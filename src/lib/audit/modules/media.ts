import type { CheckResult } from "../../types";
import { buildCheck, snippet, type AuditContext, type RawIssue } from "../context";
import { resolveUrl } from "../url";

const PLACEHOLDER_IMAGE = /placehold\.(co|it)|placeholder\.com|via\.placeholder|dummyimage\.com|placekitten|placebear|picsum\.photos|fakeimg\.pl|loremflickr|lorempixel|source\.unsplash\.com|[/_-]placeholder[\w-]*\.(png|jpe?g|svg|webp|gif)|image-placeholder|no-image|default-image/i;
const BLANK_SRC = /^data:image\/(gif|png|svg\+xml)[^,]*,(R0lGODlhAQABA|iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB|%3Csvg)/i;
const JUNK_ALT = /^(image|img|photo|picture|pic|graphic|icon|logo|banner|untitled|placeholder|alt|alt text|image description|\d+|[\w-]+\.(jpe?g|png|gif|webp|svg|avif)|img[_-]?\d+|dsc[_-]?\d+|screenshot.*)$/i;
const LEGACY_IMAGE_TYPE = /image\/(jpeg|jpg|png|gif|bmp|tiff)/i;
const OVERSIZED_BYTES = 150 * 1024;

function parseSize(value?: string): [number, number] {
  const [w, h] = (value ?? "0x0").split("x").map(Number);
  return [w || 0, h || 0];
}

/** True when a base64 data URI is truncated or malformed. */
export function isBrokenDataUri(src: string): boolean {
  const match = src.match(/^data:([^;,]*)(;base64)?,(.*)$/is);
  if (!match) return true;
  const [, , isBase64, data] = match;
  if (!isBase64) return data.length === 0;
  const clean = data.replace(/\s/g, "");
  return clean.length < 16 || clean.length % 4 === 1 || !/^[A-Za-z0-9+/_-]*={0,2}$/.test(clean);
}

