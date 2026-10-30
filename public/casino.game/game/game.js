/* /casino.game/game/?g=<slug> — one playable demo's own page.
 *
 * The game comes from G.casino.demo / demo2: the defaults in casino-page.js,
 * then the published "casino" config on top (state.site.casino), merged the
 * same way casino.js merges them. Nothing of the game loads until Play now.
 *
 * Play now puts the game in .gp-stage (the big picture) and makes that element
 * full screen, inside the click (browsers refuse it after anything async).
 * Leaving full screen keeps the game playing in place. Where an element can't
 * go full screen (iPhone Safari), the stage covers the window instead.
 *
 * The feature chips talk to the game's embed bridge exactly like the casino
 * page does: the game says "hello" once it listens, the page answers with the
 * waiting feature.
 */
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const slugify = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

  const DEMO_KEYS = ['demo2', 'demo'];          // page order on /casino.game
  const DEMO_CHIPS = { demo: [['ex', 'EX NUDGE'], ['mega', 'MEGA WIN'], ['wheel', 'Bonus wheel']] };
  const STATS = [['rtp', 'RTP'], ['volatility', 'Volatility'], ['maxWin', 'Max multiplier'], ['reels', 'Reels'], ['released', 'Release date']];
  const def = (window.STUDIO_PAGE && window.STUDIO_PAGE.G && window.STUDIO_PAGE.G.casino) || {};

  const stage = $('.gp-stage'), shot = $('.gp-shot'), hint = $('.gp-stage-hint');
  let game = null, key = '', frame = null, pending = null, chipTimer = 0;

  async function published() {
    try {
      const r = await fetch('/api/config?version=casino', { cache: 'no-store' });
      const j = r.ok ? await r.json() : null;
      return (j && j.state && j.state.site && j.state.site.casino) || {};
    } catch { return {}; }
  }
  const merge = (pub, k) => ({ on: true, name: '', url: '', poster: '', features: [], tags: [], chips: true, gallery: [],
    ...JSON.parse(JSON.stringify(def[k] || {})), ...(pub[k] || {}) });
  const slugOf = (d, k) => d.slug || slugify(d.name) || k;
  const chipsOf = (d, k) => (Array.isArray(d.chipList) && d.chipList.length ? d.chipList : DEMO_CHIPS[k] || []);

  /* ------------------------------------------------------------ render */
  function render(all) {
    const want = new URLSearchParams(location.search).get('g') || '';
    const live = DEMO_KEYS.filter(k => all[k].on && all[k].url);
    key = live.find(k => slugOf(all[k], k) === want) || live.find(k => k === want) || live[0];
    if (!key) { location.replace('/casino.game/#works'); return; }
    game = all[key];
    const name = game.name || 'Game';
    document.title = `${name} — playable demo · Klyde Sosa`;
    $('.gp-crumb-name').textContent = name;
    $('.gp-title').textContent = name;

    $('.gp-stats').innerHTML = STATS.filter(([k]) => game[k]).map(([k, label]) =>
      `<div><dt>${label}</dt><dd>${esc(game[k])}</dd></div>`).join('');
    const pills = [game.featureBuy, ...(game.features || [])].filter(Boolean);
    $('.gp-pills').innerHTML = pills.map((f, i) => `<li${i === 0 && game.featureBuy ? ' class="buy"' : ''}>${esc(f)}</li>`).join('');
    $('.gp-about-text').textContent = game.about || '';
    $('.gp-tags').innerHTML = (game.tags || []).filter(Boolean).map(t => `<li>${esc(t)}</li>`).join('');

    const chips = game.chips ? chipsOf(game, key) : [];
    $('.gp-try').hidden = !chips.length && live.length < 2;
    $('.gp-chips').innerHTML = chips.map(([id, l]) => `<button type="button" class="gp-chip" data-feature="${esc(id)}">${esc(l)}</button>`).join('');
    // The other demo(s), so a visitor can hop across without going back.
    $('.gp-other').innerHTML = live.filter(k => k !== key).map(k => {
      const o = all[k];
      return `<a class="gp-other-card" href="?g=${encodeURIComponent(slugOf(o, k))}">${o.poster ? `<img src="${esc(o.poster)}" alt="" loading="lazy" decoding="async">` : ''}<span><small>Also playable</small>${esc(o.name || 'Game')}</span></a>`;
    }).join('');

    // Pictures: the start screen first, then the gameplay screens.
    const pics = [game.poster, ...(game.gallery || [])].filter(Boolean);
    $('.gp-thumbs').innerHTML = pics.map((src, i) =>
      `<li><button type="button" data-pic="${i}" aria-label="Screenshot ${i + 1} of ${pics.length}"${i === 0 ? ' aria-current="true"' : ''}><img src="${esc(src)}" alt="" loading="${i < 5 ? 'eager' : 'lazy'}" decoding="async"></button></li>`).join('');
    $('.gp-thumbs').hidden = pics.length < 2;
    show(0, pics);
    document.body.classList.add('gp-ready');
  }

  function show(i, pics = [game.poster, ...(game.gallery || [])].filter(Boolean)) {
    if (!pics[i]) return;
    shot.src = pics[i];
    shot.alt = i === 0 ? `${game.name}: start screen` : `${game.name}: gameplay screenshot ${i}`;
    $$('.gp-thumbs [data-pic]').forEach(b => b.toggleAttribute('aria-current', Number(b.dataset.pic) === i));
  }

  /* -------------------------------------------------------------- play */
  const origin = () => { try { return new URL(game.url, location.href).origin; } catch { return ''; } };

  function start() {
    if (frame) return;
    const f = document.createElement('iframe');
    f.src = game.url; f.dataset.src = game.url;
    f.title = `${game.name || 'Game'}: playable demo`;
    f.allow = 'autoplay; fullscreen';
    f.setAttribute('allowfullscreen', '');
    f.addEventListener('load', () => setTimeout(() => { if (frame === f) { f.classList.add('live'); stage.classList.remove('loading'); } }, 250), { once: true });
    stage.classList.add('playing', 'loading');
    hint.textContent = 'Loading the game…';
    stage.appendChild(f);
    frame = f;
  }
  function stop() {
    if (document.fullscreenElement === stage) document.exitFullscreen().catch(() => {});
    if (frame) frame.remove();
    frame = null; pending = null; waitChip(null);
    stage.classList.remove('playing', 'loading', 'covering');
    document.body.classList.remove('gp-covered');
  }
  function play(feature) {
    if (!game) return;
    if (feature) { pending = feature; waitChip(feature); }
    const req = stage.requestFullscreen || stage.webkitRequestFullscreen;
    const inFull = document.fullscreenElement === stage || stage.classList.contains('covering');
    if (!inFull) {
      // Inside the click, before anything async, or the browser refuses it.
      let r;
      try { r = req ? req.call(stage) : Promise.reject(); } catch { r = Promise.reject(); }
      if (r && r.catch) r.catch(() => cover());
    }
    start();
    send();
  }
  // No element fullscreen (iPhone Safari): the stage covers the window.
  function cover() {
    stage.classList.add('covering');
    document.body.classList.add('gp-covered');
  }
  function uncover() {
    stage.classList.remove('covering');
    document.body.classList.remove('gp-covered');
  }

  function waitChip(id) {
    clearTimeout(chipTimer);
    $$('.gp-chip').forEach(b => b.classList.toggle('waiting', b.dataset.feature === id));
    if (id) chipTimer = setTimeout(() => waitChip(null), 20000);
  }
  function send() {
    if (!pending || !frame || !frame.dataset.hello || !frame.contentWindow) return;
    frame.contentWindow.postMessage({ jj: 'feature', id: pending }, origin());
    pending = null;
  }
  addEventListener('message', e => {
    if (!frame || e.source !== frame.contentWindow || e.origin !== origin()) return;
    const d = e.data || {};
    if (d.jj === 'hello' || d.jj === 'ready') { frame.dataset.hello = '1'; send(); }
    else if (d.jj === 'played') waitChip(null);
  });

  /* ------------------------------------------------------------- copy */
  async function copyLink(btn) {
    const url = location.origin + location.pathname + '?g=' + encodeURIComponent(slugOf(game, key));
    let ok = false;
    try { await navigator.clipboard.writeText(url); ok = true; } catch {
      const t = document.createElement('textarea');
      t.value = url; t.setAttribute('readonly', ''); t.style.cssText = 'position:fixed;opacity:0';
      document.body.appendChild(t); t.select();
      try { ok = document.execCommand('copy'); } catch { ok = false; }
      t.remove();
    }
    const label = $('span', btn);
    label.textContent = ok ? 'Link copied' : url;
    btn.classList.toggle('done', ok);
    clearTimeout(btn._t); btn._t = setTimeout(() => { label.textContent = 'Copy demo link'; btn.classList.remove('done'); }, 2200);
  }

  document.addEventListener('click', e => {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.matches('[data-pic]')) { if (frame) stop(); show(Number(t.dataset.pic)); }
    else if (t.matches('[data-play]')) play();
    else if (t.matches('[data-feature]')) play(t.dataset.feature);
    else if (t.matches('[data-stop]')) { if (stage.classList.contains('covering')) uncover(); else stop(); }
    else if (t.matches('[data-copy]')) copyLink(t);
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && stage.classList.contains('covering')) { e.preventDefault(); uncover(); }
  });
  // Arrow keys step through the screenshots while the game isn't running.
  $('.gp-thumbs').addEventListener('keydown', e => {
    if (!/^Arrow(Up|Down|Left|Right)$/.test(e.key)) return;
    const btns = $$('.gp-thumbs [data-pic]'), i = btns.indexOf(document.activeElement);
    if (i < 0) return;
    e.preventDefault();
    const n = btns[(i + (/Up|Left/.test(e.key) ? -1 : 1) + btns.length) % btns.length];
    n.focus(); n.click();
  });

  // Defaults render at once; the published config re-renders on top if it differs.
  const local = Object.fromEntries(DEMO_KEYS.map(k => [k, merge({}, k)]));
  render(local);
  published().then(pub => {
    if (!DEMO_KEYS.some(k => pub[k])) return;
    if (frame) return;              // never yank a running game
    render(Object.fromEntries(DEMO_KEYS.map(k => [k, merge(pub, k)])));
  });
})();
