---
project: P094-drone-radar
date: 2026-10-17
tags: [field-test, procedure, wielki-leszy]
---
# Field test 2026-10-17: phones map themselves, DJI pair gives a bearing, drone range

[[P094-drone-radar]] | app: `/Users/mj/code/the-template/deliverables/projects/2026-10-094-drone-radar/app/` | live: https://demo.maciejjankowski.com/drone-ear/ (PIN = `DRONE_EAR_PIN` in `.env`, never the shared one)

Gear: iPad (IPA, loudest), MacBook (brave), iPhone 13 (Mxj), Android (unknown Samsung, never joined yet), DJI Mic 3: 2 TX + RX on the MacBook by USB-C, measuring tape. Everything below writes to the hub's field log; pull it afterwards with `/Users/mj/code/the-template/deliverables/projects/2026-10-094-drone-radar/tests/fetch_logs.sh test 500`.

Levels: everything here is a procedure, not a claim; the two numbers to beat come from this project's own tests (map median error < 0.3 m in `tests/party_sim.js`; bearing within 1-3 samples at 48 kHz in `tests/bearing.test.js`). Indoor/outdoor drone range is unmeasured [1 SPECULATIVE | brak pomiaru], that is what test D is for.

## 0. Before leaving (10 min)

- Internet for every device: phone hotspot (not the MacBook, it has to stay a quiet listener). Pages are on the demo host, mic needs https, so no local server.
- All phones: volume max, Do Not Disturb on, auto-lock off (Settings > Display > Auto-Lock > Never), Bluetooth off (no AirPods stealing the output), Low Power Mode off.
- Every phone opens `party.html?room=test` once at home, taps Test (whistle) and Dołącz, so permissions are granted before the field. Install as PWA from the QR on `check.html` if you want the Home Screen icon (iOS gives it its own cookie jar; the QR carries the PIN).
- MacBook: Brave, two tabs: `check.html` (base) and `pair.html`. Input device for pair = the DJI receiver. RX settings: channel mode **Stereo**, both TX same Lossless setting (both on or both off), gain mid. Pair the TX before leaving.
- Charge: TX ~? h each on their own cells, RX from the MacBook. Bring the charging case.

## A. Phones hear each other and map themselves (20 min)

Base = MacBook `check.html?room=test`. Settings: band 8-12 kHz, gain 60%, slot 0.5 s, temperature = outside air (sound speed).

1. **Join:** all four phones on `party.html?room=test`, each visible on the base. Android: if it never shows up, screenshot its page and its browser name; test the whistle; that is finding #1 of the day.
2. **Pile:** all four phones stacked on one surface (MacBook lid closed is fine: its mic is at the hinge). Base: `Stos: kalibruj`, wait for the "Stos gotowy" toast (3 rounds, ~25 s). Note the per-device offsets and "reszta" from the toast into the note field, `Zapisz pomiar`. Pass: reszta under 10 cm.
3. **Square:** phones at the corners of a 2 m x 2 m square, screen up, speakers pointing in. Tape the four sides and both diagonals, type them into the "taśma" column. `Ciągle` for 5 rounds, then `Zapisz pomiar` with note "kwadrat 2 m". Pass: every pair error under 0.3 m, no `głuchy` cell, no `?` suspect.
4. **Line:** phones in a straight line 0, 3, 6, 10 m (as far as the tape goes). Same: tape, 5 rounds, save "linia 3-6-10". This is the range test for the beeps: the first pair marked `x` (not heard) tells the beep range in open air.
5. **Reload check:** reload one phone (say Mxj), re-join, do not re-pile. Base should toast that its calibration expired and that pair should be off by its offset. Save "po przeładowaniu Mxj". Then pile again (only needed for the reloaded one, but the pile button does all).
6. **Walker:** long-press Mxj on the map, walk it 5 m away along the tape, stop, read "od startu N cm", save "walker 5 m". Pass: within 0.5 m.

If step 3 fails on one phone only: that phone's offset is wrong, re-pile. If every pair is off by the same amount: temperature setting, fix it and re-fit (no new rounds needed).

## B. DJI pair bearing (15 min)

`pair.html?room=test` on the MacBook. TX1 = left, TX2 = right, 30 cm apart on a flat surface (two chairs, a bench), mics pointing up, MacBook a metre behind. Rozstaw = 30.

