/* Font pairing and colour scheme presets (§11, §14).
 *
 * Every family here is open-source from the google/fonts repository (SIL Open
 * Font License or Apache 2.0), which is what SOURCES.md already commits to.
 * Families load on demand rather than all at once: twelve pairings' worth of
 * webfonts on every page load would be a needless tax on the public site, so
 * only the pairing in use is fetched (§33).
 *
 * The three existing "font pair" buttons in the Site tab had no handler at all
 * — clicking them did nothing. They are wired to this library.
 *
 * Colour schemes are checked for contrast rather than assumed: a scheme whose
 * body text falls under 4.5:1 on its own background is a scheme that cannot
 * ship (§34), so the table is validated and the panel says the ratio.
 *
 * Exposed as window.StudioPresets.
 */
(() => {
  'use strict';

  const $ = (s, p = document) => p.querySelector(s);
  const $$ = (s, p = document) => [...p.querySelectorAll(s)];

  /* ------------------------------------------------------- font pairings
   * key: the id stored in G.display / G.body
   * spec: the Google Fonts family= fragment, including the weights used
   */
  const FAMILIES = {
    instrument: { name: 'Instrument Serif', stack: "'Instrument Serif',Georgia,serif", spec: 'Instrument+Serif' },
    manrope:    { name: 'Manrope', stack: "'Manrope',Arial,sans-serif", spec: 'Manrope:wght@400;500;600;700' },
    dmserif:    { name: 'DM Serif Display', stack: "'DM Serif Display',Georgia,serif", spec: 'DM+Serif+Display' },
    dmsans:     { name: 'DM Sans', stack: "'DM Sans',Arial,sans-serif", spec: 'DM+Sans:wght@400;500;600;700' },
    space:      { name: 'Space Grotesk', stack: "'Space Grotesk',Arial,sans-serif", spec: 'Space+Grotesk:wght@400;500;600;700' },
    cormorant:  { name: 'Cormorant Garamond', stack: "'Cormorant Garamond',Georgia,serif", spec: 'Cormorant+Garamond:wght@400;600;700' },
    inter:      { name: 'Inter', stack: "'Inter',Arial,sans-serif", spec: 'Inter:wght@400;500;600;700' },
    archivoblack: { name: 'Archivo Black', stack: "'Archivo Black',Arial,sans-serif", spec: 'Archivo+Black' },
    archivo:    { name: 'Archivo', stack: "'Archivo',Arial,sans-serif", spec: 'Archivo:wght@400;500;600;700' },
    newsreader: { name: 'Newsreader', stack: "'Newsreader',Georgia,serif", spec: 'Newsreader:wght@400;500;600' },
    publicsans: { name: 'Public Sans', stack: "'Public Sans',Arial,sans-serif", spec: 'Public+Sans:wght@400;500;600;700' },
    anton:      { name: 'Anton', stack: "'Anton',Impact,sans-serif", spec: 'Anton' },
    intertight: { name: 'Inter Tight', stack: "'Inter Tight',Arial,sans-serif", spec: 'Inter+Tight:wght@400;500;600;700' },
    bebas:      { name: 'Bebas Neue', stack: "'Bebas Neue',Impact,sans-serif", spec: 'Bebas+Neue' },
    barlow:     { name: 'Barlow', stack: "'Barlow',Arial,sans-serif", spec: 'Barlow:wght@400;500;600;700' },
    playfair:   { name: 'Playfair Display', stack: "'Playfair Display',Georgia,serif", spec: 'Playfair+Display:wght@400;600;700' },
    sourcesans: { name: 'Source Sans 3', stack: "'Source Sans 3',Arial,sans-serif", spec: 'Source+Sans+3:wght@400;500;600;700' },
    fraunces:   { name: 'Fraunces', stack: "'Fraunces',Georgia,serif", spec: 'Fraunces:wght@400;600;700' },
    nunitosans: { name: 'Nunito Sans', stack: "'Nunito Sans',Arial,sans-serif", spec: 'Nunito+Sans:wght@400;600;700' },
    syne:       { name: 'Syne', stack: "'Syne',Arial,sans-serif", spec: 'Syne:wght@400;600;700;800' },
    plexmono:   { name: 'IBM Plex Mono', stack: "'IBM Plex Mono',ui-monospace,monospace", spec: 'IBM+Plex+Mono:wght@400;500;600' },
    librebask:  { name: 'Libre Baskerville', stack: "'Libre Baskerville',Georgia,serif", spec: 'Libre+Baskerville:wght@400;700' },
    worksans:   { name: 'Work Sans', stack: "'Work Sans',Arial,sans-serif", spec: 'Work+Sans:wght@400;500;600;700' },
  };

  const FONT_PAIRS = [
    { key: 'editorial', name: 'Editorial',   display: 'instrument',   body: 'manrope',    note: 'The current pairing. High-contrast serif over a neutral grotesque.' },
    { key: 'modern',    name: 'Modern',      display: 'dmserif',      body: 'dmsans',     note: 'Clean display serif with its matching sans.' },
    { key: 'tech',      name: 'Technical',   display: 'space',        body: 'space',      note: 'One grotesque throughout; quiet and systematic.' },
    { key: 'gallery',   name: 'Gallery',     display: 'cormorant',    body: 'inter',      note: 'Light old-style serif. Reads as a print catalogue.' },
    { key: 'poster',    name: 'Poster',      display: 'archivoblack', body: 'archivo',    note: 'Heavy display weight for short, loud headlines.' },
    { key: 'quiet',     name: 'Quiet',       display: 'newsreader',   body: 'publicsans', note: 'Understated and readable; lets artwork lead.' },
    { key: 'brutal',    name: 'Brutal',      display: 'anton',        body: 'intertight', note: 'Condensed and dense. Strong on big screens.' },
    { key: 'billboard', name: 'Billboard',   display: 'bebas',        body: 'barlow',     note: 'Tall caps display over a compact sans.' },
    { key: 'classic',   name: 'Classic',     display: 'playfair',     body: 'sourcesans', note: 'Traditional publishing pairing.' },
    { key: 'warm',      name: 'Warm',        display: 'fraunces',     body: 'nunitosans', note: 'Soft, characterful serif with a rounded sans.' },
    { key: 'edge',      name: 'Edge',        display: 'syne',         body: 'plexmono',   note: 'Unusual display with a monospace body. Best in small doses.' },
    { key: 'press',     name: 'Press',       display: 'librebask',    body: 'worksans',   note: 'Bookish serif, generous body sans.' },
  ];

  /* ------------------------------------------------------- colour schemes
   * Each carries the four globals the site already uses. Every one is checked
   * against a 4.5:1 floor for body text before it is offered.
   */
  const COLOR_SCHEMES = [
    { key: 'studio',    name: 'Studio Dark',  mode: 'dark',  bg: '#10120f', surface: '#191c17', text: '#f4f2e8', accent: '#bdd657' },
    { key: 'gallery',   name: 'Gallery White', mode: 'light', bg: '#ffffff', surface: '#f4f5f3', text: '#111111', accent: '#1b6b4a' },
    { key: 'ink',       name: 'Ink',          mode: 'dark',  bg: '#0b0b0c', surface: '#16171a', text: '#f2efe9', accent: '#e0a33e' },
    { key: 'charcoal',  name: 'Charcoal',     mode: 'dark',  bg: '#14171a', surface: '#1e2328', text: '#eef2f4', accent: '#4fd1c5' },
    { key: 'bone',      name: 'Bone',         mode: 'light', bg: '#f7f4ef', surface: '#ebe6dd', text: '#1d1a17', accent: '#a5432b' },
    { key: 'midnight',  name: 'Midnight',     mode: 'dark',  bg: '#0a0f1c', surface: '#141b2d', text: '#e8eefc', accent: '#7aa2ff' },
    { key: 'forest',    name: 'Forest',       mode: 'dark',  bg: '#0c1410', surface: '#15211a', text: '#eaf3ec', accent: '#7fd18a' },
    { key: 'plum',      name: 'Plum',         mode: 'dark',  bg: '#140e18', surface: '#211628', text: '#f3ebf5', accent: '#e58bc4' },
    { key: 'concrete',  name: 'Concrete',     mode: 'light', bg: '#f2f2f0', surface: '#e3e3e0', text: '#1a1a1a', accent: '#b03030' },
    { key: 'sepia',     name: 'Sepia',        mode: 'light', bg: '#f6efe2', surface: '#e9dfcc', text: '#241c12', accent: '#8a5a24' },
    { key: 'neon',      name: 'Neon',         mode: 'dark',  bg: '#08080a', surface: '#131318', text: '#f5f5f7', accent: '#ff4d9d' },
    { key: 'sand',      name: 'Sand',         mode: 'light', bg: '#fbf8f3', surface: '#efe9df', text: '#1f1d1a', accent: '#0f6f72' },
  ];

  /* ------------------------------------------------------------- contrast */
  function srgb(hex) {
    const h = String(hex).replace('#', '');
    const n = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
    return [0, 2, 4].map(i => parseInt(n.slice(i, i + 2), 16));
  }
  function luminance(hex) {
    const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    const [r, g, b] = srgb(hex);
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  }
  function contrast(a, b) {
    const l1 = luminance(a), l2 = luminance(b);
    return +((Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)).toFixed(2);
  }
  // Reports every scheme's text and accent ratio so a bad one cannot hide.
  function auditSchemes() {
    return COLOR_SCHEMES.map(s => ({
      key: s.key,
      text: contrast(s.text, s.bg),
      textOnSurface: contrast(s.text, s.surface),
      accent: contrast(s.accent, s.bg),
      passesAA: contrast(s.text, s.bg) >= 4.5 && contrast(s.text, s.surface) >= 4.5,
      accentPassesLargeText: contrast(s.accent, s.bg) >= 3,
    }));
  }

  /* --------------------------------------------------------- font loading
   * One stylesheet link that carries only the families actually in use, so the
   * public page never downloads twelve pairings' worth of webfonts.
   */
  const loaded = new Set();
  function loadFamilies(keys) {
    const specs = keys.map(k => FAMILIES[k] && FAMILIES[k].spec).filter(Boolean);
    for (const s of specs) loaded.add(s);
    if (!loaded.size) return null;
    let link = $('#preset-fonts');
    if (!link) {
      link = document.createElement('link');
      link.id = 'preset-fonts';
      link.rel = 'stylesheet';
      // Preconnect first so the font request is not waiting on a fresh TLS
      // handshake at the moment it is needed.
      for (const href of ['https://fonts.googleapis.com', 'https://fonts.gstatic.com']) {
        const pre = document.createElement('link');
        pre.rel = 'preconnect';
        pre.href = href;
        if (href.includes('gstatic')) pre.crossOrigin = 'anonymous';
        document.head.appendChild(pre);
      }
      document.head.appendChild(link);
    }
    const href = 'https://fonts.googleapis.com/css2?' + [...loaded].map(s => 'family=' + s).join('&') + '&display=swap';
    if (link.href !== href) link.href = href;
    return href;
  }

  // Teaches the editor's FONTS map about a family so G.display/G.body can name it.
  function register(key) {
    const fam = FAMILIES[key];
    if (!fam) return false;
    if (typeof FONTS !== 'undefined' && FONTS && !FONTS[key]) FONTS[key] = fam.stack;
    // Keep the two family dropdowns in step, or a preset would apply a value
    // the select cannot display.
    for (const id of ['displayFont', 'bodyFont']) {
      const sel = $('#' + id);
      if (!sel || [...sel.options].some(o => o.value === key)) continue;
      const opt = document.createElement('option');
      opt.value = key;
      opt.textContent = fam.name;
      sel.appendChild(opt);
    }
    return true;
  }

  const ed = {
    model: () => (typeof state === 'function' ? state() : null),
    push: () => { if (typeof push === 'function') push(); },
    status: m => { if (typeof status === 'function') status(m); },
    applyGlobals: () => { if (typeof applyGlobals === 'function') applyGlobals(); },
  };

  function applyFontPair(key) {
    const p = FONT_PAIRS.find(x => x.key === key);
    if (!p) { ed.status(`"${key}" is not a font pairing in this build.`); return false; }
    register(p.display); register(p.body);
    loadFamilies([p.display, p.body]);
    // The key must be written to G as well as the model. applyState() merges
    // the whole published `site` bag into G, so G ends up holding fontPair /
    // scheme / layout too — and fromDOM spreads G LAST over the previous site,
    // so G wins. Writing only the model left these frozen at whatever was
    // published, which showed as the wrong preset card marked on reload.
    if (typeof G !== 'undefined') { G.display = p.display; G.body = p.body; G.fontPair = key; }
    const m = ed.model();
    if (m) { m.site = m.site || {}; m.site.display = p.display; m.site.body = p.body; m.site.fontPair = key; }
    ed.applyGlobals();
    const dsel = $('#displayFont'), bsel = $('#bodyFont');
    if (dsel) dsel.value = p.display;
    if (bsel) bsel.value = p.body;
    markActive('[data-pair]', key);
    ed.push();
    ed.status(`Fonts: ${FAMILIES[p.display].name} + ${FAMILIES[p.body].name}`);
    return true;
  }



  /* ------------------------------------------------------ layout presets
   * A showcase layout is a recipe for the work grid plus the page metrics that
   * carry its feel. `pattern` is applied cyclically down the tile order, so a
   * preset works whether there are four tiles or forty. `diagram` is the same
   * information drawn as rows of spans for the preview card.
   *
   * Below 980px every tile already goes full width, so a 12-column pattern
   * collapses safely on a phone without any per-layout handling.
   */
  const LAYOUTS = [
    {
      key: 'editorial', name: 'Editorial Grid',
      note: 'Mixed spans with a deliberate rhythm. The current arrangement.',
      site: { pageWidth: 1500, gap: 16, radius: 8, sectionSpace: 84 }, heroHeight: 76,
      pattern: [{ span: 8, h: 540 }, { span: 4, h: 540 }, { span: 5, h: 390 }, { span: 7, h: 390 }, { span: 6, h: 320 }, { span: 6, h: 320 }],
      diagram: [[8, 4], [5, 7], [6, 6]],
    },
    {
      key: 'thirds', name: 'Uniform Thirds',
      note: 'Three even columns. Quiet and catalogue-like; every piece reads equally.',
      site: { pageWidth: 1440, gap: 18, radius: 8, sectionSpace: 80 }, heroHeight: 70,
      pattern: [{ span: 4, h: 420 }],
      diagram: [[4, 4, 4], [4, 4, 4]],
    },
    {
      key: 'twoup', name: 'Two Up',
      note: 'Two large tiles per row. Good when each image needs room.',
      site: { pageWidth: 1400, gap: 20, radius: 10, sectionSpace: 92 }, heroHeight: 74,
      pattern: [{ span: 6, h: 520 }],
      diagram: [[6, 6], [6, 6]],
    },
    {
      key: 'fullbleed', name: 'Full Bleed',
      note: 'One piece per row at full width. The most cinematic option; best with few, strong images.',
      site: { pageWidth: 1600, gap: 28, radius: 0, sectionSpace: 110 }, heroHeight: 88,
      pattern: [{ span: 12, h: 720 }],
      diagram: [[12], [12]],
    },
    {
      key: 'feature', name: 'Feature + Strip',
      note: 'One hero piece, then a strip of smaller work beneath it.',
      site: { pageWidth: 1500, gap: 14, radius: 8, sectionSpace: 84 }, heroHeight: 78,
      pattern: [{ span: 12, h: 620 }, { span: 3, h: 260 }, { span: 3, h: 260 }, { span: 3, h: 260 }, { span: 3, h: 260 }],
      diagram: [[12], [3, 3, 3, 3]],
    },
    {
      key: 'contact', name: 'Contact Sheet',
      note: 'Dense four-across thumbnails. Shows breadth rather than individual pieces.',
      site: { pageWidth: 1560, gap: 10, radius: 4, sectionSpace: 64 }, heroHeight: 58,
      pattern: [{ span: 3, h: 250 }],
      diagram: [[3, 3, 3, 3], [3, 3, 3, 3]],
    },
    {
      key: 'masonry', name: 'Masonry Rhythm',
      note: 'Alternating tall and short pairs, for an uneven, gallery-hung feel.',
      site: { pageWidth: 1460, gap: 16, radius: 8, sectionSpace: 88 }, heroHeight: 72,
      pattern: [{ span: 6, h: 600 }, { span: 6, h: 380 }, { span: 6, h: 380 }, { span: 6, h: 600 }],
      diagram: [[6, 6], [6, 6]],
    },
    {
      key: 'cinematic', name: 'Cinematic Strip',
      note: 'Wide letterbox bands. Suits environment and key-art work.',
      site: { pageWidth: 1620, gap: 30, radius: 6, sectionSpace: 104 }, heroHeight: 84,
      pattern: [{ span: 12, h: 400 }],
      diagram: [[12], [12], [12]],
    },
    {
      key: 'featureleft', name: 'Feature Left',
      note: 'A large piece paired with a narrower one, repeating down the page.',
      site: { pageWidth: 1480, gap: 16, radius: 8, sectionSpace: 86 }, heroHeight: 74,
      pattern: [{ span: 8, h: 520 }, { span: 4, h: 520 }],
      diagram: [[8, 4], [8, 4]],
    },
    {
      key: 'salon', name: 'Salon',
      note: 'Deliberately irregular, like a salon wall. Least predictable of the set.',
      site: { pageWidth: 1520, gap: 14, radius: 6, sectionSpace: 80 }, heroHeight: 68,
      pattern: [{ span: 4, h: 470 }, { span: 8, h: 470 }, { span: 7, h: 340 }, { span: 5, h: 340 }, { span: 3, h: 300 }, { span: 9, h: 300 }],
      diagram: [[4, 8], [7, 5], [3, 9]],
    },
  ];

  /* Applies the metrics, then walks the tile order writing span and height.
   * This intentionally overwrites per-tile sizes — that is what choosing a
   * layout means — and it lands as one undo step.
   */
  function applyLayout(key) {
    const L = LAYOUTS.find(x => x.key === key);
    if (!L) { ed.status(`"${key}" is not a layout in this build.`); return false; }
    const m = ed.model();
    if (!m) { ed.status('No model yet — open the editor first.'); return false; }

    if (typeof G !== 'undefined') Object.assign(G, L.site, { layout: key });
    m.site = m.site || {};
    Object.assign(m.site, L.site, { layout: key });

    if (L.heroHeight !== undefined && typeof HERO !== 'undefined') {
      HERO.height = L.heroHeight;
      m.hero = m.hero || {};
      m.hero.height = L.heroHeight;
    }

    // Tile order comes from the model so the pattern follows the page, not the
    // order the nodes happen to be listed in.
    const order = (m.order && m.order.length)
      ? m.order
      : [...document.querySelectorAll('.grid .tile')].map(t => t.dataset.id);
    let applied = 0;
    order.forEach((id, i) => {
      if (!m.nodes || !m.nodes[id]) return;
      const step = L.pattern[i % L.pattern.length];
      window.StudioModel.setProp(m, id, 'span', step.span, 'base');
      window.StudioModel.setProp(m, id, 'tileHeight', step.h, 'base');
      applied++;
    });

    ed.applyGlobals();
    if (typeof applyHero === 'function') applyHero();
    window.StudioModel.writeCSS(window.StudioModel.emitCSS(m));
    markActive('[data-layout]', key);
    if (window.StudioInspector) window.StudioInspector.syncFromModel();
    ed.push();
    ed.status(`Layout: ${L.name} — ${applied} tile${applied === 1 ? '' : 's'} resized`);
    return true;
  }

  function layoutDiagram(L) {
    return L.diagram.map(row =>
      `<span class="lay-row">${row.map(sp => `<i style="flex:${sp}"></i>`).join('')}</span>`
    ).join('');
  }

  /* ------------------------------------------------- exact colour handling
   * applyGlobals() hard-codes light mode to #ffffff / #f4f5f3 / #111111 and
   * ignores G.bg, G.surface and G.text entirely, so the three colour pickers
   * did nothing at all in light mode and every light scheme rendered
   * identically apart from its accent.
   *
   * The hard-coding existed so that flipping the mode toggle while the dark
   * defaults were still loaded did not leave a dark page labelled light. So
   * rather than removing it, exact colours are opted into: applying a scheme,
   * or touching a colour picker, marks the palette as deliberate and it is
   * then honoured verbatim. Flipping the mode on its own still loads that
   * mode's defaults, which is what the old behaviour was approximating.
   */
  const MODE_DEFAULTS = {
    dark:  { bg: '#10120f', surface: '#191c17', text: '#f4f2e8' },
    light: { bg: '#ffffff', surface: '#f4f5f3', text: '#111111' },
  };

  /* Set on BODY, not :root. studio.css carries `.light{--bg:#fff;--text:#111;…}`,
   * a class rule on body, and every element lives inside body — so body's
   * custom properties shadow anything written to :root. Writing the exact
   * palette to :root looked correct and changed nothing on screen.
   */
  function setVar(name, value) {
    document.body.style.setProperty(name, value);
  }

  // Derived tones so a scheme's rules and secondary text match its own text
  // colour, rather than staying the generic light/dark defaults.
  function rgba(hex, alpha) {
    const [r, g, b] = srgb(hex);
    return `rgba(${r},${g},${b},${alpha})`;
  }
  function applyPalette(site) {
    setVar('--bg', site.bg);
    setVar('--surface', site.surface);
    setVar('--text', site.text);
    if (site.text) {
      setVar('--muted', rgba(site.text, 0.55));
      setVar('--line', rgba(site.text, 0.14));
    }
  }

  function installExactColors() {
    if (typeof applyGlobals !== 'function' || applyGlobals.__exact) return;
    const base = applyGlobals;
    const wrapped = function () {
      base();
      if (typeof G !== 'undefined' && G && G.exactColors) applyPalette(G);
    };
    wrapped.__exact = true;
    // eslint-disable-next-line no-global-assign
    applyGlobals = wrapped;

    // Touching any of the three colours means the palette is deliberate.
    for (const id of ['bg', 'surface', 'text']) {
      const el = $('#' + id);
      if (!el || el.dataset.exactBound === '1') continue;
      el.dataset.exactBound = '1';
      el.addEventListener('input', () => {
        if (typeof G !== 'undefined') { G.exactColors = true; G[id] = el.value; }
        const m = ed.model();
        if (m) { m.site = m.site || {}; m.site.exactColors = true; m.site[id] = el.value; }
        applyGlobals();
      });
    }
    // Flipping the mode on its own loads that mode's defaults, so the page is
    // never a dark palette wearing a light label.
    const mode = $('#mode');
    if (mode && mode.dataset.exactBound !== '1') {
      mode.dataset.exactBound = '1';
      mode.addEventListener('change', () => {
        const d = MODE_DEFAULTS[mode.value] || MODE_DEFAULTS.dark;
        if (typeof G !== 'undefined') Object.assign(G, d, { mode: mode.value, exactColors: true });
        const m = ed.model();
        if (m) { m.site = m.site || {}; Object.assign(m.site, d, { mode: mode.value, exactColors: true }); }
        applyGlobals();
        // Emptied on both, not deleted. fromDOM spreads G over the previous
        // site, so a key merely absent from G lets the old value win; an empty
        // string overwrites it.
        if (typeof G !== 'undefined') G.scheme = '';
        if (m) m.site.scheme = '';
        markActive('[data-scheme]', '');
        ed.push();
        ed.status(`${mode.value === 'light' ? 'Light' : 'Dark'} mode defaults loaded.`);
      });
    }
  }

  function applyScheme(key) {
    const s = COLOR_SCHEMES.find(x => x.key === key);
    if (!s) { ed.status(`"${key}" is not a colour scheme in this build.`); return false; }
    installExactColors();
    if (typeof G !== 'undefined') {
      G.mode = s.mode; G.bg = s.bg; G.surface = s.surface; G.text = s.text; G.accent = s.accent;
      // A scheme states its palette outright, so it is honoured verbatim.
      G.exactColors = true;
      // See the note in applyFontPair: G wins in fromDOM, so the key goes here too.
      G.scheme = key;
    }
    const m = ed.model();
    if (m) {
      m.site = m.site || {};
      Object.assign(m.site, { mode: s.mode, bg: s.bg, surface: s.surface, text: s.text, accent: s.accent, scheme: key, exactColors: true });
    }
    ed.applyGlobals();
    for (const [id, val] of [['mode', s.mode], ['bg', s.bg], ['surface', s.surface], ['text', s.text], ['accent', s.accent]]) {
      const el = $('#' + id);
      if (el) el.value = val;
    }
    markActive('[data-scheme]', key);
    ed.push();
    const c = contrast(s.text, s.bg);
    ed.status(`Scheme: ${s.name} — body text ${c}:1`);
    return true;
  }

  function markActive(sel, key) {
    $$(sel).forEach(b => {
      // Must include layout: reading only pair/scheme meant a layout card could
      // never match its own key and never showed as selected.
      const on = (b.dataset.pair || b.dataset.scheme || b.dataset.layout) === key;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', String(on));
    });
  }

  /* ------------------------------------------------------------- the panel */
  function buildPanel() {
    const host = $('.tab-panel[data-tab="site"]');
    // Install the colour wrapper even on a repeat call, or a second enter()
    // would return early and leave the palette handling uninstalled.
    installExactColors();
    if (!host || $('#presetsPanel')) return;
    const p = document.createElement('div');
    p.className = 'panel';
    p.id = 'presetsPanel';

    const pairCards = FONT_PAIRS.map(f => `
      <button type="button" class="preset-card font-card" data-pair="${f.key}" aria-pressed="false" title="${f.note}">
        <span class="preset-aa" style="font-family:${FAMILIES[f.display].stack}">Aa</span>
        <span class="preset-meta">
          <strong>${f.name}</strong>
          <span style="font-family:${FAMILIES[f.body].stack}">${FAMILIES[f.display].name} + ${FAMILIES[f.body].name}</span>
        </span>
      </button>`).join('');

    const schemeCards = COLOR_SCHEMES.map(s => `
      <button type="button" class="preset-card scheme-card" data-scheme="${s.key}" aria-pressed="false"
              title="${s.name} — body text ${contrast(s.text, s.bg)}:1 on the background">
        <span class="scheme-swatch" style="background:${s.bg}">
          <i style="background:${s.surface}"></i><i style="background:${s.text}"></i><i style="background:${s.accent}"></i>
        </span>
        <span class="preset-meta"><strong>${s.name}</strong><span>${s.mode} · ${contrast(s.text, s.bg)}:1</span></span>
      </button>`).join('');

    const layoutCards = LAYOUTS.map(L => `
      <button type="button" class="preset-card layout-card" data-layout="${L.key}" aria-pressed="false" title="${L.note}">
        <span class="lay-diagram" aria-hidden="true">${layoutDiagram(L)}</span>
        <span class="preset-meta"><strong>${L.name}</strong><span>${L.diagram[0].join(' / ')} columns</span></span>
      </button>`).join('');

    p.innerHTML = `
      <h4>Showcase layouts</h4>
      <p class="editor-note">Rearranges the work grid and the page metrics that go with it. This replaces the size of each tile, so it is one undo away if you change your mind.</p>
      <div class="preset-grid layout-grid">${layoutCards}</div>
      <h4>Font pairings</h4>
      <p class="editor-note">Open-source families from google/fonts. Only the pairing you pick is downloaded.</p>
      <div class="preset-grid">${pairCards}</div>
      <h4>Colour schemes</h4>
      <p class="editor-note">Each ratio is body text against its background. 4.5:1 is the readable floor.</p>
      <div class="preset-grid">${schemeCards}</div>`;
    host.prepend(p);
    installExactColors();

    $$('[data-pair]', p).forEach(b => { b.onclick = () => applyFontPair(b.dataset.pair); });
    $$('[data-scheme]', p).forEach(b => { b.onclick = () => applyScheme(b.dataset.scheme); });
    $$('[data-layout]', p).forEach(b => { b.onclick = () => applyLayout(b.dataset.layout); });

    // The three pre-existing font-pair buttons had no handler at all. Wire them
    // to the same library rather than leaving controls that do nothing (§1).
    $$('.font-pair[data-pair]').forEach(b => {
      if (b.closest('#presetsPanel')) return;
      b.onclick = () => applyFontPair(b.dataset.pair);
    });

    const m = ed.model();
    if (m && m.site) {
      if (m.site.fontPair) markActive('[data-pair]', m.site.fontPair);
      if (m.site.scheme) markActive('[data-scheme]', m.site.scheme);
      if (m.site.layout) markActive('[data-layout]', m.site.layout);
    }
  }

  /* Loads whatever the published config chose, for visitors too: a pairing is
   * useless if the family never arrives on the public page.
   */
  function hydrate(model) {
    const site = (model && model.site) || (typeof G !== 'undefined' ? G : null);
    if (!site) return;
    // A published exact palette has to reach visitors, not just the editor.
    if (site.exactColors) {
      if (typeof G !== 'undefined') G.exactColors = true;
      applyPalette(site);
    }
    const keys = [site.display, site.body].filter(k => k && FAMILIES[k]);
    if (!keys.length) return;
    const newToFonts = keys.filter(k => typeof FONTS === 'undefined' || !FONTS || !FONTS[k]);
    keys.forEach(register);
    loadFamilies(keys);
    // applyGlobals() already ran earlier in applyState, before these families
    // existed in the FONTS map, so fontValue() fell back to the default stack
    // and a visitor saw Manrope instead of the published pairing. Recompute now
    // that the stacks are known.
    if (newToFonts.length && typeof applyGlobals === 'function') applyGlobals();
  }

  window.StudioPresets = {
    FAMILIES, FONT_PAIRS, COLOR_SCHEMES, LAYOUTS,
    applyFontPair, applyScheme, applyLayout, buildPanel, hydrate,
    contrast, auditSchemes, loadFamilies, register, installExactColors, MODE_DEFAULTS, applyPalette,
  };
})();
