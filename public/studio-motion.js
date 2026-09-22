/* Motion system extensions (§21–§23) and the effects stack (§25).
 *
 * The existing engine had one scroll-reveal trigger and a preset name. This
 * adds the triggers, playback and text/image modes the spec asks for, without
 * a second animation library: the reveal still runs on CSS transitions driven
 * by an `.in` class, so nothing about the public page gets heavier.
 *
 * Per-character animation is opt-in and never the default. Wrapping every text
 * block in per-character spans is the expensive mistake the spec calls out, and
 * splitting text also destroys inline markup, so it only happens when asked
 * and only on the object asked for.
 *
 * Exposed as window.StudioMotion.
 */
(() => {
  'use strict';

  const TRIGGERS = {
    load:     'On page load',
    viewport: 'When it enters the viewport',
    hover:    'On hover',
    click:    'On click',
    scroll:   'Tied to scroll progress',
  };

  const TEXT_MODES = {
    object: 'Whole object',
    word:   'By word',
    line:   'By line',
    char:   'By character',
  };

  const IMAGE_PRESETS = {
    none:      'None',
    fade:      'Fade',
    scale:     'Scale',
    reveal:    'Reveal / mask',
    pan:       'Pan',
    float:     'Float',
    kenburns:  'Ken Burns',
  };

  const reduced = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ------------------------------------------------------------- splitting
   * Splits visible text into spans for staggered reveals. Refuses when the
   * element contains element children, because splitting would flatten links
   * and emphasis into plain text (§22).
   */
  function canSplit(el) {
    if (!el) return { ok: false, why: 'No object selected.' };
    // Judge the ORIGINAL markup, not the spans this module just produced.
    // Reading the live DOM meant an already-split element looked like it
    // contained markup worth protecting, so switching from word to character
    // was refused and silently left the previous mode in place.
    if (el.dataset.splitOriginal !== undefined) {
      const probe = document.createElement('div');
      probe.innerHTML = el.dataset.splitOriginal;
      if (probe.querySelector('*:not(br)')) {
        return { ok: false, why: 'This text contains links or other markup. Splitting it would flatten that, so per-word and per-character modes are unavailable here.' };
      }
      const t = (probe.textContent || '').trim();
      if (!t) return { ok: false, why: 'This object has no text to split.' };
      if (t.length > 600) return { ok: false, why: `That is ${t.length} characters. Per-character animation on a block this long would create ${t.length} elements, so it is limited to 600.` };
      return { ok: true };
    }
    if (el.querySelector('*:not(br)')) {
      return { ok: false, why: 'This text contains links or other markup. Splitting it would flatten that, so per-word and per-character modes are unavailable here.' };
    }
    const text = (el.textContent || '').trim();
    if (!text) return { ok: false, why: 'This object has no text to split.' };
    if (text.length > 600) {
      return { ok: false, why: `That is ${text.length} characters. Per-character animation on a block this long would create ${text.length} elements, so it is limited to 600.` };
    }
    return { ok: true };
  }

  function restore(el) {
    if (!el || !el.dataset.splitOriginal) return;
    el.innerHTML = el.dataset.splitOriginal;
    delete el.dataset.splitOriginal;
    delete el.dataset.splitMode;
  }

  function split(el, mode, staggerMs) {
    if (!el) return { ok: false, why: 'No object.' };
    if (mode === 'object') { restore(el); return { ok: true, parts: 0 }; }
    const check = canSplit(el);
    if (!check.ok) return check;

    if (!el.dataset.splitOriginal) el.dataset.splitOriginal = el.innerHTML;
    const source = el.dataset.splitOriginal.replace(/<br\s*\/?>/gi, '\n');
    const plain = source.replace(/<[^>]*>/g, '');

    let parts;
    if (mode === 'word') parts = plain.split(/(\s+)/);
    else if (mode === 'line') parts = plain.split('\n');
    else parts = [...plain];

    el.textContent = '';
    let index = 0;
    for (const part of parts) {
      if (mode === 'word' && /^\s+$/.test(part)) { el.appendChild(document.createTextNode(part)); continue; }
      if (mode === 'line' && part === '') continue;
      const span = document.createElement('span');
      span.className = 'split-part';
      span.textContent = part;
      // A stagger is a per-part delay, so the whole run stays one transition
      // rather than a queue of timers.
      span.style.setProperty('--part-delay', (index * Number(staggerMs || 40)) + 'ms');
      if (mode === 'char' && part === ' ') span.style.whiteSpace = 'pre';
      el.appendChild(span);
      if (mode === 'line') el.appendChild(document.createElement('br'));
      index++;
    }
    el.dataset.splitMode = mode;
    return { ok: true, parts: index };
  }

  /* --------------------------------------------------------------- triggers */
  const scrollBound = new Map();
  const observers = new WeakMap();
  // Handlers are kept per element so a trigger change can detach the previous
  // one. A single shared "already bound" flag left the old listener attached
  // and refused to add the new one, so switching trigger silently did nothing.
  const handlers = new WeakMap();

  function clearTriggers(el) {
    if (!el) return;
    const io = observers.get(el);
    if (io) { io.disconnect(); observers.delete(el); }
    const prev = handlers.get(el);
    if (prev) {
      for (const [type, fn] of Object.entries(prev)) el.removeEventListener(type, fn);
      handlers.delete(el);
    }
    scrollBound.delete(el);
    el.style.removeProperty('--progress');
    el.classList.remove('in');
  }

  function replay(el) {
    if (!el) return;
    el.classList.remove('in');
    void el.offsetWidth;                      // force a reflow so the transition restarts
    requestAnimationFrame(() => el.classList.add('in'));
  }

  function bindTrigger(el, motion) {
    if (!el) return;
    clearTriggers(el);
    const m = motion || {};
    const trigger = m.trigger || 'viewport';

    // Reduced motion: reveal immediately and bind nothing continuous (§34).
    if (reduced()) { el.classList.add('in'); return; }

    if (trigger === 'load') { requestAnimationFrame(() => el.classList.add('in')); return; }

    if (trigger === 'viewport') {
      // threshold 0 plus a ratio check, because a clipped or collapsed element
      // reports ratio 0 and would never reach a higher threshold.
      const io = new IntersectionObserver(entries => {
        for (const e of entries) {
          if (e.isIntersecting) {
            el.classList.add('in');
            if (!m.replay) io.unobserve(el);
          } else if (m.replay) {
            el.classList.remove('in');
          }
        }
      }, { threshold: 0, rootMargin: '0px 0px -12% 0px' });
      io.observe(el);
      observers.set(el, io);
      return;
    }

    if (trigger === 'hover' || trigger === 'click') {
      const type = trigger === 'hover' ? 'mouseenter' : 'click';
      const fn = () => { if (!reduced()) replay(el); };
      el.addEventListener(type, fn);
      handlers.set(el, { [type]: fn });
      el.classList.add('in');
      return;
    }
    if (trigger === 'scroll') {
      // Progress-driven rather than a one-shot reveal.
      el.classList.add('in');
      registerScroll(el, m);
      return;
    }
  }

  let raf = null;
  function registerScroll(el, m) {
    scrollBound.set(el, m);
    if (scrollBound.size === 1) {
      window.addEventListener('scroll', schedule, { passive: true });
      window.addEventListener('resize', schedule, { passive: true });
    }
    schedule();
  }
  function schedule() { if (raf === null) raf = requestAnimationFrame(tick); }
  function tick() {
    raf = null;
    for (const [el, m] of scrollBound) {
      if (!el.isConnected) { scrollBound.delete(el); continue; }
      const r = el.getBoundingClientRect();
      const p = Math.max(0, Math.min(1, (window.innerHeight - r.top) / (window.innerHeight + r.height)));
      el.style.setProperty('--progress', p.toFixed(3));
    }
    if (scrollBound.size && !document.hidden) schedule();
  }

  /* ------------------------------------------------------- effects (§25)
   * Typed effect values become one shadow list and one filter, because both
   * CSS properties are single ordered values: emitting them separately would
   * mean the last rule silently won.
   */
  function effectDecls(fx) {
    if (!fx) return [];
    const out = [];
    const shadows = [];
    if (fx.shadow && fx.shadow.enabled) {
      const s = fx.shadow;
      shadows.push(`${Number(s.x) || 0}px ${Number(s.y) || 12}px ${Number(s.blur) || 30}px ${Number(s.spread) || 0}px ${s.color || 'rgba(0,0,0,.45)'}`);
    }
    if (fx.innerShadow && fx.innerShadow.enabled) {
      const s = fx.innerShadow;
      shadows.push(`inset ${Number(s.x) || 0}px ${Number(s.y) || 4}px ${Number(s.blur) || 18}px ${Number(s.spread) || 0}px ${s.color || 'rgba(0,0,0,.5)'}`);
    }
    if (fx.glow && fx.glow.enabled) {
      const g = fx.glow;
      shadows.push(`0 0 ${Number(g.size) || 28}px ${Number(g.spread) || 0}px ${g.color || 'rgba(189,214,87,.5)'}`);
    }
    if (shadows.length) out.push(`box-shadow:${shadows.join(',')}`);
    if (fx.backdropBlur) out.push(`backdrop-filter:blur(${Number(fx.backdropBlur)}px)`);
    if (fx.blend && fx.blend !== 'normal') out.push(`mix-blend-mode:${fx.blend}`);
    return out;
  }

  window.StudioMotion = {
    TRIGGERS, TEXT_MODES, IMAGE_PRESETS,
    split, restore, canSplit, bindTrigger, clearTriggers, replay, effectDecls,
    reducedMotion: reduced,

    // Applies triggers and text splitting for every node that asks for them.
    applyFromModel(model) {
      if (!model || !model.nodes) return 0;
      let n = 0;
      for (const id in model.nodes) {
        const node = model.nodes[id];
        const el = window.StudioModel ? window.StudioModel.findNode(document, id) : null;
        if (!el) continue;
        const m = node.motion || {};
        if (m.textMode && m.textMode !== 'object') {
          const res = split(el, m.textMode, m.stagger);
          if (!res.ok) console.info('[studio] text split skipped for', id + ':', res.why);
        } else if (el.dataset.splitMode) {
          restore(el);
        }
        if (m.trigger && m.trigger !== 'viewport') { bindTrigger(el, m); n++; }
      }
      return n;
    },
  };
})();
