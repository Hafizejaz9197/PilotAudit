import type { CheerioAPI } from "cheerio";
import type { AnyNode } from "domhandler";
import type { CheckResult } from "../../types";
import { bodyText, buildCheck, contextAround, snippet, type AuditContext, type RawIssue } from "../context";

interface Pattern {
  re: RegExp;
  label: string;
}

const DUMMY_TEXT: Pattern[] = [
  { re: /\blorem ipsum\b/gi, label: "Lorem Ipsum" },
  { re: /\bdolor sit amet\b/gi, label: "Lorem Ipsum" },
  { re: /\bconsectetur adipiscing\b/gi, label: "Lorem Ipsum" },
  { re: /\[(?:insert|your|add|enter|placeholder|phone|address|name|city|state|zip|practice|doctor|dr\.?|company|business|email|location|clinic|office|service|date|link|url|number|title)[^\]\n]{0,40}\]/gi, label: "Bracketed placeholder" },
  { re: /\{\{\s*[\w.\s-]{1,40}\s*\}\}/g, label: "Unrendered template variable" },
  { re: /%%[\w-]{2,30}%%/g, label: "Unrendered template variable" },
  { re: /\b(?:sample|dummy|filler|placeholder) (?:text|content|copy|heading|title)\b/gi, label: "Placeholder copy" },
  { re: /\b(?:insert|add|enter|type|write) (?:your )?(?:text|content|copy|description|heading|title) here\b/gi, label: "Placeholder copy" },
  { re: /\bTODO\b|\bTBD\b|\bFIXME\b/g, label: "Developer TODO" },
];

const TEMPLATE_DEFAULTS: Pattern[] = [
  { re: /just another wordpress site/gi, label: "WordPress default tagline" },
  { re: /\bhello world!/gi, label: "WordPress default post" },
  { re: /\bsample page\b/gi, label: "WordPress default page" },
  { re: /this is some text inside of a div block/gi, label: "Webflow default text" },
  { re: /add your heading text here/gi, label: "Elementor default heading" },
  { re: /click edit button to change this text/gi, label: "Elementor default text" },
  { re: /i am (?:a )?text block/gi, label: "Elementor default text" },
  { re: /your (?:title|content) goes here/gi, label: "Divi default text" },
  { re: /\bwelcome to (?:your|my) (?:new )?(?:site|website|blog)\b/gi, label: "Builder default welcome text" },
  { re: /\byour (?:company|business|practice|clinic) name\b/gi, label: "Template business name" },
  { re: /\bcompany name\b/gi, label: "Template business name" },
];

const PLACEHOLDER_PEOPLE_CONTACT: Pattern[] = [
  { re: /\bdr\.?\s+(?:john|jane) doe\b/gi, label: "Generic doctor placeholder" },
  { re: /\bdr\.?\s+(?:first ?name|last ?name|name|surname|lorem|placeholder|x{2,})\b/gi, label: "Generic doctor placeholder" },
  { re: /\bdoctor name\b|\bdentist name\b|\bteam member name\b/gi, label: "Generic doctor placeholder" },
  { re: /\b(?:john|jane) (?:doe|smith)\b/gi, label: "Placeholder person name" },
  { re: /\b[\w.+-]+@(?:example|domain|yourdomain|yoursite|email|test|website|company)\.(?:com|org|net)\b/gi, label: "Placeholder email" },
  { re: /\b(?:your|my|name)@[\w-]+\.\w+\b/gi, label: "Placeholder email" },
  { re: /\b123 (?:main|any|fake|sample) (?:st(?:reet)?|ave(?:nue)?|road|rd)\b/gi, label: "Placeholder address" },
  { re: /\banytown\b|\bcity,\s*state\s*\d{0,5}\b|\bcity,\s*st\s+12345\b/gi, label: "Placeholder address" },
  { re: /\(?\b(?:555|000|123)\)?[\s.-]?(?:555|456|000)[\s.-]?(?:5555|7890|0000|01\d\d)\b/g, label: "Placeholder phone number" },
  { re: /\b(?:xxx|XXX)[\s.-]?(?:xxx|XXX)[\s.-]?(?:xxxx|XXXX)\b/g, label: "Placeholder phone number" },
];

