import type { CheckResult } from "../../types";
import { buildCheck, snippet, type AuditContext, type RawIssue } from "../context";
import { httpGet, mapLimit } from "../http";
import { resolveUrl, sameSite, shortPath } from "../url";

const MAX_BLOCKING_CSS = 8;
const MAX_BLOCKING_JS = 6;
const LOCAL_SCHEMA = /^(Dentist|DentalClinic|MedicalBusiness|MedicalClinic|MedicalOrganization|Physician|LocalBusiness|HealthAndBeautyBusiness|Hospital|Optician|Orthodontist)$/i;

/** Heuristic: large file with short average line length and no ".min." in the name. */
export function looksUnminified(url: string, body: string): boolean {
  if (/\.min\.(css|js)/i.test(url) || body.length < 4096) return false;
  const lines = body.split("\n").length;
  return lines > 60 && body.length / lines < 120;
}

export async function seoModule(ctx: AuditContext): Promise<CheckResult[]> {
  const h1: RawIssue[] = [];
  const headingOrder: RawIssue[] = [];
  const titles: RawIssue[] = [];
  const descriptions: RawIssue[] = [];
  const og: RawIssue[] = [];
  const canonical: RawIssue[] = [];
  const indexability: RawIssue[] = [];
  const lang: RawIssue[] = [];
  const blocking: RawIssue[] = [];
  const mixed: RawIssue[] = [];
  const performance: RawIssue[] = [];
  const schemaIssues: RawIssue[] = [];
  const titleIndex = new Map<string, string[]>();
  const descIndex = new Map<string, string[]>();
  // Same-site CSS/JS to test for minification, de-duplicated by path (cache-busting query strings ignored).
  const assetUrls = new Set<string>();
  const assetPaths = new Set<string>();
  const addAsset = (ref: URL) => {
    if (assetUrls.size >= 12 || assetPaths.has(ref.pathname)) return;
    assetPaths.add(ref.pathname);
    assetUrls.add(ref.toString());
  };
  const schemaTypes = new Set<string>();

  for (const { $, url, snapshot } of ctx.pages) {
    // Headings
    const h1s = $("h1");
    if (h1s.length === 0) h1.push({ message: "Page has no H1 heading", pageUrl: url, severity: "warning" });
    else if (h1s.length > 1) {
      h1.push({
        message: `Page has ${h1s.length} H1 headings (should be exactly one)`,
        pageUrl: url,
        snippet: h1s.toArray().slice(0, 4).map((el) => `<h1>${$(el).text().replace(/\s+/g, " ").trim().slice(0, 50)}</h1>`).join(" "),
        severity: "warning",
      });
    }
    let previous = 0;
    $("h1, h2, h3, h4, h5, h6").each((_, el) => {
      const level = Number(el.type === "tag" ? el.name[1] : 0);
      if (previous && level > previous + 1 && headingOrder.filter((i) => i.pageUrl === url).length < 2) {
        headingOrder.push({ message: `Heading jumps from H${previous} to H${level}`, pageUrl: url, snippet: snippet($, el, 120), severity: "warning" });
      }
      previous = level;
    });

    // Title & description
    const title = $("head title").first().text().replace(/\s+/g, " ").trim();
    if (!title) titles.push({ message: "Missing <title> tag", pageUrl: url, severity: "critical" });
    else {
      if (title.length < 15) titles.push({ message: `Title is too short (${title.length} chars): "${title}"`, pageUrl: url, severity: "warning" });
      if (title.length > 65) titles.push({ message: `Title is too long (${title.length} chars, ~60 max): "${title.slice(0, 80)}…"`, pageUrl: url, severity: "warning" });
      titleIndex.set(title, [...(titleIndex.get(title) ?? []), url]);
    }
    const description = ($('meta[name="description"]').attr("content") ?? "").trim();
    if (!description) descriptions.push({ message: "Missing meta description", pageUrl: url, severity: "warning" });
    else {
      if (description.length < 50) descriptions.push({ message: `Meta description is too short (${description.length} chars)`, pageUrl: url, snippet: description, severity: "warning" });
      if (description.length > 160) descriptions.push({ message: `Meta description is too long (${description.length} chars, 160 max)`, pageUrl: url, snippet: description.slice(0, 170), severity: "warning" });
      descIndex.set(description, [...(descIndex.get(description) ?? []), url]);
    }

    // OpenGraph
    const missingOg = ["og:title", "og:description", "og:image", "og:url"].filter((p) => !$(`meta[property="${p}"]`).attr("content"));
    if (missingOg.length) og.push({ message: `Missing OpenGraph tags: ${missingOg.join(", ")}`, pageUrl: url, severity: "warning" });

    // Canonical
    const canonicals = $('link[rel="canonical"]');
    if (canonicals.length === 0) canonical.push({ message: "Missing canonical URL", pageUrl: url, severity: "warning" });
    else {
      if (canonicals.length > 1) canonical.push({ message: `${canonicals.length} canonical tags on one page`, pageUrl: url, severity: "warning" });
      const href = canonicals.first().attr("href") ?? "";
      const target = resolveUrl(href, url);
      if (!href || !target) canonical.push({ message: "Canonical tag has an empty or invalid href", pageUrl: url, snippet: snippet($, canonicals[0]), severity: "warning" });
      else if (!sameSite(target, ctx.root)) {
        canonical.push({ message: `Canonical points to a different domain (${target.host}) — likely a staging or template URL`, pageUrl: url, snippet: snippet($, canonicals[0]), severity: "critical" });
      }
    }

    // Indexability
    const robots = `${$('meta[name="robots"]').attr("content") ?? ""} ${$('meta[name="googlebot"]').attr("content") ?? ""}`;
    if (/noindex/i.test(robots)) {
      indexability.push({ message: "Page is set to noindex — Google will not list it", pageUrl: url, snippet: snippet($, $('meta[name="robots"], meta[name="googlebot"]')[0]), severity: "critical" });
    }

    if (!$("html").attr("lang")) lang.push({ message: "<html> tag has no lang attribute", pageUrl: url, severity: "warning" });

    // JSON-LD
    $('script[type="application/ld+json"]').each((_, el) => {
      try {
        const data = JSON.parse($(el).text());
        const visit = (node: unknown) => {
          if (Array.isArray(node)) node.forEach(visit);
          else if (node && typeof node === "object") {
            const type = (node as Record<string, unknown>)["@type"];
            for (const t of Array.isArray(type) ? type : [type]) if (typeof t === "string") schemaTypes.add(t);
            Object.values(node).forEach((v) => typeof v === "object" && visit(v));
          }
        };
        visit(data);
      } catch {
        schemaIssues.push({ message: "Invalid JSON-LD structured data (parse error)", pageUrl: url, snippet: $(el).text().trim().slice(0, 140), severity: "warning" });
      }
    });

    // Render-blocking assets
    const stylesheets = $('head link[rel="stylesheet"]').filter((_, el) => {
      const media = ($(el).attr("media") ?? "all").toLowerCase();
      return media === "all" || media === "screen" || media === "";
    });
    const syncScripts = $("head script[src]").filter((_, el) => {
      const s = $(el);
      return s.attr("async") === undefined && s.attr("defer") === undefined && s.attr("type") !== "module";
    });
    if (stylesheets.length > MAX_BLOCKING_CSS) {
      blocking.push({
        message: `${stylesheets.length} render-blocking stylesheets in <head> (recommended ≤ ${MAX_BLOCKING_CSS})`,
        pageUrl: url,
        snippet: stylesheets.toArray().slice(0, 12).map((el) => shortPath(resolveUrl($(el).attr("href") ?? "", url)?.toString() ?? "")).join(", "),
        severity: "warning",
      });
    }
    if (syncScripts.length > MAX_BLOCKING_JS) {
      blocking.push({
        message: `${syncScripts.length} synchronous <script> tags in <head> without async/defer`,
        pageUrl: url,
        snippet: syncScripts.toArray().slice(0, 10).map((el) => shortPath(resolveUrl($(el).attr("src") ?? "", url)?.toString() ?? "")).join(", "),
        severity: "warning",
      });
    }
    $('link[rel="stylesheet"][href], script[src]').each((_, el) => {
      const ref = resolveUrl($(el).attr("href") ?? $(el).attr("src") ?? "", url);
      if (ref && sameSite(ref, ctx.root)) addAsset(ref);
    });

    // Mixed content
    if (url.startsWith("https:")) {
      $("img[src^='http:'], script[src^='http:'], link[rel=stylesheet][href^='http:'], iframe[src^='http:'], source[src^='http:']").each((_, el) => {
        mixed.push({ message: "Insecure http:// resource on an https page", pageUrl: url, snippet: snippet($, el), severity: "warning" });
      });
    }

    // Performance (browser renderer only)
    if (snapshot.rendered && snapshot.resources.length) {
      const bytes = snapshot.resources.reduce((sum, r) => sum + r.bytes, 0);
      if (snapshot.loadTimeMs > 5000) performance.push({ message: `Slow page load: ${(snapshot.loadTimeMs / 1000).toFixed(1)}s to the load event`, pageUrl: url, severity: "warning" });
      if (bytes > 4 * 1024 * 1024) performance.push({ message: `Heavy page: ${(bytes / 1024 / 1024).toFixed(1)} MB transferred`, pageUrl: url, severity: "warning" });
      if (snapshot.resources.length > 150) performance.push({ message: `${snapshot.resources.length} network requests on load`, pageUrl: url, severity: "warning" });
      for (const res of snapshot.resources) {
        const ref = new URL(res.url);
        if ((res.type === "stylesheet" || res.type === "script") && sameSite(ref, ctx.root)) addAsset(ref);
      }
    }
  }

  for (const [title, urls] of titleIndex) {
    if (urls.length > 1) titles.push({ message: `Duplicate title on ${urls.length} pages: "${title.slice(0, 70)}"`, pageUrl: urls[0], snippet: urls.map(shortPath).join(", "), severity: "warning" });
  }
  for (const [description, urls] of descIndex) {
    if (urls.length > 1) descriptions.push({ message: `Duplicate meta description on ${urls.length} pages`, pageUrl: urls[0], snippet: description.slice(0, 120), severity: "warning" });
  }

  if (![...schemaTypes].some((t) => LOCAL_SCHEMA.test(t))) {
    schemaIssues.push({
      message: `No Dentist/MedicalBusiness/LocalBusiness structured data found${schemaTypes.size ? ` (found: ${[...schemaTypes].slice(0, 6).join(", ")})` : ""}`,
      pageUrl: ctx.root.toString(),
      severity: "warning",
    });
  }

  // Network checks: robots.txt, favicon and unminified assets.
  const homepage = ctx.pages[0];
  const [robotsTxt, favicon, minification] = await Promise.all([
    httpGet(new URL("/robots.txt", ctx.root).toString(), { readBody: true, timeoutMs: 8000 }),
    checkFavicon(ctx),
    mapLimit([...assetUrls], 4, async (asset) => {
      const res = await httpGet(asset, { readBody: true, timeoutMs: 8000 });
      return res.status === 200 && res.body && looksUnminified(asset, res.body) ? { asset, kb: Math.round(res.body.length / 1024) } : null;
    }),
  ]);
  if (robotsTxt.status === 200 && robotsTxt.body && disallowsEverything(robotsTxt.body)) {
    indexability.push({ message: "robots.txt blocks all crawlers (Disallow: /)", pageUrl: new URL("/robots.txt", ctx.root).toString(), snippet: robotsTxt.body.slice(0, 160), severity: "critical" });
  }
  const unminified: RawIssue[] = minification
    .filter((m): m is { asset: string; kb: number } => m !== null)
    .map((m) => ({ message: `Unminified asset (${m.kb} KB): ${shortPath(m.asset)}`, pageUrl: homepage.url, severity: "warning" as const }));

  // Internal / external link health
  const linkIssues: RawIssue[] = [];
  const externalIssues: RawIssue[] = [];
  for (const link of ctx.links.values()) {
    if (link.ok || link.source === "form" || link.source === "iframe") continue;
    const status = link.status ? `HTTP ${link.status}` : link.error ?? "unreachable";
    const issue: RawIssue = {
      message: `${status} → ${link.url}`,
      pageUrl: link.foundOn[0] ?? ctx.root.toString(),
      snippet: link.foundOn.length ? `Linked from: ${link.foundOn.slice(0, 5).map(shortPath).join(", ")}${link.foundOn.length > 5 ? ` +${link.foundOn.length - 5} more` : ""}` : undefined,
      severity: link.internal ? "critical" : "warning",
    };
    (link.internal ? linkIssues : externalIssues).push(issue);
  }
  for (const page of ctx.pages) {
    if (page.snapshot.status >= 400 && !ctx.links.has(page.url)) {
      linkIssues.push({ message: `HTTP ${page.snapshot.status} → ${page.url}`, pageUrl: page.url, severity: "critical" });
    }
  }
  const internalChecked = [...ctx.links.values()].filter((l) => l.internal).length;

  return [
    buildCheck(
      {
        id: "seo.link-health",
        module: "seo",
        label: "Internal link health (403 / 404 / 500)",
        severity: "critical",
        passed: `All ${internalChecked} internal links return a healthy status`,
        recommendation: "Fix or 301-redirect each broken URL, and update menus/buttons that point at it.",
        summary: (i) => `${i.length} broken internal link${i.length === 1 ? "" : "s"} out of ${internalChecked} checked`,
      },
      linkIssues,
    ),
    buildCheck(
      {
        id: "seo.indexability",
        module: "seo",
        label: "Search engine indexability",
        severity: "critical",
        passed: "Pages are indexable (no noindex, robots.txt allows crawling)",
        recommendation: "Remove the noindex tag / 'Discourage search engines' setting left over from staging, and allow crawling in robots.txt.",
      },
      indexability,
    ),
    buildCheck(
      {
        id: "seo.title",
        module: "seo",
        label: "Meta title",
        severity: "warning",
        passed: "Every page has a unique, well-sized title",
        recommendation: "Write a unique 30–60 character title per page, e.g. \"Dental Implants in Austin, TX | Smile Dental\".",
      },
      titles,
    ),
    buildCheck(
      {
        id: "seo.description",
        module: "seo",
        label: "Meta description",
        severity: "warning",
        passed: "Every page has a unique meta description",
        recommendation: "Add a unique 120–160 character description with the service, city and a call to action.",
      },
      descriptions,
    ),
    buildCheck(
      {
        id: "seo.h1",
        module: "seo",
        label: "H1 hierarchy",
        severity: "warning",
        passed: "Every page has exactly one H1",
        recommendation: "Use exactly one H1 per page (the main page topic) and demote other large headings to H2.",
      },
      h1,
    ),
    buildCheck(
      {
        id: "seo.heading-order",
        module: "seo",
        label: "Heading order",
        severity: "warning",
        passed: "Headings follow a logical order",
        recommendation: "Don't skip heading levels; style headings with CSS instead of picking tags by size.",
      },
      headingOrder,
    ),
    buildCheck(
      {
        id: "seo.canonical",
        module: "seo",
        label: "Canonical URLs",
        severity: "warning",
        passed: "Canonical tags present and pointing at this domain",
        recommendation: "Add one self-referencing canonical per page on the production domain.",
      },
      canonical,
    ),
    buildCheck(
      {
        id: "seo.open-graph",
        module: "seo",
        label: "OpenGraph / social sharing tags",
        severity: "warning",
        passed: "OpenGraph title, description, image and URL are set",
        recommendation: "Set og:title, og:description, og:image (1200×630) and og:url — most SEO plugins can do this automatically.",
      },
      og,
    ),
    buildCheck(
      {
        id: "seo.favicon",
        module: "seo",
        label: "Favicon",
        severity: "warning",
        passed: "Favicon found",
        recommendation: "Upload a favicon (Site Identity in WordPress, Site Settings in Webflow) and link it with <link rel=\"icon\">.",
      },
      favicon,
    ),
    buildCheck(
      {
        id: "seo.schema",
        module: "seo",
        label: "Local business structured data",
        severity: "warning",
        passed: `Local business schema found (${[...schemaTypes].filter((t) => LOCAL_SCHEMA.test(t)).join(", ")})`,
        recommendation: "Add Dentist (or MedicalClinic) JSON-LD with name, address, phone, hours and geo coordinates.",
      },
      schemaIssues,
    ),
    buildCheck(
      {
        id: "seo.lang",
        module: "seo",
        label: "Document language",
        severity: "warning",
        passed: "<html lang> is set",
        recommendation: 'Add lang="en" (or the correct language) to the <html> tag.',
      },
      lang,
    ),
    buildCheck(
      {
        id: "seo.render-blocking",
        module: "seo",
        label: "Render-blocking CSS / JS",
        severity: "warning",
        passed: `Render-blocking assets within limits (≤ ${MAX_BLOCKING_CSS} stylesheets)`,
        recommendation: "Combine/bundle stylesheets, inline critical CSS and add defer to non-critical scripts (e.g. WP Rocket, Autoptimize).",
      },
      blocking,
    ),
    buildCheck(
      {
        id: "seo.minification",
        module: "seo",
        label: "CSS / JS minification",
        severity: "warning",
        passed: assetUrls.size ? `${assetUrls.size} same-site CSS/JS files checked — all minified` : "No same-site CSS/JS files to check",
        recommendation: "Enable CSS/JS minification in the caching/optimisation plugin or build pipeline.",
      },
      unminified,
    ),
    buildCheck(
      {
        id: "seo.mixed-content",
        module: "seo",
        label: "Mixed content (http on https)",
        severity: "warning",
        passed: "No insecure http:// resources",
        recommendation: "Load every resource over https:// (search-replace http:// URLs in the database).",
      },
      mixed,
    ),
    buildCheck(
      {
        id: "seo.performance",
        module: "seo",
        label: "Page speed & weight",
        severity: "warning",
        passed: ctx.rendered ? "Pages load quickly with reasonable weight" : "Skipped — requires the browser renderer",
        recommendation: "Compress images, enable caching/CDN and remove unused plugins/scripts.",
      },
      performance,
    ),
    buildCheck(
      {
        id: "seo.external-links",
        module: "seo",
        label: "External links",
        severity: "warning",
        passed: "Checked external links respond",
        recommendation: "Update or remove external links that no longer resolve (social profiles, review sites, insurance partners).",
      },
      externalIssues,
    ),
  ];
}

