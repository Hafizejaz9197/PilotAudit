import type { AuditReport } from "../types";
import { launchBrowser } from "../audit/browser";
import { reportHtml } from "./pdfHtml";

/** Renders the executive report to an A4 PDF with headless Chromium. */
export async function renderPdf(report: AuditReport): Promise<Buffer> {
  const { browser, error } = await launchBrowser();
  if (!browser) throw new Error(`PDF renderer unavailable: ${error}`);
  try {
    // The report JSON comes from the client, so render it with scripts and network access disabled.
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    await page.route("**/*", (route) => (route.request().url().startsWith("data:") ? route.continue() : route.abort()));
    await page.setContent(reportHtml(report), { waitUntil: "load" });
    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "14mm", bottom: "14mm", left: "12mm", right: "12mm" },
    });
    return Buffer.from(pdf);
  } finally {
    await browser.close().catch(() => undefined);
  }
}

export function pdfFileName(report: AuditReport): string {
  const host = new URL(report.url).hostname.replace(/^www\./, "").replace(/[^a-z0-9.-]/gi, "-");
  return `pilotaudit-${host}-${report.finishedAt.slice(0, 10)}.pdf`;
}
