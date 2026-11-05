/* /casino.game/game/?g=<slug> — one playable demo's own page.
 *
 * The game comes from G.casino.demo / demo2 / demo3: the defaults in casino-page.js,
 * then the published "casino" config on top (state.site.casino), merged the
 * same way casino.js merges them. Nothing of the game loads until Play now.
 *
 * The game plays in its own section, #play: Play now (and the big picture's
 * play button) scroll down to it and start the game there. Full screen makes
 * the player element full screen, inside the click (browsers refuse it after
 * anything async); leaving it keeps the game playing in place. Where an
 * element can't go full screen (iPhone Safari), the player covers the window.
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

  const DEMO_KEYS = ['demo3', 'demo2', 'demo'];          // page order on /casino.game
  const DEMO_CHIPS = { demo: [['ex', 'EX NUDGE'], ['mega', 'MEGA WIN'], ['wheel', 'Bonus wheel']] };
  const STATS = [['rtp', 'RTP'], ['volatility', 'Volatility'], ['maxWin', 'Max multiplier'], ['reels', 'Reels'], ['released', 'Release date']];
  const def = (window.STUDIO_PAGE && window.STUDIO_PAGE.G && window.STUDIO_PAGE.G.casino) || {};

  const shot = $('.gp-shot'), section = $('.gp-play'), player = $('.gp-player'), hint = $('.gp-player-hint');
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
    document.title = `${name} — playable prototype · Klyde Sosa`;
    $('.gp-crumb-name').textContent = name;
    $('.gp-title').textContent = name;
    $('#gp-play-title').textContent = `Play ${name}`;
    const poster = $('.gp-player-poster');
    if (game.poster) { poster.src = game.poster; poster.alt = `${name}: start screen`; }
    $('.gp-player-start').setAttribute('aria-label', `Play ${name} here`);

    $('.gp-stats').innerHTML = STATS.filter(([k]) => game[k]).map(([k, label]) =>
      `<div><dt>${label}</dt><dd>${esc(game[k])}</dd></div>`).join('');
    const pills = [game.featureBuy, ...(game.features || [])].filter(Boolean);
    $('.gp-pills').innerHTML = pills.map((f, i) => `<li${i === 0 && game.featureBuy ? ' class="buy"' : ''}>${esc(f)}</li>`).join('');
    $('.gp-about-text').textContent = game.about || '';
    $('.gp-tags').innerHTML = (game.tags || []).filter(Boolean).map(t => `<li>${esc(t)}</li>`).join('');

    const chips = game.chips ? chipsOf(game, key) : [];
    $('.gp-try').classList.toggle('no-chips', !chips.length);
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
    f.title = `${game.name || 'Game'}: playable prototype`;
    f.allow = 'autoplay; fullscreen';
    f.setAttribute('allowfullscreen', '');
    f.addEventListener('load', () => setTimeout(() => reveal(f), 250), { once: true });
    player.classList.add('playing', 'loading');
    section.classList.add('playing');
    hint.textContent = 'Loading the game…';
    player.appendChild(f);
    frame = f;
  }
  // Shown on the frame's load, or earlier when the game says hello (a game
  // that streams its assets can be playable long before 'load' fires).
  function reveal(f) {
    if (frame !== f) return;
    f.classList.add('live'); player.classList.remove('loading');
  }
  function stop() {
    if (document.fullscreenElement === player) document.exitFullscreen().catch(() => {});
    if (frame) frame.remove();
    frame = null; pending = null; waitChip(null);
    player.classList.remove('playing', 'loading', 'covering');
    section.classList.remove('playing');
    document.body.classList.remove('gp-covered');
  }
  function restart() {
    if (!frame) return start();
    frame.remove(); frame = null;
    start();
  }
  // From outside the section (Play now, the big picture) the page first
  // brings the player into view.
  function play(feature, scroll) {
    if (!game) return;
    if (feature) { pending = feature; waitChip(feature); }
    if (scroll) {
      // Centre the player itself (not the section, which is taller).
      const r = player.getBoundingClientRect();
      if (r.top < 0 || r.bottom > innerHeight) {
        const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
        const top = scrollY + r.top - Math.max(8, (innerHeight - r.height) / 2);
        window.scrollTo({ top, behavior: reduce ? 'auto' : 'smooth' });
      }
    }
    start();
    send();
  }
  function full() {
    if (!game) return;
    const req = player.requestFullscreen || player.webkitRequestFullscreen;
    if (document.fullscreenElement !== player && !player.classList.contains('covering')) {
      // Inside the click, before anything async, or the browser refuses it.
      let r;
      try { r = req ? req.call(player) : Promise.reject(); } catch { r = Promise.reject(); }
      if (r && r.catch) r.catch(() => cover());
    }
    start();
  }
  // No element fullscreen (iPhone Safari): the player covers the window.
  function cover() {
    player.classList.add('covering');
    document.body.classList.add('gp-covered');
  }
  function uncover() {
    player.classList.remove('covering');
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
    if (d.jj === 'hello' || d.jj === 'ready') { frame.dataset.hello = '1'; reveal(frame); send(); }
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
    clearTimeout(btn._t); btn._t = setTimeout(() => { label.textContent = 'Copy link'; btn.classList.remove('done'); }, 2200);
  }

  document.addEventListener('click', e => {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.matches('[data-pic]')) show(Number(t.dataset.pic));
    else if (t.matches('[data-play]')) play(null, true);
    else if (t.matches('[data-start]')) play();
    else if (t.matches('[data-feature]')) play(t.dataset.feature, true);
    else if (t.matches('[data-full]')) full();
    else if (t.matches('[data-restart]')) restart();
    else if (t.matches('[data-stop]')) { if (player.classList.contains('covering')) uncover(); else stop(); }
    else if (t.matches('[data-copy]')) copyLink(t);
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && player.classList.contains('covering')) { e.preventDefault(); uncover(); }
  });
  // Arrow keys step through the screenshots.
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
