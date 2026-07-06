/* DRIFTDREAM perf HUD — dev telemetry overlay. Toggle with the backtick (`) key, or read a one-shot
   snapshot from the console with DD.perf.snapshot(). Answers the only question that matters when the
   frame rate drops: are we CPU-bound (too much JS / too many draw calls to submit) or GPU-bound (too
   much fill rate / shadow / bloom)? — by measuring both sides of the frame:
     - frame time / FPS : real rAF cadence (incl. 1% low, the hitch metric)
     - CPU ms           : total main-thread time in the frame callback (patched rAF)
     - GPU ms           : true GPU frame time via EXT_disjoint_timer_query_webgl2 (async, ~3-frame lag).
                          Not every browser exposes it (privacy-gated in some Chromium incl. Opera; absent
                          in Firefox/Safari) — then GPU shows n/a but the bound verdict is still INFERRED
                          from the frame-vs-CPU gap (works anywhere), and DD.perf.gpuProbe() gives a rough
                          relative gl.finish() number for same-browser before/after A/B.
     - heap MB          : performance.memory (Chromium/WebView only) — watch it climb = GC hitches/leak
     - draws / tris / …  : Three's own renderer.info (same source as DD.debugGL)
   Overhead is ~0 when hidden: only frame/CPU timing runs (a couple of performance.now calls); the GPU
   timer query and DOM writes happen ONLY while the overlay is visible. THREE-free, no dependencies. */
