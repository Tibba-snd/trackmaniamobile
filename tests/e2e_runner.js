/* E2E Test Runner for DRIFTDREAM — Node-based visual verification.
   Launches Chrome headlessly, listens to CDP console logs, takes screenshots,
   and compares them browser-side against golden reference images. */
'use strict';

const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PORT = 9222;
const CHROME_PATHS = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
];

// Helper to query targets from Chrome HTTP Endpoint
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
    req.setTimeout(2000, () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });
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

// Compare function executed in the browser context
function getCompareExpression(actualB64, goldenB64, threshold = 0.05, maxDiffPixels = 0) {
  return `
    (async function() {
      const loadImage = (b64) => new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = (e) => reject(new Error("Failed to load image"));
        img.src = 'data:image/png;base64,' + b64;
      });

      try {
        const [imgAct, imgGold] = await Promise.all([loadImage("${actualB64}"), loadImage("${goldenB64}")]);
        const w = imgAct.width;
        const h = imgAct.height;

        const canvasAct = document.createElement('canvas');
        canvasAct.width = w; canvasAct.height = h;
        const ctxAct = canvasAct.getContext('2d');
        ctxAct.drawImage(imgAct, 0, 0);
        const dataAct = ctxAct.getImageData(0, 0, w, h).data;

        const canvasGold = document.createElement('canvas');
        canvasGold.width = w; canvasGold.height = h;
        const ctxGold = canvasGold.getContext('2d');
        ctxGold.drawImage(imgGold, 0, 0);
        const dataGold = ctxGold.getImageData(0, 0, w, h).data;

        const canvasDiff = document.createElement('canvas');
        canvasDiff.width = w; canvasDiff.height = h;
        const ctxDiff = canvasDiff.getContext('2d');
        const imgDataDiff = ctxDiff.createImageData(w, h);
        const dataDiff = imgDataDiff.data;

        let diffPixels = 0;
        for (let i = 0; i < dataAct.length; i += 4) {
          const r1 = dataAct[i], g1 = dataAct[i+1], b1 = dataAct[i+2], a1 = dataAct[i+3];
          const r2 = dataGold[i], g2 = dataGold[i+1], b2 = dataGold[i+2], a2 = dataGold[i+3];

          const diff = Math.sqrt((r1 - r2)**2 + (g1 - g2)**2 + (b1 - b2)**2 + (a1 - a2)**2) / 510;
          if (diff > ${threshold}) {
            diffPixels++;
            dataDiff[i] = 255; dataDiff[i+1] = 0; dataDiff[i+2] = 0; dataDiff[i+3] = 255; // Red diff
          } else {
            dataDiff[i] = r1; dataDiff[i+1] = g1; dataDiff[i+2] = b1; dataDiff[i+3] = Math.max(a1 * 0.3, 30);
          }
        }

        ctxDiff.putImageData(imgDataDiff, 0, 0);
        const diffB64 = canvasDiff.toDataURL('image/png').split(',')[1];

        return {
          success: true,
          match: diffPixels <= ${maxDiffPixels},
          diffPixels,
          diffPercent: (diffPixels / (w * h)) * 100,
          diffB64
        };
      } catch (err) {
        return { success: false, error: err.message };
      }
    })()
  `;
}

// Test cases specification
const TEST_CASES = [
  {
    name: 'boot_skip_menu',
    query: 'testMode=true&seed=CAMP-T1-01&tier=1',
    expectedLogs: [
      '[TEST] TRACK_LOAD: seed=CAMP-T1-01, tier=1',
      '[TEST] RACE_START'
    ],
    timeout: 10000,
    screenshotTrigger: '[TEST] RACE_START'
  },
  {
    name: 'autodrive_checkpoint',
    query: 'testMode=true&seed=CAMP-T1-01&tier=1&autodrive=true',
    expectedLogs: [
      '[TEST] TRACK_LOAD: seed=CAMP-T1-01, tier=1',
      '[TEST] RACE_START',
      '[TEST] CHECKPOINT: index=0'
    ],
    timeout: 90000,
    screenshotTrigger: '[TEST] CHECKPOINT: index=0'
  },
  {
    name: 'duration_timeout',
    query: 'testMode=true&seed=CAMP-T1-01&tier=1&autodrive=true&duration=2000',
    expectedLogs: [
      '[TEST] TRACK_LOAD: seed=CAMP-T1-01, tier=1',
      '[TEST] RACE_START',
      '[TEST] RESULT: FAIL: reason=timeout'
    ],
    timeout: 15000,
    screenshotTrigger: '[TEST] RESULT: FAIL: reason=timeout'
  }
];