function disallowsEverything(robots: string): boolean {
  let appliesToAll = false;
  for (const raw of robots.split("\n")) {
    const line = raw.split("#")[0].trim();
    const [key, ...rest] = line.split(":");
    const value = rest.join(":").trim();
    if (/^user-agent$/i.test(key)) appliesToAll = value === "*";
    else if (appliesToAll && /^disallow$/i.test(key) && value === "/") return true;
  }
  return false;
}

async function checkFavicon(ctx: AuditContext): Promise<RawIssue[]> {
  const home = ctx.pages[0];
  const declared = home.$('link[rel~="icon"], link[rel="shortcut icon"], link[rel="apple-touch-icon"]').first().attr("href");
  if (declared?.startsWith("data:")) return [];
  const iconUrl = resolveUrl(declared || "/favicon.ico", home.url);
  if (!iconUrl) return [{ message: "Favicon link has an invalid href", pageUrl: home.url, severity: "warning" }];
  const res = await httpGet(iconUrl.toString(), { timeoutMs: 8000 });
  if (res.status >= 200 && res.status < 400 && !res.contentType.includes("text/html")) return [];
  return [
    {
      message: declared ? `Declared favicon returns ${res.status || res.error}: ${iconUrl}` : "No favicon declared and /favicon.ico not found",
      pageUrl: home.url,
      severity: "warning",
    },
  ];
}
