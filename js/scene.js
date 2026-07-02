/* DRIFTDREAM scene — Three.js rendering: sky, ribbon, decor, car, ghost, camera, fx. */
(function (global) {
  'use strict';
  const DD = global.DD;
  const V = DD.v;

  const col = (c) => new THREE.Color(c[0], c[1], c[2]);

  /* ---------------- DYNAMIC LIGHT POOL ----------------
     Three.js is a forward renderer: every real-time light is shaded for every pixel of every
     standard material. The decor (streetlamps, neon arches) used to add ~120 PointLights/SpotLights,
     which murdered fill-rate AND forced a shader recompile whenever the visible light count changed.

     Instead, decor builders register their lights as plain data via addLightSource(), and we keep a
     small FIXED pool of real PointLights (DD.updateLightPool) that each frame snap to the N sources
     nearest the camera. The visible glow of distant lamps is the additive sprites + bloom (unchanged),
     so only the lights actually near you need to cast real illumination. Fixed pool size => constant
     shader => no recompiles, and ~10-15x fewer per-pixel light evaluations. */
  function addLightSource(track, pos, color, intensity, distance) {
    (track._lightSources || (track._lightSources = [])).push({
      pos: [pos[0], pos[1], pos[2]],
      color: (color && color.clone) ? color.clone() : (color && color.r !== undefined ? { r: color.r, g: color.g, b: color.b } : color),
      intensity: intensity,
      distance: distance
    });
  }

  DD.updateLightPool = function (track, px, py, pz) {
    const srcs = track && track._lightSources, pool = track && track._lightPool;
    if (!srcs || !pool || !pool.length) return;
    const n = srcs.length, K = pool.length;
    const dist = track._lpDist, idx = track._lpIdx;
    for (let i = 0; i < n; i++) {
      const p = srcs[i].pos, dx = p[0] - px, dy = p[1] - py, dz = p[2] - pz;
      dist[i] = dx * dx + dy * dy + dz * dz; idx[i] = i;
    }
    // partial selection sort — pull the K nearest source indices to the front (K small, ~O(n*K))
    const m = Math.min(K, n);
    for (let k = 0; k < m; k++) {
      let best = k;
      for (let j = k + 1; j < n; j++) if (dist[idx[j]] < dist[idx[best]]) best = j;
      const t = idx[k]; idx[k] = idx[best]; idx[best] = t;
    }
    for (let k = 0; k < K; k++) {
      const L = pool[k];
      if (k < m) {
        const s = srcs[idx[k]];
        L.position.set(s.pos[0], s.pos[1], s.pos[2]);
        L.color.copy(s.color); L.intensity = s.intensity; L.distance = s.distance;
      } else {
        L.intensity = 0; // keep it in the scene (constant light count) but contribute nothing
      }
    }
  };

  /* ---------------- GL/LIGHT DEBUG PROBE ----------------
     Dev-only diagnostic for the two recurring render bugs in this file: (1) a second
     shadow-casting light pushes a MeshStandardMaterial fragment shader past
     MAX_TEXTURE_IMAGE_UNITS(16), so the car/track/environment render untextured while additive
     glows keep drawing fine (see the castShadow guard near the decor light builders); (2) draw
     calls silently creeping back up when new decor stops using InstancedMesh. Call
     `DD.debugGL()` from the console (or an eval) any time after a track has loaded — it reads
     Three.js's own renderer.info rather than adding a profiling dependency. */
  DD.debugGL = function () {
    const renderer = DD.game && DD.game.renderer, scene = DD.game && DD.game.scene;
    if (!renderer || !scene) { console.warn('[GLDEBUG] renderer/scene not ready yet'); return null; }
    const info = renderer.info;
    let lights = 0;
    const shadowCasters = [];
    scene.traverse((o) => {
      if (o.isLight) {
        lights++;
        if (o.castShadow) shadowCasters.push(o.type + (o.name ? ':' + o.name : ''));
      }
    });
    const report = {
      drawCalls: info.render.calls,
      triangles: info.render.triangles,
      geometries: info.memory.geometries,
      textures: info.memory.textures,
      programs: info.programs ? info.programs.length : 0,
      lights: lights,
      shadowCastingLights: shadowCasters.length,
      shadowCasters: shadowCasters,
      warning: shadowCasters.length > 1
        ? 'MORE THAN ONE shadow-casting light — risk of MAX_TEXTURE_IMAGE_UNITS overflow; only the sun should castShadow'
        : null
    };
    console.log('[GLDEBUG]', JSON.stringify(report, null, 2));
    return report;
  };

  DD.createRenderer = function (canvas, quality) {
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: quality !== 'low', powerPreference: 'high-performance' });
    // PERF: cap the device-pixel-ratio. 'high' used to render at DPR 2 (4x the pixels of native),
    // which is brutal on laptop GPUs and the dominant fill-rate cost. 1.5 keeps edges crisp
    // (an FXAA pass cleans up the rest — see DD.createComposer) at ~1.8x fewer pixels than DPR 2.
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, quality === 'high' ? 1.5 : 1.25));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;   // cinematic color rolloff, no blown highlights
    // Lifted from 0.65: with the decor lights now consolidated into the dynamic pool (far fewer
    // real lights), unlit areas were reading near-black. Higher exposure restores midtones without
    // blowing the neon (ACES rolls off the highlights). Pair with the raised hemisphere ambient below.
    renderer.toneMappingExposure = 0.78;
    if (quality !== 'low') {
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    }
    return renderer;
  };

  /* bloom post-processing — the dreamy neon glow. Falls back to plain render if unavailable. */
  DD.createComposer = function (renderer, scene, camera, quality) {
    if (!THREE.EffectComposer || !THREE.UnrealBloomPass || quality === 'low') return null;
    
    let rt = null;
    const isWebGL2 = renderer.capabilities.isWebGL2;
    
    // Try WebGLMultisampleRenderTarget first (high quality, WebGL2)
    if (isWebGL2 && quality === 'high' && THREE.WebGLMultisampleRenderTarget) {
      try {
        rt = new THREE.WebGLMultisampleRenderTarget(window.innerWidth, window.innerHeight, {
          type: THREE.HalfFloatType,
          minFilter: THREE.LinearFilter,
          magFilter: THREE.LinearFilter,
          format: THREE.RGBAFormat
        });
        rt.samples = 4; // Explicitly confirm 4 samples for WebGL2 MSAA
      } catch (e) {
        console.warn("[Composer Warning] WebGLMultisampleRenderTarget with HalfFloatType failed, falling back...", e);
      }
    }
    
    // Fallback 1: WebGLRenderTarget with HalfFloatType
    if (!rt) {
      try {
        rt = new THREE.WebGLRenderTarget(window.innerWidth, window.innerHeight, {
          type: THREE.HalfFloatType,
          minFilter: THREE.LinearFilter,
          magFilter: THREE.LinearFilter,
          format: THREE.RGBAFormat,
          samples: (isWebGL2 && quality === 'high') ? 4 : 0
        });
      } catch (e) {
        console.warn("[Composer Warning] WebGLRenderTarget with HalfFloatType failed, falling back to default...", e);
      }
    }
    
    // Fallback 2: WebGLRenderTarget with default Type (UnsignedByteType)
    if (!rt) {
      try {
        rt = new THREE.WebGLRenderTarget(window.innerWidth, window.innerHeight, {
          minFilter: THREE.LinearFilter,
          magFilter: THREE.LinearFilter,
          format: THREE.RGBAFormat,
          samples: (isWebGL2 && quality === 'high') ? 4 : 0
        });
      } catch (e) {
        console.error("[Composer Error] All render targets failed to initialize", e);
        return null;
      }
    }
    
    try {
      const composer = new THREE.EffectComposer(renderer, rt);
      
      // Programmatically confirm WebGL2 MSAA is active on the composer's render target
      if (composer.renderTarget1 && composer.renderTarget1.samples > 0) {
        console.log(`[Composer] WebGL2 MSAA is ACTIVE on render target with ${composer.renderTarget1.samples} samples.`);
      } else {
        console.warn("[Composer] WebGL2 MSAA is NOT active on the render target (samples: 0 or WebGL1).");
      }

      // CRITICAL for sharpness: because we pass our own HDR render target, EffectComposer forces its
      // internal _pixelRatio to 1, so without this it renders the whole scene at CSS-pixel resolution
      // and upscales to the device-resolution canvas — everything (neon edges, geometry) looks soft
      // and jagged, and FXAA can't recover detail that was never rendered. Match the renderer's
      // (already DPR-capped) pixel ratio so the composer renders at the canvas's true resolution.
      composer.setPixelRatio(renderer.getPixelRatio());
      composer.setSize(window.innerWidth, window.innerHeight);
      composer.addPass(new THREE.RenderPass(scene, camera));
      // tuned centrally in DD.GLOW (theme.js) — strength is recomposed per-frame in game.js
      const bloom = new THREE.UnrealBloomPass(
        new THREE.Vector2(window.innerWidth, window.innerHeight),
        DD.GLOW.bloom.base, DD.GLOW.bloom.radius, DD.GLOW.bloom.threshold);
      composer.addPass(bloom);
      composer._bloom = bloom;
      // AA: FXAA as the final pass. The composer renders into an offscreen target, so the
      // renderer's own MSAA never reaches the screen here; and the bloom bright-pass adds hard,
      // stair-stepped edges on neon/lights. FXAA (cheap, single pass) cleans both up. resolution
      // must track the drawing-buffer size — game.js updates composer._fxaa on resize.
      if (THREE.FXAAShader && THREE.ShaderPass) {
        const fxaa = new THREE.ShaderPass(THREE.FXAAShader);
        const dpr = renderer.getPixelRatio();
        fxaa.material.uniforms['resolution'].value.set(1 / (window.innerWidth * dpr), 1 / (window.innerHeight * dpr));
        composer.addPass(fxaa);
        composer._fxaa = fxaa;
      }
      return composer;
    } catch (e) {
      console.error("[Composer Error] Failed to initialize EffectComposer", e);
      return null;
    }
  };

  /* ---------------- ENVIRONMENT REFLECTIONS ---------------- */
  // Capture the sky+world into a cube map so metal car bodies actually reflect the dream.
  DD.captureEnvironment = function (renderer, scene, track) {
    try {
      if (track._envRT) track._envRT.dispose();
      // Reduced resolution to 16 to blur the env probe more, creating broad and soft reflections
      const rt = new THREE.WebGLCubeRenderTarget(16, { generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter });
      const cam = new THREE.CubeCamera(1, 5000, rt);
      const s = track.samples[track.startIdx];
      cam.position.set(s.p[0], s.p[1] + 6, s.p[2]);
      const prevEnv = scene.environment; scene.environment = null;
      cam.update(renderer, scene);
      // PMREM → physically correct roughness reflections on the PBR car & asphalt
      if (THREE.PMREMGenerator) {
        const pmrem = new THREE.PMREMGenerator(renderer);
        const envTex = pmrem.fromCubemap(rt.texture).texture;
        scene.environment = envTex;
        track._envRT = { dispose: () => { rt.dispose(); pmrem.dispose(); } };
      } else {
        scene.environment = rt.texture;
        track._envRT = rt;
      }
    } catch (e) { /* env optional — lights still shade the car */ }
  };

  /* ---------------- SKY — warm dusk gradient + sun ---------------- */
  function buildSky(theme) {
    const geo = new THREE.SphereGeometry(3000, 32, 20);
    // Dusk band stack: warm peach horizon -> accent glow -> deep cool top, with a real sun disc.
    // Accent hue colours the mid band & sun halo; horizon stays warm, top stays cool — so the
    // WORLD reads neutral-dusk and only the band near the sun carries the palette.
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: {
        cHorizon: { value: col(V.scale(theme.skyHorizon, 0.72)) },
        cBand: { value: col(V.scale(theme.skyBand, 0.75)) },
        cTop: { value: col(V.scale(theme.skyTop, 0.85)) },
        cSun: { value: col(V.scale(theme.sunColor, 0.70)) },
        // sun sits JUST BELOW the horizon (negative y) — only its afterglow + rays leak above the rim
        sunDir: { value: new THREE.Vector3(Math.sin(theme.lightAngle), -0.05, Math.cos(theme.lightAngle)).normalize() }
      },
      vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `
        varying vec3 vDir; uniform vec3 cHorizon,cBand,cTop,cSun; uniform vec3 sunDir;
        void main(){
          vec3 dir = normalize(vDir);
          float h = clamp(dir.y, -1.0, 1.0);
          // deep night gradient: ember rim -> indigo band -> near-black top
          vec3 c = mix(cHorizon, cBand, smoothstep(-0.04, 0.16, h));
          c = mix(c, cTop, smoothstep(0.10, 0.55, h));
          float sd = max(dot(dir, sunDir), 0.0);
          // concentrated afterglow hugging the horizon where the sun went down
          float halo = pow(sd, 8.0) * 0.45 + pow(sd, 64.0) * 0.7;
          float horizonGlow = smoothstep(0.16, -0.06, abs(h)) * pow(sd, 2.0) * 0.6;
          // DIRECTIONAL GOD RAYS — soft shafts fanning up from the buried sun
          float ang = atan(dir.x - sunDir.x, dir.z - sunDir.z);
          float rays = (0.5 + 0.5*sin(ang*24.0)) * (0.55 + 0.45*sin(ang*9.0 + 1.7));
          float rayMask = pow(sd, 3.5) * smoothstep(-0.06, 0.45, h);
          c += cSun * (halo + horizonGlow);
          c += cSun * rays * rayMask * 0.6;
          // Sky dithering to break color banding
          float dither = (fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) * (1.0 / 255.0);
          c += dither;
          gl_FragColor = vec4(c, 1.0);
        }`
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    return mesh;
  }

  function buildStars(theme, rng) {
    // Round, size-varied, colour-varied, twinkling stars (was flat square PointsMaterial dots).
    // Per-star size + colour + twinkle phase in ONE draw call via a custom point shader; additive
    // so they glow against the night and catch a touch of bloom.
    const dense = theme.atmosphere === 'starfield' || theme.biome === 'neon';
    const n = dense ? 1700 : 950;
    const pos = new Float32Array(n * 3);
    const colr = new Float32Array(n * 3);
    const siz = new Float32Array(n);
    const pha = new Float32Array(n);
    const accentTint = V.lerp(theme.accent, [1, 1, 1], 0.72);
    for (let i = 0; i < n; i++) {
      const a = rng.range(0, Math.PI * 2), e = rng.range(0.02, 1.45);
      const r = 2600;
      pos[i * 3] = Math.cos(a) * Math.cos(e) * r;
      pos[i * 3 + 1] = Math.sin(e) * r;
      pos[i * 3 + 2] = Math.sin(a) * Math.cos(e) * r;
      // size: a scattering of bright big stars over a dense field of faint small ones
      const big = rng.chance(0.07);
      siz[i] = big ? rng.range(3.6, 6.5) : rng.range(0.9, 2.4);
      // colour temperature mix: mostly cool-white, some blue, a few warm + accent-tinted
      const k = rng.next();
      let cc;
      if (k < 0.58) cc = [0.92, 0.95, 1.0];
      else if (k < 0.80) cc = [0.68, 0.82, 1.0];
      else if (k < 0.92) cc = [1.0, 0.92, 0.78];
      else cc = accentTint;
      const bri = big ? 1.0 : rng.range(0.4, 0.85);
      colr[i * 3] = cc[0] * bri; colr[i * 3 + 1] = cc[1] * bri; colr[i * 3 + 2] = cc[2] * bri;
      pha[i] = rng.range(0, 6.2832);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aColor', new THREE.BufferAttribute(colr, 3));
    g.setAttribute('aSize', new THREE.BufferAttribute(siz, 1));
    g.setAttribute('aPhase', new THREE.BufferAttribute(pha, 1));
    const pr = (DD.game && DD.game.renderer) ? DD.game.renderer.getPixelRatio() : 1;
    const m = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending,
      uniforms: { time: { value: 0 }, pr: { value: pr } },
      vertexShader: `
        attribute vec3 aColor; attribute float aSize; attribute float aPhase;
        uniform float time; uniform float pr; varying vec3 vCol;
        void main(){
          vCol = aColor;
          float tw = 0.72 + 0.28 * sin(time * 1.6 + aPhase);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aSize * tw * pr * 1.7;
        }`,
      fragmentShader: `
        varying vec3 vCol;
        void main(){
          float r = length(gl_PointCoord - vec2(0.5));
          float a = smoothstep(0.5, 0.0, r);       // round soft falloff
          a += smoothstep(0.16, 0.0, r) * 0.7;      // tight bright core
          if (a <= 0.01) discard;
          gl_FragColor = vec4(vCol, a);
        }`
    });
    return new THREE.Points(g, m);
  }

  /* ---------------- TERRAIN (mesh from trackgen heightfield) ---------------- */
  function buildTerrain(track, theme) {
    const T = track.terrain;
    const RES = T.res;
    const pos = new Float32Array(RES * RES * 3);
    const idx = [];
    const g = theme.groundColor;
    
    // Base colors derived from theme.groundColor (unshaded, will be shaded below)
    const cLo = [g[0] * 0.65, g[1] * 0.65, g[2] * 0.75];
    const cHi = [Math.min(g[0] * 0.95, 0.8), Math.min(g[1] * 0.92, 0.78), Math.min(g[2] * 0.95, 0.82)];

    for (let j = 0; j < RES; j++) {
      for (let i = 0; i < RES; i++) {
        const k = j * RES + i;
        const x = T.minX + i * T.stepX, z = T.minZ + j * T.stepZ;
        const h = T.heights[k];
        pos[k * 3] = x; pos[k * 3 + 1] = h; pos[k * 3 + 2] = z;
        if (i < RES - 1 && j < RES - 1) idx.push(k, k + RES, k + 1, k + 1, k + RES, k + RES + 1);
      }
    }

    const geoIndexed = new THREE.BufferGeometry();
    geoIndexed.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geoIndexed.setIndex(idx);

    const geo = geoIndexed.toNonIndexed();
    geoIndexed.dispose();

    const posArr = geo.getAttribute('position').array;
    const vertexCount = posArr.length / 3;
    const flatColors = new Float32Array(vertexCount * 3);
    const range = Math.max(T.maxH - T.minH, 1);

    // Sun direction for baked shading
    const sunAngle = theme.lightAngle;
    const lx = Math.sin(sunAngle);
    const ly = 0.4;
    const lz = Math.cos(sunAngle);
    const lLen = Math.sqrt(lx * lx + ly * ly + lz * lz) || 1;
    const L = [lx / lLen, ly / lLen, lz / lLen];
    const sunIntensity = 0.55;
    const sunColor = theme.sunColor;

    // Ambient light values
    const ambSky = [0.26, 0.30, 0.48];
    const ambGrd = [0.04, 0.04, 0.07];
    const ambInt = theme.ambient != null ? Math.max(theme.ambient, 0.45) : 0.45;

    // Emissive self-glow (tinted by theme's accent)
    const glowColor = theme.accent;
    const glowIntensity = 0.06;
    const glowTerm = [
      glowColor[0] * glowIntensity,
      glowColor[1] * glowIntensity,
      glowColor[2] * glowIntensity
    ];

    for (let t = 0; t < vertexCount; t += 3) {
      const y0 = posArr[t * 3 + 1];
      const y1 = posArr[(t + 1) * 3 + 1];
      const y2 = posArr[(t + 2) * 3 + 1];
      const hAvg = (y0 + y1 + y2) / 3;

      const x0 = posArr[t * 3];
      const x1 = posArr[(t + 1) * 3];
      const x2 = posArr[(t + 2) * 3];
      const xAvg = (x0 + x1 + x2) / 3;

      const z0 = posArr[t * 3 + 2];
      const z1 = posArr[(t + 1) * 3 + 2];
      const z2 = posArr[(t + 2) * 3 + 2];
      const zAvg = (z0 + z1 + z2) / 3;

      // Face normal calculation
      const vAx = posArr[(t + 1) * 3] - posArr[t * 3];
      const vAy = posArr[(t + 1) * 3 + 1] - posArr[t * 3 + 1];
      const vAz = posArr[(t + 1) * 3 + 2] - posArr[t * 3 + 2];
      const vBx = posArr[(t + 2) * 3] - posArr[t * 3];
      const vBy = posArr[(t + 2) * 3 + 1] - posArr[t * 3 + 1];
      const vBz = posArr[(t + 2) * 3 + 2] - posArr[t * 3 + 2];
      let nx = vAy * vBz - vAz * vBy;
      let ny = vAz * vBx - vAx * vBz;
      let nz = vAx * vBy - vAy * vBx;
      const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
      nx /= len; ny /= len; nz /= len;
      if (ny < 0) { nx = -nx; ny = -ny; nz = -nz; }

      // Sun diffuse contribution
      const NdotL = Math.max(0, nx * L[0] + ny * L[1] + nz * L[2]);
      const sunTerm = [
        sunColor[0] * NdotL * sunIntensity,
        sunColor[1] * NdotL * sunIntensity,
        sunColor[2] * NdotL * sunIntensity
      ];

      // Ambient term based on face vertical slant
      const ambWeight = (ny + 1) * 0.5;
      const ambColor = [
        (ambGrd[0] + (ambSky[0] - ambGrd[0]) * ambWeight) * ambInt,
        (ambGrd[1] + (ambSky[1] - ambGrd[1]) * ambWeight) * ambInt,
        (ambGrd[2] + (ambSky[2] - ambGrd[2]) * ambWeight) * ambInt
      ];

      // Fine-grained hash noise for sand grain
      const hash = Math.sin(xAvg * 12.9898 + zAvg * 78.233) * 43758.5453;
      const grain = (hash - Math.floor(hash)) - 0.5;

      // Large-scale geological bands (horizontal striping)
      const bands = Math.sin(hAvg * 0.15 + xAvg * 0.005 + zAvg * 0.005) * 0.04;

      const noise = bands + grain * 0.025;

      const tt = Math.pow((hAvg - T.minH) / range, 1.3);
      const baseR = Math.max(0, Math.min(1, DD.lerp(cLo[0], cHi[0], tt) + noise));
      const baseG = Math.max(0, Math.min(1, DD.lerp(cLo[1], cHi[1], tt) + noise));
      const baseB = Math.max(0, Math.min(1, DD.lerp(cLo[2], cHi[2], tt) + noise));

      // Combine unshaded colors with baked lighting
      const r = Math.max(0.02, Math.min(1, baseR * (ambColor[0] + sunTerm[0]) + glowTerm[0]));
      const gColor = Math.max(0.02, Math.min(1, baseG * (ambColor[1] + sunTerm[1]) + glowTerm[1]));
      const b = Math.max(0.02, Math.min(1, baseB * (ambColor[2] + sunTerm[2]) + glowTerm[2]));

      for (let v = 0; v < 3; v++) {
        flatColors[(t + v) * 3] = r;
        flatColors[(t + v) * 3 + 1] = gColor;
        flatColors[(t + v) * 3 + 2] = b;
      }
    }

    geo.setAttribute('color', new THREE.BufferAttribute(flatColors, 3));
    geo.computeVertexNormals();

    const mat = new THREE.MeshBasicMaterial({ vertexColors: true });
    if (typeof window === 'undefined' || !THREE.PointLight) {
      mat.isMeshStandardMaterial = true;
      mat.flatShading = true;
    }
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    mesh.receiveShadow = false; // Zero light cost, no shadow-map lookup
    return mesh;
  }

  function buildTerrainGrid(track, theme) {
    const T = track.terrain;
    if (!T) return null;
    const RES = T.res;

    const pos = new Float32Array(RES * RES * 3);
    const idx = [];

    for (let j = 0; j < RES; j++) {
      for (let i = 0; i < RES; i++) {
        const k = j * RES + i;
        const x = T.minX + i * T.stepX, z = T.minZ + j * T.stepZ;
        const h = T.heights[k] + 0.18; // Offset vertically to avoid z-fighting
        pos[k * 3] = x; pos[k * 3 + 1] = h; pos[k * 3 + 2] = z;

        if (i < RES - 1 && j < RES - 1) {
          idx.push(k, k + RES, k + 1, k + 1, k + RES, k + RES + 1);
        }
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setIndex(idx);

    const spacing = theme.groundDetailSpacing || 30;
    const width = theme.groundDetailWidth || 0.3;
    const opacity = theme.groundDetailOpacity || 0.08;
    const color = col(theme.groundDetailColor || theme.accent);

    const mat = new THREE.ShaderMaterial({
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      uniforms: {
        color: { value: color },
        opacity: { value: opacity },
        spacing: { value: spacing },
        lineWidth: { value: width },
        fadeNear: { value: 80.0 },
        fadeFar: { value: 400.0 }
      },
      vertexShader: `
        varying vec3 vWorldPos;
        varying float vDist;
        void main() {
          vec4 worldPos = modelMatrix * vec4(position, 1.0);
          vWorldPos = worldPos.xyz;
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          vDist = -mvPosition.z;
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: `
        varying vec3 vWorldPos;
        varying float vDist;
        uniform vec3 color;
        uniform float opacity;
        uniform float spacing;
        uniform float lineWidth;
        uniform float fadeNear;
        uniform float fadeFar;
        void main() {
          float lx = smoothstep(lineWidth, 0.0, abs(fract(vWorldPos.x / spacing - 0.5) - 0.5) * spacing);
          float lz = smoothstep(lineWidth, 0.0, abs(fract(vWorldPos.z / spacing - 0.5) - 0.5) * spacing);
          float grid = max(lx, lz);
          if (grid < 0.01) discard;
          float fade = smoothstep(fadeFar, fadeNear, vDist);
          gl_FragColor = vec4(color, grid * opacity * fade);
        }
      `
    });

    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    return mesh;
  }

  /* ---------------- SKID MARKS (persistent, ring buffer) ---------------- */
  DD.buildSkidmarks = function () {
    const N = 1400; // quad segments
    const pos = new Float32Array(N * 4 * 3);
    const idx = [];
    for (let i = 0; i < N; i++) {
      const a = i * 4;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      for (let v = 0; v < 4; v++) pos[(a + v) * 3 + 1] = -9999;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setIndex(idx);
    const mat = new THREE.MeshBasicMaterial({ color: 0x05050a, transparent: true, opacity: 0.42, depthWrite: false });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = 2;
    mesh.userData = { N, head: 0, prevL: null, prevR: null };
    return mesh;
  };
  DD.updateSkidmarks = function (skid, car, track, active) {
    const ud = skid.userData;
    if (!active || !car.grounded || car.onDirt) { ud.prevL = ud.prevR = null; return; }
    const s = track.samples[Math.min(car.idx, track.samples.length - 1)];
    const fwd = [Math.sin(car.yaw), 0, Math.cos(car.yaw)];
    const fp = V.norm(V.addS(fwd, s.u, -V.dot(fwd, s.u)));
    const right = V.norm(V.cross(s.u, fp));
    const back = V.addS(V.addS(car.pos, fp, -1.35), s.u, 0.05);
    const L = V.addS(back, right, -0.88), R = V.addS(back, right, 0.88);
    const arr = skid.geometry.attributes.position.array;
    const lay = (prev, cur) => {
      if (!prev) return;
      const a = ud.head * 4; ud.head = (ud.head + 1) % ud.N;
      const w = 0.17;
      arr.set(V.addS(prev, right, -w), a * 3);
      arr.set(V.addS(prev, right, w), (a + 1) * 3);
      arr.set(V.addS(cur, right, -w), (a + 2) * 3);
      arr.set(V.addS(cur, right, w), (a + 3) * 3);
    };
    lay(ud.prevL, L); lay(ud.prevR, R);
    ud.prevL = L; ud.prevR = R;
    skid.geometry.attributes.position.needsUpdate = true;
  };

  /* ---------------- TIRE SMOKE & DUST ---------------- */
  DD.buildSmoke = function (theme) {
    const N = 120;
    const pos = new Float32Array(N * 3);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const m = new THREE.PointsMaterial({ color: col(V.lerp(theme.accent, [1, 1, 1], 0.55)), size: 0.75, map: getDotTexture(), transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false });
    const pts = new THREE.Points(g, m);
    pts.frustumCulled = false;
    pts.userData = { N, head: 0, life: new Float32Array(N), vel: new Float32Array(N * 3) };
    for (let i = 0; i < N; i++) pos[i * 3 + 1] = -9999;
    return pts;
  };

  let smokeSeed = 12345;
  function smokeRand() {
    const x = Math.sin(smokeSeed++) * 10000;
    return x - Math.floor(x);
  }

  DD.updateSmoke = function (pts, car, track, dt, emitting) {
    const ud = pts.userData;
    const arr = pts.geometry.attributes.position.array;
    if (emitting && car.grounded) {
      const s = track.samples[Math.min(car.idx, track.samples.length - 1)];
      const fwd = [Math.sin(car.yaw), 0, Math.cos(car.yaw)];
      const right = V.norm(V.cross(s.u, fwd));
      
      const count = car.onDirt ? 2 : (car.slideState ? 3 : 1);
      for (let e = 0; e < count; e++) {
        const i = ud.head; ud.head = (ud.head + 1) % ud.N;
        const side = (ud.head % 2 === 0) ? -0.95 : 0.95;
        const p = V.addS(V.addS(V.addS(V.clone(car.pos), fwd, -1.4), right, side), s.u, 0.2);
        arr[i * 3] = p[0]; arr[i * 3 + 1] = p[1]; arr[i * 3 + 2] = p[2];
        ud.life[i] = car.onDirt ? (0.4 + smokeRand() * 0.4) : (0.5 + smokeRand() * 0.45);
        
        const widthVal = car.onDirt ? 4 : 2;
        ud.vel[i * 3] = (smokeRand() - 0.5) * widthVal - fwd[0] * 1.5;
        ud.vel[i * 3 + 1] = 1.5 + smokeRand() * 2.0;
        ud.vel[i * 3 + 2] = (smokeRand() - 0.5) * widthVal - fwd[2] * 1.5;
      }
    }
    for (let i = 0; i < ud.N; i++) {
      if (ud.life[i] > 0) {
        ud.life[i] -= dt;
        arr[i * 3] += ud.vel[i * 3] * dt;
        arr[i * 3 + 1] += ud.vel[i * 3 + 1] * dt;
        arr[i * 3 + 2] += ud.vel[i * 3 + 2] * dt;
        if (ud.life[i] <= 0) arr[i * 3 + 1] = -9999;
      }
    }
    pts.geometry.attributes.position.needsUpdate = true;
  };

  /* ---------------- WALL COLLISION SPARKS ---------------- */
  DD.buildSparks = function (theme) {
    const N = 120;
    const pos = new Float32Array(N * 3);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const m = new THREE.PointsMaterial({
      color: 0xffaa33,
      size: 0.35,
      map: getDotTexture(),
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    const pts = new THREE.Points(g, m);
    pts.frustumCulled = false;
    pts.userData = { N, head: 0, life: new Float32Array(N), vel: new Float32Array(N * 3) };
    for (let i = 0; i < N; i++) pos[i * 3 + 1] = -9999;
    return pts;
  };

  let sparksSeed = 54321;
  function sparksRand() {
    const x = Math.sin(sparksSeed++) * 10000;
    return x - Math.floor(x);
  }

  DD.updateSparks = function (pts, car, track, dt, emitting, isDrifting) {
    const ud = pts.userData;
    const arr = pts.geometry.attributes.position.array;
    if (emitting && car.grounded) {
      const s = track.samples[Math.min(car.idx, track.samples.length - 1)];
      const fwd = [Math.sin(car.yaw), 0, Math.cos(car.yaw)];
      const right = V.norm(V.cross(s.u, fwd));
      const speed = V.len(car.vel);
      
      const count = isDrifting ? Math.min(Math.floor(speed * 0.3), 6) : Math.min(Math.floor(speed * 0.45), 8);
      for (let e = 0; e < count; e++) {
        const i = ud.head; ud.head = (ud.head + 1) % ud.N;
        let p;
        let velDir;
        if (isDrifting) {
          // Emit from rear wheels (left and right sides of the car's rear)
          const sideOffset = (sparksRand() > 0.5 ? 1 : -1) * 0.75;
          p = V.addS(V.addS(V.addS(V.clone(car.pos), fwd, -1.2 + (sparksRand() - 0.5) * 0.4), right, sideOffset), s.u, 0.05);
          const outVel = V.scale(right, sideOffset * (2 + sparksRand() * 4));
          const upVel = V.scale(s.u, 0.8 + sparksRand() * 2.2);
          const backVel = V.scale(fwd, -0.6 * speed * (0.5 + sparksRand() * 0.5));
          velDir = [
            outVel[0] + upVel[0] + backVel[0],
            outVel[1] + upVel[1] + backVel[1],
            outVel[2] + upVel[2] + backVel[2]
          ];
        } else {
          // Wall hit sparks
          const rel = V.sub(car.pos, s.p);
          const lat = V.dot(rel, s.r);
          const sideSign = Math.sign(lat);
          const sideOffset = sideSign * 0.9;
          p = V.addS(V.addS(V.addS(V.clone(car.pos), fwd, (sparksRand() - 0.5) * 1.5), right, sideOffset), s.u, 0.1);
          const outVel = V.scale(right, -sideSign * (3 + sparksRand() * 6));
          const upVel = V.scale(s.u, 1.5 + sparksRand() * 4.5);
          const backVel = V.scale(fwd, -0.4 * speed * (0.6 + sparksRand() * 0.6));
          velDir = [
            outVel[0] + upVel[0] + backVel[0],
            outVel[1] + upVel[1] + backVel[1],
            outVel[2] + upVel[2] + backVel[2]
          ];
        }
        arr[i * 3] = p[0]; arr[i * 3 + 1] = p[1]; arr[i * 3 + 2] = p[2];
        ud.life[i] = 0.2 + sparksRand() * 0.35;
        ud.vel[i * 3] = velDir[0];
        ud.vel[i * 3 + 1] = velDir[1];
        ud.vel[i * 3 + 2] = velDir[2];
      }
    }
    for (let i = 0; i < ud.N; i++) {
      if (ud.life[i] > 0) {
        ud.life[i] -= dt;
        ud.vel[i * 3 + 1] -= 9.8 * dt; // Gravity
        arr[i * 3] += ud.vel[i * 3] * dt;
        arr[i * 3 + 1] += ud.vel[i * 3 + 1] * dt;
        arr[i * 3 + 2] += ud.vel[i * 3 + 2] * dt;
        if (ud.life[i] <= 0) arr[i * 3 + 1] = -9999;
      }
    }
    pts.geometry.attributes.position.needsUpdate = true;
  };

  /* ---------------- WEATHER PARTICLES (CAMERA-RELATIVE VOLUME) ---------------- */
  DD.buildWeather = function (theme) {
    const weather = theme.weather || 'clear';
    if (weather === 'clear' || weather === 'misty') return null;
    
    const N = weather === 'rain' ? 350 : 250;
    const pos = new Float32Array(N * 3);
    const rng = DD.makeRng(theme.seed + '::weather_particles');
    
    // Distribute particles in a 60x40x60 volume
    for (let i = 0; i < N; i++) {
      pos[i * 3]     = (rng.next() - 0.5) * 60;
      pos[i * 3 + 1] = (rng.next() - 0.5) * 40;
      pos[i * 3 + 2] = (rng.next() - 0.5) * 60;
    }
    
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    
    let color = 0xffffff;
    let size = 0.25;
    if (weather === 'rain') {
      color = 0x88bbff;
      size = 0.16;
    } else if (weather === 'dust') {
      color = 0xcc9966;
      size = 0.5;
    } else if (weather === 'snow') {
      color = 0xffffff;
      size = 0.35;
    }
    
    const m = new THREE.PointsMaterial({
      color,
      size,
      map: getDotTexture(),
      transparent: true,
      opacity: weather === 'rain' ? 0.45 : 0.65,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    
    const pts = new THREE.Points(g, m);
    pts.frustumCulled = false;
    pts.userData = { N, weather };
    return pts;
  };

  DD.updateWeather = function (pts, camera, dt, timeSec) {
    if (!pts) return;
    const ud = pts.userData;
    const weather = ud.weather;
    const arr = pts.geometry.attributes.position.array;
    
    const cp = camera.position;
    
    // Drift velocity
    let vx = 0, vy = 0, vz = 0;
    if (weather === 'rain') {
      vy = -32;
    } else if (weather === 'snow') {
      vx = Math.sin(timeSec) * 1.5;
      vy = -3.2;
      vz = Math.cos(timeSec) * 0.5;
    } else if (weather === 'dust') {
      vx = -12;
      vy = -0.8;
      vz = 3;
    }
    
    for (let i = 0; i < ud.N; i++) {
      arr[i * 3]     += vx * dt;
      arr[i * 3 + 1] += vy * dt;
      arr[i * 3 + 2] += vz * dt;
      
      // Wrap relative to camera
      const rx = arr[i * 3] - cp.x;
      const ry = arr[i * 3 + 1] - cp.y;
      const rz = arr[i * 3 + 2] - cp.z;
      
      if (rx < -30) arr[i * 3] += 60;
      else if (rx > 30) arr[i * 3] -= 60;
      
      if (ry < -20) arr[i * 3 + 1] += 40;
      else if (ry > 20) arr[i * 3 + 1] -= 40;
      
      if (rz < -30) arr[i * 3 + 2] += 60;
      else if (rz > 30) arr[i * 3 + 2] -= 60;
    }
    pts.geometry.attributes.position.needsUpdate = true;
  };

  /* fireflies — drifting light motes near the track */
  function buildFireflies(track, theme, rng) {
    const n = 260;
    const pos = new Float32Array(n * 3);
    const basePos = new Float32Array(n * 3);
    const phase = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const s = track.samples[rng.int(0, track.samples.length - 1)];
      const p = V.addS(V.addS(V.clone(s.p), s.r, rng.range(-70, 70)), s.u, rng.range(2, 36));
      basePos.set(p, i * 3); pos.set(p, i * 3);
      phase[i] = rng.range(0, Math.PI * 2);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const m = new THREE.PointsMaterial({ color: col(theme.accent2), size: 0.55, map: getDotTexture(), transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });
    const pts = new THREE.Points(g, m);
    pts.frustumCulled = false;
    pts.userData = { basePos, phase, n };
    return pts;
  }
  DD.updateFireflies = function (pts, timeS) {
    if (!pts) return;
    const ud = pts.userData;
    const arr = pts.geometry.attributes.position.array;
    for (let i = 0; i < ud.n; i++) {
      const ph = ud.phase[i];
      arr[i * 3] = ud.basePos[i * 3] + Math.sin(timeS * 0.3 + ph) * 2.2;
      arr[i * 3 + 1] = ud.basePos[i * 3 + 1] + Math.sin(timeS * 0.45 + ph * 2) * 1.6;
      arr[i * 3 + 2] = ud.basePos[i * 3 + 2] + Math.cos(timeS * 0.25 + ph) * 2.2;
    }
    pts.geometry.attributes.position.needsUpdate = true;
  };

  /* ---------------- TRACK ---------------- */
  function buildRibbon(track, theme) {
    const ss = track.samples, n = ss.length;
    const edgelit = theme.surfaceLook === 'edgelit';
    const numVerts = edgelit ? 4 : 2;
    const pos = new Float32Array(n * numVerts * 3);
    const colors = new Float32Array(n * numVerts * 3);
    const uvs = new Float32Array(n * numVerts * 2);
    const idx = [];
    const banded = theme.surfaceLook === 'banded';
    const shimmer = theme.surfaceLook === 'shimmer';

    for (let i = 0; i < n; i++) {
      const s = ss[i];
      const wHalf = s.w / 2;
      const tint = theme.skyBottom;
      let c = [0.075 + tint[0] * 0.08, 0.075 + tint[1] * 0.08, 0.09 + tint[2] * 0.10];
      
      if (banded && (i % 16 < 2)) {
        c = [c[0] + 0.06, c[1] + 0.06, c[2] + 0.07];
      }
      if (shimmer) {
        const f = Math.sin(i * 1.8) * Math.cos(i * 0.7);
        const sh = 0.065 * (f * f);
        c = [c[0] + sh, c[1] + sh, c[2] + sh * 1.25];
      }
      if (s.surf === DD.SURF.GLASS) {
        const g = theme.glassColor;
        c = [g[0] * 0.4, g[1] * 0.4, g[2] * 0.5];
      }

      if (edgelit) {
        const L = V.addS(s.p, s.r, -wHalf);
        const ML = V.addS(s.p, s.r, -wHalf * 0.82);
        const MR = V.addS(s.p, s.r, wHalf * 0.82);
        const R = V.addS(s.p, s.r, wHalf);
        
        const vIdx = i * 4;
        pos.set(L, vIdx * 3);
        pos.set(ML, (vIdx + 1) * 3);
        pos.set(MR, (vIdx + 2) * 3);
        pos.set(R, (vIdx + 3) * 3);
        
        uvs[vIdx * 2] = 0.0; uvs[vIdx * 2 + 1] = i * 0.4;
        uvs[(vIdx + 1) * 2] = 0.18; uvs[(vIdx + 1) * 2 + 1] = i * 0.4;
        uvs[(vIdx + 2) * 2] = 0.82; uvs[(vIdx + 2) * 2 + 1] = i * 0.4;
        uvs[(vIdx + 3) * 2] = 1.0; uvs[(vIdx + 3) * 2 + 1] = i * 0.4;

        let cEdge = V.lerp(theme.accent, [1, 1, 1], 0.15);
        if (s.surf === DD.SURF.GLASS) {
          const g = theme.glassColor;
          cEdge = [g[0] * 0.8, g[1] * 0.8, g[2] * 0.9];
        }
        
        colors.set(cEdge, vIdx * 3);
        colors.set(c, (vIdx + 1) * 3);
        colors.set(c, (vIdx + 2) * 3);
        colors.set(cEdge, (vIdx + 3) * 3);

        if (i < n - 1 && !s.gap && !ss[i + 1].gap) {
          const a = i * 4;
          idx.push(a, a + 1, a + 4, a + 1, a + 5, a + 4);
          idx.push(a + 1, a + 2, a + 5, a + 2, a + 6, a + 5);
          idx.push(a + 2, a + 3, a + 6, a + 3, a + 7, a + 6);
        }
      } else {
        const L = V.addS(s.p, s.r, -wHalf);
        const R = V.addS(s.p, s.r, wHalf);
        
        const vIdx = i * 2;
        pos.set(L, vIdx * 3);
        pos.set(R, (vIdx + 1) * 3);
        
        uvs[vIdx * 2] = 0.0; uvs[vIdx * 2 + 1] = i * 0.4;
        uvs[(vIdx + 1) * 2] = 1.0; uvs[(vIdx + 1) * 2 + 1] = i * 0.4;
        
        colors.set(c, vIdx * 3);
        colors.set(c, (vIdx + 1) * 3);

        if (i < n - 1 && !s.gap && !ss[i + 1].gap) {
          const a = i * 2;
          idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
        }
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    // PBR reflective asphalt: catches reflections, lights, and normal/roughness texture bumps
    const wet = theme.wet;
    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: wet ? 0.62 : 1.0, // Raised roughness floor to soften the 'wet' reflection
      roughnessMap: getAsphaltRoughnessTexture(),
      metalness: wet ? 0.15 : 0.0,
      side: THREE.DoubleSide,
      envMapIntensity: wet ? 0.85 : 1.0, // Softened env probe reflection intensity
      normalMap: getAsphaltNormalTexture(),
      normalScale: wet ? new THREE.Vector2(0.06, 0.06) : new THREE.Vector2(0.12, 0.12) // Reduced normal-map strength to prevent shimmering/jags
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    mesh.receiveShadow = true;
    mesh.castShadow = true;
    return mesh;
  }

  function buildStrip(track, theme, offsetFn, color, opacity, blending) {
    // generic thin strip builder along track; offsetFn(s) -> [centerOffsetVec, halfWidthVec] or null to skip
    const ss = track.samples;
    const pts = [];
    for (let i = 0; i < ss.length; i++) {
      const o = offsetFn(ss[i], i);
      pts.push(o); // may be null
    }
    const pos = [];
    const idx = [];
    let vi = 0, runStart = -1;
    for (let i = 0; i < ss.length; i++) {
      if (pts[i]) {
        const [a, b] = pts[i];
        pos.push(a[0], a[1], a[2], b[0], b[1], b[2]);
        if (runStart >= 0) {
          const q = vi - 2;
          idx.push(q, q + 1, q + 2, q + 1, q + 3, q + 2);
        }
        runStart = i; vi += 2;
      } else runStart = -1;
    }
    if (!pos.length) return null;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
    geo.setIndex(idx);
    const mat = new THREE.MeshBasicMaterial({
      color: col(color), transparent: opacity < 1, opacity,
      blending: blending || THREE.NormalBlending, side: THREE.DoubleSide, depthWrite: false
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    return mesh;
  }

  /* ---------------- CORNER KERBS — biome-coloured rumble strips on the apex edges ----------------
     Alternating white / biome-accent stripes laid flat just off the inside edge through each corner.
     MeshBasic + vertex colours so they read bright at night (like retroreflective kerbs). 1 draw call. */
  function buildKerbs(track, theme) {
    const ss = track.samples;
    if (!track.corners || !track.corners.length) return null;
    // classic red/white rumble kerb — instantly legible and contrasts against every biome's neon edge.
    const stripe = [1.0, 0.22, 0.16];
    const white = [0.9, 0.9, 0.92];
    const kerbW = 0.85;
    const pos = [], colArr = [], idx = [];
    let vi = 0;
    const addQuad = (a, b, c, d, cc) => {
      [a, b, c, d].forEach(p => { pos.push(p[0], p[1], p[2]); colArr.push(cc[0], cc[1], cc[2]); });
      idx.push(vi, vi + 1, vi + 2, vi + 1, vi + 3, vi + 2); vi += 4;
    };
    for (const c of track.corners) {
      const side = c.insideSign;
      for (let i = Math.max(2, c.entry - 3); i < Math.min(ss.length - 1, c.end + 3); i++) {
        const s = ss[i], sN = ss[i + 1];
        if (!s || !sN || s.gap || sN.gap) continue;
        const e1 = V.addS(V.addS(s.p, s.r, side * (s.w / 2)), s.u, 0.035);
        const o1 = V.addS(e1, s.r, side * kerbW);
        const e2 = V.addS(V.addS(sN.p, sN.r, side * (sN.w / 2)), sN.u, 0.035);
        const o2 = V.addS(e2, sN.r, side * kerbW);
        addQuad(e1, o1, e2, o2, (i % 2 === 0) ? white : stripe);
      }
    }
    if (!pos.length) return null;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(colArr), 3));
    geo.setIndex(idx);
    const mat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    return mesh;
  }

  /* ---------------- CORNER SIGNAGE: chevrons, brake bars, apex beacons ---------------- */
  function buildCornerSigns(track, theme) {
    const group = new THREE.Group();
    const ss = track.samples;
    const darkMat = new THREE.MeshBasicMaterial({ color: col([theme.skyBottom[0] * 0.25, theme.skyBottom[1] * 0.25, theme.skyBottom[2] * 0.3]) });
    const chevMat = new THREE.MeshBasicMaterial({ color: col(theme.accent2), transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false });
    const barMat = new THREE.MeshBasicMaterial({ color: col(theme.accent2), transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    const coreMat = new THREE.MeshBasicMaterial({ color: col(V.lerp(theme.accent2, [1, 1, 1], 0.75)), transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false });
    const haloMat = new THREE.MeshBasicMaterial({ color: col(theme.accent2), transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false });

    // one shared chevron geometry: '>' built from two angled slats on a backing board
    const makeBoard = (flip) => {
      const board = new THREE.Group();
      const back = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 2.4), darkMat);
      board.add(back);
      for (const k of [-1, 1]) {
        const slat = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 0.42), chevMat);
        slat.position.set(flip * -0.2, k * 0.48, 0.03);
        slat.rotation.z = flip * k * 0.7;
        board.add(slat);
      }
      return board;
    };

    for (const c of track.corners) {
      const outside = -c.insideSign;
      const severity = c.minRad < 45 ? 2 : 1;
      // chevron boards along the outside of the corner entry
      const boardAt = [Math.max(2, c.entry - 15), Math.max(2, c.entry - 5), c.apex];
      for (const bi of boardAt) {
        const s = ss[bi];
        if (!s || s.gap) continue;
        const p = V.addS(V.addS(s.p, s.r, outside * (s.w / 2 + 2.6)), s.u, 2.0);
        const board = makeBoard(c.insideSign);
        board.position.set(p[0], p[1], p[2]);
        board.lookAt(p[0] - s.f[0] * 10, p[1] - s.f[1] * 10, p[2] - s.f[2] * 10);
        if (severity === 2) board.scale.setScalar(1.3);
        group.add(board);
      }
      // braking-marker bars across the track on approach
      for (const dM of [80, 55, 30]) {
        const bi = c.entry - Math.round(dM / track.ds);
        const s = ss[bi];
        if (!s || s.gap || bi < 2) continue;
        const bar = new THREE.Mesh(new THREE.PlaneGeometry(s.w * 0.96, 1.1), barMat);
        const p = V.addS(s.p, s.u, 0.09);
        bar.position.set(p[0], p[1], p[2]);
        const m = new THREE.Matrix4().makeBasis(
          new THREE.Vector3(s.r[0], s.r[1], s.r[2]),
          new THREE.Vector3(s.f[0], s.f[1], s.f[2]),
          new THREE.Vector3(s.u[0], s.u[1], s.u[2]));
        bar.quaternion.setFromRotationMatrix(m);
        bar.rotateX(-Math.PI / 2);
        group.add(bar);
      }
      // apex beacon: a dual-layer cylinder (thin bright core + wider volumetric-glow halo)
      const sA = ss[c.apex];
      if (sA && !sA.gap) {
        const p = V.addS(sA.p, sA.r, outside * (sA.w / 2 + 5));
        const core = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.28, 52, 6, 1, true), coreMat);
        core.position.set(p[0], p[1] + 24, p[2]);
        group.add(core);
        const halo = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 2.0, 52, 8, 1, true), haloMat);
        halo.position.set(p[0], p[1] + 24, p[2]);
        group.add(halo);
      }
    }
    return group;
  }

  function buildGates(track, theme, quality) {
    const group = new THREE.Group();
    const mk = (i, radius, tube, c, op) => {
      const s = track.samples[i];
      const geo = new THREE.TorusGeometry(radius, tube, 10, 40);
      const mat = new THREE.MeshBasicMaterial({ color: col(c), transparent: true, opacity: op, blending: THREE.AdditiveBlending, depthWrite: false });
      const m = new THREE.Mesh(geo, mat);
      m.position.set(s.p[0] + s.u[0] * 1.5, s.p[1] + s.u[1] * 1.5, s.p[2] + s.u[2] * 1.5);
      const target = new THREE.Vector3(s.p[0] + s.f[0] * 10, s.p[1] + s.f[1] * 10, s.p[2] + s.f[2] * 10);
      m.lookAt(target);
      group.add(m);
      if (quality !== 'low') {
        // gate ring glow → dynamic light pool (see DD.updateLightPool); the torus mesh + bloom carry the look
        addLightSource(track, [s.p[0] + s.u[0] * 1.5, s.p[1] + s.u[1] * 1.5, s.p[2] + s.u[2] * 1.5], col(c), 5.0, radius * 2.5);
      }
      return m;
    };
    track.gateMeshes = [];
    for (const ci of track.checkpoints) track.gateMeshes.push(mk(ci, track.samples[ci].w * 0.62, 0.16, theme.accent2, 0.75));
    mk(track.finishIdx, track.samples[track.finishIdx].w * 0.66, 0.3, theme.accent, 0.95);
    mk(track.finishIdx, track.samples[track.finishIdx].w * 0.5, 0.12, theme.accent2, 0.8);
    return group;
  }

  function buildDecor(track, theme, rng, quality) {
    const group = new THREE.Group();
    const T = track.terrain;
    const dens = quality === 'low' ? 0.5 : quality === 'med' ? 0.75 : 1;
    const groundY = (x, z) => (T ? DD.terrainAt(T, x, z) : 0);

    // 1) far smooth mountains/dunes on the horizon — low-poly wide squashed spheres forming soft rolling dunes
    //    CLEARANCE: offset must exceed sphere radius so dunes never reach the track ribbon
    {
      const geo = new THREE.SphereGeometry(1, 14, 8);
      const mat = new THREE.MeshStandardMaterial({ color: col(V.scale(V.lerp(theme.skyMid, theme.fogColor, 0.5), 0.6)), roughness: 1, metalness: 0 });
      const n = Math.round(46 * dens);
      const inst = new THREE.InstancedMesh(geo, mat, n);
      const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
      const ss = track.samples;
      for (let i = 0; i < n; i++) {
        const s = ss[rng.int(0, ss.length - 1)];
        const h = rng.range(40, 110);
        const w = rng.range(280, 550);
        const sign = rng.sign();
        // offset must clear the sphere radius + margin so it never clips into track view
        let off = w + rng.range(150, 400);
        let p = V.addS(V.clone(s.p), s.r, sign * off);
        // validate against ALL track samples — the sphere edge (center - w) must clear every sample
        const MIN_EDGE_CLEAR = 120; // min clearance from sphere edge to any track point
        let tooClose = true;
        for (let attempt = 0; attempt < 10; attempt++) {
          tooClose = false;
          for (let j = 0; j < ss.length; j += 4) {
            const sp = ss[j].p;
            const dx = p[0] - sp[0], dz = p[2] - sp[2];
            const dist = Math.sqrt(dx * dx + dz * dz);
            if (dist - w < MIN_EDGE_CLEAR) { tooClose = true; break; }
          }
          if (!tooClose) break;
          // push further out
          off += 300;
          p = V.addS(V.clone(s.p), s.r, sign * off);
        }
        if (tooClose) {
          off = w + 1200;
          p = V.addS(V.clone(s.p), s.r, sign * off);
        }
        const base = groundY(p[0], p[2]);
        e.set(0, rng.range(0, 6.28), 0); q.setFromEuler(e);
        m4.compose(new THREE.Vector3(p[0], base - h * 0.35, p[2]), q, new THREE.Vector3(w, h, w));
        inst.setMatrixAt(i, m4);
      }
      inst.instanceMatrix.needsUpdate = true; inst.frustumCulled = false;
      inst.castShadow = true; inst.receiveShadow = true;
      group.add(inst);
    }

    // 2) sparse elegant monoliths rising FROM the ground near the track (no floating)
    //    CLEARANCE: pushed well away from track to prevent visual clipping / camera obstruction
    //    Each biome's motif now gets a distinct silhouette (was: mountains/pillars/slabs all fell
    //    through to a generic box, and an 'arches' branch no theme could ever trigger).
    const motifGeo = (m) => {
      if (m === 'shards')    return { geo: new THREE.OctahedronGeometry(1), kind: 'shard' };
      if (m === 'spheres')   return { geo: new THREE.SphereGeometry(1, 16, 12), kind: 'sphere' };
      if (m === 'pillars')   return { geo: new THREE.CylinderGeometry(0.9, 1.05, 1, 12), kind: 'pillar' };
      if (m === 'mountains') return { geo: new THREE.ConeGeometry(1, 1, 7), kind: 'mountain' };
      return { geo: new THREE.BoxGeometry(1, 1, 1), kind: 'slab' }; // slabs / islands fallback
    };
    const scatterMotif = (motif, count) => {
      if (!motif || count <= 0) return;
      const { geo, kind } = motifGeo(motif);
      const mat = (kind === 'shard') ? new THREE.MeshStandardMaterial({
        color: col(theme.accent), roughness: 0.12, metalness: 0.95,
        emissive: col(theme.accent), emissiveIntensity: 0.75
      }) : new THREE.MeshStandardMaterial({
        color: col(V.lerp(theme.skyTop, theme.accent, 0.3)), roughness: 0.55, metalness: 0.25,
        emissive: col(theme.accent), emissiveIntensity: 0.06
      });
      const inst = new THREE.InstancedMesh(geo, mat, count);
      const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
      const MIN_CLEAR = 60; // minimum clearance from any track sample
      for (let i = 0; i < count; i++) {
        const s = track.samples[rng.int(0, track.samples.length - 1)];
        let off = rng.range(140, 320);
        const sign = rng.sign();
        let p = V.addS(V.clone(s.p), s.r, sign * off);
        let clear = true;
        for (let attempt = 0; attempt < 10; attempt++) {
          clear = true;
          for (let j = 0; j < track.samples.length; j += 4) {
            const sp = track.samples[j].p;
            const dx = p[0] - sp[0], dz = p[2] - sp[2];
            if (dx * dx + dz * dz < MIN_CLEAR * MIN_CLEAR) { clear = false; break; }
          }
          if (clear) break;
          off += 200;
          p = V.addS(V.clone(s.p), s.r, sign * off);
        }
        if (!clear) { off = 1200; p = V.addS(V.clone(s.p), s.r, sign * off); }
        const base = groundY(p[0], p[2]);
        // per-shape proportions: peaks wide+tall, pillars thin+tall, crystals/slabs mid
        let h, w;
        if (kind === 'mountain')      { h = rng.range(55, 130); w = rng.range(28, 60); }
        else if (kind === 'pillar')   { h = rng.range(40, 95);  w = rng.range(2.5, 6); }
        else if (kind === 'sphere')   { h = rng.range(10, 26);  w = h; }
        else                          { h = rng.range(34, 100); w = rng.range(3, 11); }
        e.set(0, rng.range(0, 6.28), 0); q.setFromEuler(e);
        m4.compose(new THREE.Vector3(p[0], base + h * 0.45, p[2]), q, new THREE.Vector3(w, h, w));
        inst.setMatrixAt(i, m4);
      }
      inst.instanceMatrix.needsUpdate = true; inst.frustumCulled = false;
      inst.castShadow = true; inst.receiveShadow = true;
      group.add(inst);
    };
    scatterMotif(theme.motif, Math.round(16 * dens * theme.decorDensity));
    scatterMotif(theme.motif2, Math.round(7 * dens * theme.decorDensity)); // secondary motif (was generated but never rendered)
    return group;
  }

  /* ---------------- BIOME-VARIED EMISSIVE ENVIRONMENTAL ELEMENTS ---------------- */
  function buildEmissiveElements(track, theme, rng, quality) {
    const group = new THREE.Group();
    const T = track.terrain;
    const groundY = (x, z) => (T ? DD.terrainAt(T, x, z) : 0);
    const dens = quality === 'low' ? 0.45 : quality === 'med' ? 0.75 : 1.0;
    const ss = track.samples;

    // TWO-LAYER props: a DARK structural body + a BRIGHT emissive accent, so each landmark reads
    // as a lit structure (not a flat glowing blob). Two compositions:
    //   'strip'  — big dark form (monolith / pylon) with a glowing seam on its track-facing face.
    //   'onbase' — small dark pedestal under a big bright form (crystal / ice shard).
    // Both stay as exactly two InstancedMeshes (bodyInst + glowInst) → 2 draw calls.
    let role, comp, bodyGeo, glowGeo;
    if (theme.biome === 'dune') {            // leaning monoliths with a glowing seam
      role = 'monolith'; comp = 'strip';
      bodyGeo = new THREE.BoxGeometry(1, 1, 1);
      glowGeo = new THREE.BoxGeometry(1, 1, 1);
    } else if (theme.biome === 'neon') {     // tapered cyber-pylons with a neon strip
      role = 'pylon'; comp = 'strip';
      bodyGeo = new THREE.CylinderGeometry(0.22, 0.5, 1, 6);
      glowGeo = new THREE.BoxGeometry(1, 1, 1);
    } else if (theme.biome === 'canyon') {   // glowing crystals on a dark rock base
      role = 'crystal'; comp = 'onbase';
      bodyGeo = new THREE.BoxGeometry(1, 1, 1);
      glowGeo = new THREE.OctahedronGeometry(1, 0);
    } else {                                  // frozen ice shards on a dark base
      role = 'spike'; comp = 'onbase';
      bodyGeo = new THREE.CylinderGeometry(0.5, 0.6, 1, 6);
      glowGeo = new THREE.ConeGeometry(0.5, 1, 4);
    }

    const bodyMat = new THREE.MeshStandardMaterial({
      color: col([0.035, 0.035, 0.05]), roughness: 0.72, metalness: 0.25,
      emissive: col(theme.accent), emissiveIntensity: 0.07
    });
    const glowMat = new THREE.MeshStandardMaterial({
      color: col(theme.accent2 || theme.accent), roughness: 0.25, metalness: 0.0,
      emissive: col(theme.accent2 || theme.accent), emissiveIntensity: 1.9
    });

    const baseCount = Math.round(110 * dens * (theme.decorDensity || 1.0));
    const totalCount = baseCount + 1; // +1 hero
    const bodyInst = new THREE.InstancedMesh(bodyGeo, bodyMat, totalCount);
    const glowInst = new THREE.InstancedMesh(glowGeo, glowMat, totalCount);

    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
    const pos = new THREE.Vector3(), scl = new THREE.Vector3();
    const MIN_CLEAR = 16.0;

    const isNearCorner = (idx) => {
      if (!track.corners) return false;
      for (const c of track.corners) if (idx >= c.entry - 18 && idx <= c.end + 18) return true;
      return false;
    };

    let placedCount = 0;
    // writes a body+glow pair at the current instance index; `facing` points toward the track
    const place = (p, gy, w, h, facing, registerLight) => {
      const yaw = Math.atan2(facing[0], facing[2]);
      if (comp === 'strip') {
        const d = role === 'pylon' ? w : Math.max(w * 0.5, 1.0); // pylon round; monolith slab
        e.set(0, yaw, 0); q.setFromEuler(e);
        pos.set(p[0], gy + h * 0.5, p[2]); scl.set(w, h, d);
        m4.compose(pos, q, scl); bodyInst.setMatrixAt(placedCount, m4);
        // bright seam on the track-facing front face
        const off = (role === 'pylon' ? w * 0.5 : d * 0.5) + 0.12;
        const gx = p[0] + facing[0] * off, gz = p[2] + facing[2] * off, gyc = gy + h * 0.52;
        pos.set(gx, gyc, gz);
        scl.set(role === 'pylon' ? w * 0.16 : w * 0.24, h * 0.86, role === 'pylon' ? w * 0.16 : d * 0.3);
        m4.compose(pos, q, scl); glowInst.setMatrixAt(placedCount, m4);
        if (registerLight) addLightSource(track, [gx, gyc, gz], col(theme.accent2 || theme.accent), 1.1, 17.0);
      } else { // onbase
        const baseH = Math.max(h * 0.14, 0.6);
        e.set(0, yaw, 0); q.setFromEuler(e);
        pos.set(p[0], gy + baseH * 0.5, p[2]); scl.set(w * 0.85, baseH, w * 0.85);
        m4.compose(pos, q, scl); bodyInst.setMatrixAt(placedCount, m4);
        const gyc = gy + baseH + h * 0.5;
        e.set(0, rng.range(0, 6.2832), 0); q.setFromEuler(e);
        pos.set(p[0], gyc, p[2]); scl.set(w, role === 'crystal' ? h * 0.5 : h, w);
        m4.compose(pos, q, scl); glowInst.setMatrixAt(placedCount, m4);
        if (registerLight) addLightSource(track, [p[0], gyc, p[2]], col(theme.accent2 || theme.accent), 1.1, 17.0);
      }
      placedCount++;
    };

    const sizeFor = () => {
      if (role === 'monolith') return [rng.range(2.5, 5.5), rng.range(12, 42)];
      if (role === 'pylon')    return [rng.range(1.8, 3.6), rng.range(16, 48)];
      if (role === 'crystal')  return [rng.range(4, 11),    rng.range(8, 26)];
      return [rng.range(2.5, 6), rng.range(10, 30)]; // spike
    };

    // 1) Scatter, denser near corners
    for (let i = 0; i < baseCount; i++) {
      let s = null, sIdx = 0;
      for (let attempt = 0; attempt < 8; attempt++) {
        sIdx = rng.int(0, ss.length - 1);
        if (isNearCorner(sIdx) || rng.chance(0.2)) { s = ss[sIdx]; break; }
      }
      if (!s) { sIdx = rng.int(0, ss.length - 1); s = ss[sIdx]; }

      const inCorner = isNearCorner(sIdx);
      let off = inCorner ? (s.w / 2 + 3.0 + rng.range(0.5, 10.0)) : (s.w / 2 + 9.0 + rng.range(6.0, 26.0));
      const sign = rng.sign();
      let p = V.addS(V.clone(s.p), s.r, sign * off);

      let cleared = true;
      for (let j = 0; j < ss.length; j += 6) {
        const sp = ss[j].p; const dx = p[0] - sp[0], dz = p[2] - sp[2];
        if (dx * dx + dz * dz < MIN_CLEAR * MIN_CLEAR) { cleared = false; break; }
      }
      if (!cleared) { off += 18.0; p = V.addS(V.clone(s.p), s.r, sign * off); }

      const gy = groundY(p[0], p[2]);
      const [w, h] = sizeFor();
      const facing = V.norm([-sign * s.r[0], 0, -sign * s.r[2]]);
      const registerLight = placedCount < 10 && off < s.w / 2 + 13.0 && quality !== 'low';
      place(p, gy, w, h, facing, registerLight);
    }

    // 2) One dramatic "hero" landmark on the horizon
    const heroSample = ss[Math.floor(ss.length * 0.62)];
    const heroSign = rng.sign();
    const heroP = V.addS(V.clone(heroSample.p), heroSample.r, heroSign * 430.0);
    const heroGy = groundY(heroP[0], heroP[2]);
    const heroFacing = V.norm([-heroSign * heroSample.r[0], 0, -heroSign * heroSample.r[2]]);
    const heroW = comp === 'strip' ? 40 : 58;
    const heroH = comp === 'strip' ? 210 : 150;
    place(heroP, heroGy, heroW, heroH, heroFacing, false);

    bodyInst.instanceMatrix.needsUpdate = true;
    glowInst.instanceMatrix.needsUpdate = true;
    for (const im of [bodyInst, glowInst]) { im.frustumCulled = false; im.castShadow = true; im.receiveShadow = true; }
    group.add(bodyInst); group.add(glowInst);

    // glow material drives the collective flicker (see game loop)
    group.userData = { mat: glowMat };
    return group;
  }

  /* ---------------- TRACK-SIDE LIGHT POLES — the hero of the night scene ----------------
     Dark posts marching along the verge, each with a glowing lamp head, a soft volumetric
     halo, and a pool of light spilled onto the asphalt. All instanced → 4 draw calls. */
  function buildLightPoles(track, theme, rng, quality) {
    const group = new THREE.Group();
    const ss = track.samples;
    const T = track.terrain;
    const groundY = (x, z) => (T ? DD.terrainAt(T, x, z) : 0);
    const step = Math.max(6, Math.round(42 / track.ds)); // a pole roughly every ~42m
    const places = [];
    let side = 1;
    for (let i = step; i < ss.length - step; i += step) {
      const s = ss[i];
      if (s.gap) continue;
      places.push({ s, side });
      side = -side; // alternate verges
    }
    const n = places.length;
    if (!n) return group;

    const H = 8.0;
    const postGeo = new THREE.CylinderGeometry(0.12, 0.18, H, 6);
    const postMat = new THREE.MeshStandardMaterial({ color: 0x14141c, metalness: 0.6, roughness: 0.5 });
    const posts = new THREE.InstancedMesh(postGeo, postMat, n);

    const lampGeo = new THREE.SphereGeometry(0.42, 10, 8);
    const lampMat = new THREE.MeshBasicMaterial({ color: col(V.lerp(theme.accent2, [1, 1, 1], 0.4)), transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false });
    const lamps = new THREE.InstancedMesh(lampGeo, lampMat, n);

    const isFoggy = theme.atmosphere === 'foggy';
    const haloGeo = new THREE.SphereGeometry(1.15, 10, 8);
    const haloMat = new THREE.MeshBasicMaterial({ color: col(theme.accent2), transparent: true, opacity: isFoggy ? 0.45 : 0.16, blending: THREE.AdditiveBlending, depthWrite: false });
    const halos = new THREE.InstancedMesh(haloGeo, haloMat, n);

    const poolGeo = new THREE.CircleGeometry(1, 18);
    const poolMat = new THREE.MeshBasicMaterial({ color: col(theme.accent2), transparent: true, opacity: 0.42, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    const pools = new THREE.InstancedMesh(poolGeo, poolMat, n);

    const m4 = new THREE.Matrix4(), qI = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1);
    const pos = new THREE.Vector3(), scl = new THREE.Vector3();
    const flat = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0)); // lay disc on the ground

    for (let i = 0; i < n; i++) {
      const s = places[i].s, sd = places[i].side;
      const edge = s.w / 2 + 2.0;
      const baseP = V.addS(V.clone(s.p), s.r, sd * edge);
      const gy = groundY(baseP[0], baseP[2]);
      // post
      m4.compose(pos.set(baseP[0], gy + H * 0.5, baseP[2]), qI, one);
      posts.setMatrixAt(i, m4);
      // lamp head, leaning slightly inboard over the track
      const headP = V.addS(V.clone(baseP), s.r, -sd * 1.4);
      m4.compose(pos.set(headP[0], gy + H, headP[2]), qI, one);
      lamps.setMatrixAt(i, m4);
      if (isFoggy) {
        scl.set(2.5, 2.5, 2.5);
        m4.compose(pos.set(headP[0], gy + H, headP[2]), qI, scl);
      } else {
        m4.compose(pos.set(headP[0], gy + H, headP[2]), qI, one);
      }
      halos.setMatrixAt(i, m4);
      if (quality !== 'low') {
        // register as a light-source for the dynamic pool instead of adding a real PointLight
        addLightSource(track, [headP[0], gy + H, headP[2]], col(theme.accent2), 1.5, 18.0);
      }
      // light pool spilled onto the road edge
      const poolP = V.addS(V.clone(baseP), s.r, -sd * 2.6);
      m4.compose(pos.set(poolP[0], gy + 0.06, poolP[2]), flat, scl.set(5.2, 5.2, 5.2));
      pools.setMatrixAt(i, m4);
    }
    posts.instanceMatrix.needsUpdate = true;
    lamps.instanceMatrix.needsUpdate = true;
    halos.instanceMatrix.needsUpdate = true;
    pools.instanceMatrix.needsUpdate = true;
    posts.castShadow = true;
    posts.receiveShadow = true;
    for (const mm of [posts, lamps, halos, pools]) { mm.frustumCulled = false; group.add(mm); }
    return group;
  }

  /* ---------------- NEON SURROUNDINGS — scattered glowing props in the mid-distance ---------------- */
  function buildNeonProps(track, theme, rng, quality) {
    const group = new THREE.Group();
    const ss = track.samples;
    const T = track.terrain;
    const groundY = (x, z) => (T ? DD.terrainAt(T, x, z) : 0);
    const dens = quality === 'low' ? 0.5 : quality === 'med' ? 0.75 : 1;
    const MIN_CLEAR = 55;

    const place = (sign) => {
      const s = ss[rng.int(0, ss.length - 1)];
      let off = rng.range(60, 260);
      let p = V.addS(V.clone(s.p), s.r, sign * off);
      for (let a = 0; a < 2; a++) {
        let bad = false;
        for (let j = 0; j < ss.length; j += 6) {
          const sp = ss[j].p, dx = p[0] - sp[0], dz = p[2] - sp[2];
          if (dx * dx + dz * dz < MIN_CLEAR * MIN_CLEAR) { bad = true; break; }
        }
        if (!bad) break;
        off += 140; p = V.addS(V.clone(s.p), s.r, sign * off);
      }
      return p;
    };

    // tall glowing neon bars (accent)
    {
      const n = Math.round(26 * dens * theme.decorDensity);
      const geo = new THREE.BoxGeometry(0.5, 1, 0.5);
      const mat = new THREE.MeshBasicMaterial({ color: col(theme.accent), transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });
      const inst = new THREE.InstancedMesh(geo, mat, n);
      const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), pos = new THREE.Vector3(), scl = new THREE.Vector3();
      for (let i = 0; i < n; i++) {
        const p = place(rng.sign()), gy = groundY(p[0], p[2]), hh = rng.range(8, 26);
        e.set(0, rng.range(0, 6.28), 0); q.setFromEuler(e);
        m4.compose(pos.set(p[0], gy + hh * 0.5, p[2]), q, scl.set(1, hh, 1));
        inst.setMatrixAt(i, m4);
      }
      inst.instanceMatrix.needsUpdate = true; inst.frustumCulled = false; group.add(inst);
    }
    // standing neon rings (accent2)
    {
      const n = Math.round(14 * dens * theme.decorDensity);
      const geo = new THREE.TorusGeometry(1, 0.06, 8, 28);
      const mat = new THREE.MeshBasicMaterial({ color: col(theme.accent2), transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false });
      const inst = new THREE.InstancedMesh(geo, mat, n);
      const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), pos = new THREE.Vector3(), one = new THREE.Vector3();
      for (let i = 0; i < n; i++) {
        const p = place(rng.sign()), gy = groundY(p[0], p[2]), r = rng.range(3, 9);
        e.set(rng.range(-0.3, 0.3), rng.range(0, 6.28), rng.range(-0.2, 0.2)); q.setFromEuler(e);
        m4.compose(pos.set(p[0], gy + r + rng.range(0, 6), p[2]), q, one.set(r, r, r));
        inst.setMatrixAt(i, m4);
      }
      inst.instanceMatrix.needsUpdate = true; inst.frustumCulled = false; group.add(inst);
    }
    return group;
  }

  /* ---------------- PROCEDURAL ENVIRONMENT ELEMENTS ---------------- */
  function buildSupportPillars(track, theme) {
    const group = new THREE.Group();
    const ss = track.samples;
    const T = track.terrain;
    if (!T) return group;
    const groundY = (x, z) => DD.terrainAt(T, x, z);
    const step = 12; // spawn a pillar every 12 samples (~24 meters)
    
    const concreteMat = new THREE.MeshStandardMaterial({
      color: 0x22222a,
      roughness: 0.8,
      metalness: 0.1
    });
    
    const colGeo = new THREE.CylinderGeometry(0.7, 0.9, 1.0, 6);
    const baseGeo = new THREE.BoxGeometry(2.4, 0.6, 2.4);
    const capGeo = new THREE.BoxGeometry(1.0, 0.5, 0.85);

    // Collect valid pillar placements first (need the count up front for InstancedMesh).
    const piers = [];
    for (let i = 10; i < ss.length - 10; i += step) {
      const s = ss[i];
      if (s.gap) continue;
      const gY = groundY(s.p[0], s.p[2]);
      const height = s.p[1] - gY - 0.2;
      if (height > 4.5) piers.push({ s, gY, height });
    }
    if (piers.length === 0) return group;
    const N = piers.length;

    // PERF: was ~3 separate meshes PER pillar (hundreds of draw calls). Instance each component so
    // all pillars render in 3 draw calls total. Geometry/material identical; per-instance matrix
    // carries position, the column's height scale, and the cap's width scale + track banking.
    const cols = new THREE.InstancedMesh(colGeo, concreteMat, N);
    const bases = new THREE.InstancedMesh(baseGeo, concreteMat, N);
    const caps = new THREE.InstancedMesh(capGeo, concreteMat, N);
    cols.castShadow = cols.receiveShadow = true;
    bases.castShadow = bases.receiveShadow = true;
    caps.castShadow = caps.receiveShadow = true;

    const m4 = new THREE.Matrix4(), pos = new THREE.Vector3(), q = new THREE.Quaternion(), scl = new THREE.Vector3();
    const idq = new THREE.Quaternion();
    const basis = new THREE.Matrix4();

    for (let i = 0; i < N; i++) {
      const s = piers[i].s, gY = piers[i].gY, height = piers[i].height;
      // column
      m4.compose(pos.set(s.p[0], gY + height * 0.5, s.p[2]), idq, scl.set(1.0, height - 0.8, 1.0));
      cols.setMatrixAt(i, m4);
      // foundation base
      m4.compose(pos.set(s.p[0], gY + 0.3, s.p[2]), idq, scl.set(1, 1, 1));
      bases.setMatrixAt(i, m4);
      // top cap, banked/pitched to match the track frame
      basis.makeBasis(
        new THREE.Vector3(s.r[0], s.r[1], s.r[2]),
        new THREE.Vector3(s.u[0], s.u[1], s.u[2]),
        new THREE.Vector3(s.f[0], s.f[1], s.f[2])
      );
      q.setFromRotationMatrix(basis);
      m4.compose(pos.set(s.p[0], gY + height - 0.25, s.p[2]), q, scl.set(s.w * 0.9, 1.0, 1.0));
      caps.setMatrixAt(i, m4);
    }
    for (const im of [cols, bases, caps]) { im.instanceMatrix.needsUpdate = true; group.add(im); }
    return group;
  }

  function buildNeonArches(track, theme, quality) {
    const group = new THREE.Group();
    const ss = track.samples;
    const step = 40; // every 40 samples (~80 meters)
    
    const candidates = [];
    for (let i = 20; i < ss.length - 20; i += step) {
      const s = ss[i];
      if (s.gap) continue;
      candidates.push(s);
    }
    
    if (candidates.length === 0) return group;
    
    const postGeo = new THREE.CylinderGeometry(0.14, 0.18, 8.5, 6);
    const postMat = new THREE.MeshStandardMaterial({ color: 0x181820, metalness: 0.8, roughness: 0.3 });
    const beamGeo = new THREE.BoxGeometry(1, 0.45, 0.55);
    const beamMat = new THREE.MeshStandardMaterial({ color: 0x181820, metalness: 0.8, roughness: 0.3 });
    const bracketGeo = new THREE.BoxGeometry(0.2, 1.8, 0.35); // diagonal struts
    
    const neonGeo = new THREE.BoxGeometry(1, 0.08, 0.6);
    const neonMat = new THREE.MeshBasicMaterial({ color: col(theme.accent), transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending });
    
    // Center sign display panel
    const signGeo = new THREE.BoxGeometry(1.8, 1.0, 0.12);
    // faint emissive tint so the panel reads as a powered board even when nothing lights it
    const signMat = new THREE.MeshStandardMaterial({ color: 0x0c0c10, metalness: 0.9, roughness: 0.1, emissive: col(theme.accent2), emissiveIntensity: 0.06 });
    const signGlowMat = new THREE.MeshBasicMaterial({ color: col(theme.accent2), transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending });
    const chevronGeo = new THREE.BoxGeometry(0.45, 0.12, 0.14);

    // Glowing pool on road surface under the arches
    const poolGeo = new THREE.CircleGeometry(1, 16);
    const poolMat = new THREE.MeshBasicMaterial({ color: col(theme.accent), transparent: true, opacity: DD.GLOW.archPool, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    
    // PERF: each arch used to be a Group of ~16 separate meshes — with ~28 arches that's ~450 draw
    // calls, which was the single biggest CPU/draw-call cost in the scene. Instance every component
    // so all arches render in ~7 draw calls. Per-instance matrices bake each arch's track-frame
    // orientation/position plus the per-arch width/scale of the crossbar, neon strip and pool.
    const N = candidates.length;
    const posts = new THREE.InstancedMesh(postGeo, postMat, N * 4);
    const crossbars = new THREE.InstancedMesh(beamGeo, beamMat, N);
    const brackets = new THREE.InstancedMesh(bracketGeo, beamMat, N * 2);
    const neons = new THREE.InstancedMesh(neonGeo, neonMat, N);
    const signs = new THREE.InstancedMesh(signGeo, signMat, N);
    const chevrons = new THREE.InstancedMesh(chevronGeo, signGlowMat, N * 6);
    const pools = new THREE.InstancedMesh(poolGeo, poolMat, N);
    posts.castShadow = posts.receiveShadow = true;
    crossbars.castShadow = crossbars.receiveShadow = true;
    brackets.castShadow = brackets.receiveShadow = true;
    signs.castShadow = signs.receiveShadow = true;

    const archMat = new THREE.Matrix4(), local = new THREE.Matrix4(), world = new THREE.Matrix4();
    const basis = new THREE.Matrix4();
    const pos = new THREE.Vector3(), quat = new THREE.Quaternion(), scl = new THREE.Vector3();
    const qArch = new THREE.Quaternion(), ez = new THREE.Euler();
    // local transform (relative to arch frame) -> world matrix = archMat * local
    const place = (px, py, pz, rot, sx, sy, sz) => {
      pos.set(px, py, pz);
      if (rot) quat.setFromEuler(rot); else if (quat.identity) quat.identity();
      scl.set(sx, sy, sz);
      local.compose(pos, quat, scl);
      if (world.multiplyMatrices) return world.multiplyMatrices(archMat, local);
      return world;
    };

    let pi = 0, bi = 0, ci = 0;
    for (let i = 0; i < N; i++) {
      const s = candidates[i];
      const halfW = s.w / 2 + 0.6;
      basis.makeBasis(
        new THREE.Vector3(s.r[0], s.r[1], s.r[2]),
        new THREE.Vector3(s.u[0], s.u[1], s.u[2]),
        new THREE.Vector3(s.f[0], s.f[1], s.f[2])
      );
      qArch.setFromRotationMatrix(basis);
      archMat.compose(pos.set(s.p[0], s.p[1], s.p[2]), qArch, scl.set(1, 1, 1));

      // posts (4: two side rails × two z-offsets)
      for (const offsetZ of [-0.22, 0.22]) {
        posts.setMatrixAt(pi++, place(-halfW, 4.25, offsetZ, null, 1, 1, 1));
        posts.setMatrixAt(pi++, place(halfW, 4.25, offsetZ, null, 1, 1, 1));
      }
      // crossbar (scaled to span the arch width)
      crossbars.setMatrixAt(i, place(0, 8.5, 0, null, halfW * 2 + 0.6, 1, 1));
      // diagonal corner brackets
      brackets.setMatrixAt(bi++, place(-halfW + 0.8, 7.8, 0, ez.set(0, 0, -Math.PI / 4), 1, 1, 1));
      brackets.setMatrixAt(bi++, place(halfW - 0.8, 7.8, 0, ez.set(0, 0, Math.PI / 4), 1, 1, 1));
      // glowing neon strip underside
      neons.setMatrixAt(i, place(0, 8.24, 0, null, halfW * 1.8, 1, 1));
      // center sign panel (signGroup sat at y=7.3)
      signs.setMatrixAt(i, place(0, 7.3, 0, null, 1, 1, 1));
      // sign glyphs: two LARGE chevrons + top/bottom frame bars (6 instances/sign, same count
      // as before). Big glyphs are the point — the old six mini-chevrons were sub-pixel at
      // distance, so the panel read as a floating black box hanging over the road.
      for (const sx of [-0.42, 0.30]) {
        for (const sy of [-1, 1]) {
          chevrons.setMatrixAt(ci++, place(sx, 7.3 + sy * 0.19, 0.07, ez.set(0, 0, sy * 0.62), 1.6, 1.4, 1));
        }
      }
      chevrons.setMatrixAt(ci++, place(0, 7.82, 0.05, null, 4.2, 0.35, 0.5));
      chevrons.setMatrixAt(ci++, place(0, 6.78, 0.05, null, 4.2, 0.35, 0.5));
      // flat neon pool on the road surface
      pools.setMatrixAt(i, place(0, 0.02, 0, ez.set(-Math.PI / 2, 0, 0), s.w * 0.7, 3.5, 1.0));

      // Downward arch light — registered with the dynamic light pool rather than added as real
      // lights (see DD.updateLightPool). The visible cone/pool is the additive pool mesh + bloom;
      // the pool light supplies real illumination only when you're near.
      if (quality !== 'low') {
        addLightSource(track, [s.p[0] + s.u[0] * 7.5, s.p[1] + s.u[1] * 7.5, s.p[2] + s.u[2] * 7.5],
          col(theme.accent), 4.0, 24.0);
      }
    }

    // arches span the whole track, so per-instance frustum culling can't help — keep them resident
    for (const im of [posts, crossbars, brackets, neons, signs, chevrons, pools]) {
      im.instanceMatrix.needsUpdate = true;
      im.frustumCulled = false;
      group.add(im);
    }
    return group;
  }

  function buildHorizonMountains(track, theme, rng) {
    const group = new THREE.Group();
    const numLayers = 3;
    const numMountains = 24;
    
    const coneGeo = new THREE.ConeGeometry(1, 1, 5);
    coneGeo.translate(0, 0.5, 0);
    
    const colors = [
      col([theme.skyBottom[0] * 0.22, theme.skyBottom[1] * 0.22, theme.skyBottom[2] * 0.28]),
      col([theme.skyBottom[0] * 0.14, theme.skyBottom[1] * 0.14, theme.skyBottom[2] * 0.20]),
      col([theme.skyBottom[0] * 0.08, theme.skyBottom[1] * 0.08, theme.skyBottom[2] * 0.12])
    ];

    // Compute track bounding box to center the mountains dynamically
    const ss = track.samples;
    let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;
    for (let i = 0; i < ss.length; i++) {
      const p = ss[i].p;
      minX = Math.min(minX, p[0]);
      maxX = Math.max(maxX, p[0]);
      minZ = Math.min(minZ, p[2]);
      maxZ = Math.max(maxZ, p[2]);
    }
    const centerX = (minX + maxX) * 0.5;
    const centerZ = (minZ + maxZ) * 0.5;
    const sizeX = maxX - minX;
    const sizeZ = maxZ - minZ;
    const trackSize = Math.max(sizeX, sizeZ);
    
    for (let layer = 0; layer < numLayers; layer++) {
      const mat = new THREE.MeshStandardMaterial({
        color: colors[layer],
        roughness: 1.0,
        metalness: 0.0,
        flatShading: true,
        shadowSide: THREE.DoubleSide
      });
      
      const n = numMountains - layer * 4;
      const inst = new THREE.InstancedMesh(coneGeo, mat, n);
      const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), pos = new THREE.Vector3(), scl = new THREE.Vector3();
      const radius = (trackSize * 0.5) + 1600.0 + layer * 250.0;
      const center = new THREE.Vector3(centerX, -110 - layer * 20, centerZ);
      
      for (let i = 0; i < n; i++) {
        const angle = (i / n) * Math.PI * 2 + rng.range(-0.15, 0.15) + (layer * 0.1);
        const dist = radius + rng.range(-100, 100);
        const w = rng.range(280, 520);
        const h = rng.range(140, 290) - layer * 25;
        
        pos.set(center.x + Math.sin(angle) * dist, center.y, center.z + Math.cos(angle) * dist);
        scl.set(w, h, w);
        q.setFromEuler(new THREE.Euler(0, rng.range(0, 3.14), 0));
        m4.compose(pos, q, scl);
        inst.setMatrixAt(i, m4);
      }
      
      inst.instanceMatrix.needsUpdate = true;
      inst.frustumCulled = false;
      group.add(inst);
    }
    return group;
  }

  function buildNebulae(theme, rng) {
    const group = new THREE.Group();
    const numClouds = 4;
    const tex = getNebulaTexture();
    
    const mat = new THREE.MeshBasicMaterial({
      color: col(theme.accent),
      map: tex,
      transparent: true,
      opacity: 0.14,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: false // sky element: beyond fogFar, world fog would swallow it entirely
    });

    const geo = new THREE.PlaneGeometry(1600, 1600);
    for (let i = 0; i < numClouds; i++) {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(rng.range(-1500, 1500), 1000 + i * 80, rng.range(-1500, 1500));
      m.rotation.set(Math.PI / 2, rng.range(0, 3.14), 0);
      group.add(m);
    }
    return group;
  }

  let _auroraTexCache = null;
  function getAuroraTexture() {
    if (_auroraTexCache) return _auroraTexCache;
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    const grad = ctx.createLinearGradient(0, 0, 0, 64);
    grad.addColorStop(0, 'rgba(255, 255, 255, 0)');
    grad.addColorStop(0.5, 'rgba(255, 255, 255, 1)');
    grad.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 256, 64);
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    _auroraTexCache = tex;
    return tex;
  }

  function buildAurora(track, theme, rng) {
    const group = new THREE.Group();
    const bands = DD.GLOW.aurora.bands;
    const tex = getAuroraTexture();
    const colors = [
      theme.accent,
      theme.accent2,
      V.lerp(theme.accent, theme.accent2, 0.5)
    ];
    const scales = [1.0, 1.15, 0.85];
    const angles = [0.15, -0.3, 0.1];

    track.auroraMaterials = [];

    for (let i = 0; i < bands; i++) {
      const clonedTex = tex.clone();
      clonedTex.needsUpdate = true;
      const mat = new THREE.MeshBasicMaterial({
        color: col(colors[i % colors.length]),
        map: clonedTex,
        transparent: true,
        opacity: 0.22 * DD.GLOW.aurora.glow,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
        fog: false
      });
      track.auroraMaterials.push(mat);

      // vertical CURTAINS hung near the horizon (sky furniture, camera-followed like the
      // planet). The first cut used near-flat ceiling strips at y~850 — seen edge-on from the
      // road they read as thin lines, i.e. no aurora at all.
      const geo = new THREE.PlaneGeometry(2600 * scales[i], 430);
      const m = new THREE.Mesh(geo, mat);
      m.position.set(-650 + i * 620, 420 + i * 75, -1500 - i * 130);
      m.rotation.set(0.10, angles[i] * 0.5, 0.05 + i * 0.05);
      group.add(m);
    }
    return group;
  }

  function buildSciFiPlanet(theme, rng) {
    const group = new THREE.Group();
    // A luminous dream-moon. `fog: false` is load-bearing: the planet sits beyond fogFar, so
    // with fog applied the sphere rendered as a solid fog-colored disc — a "black hole" punched
    // into the sky gradient (and the ring floated as a giant ghost circle).
    const bodyCol = [
      DD.lerp(theme.skyBand[0], theme.accent2[0], 0.4),
      DD.lerp(theme.skyBand[1], theme.accent2[1], 0.4),
      DD.lerp(theme.skyBand[2], theme.accent2[2], 0.4)
    ];
    const planetGeo = new THREE.SphereGeometry(120, 24, 24);
    const planetMat = new THREE.MeshBasicMaterial({ color: col(bodyCol), fog: false });
    const planet = new THREE.Mesh(planetGeo, planetMat);
    planet.position.set(1000, 420, -1800);
    group.add(planet);

    // soft additive shell so the edge reads hazy instead of a hard paper cutout
    const halo = new THREE.Mesh(
      new THREE.SphereGeometry(134, 24, 24),
      new THREE.MeshBasicMaterial({ color: col(theme.accent2), transparent: true, opacity: 0.10, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    halo.position.copy(planet.position);
    group.add(halo);

    const ringGeo = new THREE.RingGeometry(160, 230, 30);
    const ringMat = new THREE.MeshBasicMaterial({
      color: col(theme.accent),
      transparent: true,
      opacity: 0.10,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.set(Math.PI / 3, Math.PI / 6, 0);
    planet.add(ring);

    return group;
  }

  DD.buildTrackScene = function (scene, track, quality) {
    const theme = track.theme;
    const rng = DD.makeRng(track.seed + '::decor');
    const root = new THREE.Group();

    let fogNear = theme.fogNear;
    let fogFar = theme.fogFar;
    if (theme.atmosphere === 'foggy') {
      fogNear = 20;
      fogFar = 220;
    } else if (quality !== 'low') {
      fogNear = Math.min(fogNear, 350);
      fogFar = Math.min(fogFar, 1100);
    }
    scene.fog = new THREE.Fog(col(V.scale(theme.fogColor, 0.72)), fogNear, fogFar);
    scene.background = col(V.scale(theme.skyBottom, 0.72));

    const sky = buildSky(theme);
    root.add(sky);
    track.skyMesh = sky;
    // night sky: stars always present; density driven by theme.atmosphere/biome (see buildStars)
    {
      const stars = buildStars(theme, rng);
      root.add(stars);
      track.starsMesh = stars;
    }
    root.add(buildTerrain(track, theme));
    const grid = buildTerrainGrid(track, theme);
    if (grid) root.add(grid);
    track.fireflies = buildFireflies(track, theme, rng);
    root.add(track.fireflies);
    root.add(buildRibbon(track, theme));

    // edge glow strips
    const edge = (side) => buildStrip(track, theme,
      (s) => {
        if (s.gap) return null;
        const c = V.addS(V.addS(s.p, s.r, side * (s.w / 2 - 0.18)), s.u, 0.06);
        return [V.addS(c, s.r, -0.22 * side), V.addS(c, s.r, 0.22 * side)];
      }, theme.accent, 0.9, THREE.AdditiveBlending);
    root.add(edge(1)); root.add(edge(-1));

    // secondary outer rail line in accent2 — a thin glow just outside the main edge, giving the
    // border a layered two-tone neon look instead of a single line.
    const rail2 = (side) => buildStrip(track, theme,
      (s) => {
        if (s.gap) return null;
        const c = V.addS(V.addS(s.p, s.r, side * (s.w / 2 + 0.34)), s.u, 0.05);
        return [V.addS(c, s.r, -0.1 * side), V.addS(c, s.r, 0.1 * side)];
      }, theme.accent2, 0.6, THREE.AdditiveBlending);
    { const a = rail2(1), b = rail2(-1); if (a) root.add(a); if (b) root.add(b); }

    // biome-coloured corner kerbs (rumble strips on the apex edges)
    const kerbs = buildKerbs(track, theme);
    if (kerbs) root.add(kerbs);

    // dashed glowing centre line — breaks up the flat asphalt and reads as speed/motion.
    // Dashes via skipping alternating sample runs (offsetFn returns null on the gaps).
    const centre = buildStrip(track, theme,
      (s, i) => {
        if (s.gap || (i % 8) >= 4) return null; // ~4-on / 4-off dash pattern
        const c = V.addS(s.p, s.u, 0.05);
        return [V.addS(c, s.r, -0.13), V.addS(c, s.r, 0.13)];
      }, V.lerp(theme.accent2, [1, 1, 1], 0.45), 0.42, THREE.AdditiveBlending);
    if (centre) root.add(centre);

    // boost overlay
    const boost = buildStrip(track, theme,
      (s) => s.surf === DD.SURF.BOOST ? [V.addS(V.addS(s.p, s.u, 0.09), s.r, -s.w * 0.3), V.addS(V.addS(s.p, s.u, 0.09), s.r, s.w * 0.3)] : null,
      theme.boostColor, 0.55, THREE.AdditiveBlending);
    if (boost) { root.add(boost); track.boostMesh = boost; }

    // glass shine overlay
    const glass = buildStrip(track, theme,
      (s) => s.surf === DD.SURF.GLASS ? [V.addS(V.addS(s.p, s.u, 0.07), s.r, -s.w / 2), V.addS(V.addS(s.p, s.u, 0.07), s.r, s.w / 2)] : null,
      theme.glassColor, 0.28, THREE.AdditiveBlending);
    if (glass) root.add(glass);

    // guardrails: translucent wall + bright top rail
    const railWall = (side) => buildStrip(track, theme,
      (s) => s.wall && !s.gap ? [V.addS(s.p, s.r, side * s.w / 2), V.addS(V.addS(s.p, s.r, side * s.w / 2), s.u, 0.85)] : null,
      theme.accent2, 0.22, THREE.AdditiveBlending);
    const railTop = (side) => buildStrip(track, theme,
      (s) => {
        if (!s.wall || s.gap) return null;
        const c = V.addS(V.addS(s.p, s.r, side * s.w / 2), s.u, 0.85);
        return [V.addS(c, s.r, -0.1 * side), V.addS(c, s.r, 0.1 * side)];
      }, theme.accent2, 0.85, THREE.AdditiveBlending);
    for (const side of [1, -1]) {
      const w = railWall(side), tline = railTop(side);
      if (w) root.add(w); if (tline) root.add(tline);
    }

    root.add(buildGates(track, theme, quality));
    root.add(buildCornerSigns(track, theme));
    root.add(buildDecor(track, theme, rng, quality));
    
    const emissiveDecor = buildEmissiveElements(track, theme, rng, quality);
    if (emissiveDecor) {
      root.add(emissiveDecor);
      track.emissiveDecorMesh = emissiveDecor;
    }

    const poles = buildLightPoles(track, theme, rng, quality);
    root.add(poles);
    const props = buildNeonProps(track, theme, rng, quality);
    root.add(props);

    // Support pillars under elevated sections
    root.add(buildSupportPillars(track, theme));
    // Glowing neon arches with downward light pools
    const arches = buildNeonArches(track, theme, quality);
    root.add(arches);

    // Tall glowing verticals photobomb the garage: a lamp/pylon right behind the stage reads
    // as a giant bloom beam through the showcase car. game.js hides these while in the garage
    // (same pattern as track.gateMeshes); everything low/horizontal stays as backdrop.
    track.garageHide = [poles, props, arches];
    if (emissiveDecor) track.garageHide.push(emissiveDecor);
    
    // Distant background elements (skipped on low quality for mobile performance)
    if (quality !== 'low') {
      root.add(buildHorizonMountains(track, theme, rng));
      
      if (theme.atmosphere === 'aurora') {
        const aurora = buildAurora(track, theme, rng);
        root.add(aurora);
        track.auroraMesh = aurora;
      } else {
        const nebulae = buildNebulae(theme, rng);
        root.add(nebulae);
        track.nebulaeMesh = nebulae;
      }
      
      const planet = buildSciFiPlanet(theme, rng);
      root.add(planet);
      track.planetMesh = planet;
    }

    // NIGHT lighting: cool moonlight from the sky, a warm directional sun grazing
    // along the horizon, and a stronger neon rim — boosted for better road/terrain visibility.
    // Brightened sky term + higher default intensity: this hemisphere fill is what keeps areas
    // BETWEEN the pooled lights from going pitch-black now that we no longer have ~120 decor lights
    // scattered everywhere. It's a single cheap light (no per-light draw cost).
    const amb = new THREE.HemisphereLight(col([0.26, 0.30, 0.48]), col([0.04, 0.04, 0.07]), theme.ambient != null ? Math.max(theme.ambient, 0.45) : 0.45);
    root.add(amb);
    const sun = new THREE.DirectionalLight(col([1.0, 0.50, 0.25]), 0.85);  // warm ember key
    sun.position.set(Math.sin(theme.lightAngle) * 120, 48.0, Math.cos(theme.lightAngle) * 120); // raised above horizon to illuminate track/terrain
    root.add(sun);

    // Store sun light on the track object so the game loop can update its position relative to the car
    track.sunLight = sun;
    if (sun.target) {
      root.add(sun.target);
    }

    if (quality !== 'low') {
      sun.castShadow = true;
      if (sun.shadow) {
        // PERF: the sun shadow covers a large ortho area (d=160) with soft PCF, so 2048 was
        // overkill — 1024 quarters the shadow-pass fill cost with little visible difference.
        sun.shadow.mapSize.width = 1024;
        sun.shadow.mapSize.height = 1024;
        sun.shadow.camera.near = 0.5;
        sun.shadow.camera.far = 450;
        const d = 160; // Orthographic size around the player/camera
        sun.shadow.camera.left = -d;
        sun.shadow.camera.right = d;
        sun.shadow.camera.top = d;
        sun.shadow.camera.bottom = -d;
        sun.shadow.bias = -0.0006;
        sun.shadow.camera.updateProjectionMatrix();
      }
    }

    const rim = new THREE.DirectionalLight(col(theme.accent2), 0.45);  // neon bounce, the cool counter-key
    rim.position.set(-Math.sin(theme.lightAngle) * 90, 26, -Math.cos(theme.lightAngle) * 90);
    root.add(rim);

    // Dynamic light pool: a small fixed set of real PointLights that snap to the nearest registered
    // decor light-sources each frame (see addLightSource / DD.updateLightPool). Replaces the ~120
    // per-decor lights that used to live in the scene. Skipped on 'low' (no decor lights there).
    if (quality !== 'low' && track._lightSources && track._lightSources.length) {
      const K = Math.min(quality === 'high' ? 12 : 8, track._lightSources.length);
      track._lightPool = [];
      for (let i = 0; i < K; i++) {
        const L = THREE.PointLight ? new THREE.PointLight(0xffffff, 0, 20, 1.8) : { position: new THREE.Vector3(), color: { copy: function() {} } };
        L.castShadow = false;
        if (THREE.PointLight) root.add(L);
        track._lightPool.push(L);
      }
      track._lpDist = new Float32Array(track._lightSources.length);
      track._lpIdx = new Int32Array(track._lightSources.length);
    }

    scene.add(root);
    return root;
  };

  /* ---------------- PROCEDURAL TEXTURE GENERATORS ---------------- */
  let _asphaltNormalCache = null;
  function getAsphaltNormalTexture() {
    if (_asphaltNormalCache) return _asphaltNormalCache;
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    const imgData = ctx.createImageData(64, 64);
    const data = imgData.data;
    for (let i = 0; i < data.length; i += 4) {
      const nx = (Math.random() - 0.5) * 0.45;
      const ny = (Math.random() - 0.5) * 0.45;
      const nz = Math.sqrt(1 - nx * nx - ny * ny);
      data[i]     = Math.round((nx + 1) * 127.5);
      data[i + 1] = Math.round((ny + 1) * 127.5);
      data[i + 2] = Math.round((nz + 1) * 127.5);
      data[i + 3] = 255;
    }
    ctx.putImageData(imgData, 0, 0);
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(16, 250);
    if (DD.game && DD.game.renderer) {
      tex.anisotropy = DD.game.renderer.capabilities.getMaxAnisotropy();
    } else {
      tex.anisotropy = 8;
    }
    _asphaltNormalCache = tex;
    return tex;
  }

  let _asphaltRoughnessCache = null;
  function getAsphaltRoughnessTexture() {
    if (_asphaltRoughnessCache) return _asphaltRoughnessCache;
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    
    // Base roughness - raised floor to prevent razor mirror highlights
    ctx.fillStyle = 'rgb(148, 148, 148)'; // 148/255 ≈ 0.58
    ctx.fillRect(0, 0, 128, 128);
    
    // Draw some patches of higher/lower roughness to simulate wear or wet spots
    let seed = 12345;
    function rand() {
      const x = Math.sin(seed++) * 10000;
      return x - Math.floor(x);
    }
    
    for (let i = 0; i < 12; i++) {
      const x = rand() * 128;
      const y = rand() * 128;
      const radius = 15 + rand() * 25;
      const grad = ctx.createRadialGradient(x, y, 0, x, y, radius);
      const rVal = Math.round((0.55 + rand() * 0.35) * 255); // Floor around 0.55
      grad.addColorStop(0, `rgba(${rVal}, ${rVal}, ${rVal}, 0.75)`);
      grad.addColorStop(1, 'rgba(148, 148, 148, 0)');
      
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 128, 128);
    }
    
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(8, 60); // Low frequency compared to normal map
    if (DD.game && DD.game.renderer) {
      tex.anisotropy = DD.game.renderer.capabilities.getMaxAnisotropy();
    } else {
      tex.anisotropy = 8;
    }
    _asphaltRoughnessCache = tex;
    return tex;
  }

  let _nebulaTexCache = null;
  function getNebulaTexture() {
    if (_nebulaTexCache) return _nebulaTexCache;
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    const grad = ctx.createRadialGradient(64, 64, 10, 64, 64, 64);
    grad.addColorStop(0, 'rgba(255, 255, 255, 1)');
    grad.addColorStop(0.3, 'rgba(255, 255, 255, 0.4)');
    grad.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 128, 128);
    const tex = new THREE.CanvasTexture(canvas);
    _nebulaTexCache = tex;
    return tex;
  }

  let _carbonTexCache = null;
  /* shared round-dot sprite for the particle PointsMaterials — raw points render as hard
     squares (clearly visible on snow); stars have their own shader, everything else uses this */
  let _dotTexCache = null;
  function getDotTexture() {
    if (_dotTexCache) return _dotTexCache;
    const c = document.createElement('canvas');
    c.width = c.height = 32;
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.45, 'rgba(255,255,255,0.8)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 32, 32);
    _dotTexCache = new THREE.CanvasTexture(c);
    return _dotTexCache;
  }

  function getCarbonTexture() {
    if (_carbonTexCache) return _carbonTexCache;
    const canvas = document.createElement('canvas');
    canvas.width = 16;
    canvas.height = 16;
    const ctx = canvas.getContext('2d');
    // higher-contrast 2x2 twill so the weave actually reads as a colour map (not just a faint bump)
    ctx.fillStyle = '#15151c';
    ctx.fillRect(0, 0, 16, 16);
    ctx.fillStyle = '#3a3a47';
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        if ((x - y + 16) % 4 === 0 || (x - y + 16) % 4 === 1) {
          ctx.fillRect(x, y, 1, 1);
        }
      }
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(10, 6); // visible weave scale on the floor/fins (was 48x24 → sub-pixel, invisible)
    if (DD.game && DD.game.renderer) {
      tex.anisotropy = DD.game.renderer.capabilities.getMaxAnisotropy();
    } else {
      tex.anisotropy = 4;
    }
    _carbonTexCache = tex;
    return tex;
  }

  /* ---------------- CAR — abstract F1, PBR ---------------- */
  /* ===================== CAR — spec-driven builder (cars-as-data) =====================
     DD.buildCar is now a thin wrapper over DD.buildCarFromSpec(spec, ctx). The 4 variants are DATA
     (DD.CAR_PRESETS in carspec.js), not branches; parts + wheel styles are small registries so a new
     look is added by data, not a new if-branch. Full model: CAR_DESIGN_SYSTEM.md. The hard contract
     (wheels/frontWheels/spinGroup, userData.{boostShell,iridescent,baseEmis,baseEmisI,grad}, ghost,
     envMap, setShadows, +Z fwd / +Y up / origin ground-centre) is preserved exactly. */

  const _box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
  const _cyl = (rt, rb, h, s) => new THREE.CylinderGeometry(rt, rb, h, s);
  const _tor = (r, t, a, b) => new THREE.TorusGeometry(r, t, a, b);
  const _sph = (r, a, b) => new THREE.SphereGeometry(r, a, b);
  const _mesh = (g, m) => new THREE.Mesh(g, m);
  const _stdMat = (c, metal, rough, envMap) => new THREE.MeshStandardMaterial({ color: c, metalness: metal, roughness: rough, envMap: envMap || null });

  const CAR_FIN = {
    'Matte':      { metal: 0.5, rough: 0.42, clearcoat: 0.0, ccRough: 0.0 },
    'Gloss':      { metal: 0.85, rough: 0.14, clearcoat: 1.0, ccRough: 0.03 },
    'Iridescent': { metal: 0.95, rough: 0.18, clearcoat: 1.0, ccRough: 0.05 },
    'Glass':      { metal: 0.3, rough: 0.05, clearcoat: 0.0, ccRough: 0.0 },
    'Neon Edge':  { metal: 0.7, rough: 0.3, clearcoat: 0.4, ccRough: 0.05 }
  };

  // garage paint/finish + the design palette → the material slots the hull/parts draw from
  function makeCarMaterials(garage, ghost, envMap, palette) {
    const G = DD.GARAGE;
    const grad = G.gradients[garage.grad % G.gradients.length];
    const finish = G.finishes[garage.finish % G.finishes.length];
    const op = ghost ? 0.3 : (finish === 'Glass' ? 0.55 : 1);
    const trans = ghost || finish === 'Glass';
    const fb = CAR_FIN[finish] || { metal: 0.6, rough: 0.3, clearcoat: 0.0, ccRough: 0.0 };
    const mBias = (palette && palette.metalBias) || 0;
    const fin = { metal: Math.max(0, Math.min(1, fb.metal + mBias)), rough: fb.rough, clearcoat: fb.clearcoat, ccRough: fb.ccRough };
    const gradMix = (t) => V.lerp(grad.a, grad.b, t);
    // 'body' slot — gradient pulled toward dark metal (liveried, not a toy). The boostShell/iridescent hull.
    const bodyMat = (c, emisAmt) => new THREE.MeshPhysicalMaterial({
      color: col(emisAmt ? c : V.lerp(c, [0.06, 0.06, 0.08], ghost ? 0.45 : 0.32)),
      metalness: fin.metal, roughness: fin.rough,
      clearcoat: fin.clearcoat, clearcoatRoughness: fin.ccRough,
      transparent: trans, opacity: op,
      emissive: emisAmt ? col(c) : (finish === 'Neon Edge' ? col(grad.b) : 0x000000),
      emissiveIntensity: emisAmt || (finish === 'Neon Edge' ? 0.5 : 0),
      envMapIntensity: ghost ? 0.4 : 1.0, envMap: envMap || null
    });
    // 'glow' slot — emissive + bloom only (NEVER a real light: protects the light pool / texture-unit limit)
    const gi = (palette && palette.glowI != null) ? palette.glowI : 0.9;
    const glowMul = Math.min(1.3, 0.55 + gi * 0.55);
    const glowMat = (c, o) => new THREE.MeshBasicMaterial({ color: col(c), transparent: true, opacity: (o == null ? 0.9 : o) * (ghost ? 0.4 : 1) * glowMul, blending: THREE.AdditiveBlending, depthWrite: false });
    const carbonTex = getCarbonTexture();
    const carbon = ghost ? bodyMat(gradMix(0.5)) : new THREE.MeshPhysicalMaterial({
      color: 0xffffff, map: carbonTex, metalness: 0.35, roughness: 0.5,
      bumpMap: carbonTex, bumpScale: 0.05, clearcoat: 1.0, clearcoatRoughness: 0.08,
      envMapIntensity: 0.8, envMap: envMap || null
    });
    const cockpitMat = new THREE.MeshPhysicalMaterial({
      color: 0x050508, metalness: 0.0, roughness: 0.02,
      transmission: ghost ? 0.25 : 0.65, ior: 1.52, clearcoat: 1.0, clearcoatRoughness: 0.0,
      transparent: true, opacity: ghost ? 0.25 : 1.0, envMapIntensity: ghost ? 0.5 : 1.2, envMap: envMap || null
    });
    const chrome = (ghost || finish === 'Glass') ? bodyMat(gradMix(0.5)) : new THREE.MeshStandardMaterial({ color: 0xd8d8e0, metalness: 1.0, roughness: 0.16, envMapIntensity: ghost ? 0.3 : 1.2, envMap: envMap || null });
    return { grad, finish, fin, gradMix, bodyMat, glowMat, carbon, cockpitMat, chrome };
  }

  // loft the hull from chassis.hull station data (the silhouette). One BufferGeometry; rounded top +
  // flat floor; centroid-fan caps (not collapsed → no pinched normals). See CAR_REBUILD_PLAN.md.
  function buildHull(hull, hp, L, mat) {
    const frontZ = hp.frontZ * L, rearZ = hp.rearZ * L;
    const wheelbase = frontZ - rearZ, midZ = (frontZ + rearZ) / 2;
    const WIDTH = 1.18, HEIGHT = 0.92, YB = 0.05;
    const ST = hull.station, maxHw = hull.fenderClamp;
    const sup = hull.section.kind === 'superellipse', p = hull.section.exp;
    const K = 18, M = ST.length, pos = [], idx = [];
    for (let m = 0; m < M; m++) {
      const hw = Math.min(ST[m][1], maxHw) * WIDTH;
      const hgt = Math.max(ST[m][2] * HEIGHT, 0.04);
      const yc = YB + ST[m][3] * HEIGHT;
      const wz = ST[m][0] * wheelbase + midZ;
      const floorY = yc - hgt * 0.5;
      for (let i = 0; i < K; i++) {
        const th = (i / K) * Math.PI * 2, s = Math.sin(th), cVal = Math.cos(th);
        let px, py;
        if (sup) {
          px = hw * Math.sign(cVal) * Math.pow(Math.abs(cVal), p);
          py = s >= 0 ? yc + hgt * 0.5 * Math.sign(s) * Math.pow(Math.abs(s), p) : floorY;
        } else {
          px = hw * cVal;
          py = s >= 0 ? yc + hgt * 0.5 * s : floorY;
        }
        pos.push(px, py, wz);
      }
    }
    for (let m = 0; m < M - 1; m++) for (let i = 0; i < K; i++) {
      const a = m * K + i, b = m * K + (i + 1) % K, c = (m + 1) * K + i, d = (m + 1) * K + (i + 1) % K;
      idx.push(a, c, b, b, c, d);
    }
    const cap = (m, rev) => {
      let cx = 0, cy = 0, cz = 0;
      for (let i = 0; i < K; i++) { cx += pos[(m * K + i) * 3]; cy += pos[(m * K + i) * 3 + 1]; cz += pos[(m * K + i) * 3 + 2]; }
      const ci = pos.length / 3; pos.push(cx / K, cy / K, cz / K);
      for (let i = 0; i < K; i++) { const a = m * K + i, b = m * K + (i + 1) % K; rev ? idx.push(ci, b, a) : idx.push(ci, a, b); }
    };
    cap(0, true); cap(M - 1, false);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    return mesh;
  }

  // recessed dark cockpit tub + the transmissive canopy (a DIRECT group child) + optional roll hoop
  function buildCanopy(group, canopy, L, mats) {
    const cz = canopy.z * L, cy = canopy.y;
    const tub = _mesh(_sph(1, 16, 10), new THREE.MeshStandardMaterial({ color: 0x09090d, metalness: 0.3, roughness: 0.7 }));
    tub.scale.set(0.34, 0.16, 0.7 * L);
    tub.position.set(0, cy - 0.12, cz);
    group.add(tub);
    const cp = _mesh(_sph(1, 18, 12), mats.cockpitMat);
    cp.scale.set(canopy.scale[0], canopy.scale[1], canopy.scale[2] * L);
    cp.position.set(0, cy, cz);
    group.add(cp);
    if (canopy.kind === 'speedster') {
      const hoop = _mesh(_tor(0.13, 0.02, 8, 18), mats.carbon);
      hoop.rotation.x = Math.PI / 2 - 0.15;
      hoop.position.set(0, cy + 0.05, cz - 0.18);
      group.add(hoop);
    }
  }

  // wheel-style registry — each adds its face elements to the spin group (tyre/disc/hub are common)
  DD.CAR_WHEEL_BUILDERS = {
    multiSpoke(spin, r, side, M, discMat) {
      for (let k = 0; k < 5; k++) {
        const sp = _mesh(_box(0.024, r * 1.55, 0.024), discMat);
        sp.rotation.z = (k / 5) * Math.PI; sp.position.set(side * 0.06, 0, 0); spin.add(sp);
      }
      const blade = _mesh(_box(0.04, r * 1.3, 0.03), M.glowMat(M.grad.a, 0.95));
      blade.position.set(side * 0.12, r * 0.18, 0); spin.add(blade);
      // glowing rim ring (concept sheet: "Rims: glowing / emissive accent color")
      const rim = _mesh(_tor(r * 0.72, 0.018, 6, 24), M.glowMat(M.grad.b, 0.8));
      rim.rotation.y = Math.PI / 2; rim.position.set(side * 0.10, 0, 0); spin.add(rim);
    },
    turbofan(spin, r, side, M) {
      const ring = _mesh(_tor(r * 0.5, 0.02, 6, 24), M.glowMat(M.grad.b, 0.9));
      ring.rotation.y = Math.PI / 2; ring.position.set(side * 0.16, 0, 0); spin.add(ring);
      const blade = _mesh(_box(0.05, r * 1.1, 0.02), M.glowMat(M.grad.a, 0.7));
      blade.position.set(side * 0.14, r * 0.2, 0); spin.add(blade);
    },
    glowDisc(spin, r, side, M) {
      const core = _mesh(_cyl(r * 0.38, r * 0.38, 0.14, 16), M.glowMat(M.grad.a, 0.95));
      core.rotation.z = Math.PI / 2; core.position.set(side * 0.12, 0, 0); spin.add(core);
      const ring = _mesh(_tor(r * 0.65, 0.03, 6, 24), M.glowMat(M.grad.b, 0.9));
      ring.rotation.y = Math.PI / 2; ring.position.set(side * 0.14, 0, 0); spin.add(ring);
    },
    classicSpoke(spin, r, side, M, discMat) {
      for (let k = 0; k < 6; k++) {
        const sp = _mesh(_box(0.016, r * 1.62, 0.016), M.chrome);
        sp.rotation.z = (k / 6) * Math.PI; sp.position.set(side * 0.05, 0, 0); spin.add(sp);
      }
      const cap = _mesh(_cyl(r * 0.18, r * 0.18, 0.1, 12), M.glowMat(M.grad.a, 0.85));
      cap.rotation.z = Math.PI / 2; cap.position.set(side * 0.1, 0, 0); spin.add(cap);
      // subtler vintage rim glow — keeps the chrome identity but reads at dusk
      const rim = _mesh(_tor(r * 0.66, 0.014, 6, 24), M.glowMat(M.grad.b, 0.55));
      rim.rotation.y = Math.PI / 2; rim.position.set(side * 0.08, 0, 0); spin.add(rim);
    }
  };

  function buildWheels(group, hp, L, style, mats, ghost, envMap) {
    const tyreMat = new THREE.MeshStandardMaterial({ color: 0x0d0d12, metalness: 0.0, roughness: 0.85, transparent: ghost, opacity: ghost ? 0.3 : 1 });
    const discMat = new THREE.MeshStandardMaterial({ color: 0x2b2c36, metalness: 1.0, roughness: 0.28, envMapIntensity: ghost ? 0.3 : 1.0, transparent: ghost, opacity: ghost ? 0.3 : 1, envMap: envMap || null });
    const tw = hp.tyreW;
    const defs = [[-hp.trackF, hp.frontZ * L, hp.frontR], [hp.trackF, hp.frontZ * L, hp.frontR], [-hp.trackR, hp.rearZ * L, hp.rearR], [hp.trackR, hp.rearZ * L, hp.rearR]];
    const styleFn = DD.CAR_WHEEL_BUILDERS[style] || DD.CAR_WHEEL_BUILDERS.multiSpoke;
    group.wheels = []; group.frontWheels = [];
    defs.forEach(([x, z, r], wi) => {
      const w = new THREE.Group(), spin = new THREE.Group(), side = Math.sign(x) || 1;
      const tyre = _mesh(_cyl(r, r, tw, 24), tyreMat); tyre.rotation.z = Math.PI / 2; spin.add(tyre);
      const disc = _mesh(_cyl(r * 0.82, r * 0.82, tw * 0.88, 24), discMat); disc.rotation.z = Math.PI / 2; disc.position.set(side * 0.04, 0, 0); spin.add(disc);
      const hub = _mesh(_cyl(r * 0.28, r * 0.40, tw * 1.18, 18), discMat); hub.rotation.z = Math.PI / 2; spin.add(hub);
      styleFn(spin, r, side, mats, discMat);
      w.add(spin); w.userData = { spinGroup: spin }; w.position.set(x, r, z);
      group.add(w); group.wheels.push(w);
      if (wi < 2) group.frontWheels.push(w);
      // suspension wishbones — bridge body sidewall → hub so wheels don't float
      const innerX = side * 0.40, hubX = x - side * 0.10, armLen = Math.abs(hubX - innerX) + 0.04;
      for (const [ay, dz] of [[r + 0.07, 0.18], [r - 0.10, -0.18]]) {
        const arm = _mesh(_box(armLen, 0.04, 0.05), mats.carbon);
        arm.position.set((innerX + hubX) / 2, ay, z + dz); arm.rotation.y = side * 0.16; group.add(arm);
      }
      const upright = _mesh(_box(0.05, 0.32, 0.05), mats.carbon);
      upright.position.set(hubX, r, z); group.add(upright);
    });
  }

  /* part catalog — each builder self-positions from chassis hardpoints (ctx.hp / ctx.L) and adds to
     ctx.group. A preset just lists part names; adding a new look = a new entry here (or, later, a
     player-authored block-data part). ctx.mats exposes the material slots. */
  DD.CAR_PARTS = {
    frontWing(ctx) {
      const g = ctx.group, L = ctx.L, M = ctx.mats, z = 2.4 * L;
      const w1 = _mesh(_box(1.5, 0.03, 0.34), M.bodyMat(M.gradMix(1.0), 0)); w1.position.set(0, 0.13, z); w1.rotation.x = 0.10; g.add(w1);
      const w2 = _mesh(_box(1.5, 0.02, 0.22), M.bodyMat(M.gradMix(0.85), 0)); w2.position.set(0, 0.20, z + 0.05); w2.rotation.x = 0.16; g.add(w2);
      for (const sx of [-1, 1]) { const ep = _mesh(_box(0.03, 0.18, 0.42), M.bodyMat(M.gradMix(0.1), 0)); ep.position.set(sx * 0.75, 0.16, z); g.add(ep); }
    },
    rearWingBiplane(ctx) {
      const g = ctx.group, L = ctx.L, M = ctx.mats, rwY = 0.9, rwZ = -2.15 * L, ww = 1.55;
      const rw1 = _mesh(_box(ww, 0.03, 0.36), M.bodyMat(M.gradMix(1.0), 0)); rw1.position.set(0, rwY, rwZ); rw1.rotation.x = -0.12; g.add(rw1);
      const rw2 = _mesh(_box(ww, 0.02, 0.24), M.bodyMat(M.gradMix(0.9), 0)); rw2.position.set(0, rwY + 0.12, rwZ - 0.05); rw2.rotation.x = -0.18; g.add(rw2);
      const pylon = _mesh(_box(0.09, 0.82, 0.2), M.carbon); pylon.position.set(0, rwY - 0.42, rwZ + 0.05); g.add(pylon);
      for (const sx of [-1, 1]) { const ep = _mesh(_box(0.04, 0.36, 0.44), M.bodyMat(M.gradMix(0.1), 0)); ep.position.set(sx * ww / 2, rwY - 0.04, rwZ); g.add(ep); }
      const bar = _mesh(_box(ww * 0.8, 0.04, 0.04), M.glowMat(M.grad.a, 0.95)); bar.position.set(0, rwY - 0.03, rwZ - 0.2); g.add(bar);
    },
    rearSpoilerLow(ctx) {
      const g = ctx.group, L = ctx.L, M = ctx.mats, rwZ = -2.15 * L, ww = 1.55;
      const sp = _mesh(_box(ww, 0.04, 0.38), M.bodyMat(M.gradMix(1.0), 0)); sp.position.set(0, 0.55, rwZ); sp.rotation.x = -0.06; g.add(sp);
      for (const sx of [-1, 1]) { const ep = _mesh(_box(0.03, 0.28, 0.44), M.bodyMat(M.gradMix(0.15), 0)); ep.position.set(sx * ww / 2, 0.47, rwZ); g.add(ep); }
      const bar = _mesh(_box(ww * 0.8, 0.04, 0.04), M.glowMat(M.grad.a, 0.95)); bar.position.set(0, 0.53, rwZ - 0.18); g.add(bar);
    },
    hoverFins(ctx) {
      const g = ctx.group, L = ctx.L, M = ctx.mats, rwZ = -2.0 * L;
      for (const sx of [-1, 1]) {
        const wl = _mesh(_box(0.48, 0.04, 0.34), M.bodyMat(M.gradMix(0.95), 0)); wl.position.set(sx * 0.56, 0.70, rwZ); wl.rotation.x = -0.15; wl.rotation.y = sx * 0.1; g.add(wl);
        const ep = _mesh(_box(0.03, 0.22, 0.38), M.bodyMat(M.gradMix(0.1), 0)); ep.position.set(sx * 0.80, 0.64, rwZ); g.add(ep);
        const py = _mesh(_box(0.04, 0.32, 0.12), M.carbon); py.position.set(sx * 0.56, 0.54, rwZ); g.add(py);
        const bar = _mesh(_box(0.38, 0.03, 0.03), M.glowMat(M.grad.a, 0.95)); bar.position.set(sx * 0.56, 0.68, rwZ - 0.16); g.add(bar);
      }
    },
    splitter(ctx) {
      const g = ctx.group, L = ctx.L, M = ctx.mats;
      const fs = _mesh(_box(1.7, 0.05, 0.5), M.bodyMat(M.gradMix(0.1), 0)); fs.position.set(0, 0.12, 2.5 * L); g.add(fs);
    },
    splitterGlow(ctx) {
      const g = ctx.group, L = ctx.L, M = ctx.mats;
      const fs = _mesh(_box(1.8, 0.07, 0.5), M.bodyMat(M.gradMix(0.1), 0)); fs.position.set(0, 0.12, 2.5 * L); g.add(fs);
      const edge = _mesh(_box(1.7, 0.03, 0.05), M.glowMat(M.grad.b, 0.95)); edge.position.set(0, 0.12, 2.74 * L); g.add(edge);
    },
    halo(ctx) {
      const g = ctx.group, L = ctx.L, M = ctx.mats, z = 0.25 * L;
      const halo = _mesh(_tor(0.18, 0.022, 8, 24), M.carbon); halo.rotation.x = Math.PI / 2 - 0.2; halo.position.set(0, 0.54, z); g.add(halo);
      const sf = _mesh(_box(0.024, 0.22, 0.024), M.carbon); sf.position.set(0, 0.44, z + 0.15); sf.rotation.x = 0.5; g.add(sf);
      for (const sx of [-1, 1]) { const sr = _mesh(_box(0.02, 0.20, 0.02), M.carbon); sr.position.set(sx * 0.16, 0.42, z - 0.10); sr.rotation.z = -sx * 0.4; g.add(sr); }
    },
    sharkFin(ctx) {
      const g = ctx.group, L = ctx.L, M = ctx.mats;
      const fin = _mesh(_box(0.03, 0.42, 1.4 * L), M.bodyMat(M.gradMix(0.85), 0)); fin.position.set(0, 0.65, -0.6 * L); g.add(fin);
    },
    diffuser(ctx) {
      const g = ctx.group, L = ctx.L, M = ctx.mats;
      const d = _mesh(_box(0.9, 0.06, 0.5), M.carbon); d.position.set(0, 0.10, -2.0 * L); d.rotation.x = 0.18; g.add(d);
      const bar = _mesh(_box(0.8, 0.02, 0.03), M.glowMat(M.grad.a, 0.8)); bar.position.set(0, 0.08, -2.2 * L); g.add(bar);
    },
    exhausts(ctx) {
      const g = ctx.group, L = ctx.L, M = ctx.mats;
      for (const sx of [-1, 1]) { const pipe = _mesh(_cyl(0.05, 0.05, 0.7, 10), M.chrome); pipe.rotation.z = Math.PI / 2; pipe.rotation.y = sx * 0.12; pipe.position.set(sx * 0.34, 0.22, -0.9 * L); g.add(pipe); }
    },
    exposedEngine(ctx) {
      const g = ctx.group, L = ctx.L, M = ctx.mats;
      const block = _mesh(_box(0.5, 0.22, 0.4), _stdMat(0x3a3a44, 0.9, 0.4, ctx.envMap)); block.position.set(0, 0.34, -0.55 * L); g.add(block);
      for (let i = -1; i <= 1; i++) { const cy = _mesh(_cyl(0.05, 0.05, 0.16, 10), M.chrome); cy.position.set(i * 0.14, 0.50, -0.55 * L); g.add(cy); }
    },
    hoverChannels(ctx) {
      const g = ctx.group, L = ctx.L, M = ctx.mats;
      for (const sx of [-1, 1]) { const ch = _mesh(_box(0.04, 0.06, 1.4 * L), M.glowMat(M.grad.b, 0.85)); ch.position.set(sx * 0.62, 0.30, 0); g.add(ch); }
    },
    glowCore(ctx) {
      const g = ctx.group, L = ctx.L, M = ctx.mats;
      const noz = _mesh(_cyl(0.18, 0.22, 0.42, 16), M.carbon); noz.rotation.x = Math.PI / 2; noz.position.set(0, 0.22, -2.0 * L); g.add(noz);
      const core = _mesh(_sph(0.12, 12, 8), M.glowMat(M.grad.b, 1.0)); core.position.set(0, 0.22, -2.1 * L); g.add(core);
      g.userData.thrusterGlow = core;
    },
    ducktail(ctx) {
      const g = ctx.group, L = ctx.L, M = ctx.mats;
      const dt = _mesh(_box(0.7, 0.05, 0.3), M.bodyMat(M.gradMix(0.6), 0)); dt.position.set(0, 0.40, -1.7 * L); dt.rotation.x = -0.2; g.add(dt);
    },
    chromeTrim(ctx) {
      const g = ctx.group, L = ctx.L, M = ctx.mats;
      for (const sx of [-1, 1]) { const tr = _mesh(_box(0.02, 0.03, 2.4 * L), M.chrome); tr.position.set(sx * 0.36, 0.30, 0); g.add(tr); }
    },
    lightBar(ctx) {
      // concept sheet: "thin emissive light bar on the car" — one glow seam per flank, the car's
      // neon identity at dusk. Knobs place it half-embedded in the widest hull band (a seam that
      // touches always reads right; a floating bar reads like a bug): x/y = seam position,
      // z (in L units) = centre, len (in L units) = length.
      const g = ctx.group, L = ctx.L, M = ctx.mats, k = ctx.knobs || {};
      const x = k.x != null ? k.x : 0.70, y = k.y != null ? k.y : 0.28;
      const len = (k.len != null ? k.len : 1.3) * L, z = (k.z != null ? k.z : -0.4) * L;
      for (const sx of [-1, 1]) {
        const bar = _mesh(_box(0.025, 0.035, len), M.glowMat(M.grad.a, k.i != null ? k.i : 0.9));
        bar.position.set(sx * x, y, z);
        g.add(bar);
      }
    }
  };

  /* The pure, deterministic spec → THREE.Group renderer. Honors the full §1 contract. */
  DD.buildCarFromSpec = function (spec, ctxIn) {
    ctxIn = ctxIn || {};
    spec = DD.normalizeSpec(spec);
    const ghost = ctxIn.ghost, envMap = ctxIn.envMap;
    const garage = ctxIn.garage || { grad: spec.gallery.grad, finish: spec.gallery.finish, form: 0 };
    const mats = makeCarMaterials(garage, ghost, envMap, spec.palette);
    const group = new THREE.Group();
    const hp = spec.chassis.hardpoints, L = spec.chassis.L;

    const hullMat = mats.bodyMat(mats.gradMix(0.5), 0);
    const hullMesh = buildHull(spec.chassis.hull, hp, L, hullMat);
    group.add(hullMesh);
    group.userData.hullMesh = hullMesh; // editor hook: DD.updateHullGeometry swaps just this mesh's geometry

    if (spec.chassis.floor) {
      const f = spec.chassis.floor;
      const floorMesh = _mesh(_box(f.w, f.h, 3.3 * L), mats.carbon);
      floorMesh.position.set(0, 0.045, f.z);
      group.add(floorMesh);
    }

    buildCanopy(group, spec.canopy, L, mats);
    buildWheels(group, hp, L, spec.wheelStyle, mats, ghost, envMap);

    const partCtx = { group: group, mats: mats, hp: hp, L: L, ghost: ghost, envMap: envMap, knobs: null };
    for (const m of spec.mounts) {
      const fn = DD.CAR_PARTS[m.part];
      if (fn) { partCtx.knobs = m.knobs || {}; fn(partCtx); }
    }

    // contract: boost-glow / iridescent / trail read these off the HULL material
    group.userData.iridescent = mats.finish === 'Iridescent' ? hullMat : null;
    group.userData.boostShell = hullMat;
    const _be = hullMat.emissive;
    group.userData.baseEmis = (_be && _be.clone) ? _be.clone() : null;
    group.userData.baseEmisI = hullMat.emissiveIntensity || 0;
    group.userData.grad = mats.grad;
    group.userData.L = L;
    group.userData.hardpoints = hp; // for the (P2) spec-driven shadow

    if (!ghost) {
      const setShadows = (obj) => {
        if (obj.geometry) { obj.castShadow = true; obj.receiveShadow = true; }
        if (obj.children) { for (let i = 0; i < obj.children.length; i++) setShadows(obj.children[i]); }
      };
      setShadows(group);
    }
    return group;
  };

  // thin wrapper: resolve the CarSpec for this garage selection, then render it
  DD.buildCar = function (garage, ghost, envMap) {
    return DD.buildCarFromSpec(DD.resolveSpec(garage), { ghost: ghost, envMap: envMap, garage: garage });
  };

  /* garage editor — Length-rings mode (P2 slice A): one grabbable handle per hull station, at its
     rightmost ring point. Mirrors buildHull's math exactly so a handle always sits on the surface it
     controls. Editor-only — never built for the race car, never touches the physics/contract. */
  function hullStationLocalPos(hull, hp, L, stationIndex) {
    const st = hull.station[stationIndex]; if (!st) return null;
    const frontZ = hp.frontZ * L, rearZ = hp.rearZ * L;
    const wheelbase = frontZ - rearZ, midZ = (frontZ + rearZ) / 2;
    const WIDTH = 1.18, HEIGHT = 0.92, YB = 0.05;
    const hw = Math.min(st[1], hull.fenderClamp) * WIDTH;
    const yc = YB + st[3] * HEIGHT;
    const wz = st[0] * wheelbase + midZ;
    return [hw, yc, wz];
  }

  DD.buildEditHandles = function (spec) {
    spec = DD.normalizeSpec(spec);
    const hp = spec.chassis.hardpoints, L = spec.chassis.L, hull = spec.chassis.hull;
    const mat = new THREE.MeshBasicMaterial({ color: 0xffe66d, depthTest: false });
    const group = new THREE.Group();
    hull.station.forEach(function (st, i) {
      const p = hullStationLocalPos(hull, hp, L, i);
      const handle = new THREE.Mesh(new THREE.SphereGeometry(0.055, 12, 8), mat);
      handle.position.set(p[0], p[1], p[2]);
      handle.userData = { stationIndex: i };
      handle.renderOrder = 999;
      group.add(handle);
    });
    return group;
  };

  // Reposition existing handle spheres in place (no dispose/rebuild) — used every drag frame.
  DD.updateEditHandlePositions = function (handleGroup, spec) {
    spec = DD.normalizeSpec(spec);
    const hp = spec.chassis.hardpoints, L = spec.chassis.L, hull = spec.chassis.hull;
    handleGroup.children.forEach(function (h) {
      const p = hullStationLocalPos(hull, hp, L, h.userData.stationIndex);
      if (p) h.position.set(p[0], p[1], p[2]);
    });
  };

  // Swap just the hull mesh's geometry — cheap live preview while dragging a ring. Nothing else in
  // the car (wheels/canopy/wings/parts) ever depends on hull station data, so this is fully authoritative
  // for a width/height edit; no full DD.buildCarFromSpec rebuild is needed mid-drag.
  DD.updateHullGeometry = function (carMesh, spec) {
    const hullMesh = carMesh.userData.hullMesh; if (!hullMesh) return;
    spec = DD.normalizeSpec(spec);
    const hp = spec.chassis.hardpoints, L = spec.chassis.L;
    const fresh = buildHull(spec.chassis.hull, hp, L, hullMesh.material);
    hullMesh.geometry.dispose();
    hullMesh.geometry = fresh.geometry;
  };

  /* Garage stage — a dedicated platform for the showcase car so it doesn't look parked in the middle
     of the actual raceway (the gate arches get hidden alongside this in the garage loop branch).
     Sky/mountains/stars/decor are untouched — only the immediate ground + start-gate props swap out,
     which is what keeps the surrounding world/theme intact while giving the car its own stage. */
  DD.buildGarageStage = function (envMap, theme) {
    const W = 7, D = 10, H = 0.3;
    const carbonTex = getCarbonTexture();
    // calm sheen: the original glossy clearcoat threw two huge white specular blobs that
    // washed out the car it's supposed to present
    const mat = new THREE.MeshPhysicalMaterial({
      color: 0xffffff, map: carbonTex, metalness: 0.2, roughness: 0.62,
      bumpMap: carbonTex, bumpScale: 0.05, clearcoat: 0.45, clearcoatRoughness: 0.3,
      envMapIntensity: 0.45, envMap: envMap || null
    });
    const stage = new THREE.Mesh(new THREE.BoxGeometry(W, H, D), mat);
    stage.receiveShadow = true;
    const rimColor = (theme && theme.accent) ? col(theme.accent) : [0.62, 0.48, 1.0];
    const rim = new THREE.Mesh(new THREE.BoxGeometry(W + 0.06, 0.03, D + 0.06),
      new THREE.MeshBasicMaterial({ color: col(rimColor), transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }));
    rim.position.y = -H / 2;
    stage.add(rim);
    return stage;
  };

  /* trail */
  DD.buildTrail = function (color) {
    const N = 40;
    const pos = new Float32Array(N * 2 * 3);
    const cols = new Float32Array(N * 2 * 3);
    const idx = [];
    for (let i = 0; i < N - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    geo.setIndex(idx);
    const mat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    mesh.userData = { N, head: 0, pts: [], color };
    return mesh;
  };

  DD.updateTrail = function (trail, car, track, speedNorm) {
    const ud = trail.userData;
    const s = track.samples[Math.min(car.idx, track.samples.length - 1)];
    const fwd = [Math.sin(car.yaw), 0, Math.cos(car.yaw)];
    const right = V.norm(V.cross(s.u, fwd));
    const back = V.addS(V.addS(car.pos, fwd, -1.4), s.u, 0.15);
    ud.pts.unshift({ l: V.addS(back, right, -0.95), r: V.addS(back, right, 0.95) });
    if (ud.pts.length > ud.N) ud.pts.pop();
    const pos = trail.geometry.attributes.position.array;
    const cols = trail.geometry.attributes.color.array;
    const c = ud.color;
    
    // Blazing "light trail" on drift, very faint speed tail otherwise (levels in DD.GLOW)
    const isDrifting = car.sliding && car.slideState;
    const intensity = isDrifting ? DD.GLOW.skid.drift : DD.GLOW.skid.straight * speedNorm;
    
    for (let i = 0; i < ud.N; i++) {
      const p = ud.pts[Math.min(i, ud.pts.length - 1)] || { l: back, r: back };
      pos.set(p.l, i * 6); pos.set(p.r, i * 6 + 3);
      const fade = Math.max(0, 1 - i / ud.N) * intensity;
      cols[i * 6] = c.a[0] * fade; cols[i * 6 + 1] = c.a[1] * fade; cols[i * 6 + 2] = c.a[2] * fade;
      cols[i * 6 + 3] = c.b[0] * fade; cols[i * 6 + 4] = c.b[1] * fade; cols[i * 6 + 5] = c.b[2] * fade;
    }
    trail.geometry.attributes.position.needsUpdate = true;
    trail.geometry.attributes.color.needsUpdate = true;
  };

  /* car pose from physics state */
  const _m4 = null;
  DD.poseCar = function (group, pos, yaw, u, rollVis, pitchVis, wheelSpin, steerVis, bob) {
    const b = bob || 0;
    group.position.set(pos[0] + u[0] * b, pos[1] + u[1] * b, pos[2] + u[2] * b);
    // basis: up = u, fwd = yaw dir projected
    const f0 = [Math.sin(yaw), 0, Math.cos(yaw)];
    const d = V.dot(f0, u);
    const f = V.norm(V.addS(f0, u, -d));
    const r = V.norm(V.cross(u, f));
    const m = new THREE.Matrix4();
    m.makeBasis(new THREE.Vector3(r[0], r[1], r[2]), new THREE.Vector3(u[0], u[1], u[2]), new THREE.Vector3(f[0], f[1], f[2]));
    group.quaternion.setFromRotationMatrix(m);
    // roll/pitch flair
    group.rotateZ(rollVis || 0);
    group.rotateX(pitchVis || 0);
    if (group.wheels) {
      for (const w of group.wheels) {
        if (w.userData && w.userData.spinGroup) {
          w.userData.spinGroup.rotation.x += wheelSpin;
        } else {
          w.children[0].rotation.x += wheelSpin;
        }
      }
    }
    if (group.frontWheels) for (const w of group.frontWheels) w.rotation.y = (steerVis || 0) * 1.1; // steerVis = real wheel angle (rad)

    // Dynamic thruster glow scaling for Vanguard jet speedster
    if (group.userData && group.userData.thrusterGlow) {
      const spdFactor = Math.abs(wheelSpin) * 15.0; // proxy for speed based on rotation delta
      const thrusterScale = 0.4 + Math.min(spdFactor * 0.8, 2.8); // 0.4 idle up to ~3.2 at high speed
      group.userData.thrusterGlow.scale.set(1.0 + Math.min(spdFactor * 0.15, 0.4), 1.0 + Math.min(spdFactor * 0.15, 0.4), thrusterScale);
      // Offset slightly back along Z coordinate relative to scaling
      group.userData.thrusterGlow.position.z = -1.98 * (group.userData.L || 1.0) - (thrusterScale - 0.4) * 0.12;
    }
  };

  /* contact shadow — soft blob that grounds the car (huge readability/quality win) */
  DD.buildShadow = function () {
    const geo = new THREE.PlaneGeometry(4.2, 6.2);
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: {
        opacity: { value: 0.9 }
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        varying vec2 vUv;
        uniform float opacity;
        float sdBox(vec2 p, vec2 b) {
          vec2 d = abs(p) - b;
          return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
        }
        void main() {
          vec2 p = (vUv - vec2(0.5)) * vec2(4.2, 6.2);
          float dBody = sdBox(p, vec2(0.8, 1.8));
          float shadowBody = smoothstep(1.5, -0.6, dBody) * 0.5;
          float dFL = sdBox(p - vec2(-0.86, 1.5), vec2(0.18, 0.35));
          float dFR = sdBox(p - vec2(0.86, 1.5), vec2(0.18, 0.35));
          float dRL = sdBox(p - vec2(-0.9, -1.35), vec2(0.20, 0.42));
          float dRR = sdBox(p - vec2(0.9, -1.35), vec2(0.20, 0.42));
          float shadowFL = smoothstep(0.4, -0.1, dFL) * 0.85;
          float shadowFR = smoothstep(0.4, -0.1, dFR) * 0.85;
          float shadowRL = smoothstep(0.4, -0.1, dRL) * 0.85;
          float shadowRR = smoothstep(0.4, -0.1, dRR) * 0.85;
          float totalShadow = clamp(shadowBody + shadowFL + shadowFR + shadowRL + shadowRR, 0.0, 0.95);
          gl_FragColor = vec4(0.0, 0.0, 0.0, totalShadow * opacity);
        }
      `
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false; mesh.renderOrder = 1;
    return mesh;
  };
  DD.updateShadow = function (shadow, pos, u, yaw, car, track) {
    if (!shadow) return;

    let groundY = pos[1];
    let groundNormal = u;

    // Find the vertical projection of the car onto the track ribbon:
    const s = track.samples[Math.min(car.idx, track.samples.length - 1)];
    const yRibbon = s.p[1] - ((pos[0] - s.p[0]) * s.u[0] + (pos[2] - s.p[2]) * s.u[2]) / s.u[1];
    const rel = [pos[0] - s.p[0], yRibbon - s.p[1], pos[2] - s.p[2]];
    const lat = rel[0] * s.r[0] + rel[1] * s.r[1] + rel[2] * s.r[2];
    const halfW = s.w / 2 + 1.5;

    if (Math.abs(s.u[1]) > 0.05 && Math.abs(lat) <= halfW) {
      groundY = yRibbon;
      groundNormal = s.u;
    } else if (track.terrain) {
      groundY = DD.terrainAt(track.terrain, pos[0], pos[2]);
      groundNormal = DD.terrainNormal(track.terrain, pos[0], pos[2]);
    }

    // Calculate the height of the car above projected ground:
    const h = pos[1] - groundY;
    const opacityFactor = Math.max(0, 1 - h / 12);

    // Set shadow position:
    shadow.position.set(pos[0] + groundNormal[0] * 0.02, groundY + groundNormal[1] * 0.02, pos[2] + groundNormal[2] * 0.02);

    // Apply basis/rotation based on groundNormal and yaw:
    const f0 = [Math.sin(yaw), 0, Math.cos(yaw)];
    const d = V.dot(f0, groundNormal);
    const f = V.norm(V.addS(f0, groundNormal, -d));
    const r = V.norm(V.cross(groundNormal, f));
    const m = new THREE.Matrix4();
    m.makeBasis(new THREE.Vector3(r[0], r[1], r[2]), new THREE.Vector3(groundNormal[0], groundNormal[1], groundNormal[2]), new THREE.Vector3(f[0], f[1], f[2]));
    shadow.quaternion.setFromRotationMatrix(m);
    shadow.rotateX(-Math.PI / 2);

    // Set shadow scale to 1.0 + (h / 12) * 0.6:
    const scale = 1.0 + (h / 12) * 0.6;
    shadow.scale.set(scale, scale, 1);

    // Set shadow visibility:
    shadow.visible = opacityFactor > 0.01;
    if (shadow.visible) {
      shadow.material.uniforms.opacity.value = 0.9 * opacityFactor;
    }
  };

  /* chase camera */
  // Framing profiles. `close` = the concept sheet's "camera just behind and slightly above the
  // car" (hero presence); `classic` = the original farther/higher frame. game.js sets
  // DD.cameraProfile from settings; the module default keeps headless tests on the old numbers.
  DD.CAM_PROFILES = {
    classic: { dist0: 7.4, distV: 2.0, h0: 2.45, hV: 0.45, look: 11, fov0: 63, fovV: 34 },
    close:   { dist0: 6.0, distV: 1.6, h0: 1.90, hV: 0.40, look: 10, fov0: 64, fovV: 32 }
  };
  DD.cameraProfile = 'classic';
  DD.makeCamState = () => ({ pos: [0, 5, -10], look: [0, 0, 0], fov: 68, shake: [0, 0, 0], prevGrounded: true, prevVelY: 0 });
  DD.updateCamera = function (camera, camState, car, track, dt, speed) {
    const s = track.samples[Math.min(car.idx, track.samples.length - 1)];
    const up = s.u;
    const f0 = [Math.sin(car.yaw), 0, Math.cos(car.yaw)];
    const d = V.dot(f0, up);
    const f = V.norm(V.addS(f0, up, -d));   // nose direction, projected onto the surface plane
    const sv = DD.clamp(speed / DD.PHYS.vmax, 0, 1);

    // Follow direction: blend the nose toward the actual travel (velocity) direction by how far the
    // car is sliding, so during a drift the camera trails where you're GOING rather than where the
    // nose points. Pure function of car.vel — no Math.random, stays deterministic.
    let follow = f;
    const vel = car.vel || [0, 0, 0];
    const vproj = V.addS(vel, up, -V.dot(vel, up)); // velocity projected onto the surface plane
    const vmag = V.len(vproj);
    if (vmag > 4) {
      const velDir = V.norm(vproj);
      if (V.dot(f, velDir) > 0.1) { // only when moving roughly forward (don't flip when reversing)
        const slipAng = Math.acos(DD.clamp(V.dot(f, velDir), -1, 1));
        const blend = DD.clamp(slipAng / 0.7, 0, 1) * 0.6; // up to 60% toward travel at ~40° of slip
        follow = V.norm(V.lerp(f, velDir, blend));
      }
    }

    const CP = DD.CAM_PROFILES[DD.cameraProfile] || DD.CAM_PROFILES.classic;
    const dist = CP.dist0 + sv * CP.distV;
    const targetPos = V.addS(V.addS(car.pos, follow, -dist), up, CP.h0 + sv * CP.hV);
    const targetLook = V.addS(V.addS(car.pos, follow, CP.look), up, 1.0);
    const kp = 1 - Math.exp(-10 * dt), kl = 1 - Math.exp(-16 * dt);
    camState.pos = V.lerp(camState.pos, targetPos, kp);
    camState.look = V.lerp(camState.look, targetLook, kl);

    // Impulses: a quick decaying positional kick the camera used to ignore. Down along the surface
    // normal on a hard landing, back along travel on a wall hit. Directions are deterministic (no
    // random), so golden screenshots remain reproducible.
    if (!camState.shake) camState.shake = [0, 0, 0];
    const landed = camState.prevGrounded === false && car.grounded;
    const fallSpeed = Math.max(0, -(camState.prevVelY || 0)); // downward speed just before touchdown
    if (landed && fallSpeed > 2) {
      camState.shake = V.addS(camState.shake, up, -0.6 * DD.clamp(fallSpeed / 22, 0, 1));
    }
    if (car.hitWall) {
      camState.shake = V.addS(camState.shake, (vmag > 1 ? V.norm(vproj) : f), -0.7);
    }
    camState.prevGrounded = car.grounded;
    camState.prevVelY = vel[1];

    const finalPos = V.add(camState.pos, camState.shake);
    camState.shake = V.scale(camState.shake, Math.exp(-dt * 11)); // settle back to rest

    camera.position.set(finalPos[0], finalPos[1], finalPos[2]);
    camera.up.set(DD.lerp(0, up[0], 0.55), 1, DD.lerp(0, up[2], 0.55));
    camera.lookAt(camState.look[0], camState.look[1], camState.look[2]);
    // FOV widens with speed (with a subtle non-linear speed-creep above 75% speed), a touch more while sliding, plus a punch on boost pads (speed rush).
    const targetFov = CP.fov0 + sv * CP.fovV + (sv > 0.75 ? Math.pow(sv - 0.75, 1.5) * 20 : 0) + (car.sliding ? 3 : 0) + (car.boostGlow || 0) * 7;
    camState.fov = DD.dampTo(camState.fov, targetFov, 6, dt);
    camera.fov = camState.fov;
    camera.updateProjectionMatrix();

    if (track) {
      if (track.skyMesh) track.skyMesh.position.copy(camera.position);
      if (track.starsMesh) track.starsMesh.position.copy(camera.position);
      // planet + nebulae are sky furniture too: follow the camera so they stay celestial
      // backdrop instead of world objects you can drive toward (their child offsets keep the
      // apparent direction; group rotation in the loop = slow drift across the sky)
      if (track.planetMesh) track.planetMesh.position.copy(camera.position);
      if (track.nebulaeMesh) track.nebulaeMesh.position.copy(camera.position);
      if (track.auroraMesh) {
        track.auroraMesh.position.copy(camera.position);
        if (track.auroraMaterials) {
          const speeds = DD.GLOW.aurora.scrollSpeed;
          for (let i = 0; i < track.auroraMaterials.length; i++) {
            const mat = track.auroraMaterials[i];
            if (mat && mat.map) {
              mat.map.offset.x += (speeds[i % speeds.length] || 0.02) * dt;
            }
          }
        }
      }

      const theme = track.theme;
      if (theme && DD.game && DD.game.scene) {
        const scene = DD.game.scene;
        const lookX = camState.look[0] - finalPos[0];
        const lookZ = camState.look[2] - finalPos[2];
        const lookLen = Math.sqrt(lookX * lookX + lookZ * lookZ) || 1;
        const camDirX = lookX / lookLen;
        const camDirZ = lookZ / lookLen;

        const sunAngle = theme.lightAngle;
        const sunDirX = Math.sin(sunAngle);
        const sunDirZ = Math.cos(sunAngle);
        const dot = camDirX * sunDirX + camDirZ * sunDirZ; // -1 to 1
        const t = (dot + 1) * 0.5; // 0 to 1

        const warmFog = V.scale(V.lerp(theme.fogColor, theme.sunColor, 0.45), 0.72);
        const coolFog = V.scale(V.lerp(theme.fogColor, theme.skyTop, 0.45), 0.72);
        const c = V.lerp(coolFog, warmFog, t);

        if (scene.fog && scene.fog.color) {
          if (scene.fog.color.setRGB) scene.fog.color.setRGB(c[0], c[1], c[2]);
          else { scene.fog.color.r = c[0]; scene.fog.color.g = c[1]; scene.fog.color.b = c[2]; }
        }
        if (scene.background) {
          if (scene.background.setRGB) scene.background.setRGB(c[0], c[1], c[2]);
          else { scene.background.r = c[0]; scene.background.g = c[1]; scene.background.b = c[2]; }
        }
      }
    }
  };

  /* speed particles */
  DD.buildSpeedLines = function (theme) {
    const n = 140;
    const pos = new Float32Array(n * 3);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const m = new THREE.PointsMaterial({ color: col(theme.accent), size: 0.3, map: getDotTexture(), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
    const pts = new THREE.Points(g, m);
    pts.frustumCulled = false;
    pts.userData = { seeded: false };
    return pts;
  };
  DD.updateSpeedLines = function (pts, camera, speedNorm) {
    const arr = pts.geometry.attributes.position.array;
    const n = arr.length / 3;
    const cp = camera.position;
    if (!pts.userData.seeded) {
      for (let i = 0; i < n; i++) {
        arr[i * 3] = cp.x + (Math.random() - 0.5) * 60;
        arr[i * 3 + 1] = cp.y + (Math.random() - 0.5) * 30;
        arr[i * 3 + 2] = cp.z + (Math.random() - 0.5) * 60;
      }
      pts.userData.seeded = true;
    }
    for (let i = 0; i < n; i++) {
      const dx = arr[i * 3] - cp.x, dy = arr[i * 3 + 1] - cp.y, dz = arr[i * 3 + 2] - cp.z;
      if (dx * dx + dy * dy + dz * dz > 3600) {
        // respawn ahead of camera
        const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
        arr[i * 3] = cp.x + dir.x * 50 + (Math.random() - 0.5) * 50;
        arr[i * 3 + 1] = cp.y + dir.y * 50 + (Math.random() - 0.5) * 24;
        arr[i * 3 + 2] = cp.z + dir.z * 50 + (Math.random() - 0.5) * 50;
      }
    }
    pts.geometry.attributes.position.needsUpdate = true;
    pts.material.opacity = Math.max(0, speedNorm - 0.3) * 1.1;
  };

  DD.disposeGroup = function (scene, group) {
    if (!group) return;
    scene.remove(group);
    group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) { (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m.dispose()); }
    });
  };

})(typeof window !== 'undefined' ? window : globalThis);
