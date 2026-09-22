/* Studio shell: toolbar, canvas view toggles, preview, viewport switcher,
 * nested layer tree, object operations and the state editor (§6–§10, §20, §26).
 *
 * The editor outline and an object's real border are separate concerns here.
 * Outlines are drawn from body-level classes and never touch the model, so
 * turning the selection box off cannot change the published site, and enabling
 * a border cannot be confused for being selected (§7).
 *
 * Exposed as window.StudioShell.
 */
(() => {
  'use strict';

  const $ = (s, p = document) => p.querySelector(s);
  const $$ = (s, p = document) => [...p.querySelectorAll(s)];

  const VIEW_FLAGS = {
    selectionBox: { label: 'Selection box', cls: 'show-selection', on: true },
    labels:       { label: 'Object labels', cls: 'show-labels', on: false },
    guides:       { label: 'Guides',        cls: 'show-guides', on: false },
    grid:         { label: 'Grid',          cls: 'show-grid', on: false },
    snap:         { label: 'Snap',          cls: 'snap-on', on: true },
  };

  const VIEWPORTS = {
    desktop: { label: 'Desktop', width: null },
    tablet:  { label: 'Tablet',  width: 900 },
    mobile:  { label: 'Mobile',  width: 600 },
  };

  const shell = {
    previewing: false,
    viewport: 'desktop',
    editState: 'base',
    view: Object.fromEntries(Object.entries(VIEW_FLAGS).map(([k, v]) => [k, v.on])),
  };

  const ed = {
    // The editor's own functions live in studio-editor.js as globals. Reach
    // them lazily so load order cannot matter.
    model: () => (typeof state === 'function' ? state() : null),
    push: () => { if (typeof push === 'function') push(); },
    status: m => { if (typeof status === 'function') status(m); },
    select: el => { if (typeof select === 'function') select(el); },
    selected: () => (typeof selected !== 'undefined' ? selected : null),
    layers: () => { if (typeof layers === 'function') layers(); },
    observe: () => { if (typeof observe === 'function') observe(); },
    bindTile: el => { if (typeof bindTile === 'function') bindTile(el); },
    bindResize: el => { if (typeof bindResize === 'function') bindResize(el); },
    editing: () => document.body.classList.contains('editing'),
  };

  /* --------------------------------------------------------------- preview
   * Preview must remove every trace of the editor, not merely dim it, so what
   * you see is what a visitor sees (§7).
   */
  function setPreview(on) {
    shell.previewing = !!on;
    document.body.classList.toggle('previewing', shell.previewing);
    // Chrome is hidden by .previewing in CSS; also drop selection and any
    // state preview so nothing is left mid-hover.
    if (shell.previewing) {
      $$('.selected').forEach(e => e.classList.remove('selected'));
      $$('[data-preview-state]').forEach(e => delete e.dataset.previewState);
      $$('[contenteditable="true"]').forEach(e => { e.dataset.wasEditable = '1'; e.contentEditable = 'false'; });
    } else {
      $$('[data-was-editable="1"]').forEach(e => { e.contentEditable = 'true'; delete e.dataset.wasEditable; });
      const sel = ed.selected();
      if (sel) sel.classList.add('selected');
    }
    const btn = $('[data-preview]');
    if (btn) {
      btn.textContent = shell.previewing ? 'Exit preview' : 'Preview';
      btn.setAttribute('aria-pressed', String(shell.previewing));
    }
    ed.status(shell.previewing ? 'Preview — editor hidden. Press Escape or click Exit preview.' : 'Editing');
  }

  /* -------------------------------------------------------- view toggles */
  function applyView() {
    for (const [key, def] of Object.entries(VIEW_FLAGS)) {
      document.body.classList.toggle(def.cls, !!shell.view[key]);
    }
  }
  function setView(key, on) {
    if (!(key in VIEW_FLAGS)) return;
    shell.view[key] = !!on;
    applyView();
    const input = $(`[data-view="${key}"]`);
    if (input) input.checked = !!on;
  }

  /* ---------------------------------------------------------- viewport
   * Editing a breakpoint narrows the canvas and routes inspector writes to
   * that breakpoint's override bag. One DOM, many widths (§26).
   */
  function setViewport(name) {
    if (!VIEWPORTS[name]) return;
    shell.viewport = name;
    const site = $('.site');
    const w = VIEWPORTS[name].width;
    if (site) {
      site.style.maxWidth = w ? w + 'px' : '';
      site.style.marginInline = w ? 'auto' : '';
    }
    document.body.dataset.viewport = name;
    $$('[data-viewport-btn]').forEach(b => {
      const active = b.dataset.viewportBtn === name;
      b.classList.toggle('active', active);
      b.setAttribute('aria-pressed', String(active));
    });
    const hint = $('#viewportHint');
    if (hint) {
      hint.textContent = name === 'desktop'
        ? 'Editing desktop values.'
        : `Editing ${VIEWPORTS[name].label} overrides — changes apply below ${w}px only.`;
    }
    if (window.StudioInspector) window.StudioInspector.syncFromModel();
    ed.status(name === 'desktop' ? 'Desktop' : `${VIEWPORTS[name].label} overrides`);
  }

  // What the inspector should write to: null breakpoint means desktop/base.
  function writeTarget() {
    return {
      state: shell.editState,
      breakpoint: shell.viewport === 'desktop' ? null : shell.viewport,
    };
  }

  /* ------------------------------------------------------- state editor */
  function setEditState(name) {
    if (!['base', 'hover', 'pressed'].includes(name)) return;
    shell.editState = name;
    const sel = ed.selected();
    // Preview the state on the selected object only, without a real pointer.
    $$('[data-preview-state]').forEach(e => delete e.dataset.previewState);
    if (sel && window.StudioModel) window.StudioModel.previewState(sel, name);
    $$('[data-state-btn]').forEach(b => {
      const active = b.dataset.stateBtn === name;
      b.classList.toggle('active', active);
      b.setAttribute('aria-pressed', String(active));
    });
    const hint = $('#stateHint');
    if (hint) {
      hint.textContent = name === 'base'
        ? 'Editing the base state.'
        : `Editing the ${name} state — only properties you change here override base.`;
    }
    if (window.StudioInspector) window.StudioInspector.syncFromModel();
    ed.status(name === 'base' ? 'Base state' : `${name} state`);
  }

  /* ------------------------------------------------------- object factory
   * Every added object is a real node the model understands: a stable id, a
   * type, and a display name (§8).
   */
  let seq = 0;
  function uid(type) {
    seq += 1;
    return `${type}-${Date.now().toString(36)}${seq.toString(36)}`;
  }

  const TEMPLATES = {
    heading: () => ({ tag: 'h2', type: 'text', name: 'Heading', html: 'New heading', cls: '' }),
    text:    () => ({ tag: 'p',  type: 'text', name: 'Text', html: 'New paragraph of text.', cls: '' }),
    button:  () => ({ tag: 'a',  type: 'button', name: 'Button', html: 'Button', cls: 'ui-btn' }),
    divider: () => ({ tag: 'hr', type: 'divider', name: 'Divider', html: '', cls: 'rule' }),
    spacer:  () => ({ tag: 'div', type: 'spacer', name: 'Spacer', html: '', cls: 'spacer' }),
    shape:   () => ({ tag: 'div', type: 'shape', name: 'Shape', html: '', cls: 'shape' }),
    container: () => ({ tag: 'div', type: 'container', name: 'Container', html: '', cls: 'container-box' }),
    section: () => ({ tag: 'section', type: 'section', name: 'Section', html: '', cls: 'section' }),
  };

  function addObject(kind) {
    if (kind === 'tile') {
      if (typeof addTile === 'function') { addTile(); return ed.selected(); }
      ed.status('Tiles can only be added from the Work grid.');
      return null;
    }
    const make = TEMPLATES[kind];
    if (!make) { ed.status(`"${kind}" is not an object type this build can add.`); return null; }
    const spec = make();
    const el = document.createElement(spec.tag);
    if (spec.cls) el.className = spec.cls;
    el.dataset.id = uid(kind);
    el.dataset.node = spec.name;
    el.dataset.type = spec.type;
    // Marks this as Studio-authored so a reload rebuilds it. Without the mark
    // the model cannot tell a new object from a page id that was retired.
    el.dataset.authored = '1';
    if (spec.html) el.innerHTML = spec.html;
    if (spec.tag === 'a') { el.href = '#'; el.dataset.action = 'url'; }

    // Insert inside the selected container when that makes sense, otherwise
    // after the selection, otherwise at the end of the page body.
    const sel = ed.selected();
    const host = sel && ['container', 'section'].includes(sel.dataset.type) ? sel : null;
    if (host) host.appendChild(el);
    else if (sel && sel.parentElement) sel.after(el);
    else ($('.site') || document.body).appendChild(el);

    if (spec.type === 'text' || spec.type === 'button') el.contentEditable = ed.editing() ? 'true' : 'false';
    ed.layers();
    ed.select(el);
    ed.push();
    ed.status(`Added ${spec.name}.`);
    return el;
  }

  function duplicateObject() {
    const sel = ed.selected();
    if (!sel) return ed.status('Select an object to duplicate.');
    if (sel.classList.contains('tile')) {
      if (typeof duplicateSelected === 'function') return duplicateSelected();
    }
    const copy = sel.cloneNode(true);
    // A duplicate must get its own identity, or both copies would share the
    // same generated CSS rule and every later edit would hit both (§8).
    const remap = el => {
      if (el.dataset && el.dataset.id) el.dataset.id = uid(el.dataset.type || 'node');
      [...(el.children || [])].forEach(remap);
    };
    remap(copy);
    copy.dataset.node = (sel.dataset.node || 'Object') + ' Copy';
    copy.classList.remove('selected');
    sel.after(copy);
    if (copy.classList.contains('tile')) { ed.bindTile(copy); ed.bindResize(copy); }
    ed.layers();
    ed.select(copy);
    ed.push();
    ed.status(`Duplicated ${sel.dataset.node || sel.dataset.id}.`);
    return copy;
  }

  // Structural containers get a confirmation because deleting one takes its
  // children with it; a text object does not (§8).
  const STRUCTURAL = ['section', 'container'];
  function deleteObject() {
    const sel = ed.selected();
    if (!sel) return ed.status('Select an object to delete.');
    if (sel.dataset.locked === '1') return ed.status(`"${sel.dataset.node || sel.dataset.id}" is locked. Unlock it in Layers first.`);
    const type = sel.dataset.type || 'object';
    const kids = $$('[data-node]', sel).length;
    if (STRUCTURAL.includes(type) && kids) {
      const ok = window.confirm(`Delete this ${type} and the ${kids} object(s) inside it?`);
      if (!ok) return ed.status('Delete cancelled.');
    }
    if (sel.classList.contains('tile') && typeof removeSelected === 'function') return removeSelected();
    const name = sel.dataset.node || sel.dataset.id;
    const next = sel.nextElementSibling || sel.previousElementSibling || null;
    sel.remove();
    ed.layers();
    if (next && next.dataset && next.dataset.node) ed.select(next);
    ed.push();
    ed.status(`Deleted ${name}.`);
  }

  function toggleHidden() {
    const sel = ed.selected();
    if (!sel) return ed.status('Select an object to hide or show.');
    const m = ed.model();
    const n = m && m.nodes && m.nodes[sel.dataset.id];
    if (!n) return ed.status('That object is not in the model yet. Make a change first.');
    n.visibility = n.visibility || {};
    n.visibility.hidden = !n.visibility.hidden;
    // Hidden is model state, so it persists through publish (§8).
    if (window.StudioModel) window.StudioModel.writeCSS(window.StudioModel.emitCSS(m));
    sel.classList.toggle('is-hidden', n.visibility.hidden);
    ed.layers();
    ed.push();
    ed.status(`${n.visibility.hidden ? 'Hidden' : 'Shown'}: ${n.name || sel.dataset.id}`);
  }

  function toggleLocked() {
    const sel = ed.selected();
    if (!sel) return ed.status('Select an object to lock or unlock.');
    const locked = sel.dataset.locked === '1';
    if (locked) delete sel.dataset.locked; else sel.dataset.locked = '1';
    const m = ed.model();
    const n = m && m.nodes && m.nodes[sel.dataset.id];
    if (n) { n.visibility = n.visibility || {}; n.visibility.locked = !locked; }
    ed.layers();
    ed.push();
    ed.status(`${!locked ? 'Locked' : 'Unlocked'}: ${sel.dataset.node || sel.dataset.id}`);
  }

  function renameObject(el, name) {
    if (!el || !name) return;
    el.dataset.node = name;                      // display name only
    const m = ed.model();                        // internal id is untouched (§8)
    const n = m && m.nodes && m.nodes[el.dataset.id];
    if (n) n.name = name;
    ed.layers();
    ed.push();
  }

  /* ---------------------------------------------------------- layer tree
   * Nested, following real DOM parentage rather than a flat list (§9).
   */
  const collapsed = new Set();

  const ICONS = {
    text: 'T', tile: '▧', hero: '▣', logo: '◇', button: '⬭',
    section: '▤', container: '▢', divider: '─', spacer: '␣', shape: '◆',
  };

  function treeRoots() {
    // A node is a root when no other [data-node] contains it.
    return $$('[data-node]').filter(el => !el.parentElement || !el.parentElement.closest('[data-node]'));
  }

  function renderTree() {
    const box = $('.layerbox');
    if (!box) return;
    box.innerHTML = '';

    const tools = document.createElement('div');
    tools.className = 'layer-tools';
    tools.innerHTML = `
      <select id="addKind" aria-label="Object type to add">
        <option value="heading">Heading</option>
        <option value="text">Text</option>
        <option value="button">Button</option>
        <option value="tile">Project tile</option>
        <option value="section">Section</option>
        <option value="container">Container</option>
        <option value="divider">Divider</option>
        <option value="spacer">Spacer</option>
        <option value="shape">Shape</option>
      </select>
      <button type="button" data-add-object title="Add the selected object type">＋ Add</button>
      <button type="button" data-dup-object title="Duplicate selection">Duplicate</button>
      <button type="button" data-del-object class="danger-lite" title="Delete selection">Delete</button>`;
    box.appendChild(tools);
    tools.querySelector('[data-add-object]').onclick = () => addObject($('#addKind').value);
    tools.querySelector('[data-dup-object]').onclick = duplicateObject;
    tools.querySelector('[data-del-object]').onclick = deleteObject;

    const m = ed.model();
    const sel = ed.selected();

    const row = (el, depth) => {
      const id = el.dataset.id;
      const n = m && m.nodes && m.nodes[id];
      const kids = $$('[data-node]', el).filter(k => k.parentElement.closest('[data-node]') === el);
      const d = document.createElement('div');
      d.className = 'layer' + (sel === el ? ' active' : '');
      d.dataset.id = id;
      d.style.setProperty('--depth', depth);
      d.draggable = true;

      const hidden = !!(n && n.visibility && n.visibility.hidden);
      const locked = el.dataset.locked === '1';
      const type = el.dataset.type || 'text';

      d.innerHTML = `
        ${kids.length ? `<button class="layer-twist" type="button" aria-label="Collapse or expand">${collapsed.has(id) ? '▸' : '▾'}</button>` : '<span class="layer-twist-spacer"></span>'}
        <span class="layer-icon" aria-hidden="true">${ICONS[type] || '•'}</span>
        <span class="layer-name" title="${(el.dataset.node || id).replace(/"/g, '&quot;')}">${el.dataset.node || id}</span>
        <button class="layer-btn" type="button" data-vis aria-label="${hidden ? 'Show' : 'Hide'} ${el.dataset.node || id}" aria-pressed="${hidden}">${hidden ? '◌' : '◉'}</button>
        <button class="layer-btn" type="button" data-lock aria-label="${locked ? 'Unlock' : 'Lock'} ${el.dataset.node || id}" aria-pressed="${locked}">${locked ? '🔒' : '🔓'}</button>`;

      d.addEventListener('click', e => {
        if (e.target.closest('button')) return;
        ed.select(el);
      });
      // Rename in place; the stable id never changes (§8/§9).
      d.querySelector('.layer-name').addEventListener('dblclick', e => {
        e.stopPropagation();
        const cur = el.dataset.node || id;
        const next = window.prompt('Layer name', cur);
        if (next && next !== cur) renameObject(el, next.slice(0, 80));
      });
      const twist = d.querySelector('.layer-twist');
      if (twist) twist.onclick = e => {
        e.stopPropagation();
        // Collapsing is view state only and must never touch content (§9).
        if (collapsed.has(id)) collapsed.delete(id); else collapsed.add(id);
        renderTree();
      };
      d.querySelector('[data-vis]').onclick = e => { e.stopPropagation(); ed.select(el); toggleHidden(); };
      d.querySelector('[data-lock]').onclick = e => { e.stopPropagation(); ed.select(el); toggleLocked(); };

      d.addEventListener('dragstart', e => { dragId = id; d.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; });
      d.addEventListener('dragend', () => { dragId = null; d.classList.remove('dragging'); });
      d.addEventListener('dragover', e => { if (dragId && dragId !== id) { e.preventDefault(); d.classList.add('drop-target'); } });
      d.addEventListener('dragleave', () => d.classList.remove('drop-target'));
      d.addEventListener('drop', e => {
        e.preventDefault();
        d.classList.remove('drop-target');
        if (!dragId || dragId === id) return;
        reorder(dragId, id);
      });

      box.appendChild(d);
      if (!collapsed.has(id)) kids.forEach(k => row(k, depth + 1));
    };

    treeRoots().forEach(el => row(el, 0));
    enhanceAllResize();
  }

  let dragId = null;

  function reorder(fromId, toId) {
    const a = $(`[data-id="${fromId}"]`), b = $(`[data-id="${toId}"]`);
    if (!a || !b || a === b || a.contains(b)) {
      return ed.status('Cannot drop an object inside itself.');
    }
    if (a.dataset.locked === '1') return ed.status(`"${a.dataset.node || fromId}" is locked.`);
    // Dropping onto a container nests; dropping onto a sibling reorders.
    if (['container', 'section'].includes(b.dataset.type)) b.appendChild(a);
    else b.parentElement.insertBefore(a, b);
    ed.layers();
    ed.observe();
    ed.push();                                   // one atomic history entry (§27)
    ed.status(`Moved ${a.dataset.node || fromId}.`);
  }


  /* ------------------------------------------------- resize, snap, guides
   * Takes over the resize handle for three reasons.
   *
   * 1. The original handle wrote --h and --span as inline styles and left them
   *    there. Inline props are read back by fromDOM ahead of the model, so a
   *    later height change in the inspector was not merely shadowed — it was
   *    overwritten on the next read and lost. Values are now committed to the
   *    model and the inline props cleared.
   * 2. Snap was a toggle with nothing behind it. It now snaps height to a step
   *    and to nearby sibling edges, and does nothing at all when off.
   * 3. Guides were static decoration. They now appear only while dragging,
   *    where an edge actually lines up with a neighbour.
   */
  const SNAP_STEP = 8;
  const SNAP_TOLERANCE = 6;

  function guideLayer() {
    let g = $('#snapGuides');
    if (!g) {
      g = document.createElement('div');
      g.id = 'snapGuides';
      g.setAttribute('aria-hidden', 'true');
      document.body.appendChild(g);
    }
    return g;
  }
  function showGuides(lines) {
    const g = guideLayer();
    if (!shell.view.guides || !lines.length) { g.innerHTML = ''; return; }
    g.innerHTML = lines.map(l => l.axis === 'y'
      ? `<i class="snap-guide snap-h" style="top:${l.at}px"></i>`
      : `<i class="snap-guide snap-v" style="left:${l.at}px"></i>`).join('');
  }
  function hideGuides() { const g = $('#snapGuides'); if (g) g.innerHTML = ''; }

  // Candidate edges from the other tiles, in viewport coordinates.
  function siblingEdges(tile) {
    const out = { y: [], x: [] };
    for (const other of $$('.grid .tile')) {
      if (other === tile) continue;
      const r = other.getBoundingClientRect();
      out.y.push(r.top, r.bottom);
      out.x.push(r.left, r.right);
    }
    return out;
  }

  function enhanceResize(tile) {
    const old = tile.querySelector(':scope > .resize');
    if (!old || old.dataset.shellBound === '1') return;
    // Replacing the node drops the original listener, which cannot be detached.
    const h = old.cloneNode(true);
    old.replaceWith(h);
    h.dataset.shellBound = '1';

    h.addEventListener('pointerdown', e => {
      if (!ed.editing() || shell.previewing) return;
      if (tile.dataset.locked === '1') { ed.status(`"${tile.dataset.node || tile.dataset.id}" is locked. Unlock it in Layers to resize it.`); return; }
      e.stopPropagation();
      e.preventDefault();

      const startY = e.clientY, startX = e.clientX;
      const rect = tile.getBoundingClientRect();
      const grid = tile.parentElement.getBoundingClientRect();
      const col = grid.width / 12;
      const edges = siblingEdges(tile);
      let height = rect.height, span = Math.round(rect.width / col);

      try { h.setPointerCapture(e.pointerId); } catch { /* capture is best effort */ }

      const move = q => {
        let raw = rect.height + (q.clientY - startY);
        const lines = [];

        if (shell.view.snap) {
          // Prefer a sibling edge when one is close, else fall back to the step.
          const bottom = rect.top + raw;
          let snapped = null;
          for (const y of edges.y) {
            if (Math.abs(bottom - y) <= SNAP_TOLERANCE) { snapped = y; break; }
          }
          if (snapped !== null) { raw = snapped - rect.top; lines.push({ axis: 'y', at: snapped }); }
          else raw = Math.round(raw / SNAP_STEP) * SNAP_STEP;
        }

        height = Math.max(120, Math.min(1200, Math.round(raw)));
        span = Math.max(1, Math.min(12, Math.round((rect.width + (q.clientX - startX)) / col)));

        // Live feedback stays inline: this is ephemera, rewritten every frame,
        // and it is cleared on commit.
        tile.style.setProperty('--h', height + 'px');
        tile.style.setProperty('--span', String(span));

        if (shell.view.guides) {
          const now = tile.getBoundingClientRect();
          for (const x of edges.x) if (Math.abs(now.right - x) <= SNAP_TOLERANCE) lines.push({ axis: 'x', at: x });
          showGuides(lines);
        }
      };

      const up = () => {
        h.removeEventListener('pointermove', move);
        h.removeEventListener('pointerup', up);
        h.removeEventListener('pointercancel', up);
        hideGuides();

        // Commit to the model, then clear the inline props so the generated
        // stylesheet is authoritative again.
        const m = ed.model();
        const t = writeTarget();
        if (m && m.nodes && m.nodes[tile.dataset.id] && window.StudioModel) {
          window.StudioModel.setProp(m, tile.dataset.id, 'tileHeight', height, t.state, t.breakpoint);
          window.StudioModel.setProp(m, tile.dataset.id, 'span', span, t.state, t.breakpoint);
          tile.style.removeProperty('--h');
          tile.style.removeProperty('--span');
          if (!tile.getAttribute('style')) tile.removeAttribute('style');
          window.StudioModel.writeCSS(window.StudioModel.emitCSS(m));
        }
        if (window.StudioInspector) window.StudioInspector.syncFromModel();
        ed.push();
        ed.status(`${tile.dataset.node || tile.dataset.id}: ${span}/12 columns, ${height}px${shell.view.snap ? ' (snapped)' : ''}`);
      };

      h.addEventListener('pointermove', move);
      h.addEventListener('pointerup', up);
      h.addEventListener('pointercancel', up);
    });
  }

  function enhanceAllResize() { $$('.grid .tile').forEach(enhanceResize); }

  /* -------------------------------------------------------------- toolbar */
  function buildToolbar() {
    const bar = $('.devbar');
    if (!bar || $('#shellTools')) return;

    const wrap = document.createElement('div');
    wrap.id = 'shellTools';
    wrap.className = 'shell-tools';
    wrap.innerHTML = `
      <button type="button" data-preview aria-pressed="false" title="Hide all editor chrome">Preview</button>
      <div class="seg" role="group" aria-label="Viewport">
        ${Object.entries(VIEWPORTS).map(([k, v]) =>
          `<button type="button" data-viewport-btn="${k}" aria-pressed="${k === 'desktop'}" class="${k === 'desktop' ? 'active' : ''}" title="${v.width ? 'Edit overrides below ' + v.width + 'px' : 'Edit desktop values'}">${v.label}</button>`).join('')}
      </div>
      <details class="view-menu">
        <summary title="Canvas guides and outlines">View</summary>
        <div class="view-pop">
          ${Object.entries(VIEW_FLAGS).map(([k, v]) =>
            `<label class="check"><input type="checkbox" data-view="${k}" ${v.on ? 'checked' : ''}>${v.label}</label>`).join('')}
          <p class="editor-note">These affect the editor canvas only. They are never saved to the site.</p>
        </div>
      </details>`;
    bar.appendChild(wrap);

    wrap.querySelector('[data-preview]').onclick = () => setPreview(!shell.previewing);
    $$('[data-viewport-btn]', wrap).forEach(b => { b.onclick = () => setViewport(b.dataset.viewportBtn); });
    $$('[data-view]', wrap).forEach(i => { i.onchange = () => setView(i.dataset.view, i.checked); });
  }

  function buildStateBar() {
    const host = $('.tab-panel[data-tab="design"]');
    if (!host || $('#statePanel')) return;
    const p = document.createElement('div');
    p.className = 'panel';
    p.id = 'statePanel';
    p.innerHTML = `
      <h4>Interaction state</h4>
      <div class="seg" role="group" aria-label="Editing state">
        ${['base', 'hover', 'pressed'].map(s =>
          `<button type="button" data-state-btn="${s}" aria-pressed="${s === 'base'}" class="${s === 'base' ? 'active' : ''}">${s[0].toUpperCase() + s.slice(1)}</button>`).join('')}
      </div>
      <p class="editor-note" id="stateHint">Editing the base state.</p>
      <p class="editor-note" id="viewportHint">Editing desktop values.</p>`;
    host.prepend(p);
    $$('[data-state-btn]', p).forEach(b => { b.onclick = () => setEditState(b.dataset.stateBtn); });
  }

  /* ------------------------------------------------------------ keyboard */
  function bindKeys() {
    window.addEventListener('keydown', e => {
      if (e.key === 'Escape' && shell.previewing) { setPreview(false); return; }
      if (!ed.editing() || shell.previewing) return;
      const t = e.target;
      // Never steal keys from a field or from text being edited.
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      if (e.key === 'p' && !e.metaKey && !e.ctrlKey) { setPreview(true); }
      if ((e.key === 'Delete' || e.key === 'Backspace') && ed.selected()) { e.preventDefault(); deleteObject(); }
      if (e.key === 'd' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); duplicateObject(); }
      if (e.key === 'h' && !e.metaKey && !e.ctrlKey) { toggleHidden(); }
      if (e.key === 'l' && !e.metaKey && !e.ctrlKey) { toggleLocked(); }
    });
  }


  /* ------------------------------------------------------- texture panel
   * Texture is available on the page background and on a selected object, and
   * every control here maps to a real property in the model (§24).
   */
  function buildTexturePanel() {
    const host = $('.tab-panel[data-tab="motion"]');
    if (!host || $('#texturePanel') || !window.StudioTexture) return;
    const T = window.StudioTexture;
    const p = document.createElement('div');
    p.className = 'panel';
    p.id = 'texturePanel';
    p.innerHTML = `
      <h4>Texture / grain</h4>
      <div class="seg" role="group" aria-label="Texture target">
        <button type="button" data-tex-target="site" class="active" aria-pressed="true">Page</button>
        <button type="button" data-tex-target="object" aria-pressed="false">Selected object</button>
      </div>
      <label class="check"><input id="texEnabled" type="checkbox">Enable texture</label>
      <div class="ctrl"><label>Source</label><select id="texPreset">${Object.entries(T.PRESETS).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('')}</select></div>
      <div class="ctrl"><label>Motion</label><select id="texMode">${Object.entries(T.MODES).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('')}</select></div>
      <div class="ctrl"><label>Strength</label><input id="texOpacity" type="range" min="0" max="42" step="1"></div>
      <div class="ctrl"><label>Scale</label><input id="texScale" type="range" min="40" max="600" step="10"></div>
      <div class="ctrl"><label>Speed</label><input id="texSpeed" type="range" min="0.1" max="4" step="0.1"></div>
      <div class="ctrl"><label>Angle</label><input id="texAngle" type="range" min="0" max="360" step="5"></div>
      <div class="ctrl"><label>Distance</label><input id="texAmp" type="range" min="2" max="60" step="1"></div>
      <div class="ctrl"><label>Blend</label><select id="texBlend">
        <option>overlay</option><option>soft-light</option><option>multiply</option><option>screen</option><option>normal</option></select></div>
      <label class="check"><input id="texAlternate" type="checkbox">Reverse on alternate loops</label>
      <p class="editor-note" id="texNote"></p>`;
    host.appendChild(p);

    let texTarget = 'site';
    const readCfg = () => ({
      enabled: $('#texEnabled').checked,
      preset: $('#texPreset').value,
      mode: $('#texMode').value,
      opacity: Number($('#texOpacity').value) / 100,
      scale: Number($('#texScale').value),
      speed: Number($('#texSpeed').value),
      angle: Number($('#texAngle').value),
      amplitude: Number($('#texAmp').value),
      blend: $('#texBlend').value,
      alternate: $('#texAlternate').checked,
    });

    function note(msg) { const n = $('#texNote'); if (n) n.textContent = msg; }

    function commit() {
      const m = ed.model();
      if (!m) return;
      const cfg = readCfg();
      if (texTarget === 'site') {
        m.site = m.site || {};
        m.site.texture = cfg;
        window.StudioTexture.apply($('.site'), cfg);
      } else {
        const sel = ed.selected();
        if (!sel) return note('Select an object first, or switch the target back to Page.');
        const n = m.nodes && m.nodes[sel.dataset.id];
        if (!n) return note('That object is not in the model yet.');
        n.texture = cfg;
        window.StudioTexture.apply(sel, cfg);
      }
      window.StudioTexture.syncModel(m);
      ed.push();
      // Say plainly when the OS is suppressing the motion, so a "broken"
      // animation is never a mystery (§29).
      note(cfg.enabled && cfg.mode !== 'static' && window.StudioTexture.reducedMotion()
        ? 'Texture applied. Motion is paused because this system prefers reduced motion.'
        : cfg.enabled ? 'Texture applied.' : 'Texture off.');
    }

    function loadInto() {
      const m = ed.model();
      const T2 = window.StudioTexture.DEFAULTS;
      let cfg = T2;
      if (texTarget === 'site') cfg = { ...T2, ...((m && m.site && m.site.texture) || {}) };
      else {
        const sel = ed.selected();
        const n = sel && m && m.nodes && m.nodes[sel.dataset.id];
        cfg = { ...T2, ...((n && n.texture) || {}) };
      }
      $('#texEnabled').checked = !!cfg.enabled;
      $('#texPreset').value = cfg.preset;
      $('#texMode').value = cfg.mode;
      $('#texOpacity').value = Math.round((cfg.opacity || 0) * 100);
      $('#texScale').value = cfg.scale;
      $('#texSpeed').value = cfg.speed;
      $('#texAngle').value = cfg.angle;
      $('#texAmp').value = cfg.amplitude;
      $('#texBlend').value = cfg.blend;
      $('#texAlternate').checked = !!cfg.alternate;
    }

    $$('[data-tex-target]', p).forEach(b => {
      b.onclick = () => {
        texTarget = b.dataset.texTarget;
        $$('[data-tex-target]', p).forEach(x => {
          const on = x === b;
          x.classList.toggle('active', on);
          x.setAttribute('aria-pressed', String(on));
        });
        loadInto();
        note(texTarget === 'object' && !ed.selected() ? 'No object selected yet.' : '');
      };
    });
    ['texEnabled', 'texPreset', 'texMode', 'texOpacity', 'texScale', 'texSpeed', 'texAngle', 'texAmp', 'texBlend', 'texAlternate']
      .forEach(id => {
        const el = $('#' + id);
        if (!el) return;
        el.addEventListener(el.tagName === 'SELECT' || el.type === 'checkbox' ? 'change' : 'input', commit);
      });
    loadInto();
    window.StudioShell.reloadTexturePanel = loadInto;
  }


  /* --------------------------------------------------- background panel
   * §14/§15. Target is the page or the selected object. Gradient stops are
   * editable rows, not a preset-only dropdown, and presets load INTO the
   * editor so they stay adjustable afterwards.
   */
  function buildBackgroundPanel() {
    const host = $('.tab-panel[data-tab="design"]');
    if (!host || $('#backgroundPanel2') || !window.StudioBackground) return;
    const B = window.StudioBackground;
    const p = document.createElement('div');
    p.className = 'panel';
    p.id = 'backgroundPanel2';
    p.innerHTML = `
      <h4>Background</h4>
      <div class="seg" role="group" aria-label="Background target">
        <button type="button" data-bg-target="site" class="active" aria-pressed="true">Page</button>
        <button type="button" data-bg-target="object" aria-pressed="false">Selected object</button>
      </div>
      <div class="ctrl"><label>Mode</label><select id="bgMode">
        ${B.MODES.map(m => `<option value="${m}">${m[0].toUpperCase() + m.slice(1)}</option>`).join('')}
      </select></div>

      <div id="bgSolidBox" hidden>
        <div class="ctrl"><label>Colour</label><input id="bgSolidColor" type="color" value="#10120f"></div>
      </div>

      <div id="bgGradientBox" hidden>
        <div class="ctrl"><label>Preset</label><select id="bgPreset">
          <option value="">Choose a preset…</option>
          ${B.GRADIENT_PRESETS.map((g, i) => `<option value="${i}">${g.name}</option>`).join('')}
        </select></div>
        <div class="ctrl"><label>Type</label><select id="bgGradType"><option value="linear">Linear</option><option value="radial">Radial</option></select></div>
        <div class="ctrl" id="bgAngleCtrl"><label>Angle</label><input id="bgGradAngle" type="range" min="0" max="360" step="5"></div>
        <div class="ctrl" id="bgRadialXCtrl" hidden><label>Centre X</label><input id="bgGradX" type="range" min="0" max="100"></div>
        <div class="ctrl" id="bgRadialYCtrl" hidden><label>Centre Y</label><input id="bgGradY" type="range" min="0" max="100"></div>
        <div class="ctrl"><label>Opacity</label><input id="bgGradOpacity" type="range" min="0" max="100"></div>
        <label class="check"><input id="bgGradReverse" type="checkbox">Reverse</label>
        <div class="stops-head"><span>Stops</span><button type="button" id="bgAddStop" title="Add a stop">＋</button></div>
        <div id="bgStops" class="stops"></div>
        <div class="bg-preview" id="bgPreview" aria-hidden="true"></div>
      </div>

      <div id="bgImageBox" hidden>
        <div class="ctrl stack"><label>Image URL</label><input id="bgImgSrc" type="url" placeholder="/media/... or https://..."></div>
        <p class="editor-note">Pick an upload from the Image library below and press Use as background.</p>
        <button type="button" id="bgUseAsset">Use selected library asset</button>
        <div class="ctrl"><label>Fit</label><select id="bgImgFit"><option>cover</option><option>contain</option><option value="auto">original</option></select></div>
        <div class="ctrl"><label>Crop X</label><input id="bgImgX" type="range" min="0" max="100"></div>
        <div class="ctrl"><label>Crop Y</label><input id="bgImgY" type="range" min="0" max="100"></div>
        <div class="ctrl"><label>Zoom</label><input id="bgImgZoom" type="range" min="0.4" max="3" step="0.05"></div>
        <div class="ctrl"><label>Opacity</label><input id="bgImgOpacity" type="range" min="0" max="100"></div>
        <div class="ctrl"><label>Blur</label><input id="bgImgBlur" type="range" min="0" max="30" step="0.5"></div>
        <div class="ctrl"><label>Attachment</label><select id="bgImgAttach"><option value="scroll">Scroll</option><option value="fixed">Fixed</option><option value="parallax">Parallax</option></select></div>
      </div>

      <label class="check" id="bgOverlayToggleWrap"><input id="bgOverlayOn" type="checkbox">Gradient overlay on top</label>
      <div class="ctrl" id="bgOverlayCtrl" hidden><label>Overlay preset</label><select id="bgOverlayPreset">
        ${B.GRADIENT_PRESETS.map((g, i) => `<option value="${i}">${g.name}</option>`).join('')}
      </select></div>
      <p class="editor-note" id="bgNote"></p>`;
    host.appendChild(p);

    let bgTarget = 'site';
    const note = m => { const n = $('#bgNote'); if (n) n.textContent = m || ''; };

    function readBG() {
      const m = ed.model();
      if (bgTarget === 'site') return (m && m.site && m.site.background) || { mode: 'none' };
      const sel = ed.selected();
      const n = sel && m && m.nodes && m.nodes[sel.dataset.id];
      return (n && n.states && n.states.base && n.states.base.background) || { mode: 'none' };
    }

    function writeBG(bg) {
      const m = ed.model();
      if (!m) return;
      if (bgTarget === 'site') {
        m.site = m.site || {};
        m.site.background = bg;
      } else {
        const sel = ed.selected();
        if (!sel) return note('Select an object first, or switch the target back to Page.');
        const n = m.nodes && m.nodes[sel.dataset.id];
        if (!n) return note('That object is not in the model yet.');
        // Background lives in the base state so it can be overridden later.
        window.StudioModel.setProp(m, sel.dataset.id, 'background', bg, 'base');
      }
      window.StudioModel.writeCSS(window.StudioModel.emitCSS(m));
      window.StudioBackground.applyFromModel(m);
      ed.push();
      note(bg.mode === 'none' ? 'Background cleared.' : `${bg.mode[0].toUpperCase() + bg.mode.slice(1)} background applied to ${bgTarget === 'site' ? 'the page' : (ed.selected()?.dataset.node || 'the object')}.`);
    }

    function renderStops(bg) {
      const box = $('#bgStops');
      if (!box) return;
      const g = bg.gradient || window.StudioBackground.DEFAULT_GRADIENT();
      box.innerHTML = '';
      g.stops.forEach((st, i) => {
        const row = document.createElement('div');
        row.className = 'stop-row';
        row.innerHTML = `
          <input type="color" value="${/^#/.test(st.color) ? st.color : '#000000'}" aria-label="Stop ${i + 1} colour">
          <input type="range" min="0" max="100" value="${Number(st.at)}" aria-label="Stop ${i + 1} position">
          <span class="stop-pct">${Math.round(Number(st.at))}%</span>
          <button type="button" class="danger-lite" aria-label="Remove stop ${i + 1}" ${g.stops.length <= 2 ? 'disabled title="A gradient needs at least two stops"' : ''}>−</button>`;
        const [colorEl, posEl, pctEl, delEl] = [row.children[0], row.children[1], row.children[2], row.children[3]];
        colorEl.addEventListener('input', () => { g.stops[i].color = colorEl.value; bg.gradient = g; writeBG(bg); paintPreview(bg); });
        posEl.addEventListener('input', () => { g.stops[i].at = Number(posEl.value); pctEl.textContent = posEl.value + '%'; bg.gradient = g; writeBG(bg); paintPreview(bg); });
        delEl.addEventListener('click', () => {
          if (g.stops.length <= 2) return note('A gradient needs at least two stops.');
          g.stops.splice(i, 1); bg.gradient = g; writeBG(bg); renderStops(bg); paintPreview(bg);
        });
        box.appendChild(row);
      });
    }

    function paintPreview(bg) {
      const pv = $('#bgPreview');
      if (!pv) return;
      const css = window.StudioBackground.gradientCSS(bg.gradient);
      pv.style.backgroundImage = css || 'none';
      pv.style.opacity = String(bg.gradient && bg.gradient.opacity !== undefined ? bg.gradient.opacity : 1);
    }

    function showBoxes(mode) {
      $('#bgSolidBox').hidden = mode !== 'solid';
      $('#bgGradientBox').hidden = mode !== 'gradient';
      $('#bgImageBox').hidden = mode !== 'image';
      $('#bgOverlayToggleWrap').hidden = !(mode === 'image' || mode === 'gradient');
      const radial = $('#bgGradType') && $('#bgGradType').value === 'radial';
      if ($('#bgAngleCtrl')) $('#bgAngleCtrl').hidden = radial;
      if ($('#bgRadialXCtrl')) $('#bgRadialXCtrl').hidden = !radial;
      if ($('#bgRadialYCtrl')) $('#bgRadialYCtrl').hidden = !radial;
    }

    function loadInto() {
      const bg = JSON.parse(JSON.stringify(readBG()));
      $('#bgMode').value = bg.mode || 'none';
      if (bg.mode === 'solid') $('#bgSolidColor').value = /^#/.test(bg.color || '') ? bg.color : '#10120f';
      const g = bg.gradient || window.StudioBackground.DEFAULT_GRADIENT();
      $('#bgGradType').value = g.type || 'linear';
      $('#bgGradAngle').value = g.angle !== undefined ? g.angle : 180;
      $('#bgGradX').value = g.x !== undefined ? g.x : 50;
      $('#bgGradY').value = g.y !== undefined ? g.y : 50;
      $('#bgGradOpacity').value = Math.round((g.opacity !== undefined ? g.opacity : 1) * 100);
      $('#bgGradReverse').checked = !!g.reverse;
      const im = bg.image || window.StudioBackground.DEFAULT_IMAGE();
      $('#bgImgSrc').value = im.src || '';
      $('#bgImgFit').value = im.fit || 'cover';
      $('#bgImgX').value = im.x !== undefined ? im.x : 50;
      $('#bgImgY').value = im.y !== undefined ? im.y : 50;
      $('#bgImgZoom').value = im.zoom !== undefined ? im.zoom : 1;
      $('#bgImgOpacity').value = Math.round((im.opacity !== undefined ? im.opacity : 1) * 100);
      $('#bgImgBlur').value = im.blur || 0;
      $('#bgImgAttach').value = im.attachment || 'scroll';
      $('#bgOverlayOn').checked = !!bg.overlay;
      if ($('#bgOverlayCtrl')) $('#bgOverlayCtrl').hidden = !bg.overlay;
      showBoxes(bg.mode || 'none');
      renderStops(bg);
      paintPreview(bg);
    }

    function collect() {
      const bg = JSON.parse(JSON.stringify(readBG()));
      bg.mode = $('#bgMode').value;
      if (bg.mode === 'solid') bg.color = $('#bgSolidColor').value;
      const g = bg.gradient || window.StudioBackground.DEFAULT_GRADIENT();
      g.type = $('#bgGradType').value;
      g.angle = Number($('#bgGradAngle').value);
      g.x = Number($('#bgGradX').value);
      g.y = Number($('#bgGradY').value);
      g.opacity = Number($('#bgGradOpacity').value) / 100;
      g.reverse = $('#bgGradReverse').checked;
      bg.gradient = g;
      const im = bg.image || window.StudioBackground.DEFAULT_IMAGE();
      im.src = $('#bgImgSrc').value.trim();
      im.fit = $('#bgImgFit').value;
      im.x = Number($('#bgImgX').value);
      im.y = Number($('#bgImgY').value);
      im.zoom = Number($('#bgImgZoom').value);
      im.opacity = Number($('#bgImgOpacity').value) / 100;
      im.blur = Number($('#bgImgBlur').value);
      im.attachment = $('#bgImgAttach').value;
      bg.image = im;
      if ($('#bgOverlayOn').checked) {
        const idx = Number($('#bgOverlayPreset').value) || 0;
        const src = window.StudioBackground.GRADIENT_PRESETS[idx];
        bg.overlay = JSON.parse(JSON.stringify(src));
      } else delete bg.overlay;
      return bg;
    }

    const commit = () => { const bg = collect(); showBoxes(bg.mode); writeBG(bg); paintPreview(bg); };

    $$('[data-bg-target]', p).forEach(b => {
      b.onclick = () => {
        bgTarget = b.dataset.bgTarget;
        $$('[data-bg-target]', p).forEach(x => {
          const on = x === b;
          x.classList.toggle('active', on);
          x.setAttribute('aria-pressed', String(on));
        });
        loadInto();
        note(bgTarget === 'object' && !ed.selected() ? 'No object selected yet.' : '');
      };
    });

    ['bgMode', 'bgSolidColor', 'bgGradType', 'bgGradAngle', 'bgGradX', 'bgGradY', 'bgGradOpacity',
     'bgGradReverse', 'bgImgSrc', 'bgImgFit', 'bgImgX', 'bgImgY', 'bgImgZoom', 'bgImgOpacity',
     'bgImgBlur', 'bgImgAttach', 'bgOverlayOn', 'bgOverlayPreset'].forEach(id => {
      const el = $('#' + id);
      if (!el) return;
      el.addEventListener(el.tagName === 'SELECT' || el.type === 'checkbox' ? 'change' : 'input', commit);
    });

    // A preset loads into the editable stop list, so it stays adjustable (§15).
    $('#bgPreset').addEventListener('change', e => {
      const idx = e.target.value;
      if (idx === '') return;
      const src = window.StudioBackground.GRADIENT_PRESETS[Number(idx)];
      const bg = collect();
      bg.mode = 'gradient';
      bg.gradient = { ...window.StudioBackground.DEFAULT_GRADIENT(), ...JSON.parse(JSON.stringify(src)) };
      $('#bgMode').value = 'gradient';
      loadIntoFrom(bg);
      writeBG(bg);
      note(`Loaded "${src.name}". The stops below are now editable.`);
      e.target.value = '';
    });

    function loadIntoFrom(bg) {
      $('#bgGradType').value = bg.gradient.type || 'linear';
      $('#bgGradAngle').value = bg.gradient.angle !== undefined ? bg.gradient.angle : 180;
      $('#bgGradOpacity').value = Math.round((bg.gradient.opacity !== undefined ? bg.gradient.opacity : 1) * 100);
      $('#bgGradReverse').checked = !!bg.gradient.reverse;
      showBoxes('gradient');
      renderStops(bg);
      paintPreview(bg);
    }

    $('#bgAddStop').addEventListener('click', () => {
      const bg = collect();
      const g = bg.gradient;
      if (g.stops.length >= 8) return note('Eight stops is the practical limit.');
      const last = g.stops[g.stops.length - 1];
      const prev = g.stops[g.stops.length - 2] || { at: 0 };
      g.stops.push({ color: last.color, at: Math.min(100, Math.round((Number(last.at) + Number(prev.at)) / 2) + 10) });
      bg.gradient = g;
      writeBG(bg); renderStops(bg); paintPreview(bg);
    });

    $('#bgUseAsset').addEventListener('click', () => {
      const assets = (window.StudioAssets && window.StudioAssets.state.assets) || [];
      if (!assets.length) return note('No uploads in the library yet. Upload an image first.');
      $('#bgImgSrc').value = assets[0].url;
      $('#bgMode').value = 'image';
      commit();
      note(`Using ${assets[0].filename || assets[0].key} as the background.`);
    });

    loadInto();
    window.StudioShell.reloadBackgroundPanel = loadInto;
  }

  /* Alt text for meaningful portfolio images (§16/§34). */
  function buildAltTextControl() {
    const host = $('#projectMediaPanel') || $('.tab-panel[data-tab="design"]');
    if (!host || $('#imgAlt')) return;
    const wrap = document.createElement('div');
    wrap.className = 'ctrl stack';
    wrap.innerHTML = '<label for="imgAlt">Image alt text</label><input id="imgAlt" type="text" placeholder="Describe the artwork for screen readers">';
    host.appendChild(wrap);
    const input = $('#imgAlt');
    input.addEventListener('input', () => {
      const sel = ed.selected();
      if (!sel) return ed.status('Select a tile to set its alt text.');
      const img = sel.querySelector && sel.querySelector('img');
      if (!img) return ed.status('That object has no image yet, so alt text would describe nothing.');
      img.alt = input.value;
      const m = ed.model();
      const n = m && m.nodes && m.nodes[sel.dataset.id];
      if (n) { n.content = n.content || {}; n.content.alt = input.value; }
      ed.push();
    });
    window.StudioShell.syncAltText = () => {
      const sel = ed.selected();
      const img = sel && sel.querySelector && sel.querySelector('img');
      input.value = img ? (img.getAttribute('alt') || '') : '';
      input.disabled = !img;
      input.placeholder = img ? 'Describe the artwork for screen readers' : 'Add an image first';
    };
    window.StudioShell.syncAltText();
  }


  /* ------------------------------------------------------- effects panel
   * §25. One reliable instance per effect type, each behind its own enable
   * toggle so a disabled effect contributes nothing rather than a zero-value
   * shadow that still costs a paint.
   */
  function buildEffectsPanel() {
    const host = $('.tab-panel[data-tab="design"]');
    if (!host || $('#effectsPanel')) return;
    const p = document.createElement('div');
    p.className = 'panel';
    p.id = 'effectsPanel';
    p.dataset.for = 'tile,text,hero,logo,button,shape,container,section';
    p.innerHTML = `
      <h4>Effects</h4>
      <label class="check"><input id="fxShadowOn" type="checkbox">Drop shadow</label>
      <div class="ctrl"><label>Offset Y</label><input id="fxShadowY" type="range" min="-40" max="60"></div>
      <div class="ctrl"><label>Blur</label><input id="fxShadowBlur" type="range" min="0" max="90"></div>
      <div class="ctrl"><label>Spread</label><input id="fxShadowSpread" type="range" min="-20" max="40"></div>
      <div class="ctrl"><label>Colour</label><input id="fxShadowColor" type="color" value="#000000"></div>
      <label class="check"><input id="fxInnerOn" type="checkbox">Inner shadow</label>
      <div class="ctrl"><label>Inner blur</label><input id="fxInnerBlur" type="range" min="0" max="60"></div>
      <label class="check"><input id="fxGlowOn" type="checkbox">Glow</label>
      <div class="ctrl"><label>Glow size</label><input id="fxGlowSize" type="range" min="0" max="80"></div>
      <div class="ctrl"><label>Glow colour</label><input id="fxGlowColor" type="color" value="#bdd657"></div>
      <div class="ctrl"><label>Backdrop blur</label><input id="fxBackdrop" type="range" min="0" max="30" step="0.5"></div>
      <div class="ctrl"><label>Blend mode</label><select id="fxBlend">
        <option>normal</option><option>multiply</option><option>screen</option><option>overlay</option>
        <option>soft-light</option><option>hard-light</option><option>difference</option><option>luminosity</option>
      </select></div>
      <p class="editor-note" id="fxNote">Effects apply to the state you are editing.</p>`;
    host.appendChild(p);

    const IDS = ['fxShadowOn','fxShadowY','fxShadowBlur','fxShadowSpread','fxShadowColor',
                 'fxInnerOn','fxInnerBlur','fxGlowOn','fxGlowSize','fxGlowColor','fxBackdrop','fxBlend'];

    function collect() {
      return {
        shadow: { enabled: $('#fxShadowOn').checked, x: 0, y: Number($('#fxShadowY').value),
                  blur: Number($('#fxShadowBlur').value), spread: Number($('#fxShadowSpread').value),
                  color: $('#fxShadowColor').value },
        innerShadow: { enabled: $('#fxInnerOn').checked, x: 0, y: 4, blur: Number($('#fxInnerBlur').value), spread: 0, color: 'rgba(0,0,0,.5)' },
        glow: { enabled: $('#fxGlowOn').checked, size: Number($('#fxGlowSize').value), spread: 0, color: $('#fxGlowColor').value },
        backdropBlur: Number($('#fxBackdrop').value),
        blend: $('#fxBlend').value,
      };
    }

    function reflectDependencies() {
      const dep = [['fxShadowOn', ['fxShadowY','fxShadowBlur','fxShadowSpread','fxShadowColor'], 'Enable Drop shadow first.'],
                   ['fxInnerOn', ['fxInnerBlur'], 'Enable Inner shadow first.'],
                   ['fxGlowOn', ['fxGlowSize','fxGlowColor'], 'Enable Glow first.']];
      for (const [toggle, deps, why] of dep) {
        const on = $('#' + toggle) && $('#' + toggle).checked;
        for (const id of deps) {
          const el = $('#' + id);
          if (!el) continue;
          el.disabled = !on;
          const field = el.closest('.ctrl');
          if (field) {
            field.classList.toggle('is-disabled', !on);
            const lbl = field.querySelector('label');
            if (lbl) lbl.title = on ? '' : why;
          }
        }
      }
    }

    function commit() {
      const sel = ed.selected();
      if (!sel) { $('#fxNote').textContent = 'Select an object first.'; return; }
      const m = ed.model();
      const t = window.StudioShell.writeTarget();
      window.StudioModel.setProp(m, sel.dataset.id, 'effects', collect(), t.state, t.breakpoint);
      window.StudioModel.writeCSS(window.StudioModel.emitCSS(m));
      reflectDependencies();
      ed.push();
      $('#fxNote').textContent = `Effects applied to ${t.breakpoint || t.state} on ${sel.dataset.node || sel.dataset.id}.`;
    }

    IDS.forEach(id => {
      const el = $('#' + id);
      if (!el) return;
      el.addEventListener(el.tagName === 'SELECT' || el.type === 'checkbox' ? 'change' : 'input', commit);
    });

    window.StudioShell.syncEffects = () => {
      const sel = ed.selected();
      if (!sel) return;
      const m = ed.model();
      const t = window.StudioShell.writeTarget();
      const fx = window.StudioModel.getProp(m, sel.dataset.id, 'effects', t.state, t.breakpoint) || {};
      $('#fxShadowOn').checked = !!(fx.shadow && fx.shadow.enabled);
      $('#fxShadowY').value = (fx.shadow && fx.shadow.y) || 12;
      $('#fxShadowBlur').value = (fx.shadow && fx.shadow.blur) || 30;
      $('#fxShadowSpread').value = (fx.shadow && fx.shadow.spread) || 0;
      if (fx.shadow && /^#/.test(fx.shadow.color || '')) $('#fxShadowColor').value = fx.shadow.color;
      $('#fxInnerOn').checked = !!(fx.innerShadow && fx.innerShadow.enabled);
      $('#fxInnerBlur').value = (fx.innerShadow && fx.innerShadow.blur) || 18;
      $('#fxGlowOn').checked = !!(fx.glow && fx.glow.enabled);
      $('#fxGlowSize').value = (fx.glow && fx.glow.size) || 28;
      if (fx.glow && /^#/.test(fx.glow.color || '')) $('#fxGlowColor').value = fx.glow.color;
      $('#fxBackdrop').value = fx.backdropBlur || 0;
      $('#fxBlend').value = fx.blend || 'normal';
      reflectDependencies();
    };
    reflectDependencies();
  }

  /* --------------------------------------------------- motion extra panel
   * §21–§23: trigger, playback, text stagger modes and image animation.
   */
  function buildMotionPanel() {
    const host = $('.tab-panel[data-tab="motion"]');
    if (!host || $('#motionSystemPanel') || !window.StudioMotion) return;
    const MO = window.StudioMotion;
    const p = document.createElement('div');
    p.className = 'panel';
    p.id = 'motionSystemPanel';
    p.innerHTML = `
      <h4>Trigger &amp; playback</h4>
      <div class="ctrl"><label>Trigger</label><select id="moTrigger">
        ${Object.entries(MO.TRIGGERS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}
      </select></div>
      <label class="check"><input id="moReplay" type="checkbox">Replay each time it re-enters the viewport</label>
      <h4>Text animation</h4>
      <div class="ctrl"><label>Mode</label><select id="moTextMode">
        ${Object.entries(MO.TEXT_MODES).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}
      </select></div>
      <div class="ctrl"><label>Stagger</label><input id="moStagger" type="range" min="0" max="160" step="5"></div>
      <h4>Image animation</h4>
      <div class="ctrl"><label>Preset</label><select id="moImageAnim">
        ${Object.entries(MO.IMAGE_PRESETS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}
      </select></div>
      <div class="action-row"><button type="button" id="moReplayNow">▶ Replay selected</button></div>
      <p class="editor-note" id="moNote"></p>`;
    host.appendChild(p);

    const note = m => { const n = $('#moNote'); if (n) n.textContent = m || ''; };

    function commit() {
      const sel = ed.selected();
      if (!sel) return note('Select an object first.');
      const m = ed.model();
      const n = m && m.nodes && m.nodes[sel.dataset.id];
      if (!n) return note('That object is not in the model yet.');
      n.motion = n.motion || {};
      n.motion.trigger = $('#moTrigger').value;
      n.motion.replay = $('#moReplay').checked;
      n.motion.stagger = Number($('#moStagger').value);
      n.motion.imageAnim = $('#moImageAnim').value;

      const wantedText = $('#moTextMode').value;
      const messages = [];
      if (wantedText !== 'object') {
        const res = window.StudioMotion.split(sel, wantedText, n.motion.stagger);
        if (!res.ok) {
          // Say why instead of leaving a control that appears to do nothing.
          $('#moTextMode').value = n.motion.textMode || 'object';
          messages.push(res.why);
        } else {
          n.motion.textMode = wantedText;
          messages.push(`Split into ${res.parts} parts.`);
        }
      } else {
        window.StudioMotion.restore(sel);
        n.motion.textMode = 'object';
      }

      if (n.motion.imageAnim !== 'none' && !(sel.querySelector && sel.querySelector('img'))) {
        messages.push('Image animation needs an image on this object; it will apply once one is set.');
      }
      if (window.StudioMotion.reducedMotion()) {
        messages.push('This system prefers reduced motion, so the animation is held still here.');
      }

      window.StudioModel.apply(m, {});
      window.StudioMotion.bindTrigger(sel, n.motion);
      ed.push();
      note(messages.join(' ') || `Trigger: ${window.StudioMotion.TRIGGERS[n.motion.trigger]}.`);
    }

    ['moTrigger', 'moReplay', 'moTextMode', 'moStagger', 'moImageAnim'].forEach(id => {
      const el = $('#' + id);
      if (!el) return;
      el.addEventListener(el.tagName === 'SELECT' || el.type === 'checkbox' ? 'change' : 'input', commit);
    });
    $('#moReplayNow').addEventListener('click', () => {
      const sel = ed.selected();
      if (!sel) return note('Select an object first.');
      if (window.StudioMotion.reducedMotion()) return note('Reduced motion is on, so there is nothing to replay.');
      window.StudioMotion.replay(sel);
      note('Replayed.');
    });

    window.StudioShell.syncMotionPanel = () => {
      const sel = ed.selected();
      if (!sel) return;
      const m = ed.model();
      const n = (m && m.nodes && m.nodes[sel.dataset.id]) || {};
      const mo = n.motion || {};
      $('#moTrigger').value = mo.trigger || 'viewport';
      $('#moReplay').checked = !!mo.replay;
      $('#moTextMode').value = mo.textMode || 'object';
      $('#moStagger').value = mo.stagger !== undefined ? mo.stagger : 40;
      $('#moImageAnim').value = mo.imageAnim || 'none';
      const splittable = window.StudioMotion.canSplit(sel);
      $('#moTextMode').disabled = !splittable.ok && (mo.textMode || 'object') === 'object';
      const field = $('#moTextMode').closest('.ctrl');
      if (field) {
        field.classList.toggle('is-disabled', $('#moTextMode').disabled);
        const lbl = field.querySelector('label');
        if (lbl) lbl.title = splittable.ok ? '' : splittable.why;
      }
    };
    window.StudioShell.syncMotionPanel();
  }


  /* Same-tab / new-tab choice and live link validation (§12/§13). */
  function buildLinkControls() {
    const host = $('#textLinkPanel');
    if (!host || $('#linkNewTab')) return;
    const wrap = document.createElement('div');
    wrap.innerHTML = `
      <label class="check"><input id="linkNewTab" type="checkbox" checked>Open in a new tab</label>
      <p class="editor-note" id="linkNote">Accepts https://…, mailto:…, tel:… or #section for an internal jump.</p>`;
    host.appendChild(wrap);

    const apply = () => {
      const sel = ed.selected();
      if (!sel) return;
      const newTab = $('#linkNewTab').checked;
      sel.dataset.linkNewTab = newTab ? '1' : '0';
      const m = ed.model();
      const n = m && m.nodes && m.nodes[sel.dataset.id];
      if (n) { n.interaction = n.interaction || {}; n.interaction.newTab = newTab; }
      if (window.StudioLinks) window.StudioLinks.upgrade(document);
      ed.push();
    };
    $('#linkNewTab').addEventListener('change', apply);

    // Validate as typed, so a broken anchor is caught before publishing.
    const url = $('#textLinkUrl');
    if (url) url.addEventListener('input', () => {
      const note = $('#linkNote');
      if (!note || !window.StudioLinks) return;
      const v = url.value.trim();
      if (!v) { note.textContent = 'Accepts https://…, mailto:…, tel:… or #section for an internal jump.'; note.classList.remove('is-error'); return; }
      const info = window.StudioLinks.describe(v);
      note.textContent = info.ok
        ? (info.kind === 'anchor' ? `Jumps to ${info.url} on this page.` : `Opens ${info.url}`)
        : info.why;
      note.classList.toggle('is-error', !info.ok);
    });

    window.StudioShell.syncLinkControls = () => {
      const sel = ed.selected();
      if (!sel) return;
      $('#linkNewTab').checked = sel.dataset.linkNewTab !== '0';
    };
  }

  function init() {
    buildToolbar();
    buildLinkControls();
    buildEffectsPanel();
    buildMotionPanel();
    buildTexturePanel();
    buildBackgroundPanel();
    buildAltTextControl();
    buildStateBar();
    applyView();
    setViewport(shell.viewport);
    setEditState('base');
    bindKeys();
    renderTree();
    enhanceAllResize();
  }

  window.StudioShell = {
    shell, init, renderTree, setPreview, setView, setViewport, setEditState, writeTarget,
    addObject, duplicateObject, deleteObject, toggleHidden, toggleLocked, renameObject, reorder,
    buildTexturePanel, buildBackgroundPanel, buildAltTextControl, buildEffectsPanel, buildMotionPanel,
    enhanceResize, enhanceAllResize, SNAP_STEP, SNAP_TOLERANCE, buildLinkControls,
    VIEWPORTS, VIEW_FLAGS,
  };
})();
