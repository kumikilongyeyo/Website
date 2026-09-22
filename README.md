# Illustration Portfolio + Studio

One portfolio site with a visual editor built into it.

- `public/index.html` — the portfolio, served at `/`. The footer gear opens the editor.
- The old `/studio` and `/gallery` addresses 301 to `/` via `public/_redirects`.

The second "Gallery Rail" direction and its older engine (`gallery.html`, `editor.js`,
`app.css`) were retired, along with the root chooser that existed only to pick between the
two. §39 of the handoff locks scope to a single portfolio site.

## Editor controls

The editor supports:

- object selection
- position X / Y
- tile width / height
- alignment
- typography presets
- font size / weight
- kerning / tracking
- line height / alignment / color
- fill and opacity
- image replacement in-session
- crop / zoom / focal position
- edge gradient / blur treatments
- editable tile title / subtitle / tag
- animation presets with duration, delay and distance
- hover presets
- click actions
- layers
- drag-to-reorder tiles
- direct tile resize handles
- undo / redo
- local save
- JSON export
- Cloudflare live-publish hook

Public artwork clicks stay on the same page. The page behind is dimmed and blurred while the final artwork and process images appear as a clean vertical image stack.

## Font sources

The font pairing presets use open-source families from `google/fonts`. See `SOURCES.md`.

## Local preview

```bash
npm install
npm run dev
```

For file/localhost prototype mode only, editor login is:

- username: `admin`
- password: `portfolio`

Those demo credentials are **not used on the deployed site**.

## Safe Cloudflare editor authentication

`functions/api/config.js` checks the live editor credentials server-side. In Cloudflare Pages, configure encrypted secrets/variables:

- `EDITOR_USER`
- `EDITOR_PASS`

Do not put real editor credentials in public HTML or JavaScript.

For live layout persistence, create a Workers KV namespace and bind it to the Pages project as:

- `PORTFOLIO_CONFIG`

The editor's **Publish live** control will then store the selected version's configuration in KV, and visitors load the published configuration through the same Pages Function.

## Cloudflare deployment

The Pages output directory is `public/`, already declared in `wrangler.jsonc`.

A manual GitHub Actions workflow is included at `.github/workflows/cloudflare-pages.yml`.

Add these GitHub repository secrets:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

Then run:

**Actions → Deploy to Cloudflare Pages → Run workflow**

You can also connect this GitHub repository directly in the Cloudflare Pages dashboard and deploy `public/`.

## Image uploads

Uploads get a durable `/media/<key>` URL and are never written into the config.

**No setup is required.** The endpoints use whichever store is available:

| Store | Per-file limit | Setup |
| --- | --- | --- |
| R2 (`PORTFOLIO_MEDIA`) | 15MB | bind a bucket in the dashboard |
| KV (`PORTFOLIO_CONFIG`) | 2MB | **already bound — this is the current default** |

KV is not designed for binary blobs, so the per-file cap is lower and the free tier allows
1000 writes a day. For a portfolio that is a lot of uploads, and it costs nothing to set up.
Uploads are stored under a `media:` key prefix, so they never collide with the
`site-config:` keys. An oversized upload says which store refused it and how to raise the
limit, rather than just failing.

To switch to R2 later: create an R2 bucket, bind it to the Pages project as
`PORTFOLIO_MEDIA`, redeploy. The code prefers R2 automatically, and anything already in KV
keeps serving because the media route falls back to KV when a key is not in the bucket.
Do not declare the bucket in `wrangler.jsonc` before it exists — a binding pointing at a
missing bucket fails the Pages build.

Endpoints (all require the editor credentials):

- `GET /api/media` — list assets; reports the active `storage` and `limitBytes`
- `POST /api/media` — upload (multipart, field `file`); validates type and size
- `DELETE /api/media?key=...` — refuses while the asset is referenced by a published
  config and names the exact reference; add `&force=1` to delete anyway
- `GET /media/<key>` — public, immutable, etag-revalidated

## Studio architecture

`public/studio.html` loads, in order:

| File | Role |
| --- | --- |
| `studio-model.js` | typed component model (schema 4), migration, generated CSS |
| `studio-assets.js` | R2 media library client and Assets panel |
| `studio-shell.js` | toolbar, preview, viewports, layer tree, object ops, texture panel |
| `studio-inspector.js` | binds controls to the model for the active state/breakpoint |
| `studio-texture.js` | animated grain overlays |
| `studio-editor.js` | the original engine: selection, drag, publish, project viewer |

Styling reaches the page as one generated stylesheet keyed on `[data-id]`, not as
inline styles. That is what makes hover/pressed states and per-breakpoint overrides
expressible, and it keeps the editor's selection outline strictly separate from an
object's real border.

`public/studio-patch.js` was removed. Nothing loaded it, and it would have thrown on
load twice over: it referenced `syncSelection` (the function is `syncSelected`) and
`resizeImage` (it is `compressImage`). Every behaviour it intended is already in the
live code, which was verified control by control before deleting it — Site tab control
syncing, edge checkbox state, the Site-tab hero URL and brand controls, restoring
published images into placeholder tiles, and bare-domain normalisation for external
links. It is recoverable from git history if any of it is ever wanted.