export async function mediaModule(ctx: AuditContext): Promise<CheckResult[]> {
  const broken: RawIssue[] = [];
  const placeholders: RawIssue[] = [];
  const lazy: RawIssue[] = [];
  const svgs: RawIssue[] = [];
  const alt: RawIssue[] = [];
  const oversized: RawIssue[] = [];

  for (const { $, url, snapshot } of ctx.pages) {
    $("img").each((_, el) => {
      const img = $(el);
      const src = (img.attr("src") ?? "").trim();
      const lazySrc = img.attr("data-src") ?? img.attr("data-lazy-src") ?? img.attr("data-original") ?? img.attr("data-srcset") ?? "";
      const current = img.attr("data-pa-current") ?? src;
      const state = img.attr("data-pa-state");
      const [natW, natH] = parseSize(img.attr("data-pa-natural"));
      const [renW, renH] = parseSize(img.attr("data-pa-rendered"));
      const tiny = img.attr("width") === "1" || img.attr("height") === "1" || (natW === 1 && natH === 1 && !lazySrc);
      if (tiny) return; // tracking pixel

      const label = (current || lazySrc || "(no src)").slice(0, 120);

      if (PLACEHOLDER_IMAGE.test(`${src} ${lazySrc} ${current}`)) {
        placeholders.push({ message: `Placeholder/stock-generator image: ${label}`, pageUrl: url, snippet: snippet($, el), severity: "critical" });
      }

      if (src.startsWith("data:") && !BLANK_SRC.test(src) && isBrokenDataUri(src)) {
        broken.push({ message: "Malformed Base64 image/icon (data URI is truncated or invalid)", pageUrl: url, snippet: snippet($, el), severity: "critical" });
      } else if (!src && !lazySrc && !img.attr("srcset")) {
        broken.push({ message: "Image has no src", pageUrl: url, snippet: snippet($, el), severity: "critical" });
      } else if (state === "broken") {
        broken.push({ message: `Image failed to load: ${label}`, pageUrl: url, snippet: snippet($, el), severity: "critical" });
      } else if (!ctx.rendered && src && !src.startsWith("data:")) {
        const target = resolveUrl(src, url);
        const status = target ? ctx.links.get(target.toString()) : undefined;
        if (status && !status.ok) broken.push({ message: `Image returns ${status.status || status.error}: ${label}`, pageUrl: url, snippet: snippet($, el), severity: "critical" });
      }

      // Lazy-loading that never swapped in the real image (checked after scrolling the page).
      if (ctx.rendered && lazySrc && (!current || BLANK_SRC.test(current)) && renW > 0) {
        lazy.push({ message: `Lazy-loaded image never rendered (still showing placeholder): ${lazySrc.slice(0, 100)}`, pageUrl: url, snippet: snippet($, el), severity: "critical" });
      }

      // Alt text
      const decorative = img.attr("role") === "presentation" || img.attr("aria-hidden") === "true";
      const altAttr = img.attr("alt");
      if (altAttr === undefined) {
        alt.push({ message: `Missing alt attribute: ${label}`, pageUrl: url, snippet: snippet($, el), severity: "warning" });
      } else if (!altAttr.trim() && !decorative) {
        alt.push({ message: `Empty alt="" (fine only if purely decorative): ${label}`, pageUrl: url, snippet: snippet($, el), severity: "warning" });
      } else if (JUNK_ALT.test(altAttr.trim())) {
        alt.push({ message: `Non-descriptive alt text "${altAttr.trim()}": ${label}`, pageUrl: url, snippet: snippet($, el), severity: "warning" });
      }

      // Oversized dimensions (2.5× bigger than rendered, and large in absolute terms)
      if (renW > 0 && natW > 1200 && natW > renW * 2.5) {
        oversized.push({ message: `Image is ${natW}×${natH}px but displayed at ${renW}×${renH}px: ${label}`, pageUrl: url, snippet: snippet($, el), severity: "warning" });
      }
    });

    $("svg").each((_, el) => {
      const svg = $(el);
      if (svg.closest("defs, symbol").length || svg.attr("aria-hidden") === "true" && svg.attr("data-pa-rendered") === "0x0") return;
      const drawable = svg.find("path, circle, rect, polygon, polyline, line, ellipse, use, image, text, g, foreignObject");
      const emptyPaths = svg.find("path").filter((_, p) => !($(p).attr("d") ?? "").trim()).length;
      const [w, h] = parseSize(svg.attr("data-pa-rendered"));
      if (drawable.length === 0 && (!ctx.rendered || w * h > 0)) {
        svgs.push({ message: "Inline SVG has no drawable content (empty icon placeholder)", pageUrl: url, snippet: snippet($, el), severity: "warning" });
      } else if (emptyPaths > 0 && emptyPaths === svg.find("path").length && svg.find("circle, rect, polygon, use, image, text").length === 0) {
        svgs.push({ message: "Inline SVG only contains empty <path d=\"\"> elements", pageUrl: url, snippet: snippet($, el), severity: "warning" });
      }
      const use = svg.find("use").attr("href") ?? svg.find("use").attr("xlink:href");
      if (use?.startsWith("#") && $(`[id="${use.slice(1).replace(/"/g, "")}"]`).length === 0) {
        svgs.push({ message: `SVG <use> references missing symbol ${use}`, pageUrl: url, snippet: snippet($, el), severity: "warning" });
      }
    });

    // Byte-heavy JPEG/PNG/GIF that should be WebP/AVIF (needs browser network data).
    for (const res of snapshot.resources) {
      if (res.type !== "image" || !LEGACY_IMAGE_TYPE.test(res.contentType) || res.bytes < OVERSIZED_BYTES) continue;
      oversized.push({
        message: `${Math.round(res.bytes / 1024)} KB ${res.contentType.split(";")[0].replace("image/", "").toUpperCase()} not served as WebP/AVIF: ${res.url.slice(0, 120)}`,
        pageUrl: url,
        severity: "warning",
      });
    }
  }

  return [
    buildCheck(
      {
        id: "media.broken-images",
        module: "media",
        label: "Broken images & Base64 icons",
        severity: "critical",
        passed: "Every image loaded successfully",
        recommendation: "Re-upload missing media to the media library and update the image references; regenerate truncated Base64 icons as SVG files.",
      },
      broken,
    ),
    buildCheck(
      {
        id: "media.placeholder-images",
        module: "media",
        label: "Placeholder & dummy images",
        severity: "critical",
        passed: "No placeholder-service or dummy images found",
        recommendation: "Replace placeholder images with real photos of the practice, team and office.",
      },
      placeholders,
    ),
    buildCheck(
      {
        id: "media.lazy-load",
        module: "media",
        label: "Lazy-loaded images",
        severity: "critical",
        passed: ctx.rendered ? "All lazy-loaded images rendered after scrolling" : "Skipped — requires the browser renderer",
        recommendation: "Fix the lazy-load plugin/script (or switch to native loading=\"lazy\") so real images replace the placeholders.",
      },
      lazy,
    ),
    buildCheck(
      {
        id: "media.svg",
        module: "media",
        label: "SVG icons",
        severity: "warning",
        passed: "Inline SVG icons contain drawable content",
        recommendation: "Replace empty SVG placeholders with the intended icon markup or an icon file.",
      },
      svgs,
    ),
    buildCheck(
      {
        id: "media.alt-text",
        module: "media",
        label: "Image alt text",
        severity: "warning",
        passed: "All images have descriptive alt text",
        recommendation: "Add descriptive alt text (e.g. \"Dr. Patel explaining Invisalign to a patient\"). Use alt=\"\" only for purely decorative images.",
        summary: (i) => `${i.length} image${i.length === 1 ? "" : "s"} with missing, empty or generic alt text`,
      },
      alt,
    ),
    buildCheck(
      {
        id: "media.next-gen",
        module: "media",
        label: "Image weight & next-gen formats",
        severity: "warning",
        passed: ctx.rendered ? "No oversized JPEG/PNG images detected" : "Byte sizes require the browser renderer — dimensions not checked",
        recommendation: "Serve images as WebP/AVIF, resized to their display size (e.g. via an image optimisation plugin or Webflow's responsive images).",
      },
      oversized,
    ),
  ];
}
