import type { CheckResult } from "../../types";
import { buildCheck, type AuditContext, type RawIssue } from "../context";

export async function mobileModule(ctx: AuditContext): Promise<CheckResult[]> {
  const viewport: RawIssue[] = [];
  const overflow: RawIssue[] = [];
  const tap: RawIssue[] = [];
  const fonts: RawIssue[] = [];
  const callNow: RawIssue[] = [];

  // Viewport meta works from HTML alone, so it runs in static mode too.
  for (const { $, url } of ctx.pages) {
    const content = $('meta[name="viewport"]').attr("content");
    if (!content) {
      viewport.push({ message: "Missing <meta name=\"viewport\"> — the page renders as a zoomed-out desktop layout on phones", pageUrl: url, severity: "critical" });
    } else if (!/width\s*=\s*device-width/i.test(content)) {
      viewport.push({ message: `Viewport doesn't use width=device-width ("${content}")`, pageUrl: url, severity: "critical" });
    } else if (/user-scalable\s*=\s*(no|0)|maximum-scale\s*=\s*1(\.0)?\b/i.test(content)) {
      viewport.push({ message: `Viewport blocks pinch-zoom ("${content}") — an accessibility problem`, pageUrl: url, severity: "warning" });
    }
  }

  for (const m of ctx.mobile) {
    if (m.scrollWidth > m.viewportWidth + 2) {
      overflow.push({
        message: `Page scrolls sideways on a 390px phone (content is ${m.scrollWidth}px wide, layout viewport ${m.viewportWidth}px)`,
        pageUrl: m.url,
        snippet: m.overflowOffenders.join("\n") || undefined,
        severity: "warning",
      });
    }
    if (m.smallTapTargets.count > 0) {
      tap.push({
        message: `${m.smallTapTargets.count} tap target${m.smallTapTargets.count === 1 ? "" : "s"} smaller than 32×32px`,
        pageUrl: m.url,
        snippet: m.smallTapTargets.samples.join("\n"),
        severity: "warning",
      });
    }
    if (m.smallText.count > 0) {
      fonts.push({
        message: `${m.smallText.count} text block${m.smallText.count === 1 ? "" : "s"} below 12px on mobile`,
        pageUrl: m.url,
        snippet: m.smallText.samples.join("\n"),
        severity: "warning",
      });
    }
  }

  const home = ctx.mobile.find((m) => m.url === ctx.pages[0]?.url) ?? ctx.mobile[0];
  if (home && !home.phoneAboveFold) {
    callNow.push({
      message: home.hasPhoneLink
        ? "Tap-to-call link exists but isn't visible in the first mobile screen"
        : "No tap-to-call link on the mobile homepage",
      pageUrl: home.url,
      severity: "warning",
    });
  }

  const checks = [
    buildCheck(
      {
        id: "mobile.viewport",
        module: "mobile",
        label: "Responsive viewport",
        severity: "critical",
        passed: "Viewport meta tag is configured for mobile",
        recommendation: 'Add <meta name="viewport" content="width=device-width, initial-scale=1"> to every page.',
      },
      viewport,
    ),
  ];
  if (!ctx.mobile.length) return checks;

  return [
    ...checks,
    buildCheck(
      {
        id: "mobile.overflow",
        module: "mobile",
        label: "Horizontal overflow (layout defects)",
        severity: "warning",
        passed: "No sideways scrolling at 390px",
        recommendation: "Constrain the listed elements (max-width: 100%, flex-wrap, responsive widths) so nothing extends past the screen edge.",
      },
      overflow,
    ),
    buildCheck(
      {
        id: "mobile.tap-targets",
        module: "mobile",
        label: "Tap target size",
        severity: "warning",
        passed: "Buttons and links are comfortably tappable",
        recommendation: "Give buttons, icon links and menu items at least 44×44px of tappable area (padding counts).",
      },
      tap,
    ),
    buildCheck(
      {
        id: "mobile.font-size",
        module: "mobile",
        label: "Readable font sizes",
        severity: "warning",
        passed: "Body text is at least 12px on mobile",
        recommendation: "Use at least 16px for body copy on mobile; avoid fixed tiny sizes in footers and disclaimers.",
      },
      fonts,
    ),
    buildCheck(
      {
        id: "mobile.click-to-call",
        module: "mobile",
        label: "Mobile click-to-call",
        severity: "warning",
        passed: "Tap-to-call is visible in the first mobile screen",
        recommendation: "Add a sticky \"Call Now\" bar or header phone button on mobile — most dental leads call from their phone.",
      },
      callNow,
    ),
  ];
}
