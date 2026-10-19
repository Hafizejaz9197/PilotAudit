import { load, type CheerioAPI } from "cheerio";
import type { AuditReport, CheckResult, LinkStatus, ScanMode, StageId } from "../types";
import { launchBrowser, Renderer, staticSnapshot, type MobileMetrics, type PageSnapshot } from "./browser";
import { linkKey, type AnalyzedPage, type AuditContext } from "./context";
import { httpGet, mapLimit } from "./http";
import { conversionModule } from "./modules/conversion";
import { contentModule } from "./modules/content";
import { mediaModule } from "./modules/media";
import { mobileModule } from "./modules/mobile";
import { seoModule } from "./modules/seo";
import { countSeverities, gradeFor, scoreChecks } from "./scoring";
import { assertPublicHost, isCrawlable, normalizeInputUrl, pageKey, resolveUrl, sameSite } from "./url";

export interface AuditOptions {
  mode: ScanMode;
  onProgress?: (stage: StageId, message: string, percent: number) => void;
  signal?: AbortSignal;
  /** Force the HTTP-only renderer (no Chromium). */
  staticOnly?: boolean;
  /** Skip the private-network guard (e.g. auditing PilotAudit's own bundled demo site). */
  allowPrivateHost?: boolean;
}

const LEAD_PAGE = /contact|book|appointment|schedule|request|consult|new-?patient|reserve|get-?started|forms?\b/i;
const SKIP_EXTERNAL = /(facebook|instagram|linkedin|twitter|x|tiktok|youtube|pinterest|yelp)\.com$|(^|\.)google\.[a-z.]+$|goo\.gl$|maps\.app\.goo\.gl$/i;
const MAX_INTERNAL_LINKS = 150;
const MAX_EXTERNAL_LINKS = 40;

function maxPages(mode: ScanMode): number {
  const env = Number(mode === "full" ? process.env.FULL_SCAN_MAX_PAGES : process.env.QUICK_SCAN_MAX_PAGES);
  return env > 0 ? env : mode === "full" ? 20 : 5;
}

