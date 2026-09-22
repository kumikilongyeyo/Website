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

  /* Responsive variants, made in the browser.
   *
   * A 4000px illustration sent whole to a phone is the largest avoidable cost
   * on an art site, and server-side resizing means a paid image service. The
   * browser can do it for nothing: decode once, draw to a canvas at each
   * target width, and upload the results beside the original. The original is
   * never altered or replaced — it stays the largest source.
   *
   * Only photographic formats are resized. SVG is already resolution
   * independent, GIF would lose its animation, and video is not an image.
   */
  const VARIANT_WIDTHS = [800, 1600];
  const RESIZABLE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

  async function makeVariants(file, dims) {
    if (!RESIZABLE_TYPES.includes(file.type) || !dims || !dims.width) return [];
    const targets = VARIANT_WIDTHS.filter(w => w < dims.width * 0.9);
    if (!targets.length) return [];

    let bitmap;
    try { bitmap = await createImageBitmap(file); } catch { return []; }
    const out = [];
    for (const w of targets) {
      const h = Math.round(dims.height * (w / dims.width));
      try {
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(bitmap, 0, 0, w, h);
        const blob = await new Promise(res => canvas.toBlob(res, 'image/webp', 0.9));
        // A variant that came out bigger than the original is not a saving.
        if (blob && blob.size < file.size) out.push({ width: w, blob });
      } catch { /* one failed size must not stop the upload */ }
    }
    if (bitmap.close) bitmap.close();
    return out;
  }

  async function uploadVariants(parentKey, baseName, variants) {
    const stored = [];
    for (const v of variants) {
      const form = new FormData();
      form.append('file', new File([v.blob], `${baseName}-${v.width}w.webp`, { type: 'image/webp' }));
      form.append('variantOf', parentKey);
      form.append('variantWidth', String(v.width));
      try {
        const r = await fetch('/api/media', { method: 'POST', credentials: 'same-origin', body: form });
        if (r.ok) { const d = await r.json(); if (d.asset) stored.push(d.asset); }
      } catch { /* the original is already safe; a missing variant only costs bandwidth */ }
    }
    return stored;
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
      if (!data.deduped && dims) {
        const variants = await makeVariants(file, dims);
        if (variants.length) {
          const stored = await uploadVariants(data.asset.key, (file.name || 'asset').replace(/\.[^.]*$/, ''), variants);
          data.asset.variants = stored.map(v => ({ key: v.key, width: v.width }));
        }
      }
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
    let im = (window.StudioModel && window.StudioModel.contentImage)
      ? window.StudioModel.contentImage(target)
      : target.querySelector('img');
    if (!im) {
      im = document.createElement('img');
      im.loading = 'lazy'; im.decoding = 'async';
      target.prepend(im);
    }
    im.src = a.url;
    /* Offer every stored size and describe how wide the slot is, so the browser
     * can pick. Without sizes it assumes full viewport width and downloads the
     * largest file anyway.
     *
     * The description is declarative, not a measurement. Measuring the slot at
     * placement time freezes whatever layout existed at that moment — and in
     * the editor the canvas is narrowed by the layer and inspector panels, so
     * the number baked in was wrong for every visitor. These match the 980px
     * breakpoint in the stylesheet, where a tile stops being half width and
     * spans the full grid.
     */
    const variants = (a.variants || []).filter(v => v.key && v.width);
    if (variants.length && a.width) {
      im.srcset = [...variants.map(v => `/media/${v.key} ${v.width}w`), `${a.url} ${a.width}w`].join(', ');
      const full = target.dataset.type === 'hero' || target.classList.contains('hero-stage');
      im.sizes = full ? '100vw' : '(max-width: 980px) 100vw, 50vw';
    } else {
      im.removeAttribute('srcset');
      im.removeAttribute('sizes');
    }
    // Intrinsic size lets the browser reserve the right space before the file
    // arrives, so placing artwork does not shift the layout under it.
    if (a.width && a.height) { im.width = a.width; im.height = a.height; }
    im.alt = a.alt || a.label || '';
    target.classList.remove('placeholder');
    const ph = target.querySelector('.ph');
    if (ph) ph.remove();
    if (typeof window.push === 'function') window.push();
    else if (typeof push === 'function') push();
    /* Two things are worth saying the moment artwork lands, because both are
     * invisible afterwards: whether it is described, and whether it is sharp.
     * Both are measured from what the library already knows about the file, so
     * neither has to wait for the image to decode. */
    const name = a.label || a.filename || a.key;
    const notes = [];
    if (!a.alt) notes.push('Add alt text so screen readers and search engines can describe it.');
    const q = window.StudioShell && window.StudioShell.imageQuality
      ? window.StudioShell.imageQuality(im, a) : null;
    if (q && q.soft) notes.push(window.StudioShell.qualityMessage(q));
    say(`Placed ${name}.` + (notes.length ? ' ' + notes.join(' ') : ''), notes.length > 0);
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
