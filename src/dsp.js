/* Sweep Capture core: exponential sine sweep, inverse filter, deconvolution, room-acoustic metrics. No DOM, no Web Audio. */
(function (g) {
  "use strict";
  /** In-place iterative radix-2 complex FFT. re, im: Float64Array of power-of-two length. inverse scales by 1/n. */
  function fft(re, im, inverse) {
    const n = re.length;
    for (let i = 1, j = 0; i < n; i++) { let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
    for (let len = 2; len <= n; len <<= 1) {
      const ang = (2 * Math.PI / len) * (inverse ? 1 : -1), wr = Math.cos(ang), wi = Math.sin(ang), h = len >> 1;
      for (let i = 0; i < n; i += len) { let cr = 1, ci = 0; for (let k = 0; k < h; k++) {
        const a = i + k, b = a + h, xr = re[b] * cr - im[b] * ci, xi = re[b] * ci + im[b] * cr;
        re[b] = re[a] - xr; im[b] = im[a] - xi; re[a] += xr; im[a] += xi;
        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t; } }
    }
    if (inverse) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
  }
  const pow2 = (n) => { let p = 1; while (p < n) p <<= 1; return p; };
  /** Linear convolution by FFT. */
  function convolve(a, b) {
    const n = pow2(a.length + b.length - 1), ar = new Float64Array(n), ai = new Float64Array(n), br = new Float64Array(n), bi = new Float64Array(n);
    ar.set(a); br.set(b); fft(ar, ai, false); fft(br, bi, false);
    for (let i = 0; i < n; i++) { const r = ar[i] * br[i] - ai[i] * bi[i]; ai[i] = ar[i] * bi[i] + ai[i] * br[i]; ar[i] = r; }
    fft(ar, ai, true); return ar.subarray(0, a.length + b.length - 1);
  }

  /** Exponential sine sweep (Farina 2000), f1 to f2 over T seconds, with short raised-cosine fades. */
  function sweep(f1, f2, T, sr, fade) {
    const N = Math.round(T * sr), x = new Float64Array(N), L = T / Math.log(f2 / f1), K = 2 * Math.PI * f1 * L, nf = Math.round((fade == null ? 0.02 : fade) * sr);
    for (let i = 0; i < N; i++) { const t = i / sr; let v = Math.sin(K * (Math.exp(t / L) - 1)); if (i < nf) v *= 0.5 - 0.5 * Math.cos(Math.PI * i / nf); if (i >= N - nf) v *= 0.5 - 0.5 * Math.cos(Math.PI * (N - 1 - i) / nf); x[i] = v; }
    return x;
  }
  /** Inverse filter: the sweep reversed in time with a -6 dB/octave amplitude slope, so that sweep convolved with it is a band-limited impulse. */
  function inverse(f1, f2, T, sr, fade) {
    const x = sweep(f1, f2, T, sr, fade), N = x.length, L = T / Math.log(f2 / f1), inv = new Float64Array(N);
    for (let i = 0; i < N; i++) inv[i] = x[N - 1 - i] * Math.exp(-(i / sr) / L);
    return inv;
  }
  /**
   * Deconvolve a recording y of the sweep into the impulse response. Returns { ir (linear response, starting 3 ms before the main peak),
   * full (whole deconvolution), peak (index of main peak in full), lat (peak minus the ideal position, in seconds: the system latency), h2 (second-harmonic level, dB) }.
   */
  function deconvolve(y, f1, f2, T, sr, fade) {
    const x = sweep(f1, f2, T, sr, fade), inv = inverse(f1, f2, T, sr, fade), ref = convolve(x, inv);
    let rp = 0, rm = 0; for (let i = 0; i < ref.length; i++) if (Math.abs(ref[i]) > rm) { rm = Math.abs(ref[i]); rp = i; }
    const full = convolve(y, inv); for (let i = 0; i < full.length; i++) full[i] /= rm;
    let pk = rp, pm = 0; for (let i = rp - 1; i < full.length; i++) if (i >= 0 && Math.abs(full[i]) > pm) { pm = Math.abs(full[i]); pk = i; }
    const L = T / Math.log(f2 / f1) * sr, pre = Math.round(0.003 * sr), start = Math.max(0, pk - pre), ir = Float64Array.from(full.subarray(start));
    // second harmonic arrives earlier than the linear response by L ln 2 samples; compare energies in 30 ms windows
    const w = Math.round(0.03 * sr), h2c = pk - Math.round(L * Math.LN2); let e2 = 0, e1 = 0;
    for (let i = 0; i < w; i++) { const a = h2c - (w >> 1) + i, b = pk - pre + i; if (a >= 0) e2 += full[a] * full[a]; if (b < full.length) e1 += full[b] * full[b]; }
    return { ir, full, peak: pk, lat: (pk - rp) / sr, h2: 10 * Math.log10((e2 + 1e-30) / (e1 + 1e-30)) };
  }

  /** Schroeder backward integration, energy in dB relative to the total (0 dB at the start). */
  function schroederDb(x) { const n = x.length, e = new Float64Array(n); let a = 0; for (let i = n - 1; i >= 0; i--) { a += x[i] * x[i]; e[i] = a; } const t = e[0] || 1e-30; for (let i = 0; i < n; i++) e[i] = 10 * Math.log10(e[i] / t + 1e-30); return e; }
  /** Noise-floor aware truncation: the IR is cut where its 20 ms smoothed power first comes within 6 dB of the floor (median of the last 10%), and the floor power is subtracted. */
  function cleanIR(x, sr) {
    const n = x.length, tail = x.subarray(Math.floor(n * 0.9)), np = tail.reduce((s, v) => s + v * v, 0) / Math.max(1, tail.length), w = Math.max(8, Math.round(0.02 * sr));
    let cut = n, acc = 0; const q = new Float64Array(n);
    for (let i = 0; i < n; i++) { acc += x[i] * x[i]; if (i >= w) acc -= x[i - w] * x[i - w]; q[i] = acc / w; }
    let pk = 0, pm = 0; for (let i = 0; i < n; i++) if (q[i] > pm) { pm = q[i]; pk = i; }
    cut = pk + 1; for (let i = n - 1; i > pk; i--) if (q[i] > np * 4) { cut = i + 1; break; }   // last point above the floor, so a quiet gap before the dense tail does not truncate the response
    const out = new Float64Array(cut); for (let i = 0; i < cut; i++) { const v = x[i], m = v * v - np; out[i] = m > 0 ? Math.sign(v) * Math.sqrt(m) : 0; }
    return { ir: out, floorDb: 10 * Math.log10(np + 1e-30), dr: 10 * Math.log10(pm / (np + 1e-30)), cut: cut / sr };
  }
  /** Reverberation time from a straight-line fit of the Schroeder curve between hi and lo dB (negative numbers), extrapolated to 60 dB. null if the curve never reaches lo. */
  function decayTime(x, sr, hi, lo) {
    const e = schroederDb(x); let i1 = -1, i2 = -1; for (let i = 0; i < e.length; i++) { if (i1 < 0 && e[i] <= hi) i1 = i; if (e[i] <= lo) { i2 = i; break; } }
    if (i1 < 0 || i2 <= i1 + 2) return null;
    let sx = 0, sy = 0, sxx = 0, sxy = 0, m = 0; for (let i = i1; i <= i2; i++) { const t = i / sr; sx += t; sy += e[i]; sxx += t * t; sxy += t * e[i]; m++; }
    const slope = (m * sxy - sx * sy) / (m * sxx - sx * sx); return slope < 0 ? -60 / slope : null;
  }
  /** Clarity C80 (dB) and definition D50 (0-1) from an IR whose first sample is the direct sound (the main peak sits at 3 ms; the window starts at the peak). */
  function clarity(x, sr, ms, pre) {
    let p = 0, m = 0; for (let i = 0; i < x.length; i++) if (Math.abs(x[i]) > m) { m = Math.abs(x[i]); p = i; }
    const k = p + Math.round(ms * sr / 1000); let a = 0, b = 0; for (let i = p; i < x.length; i++) { const v = x[i] * x[i]; if (i < k) a += v; else b += v; }
    return { c: 10 * Math.log10((a + 1e-30) / (b + 1e-30)), d: a / (a + b + 1e-30) };
  }
  /** RBJ band-pass (constant 0 dB peak), octave wide, run forward only. stages > 1 cascades it for steeper skirts (less leakage from neighbouring bands). */
  function bandpass(x, sr, fc, stages) {
    const w = 2 * Math.PI * fc / sr, al = Math.sin(w) / (2 * (1 / (2 * Math.sinh(Math.LN2 / 2 * 1 * w / Math.sin(w))))), c = Math.cos(w);
    const b0 = al, b2 = -al, a0 = 1 + al, a1 = -2 * c, a2 = 1 - al; let src = x, y;
    for (let st = 0; st < (stages || 1); st++) { y = new Float64Array(src.length); let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
      for (let i = 0; i < src.length; i++) { const v = (b0 * src[i] + b2 * x2 - a1 * y1 - a2 * y2) / a0; x2 = x1; x1 = src[i]; y2 = y1; y1 = v; y[i] = v; } src = y; }
    return y;
  }
  const BANDS = [125, 250, 500, 1000, 2000, 4000];
  /** Full report: broadband and octave-band T20, T30 (null when the dynamic range is too small), EDT, C80, D50, plus floor and dynamic range. */
  function analyze(ir, sr) {
    const one = (x) => {
      const c = cleanIR(x, sr), t20 = decayTime(c.ir, sr, -5, -25), t30 = c.dr >= 40 ? decayTime(c.ir, sr, -5, -35) : null, edt = decayTime(c.ir, sr, 0, -10), cl = clarity(x, sr, 80);
      return { t20, t30, edt, c80: cl.c, d50: clarity(x, sr, 50).d, dr: c.dr, floorDb: c.floorDb };
    };
    const out = { broad: one(ir), bands: {} }; for (const f of BANDS) if (f < sr / 2.5) out.bands[f] = one(bandpass(ir, sr, f, 2));
    return out;
  }
  /** 24-bit PCM mono WAV. */
  function wav24(x, sr, norm) {
    let m = 0; for (let i = 0; i < x.length; i++) m = Math.max(m, Math.abs(x[i])); const k = norm && m > 0 ? 0.95 / m : 1, n = x.length, b = new ArrayBuffer(44 + n * 3), d = new DataView(b);
    const s = (o, t) => { for (let i = 0; i < t.length; i++) d.setUint8(o + i, t.charCodeAt(i)); };
    s(0, "RIFF"); d.setUint32(4, 36 + n * 3, true); s(8, "WAVE"); s(12, "fmt "); d.setUint32(16, 16, true); d.setUint16(20, 1, true); d.setUint16(22, 1, true); d.setUint32(24, sr, true); d.setUint32(28, sr * 3, true); d.setUint16(32, 3, true); d.setUint16(34, 24, true); s(36, "data"); d.setUint32(40, n * 3, true);
    for (let i = 0; i < n; i++) { const v = Math.max(-1, Math.min(1, x[i] * k)), q = Math.round(v * 8388607); d.setUint8(44 + i * 3, q & 255); d.setUint8(45 + i * 3, (q >> 8) & 255); d.setUint8(46 + i * 3, (q >> 16) & 255); }
    return b;
  }
  /** A synthetic room for demos and tests: direct sound plus an exponentially decaying noise tail with a known RT60. */
  function syntheticRoom(sr, rt60, seed, delayMs) {
    const n = Math.round(Math.min(rt60 * 1.4 + 0.2, 6) * sr), h = new Float64Array(n), d0 = Math.round((delayMs || 0) * sr / 1000); let s = seed >>> 0 || 1;
    const rnd = () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296 * 2 - 1; };
    const t0 = Math.round(0.012 * sr), a = Math.pow(10, -3 / rt60) ; // amplitude decays 60 dB over rt60: per-second factor 10^(-3/rt60)
    h[d0] = 1; for (let i = t0; i < n - d0; i++) h[d0 + i] = 0.12 * rnd() * Math.pow(a, (i - t0) / sr); return h;
  }
  g.SweepCore = { fft, convolve, sweep, inverse, deconvolve, schroederDb, cleanIR, decayTime, clarity, bandpass, analyze, wav24, syntheticRoom, BANDS };
  if (typeof module !== "undefined") module.exports = g.SweepCore;
})(typeof window !== "undefined" ? window : globalThis);
