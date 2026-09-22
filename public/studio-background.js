/* Background system: solid, gradient and image, with a real stop editor
 * (§14/§15).
 *
 * Gradient and image backgrounds are composited on a dedicated `.bg-layer`
 * child rather than the host's own `background`. Overall opacity, blur, zoom
 * and parallax cannot be applied to an element's own background without
 * faking them — an element's `opacity` would fade its text too. A layer makes
 * every one of those controls do exactly what it says.
 *
 * Solid colours are not handled here: they are a plain declaration the model
 * emits, so a hover or breakpoint can override a background colour like any
 * other property.
 *
 * Gradients are stored structurally — type, angle, ordered stops, reverse,
 * opacity — never as an opaque CSS string, so the editor can always read its
 * own work back (§15).
 *
 * Exposed as window.StudioBackground.
 */
(() => {
  'use strict';

  const $ = (s, p = document) => p.querySelector(s);
  const $$ = (s, p = document) => [...p.querySelectorAll(s)];

  /* Curated presets as data rather than a handful of hard-coded choices (§15).
   * Each is a real stop list the editor can then adjust, not a frozen image.
   */
  const GRADIENT_PRESETS = [
    { name: 'Ink wash',      type: 'linear', angle: 180, stops: [{ color: '#0f1113', at: 0 }, { color: '#242a2e', at: 100 }] },
    { name: 'Studio warm',   type: 'linear', angle: 160, stops: [{ color: '#1a1614', at: 0 }, { color: '#3a2d22', at: 100 }] },
    { name: 'Acid edge',     type: 'linear', angle: 135, stops: [{ color: '#10120f', at: 0 }, { color: '#bdd657', at: 100 }] },
    { name: 'Cold steel',    type: 'linear', angle: 200, stops: [{ color: '#0d1418', at: 0 }, { color: '#2b4652', at: 100 }] },
    { name: 'Ember',         type: 'linear', angle: 20,  stops: [{ color: '#1b0f0c', at: 0 }, { color: '#7a2f18', at: 60 }, { color: '#d4763a', at: 100 }] },
    { name: 'Paper',         type: 'linear', angle: 180, stops: [{ color: '#f6f5f0', at: 0 }, { color: '#dcd8cb', at: 100 }] },
    { name: 'Dusk',          type: 'linear', angle: 190, stops: [{ color: '#15131f', at: 0 }, { color: '#3d2b4a', at: 55 }, { color: '#8d5f6d', at: 100 }] },
    { name: 'Deep teal',     type: 'linear', angle: 170, stops: [{ color: '#08131a', at: 0 }, { color: '#0f3b45', at: 100 }] },
    { name: 'Vignette',      type: 'radial', x: 50, y: 40, stops: [{ color: 'rgba(0,0,0,0)', at: 40 }, { color: 'rgba(0,0,0,.72)', at: 100 }] },
    { name: 'Spotlight',     type: 'radial', x: 50, y: 30, stops: [{ color: 'rgba(255,255,255,.18)', at: 0 }, { color: 'rgba(255,255,255,0)', at: 70 }] },
    { name: 'Top fade',      type: 'linear', angle: 180, stops: [{ color: 'rgba(0,0,0,.65)', at: 0 }, { color: 'rgba(0,0,0,0)', at: 45 }] },
    { name: 'Bottom fade',   type: 'linear', angle: 0,   stops: [{ color: 'rgba(0,0,0,.72)', at: 0 }, { color: 'rgba(0,0,0,0)', at: 50 }] },
  ];

  const MODES = ['none', 'solid', 'gradient', 'image'];

  const DEFAULT_GRADIENT = () => ({
    type: 'linear', angle: 180, x: 50, y: 50, reverse: false, opacity: 1,
    stops: [{ color: '#10120f', at: 0 }, { color: '#bdd657', at: 100 }],
  });

  const DEFAULT_IMAGE = () => ({
    src: '', fit: 'cover', x: 50, y: 50, zoom: 1,
    opacity: 1, blur: 0, attachment: 'scroll',
  });

  const gradientCSS = g => (window.StudioModel ? window.StudioModel.gradientCSS(g) : null);

  /* ------------------------------------------------------------- layer */
  function layerFor(host) {
    let layer = host.querySelector(':scope > .bg-layer');
    if (!layer) {
      layer = document.createElement('div');
      layer.className = 'bg-layer';
      layer.setAttribute('aria-hidden', 'true');
      // First child so it sits behind content but above the host background.
      host.prepend(layer);
      if (getComputedStyle(host).position === 'static') host.dataset.bgPositioned = '1';
    }
    return layer;
  }

  function clear(host) {
    const layer = host.querySelector(':scope > .bg-layer');
    if (layer) layer.remove();
    delete host.dataset.bgPositioned;
    unregisterParallax(host);
  }

  function apply(host, bg) {
    if (!host) return;
    if (!bg || bg.mode === 'none' || bg.mode === 'solid') return clear(host);

    const layer = layerFor(host);
    const layers = [], sizes = [], positions = [], repeats = [], attachments = [];

    // An overlay gradient is a second background layer on the same element,
    // which is what makes "gradient over image" a single composited paint
    // rather than two stacked elements (§16).
    if (bg.overlay) {
      const ov = gradientCSS(bg.overlay);
      if (ov) { layers.push(ov); sizes.push('cover'); positions.push('center'); repeats.push('no-repeat'); attachments.push('scroll'); }
    }

    if (bg.mode === 'gradient') {
      const g = gradientCSS(bg.gradient) || gradientCSS(DEFAULT_GRADIENT());
      if (g) { layers.push(g); sizes.push('cover'); positions.push('center'); repeats.push('no-repeat'); attachments.push('scroll'); }
      layer.style.opacity = String(bg.gradient && bg.gradient.opacity !== undefined ? bg.gradient.opacity : 1);
      layer.style.filter = '';
    } else if (bg.mode === 'image') {
      const im = { ...DEFAULT_IMAGE(), ...(bg.image || {}) };
      if (!im.src) { clear(host); return; }
      layers.push(`url("${String(im.src).replace(/["\\]/g, '\\$&')}")`);
      // Zoom multiplies the chosen fit, so cropping and zoom stay independent
      // of each other and of any animation (§23).
      const z = Math.max(0.2, Number(im.zoom) || 1);
      sizes.push(im.fit === 'contain' ? `${100 * z}% auto` : im.fit === 'auto' ? 'auto' : `${100 * z}%`);
      positions.push(`${Number(im.x)}% ${Number(im.y)}%`);
      repeats.push('no-repeat');
      attachments.push(im.attachment === 'fixed' ? 'fixed' : 'scroll');
      layer.style.opacity = String(im.opacity !== undefined ? im.opacity : 1);
      layer.style.filter = Number(im.blur) ? `blur(${Number(im.blur)}px)` : '';
      if (im.attachment === 'parallax') registerParallax(host, layer, im); else unregisterParallax(host);
    }

    if (!layers.length) { clear(host); return; }
    layer.style.backgroundImage = layers.join(',');
    layer.style.backgroundSize = sizes.join(',');
    layer.style.backgroundPosition = positions.join(',');
    layer.style.backgroundRepeat = repeats.join(',');
    layer.style.backgroundAttachment = attachments.join(',');
    layer.style.mixBlendMode = bg.blend || 'normal';
  }

  /* --------------------------------------------------------- parallax
   * Transform only, on the layer, so it never fights the host's own transform
   * (tilt and drag both write that) and never triggers layout (§33).
   */
  const parallaxed = new Map();
  let raf = null;

  function registerParallax(host, layer, im) {
    parallaxed.set(host, { layer, im });
    if (parallaxed.size === 1) {
      window.addEventListener('scroll', schedule, { passive: true });
      window.addEventListener('resize', schedule, { passive: true });
    }
    schedule();
  }
  function unregisterParallax(host) {
    if (!parallaxed.has(host)) return;
    const s = parallaxed.get(host);
    if (s && s.layer) s.layer.style.transform = '';
    parallaxed.delete(host);
    if (!parallaxed.size) {
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      if (raf !== null) { cancelAnimationFrame(raf); raf = null; }
    }
  }
  function schedule() { if (raf === null) raf = requestAnimationFrame(tickParallax); }
  function tickParallax() {
    raf = null;
    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    for (const [host, s] of parallaxed) {
      if (!host.isConnected) { parallaxed.delete(host); continue; }
      if (reduce) { s.layer.style.transform = ''; continue; }
      const r = host.getBoundingClientRect();
      const p = Math.max(0, Math.min(1, (window.innerHeight - r.top) / (window.innerHeight + r.height)));
      s.layer.style.transform = `translate3d(0,${((p - 0.5) * 40).toFixed(2)}px,0)`;
    }
    if (parallaxed.size && !document.hidden) schedule();
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) schedule(); });

  /* ------------------------------------------------------- model binding */
  function applyFromModel(model) {
    if (!model) return 0;
    let n = 0;
    const site = document.querySelector('.site');
    if (site) {
      if (model.site && model.site.background) { apply(site, model.site.background); n++; }
      else clear(site);
    }
    for (const id in (model.nodes || {})) {
      const node = model.nodes[id];
      const host = window.StudioModel ? window.StudioModel.findNode(document, id) : null;
      if (!host) continue;
      const bg = node.states && node.states.base && node.states.base.background;
      if (bg && bg.mode && bg.mode !== 'none' && bg.mode !== 'solid') { apply(host, bg); n++; }
      else clear(host);
    }
    return n;
  }

  window.StudioBackground = {
    GRADIENT_PRESETS, MODES, DEFAULT_GRADIENT, DEFAULT_IMAGE,
    apply, clear, applyFromModel, gradientCSS,
  };
})();
