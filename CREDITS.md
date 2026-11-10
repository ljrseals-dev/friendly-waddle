# Credits

Written from memory; not re-checked against the sources.

- de Cheveigne, A., and Kawahara, H. (2002). YIN, a fundamental frequency estimator for speech and music. Journal of the Acoustical Society of America 111(4). The difference function, cumulative mean normalisation, absolute threshold and parabolic interpolation used here.
- Equal temperament: frequency = A4 x 2^((n - 69) / 12) for MIDI note n; a cent is 1/100 of a semitone.
- A4 = 440 Hz as the usual concert reference (ISO 16:1975); 415, 432 and others offered as options.

Test signals, thresholds and the tuning-estimate method (circular histogram peak refined by a mean within 15 cents) are the author's design. `src/dsp.js` (FFT) is shared with Sweep Capture.
