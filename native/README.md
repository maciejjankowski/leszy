# Wielki Leszy, native

Drone detection and location on this Mac from raw microphone input, no browser. One Python file, `leszy.py`; every number in `ssot/params.yaml`, every printed line in `ssot/ui.yaml`.

**Why a fresh program:** the browser pages were built around WebAudio, phone clocks and the hub. Here the mics sit on fixed stands and an audio interface (Zoom U-44) gives one clock for four inputs, so time differences between them are exact. The algorithms that proved themselves (rotor comb with a spectral baseline, GCC-PHAT, loudness fix, tracker) are ported from `app/detector.js`, `app/bearing.js`, `app/fusion.js`.

## Setup (once)

```bash
cd /Users/mj/code/the-template && source venv/bin/activate && pip install sounddevice numpy pyyaml
cd deliverables/projects/2026-10-094-drone-radar/native
python3 leszy.py devices              # names and channel counts
cp config.example.yaml config.yaml    # then put the tape-measured mic positions in it
```

Devices with `sync: true` (U-44, one DJI receiver in Stereo) give time differences between their own mics. Mics on different devices only share loudness. Two identical receivers: same `name`, `index: 0` and `index: 1`.

## Procedure

| Step | Command | What you do | Good result |
|---|---|---|---|
| 1 | `python3 leszy.py noise` | 10 s of silence | a background level per mic |
| 2 | `python3 leszy.py clap --at 1.5,1.5` | clap 5 times at that point, every 2-3 s | delays per channel: U-44 near 0 ms, a DJI pair under 0.5 ms |
| 3 | `python3 leszy.py points` | the drone hovers over each `calib_points` entry, Enter, 8 s each | error per point, before and after |
| 4 | `python3 leszy.py run` | fly | `DRON 152 Hz (1.23, 2.40) m ±0.05 m` lines; fixes go to the web map |

Calibration lands in `calib.json` next to the config. Web map: http://localhost:18080/drone-ear/native.html (the program POSTs to `post_url`, `--post ""` turns it off). `--log FILE.jsonl` keeps every analysis step. Any command takes `--wav DEVICE=file.wav` instead of live input.

## Tests

`python3 test_leszy.py` (no hardware): pitch and time-difference checks, a simulated four-rotor flight over 4 U-44 mics + a DJI pair, clap and point calibration with hidden delays and sensitivities, a held-out flight, and the real 2026-10-20 DJI recording (each hover lands on the correct mic's side). 12/12 on 2026-11-06.

Limits [3 MODERATE | simulator + one real recording]: the simulator is cleaner than a room (no reflections); with one DJI pair alone the fix is only along the line between the two mics; the comb pitch is shown but detection leans on loudness above the background and on mics agreeing.
