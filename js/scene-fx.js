/* DRIFTDREAM scene fx — Skidmarks, smoke, sparks, weather, fireflies, trails, speed lines. */
(function (global) {
  'use strict';
  const DD = global.DD;
  const V = DD.v;
  const col = DD._sceneShared.col;
  const getDotTexture = () => DD._sceneShared.getDotTexture();

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
    if (!active || !car.grounded) { ud.prevL = ud.prevR = null; return; }
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
    if (emitting && car.grounded && !car.onDirt && car.surf !== DD.SURF.DIRT) {
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
  DD.updateSpeedLines = function (pts, camera, speedNorm, car, theme) {
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
    const isBoosting = !!(car && car.boostGlow > 0.05);
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
    if (isBoosting && theme) {
      pts.material.color.copy(col(theme.boostColor || [0, 1, 0.5]));
      pts.material.size = 0.95;
      pts.material.opacity = 0.85;
    } else if (theme) {
      pts.material.color.copy(col(theme.accent));
      pts.material.size = 0.3;
      pts.material.opacity = Math.max(0, speedNorm - 0.3) * 1.1;
    }
  };


  // Register on DD._sceneShared
  DD._sceneShared.buildFireflies = buildFireflies;

  DD.buildDust = function (theme) {
    const N = 120;
    const pos = new Float32Array(N * 3);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const dustCol = new THREE.Color(0x8c664d).lerp(col(theme.groundColor || [0.4, 0.3, 0.2]), 0.4);
    const m = new THREE.PointsMaterial({
      color: dustCol,
      size: 0.95,
      map: getDotTexture(),
      transparent: true,
      opacity: 0.32,
      blending: THREE.NormalBlending,
      depthWrite: false
    });
    const pts = new THREE.Points(g, m);
    pts.frustumCulled = false;
    pts.userData = { N, head: 0, life: new Float32Array(N), vel: new Float32Array(N * 3) };
    for (let i = 0; i < N; i++) pos[i * 3 + 1] = -9999;
    return pts;
  };

  let dustSeed = 9999;
  function dustRand() {
    const x = Math.sin(dustSeed++) * 10000;
    return x - Math.floor(x);
  }

  DD.updateDust = function (pts, car, track, dt, emitting) {
    const ud = pts.userData;
    const arr = pts.geometry.attributes.position.array;
    const speed = V.len(car.vel);
    if (emitting && car.grounded && speed > 5) {
      const s = track.samples[Math.min(car.idx, track.samples.length - 1)];
      const fwd = [Math.sin(car.yaw), 0, Math.cos(car.yaw)];
      const right = V.norm(V.cross(s.u, fwd));
      const count = speed > 35 ? 3 : (speed > 15 ? 2 : 1);
      for (let e = 0; e < count; e++) {
        const i = ud.head; ud.head = (ud.head + 1) % ud.N;
        const side = (ud.head % 2 === 0) ? -0.95 : 0.95;
        const p = V.addS(V.addS(V.addS(V.clone(car.pos), fwd, -1.4), right, side), s.u, 0.15);
        arr[i * 3] = p[0]; arr[i * 3 + 1] = p[1]; arr[i * 3 + 2] = p[2];
        ud.life[i] = 0.22 + dustRand() * 0.28;
        const scatter = 3.0;
        ud.vel[i * 3] = (dustRand() - 0.5) * scatter - fwd[0] * (speed * 0.25);
        ud.vel[i * 3 + 1] = 1.0 + dustRand() * 2.5 + speed * 0.05;
        ud.vel[i * 3 + 2] = (dustRand() - 0.5) * scatter - fwd[2] * (speed * 0.25);
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

  DD._sceneShared.buildDust = DD.buildDust;
  DD._sceneShared.updateDust = DD.updateDust;

})(typeof window !== 'undefined' ? window : globalThis);
