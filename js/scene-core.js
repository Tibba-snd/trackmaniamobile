/* DRIFTDREAM scene core — WebGL/Three.js context setup, light pool, envMap, track orchestration, camera. */
(function (global) {
  'use strict';
  const DD = global.DD;
  const V = DD.v;

  const col = (c) => new THREE.Color(c[0], c[1], c[2]);

  // In-place vector helper functions for zero-alloc render path
  function ipSet(out, x, y, z) {
    out[0] = x; out[1] = y; out[2] = z;
    return out;
  }
  function ipSub(out, a, b) {
    out[0] = a[0] - b[0]; out[1] = a[1] - b[1]; out[2] = a[2] - b[2];
    return out;
  }
  function ipAddS(out, a, b, s) {
    out[0] = a[0] + b[0] * s; out[1] = a[1] + b[1] * s; out[2] = a[2] + b[2] * s;
    return out;
  }
  function ipDot(a, b) {
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  }
  function ipCross(out, a, b) {
    const ax = a[0], ay = a[1], az = a[2];
    const bx = b[0], by = b[1], bz = b[2];
    out[0] = ay * bz - az * by;
    out[1] = az * bx - ax * bz;
    out[2] = ax * by - ay * bx;
    return out;
  }
  function ipNorm(out, a) {
    const len = Math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]);
    if (len > 0) {
      out[0] = a[0] / len; out[1] = a[1] / len; out[2] = a[2] / len;
    } else {
      out[0] = 0; out[1] = 0; out[2] = 0;
    }
    return out;
  }

  // Export in-place vector helpers on DD namespace for other files
  DD._ipSet = ipSet;
  DD._ipSub = ipSub;
  DD._ipAddS = ipAddS;
  DD._ipDot = ipDot;
  DD._ipCross = ipCross;
  DD._ipNorm = ipNorm;

  // Initialize shared scene registry
  DD._sceneShared = {
    col: col
  };

  const camF0 = [0, 0, 0];
  const camTempF = [0, 0, 0];
  const camF = [0, 0, 0];
  const camVproj = [0, 0, 0];
  const camVelDir = [0, 0, 0];
  const camLerp = [0, 0, 0];
  const camFollow = [0, 0, 0];
  const camTargetPos = [0, 0, 0];
  const camTargetLook = [0, 0, 0];
  const camTemp1 = [0, 0, 0];
  const camTemp2 = [0, 0, 0];
  const camFinalPos = [0, 0, 0];

  function addLightSource(track, pos, color, intensity, distance) {
    (track._lightSources || (track._lightSources = [])).push({
      pos: [pos[0], pos[1], pos[2]],
      color: (color && color.clone) ? color.clone() : (color && color.r !== undefined ? { r: color.r, g: color.g, b: color.b } : color),
      intensity: intensity,
      distance: distance
    });
  }
  DD._sceneShared.addLightSource = addLightSource;

  // Core functions from scene.js
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
    // PERF: cap the device-pixel-ratio. Fill rate is the dominant cost, but the adaptive DPR
    // system (game.js) already steps down on frame drops — so the static cap only needs to set a
    // sane ceiling, not pre-emptively blur the image. 1.5 keeps edges crisp (FXAA cleans the rest)
    // and lets the adaptive system manage real under-load tradeoffs. The old 1.15 floor for 3x
    // panels was too aggressive — it pre-blurred screens that had headroom to spare.
    const _dpr = window.devicePixelRatio || 1;
    const _cap = quality === 'high' ? 1.5 : 1.25;
    renderer.setPixelRatio(Math.min(_dpr, _cap));
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

    // PERF (T1): MSAA disabled. FXAA is the final composer pass and does the AA; 4x MSAA on a
    // HalfFloat render target was ~1.5ms of pure fill for no visible gain once FXAA runs. So we
    // skip WebGLMultisampleRenderTarget and use a plain HalfFloat RT with samples:0 below.
    
    // Fallback 1: WebGLRenderTarget with HalfFloatType
    if (!rt) {
      try {
        rt = new THREE.WebGLRenderTarget(window.innerWidth, window.innerHeight, {
          type: THREE.HalfFloatType,
          minFilter: THREE.LinearFilter,
          magFilter: THREE.LinearFilter,
          format: THREE.RGBAFormat,
          samples: 0 // PERF (T1): no MSAA — FXAA handles AA
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
          samples: 0 // PERF (T1): no MSAA — FXAA handles AA
        });
      } catch (e) {
        console.error("[Composer Error] All render targets failed to initialize", e);
        return null;
      }
    }
    
    try {
      const composer = new THREE.EffectComposer(renderer, rt);

      // CRITICAL for sharpness: because we pass our own HDR render target, EffectComposer forces its
      // internal _pixelRatio to 1, so without this it renders the whole scene at CSS-pixel resolution
      // and upscales to the device-resolution canvas — everything (neon edges, geometry) looks soft
      // and jagged, and FXAA can't recover detail that was never rendered. Match the renderer's
      // (already DPR-capped) pixel ratio so the composer renders at the canvas's true resolution.
      composer.setPixelRatio(renderer.getPixelRatio());
      composer.setSize(window.innerWidth, window.innerHeight);
      composer.addPass(new THREE.RenderPass(scene, camera));
      // tuned centrally in DD.GLOW (theme.js) — strength is recomposed per-frame in game.js.
      // PERF (T1): bloom runs at half resolution (BLOOM_SCALE). Bloom is a wide blur, so half-res
      // is visually near-identical (marginally softer glow — fits the dreamy look) but ~1.2ms cheaper
      // on the dominant post cost. Keep game.js's resize handler in sync via composer._bloomScale.
      const BLOOM_SCALE = 0.5;
      const bloom = new THREE.UnrealBloomPass(
        new THREE.Vector2(Math.round(window.innerWidth * BLOOM_SCALE), Math.round(window.innerHeight * BLOOM_SCALE)),
        DD.GLOW.bloom.base, DD.GLOW.bloom.radius, DD.GLOW.bloom.threshold);
      composer.addPass(bloom);
      composer._bloom = bloom;
      composer._bloomScale = BLOOM_SCALE;
      // Radial speed blur — a cheap 6-tap zoom smear toward the focal point, strength driven by car
      // speed in game.js (0 below ~half speed, so its ~6 taps of fill only cost when you're actually
      // fast). Sits before FXAA so the streaks get cleaned up. Reads as a forward "rush" at top speed.
      if (THREE.ShaderPass) {
        const speedBlur = new THREE.ShaderPass({
          uniforms: { tDiffuse: { value: null }, uStrength: { value: 0 }, uCenter: { value: new THREE.Vector2(0.5, 0.52) } },
          vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
          fragmentShader: [
            'uniform sampler2D tDiffuse; uniform float uStrength; uniform vec2 uCenter; varying vec2 vUv;',
            'void main(){',
            '  if (uStrength <= 0.0) { gl_FragColor = texture2D(tDiffuse, vUv); return; }',
            '  vec2 dir = vUv - uCenter;',           // sampling toward centre = radial zoom streaks
            '  vec4 sum = vec4(0.0);',
            '  for (int i = 0; i < 6; i++) {',
            '    float t = float(i) / 5.0;',
            '    sum += texture2D(tDiffuse, vUv - dir * (t * uStrength));',
            '  }',
            '  gl_FragColor = sum / 6.0;',
            '}'
          ].join('\n')
        });
        composer.addPass(speedBlur);
        composer._speedBlur = speedBlur;
      }
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
      // Res 128: legible nebula/sky/terrain in the reflection. Rendered ONCE at load (static
      // furniture) so runtime cost ~0; PMREM roughness-blur below still softens for matte materials.
      const rt = new THREE.WebGLCubeRenderTarget(128, { generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter });
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

  // buildTrackScene (orchestrator)
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

    const sky = DD._sceneShared.buildSky(theme);
    root.add(sky);
    track.skyMesh = sky;
    // night sky: stars always present; density driven by theme.atmosphere/biome (see buildStars)
    {
      const stars = DD._sceneShared.buildStars(theme, rng);
      root.add(stars);
      track.starsMesh = stars;
    }
    root.add(DD._sceneShared.buildTerrain(track, theme));
    const grid = DD._sceneShared.buildTerrainGrid(track, theme);
    if (grid) root.add(grid);
    track.fireflies = DD._sceneShared.buildFireflies(track, theme, rng);
    root.add(track.fireflies);
    root.add(DD._sceneShared.buildRibbon(track, theme));
    { const body = DD._sceneShared.buildRoadBody(track, theme); if (body) root.add(body); }

    // edge glow strips — apron spans GAP the glow (the border opens = the invitation to leave)
    const edge = (side) => DD._sceneShared.buildStrip(track, theme,
      (s) => {
        if (s.gap) return null;
        if (s.apron && s.apron * side > 0 && Math.abs(s.apron) > 0.5) return null;
        const c = V.addS(V.addS(s.p, s.r, side * (s.w / 2 - 0.18)), s.u, DD.DECAL.edge);
        return [V.addS(c, s.r, -0.22 * side), V.addS(c, s.r, 0.22 * side)];
      }, theme.accent, 0.9, THREE.AdditiveBlending);
    root.add(edge(1)); root.add(edge(-1));

    // secondary outer rail line in accent2 — a thin glow just outside the main edge, giving the
    // border a layered two-tone neon look instead of a single line.
    const rail2 = (side) => DD._sceneShared.buildStrip(track, theme,
      (s) => {
        if (s.gap) return null;
        if (s.apron && s.apron * side > 0 && Math.abs(s.apron) > 0.5) return null;
        const c = V.addS(V.addS(s.p, s.r, side * (s.w / 2 + 0.34)), s.u, DD.DECAL.rail2);
        return [V.addS(c, s.r, -0.1 * side), V.addS(c, s.r, 0.1 * side)];
      }, theme.accent2, 0.6, THREE.AdditiveBlending);
    { const a = rail2(1), b = rail2(-1); if (a) root.add(a); if (b) root.add(b); }

    // biome-coloured corner kerbs (rumble strips on the apex edges)
    const kerbs = DD._sceneShared.buildKerbs(track, theme);
    if (kerbs) root.add(kerbs);

    // re-entry apron wedges (masterplan 2.1) — faint glow ramps onto the flush terrain
    { const aprons = DD._sceneShared.buildAprons(track, theme); if (aprons) root.add(aprons); }
    // dirt shortcut gates + tire-mark mouths (masterplan 2.2)
    { const cuts = DD._sceneShared.buildShortcutDecor(track, theme); if (cuts) root.add(cuts); }

    // dashed glowing centre line — breaks up the flat asphalt and reads as speed/motion.
    // Dashes via skipping alternating sample runs (offsetFn returns null on the gaps).
    const centre = DD._sceneShared.buildStrip(track, theme,
      (s, i) => {
        if (s.gap || (i % 8) >= 4) return null; // ~4-on / 4-off dash pattern
        const c = V.addS(s.p, s.u, DD.DECAL.centre);
        return [V.addS(c, s.r, -0.13), V.addS(c, s.r, 0.13)];
      }, V.lerp(theme.accent2, [1, 1, 1], 0.45), 0.42, THREE.AdditiveBlending);
    if (centre) root.add(centre);

    // boost overlay (T2 - instanced glowing pads + chevrons)
    const boost = DD._sceneShared.buildBoostPads(track, theme);
    if (boost) { root.add(boost); track.boostMesh = boost; }

    // glass shine overlay
    const glass = DD._sceneShared.buildStrip(track, theme,
      (s) => s.surf === DD.SURF.GLASS ? [V.addS(V.addS(s.p, s.u, DD.DECAL.glass), s.r, -s.w / 2), V.addS(V.addS(s.p, s.u, DD.DECAL.glass), s.r, s.w / 2)] : null,
      theme.glassColor, 0.28, THREE.AdditiveBlending);
    if (glass) root.add(glass);

    // dirtcut overlay (3.1) — matte earth wash so the rally sector reads before you're on it
    const dirtStrip = DD._sceneShared.buildStrip(track, theme,
      (s) => s.surf === DD.SURF.DIRT ? [V.addS(V.addS(s.p, s.u, DD.DECAL.glass), s.r, -s.w / 2), V.addS(V.addS(s.p, s.u, DD.DECAL.glass), s.r, s.w / 2)] : null,
      V.lerp(theme.groundColor, [0.42, 0.30, 0.18], 0.55), 0.85, THREE.NormalBlending);
    if (dirtStrip) root.add(dirtStrip);

    // guardrails: solid wall + bright top rail. Shortcut mouths OPEN the inside rail
    // (s.wallOpen — mirrors the physics clamp skip, so what you see is what collides).
    const railWall = (side) => DD._sceneShared.buildStrip(track, theme,
      (s) => s.wall && !s.gap && s.wallOpen !== side ? [V.addS(s.p, s.r, side * s.w / 2), V.addS(V.addS(s.p, s.r, side * s.w / 2), s.u, 0.85)] : null,
      theme.accent2, 1.0, THREE.NormalBlending);
    const railTop = (side) => DD._sceneShared.buildStrip(track, theme,
      (s) => {
        if (!s.wall || s.gap || s.wallOpen === side) return null;
        const c = V.addS(V.addS(s.p, s.r, side * s.w / 2), s.u, 0.85);
        return [V.addS(c, s.r, -0.1 * side), V.addS(c, s.r, 0.1 * side)];
      }, theme.accent2, 0.85, THREE.AdditiveBlending);
    // T8: Extra glowing middle rails for wallrides to emphasize banking
    const wallrideMidRail = (side, heightFrac) => DD._sceneShared.buildStrip(track, theme,
      (s) => {
        if (!s.wall || s.gap || s.pieceName !== 'wallride') return null;
        const c = V.addS(V.addS(s.p, s.r, side * s.w / 2), s.u, 0.85 * heightFrac);
        return [V.addS(c, s.r, -0.08 * side), V.addS(c, s.r, 0.08 * side)];
      }, theme.accent, 0.9, THREE.AdditiveBlending);
    for (const side of [1, -1]) {
      const w = railWall(side), tline = railTop(side);
      if (w) root.add(w); if (tline) root.add(tline);
      const mr1 = wallrideMidRail(side, 0.33), mr2 = wallrideMidRail(side, 0.66);
      if (mr1) root.add(mr1); if (mr2) root.add(mr2);
    }

    // T3 + T4: gantry-style start/finish + numbered checkpoint gates
    root.add(DD._sceneShared.buildGates(track, theme, quality));
    // T5: tunnels (overheaded tubes on straight segments)
    root.add(DD._sceneShared.buildTunnels(track, theme, quality));
    // T6: landing target pads for big jumps
    root.add(DD._sceneShared.buildLandingPads(track, theme));
    root.add(DD._sceneShared.buildCornerSigns(track, theme));
    root.add(DD._sceneShared.buildDecor(track, theme, rng, quality));
    
    const emissiveDecor = DD._sceneShared.buildEmissiveElements(track, theme, rng, quality);
    if (emissiveDecor) {
      root.add(emissiveDecor);
      track.emissiveDecorMesh = emissiveDecor;
    }

    const poles = DD._sceneShared.buildLightPoles(track, theme, rng, quality);
    root.add(poles);
    const props = DD._sceneShared.buildNeonProps(track, theme, rng, quality);
    root.add(props);

    // Support pillars under elevated sections
    root.add(DD._sceneShared.buildSupportPillars(track, theme));
    // Glowing neon arches with downward light pools
    const arches = DD._sceneShared.buildNeonArches(track, theme, quality);
    root.add(arches);

    // Tall glowing verticals photobomb the garage: a lamp/pylon right behind the stage reads
    // as a giant bloom beam through the showcase car. game.js hides these while in the garage
    // (same pattern as track.gateMeshes); everything low/horizontal stays as backdrop.
    track.garageHide = [poles, props, arches];
    if (emissiveDecor) track.garageHide.push(emissiveDecor);
    
    // Distant background elements (skipped on low quality for mobile performance)
    if (quality !== 'low') {
      root.add(DD._sceneShared.buildHorizonMountains(track, theme, rng));
      
      if (theme.atmosphere === 'aurora') {
        const aurora = DD._sceneShared.buildAurora(track, theme, rng);
        root.add(aurora);
        track.auroraMesh = aurora;
      } else {
        const nebulae = DD._sceneShared.buildNebulae(theme, rng);
        root.add(nebulae);
        track.nebulaeMesh = nebulae;
      }
      
      const planet = DD._sceneShared.buildSciFiPlanet(theme, rng);
      root.add(planet);
      track.planetMesh = planet;

      const godrays = DD._sceneShared.buildGodrays(track, theme);
      root.add(godrays);
      track.godrayMesh = godrays;
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

  // textures
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

  // (car-geometry helpers + CAR_FIN moved to scene-car.js — they are file-local closure
  // consts and MUST live in the same file as the car builders that use them)

  // updateCamera
  DD.updateCamera = function (camera, camState, car, track, dt, speed) {
    const s = track.samples[Math.min(car.idx, track.samples.length - 1)];
    const up = s.u;
    ipSet(camF0, Math.sin(car.yaw), 0, Math.cos(car.yaw));
    const d = ipDot(camF0, up);
    ipAddS(camTempF, camF0, up, -d);
    ipNorm(camF, camTempF);
    const sv = DD.clamp(speed / DD.PHYS.vmax, 0, 1);

    // Follow direction: blend the nose toward the actual travel (velocity) direction by how far the
    // car is sliding, so during a drift the camera trails where you're GOING rather than where the
    // nose points. Pure function of car.vel — no Math.random, stays deterministic.
    ipSet(camFollow, camF[0], camF[1], camF[2]);
    const vel = car.vel || [0, 0, 0];
    const velDotUp = ipDot(vel, up);
    ipAddS(camVproj, vel, up, -velDotUp);
    const vmag = Math.sqrt(camVproj[0] * camVproj[0] + camVproj[1] * camVproj[1] + camVproj[2] * camVproj[2]);
    if (vmag > 4) {
      ipNorm(camVelDir, camVproj);
      const dotF_VelDir = ipDot(camF, camVelDir);
      if (dotF_VelDir > 0.1) { // only when moving roughly forward (don't flip when reversing)
        const slipAng = Math.acos(DD.clamp(dotF_VelDir, -1, 1));
        const blend = DD.clamp(slipAng / 0.7, 0, 1) * 0.6; // up to 60% toward travel at ~40° of slip
        camLerp[0] = camF[0] + (camVelDir[0] - camF[0]) * blend;
        camLerp[1] = camF[1] + (camVelDir[1] - camF[1]) * blend;
        camLerp[2] = camF[2] + (camVelDir[2] - camF[2]) * blend;
        ipNorm(camFollow, camLerp);
      }
    }

    const CP = DD.CAM_PROFILES[DD.cameraProfile] || DD.CAM_PROFILES.classic;
    const dist = CP.dist0 + sv * CP.distV;
    ipAddS(camTemp1, car.pos, camFollow, -dist);
    ipAddS(camTargetPos, camTemp1, up, CP.h0 + sv * CP.hV);
    ipAddS(camTemp2, car.pos, camFollow, CP.look);
    ipAddS(camTargetLook, camTemp2, up, 1.0);
    const kp = 1 - Math.exp(-10 * dt), kl = 1 - Math.exp(-16 * dt);
    
    camState.pos[0] = camState.pos[0] + (camTargetPos[0] - camState.pos[0]) * kp;
    camState.pos[1] = camState.pos[1] + (camTargetPos[1] - camState.pos[1]) * kp;
    camState.pos[2] = camState.pos[2] + (camTargetPos[2] - camState.pos[2]) * kp;

    camState.look[0] = camState.look[0] + (camTargetLook[0] - camState.look[0]) * kl;
    camState.look[1] = camState.look[1] + (camTargetLook[1] - camState.look[1]) * kl;
    camState.look[2] = camState.look[2] + (camTargetLook[2] - camState.look[2]) * kl;

    // Impulses: a quick decaying positional kick the camera used to ignore. Down along the surface
    // normal on a hard landing, back along travel on a wall hit. Directions are deterministic (no
    // random), so golden screenshots remain reproducible.
    if (!camState.shake) camState.shake = [0, 0, 0];
    const landed = camState.prevGrounded === false && car.grounded;
    const fallSpeed = Math.max(0, -(camState.prevVelY || 0)); // downward speed just before touchdown
    if (landed && fallSpeed > 2) {
      ipAddS(camState.shake, camState.shake, up, -0.6 * DD.clamp(fallSpeed / 22, 0, 1));
    }
    // Wall-hit camera kick + FOV punch removed — read as jumpy, not impactful. Landing kick kept.
    camState.prevGrounded = car.grounded;
    camState.prevVelY = vel[1];

    camFinalPos[0] = camState.pos[0] + camState.shake[0];
    camFinalPos[1] = camState.pos[1] + camState.shake[1];
    camFinalPos[2] = camState.pos[2] + camState.shake[2];
    
    const scaleFactor = Math.exp(-dt * 11);
    camState.shake[0] *= scaleFactor;
    camState.shake[1] *= scaleFactor;
    camState.shake[2] *= scaleFactor;

    camera.position.set(camFinalPos[0], camFinalPos[1], camFinalPos[2]);
    camera.up.set(DD.lerp(0, up[0], 0.55), 1, DD.lerp(0, up[2], 0.55));
    camera.lookAt(camState.look[0], camState.look[1], camState.look[2]);
    // FOV widens with speed (with a non-linear speed-creep above 75% speed, scaled per camera
    // profile — CP.creep), a touch more while sliding, plus a punch on boost pads (speed rush).
    const creep = CP.creep !== undefined ? CP.creep : 20;
    const targetFov = CP.fov0 + sv * CP.fovV + (sv > 0.75 ? Math.pow(sv - 0.75, 1.5) * creep : 0) + (car.sliding ? 3 : 0) + (car.boostGlow || 0) * 7;
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
      if (track.godrayMesh) track.godrayMesh.position.copy(camera.position);
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
        const lookX = camState.look[0] - camFinalPos[0];
        const lookZ = camState.look[2] - camFinalPos[2];
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


  // disposeGroup
  DD.disposeGroup = function (scene, group) {
    if (!group) return;
    scene.remove(group);
    group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) { (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m.dispose()); }
    });
  };



  DD._sceneShared.getAsphaltNormalTexture = getAsphaltNormalTexture;
  DD._sceneShared.getAsphaltRoughnessTexture = getAsphaltRoughnessTexture;
  DD._sceneShared.getNebulaTexture = getNebulaTexture;
  DD._sceneShared.getDotTexture = getDotTexture;
  DD._sceneShared.getCarbonTexture = getCarbonTexture;

})(typeof window !== 'undefined' ? window : globalThis);