export async function runAudit(input: string, options: AuditOptions): Promise<AuditReport> {
  const { mode, signal } = options;
  const progress = options.onProgress ?? (() => undefined);
  const startedAt = new Date();
  const root = normalizeInputUrl(input);
  if (!options.allowPrivateHost) await assertPublicHost(root);
  const notes: string[] = [];

  progress("fetch", `Launching renderer for ${root.host}`, 2);
  const { browser, error: browserError } = options.staticOnly || process.env.PILOTAUDIT_RENDERER === "static" ? { browser: null, error: "disabled" } : await launchBrowser();
  if (!browser) {
    notes.push(
      browserError === "disabled"
        ? "Static HTML mode: JavaScript-rendered content, image load state, click handlers and mobile layout checks were skipped."
        : `Chromium unavailable (${browserError}). Fell back to static HTML — run "npm run browsers" to enable full rendering.`,
    );
  }
  const renderer = browser ? new Renderer(browser) : null;
  const screenshots: AuditReport["screenshots"] = {};

  try {
    const snap = async (url: string, screenshot = false): Promise<PageSnapshot & { screenshot?: string }> =>
      renderer ? renderer.snapshot(url, { screenshot }) : staticSnapshot(url);

    // ---- Stage 1: fetch homepage + discover pages ----------------------------
    progress("fetch", `Fetching rendered DOM: ${root.toString()}`, 5);
    const home = await snap(root.toString(), true);
    if (!home.html) {
      throw new Error(`Could not load ${root.toString()}: ${home.error ?? `HTTP ${home.status}`}`);
    }
    if (home.screenshot) screenshots.desktop = home.screenshot;
    const homeUrl = new URL(home.finalUrl || root.toString());
    const site = sameSite(homeUrl, root) ? homeUrl : root;
    if (!sameSite(homeUrl, root)) notes.push(`Homepage redirected to a different domain: ${homeUrl.host}`);

    const pages: AnalyzedPage[] = [toPage(home)];
    // Pages that returned 4xx/5xx are reported (link health) but not analysed as content.
    const failedPages: PageSnapshot[] = [];
    const accept = (snapshot: PageSnapshot): AnalyzedPage | null => {
      if (!snapshot.html || snapshot.status >= 400) {
        failedPages.push(snapshot);
        return null;
      }
      const page = toPage(snapshot);
      pages.push(page);
      return page;
    };
    const seen = new Set<string>([pageKey(root), pageKey(homeUrl)]);
    const limit = maxPages(mode);

    if (mode === "quick") {
      const candidates = discoverLinks(pages[0].$, pages[0].url, site)
        .filter((c) => LEAD_PAGE.test(`${c.url.pathname} ${c.text}`))
        .filter((c) => !seen.has(pageKey(c.url)) && seen.add(pageKey(c.url)))
        .slice(0, limit - 1);
      for (const [i, c] of candidates.entries()) {
        signal?.throwIfAborted();
        progress("fetch", `Fetching lead page ${i + 1}/${candidates.length}: ${c.url.pathname}`, 8 + Math.round(((i + 1) / candidates.length) * 32));
        accept(await snap(c.url.toString()));
      }
    } else {
      const queue = discoverLinks(pages[0].$, pages[0].url, site).map((c) => c.url);
      while (queue.length && pages.length < limit) {
        signal?.throwIfAborted();
        const batch: URL[] = [];
        while (queue.length && batch.length < 3 && pages.length + batch.length < limit) {
          const next = queue.shift()!;
          if (seen.has(pageKey(next))) continue;
          seen.add(pageKey(next));
          batch.push(next);
        }
        if (!batch.length) break;
        progress("fetch", `Crawling ${pages.length + 1}–${pages.length + batch.length} of up to ${limit}: ${batch.map((b) => b.pathname).join(", ")}`, 5 + Math.round((pages.length / limit) * 35));
        const snapshots = await Promise.all(batch.map((u) => snap(u.toString())));
        for (const snapshot of snapshots) {
          if (!snapshot.html && snapshot.error) notes.push(`Could not load ${snapshot.url}: ${snapshot.error}`);
          const page = accept(snapshot);
          if (!page) continue;
          for (const c of discoverLinks(page.$, page.url, site)) if (!seen.has(pageKey(c.url))) queue.push(c.url);
        }
      }
    }
    progress("fetch", `Fetched ${pages.length} page${pages.length === 1 ? "" : "s"}`, 40);

    // ---- Stage 2: link health -------------------------------------------------
    signal?.throwIfAborted();
    const links = await checkLinks(pages, failedPages, site, !renderer, renderer, (done, total) =>
      progress("links", `Checking links: ${done}/${total}`, 40 + Math.round((done / Math.max(total, 1)) * 25)),
    );

    // ---- Stage 3: modules A–D -------------------------------------------------
    signal?.throwIfAborted();
    const ctx: AuditContext = { root: site, mode, rendered: Boolean(renderer), pages, links, mobile: [] };
    progress("analyze", "Module A: conversion elements (phones, CTAs, forms)", 67);
    const checks: CheckResult[] = [...(await conversionModule(ctx))];
    progress("analyze", "Module B: AI content & placeholder detection", 70);
    checks.push(...(await contentModule(ctx)));
    progress("analyze", "Module C: media & asset integrity", 73);
    checks.push(...(await mediaModule(ctx)));
    progress("analyze", "Module D: SEO & technical architecture", 76);
    checks.push(...(await seoModule(ctx)));

    // ---- Stage 4: mobile -------------------------------------------------------
    signal?.throwIfAborted();
    if (renderer) {
      const mobilePages = pages.slice(0, mode === "quick" ? 5 : 6);
      const metrics: MobileMetrics[] = [];
      for (const [i, page] of mobilePages.entries()) {
        progress("mobile", `Rendering at 390px (iPhone): ${new URL(page.url).pathname}`, 80 + Math.round((i / mobilePages.length) * 14));
        const result = await renderer.mobileCheck(page.url, { screenshot: i === 0 });
        if (result.metrics) metrics.push(result.metrics);
        if (result.screenshot) screenshots.mobile = result.screenshot;
      }
      ctx.mobile = metrics;
    } else {
      progress("mobile", "Mobile layout checks need a browser — checking viewport meta only", 90);
    }
    checks.push(...(await mobileModule(ctx)));

    // ---- Stage 5: report -------------------------------------------------------
    progress("report", "Scoring and compiling report", 96);
    const score = scoreChecks(checks);
    const finishedAt = new Date();
    const linkList = [...links.values()];
    return {
      id: `${site.host}-${finishedAt.getTime()}`,
      url: site.toString(),
      siteName: siteName(pages[0].$, site),
      platform: detectPlatform(pages[0].snapshot.html),
      mode,
      renderer: renderer ? "browser" : "static",
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      score,
      grade: gradeFor(score),
      counts: countSeverities(checks),
      checks,
      pages: [
        ...pages.map((p) => ({
          url: p.url,
          status: p.snapshot.status,
          title: p.$("title").first().text().trim(),
          loadTimeMs: p.snapshot.loadTimeMs,
          bytes: p.snapshot.resources.reduce((sum, r) => sum + r.bytes, 0),
          requests: p.snapshot.resources.length,
          error: p.snapshot.error,
        })),
        ...failedPages.map((s) => ({ url: s.url, status: s.status, title: "", loadTimeMs: s.loadTimeMs, bytes: 0, requests: 0, error: s.error })),
      ],
      links: { checked: linkList.length, broken: linkList.filter((l) => !l.ok).length, list: linkList },
      screenshots,
      notes,
    };
  } finally {
    await renderer?.close();
    await browser?.close().catch(() => undefined);
  }
}

