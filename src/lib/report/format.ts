import { MODULES, type AuditReport, type CheckResult, type ModuleId } from "../types";

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function pathOf(url: string): string {
  try {
    const u = new URL(url);
    return u.pathname + u.search || "/";
  } catch {
    return url;
  }
}

export function failing(report: AuditReport, severity: "critical" | "warning"): CheckResult[] {
  return report.checks.filter((c) => c.severity === severity);
}

export function moduleBreakdown(report: AuditReport) {
  return (Object.keys(MODULES) as ModuleId[]).map((id) => {
    const checks = report.checks.filter((c) => c.module === id);
    return {
      id,
      ...MODULES[id],
      critical: checks.filter((c) => c.severity === "critical").length,
      warning: checks.filter((c) => c.severity === "warning").length,
      passed: checks.filter((c) => c.severity === "passed").length,
      total: checks.length,
    };
  });
}

export function scanModeLabel(report: AuditReport): string {
  const pages = report.pages.length;
  return `${report.mode === "full" ? "Full scan" : "Quick scan"} · ${pages} page${pages === 1 ? "" : "s"}`;
}

export function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
