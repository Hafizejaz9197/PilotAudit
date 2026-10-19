export type ScanMode = "quick" | "full";

export type Severity = "critical" | "warning" | "passed";

export type ModuleId = "conversion" | "content" | "media" | "seo" | "mobile";

export const MODULES: Record<ModuleId, { label: string; letter: string; description: string }> = {
  conversion: {
    label: "Conversion & Interactive Elements",
    letter: "A",
    description: "Phone links, CTA buttons, lead forms and booking widgets",
  },
  content: {
    label: "AI Content & Quality Control",
    letter: "B",
    description: "Placeholder text, template leftovers and service section links",
  },
  media: {
    label: "Media & Asset Integrity",
    letter: "C",
    description: "Broken images, alt text and next-gen image formats",
  },
  seo: {
    label: "SEO & Technical Architecture",
    letter: "D",
    description: "Headings, meta tags, render-blocking assets and link health",
  },
  mobile: {
    label: "Mobile UX & Responsive Layout",
    letter: "E",
    description: "Viewport, horizontal overflow, tap targets and font sizes",
  },
};

export interface Issue {
  message: string;
  /** First page the issue was seen on. */
  pageUrl: string;
  /** Every page the same issue appears on (header/footer bugs repeat site-wide). */
  pages: string[];
  /** Short HTML/text excerpt of the offending element. */
  snippet?: string;
  severity: Exclude<Severity, "passed">;
}

export interface CheckResult {
  id: string;
  module: ModuleId;
  label: string;
  severity: Severity;
  /** One-line summary of the outcome, shown in the dashboard and exports. */
  summary: string;
  /** What a developer should do to fix it (empty for passed checks). */
  recommendation: string;
  issues: Issue[];
}

export type StageId = "fetch" | "links" | "analyze" | "mobile" | "report";

export const STAGES: { id: StageId; label: string }[] = [
  { id: "fetch", label: "Fetching DOM" },
  { id: "links", label: "Checking Links" },
  { id: "analyze", label: "Analyzing SEO" },
  { id: "mobile", label: "Mobile UX Check" },
  { id: "report", label: "Generating Report" },
];

export interface PageSummary {
  url: string;
  status: number;
  title: string;
  loadTimeMs: number;
  /** Total bytes of resources observed while loading (browser renderer only). */
  bytes: number;
  requests: number;
  error?: string;
}

export interface LinkStatus {
  url: string;
  status: number;
  ok: boolean;
  internal: boolean;
  error?: string;
  /** Pages that link to this URL. */
  foundOn: string[];
  /** Where the URL was found; forms and iframes are reported by Module A instead of link health. */
  source: "link" | "form" | "iframe" | "image";
}

export interface AuditReport {
  id: string;
  url: string;
  siteName: string;
  platform: string;
  mode: ScanMode;
  renderer: "browser" | "static";
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  score: number;
  grade: string;
  counts: Record<Severity, number>;
  checks: CheckResult[];
  pages: PageSummary[];
  links: { checked: number; broken: number; list: LinkStatus[] };
  screenshots: { desktop?: string; mobile?: string };
  notes: string[];
}

export type AuditEvent =
  | { type: "progress"; stage: StageId; message: string; percent: number }
  | { type: "result"; report: AuditReport }
  | { type: "error"; message: string };