function toPage(snapshot: PageSnapshot): AnalyzedPage {
  return { url: snapshot.finalUrl || snapshot.url, snapshot, $: load(snapshot.html) };
}

/** Internal crawlable links in document order (header/nav first, as they appear). */
function discoverLinks($: CheerioAPI, base: string, root: URL): { url: URL; text: string }[] {
  const out: { url: URL; text: string }[] = [];
  const keys = new Set<string>();
  $("a[href]").each((_, el) => {
    const url = resolveUrl($(el).attr("href") ?? "", base);
    if (!url || !isCrawlable(url, root)) return;
    url.hash = "";
    const key = pageKey(url);
    if (keys.has(key)) return;
    keys.add(key);
    out.push({ url, text: $(el).text().trim() });
  });
  return out;
}

type LinkSource = "link" | "form" | "iframe" | "image";

async function checkLinks(
  pages: AnalyzedPage[],
  failedPages: PageSnapshot[],
  root: URL,
  includeImages: boolean,
  renderer: Renderer | null,
  onProgress: (done: number, total: number) => void,
): Promise<Map<string, LinkStatus>> {
  const found = new Map<string, { url: URL; pages: Set<string>; source: LinkSource }>();
  const add = (raw: string | undefined, base: string, source: LinkSource) => {
    if (!raw) return;
    const url = resolveUrl(raw.trim(), base);
    if (!url || !/^https?:$/.test(url.protocol)) return;
    url.hash = "";
    if (!sameSite(url, root) && SKIP_EXTERNAL.test(url.hostname)) return;
    const key = linkKey(url);
    const entry = found.get(key) ?? { url, pages: new Set<string>(), source };
    entry.pages.add(base);
    if (source !== "link") entry.source = source; // forms/iframes take priority when reporting
    found.set(key, entry);
  };
  for (const { $, url } of pages) {
    $("form[action]").each((_, el) => add($(el).attr("action"), url, "form"));
    $("iframe[src]").each((_, el) => add($(el).attr("src"), url, "iframe"));
    $("a[href]").each((_, el) => add($(el).attr("href"), url, "link"));
    if (includeImages) $("img[src]").each((_, el) => add($(el).attr("src"), url, "image"));
  }

  // Pages we already loaded don't need a second request.
  const known = new Map<string, number>();
  for (const p of pages) {
    known.set(linkKey(new URL(p.snapshot.url)), p.snapshot.status);
    known.set(linkKey(new URL(p.url)), p.snapshot.status);
  }
  for (const s of failedPages) known.set(linkKey(new URL(s.url)), s.status);

  const entries = [...found.entries()];
  const internal = entries.filter(([, e]) => sameSite(e.url, root)).slice(0, MAX_INTERNAL_LINKS);
  const external = entries.filter(([, e]) => !sameSite(e.url, root)).slice(0, MAX_EXTERNAL_LINKS);
  const todo = [...internal, ...external];
  let done = 0;
  onProgress(0, todo.length);

  const results = await mapLimit(todo, 8, async ([key, entry]) => {
    const isInternal = sameSite(entry.url, root);
    let status = known.get(key);
    let error: string | undefined;
    if (status === undefined) {
      const res = await httpGet(entry.url.toString(), { timeoutMs: 12000 });
      status = res.status;
      error = res.error;
    }
    done++;
    if (done % 5 === 0 || done === todo.length) onProgress(done, todo.length);
    return { key, entry, status, error, isInternal };
  });

  // CDNs/WAFs often 403 non-browser clients; re-verify internal 403s with the real browser.
  if (renderer) {
    const forbidden = results.filter((r) => r.isInternal && r.status === 403 && r.entry.source === "link").slice(0, 10);
    await mapLimit(forbidden, 2, async (r) => {
      const snapshot = await renderer.snapshot(r.entry.url.toString());
      if (snapshot.status) r.status = snapshot.status;
    });
  }

  const map = new Map<string, LinkStatus>();
  for (const r of results) {
    map.set(r.key, {
      url: r.entry.url.toString(),
      status: r.status,
      ok: isOk(r.status, r.isInternal, r.entry.source),
      internal: r.isInternal,
      error: r.error,
      foundOn: [...r.entry.pages],
      source: r.entry.source,
    });
  }
  return map;
}

