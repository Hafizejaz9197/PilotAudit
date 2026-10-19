"use client";

import { Trash2, X } from "lucide-react";
import type { AuditReport } from "@/lib/types";
import { formatDateTime } from "@/lib/report/format";
import { scoreTone } from "./ScoreCard";

interface Props {
  history: AuditReport[];
  activeId?: string;
  onOpen: (report: AuditReport) => void;
  onClear: () => void;
  onClose: () => void;
}

export default function HistoryPanel({ history, activeId, onOpen, onClear, onClose }: Props) {
  return (
    <section className="mb-6 rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
      <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
        <h2 className="font-semibold">Recent audits</h2>
        <div className="flex items-center gap-1">
          {history.length > 0 && (
            <button onClick={onClear} className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-slate-500 hover:bg-slate-100">
              <Trash2 className="h-3.5 w-3.5" /> Clear
            </button>
          )}
          <button onClick={onClose} className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
      {history.length === 0 ? (
        <p className="px-5 py-6 text-sm text-slate-500">No audits yet. Reports are saved in this browser.</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {history.map((r) => (
            <li key={r.id}>
              <button onClick={() => onOpen(r)} className={`flex w-full items-center gap-4 px-5 py-3 text-left hover:bg-slate-50 ${r.id === activeId ? "bg-brand-50" : ""}`}>
                <span className={`w-12 text-lg font-bold tabular-nums ${scoreTone(r.score).text}`}>{r.score}%</span>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{r.siteName}</div>
                  <div className="truncate text-xs text-slate-400">{r.url}</div>
                </div>
                <div className="hidden text-right text-xs text-slate-500 sm:block">
                  <div>🔴 {r.counts.critical} · 🟡 {r.counts.warning}</div>
                  <div>{formatDateTime(r.finishedAt)}</div>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
