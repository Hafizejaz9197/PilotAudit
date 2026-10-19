import type { AnyNode } from "domhandler";
import type { CheckResult } from "../../types";
import { buildCheck, elementText, snippet, type AuditContext, type RawIssue } from "../context";
import { resolveUrl } from "../url";

const CTA_PATTERN =
  /\b(book|booking|schedule|contact|call|appointment|request|consult(ation)?|reserve|get started|new patients?|text us|free exam|sign up)\b/i;
const PHONE_IN_TEXT = /(?:\+?1[\s.-]?)?\(?\b[2-9]\d{2}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g;
const LOOKS_LIKE_PHONE = new RegExp(PHONE_IN_TEXT.source);
const PLACEHOLDER_HREF = /^(#|#\/|#!|javascript:\s*(void\(0\);?|;|)|about:.*|undefined|null)$/i;
const POPUP_ATTRS = ["data-toggle", "data-bs-toggle", "data-target", "data-bs-target", "aria-controls", "data-fancybox", "data-popup", "data-modal", "data-micromodal-trigger", "data-elementor-open-lightbox"];

const BOOKING_PROVIDERS: [RegExp, string][] = [
  [/calendly\.com/i, "Calendly"],
  [/nexhealth/i, "NexHealth"],
  [/zocdoc/i, "Zocdoc"],
  [/localmed/i, "LocalMed"],
  [/flexbook|flex\.dental/i, "Flex"],
  [/lighthouse360|lh360/i, "Lighthouse 360"],
  [/solutionreach/i, "Solutionreach"],
  [/weave/i, "Weave"],
  [/modento/i, "Modento"],
  [/acuityscheduling/i, "Acuity"],
  [/setmore/i, "Setmore"],
  [/squareup\.com\/appointments/i, "Square Appointments"],
  [/yourdentistnow|opencare/i, "Opencare"],
  [/jotform/i, "Jotform"],
  [/typeform/i, "Typeform"],
  [/hubspot|hsforms/i, "HubSpot Forms"],
  [/forms\.gle|docs\.google\.com\/forms/i, "Google Forms"],
];

export function digitsOf(value: string): string {
  return value.replace(/[^\d]/g, "");
}

/** Last 10 digits for NANP comparisons (strips a leading country code). */
export function phoneKey(value: string): string {
  const d = digitsOf(value);
  return d.length === 11 && d.startsWith("1") ? d.slice(1) : d;
}

export function isPlaceholderPhone(value: string): boolean {
  const d = phoneKey(value);
  return (
    /^\d{3}555(01\d\d|5555)$/.test(d) ||
    /^(\d)\1{9}$/.test(d) ||
    d === "1234567890" ||
    d === "0123456789" ||
    /^555\d{7}$/.test(d)
  );
}

/** Classifies a tel: href. Returns null when valid, otherwise a problem description. */
export function telProblem(href: string): { level: "critical" | "warning"; message: string } | null {
  const value = decodeSafe(href.replace(/^tel:/i, ""));
  if (/[a-z]/i.test(value.replace(/^\+/, "").replace(/;?(ext|x|p|w)=?\d*$/i, ""))) {
    return { level: "critical", message: `tel: link contains letters ("${value}")` };
  }
  const digits = digitsOf(value);
  if (digits.length < 7) return { level: "critical", message: `tel: link has too few digits ("${value || "empty"}")` };
  if (digits.length > 15) return { level: "critical", message: `tel: link has too many digits ("${value}")` };
  if (isPlaceholderPhone(value)) return { level: "critical", message: `tel: link uses a placeholder/fictional number (${value})` };
  if (/\s/.test(value)) return { level: "warning", message: `tel: link contains spaces ("${value}") — use tel:+1XXXXXXXXXX` };
  if (!value.startsWith("+") && digits.length === 10) {
    return { level: "warning", message: `tel: link missing country code ("${value}") — prefer E.164 (tel:+1${digits})` };
  }
  return null;
}

function decodeSafe(value: string): string {
  try {
    return decodeURIComponent(value).trim();
  } catch {
    return value.trim();
  }
}

export async function conversionModule(ctx: AuditContext): Promise<CheckResult[]> {
  const telInvalid: RawIssue[] = [];
  const telFormat: RawIssue[] = [];
  const telPlain: RawIssue[] = [];
  const ctaPlaceholder: RawIssue[] = [];
  const ctaDestination: RawIssue[] = [];
  const formEndpoint: RawIssue[] = [];
  const formStructure: RawIssue[] = [];
  const widgets: RawIssue[] = [];
  const phonesSeen = new Map<string, { display: string; pages: Set<string> }>();
  const providers = new Set<string>();
  let leadCaptureFound = false;
  // Elements already reported as dead phone links aren't reported again as CTAs.
  const reported = new Set<AnyNode>();

  const notePhone = (raw: string, page: string) => {
    const key = phoneKey(raw);
    if (key.length !== 10 || isPlaceholderPhone(raw)) return;
    const entry = phonesSeen.get(key) ?? { display: raw.trim(), pages: new Set<string>() };
    entry.pages.add(page);
    phonesSeen.set(key, entry);
  };

  for (const page of ctx.pages) {
    const { $, url } = page;

    // --- Phone links ---------------------------------------------------------
    $("a").each((_, el) => {
      const a = $(el);
      const href = (a.attr("href") ?? "").trim();
      const text = elementText($, el);
      const looksLikePhone = LOOKS_LIKE_PHONE.test(text) || /\b(call|phone)\b/i.test(text + " " + (a.attr("class") ?? ""));

      if (/^tel:/i.test(href)) {
        notePhone(href.slice(4), url);
        const problem = telProblem(href);
        if (problem) (problem.level === "critical" ? telInvalid : telFormat).push({ message: problem.message, pageUrl: url, snippet: snippet($, el), severity: problem.level });
        return;
      }
      if (!looksLikePhone) return;
      if (/^(about:|javascript:|#|$)/i.test(href) || /^(tell|tel;|tel\/|phone:|call:)/i.test(href)) {
        reported.add(el);
        telInvalid.push({ message: `Phone link has invalid protocol: href="${href || "(empty)"}"`, pageUrl: url, snippet: snippet($, el), severity: "critical" });
      } else if (/^[+()\d][\d\s().-]{6,}$/.test(href)) {
        reported.add(el);
        telInvalid.push({ message: `Phone link is missing the tel: prefix: href="${href}"`, pageUrl: url, snippet: snippet($, el), severity: "critical" });
      } else if (/^callto:/i.test(href)) {
        telFormat.push({ message: `Uses legacy callto: protocol instead of tel:`, pageUrl: url, snippet: snippet($, el), severity: "warning" });
      }
    });

    // Phone numbers visible as plain text (not tap-to-call).
    const body = $("body").clone();
    body.find("a, script, style, noscript, template, input, textarea, select").remove();
    const plainText = body.text().replace(/\s+/g, " ");
    const seenOnPage = new Set<string>();
    for (const match of plainText.matchAll(PHONE_IN_TEXT)) {
      const key = phoneKey(match[0]);
      if (key.length !== 10 || seenOnPage.has(key)) continue;
      seenOnPage.add(key);
      notePhone(match[0], url);
      if (isPlaceholderPhone(match[0])) continue; // reported by the content module
      telPlain.push({ message: `Phone number ${match[0].trim()} is plain text, not a tap-to-call link`, pageUrl: url, severity: "warning" });
    }

    // --- CTA buttons ---------------------------------------------------------
    $("a, button, [role=button], input[type=submit], input[type=button]").each((_, el) => {
      const node = $(el);
      const text = elementText($, el);
      if (reported.has(el) || !CTA_PATTERN.test(text) || text.length > 80) return;
      const tag = el.type === "tag" ? el.name : "";
      const handler = node.attr("data-pa-click") ?? (node.attr("onclick") ? "direct" : "");
      const popup = POPUP_ATTRS.some((attr) => node.attr(attr) !== undefined);
      const label = `"${text.slice(0, 50)}"`;

      if (tag === "a") {
        const href = (node.attr("href") ?? "").trim();
        if (/^tel:/i.test(href)) return; // covered by phone checks
        if (node.attr("href") === undefined || href === "" || PLACEHOLDER_HREF.test(href)) {
          const shown = node.attr("href") === undefined ? "no href" : `href="${href}"`;
          if (handler === "direct" || popup) {
            ctaPlaceholder.push({ message: `CTA ${label} uses ${shown} but has a JavaScript handler — verify it opens the booking flow`, pageUrl: url, snippet: snippet($, el), severity: "warning" });
          } else {
            ctaPlaceholder.push({ message: `CTA ${label} has a placeholder link (${shown})`, pageUrl: url, snippet: snippet($, el), severity: "critical" });
          }
          return;
        }
        if (href.startsWith("#")) {
          const id = href.slice(1).replace(/^\//, "");
          if (id && $(`[id="${id.replace(/"/g, "")}"], [name="${id.replace(/"/g, "")}"]`).length === 0 && handler !== "direct" && !popup) {
            ctaPlaceholder.push({ message: `CTA ${label} points to #${id}, but no element with that id exists on the page`, pageUrl: url, snippet: snippet($, el), severity: "warning" });
          }
          return;
        }
        const target = resolveUrl(href, url);
        if (!target || !/^https?:$/.test(target.protocol)) return;
        target.hash = "";
        const status = ctx.links.get(target.toString());
        if (status && !status.ok) {
          ctaDestination.push({
            message: `CTA ${label} links to ${target.toString()} which returns ${status.status || status.error || "an error"}`,
            pageUrl: url,
            snippet: snippet($, el),
            severity: "critical",
          });
        }
        return;
      }

      // <button>, role=button, input buttons
      const inForm = node.closest("form").length > 0;
      const type = (node.attr("type") ?? (tag === "button" ? "submit" : "")).toLowerCase();
      if (inForm && type === "submit") return;
      if (handler === "direct" || popup || node.closest("a[href]").length > 0) return;
      if (!ctx.rendered) {
        ctaPlaceholder.push({ message: `CTA button ${label} has no link, form or inline handler (static scan — verify manually)`, pageUrl: url, snippet: snippet($, el), severity: "warning" });
      } else if (handler === "delegated") {
        return; // a document-level listener may handle it; can't tell for sure
      } else {
        ctaPlaceholder.push({ message: `CTA button ${label} does nothing — no link, form or click handler attached`, pageUrl: url, snippet: snippet($, el), severity: "critical" });
      }
    });

    // --- Forms ---------------------------------------------------------------
    $("form").each((_, el) => {
      const form = $(el);
      const fields = form.find("input:not([type=hidden]):not([type=submit]):not([type=button]), textarea, select");
      if (fields.length === 0) return;
      const isSearch = (form.attr("role") ?? "") === "search" || form.find("input[type=search], input[name=s]").length > 0 && fields.length <= 2;
      if (isSearch) return;
      leadCaptureFound = true;

      const action = (form.attr("action") ?? "").trim();
      if (action && !action.startsWith("#") && !/^javascript:/i.test(action)) {
        const target = resolveUrl(action, url);
        if (target && /^https?:$/.test(target.protocol)) {
          target.hash = "";
          const status = ctx.links.get(target.toString());
          if (status && isDeadEndpoint(status.status)) {
            formEndpoint.push({ message: `Form submits to ${target.toString()} which returns ${status.status || status.error}`, pageUrl: url, snippet: snippet($, el, 140), severity: "critical" });
          }
        }
      } else if (/^javascript:/i.test(action) && form.attr("data-pa-click") !== "direct") {
        formEndpoint.push({ message: `Form action is "${action}" with no submit handler attached`, pageUrl: url, snippet: snippet($, el, 140), severity: ctx.rendered ? "critical" : "warning" });
      }

      const hasSubmit = form.find("button:not([type=button]):not([type=reset]), input[type=submit], input[type=image], [role=button]").length > 0;
      if (!hasSubmit) formStructure.push({ message: "Form has no submit button", pageUrl: url, snippet: snippet($, el, 140), severity: "warning" });
      const handled = form.attr("data-pa-click") === "direct" || form.find("[data-pa-click=direct]").length > 0;
      const unnamed = fields.filter((_, f) => !$(f).attr("name") && !$(f).attr("id")).length;
      if (unnamed > 0 && !handled) {
        formStructure.push({ message: `${unnamed} form field(s) have no name attribute — their values won't be submitted`, pageUrl: url, snippet: snippet($, el, 140), severity: "warning" });
      }
    });

    // --- iFrames & booking widgets -------------------------------------------
    $("iframe").each((_, el) => {
      const node = $(el);
      const src = (node.attr("src") ?? node.attr("data-src") ?? "").trim();
      for (const [pattern, name] of BOOKING_PROVIDERS) if (pattern.test(src)) providers.add(name);
      const isWidget = BOOKING_PROVIDERS.some(([p]) => p.test(src)) || /book|appoint|schedul|form|contact/i.test(src + (node.attr("title") ?? ""));
      if (isWidget) leadCaptureFound = true;
      if (!src || src === "about:blank") {
        if (isWidget || /book|form|schedul/i.test(node.attr("title") ?? "")) {
          widgets.push({ message: "Embedded widget iframe has an empty src", pageUrl: url, snippet: snippet($, el), severity: "critical" });
        }
        return;
      }
      const target = resolveUrl(src, url);
      if (!target || !/^https?:$/.test(target.protocol)) return;
      target.hash = "";
      const status = ctx.links.get(target.toString());
      if (status && isDeadEndpoint(status.status)) {
        widgets.push({ message: `Embedded iframe ${target.host}${target.pathname} returns ${status.status || status.error}`, pageUrl: url, snippet: snippet($, el), severity: isWidget ? "critical" : "warning" });
      }
    });

    // Script-injected booking widgets (no iframe in the DOM yet).
    $("script[src]").each((_, el) => {
      const src = $(el).attr("src") ?? "";
      for (const [pattern, name] of BOOKING_PROVIDERS) {
        if (pattern.test(src)) {
          providers.add(name);
          leadCaptureFound = true;
        }
      }
    });
    if ($('a[href*="calendly.com"], a[href*="zocdoc.com"], a[href*="nexhealth"], a[href*="localmed"]').length > 0) leadCaptureFound = true;
  }

  const leadCapture: RawIssue[] = leadCaptureFound
    ? []
    : [{ message: "No contact form or booking widget found on any scanned page", pageUrl: ctx.root.toString(), severity: "critical" }];

  const multiplePhones: RawIssue[] = [];
  if (phonesSeen.size > 1) {
    const list = [...phonesSeen.values()].map((p) => `${p.display} (${p.pages.size} page${p.pages.size === 1 ? "" : "s"})`).join(", ");
    multiplePhones.push({
      message: `${phonesSeen.size} different phone numbers appear across the site: ${list}. Confirm each is real — AI copy often invents numbers.`,
      pageUrl: ctx.root.toString(),
      severity: "warning",
    });
  }

  const providerNote = providers.size ? ` (detected: ${[...providers].join(", ")})` : "";

  return [
    buildCheck(
      {
        id: "conversion.tel-invalid",
        module: "conversion",
        label: "Phone links (tel: protocol)",
        severity: "critical",
        passed: "All phone links use a valid tel: protocol",
        recommendation: 'Rewrite every phone link as <a href="tel:+1XXXXXXXXXX">. "about:invalid" means the page builder rejected the URL — re-enter it as tel:.',
        summary: (i) => `${i.length} dead or invalid phone link${i.length === 1 ? "" : "s"}`,
      },
      telInvalid,
    ),
    buildCheck(
      {
        id: "conversion.tel-format",
        module: "conversion",
        label: "Phone number formatting",
        severity: "warning",
        passed: "Phone links are E.164 formatted",
        recommendation: "Format tel: links as E.164 (tel:+15125550123) without spaces so every dialer parses them.",
      },
      telFormat,
    ),
    buildCheck(
      {
        id: "conversion.tel-plain",
        module: "conversion",
        label: "Tap-to-call coverage",
        severity: "warning",
        passed: "Every displayed phone number is tap-to-call",
        recommendation: "Wrap displayed phone numbers in tel: links so mobile visitors can call in one tap.",
      },
      telPlain,
    ),
    buildCheck(
      {
        id: "conversion.phone-consistency",
        module: "conversion",
        label: "Phone number consistency",
        severity: "warning",
        passed: phonesSeen.size === 1 ? `One consistent phone number used site-wide (${[...phonesSeen.values()][0].display})` : "No conflicting phone numbers found",
        recommendation: "Verify every number with the practice and replace any that don't match their Google Business Profile.",
        summary: () => `${phonesSeen.size} different phone numbers found`,
      },
      multiplePhones,
    ),
    buildCheck(
      {
        id: "conversion.cta-placeholder",
        module: "conversion",
        label: "CTA buttons (Book / Schedule / Contact / Call)",
        severity: "critical",
        passed: "All CTA buttons link to a real destination",
        recommendation: "Point every Book/Schedule/Contact CTA at the booking page or widget URL. Replace href=\"#\" and javascript:void(0) placeholders.",
        summary: (i) => `${i.filter((x) => x.severity === "critical").length} broken CTA${i.length === 1 ? "" : "s"}, ${i.filter((x) => x.severity === "warning").length} to verify`,
      },
      ctaPlaceholder,
    ),
    buildCheck(
      {
        id: "conversion.cta-destination",
        module: "conversion",
        label: "CTA destination pages",
        severity: "critical",
        passed: "Every CTA destination loads successfully",
        recommendation: "Fix or redirect the destination pages, or update the CTA links to the correct URL.",
      },
      ctaDestination,
    ),
    buildCheck(
      {
        id: "conversion.lead-capture",
        module: "conversion",
        label: "Lead capture (forms & booking widgets)",
        severity: "critical",
        passed: `Lead capture found${providerNote}`,
        recommendation: "Add a contact form or online booking widget to the Contact / Book Appointment page.",
      },
      leadCapture,
    ),
    buildCheck(
      {
        id: "conversion.form-endpoints",
        module: "conversion",
        label: "Form & iframe endpoints",
        severity: "critical",
        passed: "Form actions and embedded widgets respond without 403/404 errors",
        recommendation: "Reconnect the form to a working endpoint (re-save the form plugin / check the Webflow form settings) and re-test a submission.",
      },
      [...formEndpoint, ...widgets],
    ),
    buildCheck(
      {
        id: "conversion.form-structure",
        module: "conversion",
        label: "Form structure",
        severity: "warning",
        passed: "Forms have submit buttons and named fields",
        recommendation: "Give every field a name attribute and ensure each form has a submit button.",
      },
      formStructure,
    ),
  ];
}

function isDeadEndpoint(status: number): boolean {
  return status === 0 || status === 403 || status === 404 || status === 410 || status >= 500;
}
