(function () {
  'use strict';
  const DD = window.DD;
  if (!DD || !DD.PHYS) return;

  const ORIG = JSON.parse(JSON.stringify(DD.PHYS));
  const STORAGE_KEY = 'driftdream_phys_dev';

  function loadOverrides() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        for (const k in parsed) {
          if (typeof ORIG[k] === 'number') {
            DD.PHYS[k] = parsed[k];
          }
        }
      }
    } catch(e) {}
  }
  loadOverrides();

  const SCHEMA = [
    {
      tab: 'STEER',
      title: 'Steering & Yaw',
      params: [
        { key: 'steerMaxLow', min: 0.1, max: 1.5, step: 0.01, desc: 'Standstill steering lock (rad). Higher = tighter turning at low speed.' },
        { key: 'steerMaxHigh', min: 0.05, max: 0.8, step: 0.01, desc: 'High-speed steering lock (rad). Lower = more stable at speed.' },
        { key: 'steerRampUp', min: 1.0, max: 30.0, step: 0.5, desc: 'Steering speed turning in. Higher = faster wheel response.' },
        { key: 'steerRampDown', min: 1.0, max: 40.0, step: 0.5, desc: 'Steering speed returning to center. Higher = centers faster.' },
        { key: 'yawMax', min: 0.5, max: 3.0, step: 0.05, desc: 'Max turn rate (rad/s) in grip regime. Prevents instant spins.' },
        { key: 'yawTrack', min: 2.0, max: 30.0, step: 0.5, desc: 'Yaw speed matching target. Higher = sharper, more direct bite.' }
      ]
    },
    {
      tab: 'GRIP',
      title: 'Grip & Tires',
      params: [
        { key: 'gripF', min: 5.0, max: 35.0, step: 0.5, desc: 'Front axle mechanical grip. Higher = sharper turn-in.' },
        { key: 'gripR', min: 5.0, max: 35.0, step: 0.5, desc: 'Rear axle mechanical grip. Higher = more stable rear.' },
        { key: 'stiffK', min: 1.0, max: 25.0, step: 0.5, desc: 'Tire stiffness. Higher = quicker lateral force build-up.' },
        { key: 'tireKnee', min: 0.5, max: 5.0, step: 0.1, desc: 'Slip limit curve rolloff. Higher = sharper slide edge.' },
        { key: 'downforceK', min: 0.0, max: 0.5, step: 0.005, desc: 'Downforce grip multiplier. Higher = planted at high speeds.' }
      ]
    },
    {
      tab: 'SLIDE',
      title: 'Brake-Tap Slide',
      params: [
        // Entry: how the brake-tap breaks the rear loose and how the nose bites into the corner.
        { key: 'brakeRearGripMul', min: 0.2, max: 0.9, step: 0.01, desc: 'Rear grip during a brake-tap. LOWER = rear breaks loose easier = more rotation into the slide.' },
        { key: 'brakeFrontGripMul', min: 0.4, max: 1.0, step: 0.01, desc: 'Front grip during a brake-tap. HIGHER = more nose bite = the slide pulls the car onto a tighter line.' },
        // The "feels like sliding" pair — how far sideways the car sits, and how firmly it holds there.
        { key: 'slideAngle', min: 0.0, max: 0.7, step: 0.01, desc: 'How SIDEWAYS the slide sits — target slip angle at full steer, in RADIANS (0.44≈25°, 0.7≈40°). Bigger = more visibly sliding. The angle scales with how far you steer.' },
        { key: 'slideStab', min: 0.0, max: 20.0, step: 0.5, desc: 'How firmly the slide holds its angle. HIGHER = locks the drift angle in (crisp, spin-safe); LOWER = looser, angle drifts around. 0 = off (back to a shunt).' },
        // The anti-understeer core — what makes the slide MAKE the tight fast corner instead of plowing.
        { key: 'slideCoupling', min: 0.0, max: 16.0, step: 0.5, desc: 'Anti-understeer: how hard velocity follows the nose in a fast slide. HIGHER = tighter line, less wall-plow. 0 = off (pure model).' },
        { key: 'slideRotFree', min: 0.0, max: 1.0, step: 0.05, desc: 'Rotation freedom in a fast slide (relaxes the anti-spin counter so the nose rotates through the corner). HIGHER = rotates more before the assist catches it.' },
        // Speed window: below Lo the brake-tap just grips (grip stays fastest); above Hi full slide assist.
        { key: 'slideAssistVLo', min: 20.0, max: 80.0, step: 1.0, desc: 'Slide-assist START speed (m/s; 38≈137 km/h). Below this a brake-tap just grips — grip stays the fast line.' },
        { key: 'slideAssistVHi', min: 30.0, max: 100.0, step: 1.0, desc: 'Slide-assist FULL speed (m/s; 58≈209 km/h). At/above this the brake-slide gets full rotation + anti-understeer.' },
        // Stability: how the slide settles and recovers.
        { key: 'slideYawDamp', min: 0.2, max: 5.0, step: 0.1, desc: 'Slide yaw damping. HIGHER = slide settles/recovers faster; LOWER = looser, holds rotation longer.' },
        { key: 'counterAssist', min: 0.0, max: 40.0, step: 0.5, desc: 'Auto-countersteer (anti-spin on ANY slide). HIGHER = catches spins harder. This is what slideRotFree relaxes at speed.' },
        { key: 'slideRearMul', min: 0.2, max: 1.2, step: 0.02, desc: 'Rear grip once sliding. LOWER = rear stays looser through the slide.' },
        // Entry/exit shaping — the powerslide feel pass (2026-07-07).
        { key: 'slideBetaRate', min: 0.5, max: 6.0, step: 0.1, desc: 'How fast the slide angle BUILDS and releases (rad/s). LOWER = slower, more readable entry; higher = snappier.' },
        { key: 'slideEntryWin', min: 0.0, max: 0.8, step: 0.05, desc: 'Entry window (s) where brake decel is capped — the tap reads as weight transfer, not an anchor.' },
        { key: 'slideEntryBrakeCap', min: 0.2, max: 1.0, step: 0.05, desc: 'Max effective brake decel inside the entry window. 1.0 = no cap (back to the old entry shunt).' },
        { key: 'regimeBlendT', min: 0.05, max: 0.6, step: 0.05, desc: 'Grip↔slide dynamics crossfade time (s). HIGHER = softer morph into/out of the slide.' },
        { key: 'slideHoldThr', min: 0.0, max: 1.0, step: 0.05, desc: 'How much THROTTLE deepens/holds the slide angle — the power in powerslide.' },
        { key: 'slideHoldCoast', min: 0.0, max: 1.0, step: 0.05, desc: 'Angle fraction held at ZERO throttle — lifting shallows the slide toward this.' },
        { key: 'exitBoostA', min: 0.0, max: 6.0, step: 0.5, desc: 'Clean-exit reward accel (m/s²) for a moment after releasing the angle under throttle.' }
      ]
    },
    {
      tab: 'SPEED',
      title: 'Speed & Brake',
      params: [
        { key: 'vmax', min: 20.0, max: 180.0, step: 1.0, desc: 'Top speed limit on normal road (m/s).' },
        { key: 'brakeDec', min: 10.0, max: 80.0, step: 1.0, desc: 'Brake force deceleration.' },
        { key: 'dragK', min: 0.0001, max: 0.002, step: 0.00005, desc: 'Aero drag coefficient. Higher = drops top-end acceleration.' },
        { key: 'rollDrag', min: 0.0, max: 2.0, step: 0.05, desc: 'Rolling friction coefficient. Higher = rolls to stop faster.' },
        // Walls — impulse-based contact (2026-07-07).
        { key: 'wallMu', min: 0.0, max: 1.0, step: 0.05, desc: 'Wall scrape friction per impact strength. Grazes nearly free; square hits cost real speed.' },
        { key: 'wallBounce', min: 0.0, max: 0.5, step: 0.02, desc: 'Wall restitution. Higher = bouncier walls.' },
        { key: 'wallYawKick', min: 0.0, max: 0.1, step: 0.005, desc: 'Nose-away deflection on a FRONT wall hit. Higher = the wall sheds the car instead of magnet-holding it.' }
      ]
    }
  ];

  const style = document.createElement('style');
  style.textContent = `
    .dev-tune-btn {
      position: relative;
    }
    #physTuningPanel {
      position: fixed;
      top: 0;
      right: -420px;
      width: 400px;
      height: 100vh;
      z-index: 9999;
      display: flex;
      flex-direction: column;
      box-shadow: -5px 0 25px rgba(0,0,0,0.5);
      transition: right 0.3s cubic-bezier(0.2, 0.8, 0.2, 1);
      font-family: 'Outfit', sans-serif;
      color: #e8e4f5;
    }
    #physTuningPanel.open {
      right: 0;
    }
    .phys-header {
      padding: 16px;
      background: rgba(15,10,32,0.85);
      border-bottom: 1px solid rgba(157, 123, 255, 0.3);
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .phys-header h3 {
      margin: 0;
      font-family: 'Chakra Petch', sans-serif;
      letter-spacing: 0.1em;
      color: var(--accent);
      text-transform: uppercase;
      font-size: 16px;
    }
    .phys-close {
      background: none;
      border: none;
      color: #e8e4f5;
      font-size: 20px;
      cursor: pointer;
      opacity: 0.7;
    }
    .phys-close:hover { opacity: 1; }
    .phys-tabs {
      display: flex;
      background: rgba(15,10,32,0.9);
      border-bottom: 1px solid rgba(157, 123, 255, 0.15);
    }
    .phys-tab-btn {
      flex: 1;
      padding: 10px 0;
      background: none;
      border: none;
      border-bottom: 2px solid transparent;
      color: #e8e4f5;
      font-family: 'Chakra Petch', sans-serif;
      font-weight: 600;
      font-size: 12px;
      cursor: pointer;
      opacity: 0.6;
      transition: all 0.2s;
    }
    .phys-tab-btn.active {
      opacity: 1;
      border-bottom-color: var(--accent2);
      background: rgba(157, 123, 255, 0.1);
    }
    .phys-scroll {
      flex: 1;
      overflow-y: auto;
      padding: 16px;
      background: rgba(10, 7, 22, 0.9);
    }
    .phys-group {
      display: none;
      flex-direction: column;
      gap: 16px;
    }
    .phys-group.active {
      display: flex;
    }
    .phys-control {
      display: flex;
      flex-direction: column;
      gap: 4px;
      border-bottom: 1px solid rgba(255,255,255,0.05);
      padding-bottom: 12px;
    }
    .phys-row-meta {
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 13px;
      font-weight: 600;
    }
    .phys-key {
      font-family: 'Azeret Mono', monospace;
      color: var(--warm);
    }
    .phys-val {
      font-family: 'Azeret Mono', monospace;
      background: rgba(255,255,255,0.1);
      padding: 2px 6px;
      border-radius: 4px;
      font-size: 11px;
    }
    .phys-slider-container {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .phys-slider {
      flex: 1;
      accent-color: var(--accent2);
      cursor: pointer;
      height: 6px;
    }
    .phys-desc {
      font-size: 11px;
      opacity: 0.6;
      line-height: 1.4;
      margin-top: 2px;
    }
    .phys-footer {
      padding: 16px;
      background: rgba(15,10,32,0.85);
      border-top: 1px solid rgba(157, 123, 255, 0.3);
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .phys-btn {
      width: 100%;
      padding: 10px;
      font-family: 'Chakra Petch', sans-serif;
      font-weight: 600;
      text-transform: uppercase;
      font-size: 12px;
      border: 1px solid rgba(157, 123, 255, 0.4);
      background: rgba(10, 7, 22, 0.6);
      color: #e8e4f5;
      cursor: pointer;
      transition: all 0.2s;
      clip-path: polygon(0 6px, 6px 0, 100% 0, 100% calc(100% - 6px), calc(100% - 6px) 100%, 0 100%);
    }
    .phys-btn:hover {
      background: rgba(157, 123, 255, 0.15);
      border-color: var(--accent);
    }
    .phys-btn.primary {
      border-color: rgba(255, 179, 123, 0.5);
      background: rgba(255, 179, 123, 0.1);
    }
    .phys-btn.primary:hover {
      background: rgba(255, 179, 123, 0.25);
      border-color: var(--warm);
    }
    #physExportModal {
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.8);
      z-index: 100000;
      display: none;
      align-items: center;
      justify-content: center;
    }
    .phys-modal-box {
      width: min(90vw, 550px);
      background: var(--bg-primary);
      border: 1px solid var(--accent);
      padding: 24px;
      display: flex;
      flex-direction: column;
      gap: 16px;
      box-shadow: 0 0 30px rgba(157, 123, 255, 0.3);
      clip-path: polygon(0 12px, 12px 0, 100% 0, 100% calc(100% - 12px), calc(100% - 12px) 100%, 0 100%);
    }
    .phys-modal-box h4 {
      margin: 0;
      font-family: 'Chakra Petch', sans-serif;
      letter-spacing: 0.1em;
      color: var(--accent);
    }
    .phys-modal-box textarea {
      width: 100%;
      height: 250px;
      background: rgba(0,0,0,0.5);
      color: #e8e4f5;
      font-family: 'Azeret Mono', monospace;
      font-size: 11px;
      padding: 10px;
      border: 1px solid rgba(255,255,255,0.1);
      outline: none;
      resize: none;
    }
  `;
  document.head.appendChild(style);

  const panel = document.createElement('div');
  panel.id = 'physTuningPanel';
  panel.className = 'glass';

  let tabsHtml = '';
  let contentHtml = '';

  SCHEMA.forEach((group, idx) => {
    const isActive = idx === 0;
    tabsHtml += `<button class="phys-tab-btn ${isActive ? 'active' : ''}" data-tab="${group.tab}">${group.tab}</button>`;
    
    let groupControls = '';
    group.params.forEach(p => {
      const curVal = DD.PHYS[p.key];
      // Guard: never render a slider for a key that isn't a live PHYS number (a renamed/removed
      // constant would otherwise show a blank, dead control — exactly what the old DRIFT tab did).
      if (typeof curVal !== 'number') { console.warn('[physdev] skipping unknown PHYS key:', p.key); return; }
      groupControls += `
        <div class="phys-control">
          <div class="phys-row-meta">
            <span class="phys-key">${p.key}</span>
            <span class="phys-val" id="val_${p.key}">${curVal}</span>
          </div>
          <div class="phys-slider-container">
            <input type="range" class="phys-slider" data-key="${p.key}" min="${p.min}" max="${p.max}" step="${p.step}" value="${curVal}">
          </div>
          <div class="phys-desc">${p.desc}</div>
        </div>
      `;
    });

    contentHtml += `
      <div class="phys-group ${isActive ? 'active' : ''}" id="tab-group-${group.tab}">
        ${groupControls}
      </div>
    `;
  });

  panel.innerHTML = `
    <div class="phys-header">
      <h3>Physics Tuning</h3>
      <button class="phys-close">&times;</button>
    </div>
    <div class="phys-tabs">
      ${tabsHtml}
    </div>
    <div class="phys-scroll">
      ${contentHtml}
    </div>
    <div class="phys-footer">
      <button class="phys-btn primary" id="physBtnSave">Save as Baseline</button>
      <button class="phys-btn" id="physBtnExport">Export Code</button>
      <button class="phys-btn" id="physBtnReset">Reset All to Default</button>
    </div>
  `;
  document.body.appendChild(panel);

  const modal = document.createElement('div');
  modal.id = 'physExportModal';
  modal.innerHTML = `
    <div class="phys-modal-box">
      <h4>Export Baseline Settings</h4>
      <p style="font-size:12px;opacity:0.8;">Copy and paste this config block directly inside the <strong>DD.PHYS</strong> constant definition in <strong>js/physics.js</strong>:</p>
      <textarea readonly id="physExportText"></textarea>
      <button class="phys-btn" id="physBtnCloseModal">Close</button>
    </div>
  `;
  document.body.appendChild(modal);

  function tryAddWrench() {
    const parent = document.getElementById('gameButtons');
    if (!parent) return false;
    if (document.getElementById('btnTunePhys')) return true;

    const btn = document.createElement('button');
    btn.className = 'gbtn';
    btn.id = 'btnTunePhys';
    btn.title = 'Tune Physics (P)';
    btn.innerHTML = `<svg viewBox="0 0 24 24"><path fill="currentColor" d="M19.43 12.98c.04-.32.07-.64.07-.98s-.03-.66-.07-.98l2.11-1.65c.19-.15.24-.42.12-.64l-2-3.46c-.12-.22-.39-.3-.61-.22l-2.49 1c-.52-.4-1.08-.73-1.69-.98l-.38-2.65C14.46 2.18 14.25 2 14 2h-4c-.25 0-.46.18-.49.42l-.38 2.65c-.61.25-1.17.59-1.69.98l-2.49-1c-.23-.09-.49 0-.61.22l-2 3.46c-.13.22-.07.49.12.64l2.11 1.65c-.04.32-.07.65-.07.98s.03.66.07.98l-2.11 1.65c-.19.15-.24.42-.12.64l2 3.46c.12.22.39.3.61.22l2.49-1c.52.4 1.08.73 1.69.98l.38 2.65c.03.24.24.42.49.42h4c.25 0 .46-.18.49-.42l.38-2.65c.61-.25 1.17-.59 1.69-.98l2.49 1c.23.09.49 0 .61-.22l2-3.46c.12-.22.07-.49-.12-.64l-2.11-1.65zM12 15.5c-1.93 0-3.5-1.57-3.5-3.5s1.57-3.5 3.5-3.5 3.5 1.57 3.5 3.5-1.57 3.5-3.5 3.5z"/></svg>`;
    btn.onclick = (e) => {
      e.stopPropagation();
      togglePanel();
    };
    
    parent.insertBefore(btn, parent.firstChild);
    return true;
  }

  setInterval(tryAddWrench, 1000);
  tryAddWrench();

  panel.querySelectorAll('.phys-tab-btn').forEach(btn => {
    btn.onclick = () => {
      panel.querySelectorAll('.phys-tab-btn').forEach(b => b.classList.remove('active'));
      panel.querySelectorAll('.phys-group').forEach(g => g.classList.remove('active'));
      
      btn.classList.add('active');
      const target = btn.getAttribute('data-tab');
      panel.querySelector(`#tab-group-${target}`).classList.add('active');
    };
  });

  function togglePanel() {
    panel.classList.toggle('open');
    if (typeof DD.sfxClick === 'function') DD.sfxClick();
  }
  
  panel.querySelector('.phys-close').onclick = togglePanel;
  
  window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyP') {
      if (document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA') {
        e.preventDefault();
        togglePanel();
      }
    }
  });

  panel.querySelectorAll('.phys-slider').forEach(slider => {
    const key = slider.getAttribute('data-key');
    const display = panel.querySelector(`#val_${key}`);
    
    slider.oninput = (e) => {
      const val = parseFloat(e.target.value);
      display.textContent = val;
      DD.PHYS[key] = val;

      if (window.G && window.G.track) {
        window.G.track.expert = null;
      }
    };
  });

  document.getElementById('physBtnSave').onclick = () => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(DD.PHYS));
      alert('Tuned values saved to local storage! They will load automatically as your new baseline.');
      if (typeof DD.sfxClick === 'function') DD.sfxClick();
    } catch(e) {}
  };

  document.getElementById('physBtnReset').onclick = () => {
    if (confirm('Revert all values back to default physics.js values?')) {
      localStorage.removeItem(STORAGE_KEY);
      for (const k in ORIG) {
        DD.PHYS[k] = ORIG[k];
        const slider = panel.querySelector(`[data-key="${k}"]`);
        if (slider) {
          slider.value = ORIG[k];
          panel.querySelector(`#val_${k}`).textContent = ORIG[k];
        }
      }
      if (window.G && window.G.track) {
        window.G.track.expert = null;
      }
      alert('All values reset to defaults.');
      if (typeof DD.sfxClick === 'function') DD.sfxClick();
    }
  };

  document.getElementById('physBtnExport').onclick = () => {
    const text = document.getElementById('physExportText');
    
    let code = '  const P = DD.PHYS = {\n';
    const keys = Object.keys(DD.PHYS);
    keys.forEach((k, idx) => {
      let val = DD.PHYS[k];
      if (Array.isArray(val)) {
        val = JSON.stringify(val);
      } else if (typeof val === 'object' && val !== null) {
        val = JSON.stringify(val);
      }
      code += `    ${k}: ${val}${idx < keys.length - 1 ? ',' : ''}\n`;
    });
    code += '  };';

    text.value = code;
    modal.style.display = 'flex';
    if (typeof DD.sfxClick === 'function') DD.sfxClick();
  };

  document.getElementById('physBtnCloseModal').onclick = () => {
    modal.style.display = 'none';
    if (typeof DD.sfxClick === 'function') DD.sfxClick();
  };

})();
