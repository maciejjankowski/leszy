---
project: P094-drone-radar
date: 2026-10-20
tags: [architecture]
---
[[P094-drone-radar]]

# Wielki Leszy - three layers, redesigned

**In one paragraph.** The phone measures and reports raw facts, the hub stores every fact, the base calculates and writes its results back to the hub. Today the base calculates and also stores (in its own localStorage), the hub keeps only the last 6 rounds, and there are two hubs. Three findings shape the plan:

- **The per-phone "offset" was a bug: the phone subtracted `ctx.outputLatency` from its own beep.** Two-way ranging cancels every fixed delay, so the correction added c/2 x outputLatency to every distance that phone was part of. Field check 2026-10-20, six devices: c/2 x reported latency vs the offset measured on the stack: tel1 7.20/6.84 m, brave 4.80/5.35, tel3 3.94/4.30, Damiantwlglowny 3.94/4.25, IPA 0.56/0.68, Mxj 0.45/0.55. Removed and deployed the same day (leszy a00f522). [4 HIGH | algebra + six-device field match within 0.1-0.55 m] What remains (0.1-0.5 m) is the speaker-to-mic gap and latency jitter; whether it is stable per page load is risk 1.
- **"Nowa runda" (`admin reset`) deletes every member row**, and `a=state` only updates existing rows: phones keep polling but are no longer members until they reload. [4 HIGH | code read of party.php]
- **Any edit to party.html, detector.js or meter.js reloads every phone** (`appVersion` hash): a deploy during a field test wipes every calibration. [4 HIGH | code read]

## 1. The layers today

| Layer | Responsibility | State it owns | Where it lives | What breaks today |
|---|---|---|---|---|
| Phone: party.html (+ ranging.js, tap-worklet.js, detector.js, meter.js) | join, beep and listen in roll calls, comb detector, levels | id, name, joined flag; 40 s audio ring; detector floor; clock offset | localStorage (id, name); memory | reloads on every deploy; only the phone itself sees what it hears |
| Phone variant: sensor.html | detector for radar.html | id, name | localStorage; reports to api.php | other hub: its phones never appear on check.html |
| Node: pair.html + bearing.js | two-mic bearing, clap zero | zero lag, device | localStorage | bearing only goes to the field log, never fused |
| Hub: party.php | members, rounds, prev ring (6), detections, field log, admin | members, kv party, log-*.jsonl | SQLite per room + JSONL | reset removes members; rooms appear from any string; no calibration/tape/map storage; ~3.5 requests/s per phone |
| Hub: api.php | reports, placement, gains, CSV | nodes, log | radar.sqlite | a second truth; radar.html shows "no phones" |
| Base: check.html (+ fusion.js, ranging.js) | guide, calibration, MDS layout, map, detection fusion, field log | offsets, tape, refK, map, filter, trail, round meta, settings, detect mode | one browser's localStorage and memory | calibration dies on a phone reload and is missing on any other screen; one long poll() does every job |

## 2. Target split

### 2.1 Who owns which state

| State | Computed by | Stored in | Survives base reload | Survives phone reload |
|---|---|---|---|---|
| id, name, role | phone | localStorage + hub members | yes | yes |
| epoch (new with each AudioContext) | phone | hub members and every round row | yes | no, by design |
| raw arrival times, snr, lvl, latencies, self-lag | phone | hub `rounds`, never pruned within a session | yes | yes |
| detection (det, f0, level, score, floor age) | phone | hub members (latest) + `det_log` (10 min) | yes | yes |
| spectrum summary | phone, when the base asks | hub members (latest) | yes | n/a |
| tape lengths | person at the base | hub `tape` | yes | yes |
| offsets, dB profile, residual | base (ranging.js) | hub `cal` keyed by (id, epoch, method) | yes | marked stale |
| map positions | base (ranging.js) | hub `map` | yes | yes |
| fixes, track | base (fusion.js) | hub `fixes` + field log | yes | yes |
| settings | person at the base | hub kv `settings` | yes | n/a |
| guide step | derived from hub state; only detect mode stored | hub kv | yes | n/a |
| thresholds, timings | params.yaml | files | yes | yes |

**Rule: the base calculates and the hub stores.** The maths stays in ranging.js and fusion.js (node-tested); a PHP port would make two copies that drift. The hub rejects a `cal` write for a stale epoch. One base holds a write lease (renewed every 5 s); other tabs are read-only and say so. [4 HIGH | keeps the tested code path]

**Reload behaviour.** A base reload reads cal, tape, map and settings from the hub and looks identical within one poll. A phone reload gets a new epoch; the base marks it "needs calibration" and offers one touch round for that phone only. [3 MODERATE | rests on risk 1]

**Hot reload.** Phones reload only in the lobby phase or when the base presses "Update phones"; the base shows "new version ready". [4 HIGH]

### 2.2 One hub

