"use client";

import type { AuditReport, ModuleId } from "@/lib/types";
import { moduleBreakdown } from "@/lib/report/format";
import { MODULE_ICONS } from "./moduleIcons";

export default function ModuleTiles({ report, active, onSelect }: { report: AuditReport; active: ModuleId | null; onSelect: (m: ModuleId) => void }) {
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
      {moduleBreakdown(report).map((m) => {
        const Icon = MODULE_ICONS[m.id];
        const pct = m.total ? Math.round((m.passed / m.total) * 100) : 100;
        const tone = m.critical ? "text-red-600 bg-red-50" : m.warning ? "text-amber-600 bg-amber-50" : "text-emerald-600 bg-emerald-50";
        return (
          <button
            key={m.id}
            onClick={() => onSelect(m.id)}
            className={`rounded-2xl bg-white p-4 text-left shadow-sm ring-1 transition hover:shadow-md ${active === m.id ? "ring-2 ring-brand-500" : "ring-slate-200"}`}
          >
            <div className="flex items-center justify-between">
              <span className={`flex h-8 w-8 items-center justify-center rounded-lg ${tone}`}>
                <Icon className="h-4 w-4" />
              </span>
              <span className="text-xs font-semibold text-slate-400">Module {m.letter}</span>
            </div>
            <div className="mt-3 line-clamp-2 min-h-10 text-sm font-semibold leading-tight">{m.label}</div>
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-100">
              <div className={`h-full rounded-full ${m.critical ? "bg-red-500" : m.warning ? "bg-amber-400" : "bg-emerald-500"}`} style={{ width: `${Math.max(pct, 4)}%` }} />
            </div>
            <div className="mt-2 flex gap-3 text-xs tabular-nums">
              <span className={m.critical ? "font-semibold text-red-600" : "text-slate-400"}>🔴 {m.critical}</span>
              <span className={m.warning ? "font-semibold text-amber-600" : "text-slate-400"}>🟡 {m.warning}</span>
              <span className="text-emerald-600">🟢 {m.passed}</span>
            </div>
          </button>
        );
      })}
    </div>
  );
}
