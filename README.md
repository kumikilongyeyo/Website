# Illustration Portfolio Editor V4

Two interactive portfolio directions sharing one editor engine:

- `public/studio.html` — **Studio Inspector**: layers left, toolbar top, inspector right.
- `public/gallery.html` — **Gallery Rail**: inspector left, layers as a bottom rail, true-white gallery presentation.

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

The current Replace Image control is immediate but session-local. For permanent uploads, the next production step is an R2 binding and upload endpoint; save the resulting image URL in the portfolio config rather than putting full image data into localStorage or KV.