(function () {
  'use strict';
  const DD = window.DD;
  if (!DD || typeof document === 'undefined') return;

  const N = 180; // rolling window (~3s @60fps) for FPS avg + 1% low
  const hist = new Float32Array(N);
  let hi = 0, hn = 0;

  const perf = DD.perf = {
    fps: 0, frameMs: 0, cpuMs: 0, gpuMs: -1, heapMB: 0, gpuMethod: 'none',
    calls: 0, tris: 0, progs: 0, tex: 0, geo: 0,
    // one-shot readout for the console / eval, e.g. DD.perf.snapshot()
    snapshot() {
      return {
        fps: Math.round(perf.fps), frameMs: +perf.frameMs.toFixed(1),
        cpuMs: +perf.cpuMs.toFixed(1),
        gpuMs: perf.gpuMs < 0 ? null : +perf.gpuMs.toFixed(1), gpuMethod: perf.gpuMethod,
        low1pctFps: low1(), heapMB: perf.heapMB || null,
        draws: perf.calls, tris: perf.tris, programs: perf.progs, textures: perf.tex, geometries: perf.geo,
        bound: boundLabel()
      };
    }
  };

  // ---- CPU time + frame cadence: patch rAF, sum every rAF callback within a frame ----
  let lastTs = 0, cpuAccum = 0, emaFrame = 16.7;
  const rawRAF = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = function (cb) {
    return rawRAF(function (ts) {
      if (ts !== lastTs) {                       // new frame boundary
        if (lastTs) commit(ts - lastTs, cpuAccum);
        lastTs = ts; cpuAccum = 0;
      }
      const c0 = performance.now();
      try { cb(ts); } finally { cpuAccum += performance.now() - c0; }
    });
  };
  function commit(dtMs, cpuMs) {
    if (dtMs <= 0 || dtMs > 1000) return;        // tab-switch / debugger stall — ignore the gap
    perf.frameMs = dtMs; perf.cpuMs = cpuMs;
    emaFrame += (dtMs - emaFrame) * 0.1; perf.fps = 1000 / emaFrame;
    hist[hi] = dtMs; hi = (hi + 1) % N; if (hn < N) hn++;
  }
  function sortedFrames() { return Array.prototype.slice.call(hist, 0, hn).sort((x, y) => x - y); }
  function low1() { // 1% low FPS = 99th-percentile frame time
    if (hn < 10) return 0;
    const a = sortedFrames();
    return Math.round(1000 / a[Math.min(a.length - 1, Math.floor(a.length * 0.99))]);
  }
  // display refresh period ~= the fastest frames the browser delivers (vsync). 10th-percentile is a
  // robust proxy that ignores one-off super-short frames and adapts to 60/90/120/144Hz screens.
  function refreshMs() { if (hn < 10) return 16.7; const a = sortedFrames(); return a[Math.floor(a.length * 0.1)]; }
  // CPU-vs-GPU verdict. With a GPU timer query it's exact. Without one (Firefox/Safari, or a Chromium
  // that gates EXT_disjoint_timer_query for privacy — Opera can too), INFER it: if frames drop below the
  // display's refresh yet the CPU sat mostly idle that frame, the GPU is the gate. '?' marks inferred.
  function boundLabel() {
    if (perf.gpuMs >= 0) {
      if (perf.gpuMs > perf.cpuMs * 1.25) return 'GPU-bound';
      if (perf.cpuMs > perf.gpuMs * 1.25) return 'CPU-bound';
      return (perf.frameMs > refreshMs() * 1.2) ? 'balanced' : 'vsync-capped';
    }
    if (perf.frameMs <= refreshMs() * 1.3) return 'capped (ok)';         // hitting target = not a problem
    return perf.cpuMs > perf.frameMs * 0.7 ? 'CPU-bound?' : 'GPU-bound?'; // dropping frames: who's the gate?
  }

  // ---- GPU time via timer query + renderer.info, by wrapping render() (patched once, on boot) ----
  let gl = null, ext = null, activeQ = null, patched = false, depth = 0, finishProbe = 0;
  const pendingQ = [], finishSamples = [];
  function tryPatch() {
    const g = DD.game;
    if (patched || !g || !g.renderer || !g.renderer.getContext) return;
    gl = g.renderer.getContext();
    ext = gl.getExtension ? gl.getExtension('EXT_disjoint_timer_query_webgl2') : null;
    perf.gpuMethod = ext ? 'timer-query' : 'none';
    // Take manual control of info: a composer runs several renderer.render passes, each of which would
    // auto-reset the counters — so we'd only ever read the last pass (1 fullscreen quad). Instead reset
    // once at the OUTER render of the frame and read after every pass has accumulated = true frame total.
    g.renderer.info.autoReset = false;
    const wrap = (obj) => {
      if (!obj || typeof obj.render !== 'function' || obj.__perfWrapped) return;
      const orig = obj.render.bind(obj);
      obj.render = function () {
        const outer = depth === 0;   // top-level render of the frame (composer, or renderer w/o composer)
        depth++;
        let probeT0;
        if (outer) {
          g.renderer.info.reset();
          if (visible && ext && !activeQ) { activeQ = gl.createQuery(); gl.beginQuery(ext.TIME_ELAPSED_EXT, activeQ); }
          if (finishProbe > 0) { gl.finish(); probeT0 = performance.now(); } // drain prior GPU work first, then time this frame
        }
        try { return orig.apply(this, arguments); }
        finally {
          depth--;
          if (outer) {
            const info = g.renderer.info;
            perf.calls = info.render.calls; perf.tris = info.render.triangles;
            perf.geo = info.memory.geometries; perf.tex = info.memory.textures;
            perf.progs = info.programs ? info.programs.length : 0;
            if (activeQ) { gl.endQuery(ext.TIME_ELAPSED_EXT); pendingQ.push(activeQ); activeQ = null; pollQ(); }
            if (finishProbe > 0) { gl.finish(); finishSamples.push(performance.now() - probeT0); finishProbe--; }
          }
        }
      };
      obj.__perfWrapped = true;
    };
    wrap(g.composer); wrap(g.renderer); // composer.render calls renderer.render internally — depth-guarded
    patched = true;
  }
  function pollQ() {
    if (!ext) return;
    if (gl.getParameter(ext.GPU_DISJOINT_EXT)) { pendingQ.forEach((q) => gl.deleteQuery(q)); pendingQ.length = 0; return; }
    while (pendingQ.length) {
      const q = pendingQ[0];
      if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) return; // results lag a few frames
      perf.gpuMs = gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6;     // ns -> ms
      gl.deleteQuery(q); pendingQ.shift();
    }
  }

  // ---- overlay DOM ----
  let visible = false, el = null, spark = null, sctx = null, lastPaint = 0;
  function build() {
    const style = document.createElement('style');
    style.textContent = `
      #perfHud { position:fixed; top:8px; left:8px; z-index:99998; display:none;
        font:11px/1.35 'Azeret Mono',ui-monospace,monospace; color:#e8e4f5;
        background:rgba(10,7,22,0.82); border:1px solid rgba(157,123,255,0.35); padding:8px 10px;
        border-radius:6px; backdrop-filter:blur(6px); -webkit-backdrop-filter:blur(6px);
        pointer-events:none; white-space:pre; letter-spacing:0.02em; min-width:172px; }
      #perfHud b { color:var(--accent2,#c9b6ff); font-weight:600; }
      #perfHud .warn { color:#ff9b6b; } #perfHud .good { color:#7dffb0; }
      #perfHud canvas { display:block; margin-top:6px; width:172px; height:34px;
        background:rgba(0,0,0,0.35); border:1px solid rgba(255,255,255,0.06); }
      #perfHud .hint { opacity:0.6; margin-top:5px; }`;
    document.head.appendChild(style);
    el = document.createElement('div'); el.id = 'perfHud';
    spark = document.createElement('canvas'); spark.width = 172; spark.height = 34;
    document.body.appendChild(el);
    el.appendChild(spark); sctx = spark.getContext('2d');
  }
  function fmt(ms) { return ms.toFixed(1).padStart(4) + 'ms'; }
  function paint() {
    const noTimer = perf.gpuMethod === 'none';
    const gpu = perf.gpuMs < 0 ? ' n/a' : fmt(perf.gpuMs);
    const b = boundLabel();
    const bcls = (b.indexOf('CPU-bound') === 0 || b.indexOf('GPU-bound') === 0 || b === 'CPU heavy') ? 'warn' : 'good';
    const fpsCls = perf.fps < 50 ? 'warn' : 'good';
    // heap (Chromium/WebView only)
    const mem = performance.memory;
    if (mem) perf.heapMB = Math.round(mem.usedJSHeapSize / 1048576);
    const html =
      `<b>FPS</b> <span class="${fpsCls}">${String(Math.round(perf.fps)).padStart(3)}</span>  ${perf.frameMs.toFixed(1)}ms  1%low ${low1()}\n` +
      `<b>CPU</b> ${fmt(perf.cpuMs)}   <b>GPU</b> ${gpu}\n` +
      `<b>heap</b> ${perf.heapMB ? perf.heapMB + ' MB' : 'n/a'}\n` +
      `<b>draws</b> ${perf.calls}  <b>tris</b> ${fmtK(perf.tris)}\n` +
      `<b>prog</b> ${perf.progs}  <b>tex</b> ${perf.tex}  <b>geo</b> ${perf.geo}\n` +
      `<span class="hint ${bcls}">${b}${noTimer ? '  ·  GPU timer n/a' : ''}</span>`;
    // rewrite the text block without dropping the persistent sparkline canvas
    while (el.firstChild && el.firstChild !== spark) el.removeChild(el.firstChild);
    const txt = document.createElement('div'); txt.innerHTML = html;
    el.insertBefore(txt, spark);
  }
  function fmtK(n) { return n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'k' : '' + n; }
  function drawSpark() {
    if (!sctx) return;
    const w = spark.width, h = spark.height;
    sctx.clearRect(0, 0, w, h);
    // 60fps (16.7ms) and 30fps (33ms) reference lines
    sctx.strokeStyle = 'rgba(125,255,176,0.25)'; line(16.7); sctx.strokeStyle = 'rgba(255,155,107,0.25)'; line(33.3);
    function line(ms) { const y = h - Math.min(ms, 50) / 50 * h; sctx.beginPath(); sctx.moveTo(0, y); sctx.lineTo(w, y); sctx.stroke(); }
    sctx.strokeStyle = 'rgba(201,182,255,0.9)'; sctx.beginPath();
    for (let i = 0; i < hn; i++) {
      const idx = (hi - hn + i + N) % N, ms = hist[idx];
      const x = i / Math.max(1, hn - 1) * w, y = h - Math.min(ms, 50) / 50 * h;
      i ? sctx.lineTo(x, y) : sctx.moveTo(x, y);
    }
    sctx.stroke();
  }

  // own update loop on the RAW rAF so it isn't counted in CPU time; ~5Hz text, sparkline every frame
  (function tick() {
    rawRAF(tick);
    tryPatch();
    if (!visible || !el) return;
    drawSpark();
    const now = performance.now();
    if (now - lastPaint > 200) { paint(); lastPaint = now; }
  })();

  function toggle() {
    if (!el) build();
    visible = !visible;
    el.style.display = visible ? 'block' : 'none';
    if (visible) { lastPaint = 0; paint(); }
  }
  DD.perf.toggle = toggle;
  // Cross-browser GPU spot-probe: forces gl.finish() for N frames and times render -> GPU-done. Works in
  // ANY browser (no extension needed), but STALLS the pipeline (serialises CPU+GPU) so it's a spot check,
  // not a live meter, and the number includes CPU submit. Usage from console: await DD.perf.gpuProbe().
  DD.perf.gpuProbe = function (frames) {
    frames = Math.max(5, frames || 40);
    return new Promise((resolve) => {
      if (!gl) { resolve(null); return; }
      finishSamples.length = 0; finishProbe = frames;
      (function wait() {
        if (finishProbe > 0) { rawRAF(wait); return; }
        const a = finishSamples.slice().sort((x, y) => x - y);
        resolve(a.length ? { gpuApproxMs: +a[a.length >> 1].toFixed(1), min: +a[0].toFixed(1), max: +a[a.length - 1].toFixed(1), samples: a.length, note: 'gl.finish probe: ROUGH lower bound (CPU/GPU overlap makes it under-read absolute GPU time). Use for relative before/after A/B on the SAME browser; for the CPU-vs-GPU verdict trust the bound label, not this.' } : null);
      })();
    });
  };
  // ---- session recorder: capture a playtest to a shareable JSON file ----------------------------
  // Shift+`  starts/stops recording (or DD.perf.record(secs) / DD.perf.stop() from the console).
  // On stop it downloads driftdream-perf-<ts>.json — env (GPU name, DPR, quality) + a fps/CPU/GPU
  // time-series — and prints a compact summary. Send the file (or the summary) to analyse.
  let recording = false, recSamples = [], recStart = 0, recInterval = null, recAutoStop = null, recWorst = null;
  function recSample() {
    const g = DD.game, s = perf.snapshot();
    s.t = Math.round(performance.now() - recStart);
    if (g) {
      s.state = g.state;
      if (g.car) { s.idx = g.car.idx; s.lap = g.car.lap; s.kmh = Math.round(Math.hypot(g.car.vel[0], g.car.vel[1], g.car.vel[2]) * 3.6); }
      if (g.track) s.finishIdx = g.track.finishIdx;
    }
    recSamples.push(s);
    if (!recWorst || perf.frameMs > recWorst.frameMs) recWorst = { frameMs: +perf.frameMs.toFixed(1), t: s.t, state: s.state, idx: s.idx, gpuMs: s.gpuMs, cpuMs: s.cpuMs };
  }
  function envInfo() {
    const g = DD.game, r = g && g.renderer, ctx = r && r.getContext && r.getContext();
    let gpuName = 'n/a';
    try { const d = ctx && ctx.getExtension('WEBGL_debug_renderer_info'); if (d) gpuName = ctx.getParameter(d.UNMASKED_RENDERER_WEBGL); } catch (e) {}
    return {
      date: new Date().toISOString(), ua: navigator.userAgent, gpu: gpuName,
      dpr: window.devicePixelRatio, screen: screen.width + 'x' + screen.height,
      canvas: r ? (r.domElement.width + 'x' + r.domElement.height) : 'n/a',
      quality: g && g.save ? g.save.settings.quality : 'n/a',
      gpuMethod: perf.gpuMethod, refreshMsApprox: +refreshMs().toFixed(1)
    };
  }
  function stat(key) {
    const v = recSamples.map((s) => s[key]).filter((x) => typeof x === 'number').sort((a, b) => a - b);
    if (!v.length) return null;
    const q = (p) => v[Math.min(v.length - 1, Math.floor(v.length * p))];
    return { min: +q(0).toFixed(1), p50: +q(0.5).toFixed(1), p95: +q(0.95).toFixed(1), max: +q(1).toFixed(1) };
  }
  function finalizeRec() {
    const boundCount = recSamples.reduce((m, s) => { m[s.bound] = (m[s.bound] || 0) + 1; return m; }, {});
    const heaps = recSamples.map((s) => s.heapMB).filter((x) => x);
    const triS = stat('tris');
    const summary = {
      durationS: recSamples.length ? Math.round(recSamples[recSamples.length - 1].t / 1000) : 0, samples: recSamples.length,
      fps: stat('fps'), frameMs: stat('frameMs'), cpuMs: stat('cpuMs'), gpuMs: stat('gpuMs'), draws: stat('draws'),
      trisK: triS ? { min: Math.round(triS.min / 1000), p50: Math.round(triS.p50 / 1000), max: Math.round(triS.max / 1000) } : null,
      heapMB: heaps.length ? { start: heaps[0], end: heaps[heaps.length - 1], max: Math.max.apply(null, heaps) } : null,
      boundCount: boundCount, worstFrame: recWorst
    };
    const data = { env: envInfo(), summary: summary, samples: recSamples };
    try {
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = 'driftdream-perf-' + Date.now() + '.json';
      document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch (e) { console.warn('[perf] file download failed — copy the summary below instead', e); }
    console.log('%c[DRIFTDREAM perf log] downloaded JSON + summary below — send either to analyse:', 'color:#c9b6ff;font-weight:bold');
    console.log(JSON.stringify({ env: data.env, summary: summary }, null, 2));
    return data;
  }
  perf.record = function (seconds) {
    if (recording) return 'already recording';
    recording = true; recSamples = []; recWorst = null; recStart = performance.now();
    if (!el) build(); if (!visible) toggle();          // HUD must be visible so the GPU query feeds the log
    recInterval = setInterval(recSample, 250);
    if (seconds) recAutoStop = setTimeout(() => perf.stop(), seconds * 1000);
    console.log('[perf] recording… Shift+` or DD.perf.stop() to finish' + (seconds ? ' (auto-stop ' + seconds + 's — but Shift+` is more reliable for the file download)' : ''));
    return 'recording started';
  };
  perf.stop = function () {
    if (!recording) return 'not recording';
    recording = false; clearInterval(recInterval); clearTimeout(recAutoStop);
    return finalizeRec();
  };

  window.addEventListener('keydown', (e) => {
    if (e.code !== 'Backquote') return;
    if (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA') return;
    e.preventDefault();
    if (e.shiftKey) { recording ? perf.stop() : perf.record(); } // Shift+` = record toggle (downloads on stop)
    else toggle();                                               // ` = show/hide overlay
  });
})();