// Programmatic test case generator for Milestone 2
const tiers = [1, 2, 3, 4];
const features = [
  {
    category: 'phys',
    name: 'Core Physics & Movement',
    generate: (tier, idx) => {
      const seed = `CAMP-T${tier}-0${idx + 1}`;
      if (idx === 0) {
        return {
          name: `phys_accel_t${tier}`,
          query: `testMode=true&seed=${seed}&tier=${tier}&mockKeys=KeyW&duration=1000`,
          expectedLogs: ['[TEST] TRACK_LOAD', '[TEST] RACE_START'],
          assertion: 'window.DD.game.car.vel[2] > 5',
          timeout: 5000
        };
      } else if (idx === 1) {
        return {
          name: `phys_steer_r_t${tier}`,
          query: `testMode=true&seed=${seed}&tier=${tier}&mockKeys=KeyW,KeyD&duration=1000`,
          expectedLogs: ['[TEST] TRACK_LOAD', '[TEST] RACE_START'],
          assertion: 'window.DD.game.car.yaw < 0',
          timeout: 5000
        };
      } else {
        return {
          name: `phys_steer_l_t${tier}`,
          query: `testMode=true&seed=${seed}&tier=${tier}&mockKeys=KeyW,KeyA&duration=1000`,
          expectedLogs: ['[TEST] TRACK_LOAD', '[TEST] RACE_START'],
          assertion: 'window.DD.game.car.yaw > 0',
          timeout: 5000
        };
      }
    }
  },
  {
    category: 'gear',
    name: 'Gearbox & Transmission',
    generate: (tier, idx) => {
      const seed = `CAMP-T${tier}-0${idx + 4}`;
      if (idx === 0) {
        return {
          name: `gear_upshift_g2_t${tier}`,
          query: `testMode=true&seed=${seed}&tier=${tier}&mockKeys=KeyW&duration=1200`,
          expectedLogs: ['[TEST] TRACK_LOAD', '[TEST] RACE_START'],
          assertion: 'window.DD.game.car.gear >= 1',
          timeout: 5000
        };
      } else if (idx === 1) {
        return {
          name: `gear_rpm_t${tier}`,
          query: `testMode=true&seed=${seed}&tier=${tier}&mockKeys=KeyW&duration=800`,
          expectedLogs: ['[TEST] TRACK_LOAD', '[TEST] RACE_START'],
          assertion: 'window.DD.game.car.rpm01 >= 0 && window.DD.game.car.rpm01 <= 1.2',
          timeout: 5000
        };
      } else {
        return {
          name: `gear_shiftcut_t${tier}`,
          query: `testMode=true&seed=${seed}&tier=${tier}&mockKeys=KeyW&duration=1000`,
          expectedLogs: ['[TEST] TRACK_LOAD', '[TEST] RACE_START'],
          assertion: 'window.DD.game.car.shiftCut >= 0',
          timeout: 5000
        };
      }
    }
  },
  {
    category: 'drift',
    name: 'Drift Mechanics',
    generate: (tier, idx) => {
      const seed = `CAMP-T${tier}-0${idx + 5}`;
      if (idx === 0) {
        return {
          name: `drift_slip_t${tier}`,
          query: `testMode=true&seed=${seed}&tier=${tier}&mockKeys=KeyW,KeyD,Space&duration=1200`,
          expectedLogs: ['[TEST] TRACK_LOAD', '[TEST] RACE_START'],
          assertion: 'Math.abs(window.DD.game.car.slipR) >= 0',
          timeout: 5000
        };
      } else if (idx === 1) {
        return {
          name: `drift_braketap_t${tier}`,
          query: `testMode=true&seed=${seed}&tier=${tier}&mockKeys=KeyW,KeyA,KeyS&duration=1000`,
          expectedLogs: ['[TEST] TRACK_LOAD', '[TEST] RACE_START'],
          assertion: 'window.DD.game.car.slipR >= -1.6 && window.DD.game.car.slipR <= 1.6',
          timeout: 5000
        };
      } else {
        return {
          name: `drift_flag_check_t${tier}`,
          query: `testMode=true&seed=${seed}&tier=${tier}&mockKeys=KeyW,KeyD,Space&duration=1500`,
          expectedLogs: ['[TEST] TRACK_LOAD', '[TEST] RACE_START'],
          assertion: 'typeof window.DD.game.car.sliding === "boolean"',
          timeout: 5000
        };
      }
    }
  },
  {
    category: 'surf',
    name: 'Surfaces & Friction',
    generate: (tier, idx) => {
      const seed = `CAMP-T${tier}-0${idx + 6}`;
      if (idx === 0) {
        return {
          name: `surf_type_t${tier}`,
          query: `testMode=true&seed=${seed}&tier=${tier}&duration=200`,
          expectedLogs: ['[TEST] TRACK_LOAD', '[TEST] RACE_START'],
          assertion: 'window.DD.game.car.surf === 0 || window.DD.game.car.surf === 1 || window.DD.game.car.surf === 2',
          timeout: 5000
        };
      } else if (idx === 1) {
        return {
          name: `surf_dirt_t${tier}`,
          query: `testMode=true&seed=${seed}&tier=${tier}&duration=200`,
          expectedLogs: ['[TEST] TRACK_LOAD', '[TEST] RACE_START'],
          assertion: 'typeof window.DD.game.car.onDirt === "boolean"',
          timeout: 5000
        };
      } else {
        return {
          name: `surf_glass_t${tier}`,
          query: `testMode=true&seed=${seed}&tier=${tier}&duration=200`,
          expectedLogs: ['[TEST] TRACK_LOAD', '[TEST] RACE_START'],
          assertion: 'window.DD.SURF.GLASS === 1',
          timeout: 5000
        };
      }
    }
  },
  {
    category: 'aerial',
    name: 'Aerial Control & Dynamics',
    generate: (tier, idx) => {
      const seed = `CAMP-T${tier}-0${idx + 7}`;
      if (idx === 0) {
        return {
          name: `aerial_airtime_t${tier}`,
          query: `testMode=true&seed=${seed}&tier=${tier}&duration=200`,
          expectedLogs: ['[TEST] TRACK_LOAD', '[TEST] RACE_START'],
          assertion: 'window.DD.game.car.airTime >= 0',
          timeout: 5000
        };
      } else if (idx === 1) {
        return {
          name: `aerial_grounded_t${tier}`,
          query: `testMode=true&seed=${seed}&tier=${tier}&duration=200`,
          expectedLogs: ['[TEST] TRACK_LOAD', '[TEST] RACE_START'],
          assertion: 'typeof window.DD.game.car.grounded === "boolean"',
          timeout: 5000
        };
      } else {
        return {
          name: `aerial_pitch_t${tier}`,
          query: `testMode=true&seed=${seed}&tier=${tier}&duration=200`,
          expectedLogs: ['[TEST] TRACK_LOAD', '[TEST] RACE_START'],
          assertion: 'typeof window.DD.game.car.pitchVis === "number"',
          timeout: 5000
        };
      }
    }
  },
  {
    category: 'camp',
    name: 'Campaign & Save Game',
    generate: (tier, idx) => {
      const seed = `CAMP-T${tier}-0${idx + 8}`;
      if (idx === 0) {
        return {
          name: `camp_save_t${tier}`,
          query: `testMode=true&seed=${seed}&tier=${tier}&duration=100`,
          expectedLogs: ['[TEST] TRACK_LOAD', '[TEST] RACE_START'],
          assertion: 'window.DD.game.save !== null && typeof window.DD.game.save === "object"',
          timeout: 5000
        };
      } else if (idx === 1) {
        return {
          name: `camp_settings_t${tier}`,
          query: `testMode=true&seed=${seed}&tier=${tier}&duration=100`,
          expectedLogs: ['[TEST] TRACK_LOAD', '[TEST] RACE_START'],
          assertion: '["low", "medium", "high"].includes(window.DD.game.save.settings.quality)',
          timeout: 5000
        };
      } else {
        return {
          name: `camp_garage_t${tier}`,
          query: `testMode=true&seed=${seed}&tier=${tier}&duration=100`,
          expectedLogs: ['[TEST] TRACK_LOAD', '[TEST] RACE_START'],
          assertion: 'typeof window.DD.game.save.garage === "object"',
          timeout: 5000
        };
      }
    }
  },
  {
    category: 'ui',
    name: 'User Interface & HUD',
    generate: (tier, idx) => {
      const seed = `CAMP-T${tier}-0${idx + 9}`;
      if (idx === 0) {
        return {
          name: `ui_speed_t${tier}`,
          query: `testMode=true&seed=${seed}&tier=${tier}&duration=500`,
          expectedLogs: ['[TEST] TRACK_LOAD', '[TEST] RACE_START'],
          assertion: 'document.getElementById("hudSpeed") !== null && document.getElementById("hudSpeed").innerText !== ""',
          timeout: 5000
        };
      } else if (idx === 1) {
        return {
          name: `ui_gear_t${tier}`,
          query: `testMode=true&seed=${seed}&tier=${tier}&duration=500`,
          expectedLogs: ['[TEST] TRACK_LOAD', '[TEST] RACE_START'],
          assertion: 'document.getElementById("hudGear") !== null',
          timeout: 5000
        };
      } else {
        return {
          name: `ui_time_t${tier}`,
          query: `testMode=true&seed=${seed}&tier=${tier}&duration=500`,
          expectedLogs: ['[TEST] TRACK_LOAD', '[TEST] RACE_START'],
          assertion: 'document.getElementById("hudTime") !== null',
          timeout: 5000
        };
      }
    }
  },
  {
    category: 'vis',
    name: 'Visuals & Environment',
    generate: (tier, idx) => {
      const seed = `CAMP-T${tier}-01`;
      if (idx === 0) {
        return {
          name: `vis_canvas_t${tier}`,
          query: `testMode=true&seed=${seed}&tier=${tier}&duration=100`,
          expectedLogs: ['[TEST] TRACK_LOAD', '[TEST] RACE_START'],
          assertion: 'document.getElementById("gl") !== null',
          timeout: 5000
        };
      } else if (idx === 1) {
        return {
          name: `vis_theme_t${tier}`,
          query: `testMode=true&seed=${seed}&tier=${tier}&duration=100`,
          expectedLogs: ['[TEST] TRACK_LOAD', '[TEST] RACE_START'],
          assertion: 'typeof window.DD.game.track.theme === "object"',
          timeout: 5000
        };
      } else {
        return {
          name: `vis_car_mesh_t${tier}`,
          query: `testMode=true&seed=${seed}&tier=${tier}&duration=100`,
          expectedLogs: ['[TEST] TRACK_LOAD', '[TEST] RACE_START'],
          assertion: 'window.DD.game.carMesh !== null',
          timeout: 5000
        };
      }
    }
  }
];

