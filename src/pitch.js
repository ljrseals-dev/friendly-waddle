/* Pitch Ruler core: YIN pitch tracker (de Cheveigne and Kawahara 2002), note naming with cents, tuning-reference (A4) estimation, test-signal synthesis, built-in self test. */
(function (g) {
  "use strict";
  const D = g.SweepCore || require("./dsp.js");
  const NAMES = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];
  /** Frequency to note: { midi (nearest), name, octave, cents (-50..50 from that note), exact (fractional midi) } relative to A4 = a4 Hz. */
  function noteOf(f, a4) {
    a4 = a4 || 440; const exact = 69 + 12 * Math.log2(f / a4), m = Math.round(exact); return { midi: m, name: NAMES[((m % 12) + 12) % 12], octave: Math.floor(m / 12) - 1, cents: 100 * (exact - m), exact };
  }
  const hz = (midi, a4) => (a4 || 440) * Math.pow(2, (midi - 69) / 12);
  /**
   * YIN on one frame. opts: fmin, fmax, thresh (default 0.12: dips of the normalised difference function below this count as the period), minRms.
   * Returns { f0 (0 if unvoiced), clarity (1 - d'), rms }.
   */
  function yin(x, sr, opts) {
    const o = Object.assign({ fmin: 50, fmax: 2000, thresh: 0.12, minRms: 0.002 }, opts || {}), n = x.length;
    let e = 0; for (let i = 0; i < n; i++) e += x[i] * x[i]; const rms = Math.sqrt(e / n); if (rms < o.minRms) return { f0: 0, clarity: 0, rms };
    const tauMax = Math.min(Math.floor(sr / o.fmin), Math.floor(n / 2) - 1), tauMin = Math.max(2, Math.floor(sr / o.fmax)), W = n - tauMax;
    if (W < tauMax) return { f0: 0, clarity: 0, rms };
    // d(tau) = e0 + e(tau) - 2 c(tau) with c from an FFT cross-correlation
    const size = (() => { let p = 1; while (p < n + W) p <<= 1; return p; })(), ar = new Float64Array(size), ai = new Float64Array(size), br = new Float64Array(size), bi = new Float64Array(size);
    for (let i = 0; i < W; i++) ar[i] = x[i]; for (let i = 0; i < n; i++) br[i] = x[i];
    D.fft(ar, ai, false); D.fft(br, bi, false); for (let i = 0; i < size; i++) { const r = ar[i] * br[i] + ai[i] * bi[i], im = ar[i] * bi[i] - ai[i] * br[i]; ar[i] = r; ai[i] = im; } D.fft(ar, ai, true);   // conj(A) * B -> sum_j a_j b_{j+tau}
    const pre = new Float64Array(n + 1); for (let i = 0; i < n; i++) pre[i + 1] = pre[i] + x[i] * x[i]; const e0 = pre[W], d = new Float64Array(tauMax + 1), dn = new Float64Array(tauMax + 1);
    for (let t = 1; t <= tauMax; t++) d[t] = e0 + (pre[t + W] - pre[t]) - 2 * ar[t]; dn[0] = 1; let run = 0; for (let t = 1; t <= tauMax; t++) { run += d[t]; dn[t] = run > 0 ? d[t] * t / run : 1; }
    let tau = -1; for (let t = tauMin; t <= tauMax; t++) if (dn[t] < o.thresh) { while (t + 1 <= tauMax && dn[t + 1] < dn[t]) t++; tau = t; break; }
    if (tau < 0) { let m = 1e9, mt = -1; for (let t = tauMin; t <= tauMax; t++) if (dn[t] < m) { m = dn[t]; mt = t; } if (m > 0.35) return { f0: 0, clarity: Math.max(0, 1 - m), rms }; tau = mt; }
    // refine on the raw difference function: near its minimum d(u) = a - b cos(w (u - delta)) with w = 2 pi / tau, solved exactly from three samples
    // (the parabola commonly used is biased when the period is only a few dozen samples)
    let tf = tau; if (tau > 1 && tau < tauMax) { const m1 = d[tau - 1], z = d[tau], p1 = d[tau + 1], den = m1 + p1 - 2 * z; if (Math.abs(den) > 1e-12) { const w = 2 * Math.PI / tau, ratio = (m1 - p1) / den; tf = tau + Math.atan(ratio * Math.tan(w / 2)) / w; } }
    return { f0: sr / tf, clarity: Math.max(0, 1 - dn[tau]), rms };
  }
  /** Track a whole buffer. Returns { t[], f0[] (0 = unvoiced), clarity[], rms[] }. hop in seconds. */
  function track(x, sr, opts) {
    const o = Object.assign({ fmin: 50, fmax: 2000, hop: 0.01, thresh: 0.12 }, opts || {}), N = Math.min(Math.round(3 * sr / o.fmin), 1 << 14), hop = Math.round(o.hop * sr), out = { t: [], f0: [], clarity: [], rms: [] };
    for (let s = 0; s + N <= x.length; s += hop) { const r = yin(x.subarray(s, s + N), sr, o); out.t.push((s + N / 2) / sr); out.f0.push(r.f0); out.clarity.push(r.clarity); out.rms.push(r.rms); }
    return out;
  }
  /** Distribution of cents-from-nearest-note over confident frames, in 2-cent bins from -50 to 50. */
  function foldHistogram(f0, clarity, a4, minClarity) {
    const bins = new Float64Array(50); let n = 0; for (let i = 0; i < f0.length; i++) if (f0[i] > 0 && clarity[i] >= (minClarity == null ? 0.85 : minClarity)) { const c = noteOf(f0[i], a4).cents, b = Math.min(49, Math.max(0, Math.floor((c + 50) / 2))); bins[b]++; n++; } return { bins, n };
  }
  /** Circular (period 100 cents) peak of the histogram, refined by a circular mean within 15 cents: the tuning offset of the whole recording in cents relative to the A4 used. */
  function tuningOffset(f0, clarity, a4, minClarity) {
    const h = foldHistogram(f0, clarity, a4, minClarity); if (h.n < 20) return null; let bi = 0, bv = -1; for (let i = 0; i < 50; i++) { const s = h.bins[i] + 0.5 * (h.bins[(i + 49) % 50] + h.bins[(i + 1) % 50]); if (s > bv) { bv = s; bi = i; } }
    const peak = bi * 2 - 49; let sx = 0, sy = 0, w = 0; for (let i = 0; i < f0.length; i++) if (f0[i] > 0 && clarity[i] >= (minClarity == null ? 0.85 : minClarity)) { let c = noteOf(f0[i], a4).cents - peak; if (c > 50) c -= 100; if (c < -50) c += 100; if (Math.abs(c) <= 15) { sx += c; w++; } }
    let off = peak + (w ? sx / w : 0); if (off > 50) off -= 100; if (off < -50) off += 100; return { cents: off, a4: a4 * Math.pow(2, off / 1200), n: h.n, spread: (() => { let v = 0, k = 0; for (let i = 0; i < f0.length; i++) if (f0[i] > 0 && clarity[i] >= 0.85) { let c = noteOf(f0[i], a4).cents - off; if (c > 50) c -= 100; if (c < -50) c += 100; if (Math.abs(c) <= 30) { v += c * c; k++; } } return k ? Math.sqrt(v / k) : 0; })() };
  }
  function rng(seed) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296 * 2 - 1; }; }
  /**
   * Test signal. spec: { f0 (Hz), cents (detune), shape: "sine" | "saw" | "odd" | "missing" | "pulse", vibCents, vibHz, noiseDb (noise relative to signal rms, e.g. -20), dur, glideTo (Hz), seed }.
   */
  function synth(spec, sr) {
    const s = Object.assign({ f0: 440, cents: 0, shape: "sine", vibCents: 0, vibHz: 5.5, noiseDb: -200, dur: 2, seed: 1 }, spec), n = Math.round(s.dur * sr), x = new Float64Array(n), r = rng(s.seed), truth = new Float64Array(n);
    let ph = 0; const H = { sine: [[1, 1]], saw: Array.from({ length: 30 }, (_, i) => [i + 1, 1 / (i + 1)]), odd: Array.from({ length: 12 }, (_, i) => [2 * i + 1, 1 / (2 * i + 1)]), missing: Array.from({ length: 6 }, (_, i) => [i + 3, 1 / (i + 3)]), pulse: Array.from({ length: 40 }, (_, i) => [i + 1, 1]) }[s.shape];
    for (let i = 0; i < n; i++) { const t = i / sr, base = s.glideTo ? s.f0 * Math.pow(s.glideTo / s.f0, t / s.dur) : s.f0, f = base * Math.pow(2, (s.cents + s.vibCents * Math.sin(2 * Math.PI * s.vibHz * t)) / 1200); truth[i] = f; ph += 2 * Math.PI * f / sr; let v = 0; for (const [k, a] of H) if (k * f < sr / 2.2) v += a * Math.sin(k * ph); x[i] = v; }
    let e = 0; for (let i = 0; i < n; i++) e += x[i] * x[i]; const rms = Math.sqrt(e / n), k = 0.2 / rms, nz = 0.2 * Math.pow(10, s.noiseDb / 20); for (let i = 0; i < n; i++) x[i] = x[i] * k + nz * r() * 1.7320508;
    return { x, truth };
  }
  /** The built-in self test: known signals through the tracker. Returns rows { name, want (Hz), got (Hz), err (cents), pass }. */
  function selfTest(sr) {
    sr = sr || 44100; const rows = [], add = (name, spec0, tol, opts) => { const spec = Object.assign({ dur: 2 }, spec0), { x, truth } = synth(spec, sr), t = track(x, sr, Object.assign({ fmin: 40, fmax: 2500 }, opts || {})); const mid = t.f0.filter((v, i) => t.t[i] > 0.4 && t.t[i] < spec.dur - 0.4 && v > 0); const med = mid.length ? mid.slice().sort((a, b) => a - b)[mid.length >> 1] : 0, want = spec.f0 * Math.pow(2, (spec.cents || 0) / 1200); const err = med ? 1200 * Math.log2(med / want) : NaN; rows.push({ name, want, got: med, err, pass: med > 0 && Math.abs(err) < tol, voiced: mid.length / Math.max(1, t.f0.filter((v, i) => t.t[i] > 0.4 && t.t[i] < spec.dur - 0.4).length) }); };
    for (const f of [82.41, 220, 440, 1000, 2000]) add(`sine ${f} Hz`, { f0: f, cents: -23 }, 1);
    add("sawtooth 110 Hz +17 cents", { f0: 110, cents: 17, shape: "saw" }, 1.5); add("odd harmonics 196 Hz", { f0: 196, shape: "odd" }, 1.5); add("missing fundamental (harmonics 3 to 8 of 110 Hz)", { f0: 110, shape: "missing" }, 2); add("narrow pulse train 330 Hz", { f0: 330, shape: "pulse", cents: 8 }, 2);
    add("sawtooth 220 Hz with noise at -15 dB", { f0: 220, shape: "saw", noiseDb: -15, cents: 12 }, 8); return rows;
  }
  g.PitchRuler = { yin, track, noteOf, hz, foldHistogram, tuningOffset, synth, selfTest, NAMES };
  if (typeof module !== "undefined") module.exports = g.PitchRuler;
})(typeof window !== "undefined" ? window : globalThis);
