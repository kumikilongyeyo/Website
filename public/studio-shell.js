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

  function init() {
    buildToolbar();
    buildStateBar();
    applyView();
    setViewport(shell.viewport);
    setEditState('base');
    bindKeys();
    renderTree();
  }

  window.StudioShell = {
    shell, init, renderTree, setPreview, setView, setViewport, setEditState, writeTarget,
    addObject, duplicateObject, deleteObject, toggleHidden, toggleLocked, renameObject, reorder,
    VIEWPORTS, VIEW_FLAGS,
  };
})();
