# Pitch Ruler

A tuner you can check. It tracks pitch with the YIN method, names the note, and shows how many cents sharp or flat you are against a reference A4 you choose (415 to 466 Hz). Three sources:

- **Microphone**: live note, cents, Hz, a ruler with a needle, a scrolling pitch trace, and statistics over the last five seconds.
- **Recording**: analyse a file; the page reports the median offset, the spread, the share of voiced frames, a histogram of cents-from-nearest-note, and **what A4 the recording was tuned to**.
- **Test instrument**: a synthetic sound whose true pitch the page knows (sine, sawtooth, odd harmonics, missing fundamental, narrow pulses; detune, vibrato, noise). It plays it and tells you how far the measurement is from the truth.

Also a reference tone generator and a built-in **self test** table that runs known signals through the tracker.

Open `index.html`. (`artifact.html` is identical; this page has no download buttons.)

## Build and test
`python3 build.py`, then `node tests/core.test.mjs` and `NODE_PATH=$(npm root -g) node tests/browser.test.cjs`. The browser test uses headless Chromium with a fake microphone fed from `tests/_mic.wav` (A3 plus 20 cents), so the live microphone path runs end to end.

## What is verified (measured)
All on synthetic signals of known pitch, so the errors are best-case.
- **Pure tones, 41 Hz to 2 kHz** at five detunes each (55 cases): worst error 0.00 cents.
- **Rich and awkward sounds**: sawtooth, odd harmonics, narrow pulse train and a missing fundamental (harmonics 3 to 8 of 110 Hz) all come out at the true fundamental in every frame (no octave errors); sawtooth with noise 15 dB below the signal: 0.04 cents.
- **Not voiced when there is no pitch**: white noise 0.0% voiced, silence 0%.
- **Vibrato** (5.5 Hz, plus or minus 30 cents): 2.1 cents rms error with the 100 Hz range setting, 7.4 cents with the 40 Hz setting (its longer window smooths fast vibrato; the traced range falls from 60 to 54 cents).
- **Glide** 200 to 400 Hz in 1.5 s: worst error 9.6 cents.
- **Tuning reference**: melodies built on A4 = 432, 438, 442.5, 440 Hz estimated as 432.08, 438.08, 442.57, 440.09 Hz.
- **Note naming**: 440 Hz is A4, 442 Hz is +7.85 cents, 466.16 Hz is A sharp 4, middle C is C4.
- **Live microphone path** (fake microphone, 222.556 Hz): reads A3, +20.0 cents, 222.56 Hz; the same file as a recording gives +20.0 cents and A4 = 445.11 Hz.
- **Test instrument in the page**: commanded +14, -23, +7, +38 cents (sine, sawtooth, missing fundamental, odd harmonics) measured as +14.00, -23.19, +6.97, +38.06.
- The page: no errors, no horizontal scroll at 390 px, all canvases drawn.

## Bugs found while building
The first version of the correlation step had a sign error (it computed the correlation at negative lag), which made low notes unvoiced and some pitches wrong by tens of cents. The pure-tone sweep from 41 Hz found it.

## Not verified, and limits
- **Only synthetic signals and one synthetic microphone file have been tested.** Real instruments (inharmonic strings, breathy voices, room noise, a real microphone and sound card) have not. Real-world accuracy will be worse than the numbers above; I do not know by how much.
- Equal temperament only; no just intonation, meantone or other temperaments.
- **A tuning estimate is only defined modulo a semitone**: a recording tuned to A4 = 415 Hz reads as 439.76 Hz (about 2 cents under 440), because 415 Hz is almost exactly 440 Hz lowered one semitone. The page cannot tell A = 415 from A = 440 with every note a semitone lower.
- The reported accuracy depends on the audio device's clock; I assumed it is exact (a 100 ppm error is about 0.17 cents).
- Strictness and range settings change how fast and how steady the readout is; defaults are my choices.
- Live updates are about ten per second, with a median of the last five readings; very fast pitch changes are smoothed.

## Citations
See CREDITS.md.
