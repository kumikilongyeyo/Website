/* /casino.game page behaviour.
 *
 *   - renders the image collections held in G.casino (logos, screens, icons,
 *     service art, avatar, tech) — the site settings bag, so publish, undo and
 *     version history already cover them
 *   - the Screens wall: straight columns alternating up/down, a constant drift
 *     plus a boost from scrolling, paused while off screen
 *   - the icon viewer: hover reveals title + info, click opens a dimmed
 *     lightbox with previous/next, arrow keys, Esc and swipe
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
      const style = `--s:${s};--r:${r};--sm:${Math.min(6, Math.max(2, Math.ceil(s / 2)))};--d:${Math.min(i * 45, 700)}ms`;
      return `<button type="button" class="cz-icon" style="${style}" data-icon="${i}" aria-label="${esc(x.title || 'Symbol')}: view larger">
        <img src="${esc(x.src)}" alt=""${sizeAttrs(x)} loading="lazy" decoding="async">
        <span class="cz-icon-cap"><strong>${esc(x.title)}</strong><span>${esc(x.info)}</span></span></button>`;
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

  function renderAll() {
    renderLogos(); renderIcons(); renderServices(); renderAbout(); Wall.build();
    if (panelOpen()) renderPanel();
  }

  /* ------------------------------------------------------------- wall */
  const Wall = (() => {
    const wall = $('.cz-wall'), host = $('.cz-wall-cols');
    let cols = [], drift = 0, last = 0, running = false, visible = false, loaded = false, raf = 0;

    function colCount() { return phone.matches ? 2 : Math.max(2, Math.min(6, Number(C().wall.columns) || 4)); }

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
        cols.push({ track, dir: c % 2 ? 1 : -1, off: (c * 137) % 400, half: 0 });
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
      const sc = (innerHeight - rect.top) * (Number(C().wall.scroll) || 0) / 100;
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
      drift += (Number(C().wall.speed) || 0) * dt;
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
        visible ? start() : stop();
      }).observe(wall);
      addEventListener('scroll', () => { if (!running && visible) place(); }, { passive: true });
      addEventListener('resize', () => { measure(); place(); });
      phone.addEventListener('change', build);
      reduced.addEventListener('change', () => (reduced.matches ? stop() : visible && start()));
      document.addEventListener('visibilitychange', () => (document.hidden ? stop() : visible && start()));
    }
    return { build };
  })();

  /* --------------------------------------------------------- lightbox */
  const LB = (() => {
    const box = $('.cz-lightbox');
    if (!box) return { open() {} };
    const img = $('.cz-lb-img', box), title = $('.cz-lb-title', box), info = $('.cz-lb-info', box), count = $('.cz-lb-count', box);
    let i = 0, opener = null, closing = 0;
    const items = () => C().icons.filter(x => x.src);

    function show(dir) {
      const list = items();
      if (!list.length) return close();
      i = (i + list.length) % list.length;
      const it = list[i];
      const swap = () => {
        img.src = it.src; img.alt = it.title || 'Symbol';
        title.textContent = it.title || '';
        info.textContent = it.info || '';
        info.hidden = !it.info;
        count.textContent = `${i + 1} / ${list.length}`;
      };
      if (!dir || reduced.matches) return swap();
      // Old image slides out one way, the new one arrives from the other.
      box.style.setProperty('--dir', dir);
      img.classList.add('leaving');
      setTimeout(() => {
        swap();
        img.classList.remove('leaving'); img.classList.add('entering');
        void img.offsetWidth;
        img.classList.remove('entering');
      }, 160);
    }
    function open(index, from) {
      if (editingNow()) return;
      clearTimeout(closing);
      i = index; opener = from || null;
      box.hidden = false;
      document.body.style.overflow = 'hidden';
      show(0);
      requestAnimationFrame(() => box.classList.add('open'));
      $('.cz-lb-close', box).focus({ preventScroll: true });
    }
    function close() {
      box.classList.remove('open');
      document.body.style.overflow = '';
      closing = setTimeout(() => { box.hidden = true; }, reduced.matches ? 0 : 260);
      if (opener && opener.isConnected) opener.focus({ preventScroll: true });
    }
    const step = d => { i += d; show(d); };

    box.addEventListener('click', e => {
      if (e.target.closest('[data-lb-close]')) return close();
      const s = e.target.closest('[data-lb-step]');
      if (s) step(Number(s.dataset.lbStep));
    });
    document.addEventListener('keydown', e => {
      if (box.hidden) return;
      if (e.key === 'Escape') { e.preventDefault(); close(); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); step(1); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1); }
      else if (e.key === 'Tab') {
        // Keep focus inside the dialog while it is open.
        const f = $$('button', box);
        const k = f.indexOf(document.activeElement);
        if (e.shiftKey && k <= 0) { e.preventDefault(); f[f.length - 1].focus(); }
        else if (!e.shiftKey && k === f.length - 1) { e.preventDefault(); f[0].focus(); }
      }
    });
    let x0 = null, y0 = 0;
    box.addEventListener('touchstart', e => { x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; }, { passive: true });
    box.addEventListener('touchend', e => {
      if (x0 === null) return;
      const dx = e.changedTouches[0].clientX - x0, dy = e.changedTouches[0].clientY - y0;
      x0 = null;
      if (Math.abs(dx) > 44 && Math.abs(dx) > Math.abs(dy) * 1.3) step(dx < 0 ? 1 : -1);
    });
    return { open };
  })();

  document.addEventListener('click', e => {
    const t = e.target.closest('.cz-icon');
    if (t) LB.open(Number(t.dataset.icon), t);
  });

  /* ------------------------------------------- first-appearance motion */
  (() => {
    if (reduced.matches || !('IntersectionObserver' in window)) return;
    document.documentElement.classList.add('cz-anim');
    const io = new IntersectionObserver(es => es.forEach(e => {
      if (!e.isIntersecting) return;
      e.target.classList.add('in');
      io.unobserve(e.target);
    }), { threshold: 0.18, rootMargin: '0px 0px -8% 0px' });
    $$('.cz-card, .cz-board').forEach(el => io.observe(el));
    // Anything already on screen at load (a deep link, a refresh mid-page)
    // must not wait for a scroll to appear.
    requestAnimationFrame(() => $$('.cz-card, .cz-board').forEach(el => {
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
    { key: 'screens', label: 'Screens wall', fields: [], note: 'Gameplay screenshots. They are dealt across the columns in this order.' },
    { key: 'icons', label: 'Icons & symbols', fields: [['title', 'Title'], ['info', 'Info', true], ['span', 'Width (1–12 columns)', 'num'], ['rows', 'Height (rows)', 'num']], note: 'Hover shows the title and info; click opens the viewer. The board is 12 columns wide: set each symbol’s width and height to lay it out like the PDF.' },
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

  function rowHTML(list, it, i) {
    const nums = list.fields.filter(f => f[2] === 'num');
    const fields = list.fields.filter(f => f[2] !== 'num').map(([k, label, long]) => long
      ? `<textarea rows="2" data-f="${k}" aria-label="${label}" placeholder="${label}">${esc(it[k])}</textarea>`
      : `<input type="text" data-f="${k}" aria-label="${label}" placeholder="${label}" value="${esc(it[k])}">`).join('') +
      (nums.length ? `<span class="cz-nums">${nums.map(([k, label]) => `<label title="${label}">${k === 'span' ? 'W' : 'H'}<input type="number" min="1" max="12" data-f="${k}" data-num="1" aria-label="${label}" value="${esc(it[k] ?? (k === 'span' ? 3 : 4))}"></label>`).join('')}</span>` : '');
    const file = (it.src || '').split('/').pop();
    return `<div class="cz-row" data-i="${i}">
      ${it.src ? `<img src="${esc(it.src)}" alt="">` : '<span class="cz-thumb-empty"></span>'}
      <div class="cz-fields">${fields || `<span class="cz-meta" title="${esc(it.src)}">${esc(file)}</span>`}</div>
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
      <details data-key="wall"${openKeys.includes('wall') ? ' open' : ''}><summary>Screens wall motion</summary>
        <div class="ctrl"><label for="czCols">Columns</label><div class="scrub"><input id="czColsRange" type="range" min="2" max="6" step="1" value="${c.wall.columns}"><input id="czCols" type="number" min="2" max="6" value="${c.wall.columns}"></div></div>
        <div class="ctrl"><label for="czSpeed">Drift speed</label><div class="scrub"><input id="czSpeedRange" type="range" min="0" max="120" value="${c.wall.speed}"><input id="czSpeed" type="number" min="0" max="200" value="${c.wall.speed}"></div></div>
        <div class="ctrl"><label for="czScroll">Scroll boost</label><div class="scrub"><input id="czScrollRange" type="range" min="0" max="100" value="${c.wall.scroll}"><input id="czScroll" type="number" min="0" max="200" value="${c.wall.scroll}"></div></div>
        <p class="cz-note">Phones always use 2 columns. Visitors who ask for reduced motion get a still wall.</p>
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
