/* Model-aware inspector bindings (§10–§13, §20, §26).
 *
 * The original controls wrote straight to element.style. That is why a hover or
 * a mobile override could not exist: every edit landed in one flat inline
 * string. These bindings write through StudioModel instead, into whichever
 * state and breakpoint the shell is currently editing, and each control shows
 * whether its value is the object's own or inherited from base/desktop.
 *
 * Taking over an input means replacing the element, because the old listeners
 * were attached with addEventListener and cannot be detached by reference.
 * Cloning drops them, then we bind ours to the clone.
 *
 * Exposed as window.StudioInspector.
 */
(() => {
  'use strict';

  const $ = (s, p = document) => p.querySelector(s);
  const $$ = (s, p = document) => [...p.querySelectorAll(s)];

  // input id -> { prop, parse, kind }
  // `pair` means there is a matching #<id>Range slider to keep in sync.
  const BINDINGS = [
    { id: 'fs',    prop: 'fontSize',      parse: Number, pair: true },
    { id: 'fw',    prop: 'fontWeight',    parse: v => v, event: 'change' },
    { id: 'track', prop: 'letterSpacing', parse: Number, pair: true },
    { id: 'lh',    prop: 'lineHeight',    parse: Number, pair: true },
    { id: 'ta',    prop: 'textAlign',     parse: v => v, event: 'change' },
    { id: 'tc',    prop: 'color',         parse: v => v },
    { id: 'op',    prop: 'opacity',       parse: v => Number(v) / 100, pair: true, display: v => Math.round(v * 100) },
    { id: 'r',     prop: 'tileRadius',    parse: Number, pair: true },
    { id: 'x',     prop: 'offsetX',       parse: Number, pair: true },
    { id: 'y',     prop: 'offsetY',       parse: Number, pair: true },
    { id: 'w',     prop: 'span',          parse: Number, pair: true },
    { id: 'h',     prop: 'tileHeight',    parse: Number, pair: true },
    { id: 'zoom',  prop: 'imageZoom',     parse: Number, pair: true },
    { id: 'ix',    prop: 'imageX',        parse: Number, pair: true },
    { id: 'iy',    prop: 'imageY',        parse: Number, pair: true },
    { id: 'advBorderWidth', prop: 'borderWidth', parse: Number },
    { id: 'advBorderColor', prop: 'borderColor', parse: v => v },
    { id: 'advBorderStyle', prop: 'borderStyle', parse: v => v, event: 'change' },
    { id: 'advBrightness',  prop: 'brightness',  parse: Number },
    { id: 'advContrast',    prop: 'contrast',    parse: Number },
    { id: 'advSaturate',    prop: 'saturate',    parse: Number },
    { id: 'advBlur',        prop: 'blur',        parse: Number },
    { id: 'hoverScale',     prop: 'hoverScale',  parse: Number },
    { id: 'hoverLift',      prop: 'hoverLift',   parse: Number },
  ];

  const ed = {
    model: () => (typeof state === 'function' ? state() : null),
    selected: () => (typeof selected !== 'undefined' ? selected : null),
    push: () => { if (typeof push === 'function') push(); },
    status: m => { if (typeof status === 'function') status(m); },
  };

  const target = () => (window.StudioShell ? window.StudioShell.writeTarget() : { state: 'base', breakpoint: null });

  let coalesce = null;

  function currentModel() {
    // Always the live model, never a cached copy. Caching one per edit burst
    // looked like a sensible optimisation and silently lost edits: anything
    // else that calls state() — a resize commit, push(), the shell — replaces
    // the editor's MODEL, leaving this module writing to an orphaned object
    // whose values never reach the next read. fromDOM carries typed props
    // forward from the previous model, so a fresh read loses nothing.
    return ed.model();
  }

  function flush() {
    // Debounced so dragging a slider is one history entry, not one per pixel
    // (§27), matching the editor's own 180ms coalescing.
    clearTimeout(coalesce);
    coalesce = setTimeout(() => ed.push(), 200);
  }

  function write(prop, value) {
    const el = ed.selected();
    if (!el) return ed.status('Select an object first.');
    if (el.dataset.locked === '1') return ed.status(`"${el.dataset.node || el.dataset.id}" is locked. Unlock it in Layers to edit it.`);
    const m = currentModel();
    const n = m && m.nodes && m.nodes[el.dataset.id];
    if (!n) return ed.status('That object is not in the model yet.');

    const t = target();
    window.StudioModel.setProp(m, el.dataset.id, prop, value, t.state, t.breakpoint);
    window.StudioModel.writeCSS(window.StudioModel.emitCSS(m));
    markOrigins(m, el.dataset.id);
    flush();
  }

  /* Shows whether each control's value belongs to this state/breakpoint or is
   * inherited, so an override is never invisible (§26).
   */
  function markOrigins(m, id) {
    const t = target();
    for (const b of BINDINGS) {
      const input = $('#' + b.id);
      if (!input) continue;
      const field = input.closest('.ctrl') || input.parentElement;
      if (!field) continue;
      const origin = window.StudioModel.propOrigin(m, id, b.prop, t.state, t.breakpoint);
      field.classList.toggle('is-override', origin === 'override');
      field.classList.toggle('is-inherited', origin === 'base' && (t.state !== 'base' || t.breakpoint));
      const label = field.querySelector('label');
      if (label) {
        label.dataset.origin = origin === 'override' ? 'override' : (origin === 'base' ? 'inherited' : '');
        label.title = origin === 'override'
          ? `Overridden for ${t.breakpoint || t.state}. Clear it to fall back.`
          : origin === 'base'
            ? 'Inherited from the base/desktop value.'
            : 'Not set.';
      }
    }
  }

  // Reflects the model into the controls for the current state/breakpoint.
  function syncFromModel() {
    const el = ed.selected();
    if (!el) return;
    const m = currentModel();
    if (!m || !m.nodes || !m.nodes[el.dataset.id]) return;
    const t = target();
    for (const b of BINDINGS) {
      const input = $('#' + b.id);
      if (!input) continue;
      let v = window.StudioModel.getProp(m, el.dataset.id, b.prop, t.state, t.breakpoint);
      if (v === undefined) continue;
      if (b.display) v = b.display(v);
      input.value = v;
      const range = $('#' + b.id + 'Range');
      if (range) range.value = v;
    }
    markOrigins(m, el.dataset.id);
  }

  // Replacing the node drops the old inline-style listeners; returns the clone.
  function takeOver(input) {
    const clone = input.cloneNode(true);
    input.replaceWith(clone);
    return clone;
  }

  function bind() {
    for (const b of BINDINGS) {
      const main = $('#' + b.id);
      if (!main || main.dataset.modelBound === '1') continue;
      const el = takeOver(main);
      el.dataset.modelBound = '1';
      const ev = b.event || 'input';
      el.addEventListener(ev, () => {
        const parsed = b.parse(el.value);
        write(b.prop, parsed);
        const range = $('#' + b.id + 'Range');
        if (range && range !== el) range.value = el.value;
      });

      if (b.pair) {
        const r = $('#' + b.id + 'Range');
        if (r && r.dataset.modelBound !== '1') {
          const rc = takeOver(r);
          rc.dataset.modelBound = '1';
          rc.addEventListener('input', () => {
            const numeric = $('#' + b.id);
            if (numeric) numeric.value = rc.value;
            write(b.prop, b.parse(rc.value));
          });
        }
      }
    }
    addBorderToggle();
    addClearOverride();
  }

  /* §7/§13: border on/off is its own decision. When off, the width/style/colour
   * controls are disabled and say why rather than sitting there doing nothing.
   */
  function addBorderToggle() {
    const panel = $('#appearancePanel');
    if (!panel || $('#borderEnabled')) return;
    const wrap = document.createElement('label');
    wrap.className = 'check';
    wrap.innerHTML = '<input id="borderEnabled" type="checkbox" checked>Border enabled';
    panel.prepend(wrap);
    $('#borderEnabled').addEventListener('change', e => {
      write('borderEnabled', e.target.checked);
      reflectBorderEnabled(e.target.checked);
    });
  }

  function reflectBorderEnabled(on) {
    for (const id of ['advBorderWidth', 'advBorderColor', 'advBorderStyle']) {
      const input = $('#' + id);
      if (!input) continue;
      input.disabled = !on;
      const field = input.closest('.ctrl') || input.parentElement;
      if (field) {
        field.classList.toggle('is-disabled', !on);
        const label = field.querySelector('label');
        // A disabled control must explain its dependency (§29).
        if (label) label.title = on ? '' : 'Enable Border first.';
      }
    }
  }

  /* Lets an override be removed so the value falls back to base/desktop.
   * Without this an override would be a one-way door (§26).
   */
  function addClearOverride() {
    const panel = $('#statePanel');
    if (!panel || $('#clearOverrides')) return;
    const row = document.createElement('div');
    row.className = 'action-row';
    row.innerHTML = '<button type="button" id="clearOverrides">Clear overrides for this state/viewport</button>';
    panel.appendChild(row);
    $('#clearOverrides').addEventListener('click', () => {
      const el = ed.selected();
      if (!el) return ed.status('Select an object first.');
      const t = target();
      if (t.state === 'base' && !t.breakpoint) {
        return ed.status('Base desktop values are the originals — there is nothing to clear. Switch to Hover, Pressed, Tablet or Mobile first.');
      }
      const m = currentModel();
      const n = m.nodes[el.dataset.id];
      if (!n) return ed.status('That object is not in the model yet.');
      let removed = 0;
      if (t.breakpoint) {
        removed = Object.keys((n.responsive && n.responsive[t.breakpoint]) || {}).length;
        if (n.responsive) delete n.responsive[t.breakpoint];
      } else {
        removed = Object.keys((n.states && n.states[t.state]) || {}).length;
        if (n.states) n.states[t.state] = {};
      }
      window.StudioModel.writeCSS(window.StudioModel.emitCSS(m));
      syncFromModel();
      ed.push();
      ed.status(removed
        ? `Cleared ${removed} override(s) for ${t.breakpoint || t.state}. Values fall back to base.`
        : `No overrides were set for ${t.breakpoint || t.state}.`);
    });
  }

  function init() {
    if (!window.StudioModel) return;
    bind();
    syncFromModel();
    reflectBorderEnabled($('#borderEnabled') ? $('#borderEnabled').checked : true);
  }

  window.StudioInspector = { init, bind, syncFromModel, markOrigins, write, BINDINGS };
})();
