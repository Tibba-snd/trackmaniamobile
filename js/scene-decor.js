/* DRIFTDREAM scene decor — Static world components: Sky, Terrain, Props, etc. */
(function (global) {
  'use strict';
  const DD = global.DD;
  const V = DD.v;
  const col = DD._sceneShared.col;
  const addLightSource = DD._sceneShared.addLightSource;

  // Shared texture wrappers
  const getAsphaltNormalTexture = () => DD._sceneShared.getAsphaltNormalTexture();
  const getAsphaltRoughnessTexture = () => DD._sceneShared.getAsphaltRoughnessTexture();
  const getNebulaTexture = () => DD._sceneShared.getNebulaTexture();
  const getDotTexture = () => DD._sceneShared.getDotTexture();

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
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x0c0c10, metalness: 0.9, roughness: 0.1, emissive: col(theme.accent2), emissiveIntensity: 0.06 });
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
    const chevrons = new THREE.InstancedMesh(chevronGeo, signGlowMat, N * 10);
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
      // sign glyphs: two LARGE chevrons + top/bottom frame bars (10 instances/sign,
      // front/back + frame bars). Big glyphs are the point — the old six mini-chevrons were sub-pixel at
      // distance, so the panel read as a floating black box hanging over the road.
      for (const sx of [-0.42, 0.30]) {
        for (const sy of [-1, 1]) {
          chevrons.setMatrixAt(ci++, place(sx, 7.3 + sy * 0.19, 0.07, ez.set(0, 0, sy * 0.62), 1.6, 1.4, 1));
        }
      }
      for (const sx of [-0.42, 0.30]) {
        for (const sy of [-1, 1]) {
          chevrons.setMatrixAt(ci++, place(sx, 7.3 + sy * 0.19, -0.07, ez.set(0, Math.PI, sy * 0.62), 1.6, 1.4, 1));
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


  // Register on DD._sceneShared
  DD._sceneShared.buildSky = buildSky;
  DD._sceneShared.buildStars = buildStars;
  DD._sceneShared.buildTerrain = buildTerrain;
  DD._sceneShared.buildTerrainGrid = buildTerrainGrid;
  DD._sceneShared.buildRibbon = buildRibbon;
  DD._sceneShared.buildStrip = buildStrip;
  DD._sceneShared.buildKerbs = buildKerbs;
  DD._sceneShared.buildCornerSigns = buildCornerSigns;
  DD._sceneShared.buildGates = buildGates;
  DD._sceneShared.buildDecor = buildDecor;
  DD._sceneShared.buildEmissiveElements = buildEmissiveElements;
  DD._sceneShared.buildLightPoles = buildLightPoles;
  DD._sceneShared.buildNeonProps = buildNeonProps;
  DD._sceneShared.buildSupportPillars = buildSupportPillars;
  DD._sceneShared.buildNeonArches = buildNeonArches;
  DD._sceneShared.buildHorizonMountains = buildHorizonMountains;
  DD._sceneShared.buildNebulae = buildNebulae;
  DD._sceneShared.getAuroraTexture = getAuroraTexture;
  DD._sceneShared.buildAurora = buildAurora;
  DD._sceneShared.buildSciFiPlanet = buildSciFiPlanet;

})(typeof window !== 'undefined' ? window : globalThis);
