/* DRIFTDREAM Sky & Atmosphere verification script.
   Empirically verifies:
   1. skyMesh and starsMesh accurately track the camera position at different coordinates (especially past 3000 units on Z).
   2. Sky colors conform to the sunset palette specification: peach (horizon) -> lilac (mid-sky) -> deep blue (top-sky).
*/
'use strict';

const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PORT = 9333;
const CHROME_PATHS = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
];

function getWebSocketDebuggerUrl(port) {
  return new Promise((resolve, reject) => {
    const req = http.get(`http://localhost:${port}/json/list`, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const targets = JSON.parse(data);
          const pageTarget = targets.find(t => t.type === 'page');
          if (pageTarget && pageTarget.webSocketDebuggerUrl) {
            resolve(pageTarget.webSocketDebuggerUrl);
          } else {
            reject(new Error('No page target found with webSocketDebuggerUrl'));
          }
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

async function connectToChrome(port) {
  for (let i = 0; i < 30; i++) {
    try {
      const url = await getWebSocketDebuggerUrl(port);
      return url;
    } catch (e) {
      await new Promise(r => setTimeout(r, 200));
    }
  }
  throw new Error('Timed out waiting for Chrome debugging port');
}

async function main() {
  // 1. Start HTTP Server
  const server = http.createServer((req, res) => {
    const parsedUrl = new URL(req.url, 'http://localhost');
    let filePath = path.join(__dirname, '..', parsedUrl.pathname);
    if (parsedUrl.pathname === '/') {
      filePath = path.join(__dirname, '..', 'index.html');
    }

    const ext = path.extname(filePath).toLowerCase();
    const mimeTypes = {
      '.html': 'text/html',
      '.js': 'application/javascript',
      '.css': 'text/css',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.json': 'application/json'
    };

    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.statusCode = 404;
        res.end('Not Found');
      } else {
        res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'text/plain' });
        res.end(data);
      }
    });
  });

  const webPort = await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
  console.log(`[INFRA] Web server started on port ${webPort}`);

  // 2. Find Chrome/Edge
  let chromePath = null;
  for (const p of CHROME_PATHS) {
    if (fs.existsSync(p)) {
      chromePath = p;
      break;
    }
  }
  if (!chromePath) {
    console.error('[ERROR] Neither Google Chrome nor Microsoft Edge was found.');
    server.close();
    process.exit(1);
  }

  // 3. Spawn Browser
  const chromeProcess = spawn(chromePath, [
    `--remote-debugging-port=${PORT}`,
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    `--user-data-dir=${path.join(os.tmpdir(), 'chrome-m1-verify-' + Date.now())}`,
    '--window-size=1280,720'
  ]);

  let wsUrl;
  try {
    wsUrl = await connectToChrome(PORT);
    console.log(`[INFRA] Connected to CDP: ${wsUrl}`);
  } catch (e) {
    console.error(`[ERROR] Failed to connect: ${e.message}`);
    chromeProcess.kill();
    server.close();
    process.exit(1);
  }

  // 4. Connect to Web Socket
  const ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve);
    ws.addEventListener('error', reject);
  });

  let commandId = 1;
  const pending = new Map();
  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) {
        reject(new Error(msg.error.message || JSON.stringify(msg.error)));
      } else {
        resolve(msg.result);
      }
    }
  });

  function send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = commandId++;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  }

  await send('Runtime.enable');
  await send('Page.enable');

  // Navigate to page
  const targetUrl = `http://localhost:${webPort}/index.html?testMode=true&seed=CAMP-T1-01&tier=1`;
  console.log(`[INFRA] Navigating to ${targetUrl}`);
  await send('Page.navigate', { url: targetUrl });

  // Wait 3 seconds for game initialization and scene setup
  console.log(`[INFRA] Waiting for scene initialization...`);
  await new Promise(r => setTimeout(r, 3000));

  // Run Browser-Side Verification
  const verifyExpression = `
    (function() {
      // Helper function to convert RGB [0..1] to HSL
      function rgbToHsl(r, g, b) {
        let max = Math.max(r, g, b), min = Math.min(r, g, b);
        let h, s, l = (max + min) / 2;

        if (max === min) {
          h = s = 0; // achromatic
        } else {
          let d = max - min;
          s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
          switch (max) {
            case r: h = (g - b) / d + (g < b ? 6 : 0); break;
            case g: h = (b - r) / d + 2; break;
            case b: h = (r - g) / d + 4; break;
          }
          h /= 6;
        }
        return [h * 360, s, l];
      }

      const G = window.DD.game;
      if (!G || !G.camera || !G.track || !G.scene) {
        return { success: false, error: "Game variables not fully initialized" };
      }

      const track = G.track;
      const theme = track.theme;

      // 1. Validate Sky Color Palette Conformance
      const horizonHsl = rgbToHsl(theme.skyHorizon[0], theme.skyHorizon[1], theme.skyHorizon[2]);
      const bandHsl = rgbToHsl(theme.skyBand[0], theme.skyBand[1], theme.skyBand[2]);
      const topHsl = rgbToHsl(theme.skyTop[0], theme.skyTop[1], theme.skyTop[2]);

      // Assertions for Sunset Palette:
      // Peach horizon: Hue in [15, 33], Saturation [0.75, 0.85], Lightness [0.60, 0.65]
      const isPeach = horizonHsl[0] >= 14.9 && horizonHsl[0] <= 33.1 && 
                      horizonHsl[1] >= 0.74 && horizonHsl[1] <= 0.86 &&
                      horizonHsl[2] >= 0.59 && horizonHsl[2] <= 0.66;

      // Lilac band: Hue in [265, 285], Saturation [0.45, 0.55], Lightness [0.52, 0.58]
      const isLilac = bandHsl[0] >= 264.9 && bandHsl[0] <= 285.1 &&
                      bandHsl[1] >= 0.44 && bandHsl[1] <= 0.56 &&
                      bandHsl[2] >= 0.51 && bandHsl[2] <= 0.59;

      // Deep blue top: Hue in [220, 250], Saturation [0.50, 0.60], Lightness [0.08, 0.16]
      const isDeepBlue = topHsl[0] >= 219.9 && topHsl[0] <= 250.1 &&
                         topHsl[1] >= 0.49 && topHsl[1] <= 0.61 &&
                         topHsl[2] >= 0.07 && topHsl[2] <= 0.17;

      const paletteResult = {
        skyHorizon: { rgb: theme.skyHorizon, hsl: horizonHsl, conforms: isPeach },
        skyBand: { rgb: theme.skyBand, hsl: bandHsl, conforms: isLilac },
        skyTop: { rgb: theme.skyTop, hsl: topHsl, conforms: isDeepBlue },
        conformsFully: isPeach && isLilac && isDeepBlue
      };

      // 2. Force StarsMesh generation to verify stars tracking
      // Build a starsMesh if not present (force atmosphere to starfield and rebuild scene root)
      let starsCreated = false;
      if (!track.starsMesh) {
        // Backup atmosphere
        const oldAtm = theme.atmosphere;
        theme.atmosphere = 'starfield';
        
        // Temporarily recreate track scene components
        const rng = window.DD.makeRng(track.seed + '::decor');
        // Let's create and add starsMesh directly using the scene's Three.js context
        const starsGeo = new THREE.BufferGeometry();
        const n = 700;
        const pos = new Float32Array(n * 3);
        const colFunc = (c) => new THREE.Color(c[0], c[1], c[2]);
        for (let i = 0; i < n; i++) {
          const a = rng.range(0, Math.PI * 2), e = rng.range(0.05, 1.4);
          const r = 2600;
          pos[i * 3] = Math.cos(a) * Math.cos(e) * r;
          pos[i * 3 + 1] = Math.sin(e) * r;
          pos[i * 3 + 2] = Math.sin(a) * Math.cos(e) * r;
        }
        starsGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        const starsMat = new THREE.PointsMaterial({
          color: colFunc(theme.accent), size: 7, sizeAttenuation: false,
          transparent: true, opacity: 0.8, depthWrite: false, fog: false
        });
        const starsMesh = new THREE.Points(starsGeo, starsMat);
        
        G.scene.add(starsMesh);
        track.starsMesh = starsMesh;
        starsCreated = true;
      }

      // 3. Verify Position Tracking (especially past 3000 units on Z)
      const testCoordinates = [
        [0, 5, 0],
        [500, 20, 1500],
        [1000, 100, 3000],
        [-100, 200, 4500],
        [3000, 50, 6000]
      ];

      const trackingResults = [];
      for (const coords of testCoordinates) {
        // Move camera position
        G.camera.position.set(coords[0], coords[1], coords[2]);

        // Trigger updates
        // Call the game's actual DD.updateCamera code by passing dummy values
        const dummyCamState = { pos: coords, look: [0, 0, 0], fov: 68 };
        const dummyCar = { idx: 0, pos: [0,0,0], yaw: 0, sliding: false };
        window.DD.updateCamera(G.camera, dummyCamState, dummyCar, track, 0.016, 0);

        // Assert positions
        const camPos = [G.camera.position.x, G.camera.position.y, G.camera.position.z];
        const skyPos = [track.skyMesh.position.x, track.skyMesh.position.y, track.skyMesh.position.z];
        const starsPos = track.starsMesh ? [track.starsMesh.position.x, track.starsMesh.position.y, track.starsMesh.position.z] : null;

        const skyDist = Math.sqrt(
          (skyPos[0] - camPos[0])**2 +
          (skyPos[1] - camPos[1])**2 +
          (skyPos[2] - camPos[2])**2
        );

        let starsDist = 0;
        if (starsPos) {
          starsDist = Math.sqrt(
            (starsPos[0] - camPos[0])**2 +
            (starsPos[1] - camPos[1])**2 +
            (starsPos[2] - camPos[2])**2
          );
        }

        trackingResults.push({
          cameraPos: camPos,
          skyPos: skyPos,
          starsPos: starsPos,
          skyOffset: skyDist,
          starsOffset: starsDist,
          ok: skyDist < 0.01 && (!starsPos || starsDist < 0.01)
        });
      }

      // Check far clipping effects:
      // When camera is at (0, 0, 4500), let's verify distance to sky mesh vertices.
      // Since skyMesh is a sphere of radius 3000, and it is positioned exactly at camera.position,
      // all vertices are exactly 3000 units away from the camera.
      // Since camera far clip plane is 6000 (verified from three.PerspectiveCamera(68, ..., 6.1, 6000)),
      // 3000 is always < 6000, so it never gets clipped, regardless of absolute coordinate magnitude.
      // We will verify the camera's far clipping plane too.
      const farClip = G.camera.far;
      const skyRadius = track.skyMesh.geometry.parameters.radius;

      return {
        success: true,
        paletteResult,
        trackingResults,
        cameraFarClip: farClip,
        skyRadius: skyRadius,
        trackingFullyOk: trackingResults.every(r => r.ok),
        clipOk: skyRadius < farClip
      };
    })()
  `;

  console.log(`[INFRA] Evaluating verification script inside browser context...`);
  const evalRes = await send('Runtime.evaluate', {
    expression: verifyExpression,
    returnByValue: true
  });

  const result = evalRes.result.value;
  if (!result || !result.success) {
    console.error(`[ERROR] Verification execution failed:`, result ? result.error : evalRes);
    ws.close();
    chromeProcess.kill();
    server.close();
    process.exit(1);
  }

  console.log(`\n=================== VERIFICATION RESULTS ===================`);
  
  console.log(`\n--- 1. Sunset Sky Palette Conformance ---`);
  console.log(`Horizon Color (Peach): RGB=[${result.paletteResult.skyHorizon.rgb.map(n=>n.toFixed(3))}] HSL=[${result.paletteResult.skyHorizon.hsl.map(n=>n.toFixed(1))}] -> Conforms: ${result.paletteResult.skyHorizon.conforms}`);
  console.log(`Mid-Sky Color (Lilac): RGB=[${result.paletteResult.skyBand.rgb.map(n=>n.toFixed(3))}] HSL=[${result.paletteResult.skyBand.hsl.map(n=>n.toFixed(1))}] -> Conforms: ${result.paletteResult.skyBand.conforms}`);
  console.log(`Top-Sky Color (Deep Blue): RGB=[${result.paletteResult.skyTop.rgb.map(n=>n.toFixed(3))}] HSL=[${result.paletteResult.skyTop.hsl.map(n=>n.toFixed(1))}] -> Conforms: ${result.paletteResult.skyTop.conforms}`);
  console.log(`Palette fully conforms to sunset specification (Peach -> Lilac -> Deep Blue): ${result.paletteResult.conformsFully}`);

  console.log(`\n--- 2. Sky & Stars Mesh Tracking (Past 3000 units on Z) ---`);
  result.trackingResults.forEach((tr, idx) => {
    console.log(`Test Coordinate ${idx + 1}: CamPos=[${tr.cameraPos.map(n=>n.toFixed(1))}]`);
    console.log(`  SkyMeshPos   = [${tr.skyPos.map(n=>n.toFixed(1))}] (Offset: ${tr.skyOffset.toFixed(4)} units)`);
    if (tr.starsPos) {
      console.log(`  StarsMeshPos = [${tr.starsPos.map(n=>n.toFixed(1))}] (Offset: ${tr.starsOffset.toFixed(4)} units)`);
    }
    console.log(`  Tracking OK  = ${tr.ok}`);
  });
  console.log(`All coordinates tracked perfectly: ${result.trackingFullyOk}`);

  console.log(`\n--- 3. Clipping Plane Analysis ---`);
  console.log(`Camera Far Clipping Plane = ${result.cameraFarClip} units`);
  console.log(`Sky Mesh Radius           = ${result.skyRadius} units`);
  console.log(`Sky is fully within the far clipping plane (Radius < FarClip): ${result.clipOk}`);

  const allPassed = result.paletteResult.conformsFully && result.trackingFullyOk && result.clipOk;
  console.log(`\n=============================================================`);
  console.log(`FINAL RESULT: ${allPassed ? "PASSED" : "FAILED"}`);
  console.log(`=============================================================`);

  ws.close();
  chromeProcess.kill();
  server.close();

  if (allPassed) {
    process.exit(0);
  } else {
    process.exit(1);
  }
}

main().catch(err => {
  console.error("Unhanded rejection:", err);
  process.exit(1);
});
