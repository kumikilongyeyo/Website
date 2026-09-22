/* Studio media library client (§16/§17).
 *
 * Uploads go to R2 through /api/media and the page stores a durable /media/...
 * URL. Nothing here ever produces a data: or blob: URL for persistence — the
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

  const state = { assets: [], loaded: false, loading: false, error: null };
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
  // so responsive delivery has something to work with later (§33).
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

  async function upload(file, { onProgress } = {}) {
    if (!signedIn()) return { ok: false, error: 'Sign in to the editor before uploading.' };
    if (!file) return { ok: false, error: 'No file was chosen.' };

    const dims = await measure(file);
    const form = new FormData();
    form.append('file', file);
    if (dims) { form.append('width', String(dims.width)); form.append('height', String(dims.height)); }

    if (onProgress) onProgress({ phase: 'uploading', name: file.name });
    try {
      const r = await fetch('/api/media', { method: 'POST', credentials: 'same-origin', body: form });
      if (!r.ok) {
        const e = await readError(r, 'Upload failed');
        return { ok: false, error: e.message, code: e.code };
      }
      const data = await r.json();
      if (!data.ok || !data.asset) return { ok: false, error: 'The server accepted the upload but returned no asset.' };
      state.assets.unshift(data.asset);
      state.loaded = true;
      notify();
      return { ok: true, asset: data.asset };
    } catch {
      return { ok: false, error: 'Could not reach the media endpoint. The file was not uploaded.' };
    }
  }

  async function remove(key, { force = false } = {}) {
    if (!signedIn()) return { ok: false, error: 'Sign in to the editor before deleting assets.' };
    try {
      const r = await fetch(`/api/media?key=${encodeURIComponent(key)}${force ? '&force=1' : ''}`, {
        method: 'DELETE', credentials: 'same-origin',
      });
      if (!r.ok) {
        const e = await readError(r, 'Delete failed');
        // 409 means the asset is still referenced; hand the caller the detail
        // so it can offer "delete anyway" instead of a dead end.
        return { ok: false, error: e.message, code: e.code, references: (e.body && e.body.references) || [], inUse: r.status === 409 };
      }
      state.assets = state.assets.filter(a => a.key !== key);
      notify();
      const data = await r.json().catch(() => ({}));
      return { ok: true, brokenReferences: data.brokenReferences || [] };
    } catch {
      return { ok: false, error: 'Could not reach the media endpoint. Nothing was deleted.' };
    }
  }

  /* ------------------------------------------------------------------ UI */

  function fmtSize(b) {
    if (!b) return '';
    return b >= 1048576 ? `${(b / 1048576).toFixed(1)}MB` : `${Math.max(1, Math.round(b / 1024))}KB`;
  }

  function panel() {
    let el = document.querySelector('#assetsPanel');
    if (el) return el;
    el = document.createElement('div');
    el.className = 'panel';
    el.id = 'assetsPanel';
    el.innerHTML = `
      <h4>Image library</h4>
      <p class="editor-note">Uploads get a durable URL and never go into the config, so artwork survives reload. The line below says which store is active and its size limit.</p>
      <label class="file-btn">Upload image / video<input id="assetUpload" type="file" accept="image/*,video/mp4,video/webm" multiple></label>
      <div id="assetStatus" class="editor-note" role="status" aria-live="polite"></div>
      <div id="assetGrid" class="asset-grid"></div>
      <div class="action-row"><button type="button" id="assetRefresh">Refresh library</button></div>`;
    return el;
  }

  function render() {
    const grid = document.querySelector('#assetGrid');
    const statusEl = document.querySelector('#assetStatus');
    if (!grid) return;

    if (statusEl && state.error) {
      statusEl.textContent = state.error;
      statusEl.classList.add('is-error');
    } else if (statusEl) {
      statusEl.classList.remove('is-error');
      if (!state.loading) {
        // Say which store is in use and what it costs, so the smaller KV limit
        // is never a mystery when an upload is refused.
        const where = state.storage === 'kv'
          ? ' · stored in KV, 2MB per file'
          : state.storage === 'r2' ? ' · stored in R2, 15MB per file' : '';
        statusEl.textContent = state.loaded
          ? `${state.assets.length} asset${state.assets.length === 1 ? '' : 's'}${where}`
          : '';
      }
    }

    if (state.loading) { grid.innerHTML = '<div class="asset-empty">Loading library…</div>'; return; }
    if (state.error) { grid.innerHTML = ''; return; }
    if (!state.assets.length) { grid.innerHTML = '<div class="asset-empty">No uploads yet.</div>'; return; }

    grid.innerHTML = '';
    for (const a of state.assets) {
      const card = document.createElement('div');
      card.className = 'asset-card';
      card.dataset.key = a.key;
      const isVideo = /^video\//.test(a.mime || '');
      card.innerHTML = `
        <div class="asset-thumb">${isVideo
          ? '<span class="asset-badge">video</span>'
          : `<img loading="lazy" decoding="async" src="${a.url}" alt="">`}</div>
        <div class="asset-meta">
          <strong title="${a.filename || a.key}">${a.filename || a.key}</strong>
          <span>${[a.width && a.height ? `${a.width}×${a.height}` : '', fmtSize(a.size)].filter(Boolean).join(' · ')}</span>
        </div>
        <div class="asset-actions">
          <button type="button" data-use>Use</button>
          <button type="button" data-del class="danger-lite">Delete</button>
        </div>`;
      card.querySelector('[data-use]').onclick = () => useAsset(a);
      card.querySelector('[data-del]').onclick = () => deleteAsset(a);
      grid.appendChild(card);
    }
  }

  function say(msg, isError) {
    const el = document.querySelector('#assetStatus');
    if (el) { el.textContent = msg; el.classList.toggle('is-error', !!isError); }
    if (typeof window.status === 'function') { try { window.status(msg); } catch { /* editor status is optional */ } }
    if (typeof status === 'function') { try { status(msg); } catch { /* ignore */ } }
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
    im.alt = a.filename || 'Portfolio artwork';
    target.classList.remove('placeholder');
    const ph = target.querySelector('.ph');
    if (ph) ph.remove();
    if (typeof window.push === 'function') window.push();
    else if (typeof push === 'function') push();
    say(`Placed ${a.filename || a.key} on ${target.dataset.node || target.dataset.id}.`);
  }

  async function deleteAsset(a) {
    const first = await remove(a.key);
    if (first.ok) { render(); return say(`Deleted ${a.filename || a.key}.`); }
    if (!first.inUse) return say(first.error, true);
    // The server refused because the asset is published somewhere. Offer the
    // override explicitly rather than silently breaking the public page.
    const ok = window.confirm(`${first.error}\n\nDelete anyway and leave those references broken?`);
    if (!ok) return say('Delete cancelled. The asset is still in use.', true);
    const forced = await remove(a.key, { force: true });
    if (!forced.ok) return say(forced.error, true);
    render();
    say(`Deleted ${a.filename || a.key}. ${forced.brokenReferences.length} published reference(s) now point at a missing asset.`, true);
  }

  async function handleFiles(files) {
    const list = [...files];
    if (!list.length) return;
    let done = 0; const failed = [];
    for (const f of list) {
      say(`Uploading ${f.name} (${done + 1} of ${list.length})…`);
      const res = await upload(f);
      if (res.ok) done++; else failed.push(`${f.name}: ${res.error}`);
      render();
    }
    // Partial success is reported as partial, never as total success (§29).
    if (failed.length && done) say(`Uploaded ${done} of ${list.length}. Failed — ${failed.join(' | ')}`, true);
    else if (failed.length) say(`Nothing uploaded. ${failed.join(' | ')}`, true);
    else say(`Uploaded ${done} file${done === 1 ? '' : 's'}.`);
  }

  function mount(container) {
    const host = container || document.querySelector('.tab-panel[data-tab="design"]') || document.querySelector('.inspector');
    if (!host) return null;
    const el = panel();
    if (!el.isConnected) host.appendChild(el);

    const input = el.querySelector('#assetUpload');
    if (input && !input.dataset.bound) {
      input.dataset.bound = '1';
      input.addEventListener('change', async e => {
        const files = e.target.files;
        await handleFiles(files);
        e.target.value = '';
      });
    }
    const refresh = el.querySelector('#assetRefresh');
    if (refresh && !refresh.dataset.bound) {
      refresh.dataset.bound = '1';
      refresh.addEventListener('click', async () => {
        refresh.disabled = true;
        await list({ force: true });
        refresh.disabled = false;
      });
    }
    listeners.add(render);
    render();
    list();
    return el;
  }

  window.StudioAssets = { state, list, upload, remove, mount, render, useAsset, subscribe: fn => listeners.add(fn) };
})();
