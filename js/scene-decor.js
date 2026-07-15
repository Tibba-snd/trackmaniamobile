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
    const n = dense ? 2200 : 1300;
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

  // Local noise utilities for terrain color bake
  function noise2(seed, x, y) {
    let n = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ (seed | 0);
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
  }
  function valueNoise(seed, x, y) {
    const xi = Math.floor(x), yi = Math.floor(y);
    const fx = x - xi, fy = y - yi;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const a = noise2(seed, xi, yi), b = noise2(seed, xi + 1, yi);
    const c = noise2(seed, xi, yi + 1), d = noise2(seed, xi + 1, yi + 1);
    return DD.lerp(DD.lerp(a, b, sx), DD.lerp(c, d, sx), sy);
  }

  /* ---------------- TERRAIN (mesh from trackgen heightfield) ---------------- */
  function buildTerrain(track, theme) {
    const T = track.terrain;
    const RES = T.res;
    const pos = new Float32Array(RES * RES * 3);
    const idx = [];
    const g = theme.groundColor;
    const B = DD.TERRAIN_BAKE;
    
    // Base colors derived from theme.groundColor (unshaded, will be shaded below)
    const cLo = [g[0] * B.cLoScale[0], g[1] * B.cLoScale[1], g[2] * B.cLoScale[2]];
    const cHi = [
      Math.min(g[0] * B.cHiScale[0], B.cHiMax[0]),
      Math.min(g[1] * B.cHiScale[1], B.cHiMax[1]),
      Math.min(g[2] * B.cHiScale[2], B.cHiMax[2])
    ];

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

    // Compute track AABB center and radius
    let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;
    for (const s of track.samples) {
      minX = Math.min(minX, s.p[0]);
      maxX = Math.max(maxX, s.p[0]);
      minZ = Math.min(minZ, s.p[2]);
      maxZ = Math.max(maxZ, s.p[2]);
    }
    const centerX = (minX + maxX) / 2;
    const centerZ = (minZ + maxZ) / 2;
    const maxRadius = Math.max((maxX - minX) / 2, (maxZ - minZ) / 2, 1);

    // Sun direction for baked shading
    const sunAngle = theme.lightAngle;
    const lx = Math.sin(sunAngle);
    const ly = 0.4;
    const lz = Math.cos(sunAngle);
    const lLen = Math.sqrt(lx * lx + ly * ly + lz * lz) || 1;
    const L = [lx / lLen, ly / lLen, lz / lLen];
    const sunIntensity = B.sunIntensity;
    const sunColor = theme.sunColor;

    // Ambient light values
    const ambSky = B.ambSky;
    const ambGrd = B.ambGrd;
    const ambInt = theme.ambient != null ? Math.max(theme.ambient, B.ambientFloor) : B.ambientFloor;

    // Emissive self-glow (tinted by theme's accent)
    const glowColor = theme.accent;
    const glowIntensity = B.glowIntensity;
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

      // 2-3 octaves of valueNoise modulating color (biome-tinted - mix toward groundDetailColor)
      const nSeed = DD.hashSeed(track.seed + '::terrainBakeV2');
      let nVal = 0;
      let ampSum = 0;
      let scale = B.noiseScale;
      let amp = 1.0;
      for (let oct = 0; oct < B.octaves; oct++) {
        nVal += valueNoise(nSeed ^ (oct * 0x3f2d), xAvg * scale, zAvg * scale) * amp;
        ampSum += amp;
        scale *= 2.0;
        amp *= 0.5;
      }
      nVal /= ampSum; // normalized 0..1

      // Subtle geological bands
      const bands = Math.sin(hAvg * 0.15 + xAvg * 0.005 + zAvg * 0.005) * B.bandsStrength;

      const tt = Math.pow((hAvg - T.minH) / range, 1.3);
      let baseR = DD.lerp(cLo[0], cHi[0], tt) + bands;
      let baseG = DD.lerp(cLo[1], cHi[1], tt) + bands;
      let baseB = DD.lerp(cLo[2], cHi[2], tt) + bands;

      // Mix toward groundDetailColor based on multi-octave noise
      const detailColor = theme.groundDetailColor;
      const mixAmt = nVal * B.varianceStrength;
      baseR = DD.lerp(baseR, detailColor[0], mixAmt);
      baseG = DD.lerp(baseG, detailColor[1], mixAmt);
      baseB = DD.lerp(baseB, detailColor[2], mixAmt);

      // Subtle radial warm->cool shade with distance from track AABB center
      const dx = xAvg - centerX;
      const dz = zAvg - centerZ;
      const dist = Math.sqrt(dx * dx + dz * dz);
      const radialBlend = Math.min(1, dist / maxRadius);
      const tintR = DD.lerp(B.radialWarmth[0], B.radialCoolness[0], radialBlend);
      const tintG = DD.lerp(B.radialWarmth[1], B.radialCoolness[1], radialBlend);
      const tintB = DD.lerp(B.radialWarmth[2], B.radialCoolness[2], radialBlend);

      baseR += tintR;
      baseG += tintG;
      baseB += tintB;

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
    // closed circuits: stitch the last sample back to the first — the loop above stops at n-1,
    // which left a literal 2 m hole in the deck at the start/finish seam
    if (track.closed && !ss[n - 1].gap && !ss[0].gap) {
      if (edgelit) {
        const a = (n - 1) * 4;
        idx.push(a, a + 1, 0, a + 1, 1, 0);
        idx.push(a + 1, a + 2, 1, a + 2, 2, 1);
        idx.push(a + 2, a + 3, 2, a + 3, 3, 2);
      } else {
        const a = (n - 1) * 2;
        idx.push(a, a + 1, 0, a + 1, 1, 0);
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
      roughness: wet ? 0.85 : 1.0, // Raised roughness floor to soften reflections
      roughnessMap: getAsphaltRoughnessTexture(),
      metalness: wet ? 0.05 : 0.0,
      side: THREE.DoubleSide,
      envMapIntensity: wet ? 0.40 : 0.60, // Significantly lowered environment map reflection intensity
      normalMap: getAsphaltNormalTexture(),
      normalScale: wet ? new THREE.Vector2(0.06, 0.06) : new THREE.Vector2(0.12, 0.12) // Reduced normal-map strength to prevent shimmering/jags
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    mesh.receiveShadow = true;
    mesh.castShadow = true;
    return mesh;
  }

  /* ---------------- ROAD BODY — vertical side skirts give the ribbon 3D girth ----------------
     The ribbon is a flat slab decal; on a fill-bound GPU geometry is ~free, so drop a solid side
     wall down each edge so the track reads as a raised deck, not a sticker. Dark asphalt-side
     material; 1 draw call; skips gap seams. */
  function buildRoadBody(track, theme) {
    const ss = track.samples, n = ss.length;
    const depth = 1.9;                       // how far the slab drops below the road surface
    const pos = [], idx = [];
    let vi = 0;
    const push = (a) => { pos.push(a[0], a[1], a[2]); return vi++; };
    const addSpan = (s, s2) => {
      if (s.gap || s2.gap) return;
      const wl = s.w / 2, wl2 = s2.w / 2;
      // left side face
      const Lt = V.addS(s.p, s.r, -wl), Lb = V.addS(Lt, s.u, -depth);
      const Lt2 = V.addS(s2.p, s2.r, -wl2), Lb2 = V.addS(Lt2, s2.u, -depth);
      { const a = push(Lt), b = push(Lb), c = push(Lt2), d = push(Lb2); idx.push(a, b, c, b, d, c); }
      // right side face
      const Rt = V.addS(s.p, s.r, wl), Rb = V.addS(Rt, s.u, -depth);
      const Rt2 = V.addS(s2.p, s2.r, wl2), Rb2 = V.addS(Rt2, s2.u, -depth);
      { const e = push(Rt), f = push(Rb), g = push(Rt2), h = push(Rb2); idx.push(e, g, f, f, g, h); }
    };
    for (let i = 0; i < n - 1; i++) addSpan(ss[i], ss[i + 1]);
    if (track.closed) addSpan(ss[n - 1], ss[0]); // circuit seam
    if (!pos.length) return null;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const t = theme.skyBottom;
    const mat = new THREE.MeshStandardMaterial({
      color: col([0.04 + t[0] * 0.03, 0.04 + t[1] * 0.03, 0.05 + t[2] * 0.04]),
      roughness: 0.92, metalness: 0.0, side: THREE.DoubleSide, envMapIntensity: 0.25
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    mesh.receiveShadow = true;
    mesh.castShadow = true;
    return mesh;
  }

  function buildStrip(track, theme, offsetFn, color, opacity, blending, texture) {
    // generic thin strip builder along track; offsetFn(s) -> [centerOffsetVec, halfWidthVec] or null to skip
    const ss = track.samples;
    const pts = [];
    for (let i = 0; i < ss.length; i++) {
      const o = offsetFn(ss[i], i);
      pts.push(o); // may be null
    }
    const pos = [];
    const uvs = [];
    const idx = [];
    let vi = 0, runStart = -1;
    for (let i = 0; i < ss.length; i++) {
      if (pts[i]) {
        const [a, b] = pts[i];
        pos.push(a[0], a[1], a[2], b[0], b[1], b[2]);
        uvs.push(0, i * 0.2, 1, i * 0.2);
        if (runStart >= 0) {
          const q = vi - 2;
          idx.push(q, q + 1, q + 2, q + 1, q + 3, q + 2);
        }
        runStart = i; vi += 2;
      } else runStart = -1;
    }
    // circuit seam: if the strip is live on both sides of the start/finish wrap, close it
    // (verts 0,1 are pts[0]'s pair whenever pts[0] is non-null)
    if (track.closed && pts[0] && pts[ss.length - 1]) {
      const q = vi - 2;
      idx.push(q, q + 1, 0, q + 1, 1, 0);
    }
    if (!pos.length) return null;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uvs), 2));
    geo.setIndex(idx);
    const isNormal = !blending || blending === THREE.NormalBlending;
    const mat = new THREE.MeshBasicMaterial({
      color: col(color), transparent: opacity < 1, opacity,
      blending: blending || THREE.NormalBlending, side: THREE.DoubleSide,
      depthWrite: isNormal,
      polygonOffset: isNormal,
      polygonOffsetFactor: isNormal ? -1 : 0,
      polygonOffsetUnits: isNormal ? -1 : 0,
      map: texture || null
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    return mesh;
  }

  /* ---------------- KERBS — biome-coloured rumble strips on flagged edges ----------------
     Alternating white / accent stripes laid flat just off the edge. FLAG-DRIVEN (s.kerb, set by
     trackgen): corner apex inside edges AND kerbed apron/shortcut edges — the kerb marks every
     "creative line" a fence doesn't guard. MeshBasic + vertex colours. 1 draw call. */
  function buildKerbs(track, theme) {
    const ss = track.samples;
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
    for (let i = 2; i < ss.length - 1; i++) {
      const s = ss[i], sN = ss[i + 1];
      if (!s.kerb || sN.kerb !== s.kerb || s.gap || sN.gap) continue;
      const side = s.kerb;
      // inner edge sits on the deck; outer edge lifts ~0.12 so the kerb is a beveled 3D rumble
      // strip (catches light on its slope) instead of a flat painted sticker.
      const e1 = V.addS(V.addS(s.p, s.r, side * (s.w / 2)), s.u, DD.DECAL.kerb);
      const o1 = V.addS(V.addS(e1, s.r, side * kerbW), s.u, 0.12);
      const e2 = V.addS(V.addS(sN.p, sN.r, side * (sN.w / 2)), sN.u, DD.DECAL.kerb);
      const o2 = V.addS(V.addS(e2, sN.r, side * kerbW), sN.u, 0.12);
      addQuad(e1, o1, e2, o2, (i % 2 === 0) ? white : stripe);
    }
    if (!pos.length) return null;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(colArr), 3));
    geo.setIndex(idx);
    const mat = new THREE.MeshBasicMaterial({
      vertexColors: true,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    return mesh;
  }

  function getWrappedIdx(idx, N, closed) {
    if (closed) {
      return (idx % N + N) % N;
    }
    if (idx < 0 || idx >= N) return -1;
    return idx;
  }

  function isSpawningSafe(idx, track) {
    const N = track.samples.length;
    const s = track.samples[(idx % N + N) % N];
    if (!s) return false;
    if (s.apron && Math.abs(s.apron) > 0.01) return false;
    if (s.gap) return false;
    if (s.landing) return false;

    if (track.shortcuts && track.shortcuts.length) {
      const px = s.p[0];
      const pz = s.p[2];
      for (const sc of track.shortcuts) {
        const ax = sc.a[0];
        const az = sc.a[2];
        const bx = sc.b[0];
        const bz = sc.b[2];
        const abx = bx - ax;
        const abz = bz - az;
        const len2 = sc.len2 || (abx * abx + abz * abz);
        if (len2 < 0.01) continue;
        let t = ((px - ax) * abx + (pz - az) * abz) / len2;
        t = Math.max(0, Math.min(1, t));
        const projx = ax + t * abx;
        const projz = az + t * abz;
        const dx = px - projx;
        const dz = pz - projz;
        if (dx * dx + dz * dz < 16 * 16) {
          return false;
        }
      }
    }
    return true;
  }

  // world-space clearance vs EVERY OTHER stretch of track: roadside furniture must never stand
  // inside an adjacent leg (hairpin returns, overunder crossings, closure passes). Same pattern
  // as the trackgen apron proximity scan — arc-distance-gated, wrapped on circuits.
  function clearOfTrack(track, px, pz, ownIdx, minD) {
    const ss = track.samples, N = ss.length;
    const d2 = minD * minD;
    for (let j = 0; j < N; j += 3) {
      let di = Math.abs(j - ownIdx);
      if (track.closed) di = Math.min(di, N - di);
      if (di < 30) continue;
      const dx = px - ss[j].p[0], dz = pz - ss[j].p[2];
      if (dx * dx + dz * dz < d2) return false;
    }
    return true;
  }

  // corner/brake board eligibility — shared by the count pass and the place pass so instance
  // counts always mirror placements exactly. Rejects: unsafe samples (aprons/gaps/shortcuts),
  // board centers standing inside another track leg, and boards whose support posts would need
  // >9 m stilts (elevated deck / crossing below — the "pole skewers the road" artifact).
  function boardOk(track, bi, outside) {
    if (bi < 2) return false;
    const s = track.samples[bi];
    if (!s || s.gap) return false;
    if (!isSpawningSafe(bi, track)) return false;
    const lat = outside * (s.w / 2 + 2.6);
    const px = s.p[0] + s.r[0] * lat;
    const pz = s.p[2] + s.r[2] * lat;
    if (!clearOfTrack(track, px, pz, bi, 12)) return false;
    if (track.terrain) {
      const py = s.p[1] + s.r[1] * lat + s.u[1] * 2.0;
      const g = DD.terrainAt(track.terrain, px, pz);
      if (py - g > 9) return false;
    }
    return true;
  }

  // true off-deck test vs the LOCAL arc: on curves, a point laterally clear of its own sample
  // can still sit over a sample 10-20 m along the bend (the chord pinches inside). Checks every
  // sample in ±25 against that sample's own width.
  function offDeck(track, px, pz, idx, margin) {
    const ss = track.samples, N = ss.length;
    for (let o = -25; o <= 25; o++) {
      const j = getWrappedIdx(idx + o, N, track.closed);
      if (j === -1) continue;
      const s = ss[j];
      const dx = px - s.p[0], dz = pz - s.p[2];
      const min = s.w / 2 + margin;
      if (dx * dx + dz * dz < min * min) return false;
    }
    return true;
  }

  // apex cone eligibility — cones sit on the INSIDE edge, which on hairpins points both at the
  // returning leg AND into the pinched inside chord of the bend itself. If the cone can't stand
  // truly off-deck there, skip it — kerbs already mark the apex.
  function coneOk(track, c, idx) {
    if (idx === -1) return false;
    if (!isSpawningSafe(idx, track)) return false;
    const s = track.samples[idx];
    if (!s) return false;
    const lat = c.insideSign * (s.w / 2 + 1.4);
    const px = s.p[0] + s.r[0] * lat, pz = s.p[2] + s.r[2] * lat;
    if (!offDeck(track, px, pz, idx, 0.7)) return false;
    return clearOfTrack(track, px, pz, idx, 8);
  }

  const colToHex = (c) => {
    const r = Math.round(c[0] * 255).toString(16).padStart(2, '0');
    const g = Math.round(c[1] * 255).toString(16).padStart(2, '0');
    const b = Math.round(c[2] * 255).toString(16).padStart(2, '0');
    return '#' + r + g + b;
  };

  const _textTexCache = {};
  function getTextTexture(text, signColorHex, bgColorHex = '#0c0c10') {
    const key = text + '|' + signColorHex + '|' + bgColorHex;
    if (_textTexCache[key]) return _textTexCache[key];
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.fillStyle = bgColorHex;
      ctx.fillRect(0, 0, 256, 128);
      ctx.strokeStyle = signColorHex;
      ctx.lineWidth = 12;
      ctx.strokeRect(6, 6, 244, 116);
      ctx.fillStyle = signColorHex;
      ctx.font = 'bold 72px "Chakra Petch", "Courier New", monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, 128, 64);
    }
    const tex = new THREE.CanvasTexture(canvas);
    _textTexCache[key] = tex;
    return tex;
  }

  function buildHazardChevrons(track, theme) {
    const ss = track.samples;
    const N = ss.length;
    const pos = [];
    const idx = [];
    let vi = 0;

    // Every vertex is CONFORMED to the deck at its own arc position: the old code extruded the
    // arrow planar from one sample's frame, so on a curving/banking tighten span the deck curved
    // away underneath and the arrow floated/sank — the "translucent repeating glitch mid-curve".
    const ds = track.ds || 2;
    const deckPoint = (i, fOff, rOff) => {
      const t = fOff / ds;
      const j0 = Math.floor(t), frac = t - j0;
      const ia = getWrappedIdx(i + j0, N, track.closed);
      const ib = getWrappedIdx(i + j0 + 1, N, track.closed);
      const a = ia !== -1 ? ss[ia] : ss[i];
      const b = ib !== -1 ? ss[ib] : a;
      const L = (k) => DD.lerp(a.p[k], b.p[k], frac) + DD.lerp(a.r[k], b.r[k], frac) * rOff + DD.lerp(a.u[k], b.u[k], frac) * DD.DECAL.centre;
      return [L(0), L(1), L(2)];
    };
    for (let i = 0; i < N; i++) {
      const s = ss[i];
      if (s.pieceName === 'tighten' && i % 4 === 0 && isSpawningSafe(i, track)) {
        const v0 = deckPoint(i, 1.5, 0);
        const v1 = deckPoint(i, -0.5, -2.2);
        const v2 = deckPoint(i, -0.5, 2.2);
        const v3 = deckPoint(i, 0.8, 0);
        const v4 = deckPoint(i, -1.2, -1.8);
        const v5 = deckPoint(i, -1.2, 1.8);

        pos.push(v0[0], v0[1], v0[2]);
        pos.push(v1[0], v1[1], v1[2]);
        pos.push(v2[0], v2[1], v2[2]);
        pos.push(v3[0], v3[1], v3[2]);
        pos.push(v4[0], v4[1], v4[2]);
        pos.push(v5[0], v5[1], v5[2]);

        idx.push(vi + 0, vi + 1, vi + 4);
        idx.push(vi + 0, vi + 4, vi + 3);
        idx.push(vi + 0, vi + 5, vi + 2);
        idx.push(vi + 0, vi + 3, vi + 5);

        vi += 6;
      }
    }

    if (pos.length === 0) return null;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
    geo.setIndex(idx);

    // depthWrite OFF: transparent decal writing depth fought the road plane + neighbouring
    // ladder decals (sorting shimmer). polygonOffset + the DECAL ladder height do the layering.
    const mat = new THREE.MeshBasicMaterial({
      color: col(theme.accent),
      transparent: true,
      opacity: 0.85,
      side: THREE.DoubleSide,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1
    });

    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    return mesh;
  }

  function buildDistanceBoards(track, theme) {
    const ss = track.samples;
    const N = ss.length;
    const group = new THREE.Group();

    const targets = [
      { ratio: 0.25, label: '75%' },
      { ratio: 0.50, label: '50%' },
      { ratio: 0.75, label: '25%' }
    ];

    const darkMat = new THREE.MeshStandardMaterial({ color: 0x0c0c10, metalness: 0.9, roughness: 0.1 });
    const panelGeo = new THREE.BoxGeometry(2.0, 1.3, 0.1);
    const postGeo = new THREE.CylinderGeometry(0.06, 0.08, 1.0, 6);
    const textPlaneGeo = new THREE.PlaneGeometry(1.8, 1.1);

    function isNearCheckpoint(idx) {
      const gates = [...(track.checkpoints || [])];
      if (track.startIdx !== undefined) gates.push(track.startIdx);
      if (track.finishIdx !== undefined) gates.push(track.finishIdx);

      const maxSampleDiff = Math.ceil(80 / track.ds);
      for (const gateIdx of gates) {
        let diff = Math.abs(idx - gateIdx);
        if (track.closed) {
          diff = Math.min(diff, N - diff);
        }
        if (diff <= maxSampleDiff) {
          return true;
        }
      }
      return false;
    }

    for (const tgt of targets) {
      const idx = Math.round(N * tgt.ratio);
      const wIdx = getWrappedIdx(idx, N, track.closed);
      if (wIdx === -1 || !isSpawningSafe(wIdx, track) || isNearCheckpoint(wIdx)) continue;

      const s = ss[wIdx];
      const outside = 1;
      const p = V.addS(V.addS(s.p, s.r, outside * (s.w / 2 + 2.2)), s.u, 1.5);

      const basis = new THREE.Matrix4();
      if (basis.makeBasis) {
        basis.makeBasis(
          new THREE.Vector3(-s.r[0], -s.r[1], -s.r[2]),
          new THREE.Vector3(s.u[0], s.u[1], s.u[2]),
          new THREE.Vector3(-s.f[0], -s.f[1], -s.f[2])
        );
      }
      const qBoard = new THREE.Quaternion().setFromRotationMatrix(basis);

      const mBoard = new THREE.Matrix4();
      mBoard.compose(new THREE.Vector3(p[0], p[1], p[2]), qBoard, new THREE.Vector3(1, 1, 1));

      const panel = new THREE.Mesh(panelGeo, darkMat);
      panel.position.copy(p);
      panel.quaternion.copy(qBoard);
      panel.castShadow = panel.receiveShadow = true;
      group.add(panel);

      const postTop = [p[0] - s.u[0] * 0.65, p[1] - s.u[1] * 0.65, p[2] - s.u[2] * 0.65];
      const g = track.terrain ? DD.terrainAt(track.terrain, postTop[0], postTop[2]) : 0;
      const height = Math.max(0.1, postTop[1] - g);
      const yCenter = (postTop[1] + g) / 2;

      const post = new THREE.Mesh(postGeo, darkMat);
      post.position.set(postTop[0], yCenter, postTop[2]);
      post.scale.set(1, height, 1);
      post.castShadow = post.receiveShadow = true;
      group.add(post);

      const textMat = new THREE.MeshBasicMaterial({
        map: getTextTexture(tgt.label, colToHex(theme.accent2)),
        transparent: true,
        opacity: 0.95,
        side: THREE.DoubleSide,
        depthWrite: true,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1
      });

      const textPlane = new THREE.Mesh(textPlaneGeo, textMat);
      const sPos = new THREE.Vector3(0, 0, 0.06);
      const sQuat = new THREE.Quaternion();
      const sScl = new THREE.Vector3(1, 1, 1);
      const mLocal = new THREE.Matrix4().compose(sPos, sQuat, sScl);
      const mWorld = new THREE.Matrix4().multiplyMatrices(mBoard, mLocal);

      textPlane.position.setFromMatrixPosition(mWorld);
      textPlane.quaternion.copy(qBoard);
      group.add(textPlane);
    }

    return group;
  }

  /* ---------------- CORNER SIGNAGE: chevrons, brake bars, apex beacons ---------------- */
  function buildCornerSigns(track, theme) {
    const group = new THREE.Group();
    const ss = track.samples;
    const N = ss.length;
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x0c0c10, metalness: 0.9, roughness: 0.1, emissive: col(theme.accent2), emissiveIntensity: 0.06 });
    const chevMat = new THREE.MeshBasicMaterial({ color: col(theme.accent2), transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false });
    const barMat = new THREE.MeshBasicMaterial({ color: col(theme.accent2), transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    const coreMat = new THREE.MeshBasicMaterial({ color: col(V.lerp(theme.accent2, [1, 1, 1], 0.75)), transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false });
    const haloMat = new THREE.MeshBasicMaterial({ color: col(theme.accent2), transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false });

    // First pass: count total boards and total slat instances for all corners
    let totalBoards = 0;
    let totalSlats = 0;
    let totalBrake100 = 0;
    let totalBrake50 = 0;

    for (const c of track.corners) {
      const outside = -c.insideSign;
      const numGlyphs = c.minRad < 40 ? 3 : (c.minRad < 70 ? 2 : 1);
      const startIdx = Math.max(2, c.entry - 20);
      const endIdx = Math.max(2, c.apex);
      const boardAt = Array.from(new Set([
        startIdx,
        Math.round(startIdx + (endIdx - startIdx) * 0.33),
        Math.round(startIdx + (endIdx - startIdx) * 0.67),
        endIdx
      ]));
      for (const bi of boardAt) {
        if (!boardOk(track, bi, outside)) continue;
        totalBoards++;
        totalSlats += 4 + 2 * numGlyphs;
      }

      // Braking boards at -100m and -50m
      const bi100 = getWrappedIdx(c.entry - Math.round(100 / track.ds), N, track.closed);
      const bi50 = getWrappedIdx(c.entry - Math.round(50 / track.ds), N, track.closed);
      if (bi100 !== -1 && boardOk(track, bi100, outside)) {
        totalBrake100++;
      }
      if (bi50 !== -1 && boardOk(track, bi50, outside)) {
        totalBrake50++;
      }
    }

    const totalAllPanels = totalBoards + totalBrake100 + totalBrake50;
    const totalAllPosts = totalAllPanels * 2;

    if (totalAllPanels > 0) {
      const panelGeo = new THREE.BoxGeometry(3.6, 2.4, 0.15);
      const postGeo = new THREE.CylinderGeometry(0.08, 0.11, 1.0, 6);
      const slatGeo = new THREE.PlaneGeometry(1.0, 1.0);

      const panelIM = new THREE.InstancedMesh(panelGeo, darkMat, totalAllPanels);
      const postIM = new THREE.InstancedMesh(postGeo, darkMat, totalAllPosts);
      const slatIM = new THREE.InstancedMesh(slatGeo, chevMat, totalSlats);

      panelIM.castShadow = panelIM.receiveShadow = true;
      postIM.castShadow = postIM.receiveShadow = true;

      let brake100IM = null;
      let brake50IM = null;
      if (totalBrake100 > 0) {
        const brakePlaneGeo = new THREE.PlaneGeometry(3.4, 2.2);
        const tex100 = getTextTexture('100', colToHex(theme.accent2));
        const brake100Mat = new THREE.MeshBasicMaterial({
          map: tex100,
          transparent: true,
          opacity: 0.95,
          side: THREE.DoubleSide,
          depthWrite: true,
          polygonOffset: true,
          polygonOffsetFactor: -1,
          polygonOffsetUnits: -1
        });
        brake100IM = new THREE.InstancedMesh(brakePlaneGeo, brake100Mat, totalBrake100);
      }
      if (totalBrake50 > 0) {
        const brakePlaneGeo = new THREE.PlaneGeometry(3.4, 2.2);
        const tex50 = getTextTexture('50', colToHex(theme.accent2));
        const brake50Mat = new THREE.MeshBasicMaterial({
          map: tex50,
          transparent: true,
          opacity: 0.95,
          side: THREE.DoubleSide,
          depthWrite: true,
          polygonOffset: true,
          polygonOffsetFactor: -1,
          polygonOffsetUnits: -1
        });
        brake50IM = new THREE.InstancedMesh(brakePlaneGeo, brake50Mat, totalBrake50);
      }

      let boardIdx = 0;
      let postIdx = 0;
      let slatIdx = 0;
      let b100Idx = 0;
      let b50Idx = 0;

      for (const c of track.corners) {
        const outside = -c.insideSign;
        const numGlyphs = c.minRad < 40 ? 3 : (c.minRad < 70 ? 2 : 1);
        const startIdx = Math.max(2, c.entry - 20);
        const endIdx = Math.max(2, c.apex);
        const boardAt = Array.from(new Set([
          startIdx,
          Math.round(startIdx + (endIdx - startIdx) * 0.33),
          Math.round(startIdx + (endIdx - startIdx) * 0.67),
          endIdx
        ]));

        for (const bi of boardAt) {
          if (!boardOk(track, bi, outside)) continue;
          const s = ss[bi];

          const p = V.addS(V.addS(s.p, s.r, outside * (s.w / 2 + 2.6)), s.u, 2.0);

          const basis = new THREE.Matrix4();
          if (basis.makeBasis) {
            basis.makeBasis(
              new THREE.Vector3(-s.r[0], -s.r[1], -s.r[2]),
              new THREE.Vector3(s.u[0], s.u[1], s.u[2]),
              new THREE.Vector3(-s.f[0], -s.f[1], -s.f[2])
            );
          }
          const qBoard = new THREE.Quaternion();
          if (qBoard.setFromRotationMatrix) qBoard.setFromRotationMatrix(basis);

          const mBoard = new THREE.Matrix4();
          if (mBoard.compose) {
            mBoard.compose(
              new THREE.Vector3(p[0], p[1], p[2]),
              qBoard,
              new THREE.Vector3(1, 1, 1)
            );
          }

          panelIM.setMatrixAt(boardIdx++, mBoard);

          const postTops = [
            [
              p[0] + s.r[0] * 1.0 - s.u[0] * 1.2,
              p[1] + s.r[1] * 1.0 - s.u[1] * 1.2,
              p[2] + s.r[2] * 1.0 - s.u[2] * 1.2
            ],
            [
              p[0] - s.r[0] * 1.0 - s.u[0] * 1.2,
              p[1] - s.r[1] * 1.0 - s.u[1] * 1.2,
              p[2] - s.r[2] * 1.0 - s.u[2] * 1.2
            ]
          ];

          for (const postTop of postTops) {
            const g = track.terrain ? DD.terrainAt(track.terrain, postTop[0], postTop[2]) : 0;
            const height = Math.max(0.1, postTop[1] - g);
            const yCenter = (postTop[1] + g) / 2;

            const mPost = new THREE.Matrix4();
            if (mPost.compose) {
              mPost.compose(
                new THREE.Vector3(postTop[0], yCenter, postTop[2]),
                new THREE.Quaternion(),
                new THREE.Vector3(1, height, 1)
              );
            }
            postIM.setMatrixAt(postIdx++, mPost);
          }

          const placeSlat = (lx, ly, lz, rotZ, sx, sy) => {
            const sPos = new THREE.Vector3(lx, ly, lz);
            const sQuat = new THREE.Quaternion();
            if (sQuat.setFromEuler) sQuat.setFromEuler(new THREE.Euler(0, 0, rotZ));
            const sScl = new THREE.Vector3(sx, sy, 1);
            const mLocal = new THREE.Matrix4();
            if (mLocal.compose) mLocal.compose(sPos, sQuat, sScl);
            const mWorld = new THREE.Matrix4();
            if (mWorld.multiplyMatrices) mWorld.multiplyMatrices(mBoard, mLocal);
            return mWorld;
          };

          slatIM.setMatrixAt(slatIdx++, placeSlat(0, 1.15, 0.08, 0, 3.5, 0.08));
          slatIM.setMatrixAt(slatIdx++, placeSlat(0, -1.15, 0.08, 0, 3.5, 0.08));
          slatIM.setMatrixAt(slatIdx++, placeSlat(-1.75, 0, 0.08, 0, 0.08, 2.38));
          slatIM.setMatrixAt(slatIdx++, placeSlat(1.75, 0, 0.08, 0, 0.08, 2.38));

          let centers = [0];
          if (numGlyphs === 2) {
            centers = [-0.65, 0.65];
          } else if (numGlyphs === 3) {
            centers = [-1.1, 0, 1.1];
          }

          const flip = c.insideSign;
          for (const cx of centers) {
            for (const k of [-1, 1]) {
              slatIM.setMatrixAt(slatIdx++, placeSlat(
                cx + flip * -0.15,
                k * 0.38,
                0.08,
                flip * k * 0.7,
                1.2,
                0.32
              ));
            }
          }
        }

        const brakeBIs = [
          { bi: getWrappedIdx(c.entry - Math.round(100 / track.ds), N, track.closed), label: '100' },
          { bi: getWrappedIdx(c.entry - Math.round(50 / track.ds), N, track.closed), label: '50' }
        ];

        for (const bInfo of brakeBIs) {
          const bi = bInfo.bi;
          if (bi === -1 || !boardOk(track, bi, outside)) continue;
          const s = ss[bi];

          const p = V.addS(V.addS(s.p, s.r, outside * (s.w / 2 + 2.6)), s.u, 2.0);

          const basis = new THREE.Matrix4();
          if (basis.makeBasis) {
            basis.makeBasis(
              new THREE.Vector3(-s.r[0], -s.r[1], -s.r[2]),
              new THREE.Vector3(s.u[0], s.u[1], s.u[2]),
              new THREE.Vector3(-s.f[0], -s.f[1], -s.f[2])
            );
          }
          const qBoard = new THREE.Quaternion();
          if (qBoard.setFromRotationMatrix) qBoard.setFromRotationMatrix(basis);

          const mBoard = new THREE.Matrix4();
          if (mBoard.compose) {
            mBoard.compose(
              new THREE.Vector3(p[0], p[1], p[2]),
              qBoard,
              new THREE.Vector3(1, 1, 1)
            );
          }

          panelIM.setMatrixAt(boardIdx++, mBoard);

          const postTops = [
            [
              p[0] + s.r[0] * 1.0 - s.u[0] * 1.2,
              p[1] + s.r[1] * 1.0 - s.u[1] * 1.2,
              p[2] + s.r[2] * 1.0 - s.u[2] * 1.2
            ],
            [
              p[0] - s.r[0] * 1.0 - s.u[0] * 1.2,
              p[1] - s.r[1] * 1.0 - s.u[1] * 1.2,
              p[2] - s.r[2] * 1.0 - s.u[2] * 1.2
            ]
          ];

          for (const postTop of postTops) {
            const g = track.terrain ? DD.terrainAt(track.terrain, postTop[0], postTop[2]) : 0;
            const height = Math.max(0.1, postTop[1] - g);
            const yCenter = (postTop[1] + g) / 2;

            const mPost = new THREE.Matrix4();
            if (mPost.compose) {
              mPost.compose(
                new THREE.Vector3(postTop[0], yCenter, postTop[2]),
                new THREE.Quaternion(),
                new THREE.Vector3(1, height, 1)
              );
            }
            postIM.setMatrixAt(postIdx++, mPost);
          }

          const sPos = new THREE.Vector3(0, 0, 0.08);
          const sQuat = new THREE.Quaternion();
          const sScl = new THREE.Vector3(1, 1, 1);
          const mLocal = new THREE.Matrix4();
          if (mLocal.compose) mLocal.compose(sPos, sQuat, sScl);
          const mWorld = new THREE.Matrix4();
          if (mWorld.multiplyMatrices) mWorld.multiplyMatrices(mBoard, mLocal);

          if (bInfo.label === '100') {
            brake100IM.setMatrixAt(b100Idx++, mWorld);
          } else {
            brake50IM.setMatrixAt(b50Idx++, mWorld);
          }
        }
      }

      panelIM.instanceMatrix.needsUpdate = true;
      postIM.instanceMatrix.needsUpdate = true;
      slatIM.instanceMatrix.needsUpdate = true;

      group.add(panelIM);
      group.add(postIM);
      group.add(slatIM);

      if (brake100IM) {
        brake100IM.instanceMatrix.needsUpdate = true;
        brake100IM.frustumCulled = false;
        group.add(brake100IM);
      }
      if (brake50IM) {
        brake50IM.instanceMatrix.needsUpdate = true;
        brake50IM.frustumCulled = false;
        group.add(brake50IM);
      }
    }

    // Apex cones
    let totalCones = 0;
    for (const c of track.corners) {
      for (const offset of [-3, -1, 1, 3]) {
        const idx = getWrappedIdx(c.apex + offset, N, track.closed);
        if (coneOk(track, c, idx)) {
          totalCones++;
        }
      }
    }
    if (totalCones > 0) {
      const coneGeo = new THREE.ConeGeometry(0.25, 0.6, 8);
      coneGeo.translate(0, 0.3, 0);
      const coneMat = new THREE.MeshStandardMaterial({
        color: 0xff5500,
        roughness: 0.4,
        metalness: 0.1
      });
      const coneIM = new THREE.InstancedMesh(coneGeo, coneMat, totalCones);
      coneIM.castShadow = coneIM.receiveShadow = true;
      let coneIdx = 0;

      for (const c of track.corners) {
        const insideSign = c.insideSign;
        for (const offset of [-3, -1, 1, 3]) {
          const idx = getWrappedIdx(c.apex + offset, N, track.closed);
          if (!coneOk(track, c, idx)) continue;
          const s = ss[idx];

          const p = V.addS(s.p, s.r, insideSign * (s.w / 2 + 1.4));

          const basis = new THREE.Matrix4();
          if (basis.makeBasis) {
            basis.makeBasis(
              new THREE.Vector3(s.r[0], s.r[1], s.r[2]),
              new THREE.Vector3(s.u[0], s.u[1], s.u[2]),
              new THREE.Vector3(s.f[0], s.f[1], s.f[2])
            );
          }
          const qCone = new THREE.Quaternion().setFromRotationMatrix(basis);
          const mCone = new THREE.Matrix4();
          if (mCone.compose) {
            mCone.compose(
              new THREE.Vector3(p[0], p[1], p[2]),
              qCone,
              new THREE.Vector3(1, 1, 1)
            );
          }
          coneIM.setMatrixAt(coneIdx++, mCone);
        }
      }
      coneIM.instanceMatrix.needsUpdate = true;
      coneIM.frustumCulled = false;
      group.add(coneIM);
    }

    // Hazard chevrons
    const chevrons = buildHazardChevrons(track, theme);
    if (chevrons) group.add(chevrons);

    // Distance to finish boards
    const distanceBoards = buildDistanceBoards(track, theme);
    group.add(distanceBoards);

    // Keep non-instanced components (brake bars & apex beacons)
    for (const c of track.corners) {
      const outside = -c.insideSign;
      for (const dM of [80, 55, 30]) {
        const bi = c.entry - Math.round(dM / track.ds);
        const s = ss[bi];
        if (!s || s.gap || bi < 2) continue;
        const bar = new THREE.Mesh(new THREE.PlaneGeometry(s.w * 0.96, 1.1), barMat);
        const p = V.addS(s.p, s.u, DD.DECAL.decor);
        bar.position.set(p[0], p[1], p[2]);
        const m = new THREE.Matrix4().makeBasis(
          new THREE.Vector3(s.r[0], s.r[1], s.r[2]),
          new THREE.Vector3(s.f[0], s.f[1], s.f[2]),
          new THREE.Vector3(s.u[0], s.u[1], s.u[2]));
        bar.quaternion.setFromRotationMatrix(m);
        bar.rotateX(-Math.PI / 2);
        group.add(bar);
      }
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

  let _checkeredTexCache = null;
  function getCheckeredTexture() {
    if (_checkeredTexCache) return _checkeredTexCache;
    const cv = document.createElement('canvas'); cv.width = 128; cv.height = 32;
    const cx = cv.getContext('2d');
    const rows = 2;
    const cols = 8;
    const w = 128 / cols;
    const h = 32 / rows;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        cx.fillStyle = ((r + c) % 2 === 0) ? '#ffffff' : '#0a0518';
        cx.fillRect(c * w, r * h, w, h);
      }
    }
    const tex = new THREE.CanvasTexture(cv);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    _checkeredTexCache = tex;
    return tex;
  }

  let _startGridTexCache = {};
  function getStartGridTexture(theme) {
    const key = theme.accent.join(',');
    if (_startGridTexCache[key]) return _startGridTexCache[key];
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      if (ctx.fillRect) {
        ctx.fillStyle = '#08050e';
        ctx.fillRect(0, 0, 128, 256);
      }
      if (ctx.strokeRect) {
        ctx.strokeStyle = 'rgba(' + Math.round(theme.accent[0] * 255) + ',' + Math.round(theme.accent[1] * 255) + ',' + Math.round(theme.accent[2] * 255) + ', 0.9)';
        ctx.lineWidth = 6;
        ctx.strokeRect(3, 3, 122, 250);
      }
      if (ctx.beginPath && ctx.moveTo && ctx.lineTo && ctx.stroke) {
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
        ctx.lineWidth = 3;
        for (let y = 30; y < 250; y += 50) {
          ctx.beginPath();
          ctx.moveTo(15, y); ctx.lineTo(45, y);
          ctx.moveTo(83, y + 25); ctx.lineTo(113, y + 25);
          ctx.stroke();
        }
      }
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    _startGridTexCache[key] = tex;
    return tex;
  }

  function buildGates(track, theme, quality) {
    const group = new THREE.Group();
    const ss = track.samples;
    const N = ss.length;
    if (!N) return group;

    track.checkpointPlanes = [];

    const structMat = new THREE.MeshBasicMaterial({ color: 0x0c0a15, transparent: true, opacity: 0.92, fog: false });
    const glowMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });

    const ckptCount = (track.checkpoints || []).length;
    const totalGantries = ckptCount + 2; // +start +finish

    const structGeo = new THREE.BoxGeometry(1, 1, 1);
    
    const postIM = new THREE.InstancedMesh(structGeo, structMat, totalGantries * 4);
    const braceIM = new THREE.InstancedMesh(structGeo, structMat, totalGantries * 4);
    const barIM = new THREE.InstancedMesh(structGeo, structMat, totalGantries * 2);
    const postNeonIM = new THREE.InstancedMesh(structGeo, glowMat, totalGantries * 2);
    const barNeonIM = new THREE.InstancedMesh(structGeo, glowMat, totalGantries);

    const m = new THREE.Matrix4();
    let gi = 0, pi = 0, bri = 0, pni = 0, bni = 0;

    function placeGantry(idx, signText, signColor, isStart, isFinish, ckptIdx) {
      const s = ss[idx];
      if (!s) return;
      // +0.7: post columns used to be CENTERED on the road-edge line (±w/2) — half the column
      // stood inside the drivable width and cars clipped through it. Clear of the kerb band now.
      const halfW = s.w * 0.5 + 0.7;
      const postH = 4.2;
      const right = new THREE.Vector3(s.r[0], s.r[1], s.r[2]);
      const up = new THREE.Vector3(s.u[0], s.u[1], s.u[2]);
      const fwd = new THREE.Vector3(s.f[0], s.f[1], s.f[2]);
      const yaw = Math.atan2(s.f[0], s.f[2]);
      const pitch = Math.asin(s.f[1]);
      const roll = Math.atan2(s.r[1], s.r[0]);
      const e = new THREE.Euler().set(pitch, yaw, roll, 'YXZ');
      const quat = new THREE.Quaternion().setFromEuler(e);

      // left column post 1
      const lp1 = new THREE.Vector3(
        s.p[0] - right.x * halfW - fwd.x * 0.3 + up.x * postH * 0.5,
        s.p[1] - right.y * halfW - fwd.y * 0.3 + up.y * postH * 0.5,
        s.p[2] - right.z * halfW - fwd.z * 0.3 + up.z * postH * 0.5
      );
      m.compose(lp1, quat, new THREE.Vector3(0.15, postH, 0.15));
      postIM.setMatrixAt(pi++, m);

      // left column post 2
      const lp2 = new THREE.Vector3(
        s.p[0] - right.x * halfW + fwd.x * 0.3 + up.x * postH * 0.5,
        s.p[1] - right.y * halfW + fwd.y * 0.3 + up.y * postH * 0.5,
        s.p[2] - right.z * halfW + fwd.z * 0.3 + up.z * postH * 0.5
      );
      m.compose(lp2, quat, new THREE.Vector3(0.15, postH, 0.15));
      postIM.setMatrixAt(pi++, m);

      // right column post 1
      const rp1 = new THREE.Vector3(
        s.p[0] + right.x * halfW - fwd.x * 0.3 + up.x * postH * 0.5,
        s.p[1] + right.y * halfW - fwd.y * 0.3 + up.y * postH * 0.5,
        s.p[2] + right.z * halfW - fwd.z * 0.3 + up.z * postH * 0.5
      );
      m.compose(rp1, quat, new THREE.Vector3(0.15, postH, 0.15));
      postIM.setMatrixAt(pi++, m);

      // right column post 2
      const rp2 = new THREE.Vector3(
        s.p[0] + right.x * halfW + fwd.x * 0.3 + up.x * postH * 0.5,
        s.p[1] + right.y * halfW + fwd.y * 0.3 + up.y * postH * 0.5,
        s.p[2] + right.z * halfW + fwd.z * 0.3 + up.z * postH * 0.5
      );
      m.compose(rp2, quat, new THREE.Vector3(0.15, postH, 0.15));
      postIM.setMatrixAt(pi++, m);

      // diagonal braces for left column
      const angle = 0.14; // approx angle
      const lColCenter = new THREE.Vector3(
        s.p[0] - right.x * halfW + up.x * postH * 0.5,
        s.p[1] - right.y * halfW + up.y * postH * 0.5,
        s.p[2] - right.z * halfW + up.z * postH * 0.5
      );
      const qb1 = new THREE.Quaternion().copy(quat);
      if (qb1.multiply) qb1.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(angle, 0, 0)));
      m.compose(lColCenter, qb1, new THREE.Vector3(0.08, 4.24, 0.08));
      braceIM.setMatrixAt(bri++, m);

      const qb2 = new THREE.Quaternion().copy(quat);
      if (qb2.multiply) qb2.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(-angle, 0, 0)));
      m.compose(lColCenter, qb2, new THREE.Vector3(0.08, 4.24, 0.08));
      braceIM.setMatrixAt(bri++, m);

      // diagonal braces for right column
      const rColCenter = new THREE.Vector3(
        s.p[0] + right.x * halfW + up.x * postH * 0.5,
        s.p[1] + right.y * halfW + up.y * postH * 0.5,
        s.p[2] + right.z * halfW + up.z * postH * 0.5
      );
      const qb3 = new THREE.Quaternion().copy(quat);
      if (qb3.multiply) qb3.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(angle, 0, 0)));
      m.compose(rColCenter, qb3, new THREE.Vector3(0.08, 4.24, 0.08));
      braceIM.setMatrixAt(bri++, m);

      const qb4 = new THREE.Quaternion().copy(quat);
      if (qb4.multiply) qb4.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(-angle, 0, 0)));
      m.compose(rColCenter, qb4, new THREE.Vector3(0.08, 4.24, 0.08));
      braceIM.setMatrixAt(bri++, m);

      // crossbars
      const barCenter1 = new THREE.Vector3(
        s.p[0] + up.x * postH,
        s.p[1] + up.y * postH,
        s.p[2] + up.z * postH
      );
      m.compose(barCenter1, quat, new THREE.Vector3(s.w * 1.02 + 1.4, 0.2, 0.2));
      barIM.setMatrixAt(gi++, m);

      const barCenter2 = new THREE.Vector3(
        s.p[0] + up.x * (postH - 0.5),
        s.p[1] + up.y * (postH - 0.5),
        s.p[2] + up.z * (postH - 0.5)
      );
      m.compose(barCenter2, quat, new THREE.Vector3(s.w * 1.02 + 1.4, 0.15, 0.15));
      barIM.setMatrixAt(gi++, m);

      // neon vertical trims
      const lnPos = new THREE.Vector3(
        s.p[0] - right.x * (halfW - 0.08) + up.x * postH * 0.5,
        s.p[1] - right.y * (halfW - 0.08) + up.y * postH * 0.5,
        s.p[2] - right.z * (halfW - 0.08) + up.z * postH * 0.5
      );
      m.compose(lnPos, quat, new THREE.Vector3(0.03, postH, 0.06));
      postNeonIM.setMatrixAt(pni++, m);
      if (postNeonIM.setColorAt) postNeonIM.setColorAt(pni - 1, col(signColor));

      const rnPos = new THREE.Vector3(
        s.p[0] + right.x * (halfW - 0.08) + up.x * postH * 0.5,
        s.p[1] + right.y * (halfW - 0.08) + up.y * postH * 0.5,
        s.p[2] + right.z * (halfW - 0.08) + up.z * postH * 0.5
      );
      m.compose(rnPos, quat, new THREE.Vector3(0.03, postH, 0.06));
      postNeonIM.setMatrixAt(pni++, m);
      if (postNeonIM.setColorAt) postNeonIM.setColorAt(pni - 1, col(signColor));

      // horizontal neon trim
      const hnPos = new THREE.Vector3(
        s.p[0] + up.x * (postH + 0.11),
        s.p[1] + up.y * (postH + 0.11),
        s.p[2] + up.z * (postH + 0.11)
      );
      m.compose(hnPos, quat, new THREE.Vector3(s.w * 0.98 + 1.4, 0.04, 0.08));
      barNeonIM.setMatrixAt(bni++, m);
      if (barNeonIM.setColorAt) barNeonIM.setColorAt(bni - 1, col(signColor));

      if (isStart) {
        track.startLights = [];
        const lightGeo = new THREE.SphereGeometry(0.12, 8, 8);
        for (let i = 0; i < 5; i++) {
          const lightMat = new THREE.MeshBasicMaterial({ color: 0x221111, transparent: true, opacity: 0.8 });
          const lightMesh = new THREE.Mesh(lightGeo, lightMat);
          const offsetRatio = (i - 2) * 0.22;
          const bulbPos = new THREE.Vector3(
            s.p[0] + up.x * (postH - 0.45) + right.x * s.w * offsetRatio,
            s.p[1] + up.y * (postH - 0.45) + right.y * s.w * offsetRatio,
            s.p[2] + up.z * (postH - 0.45) + right.z * s.w * offsetRatio
          );
          lightMesh.position.copy(bulbPos);
          group.add(lightMesh);
          track.startLights.push(lightMesh);
        }

        // Build the 24-meter dark start slab + painted grid box lines (startIdx ± 6)
        const iMin = idx - 6;
        const iMax = idx + 6;
        const slabPos = [];
        const slabUvs = [];
        const slabIdx = [];
        let slabVi = 0;
        
        for (let i = iMin; i <= iMax; i++) {
          const wIdx = getWrappedIdx(i, N, track.closed);
          if (wIdx === -1) continue;
          const sSlab = ss[wIdx];
          
          const halfW = sSlab.w * 0.49;
          const pL = V.addS(V.addS(sSlab.p, sSlab.r, -halfW), sSlab.u, 0.02);
          const pR = V.addS(V.addS(sSlab.p, sSlab.r, halfW), sSlab.u, 0.02);
          
          slabPos.push(pL[0], pL[1], pL[2]);
          slabPos.push(pR[0], pR[1], pR[2]);
          
          const vCoord = (i - iMin) / 2.0; // repeats every 4 meters
          slabUvs.push(0, vCoord);
          slabUvs.push(1, vCoord);
          
          if (i > iMin) {
            const q = slabVi - 2;
            slabIdx.push(q, q + 1, q + 2, q + 1, q + 3, q + 2);
          }
          slabVi += 2;
        }
        
        if (slabPos.length > 0) {
          const slabGeo = new THREE.BufferGeometry();
          slabGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(slabPos), 3));
          slabGeo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(slabUvs), 2));
          slabGeo.setIndex(slabIdx);
          
          const slabCanvas = document.createElement('canvas');
          slabCanvas.width = 128;
          slabCanvas.height = 256;
          const slabCtx = slabCanvas.getContext('2d');
          if (slabCtx) {
            slabCtx.fillStyle = '#0a0812';
            slabCtx.fillRect(0, 0, 128, 256);
            slabCtx.strokeStyle = 'rgba(' + Math.round(theme.accent[0] * 255) + ',' + Math.round(theme.accent[1] * 255) + ',' + Math.round(theme.accent[2] * 255) + ', 0.6)';
            slabCtx.lineWidth = 4;
            slabCtx.strokeRect(10, 20, 45, 80);
            slabCtx.strokeRect(73, 140, 45, 80);
          }
          const slabTex = new THREE.CanvasTexture(slabCanvas);
          slabTex.wrapS = THREE.ClampToEdgeWrapping;
          slabTex.wrapT = THREE.RepeatWrapping;
          
          const slabMat = new THREE.MeshBasicMaterial({
            map: slabTex,
            transparent: true,
            opacity: 0.9,
            side: THREE.DoubleSide,
            depthWrite: true,
            polygonOffset: true,
            polygonOffsetFactor: -1.5,
            polygonOffsetUnits: -1.5
          });
          const slabMesh = new THREE.Mesh(slabGeo, slabMat);
          slabMesh.frustumCulled = false;
          group.add(slabMesh);
        }

        const gridPad = new THREE.Mesh(new THREE.PlaneGeometry(s.w * 0.96, 12),
          new THREE.MeshBasicMaterial({
            map: getStartGridTexture(theme),
            transparent: true,
            opacity: 0.82,
            fog: false,
            polygonOffset: true,
            polygonOffsetFactor: -1,
            polygonOffsetUnits: -1
          }));
        const padPos = new THREE.Vector3(s.p[0] + up.x * DD.DECAL.start, s.p[1] + up.y * DD.DECAL.start, s.p[2] + up.z * DD.DECAL.start);
        gridPad.position.copy(padPos);
        gridPad.lookAt(new THREE.Vector3(padPos.x + up.x, padPos.y + up.y, padPos.z + up.z));
        group.add(gridPad);
      }

      if (ckptIdx !== undefined) {
        track.checkpointLights = track.checkpointLights || {};
        track.checkpointLights[ckptIdx] = [];
        const lightGeo = new THREE.SphereGeometry(0.1, 8, 8);
        for (let i = 0; i < 3; i++) {
          const lightMat = new THREE.MeshBasicMaterial({ color: col(signColor), transparent: true, opacity: 0.8 });
          const lightMesh = new THREE.Mesh(lightGeo, lightMat);
          const offsetRatio = (i - 1) * 0.22;
          const bulbPos = new THREE.Vector3(
            s.p[0] + up.x * (postH - 0.45) + right.x * s.w * offsetRatio,
            s.p[1] + up.y * (postH - 0.45) + right.y * s.w * offsetRatio,
            s.p[2] + up.z * (postH - 0.45) + right.z * s.w * offsetRatio
          );
          lightMesh.position.copy(bulbPos);
          group.add(lightMesh);
          track.checkpointLights[ckptIdx].push(lightMesh);
        }
      }

      if (isFinish) {
        track.finishLights = [];
        const lightGeo = new THREE.SphereGeometry(0.12, 8, 8);
        for (let i = 0; i < 5; i++) {
          const lightMat = new THREE.MeshBasicMaterial({ color: 0x0055ff, transparent: true, opacity: 0.8 });
          const lightMesh = new THREE.Mesh(lightGeo, lightMat);
          const offsetRatio = (i - 2) * 0.22;
          const bulbPos = new THREE.Vector3(
            s.p[0] + up.x * (postH - 0.45) + right.x * s.w * offsetRatio,
            s.p[1] + up.y * (postH - 0.45) + right.y * s.w * offsetRatio,
            s.p[2] + up.z * (postH - 0.45) + right.z * s.w * offsetRatio
          );
          lightMesh.position.copy(bulbPos);
          group.add(lightMesh);
          track.finishLights.push(lightMesh);
        }

        const finishPos = new THREE.Vector3(s.p[0], s.p[1], s.p[2]);
        const stripe = new THREE.Mesh(new THREE.PlaneGeometry(s.w * 0.95, 1.6),
          new THREE.MeshBasicMaterial({
            map: getCheckeredTexture(),
            transparent: true,
            opacity: 0.85,
            fog: false,
            polygonOffset: true,
            polygonOffsetFactor: -1,
            polygonOffsetUnits: -1
          }));
        stripe.position.set(
          finishPos.x + up.x * DD.DECAL.finish,
          finishPos.y + up.y * DD.DECAL.finish,
          finishPos.z + up.z * DD.DECAL.finish
        );
        stripe.lookAt(new THREE.Vector3(
          finishPos.x + up.x,
          finishPos.y + up.y,
          finishPos.z + up.z
        ));
        group.add(stripe);
      }

      if (quality !== 'low') {
        addLightSource(track, [s.p[0] + up.x * 4, s.p[1] + up.y * 4, s.p[2] + up.z * 4], col(signColor), 4.5, s.w * 1.2);
      }
    }

    // checkpoints: numbered sector gates (T4)
    const ckpts = track.checkpoints || [];
    for (let i = 0; i < ckpts.length; i++) {
      let gateColor = theme.accent2;
      if (theme.biome === 'frozen') {
        gateColor = [0.85, 0.95, 1.0];
      } else if (theme.biome === 'canyon') {
        gateColor = [1.0, 0.6, 0.0];
      } else if (theme.biome === 'dune') {
        gateColor = [1.0, 0.9, 0.75];
      } else if (theme.biome === 'neon') {
        gateColor = [1.0, 0.0, 0.75];
      }
      placeGantry(ckpts[i], 'SECTOR ' + (i + 1), gateColor, false, false, i);
    }

    // start gantry (T3)
    placeGantry(track.startIdx || 2, 'START / SECTOR 0', theme.accent, true, false);

    // finish gantry (T3)
    placeGantry(track.finishIdx || (N - 3), 'FINISH', theme.boostColor || theme.accent, false, true);

    postIM.count = pi; braceIM.count = bri; barIM.count = gi;
    postNeonIM.count = pni; barNeonIM.count = bni;

    postIM.instanceMatrix.needsUpdate = true;
    braceIM.instanceMatrix.needsUpdate = true;
    barIM.instanceMatrix.needsUpdate = true;
    postNeonIM.instanceMatrix.needsUpdate = true;
    barNeonIM.instanceMatrix.needsUpdate = true;

    if (postNeonIM.instanceColor) postNeonIM.instanceColor.needsUpdate = true;
    if (barNeonIM.instanceColor) barNeonIM.instanceColor.needsUpdate = true;

    postIM.frustumCulled = false;
    braceIM.frustumCulled = false;
    barIM.frustumCulled = false;
    postNeonIM.frustumCulled = false;
    barNeonIM.frustumCulled = false;

    group.add(postIM);
    group.add(braceIM);
    group.add(barIM);
    group.add(postNeonIM);
    group.add(barNeonIM);

    track.postNeonIM = postNeonIM;
    track.barNeonIM = barNeonIM;
    track.flashingGantries = {};
    track.gateMeshes = [];
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
    const maxInstances = (baseCount + 1) * 3;
    const bodyInst = new THREE.InstancedMesh(bodyGeo, bodyMat, maxInstances);
    const glowInst = new THREE.InstancedMesh(glowGeo, glowMat, maxInstances);

    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
    const pos = new THREE.Vector3(), scl = new THREE.Vector3();
    const MIN_CLEAR = 16.0;

    const isNearCorner = (idx) => {
      if (!track.corners) return false;
      for (const c of track.corners) if (idx >= c.entry - 18 && idx <= c.end + 18) return true;
      return false;
    };

    let placedCount = 0;

    // Place a single monolith/pylon (dune/neon)
    const placeSingleStrip = (p, gy, w, h, yaw, roll, registerLight) => {
      e.set(0, yaw, roll); q.setFromEuler(e);
      pos.set(p[0], gy + h * 0.5, p[2]); scl.set(w, h, role === 'pylon' ? w : Math.max(w * 0.5, 1.0));
      m4.compose(pos, q, scl); bodyInst.setMatrixAt(placedCount, m4);
      
      const d = role === 'pylon' ? w : Math.max(w * 0.5, 1.0);
      const off = (role === 'pylon' ? w * 0.5 : d * 0.5) + 0.12;
      const facingX = Math.sin(yaw), facingZ = Math.cos(yaw);
      const gx = p[0] + facingX * off, gz = p[2] + facingZ * off, gyc = gy + h * 0.52;
      pos.set(gx, gyc, gz);
      scl.set(role === 'pylon' ? w * 0.16 : w * 0.24, h * 0.86, role === 'pylon' ? w * 0.16 : d * 0.3);
      m4.compose(pos, q, scl); glowInst.setMatrixAt(placedCount, m4);
      
      if (registerLight) addLightSource(track, [gx, gyc, gz], col(theme.accent2 || theme.accent), 1.1, 17.0);
      placedCount++;
    };

    // Place a single onbase element (canyon/frozen)
    const placeSingleOnbase = (p, gy, w, h, yaw, roll, registerLight) => {
      const baseH = Math.max(h * 0.14, 0.6);
      e.set(0, yaw, roll); q.setFromEuler(e);
      pos.set(p[0], gy + baseH * 0.5, p[2]); scl.set(w * 0.85, baseH, w * 0.85);
      m4.compose(pos, q, scl); bodyInst.setMatrixAt(placedCount, m4);
      
      const gyc = gy + baseH + h * (role === 'crystal' ? 0.25 : 0.5);
      e.set(0, rng.range(0, 6.2832), roll); q.setFromEuler(e);
      pos.set(p[0], gyc, p[2]); scl.set(w, role === 'crystal' ? h * 0.5 : h, w);
      m4.compose(pos, q, scl); glowInst.setMatrixAt(placedCount, m4);
      
      if (registerLight) addLightSource(track, [p[0], gyc, p[2]], col(theme.accent2 || theme.accent), 1.1, 17.0);
      placedCount++;
    };

    // Place a broken arch pair (dune only)
    const placeBrokenArchPair = (p, gy, w, h, yaw, registerLight) => {
      const facingX = Math.sin(yaw), facingZ = Math.cos(yaw);
      const perpX = -facingZ, perpZ = facingX;
      
      // Left monolith leaning right
      const pLeft = [p[0] - perpX * (w * 0.9), p[1], p[2] - perpZ * (w * 0.9)];
      const hLeft = h * 0.95;
      placeSingleStrip(pLeft, gy, w, hLeft, yaw, 0.22, registerLight);

      // Right monolith broken and shorter, leaning left
      const pRight = [p[0] + perpX * (w * 0.9), p[1], p[2] + perpZ * (w * 0.9)];
      const hRight = h * 0.65;
      placeSingleStrip(pRight, gy, w, hRight, yaw, -0.36, false);
    };

    // Place stacked billboard slabs (neon only)
    const placeStackedSlabs = (p, gy, w, h, yaw, registerLight) => {
      const hLower = h * 0.58;
      placeSingleStrip(p, gy, w, hLower, yaw, 0, registerLight);

      const hUpper = h * 0.38;
      const pUpper = [p[0], p[1], p[2]];
      placeSingleStrip(pUpper, gy + hLower, w * 0.78, hUpper, yaw, 0.16, false);
    };

    // Place leaning shard cluster (canyon only)
    const placeShardCluster = (p, gy, w, h, yaw, registerLight) => {
      const facingX = Math.sin(yaw), facingZ = Math.cos(yaw);
      const perpX = -facingZ, perpZ = facingX;

      // Shard 1 (Tall, center)
      placeSingleOnbase(p, gy, w, h, yaw, 0.08, registerLight);

      // Shard 2 (Medium, left)
      const pLeft = [
        p[0] - perpX * (w * 0.45) + facingX * (w * 0.1),
        p[1],
        p[2] - perpZ * (w * 0.45) + facingZ * (w * 0.1)
      ];
      placeSingleOnbase(pLeft, gy, w * 0.8, h * 0.7, yaw, -0.26, false);

      // Shard 3 (Small, right)
      const pRight = [
        p[0] + perpX * (w * 0.45) - facingX * (w * 0.1),
        p[1],
        p[2] + perpZ * (w * 0.45) - facingZ * (w * 0.1)
      ];
      placeSingleOnbase(pRight, gy, w * 0.65, h * 0.5, yaw, 0.32, false);
    };

    // Place aurora-lit needles (frozen only)
    const placeNeedles = (p, gy, w, h, yaw, registerLight) => {
      const facingX = Math.sin(yaw), facingZ = Math.cos(yaw);
      const perpX = -facingZ, perpZ = facingX;

      // Needle 1 (Tall, center)
      placeSingleOnbase(p, gy, w, h, yaw, -0.06, registerLight);

      // Needle 2 (Medium, left)
      const pLeft = [p[0] - perpX * (w * 0.38), p[1], p[2] - perpZ * (w * 0.38)];
      placeSingleOnbase(pLeft, gy, w * 0.82, h * 0.72, yaw, -0.28, false);

      // Needle 3 (Small, right)
      const pRight = [p[0] + perpX * (w * 0.38), p[1], p[2] + perpZ * (w * 0.38)];
      placeSingleOnbase(pRight, gy, w * 0.68, h * 0.54, yaw, 0.3, false);
    };

    const sizeFor = () => {
      if (role === 'monolith') return [rng.range(2.5, 5.5), rng.range(12, 42)];
      if (role === 'pylon')    return [rng.range(1.8, 3.6), rng.range(16, 48)];
      if (role === 'crystal')  return [rng.range(4, 11),    rng.range(8, 26)];
      return [rng.range(2.5, 6), rng.range(10, 30)]; // spike
    };

    // 1) Scatter
    for (let i = 0; i < baseCount; i++) {
      let s = null, sIdx = 0;
      for (let attempt = 0; attempt < 8; attempt++) {
        sIdx = rng.int(0, ss.length - 1);
        if (isNearCorner(sIdx) || rng.chance(0.2)) { s = ss[sIdx]; break; }
      }
      if (!s) { sIdx = rng.int(0, ss.length - 1); s = ss[sIdx]; }

      const inCorner = isNearCorner(sIdx);
      let sign = rng.sign();
      let off = inCorner ? (s.w / 2 + 3.0 + rng.range(0.5, 10.0)) : (s.w / 2 + 9.0 + rng.range(6.0, 26.0));
      let p = V.addS(V.clone(s.p), s.r, sign * off);

      // O3: Bias placement to canyon walls and dune ridges by searching for slopes
      if (T && (theme.biome === 'canyon' || theme.biome === 'dune')) {
        for (let attempt = 0; attempt < 8; attempt++) {
          const testOff = inCorner ? (s.w / 2 + 3.0 + rng.range(0.5, 20.0)) : (s.w / 2 + 9.0 + rng.range(6.0, 45.0));
          const testSign = rng.sign();
          const testP = V.addS(V.clone(s.p), s.r, testSign * testOff);
          const tn = DD.terrainNormal(T, testP[0], testP[2]);
          if (1.0 - tn[1] > 0.06) {
            off = testOff;
            sign = testSign;
            p = testP;
            break;
          }
        }
      }

      // Clearance vs EVERY track sample — resolved ITERATIVELY. The old code shoved a failing
      // pick 18 m outboard ONCE and never re-checked: the shoved spot regularly landed on a
      // DIFFERENT leg (hairpin returns, crossings) — the giant translucent spike mid-road bug.
      // Stride 3 (6 m): the old 12 m stride skipped past samples on tight curves. The vertical
      // test kills the sibling artifact — a tall spike planted in a valley piercing an elevated
      // deck above it ("cone peeking through the road").
      const [w, h] = sizeFor();
      const clearedAt = (pp) => {
        const gy = groundY(pp[0], pp[2]);
        for (let j = 0; j < ss.length; j += 3) {
          const sp = ss[j].p; const dx = pp[0] - sp[0], dz = pp[2] - sp[2];
          const d2 = dx * dx + dz * dz;
          if (d2 < MIN_CLEAR * MIN_CLEAR) return false;
          if (d2 < 26 * 26 && sp[1] > gy + 1.0 && sp[1] < gy + h + 3.0) return false;
        }
        return true;
      };
      // keep landmarks out of shortcut corridors — shove outboard if the pick sits in a cut
      if (track.shortcuts) {
        for (const cut of track.shortcuts) {
          const abx = cut.b[0] - cut.a[0], abz = cut.b[2] - cut.a[2];
          const t = DD.clamp(((p[0] - cut.a[0]) * abx + (p[2] - cut.a[2]) * abz) / cut.len2, 0, 1);
          const dx = p[0] - (cut.a[0] + abx * t), dz = p[2] - (cut.a[2] + abz * t);
          if (dx * dx + dz * dz < 14 * 14) { off += 34.0; p = V.addS(V.clone(s.p), s.r, sign * off); break; }
        }
      }
      let shoves = 0;
      while (!clearedAt(p) && shoves < 4) { off += 18.0; p = V.addS(V.clone(s.p), s.r, sign * off); shoves++; }
      if (!clearedAt(p)) continue; // nowhere clean on this ray — skip the landmark entirely

      const gy = groundY(p[0], p[2]);
      const facing = V.norm([-sign * s.r[0], 0, -sign * s.r[2]]);
      const yaw = Math.atan2(facing[0], facing[2]);
      const registerLight = placedCount < 10 && off < s.w / 2 + 13.0 && quality !== 'low';

      if (rng.chance(0.35)) {
        if (theme.biome === 'dune') {
          placeBrokenArchPair(p, gy, w, h, yaw, registerLight);
        } else if (theme.biome === 'neon') {
          placeStackedSlabs(p, gy, w, h, yaw, registerLight);
        } else if (theme.biome === 'canyon') {
          placeShardCluster(p, gy, w, h, yaw, registerLight);
        } else {
          placeNeedles(p, gy, w, h, yaw, registerLight);
        }
      } else {
        if (comp === 'strip') {
          placeSingleStrip(p, gy, w, h, yaw, 0, registerLight);
        } else {
          placeSingleOnbase(p, gy, w, h, yaw, 0, registerLight);
        }
      }
    }

    // 2) One dramatic "hero" landmark on the horizon
    const heroSample = ss[Math.floor(ss.length * 0.62)];
    const heroSign = rng.sign();
    const heroP = V.addS(V.clone(heroSample.p), heroSample.r, heroSign * 430.0);
    const heroGy = groundY(heroP[0], heroP[2]);
    const heroFacing = V.norm([-heroSign * heroSample.r[0], 0, -heroSign * heroSample.r[2]]);
    const heroYaw = Math.atan2(heroFacing[0], heroFacing[2]);
    const heroW = comp === 'strip' ? 40 : 58;
    const heroH = comp === 'strip' ? 210 : 150;
    
    if (theme.biome === 'dune') {
      placeBrokenArchPair(heroP, heroGy, heroW, heroH, heroYaw, false);
    } else if (theme.biome === 'neon') {
      placeStackedSlabs(heroP, heroGy, heroW, heroH, heroYaw, false);
    } else if (theme.biome === 'canyon') {
      placeShardCluster(heroP, heroGy, heroW, heroH, heroYaw, false);
    } else {
      placeNeedles(heroP, heroGy, heroW, heroH, heroYaw, false);
    }

    bodyInst.instanceMatrix.needsUpdate = true;
    glowInst.instanceMatrix.needsUpdate = true;
    bodyInst.count = placedCount;
    glowInst.count = placedCount;
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
      // never plant a pole in a re-entry apron / shortcut mouth (it IS the drive-off path)
      if (s.apron && s.apron * side > 0) { side = -side; continue; }
      // pole foot must be clear of every OTHER leg — verge of span A can be the deck of span B
      const edge = s.w / 2 + 2.0;
      if (!clearOfTrack(track, s.p[0] + s.r[0] * side * edge, s.p[2] + s.r[2] * side * edge, i, 7)) { side = -side; continue; }
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
      if (height <= 4.5) continue;
      // overunder guard: a pier for the UPPER deck must not skewer a lower deck it crosses —
      // if any other-arc sample's deck sits between the ground and this deck within reach of
      // the column, skip the pier (short unsupported bridge spans read fine).
      let skewers = false;
      for (let j = 0; j < ss.length && !skewers; j += 3) {
        let di = Math.abs(j - i);
        if (track.closed) di = Math.min(di, ss.length - di);
        if (di < 30) continue;
        const dx = s.p[0] - ss[j].p[0], dz = s.p[2] - ss[j].p[2];
        if (dx * dx + dz * dz < 6 * 6 && ss[j].p[1] > gY + 0.5 && ss[j].p[1] < s.p[1] - 1.0) skewers = true;
      }
      if (skewers) continue;
      piers.push({ s, gY, height });
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
      // straight-ish spans only: the arch is a rigid straight frame built off ONE sample —
      // mid-curve the deck sweeps into its posts (the "pole in the middle of the road" bug)
      const iA = Math.max(0, i - 4), iB = Math.min(ss.length - 1, i + 4);
      if (Math.abs(DD.angleDiff(ss[iA].yaw, ss[iB].yaw)) > 0.14) continue;
      if (!isSpawningSafe(i, track)) continue; // aprons/shortcut mouths are drive-off paths
      // both post feet must be clear of every OTHER track leg (hairpin returns, crossings)
      const hw = s.w / 2 + 0.6;
      if (!clearOfTrack(track, s.p[0] + s.r[0] * hw, s.p[2] + s.r[2] * hw, i, 9)) continue;
      if (!clearOfTrack(track, s.p[0] - s.r[0] * hw, s.p[2] - s.r[2] * hw, i, 9)) continue;
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

    // Glowing pool on road surface under the arches
    const poolGeo = new THREE.CircleGeometry(1, 16);
    const poolMat = new THREE.MeshBasicMaterial({ color: col(theme.accent), transparent: true, opacity: DD.GLOW.archPool, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    
    const N = candidates.length;
    const posts = new THREE.InstancedMesh(postGeo, postMat, N * 4);
    const crossbars = new THREE.InstancedMesh(beamGeo, beamMat, N);
    const brackets = new THREE.InstancedMesh(bracketGeo, beamMat, N * 2);
    const neons = new THREE.InstancedMesh(neonGeo, neonMat, N);
    const pools = new THREE.InstancedMesh(poolGeo, poolMat, N);
    posts.castShadow = posts.receiveShadow = true;
    crossbars.castShadow = crossbars.receiveShadow = true;
    brackets.castShadow = brackets.receiveShadow = true;

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

    let pi = 0, bi = 0;
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
    for (const im of [posts, crossbars, brackets, neons, pools]) {
      im.instanceMatrix.needsUpdate = true;
      im.frustumCulled = false;
      group.add(im);
    }
    return group;
  }

  // buildGatesV2 removed, integrated into buildGates above


  function buildHorizonMountains(track, theme, rng) {
    const group = new THREE.Group();
    const numLayers = 4;
    const numMountains = 30;

    const coneGeo = new THREE.ConeGeometry(1, 1, 5);
    coneGeo.translate(0, 0.5, 0);

    const colors = [
      col([theme.skyBottom[0] * 0.22, theme.skyBottom[1] * 0.22, theme.skyBottom[2] * 0.28]),
      col([theme.skyBottom[0] * 0.14, theme.skyBottom[1] * 0.14, theme.skyBottom[2] * 0.20]),
      col([theme.skyBottom[0] * 0.08, theme.skyBottom[1] * 0.08, theme.skyBottom[2] * 0.12]),
      col([theme.skyBottom[0] * 0.05, theme.skyBottom[1] * 0.05, theme.skyBottom[2] * 0.09])
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

  /* ---------------- GODRAYS — far-parallax light shafts, depth-occluded by terrain ----------------
     NOT a fullscreen post pass (fill-bound GPU = expensive). Geometry shafts hung high in the far
     sky near the sun azimuth, raking down toward the horizon. depthTest stays ON so foreground
     ridges/decor EAT the shaft bases — that occlusion is what reads as volumetric instead of a
     floating transparent quad. Camera-followed like the planet so they hold their far parallax. */
  function buildGodrays(track, theme) {
    const group = new THREE.Group();
    const tex = getAuroraTexture();                         // soft 0→1→0 gradient along length
    const rayCol = V.lerp(theme.accent2, [1, 1, 1], 0.6);   // warm-white shaft
    const N = 5;
    for (let i = 0; i < N; i++) {
      const clonedTex = tex.clone(); clonedTex.needsUpdate = true;
      const mat = new THREE.MeshBasicMaterial({
        color: col(rayCol), map: clonedTex, transparent: true,
        opacity: 0.06, blending: THREE.AdditiveBlending,
        depthWrite: false, side: THREE.DoubleSide, fog: false
      });
      const t = i / (N - 1) - 0.5;                          // -0.5..0.5 fan across the sky
      const geo = new THREE.PlaneGeometry(70 + Math.abs(t) * 45, 1500);
      const m = new THREE.Mesh(geo, mat);
      m.position.set(t * 520 + Math.sin(theme.lightAngle) * 260, 360, -1150);
      m.rotation.set(-0.55, t * 0.6, t * 0.9);              // rake down + fan outward
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


  /* ---------------- RE-ENTRY APRONS (masterplan 2.1) ----------------
     Faint glow wedge ramping from the deck edge onto the flush terrain — widens with apron
     strength so the span reads as an invitation (the edge glow itself gaps in scene-core). */
  function buildAprons(track, theme) {
    const T = track.terrain;
    if (!T) return null;
    const group = new THREE.Group();
    for (const side of [1, -1]) {
      const strip = buildStrip(track, theme, (s) => {
        if (s.gap || !s.apron || s.apron * side <= 0) return null;
        const k = Math.abs(s.apron);
        const inner = V.addS(V.addS(s.p, s.r, side * (s.w / 2 + 0.2)), s.u, 0.04);
        const oP = V.addS(s.p, s.r, side * (s.w / 2 + 0.5 + 3.4 * k));
        return [inner, [oP[0], DD.terrainAt(T, oP[0], oP[2]) + 0.07, oP[2]]];
      }, V.lerp(theme.accent, [1, 1, 1], 0.2), 0.28, THREE.AdditiveBlending);
      if (strip) group.add(strip);
    }
    return group.children.length ? group : null;
  }

  /* ---------------- DIRT SHORTCUTS (masterplan 2.2) ----------------
     Cone gates flanking each corridor mouth + a dark tire-mark decal leading in. The corridor
     itself is carved into the heightfield by trackgen; this is just the signage. */
  function buildShortcutDecor(track, theme) {
    const cuts = track.shortcuts;
    const T = track.terrain;
    if (!cuts || !cuts.length || !T) return null;
    const group = new THREE.Group();
    const coneGeo = new THREE.ConeGeometry(0.42, 1.15, 7); // origin at centre; instances offset +h/2
    const coneMat = new THREE.MeshStandardMaterial({
      color: col([0.08, 0.07, 0.1]), roughness: 0.6, metalness: 0.1,
      emissive: col(theme.accent2), emissiveIntensity: 1.4
    });
    const cones = new THREE.InstancedMesh(coneGeo, coneMat, cuts.length * 8);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1), pos = new THREE.Vector3();
    let ci = 0;
    const markPos = [], markIdx = [];
    let mvi = 0;
    for (const cut of cuts) {
      const dir = V.norm([cut.b[0] - cut.a[0], 0, cut.b[2] - cut.a[2]]);
      const perp = [-dir[2], 0, dir[0]];
      for (const [end, sgn] of [[cut.a, 1], [cut.b, -1]]) {
        for (const pSide of [1, -1]) {
          for (const along of [2.0, 8.0]) {
            const px = end[0] + perp[0] * pSide * 5.2 + dir[0] * sgn * along;
            const pz = end[2] + perp[2] * pSide * 5.2 + dir[2] * sgn * along;
            m4.compose(pos.set(px, DD.terrainAt(T, px, pz) + 0.575, pz), q, one);
            cones.setMatrixAt(ci++, m4);
          }
        }
      }
      // tire-mark decal chain along the WHOLE corridor (findability — mouth-only marks were
      // invisible from the road): dark segmented strip hugging the terrain, a-to-b
      const len = Math.sqrt(cut.len2);
      const segN = Math.max(3, Math.round(len / 8));
      for (let si = 0; si <= segN; si++) {
        const t = si / segN;
        const cx = cut.a[0] + (cut.b[0] - cut.a[0]) * t;
        const cz = cut.a[2] + (cut.b[2] - cut.a[2]) * t;
        for (const dPerp of [-1.3, 1.3]) {
          const mx = cx + perp[0] * dPerp, mz = cz + perp[2] * dPerp;
          markPos.push(mx, DD.terrainAt(T, mx, mz) + 0.06, mz);
        }
        if (si > 0) {
          markIdx.push(mvi - 2, mvi - 1, mvi, mvi - 1, mvi + 1, mvi);
        }
        mvi += 2;
      }
    }
    cones.count = ci;
    cones.instanceMatrix.needsUpdate = true;
    cones.frustumCulled = false;
    group.add(cones);
    const markGeo = new THREE.BufferGeometry();
    markGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(markPos), 3));
    markGeo.setIndex(markIdx);
    const markMat = new THREE.MeshBasicMaterial({
      color: col([0.02, 0.02, 0.03]), transparent: true, opacity: 0.55, side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1
    });
    const marks = new THREE.Mesh(markGeo, markMat);
    marks.frustumCulled = false;
    group.add(marks);
    return group;
  }

  // (fake-fork median islands removed after Tibba playtest — bollards mid-road were an
  //  annoyance and clipped through banked decks; masterplan 2.3 retired in session 28)

  // Register on DD._sceneShared
  DD._sceneShared.buildSky = buildSky;
  DD._sceneShared.buildStars = buildStars;
  DD._sceneShared.buildTerrain = buildTerrain;
  DD._sceneShared.buildTerrainGrid = buildTerrainGrid;
  DD._sceneShared.buildRibbon = buildRibbon;
  DD._sceneShared.buildRoadBody = buildRoadBody;
  DD._sceneShared.buildStrip = buildStrip;
  DD._sceneShared.buildKerbs = buildKerbs;
  DD._sceneShared.buildAprons = buildAprons;
  DD._sceneShared.buildShortcutDecor = buildShortcutDecor;
  DD._sceneShared.buildCornerSigns = buildCornerSigns;
  DD._sceneShared.buildGates = buildGates;
  DD._sceneShared.buildDecor = buildDecor;
  DD._sceneShared.buildEmissiveElements = buildEmissiveElements;
  DD._sceneShared.buildLightPoles = buildLightPoles;
  DD._sceneShared.buildNeonProps = buildNeonProps;
  DD._sceneShared.buildSupportPillars = buildSupportPillars;
  DD._sceneShared.buildNeonArches = buildNeonArches;
  DD._sceneShared.buildBoostPads = buildBoostPads;
  DD._sceneShared.buildHorizonMountains = buildHorizonMountains;
  DD._sceneShared.buildNebulae = buildNebulae;
  DD._sceneShared.getAuroraTexture = getAuroraTexture;
  DD._sceneShared.buildAurora = buildAurora;
  DD._sceneShared.buildGodrays = buildGodrays;
  DD._sceneShared.buildSciFiPlanet = buildSciFiPlanet;

  function buildBoostPads(track, theme) {
    const group = new THREE.Group();
    const ss = track.samples;
    const runs = [];
    let start = -1;
    for (let i = 0; i < ss.length; i++) {
      if (ss[i].surf === DD.SURF.BOOST) {
        if (start === -1) start = i;
      } else {
        if (start !== -1) {
          runs.push({ start, end: i - 1 });
          start = -1;
        }
      }
    }
    if (start !== -1) {
      runs.push({ start, end: ss.length - 1 });
    }

    if (runs.length === 0) return group;

    let totalChevrons = 0;
    const padData = [];

    runs.forEach(run => {
      const len = run.end - run.start + 1;
      const numChevrons = Math.max(2, Math.floor(len / 6));
      totalChevrons += numChevrons;
      padData.push({
        run,
        numChevrons,
        chevrons: []
      });
    });

    const boostCol = col(theme.boostColor || [0, 1, 0.5]);
    const baseMat = new THREE.MeshStandardMaterial({
      color: 0x0a0715,
      emissive: boostCol,
      emissiveIntensity: 0.18,
      roughness: 0.5,
      metalness: 0.8,
      transparent: true,
      opacity: 0.9,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1
    });

    const chevronMat = new THREE.MeshBasicMaterial({
      color: boostCol,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });

    const baseGeo = new THREE.BoxGeometry(1, 0.03, 1);
    const chevronGeo = new THREE.ConeGeometry(0.35, 1.0, 3);

    const baseInst = new THREE.InstancedMesh(baseGeo, baseMat, runs.length);
    const chevronInst = new THREE.InstancedMesh(chevronGeo, chevronMat, totalChevrons);

    const haloGeo = new THREE.PlaneGeometry(1, 1);
    const haloMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      map: getDotTexture ? getDotTexture() : null,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2
    });
    const haloInst = new THREE.InstancedMesh(haloGeo, haloMat, runs.length);
    group.add(haloInst);
    track.boostHaloInst = haloInst;

    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
    const pos = new THREE.Vector3(), scl = new THREE.Vector3();

    runs.forEach((run, idx) => {
      const midIdx = Math.floor((run.start + run.end) / 2);
      const sMid = ss[midIdx];
      const startP = ss[run.start].p;
      const endP = ss[run.end].p;
      const dist = V.dist(startP, endP);

      pos.set(sMid.p[0], sMid.p[1] + DD.DECAL.boost, sMid.p[2]);

      const yaw = Math.atan2(sMid.f[0], sMid.f[2]);
      const pitch = Math.asin(sMid.f[1]);
      const roll = Math.atan2(sMid.r[1], sMid.r[0]);
      q.setFromEuler(e.set(pitch, yaw, roll, 'YXZ'));

      scl.set(sMid.w * 0.65, 1.0, dist + 2.0);

      m4.compose(pos, q, scl);
      baseInst.setMatrixAt(idx, m4);

      if (idx < 8) {
        const light = {
          pos: [sMid.p[0], sMid.p[1] + 1.2, sMid.p[2]],
          color: boostCol,
          intensity: 0.0,
          distance: 16.0
        };
        (track._lightSources || (track._lightSources = [])).push(light);
        padData[idx].lightSource = light;
      }
    });

    group.add(baseInst);
    group.add(chevronInst);
    track.boostChevronInst = chevronInst;
    track.boostBaseMat = baseMat;
    track.boostChevronMat = chevronMat;

    let chevGlobalIdx = 0;
    padData.forEach(pad => {
      for (let c = 0; c < pad.numChevrons; c++) {
        const initialProgress = c / pad.numChevrons;
        pad.chevrons.push({
          globalIdx: chevGlobalIdx++,
          progress: initialProgress
        });
      }
    });

    track.boostPadsData = padData;
    return group;
  }

  function buildLandingPads(track, theme) {
    const group = new THREE.Group();
    const ss = track.samples;
    const runs = [];
    let start = -1;
    for (let i = 0; i < ss.length; i++) {
      if (ss[i].landing) {
        if (start === -1) start = i;
      } else {
        if (start !== -1) {
          runs.push({ start, end: i - 1 });
          start = -1;
        }
      }
    }
    if (start !== -1) {
      runs.push({ start, end: ss.length - 1 });
    }

    if (runs.length === 0) return group;

    const landCol = col(theme.accent2 || [1, 0, 0.5]);
    const baseMat = new THREE.MeshStandardMaterial({
      color: 0x0f0b1a,
      emissive: landCol,
      emissiveIntensity: 0.2,
      roughness: 0.6,
      metalness: 0.6,
      transparent: true,
      opacity: 0.85,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1
    });

    const targetMat = new THREE.MeshBasicMaterial({
      color: landCol,
      transparent: true,
      opacity: 0.8,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });

    const baseGeo = new THREE.BoxGeometry(1, 0.02, 1);
    const arrowGeo = new THREE.ConeGeometry(0.4, 1.2, 3);

    let totalArrows = 0;
    runs.forEach(run => {
      const len = run.end - run.start + 1;
      totalArrows += Math.floor(len / 3);
    });

    const baseInst = new THREE.InstancedMesh(baseGeo, baseMat, runs.length);
    const arrowInst = new THREE.InstancedMesh(arrowGeo, targetMat, totalArrows);

    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
    const pos = new THREE.Vector3(), scl = new THREE.Vector3();
    let ai = 0;

    runs.forEach((run, idx) => {
      const midIdx = Math.floor((run.start + run.end) / 2);
      const sMid = ss[midIdx];
      const startP = ss[run.start].p;
      const endP = ss[run.end].p;
      const dist = V.dist(startP, endP);

      pos.set(sMid.p[0], sMid.p[1] + DD.DECAL.landing, sMid.p[2]);

      const yaw = Math.atan2(sMid.f[0], sMid.f[2]);
      const pitch = Math.asin(sMid.f[1]);
      const roll = Math.atan2(sMid.r[1], sMid.r[0]);
      q.setFromEuler(e.set(pitch, yaw, roll, 'YXZ'));

      scl.set(sMid.w * 0.82, 1.0, dist + 1.0);
      m4.compose(pos, q, scl);
      baseInst.setMatrixAt(idx, m4);

      for (let k = run.start; k <= run.end; k++) {
        if ((k - run.start) % 3 === 0 && ai < totalArrows) {
          const s = ss[k];
          pos.set(s.p[0], s.p[1] + (DD.DECAL.landing + 0.02), s.p[2]);
          const kYaw = Math.atan2(s.f[0], s.f[2]);
          const kPitch = Math.asin(s.f[1]);
          const kRoll = Math.atan2(s.r[1], s.r[0]);
          q.setFromEuler(e.set(kPitch, kYaw, kRoll, 'YXZ'));
          const localRot = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);
          q.multiply(localRot);
          scl.set(s.w * 0.5 * 2.2, 0.05, 1.0);

          m4.compose(pos, q, scl);
          arrowInst.setMatrixAt(ai++, m4);
        }
      }
    });

    baseInst.instanceMatrix.needsUpdate = true;
    arrowInst.instanceMatrix.needsUpdate = true;
    group.add(baseInst);
    group.add(arrowInst);
    track.landingChevronInst = arrowInst;

    return group;
  }

  function updateLandingPads(track, t) {
    if (!track || !track.landingChevronInst) return;
    const osc = 0.55 + Math.sin(t * 0.008) * 0.3;
    track.landingChevronInst.material.opacity = osc;
  }

  function buildTunnels(track, theme, quality) {
    const group = new THREE.Group();
    const ss = track.samples;
    const N = ss.length;
    if (N < 50) return group;

    const rng = DD.makeRng(track.seed + '::tunnels');
    const biome = theme.biome || 'neon';
    let maxTunnels = 1;
    let prob = 0.15;
    if (biome === 'neon') { maxTunnels = 3; prob = 0.35; }
    else if (biome === 'canyon') { maxTunnels = 2; prob = 0.22; }
    else if (biome === 'frozen' || biome === 'dune') { maxTunnels = 1; prob = 0.10; }

    const tunnelRanges = [];
    let i = 25;
    while (i < N - 25 && tunnelRanges.length < maxTunnels) {
      const rangeLen = 16;
      let valid = true;
      for (let k = 0; k < rangeLen; k++) {
        const idx = i + k;
        const s = ss[idx];
        if (!s) { valid = false; break; }
        if (track.checkpoints && track.checkpoints.includes(idx)) { valid = false; break; }
        if (idx > 0) {
          const dot = V.dot(s.f, ss[idx - 1].f);
          if (dot < 0.993) { valid = false; break; }
        }
        if (Math.abs(s.f[1]) > 0.15) { valid = false; break; }
      }

      if (valid && rng.range(0, 1) < prob) {
        tunnelRanges.push({ start: i, end: i + rangeLen });
        i += rangeLen + 30;
      } else {
        i += 4;
      }
    }

    if (tunnelRanges.length === 0) return group;

    let totalRings = 0;
    tunnelRanges.forEach(r => {
      const len = r.end - r.start + 1;
      totalRings += Math.floor(len / 2);
    });

    const ringCol = col(theme.accent);
    const ringMat = new THREE.MeshStandardMaterial({
      color: 0x080610,
      emissive: ringCol,
      emissiveIntensity: 1.5,
      roughness: 0.4,
      metalness: 0.8
    });

    const unitBox = new THREE.BoxGeometry(1, 1, 1);
    const ringInst = new THREE.InstancedMesh(unitBox, ringMat, totalRings * 3);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
    const pos = new THREE.Vector3(), scl = new THREE.Vector3();
    let ri = 0;

    tunnelRanges.forEach(range => {
      const posAttr = [];
      const indices = [];

      for (let idx = range.start; idx <= range.end; idx++) {
        const s = ss[idx];
        const halfW = s.w * 0.5;
        const postH = 4.2;
        const right = { x: s.r[0], y: s.r[1], z: s.r[2] };
        const up = { x: s.u[0], y: s.u[1], z: s.u[2] };
        const yaw = Math.atan2(s.f[0], s.f[2]);
        const pitch = Math.asin(s.f[1]);
        const roll = Math.atan2(s.r[1], s.r[0]);
        const quat = new THREE.Quaternion().setFromEuler(e.set(pitch, yaw, roll, 'YXZ'));

        const lp = new THREE.Vector3(s.p[0] - right.x * halfW, s.p[1] - right.y * halfW, s.p[2] - right.z * halfW);
        const rp = new THREE.Vector3(s.p[0] + right.x * halfW, s.p[1] + right.y * halfW, s.p[2] + right.z * halfW);
        const lpt = new THREE.Vector3(lp.x + up.x * postH, lp.y + up.y * postH, lp.z + up.z * postH);
        const rpt = new THREE.Vector3(rp.x + up.x * postH, rp.y + up.y * postH, rp.z + up.z * postH);

        posAttr.push(lp.x, lp.y, lp.z);
        posAttr.push(lpt.x, lpt.y, lpt.z);
        posAttr.push(rpt.x, rpt.y, rpt.z);
        posAttr.push(rp.x, rp.y, rp.z);

        if (idx > range.start) {
          const k0 = 4 * (idx - range.start - 1);
          const k1 = 4 * (idx - range.start);
          indices.push(k0 + 0, k0 + 1, k1 + 0);
          indices.push(k1 + 0, k0 + 1, k1 + 1);
          indices.push(k0 + 1, k0 + 2, k1 + 1);
          indices.push(k1 + 1, k0 + 2, k1 + 2);
          indices.push(k0 + 2, k0 + 3, k1 + 2);
          indices.push(k1 + 2, k0 + 3, k1 + 3);
        }

        if ((idx - range.start) % 2 === 0) {
          const lColPos = new THREE.Vector3(lp.x + up.x * postH * 0.5, lp.y + up.y * postH * 0.5, lp.z + up.z * postH * 0.5);
          m4.compose(lColPos, quat, new THREE.Vector3(0.3, postH, 0.4));
          ringInst.setMatrixAt(ri++, m4);

          const rColPos = new THREE.Vector3(rp.x + up.x * postH * 0.5, rp.y + up.y * postH * 0.5, rp.z + up.z * postH * 0.5);
          m4.compose(rColPos, quat, new THREE.Vector3(0.3, postH, 0.4));
          ringInst.setMatrixAt(ri++, m4);

          const rBeamPos = new THREE.Vector3(lpt.x + right.x * halfW, lpt.y + right.y * halfW, lpt.z + right.z * halfW);
          const rBeamQuat = new THREE.Quaternion().copy(quat);
          m4.compose(rBeamPos, rBeamQuat, new THREE.Vector3(s.w * 1.02, 0.3, 0.4));
          ringInst.setMatrixAt(ri++, m4);
        }

        if ((idx - range.start) % 6 === 3 && quality !== 'low') {
          const lightP = new THREE.Vector3(lpt.x + right.x * halfW + up.x * -0.4, lpt.y + right.y * halfW + up.y * -0.4, lpt.z + right.z * halfW + up.z * -0.4);
          addLightSource(track, [lightP.x, lightP.y, lightP.z], col(theme.accent), 2.2, s.w * 1.2);
        }
      }

      const roofGeo = new THREE.BufferGeometry();
      roofGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(posAttr), 3));
      roofGeo.setIndex(indices);
      roofGeo.computeVertexNormals();

      const roofMat = new THREE.MeshStandardMaterial({
        color: 0x07040e,
        roughness: 0.7,
        metalness: 0.3,
        transparent: true,
        opacity: 0.78,
        side: THREE.DoubleSide
      });
      const roofMesh = new THREE.Mesh(roofGeo, roofMat);
      group.add(roofMesh);
    });

    ringInst.count = ri;
    ringInst.instanceMatrix.needsUpdate = true;
    ringInst.frustumCulled = false;
    group.add(ringInst);

    return group;
  }

  function updateBoostPads(track, dt, car) {
    if (!track || !track.boostPadsData || !track.boostChevronInst) return;
    const ss = track.samples;
    const chevronInst = track.boostChevronInst;

    track.boostPadTime = (track.boostPadTime || 0) + dt;
    if (track.boostChevronMat) {
      track.boostChevronMat.opacity = 0.55 + 0.4 * Math.sin(track.boostPadTime * 6.0);
    }

    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
    const pos = new THREE.Vector3(), scl = new THREE.Vector3();
    const qPlane = new THREE.Quaternion(), localRot = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);

    const boostCol = new THREE.Color().copy(chevronInst.material.color);
    const cTemp = new THREE.Color();

    track.boostPadsData.forEach((pad, idx) => {
      const run = pad.run;
      const midIdx = Math.floor((run.start + run.end) / 2);
      const sMid = ss[midIdx];
      const startP = ss[run.start].p;
      const endP = ss[run.end].p;
      const dist = V.dist(startP, endP);

      let smoothGlow = 0;
      if (car) {
        const dx = car.pos[0] - sMid.p[0];
        const dz = car.pos[2] - sMid.p[2];
        const d = Math.hypot(dx, dz);
        const normD = DD.clamp((d - 20) / (120 - 20), 0, 1);
        const approachGlow = 1.0 - normD;
        smoothGlow = approachGlow * approachGlow * (3.0 - 2.0 * approachGlow);
      }

      if (pad.lightSource) {
        pad.lightSource.intensity = smoothGlow * 1.4;
      }

      if (track.boostHaloInst) {
        pos.set(sMid.p[0], sMid.p[1] + (DD.DECAL.boost + 0.04), sMid.p[2]);

        const yaw = Math.atan2(sMid.f[0], sMid.f[2]);
        const pitch = Math.asin(sMid.f[1]);
        const roll = Math.atan2(sMid.r[1], sMid.r[0]);
        q.setFromEuler(e.set(pitch, yaw, roll, 'YXZ'));

        qPlane.copy(q).multiply(localRot);

        const scaleFactor = 1.0 + smoothGlow * 0.45;
        scl.set(sMid.w * 1.4 * scaleFactor, (dist + 3.0) * scaleFactor, 1.0);

        m4.compose(pos, qPlane, scl);
        track.boostHaloInst.setMatrixAt(idx, m4);

        cTemp.copy(boostCol).multiplyScalar(smoothGlow * 0.85);
        track.boostHaloInst.setColorAt(idx, cTemp);
      }

      const len = run.end - run.start;
      pad.chevrons.forEach(chev => {
        chev.progress = (chev.progress + dt * 1.6) % 1.0;

        const localVal = run.start + chev.progress * len;
        const idxA = Math.floor(localVal);
        const idxB = Math.min(run.end, idxA + 1);
        const fraction = localVal - idxA;

        const sA = ss[idxA], sB = ss[idxB];

        const px = sA.p[0] + (sB.p[0] - sA.p[0]) * fraction;
        const py = sA.p[1] + (sB.p[1] - sA.p[1]) * fraction;
        const pz = sA.p[2] + (sB.p[2] - sA.p[2]) * fraction;

        const fx = sA.f[0] + (sB.f[0] - sA.f[0]) * fraction;
        const fy = sA.f[1] + (sB.f[1] - sA.f[1]) * fraction;
        const fz = sA.f[2] + (sB.f[2] - sA.f[2]) * fraction;

        const rx = sA.r[0] + (sB.r[0] - sA.r[0]) * fraction;
        const ry = sA.r[1] + (sB.r[1] - sA.r[1]) * fraction;
        const rz = sA.r[2] + (sB.r[2] - sA.r[2]) * fraction;

        pos.set(px, py + (DD.DECAL.boost + 0.03), pz);

        const yaw = Math.atan2(fx, fz);
        const pitch = Math.asin(fy);
        const roll = Math.atan2(ry, rx);
        q.setFromEuler(e.set(pitch, yaw, roll, 'YXZ'));
        q.multiply(localRot);

        const width = (sA.w + (sB.w - sA.w) * fraction) * 0.45;
        scl.set(width * 1.8, 0.05, 1.0);

        m4.compose(pos, q, scl);
        chevronInst.setMatrixAt(chev.globalIdx, m4);
      });
    });

    if (track.boostHaloInst) {
      track.boostHaloInst.instanceMatrix.needsUpdate = true;
      if (track.boostHaloInst.instanceColor) track.boostHaloInst.instanceColor.needsUpdate = true;
    }
    chevronInst.instanceMatrix.needsUpdate = true;
  }

  function updateGates(track, dt, state, countdownT, nextCkpt) {
    if (!track) return;

    // 1. Update start lights countdown sequence
    if (track.startLights) {
      if (state === 'countdown') {
        const activeCount = countdownT > 2.0 ? 1 : (countdownT > 1.0 ? 3 : 5);
        for (let i = 0; i < 5; i++) {
          if (i < activeCount) {
            track.startLights[i].material.color.setHex(0xff0000); // Red
            track.startLights[i].material.opacity = 1.0;
          } else {
            track.startLights[i].material.color.setHex(0x221111); // Off/Dim
            track.startLights[i].material.opacity = 0.4;
          }
        }
      } else if (state === 'play') {
        track.startPlayTime = (track.startPlayTime || 0) + dt;
        if (track.startPlayTime < 1.0) {
          // Green lights!
          for (let i = 0; i < 5; i++) {
            track.startLights[i].material.color.setHex(0x00ff66); // Green
            track.startLights[i].material.opacity = 1.0;
          }
        } else {
          // Off
          for (let i = 0; i < 5; i++) {
            track.startLights[i].material.color.setHex(0x111111); // Off
            track.startLights[i].material.opacity = 0.2;
          }
        }
      } else {
        // Off
        for (let i = 0; i < 5; i++) {
          track.startLights[i].material.color.setHex(0x111111); // Off
          track.startLights[i].material.opacity = 0.2;
        }
      }
    }

    // 2. Update checkpoint indicator lights and flash color triggers
    const ckpts = track.checkpoints || [];
    if (track.checkpointLights) {
      for (let i = 0; i < ckpts.length; i++) {
        const lights = track.checkpointLights[i];
        if (!lights) continue;
        
        const passed = i < nextCkpt;
        const flashTime = track.flashingGantries ? (track.flashingGantries[i] || 0) : 0;
        
        for (let j = 0; j < lights.length; j++) {
          if (flashTime > 0) {
            // Pulsing bright white during checkpoint crossing moment
            lights[j].material.color.setHex(0xffffff);
            lights[j].material.opacity = 1.0;
          } else if (passed) {
            // Green when passed
            lights[j].material.color.setHex(0x00ff66);
            lights[j].material.opacity = 0.95;
          } else {
            // Orange (not yet passed)
            lights[j].material.color.setHex(0xff5500);
            lights[j].material.opacity = 0.5;
          }
        }
      }
    }

    // 3. Update finish line indicator beacons
    if (track.finishLights) {
      if (state === 'finish') {
        const timeSecs = (track.finishPlayTime || 0) + dt;
        track.finishPlayTime = timeSecs;
        const activeIdx = Math.floor(timeSecs * 8) % 5;
        for (let i = 0; i < 5; i++) {
          if (i === activeIdx) {
            track.finishLights[i].material.color.setHex(0x00ffcc);
            track.finishLights[i].material.opacity = 1.0;
          } else {
            track.finishLights[i].material.color.setHex(0x002244);
            track.finishLights[i].material.opacity = 0.4;
          }
        }
      } else {
        // Slow breathing blue animation waiting
        const timer = (track.finishTimer || 0) + dt;
        track.finishTimer = timer;
        const breath = Math.sin(timer * 4) * 0.3 + 0.7;
        for (let i = 0; i < 5; i++) {
          track.finishLights[i].material.color.setHex(0x0055ff);
          track.finishLights[i].material.opacity = breath * 0.8;
        }
      }
    }

    // 4. Update instanced neon columns flash animation
    if (track.flashingGantries) {
      let colorsNeedUpdate = false;
      for (let i = 0; i < ckpts.length; i++) {
        if (track.flashingGantries[i] !== undefined && track.flashingGantries[i] > 0) {
          track.flashingGantries[i] -= dt * 2.5;
          if (track.flashingGantries[i] < 0) track.flashingGantries[i] = 0;
          colorsNeedUpdate = true;
        }
      }
      
      if (colorsNeedUpdate && track.postNeonIM && track.barNeonIM) {
        const theme = track.theme || { accent2: [1, 0.5, 0] };
        const col = (c) => new THREE.Color(c[0], c[1], c[2]);
        const baseCol = col(theme.accent2);
        
        for (let i = 0; i < ckpts.length; i++) {
          const f = track.flashingGantries[i] || 0;
          const flashCol = new THREE.Color().copy(baseCol).lerp(new THREE.Color(0xffffff), f * 0.95);
          track.postNeonIM.setColorAt(i * 2, flashCol);
          track.postNeonIM.setColorAt(i * 2 + 1, flashCol);
          track.barNeonIM.setColorAt(i, flashCol);
        }
        if (track.postNeonIM.instanceColor) track.postNeonIM.instanceColor.needsUpdate = true;
        if (track.barNeonIM.instanceColor) track.barNeonIM.instanceColor.needsUpdate = true;
      }
    }
  }

  DD._sceneShared.buildBoostPads = buildBoostPads;
  DD._sceneShared.updateBoostPads = updateBoostPads;
  DD._sceneShared.updateGates = updateGates;
  DD._sceneShared.buildTunnels = buildTunnels;
  DD._sceneShared.buildLandingPads = buildLandingPads;
  DD._sceneShared.updateLandingPads = updateLandingPads;

  let _dirtTex = null;
  function getDirtTexture() {
    if (_dirtTex) return _dirtTex;
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;
    const ctx = canvas.getContext('2d');
    
    // Fill background with earth wash
    ctx.fillStyle = '#6b4c35';
    ctx.fillRect(0, 0, 512, 512);
    
    // Deterministic LCG
    let rngSeed = 42;
    function rand() {
      rngSeed = (rngSeed * 1664525 + 1013904223) % 4294967296;
      return rngSeed / 4294967296;
    }
    
    // Draw noise / mottling
    for (let i = 0; i < 5000; i++) {
      const x = rand() * 512;
      const y = rand() * 512;
      const size = rand() * 2 + 1;
      const c = rand() > 0.5 ? 'rgba(60,40,25,0.45)' : 'rgba(140,105,75,0.3)';
      ctx.fillStyle = c;
      ctx.fillRect(x, y, size, size);
    }
    
    // Draw tire-groove streaks
    ctx.strokeStyle = 'rgba(50,30,15,0.4)';
    ctx.lineWidth = 4;
    if (ctx.beginPath) {
      for (let i = 0; i < 24; i++) {
        const x = rand() * 512;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, 512);
        ctx.stroke();
      }
    }
    
    // Draw lighter tire-groove streaks
    ctx.strokeStyle = 'rgba(125,95,65,0.22)';
    ctx.lineWidth = 3;
    if (ctx.beginPath) {
      for (let i = 0; i < 18; i++) {
        const x = rand() * 512;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, 512);
        ctx.stroke();
      }
    }
    
    _dirtTex = new THREE.CanvasTexture(canvas);
    _dirtTex.wrapS = THREE.RepeatWrapping;
    _dirtTex.wrapT = THREE.RepeatWrapping;
    _dirtTex.repeat.set(4, 32);
    return _dirtTex;
  }

  function buildDirtScatter(track, theme) {
    const ss = track.samples;
    const N = ss.length;
    const rng = DD.makeRng(track.seed + '::dirtlook');
    
    const dirtIndices = [];
    for (let i = 0; i < N; i++) {
      if (ss[i].surf === DD.SURF.DIRT) {
        dirtIndices.push(i);
      }
    }
    if (!dirtIndices.length) return null;
    
    let count = 0;
    dirtIndices.forEach(idx => {
      if (rng.chance(0.7)) {
        count++;
      }
    });
    if (count === 0) return null;
    
    const geo = new THREE.OctahedronGeometry(0.18, 0);
    const mat = new THREE.MeshStandardMaterial({
      color: 0x5a483c,
      roughness: 0.92,
      metalness: 0.08
    });
    const inst = new THREE.InstancedMesh(geo, mat, count);
    inst.castShadow = true;
    inst.receiveShadow = true;
    inst.frustumCulled = false;
    
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
    const pos = new THREE.Vector3(), scl = new THREE.Vector3();
    
    let ii = 0;
    dirtIndices.forEach(idx => {
      if (!rng.chance(0.7)) return;
      const s = ss[idx];
      
      const side = rng.sign();
      const factor = 0.88 + rng.range(0.0, 0.1);
      const edgeDist = side * (s.w / 2) * factor;
      
      const px = s.p[0] + s.r[0] * edgeDist;
      const pz = s.p[2] + s.r[2] * edgeDist;
      const py = DD.terrainAt(track.terrain, px, pz) + 0.04;
      
      pos.set(px, py, pz);
      
      const sVal = rng.range(0.6, 1.4);
      scl.set(sVal, sVal, sVal);
      
      e.set(rng.range(0, 6.28), rng.range(0, 6.28), rng.range(0, 6.28));
      q.setFromEuler(e);
      
      m4.compose(pos, q, scl);
      inst.setMatrixAt(ii++, m4);
    });
    
    inst.instanceMatrix.needsUpdate = true;
    return inst;
  }

  function buildSpeedTrapGantry(track, theme) {
    if (!track || track.speedTrapIdx === undefined || track.speedTrapIdx === -1) return null;
    const ss = track.samples;
    const s = ss[track.speedTrapIdx];
    if (!s) return null;
    
    const group = new THREE.Group();
    const halfW = s.w * 0.5 + 0.7;
    const postH = 4.2;
    
    const right = new THREE.Vector3(s.r[0], s.r[1], s.r[2]);
    const up = new THREE.Vector3(s.u[0], s.u[1], s.u[2]);
    const fwd = new THREE.Vector3(s.f[0], s.f[1], s.f[2]);
    
    const yaw = Math.atan2(s.f[0], s.f[2]);
    const pitch = Math.asin(s.f[1]);
    const roll = Math.atan2(s.r[1], s.r[0]);
    const e = new THREE.Euler().set(pitch, yaw, roll, 'YXZ');
    const quat = new THREE.Quaternion().setFromEuler(e);
    
    const structMat = new THREE.MeshBasicMaterial({ color: 0x0c0a15, transparent: true, opacity: 0.95 });
    
    // Left column
    const lp = new THREE.Mesh(new THREE.BoxGeometry(0.18, postH, 0.18), structMat);
    lp.position.set(
      s.p[0] - right.x * halfW + up.x * postH * 0.5,
      s.p[1] - right.y * halfW + up.y * postH * 0.5,
      s.p[2] - right.z * halfW + up.z * postH * 0.5
    );
    lp.quaternion.copy(quat);
    group.add(lp);
    
    // Right column
    const rp = new THREE.Mesh(new THREE.BoxGeometry(0.18, postH, 0.18), structMat);
    rp.position.set(
      s.p[0] + right.x * halfW + up.x * postH * 0.5,
      s.p[1] + right.y * halfW + up.y * postH * 0.5,
      s.p[2] + right.z * halfW + up.z * postH * 0.5
    );
    rp.quaternion.copy(quat);
    group.add(rp);
    
    // Crossbar
    const cb = new THREE.Mesh(new THREE.BoxGeometry(s.w * 1.02 + 1.4, 0.2, 0.2), structMat);
    cb.position.set(
      s.p[0] + up.x * postH,
      s.p[1] + up.y * postH,
      s.p[2] + up.z * postH
    );
    cb.quaternion.copy(quat);
    group.add(cb);
    
    // Radar Text Canvas Board
    const canvas = document.createElement('canvas');
    canvas.width = 256; canvas.height = 128;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#090712'; ctx.fillRect(0, 0, 256, 128);
    ctx.strokeStyle = 'rgba(255,179,123,0.85)'; ctx.lineWidth = 8; ctx.strokeRect(8, 8, 240, 112);
    ctx.fillStyle = '#ffffff'; ctx.font = 'bold 50px monospace';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('RADAR', 128, 64);
    
    const radarTex = new THREE.CanvasTexture(canvas);
    const boardMat = new THREE.MeshStandardMaterial({
      map: radarTex,
      emissive: col(theme.accent2 || theme.accent),
      emissiveMap: radarTex,
      emissiveIntensity: 1.0,
      roughness: 0.5
    });
    track.speedTrapMat = boardMat;
    
    const boardGeo = new THREE.BoxGeometry(4.0, 1.4, 0.15);
    const board = new THREE.Mesh(boardGeo, boardMat);
    board.position.set(
      s.p[0] + up.x * (postH - 0.7),
      s.p[1] + up.y * (postH - 0.7),
      s.p[2] + up.z * (postH - 0.7)
    );
    board.quaternion.copy(quat);
    group.add(board);
    
    // Add flashing neon trim
    const trimGeo = new THREE.BoxGeometry(4.2, 0.05, 0.22);
    const trimMat = new THREE.MeshBasicMaterial({
      color: col(theme.accent2 || theme.accent),
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    const trimT = new THREE.Mesh(trimGeo, trimMat);
    trimT.position.set(
      s.p[0] + up.x * (postH - 0.7 + 0.725),
      s.p[1] + up.y * (postH - 0.7 + 0.725),
      s.p[2] + up.z * (postH - 0.7 + 0.725)
    );
    trimT.quaternion.copy(quat);
    group.add(trimT);
    
    const trimB = new THREE.Mesh(trimGeo, trimMat);
    trimB.position.set(
      s.p[0] + up.x * (postH - 0.7 - 0.725),
      s.p[1] + up.y * (postH - 0.7 - 0.725),
      s.p[2] + up.z * (postH - 0.7 - 0.725)
    );
    trimB.quaternion.copy(quat);
    group.add(trimB);
    
    return group;
  }

  DD._sceneShared.getDirtTexture = getDirtTexture;
  DD._sceneShared.buildDirtScatter = buildDirtScatter;
  DD._sceneShared.buildSpeedTrapGantry = buildSpeedTrapGantry;

  let _arrowTex = null;
  function getArrowTexture() {
    if (_arrowTex) return _arrowTex;
    const canvas = document.createElement('canvas');
    canvas.width = 128; canvas.height = 128;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = 'rgba(0,0,0,0)'; ctx.fillRect(0, 0, 128, 128);
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 14;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    if (ctx.beginPath) {
      ctx.beginPath();
      ctx.moveTo(24, 76); ctx.lineTo(64, 36); ctx.lineTo(104, 76);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(24, 102); ctx.lineTo(64, 62); ctx.lineTo(104, 102);
      ctx.stroke();
    }
    _arrowTex = new THREE.CanvasTexture(canvas);
    return _arrowTex;
  }

  function buildPlaygroundCues(track, theme) {
    const pgs = track.playgrounds;
    if (!pgs || !pgs.length) return null;
    const group = new THREE.Group();
    const ss = track.samples;
    const N = ss.length;
    const T = track.terrain;
    if (!T) return null;
    
    const arrowTex = getArrowTexture();
    const arrowMat = new THREE.MeshBasicMaterial({
      color: col(theme.accent),
      transparent: true,
      opacity: 0.25,
      map: arrowTex,
      blending: THREE.NormalBlending,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1
    });
    
    const arrowGeo = new THREE.PlaneGeometry(2.2, 2.2);
    let totalArrows = pgs.length * 3;
    const arrowInst = new THREE.InstancedMesh(arrowGeo, arrowMat, totalArrows);
    group.add(arrowInst);
    
    const glowGeo = new THREE.PlaneGeometry(3.0, 3.0);
    const glowMat = new THREE.MeshBasicMaterial({
      color: col(theme.accent2 || theme.accent),
      transparent: true,
      opacity: 0.65,
      map: getDotTexture ? getDotTexture() : null,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1.5,
      polygonOffsetUnits: -1.5
    });
    const glowInst = new THREE.InstancedMesh(glowGeo, glowMat, pgs.length);
    group.add(glowInst);
    
    const furnDots = [];
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
    const pos = new THREE.Vector3(), scl = new THREE.Vector3();
    const qPlane = new THREE.Quaternion();
    const localRot = new THREE.Quaternion();
    if (localRot.setFromAxisAngle) {
      localRot.setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);
    }
    
    let arrowVi = 0;
    let glowVi = 0;
    
    pgs.forEach(pg => {
      const anchorIdx = pg.anchorIdx;
      if (anchorIdx === undefined || anchorIdx === -1) return;
      const s = ss[anchorIdx];
      if (!s) return;
      
      const side = Math.sign(s.apron) || 1;
      const k = Math.abs(s.apron) || 1;
      
      const arrowIndices = [anchorIdx - 3, anchorIdx, anchorIdx + 3];
      arrowIndices.forEach(idx => {
        const wIdx = getWrappedIdx(idx, N, track.closed);
        if (wIdx === -1) return;
        const sArrow = ss[wIdx];
        const distOnApron = side * (sArrow.w * 0.5 + 0.3 + 1.6 * k);
        const px = sArrow.p[0] + sArrow.r[0] * distOnApron;
        const pz = sArrow.p[2] + sArrow.r[2] * distOnApron;
        const py = DD.terrainAt(T, px, pz) + 0.05;
        
        pos.set(px, py, pz);
        scl.set(1.0, 1.0, 1.0);
        
        const dirX = pg.x - px, dirZ = pg.z - pz;
        const distToCenter = Math.hypot(dirX, dirZ) || 1;
        const dir = [dirX / distToCenter, 0, dirZ / distToCenter];
        
        const ux = sArrow.u[0], uy = sArrow.u[1], uz = sArrow.u[2];
        const fx = dir[0], fy = 0, fz = dir[2];
        const rx = uy * fz - uz * fy;
        const ry = uz * fx - ux * fz;
        const rz = ux * fy - uy * fx;
        const rLen = Math.hypot(rx, ry, rz) || 1;
        const rVec = new THREE.Vector3(rx / rLen, ry / rLen, rz / rLen);
        const cx = ry * uz - rz * uy;
        const cy = rz * ux - rx * uz;
        const cz = rx * uy - ry * ux;
        const cLen = Math.hypot(cx, cy, cz) || 1;
        const uVec = new THREE.Vector3(ux, uy, uz);
        const fVecCorrected = new THREE.Vector3(-cx / cLen, -cy / cLen, -cz / cLen);
        m4.makeBasis(rVec, uVec, fVecCorrected);
        if (m4.setPosition) m4.setPosition(pos);
        
        arrowInst.setMatrixAt(arrowVi++, m4);
      });
      
      const entDist = side * (s.w * 0.5 + 0.5 + 3.4 * k);
      const entX = s.p[0] + s.r[0] * entDist;
      const entZ = s.p[2] + s.r[2] * entDist;
      const entY = DD.terrainAt(T, entX, entZ);
      
      pos.set(entX, entY + 0.08, entZ);
      scl.set(1.0, 1.0, 1.0);
      
      const yaw = Math.atan2(s.f[0], s.f[2]);
      const pitch = Math.asin(s.f[1]);
      const roll = Math.atan2(s.r[1], s.r[0]);
      q.setFromEuler(e.set(pitch, yaw, roll, 'YXZ'));
      qPlane.copy(q);
      if (qPlane.multiply) qPlane.multiply(localRot);
      
      m4.compose(pos, qPlane, scl);
      glowInst.setMatrixAt(glowVi++, m4);
      
      if (glowVi <= 8) {
        addLightSource(track, [entX, entY + 1.0, entZ], col(theme.accent2 || theme.accent), 1.2, 10.0);
      }
      
      const f = pg.furniture;
      if (f) {
        if (f.type === 'bowl') {
          const count = 3;
          for (let i = 0; i < count; i++) {
            const angle = i * (Math.PI * 2 / count);
            const dotX = pg.x + Math.cos(angle) * (f.r * 0.975);
            const dotZ = pg.z + Math.sin(angle) * (f.r * 0.975);
            const dotY = DD.terrainAt(T, dotX, dotZ) + 0.22;
            furnDots.push([dotX, dotY, dotZ]);
          }
        } else {
          const count = 3;
          for (let i = 0; i < count; i++) {
            const t = (i / (count - 1) - 0.5) * 1.6;
            const dotX = pg.x + f.dir[0] * (t * f.halfLen);
            const dotZ = pg.z + f.dir[1] * (t * f.halfLen);
            const dotY = DD.terrainAt(T, dotX, dotZ) + 0.22;
            furnDots.push([dotX, dotY, dotZ]);
          }
        }
      }
    });
    
    arrowInst.count = arrowVi;
    arrowInst.instanceMatrix.needsUpdate = true;
    
    glowInst.count = glowVi;
    glowInst.instanceMatrix.needsUpdate = true;
    
    if (furnDots.length > 0) {
      const dotGeo = new THREE.SphereGeometry(0.14, 8, 8);
      const dotMat = new THREE.MeshBasicMaterial({
        color: col(theme.accent2 || theme.accent),
        transparent: true,
        opacity: 0.9,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      });
      const dotInst = new THREE.InstancedMesh(dotGeo, dotMat, furnDots.length);
      group.add(dotInst);
      furnDots.forEach((pt, idx) => {
        pos.set(pt[0], pt[1], pt[2]);
        scl.set(1.0, 1.0, 1.0);
        if (q.set) q.set(0, 0, 0, 1);
        m4.compose(pos, q, scl);
        dotInst.setMatrixAt(idx, m4);
      });
      dotInst.instanceMatrix.needsUpdate = true;
    }
    
    return group;
  }

  DD._sceneShared.buildPlaygroundCues = buildPlaygroundCues;

})(typeof window !== 'undefined' ? window : globalThis);
