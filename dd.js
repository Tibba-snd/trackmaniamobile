#!/usr/bin/env node

/**
 * DRIFTDREAM Developer Tool (dd.js)
 * A unified, cross-platform CLI tool for local serving, testing, and Capacitor syncing.
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawnSync, execSync } = require('child_process');

const PORT_DEFAULT = 8000;
const ROOT_DIR = __dirname;

const MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.mp4': 'video/mp4'
};

function printHelp() {
  console.log(`
DRIFTDREAM Developer Tool (dd.js)
Usage:
  node dd.js <command> [arguments]

Commands:
  serve [port]       Start a zero-dependency local static file server.
                     Default port: ${PORT_DEFAULT}
  test               Run all unit and verification tests in sequence.
  e2e                Run the Chrome CDP-based end-to-end tests.
  e2e-update         Run e2e tests and update the golden screenshot baselines.
  sync               Synchronize source files to the Android Capacitor build.
  help               Show this help message.
`);
}

function handleServe(portArg) {
  const port = parseInt(portArg, 10) || PORT_DEFAULT;

  const server = http.createServer((req, res) => {
    // Sanitize and decode URL
    let safeUrl = decodeURIComponent(req.url.split('?')[0]);
    if (safeUrl.endsWith('/')) {
      safeUrl += 'index.html';
    }

    const filePath = path.join(ROOT_DIR, safeUrl);

    // Simple path traversal check
    if (!filePath.startsWith(ROOT_DIR)) {
      res.statusCode = 403;
      res.end('Forbidden');
      return;
    }

    fs.stat(filePath, (err, stats) => {
      if (err || !stats.isFile()) {
        res.statusCode = 404;
        res.setHeader('Content-Type', 'text/plain');
        res.end(`404 Not Found: ${safeUrl}`);
        return;
      }

      const ext = path.extname(filePath).toLowerCase();
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';

      res.statusCode = 200;
      res.setHeader('Content-Type', contentType);
      
      const stream = fs.createReadStream(filePath);
      stream.pipe(res);
    });
  });

  server.listen(port, () => {
    console.log(`\x1b[32m[DRIFTDREAM SERVER]\x1b[0m Running at http://localhost:${port}/`);
    console.log(`Press Ctrl+C to stop.`);
  });
}

function handleTest() {
  const tests = [
    { name: 'drivability.js', path: 'tests/drivability.js' },
    { name: 'verify_determinism.js', path: 'tests/verify_determinism.js' },
    { name: 'verify_colors.js', path: 'tests/verify_colors.js' },
    { name: 'verify_sky_stars.js', path: 'tests/verify_sky_stars.js' },
    { name: 'verify_camera.js', path: 'tests/verify_camera.js' },
    { name: 'verify_m2_features.js', path: 'tests/verify_m2_features.js' }
  ];

  console.log(`\x1b[36m[DRIFTDREAM TESTS]\x1b[0m Starting verification test suite...\n`);

  let allPassed = true;
  const results = [];

  for (const t of tests) {
    const fullPath = path.join(ROOT_DIR, t.path);
    console.log(`Running: ${t.name}...`);
    
    const proc = spawnSync('node', [fullPath], { stdio: 'inherit', cwd: ROOT_DIR });
    
    if (proc.status === 0) {
      console.log(`\x1b[32m[PASS]\x1b[0m ${t.name}\n`);
      results.push({ name: t.name, status: 'PASS' });
    } else {
      console.log(`\x1b[31m[FAIL]\x1b[0m ${t.name} (Exit code: ${proc.status})\n`);
      results.push({ name: t.name, status: 'FAIL' });
      allPassed = false;
    }
  }

  console.log('--------------------------------------------------');
  console.log('Test Summary:');
  for (const r of results) {
    const color = r.status === 'PASS' ? '\x1b[32m' : '\x1b[31m';
    console.log(`  ${color}[${r.status}]\x1b[0m ${r.name}`);
  }
  console.log('--------------------------------------------------');

  if (allPassed) {
    console.log(`\x1b[32;1mAll tests passed successfully!\x1b[0m`);
    process.exit(0);
  } else {
    console.error(`\x1b[31;1mSome tests failed. Please check the logs above.\x1b[0m`);
    process.exit(1);
  }
}

function handleE2E(update = false) {
  const e2ePath = path.join(ROOT_DIR, 'tests/e2e_runner.js');
  const args = update ? ['-u'] : [];
  
  console.log(`\x1b[36m[DRIFTDREAM E2E]\x1b[0m Running E2E screenshot tests${update ? ' (UPDATING GOLDENS)' : ''}...`);
  const proc = spawnSync('node', [e2ePath, ...args], { stdio: 'inherit', cwd: ROOT_DIR });

  if (proc.status === 0) {
    console.log(`\x1b[32;1mE2E tests finished successfully!\x1b[0m`);
    process.exit(0);
  } else {
    console.error(`\x1b[31;1mE2E tests failed (Exit code: ${proc.status}).\x1b[0m`);
    process.exit(proc.status || 1);
  }
}

function handleSync() {
  console.log(`\x1b[36m[DRIFTDREAM SYNC]\x1b[0m Syncing source files with Android Capacitor project...`);

  const apkBuildDir = path.join(ROOT_DIR, 'apk-build');
  const wwwDir = path.join(apkBuildDir, 'www');

  try {
    // 1. Delete existing www folder
    if (fs.existsSync(wwwDir)) {
      console.log(`Cleaning old synced directory: ${wwwDir}...`);
      fs.rmSync(wwwDir, { recursive: true, force: true });
    }

    // 2. Re-create structure
    fs.mkdirSync(wwwDir, { recursive: true });
    fs.mkdirSync(path.join(wwwDir, 'js'), { recursive: true });

    // 3. Copy index.html
    const indexSrc = path.join(ROOT_DIR, 'index.html');
    const indexDest = path.join(wwwDir, 'index.html');
    fs.copyFileSync(indexSrc, indexDest);
    console.log(`Copied index.html -> apk-build/www/index.html`);

    // Copy PWA files (manifest.json, sw.js, icon.png)
    const pwaFiles = ['manifest.json', 'sw.js', 'icon.png'];
    for (const file of pwaFiles) {
      const srcPath = path.join(ROOT_DIR, file);
      if (fs.existsSync(srcPath)) {
        fs.copyFileSync(srcPath, path.join(wwwDir, file));
        console.log(`Copied ${file} -> apk-build/www/${file}`);
      }
    }

    // 4. Copy js folder recursively
    const jsSrc = path.join(ROOT_DIR, 'js');
    const jsDest = path.join(wwwDir, 'js');
    
    // Node.js fs.cpSync handles recursive copies natively
    fs.cpSync(jsSrc, jsDest, { recursive: true });
    console.log(`Copied js/ -> apk-build/www/js/`);

    // 5. Run npx cap sync android
    console.log(`Executing: npx cap sync android...`);
    execSync('npx cap sync android', { cwd: apkBuildDir, stdio: 'inherit' });

    console.log(`\x1b[32;1mSync complete!\x1b[0m Build now with:\n  cd apk-build/android && gradlew assembleDebug`);
  } catch (err) {
    console.error(`\x1b[31m[ERROR] Sync failed:\x1b[0m`, err.message);
    process.exit(1);
  }
}

// Command dispatcher
const args = process.argv.slice(2);
const command = args[0] || 'help';

switch (command.toLowerCase()) {
  case 'serve':
    handleServe(args[1]);
    break;
  case 'test':
    handleTest();
    break;
  case 'e2e':
    handleE2E(false);
    break;
  case 'e2e-update':
    handleE2E(true);
    break;
  case 'sync':
    handleSync();
    break;
  case 'help':
  default:
    printHelp();
    break;
}
