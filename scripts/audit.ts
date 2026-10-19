/**
 * Command-line runner for scheduled ("daily report") audits.
 *
 *   npm run audit -- https://example-dental.com --mode full --out reports
 *   npm run audit:daily            # audits every site listed in sites.json
 *
 * Writes <host>-<date>.{json,pdf,slack.md,jira.md} per site and, when
 * SLACK_WEBHOOK_URL is set, posts the Slack summary to that channel.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { runAudit } from "../src/lib/audit/engine";
import { jiraMarkdown } from "../src/lib/report/jira";
import { renderPdf } from "../src/lib/report/pdf";
import { slackSummary } from "../src/lib/report/slack";
import type { ScanMode } from "../src/lib/types";

interface Args {
  urls: string[];
  mode: ScanMode;
  out: string;
  pdf: boolean;
  sites?: string;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { urls: [], mode: "quick", out: "reports", pdf: true };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--mode") args.mode = argv[++i] === "full" ? "full" : "quick";
    else if (a === "--out") args.out = argv[++i];
    else if (a === "--sites") args.sites = argv[++i];
    else if (a === "--no-pdf") args.pdf = false;
    else if (a === "--help" || a === "-h") {
      console.log("Usage: npm run audit -- <url...> [--mode quick|full] [--out dir] [--no-pdf] [--sites sites.json]");
      process.exit(0);
    } else args.urls.push(a);
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  let targets = args.urls.map((url) => ({ url, mode: args.mode }));
  if (args.sites) {
    const list = JSON.parse(await readFile(args.sites, "utf8")) as (string | { url: string; mode?: ScanMode })[];
    targets = targets.concat(list.map((s) => (typeof s === "string" ? { url: s, mode: args.mode } : { url: s.url, mode: s.mode ?? args.mode })));
  }
  if (!targets.length) {
    console.error("No URLs given. Pass URLs or --sites sites.json (an array of URLs or {url, mode}).");
    process.exit(1);
  }
  await mkdir(args.out, { recursive: true });

  let failures = 0;
  for (const target of targets) {
    console.log(`\n▶ Auditing ${target.url} (${target.mode})`);
    try {
      const report = await runAudit(target.url, {
        mode: target.mode,
        allowPrivateHost: true, // the operator running the CLI chooses the targets
        onProgress: (_stage, message, percent) => console.log(`  [${String(percent).padStart(3)}%] ${message}`),
      });
      const base = path.join(args.out, `${new URL(report.url).hostname.replace(/^www\./, "")}-${report.finishedAt.slice(0, 10)}`);
      const slack = slackSummary(report);
      await writeFile(`${base}.json`, JSON.stringify(report, null, 2));
      await writeFile(`${base}.slack.md`, slack);
      await writeFile(`${base}.jira.md`, jiraMarkdown(report));
      if (args.pdf) await writeFile(`${base}.pdf`, await renderPdf(report)).catch((err) => console.warn(`  PDF skipped: ${err.message}`));
      console.log(`  ✔ Score ${report.score}/100 — ${report.counts.critical} critical, ${report.counts.warning} warnings → ${base}.*`);

      if (process.env.SLACK_WEBHOOK_URL) {
        const res = await fetch(process.env.SLACK_WEBHOOK_URL, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ text: slack }),
        });
        console.log(res.ok ? "  ✔ Posted to Slack" : `  ✖ Slack webhook returned ${res.status}`);
      }
    } catch (err) {
      failures++;
      console.error(`  ✖ ${err instanceof Error ? err.message : err}`);
    }
  }
  process.exit(failures ? 1 : 0);
}

void main();
