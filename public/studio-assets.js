/* Studio media library client (§6/§16/§17).
 *
 * Uploads go through /api/media and the page stores a durable /media/... URL.
 * Nothing here ever produces a data: or blob: URL for persistence — the
 * previous approach did, which is why artwork vanished on reload or bloated the
 * KV config past its limit.
 *
 * Every failure shows the server's own reason. The endpoints return a message
 * plus a code precisely so this layer does not have to guess (§29).
 *
 * Exposed as window.StudioAssets.
 */
(() => {
  'use strict';

  const state = {
    assets: [], loaded: false, loading: false, error: null,
    query: '', filter: 'all',            // all | unused | trash
    storage: null, limitBytes: null, stats: null,
  };
  const listeners = new Set();
  const notify = () => listeners.forEach(fn => { try { fn(state); } catch (e) { console.error(e); } });

  // Identity travels as the session cookie now, so nothing here handles a
  // password. This only reports whether a session exists, to give a useful
  // message instead of a bare 401.
  function signedIn() {
    const a = (typeof window.auth === 'object' && window.auth) || (typeof auth !== 'undefined' ? auth : null);
    return !!(a && a.signedIn);
  }
  const SEND = { credentials: 'same-origin' };

  async function readError(response, fallback) {
    let body = null;
    try { body = await response.json(); } catch { /* not JSON */ }
    if (body && body.error) return { message: body.error, code: body.code || null, body };
    return { message: `${fallback} (server returned ${response.status})`, code: null, body: null };
  }

  async function list({ force = false } = {}) {
    if (state.loading) return state.assets;
    if (state.loaded && !force) return state.assets;
    if (!signedIn()) { state.error = 'Sign in to the editor to use the media library.'; notify(); return []; }

    state.loading = true; state.error = null; notify();
    try {
      const r = await fetch('/api/media', SEND);
      if (!r.ok) {
        const e = await readError(r, 'Could not load the media library');
        state.error = e.message; state.code = e.code; state.assets = []; state.loaded = false;
        return [];
      }
      const data = await r.json();
      state.assets = Array.isArray(data.assets) ? data.assets : [];
      state.storage = data.storage || null;
      state.limitBytes = data.limitBytes || null;
      state.stats = {
        count: data.count || 0,
        active: data.activeCount || 0,
        trashed: data.trashedCount || 0,
        unused: data.unusedCount || 0,
        bytes: data.bytesUsed || 0,
      };
      state.loaded = true; state.error = null; state.code = null;
      return state.assets;
    } catch {
      state.error = 'Could not reach the media endpoint. Check your connection.';
      state.assets = []; state.loaded = false;
      return [];
    } finally {
      state.loading = false; notify();
    }
  }

  // Reads intrinsic dimensions before upload so the library can show them and
  // so the placed <img> can carry width/height, which stops the page reflowing
  // as artwork loads.
  function measure(file) {
    return new Promise(resolve => {
      if (!/^image\//.test(file.type) || file.type === 'image/svg+xml') return resolve(null);
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => { resolve({ width: img.naturalWidth, height: img.naturalHeight }); URL.revokeObjectURL(url); };
      img.onerror = () => { resolve(null); URL.revokeObjectURL(url); };
      img.src = url;
    });
  }

  async function upload(file) {
    if (!signedIn()) return { ok: false, error: 'Sign in to the editor before uploading.' };
    if (!file) return { ok: false, error: 'No file was chosen.' };

    const dims = await measure(file);
    const form = new FormData();
    form.append('file', file);
    if (dims) { form.append('width', String(dims.width)); form.append('height', String(dims.height)); }

    try {
      const r = await fetch('/api/media', { method: 'POST', credentials: 'same-origin', body: form });
      if (!r.ok) {
        const e = await readError(r, 'Upload failed');
        return { ok: false, error: e.message, code: e.code };
      }
      const data = await r.json();
      if (!data.ok || !data.asset) return { ok: false, error: 'The server accepted the upload but returned no asset.' };
      // A deduplicated upload returns an asset that is already in the list.
      const i = state.assets.findIndex(a => a.key === data.asset.key);
      if (i >= 0) state.assets[i] = { ...state.assets[i], ...data.asset };
      else state.assets.unshift(data.asset);
      state.loaded = true;
      notify();
      return { ok: true, asset: data.asset, deduped: !!data.deduped, restored: !!data.restored };
    } catch {
      return { ok: false, error: 'Could not reach the media endpoint. The file was not uploaded.' };
    }
  }

  /* Label, alt text and restore all go through one PATCH, which touches a small
   * sidecar document rather than the image itself.
   */
  async function patch(key, fields) {
    if (!signedIn()) return { ok: false, error: 'Sign in to the editor first.' };
    try {
      const r = await fetch('/api/media', {
        method: 'PATCH', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, ...fields }),
      });
      if (!r.ok) {
        const e = await readError(r, 'Could not save the change');
        return { ok: false, error: e.message, code: e.code };
      }
      const data = await r.json();
      const a = state.assets.find(x => x.key === key);
      if (a) Object.assign(a, { label: data.label, alt: data.alt, status: data.status });
      notify();
      return { ok: true, asset: a };
    } catch {
      return { ok: false, error: 'Could not reach the media endpoint. Nothing was saved.' };
    }
  }

  async function remove(key, { force = false, purge = false, confirm = false } = {}) {
    if (!signedIn()) return { ok: false, error: 'Sign in to the editor before deleting assets.' };
    const q = new URLSearchParams({ key });
    if (force) q.set('force', '1');
    if (purge) q.set('purge', '1');
    if (confirm) q.set('confirm', '1');
    try {
      const r = await fetch('/api/media?' + q, { method: 'DELETE', credentials: 'same-origin' });
      if (!r.ok) {
        const e = await readError(r, 'Delete failed');
        // 409 means the asset is still referenced; hand the caller the detail
        // so it can offer "delete anyway" instead of a dead end.
        return {
          ok: false, error: e.message, code: e.code,
          references: (e.body && e.body.references) || [],
          historyReferences: (e.body && e.body.historyReferences) || [],
          inUse: e.code === 'in-use',
          inHistory: e.code === 'in-history',
        };
      }
      const data = await r.json().catch(() => ({}));
      if (data.purged) state.assets = state.assets.filter(a => a.key !== key);
      else {
        const a = state.assets.find(x => x.key === key);
        if (a) { a.status = 'trashed'; a.trashedAt = new Date().toISOString(); }
      }
      notify();
      return { ok: true, purged: !!data.purged, brokenReferences: data.brokenReferences || [] };
    } catch {
      return { ok: false, error: 'Could not reach the media endpoint. Nothing was deleted.' };
    }
  }

  /* ------------------------------------------------------------------ UI */

  function fmtSize(b) {
    if (!b) return '';
    return b >= 1048576 ? `${(b / 1048576).toFixed(1)}MB` : `${Math.max(1, Math.round(b / 1024))}KB`;
  }

  const esc = s => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  function panel() {
    let el = document.querySelector('#assetsPanel');
    if (el) return el;
    el = document.createElement('div');
    el.className = 'panel';
    el.id = 'assetsPanel';
    el.innerHTML = `
      <h4>Image library</h4>
      <p class="editor-note">Uploads get a durable URL and never go into the config, so artwork survives reload. Re-uploading a file you already have reuses the stored copy instead of keeping two.</p>
      <label class="file-btn">Upload image / video<input id="assetUpload" type="file" accept="image/*,video/mp4,video/webm" multiple></label>
      <div class="asset-tools">
        <input id="assetSearch" type="search" placeholder="Search by name or label" aria-label="Search the image library">
        <div class="asset-filters" role="group" aria-label="Filter the image library">
          <button type="button" data-filter="all" class="on">All</button>
          <button type="button" data-filter="unused">Unused</button>
          <button type="button" data-filter="trash">Trash</button>
        </div>
      </div>
      <div id="assetStatus" class="editor-note" role="status" aria-live="polite"></div>
      <div id="assetGrid" class="asset-grid"></div>
      <div class="action-row"><button type="button" id="assetRefresh">Refresh library</button></div>`;
    return el;
  }

  function visible() {
    const q = state.query.trim().toLowerCase();
    return state.assets.filter(a => {
      if (state.filter === 'trash') { if (a.status !== 'trashed') return false; }
      else if (a.status === 'trashed') return false;
      if (state.filter === 'unused' && a.inUse) return false;
      if (!q) return true;
      return `${a.label || ''} ${a.filename || ''} ${a.key} ${a.alt || ''}`.toLowerCase().includes(q);
    });
  }

  function summary() {
    const s = state.stats;
    if (!s) return '';
    // Say which store is in use and what it costs, so the smaller KV limit is
    // never a mystery when an upload is refused.
    const where = state.storage === 'kv'
      ? 'KV, 2MB per file'
      : state.storage === 'r2' ? 'R2, 15MB per file' : '';
    return [
      `${s.active} asset${s.active === 1 ? '' : 's'}`,
      s.unused ? `${s.unused} unused` : '',
      s.trashed ? `${s.trashed} in trash` : '',
      fmtSize(s.bytes),
      where,
    ].filter(Boolean).join(' · ');
  }

  function render() {
    const grid = document.querySelector('#assetGrid');
    const statusEl = document.querySelector('#assetStatus');
    if (!grid) return;

    document.querySelectorAll('.asset-filters [data-filter]').forEach(b => {
      b.classList.toggle('on', b.dataset.filter === state.filter);
    });

    if (statusEl && state.error) {
      statusEl.textContent = state.error;
      statusEl.classList.add('is-error');
    } else if (statusEl && !statusEl.dataset.sticky) {
      statusEl.classList.remove('is-error');
      if (!state.loading) statusEl.textContent = state.loaded ? summary() : '';
    }

    if (state.loading) { grid.innerHTML = '<div class="asset-empty">Loading library…</div>'; return; }
    if (state.error) { grid.innerHTML = ''; return; }

    const items = visible();
    if (!items.length) {
      grid.innerHTML = `<div class="asset-empty">${
        !state.assets.length ? 'No uploads yet.'
        : state.filter === 'trash' ? 'The trash is empty.'
        : state.filter === 'unused' ? 'Every asset is used on the published site.'
        : 'Nothing matches that search.'}</div>`;
      return;
    }

    grid.innerHTML = '';
    for (const a of items) {
      const card = document.createElement('div');
      card.className = 'asset-card' + (a.status === 'trashed' ? ' is-trashed' : '');
      card.dataset.key = a.key;
      const isVideo = /^video\//.test(a.mime || '');
      const dims = a.width && a.height ? `${a.width}×${a.height}` : '';
      const badge = a.status === 'trashed' ? '<span class="asset-tag is-trash">in trash</span>'
        : a.inUse ? '<span class="asset-tag is-used">on the site</span>'
        : '<span class="asset-tag">unused</span>';
      card.innerHTML = `
        <div class="asset-thumb">${isVideo
          ? '<span class="asset-badge">video</span>'
          : `<img loading="lazy" decoding="async"${a.width ? ` width="${a.width}" height="${a.height}"` : ''} src="${esc(a.url)}" alt="">`}</div>
        <div class="asset-meta">
          <input class="asset-label" type="text" value="${esc(a.label)}" placeholder="${esc(a.filename || a.key)}" aria-label="Label for ${esc(a.filename || a.key)}">
          <span>${[dims, fmtSize(a.size)].filter(Boolean).join(' · ')} ${badge}</span>
          <input class="asset-alt${a.alt ? '' : ' needs-alt'}" type="text" value="${esc(a.alt)}" placeholder="Alt text — describe the artwork" aria-label="Alt text for ${esc(a.filename || a.key)}">
        </div>
        <div class="asset-actions">
          ${a.status === 'trashed'
            ? '<button type="button" data-restore>Restore</button><button type="button" data-purge class="danger-lite">Delete forever</button>'
            : '<button type="button" data-use>Use</button><button type="button" data-del class="danger-lite">Trash</button>'}
        </div>`;

      const label = card.querySelector('.asset-label');
      label.onchange = async () => {
        const res = await patch(a.key, { label: label.value });
        say(res.ok ? `Renamed to “${label.value || a.filename}”.` : res.error, !res.ok);
      };
      const alt = card.querySelector('.asset-alt');
      alt.onchange = async () => {
        const res = await patch(a.key, { alt: alt.value });
        alt.classList.toggle('needs-alt', !alt.value.trim());
        say(res.ok ? 'Alt text saved.' : res.error, !res.ok);
      };

      const on = (sel, fn) => { const b = card.querySelector(sel); if (b) b.onclick = fn; };
      on('[data-use]', () => useAsset(a));
      on('[data-del]', () => trashAsset(a));
      on('[data-restore]', async () => {
        const res = await patch(a.key, { status: 'active' });
        if (res.ok) { render(); say(`Restored ${a.label || a.filename || a.key}.`); }
        else say(res.error, true);
      });
      on('[data-purge]', () => purgeAsset(a));
      grid.appendChild(card);
    }
  }

  function say(msg, isError) {
    const el = document.querySelector('#assetStatus');
    if (el) {
      el.textContent = msg;
      el.classList.toggle('is-error', !!isError);
      // Hold a result message long enough to read, then fall back to the
      // running summary rather than leaving a stale line on screen.
      el.dataset.sticky = '1';
      clearTimeout(el._t);
      el._t = setTimeout(() => { delete el.dataset.sticky; el.classList.remove('is-error'); el.textContent = summary(); }, 6000);
    }
    if (typeof window.status === 'function') { try { window.status(msg); } catch { /* editor status is optional */ } }
  }

  // Assigns an asset to whatever is selected. Reports why when it cannot,
  // instead of appearing to do nothing.
  function useAsset(a) {
    const target = typeof window.selected !== 'undefined' ? window.selected : (typeof selected !== 'undefined' ? selected : null);
    if (!target) return say('Select an object on the canvas first, then choose Use.', true);
    if (!target.classList.contains('tile')) {
      return say(`Images can only be placed on project tiles. "${target.dataset.node || target.dataset.id}" is a ${target.dataset.type || 'text'} object.`, true);
    }
    let im = target.querySelector('img');
    if (!im) {
      im = document.createElement('img');
      im.loading = 'lazy'; im.decoding = 'async';
      target.prepend(im);
    }
    im.src = a.url;
    // Intrinsic size lets the browser reserve the right space before the file
    // arrives, so placing artwork does not shift the layout under it.
    if (a.width && a.height) { im.width = a.width; im.height = a.height; }
    im.alt = a.alt || a.label || '';
    target.classList.remove('placeholder');
    const ph = target.querySelector('.ph');
    if (ph) ph.remove();
    if (typeof window.push === 'function') window.push();
    else if (typeof push === 'function') push();
    // Missing alt text is a real accessibility gap on an artwork site, so it is
    // named at the moment it matters rather than silently accepted.
    say(a.alt
      ? `Placed ${a.label || a.filename || a.key}.`
      : `Placed ${a.label || a.filename || a.key}. Add alt text so screen readers and search engines can describe it.`, !a.alt);
  }

  async function trashAsset(a) {
    const first = await remove(a.key);
    if (first.ok) { render(); return say(`Moved ${a.label || a.filename || a.key} to the trash. It is still recoverable.`); }
    if (!first.inUse) return say(first.error, true);

    // The server refused because the asset is published somewhere. Offer the
    // override explicitly rather than silently breaking the public page.
    if (!window.confirm(`${first.error}\n\nMove it to the trash anyway and leave those references broken?`)) {
      return say('Cancelled. The asset is still in use.', true);
    }
    const forced = await remove(a.key, { force: true });
    if (!forced.ok) return say(forced.error, true);
    render();
    say(`Moved to the trash. ${forced.brokenReferences.length} published reference(s) now point at a missing asset.`, true);
  }

  async function purgeAsset(a) {
    const name = a.label || a.filename || a.key;
    if (!window.confirm(`Permanently delete ${name}?\n\nThe file is removed from storage. This cannot be undone.`)) return;
    let res = await remove(a.key, { purge: true, force: true });
    // The server refuses once if saved versions still reference the file, so
    // the owner learns that rolling back would break before the bytes go.
    if (!res.ok && res.inHistory) {
      if (!window.confirm(`${res.error}\n\nDelete the file permanently anyway?`)) {
        return say('Cancelled. The file is still in storage.');
      }
      res = await remove(a.key, { purge: true, force: true, confirm: true });
    }
    if (!res.ok) return say(res.error, true);
    render();
    const n = (res.historyReferences || []).length;
    say(n
      ? `Deleted ${name} permanently. ${n} saved version${n === 1 ? ' now references' : 's now reference'} a missing file.`
      : `Deleted ${name} permanently.`, !!n);
  }

  async function handleFiles(files) {
    const items = [...files];
    if (!items.length) return;
    let done = 0, reused = 0; const failed = [];
    for (const f of items) {
      say(`Uploading ${f.name} (${done + reused + 1} of ${items.length})…`);
      const res = await upload(f);
      if (res.ok && res.deduped) reused++;
      else if (res.ok) done++;
      else failed.push(`${f.name}: ${res.error}`);
      render();
    }
    // Partial success is reported as partial, never as total success (§29).
    const parts = [];
    if (done) parts.push(`Uploaded ${done} file${done === 1 ? '' : 's'}`);
    if (reused) parts.push(`${reused} already in the library, reused`);
    if (failed.length) {
      parts.push(`Failed — ${failed.join(' | ')}`);
      say(parts.join('. '), true);
    } else {
      say(parts.join('. ') + '.');
      await list({ force: true });   // refresh use counts and totals
    }
  }

  function mount(container) {
    const host = container || document.querySelector('.tab-panel[data-tab="design"]') || document.querySelector('.inspector');
    if (!host) return null;
    const el = panel();
    if (!el.isConnected) host.appendChild(el);

    const bind = (sel, ev, fn) => {
      const node = el.querySelector(sel);
      if (node && !node.dataset.bound) { node.dataset.bound = '1'; node.addEventListener(ev, fn); }
      return node;
    };

    bind('#assetUpload', 'change', async e => {
      await handleFiles(e.target.files);
      e.target.value = '';
    });
    bind('#assetSearch', 'input', e => { state.query = e.target.value; render(); });
    bind('.asset-filters', 'click', e => {
      const b = e.target && e.target.closest ? e.target.closest('[data-filter]') : null;
      if (!b) return;
      state.filter = b.dataset.filter;
      render();
    });
    const refresh = bind('#assetRefresh', 'click', async () => {
      refresh.disabled = true;
      await list({ force: true });
      refresh.disabled = false;
    });

    listeners.add(render);
    render();
    list();
    return el;
  }

  window.StudioAssets = { state, list, upload, patch, remove, mount, render, useAsset, subscribe: fn => listeners.add(fn) };
})();