1. Header must say `2 kan.`. If `1 kan.`: Brave merged the channels; note it, finish test A and D, and we route around it later (TRS cable into a USB audio interface, or the DJI app's export).
2. **Zero:** clap once exactly between the two TX (tape: 15 cm from each). Press `Zero`, clap again until it says "Zero ustawione". Note the ms value: that is the radio latency difference between the transmitters. Save "zero".
3. **Sign:** clap 2 m to the left of the pair. The dial must swing to L. Then 2 m right. Save "L" and "P" each. If the sign is wrong, swap the TX physically and redo the zero.
4. **Arc:** iPhone running `emitter.html` (f0 320 Hz) at 3 m, at 0, 30, 60, 90 degrees from straight ahead (tape 3 m along the baseline for 90, 2.6 m / 1.5 m for 60 / 30). Hold still 5 s each, note the true angle in the note field, save each. Pass: within 10 degrees, rozrzut under 3.
5. **Repeat zero** at the end: clap between the TX again without pressing Zero; the dial should read within 3 degrees of 0. If it drifted, the two radio links do not share a stable latency, and the pair cannot give a bearing without timecode.

## C. Phones vs DJI as drone ears (10 min)

`radar.html` on the MacBook, `sensor.html` on each phone (not party.html: different hub), phones at the 2 m square corners, DJI pair where it stood. iPhone `emitter.html` as the drone, or the real drone if it flies.

Walk the emitter in from 20 m along the tape. For each phone and for `sensor.html` fed by the DJI RX (open a third tab, select the DJI input), note the distance where the status turns DRON and stays for 3 s. Write them into the base note: "zasięg: IPA 12 m, Mxj 9 m, Bbbb 6 m, DJI 18 m" and save. Outdoors a toy drone at 320 Hz through a phone speaker is quiet; the real drone will carry further.

## D. Real drone, if it flies (15 min)

Same layout. Hover at 5 m, 10 m, 20 m, 30 m horizontal, 2-3 m up. Note which phones show DRON, the f0 they report (should agree within 3%), and whether `radar.html` places the fix on the right side of the square. Save each hover as "dron 10 m". If nothing fires at 5 m: the rotor f0 is outside 100-2000 Hz or the comb is too weak; keep the `sensor.html` spectrum screenshot, that is the finding.

## Afterwards

`tests/fetch_logs.sh test 500 > /Users/mj/code/the-template/runtime/p094/field-log-2026-10-17.jsonl`, then I turn the saved pairs vs tape into the error table for the README and the deck (slide "co zmierzyliśmy").

If this plan is wrong, the first sign is step A2: a "reszta" over 30 cm on the pile means the beeps are not being detected cleanly outdoors (wind, no reflections to help), and the day becomes a detector-tuning day: switch band to 2-6 kHz, gain 90%, slot 1 s, and repeat the pile before anything else.

## Results 2026-10-20: real drone, DJI Mic 3 pair 2.5 m apart

Recording: `/Users/mj/code/the-template/runtime/p094/recordings/dji-pair-20261020-122920.wav` (56 s, stereo 48 kHz 24-bit, straight from the receiver, no browser processing). Per-frame analysis next to it (`.frames.json`), script in the job tmp (`analyse.js`: band level, comb f0 per channel, GCC-PHAT lag).

| Segment | Time difference L-R | Position from centre (c x lag / 2) | Level L-R |
|---|---|---|---|
| hover near P, 11-17 s | -4.6 ms | 0.8 m towards P | -11 dB |
| hover near L, 19-26 s | +6.4 ms | 1.1 m towards L | +17 dB |
| near P again, 27-34 s | -6.0 ms | 1.0 m towards P | -11 dB |
| near L again, 43-51 s | +5.4 ms | 0.9 m towards L | +11 dB |
| crossing the middle | +0.3 to +0.7 ms | 0.0-0.1 m | -3 to -5 dB |

What it shows [4 HIGH | one recording, two passes each way, two independent cues agree]:
- The time difference between the two DJI channels tracks the drone along the baseline to about 0.2 m, and flips sign within a second when it crosses. The theoretical limit for 2.5 m is 7.3 ms; hovers near a mic read 5.4-6.4 ms, so the drone hovered roughly 0.1-0.4 m inside each mic.
- The two transmitters' radio delays differ by under 0.5 ms: the middle crossing reads 0.3-0.7 ms, so no clap zero was needed at this accuracy.
- Level difference agrees in sign with the time difference in every segment: 10-17 dB louder at the near mic.
- The comb detector is the weak link: per-channel pitch jumps between 110 and 1900 Hz; the two channels agree only in short stretches (170-213 Hz at 11-14 s). Detection for this drone should lean on band level above the room floor and on two-mic agreement, not on a single-channel 0.6 s pitch chain.