const AI_ARTIFACTS: Pattern[] = [
  { re: /\bas an ai(?: language model)?\b/gi, label: "AI assistant disclaimer" },
  { re: /\bi(?:'m| am) (?:sorry|unable),? but i (?:can(?:'|no)t|am unable)\b/gi, label: "AI refusal text" },
  { re: /\bcertainly! here(?:'s| is)\b/gi, label: "AI chat preamble" },
  { re: /\bhere(?:'s| is) (?:a|an|the) (?:revised|rewritten|updated|draft|sample|seo-optimized) (?:version|copy|paragraph|text|content|section)\b/gi, label: "AI chat preamble" },
  { re: /\bi hope this helps\b/gi, label: "AI chat sign-off" },
  { re: /\bregenerate response\b/gi, label: "Copied chat UI text" },
  { re: /\bknowledge cutoff\b/gi, label: "AI assistant disclaimer" },
  { re: /\[note:[^\]]{0,80}\]/gi, label: "AI editorial note" },
];

const GENERIC_COPY = [
  "in today's fast-paced world",
  "look no further",
  "unlock the",
  "elevate your",
  "embark on",
  "delve into",
  "a testament to",
  "tapestry",
  "seamless",
  "state-of-the-art",
  "cutting-edge",
  "top-notch",
  "second to none",
  "one-stop shop",
  "we pride ourselves",
  "smile of your dreams",
  "dive into",
  "navigate the complexities",
  "rest assured",
  "nestled in",
  "world-class",
  "game-changer",
  "whether you're looking",
];

/** Text sources that should never contain placeholders: body copy plus head metadata and alt text. */
function pageCorpus($: CheerioAPI): { text: string; source: string }[] {
  const items: { text: string; source: string }[] = [{ text: bodyText($), source: "page copy" }];
  const title = $("title").first().text().trim();
  if (title) items.push({ text: title, source: "meta title" });
  $('meta[name="description"], meta[property^="og:"], meta[name^="twitter:"]').each((_, el) => {
    const content = $(el).attr("content");
    if (content) items.push({ text: content, source: `meta ${$(el).attr("name") ?? $(el).attr("property")}` });
  });
  $("img[alt]").each((_, el) => {
    const alt = $(el).attr("alt");
    if (alt) items.push({ text: alt, source: "image alt text" });
  });
  return items;
}

function scan(patterns: Pattern[], corpus: { text: string; source: string }[], pageUrl: string, severity: "critical" | "warning"): RawIssue[] {
  const issues: RawIssue[] = [];
  for (const { text, source } of corpus) {
    for (const { re, label } of patterns) {
      re.lastIndex = 0;
      let count = 0;
      for (const match of text.matchAll(re)) {
        if (++count > 3) break;
        issues.push({
          message: `${label}: "${match[0]}" found in ${source}`,
          pageUrl,
          snippet: contextAround(text, match.index ?? 0, match[0].length),
          severity,
        });
      }
    }
  }
  return issues;
}

export async function contentModule(ctx: AuditContext): Promise<CheckResult[]> {
  const dummy: RawIssue[] = [];
  const templates: RawIssue[] = [];
  const people: RawIssue[] = [];
  const ai: RawIssue[] = [];
  const generic: RawIssue[] = [];
  const services: RawIssue[] = [];
  const copyright: RawIssue[] = [];
  const year = new Date().getFullYear();

  for (const { $, url } of ctx.pages) {
    const corpus = pageCorpus($);
    dummy.push(...scan(DUMMY_TEXT, corpus, url, "critical"));
    templates.push(...scan(TEMPLATE_DEFAULTS, corpus, url, "critical"));
    people.push(...scan(PLACEHOLDER_PEOPLE_CONTACT, corpus, url, "critical"));
    ai.push(...scan(AI_ARTIFACTS, corpus, url, "critical"));

    const text = corpus[0].text.toLowerCase();
    const hits = GENERIC_COPY.map((phrase) => ({ phrase, n: text.split(phrase).length - 1 })).filter((h) => h.n > 0);
    const total = hits.reduce((sum, h) => sum + h.n, 0);
    if (total >= 5) {
      generic.push({
        message: `${total} generic AI-style marketing phrases on this page`,
        pageUrl: url,
        snippet: hits.map((h) => `"${h.phrase}"${h.n > 1 ? ` ×${h.n}` : ""}`).join(", "),
        severity: "warning",
      });
    }

    const footer = $("footer").text() || corpus[0].text.slice(-600);
    const match = footer.match(/(?:©|&copy;|copyright)\s*(?:\d{4}\s*[-–]\s*)?(\d{4})/i);
    if (match && Number(match[1]) < year - 1) {
      copyright.push({ message: `Footer copyright year is ${match[1]}`, pageUrl: url, snippet: match[0], severity: "warning" });
    }

    services.push(...serviceSectionIssues($, url));
  }

  return [
    buildCheck(
      {
        id: "content.dummy-text",
        module: "content",
        label: "Placeholder & dummy text",
        severity: "critical",
        passed: "No Lorem Ipsum, [Insert …] tokens or template variables found",
        recommendation: "Replace every placeholder with final, practice-approved copy before the site goes live.",
      },
      dummy,
    ),
    buildCheck(
      {
        id: "content.template-defaults",
        module: "content",
        label: "Page-builder template leftovers",
        severity: "critical",
        passed: "No WordPress, Webflow, Elementor or Divi default text found",
        recommendation: "Edit or delete the default theme/builder blocks listed here.",
      },
      templates,
    ),
    buildCheck(
      {
        id: "content.placeholder-people",
        module: "content",
        label: "Generic doctor & contact placeholders",
        severity: "critical",
        passed: "No placeholder doctor names, emails, addresses or phone numbers",
        recommendation: "Swap placeholder names, emails, addresses and 555 numbers for the practice's real details (match the Google Business Profile).",
      },
      people,
    ),
    buildCheck(
      {
        id: "content.ai-artifacts",
        module: "content",
        label: "AI chat artifacts",
        severity: "critical",
        passed: "No copied AI-assistant phrases (\"As an AI…\", \"Certainly! Here's…\")",
        recommendation: "Remove text pasted from the AI chat (preambles, disclaimers, editorial notes).",
      },
      ai,
    ),
    buildCheck(
      {
        id: "content.generic-copy",
        module: "content",
        label: "Generic AI-style copy",
        severity: "warning",
        passed: "Copy reads specific — few generic AI marketing clichés",
        recommendation: "Rewrite cliché-heavy sections with specifics: doctor names, technologies, insurance accepted, neighbourhood.",
      },
      generic,
    ),
    buildCheck(
      {
        id: "content.service-links",
        module: "content",
        label: "Service section links",
        severity: "warning",
        passed: "Service cards and lists link to their landing pages",
        recommendation: "Link each service card/list item to its own sub-service page (e.g. /services/dental-implants) — unlinked services lose SEO value and leads.",
      },
      services,
    ),
    buildCheck(
      {
        id: "content.copyright",
        module: "content",
        label: "Copyright year",
        severity: "warning",
        passed: "Footer copyright year is current",
        recommendation: "Update the footer to the current year (or render it dynamically).",
      },
      copyright,
    ),
  ];
}

const SERVICE_SECTION = /\b(services?|treatments?|procedures?|what we offer|our care|specialt(y|ies))\b/i;

/** Finds service cards/list items that don't link anywhere. */
function serviceSectionIssues($: CheerioAPI, url: string): RawIssue[] {
  const issues: RawIssue[] = [];
  const containers = new Set<AnyNode>();
  $("section, div, ul").each((_, el) => {
    const node = $(el);
    if (node.closest("nav, header, footer, [role=navigation]").length) return;
    const marker = `${node.attr("id") ?? ""} ${node.attr("class") ?? ""}`;
    const heading = node.children("h1, h2, h3").first().text() || node.find("> div > h2, > div > h3").first().text();
    if ((/\b(services?|treatments?|procedures?)\b/i.test(marker) && !/\b(service-?worker)\b/i.test(marker)) || SERVICE_SECTION.test(heading)) {
      // Keep only the outermost matching container.
      if (node.parents().toArray().some((p) => containers.has(p))) return;
      containers.add(el);
    }
  });

  for (const container of containers) {
    const node = $(container);
    const seen = new Set<string>();
    node.find("li").each((_, li) => {
      const item = $(li);
      const text = item.text().replace(/\s+/g, " ").trim();
      if (!text || text.length > 60 || item.find("a[href]").length || item.closest("a[href]").length || item.find("ul, ol").length) return;
      if (seen.has(text)) return;
      seen.add(text);
      issues.push({ message: `Service list item "${text}" is not linked to a landing page`, pageUrl: url, snippet: snippet($, li), severity: "warning" });
    });
    // Card pattern: an element with a heading but no link anywhere in the card.
    node.find("h3, h4").each((_, h) => {
      const heading = $(h);
      const card = heading.parent();
      const title = heading.text().replace(/\s+/g, " ").trim();
      if (!title || title.length > 60 || seen.has(title)) return;
      if (heading.closest("a[href]").length || card.find("a[href]").length || card.closest("a[href]").length) return;
      if (card.find("p").length === 0 && card.find("img, svg, i").length === 0) return;
      seen.add(title);
      issues.push({ message: `Service card "${title}" has no link to a sub-service page`, pageUrl: url, snippet: snippet($, card[0], 160), severity: "warning" });
    });
  }
  return issues.slice(0, 25);
}
