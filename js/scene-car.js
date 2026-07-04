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
      // O6: Asymmetric neon blade extending from core to ring to serve as a visible spin cue
      const blade = _mesh(_box(0.03, r * 0.45, 0.02), M.glowMat(M.grad.a, 0.95));
      blade.position.set(side * 0.13, r * 0.42, 0); spin.add(blade);
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
    classic: { dist0: 7.4, distV: 2.0, h0: 2.45, hV: 0.45, look: 11, fov0: 63, fovV: 34 },
    close:   { dist0: 6.0, distV: 1.6, h0: 1.90, hV: 0.40, look: 10, fov0: 64, fovV: 32 }
  };
  DD.cameraProfile = 'classic';
  DD.makeCamState = () => ({ pos: [0, 5, -10], look: [0, 0, 0], fov: 68, shake: [0, 0, 0], prevGrounded: true, prevVelY: 0 });

})(typeof window !== 'undefined' ? window : globalThis);