- party.php is the only hub; api.php answers 410 for one release, then goes. [4 HIGH | two hubs caused "no phones"]
- sensor.html is replaced by party.html (done for detection on 2026-10-20); extra input channels become members `id~ch2` sharing the parent's epoch.
- radar.html is retired (check.html detect mode draws fixes); pair.html joins as a member and sends `bearing`.
- One default room for every page; each page shows the room and live member count; an empty room says so.
- `reset` keeps members and cal, clears rounds; a tick from an unknown id answers `rejoin: true`.

### 2.3 Protocol

| Action | From | Rate | Payload | Reply |
|---|---|---|---|---|
| `time` | phone | 6 at join | none | t |
| `join` | phone | at start, on rejoin | id, epoch, name, role, platform, sr, lat, app ver | room, cfg, cal status |
| `tick` | phone | 1 Hz, + at once when det flips (cap 2 Hz) | id, epoch, det {det, f0, level, score, warming, floorAgeS}, heading?, bearing?, spec? | t, party, ver, want {spec}, rejoin? |
| `heard` | phone | once per round | id, epoch, round, raw, snr, lvl, lat, selfLag | ok |
| `data` | base | 1 Hz (4 Hz walker) | since round | members, rounds, cal, tape, map, settings, lease |
| `admin` | base (lease) | on press | rollcall, drones, land, reset, settings, update_phones, lease | party |
| `cal`, `tape`, `map`, `fix` | base (lease) | on result | entries with id + epoch | ok or stale |
| `log`, `logs` | base, pair | on save | as today + round ids | as today |

`spec`: 64 log-spaced bands 100 Hz-8 kHz, int8 dB, base64 (~90 bytes) plus the floor, every tick while the base has that phone selected, every 10 s otherwise. Load ~1.2 requests/s per phone instead of 3.5. [3 MODERATE | arithmetic; shared-host limits not measured]

### 2.4 Thin sensor or smart node

| | Thin sensor (phone sends spectra) | Smart node (phone decides) |
|---|---|---|
| Alarm latency | 1-2 s | ~0.5 s |
| Hosting load | 5-10 spectra/s per phone | one small JSON per second |
| Tuning | one place | hub-pushed cfg (else a deploy, which reloads phones) |
| Inspectable | by construction | only if it sends evidence |
| Hub stalls | no alarm | phone still alarms |

**Recommendation: a smart node that can be inspected.** The phone runs the detector, sends results plus a spectrum summary on request, never applies calibration. Thresholds come from hub cfg at join. Field 2026-10-20 adds one more input: single phones rarely held a pitch for 0.5 s, but 3-4 phones often agreed within 5% at moderate score, so the base should also fuse the phones' best pitches (network vote). [3 MODERATE | one field session]

## 3. Migration, six steps

1. **Stop the silent failures.** Unknown id answers `rejoin`; `reset` keeps members; hot reload only in lobby or on "Update phones"; `epoch` in join and heard. Test: `node tests/regressions.cjs`; party_sim with a reset mid-run; field: reset, phones back within 2 s without a tap.
2. **Raw times (done 2026-10-20) and latency shown, never applied.** Base shows per phone the residual offset after the fix. Test: ranging.test.js case proving the old correction adds c/2 x (outA + outB); field: 3-round pile, residual offsets under 0.3 m on all phones.
3. **Calibration on the hub.** `cal` and `tape` tables keyed by (id, epoch); localStorage is a cache; write lease. Test: tests/cal_sim.js, second base client gets identical offsets; field: reload the base mid-test, map unchanged.
4. **One hub.** sensor/radar/pair on party.php; api.php 410; room badge everywhere. Test: grep test fails if any app file calls api.php; field: every device appears on check.html.
5. **`tick` and inspectable phones.** state, detect, pose merge into tick; spectrum on request; base mini-spectrum per phone; network vote; cfg from the hub. Test: tests/run.js "drone present from t=0" (added 2026-10-20) and "drone after 60 s of learning"; spec under 200 bytes; party_sim at 20 phones for request rate.
6. **Map and fixes on the hub; base split into modules** (ranging, calibration, detection, guide), each with a node test; pair.html bearing drawn as a ray. Test: tour_sim + party_sim end to end; field: full guide with one forced phone reload and one base reload, ending in a fix.

## 4. Riskiest assumptions

| # | Assumption | Why it matters | First observable sign it is wrong |
|---|---|---|---|
| 1 | With the latency bug gone, the residual per-phone offset is under 0.3 m and fixed within one epoch | "one touch round after a reload" and stored offsets depend on it | next pile: any phone's residual over 0.5 m, or one phone moving more than 20 cm between rounds of one epoch [3 MODERATE] |
| 2 | Shared-hosting PHP + SQLite keeps up with ~28 requests/s | one hub only works if it is never the bottleneck | 10+ phones: tick p95 over 300 ms, `database is locked`, or member age over 3 s on the base [2 LOW | not measured] |
| 3 | The phone's own decision is good enough; spectra are evidence | otherwise move toward the thin sensor | base mini-spectrum shows 4+ teeth while that phone reports det false in more than 1 of 10 fake-drone passes [3 MODERATE | one real drone pass so far] |
