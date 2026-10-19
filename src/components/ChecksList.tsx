"use client";

import { useState } from "react";
import { AlertOctagon, AlertTriangle, Check, CheckCircle2, ChevronDown, Copy, Wrench, X } from "lucide-react";
import { MODULES, type AuditReport, type CheckResult, type ModuleId } from "@/lib/types";
import { pathOf } from "@/lib/report/format";
import { jiraTicket } from "@/lib/report/jira";
import { copyText } from "@/lib/client";
import type { SeverityFilter } from "./ReportView";

const FILTERS: { id: SeverityFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "critical", label: "🔴 Critical" },
  { id: "warning", label: "🟡 Warnings" },
  { id: "passed", label: "🟢 Passed" },
];

interface Props {
  report: AuditReport;
  checks: CheckResult[];
  severity: SeverityFilter;
  module: ModuleId | null;
  onSeverity: (s: SeverityFilter) => void;
  onClearModule: () => void;
}

export default function ChecksList({ report, checks, severity, module, onSeverity, onClearModule }: Props) {
  const order = { critical: 0, warning: 1, passed: 2 };
  const sorted = [...checks].sort((a, b) => order[a.severity] - order[b.severity]);
  const groups = (Object.keys(MODULES) as ModuleId[])
    .map((id) => ({ id, checks: sorted.filter((c) => c.module === id) }))
    .filter((g) => g.checks.length);
  // Only the first critical finding starts expanded so the list stays scannable.
  const firstCritical = groups.flatMap((g) => g.checks).find((c) => c.severity === "critical")?.id;

  return (
    <section className="rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-4">
        <h2 className="text-lg font-semibold">Audit findings</h2>
        <div className="flex flex-wrap items-center gap-1 rounded-lg bg-slate-100 p-1 text-sm">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              onClick={() => onSeverity(f.id)}
              className={`rounded-md px-3 py-1.5 font-medium ${severity === f.id ? "bg-white shadow-sm" : "text-slate-500 hover:text-slate-800"}`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>
      {module && (
        <div className="flex items-center gap-2 border-b border-slate-100 bg-brand-50 px-5 py-2 text-sm text-brand-700">
          Showing Module {MODULES[module].letter}: {MODULES[module].label}
          <button onClick={onClearModule} className="ml-auto flex items-center gap-1 text-xs font-semibold hover:underline">
            <X className="h-3.5 w-3.5" /> Clear
          </button>
        </div>
      )}
      {groups.length === 0 && <div className="px-5 py-10 text-center text-sm text-slate-500">No checks match this filter.</div>}
      {groups.map((group) => (
        <div key={group.id}>
          <div className="bg-slate-50 px-5 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Module {MODULES[group.id].letter} · {MODULES[group.id].label}
          </div>
          <ul className="divide-y divide-slate-100">
            {group.checks.map((check) => (
              <CheckRow key={check.id} report={report} check={check} defaultOpen={check.id === firstCritical} />
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}

function CheckRow({ report, check, defaultOpen }: { report: AuditReport; check: CheckResult; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const [copied, setCopied] = useState(false);
  const Icon = check.severity === "critical" ? AlertOctagon : check.severity === "warning" ? AlertTriangle : CheckCircle2;
  const color = check.severity === "critical" ? "text-red-500" : check.severity === "warning" ? "text-amber-500" : "text-emerald-500";
  const expandable = check.issues.length > 0;

  return (
    <li>
      <button
        onClick={() => expandable && setOpen((v) => !v)}
        className={`flex w-full items-start gap-3 px-5 py-3.5 text-left ${expandable ? "hover:bg-slate-50" : "cursor-default"}`}
        aria-expanded={expandable ? open : undefined}
      >
        <Icon className={`mt-0.5 h-5 w-5 shrink-0 ${color}`} />
        <div className="min-w-0 flex-1">
          <div className="font-medium">{check.label}</div>
          <div className="text-sm text-slate-500">{check.summary}</div>
        </div>
        {expandable && (
          <>
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600 tabular-nums">{check.issues.length}</span>
            <ChevronDown className={`h-5 w-5 shrink-0 text-slate-400 transition ${open ? "rotate-180" : ""}`} />
          </>
        )}
      </button>
      {open && expandable && (
        <div className="space-y-3 px-5 pb-4 pl-13">
          <ol className="space-y-2">
            {check.issues.map((issue, i) => (
              <li key={i} className="rounded-lg border border-slate-200 p-3 text-sm">
                <div className="flex items-start gap-2">
                  <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${issue.severity === "critical" ? "bg-red-500" : "bg-amber-400"}`} />
                  <div className="min-w-0 flex-1">
                    <div className="break-words">{issue.message}</div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {issue.pages.slice(0, 6).map((p) => (
                        <a key={p} href={p} target="_blank" rel="noreferrer" className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-600 hover:bg-brand-50 hover:text-brand-700">
                          {pathOf(p)}
                        </a>
                      ))}
                      {issue.pages.length > 6 && <span className="text-[11px] text-slate-400">+{issue.pages.length - 6} more pages</span>}
                    </div>
                    {issue.snippet && (
                      <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-all rounded-md bg-slate-950 px-3 py-2 font-mono text-[11px] text-slate-200">{issue.snippet}</pre>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ol>
          <div className="flex flex-col gap-2 rounded-lg bg-brand-50 p-3 text-sm text-brand-700 sm:flex-row sm:items-start">
            <Wrench className="mt-0.5 h-4 w-4 shrink-0" />
            <div className="flex-1">
              <strong>Fix:</strong> {check.recommendation}
            </div>
            <button
              onClick={async () => {
                const t = jiraTicket(report, check);
                await copyText(`${t.title}\n\n${t.body}`);
                setCopied(true);
                setTimeout(() => setCopied(false), 1800);
              }}
              className="flex shrink-0 items-center gap-1 self-start rounded-md bg-white px-2 py-1 text-xs font-semibold text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50"
            >
              {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />} Jira ticket
            </button>
          </div>
        </div>
      )}
    </li>
  );
}
