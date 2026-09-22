/* Makes the footer/nav links and the divider rules into real editable objects,
 * and adds canvas dragging (§8, §10, §12, §13).
 *
 * Three things were not editable at all:
 *
 * - The EMAIL / ARTSTATION / LINKEDIN / RESUME buttons carried only a
 *   data-link-key. applyLinks() looked for [data-link-title] and [data-link-url]
 *   inputs to sync against, and those inputs were never built, so there was no
 *   way to set the URLs the footer exists for.
 * - The divider rules were bare 1px divs with no handle on thickness, width,
 *   colour or angle.
 * - Text could only be repositioned by typing numbers into the inspector.
 *
 * Dragging lives behind a Move mode rather than being always-on, because text
 * objects are contenteditable while editing and a plain press-and-drag on them
 * belongs to the text cursor, not the object.
 *
 * Exposed as window.StudioObjects.
 */
(() => {
  'use strict';

  const $ = (s, p = document) => p.querySelector(s);
  const $$ = (s, p = document) => [...p.querySelectorAll(s)];

  const ed = {
    model: () => (typeof state === 'function' ? state() : null),
    selected: () => (typeof selected !== 'undefined' ? selected : null),
    select: el => { if (typeof select === 'function') select(el); },
    push: () => { if (typeof push === 'function') push(); },
    status: m => { if (typeof status === 'function') status(m); },
    layers: () => { if (typeof layers === 'function') layers(); },
    editing: () => document.body.classList.contains('editing'),
  };

  const LINK_KEYS = ['email', 'artstation', 'linkedin', 'resume'];

  /* --------------------------------------------------- promote to objects
   * Gives the links and rules a stable id, a type and a display name so the
   * model, the layer tree and the inspector all treat them like anything else.
   */
  function promote() {
    let n = 0;
    for (const el of $$('[data-link-key]')) {
      if (el.dataset.id) continue;
      const key = el.dataset.linkKey;
      // Several buttons can share a key (nav + footer Resume). The suffix keeps
      // ids unique while the key still ties them to one destination.
      const same = $$(`[data-link-key="${key}"]`);
      const idx = same.indexOf(el);
      el.dataset.id = 'link-' + key + (idx > 0 ? '-' + (idx + 1) : '');
      el.dataset.type = 'link';
      el.dataset.node = key.charAt(0).toUpperCase() + key.slice(1) + ' link' + (idx > 0 ? ' (nav)' : '');
      el.setAttribute('data-node', el.dataset.node);
      n++;
    }
    $$('.rule').forEach((el, i) => {
      if (el.dataset.id) return;
      el.dataset.id = 'rule-' + (i + 1);
      el.dataset.type = 'divider';
      el.dataset.node = 'Divider ' + (i + 1);
      el.setAttribute('data-node', el.dataset.node);
      n++;
    });
    return n;
  }

  // The editor's LINKS global is the live source the footer buttons render from.
  function linksState() {
    return (typeof LINKS !== 'undefined' && LINKS) ? LINKS : {};
  }

  /* --------------------------------------------- enhance existing links
   * index.html already ships an "External redirects" panel with a Title and
   * URL field per destination, and applyLinks() syncs those. Adding a second
   * panel duplicated it and broke the sync, because applyLinks() writes to the
   * FIRST matching input in the document. So this enhances what is there
   * instead: live validation of the address, a same-tab/new-tab choice, and a
   * button to select the real thing on the page and style it.
   */
  function enhanceLinkFields() {
    for (const key of LINK_KEYS) {
      const url = $(`[data-link-url="${key}"]`);
      if (!url || url.dataset.enhanced === '1') continue;
      url.dataset.enhanced = '1';
      const row = url.closest('.redirect-edit') || url.parentElement;

      const extras = document.createElement('div');
      extras.className = 'link-extras';
      extras.innerHTML = `
        <label class="check"><input type="checkbox" data-link-newtab="${key}" checked>Open in a new tab</label>
        <div class="link-extra-row">
          <button type="button" data-link-select="${key}">Select button on page</button>
        </div>
        <p class="editor-note link-note"></p>`;
      row.appendChild(extras);

      const note = extras.querySelector('.link-note');
      const tab = extras.querySelector(`[data-link-newtab="${key}"]`);

      const validate = () => {
        const v = (url.value || '').trim();
        if (!v) {
          note.textContent = 'No address yet — this button will not go anywhere.';
          note.classList.add('is-error');
          return;
        }
        if (!window.StudioLinks) { note.textContent = ''; return; }
        const info = window.StudioLinks.describe(v);
        note.textContent = info.ok
          ? (info.kind === 'anchor' ? `Jumps to ${info.url} on this page.` : `Opens ${info.url}`)
          : info.why;
        note.classList.toggle('is-error', !info.ok);
      };

      url.addEventListener('input', validate);
      tab.addEventListener('change', () => {
        const L = linksState();
        L[key] = L[key] || {};
        L[key].newTab = tab.checked;
        const m = ed.model();
        if (m) { m.links = m.links || {}; m.links[key] = { ...(m.links[key] || {}), ...L[key] }; }
        $$(`[data-link-key="${key}"]`).forEach(b => { b.dataset.linkNewTab = tab.checked ? '1' : '0'; });
        ed.push();
        ed.status(`${key}: ${tab.checked ? 'opens in a new tab' : 'opens in the same tab'}`);
      });
      extras.querySelector(`[data-link-select="${key}"]`).addEventListener('click', () => {
        const el = $(`[data-link-key="${key}"]`);
        if (!el) return ed.status(`No ${key} button exists on the page.`);
        ed.select(el);
        ed.status(`Selected the ${key} button — style it in the Design tab, or drag it in Move mode.`);
      });

      const L = linksState();
      if (L[key] && L[key].newTab === false) tab.checked = false;
      validate();
    }
  }

  /* ----------------------------------------------------- divider panel
   * Thickness, length, colour, angle and the accent sweep, so a rule can be
   * shaped rather than being a fixed hairline.
   */
  function buildDividerPanel() {
    const host = $('.tab-panel[data-tab="design"]');
    if (!host || $('#dividerPanel')) return;
    const p = document.createElement('div');
    p.className = 'panel';
    p.id = 'dividerPanel';
    p.dataset.for = 'divider';
    p.innerHTML = `
      <h4>Divider shape</h4>
      <div class="ctrl"><label>Thickness</label><input id="ruleThickness" type="range" min="1" max="24" step="1"></div>
      <div class="ctrl"><label>Length</label><input id="ruleWidth" type="range" min="10" max="100" step="1"></div>
      <div class="ctrl"><label>Align</label><select id="ruleAlign"><option value="flex-start">Left</option><option value="center">Centre</option><option value="flex-end">Right</option></select></div>
      <div class="ctrl"><label>Angle</label><input id="ruleAngle" type="range" min="-45" max="45" step="1"></div>
      <div class="ctrl"><label>Radius</label><input id="ruleRadius" type="range" min="0" max="12" step="1"></div>
      <div class="ctrl"><label>Colour</label><input id="ruleColor" type="color" value="#bdd657"></div>
      <div class="ctrl"><label>Opacity</label><input id="ruleOpacity" type="range" min="10" max="100" step="1"></div>
      <label class="check"><input id="ruleSweep" type="checkbox" checked>Animate an accent sweep on reveal</label>
      <p class="editor-note" id="ruleNote">Select a divider to shape it.</p>`;
    host.appendChild(p);

    const IDS = ['ruleThickness', 'ruleWidth', 'ruleAlign', 'ruleAngle', 'ruleRadius', 'ruleColor', 'ruleOpacity', 'ruleSweep'];
    const commit = () => {
      const el = ed.selected();
      if (!el || el.dataset.type !== 'divider') { $('#ruleNote').textContent = 'Select a divider first.'; return; }
      const m = ed.model();
      const t = window.StudioShell ? window.StudioShell.writeTarget() : { state: 'base', breakpoint: null };
      const set = (prop, val) => window.StudioModel.setProp(m, el.dataset.id, prop, val, t.state, t.breakpoint);
      set('height', $('#ruleThickness').value + 'px');
      set('width', $('#ruleWidth').value + '%');
      set('justifySelf', $('#ruleAlign').value);
      set('rotate', Number($('#ruleAngle').value));
      set('borderRadius', Number($('#ruleRadius').value));
      set('background', { mode: 'solid', color: $('#ruleColor').value });
      set('opacity', Number($('#ruleOpacity').value) / 100);
      el.classList.toggle('no-sweep', !$('#ruleSweep').checked);
      const n = m.nodes && m.nodes[el.dataset.id];
      if (n) { n.effects = n.effects || {}; n.effects.sweep = $('#ruleSweep').checked; }
      window.StudioModel.writeCSS(window.StudioModel.emitCSS(m));
      ed.push();
      $('#ruleNote').textContent = `${el.dataset.node}: ${$('#ruleThickness').value}px, ${$('#ruleWidth').value}% wide, ${$('#ruleAngle').value}°`;
    };
    IDS.forEach(id => {
      const e = $('#' + id);
      if (!e) return;
      e.addEventListener(e.tagName === 'SELECT' || e.type === 'checkbox' ? 'change' : 'input', commit);
    });

    window.StudioObjects.syncDivider = () => {
      const el = ed.selected();
      if (!el || el.dataset.type !== 'divider') return;
      const m = ed.model();
      const t = window.StudioShell ? window.StudioShell.writeTarget() : { state: 'base', breakpoint: null };
      const g = p2 => window.StudioModel.getProp(m, el.dataset.id, p2, t.state, t.breakpoint);
      $('#ruleThickness').value = parseFloat(g('height')) || 1;
      $('#ruleWidth').value = parseFloat(g('width')) || 100;
      $('#ruleAlign').value = g('justifySelf') || 'flex-start';
      $('#ruleAngle').value = g('rotate') || 0;
      $('#ruleRadius').value = g('borderRadius') || 0;
      const bg = g('background');
      if (bg && /^#/.test(bg.color || '')) $('#ruleColor').value = bg.color;
      $('#ruleOpacity').value = Math.round((g('opacity') !== undefined ? g('opacity') : 1) * 100);
      $('#ruleSweep').checked = !el.classList.contains('no-sweep');
      $('#ruleNote').textContent = `Shaping ${el.dataset.node}.`;
    };
  }

  /* ------------------------------------------------------------ move mode
   * Dragging is modal. With Move on, text is not editable and a press-and-drag
   * moves the object; with it off, clicking text puts the caret in it as
   * before. Alt+drag works in either mode for a quick nudge.
   */
  // spacer/container/section were movable in the model but had no transform
  // rule, so they stored a position and never visibly moved.
  const MOVABLE = ['text', 'button', 'shape', 'divider', 'link', 'logo', 'spacer', 'container', 'section'];
  let moveMode = false;

  function setMoveMode(on) {
    moveMode = !!on;
    document.body.classList.toggle('move-mode', moveMode);
    // Text must stop being editable, or the drag fights the text cursor.
    $$('[data-type="text"]').forEach(e => { e.contentEditable = (moveMode || !ed.editing()) ? 'false' : 'true'; });
    const btn = $('[data-move-mode]');
    if (btn) {
      btn.classList.toggle('active', moveMode);
      btn.setAttribute('aria-pressed', String(moveMode));
    }
    ed.status(moveMode ? 'Move mode — drag objects to reposition. Text editing is paused.' : 'Edit mode — click text to type.');
  }

  function bindDrag() {
    if (document.body.dataset.dragBound === '1') return;
    document.body.dataset.dragBound = '1';

    document.addEventListener('pointerdown', e => {
      if (!ed.editing()) return;
      if (window.StudioShell && window.StudioShell.shell.previewing) return;
      if (!moveMode && !e.altKey) return;
      // e.target is not always an Element. A pointer event dispatched on
      // document, or one landing on a text node, has no closest(), and calling
      // it threw a TypeError that killed this handler outright.
      const src = e.target;
      if (!src || typeof src.closest !== 'function') return;
      const el = src.closest('[data-node]');
      if (!el || !MOVABLE.includes(el.dataset.type)) return;
      if (el.dataset.locked === '1') { ed.status(`"${el.dataset.node}" is locked.`); return; }
      if (src.closest('.resize, button[data-link-select]')) return;

      e.preventDefault();
      ed.select(el);
      const m = ed.model();
      const t = window.StudioShell ? window.StudioShell.writeTarget() : { state: 'base', breakpoint: null };
      const startX = e.clientX, startY = e.clientY;
      const baseX = Number(window.StudioModel.getProp(m, el.dataset.id, 'offsetX', t.state, t.breakpoint)) || 0;
      const baseY = Number(window.StudioModel.getProp(m, el.dataset.id, 'offsetY', t.state, t.breakpoint)) || 0;
      const snap = window.StudioShell ? window.StudioShell.shell.view.snap : false;
      const step = 8;
      let x = baseX, y = baseY;

      const move = q => {
        x = baseX + (q.clientX - startX);
        y = baseY + (q.clientY - startY);
        if (snap) { x = Math.round(x / step) * step; y = Math.round(y / step) * step; }
        // Live feedback as ephemera; committed to the model on release.
        el.style.setProperty('--x', Math.round(x) + 'px');
        el.style.setProperty('--y', Math.round(y) + 'px');
      };
      const up = () => {
        document.removeEventListener('pointermove', move);
        document.removeEventListener('pointerup', up);
        const m2 = ed.model();
        window.StudioModel.setProp(m2, el.dataset.id, 'offsetX', Math.round(x), t.state, t.breakpoint);
        window.StudioModel.setProp(m2, el.dataset.id, 'offsetY', Math.round(y), t.state, t.breakpoint);
        el.style.removeProperty('--x');
        el.style.removeProperty('--y');
        if (!el.getAttribute('style')) el.removeAttribute('style');
        window.StudioModel.writeCSS(window.StudioModel.emitCSS(m2));
        if (window.StudioInspector) window.StudioInspector.syncFromModel();
        ed.push();
        ed.status(`${el.dataset.node} moved to ${Math.round(x)}, ${Math.round(y)}${snap ? ' (snapped)' : ''}`);
      };
      document.addEventListener('pointermove', move);
      document.addEventListener('pointerup', up);
    }, true);

    window.addEventListener('keydown', e => {
      if (!ed.editing()) return;
      const t = e.target;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      if (e.key === 'v' || e.key === 'V') setMoveMode(!moveMode);
      // Arrow-key nudging, which is often more precise than a drag.
      const el = ed.selected();
      if (!el || !MOVABLE.includes(el.dataset.type)) return;
      const delta = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
      if (!delta) return;
      e.preventDefault();
      const amount = e.shiftKey ? 10 : 1;
      const m = ed.model();
      const tgt = window.StudioShell ? window.StudioShell.writeTarget() : { state: 'base', breakpoint: null };
      const nx = (Number(window.StudioModel.getProp(m, el.dataset.id, 'offsetX', tgt.state, tgt.breakpoint)) || 0) + delta[0] * amount;
      const ny = (Number(window.StudioModel.getProp(m, el.dataset.id, 'offsetY', tgt.state, tgt.breakpoint)) || 0) + delta[1] * amount;
      window.StudioModel.setProp(m, el.dataset.id, 'offsetX', nx, tgt.state, tgt.breakpoint);
      window.StudioModel.setProp(m, el.dataset.id, 'offsetY', ny, tgt.state, tgt.breakpoint);
      window.StudioModel.writeCSS(window.StudioModel.emitCSS(m));
      ed.push();
      ed.status(`${el.dataset.node}: ${nx}, ${ny}`);
    });
  }

  function init() {
    const promoted = promote();
    enhanceLinkFields();
    buildDividerPanel();
    bindDrag();
    ed.layers();
    if (promoted) console.info('[studio] promoted', promoted, 'links/dividers to editable objects');
  }

  window.StudioObjects = { init, promote, enhanceLinkFields, setMoveMode, isMoveMode: () => moveMode, LINK_KEYS, MOVABLE };

  /* Promote on load, not only when the editor opens.
   *
   * The ids are what the model matches on, so a published divider shape or a
   * styled link could not be applied to a page nobody had opened the editor on
   * — the elements had no data-id yet and apply() simply could not find them.
   * A visitor saw the default hairline while the config held the real shape.
   *
   * This script is last in the body, so the elements exist by now, and it runs
   * before the config fetch resolves.
   */
  promote();
})();
