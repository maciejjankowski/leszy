# Wielki Leszy

**Phones that hear drones.** Every phone in the room listens for the sound a propeller makes, and a radar page combines what they hear into a position, a speed and a heading. Nothing to install: it runs in the phone's browser.

## Links

Live (PIN-gated beta; the base screen's QR carries the PIN, so guests type nothing):

| What | Live | In this repo |
|---|---|---|
| Base: QR + "phones beep" + room map (café test) | [check.html](https://demo.maciejjankowski.com/drone-ear/check.html) | [check.html](check.html) |
| Guest phone: join, test, beep, listen | [party.html](https://demo.maciejjankowski.com/drone-ear/party.html) | [party.html](party.html) |
| Stage screen for the audience demo (drones, reveal) | [stage.html](https://demo.maciejjankowski.com/drone-ear/stage.html) | [stage.html](stage.html) |
| Radar (4-phone demo) / simulated flight | [radar.html](https://demo.maciejjankowski.com/drone-ear/radar.html), [radar.html?sim](https://demo.maciejjankowski.com/drone-ear/radar.html?sim) | [radar.html](radar.html) |
| Phone sensor (drone detector) | [sensor.html](https://demo.maciejjankowski.com/drone-ear/sensor.html) | [sensor.html](sensor.html) |
| Fake drone (synthetic rotor sound) | [emitter.html](https://demo.maciejjankowski.com/drone-ear/emitter.html) | [emitter.html](emitter.html) |
| Deck, Polish (S = speaker notes) | [drone-ear.html](https://demo.maciejjankowski.com/drone-ear/presentations/drone-ear.html) | [presentations/drone-ear.html](presentations/drone-ear.html) |
| Deck, English | [drone-ear-en.html](https://demo.maciejjankowski.com/drone-ear/presentations/drone-ear-en.html) | [presentations/drone-ear-en.html](presentations/drone-ear-en.html) |
| Printable cue cards (PL / EN) | [stickies](https://demo.maciejjankowski.com/drone-ear/presentations/drone-ear-stickies.html), [EN](https://demo.maciejjankowski.com/drone-ear/presentations/drone-ear-stickies-en.html) | [presentations/](presentations/) |

Reference projects: [VolAnti](https://github.com/agamrossen/VolAnti) (detector design, range tables, BOM) · [Batear](https://github.com/batear-io/batear) (ESP32 + LoRa alerting) · BeepBeep acoustic ranging (Peng et al., ACM SenSys 2007).

**The name.** Leszy is the forest spirit of Polish and Ukrainian folklore that guards the woods and leads intruders astray. Wielki ("great"), because once deployed it is meant to span the whole border.

Detection and alerting only. No jamming, no countermeasures.

Built for a hackathon on top of two open projects: [VolAnti](https://github.com/agamrossen/VolAnti) (detector design) and [Batear](https://github.com/batear-io/batear) (edge detector + LoRa alerting).

---

## Why sound

A drone can switch off its radio. A fibre-optic drone never has one. It cannot switch off its propellers. A propeller with B blades at R revolutions per second chops the air B x R times a second, and because the chop is not a smooth wave, the sound has energy at 2x, 3x, 4x that rate too: a **harmonic comb** of evenly spaced peaks. Wind, traffic and voices do not make evenly spaced peaks. That spacing is what we listen for.

## How it works

```
 phone (Safari/Chrome)            hub (PHP + SQLite)          radar (any browser)
 mic -> FFT -> comb detector  ->  5 reports/s per phone  ->  fuse levels -> position
       "DRONE, 430 Hz, -48 dB"                               Kalman filter -> speed, heading
```

1. **Listen.** The microphone feeds an 8192-point FFT every 60 ms. A 100 Hz high-pass cuts hum and handling thumps.
2. **Learn the room.** For the first 2 s each phone learns what "normal" sounds like in every frequency bin, and keeps updating slowly afterwards.
3. **Find the comb.** For every candidate rotor rate from 100 to 2000 Hz: energy on the teeth minus energy in the gaps. A single whistle is rejected (needs 4+ teeth lit), half-rate ghosts are rejected (octave check).
4. **Insist.** Only the same rate winning 6 frames in a row (within 3%) raises the alarm. Noise does not hold still; a rotor does.
5. **Measure loudness on the teeth only**, so speech and room noise do not move it.
6. **Fuse.** Loudness falls by 6 dB every time the distance doubles. The drone's own loudness is unknown, so the radar searches for the one point where all phones agree on it (needs 3+ phones). A Kalman filter turns the jumpy fixes into a smooth track with speed, heading and a 3 s predicted path.
7. **Fallback.** An amber ring always marks the phone that hears the drone loudest. That needs no model and works even when the position fix wanders.

## Run it

| What | Where |
|---|---|
| Phones (need https for the microphone) | `https://demo.maciejjankowski.com/drone-ear/` -> **Sensor**, gated by its own PIN (`DRONE_EAR_PIN` in `.env`, not the shared demo PIN); `?pin=` in any link unlocks it, which is what the stage QR does |
| Publish | `scripts/demo_publish.sh --site mj --name drone-ear --src deliverables/projects/2026-10-094-drone-radar/app --pin-var DRONE_EAR_PIN --pin-qr` (plain `--pin` would fall back to the shared PIN, which must never go into a QR) |
| Radar | same address -> **Radar**; `radar.html?sim` runs a simulated flight with no phones |
| No drone? | a spare phone opens **Fake drone**, or tick **Self-test** on a sensor |
| Local copy | any PHP 8 + SQLite host; drop this folder in, open `index.html` |

**Setup:** phones in a 2-3 m ring (indoors) or a 6-8 m square (outdoors), flat, screens up, at about flight height, Auto-Lock off. Press **Calibrate** with all phones together first: different phone microphones differ. Full test-day script: `../2026-10-14_drone-ear-poc.md`.

## Audience demo ("drone party")

Everyone in the room becomes part of the network.

1. **Join.** People scan the QR on `stage.html` and tap Join on `party.html` (ringer on, volume up). The presenter opens `party.html?role=L` and `?role=R` on two devices at the front-left and front-right corners.
2. **Roll call.** Every phone beeps once in its own half-second slot (a 40 ms chirp at 8-12 kHz, above most speech) while all phones record. Each phone notes when it heard every beep on its **own** clock, so no clock sync is needed: for phones A and B, `d = c/2 x ((tA(B) - tA(A)) - (tB(B) - tB(A)))` (two-way ranging, BeepBeep, SenSys 2007; detector reused from project P074 room-map).
3. **Map.** Pair distances become a seating map (weighted MDS, works with missing pairs); the two corner devices turn it the right way round (stage on top).
4. **Drones.** "One drone" picks a random phone and makes it play a rotor sound at its own pitch; every other phone reports how loud it hears that pitch, and the stage screen locates it. The room points; "Reveal" shows who it was and how far off the fix was.

`?loop=1` on `party.html` feeds a phone's own output into its recorder: a one-browser test without a microphone.

Tests: `tests/ranging.test.js` (simulated room with unrelated clocks, playback latency, reflections, a 10 cm speaker-mic gap, a 25 C room and one blocked pair: median map error 0.105 m) and `tests/party_sim.js` (14 simulated phones through the real hub: map 0.11 m, drone fix 0.30 m). Not yet tried with a real audience.

## External microphones (DJI Mic and similar)

`sensor.html` asks for every input channel. A receiver that delivers its transmitters as separate channels (e.g. DJI Mic split-track or 4-track mode, unverified for browsers) shows up as one sensor per channel ("name ch2", "ch3"...), each placed on the radar like a phone. Channels from one receiver share one clock, which is what a future time-difference (TDOA) fix needs.

## Files

| File | Role |
|---|---|
| `detector.js` | comb detector (shared by phones and tests) |
| `fusion.js` | level-based localization, Kalman tracker, simulator |
| `sensor.html` | phone page: mic, detector, reporting, spectrum strip |
| `radar.html` | radar screen, phone placement, calibration |
| `api.php` | hub: reports, placement, gains, CSV export |
| `synth.js`, `emitter.html` | synthetic rotor sound for testing |
| `../tests/run.js` | detector on synthetic audio + fusion on a simulated flight (`SEED=n`) |
| `../tests/regressions.cjs` | 9 browser-race reproductions |
| `ranging.js`, `party.html`, `party.php`, `stage.html`, `tap-worklet.js` | audience demo: beep roll call, room map, phone drones |
| `presentations/` | the deck (reveal.js) and printable cue cards |

## What is proven, what is not

| Proven (tests, browser) | Not yet proven |
|---|---|
| no false alarm in 26 s of noise, single tones ignored | a real drone, real phones, a real room |
| comb found in 0.21 s, rate within 2% | Safari actually turning off mic processing on every device |
| median track error 0.2-0.5 m in simulation, 5 phones | localization in reverberant rooms (expected weak beyond ~1 m from a phone) |
| works at 44.1 and 48 kHz, Safari's analyser window | anything outdoors, wind, range |

## Novel ideas worth checking

Each is untested at field scale. Ordered by how cheaply it can be checked.

1. **Phones as the sensor network.** No hardware at all for a first deployment; Ukraine's acoustic network started on phones before moving to dedicated boxes.
2. **Localization without clocks.** Comparing loudness between phones needs no time sync, unlike time-of-arrival methods.
3. **Loudest-phone zones.** A zero-model fallback an operator can trust when the fix is noisy.
4. **Speed from one microphone.** A passing engine drops in pitch; the ratio of approach to departure pitch gives the speed (50 m/s gives a 34% drop). Needs steady engine revs.
5. **Two rows instead of one line.** Which row hears it first gives the direction of crossing; the time between rows gives speed across the line.
6. **Horn on the microphone = a direction finder.** A horn only gains when its mouth is wavelength-sized (about 18 cm at 600 Hz), and it makes the node directional: that turns it into a bearing post.
7. **Acoustic + radio, two layers.** Loud engine drones are heard far; quiet electric fixed-wing drones are not, but they talk over radio links that an RF detector can hear.

8. **Ears first, eyes to confirm.** A camera alone mistakes birds for drones; sound alone gives no direction. Use the sound as the trigger (a rotor comb, which birds do not make) and a camera only to find the dark dot at that moment: it gives a bearing, which loudness cannot. A phone lying flat outdoors already points its selfie camera at the sky; a Raspberry Pi with camera + USB mic is a fixed node closer to the border hardware. Bird check on top: a flapping bird flickers at its wingbeat, a drone silhouette does not. Untested.

## Plans

1. **Hackathon:** 4 mixed devices + one drone. Prove the pipeline end to end.
2. **Field day:** phones on tripods 50-200 m apart outdoors. Measure detection versus distance and wind.
3. **Pilot:** ~12 ESP32 nodes (VolAnti-class: 4 MEMS mics + LoRa) and 2 gateways, 30 days, recorded ground truth, agreed pass criteria.
4. **Sector:** spacing from pilot data; plugged into the existing border-monitoring workflow, not a parallel system.

Design notes for the border-scale network: `../2026-10-14_border-acoustic-network.md`.

## Credits and licence

Detector approach: VolAnti by Agam Rossen (Apache-2.0 code, CERN-OHL-W hardware). Edge + LoRa architecture: Batear. This prototype: plain JS + PHP, no frameworks.
