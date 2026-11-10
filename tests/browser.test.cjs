const { chromium } = require("playwright"), http = require("http"), fs = require("fs"), path = require("path"), assert = require("assert");
const server = http.createServer((q, r) => { r.setHeader("content-type", "text/html; charset=utf-8"); r.end(fs.readFileSync(path.join(__dirname, "..", "index.html"))); });
const MIC = path.join(__dirname, "_mic.wav");   // A3 plus 20 cents (222.556 Hz), eight harmonics, looped by Chromium as the fake microphone
(async () => {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const b = await chromium.launch({ args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--use-file-for-fake-audio-capture=" + MIC, "--autoplay-policy=no-user-gesture-required"] });
  const ctx = await b.newContext({ viewport: { width: 390, height: 900 }, permissions: ["microphone"] }), p = await ctx.newPage(); const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  await p.goto(`http://127.0.0.1:${server.address().port}/`); await p.waitForFunction(() => window.__pr);
  // 1. live microphone path end to end
  await p.click("#micGo"); await p.waitForTimeout(3500);
  const live = await p.evaluate(() => ({ nm: document.getElementById("nm").textContent, cents: document.getElementById("cents").textContent, hz: document.getElementById("hz").textContent, last: window.__pr.S.last && window.__pr.S.last.f0 }));
  console.log("live:", JSON.stringify(live)); assert(live.last > 0, "live pitch found"); const lc = 1200 * Math.log2(live.last / 222.5563); assert(Math.abs(lc) < 3, "live pitch within 3 cents of the fake microphone: " + lc.toFixed(2)); assert(/^A/.test(live.nm) && live.nm.includes("3"), "note name " + live.nm);
  await p.click("#micStop");
  // 2. test instrument: commanded detune recovered, for several waveforms
  await p.click("#sTest"); const rows = [];
  for (const [shape, cents] of [["sine", 14], ["saw", -23], ["missing", 7], ["odd", 38]]) { await p.selectOption("#tShape", shape); await p.evaluate((c) => { const e = document.getElementById("tCents"); e.value = c; e.dispatchEvent(new Event("input")); }, cents); await p.click("#tGo"); await p.waitForFunction(() => window.__pr.S.testResult !== undefined && document.getElementById("tSt").textContent.length > 0, null, { timeout: 30000 }); rows.push(await p.evaluate((s) => ({ s, ...window.__pr.S.testResult }), shape)); }
  console.log("test instrument:", rows.map((r) => `${r.s} commanded ${r.commanded} measured ${r.measured.toFixed(2)}`).join("; ")); for (const r of rows) { assert(Math.abs(r.err) < 1.5, `${r.s} error ${r.err}`); assert.equal(r.midi, r.wantMidi); }
  // 3. recording: the fake-mic file analysed as a recording
  await p.click("#sFile"); await p.setInputFiles("#file", MIC); await p.waitForFunction(() => window.__pr.S.trace && /_mic/.test(window.__pr.S.trace.label) && window.__pr.S.trace.t.f0.length > 100, null, { timeout: 60000 });
  const rec = await p.evaluate(() => { const t = window.__pr.S.trace.t; const v = t.f0.filter((x) => x > 0).sort((a, b) => a - b); return { med: v[v.length >> 1], voiced: v.length / t.f0.length, med2: document.getElementById("sMed").textContent, a4: document.getElementById("sA4").textContent }; });
  console.log("recording:", JSON.stringify(rec)); assert(Math.abs(1200 * Math.log2(rec.med / 222.5563)) < 1, "recording median"); assert(rec.voiced > 0.9);
  // 4. self test table and layout
  await p.click("#stGo"); await p.waitForFunction(() => document.querySelectorAll("#stTb tr").length >= 10, null, { timeout: 60000 }); const st = await p.evaluate(() => [...document.querySelectorAll("#stTb tr")].map((r) => r.textContent)); assert(st.every((t) => /ok|pass/i.test(t) && !/fail/i.test(t)), "self test rows: " + st.join(" | "));
  const px = await p.evaluate(() => { const cnt = (id) => { const c = document.getElementById(id), g = c.getContext("2d"), d = g.getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] !== d[0] || d[i + 1] !== d[1]) n++; return n; }; return { ruler: cnt("ruler"), trace: cnt("trace"), hist: cnt("hist"), over: document.documentElement.scrollWidth > innerWidth + 1 }; });
  console.log("canvas pixels", JSON.stringify(px)); assert(px.ruler > 100 && px.trace > 200 && px.hist > 100); assert(!px.over, "no horizontal scroll at 390 px"); assert.deepEqual(errs, []);
  console.log("pitch ruler browser tests ok"); await b.close(); server.close();
})().catch((e) => { console.error(e); process.exit(1); });
