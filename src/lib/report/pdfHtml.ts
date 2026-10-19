import type { AuditReport } from "../types";
import { escapeHtml as e, failing, formatDateTime, moduleBreakdown, pathOf, scanModeLabel } from "./format";

const n = (value: unknown) => Number(value) || 0;
const SAFE_IMAGE = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;
const safeImage = (src?: string) => (src && SAFE_IMAGE.test(src) ? src : undefined);

function scoreColor(score: number): string {
  if (score >= 80) return "#059669";
  if (score >= 60) return "#d97706";
  return "#dc2626";
}

function ring(score: number): string {
  const r = 46;
  const c = 2 * Math.PI * r;
  const color = scoreColor(score);
  return `<svg width="120" height="120" viewBox="0 0 120 120">
    <circle cx="60" cy="60" r="${r}" fill="none" stroke="#e5e7eb" stroke-width="12"/>
    <circle cx="60" cy="60" r="${r}" fill="none" stroke="${color}" stroke-width="12" stroke-linecap="round"
      stroke-dasharray="${(c * score) / 100} ${c}" transform="rotate(-90 60 60)"/>
    <text x="60" y="58" text-anchor="middle" font-size="30" font-weight="800" fill="#0f172a">${score}</text>
    <text x="60" y="78" text-anchor="middle" font-size="11" fill="#64748b">/ 100</text>
  </svg>`;
}

/**
 * Branded, print-ready executive report. Used server-side for Playwright's page.pdf()
 * and client-side as a print fallback, so it must stay dependency-free.
 */
