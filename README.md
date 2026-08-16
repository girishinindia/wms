# Genius WMS — Web Portal + API

Public marketing site, health endpoint and the `/api/v1` namespace for the
warehouse management system. Next.js 15 App Router, one deployment serving
both the web portal and the API that the Flutter app consumes.

**Production:** https://wms.geniusitens.com

---

## Run it

```bash
npm install
cp .env.example .env.local     # only APP_ENV + the two URLs are needed to boot
npm run dev                    # http://localhost:3000
```

```bash
npm run build && npm start     # production build
npx eslint .                   # lint
npx tsc --noEmit               # typecheck
```

---

## What's here

```
src/
  app/
    layout.tsx            fonts, metadata, skip-link
    page.tsx              home page
    not-found.tsx         branded 404
    globals.css           Tailwind v4 + verdigris design tokens
    api/
      health/route.ts     liveness probe — what UptimeRobot polls
      health/db/route.ts  database readiness probe (read-only SELECT)
      openapi.json/route  the generated OpenAPI 3.1 document
      v1/route.ts         API index placeholder
    docs/route.ts         Scalar reference, served against the document
  db/
    index.ts              Drizzle client (lazy, pooler-safe)
  lib/
    openapi/document.ts   registry — paths + schemas, generated from Zod
  components/
    VerdigrisField.tsx    WebGL background (no dependencies)
    HealthBadge.tsx       live /api/health pill on the hero
    icons.tsx             inline stroke icons
next.config.ts            security headers, image remote patterns
```

Home page is statically prerendered (~2.8 kB route, ~109 kB first load JS).
API routes are dynamic.

---

## Design tokens

Every colour comes from `@theme` in `globals.css` — `verdigris-50…950`,
`ink-700…900`, and `patina` for glows. Nothing downstream hardcodes a hex,
so swapping the palette is a single-file edit.

---

## The WebGL background

`VerdigrisField.tsx` is one WebGL1 program: a fullscreen triangle and ~40
lines of GLSL doing two rounds of domain-warped fbm noise. No three.js, no
runtime dependency, about 3 kB gzipped.

It guards itself:

- renders at 55% resolution, CSS-upscaled (the field is soft, so it reads
  identically and costs a third of the fragment work)
- device pixel ratio capped at 1.5
- the rAF loop stops when the tab is hidden **and** when the hero scrolls
  out of view, via `IntersectionObserver`
- `prefers-reduced-motion` paints one static frame and never starts a loop
- no WebGL, or context lost → the component unmounts itself and the CSS
  radial gradient underneath shows through

To retune the look, the four `vec3` constants near the bottom of the
fragment shader are the palette; `uTime * 0.045` is the drift speed.

---

## Health endpoint

`GET /api/health` → `200` with status, environment, region, commit and
uptime. `HEAD` is supported for monitors that only need the status code.
Never cached.

It deliberately does **not** touch the database, Redis or any third party.
A liveness check that depends on downstream services pages you at 3am
because a CDN blipped, which trains everyone to ignore the pager.
Dependency checks belong on a separate `/api/health/ready` once those
dependencies exist.

---

## API documentation

`GET /docs` — Scalar reference.
`GET /api/openapi.json` — the OpenAPI 3.1 document it reads.

The document is **generated**, not written. `src/lib/openapi/document.ts`
registers paths against the same Zod schemas in `src/lib/validation` that
the forms and the route handlers validate with, so a rule changed there
propagates to the docs and to the generated Dart client without anyone
remembering to update three files.

```bash
npx @redocly/cli lint http://localhost:3000/api/openapi.json
```

Two deliberate choices:

- **Only endpoints that exist are listed.** The auth payloads are
  registered as components (they show under *Models*) but have no paths,
  because the handlers are not built. A spec documenting routes that 404
  stops being trusted, and then nobody reads it.
- **The Scalar bundle is pinned** to a specific version on jsDelivr. The
  adapter's default is an unversioned URL, so the UI can change between
  two page loads with no deploy. If the network blocks jsDelivr the page
  renders blank with nothing on screen explaining why — set `SCALAR_CDN`
  to a self-hosted copy of `standalone.js` in that case.

Generate the mobile client from the deployed document, never by hand:

```bash
openapi-generator generate -g dart-dio \
  -i https://wms.geniusitens.com/api/openapi.json \
  -o mobile-app/lib/src/api
```

---

## Database

`GET /api/health/db` runs one read-only `SELECT` through the Supavisor
transaction pooler and reports latency, database, user and server version.
No writes, no DDL — safe against production.

`src/db/index.ts` connects **lazily**. `next build` imports every route
module to read its config, so an eager connection turns a missing
`DATABASE_URL` into a failed build instead of a readable 503. Two settings
are not optional on the pooler: `prepare: false` (statements land on
different backends, so a prepared statement created on one is missing on
the next) and `max: 1` on serverless.

`DATABASE_URL` uses port **6543** (transaction pooler). `DIRECT_URL` uses
**5432** and is for `drizzle-kit` only — migrations, advisory locks and
`CREATE INDEX CONCURRENTLY` break through a transaction pooler.

---

## Environment

`.env.example` is the full annotated list with sourcing notes for every
key. Only three are needed to boot the current scaffold: `APP_ENV`,
`NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_API_URL`.

Two that are easy to miss and expensive to get wrong:

- **`APP_TIMEZONE=Asia/Kolkata`** — every date boundary in this system is a
  billing boundary. Postgres and Vercel default to UTC, so an 11 PM IST
  put-away lands on the previous day and silently mis-bills.
- **`AUTH_COOKIE_DOMAIN=`** — leave blank. Setting `.geniusitens.com` sends
  the session cookie to every other subdomain.

Anything `NEXT_PUBLIC_`-prefixed ships to the browser. Never put a secret
behind that prefix.

---

## Deploy

Vercel, function region `bom1` (Mumbai), same region as the Supabase
project in `ap-south-1`.

DNS:

| Host | Type | Target |
|---|---|---|
| `wms` | CNAME | Vercel's target |
| `cdn` | CNAME | Bunny pull-zone hostname |
| `@` | TXT | SPF including Brevo |
| Brevo DKIM | CNAME ×2 | from the Brevo domain setup |
| `_dmarc` | TXT | start at `p=none`, tighten later |

---

## Next

This is the shell. Per the build order, the next commit is **not** auth or
CRUD screens — it is the stock ledger:

1. `stock_lots`, `stock_balances`, `stock_movements` (append-only),
   `reservations`
2. reserve inside one transaction with `SELECT … FOR UPDATE`
3. a test firing 50 parallel reservations at 10 cartons, asserting exactly
   10 succeed — run against a deployed preview, not localhost, because the
   transaction pooler is where the surprises are

Then the `Scope` layer, then Better Auth, then Stage W.

One decision still blocks those tables: **opaque cartons or SKUs with
quantities?** The spec says both in different places.
