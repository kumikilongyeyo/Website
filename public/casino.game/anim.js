/* /casino.game — Animation showcase (#animation).
 *
 * The shipped Spine 4.2 exports of Mayan Wild Throw and Spice Rush, playing
 * live: reel symbols (as a full set, or one at a time), the Xolo mascot, big
 * win screens and FX. Every skeleton draws on ONE WebGL canvas (the stage), so
 * the page never holds more than one GL context however much it shows.
 *
 * Files: /casino.game/assets/anim/v1/<id>/ (.skel, .atlas, premultiplied WebP
 * pages from the games' hand-offs; Spice Rush's PNG pages encoded q90; the shader clamps the stray
 * colour WebP leaves under transparent pixels, see boot()). The runtime
 * (/casino.game/vendor/spine-webgl-4.2.98.min.js, the Mayan game's copy) loads
 * only when the section comes near the viewport, and the stage renders only
 * while it is on screen.
 *
 * A "play" string drives one skeleton for one state: tracks split by '|', each
 * a queue of animation names; 'name*' loops, 'name@1.2' starts 1.2 s after the
 * previous one started (otherwise when it ends), '' holds the setup pose. A
 * state whose queues end replays after HOLD seconds, so every state keeps moving.
 *
 * Rendered markup carries no data-node: the editor only sees the heading.
 */
