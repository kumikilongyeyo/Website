/* Studio typed component model (schema 4).
 *
 * Replaces the old approach of serialising each node to an opaque inline-style
 * string. A flat style string cannot express a per-state override or a
 * per-breakpoint override, which is why hover/pressed states and responsive
 * editing were impossible before this file existed.
 *
 * A node now carries typed property bags:
 *
 *   states: { base: {...}, hover: {...}, pressed: {...} }
 *   responsive: { tablet: {...}, mobile: {...} }
 *
 * and styling reaches the page as a generated stylesheet keyed on [data-id],
 * not as inline styles. Inline styles are reserved for live drag/resize
 * ephemera so the editor never writes design decisions into the DOM by
 * accident, and so a selection outline can never be mistaken for a border.
 *
 * Exposed as window.StudioModel. Pure functions: nothing here reads globals
 * from the editor, everything is passed in.
 */
(() => {
  'use strict';

  const CURRENT_SCHEMA = 4;
  const STATES = ['base', 'hover', 'pressed'];
  const BREAKPOINTS = { tablet: 900, mobile: 600 };
  const NODE_TYPES = ['text', 'tile', 'hero', 'logo', 'button', 'link', 'section', 'container', 'divider', 'spacer', 'shape'];

  /* ---------------------------------------------------------------- helpers */

  const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
  const num = (v, d = 0) => (v === '' || v === null || v === undefined || isNaN(parseFloat(v)) ? d : parseFloat(v));
  const clone = v => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
  const clean = o => {
    // Drop undefined/'' so an absent override never shadows an inherited value.
    const out = {};
    for (const k in o) if (o[k] !== undefined && o[k] !== '' && o[k] !== null) out[k] = o[k];
    return out;
  };
  const cssEscape = s => String(s).replace(/["\\]/g, '\\$&');


  // Layer rows, and anything else in the editor chrome, deliberately carry the
  // same data-id as the object they represent. A bare [data-id] lookup can
  // therefore resolve to a tree row instead of the real object, so every
  // lookup here skips the chrome explicitly.
  const CHROME = '.layerbox, .layers, .inspector, .devbar, .savebar, .login, #assetGrid';
  /* An object can hold more than one <img>: the hero pairs a blurred full-bleed
   * backdrop with the artwork itself. Everything that reads or writes "the
   * image" means the content one. Selecting the first <img> instead put new
   * artwork on the blur layer, and gave a decorative, aria-hidden element the
   * node's name as its alt text.
   */
  const DECORATIVE_IMG = 'img[aria-hidden="true"], .hero-bleed';
  function contentImage(el) {
    if (!el || !el.querySelector) return null;
    return el.querySelector('img:not([aria-hidden="true"]):not(.hero-bleed)') || el.querySelector('img');
  }

  function findNode(root, id) {
    const els = root.querySelectorAll(`[data-id="${cssEscape(id)}"]`);
    for (const el of els) {
      if (el.closest && el.closest(CHROME)) continue;
      return el;
    }
    return null;
  }

  /* ------------------------------------------------------- property → CSS
   * One entry per typed property. Keeping this a data table (rather than
   * branching code) is what makes the property set auditable and what lets the
   * same table serve base, hover, pressed and every breakpoint.
   */
  const PX = p => v => `${p}:${num(v)}px`;
  const RAW = p => v => `${p}:${v}`;
  const VAR = p => v => `${p}:${v}`;

  const CSS_MAP = {
    /* typography (§11) */
    fontFamily:     RAW('font-family'),
    fontSize:       PX('font-size'),
    fontWeight:     RAW('font-weight'),
    fontStyle:      RAW('font-style'),
    letterSpacing:  v => `letter-spacing:${num(v) / 100}em`,
    wordSpacing:    PX('word-spacing'),
    lineHeight:     RAW('line-height'),
    textAlign:      RAW('text-align'),
    textTransform:  RAW('text-transform'),
    textDecoration: RAW('text-decoration'),
    color:          RAW('color'),

    /* box + layout (§10) */
    opacity:        RAW('opacity'),
    width:          RAW('width'),
    height:         RAW('height'),
    minWidth:       RAW('min-width'),
    maxWidth:       RAW('max-width'),
    margin:         RAW('margin'),
    padding:        RAW('padding'),
    gap:            PX('gap'),
    borderRadius:   PX('border-radius'),
    overflow:       RAW('overflow'),
    zIndex:         RAW('z-index'),
    position:       RAW('position'),
    justifySelf:    RAW('justify-self'),
    alignSelf:      RAW('align-self'),

    /* grid/tile geometry — these drive existing CSS custom properties */
    span:           VAR('--span'),
    tileHeight:     v => `--h:${num(v)}px`,
    offsetX:        v => `--x:${num(v)}px`,
    offsetY:        v => `--y:${num(v)}px`,
    tileRadius:     v => `--tr:${num(v)}px`,
    tileTint:       VAR('--tile'),

    /* image framing inside a tile (§16) */
    imageZoom:      VAR('--imgScale'),
    imageX:         v => `--imgX:${num(v)}%`,
    imageY:         v => `--imgY:${num(v)}%`,

    /* border — width/style/colour only apply when borderEnabled (§7) */
    borderWidth:    PX('border-width'),
    borderStyle:    RAW('border-style'),
    borderColor:    RAW('border-color'),

    /* transform + hover affordances */
    scale:          VAR('--objScale'),
    rotate:         v => `--objRotate:${num(v)}deg`,
    hoverScale:     VAR('--hoverScale'),
    hoverLift:      v => `--hoverLift:${num(v)}px`,

    /* motion tokens consumed by the existing [data-motion] rules */
    motionDur:      v => `--dur:${num(v)}ms`,
    motionDelay:    v => `--delay:${num(v)}ms`,
    motionDist:     v => `--dist:${num(v)}px`,

    /* effects (§25) */
    boxShadow:      RAW('box-shadow'),
    backdropBlur:   v => `backdrop-filter:blur(${num(v)}px)`,
    mixBlendMode:   RAW('mix-blend-mode'),
  };

  // Filter is assembled from several typed props into one declaration, because
  // CSS filter is a single ordered list and separate rules would overwrite.
  const FILTER_PROPS = {
    brightness: v => `brightness(${num(v, 100) / 100})`,
    contrast:   v => `contrast(${num(v, 100) / 100})`,
    saturate:   v => `saturate(${num(v, 100) / 100})`,
    hueRotate:  v => `hue-rotate(${num(v)}deg)`,
    grayscale:  v => `grayscale(${num(v) / 100})`,
    sepia:      v => `sepia(${num(v) / 100})`,
    blur:       v => `blur(${num(v)}px)`,
  };
  const FILTER_DEFAULTS = { brightness: 100, contrast: 100, saturate: 100, hueRotate: 0, grayscale: 0, sepia: 0, blur: 0 };

  /* ------------------------------------------------------------ background
   * §14/§15: a structured background rather than an opaque CSS string, so the
   * editor can round-trip gradient stops and image framing.
   */
  function gradientCSS(g) {
    if (!g) return null;
    const stops = (g.stops || []).slice().sort((a, b) => num(a.at) - num(b.at));
    if (stops.length < 2) return null;
    const list = (g.reverse ? stops.slice().reverse().map((s, i, a) => ({ ...s, at: 100 - num(s.at) })) : stops)
      .slice().sort((a, b) => num(a.at) - num(b.at))
      .map(s => `${s.color} ${num(s.at)}%`).join(',');
    return g.type === 'radial'
      ? `radial-gradient(circle at ${num(g.x, 50)}% ${num(g.y, 50)}%,${list})`
      : `linear-gradient(${num(g.angle, 180)}deg,${list})`;
  }

  /* Only the solid case becomes a declaration, so a hover or breakpoint can
   * override a background colour like any other property. Gradient, image and
   * texture backgrounds are composited by studio-background.js on a dedicated
   * child layer instead, because overall opacity, blur, zoom and parallax
   * cannot be expressed on an element's own background without faking them —
   * and a control that only looks like it works is worse than none (§1).
   */
  function backgroundDecls(bg) {
    if (!bg || !bg.mode) return [];
    if (bg.mode === 'none') return ['background-color:transparent'];
    if (bg.mode === 'solid') return bg.color ? [`background-color:${bg.color}`] : [];
    return [];
  }

  /* ------------------------------------------------------ declaration build */
  function declsFor(props) {
    if (!props) return [];
    const out = [];
    for (const key in props) {
      const v = props[key];
      if (v === undefined || v === null || v === '') continue;
      if (key === 'borderEnabled') { if (!v) out.push('border-style:none'); continue; }
      if (key === 'background') { out.push(...backgroundDecls(v)); continue; }
      if (key in FILTER_PROPS) continue;                       // handled below
      const fn = CSS_MAP[key];
      if (fn) out.push(fn(v));
    }
    // Shadow, glow and blend are assembled by the motion module, which owns
    // the effect stack because box-shadow and filter are each a single
    // ordered value that separate rules would overwrite.
    if (props.effects && window.StudioMotion) out.push(...window.StudioMotion.effectDecls(props.effects));

    // One combined filter declaration, only when something deviates.
    const active = Object.keys(FILTER_PROPS).filter(k => props[k] !== undefined && num(props[k]) !== FILTER_DEFAULTS[k]);
    if (active.length) {
      const parts = Object.keys(FILTER_PROPS)
        .filter(k => props[k] !== undefined)
        .map(k => FILTER_PROPS[k](props[k]));
      if (parts.length) out.push(`filter:${parts.join(' ')}`);
    }
    return out;
  }

  /* ----------------------------------------------------------- emitCSS
   * Generates the stylesheet for a whole model: base, hover, pressed,
   * tablet, mobile. Hover rules are also mirrored onto
   * [data-preview-state="hover"] so Studio can preview a state without the
   * pointer actually being over the object (§20).
   */
  function emitCSS(model) {
    if (!model || !model.nodes) return '';
    const out = [];
    const rule = (sel, decls) => { if (decls.length) out.push(`${sel}{${decls.join(';')}}`); };

    // The page wrapper has no data-id, so its own background is emitted here.
    if (model.site && model.site.background) rule('.site', backgroundDecls(model.site.background));
    // Hero frame: absent means no frame, which is the default look.
    if (model.site && model.site.heroBorder) rule('.site', ['--hero-border:1px']);

    for (const id in model.nodes) {
      const n = model.nodes[id];
      const sel = `.site [data-id="${cssEscape(id)}"]`;
      rule(sel, declsFor(n.states && n.states.base));

      const hover = declsFor(n.states && n.states.hover);
      if (hover.length) {
        rule(`body:not(.editing) ${sel}:hover`, hover);
        rule(`${sel}[data-preview-state="hover"]`, hover);
      }
      const pressed = declsFor(n.states && n.states.pressed);
      if (pressed.length) {
        rule(`body:not(.editing) ${sel}:active`, pressed);
        rule(`${sel}[data-preview-state="pressed"]`, pressed);
      }
      if (n.visibility && n.visibility.hidden) rule(`${sel}`, ['display:none']);
    }

    // Responsive overrides share the same property table (§26), so a value can
    // be overridden per breakpoint without duplicating the DOM.
    for (const bp of ['tablet', 'mobile']) {
      const inner = [];
      for (const id in model.nodes) {
        const n = model.nodes[id];
        const ov = n.responsive && n.responsive[bp];
        const decls = declsFor(ov);
        if (decls.length) inner.push(`.site [data-id="${cssEscape(id)}"]{${decls.join(';')}}`);
        if (ov && ov.hidden === true) inner.push(`.site [data-id="${cssEscape(id)}"]{display:none}`);
        if (ov && ov.hidden === false) inner.push(`.site [data-id="${cssEscape(id)}"]{display:revert}`);
      }
      if (inner.length) out.push(`@media(max-width:${BREAKPOINTS[bp]}px){${inner.join('')}}`);
    }
    return out.join('\n');
  }

  /* ------------------------------------------------- inline style migration
   * Parses a schema-3 inline style string into typed properties. Anything not
   * recognised is preserved under node.unmapped rather than silently dropped
   * (§32), so nothing about the published look is lost on the way in.
   */
  const FROM_CSS = {
    'font-family': ['fontFamily', v => v],
    'font-size': ['fontSize', v => parseFloat(v)],
    'font-weight': ['fontWeight', v => v],
    'font-style': ['fontStyle', v => v],
    'letter-spacing': ['letterSpacing', v => Math.round(parseFloat(v) * 100)],
    'word-spacing': ['wordSpacing', v => parseFloat(v)],
    'line-height': ['lineHeight', v => parseFloat(v)],
    'text-align': ['textAlign', v => v],
    'text-transform': ['textTransform', v => v],
    'text-decoration': ['textDecoration', v => v],
    'color': ['color', v => v],
    'opacity': ['opacity', v => parseFloat(v)],
    'overflow': ['overflow', v => v],
    'z-index': ['zIndex', v => v],
    'justify-self': ['justifySelf', v => v],
    'border-width': ['borderWidth', v => parseFloat(v)],
    'border-style': ['borderStyle', v => v],
    'border-color': ['borderColor', v => v],
    'border-radius': ['borderRadius', v => parseFloat(v)],
    '--span': ['span', v => parseFloat(v)],
    '--h': ['tileHeight', v => parseFloat(v)],
    '--x': ['offsetX', v => parseFloat(v)],
    '--y': ['offsetY', v => parseFloat(v)],
    '--tr': ['tileRadius', v => parseFloat(v)],
    '--tile': ['tileTint', v => v],
    '--imgScale': ['imageZoom', v => parseFloat(v)],
    '--imgX': ['imageX', v => parseFloat(v)],
    '--imgY': ['imageY', v => parseFloat(v)],
    '--dur': ['motionDur', v => parseFloat(v)],
    '--delay': ['motionDelay', v => parseFloat(v)],
    '--dist': ['motionDist', v => parseFloat(v)],
    '--hoverScale': ['hoverScale', v => parseFloat(v)],
    '--hoverLift': ['hoverLift', v => parseFloat(v)],
  };

  // Written every pointer/scroll frame by the tilt and parallax handlers. The
  // old serialiser captured whatever the pointer happened to be doing and
  // published it, so a tile could load permanently rotated. Never persist.
  const EPHEMERAL = ['--rx', '--ry', '--pan'];

  function parseInlineStyle(str) {
    const props = {}, unmapped = {};
    if (!str) return { props, unmapped };
    for (const part of String(str).split(';')) {
      const i = part.indexOf(':');
      if (i < 0) continue;
      const k = part.slice(0, i).trim(), v = part.slice(i + 1).trim();
      if (!k || !v) continue;
      if (EPHEMERAL.includes(k)) continue;
      if (k === 'filter') {
        // brightness(1) contrast(1.2) saturate(1) blur(0px)
        for (const fk in FILTER_PROPS) {
          const css = fk === 'hueRotate' ? 'hue-rotate' : fk;
          const m = v.match(new RegExp(css + '\\(([^)]+)\\)'));
          if (!m) continue;
          const raw = parseFloat(m[1]);
          props[fk] = (fk === 'blur' || fk === 'hueRotate') ? raw : Math.round(raw * 100);
        }
        continue;
      }
      const map = FROM_CSS[k];
      if (map) { const parsed = map[1](v); if (!(typeof parsed === 'number' && isNaN(parsed))) props[map[0]] = parsed; }
      else unmapped[k] = v;
    }
    return { props: clean(props), unmapped };
  }

  /* ------------------------------------------------------------- migration */
  function migrate(raw) {
    const report = { from: null, unmappedNodes: [], unmappedProps: [], notes: [] };
    if (!raw || !isObj(raw)) return { model: blank(), report: { ...report, from: 'empty' } };
    if (raw.schema === CURRENT_SCHEMA) return { model: raw, report: { ...report, from: 'schema-4' } };
    // A config written by a NEWER editor must be passed through untouched.
    // Running it down the legacy path would quietly strip whatever that
    // version added, turning a forward-compatible load into data loss.
    if (typeof raw.schema === 'number' && raw.schema > CURRENT_SCHEMA) {
      return {
        model: raw,
        report: {
          ...report,
          from: `schema-${raw.schema}`,
          notes: [`This config was written by a newer Studio (schema ${raw.schema}); this build understands ${CURRENT_SCHEMA}. It was applied as-is rather than downgraded, so newer settings are preserved but may not be editable here.`],
        },
      };
    }

    report.from = raw.schema ? `schema-${raw.schema}` : 'legacy';
    const model = blank();
    if (raw.G) model.site = { ...raw.G };
    if (raw.brand) model.brand = { ...raw.brand };
    if (raw.hero) model.hero = { ...raw.hero };
    if (raw.links) model.links = clone(raw.links);
    if (raw.projects) model.projects = clone(raw.projects);
    if (Array.isArray(raw.order)) model.order = raw.order.slice();

    for (const id in (raw.nodes || {})) {
      const old = raw.nodes[id] || {};
      const data = old.data || {};
      const { props, unmapped } = parseInlineStyle(old.style);
      const node = {
        id,
        type: NODE_TYPES.includes(data.type) ? data.type : (id.startsWith('tile-') ? 'tile' : 'text'),
        name: data.node || id,
        parent: null,
        content: clean({
          html: old.html === null ? undefined : old.html,
          title: old.title,
          sub: old.sub,
          tag: old.tag,
        }),
        media: clean({ src: old.img || undefined }),
        states: { base: props, hover: {}, pressed: {} },
        responsive: {},
        motion: clean({
          preset: data.motion,
          replay: data.replay === '1' || data.replay === true || undefined,
        }),
        interaction: clean({
          action: data.action,
          target: data.target,
          url: data.url,
          textLink: data.textLink,
          textLinkEnabled: data.textLinkEnabled ? true : undefined,
        }),
        visibility: { hidden: false, locked: false },
        effects: clean({ edge: data.edge, edges: old.edges }),
        tilt: data.hover === 'tilt' ? { enabled: true, strength: num(data.strength, 9) } : { enabled: false },
        placeholder: !!old.placeholder,
      };
      // hover preset carried the old one-off hover behaviour; keep it addressable
      if (data.hover && data.hover !== 'tilt' && data.hover !== 'none') node.motion.hoverPreset = data.hover;
      if (data.strength !== undefined) node.effects.strength = num(data.strength, 9);

      if (old.authored) node.authored = true;
      if (old.texture) node.texture = clone(old.texture);
      if (old.background) node.background = clone(old.background);
      if (Object.keys(unmapped).length) {
        node.unmapped = unmapped;
        report.unmappedProps.push({ id, props: Object.keys(unmapped) });
      }
      model.nodes[id] = node;
    }
    return { model, report };
  }

  function blank() {
    return { schema: CURRENT_SCHEMA, site: {}, brand: {}, hero: {}, links: {}, projects: {}, order: [], nodes: {} };
  }

  /* ---------------------------------------------------------------- fromDOM
   * Builds the model from the live page. During the transition the DOM is
   * still the source of truth for text content and tile order, so this reads
   * both the DOM and the editor's own globals. Typed props already held in
   * model form are preserved via prev, so a round trip never downgrades a
   * hover or responsive override into nothing.
   */
  function fromDOM(opts) {
    const o = opts || {};
    const root = o.root || document;
    const prev = o.prev && o.prev.nodes ? o.prev.nodes : {};
    const model = blank();
    // Previous site settings first, then the editor's G globals over the top.
    // Rebuilding site from G alone dropped every model-only setting — texture,
    // background, the hero frame — on the next read, so they never reached
    // publish. Listing them one by one meant each new setting repeated the
    // bug, so the whole bag is carried and G simply wins for its own keys.
    model.site = { ...clone((o.prev && o.prev.site) || {}), ...(o.G || {}) };
    model.brand = { ...(o.BRAND || {}) };
    model.hero = { ...(o.HERO || {}) };
    model.links = clone(o.LINKS || {});
    model.projects = clone(o.PROJECTS || {});
    model.order = [...root.querySelectorAll('.tile')].map(t => t.dataset.id);
    // Every node in document order, so objects added in Studio can be put back
    // where they were. Without this only tiles survived a reload.
    model.domOrder = [...root.querySelectorAll('[data-node]')]
      .filter(e => !(e.closest && e.closest(CHROME)))
      .map(e => e.dataset.id).filter(Boolean);

    for (const el of root.querySelectorAll('[data-node]')) {
      if (el.closest && el.closest(CHROME)) continue;
      const id = el.dataset.id;
      if (!id) continue;
      const before = prev[id] || {};
      const inline = parseInlineStyle(el.getAttribute('style'));
      const img = contentImage(el);
      const q = sel => { const e = el.querySelector && el.querySelector(sel); return e ? e.textContent : undefined; };

      model.nodes[id] = {
        id,
        type: el.dataset.type || before.type || 'text',
        name: el.dataset.node || before.name || id,
        // Derived from the DOM, not carried blindly: nesting is only real if
        // it can be rebuilt, and a stale parent would resurrect old structure.
        parent: (() => {
          const p = el.parentElement && el.parentElement.closest('[data-node]');
          return p && p.dataset.id ? p.dataset.id : null;
        })(),
        content: clean({
          // When text is split for a staggered reveal, the spans are
          // presentation. Reading innerHTML here would store them as content,
          // and apply() would write them back — corrupting the text and
          // publishing it pre-split.
          html: el.dataset.type === 'text'
            ? (el.dataset.splitOriginal !== undefined ? el.dataset.splitOriginal : el.innerHTML)
            : undefined,
          title: q('.t-title'),
          sub: q('.t-sub'),
          tag: q('.tag'),
          alt: img ? (img.getAttribute('alt') || undefined) : undefined,
        }),
        media: clean({
          src: img ? img.getAttribute('src') : (before.media && before.media.src),
          assetId: before.media && before.media.assetId,
          // Kept so a republished page can reserve the artwork's space before
          // the file arrives instead of reflowing as each image lands.
          width: img ? (img.getAttribute('width') || img.naturalWidth || undefined) : (before.media && before.media.width),
          height: img ? (img.getAttribute('height') || img.naturalHeight || undefined) : (before.media && before.media.height),
        }),
        // Base merges what the model already knew with anything the old
        // inline-style controls just wrote, so both paths work mid-migration.
        states: {
          base: { ...(before.states && before.states.base), ...inline.props },
          hover: clone((before.states && before.states.hover) || {}),
          pressed: clone((before.states && before.states.pressed) || {}),
        },
        responsive: clone(before.responsive || {}),
        motion: clean({
          ...(before.motion || {}),
          preset: el.dataset.motion || (before.motion && before.motion.preset),
          replay: el.dataset.replay === '1' ? true : undefined,
        }),
        interaction: clean({
          ...(before.interaction || {}),
          // Prefer the DOM, fall back to what the model already held: a value
          // set on the model alone would otherwise be erased on the next read.
          action: el.dataset.action || (before.interaction && before.interaction.action),
          target: el.dataset.target || (before.interaction && before.interaction.target),
          textLink: el.dataset.textLink,
          textLinkEnabled: el.dataset.textLinkEnabled ? true : undefined,
        }),
        visibility: {
          hidden: !!(before.visibility && before.visibility.hidden),
          locked: !!(before.visibility && before.visibility.locked),
        },
        effects: clean({
          ...(before.effects || {}),
          edge: el.dataset.edge,
          edges: ['top', 'bottom', 'left', 'right'].filter(k => {
            const e = el.querySelector && el.querySelector('.edge.' + k);
            return e && e.classList.contains('on');
          }),
          strength: el.dataset.strength !== undefined ? num(el.dataset.strength, 9) : undefined,
        }),
        tilt: el.dataset.hover === 'tilt'
          ? { enabled: true, ...(before.tilt || {}), strength: num(el.dataset.strength, 9) }
          : { ...(before.tilt || {}), enabled: false },
        placeholder: el.classList.contains('placeholder'),
        // Set by the shell when it creates an object, so a reload knows the
        // difference between "Studio made this" and "the page used to have one".
        authored: el.dataset.authored === '1' || before.authored === true || undefined,
      };
      if (before.unmapped) model.nodes[id].unmapped = before.unmapped;
      if (before.texture) model.nodes[id].texture = clone(before.texture);
      if (before.background) model.nodes[id].background = clone(before.background);
    }
    return model;
  }


  /* Rebuilds an element for any node type. Previously only tiles could be
   * recreated, so every heading, button, section or shape added in Studio was
   * published and then silently missing on the next load.
   */
  const TAGS = {
    text: 'p', heading: 'h2', tile: 'article', hero: 'div', logo: 'span',
    button: 'a', section: 'section', container: 'div', divider: 'hr',
    spacer: 'div', shape: 'div',
  };
  const CLASSES = {
    button: 'ui-btn', divider: 'rule', spacer: 'spacer', shape: 'shape',
    container: 'container-box', section: 'section', tile: 'tile',
  };

  function createElementFor(id, node) {
    const type = (node && node.type) || 'text';
    if (type === 'tile') return null;            // tiles keep their own builder
    const el = document.createElement(TAGS[type] || 'div');
    if (CLASSES[type]) el.className = CLASSES[type];
    el.dataset.id = id;
    el.dataset.type = type;
    el.dataset.node = (node && node.name) || id;
    const c = (node && node.content) || {};
    if (c.html != null) el.innerHTML = c.html;
    if (type === 'button') {
      const url = (node.interaction && (node.interaction.target || node.interaction.url)) || '#';
      el.href = url;
      if (node.interaction && node.interaction.newTab) { el.target = '_blank'; el.rel = 'noopener'; }
    }
    return el;
  }

  // Puts hydrated nodes back into their recorded parent and document order.
  function restoreStructure(model, root) {
    const order = model.domOrder || [];
    if (!order.length) return;
    const fallback = root.querySelector('.site') || document.body;
    for (const id of order) {
      const el = findNode(root, id);
      if (!el) continue;
      const node = model.nodes[id];
      const parentId = node && node.parent;
      const parent = parentId ? findNode(root, parentId) : null;
      // Never reparent a tile out of the grid, and never nest inside itself.
      if (parent && parent !== el && !el.contains(parent)) {
        if (el.parentElement !== parent) parent.appendChild(el);
      } else if (!parentId && !el.parentElement) {
        fallback.appendChild(el);
      }
    }
    // Second pass fixes sibling order within each parent.
    for (const id of order) {
      const el = findNode(root, id);
      if (!el || el.classList.contains('tile')) continue;
      const host = el.parentElement;
      if (host) host.appendChild(el);
    }
  }

  /* ------------------------------------------------------------------ apply
   * Writes a model onto the page: content and behaviour onto the DOM,
   * everything visual into one generated stylesheet. Nodes present in the
   * model but absent from the page are reported rather than dropped (§32).
   */
  function apply(model, opts) {
    const o = opts || {};
    const root = o.root || document;
    const missing = [], hydrated = [];
    if (!model || !model.nodes) return { missing, hydrated };

    for (const id in model.nodes) {
      const n = model.nodes[id];
      let el = findNode(root, id);
      if (!el && o.hydrate) el = o.hydrate(id, n);
      // Rebuild only what Studio itself created. A legacy config still carries
      // ids the page retired in a redesign (renamed or deleted), and
      // recreating those appends duplicate, resurrected content to the public
      // page. Anything else missing is reported, not invented.
      if (!el && n.authored) el = createElementFor(id, n);
      if (!el) { missing.push({ id, type: n.type, name: n.name, authored: !!n.authored }); continue; }
      if (!el.isConnected) {
        // Parked at the end for now; restoreStructure puts it in place once
        // every node exists, since a parent may be hydrated after its child.
        (root.querySelector('.site') || document.body).appendChild(el);
        hydrated.push(id);
      }

      // The static HTML ships design defaults as inline styles, and inline
      // beats a stylesheet on specificity — leaving them in place would let a
      // stale inline value silently shadow every later model edit. Adopt
      // anything the model does not already know, then clear the attribute so
      // the model is the single source of truth. Ephemeral pointer values are
      // left alone: they are rewritten every frame and own nothing.
      adoptInline(el, n);

      if (n.authored) el.dataset.authored = '1';
      if (n.name) el.dataset.node = n.name;
      if (n.type) el.dataset.type = n.type;
      if (n.motion && n.motion.preset) el.dataset.motion = n.motion.preset;
      if (n.motion && n.motion.imageAnim && n.motion.imageAnim !== 'none') el.dataset.imgAnim = n.motion.imageAnim;
      else delete el.dataset.imgAnim;
      if (n.motion && n.motion.replay) el.dataset.replay = '1'; else delete el.dataset.replay;
      if (n.interaction) {
        if (n.interaction.action) el.dataset.action = n.interaction.action;
        if (n.interaction.target) el.dataset.target = n.interaction.target;
        if (n.interaction.textLink) el.dataset.textLink = n.interaction.textLink;
        if (n.interaction.textLinkEnabled) el.dataset.textLinkEnabled = '1'; else delete el.dataset.textLinkEnabled;
      }
      // Only write data-hover when there is a real preset. Writing 'none'
      // where the attribute was previously absent is a needless DOM diff.
      const hoverPreset = (n.tilt && n.tilt.enabled) ? 'tilt' : (n.motion && n.motion.hoverPreset) || '';
      if (hoverPreset) el.dataset.hover = hoverPreset; else delete el.dataset.hover;
      if (n.effects) {
        if (n.effects.edge) el.dataset.edge = n.effects.edge;
        if (n.effects.strength !== undefined) el.dataset.strength = String(n.effects.strength);
        ['top', 'bottom', 'left', 'right'].forEach(k => {
          const e = el.querySelector && el.querySelector('.edge.' + k);
          if (e) e.classList.toggle('on', (n.effects.edges || []).includes(k));
        });
      }
      el.dataset.locked = (n.visibility && n.visibility.locked) ? '1' : '';
      if (!el.dataset.locked) delete el.dataset.locked;

      const c = n.content || {};
      if (c.html != null && el.dataset.type === 'text') {
        // Re-writing innerHTML on a split element would destroy the spans the
        // stagger depends on; the motion module re-splits from the original.
        if (el.dataset.splitMode) el.dataset.splitOriginal = c.html;
        else if (el.innerHTML !== c.html) el.innerHTML = c.html;
      }
      const set = (sel, val) => { const e = el.querySelector && el.querySelector(sel); if (e && val != null) e.textContent = val; };
      set('.t-title', c.title); set('.t-sub', c.sub); set('.tag', c.tag);

      if (n.media && n.media.src) {
        /* The hero has two images: the blurred full-bleed backdrop and the
         * artwork itself. A plain querySelector('img') returns the backdrop,
         * so a newly chosen hero image used to land on the blur layer while the
         * real hero kept the old picture — and the backdrop, which is
         * aria-hidden decoration, was given the node's name as alt text.
         * Pick the content image, and mirror the source onto any decorative
         * layer without ever giving it a description.
         */
        let im = contentImage(el);
        if (!im && el.classList.contains('tile')) {
          im = document.createElement('img');
          im.loading = 'lazy'; im.decoding = 'async';
          el.prepend(im);
        }
        if (im) {
          if (im.getAttribute('src') !== n.media.src) im.src = n.media.src;
          /* Never let a tooling identifier become alt text. The old
           * first-<img> bug stored the node id as the hero's alt, so a screen
           * reader announced "hero-media". An id or a layer name is not a
           * description, so it is treated as no description at all. */
          const authored = c.alt && c.alt !== n.id && c.alt !== n.name ? c.alt : '';
          im.alt = authored || 'Portfolio artwork';
          if (n.media.width && n.media.height) {
            // Reserve the space before the file arrives, so loading artwork
            // does not push the page around under the reader.
            im.setAttribute('width', n.media.width);
            im.setAttribute('height', n.media.height);
          }
          el.classList.remove('placeholder');
          const ph = el.querySelector('.ph'); if (ph) ph.remove();
        }
        if (el.querySelectorAll) el.querySelectorAll(DECORATIVE_IMG).forEach(d => {
          if (d === im) return;
          if (d.getAttribute('src') !== n.media.src) d.src = n.media.src;
          d.alt = '';
        });
      } else if (n.placeholder && el.classList.contains('tile')) {
        el.classList.add('placeholder');
      }
    }

    // Tile order
    const grid = root.querySelector('.grid');
    if (grid) for (const id of (model.order || [])) {
      const el = findNode(root, id);
      if (el && el.classList.contains('tile')) grid.appendChild(el);
    }

    restoreStructure(model, root);
    writeCSS(emitCSS(model));
    // Texture overlays are real elements, not declarations, so they are built
    // after the stylesheet rather than emitted into it.
    // Visitors need the chosen webfont families too, or a published pairing
    // renders in the fallback stack.
    if (window.StudioPresets) window.StudioPresets.hydrate(model);
    if (window.StudioBackground) window.StudioBackground.applyFromModel(model);
    if (window.StudioMotion) window.StudioMotion.applyFromModel(model);
    if (window.StudioTexture) window.StudioTexture.syncModel(model);
    return { missing, hydrated };
  }


  function adoptInline(el, n) {
    const raw = el.getAttribute('style');
    if (!raw) return;
    const { props } = parseInlineStyle(raw);
    n.states = n.states || { base: {}, hover: {}, pressed: {} };
    n.states.base = n.states.base || {};
    for (const k in props) if (n.states.base[k] === undefined) n.states.base[k] = props[k];
    // Keep only the ephemeral declarations the live handlers own.
    const keep = [];
    for (const part of raw.split(';')) {
      const i = part.indexOf(':');
      if (i < 0) continue;
      if (EPHEMERAL.includes(part.slice(0, i).trim())) keep.push(part.trim());
    }
    if (keep.length) el.setAttribute('style', keep.join(';'));
    else el.removeAttribute('style');
  }

  let sheet = null;
  function writeCSS(text) {
    if (!sheet) {
      sheet = document.getElementById('studio-generated');
      if (!sheet) {
        sheet = document.createElement('style');
        sheet.id = 'studio-generated';
        document.head.appendChild(sheet);
      }
    }
    if (sheet.textContent !== text) sheet.textContent = text;
    return sheet;
  }

  /* --------------------------------------------------------- state preview */
  function previewState(el, state) {
    if (!el) return;
    if (!state || state === 'base') delete el.dataset.previewState;
    else el.dataset.previewState = state;
  }

  /* ------------------------------------------------------------- accessors */
  function getProp(model, id, prop, state, breakpoint) {
    const n = model && model.nodes && model.nodes[id];
    if (!n) return undefined;
    if (breakpoint && n.responsive && n.responsive[breakpoint] && n.responsive[breakpoint][prop] !== undefined)
      return n.responsive[breakpoint][prop];
    const s = state || 'base';
    if (n.states && n.states[s] && n.states[s][prop] !== undefined) return n.states[s][prop];
    if (s !== 'base' && n.states && n.states.base) return n.states.base[prop];
    return undefined;
  }

  // Reports whether a value is the node's own or inherited from base/desktop,
  // which the inspector shows so an override is never invisible (§26).
  function propOrigin(model, id, prop, state, breakpoint) {
    const n = model && model.nodes && model.nodes[id];
    if (!n) return 'none';
    if (breakpoint && n.responsive && n.responsive[breakpoint] && n.responsive[breakpoint][prop] !== undefined) return 'override';
    const s = state || 'base';
    if (s !== 'base' && n.states && n.states[s] && n.states[s][prop] !== undefined) return 'override';
    if (n.states && n.states.base && n.states.base[prop] !== undefined) return 'base';
    return 'none';
  }

  function setProp(model, id, prop, value, state, breakpoint) {
    const n = model && model.nodes && model.nodes[id];
    if (!n) return false;
    const drop = value === undefined || value === null || value === '';
    if (breakpoint) {
      n.responsive = n.responsive || {};
      n.responsive[breakpoint] = n.responsive[breakpoint] || {};
      if (drop) delete n.responsive[breakpoint][prop]; else n.responsive[breakpoint][prop] = value;
    } else {
      const s = state || 'base';
      n.states = n.states || { base: {}, hover: {}, pressed: {} };
      n.states[s] = n.states[s] || {};
      if (drop) delete n.states[s][prop]; else n.states[s][prop] = value;
    }
    return true;
  }

  window.StudioModel = {
    CURRENT_SCHEMA, STATES, BREAKPOINTS, NODE_TYPES, CSS_MAP, FILTER_PROPS,
    blank, migrate, fromDOM, apply, emitCSS, writeCSS, previewState,
    getProp, setProp, propOrigin, parseInlineStyle, gradientCSS, declsFor, EPHEMERAL, adoptInline,
    createElementFor, restoreStructure, findNode, contentImage, DECORATIVE_IMG,
  };
})();
