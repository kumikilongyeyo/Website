/* Direct text transform, the way Figma and Photoshop handle text.
 *
 * Select a text object and it gets a bounding box:
 *   - drag a corner handle to scale the type (font size), with a live readout
 *   - drag the ✥ grip to move it
 *   - a floating toolbar above it: − size +, a scrubbable Size label, weight,
 *     alignment
 *   - Photoshop shortcuts: ⌘⇧> / ⌘⇧< size ±2px (⌥ for ±10), ⌥← / ⌥→ tracking,
 *     ⌥↑ / ⌥↓ leading
 *
 * Every change goes through StudioModel like the inspector does, so it lands
 * on the current state and breakpoint (the phone preview edits the phone
 * size), survives publish, and undoes in one step per gesture.
 *
 * Loaded with the other editor modules (EDITOR_MODULES), never for visitors.
 */
(() => {
  'use strict';

  const $ = (s, p = document) => p.querySelector(s);
  const sel = () => (typeof selected !== 'undefined' ? selected : null);
  const active = () => document.body.classList.contains('editing') && !document.body.classList.contains('previewing');
  const isText = el => !!(el && el.isConnected && el.dataset && el.dataset.type === 'text');
  const isLine = el => !!(el && el.isConnected && el.dataset && el.dataset.type === 'divider');
  const numOr = (v, f) => { const n = typeof v === 'number' ? v : (typeof v === 'string' && /^-?[\d.]+(px)?$/.test(v.trim()) ? parseFloat(v) : NaN); return Number.isFinite(n) ? n : f(); };
  const target = () => (window.StudioShell ? window.StudioShell.writeTarget() : { state: 'base', breakpoint: null });
  const say = m => { if (typeof status === 'function') status(m); };
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  /* ------------------------------------------------------------ model io */
  function read(el, prop, fallback) {
    const t = target();
    const v = window.StudioModel.getProp(state(), el.dataset.id, prop, t.state, t.breakpoint);
    return v === undefined || v === '' ? fallback() : v;
  }
  // Stored values can be CSS expressions (a frozen clamp()); then the on-screen
  // computed value is the starting point for a nudge.
  const cFont = el => parseFloat(getComputedStyle(el).fontSize) || 16;
  const cTrack = el => Math.round(parseFloat(getComputedStyle(el).letterSpacing) / cFont(el) * 100) || 0;
  const cLead = el => { const lh = parseFloat(getComputedStyle(el).lineHeight); return lh ? +(lh / cFont(el)).toFixed(2) : 1.2; };
  const fontSize = el => numOr(read(el, 'fontSize', () => cFont(el)), () => cFont(el));
  const tracking = el => numOr(read(el, 'letterSpacing', () => cTrack(el)), () => cTrack(el));
  const leading = el => numOr(read(el, 'lineHeight', () => cLead(el)), () => cLead(el));
  const offset = (el, k) => numOr(read(el, k, () => 0), () => 0);

  /* What a size shows when it has no model value: the page stylesheet's own
   * declaration (e.g. clamp(34px, 5.6cqw, 72px)), so freezing a phone size
   * before a desktop edit keeps it exactly as the page defines it. */
  const CSS_OF = { fontSize: 'font-size', fontWeight: 'font-weight', lineHeight: 'line-height', textAlign: 'text-align', color: 'color', letterSpacing: 'letter-spacing', fontFamily: 'font-family', width: 'width', height: 'height', opacity: 'opacity' };
  const ZERO = { offsetX: 0, offsetY: 0, rotate: 0 };
  const WIDTH = { tablet: 900, mobile: 390 };
  function specificity(sel) {
    const t = sel.replace(/::?[\w-]+(\([^)]*\))?/g, m => (m.startsWith('::') ? ' e' : ' c'));
    return (t.match(/#[\w-]+/g) || []).length * 100 + (t.match(/\.[\w-]+|\[[^\]]+\]| c/g) || []).length * 10 + (t.match(/(^|[\s>+~])[a-z]+/gi) || []).length;
  }
  function pageValue(el, cssProp, bp) {
    let best = null, bestSpec = -1;
    const walk = (rules, applies) => {
      for (const rule of rules) {
        if (rule.cssRules && !rule.selectorText) {
          const cond = rule.conditionText || (rule.media && rule.media.mediaText) || '';
          const m = /max-width:\s*(\d+)px/.exec(cond), mn = /min-width:\s*(\d+)px/.exec(cond);
          const ok = !cond || /prefers|hover|print/.test(cond) ? !/prefers|hover|print/.test(cond) : (!m || WIDTH[bp] <= +m[1]) && (!mn || WIDTH[bp] >= +mn[1]);
          walk(rule.cssRules, applies && ok);
          continue;
        }
        if (!applies || !rule.selectorText || !rule.style) continue;
        const v = rule.style.getPropertyValue(cssProp); if (!v) continue;
        for (const part of rule.selectorText.split(',')) {
          let hit = false; try { hit = el.matches(part.trim()); } catch { /* pseudo selector */ }
          if (!hit) continue;
          const sp = specificity(part);
          if (sp >= bestSpec) { best = v.trim(); bestSpec = sp; }
        }
      }
    };
    for (const sh of document.styleSheets) {
      if (sh.ownerNode && sh.ownerNode.id === 'studio-generated') continue;
      let rules; try { rules = sh.cssRules; } catch { continue; }
      walk(rules, true);
    }
    return best;
  }
  function resolveDefault(id, prop, bp) {
    if (prop in ZERO) return ZERO[prop];
    const cssProp = CSS_OF[prop]; if (!cssProp) return undefined;
    const el = window.StudioModel.findNode(document, id); if (!el) return undefined;
    const v = pageValue(el, cssProp, bp); if (!v) return undefined;
    if (prop === 'letterSpacing' && /^-?[\d.]+em$/.test(v)) return Math.round(parseFloat(v) * 1000) / 10;
    if (prop === 'fontSize' && /^[\d.]+px$/.test(v)) return parseFloat(v);
    return v;
  }
  if (window.StudioModel && window.StudioModel.setDefaultResolver) window.StudioModel.setDefaultResolver(resolveDefault);

  let pushTimer = 0;
  // live: part of a drag, so no history entry yet (the gesture commits once on release).
  function write(el, props, commitNow, live) {
    if (el.dataset.locked === '1') { say(`"${el.dataset.node || el.dataset.id}" is locked. Unlock it in Layers to edit it.`); return false; }
    const m = state();
    if (!m.nodes[el.dataset.id]) return false;
    const t = target();
    for (const k in props) window.StudioModel.setProp(m, el.dataset.id, k, props[k], t.state, t.breakpoint);
    window.StudioModel.writeCSS(window.StudioModel.emitCSS(m));
    if (window.StudioInspector && window.StudioInspector.syncFromModel) window.StudioInspector.syncFromModel();
    clearTimeout(pushTimer);
    if (live) return true;
    const go = () => { if (typeof push === 'function') push(); };
    commitNow ? go() : (pushTimer = setTimeout(go, 300));
    return true;
  }

  /* ------------------------------------------------------------ the ui */
  const CSS = `
  .tbx-live,.tbx-live *{transition:none!important}
  body.tbx-on .of-handle{display:none!important}
  .tbx{position:fixed;z-index:880;pointer-events:none;border:1px solid #0d99ff;box-shadow:0 0 0 1px rgba(13,153,255,.25)}
  .tbx[hidden],.tbx-bar[hidden]{display:none!important}
  .tbx-h{position:absolute;width:10px;height:10px;background:#fff;border:1.5px solid #0d99ff;border-radius:2px;pointer-events:auto;touch-action:none}
  .tbx-h[data-h=nw]{left:-6px;top:-6px;cursor:nwse-resize}.tbx-h[data-h=se]{right:-6px;bottom:-6px;cursor:nwse-resize}
  .tbx-h[data-h=ne]{right:-6px;top:-6px;cursor:nesw-resize}.tbx-h[data-h=sw]{left:-6px;bottom:-6px;cursor:nesw-resize}
  .tbx-bar.line-bar>:not([data-tb=edit]):not([data-tb=anim]):not(.tbx-vp){display:none}
  .tbx.line .tbx-h[data-h=nw],.tbx.line .tbx-h[data-h=ne]{display:none}
  .tbx.line .tbx-h[data-h=sw]{left:-6px;top:50%;bottom:auto;margin-top:-5px;cursor:ew-resize}
  .tbx.line .tbx-h[data-h=se]{right:-6px;top:50%;bottom:auto;margin-top:-5px;cursor:ew-resize}
  .tbx.line{min-height:10px}
  .tbx-move{position:absolute;left:-1px;top:-26px;height:22px;padding:0 7px;border-radius:5px 5px 0 0;background:#0d99ff;color:#fff;font:600 11px/22px system-ui,sans-serif;pointer-events:auto;cursor:grab;border:0;touch-action:none;white-space:nowrap}
  .tbx-move:active{cursor:grabbing}
  .tbx-badge{position:absolute;right:-1px;bottom:-24px;padding:2px 6px;border-radius:4px;background:#0d99ff;color:#fff;font:600 11px/16px system-ui,sans-serif;font-variant-numeric:tabular-nums;pointer-events:none;opacity:0;transition:opacity .15s}
  .tbx.scaling .tbx-badge{opacity:1}
  .tbx-bar{position:fixed;z-index:890;display:flex;align-items:center;gap:4px;padding:4px;border-radius:10px;background:#1e1e1e;color:#eee;border:1px solid rgba(255,255,255,.12);box-shadow:0 10px 30px rgba(0,0,0,.45);font:12px/1 system-ui,sans-serif}
  .tbx-bar button,.tbx-bar select,.tbx-bar input{height:28px;border-radius:6px;background:transparent;color:inherit;border:1px solid transparent;font:inherit}
  .tbx-bar button{min-width:28px;padding:0 6px;cursor:pointer}
  .tbx-bar button:hover,.tbx-bar button[aria-pressed=true]{background:rgba(255,255,255,.1)}
  .tbx-bar button:focus-visible,.tbx-bar input:focus-visible,.tbx-bar select:focus-visible{outline:2px solid #0d99ff;outline-offset:1px}
  .tbx-bar input{width:52px;text-align:center;background:rgba(255,255,255,.06);font-variant-numeric:tabular-nums}
  .tbx-bar select{padding:0 4px;background:rgba(255,255,255,.06)}
  .tbx-bar .tbx-scrub{cursor:ew-resize;padding:0 4px;opacity:.7;user-select:none}
  .tbx-bar .tbx-sep{width:1px;height:18px;background:rgba(255,255,255,.14);margin:0 2px}
  .tbx-bar .tbx-vp{padding:3px 7px;border-radius:5px;background:#0d99ff;color:#fff;font-weight:600;font-size:11px;white-space:nowrap}
  .tbx-bar select:disabled{opacity:.45}
  .tbx-bar .tbx-anim{display:inline-flex;align-items:center;gap:5px}
  .tbx-bar .tbx-anim-name{font-size:11px;opacity:.8;text-transform:capitalize}
  .tbx-bar .tbx-anim.on .tbx-anim-name{color:#7dd3ff;opacity:1}
  @keyframes tbx-flash{0%{box-shadow:0 0 0 2px #0d99ff,0 0 0 8px rgba(13,153,255,.35)}100%{box-shadow:0 0 0 0 rgba(13,153,255,0)}}
  .inspector .tbx-flash{animation:tbx-flash 1.2s ease-out;border-radius:8px}
  .inspector .panel.tbx-folded>:not(h4){display:none!important}
  .inspector .panel.tbx-folded>h4::after{content:" (folded, click ✎ or the animation icon again to open)";font-weight:400;opacity:.5;text-transform:none;letter-spacing:0}
  .tbx-bar .tbx-hint{opacity:.55;font-size:11px;padding:0 6px;white-space:nowrap}
  @media (max-width:900px){.tbx-bar .tbx-hint{display:none}}`;
  const PENCIL = '<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M9.6 1.6l2.8 2.8-7.6 7.6H2V9.2z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M8.2 3l2.8 2.8" stroke="currentColor" stroke-width="1.5"/></svg>';
  const SPARK = '<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M7 1.2l1.5 3.9 3.9 1.4-3.9 1.5L7 11.8 5.5 8 1.6 6.5l3.9-1.4z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M11.4 10.2l.5 1.3 1.3.5-1.3.5-.5 1.3-.5-1.3-1.3-.5 1.3-.5z" fill="currentColor"/></svg>';
  const ALIGN_ICON = a => `<svg width="14" height="12" viewBox="0 0 14 12" aria-hidden="true"><g stroke="currentColor" stroke-width="1.6" stroke-linecap="round">${a === 'left' ? '<path d="M1 2h12M1 6h8M1 10h10"/>' : a === 'center' ? '<path d="M1 2h12M3 6h8M2 10h10"/>' : '<path d="M1 2h12M5 6h8M3 10h10"/>'}</g></svg>`;

  let box, bar, cur = null, raf = 0;
  function mount() {
    if (box) return;
    const st = document.createElement('style'); st.id = 'textboxStyle'; st.textContent = CSS; document.head.appendChild(st);
    box = document.createElement('div'); box.className = 'tbx'; box.hidden = true; box.setAttribute('aria-hidden', 'true');
    box.innerHTML = '<button type="button" class="tbx-move" title="Drag to move">✥ Move</button>' + ['nw', 'ne', 'sw', 'se'].map(h => `<span class="tbx-h" data-h="${h}"></span>`).join('') + '<span class="tbx-badge"></span>';
    bar = document.createElement('div'); bar.className = 'tbx-bar'; bar.hidden = true; bar.setAttribute('role', 'toolbar'); bar.setAttribute('aria-label', 'Text');
    bar.innerHTML = `<span class="tbx-scrub" title="Drag left or right to change the size">Size</span>
      <button type="button" data-tb="dec" title="Smaller (⌘⇧<)" aria-label="Smaller">−</button>
      <input id="tbxSize" type="number" min="4" max="400" step="1" aria-label="Font size in pixels">
      <button type="button" data-tb="inc" title="Larger (⌘⇧>)" aria-label="Larger">+</button>
      <span class="tbx-sep"></span>
      <select id="tbxWeight" aria-label="Weight">${[300, 400, 500, 600, 700, 800, 900].map(w => `<option value="${w}">${w}</option>`).join('')}</select>
      <span class="tbx-sep"></span>
      ${['left', 'center', 'right'].map(a => `<button type="button" data-align="${a}" aria-label="Align ${a}" title="Align ${a}">${ALIGN_ICON(a)}</button>`).join('')}
      <span class="tbx-sep"></span>
      <button type="button" data-tb="reset" title="Put it back in its default position for this size" aria-label="Reset position">⟲</button>
      <span class="tbx-sep"></span>
      <button type="button" data-tb="edit" title="Open its settings in the side panel" aria-label="Settings">${PENCIL}</button>
      <button type="button" data-tb="anim" class="tbx-anim" title="Open its animation settings" aria-label="Animation">${SPARK}<span class="tbx-anim-name"></span></button>
      <span class="tbx-vp" hidden></span>
      <span class="tbx-hint">Drag a corner to resize · ⌘⇧&lt; &gt;</span>`;
    document.body.append(box, bar);
    // Keep editor clicks on the toolbar from reaching the page and deselecting.
    bar.addEventListener('pointerdown', e => e.stopPropagation());
    bar.addEventListener('click', e => e.stopPropagation());
    bindBar(); bindHandles();
  }

  function syncBar() {
    if (!cur) return;
    const size = $('#tbxSize'); if (document.activeElement !== size) size.value = Math.round(fontSize(cur));
    const w = String(read(cur, 'fontWeight', () => getComputedStyle(cur).fontWeight));
    const ws = $('#tbxWeight');
    ws.value = ['300', '400', '500', '600', '700', '800', '900'].includes(w) ? w : '400';
    // A face that ships a single weight (Archivo Black) cannot get bolder or
    // lighter; say so rather than offer a menu that silently does nothing.
    const fam = getComputedStyle(cur).fontFamily.split(',')[0].replace(/["']/g, '').trim();
    const weights = new Set([...document.fonts].filter(f => f.family.replace(/["']/g, '') === fam && f.status === 'loaded').map(f => String(f.weight)));
    const single = weights.size === 1 && ![...weights][0].includes(' ');
    ws.disabled = single;
    const an = animInfo(cur);
    bar.querySelector('.tbx-anim-name').textContent = an.label;
    bar.querySelector('.tbx-anim').classList.toggle('on', an.active);
    bar.querySelector('.tbx-anim').title = an.title;
    ws.title = single ? `${fam} comes in one weight only` : 'Weight';

    const al = read(cur, 'textAlign', () => getComputedStyle(cur).textAlign);
    bar.querySelectorAll('[data-align]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.align === al || (al === 'start' && b.dataset.align === 'left'))));
  }

  function place() {
    raf = 0;
    const el = sel();
    const show = active() && (isText(el) || isLine(el)) && el.getClientRects().length;
    document.body.classList.toggle('tbx-on', !!show);
    if (!show) { if (box) { box.hidden = true; bar.hidden = true; } cur = null; return; }
    mount();
    if (cur !== el) { cur = el; box.classList.toggle('line', isLine(el)); syncBar(); }
    const r = el.getBoundingClientRect();
    // Scrolled out of view: hide rather than pin a toolbar to the screen edge
    // for text you can no longer see. The loop keeps running to bring it back.
    if (r.bottom < 0 || r.top > innerHeight) { box.hidden = true; bar.hidden = true; raf = requestAnimationFrame(place); return; }
    box.hidden = false; bar.hidden = false;
    bar.classList.toggle('line-bar', isLine(el));
    const t = target(), vp = bar.querySelector('.tbx-vp'), label = t.breakpoint ? `Editing ${t.breakpoint} size` : t.state !== 'base' ? `Editing ${t.state}` : '';
    if (vp.textContent !== label) { vp.textContent = label; vp.hidden = !label; syncBar(); }
    Object.assign(box.style, { left: r.left - 3 + 'px', top: r.top - 3 + 'px', width: r.width + 6 + 'px', height: r.height + 6 + 'px' });
    const bw = bar.offsetWidth, bh = bar.offsetHeight, topLimit = 60;
    let top = r.top - bh - 34; if (top < topLimit) top = r.bottom + 30;
    bar.style.left = clamp(r.left, 8, innerWidth - bw - 8) + 'px';
    bar.style.top = clamp(top, topLimit, innerHeight - bh - 8) + 'px';
    raf = requestAnimationFrame(place);          // follows scrolling, typing and reflow
  }
  const kick = () => { if (!raf) raf = requestAnimationFrame(place); };

  /* ------------------------------------------------------------ side panel
   * ✎ opens the object's own settings, the spark opens its animation. A page
   * can take over either for particular objects (window.StudioPageHooks),
   * e.g. the casino hero text, whose timing lives in its Hero animation panel.
   * A second click on the same icon folds the section it opened.
   */
  let lastJump = null;
  function panelByTitle(tab, re) {
    return [...document.querySelectorAll(`.inspector .tab-panel[data-tab="${tab}"] .panel`)].find(p => re.test((p.querySelector('h4') || {}).textContent || ''));
  }
  function jumpTo(tab, panel, key) {
    const t = document.querySelector(`.inspect-tab[data-tab="${tab}"]`);
    if (t && !t.classList.contains('active')) t.click();
    if (!panel) return;
    if (lastJump === key && !panel.classList.contains('tbx-folded') && t && t.classList.contains('active')) { panel.classList.add('tbx-folded'); lastJump = null; say('Folded. Click the icon again to open it.'); return; }
    panel.classList.remove('tbx-folded');
    lastJump = key;
    panel.scrollIntoView({ block: 'start', behavior: 'smooth' });
    document.querySelectorAll('.inspector .tbx-flash').forEach(x => x.classList.remove('tbx-flash'));
    void panel.offsetWidth; panel.classList.add('tbx-flash');
  }
  function motionPreset(el) {
    const n = state().nodes[el.dataset.id];
    return (n && n.motion && n.motion.preset) || el.dataset.motion || 'none';
  }
  function animInfo(el) {
    const hook = window.StudioPageHooks && window.StudioPageHooks.anim && window.StudioPageHooks.anim(el);
    if (hook) return { label: hook.label, active: true, title: hook.title || 'Open its animation settings' };
    const p = motionPreset(el);
    return { label: p === 'none' ? 'None' : p, active: p !== 'none', title: p === 'none' ? 'No animation yet. Click to add one' : `Animation: ${p}. Click to change it` };
  }
  function openSettings(el) {
    const hook = window.StudioPageHooks && window.StudioPageHooks.edit && window.StudioPageHooks.edit(el);
    if (hook) return hook.open();
    if (isLine(el)) return jumpTo('design', document.getElementById('dividerPanel'), 'edit-line');
    jumpTo('design', panelByTitle('design', /typography/i), 'edit-text');
  }
  function openAnimation(el) {
    const hook = window.StudioPageHooks && window.StudioPageHooks.anim && window.StudioPageHooks.anim(el);
    if (hook) return hook.open();
    jumpTo('motion', panelByTitle('motion', /selected object animation/i), 'anim');
  }

  /* ------------------------------------------------------------ gestures */
  function drag(e, onMove, onEnd) {
    e.preventDefault(); e.stopPropagation();
    const h = e.currentTarget; try { h.setPointerCapture(e.pointerId); } catch { /* synthetic */ }
    const move = q => onMove(q), up = q => { h.removeEventListener('pointermove', move); h.removeEventListener('pointerup', up); h.removeEventListener('pointercancel', up); onEnd(q); };
    h.addEventListener('pointermove', move); h.addEventListener('pointerup', up); h.addEventListener('pointercancel', up);
  }

  function bindHandles() {
    box.querySelectorAll('.tbx-h').forEach(h => h.addEventListener('pointerdown', e => {
      const el = cur; if (!el) return;
      if (isLine(el)) {
        // A line's ends set its length, as a % of its container.
        const r0 = el.getBoundingClientRect(), pw = el.parentElement.getBoundingClientRect().width || 1, dir = h.dataset.h.includes('e') ? 1 : -1;
        el.classList.add('tbx-live'); box.classList.add('scaling');
        drag(e, q => {
          const w = clamp(Math.round((r0.width + (q.clientX - e.clientX) * dir) / pw * 100), 2, 100);
          box.querySelector('.tbx-badge').textContent = w + '%';
          write(el, { width: w + '%' }, false, true);
        }, () => { el.classList.remove('tbx-live'); box.classList.remove('scaling'); write(el, {}, true); if (window.StudioObjects && window.StudioObjects.syncDivider) window.StudioObjects.syncDivider(); say('Line length set.'); });
        return;
      }
      const r = el.getBoundingClientRect(), size0 = fontSize(el);
      const sx = h.dataset.h.includes('e') ? 1 : -1, sy = h.dataset.h.includes('s') ? 1 : -1;
      const len2 = r.width * r.width + r.height * r.height;
      box.classList.add('scaling'); el.classList.add('tbx-live');
      drag(e, q => {
        // Project the pointer onto the box diagonal: dragging a corner away
        // from its opposite corner grows the type, toward it shrinks it.
        const dx = q.clientX - e.clientX, dy = q.clientY - e.clientY;
        const f = 1 + (dx * sx * r.width + dy * sy * r.height) / len2;
        const size = clamp(Math.round(size0 * f), 4, 400);
        box.querySelector('.tbx-badge').textContent = size + 'px';
        write(el, { fontSize: size }, false, true); syncBar();
      }, () => { box.classList.remove('scaling'); el.classList.remove('tbx-live'); write(el, {}, true); say(`Text size ${Math.round(fontSize(el))}px.`); });
    }));
    box.querySelector('.tbx-move').addEventListener('pointerdown', e => {
      const el = cur; if (!el) return;
      const x0 = offset(el, 'offsetX'), y0 = offset(el, 'offsetY');
      const snap = window.StudioShell && window.StudioShell.shell.view && window.StudioShell.shell.view.snap;
      el.classList.add('tbx-live');
      drag(e, q => {
        let x = x0 + q.clientX - e.clientX, y = y0 + q.clientY - e.clientY;
        if (snap || q.shiftKey) { x = Math.round(x / 8) * 8; y = Math.round(y / 8) * 8; }
        write(el, { offsetX: Math.round(x), offsetY: Math.round(y) }, false, true);
      }, () => { el.classList.remove('tbx-live'); write(el, {}, true); say('Moved. Undo puts it back.'); });
    });
  }

  function bindBar() {
    const size = $('#tbxSize');
    const setSize = (v, now) => { if (cur && Number.isFinite(v)) { write(cur, { fontSize: clamp(Math.round(v), 4, 400) }, now); syncBar(); } };
    bar.addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b || !cur) return;
      if (b.dataset.tb === 'inc') setSize(fontSize(cur) + (e.altKey ? 10 : 2), true);
      if (b.dataset.tb === 'dec') setSize(fontSize(cur) - (e.altKey ? 10 : 2), true);
      if (b.dataset.align) { write(cur, { textAlign: b.dataset.align }, true); syncBar(); }
      if (b.dataset.tb === 'edit') { openSettings(cur); return; }
      if (b.dataset.tb === 'anim') { openAnimation(cur); return; }
      if (b.dataset.tb === 'reset') { write(cur, { offsetX: 0, offsetY: 0 }, true); const t = target(); say(`Position reset${t.breakpoint ? ' for the ' + t.breakpoint + ' size' : ''}.`); }
    });
    size.addEventListener('input', () => setSize(Number(size.value)));
    size.addEventListener('keydown', e => { if (e.key === 'Enter') { setSize(Number(size.value), true); size.blur(); } });
    $('#tbxWeight').addEventListener('change', e => { if (cur) write(cur, { fontWeight: e.target.value }, true); });
    // Figma-style scrub: drag the Size label sideways.
    bar.querySelector('.tbx-scrub').addEventListener('pointerdown', e => {
      if (!cur) return; const s0 = fontSize(cur);
      const el = cur; el.classList.add('tbx-live');
      drag(e, q => { write(el, { fontSize: clamp(Math.round(s0 + (q.clientX - e.clientX) / 2), 4, 400) }, false, true); syncBar(); }, () => { el.classList.remove('tbx-live'); write(el, {}, true); });
    });
  }

  /* ------------------------------------------------------------ keys */
  document.addEventListener('keydown', e => {
    const el = sel();
    if (!active() || !isText(el)) return;          // shortcuts are for type; lines use the box and panel
    const mod = e.metaKey || e.ctrlKey;
    let props = null;
    if (mod && e.shiftKey && (e.key === '>' || e.key === '.' || e.code === 'Period')) props = { fontSize: clamp(fontSize(el) + (e.altKey ? 10 : 2), 4, 400) };
    else if (mod && e.shiftKey && (e.key === '<' || e.key === ',' || e.code === 'Comma')) props = { fontSize: clamp(fontSize(el) - (e.altKey ? 10 : 2), 4, 400) };
    else if (e.altKey && !mod && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) props = { letterSpacing: +(tracking(el) + (e.key === 'ArrowRight' ? 2 : -2)).toFixed(1) };
    else if (e.altKey && !mod && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) props = { lineHeight: +clamp(leading(el) + (e.key === 'ArrowDown' ? 0.05 : -0.05), 0.5, 3).toFixed(2) };
    if (!props) return;
    e.preventDefault(); e.stopPropagation();
    write(el, props); syncBar();
    if (props.fontSize) say(`Text size ${props.fontSize}px.`);
    else if (props.letterSpacing !== undefined) say(`Letter spacing ${props.letterSpacing}.`);
    else say(`Line height ${props.lineHeight}.`);
  }, true);

  /* ------------------------------------------------------------ wiring */
  if (typeof window.select === 'function' && !window.select.__textbox) {
    const inner = window.select;
    const wrapped = function (...a) { const r = inner.apply(this, a); kick(); return r; };
    wrapped.__textbox = true;
    window.select = wrapped;
  }
  new MutationObserver(kick).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  document.addEventListener('change', e => { if (e.target && e.target.id === 'motion') setTimeout(() => { if (cur) syncBar(); }, 0); });
  addEventListener('scroll', kick, true);
  addEventListener('resize', kick);
  kick();
  window.StudioTextBox = { refresh: kick, jumpTo, panelByTitle };
})();
