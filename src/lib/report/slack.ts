import type { AuditReport } from "../types";
import { failing, formatDateTime, pathOf, scanModeLabel } from "./format";

/** Executive briefing in Slack mrkdwn, ready to paste into a channel. */
export function slackSummary(report: AuditReport): string {
  const critical = failing(report, "critical");
  const warnings = failing(report, "warning");
  const passed = report.checks.filter((c) => c.severity === "passed");
  const lines: string[] = [];

  lines.push(`*PilotAudit QA Report — ${report.siteName}*`);
  lines.push(`<${report.url}|${report.url}> · ${report.platform} · ${scanModeLabel(report)} · ${formatDateTime(report.finishedAt)}`);
  lines.push("");
  lines.push(`*Overall Site Health: ${report.score}/100 (Grade ${report.grade})*`);
  lines.push(`🔴 ${report.counts.critical} critical  ·  🟡 ${report.counts.warning} warnings  ·  🟢 ${report.counts.passed} passed`);
  lines.push("");

  if (critical.length) {
    lines.push("*🔴 Critical blockers — needs immediate developer fix*");
    for (const check of critical) {
      lines.push(`• *${check.label}* — ${check.summary}`);
      for (const issue of check.issues.filter((i) => i.severity === "critical").slice(0, 2)) {
        const where = issue.pages.slice(0, 3).map(pathOf).join(", ");
        lines.push(`    ↳ ${issue.message}${where ? ` (${where}${issue.pages.length > 3 ? ` +${issue.pages.length - 3}` : ""})` : ""}`);
      }
    }
  } else {
    lines.push("*🔴 Critical blockers:* none — no launch blockers found 🎉");
  }
  lines.push("");

  if (warnings.length) {
    lines.push("*🟡 Medium warnings*");
    for (const check of warnings.slice(0, 8)) lines.push(`• ${check.label} — ${check.summary}`);
    if (warnings.length > 8) lines.push(`• …and ${warnings.length - 8} more in the full report`);
    lines.push("");
  }

  if (passed.length) {
    lines.push("*🟢 Passed & polished*");
    lines.push(passed.map((c) => c.label).join(" · "));
    lines.push("");
  }

  lines.push(`_Scanned ${report.pages.length} page${report.pages.length === 1 ? "" : "s"} and ${report.links.checked} links in ${Math.round(report.durationMs / 1000)}s with PilotAudit._`);
  return lines.join("\n");
}
