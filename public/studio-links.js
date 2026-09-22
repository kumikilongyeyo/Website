/* Whole-object links and link accessibility (§12, §13, §34).
 *
 * Loads after studio-editor.js so it can wrap that engine's globals.
 *
 * §12 treats reliable whole-object links as mandatory and inline rich text as a
 * contained follow-up, so that is exactly the split here: a text object, button
 * or tile can carry one URL, with same-tab or new-tab, and internal anchors
 * scroll rather than being treated as external destinations.
 *
 * A linked heading was previously a div with a click handler: not focusable,
 * not announced as a link, and unreachable by keyboard. It now carries
 * role="link", tabindex and Enter/Space activation, which is the practical fix
 * short of restructuring the DOM into real anchors — that would fight
 * contenteditable in the editor.
 *
 * Exposed as window.StudioLinks.
 */
(() => {
  'use strict';

  const $ = (s, p = document) => p.querySelector(s);
  const $$ = (s, p = document) => [...p.querySelectorAll(s)];

  // Navigation targets only. data: and blob: were accepted before, which is a
  // hazard with no upside: a data:text/html link is attacker-controlled markup
  // wearing a link's clothes, and image URLs never travel through here.
  const NAV_SCHEMES = /^(https?:|mailto:|tel:)/i;

  function normalize(url) {
    let x = String(url || '').trim();
    if (!x) return '';
    if (x.startsWith('#')) return x;                       // internal anchor
  // Anything that already declares a scheme is judged on that scheme, never
  // prefixed. Blindly prepending https:// turned data:text/html,x into
  // https://data:text/html,x — which then passed the allowlist, laundering a
  // rejected scheme into an accepted-looking link.
  // A dotted prefix (example.com:8080) or a numeric tail (localhost:3000) is a
  // host and port, not a scheme.
    const m = x.match(/^([a-zA-Z][a-zA-Z0-9+.\-]*):([\s\S]*)$/);
    if (m && !m[1].includes('.') && !/^\d/.test(m[2])) {
      return NAV_SCHEMES.test(x) ? x : '';
    }
    return 'https://' + x.replace(/^\/+/, '');
  }

  function describe(url) {
    const safe = normalize(url);
    if (!safe) return { ok: false, why: 'That is not a usable link. Use https://…, mailto:…, tel:… or #section.' };
    if (safe.startsWith('#')) {
      const target = document.querySelector(safe);
      return target
        ? { ok: true, kind: 'anchor', url: safe }
        : { ok: false, why: `No section on this page has the id "${safe.slice(1)}", so the link would go nowhere.` };
    }
    return { ok: true, kind: 'external', url: safe };
  }

  /* An anchor scrolls; an external destination goes through the existing
   * confirmation dialog so nobody leaves the portfolio unexpectedly.
   */
  function follow(url, title, opts) {
    const info = describe(url);
    if (!info.ok) {
      if (typeof status === 'function') status(info.why);
      return false;
    }
    if (info.kind === 'anchor') {
      const target = document.querySelector(info.url);
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return true;
    }
    if (typeof openExternal === 'function') {
      openExternal(info.url, title);
      // Carry the same-tab/new-tab choice to the dialog's Go button.
      const go = $('.redirect-go');
      if (go) go.dataset.newTab = (opts && opts.newTab === false) ? '0' : '1';
    }
    return true;
  }

  /* Makes a linked object operable and announced. Anything with a link gets a
   * role and a tab stop; anything that loses its link gives them back.
   */
  function upgrade(root) {
    const scope = root || document;
    for (const el of $$('[data-text-link-enabled="1"]', scope)) {
      if (el.getAttribute('role') !== 'link') el.setAttribute('role', 'link');
      if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '0');
      const url = el.dataset.textLink || '';
      const info = describe(url);
      el.setAttribute('aria-label', `${(el.textContent || '').trim().slice(0, 80)} — ${info.ok ? info.url : 'link not set'}`);
      if (el.dataset.linkKeyed === '1') continue;
      el.dataset.linkKeyed = '1';
      el.addEventListener('keydown', e => {
        if (document.body.classList.contains('editing')) return;   // typing, not navigating
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        follow(el.dataset.textLink, el.dataset.node || 'Link', { newTab: el.dataset.linkNewTab !== '0' });
      });
    }
    // Strip the affordances from anything no longer linked.
    for (const el of $$('[role="link"]', scope)) {
      if (el.dataset.textLinkEnabled === '1') continue;
      el.removeAttribute('role');
      el.removeAttribute('aria-label');
      if (el.getAttribute('tabindex') === '0') el.removeAttribute('tabindex');
    }
  }


  /* ------------------------------------------------------------ link peek
   * A hover/focus popover showing where a link actually goes, with Copy and
   * Continue. The existing confirm dialog only appears after a click, which is
   * too late to decide; this lets you read the destination first, copy it
   * without leaving, or continue deliberately.
   *
   * Shown on focus as well as hover, so it is reachable by keyboard rather
   * than being a pointer-only affordance (§34). Never shown while editing,
   * where hovering an object means selecting it.
   */
  const PEEK_DELAY = 260;
  const PEEK_GRACE = 220;
  let peekTimer = null, hideTimer = null, peekFor = null;

  function peekEl() {
    let el = $('#linkPeek');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'linkPeek';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', 'Link destination');
    el.innerHTML = `
      <code class="peek-url"></code>
      <div class="peek-actions">
        <button type="button" class="peek-copy icon-btn" title="Copy link" aria-label="Copy link">⧉</button>
        <button type="button" class="peek-go" title="Open this link">Continue</button>
      </div>`;
    document.body.appendChild(el);

    el.addEventListener('mouseenter', () => clearTimeout(hideTimer));
    el.addEventListener('mouseleave', () => scheduleHide());
    el.querySelector('.peek-copy').addEventListener('click', async e => {
      e.stopPropagation();
      const url = el.dataset.url || '';
      const btn = e.currentTarget;
      try {
        await navigator.clipboard.writeText(url);
        btn.textContent = '✓';
        btn.setAttribute('aria-label', 'Link copied');
      } catch {
        // Clipboard can be refused; say so rather than showing a false tick.
        btn.textContent = '✕';
        btn.setAttribute('aria-label', 'Copy was blocked by the browser');
      }
      setTimeout(() => { btn.textContent = '⧉'; btn.setAttribute('aria-label', 'Copy link'); }, 1100);
    });
    el.querySelector('.peek-go').addEventListener('click', e => {
      e.stopPropagation();
      const url = el.dataset.url || '';
      const title = el.dataset.title || 'Link';
      hidePeek();
      follow(url, title, { newTab: el.dataset.newTab !== '0' });
    });
    return el;
  }

  function linkInfoFor(el) {
    if (!el) return null;
    const url = el.dataset.href || el.dataset.textLink || el.dataset.target || el.getAttribute('href') || '';
    if (!url || url === '#') {
      // A link with no destination is worth saying out loud rather than
      // showing an empty popover.
      return { url: '', label: 'No destination set yet', invalid: true, title: el.dataset.node || 'Link' };
    }
    if (el.dataset.linkKey && typeof LINKS !== 'undefined' && LINKS[el.dataset.linkKey]) {
      const l = LINKS[el.dataset.linkKey];
      const info = describe(l.url || '');
      return { url: l.url || '', label: info.ok ? info.url : (info.why || 'No destination set yet'), invalid: !info.ok, title: l.title || 'Link', newTab: l.newTab !== false };
    }
    const info = describe(url);
    return { url, label: info.ok ? info.url : info.why, invalid: !info.ok, title: el.dataset.node || (el.textContent || 'Link').trim().slice(0, 40), newTab: el.dataset.linkNewTab !== '0' };
  }

  function showPeek(target) {
    if (document.body.classList.contains('editing')) return;
    // Cancel any pending hide. Without this a hide scheduled by leaving the
    // previous link fires ~220ms later and closes the popover that has just
    // been opened — which is what moving straight from one link to the next,
    // or hovering then focusing, actually does.
    clearTimeout(hideTimer);
    clearTimeout(peekTimer);
    const info = linkInfoFor(target);
    if (!info) return;
    const el = peekEl();
    peekFor = target;
    el.dataset.url = info.url;
    el.dataset.title = info.title;
    el.dataset.newTab = info.newTab === false ? '0' : '1';
    el.querySelector('.peek-url').textContent = info.label;
    el.classList.toggle('is-invalid', !!info.invalid);
    // Continue is pointless without a usable destination, so it is disabled
    // and says why instead of failing on click.
    const go = el.querySelector('.peek-go');
    go.disabled = !!info.invalid;
    go.title = info.invalid ? 'This link has no usable destination' : 'Open this link';
    el.classList.add('open');
    position(el, target);
  }

  function position(el, target) {
    const r = target.getBoundingClientRect();
    el.style.visibility = 'hidden';
    el.style.left = '0px';
    el.style.top = '0px';
    const box = el.getBoundingClientRect();
    // Prefer above; flip below when there is not room. Clamped to the viewport
    // so it can never render off-screen (§35.2).
    let top = r.top - box.height - 8;
    if (top < 8) top = r.bottom + 8;
    let left = r.left + r.width / 2 - box.width / 2;
    left = Math.max(8, Math.min(left, window.innerWidth - box.width - 8));
    el.style.left = Math.round(left) + 'px';
    el.style.top = Math.round(Math.min(top, window.innerHeight - box.height - 8)) + 'px';
    el.style.visibility = '';
  }

  function scheduleHide() {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(hidePeek, PEEK_GRACE);
  }
  function hidePeek() {
    clearTimeout(peekTimer);
    const el = $('#linkPeek');
    if (el) el.classList.remove('open');
    peekFor = null;
  }

  const PEEK_SELECTOR = '.inline-link, [data-link-key], [data-type="button"], [data-text-link-enabled="1"]';

  function bindPeek() {
    if (document.body.dataset.peekBound === '1') return;
    document.body.dataset.peekBound = '1';

    document.addEventListener('mouseover', e => {
      if (!e.target || typeof e.target.closest !== 'function') return;
      const t = e.target.closest(PEEK_SELECTOR);
      if (!t) return;
      clearTimeout(hideTimer);
      clearTimeout(peekTimer);
      if (peekFor === t && $('#linkPeek') && $('#linkPeek').classList.contains('open')) return;
      peekTimer = setTimeout(() => showPeek(t), PEEK_DELAY);
    }, true);

    document.addEventListener('mouseout', e => {
      if (!e.target || typeof e.target.closest !== 'function') return;
      if (!e.target.closest(PEEK_SELECTOR)) return;
      clearTimeout(peekTimer);
      scheduleHide();
    }, true);

    // Keyboard parity: focusing a link shows the same information.
    document.addEventListener('focusin', e => {
      if (!e.target || typeof e.target.closest !== 'function') return;
      const t = e.target.closest(PEEK_SELECTOR);
      if (t) showPeek(t);
    });
    document.addEventListener('focusout', e => {
      if (!e.target || typeof e.target.closest !== 'function') return;
      if (e.target.closest(PEEK_SELECTOR)) scheduleHide();
    });

    window.addEventListener('keydown', e => { if (e.key === 'Escape') hidePeek(); });
    window.addEventListener('scroll', hidePeek, { passive: true });
    window.addEventListener('resize', hidePeek, { passive: true });
  }

  /* --------------------------------------------------------- inline links
   * Wraps the current selection inside a text object. Inline markup survives
   * publish for free, because the model already stores a text node's innerHTML
   * as its content.
   */
  function wrapSelection(url) {
    const info = describe(url);
    if (!info.ok) return { ok: false, why: info.why };
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) {
      return { ok: false, why: 'Select some words inside a text object first, then set the link.' };
    }
    const range = sel.getRangeAt(0);
    const host = range.commonAncestorContainer.nodeType === 1
      ? range.commonAncestorContainer
      : range.commonAncestorContainer.parentElement;
    const node = host && host.closest ? host.closest('[data-node]') : null;
    if (!node || node.dataset.type !== 'text') {
      return { ok: false, why: 'Inline links only work inside a text object.' };
    }
    if (node.querySelector('.inline-link') && range.cloneContents().querySelector('.inline-link')) {
      return { ok: false, why: 'That selection already contains a link. Remove it first.' };
    }
    const a = document.createElement('a');
    a.className = 'inline-link';
    a.dataset.href = info.url;
    a.href = info.url;
    a.rel = 'noopener';
    try {
      a.appendChild(range.extractContents());
      range.insertNode(a);
    } catch (e) {
      return { ok: false, why: 'That selection spans too much structure to link. Select within a single paragraph.' };
    }
    sel.removeAllRanges();
    return { ok: true, node, text: (a.textContent || '').trim() };
  }

  function unwrapSelection() {
    const sel = window.getSelection();
    const anchorEl = sel && sel.anchorNode
      ? (sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement)
      : null;
    const a = anchorEl && anchorEl.closest ? anchorEl.closest('.inline-link') : null;
    if (!a) return { ok: false, why: 'Put the cursor inside a linked word first.' };
    const node = a.closest('[data-node]');
    const parent = a.parentNode;
    while (a.firstChild) parent.insertBefore(a.firstChild, a);
    a.remove();
    parent.normalize();
    return { ok: true, node };
  }

  function init() {
    // Route clicks on linked text through follow(), so anchors and same-tab
    // both work rather than everything becoming an external new-tab redirect.
    document.addEventListener('click', e => {
      if (document.body.classList.contains('editing')) return;
      // Guarded for the same reason as the drag handler: e.target may be
      // document or a text node, neither of which has closest().
      if (!e.target || typeof e.target.closest !== 'function') return;
      // Inline links first: a link inside a paragraph is more specific than the
      // paragraph's own whole-object link.
      const inline = e.target.closest('.inline-link');
      if (inline) {
        e.preventDefault();
        follow(inline.dataset.href || inline.getAttribute('href'), (inline.textContent || 'Link').trim().slice(0, 40), { newTab: inline.dataset.linkNewTab !== '0' });
        return;
      }
      const t = e.target.closest('[data-type="text"][data-text-link-enabled="1"], [data-type="button"]');
      if (!t) return;
      const url = t.dataset.textLink || t.dataset.target || t.getAttribute('href');
      if (!url || url === '#') return;
      e.preventDefault();
      follow(url, t.dataset.node || 'Link', { newTab: t.dataset.linkNewTab !== '0' });
    }, true);

    // The dialog's Go button honours the link's own choice.
    const go = $('.redirect-go');
    if (go && !go.dataset.linksBound) {
      go.dataset.linksBound = '1';
      go.addEventListener('click', e => {
        const u = e.currentTarget.dataset.url;
        if (!u) return;
        const newTab = e.currentTarget.dataset.newTab !== '0';
        if (/^mailto:|^tel:/i.test(u)) location.href = u;
        else if (newTab) window.open(u, '_blank', 'noopener');
        else location.href = u;
        const modal = $('.redirect-modal');
        if (modal) modal.classList.remove('open');
      }, true);
    }

    upgrade(document);
    bindPeek();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  window.StudioLinks = {
    normalize, describe, follow, upgrade, init, NAV_SCHEMES,
    showPeek, hidePeek, bindPeek, wrapSelection, unwrapSelection, PEEK_SELECTOR,
  };
})();
