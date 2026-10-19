import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { runAudit } from "../src/lib/audit/engine";
import { launchBrowser } from "../src/lib/audit/browser";
import { slackSummary } from "../src/lib/report/slack";
import { jiraTickets } from "../src/lib/report/jira";
import { reportHtml } from "../src/lib/report/pdfHtml";
import type { AuditReport } from "../src/lib/types";

const PUBLIC = path.join(import.meta.dirname, "..", "public");
const TYPES: Record<string, string> = { ".html": "text/html", ".css": "text/css", ".svg": "image/svg+xml", ".jpg": "image/jpeg" };
let server: Server;
let base = "";

before(async () => {
  server = createServer(async (req, res) => {
    const file = path.join(PUBLIC, decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname));
    try {
      if (!file.startsWith(PUBLIC)) throw new Error("outside");
      const body = await readFile(file);
      res.writeHead(200, { "content-type": TYPES[path.extname(file)] ?? "application/octet-stream" }).end(body);
    } catch {
      res.writeHead(404, { "content-type": "text/html" }).end("<html><head><title>Not found</title></head><body>404</body></html>");
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  base = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
});

after(() => server.close());

function check(report: AuditReport, id: string) {
  const found = report.checks.find((c) => c.id === id);
  assert.ok(found, `missing check ${id}`);
  return found;
}

function assertCommonFindings(report: AuditReport) {
  assert.equal(check(report, "conversion.tel-invalid").severity, "critical");
  assert.ok(check(report, "conversion.tel-invalid").issues.some((i) => i.message.includes("about:invalid")));
  assert.equal(check(report, "conversion.cta-placeholder").severity, "critical");
  assert.equal(check(report, "content.dummy-text").severity, "critical");
  assert.equal(check(report, "content.ai-artifacts").severity, "critical");
  assert.equal(check(report, "seo.indexability").severity, "critical");
  assert.equal(check(report, "seo.canonical").severity, "critical");
  assert.ok(check(report, "seo.link-health").issues.some((i) => i.message.includes("404")));
  assert.equal(check(report, "seo.h1").severity, "warning");
  assert.equal(check(report, "mobile.viewport").severity, "critical");
  assert.ok(report.score < 40);
}

test("static renderer finds the seeded demo bugs", { timeout: 120000 }, async () => {
  const report = await runAudit(`${base}/demo-clinic/index.html`, { mode: "full", staticOnly: true, allowPrivateHost: true });
  assert.equal(report.renderer, "static");
  assert.ok(report.pages.length >= 5);
  assertCommonFindings(report);

  const slack = slackSummary(report);
  assert.match(slack, /Critical blockers/);
  assert.match(slack, /Bright Smile Dental/);
  const tickets = jiraTickets(report);
  assert.equal(tickets.length, report.counts.critical + report.counts.warning);
  assert.equal(tickets[0].priority, "Highest");
  assert.match(reportHtml(report), /Executive Audit Report/);
});

test("browser renderer adds runtime checks", { timeout: 240000 }, async (t) => {
  const { browser } = await launchBrowser();
  if (!browser) return t.skip("Chromium not installed");
  await browser.close();
  const report = await runAudit(`${base}/demo-clinic/index.html`, { mode: "quick", allowPrivateHost: true });
  assert.equal(report.renderer, "browser");
  assertCommonFindings(report);
  assert.ok(check(report, "conversion.cta-placeholder").issues.some((i) => i.message.includes("does nothing")));
  assert.equal(check(report, "media.lazy-load").severity, "critical");
  assert.equal(check(report, "conversion.form-endpoints").severity, "critical");
  assert.ok(report.screenshots.desktop?.startsWith("data:image/jpeg"));
  assert.ok(report.screenshots.mobile?.startsWith("data:image/jpeg"));
});
