import type { CheckResult, Severity } from "../types";

/**
 * Starts at 100 and deducts per failing check. A failing check costs a base amount
 * plus a little per extra issue, capped, so one site-wide header bug doesn't zero the score.
 */
export function scoreChecks(checks: CheckResult[]): number {
  let score = 100;
  for (const check of checks) {
    const extra = Math.max(0, check.issues.length - 1);
    if (check.severity === "critical") score -= 9 + Math.min(6, extra * 1.5);
    else if (check.severity === "warning") score -= 2.5 + Math.min(2.5, extra * 0.5);
  }
  return Math.max(0, Math.min(100, Math.round(score)));
}

export function gradeFor(score: number): string {
  if (score >= 90) return "A";
  if (score >= 80) return "B";
  if (score >= 70) return "C";
  if (score >= 60) return "D";
  return "F";
}

export function countSeverities(checks: CheckResult[]): Record<Severity, number> {
  const counts: Record<Severity, number> = { critical: 0, warning: 0, passed: 0 };
  for (const c of checks) counts[c.severity]++;
  return counts;
}
