/* DRIFTDREAM scene car — Chassis geometry, edit handles, posing. */
(function (global) {
  'use strict';
  const DD = global.DD;
  const V = DD.v;
  const col = DD._sceneShared.col;
  const getCarbonTexture = () => DD._sceneShared.getCarbonTexture();
  const getDotTexture = () => DD._sceneShared.getDotTexture();

  // car-geometry shorthands + finish table (file-local: every user lives in this file).
  // These were stranded in scene-core.js by the A4 split — buildCar threw ReferenceError.
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

  // In-place vector helpers from core
  const ipSet = DD._ipSet;
  const ipSub = DD._ipSub;
  const ipAddS = DD._ipAddS;
  const ipDot = DD._ipDot;
  const ipCross = DD._ipCross;
  const ipNorm = DD._ipNorm;

  // Module-scope scratch objects
  const poseM4 = new THREE.Matrix4();
  const poseV3_r = new THREE.Vector3();
  const poseV3_u = new THREE.Vector3();
  const poseV3_f = new THREE.Vector3();
  const poseF0 = [0, 0, 0];
  const poseTempF = [0, 0, 0];
  const poseTempCross = [0, 0, 0];
  const poseR = [0, 0, 0];
  const poseF = [0, 0, 0];

  const shadowM4 = new THREE.Matrix4();
  const shadowV3_r = new THREE.Vector3();
  const shadowV3_u = new THREE.Vector3();
  const shadowV3_f = new THREE.Vector3();
  const shadowF0 = [0, 0, 0];
  const shadowTempF = [0, 0, 0];
  const shadowTempCross = [0, 0, 0];
  const shadowR = [0, 0, 0];
  const shadowF = [0, 0, 0];

  function makeCarMaterials(garage, ghost, envMap, palette) {
    garage = garage || {};
    const G = DD.GARAGE;
    const grad = G.gradients[(garage.grad || 0) % G.gradients.length];
    const finish = G.finishes[(garage.finish || 0) % G.finishes.length];
    const op = ghost ? 0.3 : (finish === 'Glass' ? 0.55 : 1);
    const trans = ghost || finish === 'Glass';
    const fb = CAR_FIN[finish] || { metal: 0.6, rough: 0.3, clearcoat: 0.0, ccRough: 0.0 };
    const mBias = (palette && palette.metalBias) || 0;
    const fin = { metal: Math.max(0, Math.min(1, fb.metal + mBias)), rough: fb.rough, clearcoat: fb.clearcoat, ccRough: fb.ccRough };
    const gradMix = (t) => V.lerp(grad.a, grad.b, t);
    // 'body' slot — gradient pulled toward dark metal (liveried, not a toy). The boostShell/iridescent hull.
    // Fresnel silhouette rim light injected on solid shells (not ghost, not self-emissive glow slots):
    // grazing-angle emissive that traces the car outline against the dark bg. Car pixels only = cheap.
    const _rimCol = new THREE.Color(...V.lerp(grad.b, [1, 1, 1], 0.35));
    const bodyMat = (c, emisAmt) => {
      const m = new THREE.MeshPhysicalMaterial({
        color: col(emisAmt ? c : V.lerp(c, [0.06, 0.06, 0.08], ghost ? 0.45 : 0.32)),
        metalness: fin.metal, roughness: fin.rough,
        clearcoat: fin.clearcoat, clearcoatRoughness: fin.ccRough,
        transparent: trans, opacity: op,
        emissive: emisAmt ? col(c) : (finish === 'Neon Edge' ? col(grad.b) : 0x000000),
        emissiveIntensity: emisAmt || (finish === 'Neon Edge' ? 0.5 : 0),
        envMapIntensity: ghost ? 0.4 : 1.0, envMap: envMap || null
      });
      if (!ghost && !emisAmt) {
        m.onBeforeCompile = (shader) => {
          shader.uniforms.uRimColor = { value: _rimCol };
          shader.uniforms.uRimPow = { value: 2.6 };
          shader.uniforms.uRimI = { value: 0.85 };
          shader.fragmentShader = 'uniform vec3 uRimColor;\nuniform float uRimPow;\nuniform float uRimI;\n' +
            shader.fragmentShader.replace('#include <emissivemap_fragment>',
              '#include <emissivemap_fragment>\n  float rimF = pow(1.0 - abs(dot(normalize(vViewPosition), normal)), uRimPow);\n  totalEmissiveRadiance += uRimColor * rimF * uRimI;');
        };
      }
      return m;
    };
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
    const isTest = (typeof window === 'undefined');
    const cockpitMat = new THREE.MeshPhysicalMaterial({
      color: 0x020204, metalness: 0.95, roughness: 0.02,
      transmission: isTest ? 0.65 : 0.0, ior: 1.52,
      clearcoat: 1.0, clearcoatRoughness: 0.01,
      transparent: ghost || isTest, opacity: ghost ? 0.25 : 1.0, envMapIntensity: ghost ? 0.5 : 1.5, envMap: envMap || null
    });
    const chrome = (ghost || finish === 'Glass') ? bodyMat(gradMix(0.5)) : new THREE.MeshStandardMaterial({ color: 0xd8d8e0, metalness: 1.0, roughness: 0.16, envMapIntensity: ghost ? 0.3 : 1.2, envMap: envMap || null });
    
    // Rim specific gradient and finish
    const rGradIdx = garage.rimGrad != null ? garage.rimGrad : 1;
    const rFinIdx = garage.rimFinish != null ? garage.rimFinish : 1;
    const rGrad = G.gradients[rGradIdx % G.gradients.length];
    const rFinish = G.finishes[rFinIdx % G.finishes.length];
    const rFb = CAR_FIN[rFinish] || { metal: 0.85, rough: 0.14, clearcoat: 1.0, ccRough: 0.03 };
    const rFin = { metal: Math.max(0, Math.min(1, rFb.metal + mBias)), rough: rFb.rough, clearcoat: rFb.clearcoat, ccRough: rFb.ccRough };
    const rGradMix = (t) => V.lerp(rGrad.a, rGrad.b, t);
    const rimMat = new THREE.MeshPhysicalMaterial({
      color: col(V.lerp(rGradMix(0.5), [0.06, 0.06, 0.08], ghost ? 0.45 : 0.32)),
      metalness: rFin.metal, roughness: rFin.rough,
      clearcoat: rFin.clearcoat, clearcoatRoughness: rFin.ccRough,
      transparent: trans, opacity: op,
      emissive: rFinish === 'Neon Edge' ? col(rGrad.b) : 0x000000,
      emissiveIntensity: rFinish === 'Neon Edge' ? 0.5 : 0,
      envMapIntensity: ghost ? 0.4 : 1.2, envMap: envMap || null,
      side: THREE.DoubleSide
    });

    return { grad, finish, fin, gradMix, bodyMat, glowMat, carbon, cockpitMat, chrome, rimMat };
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
      // T12: per-station ring override replaces the global ellipse/superellipse outline. The override
      // map is sparse (keyed by station index); only stations present use it, others stay global.
      const ringOverride = hull.rings && hull.rings[m] && hull.rings[m].pts;
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
        if (ringOverride && ringOverride.length === K && ringOverride[i]) {
          // ring pts normalized [-1,1]; x scales the width axis, y offsets from station center upward
          px = hw * ringOverride[i].x;
          py = yc + hgt * 0.5 * ringOverride[i].y;
        }
        pos.push(px, py, wz);
      }
    }
    for (let m = 0; m < M - 1; m++) for (let i = 0; i < K; i++) {
      const a = m * K + i, b = m * K + (i + 1) % K, c = (m + 1) * K + i, d = (m + 1) * K + (i + 1) % K;
      idx.push(a, c, b, b, c, d);
    }
    // Cap styles (CAR.md): flat = centroid fan (default), pointed = cone tip offset along the spine,
    // rounded = hemisphere bulge (centroid peak + tapered mid-ring, single pass), hollow = skip cap.
    // Winding mirrors the flat fan (rev true/false) so every style faces the same way as the default.
    const cap = (m, rev, style) => {
      style = (style === 'pointed' || style === 'rounded' || style === 'hollow') ? style : 'flat';
      if (style === 'hollow') return; // open intake/exhaust bay — emit no cap triangles
      let cx = 0, cy = 0, cz = 0;
      for (let i = 0; i < K; i++) {
        cx += pos[(m * K + i) * 3]; cy += pos[(m * K + i) * 3 + 1]; cz += pos[(m * K + i) * 3 + 2];
      }
      cx /= K; cy /= K; cz /= K;
      const dir = rev ? 1 : -1; // front cap bulges +Z, rear cap bulges -Z
      if (style === 'pointed') {
        // cone tip: centroid offset ±0.3·L along the spine axis
        const ci = pos.length / 3; pos.push(cx, cy, cz + dir * 0.3 * L);
        for (let i = 0; i < K; i++) {
          const a = m * K + i, b = m * K + (i + 1) % K;
          rev ? idx.push(ci, a, b) : idx.push(ci, b, a);
        }
        return;
      }
      if (style === 'rounded') {
        // hemisphere bulge: centroid peak ~0.5·avgRingRadius + a duplicated tapered mid-ring
        // (single pass, no recursion) so the cap curves instead of forming a sharp cone.
        let avgR = 0;
        for (let i = 0; i < K; i++) {
          const px = pos[(m * K + i) * 3] - cx, py = pos[(m * K + i) * 3 + 1] - cy;
          avgR += Math.sqrt(px * px + py * py);
        }
        avgR /= K;
        const peak = dir * 0.5 * avgR, taper = peak * 0.5;
        const rim = pos.length / 3; // duplicated mid-ring (cap-exclusive; side strips stay intact)
        for (let i = 0; i < K; i++) {
          pos.push(pos[(m * K + i) * 3], pos[(m * K + i) * 3 + 1], pos[(m * K + i) * 3 + 2] + taper);
        }
        const ci = pos.length / 3; pos.push(cx, cy, cz + peak);
        for (let i = 0; i < K; i++) {
          const a = m * K + i, b = m * K + (i + 1) % K, da = rim + i, db = rim + (i + 1) % K;
          if (rev) { idx.push(da, a, b, da, b, db, ci, da, db); }
          else { idx.push(da, b, a, da, db, b, ci, db, da); }
        }
        return;
      }
      // flat (default): centroid fan — unchanged from original buildHull
      const ci = pos.length / 3; pos.push(cx, cy, cz);
      for (let i = 0; i < K; i++) {
        const a = m * K + i, b = m * K + (i + 1) % K;
        rev ? idx.push(ci, a, b) : idx.push(ci, b, a);
      }
    };
    cap(0, true, hull.capStyleFront);
    cap(M - 1, false, hull.capStyleRear);
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
    // recessed dark cockpit tub
    const tub = _mesh(_sph(1, 16, 10), new THREE.MeshStandardMaterial({ color: 0x09090d, metalness: 0.3, roughness: 0.7 }));
    tub.scale.set(0.34, 0.16, 0.7 * L);
    tub.position.set(0, cy - 0.12, cz);
    group.add(tub);

    if (canopy.kind === 'speedster') {
      // Windshield deflector
      const cp = _mesh(_sph(1, 18, 12), mats.cockpitMat);
      cp.scale.set(canopy.scale[0], canopy.scale[1] * 0.7, canopy.scale[2] * 0.45 * L);
      cp.position.set(0, cy, cz + canopy.scale[2] * 0.25 * L);
      group.add(cp);
      // Double aero humps behind driver/passenger
      for (const sx of [-1, 1]) {
        const hump = _mesh(_sph(1, 14, 8), mats.cockpitMat);
        hump.scale.set(canopy.scale[0] * 0.36, canopy.scale[1] * 0.75, canopy.scale[2] * 0.5 * L);
        hump.position.set(sx * canopy.scale[0] * 0.42, cy - 0.04, cz - canopy.scale[2] * 0.25 * L);
        group.add(hump);
      }
      // Roll hoop
      const hoop = _mesh(_tor(canopy.scale[0] * 0.65, 0.02, 8, 18), mats.carbon);
      hoop.rotation.x = Math.PI / 2 - 0.15;
      hoop.position.set(0, cy + canopy.scale[1] * 0.32, cz - canopy.scale[2] * 0.25 * L);
      group.add(hoop);
    } else if (canopy.kind === 'open') {
      // Low deflector shield / open cockpit look
      const cp = _mesh(_sph(1, 18, 12), mats.cockpitMat);
      cp.scale.set(canopy.scale[0], canopy.scale[1] * 0.6, canopy.scale[2] * 0.35 * L);
      cp.position.set(0, cy - 0.02, cz + canopy.scale[2] * 0.35 * L);
      group.add(cp);
      // Exposed roll hoop
      const hoop = _mesh(_tor(canopy.scale[0] * 0.7, 0.025, 8, 18), mats.carbon);
      hoop.rotation.x = Math.PI / 2 - 0.1;
      hoop.position.set(0, cy + canopy.scale[1] * 0.4, cz - canopy.scale[2] * 0.1 * L);
      group.add(hoop);
    } else if (canopy.kind === 'recessed') {
      // Angular wedge canopy (stealth look)
      const cp = _mesh(_box(1, 1, 1), mats.cockpitMat);
      cp.scale.set(canopy.scale[0] * 2, canopy.scale[1] * 2, canopy.scale[2] * 2 * L);
      cp.position.set(0, cy - canopy.scale[1], cz);
      cp.rotation.x = 0.14; // sloped forward
      group.add(cp);
    } else {
      // 'bubble' (default): Sphere geometry (classic bubble dome)
      const cp = _mesh(_sph(1, 18, 12), mats.cockpitMat);
      cp.scale.set(canopy.scale[0], canopy.scale[1], canopy.scale[2] * L);
      cp.position.set(0, cy, cz);
      group.add(cp);
    }
  }

  // wheel-style registry — each adds its face elements to the spin group (tyre/disc/hub are common).
  // G2: every builder now reads opts { rimPct, spokeCount } so parametric wheels work; defaults preserve
  // the original look when knobs are absent. No new THREE classes (all reuse _tor/_cyl/_box helpers).
  DD.CAR_WHEEL_BUILDERS = {
    multiSpoke(spin, r, side, M, o) {
      o = o || {};
      const n = o.spokeCount || 5;
      const tw = o.tw || 0.35;
      const spokeX = side * (tw * 0.5 - 0.06);
      for (let k = 0; k < n; k++) {
        const sp = _mesh(_box(0.024, r * 1.55, 0.024), o.discMat);
        sp.rotation.x = (k / n) * Math.PI; sp.position.set(spokeX, 0, 0); spin.add(sp);
      }
      const blade = _mesh(_box(0.04, r * 1.3, 0.03), M.glowMat(M.grad.a, 0.95));
      blade.position.set(side * (tw * 0.5 - 0.02), r * 0.18, 0); spin.add(blade);
      const rim = _mesh(_tor(r * (o.rimPct || 0.82) * 0.88, 0.018, 6, 24), M.glowMat(M.grad.b, 0.8));
      rim.rotation.y = Math.PI / 2; rim.position.set(side * (tw * 0.5 - 0.03), 0, 0); spin.add(rim);
    },
    turbofan(spin, r, side, M, o) {
      o = o || {};
      const tw = o.tw || 0.35;
      const ring = _mesh(_tor(r * (o.rimPct || 0.82) * 0.62, 0.02, 6, 24), M.glowMat(M.grad.b, 0.9));
      ring.rotation.y = Math.PI / 2; ring.position.set(side * (tw * 0.5 - 0.02), 0, 0); spin.add(ring);
      const blade = _mesh(_box(0.05, r * 1.1, 0.02), M.glowMat(M.grad.a, 0.7));
      blade.position.set(side * (tw * 0.5 - 0.04), r * 0.2, 0); spin.add(blade);
    },
    glowDisc(spin, r, side, M, o) {
      o = o || {};
      const rr = o.rimPct || 0.82;
      const tw = o.tw || 0.35;
      const core = _mesh(_cyl(r * rr * 0.46, r * rr * 0.46, 0.14, 16), M.glowMat(M.grad.a, 0.95));
      core.rotation.z = Math.PI / 2; core.position.set(side * (tw * 0.5 - 0.04), 0, 0); spin.add(core);
      const ring = _mesh(_tor(r * rr * 0.79, 0.03, 6, 24), M.glowMat(M.grad.b, 0.9));
      ring.rotation.y = Math.PI / 2; ring.position.set(side * (tw * 0.5 - 0.03), 0, 0); spin.add(ring);
      const blade = _mesh(_box(0.03, r * 0.45, 0.02), M.glowMat(M.grad.a, 0.95));
      blade.position.set(side * (tw * 0.5 - 0.035), r * 0.42, 0); spin.add(blade);
    },
    classicSpoke(spin, r, side, M, o) {
      o = o || {};
      const n = o.spokeCount || 6;
      const tw = o.tw || 0.35;
      const spokeX = side * (tw * 0.5 - 0.06);
      for (let k = 0; k < n; k++) {
        const sp = _mesh(_box(0.016, r * 1.62, 0.016), M.chrome);
        sp.rotation.x = (k / n) * Math.PI; sp.position.set(spokeX, 0, 0); spin.add(sp);
      }
      const cap = _mesh(_cyl(r * (o.rimPct || 0.82) * 0.22, r * (o.rimPct || 0.82) * 0.22, 0.1, 12), M.glowMat(M.grad.a, 0.85));
      cap.rotation.z = Math.PI / 2; cap.position.set(side * (tw * 0.5 - 0.03), 0, 0); spin.add(cap);
      const rim = _mesh(_tor(r * (o.rimPct || 0.82) * 0.80, 0.014, 6, 24), M.glowMat(M.grad.b, 0.55));
      rim.rotation.y = Math.PI / 2; rim.position.set(side * (tw * 0.5 - 0.04), 0, 0); spin.add(rim);
    },
    meshBBS(spin, r, side, M, o) {
      o = o || {};
      const n = o.spokeCount || 8;
      const tw = o.tw || 0.35;
      const spokeX = side * (tw * 0.5 - 0.06);
      const rimR = r * (o.rimPct || 0.82);
      for (let k = 0; k < n; k++) {
        const angle = (k / n) * Math.PI * 2;
        const sp1 = _mesh(_box(0.016, rimR * 0.55, 0.016), o.discMat);
        const midR = rimR * 0.25;
        sp1.position.set(spokeX, Math.sin(angle) * midR, Math.cos(angle) * midR);
        sp1.rotation.x = angle;
        spin.add(sp1);
        for (const branchAngle of [angle - 0.18, angle + 0.18]) {
          const sp2 = _mesh(_box(0.012, rimR * 0.55, 0.012), o.discMat);
          const outerR = rimR * 0.70;
          sp2.position.set(spokeX, Math.sin(branchAngle) * outerR, Math.cos(branchAngle) * outerR);
          sp2.rotation.x = branchAngle;
          spin.add(sp2);
        }
      }
    },
    starFive(spin, r, side, M, o) {
      o = o || {};
      const n = 5;
      const tw = o.tw || 0.35;
      const rimR = r * (o.rimPct || 0.82);
      const outerX = side * (tw * 0.5 - 0.02);
      const innerX = side * (tw * 0.5 - 0.08);
      for (let k = 0; k < n; k++) {
        const angle = (k / n) * Math.PI * 2;
        const spokeGrp = new THREE.Group();
        spokeGrp.rotation.x = angle;
        const sp = _mesh(_box(0.04, rimR * 0.95, 0.035), o.discMat);
        sp.position.set((outerX - innerX) * 0.5, rimR * 0.45, 0);
        sp.rotation.z = -side * 0.22;
        spokeGrp.add(sp);
        spin.add(spokeGrp);
      }
    },
    deepDish6(spin, r, side, M, o) {
      o = o || {};
      const n = 6;
      const tw = o.tw || 0.35;
      const rimR = r * (o.rimPct || 0.82);
      const outerX = side * (tw * 0.5 - 0.02);
      const innerX = side * (tw * 0.5 - 0.08);
      for (let k = 0; k < n; k++) {
        const angle = (k / n) * Math.PI * 2;
        const spokeGrp = new THREE.Group();
        spokeGrp.rotation.x = angle;
        for (const offsetZ of [-0.025, 0.025]) {
          const sp = _mesh(_box(0.022, rimR * 0.95, 0.022), o.discMat);
          sp.position.set((outerX - innerX) * 0.5, rimR * 0.45, offsetZ);
          sp.rotation.z = -side * 0.25;
          spokeGrp.add(sp);
        }
        spin.add(spokeGrp);
      }
    }
  };

  function buildWheels(group, spec, L, style, mats, ghost, envMap) {
    const hp = spec.chassis.hardpoints;
    const hull = spec.chassis.hull;
    const tyreMat = new THREE.MeshStandardMaterial({ color: 0x0d0d12, metalness: 0.0, roughness: 0.85, transparent: ghost, opacity: ghost ? 0.3 : 1, side: THREE.DoubleSide });
    const discMat = mats.rimMat || new THREE.MeshStandardMaterial({ color: 0x2b2c36, metalness: 1.0, roughness: 0.28, envMapIntensity: ghost ? 0.3 : 1.0, transparent: ghost, opacity: ghost ? 0.3 : 1, envMap: envMap || null, side: THREE.DoubleSide });
    const tw = hp.tyreW;
    const rimPct = (hp.rimRadiusPct != null && Number.isFinite(hp.rimRadiusPct)) ? hp.rimRadiusPct : 0.82;
    const roundness = (hp.tyreRoundness != null && Number.isFinite(hp.tyreRoundness)) ? hp.tyreRoundness : 0;
    const spokeCount = (typeof hp.spokeCount === 'number') ? hp.spokeCount : null;
    const defs = [[-hp.trackF, hp.frontZ * L, hp.frontR], [hp.trackF, hp.frontZ * L, hp.frontR], [-hp.trackR, hp.rearZ * L, hp.rearR], [hp.trackR, hp.rearZ * L, hp.rearR]];
    const styleFn = DD.CAR_WHEEL_BUILDERS[style] || DD.CAR_WHEEL_BUILDERS.multiSpoke;
    
    // helper to interpolate body width at wheel Z position
    const wheelbase = (hp.frontZ - hp.rearZ) * L;
    const midZ = (hp.frontZ + hp.rearZ) * 0.5 * L;
    const getBodyHalfWidth = (zVal) => {
      const normZ = (zVal - midZ) / (wheelbase || 1);
      let w = 0.40;
      const ST = hull.station;
      const WIDTH_SCALE = 1.18;
      const fenderClamp = hull.fenderClamp || 1.0;
      if (ST && ST.length > 0) {
        const sorted = [...ST].sort((a, b) => a[0] - b[0]);
        if (normZ <= sorted[0][0]) {
          w = sorted[0][1];
        } else if (normZ >= sorted[sorted.length - 1][0]) {
          w = sorted[sorted.length - 1][1];
        } else {
          for (let i = 0; i < sorted.length - 1; i++) {
            const s0 = sorted[i], s1 = sorted[i+1];
            if (normZ >= s0[0] && normZ <= s1[0]) {
              const t = (normZ - s0[0]) / (s1[0] - s0[0] || 1);
              w = s0[1] + (s1[1] - s0[1]) * t;
              break;
            }
          }
        }
      }
      return Math.min(w, fenderClamp) * WIDTH_SCALE;
    };

    group.wheels = []; group.frontWheels = [];
    defs.forEach(([x, z, r], wi) => {
      const w = new THREE.Group(), spin = new THREE.Group(), side = Math.sign(x) || 1;
      
      // Parametric tire bevel shoulder rounding
      const sh = Math.min(tw * 0.45, r * 0.25) * roundness;
      if (sh > 0.005) {
        const centerW = tw - 2 * sh;
        const tread = _mesh(new THREE.CylinderGeometry(r, r, centerW, 24, 1, true), tyreMat);
        tread.rotation.z = Math.PI / 2;
        spin.add(tread);
        const torR = r - sh;
        for (const sx of [-1, 1]) {
          const torus = _mesh(_tor(torR, sh, 8, 24), tyreMat);
          torus.rotation.y = Math.PI / 2;
          torus.position.x = sx * (tw * 0.5 - sh);
          spin.add(torus);
          const wall = _mesh(new THREE.RingGeometry(r * rimPct, torR, 24), tyreMat);
          wall.rotation.y = sx * Math.PI / 2;
          wall.position.x = sx * (tw * 0.5);
          spin.add(wall);
        }
      } else {
        const tyre = _mesh(new THREE.CylinderGeometry(r, r, tw, 24, 1, true), tyreMat);
        tyre.rotation.z = Math.PI / 2;
        spin.add(tyre);
        for (const sx of [-1, 1]) {
          const wall = _mesh(new THREE.RingGeometry(r * rimPct, r, 24), tyreMat);
          wall.rotation.y = sx * Math.PI / 2;
          wall.position.x = sx * (tw * 0.5);
          spin.add(wall);
        }
      }

      // Hollow cylinder barrel
      const disc = _mesh(new THREE.CylinderGeometry(r * rimPct, r * rimPct, tw * 0.88, 24, 1, true), discMat);
      disc.rotation.z = Math.PI / 2;
      disc.position.set(side * 0.02, 0, 0);
      spin.add(disc);

      // Sleek center hub
      if (hp.hollowHub > 0.5) {
        const hub = _mesh(new THREE.CylinderGeometry(r * 0.15, r * 0.15, tw * 0.22, 18, 1, true), discMat);
        hub.rotation.z = Math.PI / 2;
        hub.position.set(side * (tw * 0.5 - 0.08), 0, 0);
        spin.add(hub);
      } else {
        const hub = _mesh(_cyl(r * 0.15, r * 0.15, tw * 0.22, 18), discMat);
        hub.rotation.z = Math.PI / 2;
        hub.position.set(side * (tw * 0.5 - 0.08), 0, 0);
        spin.add(hub);
      }

      styleFn(spin, r, side, mats, { discMat: discMat, rimPct: rimPct, spokeCount: spokeCount, tw: tw });
      w.add(spin); w.userData = { spinGroup: spin }; w.position.set(x, r, z);
      group.add(w); group.wheels.push(w);
      if (wi < 2) group.frontWheels.push(w);
      
      // Auto-connecting suspension wishbones
      const innerX = side * getBodyHalfWidth(z);
      const hubX = x - side * 0.10;
      const armLen = Math.abs(hubX - innerX) + 0.04;
      const suspY = (hp.suspensionY != null && Number.isFinite(hp.suspensionY)) ? hp.suspensionY : 0.0;
      const suspZ = (hp.suspensionZ != null && Number.isFinite(hp.suspensionZ)) ? hp.suspensionZ : 0.18;
      for (const [ay, dz] of [[r + 0.07 + suspY, suspZ], [r - 0.10 + suspY, -suspZ]]) {
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
      // G3 knobs: angle (pitch rad, clamp ±0.6, default 0.10), scale (clamp 0.5-2.0, default 1),
      // width (span multiplier, clamp 0.5-1.5, default 1). Mirrors lightBar's defensive read pattern.
      const k = ctx.knobs || {};
      const angle = (k.angle != null && Number.isFinite(k.angle)) ? Math.max(-0.6, Math.min(0.6, k.angle)) : 0.10;
      const scale = (k.scale != null && Number.isFinite(k.scale)) ? Math.max(0.5, Math.min(2.0, k.scale)) : 1;
      const width = (k.width != null && Number.isFinite(k.width)) ? Math.max(0.5, Math.min(1.5, k.width)) : 1;
      const g = ctx.group, L = ctx.L, M = ctx.mats, z = 2.4 * L;
      const w1 = _mesh(_box(1.5 * width, 0.03 * scale, 0.34 * scale), M.bodyMat(M.gradMix(1.0), 0)); w1.position.set(0, 0.13, z); w1.rotation.x = angle; g.add(w1);
      const w2 = _mesh(_box(1.5 * width, 0.02 * scale, 0.22 * scale), M.bodyMat(M.gradMix(0.85), 0)); w2.position.set(0, 0.20, z + 0.05); w2.rotation.x = angle + 0.06; g.add(w2);
      for (const sx of [-1, 1]) { const ep = _mesh(_box(0.03, 0.18 * scale, 0.42 * scale), M.bodyMat(M.gradMix(0.1), 0)); ep.position.set(sx * 0.75 * width, 0.16, z); g.add(ep); }
    },
    rearWingBiplane(ctx) {
      // G3 knobs — same semantics as frontWing. Defaults reproduce the original look.
      const k = ctx.knobs || {};
      const angle = (k.angle != null && Number.isFinite(k.angle)) ? Math.max(-0.6, Math.min(0.6, k.angle)) : -0.12;
      const scale = (k.scale != null && Number.isFinite(k.scale)) ? Math.max(0.5, Math.min(2.0, k.scale)) : 1;
      const width = (k.width != null && Number.isFinite(k.width)) ? Math.max(0.5, Math.min(1.5, k.width)) : 1;
      const g = ctx.group, L = ctx.L, M = ctx.mats, rwY = 0.9, rwZ = -2.15 * L, ww = 1.55 * width;
      const rw1 = _mesh(_box(ww, 0.03 * scale, 0.36 * scale), M.bodyMat(M.gradMix(1.0), 0)); rw1.position.set(0, rwY, rwZ); rw1.rotation.x = angle; g.add(rw1);
      const rw2 = _mesh(_box(ww, 0.02 * scale, 0.24 * scale), M.bodyMat(M.gradMix(0.9), 0)); rw2.position.set(0, rwY + 0.12, rwZ - 0.05); rw2.rotation.x = angle - 0.06; g.add(rw2);
      const pylon = _mesh(_box(0.09 * scale, 0.82 * scale, 0.2 * scale), M.carbon); pylon.position.set(0, rwY - 0.42, rwZ + 0.05); g.add(pylon);
      for (const sx of [-1, 1]) { const ep = _mesh(_box(0.04, 0.36 * scale, 0.44 * scale), M.bodyMat(M.gradMix(0.1), 0)); ep.position.set(sx * ww / 2, rwY - 0.04, rwZ); g.add(ep); }
      const bar = _mesh(_box(ww * 0.8, 0.04, 0.04), M.glowMat(M.grad.a, 0.95)); bar.position.set(0, rwY - 0.03, rwZ - 0.2); g.add(bar);
    },
    rearSpoilerLow(ctx) {
      // G3 knobs — same semantics. Default angle -0.06 reproduces original.
      const k = ctx.knobs || {};
      const angle = (k.angle != null && Number.isFinite(k.angle)) ? Math.max(-0.6, Math.min(0.6, k.angle)) : -0.06;
      const scale = (k.scale != null && Number.isFinite(k.scale)) ? Math.max(0.5, Math.min(2.0, k.scale)) : 1;
      const width = (k.width != null && Number.isFinite(k.width)) ? Math.max(0.5, Math.min(1.5, k.width)) : 1;
      const g = ctx.group, L = ctx.L, M = ctx.mats, rwZ = -2.15 * L, ww = 1.55 * width;
      const sp = _mesh(_box(ww, 0.04 * scale, 0.38 * scale), M.bodyMat(M.gradMix(1.0), 0)); sp.position.set(0, 0.55, rwZ); sp.rotation.x = angle; g.add(sp);
      for (const sx of [-1, 1]) { const ep = _mesh(_box(0.03, 0.28 * scale, 0.44 * scale), M.bodyMat(M.gradMix(0.15), 0)); ep.position.set(sx * ww / 2, 0.47, rwZ); g.add(ep); }
      const bar = _mesh(_box(ww * 0.8, 0.04, 0.04), M.glowMat(M.grad.a, 0.95)); bar.position.set(0, 0.53, rwZ - 0.18); g.add(bar);
    },
    hoverFins(ctx) {
      // G3 knobs — angle (splay rad, clamp ±0.6, default -0.15) + scale only (fins have no span knob).
      const k = ctx.knobs || {};
      const angle = (k.angle != null && Number.isFinite(k.angle)) ? Math.max(-0.6, Math.min(0.6, k.angle)) : -0.15;
      const scale = (k.scale != null && Number.isFinite(k.scale)) ? Math.max(0.5, Math.min(2.0, k.scale)) : 1;
      const g = ctx.group, L = ctx.L, M = ctx.mats, rwZ = -2.0 * L;
      for (const sx of [-1, 1]) {
        const wl = _mesh(_box(0.48 * scale, 0.04 * scale, 0.34 * scale), M.bodyMat(M.gradMix(0.95), 0)); wl.position.set(sx * 0.56, 0.70, rwZ); wl.rotation.x = angle; wl.rotation.y = sx * 0.1; g.add(wl);
        const ep = _mesh(_box(0.03, 0.22 * scale, 0.38 * scale), M.bodyMat(M.gradMix(0.1), 0)); ep.position.set(sx * 0.80, 0.64, rwZ); g.add(ep);
        const py = _mesh(_box(0.04 * scale, 0.32 * scale, 0.12 * scale), M.carbon); py.position.set(sx * 0.56, 0.54, rwZ); g.add(py);
        const bar = _mesh(_box(0.38 * scale, 0.03, 0.03), M.glowMat(M.grad.a, 0.95)); bar.position.set(sx * 0.56, 0.68, rwZ - 0.16); g.add(bar);
      }
    },
    splitter(ctx) {
      const g = ctx.group, L = ctx.L, M = ctx.mats;
      const k = ctx.knobs || {};
      const scale = k.scale != null ? Math.max(0.5, Math.min(2.0, k.scale)) : 1;
      const z = (k.z != null ? k.z : 2.5) * L;
      const fs = _mesh(_box(1.7 * scale, 0.05 * scale, 0.5 * scale), M.bodyMat(M.gradMix(0.1), 0)); fs.position.set(0, 0.12, z); g.add(fs);
    },
    splitterGlow(ctx) {
      const g = ctx.group, L = ctx.L, M = ctx.mats;
      const k = ctx.knobs || {};
      const scale = k.scale != null ? Math.max(0.5, Math.min(2.0, k.scale)) : 1;
      const z = (k.z != null ? k.z : 2.5) * L;
      const fs = _mesh(_box(1.8 * scale, 0.07 * scale, 0.5 * scale), M.bodyMat(M.gradMix(0.1), 0)); fs.position.set(0, 0.12, z); g.add(fs);
      const edge = _mesh(_box(1.7 * scale, 0.03 * scale, 0.05 * scale), M.glowMat(M.grad.b, 0.95)); edge.position.set(0, 0.12, z + 0.24 * scale); g.add(edge);
    },
    halo(ctx) {
      const g = ctx.group, L = ctx.L, M = ctx.mats, z = 0.25 * L;
      const halo = _mesh(_tor(0.18, 0.022, 8, 24), M.carbon); halo.rotation.x = Math.PI / 2 - 0.2; halo.position.set(0, 0.54, z); g.add(halo);
      const sf = _mesh(_box(0.024, 0.22, 0.024), M.carbon); sf.position.set(0, 0.44, z + 0.15); sf.rotation.x = 0.5; g.add(sf);
      for (const sx of [-1, 1]) { const sr = _mesh(_box(0.02, 0.20, 0.02), M.carbon); sr.position.set(sx * 0.16, 0.42, z - 0.10); sr.rotation.z = -sx * 0.4; g.add(sr); }
    },
    sharkFin(ctx) {
      const g = ctx.group, L = ctx.L, M = ctx.mats;
      const k = ctx.knobs || {};
      const scale = k.scale != null ? Math.max(0.5, Math.min(2.0, k.scale)) : 1;
      const z = (k.z != null ? k.z : -0.6) * L;
      const fin = _mesh(_box(0.03, 0.42 * scale, 1.4 * L), M.bodyMat(M.gradMix(0.85), 0)); fin.position.set(0, 0.44 + 0.21 * scale, z); g.add(fin);
    },
    diffuser(ctx) {
      const g = ctx.group, L = ctx.L, M = ctx.mats;
      const k = ctx.knobs || {};
      const scale = k.scale != null ? Math.max(0.5, Math.min(2.0, k.scale)) : 1;
      const z = (k.z != null ? k.z : -2.0) * L;
      const d = _mesh(_box(0.9 * scale, 0.06 * scale, 0.5 * scale), M.carbon); d.position.set(0, 0.10, z); d.rotation.x = 0.18; g.add(d);
      const bar = _mesh(_box(0.8 * scale, 0.02 * scale, 0.03 * scale), M.glowMat(M.grad.a, 0.8)); bar.position.set(0, 0.08, z - 0.2 * scale); g.add(bar);
    },
    exhausts(ctx) {
      const g = ctx.group, L = ctx.L, M = ctx.mats;
      const k = ctx.knobs || {};
      const scale = k.scale != null ? Math.max(0.5, Math.min(2.0, k.scale)) : 1;
      const z = (k.z != null ? k.z : -0.9) * L;
      for (const sx of [-1, 1]) { const pipe = _mesh(_cyl(0.05 * scale, 0.05 * scale, 0.7 * scale, 10), M.chrome); pipe.rotation.z = Math.PI / 2; pipe.rotation.y = sx * 0.12; pipe.position.set(sx * 0.34, 0.22, z); g.add(pipe); }
    },
    exposedEngine(ctx) {
      const g = ctx.group, L = ctx.L, M = ctx.mats;
      const k = ctx.knobs || {};
      const scale = k.scale != null ? Math.max(0.5, Math.min(2.0, k.scale)) : 1;
      const z = (k.z != null ? k.z : -0.55) * L;
      const block = _mesh(_box(0.5 * scale, 0.22 * scale, 0.4 * scale), _stdMat(0x3a3a44, 0.9, 0.4, ctx.envMap)); block.position.set(0, 0.23 + 0.11 * scale, z); g.add(block);
      for (let i = -1; i <= 1; i++) { const cy = _mesh(_cyl(0.05 * scale, 0.05 * scale, 0.16 * scale, 10), M.chrome); cy.position.set(i * 0.14 * scale, 0.34 + 0.16 * scale, z); g.add(cy); }
    },
    hoverChannels(ctx) {
      const g = ctx.group, L = ctx.L, M = ctx.mats;
      const k = ctx.knobs || {};
      const scale = k.scale != null ? Math.max(0.5, Math.min(2.0, k.scale)) : 1;
      for (const sx of [-1, 1]) { const ch = _mesh(_box(0.04 * scale, 0.06 * scale, 1.4 * L), M.glowMat(M.grad.b, 0.85)); ch.position.set(sx * 0.62, 0.30, 0); g.add(ch); }
    },
    glowCore(ctx) {
      const g = ctx.group, L = ctx.L, M = ctx.mats;
      const k = ctx.knobs || {};
      const scale = k.scale != null ? Math.max(0.5, Math.min(2.0, k.scale)) : 1;
      const z = (k.z != null ? k.z : -2.0) * L;
      const noz = _mesh(_cyl(0.18 * scale, 0.22 * scale, 0.42 * scale, 16), M.carbon); noz.rotation.x = Math.PI / 2; noz.position.set(0, 0.22, z); g.add(noz);
      const core = _mesh(_sph(0.12 * scale, 12, 8), M.glowMat(M.grad.b, 1.0)); core.position.set(0, 0.22, z - 0.1 * scale); g.add(core);
      g.userData.thrusterGlow = core;
    },
    ducktail(ctx) {
      const g = ctx.group, L = ctx.L, M = ctx.mats;
      const k = ctx.knobs || {};
      const scale = k.scale != null ? Math.max(0.5, Math.min(2.0, k.scale)) : 1;
      const z = (k.z != null ? k.z : -1.7) * L;
      const dt = _mesh(_box(0.7 * scale, 0.05 * scale, 0.3 * scale), M.bodyMat(M.gradMix(0.6), 0)); dt.position.set(0, 0.40, z); dt.rotation.x = -0.2; g.add(dt);
    },
    chromeTrim(ctx) {
      const k = ctx.knobs || {};
      const scale = k.scale != null ? Math.max(0.5, Math.min(2.0, k.scale)) : 1;
      const g = ctx.group, L = ctx.L, M = ctx.mats;
      for (const sx of [-1, 1]) { const tr = _mesh(_box(0.02 * scale, 0.03 * scale, 2.4 * L), M.chrome); tr.position.set(sx * 0.36, 0.30, 0); g.add(tr); }
    },
    lightBar(ctx) {
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
    buildWheels(group, spec, L, spec.wheelStyle, mats, ghost, envMap);

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

  // thin wrapper: resolve the CarSpec for this garage selection, then render it.
  // customDesigns is OPTIONAL and forwarded to resolveSpec so the active custom design (if any) drives.
  DD.buildCar = function (garage, ghost, envMap, customDesigns) {
    return DD.buildCarFromSpec(DD.resolveSpec(garage, customDesigns), { ghost: ghost, envMap: envMap, garage: garage });
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
      const handle = new THREE.Mesh(new THREE.SphereGeometry(0.15, 12, 8), mat);
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

  // T12 cross-section: build 18 ring-point dots for ONE station's cross-section outline. Each dot maps
  // 1:1 to hull.rings[stationIndex].pts[pointIndex]. Mirror axis is X=0 — dragging point i also moves
  // the mirror partner (K - i) % K when ring.mirror !== false (applied by the caller during drag).
  DD.buildCrossHandles = function (spec, stationIndex) {
    spec = DD.normalizeSpec(spec);
    const hp = spec.chassis.hardpoints, L = spec.chassis.L, hull = spec.chassis.hull;
    const st = hull.station[stationIndex]; if (!st) return new THREE.Group();
    const frontZ = hp.frontZ * L, rearZ = hp.rearZ * L;
    const wheelbase = frontZ - rearZ, midZ = (frontZ + rearZ) / 2;
    const WIDTH = 1.18, HEIGHT = 0.92, YB = 0.05;
    const hw = Math.min(st[1], hull.fenderClamp) * WIDTH;
    const hgt = Math.max(st[2] * HEIGHT, 0.04);
    const yc = YB + st[3] * HEIGHT;
    const wz = st[0] * wheelbase + midZ;
    const K = 18;
    // resolve the active pts: override if present, else synthesize from the global ellipse
    const override = hull.rings && hull.rings[stationIndex] && hull.rings[stationIndex].pts;
    const pts = [];
    for (let i = 0; i < K; i++) {
      const th = (i / K) * Math.PI * 2;
      if (override && override[i]) { pts.push({ x: override[i].x, y: override[i].y }); }
      else { pts.push({ x: Math.cos(th), y: Math.sin(th) }); } // unit circle fallback
    }
    const mat = new THREE.MeshBasicMaterial({ color: 0xffe66d, depthTest: false });
    const group = new THREE.Group();
    for (let i = 0; i < K; i++) {
      const dot = new THREE.Mesh(new THREE.SphereGeometry(0.10, 10, 8), mat);
      dot.position.set(hw * pts[i].x, yc + hgt * 0.5 * pts[i].y, wz);
      dot.userData = { stationIndex: stationIndex, pointIndex: i };
      dot.renderOrder = 1000;
      group.add(dot);
    }
    return group;
  };

  // Reposition cross-handle dots in place during a drag (no rebuild). Reads the live ring pts.
  DD.updateCrossHandlePositions = function (handleGroup, spec, stationIndex) {
    spec = DD.normalizeSpec(spec);
    const hp = spec.chassis.hardpoints, L = spec.chassis.L, hull = spec.chassis.hull;
    const st = hull.station[stationIndex]; if (!st) return;
    const frontZ = hp.frontZ * L, rearZ = hp.rearZ * L;
    const wheelbase = frontZ - rearZ, midZ = (frontZ + rearZ) / 2;
    const WIDTH = 1.18, HEIGHT = 0.92, YB = 0.05;
    const hw = Math.min(st[1], hull.fenderClamp) * WIDTH;
    const hgt = Math.max(st[2] * HEIGHT, 0.04);
    const yc = YB + st[3] * HEIGHT;
    const wz = st[0] * wheelbase + midZ;
    const override = hull.rings && hull.rings[stationIndex] && hull.rings[stationIndex].pts;
    handleGroup.children.forEach(function (h) {
      const i = h.userData.pointIndex; if (i == null) return;
      let x, y;
      if (override && override[i]) { x = override[i].x; y = override[i].y; }
      else { const th = (i / 18) * Math.PI * 2; x = Math.cos(th); y = Math.sin(th); }
      h.position.set(hw * x, yc + hgt * 0.5 * y, wz);
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
  /* Garage stage — replaced with a dedicated self-contained garage room (obsidian floor,
     indigo vertical gradient backdrop, overhead softbox light rig, and horizontal neon accent wire) */
  DD.buildGarageStage = function (envMap, theme) {
    const group = new THREE.Group();

    // 1. Solid Floor Platform (a beveled circular stage)
    const stageGeo = new THREE.CylinderGeometry(8.5, 8.5, 0.2, 64);
    const stageMat = new THREE.MeshPhysicalMaterial({
      color: 0x0c0c12, // polished obsidian gray
      metalness: 0.2,
      roughness: 0.05,
      clearcoat: 1.0,
      clearcoatRoughness: 0.05,
      envMap: envMap || null,
      envMapIntensity: 1.2
    });
    const stage = new THREE.Mesh(stageGeo, stageMat);
    stage.position.y = -0.1; // top face sits exactly at y = 0
    stage.receiveShadow = true;
    group.add(stage);

    // 2. Backdrop: Radial gradient shader that casts a soft accent spotlight glow
    const bgGeo = new THREE.PlaneGeometry(80, 50);
    const accentColor = (theme && theme.accent) ? col(theme.accent) : col([0.62, 0.48, 1.0]);
    const bgMat = new THREE.ShaderMaterial({
      uniforms: {
        accentColor: { value: new THREE.Color().copy(accentColor) }
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
        uniform vec3 accentColor;
        void main() {
          // Soft spotlight glow centered at bottom-middle (0.5, 0.2)
          float d = distance(vUv, vec2(0.5, 0.2));
          vec3 glow = accentColor * smoothstep(0.7, 0.0, d) * 0.42;
          vec3 bg = mix(vec3(0.015, 0.015, 0.025), vec3(0.003, 0.003, 0.008), vUv.y);
          gl_FragColor = vec4(bg + glow, 1.0);
        }
      `,
      depthWrite: false
    });
    const backdrop = new THREE.Mesh(bgGeo, bgMat);
    backdrop.position.set(0, 20, -15); // pushed back slightly
    group.add(backdrop);

    // 3. Overhead Softbox (Visual mesh representation)
    const boxGeo = new THREE.BoxGeometry(4, 0.1, 6);
    const boxMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const softbox = new THREE.Mesh(boxGeo, boxMat);
    softbox.position.set(0, 5, 0);
    group.add(softbox);

    // Real light: Overhead DirectionalLight
    const keyLight = new THREE.DirectionalLight(0xffffff, 2.2);
    keyLight.position.set(0, 6, 0);
    keyLight.target.position.set(0, 0, 0);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.width = 1024;
    keyLight.shadow.mapSize.height = 1024;
    keyLight.shadow.camera.near = 0.5;
    keyLight.shadow.camera.far = 10;
    keyLight.shadow.camera.left = -5;
    keyLight.shadow.camera.right = 5;
    keyLight.shadow.camera.top = 5;
    keyLight.shadow.camera.bottom = -5;
    keyLight.shadow.bias = -0.0005;
    group.add(keyLight);
    group.add(keyLight.target);

    // Fill light: low ambient
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.35);
    group.add(ambientLight);

    group.name = "garageRoom";
    return group;
  };

  DD.captureGarageEnvironment = function (renderer, scene, carMesh) {
    try {
      const rt = new THREE.WebGLCubeRenderTarget(16, { generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter });
      const cam = new THREE.CubeCamera(1, 1000, rt);
      cam.position.set(0, 0.5, 0);
      
      let carWasVisible = false;
      if (carMesh) {
        carWasVisible = carMesh.visible;
        carMesh.visible = false;
      }
      
      cam.update(renderer, scene);
      
      if (carMesh) {
        carMesh.visible = carWasVisible;
      }

      let envTex;
      if (THREE.PMREMGenerator) {
        const pmrem = new THREE.PMREMGenerator(renderer);
        envTex = pmrem.fromCubemap(rt.texture).texture;
        pmrem.dispose();
      } else {
        envTex = rt.texture;
      }
      rt.dispose();
      return envTex;
    } catch (e) {
      console.error("Failed to capture garage environment map", e);
      return null;
    }
  };


  /* trail */

  DD.poseCar = function (group, pos, yaw, u, rollVis, pitchVis, wheelSpin, steerVis, bob) {
    const b = bob || 0;
    group.position.set(pos[0] + u[0] * b, pos[1] + u[1] * b, pos[2] + u[2] * b);
    // basis: up = u, fwd = yaw dir projected
    ipSet(poseF0, Math.sin(yaw), 0, Math.cos(yaw));
    const d = ipDot(poseF0, u);
    ipAddS(poseTempF, poseF0, u, -d);
    ipNorm(poseF, poseTempF);
    ipCross(poseTempCross, u, poseF);
    ipNorm(poseR, poseTempCross);

    poseV3_r.set(poseR[0], poseR[1], poseR[2]);
    poseV3_u.set(u[0], u[1], u[2]);
    poseV3_f.set(poseF[0], poseF[1], poseF[2]);

    poseM4.makeBasis(poseV3_r, poseV3_u, poseV3_f);
    group.quaternion.setFromRotationMatrix(poseM4);
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
    const relX = pos[0] - s.p[0];
    const relY = yRibbon - s.p[1];
    const relZ = pos[2] - s.p[2];
    const lat = relX * s.r[0] + relY * s.r[1] + relZ * s.r[2];
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
    ipSet(shadowF0, Math.sin(yaw), 0, Math.cos(yaw));
    const d = ipDot(shadowF0, groundNormal);
    ipAddS(shadowTempF, shadowF0, groundNormal, -d);
    ipNorm(shadowF, shadowTempF);
    ipCross(shadowTempCross, groundNormal, shadowF);
    ipNorm(shadowR, shadowTempCross);

    shadowV3_r.set(shadowR[0], shadowR[1], shadowR[2]);
    shadowV3_u.set(groundNormal[0], groundNormal[1], groundNormal[2]);
    shadowV3_f.set(shadowF[0], shadowF[1], shadowF[2]);

    shadowM4.makeBasis(shadowV3_r, shadowV3_u, shadowV3_f);
    shadow.quaternion.setFromRotationMatrix(shadowM4);
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
    // distV = extra follow distance at vmax, fovV = extra FOV(deg) at vmax. Both were pushed high
    // enough that the car read as "too far away" at speed (the wide FOV shrinks it as much as the
    // pull-back does). Trimmed both: still a clear speed sensation, but the car stays close at top end.
    classic: { dist0: 7.2, distV: 1.1, h0: 2.45, hV: 0.45, look: 11, fov0: 63, fovV: 22 },
    close:   { dist0: 5.7, distV: 0.8, h0: 1.90, hV: 0.40, look: 10, fov0: 64, fovV: 20 }
  };
  DD.cameraProfile = 'classic';
  DD.makeCamState = () => ({ pos: [0, 5, -10], look: [0, 0, 0], fov: 68, shake: [0, 0, 0], prevGrounded: true, prevVelY: 0 });

})(typeof window !== 'undefined' ? window : globalThis);
