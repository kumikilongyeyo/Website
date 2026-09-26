/* Text fill: solid colour or gradient lettering, with an optional glow.
 *
 * Adds a "Text fill" panel under Typography for every text object. The value
 * is one typed prop, `textFill`, written through StudioModel like every other
 * inspector control, so it follows the current state (base/hover/pressed) and
 * breakpoint, survives publish, and undoes as one step.
 *
 *   textFill: { mode: 'gradient', angle: 90,
 *               stops: [{ color, at }, ...],          // 2 or 3 stops
 *               glow: { enabled, color, size } }
 *
 * The text stays ordinary editable text: the gradient is a clipped background,
 * so typing into the heading keeps the fill.
 *
 * Loaded with the other editor modules (EDITOR_MODULES), never for visitors;
 * the published look comes from the generated stylesheet alone.
 */
(() => {
  'use strict';

  const $ = (s, p = document) => p.querySelector(s);

  // Pulled from the casino portfolio's headings, so the first click looks right.
  const PRESETS = [
    { name: 'Blue → cyan',   stops: ['#2f6bff', '#39e6ff'] },
    { name: 'Purple → pink', stops: ['#9b4dff', '#ff5fd2'] },
    { name: 'Teal',          stops: ['#12c7a5', '#7ff0da'] },
    { name: 'Gold',          stops: ['#ffb300', '#fff1a8', '#e08a00'] },
    { name: 'Magenta glow',  stops: ['#ff4fd8', '#b44dff'] },
    { name: 'Ice',           stops: ['#b8c7ff', '#ffffff'] },
  ];
  const DEFAULT = { mode: 'gradient', angle: 90, stops: [{ color: '#2f6bff', at: 0 }, { color: '#39e6ff', at: 100 }], glow: { enabled: false, color: '#39e6ff', size: 14, strength: 55 } };

  const selectedEl = () => (typeof selected !== 'undefined' ? selected : null);
  const target = () => (window.StudioShell ? window.StudioShell.writeTarget() : { state: 'base', breakpoint: null });
  const say = m => { if (typeof status === 'function') status(m); };

  function rgba(hex, pct) {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
    if (!m) return hex;
    const n = parseInt(m[1], 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${Math.max(0, Math.min(100, pct)) / 100})`;
  }

  function panelHTML() {
    return `<div class="panel" data-for="text" id="textFillPanel"><h4>Text fill</h4>
      <div class="ctrl"><label for="tfMode">Fill</label><select id="tfMode"><option value="solid">Solid colour</option><option value="gradient">Gradient</option></select></div>
      <div class="tf-grad">
        <div class="tf-presets" role="group" aria-label="Gradient presets">${PRESETS.map((p, i) =>
          `<button type="button" class="tf-preset" data-tf-preset="${i}" title="${p.name}" aria-label="${p.name}" style="background:linear-gradient(90deg,${p.stops.join(',')})"></button>`).join('')}</div>
        <div class="ctrl"><label for="tfC1">Colour 1</label><input id="tfC1" type="color"></div>
        <div class="ctrl"><label for="tfC2">Colour 2</label><input id="tfC2" type="color"></div>
        <div class="ctrl"><label for="tfUse3">3rd colour</label><input id="tfUse3" type="checkbox"><input id="tfC3" type="color"></div>
        <div class="ctrl"><label for="tfAngle">Angle</label><div class="scrub"><input id="tfAngleRange" type="range" min="0" max="360" step="1"><input id="tfAngle" type="number" min="0" max="360"></div></div>
        <div class="ctrl"><label for="tfGlow">Glow</label><input id="tfGlow" type="checkbox"><input id="tfGlowColor" type="color"></div>
        <div class="ctrl"><label for="tfGlowSize">Glow size</label><div class="scrub"><input id="tfGlowSizeRange" type="range" min="2" max="48"><input id="tfGlowSize" type="number" min="0" max="80"></div></div>
        <div class="ctrl"><label for="tfGlowStrength">Glow strength</label><div class="scrub"><input id="tfGlowStrengthRange" type="range" min="5" max="100"><input id="tfGlowStrength" type="number" min="0" max="100"></div></div>
        <div class="ctrl"><label for="tfShadow">Dark shadow</label><input id="tfShadow" type="checkbox"></div>
        <div class="ctrl"><label for="tfShadowStrength">Shadow strength</label><div class="scrub"><input id="tfShadowStrengthRange" type="range" min="5" max="100"><input id="tfShadowStrength" type="number" min="0" max="100"></div></div>
        <p class="editor-note">The text stays editable: click into it and type. Solid colour uses the Typography colour above.</p>
      </div></div>`;
  }

  function mount() {
    if (!document.getElementById('textFillStyle')) {
      const st = document.createElement('style');
      st.id = 'textFillStyle';
      st.textContent = '.tf-presets{display:grid;grid-template-columns:repeat(6,1fr);gap:6px;margin:4px 0 10px}.tf-preset{height:22px;border-radius:5px;border:1px solid rgba(255,255,255,.18);cursor:pointer}.tf-preset:hover{outline:2px solid rgba(255,255,255,.5);outline-offset:1px}.tf-preset:focus-visible{outline:2px solid #fff;outline-offset:1px}';
      document.head.appendChild(st);
    }
    if ($('#textFillPanel')) return;
    const typo = [...document.querySelectorAll('.inspector .panel[data-for="text"]')].find(p => /Typography/i.test(p.querySelector('h4')?.textContent || ''));
    const host = typo || $('.inspector .tab-panel[data-tab="design"]');
    if (!host) return;
    const box = document.createElement('div');
    box.innerHTML = panelHTML();
    const panel = box.firstElementChild;
    if (typo) typo.after(panel); else host.appendChild(panel);
    const sel = selectedEl();
    panel.hidden = !(sel && sel.dataset.type === 'text');
    bind(panel);
  }

  function current() {
    const el = selectedEl();
    if (!el || typeof state !== 'function') return null;
    const m = state();
    const t = target();
    const v = window.StudioModel.getProp(m, el.dataset.id, 'textFill', t.state, t.breakpoint);
    return v && v.mode === 'gradient' ? JSON.parse(JSON.stringify(v)) : null;
  }

  let coalesce = null;
  function write(fill) {
    const el = selectedEl();
    if (!el) return say('Select a text object first.');
    if (el.dataset.locked === '1') return say(`"${el.dataset.node || el.dataset.id}" is locked. Unlock it in Layers to edit it.`);
    const m = state();
    if (!m.nodes[el.dataset.id]) return say('That object is not in the model yet.');
    const t = target();
    if (fill && fill.mode === 'gradient' && !fill.align) {
      const a = getComputedStyle(el).textAlign;
      fill.align = a === 'center' ? 'center' : (a === 'right' || a === 'end') ? 'right' : 'left';
    }
    window.StudioModel.setProp(m, el.dataset.id, 'textFill', fill || undefined, t.state, t.breakpoint);
    window.StudioModel.writeCSS(window.StudioModel.emitCSS(m));
    clearTimeout(coalesce);
    coalesce = setTimeout(() => { if (typeof push === 'function') push(); }, 200);
  }

  function readUI() {
    const stops = [$('#tfC1').value, $('#tfC2').value];
    if ($('#tfUse3').checked) stops.push($('#tfC3').value);
    const at = stops.length === 3 ? [0, 50, 100] : [0, 100];
    return {
      mode: 'gradient',
      angle: Number($('#tfAngle').value) || 0,
      stops: stops.map((color, i) => ({ color, at: at[i] })),
      glow: {
        enabled: $('#tfGlow').checked,
        color: rgba($('#tfGlowColor').value, Number($('#tfGlowStrength').value)),
        hex: $('#tfGlowColor').value,
        size: Number($('#tfGlowSize').value) || 0,
        strength: Number($('#tfGlowStrength').value) || 0,
      },
      shadow: { enabled: $('#tfShadow').checked, strength: Number($('#tfShadowStrength').value) || 0, size: 10, y: 4 },
    };
  }

  function sync() {
    const panel = $('#textFillPanel');
    if (!panel) return;
    const f = current();
    const v = f || DEFAULT;
    $('#tfMode').value = f ? 'gradient' : 'solid';
    panel.querySelector('.tf-grad').hidden = !f;
    const s = v.stops || DEFAULT.stops;
    $('#tfC1').value = (s[0] && s[0].color) || '#2f6bff';
    $('#tfC2').value = (s[1] && s[1].color) || '#39e6ff';
    $('#tfUse3').checked = s.length > 2;
    $('#tfC3').value = (s[2] && s[2].color) || '#ffffff';
    $('#tfC3').disabled = s.length < 3;
    $('#tfAngle').value = $('#tfAngleRange').value = v.angle ?? 90;
    const g = v.glow || DEFAULT.glow;
    $('#tfGlow').checked = !!g.enabled;
    $('#tfGlowColor').value = g.hex || (/^#[0-9a-f]{6}$/i.test(g.color || '') ? g.color : '#39e6ff');
    $('#tfGlowSize').value = $('#tfGlowSizeRange').value = g.size ?? 14;
    $('#tfGlowStrength').value = $('#tfGlowStrengthRange').value = g.strength ?? 55;
    const sh = v.shadow || {};
    $('#tfShadow').checked = !!sh.enabled;
    $('#tfShadowStrength').value = $('#tfShadowStrengthRange').value = sh.strength ?? 60;
  }

  function bind(panel) {
    $('#tfMode').addEventListener('change', e => {
      if (e.target.value === 'gradient') { write(current() || JSON.parse(JSON.stringify(DEFAULT))); say('Gradient fill on. Pick colours or a preset.'); }
      // Stored as an explicit 'solid' rather than removed, so a page's starting
      // gradient (STUDIO_PAGE.seedProps) cannot come back on the next load.
      else { write({ mode: 'solid' }); say('Back to a solid colour.'); }
      sync();
    });
    panel.querySelectorAll('[data-tf-preset]').forEach(b => b.addEventListener('click', () => {
      const p = PRESETS[Number(b.dataset.tfPreset)];
      const base = current() || JSON.parse(JSON.stringify(DEFAULT));
      const at = p.stops.length === 3 ? [0, 50, 100] : [0, 100];
      base.stops = p.stops.map((color, i) => ({ color, at: at[i] }));
      write(base); sync(); say(`Applied the ${p.name} gradient.`);
    }));
    // Range + number pairs mirror each other, like the rest of the inspector.
    for (const id of ['tfAngle', 'tfGlowSize', 'tfGlowStrength', 'tfShadowStrength']) {
      const num = $('#' + id), range = $('#' + id + 'Range');
      range.addEventListener('input', () => { num.value = range.value; write(readUI()); });
      num.addEventListener('input', () => { range.value = num.value; write(readUI()); });
    }
    for (const id of ['tfC1', 'tfC2', 'tfC3', 'tfGlowColor']) $('#' + id).addEventListener('input', () => write(readUI()));
    $('#tfUse3').addEventListener('change', () => { $('#tfC3').disabled = !$('#tfUse3').checked; write(readUI()); });
    $('#tfGlow').addEventListener('change', () => write(readUI()));
    $('#tfShadow').addEventListener('change', () => write(readUI()));
  }

  // Follow the selection. select() is a global in studio-editor.js; wrapping the
  // window property is how studio-links.js hooks it too.
  if (typeof window.select === 'function' && !window.select.__textFill) {
    const inner = window.select;
    const wrapped = function (...a) { const r = inner.apply(this, a); try { sync(); } catch { /* panel not mounted */ } return r; };
    wrapped.__textFill = true;
    window.select = wrapped;
  }
  // The shell switches state/breakpoint without reselecting; resync on its tabs.
  document.addEventListener('click', e => { if (e.target.closest('[data-edit-state],[data-viewport],[data-view]')) setTimeout(sync, 0); });

  mount();
  sync();
  window.StudioTextFill = { mount, sync, PRESETS };
})();
