/* Animated texture / grain overlays (§24) and the motion-system extensions
 * they share with everything else (§21).
 *
 * Grain is drawn once as a small tiling SVG turbulence and then only ever
 * transformed. Regenerating raster noise per frame, or animating a full-bleed
 * high-resolution texture, is the expensive mistake the spec calls out: the
 * overlay here is a fixed, repeating source that moves on the compositor.
 *
 * The overlay is always its own child element, never the host's own transform.
 * 3D tilt and drag both write transform on the host, so sharing it would mean
 * texture motion fighting the tilt handler and the editor's drag — the exact
 * collision the handoff lists as a worked example.
 *
 * Exposed as window.StudioTexture.
 */
(() => {
  'use strict';

  const MODES = {
    static:    { label: 'Static',          animation: null },
    drift:     { label: 'Drift',           animation: 'tex-drift' },
    crawl:     { label: 'Film crawl',      animation: 'tex-crawl' },
    jitter:    { label: 'Micro jitter',    animation: 'tex-jitter' },
    breathe:   { label: 'Breathing',       animation: 'tex-breathe' },
    parallax:  { label: 'Parallax',        animation: null, scroll: 'parallax' },
    scroll:    { label: 'Scroll reactive', animation: null, scroll: 'reactive' },
    flow:      { label: 'Directional flow', animation: 'tex-flow' },
  };

  const PRESETS = {
    grain:  { label: 'Fine grain',  baseFrequency: 0.8,  octaves: 4, type: 'fractalNoise' },
    coarse: { label: 'Coarse grain', baseFrequency: 0.36, octaves: 3, type: 'fractalNoise' },
    paper:  { label: 'Paper',       baseFrequency: 0.05, octaves: 5, type: 'fractalNoise' },
    clouds: { label: 'Clouds',      baseFrequency: 0.012, octaves: 4, type: 'fractalNoise' },
  };

  // Keeps grain from ever rendering as an opaque sheet over the artwork (§24).
  const MAX_OPACITY = 0.42;

  const DEFAULTS = {
    enabled: false,
    preset: 'grain',
    mode: 'static',
    opacity: 0.12,
    scale: 180,
    speed: 1,
    angle: 0,
    amplitude: 14,
    blend: 'overlay',
    alternate: false,
  };

  const reduced = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function noiseURL(presetKey) {
    const p = PRESETS[presetKey] || PRESETS.grain;
    // A single tile, generated once. Encoded rather than base64 so it stays
    // readable and small.
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="180" height="180">` +
      `<filter id="n"><feTurbulence type="${p.type}" baseFrequency="${p.baseFrequency}" numOctaves="${p.octaves}" stitchTiles="stitch"/>` +
      `<feColorMatrix type="saturate" values="0"/></filter>` +
      `<rect width="180" height="180" filter="url(#n)"/></svg>`;
    return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
  }

  function layerFor(host) {
    let layer = host.querySelector(':scope > .tex-layer');
    if (!layer) {
      layer = document.createElement('div');
      layer.className = 'tex-layer';
      layer.setAttribute('aria-hidden', 'true');
      host.appendChild(layer);
      // The host must establish a containing block, or a positioned overlay
      // would escape to the nearest ancestor.
      const pos = getComputedStyle(host).position;
      if (pos === 'static') host.dataset.texPositioned = '1';
    }
    return layer;
  }

  function clear(host) {
    const layer = host.querySelector(':scope > .tex-layer');
    if (layer) layer.remove();
    delete host.dataset.texPositioned;
    delete host.dataset.texMode;
  }

  function apply(host, cfgIn) {
    if (!host) return;
    const cfg = { ...DEFAULTS, ...(cfgIn || {}) };
    if (!cfg.enabled) return clear(host);

    const layer = layerFor(host);
    const mode = MODES[cfg.mode] ? cfg.mode : 'static';
    const def = MODES[mode];
    const opacity = Math.min(MAX_OPACITY, Math.max(0, Number(cfg.opacity) || 0));

    layer.style.backgroundImage = noiseURL(cfg.preset);
    layer.style.backgroundSize = `${Math.max(40, Number(cfg.scale) || 180)}px`;
    layer.style.opacity = String(opacity);
    layer.style.mixBlendMode = cfg.blend || 'overlay';
    layer.style.setProperty('--tex-amp', (Number(cfg.amplitude) || 14) + 'px');
    layer.style.setProperty('--tex-angle', (Number(cfg.angle) || 0) + 'deg');

    const speed = Math.max(0.05, Number(cfg.speed) || 1);
    const duration = (18 / speed).toFixed(2) + 's';
    host.dataset.texMode = mode;

    // Reduced motion keeps the texture but stops it moving. Removing the
    // texture entirely would change the design, not just the motion (§34).
    if (def.animation && !reduced()) {
      layer.style.animationName = def.animation;
      layer.style.animationDuration = duration;
      layer.style.animationTimingFunction = mode === 'jitter' ? 'steps(6, end)' : 'linear';
      layer.style.animationIterationCount = 'infinite';
      layer.style.animationDirection = cfg.alternate ? 'alternate' : 'normal';
    } else {
      layer.style.animationName = 'none';
    }

    if (def.scroll && !reduced()) registerScroll(host, layer, def.scroll, cfg);
    else unregisterScroll(host);
  }

  /* -------------------------------------------------- scroll-driven modes */
  const scrollers = new Map();

  function registerScroll(host, layer, kind, cfg) {
    scrollers.set(host, { layer, kind, cfg });
    startLoop();
  }
  function unregisterScroll(host) {
    scrollers.delete(host);
    if (!scrollers.size) stopLoop();
  }

  let raf = null;
  function tick() {
    raf = null;
    for (const [host, s] of scrollers) {
      if (!host.isConnected) { scrollers.delete(host); continue; }
      const r = host.getBoundingClientRect();
      const progress = Math.max(0, Math.min(1, (window.innerHeight - r.top) / (window.innerHeight + r.height)));
      const amp = Number(s.cfg.amplitude) || 14;
      if (s.kind === 'parallax') {
        // Texture moves at a different rate from the content it sits on.
        s.layer.style.transform = `translate3d(0,${((progress - 0.5) * amp * 2).toFixed(2)}px,0)`;
      } else {
        s.layer.style.transform = `translate3d(0,${((progress - 0.5) * amp).toFixed(2)}px,0)`;
        const base = Math.min(MAX_OPACITY, Number(s.cfg.opacity) || 0.12);
        s.layer.style.opacity = String((base * (0.45 + progress * 0.55)).toFixed(3));
      }
    }
    if (scrollers.size && !document.hidden) schedule();
  }
  function schedule() { if (raf === null) raf = requestAnimationFrame(tick); }
  function onScroll() { schedule(); }
  function startLoop() {
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    schedule();
  }
  function stopLoop() {
    window.removeEventListener('scroll', onScroll);
    window.removeEventListener('resize', onScroll);
    if (raf !== null) { cancelAnimationFrame(raf); raf = null; }
  }

  /* Continuous motion has no reason to run while the tab is in the background,
   * and burning a phone battery on invisible grain is the kind of thing the
   * performance section is about (§33).
   */
  document.addEventListener('visibilitychange', () => {
    document.querySelectorAll('.tex-layer').forEach(l => {
      l.style.animationPlayState = document.hidden ? 'paused' : 'running';
    });
    if (!document.hidden) schedule();
  });

  // Following the OS preference live, not only at load.
  if (window.matchMedia) {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = () => {
      if (window.StudioTexture && typeof window.StudioTexture.reapply === 'function') window.StudioTexture.reapply();
    };
    if (mq.addEventListener) mq.addEventListener('change', onChange);
  }

  /* -------------------------------------------------------- model binding */
  function applyFromModel(model) {
    if (!model || !model.nodes) return 0;
    let n = 0;
    for (const id in model.nodes) {
      const node = model.nodes[id];
      const tex = node.texture;
      const host = document.querySelector(`[data-id="${String(id).replace(/["\\]/g, '\\$&')}"]`);
      if (!host) continue;
      if (tex && tex.enabled) { apply(host, tex); n++; } else clear(host);
    }
    // Site-level texture lives on the page wrapper (§24).
    const site = document.querySelector('.site');
    if (site && model.site && model.site.texture) {
      if (model.site.texture.enabled) { apply(site, model.site.texture); n++; } else clear(site);
    }
    return n;
  }

  let lastModel = null;
  function reapply() { if (lastModel) applyFromModel(lastModel); }
  function syncModel(model) { lastModel = model; return applyFromModel(model); }

  window.StudioTexture = {
    MODES, PRESETS, DEFAULTS, MAX_OPACITY,
    apply, clear, applyFromModel, syncModel, reapply,
    reducedMotion: reduced,
  };
})();