function isOk(status: number, internal: boolean, source: LinkSource): boolean {
  if (status >= 200 && status < 400) return true;
  // Form endpoints commonly reject GET (400/405) but accept POST.
  if (source === "form") return status === 400 || status === 405 || status === 401;
  if (status === 405 || status === 429) return true;
  // Third-party sites frequently block bots with 401/403/999.
  if (!internal) return status === 401 || status === 403 || status === 999;
  return false;
}

function siteName($: CheerioAPI, root: URL): string {
  const og = $('meta[property="og:site_name"]').attr("content")?.trim();
  if (og) return og;
  const app = $('meta[name="application-name"]').attr("content")?.trim();
  if (app) return app;
  const parts = $("title").first().text().split(/\s[|–—•:-]\s/).map((s) => s.trim()).filter(Boolean);
  const named = parts.find((p) => !/^home(page)?$/i.test(p));
  return named || root.hostname.replace(/^www\./, "");
}

export function detectPlatform(html: string): string {
  if (/wp-content|wp-includes|content="WordPress/i.test(html)) return "WordPress";
  if (/data-wf-site|webflow\.(js|com)/i.test(html)) return "Webflow";
  if (/static\.wixstatic\.com|wix\.com/i.test(html)) return "Wix";
  if (/squarespace/i.test(html)) return "Squarespace";
  if (/cdn\.shopify\.com/i.test(html)) return "Shopify";
  if (/irp\.cdn-website\.com|dudaone|duda\.co/i.test(html)) return "Duda";
  if (/framerusercontent|framer\.com/i.test(html)) return "Framer";
  if (/__NEXT_DATA__|\/_next\/static/i.test(html)) return "Next.js";
  if (/___gatsby/i.test(html)) return "Gatsby";
  return "Custom";
}
