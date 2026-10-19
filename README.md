# PilotAudit — AI Website QA & Audit Engine

PilotAudit audits AI-generated dental and healthcare marketing websites (WordPress, Webflow, custom builds). It catches the bugs AI site
builders leave behind: dead phone links, `#` CTAs, Lorem Ipsum, placeholder doctors, broken images, SEO gaps and mobile layout
defects. It then turns the results into a client-ready report for leadership (Slack, PDF, Jira).

![Stack](https://img.shields.io/badge/Next.js-15-black) ![Playwright](https://img.shields.io/badge/Playwright-Chromium-2EAD33) ![Tailwind](https://img.shields.io/badge/Tailwind-v4-38BDF8)

## Quick start

```bash
npm install
npm run browsers      # one-time: downloads Playwright's Chromium (skip if CHROMIUM_PATH is set)
npm run dev           # http://localhost:3000
```

Click **"Try the bundled demo clinic site"** to audit `public/demo-clinic/`. That site is seeded with typical AI-generated bugs.

## How it works

```
URL ──▶ Renderer (Playwright Chromium, desktop 1440px)
          │   • waits for network idle, scrolls to trigger lazy-loading
          │   • records click listeners (to tell live <button>s from dead ones)
          │   • annotates image load state, captures screenshots + network sizes
          ▼
        Crawler  ── Quick: homepage + lead-form pages (contact/book/schedule)
          │      ── Full: BFS over internal links, up to 20 pages
          ▼
        Link checker (internal + external, 403s re-verified in the browser)
          ▼
        Modules A–D on the rendered HTML (Cheerio)  ──▶  Module E at 390px (iPhone)
          ▼
        Score (0–100) ─▶ Dashboard · Slack summary · PDF · Jira markdown
```

The audit API (`POST /api/audit`) streams progress as NDJSON through the five stages: **Fetching DOM → Checking Links → Analyzing
SEO → Mobile UX Check → Generating Report**.

If Chromium isn't available, PilotAudit falls back to static HTML fetching. Runtime-only checks are then skipped, and the report
says so.

## Audit modules

| Module | Checks |
| --- | --- |
| **A. Conversion & Interactive** | `tel:` links (`about:invalid`, missing prefix, letters, too few digits, fictional 555 numbers, E.164 formatting) · plain-text numbers that aren't tap-to-call · conflicting phone numbers across pages · Book/Schedule/Contact/Call CTAs with `#`, `#/`, `javascript:void(0)`, empty or missing `href` · `<button>` CTAs with no form/link/click handler · CTA destinations returning 4xx/5xx · lead-capture presence (forms, Calendly/NexHealth/Zocdoc/LocalMed/… widgets) · form action & iframe endpoints returning 403/404/5xx · unnamed form fields |
| **B. AI Content & QC** | Lorem Ipsum, `[Insert Name]`, `{{tokens}}`, TODO · WordPress/Webflow/Elementor/Divi default text · placeholder doctors (Dr. John Doe), emails, addresses, phone numbers · copied AI-chat text ("As an AI language model", "Certainly! Here's…") · cliché-heavy generic copy · unlinked service cards and list items · stale copyright year |
| **C. Media & Assets** | Images that failed to load · malformed Base64 icons · empty inline SVGs / missing `<use>` symbols · lazy-loaded images that never rendered · placeholder-service images · missing/empty/junk `alt` · JPEG/PNG over 150 KB not served as WebP/AVIF · images far larger than their display size |
| **D. SEO & Technical** | One H1 per page · heading order · title & meta description (missing, length, duplicates) · favicon · OpenGraph · canonical (missing, multiple, pointing at a staging/template domain) · `noindex` and `robots.txt Disallow: /` · Dentist/MedicalBusiness JSON-LD · `lang` · more than 8 render-blocking stylesheets / sync head scripts · unminified CSS/JS · mixed content · page weight & load time · internal links returning 403/404/500 · external link health |
| **E. Mobile UX** | Viewport meta · horizontal overflow at 390px (names the offending elements) · tap targets under 32px · text under 12px · tap-to-call visible in the first mobile screen |

### Scoring

Every check is 🔴 **critical**, 🟡 **warning** or 🟢 **passed**. The score starts at 100. Each failing critical check deducts 9 points
plus up to 6 more for repeat issues; each warning deducts 2.5 points plus up to 2.5 more. Repeated header/footer bugs are merged into
a single issue that lists every affected page, so one site-wide bug doesn't zero the score. Grades: A ≥ 90, B ≥ 80, C ≥ 70,
D ≥ 60, F < 60.

## Reporting for leadership

* **Copy Slack Summary**: executive briefing in Slack mrkdwn (site, score, critical blockers with affected pages, warnings,
  passed and polished checks).
* **Download PDF Report**: branded A4 executive report rendered by headless Chromium (`POST /api/report/pdf`). Most sites fit on
  1–2 pages; a heavily broken site runs longer. If the server can't render PDFs, the browser's print dialog opens instead.
* **Send to Jira**: one Markdown bug ticket per failing check (summary, priority, labels, affected elements with HTML snippets,
  expected fix, acceptance criteria). Copy one ticket, copy all, or download a `.md` file.

### Daily reports (CLI / cron)

```bash
npm run audit -- https://brightsmiledental.com --mode full --out reports
cp sites.example.json sites.json && npm run audit:daily
```

Each site gets `reports/<host>-<date>.{json,pdf,slack.md,jira.md}`. If `SLACK_WEBHOOK_URL` is set, the summary is also posted
to Slack, for example from a cron job each morning:

```cron
45 7 * * 1-5  cd /srv/pilotaudit && SLACK_WEBHOOK_URL=... npm run audit:daily
```

## Configuration

See `.env.example`. In production, auditing localhost and private-network addresses is blocked (SSRF protection) unless
`ALLOW_PRIVATE_HOSTS=true`. The bundled demo site is always allowed because it's served from PilotAudit's own origin.

## Project layout

```
src/app/api/audit/route.ts        streaming audit endpoint
src/app/api/report/pdf/route.ts   PDF export
src/lib/audit/engine.ts           orchestration: crawl → links → modules → score
src/lib/audit/browser.ts          Playwright renderer, DOM annotation, mobile metrics
src/lib/audit/modules/*.ts        modules A–E
src/lib/report/*.ts               Slack, Jira and PDF formatters
src/components/*                  dashboard UI
scripts/audit.ts                  CLI for scheduled reports
public/demo-clinic/               demo site with seeded bugs
```

## Scripts

`npm run dev` · `npm run build` · `npm start` · `npm test` (unit tests plus engine integration tests against the demo site) ·
`npm run typecheck`

## Deployment notes

The audit runs Chromium, so deploy to a Node host that allows it (a Docker/VM host, Render, Railway or Fly.io). Serverless
platforms with short timeouts aren't suitable for full scans. Install the browser in your image with `npx playwright install --with-deps chromium`.
