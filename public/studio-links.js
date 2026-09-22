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

  function init() {
    // Route clicks on linked text through follow(), so anchors and same-tab
    // both work rather than everything becoming an external new-tab redirect.
    document.addEventListener('click', e => {
      if (document.body.classList.contains('editing')) return;
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
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  window.StudioLinks = { normalize, describe, follow, upgrade, init, NAV_SCHEMES };
})();
