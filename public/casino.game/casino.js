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

  // A reload must start at the top, on the hero's first frame. Browsers restore
  // the old scroll position by default, which landed visitors mid-animation
  // with the text already shown. A #works style link still jumps as asked.
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
  if (!location.hash) scrollTo(0, 0);

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
    const def = (window.STUDIO_PAGE && window.STUDIO_PAGE.G.casino) || {};
    c.wall = { columns: 4, speed: 28, scroll: 35, fade: 16, blur: 10, band: 20, ...(c.wall || {}) };
    // A config published before these settings existed simply has none; the
    // page defaults fill in, so older publishes keep working.
    c.heroAnim = { ...(def.heroAnim || {}), ...(c.heroAnim || {}) };
    if (!Array.isArray(c.decor)) c.decor = JSON.parse(JSON.stringify(def.decor || []));
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
    const w = $('.cz-wall'), wl = C().wall;
    if (w) { w.style.setProperty('--fade', wl.fade + '%'); w.style.setProperty('--blur', wl.blur + 'px'); w.style.setProperty('--band', wl.band + '%'); }
    const a = C().heroAnim;
    h.style.setProperty('--pin', (Number(a.pin) || 120) + 'vh');
    h.style.setProperty('--line-delay', (Number(a.lineDelay) || 0) + 's');
    h.style.setProperty('--line-dur', (Number(a.lineDur) || 2.4) + 's');
    h.style.setProperty('--line-w', (Number(a.lineWidth) || 1) + 'px');
    renderDecor();
  }

  function renderDecor() {
    $$('.cz-decor-layer').forEach(layer => {
      layer.innerHTML = C().decor.map((d, i) => d.section !== layer.dataset.section || d.hidden || !d.src ? '' :
        `<img class="cz-decor" data-decor="${i}" src="${esc(d.src)}" alt="" draggable="false" loading="lazy" decoding="async" style="--dx:${+d.x}%;--dy:${+d.y}%;--dw:${+d.w}%;--dop:${+d.op};--drot:${+d.rot || 0}deg">`).join('');
    });
  }

  function renderAll() {
    renderHero(); renderLogos(); renderIcons(); renderServices(); renderAbout(); Wall.build(); HeroMotion.apply();
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

  /* -------------------------------------------------------- hero motion
   * scroll:   the hero is pinned; scrolling scrubs the drive-in video, and the
   *           text arrives once the video reaches "text appears at".
   * autoplay: the video plays once on load; the text follows it.
   * image:    the still; the text arrives after "text delay".
   * The line under the pitch draws after the text (line delay / duration),
   * or follows the scroll when "line follows" is set to scroll.
   * Reduced motion and the editor always show the finished hero.
   */
  const HeroMotion = (() => {
    const root = document.documentElement, hero = $('.cz-hero'), pin = $('.cz-hero-pin'), video = $('.cz-hero-video');
    if (!hero || !video) return { apply() {} };
    let textShown = false, played = false, timer = 0, raf = 0, seeking = false, want = -1, primed = false;
    const cfg = () => C().heroAnim;
    const mode = () => (reduced.matches ? 'image' : (cfg().video ? cfg().mode : 'image'));
    // The editor shows the finished hero, except in Preview, which plays it.
    const armed = () => !reduced.matches && (!editingNow() || document.body.classList.contains('previewing'));
    const textAt = () => Math.max(0, Math.min(100, Number(cfg().textAt) || 0)) / 100;
    const clamp01 = v => Math.max(0, Math.min(1, v));

    function setText(on) {
      if (on === textShown) return;
      textShown = on;
      hero.classList.toggle('cz-text-in', on);
      hero.classList.toggle('cz-line-in', on);
    }
    // One seek in flight at a time, always to the latest target. Compared with
    // the last time REQUESTED, never video.currentTime: browsers snap a seek to
    // a frame and report a slightly different time, and comparing against that
    // re-seeked forever.
    let last = -1, guard = 0;
    function seek(t) {
      if (!video.duration) return;
      want = Math.max(0, Math.min(video.duration - 0.04, t));
      pump();
    }
    function pump() {
      if (seeking || Math.abs(want - last) < 1 / 60) return;
      seeking = true; last = want;
      video.currentTime = want;
      clearTimeout(guard); guard = setTimeout(() => { seeking = false; pump(); }, 300);   // a lost 'seeked' must not stall the scrub
    }
    video.addEventListener('seeked', () => { seeking = false; clearTimeout(guard); pump(); });
    video.addEventListener('emptied', () => { last = -1; seeking = false; });
    video.addEventListener('loadeddata', () => { if (!armed() && video.duration) seek(video.duration); else tick(); });

    function progress() {
      if (!pin) return 0;
      const top = pin.getBoundingClientRect().top, len = pin.offsetHeight - innerHeight;
      return len > 0 ? clamp01(-top / len) : 1;
    }
    function tick() {
      raf = 0;
      if (!armed()) return;
      const m = mode();
      if (m === 'scroll') {
        const p = progress();
        root.classList.toggle('cz-scrolled', p > 0.02);
        if (video.duration) seek(p * video.duration);
        setText(p >= textAt());
        hero.style.setProperty('--line-p', clamp01((p - textAt()) / Math.max(0.05, 1 - textAt())));
      } else if (cfg().lineMode === 'scroll') {
        hero.style.setProperty('--line-p', clamp01(scrollY / Math.max(1, hero.offsetHeight * 0.6)));
      }
    }
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(tick); };
    addEventListener('scroll', onScroll, { passive: true });
    addEventListener('resize', onScroll);
    // iOS only decodes a video after a play() call, so seeking to follow the
    // scroll needs one muted play/pause first.
    const prime = () => { if (primed || mode() !== 'scroll') return; primed = true; video.play().then(() => video.pause()).catch(() => {}); };
    addEventListener('touchstart', prime, { passive: true, once: true });
    addEventListener('scroll', prime, { passive: true, once: true });

    video.addEventListener('timeupdate', () => {
      if (mode() !== 'autoplay' || !armed() || !video.duration) return;
      if (video.currentTime / video.duration >= textAt()) { clearTimeout(timer); timer = setTimeout(() => setText(true), (Number(cfg().textDelay) || 0) * 1000); }
    });

    /* The whole file is fetched into memory and played from a blob: URL. A
     * video streamed with range requests is only seekable where the server
     * answers them, and scrubbing asks for a seek on every scroll frame; from
     * memory it is always seekable and never re-downloads. Falls back to the
     * plain URL if the fetch is refused (e.g. another origin). */
    let blobUrl = '';
    function load(src) {
      if (blobUrl) { URL.revokeObjectURL(blobUrl); blobUrl = ''; }
      last = -1;
      fetch(src).then(r => { if (!r.ok) throw new Error(r.status); return r.blob(); })
        .then(b => { if (video.dataset.src !== src) return; blobUrl = URL.createObjectURL(b); video.src = blobUrl; video.load(); })
        .catch(() => { if (video.dataset.src === src) { video.src = src; video.load(); } });
    }

    function apply() {
      const m = mode(), on = armed(), a = cfg();
      root.classList.toggle('cz-mode-scroll', m === 'scroll' && on);
      hero.classList.toggle('cz-video-mode', m !== 'image');
      hero.classList.toggle('cz-hero-anim', on);
      hero.classList.toggle('cz-line-scroll', on && a.lineMode === 'scroll');
      if (m !== 'image') {
        if (video.dataset.src !== a.video) { video.dataset.src = a.video; video.poster = a.poster || ''; load(a.video); played = false; }
      } else if (video.getAttribute('src')) { video.removeAttribute('src'); video.removeAttribute('poster'); delete video.dataset.src; video.load(); }
      if (!on) {
        // Editor / reduced motion: the finished hero, text in place, last frame.
        clearTimeout(timer); textShown = false; setText(true); hero.style.setProperty('--line-p', 1);
        if (video.duration) seek(video.duration);
        return;
      }
      if (m === 'scroll') { tick(); return; }
      if (m === 'autoplay') {
        if (!played) {
          played = true; setText(false);
          const go = () => video.play().catch(() => { if (video.duration) seek(video.duration); setText(true); });
          video.readyState >= 2 ? go() : video.addEventListener('loadeddata', go, { once: true });
        }
      } else if (!textShown) {
        clearTimeout(timer); timer = setTimeout(() => setText(true), (Number(a.textDelay) || 0) * 1000);
      }
      tick();
    }
    reduced.addEventListener('change', apply);
    const replay = () => { played = false; textShown = true; setText(false); clearTimeout(timer); last = -1; if (video.duration) seek(0); apply(); };
    // Entering Preview replays the hero from the start; leaving it shows the finished hero again.
    let wasPreviewing = document.body.classList.contains('previewing');
    new MutationObserver(() => {
      const now = document.body.classList.contains('previewing');
      if (now === wasPreviewing) return;
      wasPreviewing = now;
      now ? (scrollTo(0, 0), replay()) : apply();
    }).observe(document.body, { attributes: true, attributeFilter: ['class'] });
    return { apply, replay };
  })();

  /* ------------------------------------------------------ logo hover tilt
   * Display-only logos still respond to the pointer: a 3D tilt toward it.
   */
  (() => {
    const ul = $('.cz-logos');
    if (!ul || !matchMedia('(hover: hover)').matches) return;
    ul.addEventListener('pointermove', e => {
      if (reduced.matches) return;
      const li = e.target.closest('li'); if (!li) return;
      const r = li.getBoundingClientRect(), nx = (e.clientX - r.left) / r.width - 0.5, ny = (e.clientY - r.top) / r.height - 0.5;
      li.classList.add('tilting');
      li.style.setProperty('--ry', (nx * 18).toFixed(2) + 'deg');
      li.style.setProperty('--rx', (-ny * 18).toFixed(2) + 'deg');
      li.style.setProperty('--ts', 1.06);
    });
    ul.addEventListener('pointerout', e => {
      const li = e.target.closest('li'); if (!li || li.contains(e.relatedTarget)) return;
      li.classList.remove('tilting');
      ['--rx', '--ry', '--ts'].forEach(k => li.style.removeProperty(k));
    });
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

  // A range + number pair bound to a path in G.casino (e.g. 'heroAnim.pin', 'decor.2.x').
  const ctl = (path, label, min, max, step, val) => {
    const id = 'cz_' + path.replace(/\./g, '_');
    return `<div class="ctrl"><label for="${id}">${label}</label><div class="scrub"><input id="${id}Range" data-set="${path}" type="range" min="${min}" max="${max}" step="${step}" value="${esc(val)}"><input id="${id}" data-set="${path}" type="number" min="${min}" max="${max}" step="${step}" value="${esc(val)}"></div></div>`;
  };
  function setPath(path, value) {
    const keys = path.split('.');
    let o = C();
    for (let i = 0; i < keys.length - 1; i++) o = o[keys[i]];
    o[keys[keys.length - 1]] = value;
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
      <div class="cz-ops"><button type="button" data-op="del" aria-label="Remove">✕</button></div></div>`;
  }

  function renderPanel() {
    const box = $('#czPanel .cz-body-lists');
    if (!box) return;
    const c = C();
    const openKeys = $$('details[open]', box).map(d => d.dataset.key);
    box.innerHTML = LISTS.map(l => `<details data-key="${l.key}"${openKeys.includes(l.key) ? ' open' : ''}>
        <summary>${l.label} (${c[l.key].length})</summary>
        <p class="cz-note">${l.note} Click to select, Shift-click for a range, ⌘/Ctrl-click to add one, then drag to reorder. Delete removes the selection.</p>
        <div class="cz-selbar" data-selbar="${l.key}" hidden></div>
        <div class="cz-list" data-list="${l.key}" aria-label="${l.label}: click to select, Shift-click for a range, ⌘ or Ctrl-click to add one, then drag to reorder">${c[l.key].map((it, i) => rowHTML(l, it, i)).join('')}</div>
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
        ${ctl('wall.fade', 'Edge fade depth (%)', 0, 45, 1, c.wall.fade)}
        ${ctl('wall.blur', 'Edge blur (px)', 0, 40, 1, c.wall.blur)}
        ${ctl('wall.band', 'Edge blur depth (%)', 0, 50, 1, c.wall.band)}
        <p class="cz-note">Phones always use 4 columns. Visitors who ask for reduced motion get a still wall.</p>
      </details>
      <details data-key="heroAnim"${openKeys.includes('heroAnim') ? ' open' : ''}><summary>Hero animation</summary>
        <div class="ctrl"><label for="czHeroMode">Hero</label><select id="czHeroMode" data-set="heroAnim.mode">
          ${[['scroll', 'Video follows the scroll'], ['autoplay', 'Video plays on load'], ['image', 'Still image']].map(([v, l]) => `<option value="${v}"${c.heroAnim.mode === v ? ' selected' : ''}>${l}</option>`).join('')}</select></div>
        ${ctl('heroAnim.pin', 'Scroll length (vh)', 30, 300, 5, c.heroAnim.pin)}
        ${ctl('heroAnim.textAt', 'Text appears at (% of video)', 0, 100, 1, c.heroAnim.textAt)}
        ${ctl('heroAnim.textDelay', 'Text delay (s)', 0, 8, 0.1, c.heroAnim.textDelay)}
        ${ctl('heroAnim.lineDelay', 'Line delay after text (s)', 0, 10, 0.1, c.heroAnim.lineDelay)}
        ${ctl('heroAnim.lineDur', 'Line draw time (s)', 0.2, 10, 0.1, c.heroAnim.lineDur)}
        ${ctl('heroAnim.lineWidth', 'Line thickness (px)', 1, 4, 1, c.heroAnim.lineWidth)}
        <div class="ctrl"><label for="czLineMode">Line</label><select id="czLineMode" data-set="heroAnim.lineMode">
          ${[['time', 'Draws after the text'], ['scroll', 'Follows the scroll']].map(([v, l]) => `<option value="${v}"${c.heroAnim.lineMode === v ? ' selected' : ''}>${l}</option>`).join('')}</select></div>
        <div class="ctrl stack"><label for="czHeroVideo">Video URL (MP4)</label><input id="czHeroVideo" type="url" data-set="heroAnim.video" value="${esc(c.heroAnim.video)}"></div>
        <label class="file-btn">Upload a video (MP4, under 2MB)<input type="file" accept="video/mp4" data-hero-video hidden></label>
        <button type="button" class="file-btn" data-hero-replay>Watch it in Preview</button>
        <p class="cz-note">"Text appears at" is how far through the video the headline arrives (scroll and play-on-load). "Text delay" waits after that, or after the page loads for the still image. The editor shows the finished hero so you can edit it; Preview plays it from the top.</p>
      </details>
      <details data-key="decor"${openKeys.includes('decor') ? ' open' : ''}><summary>Decorations (${c.decor.length})</summary>
        <p class="cz-note">The ribbons and sphere behind the sections. Turn on dragging to move them on the page, or use the sliders. X, Y and size are % of their section.</p>
        <button type="button" class="file-btn" data-decor-drag aria-pressed="${document.body.classList.contains('cz-decor-drag')}">${document.body.classList.contains('cz-decor-drag') ? 'Stop dragging' : 'Drag decorations'}</button>
        ${c.decor.map((d, i) => `<div class="cz-decor-row">
          <div class="cz-row">${d.src ? `<img src="${esc(d.src)}" alt="">` : '<span class="cz-thumb-empty"></span>'}<div class="cz-fields">
            <select data-set="decor.${i}.section" aria-label="Section">${['works', 'services', 'about'].map(v => `<option value="${v}"${d.section === v ? ' selected' : ''}>${v[0].toUpperCase() + v.slice(1)}</option>`).join('')}</select>
            <label class="cz-meta"><input type="checkbox" data-set="decor.${i}.hidden"${d.hidden ? ' checked' : ''}> Hidden</label></div>
            <div class="cz-ops"><label class="file-btn" style="padding:0 6px">Replace<input type="file" accept="image/*" data-decor-replace="${i}" hidden></label><button type="button" data-decor-del="${i}" aria-label="Remove decoration">✕</button></div></div>
          ${ctl(`decor.${i}.x`, 'X (%)', -50, 130, 1, d.x)}${ctl(`decor.${i}.y`, 'Y (%)', -50, 130, 1, d.y)}${ctl(`decor.${i}.w`, 'Size (%)', 2, 120, 1, d.w)}
          ${ctl(`decor.${i}.op`, 'Opacity', 0, 1, 0.01, d.op)}${ctl(`decor.${i}.rot`, 'Rotation (°)', -180, 180, 1, d.rot || 0)}</div>`).join('')}
        <label class="file-btn">Add a decoration<input type="file" accept="image/*" data-decor-add hidden></label>
      </details>`;
    // Re-rendering the panel keeps what was selected (and drops indices that no longer exist).
    Object.keys(SEL).forEach(k => { SEL[k].forEach(i => { if (i >= (c[k] || []).length) SEL[k].delete(i); }); paintSel(k); });
  }

  /* ------------------------------------------ list selection + dragging */
  const SEL = {}, ANCHOR = {};
  const selOf = key => (SEL[key] = SEL[key] || new Set());
  function paintSel(key) {
    const box = $(`#czPanel .cz-list[data-list="${key}"]`); if (!box) return;
    const sel = selOf(key);
    $$('.cz-row', box).forEach(r => r.classList.toggle('sel', sel.has(Number(r.dataset.i))));
    const bar = $(`#czPanel [data-selbar="${key}"]`);
    if (bar) { bar.hidden = !sel.size; bar.innerHTML = sel.size ? `<span>${sel.size} selected</span><button type="button" data-sel-remove="${key}">Remove</button><button type="button" data-sel-clear="${key}">Clear</button>` : ''; }
  }
  function clickSelect(key, i, shift, meta) {
    const sel = selOf(key);
    if (shift && ANCHOR[key] !== undefined) {
      if (!meta) sel.clear();
      const [a, b] = [ANCHOR[key], i].sort((x, y) => x - y);
      for (let k = a; k <= b; k++) sel.add(k);
    } else if (meta) { sel.has(i) ? sel.delete(i) : sel.add(i); ANCHOR[key] = i; }
    else { sel.clear(); sel.add(i); ANCHOR[key] = i; }
    paintSel(key);
  }
  function removeSelected(key) {
    const sel = selOf(key); if (!sel.size) return;
    const n = sel.size;
    C()[key] = C()[key].filter((_, i) => !sel.has(i));
    sel.clear(); delete ANCHOR[key];
    renderAll(); commit(`Removed ${n} image${n > 1 ? 's' : ''}. Undo brings ${n > 1 ? 'them' : 'it'} back.`);
  }

  let drag = null;
  function dropIndex(box, y) {
    const rows = $$('.cz-row', box);
    for (const r of rows) { const b = r.getBoundingClientRect(); if (y < b.top + b.height / 2) return { i: Number(r.dataset.i), before: r }; }
    return { i: rows.length, before: null };
  }
  function onDragMove(e) {
    if (!drag) return;
    if (!drag.started) {
      if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 5) return;
      drag.started = true;
      const sel = selOf(drag.key);
      if (!sel.has(drag.i)) { sel.clear(); sel.add(drag.i); ANCHOR[drag.key] = drag.i; paintSel(drag.key); }
      $$('.cz-row', drag.box).forEach(r => r.classList.toggle('dragging', sel.has(Number(r.dataset.i))));
      drag.ghost = Object.assign(document.createElement('div'), { className: 'cz-drag-ghost', textContent: `Moving ${sel.size} image${sel.size > 1 ? 's' : ''}` });
      drag.line = Object.assign(document.createElement('div'), { className: 'cz-drop' });
      document.body.appendChild(drag.ghost);
    }
    drag.ghost.style.left = e.clientX + 14 + 'px'; drag.ghost.style.top = e.clientY + 10 + 'px';
    const t = dropIndex(drag.box, e.clientY);
    drag.target = t.i;
    t.before ? drag.box.insertBefore(drag.line, t.before) : drag.box.appendChild(drag.line);
    // Scroll the inspector while dragging near its top or bottom edge.
    const sc = drag.box.closest('.inspect-scroll');
    if (sc) { const b = sc.getBoundingClientRect(); if (e.clientY < b.top + 40) sc.scrollTop -= 14; else if (e.clientY > b.bottom - 40) sc.scrollTop += 14; }
  }
  function onDragEnd() {
    if (!drag) return;
    const d = drag; drag = null;
    removeEventListener('pointermove', onDragMove); removeEventListener('pointerup', onDragEnd);
    if (!d.started) return clickSelect(d.key, d.i, d.shift, d.meta);
    d.ghost.remove(); d.line.remove();
    const arr = C()[d.key], sel = [...selOf(d.key)].sort((a, b) => a - b);
    const moving = sel.map(i => arr[i]), rest = arr.filter((_, i) => !selOf(d.key).has(i));
    const at = d.target - sel.filter(i => i < d.target).length;
    C()[d.key] = [...rest.slice(0, at), ...moving, ...rest.slice(at)];
    const next = selOf(d.key); next.clear(); moving.forEach((_, k) => next.add(at + k)); ANCHOR[d.key] = at;
    renderAll(); paintSel(d.key);
    commit(`Moved ${moving.length} image${moving.length > 1 ? 's' : ''}.`);
  }
  document.addEventListener('keydown', e => {
    if (!panelOpen() || e.target.closest('input, textarea, select, [contenteditable="true"]')) return;
    const key = Object.keys(SEL).find(k => SEL[k].size);
    if (!key) return;
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); removeSelected(key); }
    else if (e.key === 'Escape') { SEL[key].clear(); paintSel(key); }
  });

  /* ---------------------------------------- finding the right controls */
  const JUMPS = [['logos', 'Logos'], ['screens', 'Screens'], ['icons', 'Icons'], ['tech', 'Tools'], ['slots', 'Service art'], ['hero', 'Hero framing'], ['heroAnim', 'Hero animation'], ['board', 'Board size'], ['wall', 'Wall motion'], ['decor', 'Decorations']];
  function openSection(key) {
    const tab = $('.inspect-tab[data-tab="site"]'); if (tab && !tab.classList.contains('active')) tab.click();
    mountPanel();
    const d = $(`#czPanel details[data-key="${key}"]`); if (!d) return;
    d.open = true;
    d.scrollIntoView({ block: 'start', behavior: 'smooth' });
    d.classList.add('cz-flash'); setTimeout(() => d.classList.remove('cz-flash'), 1200);
  }
  // In the editor, clicking a part of the page opens its settings.
  const CANVAS = [['.cz-logos', 'logos'], ['.cz-wall', 'screens'], ['.cz-board', 'icons'], ['.cz-tech', 'tech'], ['.cz-card-art', 'slots'], ['.cz-avatar', 'slots']];
  document.addEventListener('click', e => {
    if (!editingNow() || document.body.classList.contains('previewing') || !e.target.closest) return;
    if (e.target.closest('.inspector, .layers, .devbar, .savebar, [data-node]')) return;
    const hit = CANVAS.find(([sel]) => e.target.closest(sel));
    if (hit) setTimeout(() => openSection(hit[1]), 0);
  });

  function mountPanel() {
    if (panelOpen()) return;
    const site = $('.inspector .tab-panel[data-tab="site"]');
    if (!site) return;
    const p = document.createElement('div');
    p.className = 'panel cz-panel'; p.id = 'czPanel';
    p.innerHTML = `<h4>Casino page</h4><p class="editor-note">Everything here is saved with Publish, like the rest of the page. Uploads are compressed to under 2MB. Tip: click the wall, logos, icons or tools on the page to jump to their settings.</p>
      <div class="cz-jump" role="group" aria-label="Jump to">${JUMPS.map(([k, l]) => `<button type="button" data-jump="${k}">${l}</button>`).join('')}</div><div class="cz-body-lists"></div>`;
    site.prepend(p);
    renderPanel();

    const onSet = e => {
      const t = e.target;
      if (!t.dataset || !t.dataset.set) return false;
      const path = t.dataset.set;
      const v = t.type === 'checkbox' ? t.checked : (t.type === 'range' || t.type === 'number') ? Number(t.value) : t.value;
      if (t.type === 'url' && e.type === 'input') return true;          // URLs apply on change
      setPath(path, v);
      $$(`[data-set="${path}"]`, p).forEach(i => { if (i !== t && i.type !== 'checkbox') i.value = v; });
      renderHero();
      if (path.startsWith('heroAnim.')) HeroMotion.apply();
      clearTimeout(p._s); p._s = setTimeout(() => commit(), 250);
      return true;
    };
    p.addEventListener('change', e => { if (e.target.dataset && e.target.dataset.set && (e.target.tagName === 'SELECT' || e.target.type === 'checkbox' || e.target.type === 'url')) onSet(e); });

    p.addEventListener('input', e => {
      if (e.target.dataset && e.target.dataset.set) { if (e.target.tagName !== 'SELECT' && e.target.type !== 'checkbox') onSet(e); return; }
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

    p.addEventListener('pointerdown', e => {
      const row = e.target.closest('.cz-list[data-list] .cz-row');
      if (!row || e.button !== 0 || e.target.closest('input, textarea, button, label, select')) return;
      e.preventDefault();
      const box = row.closest('[data-list]');
      drag = { key: box.dataset.list, box, i: Number(row.dataset.i), x: e.clientX, y: e.clientY, shift: e.shiftKey, meta: e.metaKey || e.ctrlKey, started: false };
      addEventListener('pointermove', onDragMove); addEventListener('pointerup', onDragEnd);
    });

    p.addEventListener('click', e => {
      const jb = e.target.closest('[data-jump]');
      if (jb) { openSection(jb.dataset.jump); return; }
      const sr = e.target.closest('[data-sel-remove]');
      if (sr) { removeSelected(sr.dataset.selRemove); return; }
      const sc = e.target.closest('[data-sel-clear]');
      if (sc) { selOf(sc.dataset.selClear).clear(); paintSel(sc.dataset.selClear); return; }
      const dd = e.target.closest('[data-decor-drag]');
      if (dd) {
        const on = document.body.classList.toggle('cz-decor-drag');
        dd.setAttribute('aria-pressed', String(on)); dd.textContent = on ? 'Stop dragging' : 'Drag decorations';
        if (typeof status === 'function') status(on ? 'Drag a ribbon or the sphere to move it. Click "Stop dragging" when done.' : 'Decoration dragging off.');
        return;
      }
      if (e.target.closest('[data-hero-replay]')) {
        // Preview hides the editor chrome and plays the hero from the top.
        const pv = document.querySelector('[data-preview], .devbar [data-toggle-preview]') || [...document.querySelectorAll('.devbar button')].find(b => /preview/i.test(b.textContent));
        if (pv) pv.click(); else if (typeof status === 'function') status('Use Preview in the top bar to watch the hero animation.');
        return;
      }
      const del = e.target.closest('[data-decor-del]');
      if (del) { C().decor.splice(Number(del.dataset.decorDel), 1); renderHero(); renderPanel(); commit('Decoration removed. Undo brings it back.'); return; }
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
        if (op.dataset.op === 'del') { arr.splice(i, 1); selOf(key).clear(); }
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
        if (t.hasAttribute('data-hero-video')) {
          const f = files[0];
          if (f.size > 2 * 1024 * 1024) { say(`That video is ${(f.size / 1048576).toFixed(1)}MB; the limit is 2MB. Re-export it smaller, or host it and paste the URL.`); return; }
          say('Uploading the video…');
          const res = typeof uploadMedia === 'function' ? await uploadMedia(f) : { ok: false, error: 'the editor is not loaded' };
          if (!res.ok) throw new Error(res.error || 'upload failed');
          C().heroAnim.video = res.src; C().heroAnim.poster = '';
          HeroMotion.apply(); renderPanel(); commit('Hero video replaced.');
          return;
        }
        if (t.hasAttribute('data-decor-add') || t.dataset.decorReplace !== undefined) {
          const it = await fileToItem(files[0]);
          if (t.hasAttribute('data-decor-add')) C().decor.push({ id: 'decor-' + Date.now().toString(36), section: 'works', src: it.src, x: 70, y: 20, w: 20, rot: 0, op: 0.6, hidden: false });
          else C().decor[Number(t.dataset.decorReplace)].src = it.src;
          renderHero(); renderPanel(); commit('Decoration saved.');
          return;
        }
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

  /* ------------------------------------------------ decoration dragging */
  document.addEventListener('pointerdown', e => {
    if (!editingNow() || !document.body.classList.contains('cz-decor-drag')) return;
    const img = e.target.closest && e.target.closest('.cz-decor');
    if (!img) return;
    e.preventDefault(); e.stopPropagation();
    const i = Number(img.dataset.decor), d = C().decor[i], layer = img.parentElement.getBoundingClientRect();
    const start = { x: e.clientX, y: e.clientY, dx: +d.x, dy: +d.y };
    const move = q => {
      d.x = Math.round((start.dx + (q.clientX - start.x) / layer.width * 100) * 10) / 10;
      d.y = Math.round((start.dy + (q.clientY - start.y) / layer.height * 100) * 10) / 10;
      img.style.setProperty('--dx', d.x + '%'); img.style.setProperty('--dy', d.y + '%');
    };
    const up = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); if (panelOpen()) renderPanel(); commit(`Decoration moved to ${d.x}% × ${d.y}%.`); };
    addEventListener('pointermove', move); addEventListener('pointerup', up);
  }, true);

  /* ---------------------------------------------------- editor wiring
   * applyState() (load, undo, redo, rollback) swaps G for a new object, so the
   * collections are redrawn after it. enter() builds the inspector, so the
   * panel mounts after it. Same wrap-the-global pattern as studio-links.js.
   */
  for (const [name, after] of [['applyState', renderAll], ['enter', () => setTimeout(() => { mountPanel(); renderPanel(); HeroMotion.apply(); }, 0)], ['exit', () => HeroMotion.apply()]]) {
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
  // For tests and the console; nothing on the page depends on it.
  window.CasinoPage = { renderAll, hero: HeroMotion, config: C };
})();