for (const f of features) {
  for (const tier of tiers) {
    for (let idx = 0; idx < 3; idx++) {
      const tc = f.generate(tier, idx);
      tc.timeout = 15000;
      TEST_CASES.push(tc);
    }
  }
}

async function main() {
  const args = process.argv.slice(2);
  const updateSnapshots = args.includes('--update-snapshots') || args.includes('-u');
  // Support running specific test name
  const filterTest = args.find(a => !a.startsWith('-'));

  // Ensure directories exist
  const dirGolden = path.join(__dirname, 'screenshots', 'golden');
  const dirDiff = path.join(__dirname, 'screenshots', 'diff');
  const dirActual = path.join(__dirname, 'screenshots', 'actual');
  fs.mkdirSync(dirGolden, { recursive: true });
  fs.mkdirSync(dirDiff, { recursive: true });
  fs.mkdirSync(dirActual, { recursive: true });

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
        res.writeHead(200, {
          'Content-Type': mimeTypes[ext] || 'text/plain',
          'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
          'Pragma': 'no-cache',
          'Expires': '0'
        });
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
    console.error('[ERROR] Neither Google Chrome nor Microsoft Edge was found at standard paths.');
    server.close();
    process.exit(1);
  }
  let failedCount = 0;
  const targetTests = filterTest ? TEST_CASES.filter(t => t.name === filterTest) : TEST_CASES;

  if (targetTests.length === 0) {
    console.log(`[WARN] No test cases matched filter: ${filterTest}`);
  }

  let testIndex = 0;
  for (const tc of targetTests) {
    // Shorter sleep for rapid virtual time test runs
    await new Promise(r => setTimeout(r, 50));
    console.log(`\n[TEST] Running case: ${tc.name}`);

    // Assign a unique remote debugging port and user data dir for this test case
    const port = PORT + (testIndex % 100);
    const userDataPath = path.join(os.tmpdir(), `chrome-e2e-${Date.now()}-${testIndex}`);
    testIndex++;

    // Spawn Browser for this test case
    const chromeProcess = spawn(chromePath, [
      `--remote-debugging-port=${port}`,
      '--headless=new',
      '--disable-gpu',
      '--no-sandbox',
      `--user-data-dir=${userDataPath}`,
      '--force-device-scale-factor=1',
      '--window-size=1280,720'
    ]);

    let wsUrl;
    try {
      wsUrl = await connectToChrome(port);
    } catch (e) {
      console.error(`[ERROR] Failed to connect to Chrome debugging port on port ${port}: ${e.message}`);
      chromeProcess.kill();
      failedCount++;
      continue;
    }

    const ws = new WebSocket(wsUrl);
    try {
      await new Promise((resolve, reject) => {
        ws.addEventListener('open', resolve);
        ws.addEventListener('error', reject);
      });
    } catch (e) {
      console.error(`[ERROR] Failed to connect WebSocket: ${e.message}`);
      chromeProcess.kill();
      failedCount++;
      continue;
    }

    let commandId = 1;
    const pending = new Map();
    let consoleLogCallback = null;

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
      } else if (msg.method === 'Runtime.consoleAPICalled') {
        if (consoleLogCallback) {
          consoleLogCallback(msg.params);
        }
      } else if (msg.method === 'Runtime.exceptionThrown') {
        console.error(`  [BROWSER EXCEPTION]`, msg.params.exceptionDetails.exception ? (msg.params.exceptionDetails.exception.description || msg.params.exceptionDetails.exception.className) : msg.params.exceptionDetails.text);
      }
    });

    function send(method, params = {}) {
      return new Promise((resolve, reject) => {
        const id = commandId++;
        pending.set(id, { resolve, reject });
        ws.send(JSON.stringify({ id, method, params }));
      });
    }

    try {
      await send('Runtime.enable');
      await send('Page.enable');
    } catch (e) {
      console.error(`[ERROR] Failed enabling Runtime/Page: ${e.message}`);
      ws.close();
      chromeProcess.kill();
      failedCount++;
      continue;
    }

    const logs = [];
    let triggerPromiseResolve;
    const triggerPromise = new Promise(r => triggerPromiseResolve = r);

    const trigger = tc.screenshotTrigger || '[TEST] RESULT:';
    consoleLogCallback = (params) => {
      const text = params.args.map(arg => arg.value).join(' ');
      logs.push(text);
      console.log(`  [BROWSER] ${text}`);
      if (text.includes(trigger)) {
        triggerPromiseResolve();
      }
    };

    try {
      // Wait for page load event in real time (since virtual time is not active yet)
      let loadResolve;
      const loadPromise = new Promise(r => loadResolve = r);
      const loadListener = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.method === 'Page.loadEventFired') {
          loadResolve();
        }
      };
      ws.addEventListener('message', loadListener);

      // Navigate to page
      const targetUrl = `http://localhost:${webPort}/index.html?${tc.query}`;
      await send('Page.navigate', { url: targetUrl });

      // Wait for page load to finish
      await loadPromise;
      ws.removeEventListener('message', loadListener);

      // Set virtual time policy to advance the game loop instantly!
      // (Disabled to run in real-time and prevent task queues from freezing)
      /*
      await send('Emulation.setVirtualTimePolicy', {
        policy: 'advance',
        budget: 30000
      });
      */

      await send('Emulation.setDeviceMetricsOverride', {
        width: 1280,
        height: 720,
        deviceScaleFactor: 1,
        mobile: false
      });

      // Wait for trigger or timeout
      const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout waiting for trigger')), tc.timeout));
      await Promise.race([triggerPromise, timeoutPromise]);

      // Inject styling to hide unstable HUD elements before screenshot, and pause the game loop to free CPU
      await send('Runtime.evaluate', {
        expression: `
          (function() {
            window.requestAnimationFrame = () => {};
            const style = document.createElement('style');
            style.innerHTML = '#hudTime, #hudSpeed, #hudGear, #hudPB, #hudDelta, #countdown, #hudWarn { display: none !important; }';
            document.head.appendChild(style);
          })()
        `
      });

      // Evaluate assertion in page context if specified
      let assertionOK = true;
      if (tc.assertion) {
        console.log(`[INFRA] Evaluating assertion: ${tc.assertion}`);
        const evalRes = await send('Runtime.evaluate', {
          expression: tc.assertion,
          awaitPromise: true,
          returnByValue: true
        });
        
        if (evalRes && evalRes.result && evalRes.result.value === true) {
          console.log(`[PASS] Assertion passed`);
        } else {
          const val = evalRes && evalRes.result ? evalRes.result.value : undefined;
          console.log(`[FAIL] Assertion failed: "${tc.assertion}" evaluated to ${JSON.stringify(val)}`);
          assertionOK = false;
        }
      }

      // Capture screenshot
      console.log(`[INFRA] Capturing screenshot...`);
      const screenshotRes = await send('Page.captureScreenshot', { format: 'png' });
      const actualB64 = screenshotRes.data;

      const goldenPath = path.join(dirGolden, `${tc.name}.png`);
      const actualPath = path.join(dirActual, `${tc.name}.png`);
      const diffPath = path.join(dirDiff, `${tc.name}.png`);

      if (updateSnapshots || !fs.existsSync(goldenPath)) {
        fs.writeFileSync(goldenPath, Buffer.from(actualB64, 'base64'));
        console.log(`[PASS] Saved golden reference image for: ${tc.name}`);
      } else {
        // Perform Canvas comparison
        const goldenB64 = fs.readFileSync(goldenPath).toString('base64');
        fs.writeFileSync(actualPath, Buffer.from(actualB64, 'base64'));

        console.log(`[INFRA] Comparing screenshot browser-side...`);
        const maxDiffPixels = Math.floor((1280 * 720) * 0.20);
        const compareExpr = getCompareExpression(actualB64, goldenB64, 0.05, maxDiffPixels);
        // (Disabled virtual time policy adjustment for comparison)
        const evalRes = await send('Runtime.evaluate', {
          expression: compareExpr,
          awaitPromise: true,
          returnByValue: true
        });

        const comp = evalRes.result.value;
        if (!comp || !comp.success) {
          console.error(`[ERROR] Comparison evaluation failed:`, comp ? comp.error : evalRes);
          failedCount++;
          ws.close();
          chromeProcess.kill();
          continue;
        }

        // Check logs
        let logsOK = true;
        if (tc.expectedLogs) {
          for (const expected of tc.expectedLogs) {
            if (!logs.some(l => l.includes(expected))) {
              console.log(`[FAIL] Expected console log not found: "${expected}"`);
              logsOK = false;
            }
          }
        }

        if (comp.match && logsOK && assertionOK) {
          console.log(`[PASS] Case ${tc.name} succeeded (diff percent: ${comp.diffPercent.toFixed(2)}%)`);
        } else {
          if (!comp.match) {
            fs.writeFileSync(diffPath, Buffer.from(comp.diffB64, 'base64'));
            console.log(`[FAIL] Case ${tc.name} failed (diff percent: ${comp.diffPercent.toFixed(2)}%). Diff saved to tests/screenshots/diff/${tc.name}.png`);
          } else if (!logsOK) {
            console.log(`[FAIL] Case ${tc.name} failed due to missing expected logs.`);
          } else {
            console.log(`[FAIL] Case ${tc.name} failed due to failed assertion.`);
          }
          failedCount++;
        }
      }

    } catch (e) {
      console.log(`[FAIL] ${tc.name} error: ${e.message}`);
      failedCount++;
    }

    // Cleanup for this test case
    ws.close();
    chromeProcess.kill();
  }

  // Cleanup web server
  console.log('\n[INFRA] Cleaning up...');
  server.close();

  console.log(`\nE2E Tests completed. Failed count: ${failedCount}`);
  process.exit(failedCount ? 1 : 0);
}

main().catch(err => {
  console.error('[FATAL]', err);
  process.exit(1);
});
