/* /casino.game page behaviour.
 *
 *   - renders the image collections held in G.casino (logos, screens, icons,
 *     service art, avatar, tech) — the site settings bag, so publish, undo and
 *     version history already cover them
 *   - the Screens wall: straight columns alternating up/down, a constant drift
 *     plus a boost from scrolling, paused while off screen
 *   - the icons board: a static PDF-style composition on a 12-column grid
 *   - the sticky section nav (scroll spy)
 *   - in the editor, a "Casino page images" panel in the Site tab to add,
 *     reorder, caption and remove images
 *
 * Loads last. Collection items deliberately carry no data-node: they are not
 * Studio objects, so fromDOM never tries to serialise or rebuild them.
 */
(() => {
  'use strict';

  const $ = (s, p = document) => p.querySelector(s);
  const $$ = (s, p = document) => [...p.querySelectorAll(s)];
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const phone = matchMedia('(max-width: 720px)');
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // G is the editor's site-settings global (studio-editor.js). Read it fresh
  // every time: applyState() replaces the object rather than mutating it.
  const C = () => {
    const g = typeof G !== 'undefined' ? G : {};
    if (!g.casino) g.casino = JSON.parse(JSON.stringify((window.STUDIO_PAGE && window.STUDIO_PAGE.G.casino) || {}));
    const c = g.casino;
    for (const k of ['logos', 'screens', 'icons', 'services', 'tech']) if (!Array.isArray(c[k])) c[k] = [];
    c.avatar = c.avatar || { src: '' };
    c.wall = { columns: 4, speed: 28, scroll: 35, ...(c.wall || {}) };
    return c;
  };
  const editingNow = () => document.body.classList.contains('editing');
  const commit = msg => { if (typeof push === 'function') push(); if (msg && typeof status === 'function') status(msg); };
  const sizeAttrs = it => (it.w && it.h ? ` width="${+it.w}" height="${+it.h}"` : '');

  /* ------------------------------------------------------------ render */
  function renderLogos() {
    const ul = $('.cz-logos');
    if (!ul) return;
    ul.innerHTML = C().logos.filter(x => x.src).map(x =>
      `<li><img src="${esc(x.src)}" alt="${esc(x.name || 'Game logo')}"${sizeAttrs(x)} loading="lazy" decoding="async"></li>`).join('');
  }

  const clampInt = (v, lo, hi, d) => { const n = Math.round(Number(v)); return Number.isFinite(n) && n > 0 ? Math.max(lo, Math.min(hi, n)) : d; };
  function renderIcons() {
    const board = $('.cz-board');
    if (!board) return;
    board.innerHTML = C().icons.filter(x => x.src).map((x, i) => {
      // Width in columns of 12 and height in rows; a new upload defaults to 3×4.
      const s = clampInt(x.span, 1, 12, 3), r = clampInt(x.rows, 1, 12, 4);
      const style = `--s:${s};--r:${r};--d:${Math.min(i * 45, 700)}ms`;
      // Static, like the PDF board: no hover caption, no viewer. The title is the alt text.
      return `<div class="cz-icon" role="listitem" style="${style}"><img src="${esc(x.src)}" alt="${esc(x.title || 'Slot symbol')}"${sizeAttrs(x)} loading="lazy" decoding="async"></div>`;
    }).join('');
  }

  function renderServices() {
    const list = C().services;
    $$('.cz-card').forEach(card => {
      const it = list[Number(card.dataset.slot)] || {};
      const art = $('.cz-card-art', card);
      card.classList.toggle('no-art', !it.src);
      art.innerHTML = it.src ? `<img src="${esc(it.src)}" alt=""${sizeAttrs(it)} loading="lazy" decoding="async">` : '';
    });
  }

  function renderAbout() {
    const img = $('.cz-avatar img');
    if (img) { const src = C().avatar.src; if (src) img.src = src; else img.removeAttribute('src'); }
    const ul = $('.cz-tech');
    if (ul) ul.innerHTML = C().tech.map(t => `<li>${t.src
      ? `<img src="${esc(t.src)}" alt="${esc(t.name || 'Tool')}" loading="lazy" decoding="async">`
      : `<span class="cz-tech-name">${esc(t.name || 'Tool')}</span>`}</li>`).join('');
  }

  // Hero framing, desktop and phone, as CSS variables on the hero.
  const HERO_DEF = { x: 62, y: 50, s: 1, mx: 70, my: 50, ms: 1 };
  const heroPos = () => ({ ...HERO_DEF, ...(C().hero || {}) });
  function renderHero() {
    const h = $('.cz-hero'); if (!h) return;
    const p = heroPos();
    h.style.setProperty('--czh-x', p.x + '%'); h.style.setProperty('--czh-y', p.y + '%'); h.style.setProperty('--czh-s', p.s);
    h.style.setProperty('--czh-mx', p.mx + '%'); h.style.setProperty('--czh-my', p.my + '%'); h.style.setProperty('--czh-ms', p.ms);
    const b = $('.cz-board'); if (b) b.style.setProperty('--bz', (C().board && C().board.zoom) || 1);
  }

  function renderAll() {
    renderHero(); renderLogos(); renderIcons(); renderServices(); renderAbout(); Wall.build();
    if (panelOpen()) renderPanel();
  }

  /* ------------------------------------------------------------- wall */
  const Wall = (() => {
    const wall = $('.cz-wall'), host = $('.cz-wall-cols');
    // armed: the drift only starts once half the wall has been on screen, so
    // the starting screens are still in place when a visitor reaches it.
    let cols = [], drift = 0, last = 0, running = false, visible = false, loaded = false, raf = 0, armed = false;

    // Phones get 4 columns too (the user asked for the same 4:5 wall on mobile).
    function colCount() { return phone.matches ? 4 : Math.max(2, Math.min(6, Number(C().wall.columns) || 4)); }

    function build() {
      if (!wall || !host) return;
      const shots = C().screens.filter(x => x.src);
      const n = colCount();
      wall.style.setProperty('--cols', n);
      host.innerHTML = '';
      cols = [];
      wall.hidden = !shots.length;
      if (!shots.length) return;
      for (let c = 0; c < n; c++) {
        // Round-robin, so neighbouring columns never start on the same shot.
        let mine = shots.filter((_, i) => i % n === c);
        if (!mine.length) mine = shots.slice(c % shots.length, c % shots.length + 1);
        // Short columns are repeated so one set is always taller than the wall.
        const minItems = 6;
        const base = [...mine];
        while (mine.length < minItems) mine = mine.concat(base);
        const col = document.createElement('div'); col.className = 'cz-col';
        const track = document.createElement('div'); track.className = 'cz-track';
        // Two copies of the set: the loop wraps at exactly one set's height.
        const html = copy => mine.map(s => `<div class="cz-shot"${copy ? ' aria-hidden="true"' : ''}><img ${loaded ? 'src' : 'data-src'}="${esc(s.src)}" alt="${copy ? '' : 'Gameplay screen'}"${sizeAttrs(s)} decoding="async"></div>`).join('');
        track.innerHTML = html(false) + html(true);
        col.appendChild(track); host.appendChild(col);
        // No per-column offset: when the wall first appears every column starts
        // on its first screen, so the list order decides what is seen first
        // (screens 1–4 across the top row, 5–8 below, and so on).
        cols.push({ track, dir: c % 2 ? 1 : -1, off: 0, half: 0 });
      }
      measure();
      $$('img', host).forEach(im => im.addEventListener('load', measure, { once: true }));
      place();
    }

    function measure() {
      for (const c of cols) {
        const gap = parseFloat(getComputedStyle(c.track).rowGap) || 0;
        c.half = (c.track.scrollHeight + gap) / 2;
      }
    }

    // Loop + scroll: constant drift, plus the page's scroll position.
    function place() {
      const rect = wall.getBoundingClientRect();
      // Zero when the wall is centred on screen, which is when it is first seen
    // whole: the columns rest on their starting screens there.
    const sc = (innerHeight / 2 - (rect.top + rect.height / 2)) * (Number(C().wall.scroll) || 0) / 100;
      for (const c of cols) {
        if (!c.half) continue;
        let y = ((c.off + drift + sc) % c.half + c.half) % c.half;
        y = c.dir < 0 ? -y : y - c.half;              // up: 0 → -half; down: -half → 0
        c.track.style.transform = `translate3d(0,${y.toFixed(1)}px,0)`;
      }
    }

    function frame(t) {
      const dt = last ? Math.min(0.05, (t - last) / 1000) : 0;
      last = t;
      if (armed) drift += (Number(C().wall.speed) || 0) * dt;
      place();
      raf = requestAnimationFrame(frame);
    }
    function start() { if (running || reduced.matches) return; running = true; last = 0; raf = requestAnimationFrame(frame); }
    function stop() { running = false; cancelAnimationFrame(raf); }

    function load() {
      if (loaded) return; loaded = true;
      $$('img[data-src]', host).forEach(im => { im.src = im.dataset.src; im.removeAttribute('data-src'); });
    }

    if (wall) {
      // Images load when the wall comes near, and the loop runs only while it is on screen.
      new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) load(); }, { rootMargin: '900px 0px' }).observe(wall);
      new IntersectionObserver(es => {
        visible = es.some(e => e.isIntersecting);
        if (es.some(e => e.intersectionRatio >= 0.5)) armed = true;
        visible ? start() : stop();
      }, { threshold: [0, 0.5] }).observe(wall);
      addEventListener('scroll', () => { if (!running && visible) place(); }, { passive: true });
      addEventListener('resize', () => { measure(); place(); });
      phone.addEventListener('change', build);
      reduced.addEventListener('change', () => (reduced.matches ? stop() : visible && start()));
      document.addEventListener('visibilitychange', () => (document.hidden ? stop() : visible && start()));
    }
    return { build };
  })();

  /* ------------------------------------------- first-appearance motion */
  (() => {
    if (reduced.matches || !('IntersectionObserver' in window)) return;
    document.documentElement.classList.add('cz-anim');
    const io = new IntersectionObserver(es => es.forEach(e => {
      if (!e.isIntersecting) return;
      e.target.classList.add('in');
      io.unobserve(e.target);
    }), { threshold: 0.18, rootMargin: '0px 0px -8% 0px' });
    const targets = '.cz-card, .cz-board, .cz-spin, .cz-tech, .cz-connect-title';
    $$(targets).forEach(el => io.observe(el));
    // Anything already on screen at load (a deep link, a refresh mid-page)
    // must not wait for a scroll to appear.
    requestAnimationFrame(() => $$(targets).forEach(el => {
      const r = el.getBoundingClientRect();
      if (r.top < innerHeight && r.bottom > 0) el.classList.add('in');
    }));
  })();

  /* -------------------------------------------------------- scroll spy */
  (() => {
    const links = $$('.cz-nav [data-spy]');
    const bar = $('.cz-nav-bar');
    if (!links.length) return;
    const setActive = id => links.forEach((a, k) => {
      const on = a.dataset.spy === id;
      a.setAttribute('aria-current', on ? 'true' : 'false');
      if (on && bar) bar.style.setProperty('--i', k);
    });
    setActive('works');
    const io = new IntersectionObserver(es => {
      const hit = es.filter(e => e.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
      if (hit) setActive(hit.target.id);
    }, { rootMargin: '-45% 0px -50% 0px' });
    links.forEach(a => { const s = document.getElementById(a.dataset.spy); if (s) io.observe(s); });
  })();

  /* ------------------------------------------------------ editor panel */
  const LISTS = [
    { key: 'logos', label: 'Game logos', fields: [['name', 'Game name']], note: 'Shown in the Works grid, in this order. Display only, not clickable.' },
    { key: 'screens', label: 'Screens wall', fields: [], note: 'What visitors see first: the wall starts on screens 1–4 across the top row, then 5–8 below it. Reorder with ↑ ↓ to choose. The label on each row shows where it starts.' },
    { key: 'icons', label: 'Icons & symbols', fields: [['title', 'Name (read out by screen readers)'], ['span', 'Width (1–12 columns)', 'num'], ['rows', 'Height (rows)', 'num']], note: 'A static board, like the PDF. It is 12 columns wide: set each symbol’s width (W) and height (H) to lay it out.' },
    { key: 'tech', label: 'Technologies', fields: [['name', 'Name']], note: 'With no image, the name is shown as text.', allowEmpty: true },
  ];
  const panelOpen = () => !!$('#czPanel');

  async function fileToItem(file) {
    // Compressed in the browser first so no stored image passes 2MB.
    let upload = file;
    if (typeof compressImage === 'function' && file.type !== 'image/svg+xml' && file.type !== 'image/gif') {
      const data = await compressImage(file, 2000, 0.84, 1900000, true);
      if (data) {
        const blob = await (await fetch(data)).blob();
        upload = new File([blob], file.name.replace(/\.[^.]+$/, '') + '.webp', { type: 'image/webp' });
      }
    }
    let w = 0, h = 0;
    try { const b = await createImageBitmap(upload); w = b.width; h = b.height; b.close && b.close(); } catch { /* size is optional */ }
    const res = typeof uploadMedia === 'function' ? await uploadMedia(upload) : { ok: false, error: 'the editor is not loaded' };
    if (!res.ok) throw new Error(res.error || 'upload failed');
    return { src: res.src, w, h, name: file.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ') };
  }

  // Where a screen sits when the wall first appears, on desktop.
  function startSlot(i) {
    const n = Math.max(2, Math.min(6, Number(C().wall.columns) || 4));
    return `Row ${Math.floor(i / n) + 1}, col ${(i % n) + 1}`;
  }

  function rowHTML(list, it, i) {
    const nums = list.fields.filter(f => f[2] === 'num');
    const fields = list.fields.filter(f => f[2] !== 'num').map(([k, label, long]) => long
      ? `<textarea rows="2" data-f="${k}" aria-label="${label}" placeholder="${label}">${esc(it[k])}</textarea>`
      : `<input type="text" data-f="${k}" aria-label="${label}" placeholder="${label}" value="${esc(it[k])}">`).join('') +
      (nums.length ? `<span class="cz-nums">${nums.map(([k, label]) => `<label title="${label}">${k === 'span' ? 'W' : 'H'}<input type="number" min="1" max="12" data-f="${k}" data-num="1" aria-label="${label}" value="${esc(it[k] ?? (k === 'span' ? 3 : 4))}"></label>`).join('')}</span>` : '');
    const file = (it.src || '').split('/').pop();
    return `<div class="cz-row" data-i="${i}">
      ${it.src ? `<img src="${esc(it.src)}" alt="">` : '<span class="cz-thumb-empty"></span>'}
      <div class="cz-fields">${fields || `<span class="cz-meta" title="${esc(it.src)}">${list.key === 'screens' ? `<b>${startSlot(i)}</b> · ` : ''}${esc(file)}</span>`}</div>
      <div class="cz-ops"><button type="button" data-op="up" aria-label="Move up">↑</button><button type="button" data-op="down" aria-label="Move down">↓</button><button type="button" data-op="del" aria-label="Remove">✕</button></div></div>`;
  }

  function renderPanel() {
    const box = $('#czPanel .cz-body-lists');
    if (!box) return;
    const c = C();
    const openKeys = $$('details[open]', box).map(d => d.dataset.key);
    box.innerHTML = LISTS.map(l => `<details data-key="${l.key}"${openKeys.includes(l.key) ? ' open' : ''}>
        <summary>${l.label} (${c[l.key].length})</summary>
        <p class="cz-note">${l.note}</p>
        <div class="cz-list" data-list="${l.key}">${c[l.key].map((it, i) => rowHTML(l, it, i)).join('')}</div>
        <div class="cz-add"><label class="file-btn">Add images<input type="file" accept="image/*" multiple data-add="${l.key}" hidden></label>
          <input type="url" placeholder="…or paste an image URL" data-url="${l.key}"><button type="button" data-add-url="${l.key}">Add</button></div>
      </details>`).join('') +
      `<details data-key="slots"${openKeys.includes('slots') ? ' open' : ''}><summary>Service art & profile photo</summary>
        <p class="cz-note">Character art for the three service cards, and the About photo. A card with no art centres its text.</p>
        <div class="cz-list">${['2D Game Art', 'Asset Optimization', 'UI / UX'].map((n, i) => {
          const it = c.services[i] || {};
          return `<div class="cz-row">${it.src ? `<img src="${esc(it.src)}" alt="">` : '<span class="cz-thumb-empty"></span>'}<div class="cz-fields"><span class="cz-meta">${n}</span></div>
            <div class="cz-ops"><label class="file-btn" style="padding:0 6px">Replace<input type="file" accept="image/*" data-slot="${i}" hidden></label><button type="button" data-clear-slot="${i}" aria-label="Remove ${n} art">✕</button></div></div>`;
        }).join('')}
          <div class="cz-row">${c.avatar.src ? `<img src="${esc(c.avatar.src)}" alt="">` : '<span class="cz-thumb-empty"></span>'}<div class="cz-fields"><span class="cz-meta">Profile photo</span></div>
            <div class="cz-ops"><label class="file-btn" style="padding:0 6px">Replace<input type="file" accept="image/*" data-avatar hidden></label></div></div>
        </div></details>
      <details data-key="hero"${openKeys.includes('hero') ? ' open' : ''}><summary>Hero image position</summary>
        <p class="cz-note">Keep the driver clear of the headline. Turn on dragging and drag the image, or use the sliders. Desktop and phone are framed separately; the editor's phone preview edits the phone framing.</p>
        <button type="button" class="file-btn" data-hero-drag aria-pressed="${document.body.classList.contains('cz-hero-drag')}">${document.body.classList.contains('cz-hero-drag') ? 'Stop dragging' : 'Drag the hero image'}</button>
        ${[['x', 'Desktop X', 0, 100], ['y', 'Desktop Y', 0, 100], ['s', 'Desktop zoom', 1, 2, .01], ['mx', 'Phone X', 0, 100], ['my', 'Phone Y', 0, 100], ['ms', 'Phone zoom', 1, 2, .01]].map(([k, l, lo, hi, st]) =>
          `<div class="ctrl"><label for="czHero_${k}">${l}</label><div class="scrub"><input id="czHero_${k}Range" data-hero="${k}" type="range" min="${lo}" max="${hi}" step="${st || 1}" value="${heroPos()[k]}"><input id="czHero_${k}" data-hero="${k}" type="number" min="${lo}" max="${hi}" step="${st || 1}" value="${heroPos()[k]}"></div></div>`).join('')}
      </details>
      <details data-key="board"${openKeys.includes('board') ? ' open' : ''}><summary>Icons board size</summary>
        <p class="cz-note">The glass board grows with its symbols. Make it taller here, or give a symbol more W/H in the list above.</p>
        <div class="ctrl"><label for="czBoard">Row height</label><div class="scrub"><input id="czBoardRange" data-board type="range" min="0.6" max="1.8" step="0.05" value="${(c.board && c.board.zoom) || 1}"><input id="czBoard" data-board type="number" min="0.6" max="1.8" step="0.05" value="${(c.board && c.board.zoom) || 1}"></div></div>
      </details>
      <details data-key="wall"${openKeys.includes('wall') ? ' open' : ''}><summary>Screens wall motion</summary>
        <div class="ctrl"><label for="czCols">Columns</label><div class="scrub"><input id="czColsRange" type="range" min="2" max="6" step="1" value="${c.wall.columns}"><input id="czCols" type="number" min="2" max="6" value="${c.wall.columns}"></div></div>
        <div class="ctrl"><label for="czSpeed">Drift speed</label><div class="scrub"><input id="czSpeedRange" type="range" min="0" max="120" value="${c.wall.speed}"><input id="czSpeed" type="number" min="0" max="200" value="${c.wall.speed}"></div></div>
        <div class="ctrl"><label for="czScroll">Scroll boost</label><div class="scrub"><input id="czScrollRange" type="range" min="0" max="100" value="${c.wall.scroll}"><input id="czScroll" type="number" min="0" max="200" value="${c.wall.scroll}"></div></div>
        <p class="cz-note">Phones always use 4 columns. Visitors who ask for reduced motion get a still wall.</p>
      </details>`;
  }

  function mountPanel() {
    if (panelOpen()) return;
    const site = $('.inspector .tab-panel[data-tab="site"]');
    if (!site) return;
    const p = document.createElement('div');
    p.className = 'panel cz-panel'; p.id = 'czPanel';
    p.innerHTML = '<h4>Casino page images</h4><p class="editor-note">Everything here is saved with Publish, like the rest of the page. Uploads are compressed to under 2MB.</p><div class="cz-body-lists"></div>';
    site.prepend(p);
    renderPanel();

    p.addEventListener('input', e => {
      const f = e.target.closest('[data-f]');
      if (f) {
        const key = f.closest('[data-list]').dataset.list, i = Number(f.closest('.cz-row').dataset.i);
        C()[key][i][f.dataset.f] = f.dataset.num ? Number(f.value) : f.value;
        clearTimeout(p._t); p._t = setTimeout(() => { renderLogos(); renderIcons(); renderAbout(); commit(); }, 250);
        return;
      }
      if (e.target.dataset.hero) {
        const k = e.target.dataset.hero, v = Number(e.target.value);
        C().hero = { ...heroPos(), [k]: v };
        $$(`[data-hero="${k}"]`, p).forEach(i => { if (i !== e.target) i.value = v; });
        renderHero(); clearTimeout(p._h); p._h = setTimeout(() => commit(), 250);
        return;
      }
      if (e.target.hasAttribute('data-board')) {
        const v = Number(e.target.value);
        C().board = { ...(C().board || {}), zoom: v };
        $$('[data-board]', p).forEach(i => { if (i !== e.target) i.value = v; });
        renderHero(); clearTimeout(p._b); p._b = setTimeout(() => commit(), 250);
        return;
      }
      const pairs = { czCols: 'columns', czSpeed: 'speed', czScroll: 'scroll' };
      for (const id in pairs) {
        if (e.target.id === id || e.target.id === id + 'Range') {
          const v = Number(e.target.value);
          $('#' + id).value = v; $('#' + id + 'Range').value = v;
          C().wall[pairs[id]] = v;
          if (id === 'czCols') Wall.build();
          clearTimeout(p._w); p._w = setTimeout(() => commit(), 250);
        }
      }
    });

    p.addEventListener('click', e => {
      const hd = e.target.closest('[data-hero-drag]');
      if (hd) {
        const on = document.body.classList.toggle('cz-hero-drag');
        hd.setAttribute('aria-pressed', String(on)); hd.textContent = on ? 'Stop dragging' : 'Drag the hero image';
        if (typeof status === 'function') status(on ? 'Drag the hero image to reposition it. Click "Stop dragging" when done.' : 'Hero dragging off.');
        if (on) $('.cz-hero').scrollIntoView({ block: 'start', behavior: 'instant' });
        return;
      }
      const op = e.target.closest('[data-op]');
      if (op) {
        const key = op.closest('[data-list]').dataset.list, i = Number(op.closest('.cz-row').dataset.i), arr = C()[key];
        if (op.dataset.op === 'del') arr.splice(i, 1);
        else {
          const j = op.dataset.op === 'up' ? i - 1 : i + 1;
          if (j < 0 || j >= arr.length) return;
          [arr[i], arr[j]] = [arr[j], arr[i]];
        }
        renderAll(); commit(op.dataset.op === 'del' ? 'Removed. Undo brings it back.' : 'Moved.');
        return;
      }
      const addUrl = e.target.closest('[data-add-url]');
      if (addUrl) {
        const key = addUrl.dataset.addUrl, input = $(`[data-url="${key}"]`, p), url = (input.value || '').trim();
        if (!/^(https:\/\/|\/)/.test(url)) return typeof status === 'function' && status('Paste a full https:// image URL, or a path on this site starting with /.');
        const probe = new Image();
        probe.onload = () => { C()[key].push({ src: url, w: probe.naturalWidth, h: probe.naturalHeight, name: '', title: '', info: '' }); input.value = ''; renderAll(); commit('Image added.'); };
        probe.onerror = () => typeof status === 'function' && status('That URL did not load as an image.');
        probe.src = url;
        return;
      }
      const clr = e.target.closest('[data-clear-slot]');
      if (clr) { C().services[Number(clr.dataset.clearSlot)] = { src: '' }; renderAll(); commit('Service art removed.'); }
    });

    p.addEventListener('change', async e => {
      const t = e.target;
      // Start positions depend on the column count; refresh them once the slider is released.
      if (t.id === 'czCols' || t.id === 'czColsRange') { renderPanel(); return; }
      if (!(t instanceof HTMLInputElement) || t.type !== 'file' || !t.files.length) return;
      const files = [...t.files];
      t.value = '';
      const say = m => typeof status === 'function' && status(m);
      try {
        if (t.dataset.add) {
          const key = t.dataset.add;
          let done = 0;
          for (const f of files) {
            say(`Uploading ${++done} of ${files.length}…`);
            const it = await fileToItem(f);
            C()[key].push(key === 'icons' ? { src: it.src, w: it.w, h: it.h, title: it.name, info: '' } : key === 'screens' ? { src: it.src, w: it.w, h: it.h } : { src: it.src, w: it.w, h: it.h, name: it.name });
          }
          renderAll(); commit(`Added ${files.length} image${files.length > 1 ? 's' : ''}.`);
        } else if (t.dataset.slot !== undefined) {
          const it = await fileToItem(files[0]);
          C().services[Number(t.dataset.slot)] = { src: it.src, w: it.w, h: it.h };
          renderAll(); commit('Service art replaced.');
        } else if (t.hasAttribute('data-avatar')) {
          const it = await fileToItem(files[0]);
          C().avatar = { src: it.src };
          renderAll(); commit('Profile photo replaced.');
        }
      } catch (err) {
        say('Upload failed: ' + err.message + '. Nothing was changed for that file.');
      }
    });
  }

  /* ------------------------------------------------ hero image dragging
   * Only while "Drag the hero image" is on. Captured before the editor's own
   * Move-mode handler, which would otherwise select and move an object.
   */
  document.addEventListener('pointerdown', e => {
    if (!editingNow() || !document.body.classList.contains('cz-hero-drag')) return;
    const hero = e.target.closest && e.target.closest('.cz-hero');
    if (!hero || e.target.closest('.inspector, .devbar, .layers')) return;
    e.preventDefault(); e.stopPropagation();
    const phoneView = innerWidth <= 720 || document.body.dataset.viewport === 'mobile';
    const kx = phoneView ? 'mx' : 'x', ky = phoneView ? 'my' : 'y';
    const r = hero.getBoundingClientRect();
    const start = { x: e.clientX, y: e.clientY, px: heroPos()[kx], py: heroPos()[ky] };
    const clamp = v => Math.max(0, Math.min(100, Math.round(v * 10) / 10));
    const move = q => {
      // Dragging right reveals more of the left of the picture, so the focus moves left.
      C().hero = { ...heroPos(), [kx]: clamp(start.px - (q.clientX - start.x) / r.width * 100), [ky]: clamp(start.py - (q.clientY - start.y) / r.height * 100) };
      renderHero();
    };
    const up = () => {
      removeEventListener('pointermove', move); removeEventListener('pointerup', up);
      if (panelOpen()) renderPanel();
      commit(`Hero ${phoneView ? 'phone' : 'desktop'} framing: ${heroPos()[kx]}% × ${heroPos()[ky]}%.`);
    };
    addEventListener('pointermove', move); addEventListener('pointerup', up);
  }, true);

  /* ---------------------------------------------------- editor wiring
   * applyState() (load, undo, redo, rollback) swaps G for a new object, so the
   * collections are redrawn after it. enter() builds the inspector, so the
   * panel mounts after it. Same wrap-the-global pattern as studio-links.js.
   */
  for (const [name, after] of [['applyState', renderAll], ['enter', () => setTimeout(() => { mountPanel(); renderPanel(); }, 0)]]) {
    const inner = window[name];
    if (typeof inner !== 'function' || inner.__casino) continue;
    const wrapped = function (...a) {
      const r = inner.apply(this, a);
      Promise.resolve(r).then(after, () => {});
      return r;
    };
    wrapped.__casino = true;
    window[name] = wrapped;
  }

  renderAll();
})();
