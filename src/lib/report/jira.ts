import { MODULES, type AuditReport, type CheckResult } from "../types";
import { formatDateTime, pathOf } from "./format";

export interface JiraTicket {
  checkId: string;
  title: string;
  priority: "Highest" | "Medium";
  body: string;
}

const MAX_ELEMENTS = 8;

export function jiraTicket(report: AuditReport, check: CheckResult): JiraTicket {
  const critical = check.severity === "critical";
  const priority = critical ? "Highest" : "Medium";
  const module = MODULES[check.module];
  const title = `[PilotAudit][${critical ? "Critical" : "Warning"}] ${report.siteName}: ${check.label} — ${check.summary}`;
  const lines: string[] = [];

  lines.push(`**Site:** ${report.siteName} — ${report.url}`);
  lines.push(`**Priority:** ${priority}  |  **Type:** Bug  |  **Labels:** pilotaudit, website-qa, ${check.module}`);
  lines.push(`**Component:** Module ${module.letter} — ${module.label}`);
  lines.push(`**Detected:** ${formatDateTime(report.finishedAt)} (${report.mode} scan, ${report.platform})`);
  lines.push("");
  lines.push("### Problem");
  lines.push(check.summary + ".");
  lines.push("");
  lines.push("### Affected elements");
  check.issues.slice(0, MAX_ELEMENTS).forEach((issue, i) => {
    const pages = issue.pages.slice(0, 4).map(pathOf).join(", ") + (issue.pages.length > 4 ? ` +${issue.pages.length - 4} more` : "");
    lines.push(`${i + 1}. ${issue.severity === "critical" ? "🔴" : "🟡"} ${issue.message} — \`${pages}\``);
    if (issue.snippet) {
      lines.push("   ```html");
      lines.push(`   ${issue.snippet.replace(/\n/g, "\n   ")}`);
      lines.push("   ```");
    }
  });
  if (check.issues.length > MAX_ELEMENTS) lines.push(`…plus ${check.issues.length - MAX_ELEMENTS} more (see the PilotAudit report).`);
  lines.push("");
  lines.push("### Expected fix");
  lines.push(check.recommendation);
  lines.push("");
  lines.push("### Acceptance criteria");
  lines.push(`- [ ] Every element listed above is fixed on production`);
  lines.push(`- [ ] PilotAudit re-scan shows "${check.label}" as passed`);

  return { checkId: check.id, title, priority, body: lines.join("\n") };
}

export function jiraTickets(report: AuditReport): JiraTicket[] {
  return [...report.checks.filter((c) => c.severity === "critical"), ...report.checks.filter((c) => c.severity === "warning")].map((c) =>
    jiraTicket(report, c),
  );
}

/** All tickets as one markdown document. */
export function jiraMarkdown(report: AuditReport, tickets = jiraTickets(report)): string {
  const header = `# PilotAudit bug tickets — ${report.siteName}\n${report.url} · Score ${report.score}/100 · ${formatDateTime(report.finishedAt)}\n`;
  return [header, ...tickets.map((t) => `---\n\n## ${t.title}\n\n${t.body}\n`)].join("\n");
}
