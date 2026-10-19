"use client";

import { Clock, ExternalLink, Layers, Link2, Monitor } from "lucide-react";
import type { AuditReport, Severity } from "@/lib/types";
import { formatDateTime } from "@/lib/report/format";

export function scoreTone(score: number) {
  if (score >= 80) return { stroke: "#10b981", text: "text-emerald-600", label: "Healthy" };
  if (score >= 60) return { stroke: "#f59e0b", text: "text-amber-600", label: "Needs work" };
  return { stroke: "#ef4444", text: "text-red-600", label: "At risk" };
}

function Gauge({ score }: { score: number }) {
  const r = 52;
  const c = 2 * Math.PI * r;
  const tone = scoreTone(score);
  return (
    <svg viewBox="0 0 140 140" className="h-36 w-36 shrink-0" role="img" aria-label={`Site health score ${score} out of 100`}>
      <circle cx="70" cy="70" r={r} fill="none" stroke="#eef2f7" strokeWidth="14" />
      <circle
        cx="70"
        cy="70"
        r={r}
        fill="none"
        stroke={tone.stroke}
        strokeWidth="14"
        strokeLinecap="round"
        strokeDasharray={`${(c * score) / 100} ${c}`}
        transform="rotate(-90 70 70)"
        style={{ transition: "stroke-dasharray 800ms ease" }}
      />
      <text x="70" y="68" textAnchor="middle" className="fill-slate-900" fontSize="34" fontWeight="800">
        {score}%
      </text>
      <text x="70" y="90" textAnchor="middle" className="fill-slate-400" fontSize="12">
        Site Health
      </text>
    </svg>
  );
}

const BADGES: { id: Severity; label: string; emoji: string; className: string }[] = [
  { id: "critical", label: "Critical Issues", emoji: "🔴", className: "bg-red-50 text-red-700 ring-red-200 hover:bg-red-100" },
  { id: "warning", label: "Medium Warnings", emoji: "🟡", className: "bg-amber-50 text-amber-700 ring-amber-200 hover:bg-amber-100" },
  { id: "passed", label: "Passed Checks", emoji: "🟢", className: "bg-emerald-50 text-emerald-700 ring-emerald-200 hover:bg-emerald-100" },
];

export default function ScoreCard({ report, onSeverity }: { report: AuditReport; onSeverity: (s: Severity) => void }) {
  const tone = scoreTone(report.score);
  return (
    <section className="h-full rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200 sm:p-6">
      <div className="flex flex-col gap-6 sm:flex-row sm:items-center">
        <Gauge score={report.score} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="truncate text-2xl font-bold tracking-tight">{report.siteName}</h1>
            <span className={`rounded-full bg-slate-100 px-2.5 py-0.5 text-sm font-bold ${tone.text}`}>
              Grade {report.grade} · {tone.label}
            </span>
          </div>
          <a href={report.url} target="_blank" rel="noreferrer" className="mt-1 inline-flex max-w-full items-center gap-1 truncate text-sm text-brand-700 hover:underline">
            {report.url} <ExternalLink className="h-3.5 w-3.5 shrink-0" />
          </a>
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
            <span className="flex items-center gap-1"><Monitor className="h-3.5 w-3.5" />{report.platform}</span>
            <span className="flex items-center gap-1"><Layers className="h-3.5 w-3.5" />{report.mode === "full" ? "Full" : "Quick"} scan · {report.pages.length} pages</span>
            <span className="flex items-center gap-1"><Link2 className="h-3.5 w-3.5" />{report.links.checked} links checked</span>
            <span className="flex items-center gap-1"><Clock className="h-3.5 w-3.5" />{formatDateTime(report.finishedAt)} · {Math.round(report.durationMs / 1000)}s</span>
          </div>
          <div className="mt-4 grid grid-cols-3 gap-2">
            {BADGES.map((b) => (
              <button key={b.id} onClick={() => onSeverity(b.id)} className={`rounded-xl px-3 py-2.5 text-left ring-1 transition ${b.className}`}>
                <div className="text-2xl font-bold tabular-nums">
                  {report.counts[b.id]}
                </div>
                <div className="text-xs font-medium">
                  <span aria-hidden>{b.emoji}</span> {b.label}
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