(function () {
  'use strict';
  const root = document.querySelector('[data-an]');
  if (!root) return;

  const BASE = '/casino.game/assets/anim/v2/';
  const RUNTIME = '/casino.game/vendor/spine-webgl-4.2.98.min.js';
  const HOLD = 1.1;           // seconds a finished state rests before it replays
  const FADE = 0.16;          // fade-in when a state replays from its first frame
  const KEEP_VIEWS = 2;       // views whose textures stay loaded (the current one + the last)
  const MAYAN = 'Mayan Wild Throw', SPICY = 'Spice Rush';
  const reduce = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  /* ------------------------------------------------------------ the catalogue */

  // Download size of each folder (skeleton + atlas + pages), MB.
  const SIZE = {
    ma_bigwin: 5.99, ma_chalice: 1.12, ma_coins: .20, ma_eagle: .21, ma_exnudge: .48, ma_intro: .65, ma_jaguar: .42, ma_lp: .18, ma_orb: 2.90, ma_scatter: 1.09, ma_screech: .82, ma_wild: 1.22, ma_wyrm: .97, sp_antic: 1.54, sp_bigwin: 3.37, sp_coin: .23, sp_coins: .22, sp_comet: .24, sp_fire: 1.56, sp_flame: .86, sp_hat: 1.14, sp_lp: 1.50, sp_medal: 1.60, sp_sauce: 1.10, sp_scatter: 2.04, sp_tortilla: 1.03, sp_wild: 1.75, sp_xolo: 1.05,
  };



  // Mayan high pays share one rig layout: two landings, two win takes.
  const maHP = (id, name, desc) => ({
    id, file: 'hp_' + id.slice(3) + '_1tile', name, tag: 'High pay', desc,
    card: { w: 255, h: 222 },
    play: { landing: 'landing_1', win: 'activated_1', win2: 'activated_2' },
    states: [['Landing', 'landing_1'], ['Landing · side', 'landing_side'], ['Win · take 1', 'activated_1'], ['Win · take 2', 'activated_2']],
  });
  const maLP = (skin) => ({
    id: 'ma_lp', file: 'lp_stone', skin, name: skin, tag: 'Low pay',
    desc: 'Limestone low pays on one skeleton, a skin per letter. The landing stops dead with one hard jolt; the win gathers light, cracks three times and breaks into stone chunks, leaving the cell empty.',
    card: { w: 250, h: 203 },
    play: { landing: 'landing', win: 'activated', win2: 'activated' },
    states: [['Landing', 'landing'], ['Landing · side', 'landing_side'], ['Win', 'activated']],
  });
  // Spice Rush symbols sit in a 110 px cell at the game's own scale and offset (reels.ts HP_SPINE).
  const spLP = (skin, dx, dy) => ({
    id: 'sp_lp', file: 'spicy_lp', skin, name: skin, tag: 'Low pay', scale: .26059, dx, dy,
    desc: 'A K Q J on one skeleton. A physical drop on landing; on a win the outline glows, the fire flows outward, the letter stamps up and burns out.',
    play: { landing: 'landing', win: 'activated' },
    states: [['Landing', 'landing'], ['Win', 'activated']],
  });

  const SETS = {
    mayan: {
      game: MAYAN, name: 'Full symbol set', cell: { w: 256, h: 223 },
      desc: 'Every reel symbol of the Mayan game at once. Stone low pays break on a win; the high pays climb out of their frame first, then crack and break like the stones. Phone build: 256 px symbols, WebP atlases.',
      states: [['landing', 'Landing'], ['antic', 'Anticipation'], ['win', 'Win · take 1'], ['win2', 'Win · take 2']],
      items: {
        wild: {
          id: 'ma_wild', file: 'wild_1tile', atlas: 'wild', name: 'Wild', tag: 'Wild', card: { w: 261, h: 259, cx: -3.5, cy: 17.5 },
          desc: 'The death-whistle skull on its magenta card. It lands, then screeches: a shimmer, the stamp, energy into the blow hole and sonic rings. Vanish burns it away into embers.',
          play: { landing: 'land_1', win: 'activated_2', win2: 'activated_2' },
          states: [['Landing', 'land_1'], ['Screech', 'activated_2'], ['Vanish', 'vanish_1']],
        },
        wyrm: maHP('ma_wyrm', 'Serpent', 'The extreme take: the serpent rears up out of its frame and roars with a head thrash while its scales ripple and a depth shine sweeps across.'),
        jaguar: maHP('ma_jaguar', 'Jaguar', 'Leaps out of the frame, head up, jaw wide; the roar is one soft pulsing smoke ripple from After Effects. Take 2 rumbles, creeps out growling, lunges and slams back.'),
        chalice: maHP('ma_chalice', 'Chalice', 'A heavy lift, then a slow 2.5D turn: the band and mask slide around the round cup while the outline stays, and a surface shine sweeps across before it is set down with weight.'),
        eagle: maHP('ma_eagle', 'Eagle', 'Lifts out of its frame, the four feathers fan open and rattle out of step, and the beak screeches. Take 2 runs two rattle waves up the fan.'),
        scatter: {
          id: 'ma_scatter', file: 'scatter_1tile', atlas: 'scatter', name: 'Scatter', tag: 'Scatter', card: { w: 263, h: 259, cx: -3.5, cy: 17.5 },
          desc: 'The Mayan warrior. Drops in as SCATTER stamps, idles with a slow letter wave, burns his border with lit eyes during anticipation, and on the trigger turns his head in 2.5D with a wink and a smirk.',
          rest: 'idle* | glow*',
          play: { landing: 'land idle* | glow*', antic: 'anticipation* | glow*', win: 'activated | glow*', win2: 'activated | glow*' },
          states: [['Landing', 'land idle* | glow*'], ['Idle', 'idle* | glow*'], ['Anticipation', 'anticipation* | glow*'], ['Trigger', 'activated | glow*']],
        },
        A: maLP('A'), K: maLP('K'), Q: maLP('Q'), J: maLP('J'), n10: maLP('10'),
      },
      rows: [['wild', 'wyrm', 'jaguar', 'chalice', 'eagle', 'scatter'], ['A', 'K', 'Q', 'J', 'n10']],
      narrow: [['wild', 'wyrm', 'jaguar'], ['chalice', 'eagle', 'scatter'], ['A', 'K', 'Q'], ['J', 'n10']],
    },
    spicy: {
      game: SPICY, name: 'Full symbol set', cell: { w: 98, h: 98 },
      desc: 'Every reel symbol of Spice Rush at once. The food high pays bounce with spring follow-through and burn on a win; the letters drop and stamp; the Wild and the Scatter carry their own idle and anticipation loops.',
      states: [['landing', 'Landing'], ['antic', 'Anticipation'], ['win', 'Win']],
      items: {
        wild: {
          id: 'sp_wild', file: 'spicy_wild', name: 'Wild', tag: 'Wild', scale: .25906, dx: 5.2, dy: -3.33,
          desc: 'A jolt on landing, a subtle idle loop, an intro that scales the Wild up from nothing with a shine, and the win: high-pay fire, a text stamp and a depth shimmer.',
          rest: 'idle*', play: { landing: 'landing idle*', win: 'activated' },
          states: [['Intro', 'intro idle*'], ['Landing', 'landing idle*'], ['Idle', 'idle*'], ['Win', 'activated']],
        },
        hat: {
          id: 'sp_hat', file: 'spicy_hp_hat', name: 'Sombrero', tag: 'High pay', scale: .18577, dy: 1.64,
          desc: 'A drop and a rotational jolt that shakes out in a third of a second; the win reuses the high-pay fire, glow and stamp.',
          play: { landing: 'landing', win: 'activated' }, states: [['Landing', 'landing'], ['Win', 'activated']],
        },
        tortilla: {
          id: 'sp_tortilla', file: 'spicy_hp_tortilla', name: 'Taco', tag: 'High pay', scale: .21131, dx: .59, dy: -2.03,
          desc: 'The same jolt landing as the sombrero; the filling is its own mesh pinned along the cut, so it moves inside the shell on the win.',
          play: { landing: 'landing', win: 'activated' }, states: [['Landing', 'landing'], ['Win', 'activated']],
        },
        medal: {
          id: 'sp_medal', file: 'spicy_hp_medal', name: 'Medal', tag: 'High pay', scale: .22932, dx: -4.36, dy: -2.64,
          desc: 'The lanyard follows through on landing like a spring. The win: fire and glow behind, scale up, a wiggle and a tilt with a soft flash, then it scales away.',
          rest: 'idle*', play: { landing: 'landing idle*', win: 'activated' },
          states: [['Landing', 'landing idle*'], ['Idle', 'idle*'], ['Win', 'activated']],
        },
        sauce: {
          id: 'sp_sauce', file: 'spicy_hp_sauce', name: 'Hot sauce', tag: 'High pay', scale: .27799, dx: -2.63, dy: -4.66,
          desc: 'The bottle bounces and the spices follow through. On a win the spices tilt and spin with the bottle before everything scales to nothing.',
          rest: 'idle*', play: { landing: 'landing idle*', win: 'activated' },
          states: [['Landing', 'landing idle*'], ['Idle', 'idle*'], ['Win', 'activated']],
        },
        scatter: {
          id: 'sp_scatter', file: 'spicy_scatter', name: 'Scatter', tag: 'Scatter', scale: .246, grid: .66,
          desc: 'Lands once and settles into its loop; anticipation and the trigger burn with After Effects fire made from the game art\'s own fire layer.',
          rest: 'land_loop*', play: { landing: 'land land_loop*', antic: 'anticipation*', win: 'activated*' },
          states: [['Landing', 'land land_loop*'], ['Idle', 'land_loop*'], ['Anticipation', 'anticipation*'], ['Trigger', 'activated*']],
        },
        A: spLP('A', .65, 3.09), K: spLP('K', -1.7, 1.26), Q: spLP('Q', 4.15, 7.52), J: spLP('J', 8.99, 3.35),
      },
      rows: [['wild', 'hat', 'tortilla', 'medal', 'sauce', 'scatter'], ['A', 'K', 'Q', 'J']],
      narrow: [['wild', 'hat', 'tortilla'], ['medal', 'sauce', 'scatter'], ['A', 'K'], ['Q', 'J']],
    },
  };
  for (const set of Object.values(SETS)) for (const [k, it] of Object.entries(set.items)) { it.key = k; it.game = set.game; }

  const XOLO = {
    id: 'sp_xolo', file: 'xolo', name: 'Xolo', tag: 'Mascot', game: SPICY, frame: { k: .8, on: 'setup' },
    desc: 'The Spice Rush mascot, rigged with 2.5D turn constraints and a weighted face. He reacts to the game: a slam on a big hit, wins, the spice heat building from sweat to steam out of his ears, cooling down, and the fire breath that sweeps the reels.',
    states: [
      ['Idle', 'idle*'], ['Slam', 'slam idle*'], ['Win A', 'win_a idle*'], ['Win B', 'win_b idle*'], ['Spicy', 'spicy idle*'],
      ['Sweat', 'sweat idle*'], ['Hot puff', 'hot_puff idle*'], ['Hot max', 'hot_max idle*'], ['Cool down', 'cool_down idle*'],
      ['Fire sweep →', 'fire_sweep_LtoR idle*'], ['Fire sweep ←', 'fire_sweep_RtoL idle*'],
    ],
  };

  const BIGWIN = [
    {
      id: 'sp_bigwin', file: 'spicy_bigwin', name: 'Big Win', tag: 'Win screen', game: SPICY, frame: { k: .96, on: 'setup', box: [-700, -650, 700, 950] },
      desc: 'Xolo, BIG WIN and the amount fall in and slam, a shock wave leaves the After Effects fire ring, confetti fountains up and the game\'s own chili coin splash rains behind. The amount is a placeholder the game replaces with its counting label.',
      states: [
        ['Intro', 'A_drop_in A_drop_loop* | coins_loop* | count count count count count_end'],
        ['Loop', 'A_drop_loop* | coins_loop*'], ['Outro', 'A_drop_loop* out@1.4 | coins_loop*'],
      ],
    },
    {
      id: 'ma_bigwin', file: 'bigwin', name: 'Big Win', tag: 'Win screen', game: MAYAN, frame: { k: .96, on: 'setup' },
      desc: '"Jade Burst": a boom, the hero and BIG WIN pop in, the plaque\'s frames burst open to full length, the amount counts up, then a finale and a 4 s loop. In the game the digit slots show the real amount.',
      states: [['Intro', 'intro loop*'], ['Loop', 'loop*'], ['Outro', 'loop* outro@1.6']],
    },
  ];

  const FX = [
    { id: 'sp_fire', file: 'spicy_fire', name: 'Fire', tag: 'Additive FX', game: SPICY,
      desc: 'Three additive takes of the game\'s fire, made from its fx PSB: a steady flow (the one that burns behind winning symbols), a pulse and a one-shot burst.',
      states: [['Flow', 'fire_flow*'], ['Pulse', 'fire_pulse*'], ['Burst', 'fire_burst']] },
    { id: 'sp_flame', file: 'flamethrower', name: 'Flamethrower', tag: 'AE → Spine', game: SPICY,
      desc: 'Xolo\'s fire breath: an IK-aimed jet that the game points at any reel cell, plus sweeps timed to his fire sweep.',
      states: [['Point', 'point_in point_loop* point_out@1.6'], ['Sweep →', 'sweep_LtoR'], ['Sweep ←', 'sweep_RtoL']] },
    { id: 'sp_antic', file: 'spicy_anticipation', name: 'Reel anticipation', tag: 'AE → Spine', game: SPICY,
      desc: 'The reel-edge fire that teases the third Scatter: a scrolling fire strip with embers and a caustic smoke wave beside it.',
      states: [['In → blaze', 'antic_in v3_blaze*'], ['Blaze', 'v3_blaze*'], ['Out', 'v3_blaze* antic_out@1.4']] },
    { id: 'ma_orb', file: 'multiplier_orb', name: 'Multiplier orb', tag: 'AE → Spine', game: MAYAN, frame: { k: .42, on: 'setup' },
      skins: [['green', 'Green'], ['red', 'Red'], ['blue', 'Blue'], ['violet', 'Violet'], ['max', 'MAX']],
      desc: 'Five orbs on one skeleton (MAX hue-switches), with After Effects ripples, comets and smoke shocks. The number is drawn by the game.',
      states: [['Active', 'active_v1*'], ['Active · B', 'active_v2*'], ['Anticipation', 'anticipation_v1*'], ['Activated', 'activated_v1'], ['Activated · B', 'activated_v2']],
      skinStates: { max: [['Idle', 'max_idle_v1*'], ['Idle · B', 'max_idle_v2*'], ['Activated', 'max_activated_v1'], ['Activated · B', 'max_activated_v2']] } },
    { id: 'ma_exnudge', file: 'exnudge', name: 'EX NUDGE orb', tag: 'Feature FX', game: MAYAN,
      desc: 'A dip, a flash-glow with a rainbow puff, EX and NUDGE slam in, a letter wave, a sideways nudge and a shine. It starts and ends on its rest pose, so it loops.',
      states: [['Active', 'exnudge_active']] },
    { id: 'sp_coins', file: 'coin_splash', name: 'Chili coin splash', tag: 'Particles', game: SPICY,
      desc: 'The chili coin splash: a burst, or a spray across the screen either way. The big win reuses it unchanged.',
      states: [['Burst', 'splash_burst'], ['Left → right', 'splash_left_to_right'], ['Right → left', 'splash_right_to_left']] },
    { id: 'ma_coins', file: 'coin_splash', name: 'Gold coin splash', tag: 'Particles', game: MAYAN,
      desc: 'Gold coins for the Mayan win banner, in four directions.',
      states: [['Burst', 'splash_burst'], ['Up', 'splash_up'], ['Down', 'splash_down'], ['Sides', 'splash_sides']] },
    { id: 'sp_comet', file: 'heat_comet', name: 'Heat comet', tag: 'Additive FX', game: SPICY,
      desc: 'Heat comets that carry a value across the board, in three lengths.',
      states: [['Short', 'comet_s'], ['Medium', 'comet_m'], ['Long', 'comet_l']] },
    { id: 'ma_screech', file: 'screech', name: 'Screech', tag: 'AE → Spine', game: MAYAN,
      desc: 'The Screech Wild\'s pieces from After Effects: the screech, the impact on the symbol it converts, and the wave.',
      states: [['Screech', 'screech'], ['Impact', 'impact'], ['Wave', 'wave']] },
    { id: 'sp_coin', file: 'coin', name: 'Chili coin', tag: 'Spin', game: SPICY,
      desc: 'A single chili coin turning on its edge.', states: [['Turn', 'turn*']] },
    { id: 'ma_intro', file: 'wall_open', name: 'Temple wall intro', tag: 'Intro', game: MAYAN, frame: { k: .96, on: 'setup' },
      desc: 'The temple wall that opens on the game.', states: [['Open', 'open']] },
  ];

  const TABS = [
    { key: 'symbols', label: 'Symbols' },
    { key: 'character', label: 'Character', items: [XOLO] },
    { key: 'bigwin', label: 'Big Win', items: BIGWIN },
    { key: 'fx', label: 'FX', items: FX },
  ];

  /* ---------------------------------------------------------------- markup */

  const $ = (s, el = root) => el.querySelector(s);
  const h = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
  const stage = $('.an-stage'), canvas = $('.an-stage canvas');
  const ui = {
    tabs: $('.an-tabs'), games: $('.an-games'), picker: $('.an-picker'), eyebrow: $('.an-eyebrow'), name: $('.an-name'),
    desc: $('.an-desc'), range: $('.an-range'), pills: $('.an-pills'), stateName: $('.an-state-name'),
    stateCount: $('.an-state-count'), ticks: $('.an-ticks'), skins: $('.an-skins'), specs: $('.an-specs'), load: $('.an-load'),
    bar: $('.an-bar i'), play: $('[data-an-play]'), replay: $('[data-an-replay]'), speed: $('[data-an-speed]'),
  };

  let tab = 'symbols', game = 'mayan', pick = 'all', skin = null, stateIx = 0, speed = 1;
  let paused = reduce;

  TABS.forEach((t) => {
    const b = h('button', 'an-tab');
    b.append(h('span', 'an-tab-n', String(TABS.indexOf(t) + 1).padStart(2, '0')), h('span', 'an-tab-l', t.label),
      h('span', 'an-tab-c', t.key === 'symbols' ? Object.values(SETS).reduce((n, x) => n + Object.keys(x.items).length, 0) + ' symbols' : t.items.length + (t.items.length > 1 ? ' pieces' : ' rig')));
    b.type = 'button'; b.setAttribute('role', 'tab'); b.dataset.tab = t.key;
    b.addEventListener('click', () => { if (tab !== t.key) { tab = t.key; pick = t.key === 'symbols' ? 'all' : 0; skin = null; stateIx = 0; show(); } });
    ui.tabs.append(b);
  });
  ui.tabs.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const i = TABS.findIndex((t) => t.key === tab), n = TABS[(i + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length];
    ui.tabs.querySelector(`[data-tab="${n.key}"]`).click(); ui.tabs.querySelector(`[data-tab="${n.key}"]`).focus();
  });
  [['mayan', MAYAN], ['spicy', SPICY]].forEach(([k, label]) => {
    const b = h('button', 'an-game', label);
    b.type = 'button'; b.dataset.game = k;
    b.addEventListener('click', () => { if (game !== k) { game = k; pick = 'all'; stateIx = 0; show(); } });
    ui.games.append(b);
  });

  ui.range.addEventListener('input', () => setState(+ui.range.value));
  ui.play.addEventListener('click', () => { paused = !paused; syncTransport(); kick(); });
  ui.replay.addEventListener('click', () => { if (view) { restart(); paused = false; syncTransport(); kick(); } });
  ui.speed.addEventListener('click', () => { speed = speed === 1 ? .5 : speed === .5 ? .25 : 1; syncTransport(); });
  function syncTransport() {
    ui.play.setAttribute('aria-pressed', String(!paused));
    ui.play.querySelector('span').textContent = paused ? 'Play' : 'Pause';
    ui.play.classList.toggle('is-paused', paused);
    ui.speed.querySelector('span').textContent = speed === 1 ? '1×' : speed === .5 ? '0.5×' : '0.25×';
  }

  // thumbs are optional: a chip shows its picture once it has loaded
  const thumbOf = (it) => BASE + 'thumbs/' + it.id + (it.skin ? '_' + it.skin : '') + '.webp';
  function chip(label, sub, it, on, click) {
    const b = h('button', 'an-chip' + (on ? ' on' : ''));
    b.type = 'button';
    b.setAttribute('aria-pressed', String(!!on));
    const th = h('span', 'an-thumb');
    if (it) {
      const img = new Image();
      img.alt = ''; img.decoding = 'async'; img.loading = 'lazy';
      img.onload = () => th.classList.add('has');
      img.src = it === 'all' ? BASE + 'thumbs/set_' + game + '.webp' : thumbOf(it);
      th.append(img);
    }
    const tx = h('span', 'an-chip-tx');
    tx.append(h('b', null, label));
    if (sub) tx.append(h('small', null, sub));
    b.append(th, tx);
    b.addEventListener('click', click);
    return b;
  }

  /* ----------------------------------------------------------- the runtime */

  let spine = null, ctx = null, scene = null, gl = null, booting = null;
  function boot() {
    booting ||= new Promise((res, rej) => {
      if (window.spine && window.spine.SceneRenderer) return res(window.spine);
      const s = document.createElement('script');
      s.src = RUNTIME; s.async = true;
      s.onload = () => (window.spine ? res(window.spine) : rej(new Error('spine runtime missing')));
      s.onerror = () => rej(new Error('spine runtime failed to load'));
      document.head.append(s);
    }).then((sp) => {
      spine = sp;
      ctx = new spine.ManagedWebGLRenderingContext(canvas, { alpha: true, premultipliedAlpha: true, antialias: true });
      gl = ctx.gl;
      if (!gl) throw new Error('no WebGL');
      scene = new spine.SceneRenderer(canvas, ctx, true);
      // Every page here is premultiplied, so a texel's colour can never exceed its alpha. WebP encoders still leave colour
      // under fully transparent pixels (lossy noise, or "don't care" pixels even when lossless), and premultiplied
      // blending ADDS it: speckle around every edge (the Xolo "dithering"), or solid blocks. Clamp it as it is read.
      const sh = scene.batcherShader, read = 'vec4 texColor = texture2D(u_texture, v_texCoords);';
      if (sh.fsSource && sh.fsSource.includes(read)) {
        scene.batcherShader = new spine.Shader(ctx, sh.vsSource, sh.fsSource.replace(read, read + '\n\ttexColor.rgb = min(texColor.rgb, vec3(texColor.a));'));
        sh.dispose();
      }
      return spine;
    });
    return booting;
  }

  const assets = new Map(); // id -> { promise, am, data, pma, used }
  function asset(it) {
    let a = assets.get(it.id);
    if (a) return a.promise;
    a = { used: 0 };
    a.promise = (async () => {
      const am = new spine.AssetManager(ctx, BASE + it.id + '/');
      a.am = am;
      const skel = it.file + '.skel', atl = (it.atlas || it.file) + '.atlas';
      am.loadBinary(skel);
      am.loadTextureAtlas(atl);
      await am.loadAll();
      const atlas = am.require(atl);
      // no mipmaps: the pages are packed tight, so smaller mip levels bleed neighbouring parts into each other
      a.data = new spine.SkeletonBinary(new spine.AtlasAttachmentLoader(atlas)).readSkeletonData(am.require(skel));
      a.pma = atlas.pages.some((p) => p.pma);
      return a;
    })();
    a.promise.catch(() => assets.delete(it.id));
    assets.set(it.id, a);
    return a.promise;
  }
  // free the textures of views that are no longer near (the current view and the last stay)
  const recent = [];
  function retain(ids) {
    recent.unshift(ids);
    recent.length = Math.min(recent.length, KEEP_VIEWS);
    const keep = new Set(recent.flat());
    for (const [id, a] of assets) {
      if (keep.has(id) || !a.am) continue;
      try { a.am.dispose(); } catch (e) { /* already gone */ }
      assets.delete(id);
    }
  }

  /* ------------------------------------------------------------- the view */

  // view = { kind: 'set' | 'solo', insts: [...], states: [[label, ...]], t, cycle }
  let view = null, token = 0;

  function currentItems() {
    if (tab === 'symbols') {
      const set = SETS[game];
      return pick === 'all' ? Object.values(set.items) : [set.items[pick]];
    }
    const t = TABS.find((x) => x.key === tab);
    return [t.items[pick] || t.items[0]];
  }
  function statesOf(it) {
    if (!it) return [];
    if (skin && it.skinStates && it.skinStates[skin]) return it.skinStates[skin];
    return it.states;
  }

  function renderSide() {
    const isSet = tab === 'symbols' && pick === 'all';
    const set = SETS[game], it = currentItems()[0];
    const tabLabel = TABS.find((x) => x.key === tab).label;
    ui.eyebrow.textContent = (isSet ? set.game : it.game) + ' · ' + (isSet ? tabLabel : it.tag);
    ui.name.textContent = isSet ? set.name : (tab === 'symbols' && it.skin ? 'Low pay ' + it.skin : it.name);
    ui.desc.textContent = isSet ? set.desc : it.desc;
    // states: the slider and its labels
    const st = isSet ? set.states.map(([, label]) => [label]) : statesOf(it);
    stateIx = Math.min(stateIx, st.length - 1);
    ui.range.max = String(st.length - 1);
    ui.range.value = String(stateIx);
    ui.range.disabled = st.length < 2;
    ui.ticks.replaceChildren(...st.map((_, i) => h('i', i <= stateIx ? 'past' : '')));
    ui.ticks.hidden = st.length < 2;
    ui.range.setAttribute('aria-valuetext', st[stateIx][0]);
    ui.pills.replaceChildren(...st.map(([label], i) => {
      const b = h('button', 'an-pill' + (i === stateIx ? ' on' : ''), label);
      b.type = 'button';
      b.style.setProperty('--i', String(i));
      b.dataset.n = String(i + 1).padStart(2, '0');
      b.setAttribute('aria-pressed', String(i === stateIx));
      b.addEventListener('click', () => setState(i));
      return b;
    }));
    ui.stateName.textContent = st[stateIx][0];
    glide();
    ui.stateCount.textContent = st.length > 1 ? `${stateIx + 1} / ${st.length}` : '';
    // skins (the orb's colours)
    ui.skins.hidden = !(!isSet && it.skins);
    if (!isSet && it.skins) {
      ui.skins.replaceChildren(...it.skins.map(([k, label]) => {
        const b = h('button', 'an-pill an-skin' + ((skin || it.skins[0][0]) === k ? ' on' : ''), label);
        b.type = 'button';
        b.dataset.skin = k;
        b.addEventListener('click', () => { if (skin !== k) { skin = k; stateIx = 0; show(); } });
        return b;
      }));
    }
  }

  // a sliding indicator under the active state (layouts that have .an-glider)
  function glide() {
    const g = root.querySelector('.an-glider'), on = ui.pills.querySelector('.an-pill.on');
    if (!g) return;
    if (!on) { g.style.opacity = '0'; return; }
    g.style.opacity = '1';
    g.style.transform = `translate(${on.offsetLeft}px, ${on.offsetTop}px)`;
    g.style.width = on.offsetWidth + 'px';
    g.style.height = on.offsetHeight + 'px';
  }
  // ‹ › step through the picker's items
  root.querySelectorAll('[data-an-step]').forEach((b) => b.addEventListener('click', () => {
    const chips = [...ui.picker.querySelectorAll('.an-chip')];
    if (!chips.length) return;
    const i = chips.findIndex((c) => c.classList.contains('on'));
    const n = chips[(i + +b.dataset.anStep + chips.length) % chips.length];
    n.click();
    const c = ui.picker.querySelector('.an-chip.on');
    if (c) c.scrollIntoView({ block: 'nearest', inline: 'center', behavior: reduce ? 'auto' : 'smooth' });
  }));
  // the layout (?an=a|b|c on the preview); the tab buttons carry a counter and a picture hook for it
  const lay = new URLSearchParams(location.search).get('an');
  if (lay && /^[a-z]$/.test(lay)) root.dataset.v = lay;

  function renderPicker() {
    root.querySelectorAll('.an-tab').forEach((b) => {
      const on = b.dataset.tab === tab;
      b.classList.toggle('on', on);
      b.setAttribute('aria-selected', String(on));
      b.tabIndex = on ? 0 : -1;
    });
    ui.games.hidden = tab !== 'symbols';
    root.querySelectorAll('.an-game').forEach((b) => b.classList.toggle('on', b.dataset.game === game));
    root.querySelectorAll('.an-game').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.game === game)));
    const chips = [];
    if (tab === 'symbols') {
      const set = SETS[game];
      chips.push(chip('All symbols', Object.keys(set.items).length + ' skeletons', 'all', pick === 'all', () => { pick = 'all'; stateIx = 0; show(); }));
      for (const [k, it] of Object.entries(set.items)) {
        chips.push(chip(it.name, it.tag, it, pick === k, () => { pick = k; stateIx = 0; show(); }));
      }
    } else {
      const items = TABS.find((x) => x.key === tab).items;
      items.forEach((it, i) => chips.push(chip(it.name, it.game, it, (pick || 0) === i, () => { pick = i; skin = null; stateIx = 0; show(); })));
    }
    ui.picker.replaceChildren(...chips);
    ui.picker.hidden = chips.length < 2;
    root.classList.toggle('an-single', chips.length < 2);
  }

  function show() {
    renderPicker();
    renderSide();
    build();
  }

  async function build() {
    const my = ++token;
    const items = currentItems();
    const isSet = tab === 'symbols' && pick === 'all';
    ui.specs.replaceChildren();
    stage.classList.add('loading');
    stage.classList.remove('failed');
    ui.load.textContent = 'Loading…';
    try {
      await boot();
      const ids = [...new Set(items.map((it) => it.id))];
      retain(ids);
      let done = 0;
      const loaded = await Promise.all(ids.map((id) => asset(items.find((it) => it.id === id)).then((a) => {
        if (my === token && ids.length > 1) ui.load.textContent = `Loading ${++done} / ${ids.length}`;
        return a;
      })));
      if (my !== token) return;
      const byId = Object.fromEntries(ids.map((id, i) => [id, loaded[i]]));
      const insts = items.map((it) => {
        const a = byId[it.id], sk = new spine.Skeleton(a.data);
        const s = skin || (it.skins && it.skins[0][0]) || it.skin;
        if (s) sk.setSkinByName(s);
        sk.setToSetupPose();
        const sd = new spine.AnimationStateData(a.data);
        sd.defaultMix = 0;
        return { it, a, sk, st: new spine.AnimationState(sd), x: 0, y: 0, s: 1, end: 0, showAt: 0, alpha: 1 };
      });
      view = { isSet, insts, t: 0, cycle: 0, box: null };
      if (!isSet) view.box = frameOf(insts[0], statesOf(items[0]));
      stage.classList.remove('loading');
      specs(isSet, items, loaded);
      layout();
      restart();
      kick();
      if (paused) still();
    } catch (e) {
      if (my !== token) return;
      console.warn('[animation showcase]', e);
      stage.classList.add('failed');
      ui.load.textContent = 'This animation could not be loaded.';
    }
  }

  function specs(isSet, items, loaded) {
    const datas = [...new Set(loaded.map((a) => a.data))];
    const sum = (f) => datas.reduce((n, d) => n + f(d), 0);
    const mb = [...new Set(items.map((it) => it.id))].reduce((n, id) => n + (SIZE[id] || 0), 0);
    const rows = [
      ['Runtime', 'Spine 4.2'],
      [isSet ? 'Skeletons' : 'Animations', isSet ? String(datas.length) : String(sum((d) => d.animations.length))],
      ['Bones', String(sum((d) => d.bones.length))],
      ['Slots', String(sum((d) => d.slots.length))],
      ['Download', mb >= 1 ? mb.toFixed(1) + ' MB' : Math.round(mb * 1000) + ' KB'],
    ];
    ui.specs.replaceChildren(...rows.map(([k, v]) => { const d = h('div'); d.append(h('dt', null, k), h('dd', null, v)); return d; }));
  }

  // The solo view's boxes: the union of everything every state of this item draws (sampled), and the setup pose.
  function frameOf(inst, states) {
    const sk = new spine.Skeleton(inst.a.data);
    if (inst.sk.skin) sk.setSkin(inst.sk.skin);
    const st = new spine.AnimationState(new spine.AnimationStateData(inst.a.data));
    const off = new spine.Vector2(), size = new spine.Vector2(), tmp = [];
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const grow = () => {
      sk.updateWorldTransform(spine.Physics.update);
      sk.getBounds(off, size, tmp);
      if (!isFinite(off.x) || size.x <= 0) return;
      x0 = Math.min(x0, off.x); y0 = Math.min(y0, off.y); x1 = Math.max(x1, off.x + size.x); y1 = Math.max(y1, off.y + size.y);
    };
    sk.setToSetupPose(); grow();
    const setup = isFinite(x0) ? [x0, y0, x1, y1] : null;
    const names = new Set();
    for (const [, play] of states) for (const tok of play.split(/[|\s]+/)) { const n = tok.replace(/[*].*|@.*/, ''); if (n) names.add(n); }
    for (const n of names) {
      const anim = inst.a.data.findAnimation(n);
      if (!anim) continue;
      sk.setToSetupPose();
      st.setAnimation(0, n, false);
      const steps = Math.min(120, Math.max(4, Math.ceil(anim.duration * 20)));
      for (let i = 0; i <= steps; i++) { st.update(i ? anim.duration / steps : 0); st.apply(sk); grow(); }
    }
    if (!isFinite(x0)) return { u: [-300, -300, 300, 300], s: null };
    return { u: [x0, y0, x1, y1], s: setup };
  }

  /* -------------------------------------------------------- state playback */

  function setState(i) {
    const n = +ui.range.max + 1;
    i = Math.max(0, Math.min(n - 1, i));
    if (i === stateIx && view) { restart(); return; }
    stateIx = i;
    renderSide();
    restart();
    if (paused && !reduce) { paused = false; syncTransport(); }
    kick();
  }

  function playOf(inst) {
    if (!view.isSet) {
      const st = statesOf(inst.it);
      return st[Math.min(stateIx, st.length - 1)][1];
    }
    const key = SETS[game].states[stateIx][0], p = inst.it.play || {};
    return p[key] != null ? p[key] : (inst.it.rest || '');
  }

  // queue one play string; returns when its one-shot part ends (0 = it only loops)
  function queue(inst, play, delay) {
    const { st, sk, a } = inst;
    st.clearTracks();
    sk.setToSetupPose();
    let end = 0;
    play.split('|').forEach((q, track) => {
      const toks = q.trim().split(/\s+/).filter(Boolean);
      let t = delay, prev = null, first = true;
      for (const tok of toks) {
        const m = /^([^*@]+)(\*)?(?:@([\d.]+))?$/.exec(tok);
        const anim = m && a.data.findAnimation(m[1]);
        if (!anim) continue;
        const loop = !!m[2], at = m[3] != null ? +m[3] : null;
        if (first) {
          st.setEmptyAnimation(track, 0);
          st.addAnimation(track, m[1], loop, delay > 0 ? delay : 0);
        } else {
          if (prev.loop && at == null) break;      // nothing follows an open loop
          t += at != null ? at : prev.dur;
          st.addAnimation(track, m[1], loop, at != null ? at : 0);
        }
        prev = { dur: anim.duration, loop };
        first = false;
      }
      if (prev) end = Math.max(end, prev.loop ? t : t + prev.dur);
    });
    st.apply(sk);
    sk.updateWorldTransform(spine.Physics.update);
    return end;
  }

  function restart() {
    if (!view) return;
    view.t = 0;
    const set = view.isSet && SETS[game];
    const stagger = set && set.states[stateIx][0] === 'landing';
    let cycle = 0;
    view.insts.forEach((inst) => {
      const d = stagger ? inst.col * .085 : 0;
      inst.end = queue(inst, playOf(inst), d);
      inst.showAt = stagger ? d : 0;
      inst.fade = !stagger;
      cycle = Math.max(cycle, inst.end);
    });
    view.cycle = cycle;
  }

  /* --------------------------------------------------------------- layout */

  let W = 0, H = 0, dpr = 1;
  function layout() {
    const r = stage.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = Math.max(1, Math.round(r.width * dpr));
    H = Math.max(1, Math.round(r.height * dpr));
    if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
    if (!view) return;
    if (view.isSet) {
      const set = SETS[game], narrow = r.width / r.height < 1.2 || r.width < 640;
      const rows = (narrow ? set.narrow : set.rows).map((row) => row.map((k) => view.insts.find((i) => i.it.key === k)).filter(Boolean));
      const cols = Math.max(...rows.map((row) => row.length));
      const gx = .14, gy = narrow ? .26 : .36, aspect = set.cell.h / set.cell.w;
      let cw = (W * .9) / (cols + (cols - 1) * gx), ch = cw * aspect;
      const blockH = () => rows.length * ch + (rows.length - 1) * ch * gy;
      const fill = W / H > 2 ? .68 : .76;   // a very wide stage: leave room above the tall Wild / Scatter art
      if (blockH() > H * fill) { const k = H * fill / blockH(); cw *= k; ch *= k; }
      let y = H / 2 + blockH() / 2 - ch / 2;
      rows.forEach((row) => {
        let x = W / 2 - (row.length * cw + (row.length - 1) * cw * gx) / 2 + cw / 2;
        row.forEach((inst, c) => {
          const it = inst.it, card = it.card;
          // fit the card to the cell (Mayan: cards stretch to the cell in the game; here they scale evenly)
          let s = card ? cw / set.cell.w * Math.min(set.cell.w / card.w, set.cell.h / card.h) : cw / set.cell.w * (it.scale || 1);
          if (it.grid) s *= it.grid;
          inst.s = s;
          inst.x = x - (card ? (card.cx || 0) * s : -(it.dx || 0) * cw / set.cell.w);
          inst.y = y - (card ? (card.cy || 0) * s : -(it.dy || 0) * cw / set.cell.w);
          inst.col = c;
          x += cw * (1 + gx);
        });
        y -= ch * (1 + gy);
      });
    } else {
      // fit everything the item ever draws, but keep its card / setup pose at least k of the stage height;
      // big screens frame on their own setup pose (their intros fly in from far outside it)
      const inst = view.insts[0], it = inst.it, fr = it.frame || { k: tab === 'symbols' ? .38 : .3, on: 'union' };
      const c = fr.box || (it.card ? [-it.card.w / 2 + (it.card.cx || 0), -it.card.h / 2 + (it.card.cy || 0), it.card.w / 2 + (it.card.cx || 0), it.card.h / 2 + (it.card.cy || 0)] : view.box.s || view.box.u);
      const box = fr.on === 'setup' ? c : view.box.u;
      const fitIn = (b, k) => Math.min(W * .92 / (b[2] - b[0]), H * k / (b[3] - b[1]));
      const s = fr.on === 'setup' ? fitIn(c, fr.k) : Math.max(fitIn(box, .9), Math.min(H * fr.k / (c[3] - c[1]), W * .5 / (c[2] - c[0])));
      inst.s = s;
      // symbols stay centred on their card (a side-slide landing would push the union off-centre)
      const mid = tab === 'symbols' ? c : box;
      inst.x = W / 2 - (mid[0] + mid[2]) / 2 * s;
      inst.y = H / 2 - (mid[1] + mid[3]) / 2 * s;
    }
  }

  /* ----------------------------------------------------------- the loop */

  let raf = 0, last = 0, visible = false;
  // a paused stage still draws: its first frame, and again after a resize or a state change
  function still() {
    if (raf || !view) return;
    raf = requestAnimationFrame(() => { raf = 0; if (view) { draw(0); progress(); } });
  }
  function kick() {
    if (paused) { still(); return; }
    if (!raf && visible && view && !document.hidden) { last = 0; raf = requestAnimationFrame(frame); }
  }
  function frame(now) {
    raf = 0;
    if (!visible || document.hidden || !view) return;
    const dt = last ? Math.min((now - last) / 1000, 1 / 20) : 0;
    last = now;
    const r = stage.getBoundingClientRect();
    if (Math.round(r.width * Math.min(window.devicePixelRatio || 1, 2)) !== W || Math.round(r.height * Math.min(window.devicePixelRatio || 1, 2)) !== H) layout();
    const step = paused ? 0 : dt * speed;
    view.t += step;
    if (view.cycle > 0 && view.t >= view.cycle + HOLD) restart();
    draw(step);
    progress();
    if (!paused) raf = requestAnimationFrame(frame);
  }
  function draw(step) {
    gl.viewport(0, 0, W, H);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    scene.camera.position.set(W / 2, H / 2, 0);
    scene.camera.setViewport(W, H);
    scene.begin();
    // symbols that are playing a win draw last, so their FX lie over their neighbours
    const order = view.isSet ? [...view.insts].sort((p, q) => busy(p) - busy(q)) : view.insts;
    for (const inst of order) {
      const { sk, st } = inst;
      st.update(step);
      st.apply(sk);
      sk.update(step);
      sk.x = inst.x; sk.y = inst.y;
      sk.scaleX = sk.scaleY = inst.s;
      let a = view.t < inst.showAt ? 0 : 1;
      if (inst.fade && view.t < FADE) a = view.t / FADE;
      sk.color.a = a;
      sk.updateWorldTransform(spine.Physics.update);
      if (a > 0) scene.drawSkeleton(sk, inst.a.pma);
    }
    scene.end();
  }
  const busy = (inst) => { const e = inst.st.tracks[0]; return e && /activ|win|screech|vanish/.test(e.animation.name) ? 1 : 0; };
  function progress() {
    let f = 0;
    if (view.cycle > 0) f = Math.min(1, view.t / (view.cycle + HOLD));
    else {
      const e = view.insts[0].st.tracks[0];
      if (e && e.animation.duration > 0) f = (e.trackTime % e.animation.duration) / e.animation.duration;
    }
    ui.bar.style.transform = `scaleX(${f.toFixed(4)})`;
    root.style.setProperty('--an-p', f.toFixed(4));   // layouts that fill the active state's chip with the playhead
  }

  /* ----------------------------------------------------- start when near */

  syncTransport();
  renderPicker();
  renderSide();
  const near = new IntersectionObserver((es) => {
    if (es.some((e) => e.isIntersecting)) { near.disconnect(); build(); }
  }, { rootMargin: '600px 0px' });
  near.observe(root);
  new IntersectionObserver((es) => {
    visible = es.some((e) => e.isIntersecting);
    if (visible) kick();
  }).observe(stage);
  document.addEventListener('visibilitychange', kick);
  window.addEventListener('resize', () => { glide(); if (view) { layout(); if (paused) still(); } });
  if (document.fonts) document.fonts.ready.then(glide);

  // keyboard on the stage: ← → step the states, space pauses
  stage.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight') { setState(stateIx + 1); e.preventDefault(); }
    else if (e.key === 'ArrowLeft') { setState(stateIx - 1); e.preventDefault(); }
    else if (e.key === ' ') { ui.play.click(); e.preventDefault(); }
  });

  window.CasinoAnim = { show: (t, g, p) => { tab = t || tab; game = g || game; pick = p != null ? p : pick; stateIx = 0; show(); }, setState, get view() { return view; } };
})();
