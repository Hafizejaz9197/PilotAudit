import { test } from "node:test";
import assert from "node:assert/strict";
import { load } from "cheerio";
import { isPlaceholderPhone, telProblem } from "../src/lib/audit/modules/conversion";
import { isBrokenDataUri } from "../src/lib/audit/modules/media";
import { looksUnminified } from "../src/lib/audit/modules/seo";
import { buildCheck, snippet } from "../src/lib/audit/context";
import { gradeFor, scoreChecks } from "../src/lib/audit/scoring";
import { isCrawlable, normalizeInputUrl, pageKey } from "../src/lib/audit/url";
import type { CheckResult } from "../src/lib/types";

test("telProblem accepts E.164 and flags broken numbers", () => {
  assert.equal(telProblem("tel:+15128320142"), null);
  assert.equal(telProblem("tel:")?.level, "critical");
  assert.equal(telProblem("tel:555-CALL-NOW")?.level, "critical");
  assert.equal(telProblem("tel:(512) 555-0142")?.level, "critical"); // fictional 555-01xx
  assert.equal(telProblem("tel:(512) 832 0142")?.level, "warning"); // spaces
  assert.equal(telProblem("tel:5128320142")?.level, "warning"); // no country code
});

test("isPlaceholderPhone detects template numbers", () => {
  for (const n of ["(555) 555-5555", "123-456-7890", "512-555-0100", "000-000-0000"]) assert.ok(isPlaceholderPhone(n), n);
  assert.ok(!isPlaceholderPhone("(512) 832-0142"));
});

test("isBrokenDataUri", () => {
  assert.ok(isBrokenDataUri("data:image/png;base64,iVBOR"));
  assert.ok(!isBrokenDataUri("data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"));
});

test("looksUnminified", () => {
  const pretty = Array.from({ length: 300 }, (_, i) => `.a${i} {\n  color: red;\n}`).join("\n");
  assert.ok(looksUnminified("https://x.com/style.css", pretty));
  assert.ok(!looksUnminified("https://x.com/style.min.css", pretty));
  assert.ok(!looksUnminified("https://x.com/app.css", pretty.replace(/\n/g, "")));
});

test("buildCheck merges repeated issues across pages and derives severity", () => {
  const check = buildCheck(
    { id: "x", module: "seo", label: "X", severity: "warning", passed: "ok", recommendation: "fix" },
    [
      { message: "Missing og:image", pageUrl: "https://a.com/" },
      { message: "Missing og:image", pageUrl: "https://a.com/about" },
      { message: "Broken", pageUrl: "https://a.com/", severity: "critical" },
    ],
  );
  assert.equal(check.severity, "critical");
  assert.equal(check.issues.length, 2);
  assert.equal(check.issues[0].message, "Broken");
  assert.deepEqual(check.issues[1].pages, ["https://a.com/", "https://a.com/about"]);
  assert.equal(buildCheck({ id: "y", module: "seo", label: "Y", severity: "warning", passed: "all good", recommendation: "" }, []).severity, "passed");
});

test("snippet strips PilotAudit annotations", () => {
  const $ = load('<a href="#" data-pa-click="direct" class="btn">Book</a>');
  assert.equal(snippet($, $("a")[0]), '<a href="#" class="btn">Book</a>');
});

test("scoring", () => {
  const mk = (severity: CheckResult["severity"], n = 1): CheckResult => ({
    id: severity, module: "seo", label: "", severity, summary: "", recommendation: "",
    issues: Array.from({ length: severity === "passed" ? 0 : n }, () => ({ message: "", pageUrl: "", pages: [], severity: "warning" })),
  });
  assert.equal(scoreChecks([mk("passed"), mk("passed")]), 100);
  assert.equal(scoreChecks([mk("critical")]), 91);
  assert.ok(scoreChecks([mk("critical", 50)]) >= 85);
  assert.equal(gradeFor(91), "A");
  assert.equal(gradeFor(10), "F");
});

test("url helpers", () => {
  assert.equal(normalizeInputUrl("brightsmile.com").toString(), "https://brightsmile.com/");
  assert.throws(() => normalizeInputUrl("ftp://x.com"));
  assert.equal(pageKey("https://www.a.com/about/#team"), pageKey("https://a.com/about"));
  const root = new URL("https://a.com");
  assert.ok(isCrawlable(new URL("https://a.com/services"), root));
  assert.ok(!isCrawlable(new URL("https://a.com/brochure.pdf"), root));
  assert.ok(!isCrawlable(new URL("https://b.com/"), root));
  assert.ok(!isCrawlable(new URL("https://a.com/wp-admin/"), root));
});
