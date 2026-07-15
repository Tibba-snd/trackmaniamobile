'use strict';

const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PORT = 9223;
const CHROME_PATHS = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
];

const WORKSPACE_DIR = 'c:/Users/tibba/Documents/Claude/Projects/trackmaniamobile';
const SVG_PATH = path.join(WORKSPACE_DIR, 'assets', 'icon-source.svg');

// Start a simple server to serve our icon page
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const mode = url.searchParams.get('mode') || 'composite';
  
  let svgContent = '';
  try {
    svgContent = fs.readFileSync(SVG_PATH, 'utf8');
  } catch (err) {
    res.statusCode = 500;
    res.end('SVG file not found: ' + err.message);
    return;
  }
  
  if (mode === 'foreground') {
    // Hide the background group
    svgContent = svgContent.replace('id="background"', 'id="background" style="display:none;"');
  } else if (mode === 'background') {
    // Hide the foreground group
    svgContent = svgContent.replace('id="foreground"', 'id="foreground" style="display:none;"');
  }
  
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(`
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        * { margin: 0; padding: 0; overflow: hidden; }
        body, html { width: 1024px; height: 1024px; background: transparent; }
        svg { display: block; width: 1024px; height: 1024px; }
      </style>
    </head>
    <body>
      ${svgContent}
    </body>
    </html>
  `);
});

server.listen(0, 'localhost', async () => {
  const serverPort = server.address().port;
  console.log(`Temp server listening on port ${serverPort}`);
  
  // Find Chrome path
  let chromePath = null;
  for (const p of CHROME_PATHS) {
    if (fs.existsSync(p)) {
      chromePath = p;
      break;
    }
  }
  if (!chromePath) {
    console.error('Could not find chrome.exe or msedge.exe');
    server.close();
    process.exit(1);
  }
  
  console.log(`Spawning Chrome: ${chromePath}`);
  const userDataPath = path.join(os.tmpdir(), `chrome-rasterize-${Date.now()}`);
  const chromeProcess = spawn(chromePath, [
    `--remote-debugging-port=${PORT}`,
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    `--user-data-dir=${userDataPath}`,
    '--force-device-scale-factor=1',
    '--window-size=1024,1024'
  ]);
  
  // Connect WebSocket
  let wsUrl = null;
  for (let i = 0; i < 30; i++) {
    try {
      wsUrl = await getWebSocketDebuggerUrl(PORT);
      break;
    } catch (e) {
      await new Promise(r => setTimeout(r, 200));
    }
  }
  
  if (!wsUrl) {
    console.error('Could not connect to Chrome debugging port');
    chromeProcess.kill();
    server.close();
    process.exit(1);
  }
  
  console.log(`Connecting WebSocket: ${wsUrl}`);
  const ws = new WebSocket(wsUrl);
  
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve);
    ws.addEventListener('error', reject);
  });
  
  let msgId = 1;
  function send(method, params = {}) {
    return new Promise((resolve) => {
      const id = msgId++;
      const handler = (event) => {
        const res = JSON.parse(event.data);
        if (res.id === id) {
          ws.removeEventListener('message', handler);
          resolve(res.result);
        }
      };
      ws.addEventListener('message', handler);
      ws.send(JSON.stringify({ id, method, params }));
    });
  }
  
  // Enable Page domain
  await send('Page.enable');
  
  const modes = ['composite', 'foreground', 'background'];
  const filenames = {
    composite: 'icon.png',
    foreground: 'icon-foreground.png',
    background: 'icon-background.png'
  };
  
  for (const mode of modes) {
    const targetUrl = `http://localhost:${serverPort}/?mode=${mode}`;
    console.log(`Navigating to: ${targetUrl}`);
    await send('Page.navigate', { url: targetUrl });
    
    // Wait for load event
    await new Promise(r => setTimeout(r, 1000));
    
    console.log(`Capturing screenshot for ${mode}...`);
    const result = await send('Page.captureScreenshot', { format: 'png', fromSurface: true });
    const buffer = Buffer.from(result.data, 'base64');
    
    const destPath = path.join(WORKSPACE_DIR, 'assets', filenames[mode]);
    fs.writeFileSync(destPath, buffer);
    console.log(`Saved screenshot to ${destPath}`);
  }
  
  // Clean up
  console.log('Cleaning up...');
  ws.close();
  chromeProcess.kill();
  server.close();
  
  // Delete temp folder if exists
  try {
    fs.rmSync(userDataPath, { recursive: true, force: true });
  } catch (err) {}
  
  console.log('Done!');
  process.exit(0);
});

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
            reject(new Error('No page target found'));
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
