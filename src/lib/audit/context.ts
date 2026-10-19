import type { CheerioAPI } from "cheerio";
import type { AnyNode } from "domhandler";
import type { CheckResult, Issue, LinkStatus, ModuleId, ScanMode } from "../types";
import type { MobileMetrics, PageSnapshot } from "./browser";

export interface AnalyzedPage {
  url: string;
  snapshot: PageSnapshot;
  $: CheerioAPI;
}

export interface AuditContext {
  root: URL;
  mode: ScanMode;
  rendered: boolean;
  pages: AnalyzedPage[];
  /** Link status keyed by absolute URL (without hash). */
  links: Map<string, LinkStatus>;
  mobile: MobileMetrics[];
}

export type RawIssue = Omit<Issue, "pages" | "severity"> & { severity?: Issue["severity"] };

export interface CheckDef {
  id: string;
  module: ModuleId;
  label: string;
  /** Severity for issues that don't specify their own. */
  severity: Issue["severity"];
  passed: string;
  recommendation: string;
  /** Builds the summary line from the merged issues; defaults to a count. */
  summary?: (issues: Issue[]) => string;
}

const MAX_ISSUES_PER_CHECK = 60;

/** Merges duplicate issues (same message + snippet on many pages) and derives the check's severity. */
export function buildCheck(def: CheckDef, raw: RawIssue[]): CheckResult {
  const merged = new Map<string, Issue>();
  for (const r of raw) {
    const key = `${r.message}\u0000${r.snippet ?? ""}`;
    const existing = merged.get(key);
    if (existing) {
      if (!existing.pages.includes(r.pageUrl)) existing.pages.push(r.pageUrl);
      if (r.severity === "critical") existing.severity = "critical";
    } else {
      merged.set(key, { ...r, pages: [r.pageUrl], severity: r.severity ?? def.severity });
    }
  }
  const issues = [...merged.values()].sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "critical" ? -1 : 1));
  if (issues.length === 0) {
    return { id: def.id, module: def.module, label: def.label, severity: "passed", summary: def.passed, recommendation: "", issues: [] };
  }
  const severity = issues.some((i) => i.severity === "critical") ? "critical" : "warning";
  const summary = def.summary?.(issues) ?? `${issues.length} issue${issues.length === 1 ? "" : "s"} found`;
  return {
    id: def.id,
    module: def.module,
    label: def.label,
    severity,
    summary,
    recommendation: def.recommendation,
    issues: issues.slice(0, MAX_ISSUES_PER_CHECK),
  };
}

/** Outer HTML of an element, trimmed for display, without PilotAudit's own annotations. */
export function snippet($: CheerioAPI, el: AnyNode, max = 180): string {
  const html = ($.html(el) ?? "")
    .replace(/\sdata-pa-[a-z]+="[^"]*"/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return html.length > max ? `${html.slice(0, max - 1)}…` : html;
}

/** Visible-ish text of the page body (scripts, styles and templates removed). */
export function bodyText($: CheerioAPI): string {
  const body = $("body").clone();
  body.find("script, style, noscript, template, svg").remove();
  return body.text().replace(/\s+/g, " ").trim();
}

export function elementText($: CheerioAPI, el: AnyNode): string {
  const node = $(el);
  return [node.text(), node.attr("aria-label"), node.attr("value"), node.attr("title")]
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

export function contextAround(text: string, index: number, length: number, radius = 50): string {
  const start = Math.max(0, index - radius);
  const end = Math.min(text.length, index + length + radius);
  return `${start > 0 ? "…" : ""}${text.slice(start, end)}${end < text.length ? "…" : ""}`;
}

export function linkKey(url: URL): string {
  const u = new URL(url.toString());
  u.hash = "";
  return u.toString();
}