export function reportHtml(report: AuditReport, { autoPrint = false } = {}): string {
  const critical = failing(report, "critical");
  const warnings = failing(report, "warning");
  const passed = report.checks.filter((c) => c.severity === "passed");
  const modules = moduleBreakdown(report);
  const score = Math.max(0, Math.min(100, n(report.score)));
  const desktop = safeImage(report.screenshots?.desktop);
  const mobile = safeImage(report.screenshots?.mobile);

  const criticalHtml = critical.length
    ? critical
        .map(
          (c) => `<div class="item crit">
        <div class="item-head"><span class="badge b-crit">CRITICAL</span><strong>${e(c.label)}</strong><span class="muted"> — ${e(c.summary)}</span></div>
        <ul>${c.issues
          .slice(0, 2)
          .map((i) => `<li>${e(i.message)} <span class="muted">(${e(i.pages.slice(0, 3).map(pathOf).join(", "))}${i.pages.length > 3 ? ` +${i.pages.length - 3}` : ""})</span></li>`)
          .join("")}${c.issues.length > 2 ? `<li class="muted">+${c.issues.length - 2} more</li>` : ""}</ul>
        <div class="fix"><strong>Fix:</strong> ${e(c.recommendation)}</div>
      </div>`,
        )
        .join("")
    : `<div class="item ok-box">No critical blockers found — conversion paths, phone links and pages are working.</div>`;

  const warningRows = warnings
    .map(
      (c) => `<tr><td><span class="badge b-warn">WARN</span></td><td><strong>${e(c.label)}</strong><span class="muted small"> — ${e(c.summary)}</span><div class="muted small">${e(c.issues[0]?.message ?? "")}</div></td></tr>`,
    )
    .join("");

  const shots =
    desktop || mobile
      ? `<section class="avoid"><h2>Viewport snapshots</h2><div class="shots">
        ${desktop ? `<figure class="desk"><img src="${desktop}"/><figcaption>Desktop · 1440px</figcaption></figure>` : ""}
        ${mobile ? `<figure class="mob"><img src="${mobile}"/><figcaption>Mobile · 390px</figcaption></figure>` : ""}
      </div></section>`
      : "";

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/>
<title>PilotAudit Report — ${e(report.siteName)}</title>
<style>
  @page { size: A4; margin: 14mm 12mm; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: #0f172a; font-size: 11px; line-height: 1.45; margin: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .brand { display: flex; justify-content: space-between; align-items: center; background: #0b1b3a; color: #fff; padding: 14px 18px; border-radius: 10px; }
  .brand .logo { font-size: 18px; font-weight: 800; letter-spacing: -.02em; }
  .brand .logo span { color: #2dd4bf; }
  .brand .meta { text-align: right; font-size: 10px; color: #cbd5e1; }
  .summary { display: flex; gap: 18px; align-items: center; margin: 16px 0 8px; }
  .summary h1 { font-size: 20px; margin: 0 0 2px; }
  .summary .url { color: #0f766e; font-size: 11px; word-break: break-all; }
  .counts { display: flex; gap: 8px; margin-top: 10px; }
  .count { border-radius: 8px; padding: 6px 12px; font-weight: 700; font-size: 12px; }
  .c-crit { background: #fee2e2; color: #991b1b; } .c-warn { background: #fef3c7; color: #92400e; } .c-pass { background: #d1fae5; color: #065f46; }
  .grade { display: inline-block; margin-left: 6px; padding: 1px 8px; border-radius: 999px; color: #fff; font-weight: 700; font-size: 11px; }
  h2 { font-size: 12px; margin: 12px 0 6px; padding-bottom: 4px; border-bottom: 2px solid #e2e8f0; text-transform: uppercase; letter-spacing: .04em; color: #334155; }
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: left; padding: 3px 6px; border-bottom: 1px solid #e2e8f0; vertical-align: top; }
  th { font-size: 9.5px; text-transform: uppercase; color: #64748b; letter-spacing: .04em; }
  .num { text-align: center; font-weight: 700; width: 64px; }
  .item { border: 1px solid #fecaca; border-left: 4px solid #dc2626; border-radius: 6px; padding: 5px 9px; margin-bottom: 5px; page-break-inside: avoid; font-size: 10.5px; }
  .ok-box { border-color: #a7f3d0; border-left-color: #059669; background: #ecfdf5; }
  .item ul { margin: 2px 0 2px 16px; padding: 0; }
  .fix { background: #f8fafc; border-radius: 4px; padding: 2px 6px; margin-top: 2px; }
  .badge { display: inline-block; font-size: 8.5px; font-weight: 800; padding: 1px 6px; border-radius: 4px; margin-right: 6px; letter-spacing: .04em; }
  .b-crit { background: #dc2626; color: #fff; } .b-warn { background: #f59e0b; color: #fff; } .b-pass { background: #059669; color: #fff; }
  .muted { color: #64748b; } .small { font-size: 10px; }
  .passed { columns: 2; column-gap: 18px; margin: 0; padding: 0; list-style: none; }
  .passed li { break-inside: avoid; padding: 2px 0; }
  .passed li::before { content: "✓ "; color: #059669; font-weight: 800; }
  .shots { display: flex; gap: 14px; align-items: flex-start; }
  .shots figure { margin: 0; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden; }
  .shots img { display: block; width: 100%; object-fit: cover; object-position: top; }
  .desk { flex: 3; } .desk img { height: 190px; } .mob { flex: 1; } .mob img { height: 190px; }
  figcaption { font-size: 9.5px; color: #64748b; padding: 4px 8px; background: #f8fafc; }
  .avoid { page-break-inside: avoid; }
  .footer { margin-top: 18px; font-size: 9.5px; color: #94a3b8; text-align: center; }
  .notes { font-size: 10px; color: #92400e; background: #fffbeb; border-radius: 6px; padding: 6px 8px; margin-top: 8px; }
</style></head>
<body>
  <div class="brand">
    <div class="logo">Pilot<span>Audit</span> <span style="color:#94a3b8;font-weight:500;font-size:11px">AI Website QA &amp; Audit Engine</span></div>
    <div class="meta">Executive Audit Report<br/>${e(formatDateTime(report.finishedAt))}</div>
  </div>

  <div class="summary">
    ${ring(score)}
    <div>
      <h1>${e(report.siteName)} <span class="grade" style="background:${scoreColor(score)}">Grade ${e(report.grade)}</span></h1>
      <div class="url">${e(report.url)}</div>
      <div class="muted small">${e(report.platform)} · ${e(scanModeLabel(report))} · ${n(report.links?.checked)} links checked · ${Math.round(n(report.durationMs) / 1000)}s</div>
      <div class="counts">
        <div class="count c-crit">🔴 ${n(report.counts?.critical)} Critical</div>
        <div class="count c-warn">🟡 ${n(report.counts?.warning)} Warnings</div>
        <div class="count c-pass">🟢 ${n(report.counts?.passed)} Passed</div>
      </div>
    </div>
  </div>
  ${report.notes.length ? `<div class="notes">${report.notes.map(e).join("<br/>")}</div>` : ""}

  <h2>Severity breakdown by module</h2>
  <table>
    <thead><tr><th>Module</th><th class="num">Critical</th><th class="num">Warnings</th><th class="num">Passed</th></tr></thead>
    <tbody>${modules
      .filter((m) => m.total > 0)
      .map(
        (m) => `<tr><td><strong>${m.letter}. ${e(m.label)}</strong><div class="muted small">${e(m.description)}</div></td>
        <td class="num" style="color:${m.critical ? "#dc2626" : "#94a3b8"}">${m.critical}</td>
        <td class="num" style="color:${m.warning ? "#d97706" : "#94a3b8"}">${m.warning}</td>
        <td class="num" style="color:#059669">${m.passed}</td></tr>`,
      )
      .join("")}</tbody>
  </table>

  <h2>Critical blockers — immediate developer fix</h2>
  ${criticalHtml}

  ${warnings.length ? `<h2>Medium warnings</h2><table><tbody>${warningRows}</tbody></table>` : ""}

  <h2>Passed &amp; polished</h2>
  <ul class="passed">${passed.map((c) => `<li>${e(c.label)} <span class="muted small">— ${e(c.summary)}</span></li>`).join("")}</ul>

  ${shots}

  <h2>Pages scanned</h2>
  <table>
    <thead><tr><th>Page</th><th class="num">Status</th><th class="num">Load</th></tr></thead>
    <tbody>${report.pages
      .slice(0, 12)
      .map(
        (p) => `<tr><td>${e(pathOf(p.url))}<div class="muted small">${e(p.title)}</div></td>
        <td class="num" style="color:${n(p.status) >= 400 || !n(p.status) ? "#dc2626" : "#059669"}">${n(p.status) || "ERR"}</td>
        <td class="num">${n(p.loadTimeMs) ? `${(n(p.loadTimeMs) / 1000).toFixed(1)}s` : "—"}</td></tr>`,
      )
      .join("")}</tbody>
  </table>

  <div class="footer">Generated by PilotAudit · ${e(report.url)} · ${e(formatDateTime(report.finishedAt))}</div>
  ${autoPrint ? "<script>window.addEventListener('load',()=>setTimeout(()=>window.print(),300));</script>" : ""}
</body></html>`;
}
