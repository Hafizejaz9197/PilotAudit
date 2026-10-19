"use client";

import { Check, Loader2 } from "lucide-react";
import { STAGES } from "@/lib/types";
import type { ProgressState } from "./Dashboard";

export default function ProgressPanel({ progress }: { progress: ProgressState }) {
  const activeIndex = STAGES.findIndex((s) => s.id === progress.stage);
  return (
    <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200 sm:p-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Audit in progress</h2>
        <span className="text-sm font-semibold tabular-nums text-brand-700">{progress.percent}%</span>
      </div>
      <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-slate-100">
        <div className="progress-stripes h-full rounded-full bg-brand-500 transition-all duration-500" style={{ width: `${progress.percent}%` }} />
      </div>

      <ol className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-5">
        {STAGES.map((stage, i) => {
          const state = i < activeIndex ? "done" : i === activeIndex ? "active" : "todo";
          return (
            <li
              key={stage.id}
              className={`flex items-center gap-3 rounded-xl border px-3 py-3 text-sm ${
                state === "active" ? "border-brand-500 bg-brand-50" : state === "done" ? "border-emerald-200 bg-emerald-50/60" : "border-slate-200"
              }`}
            >
              <span
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                  state === "done" ? "bg-emerald-500 text-white" : state === "active" ? "bg-brand-500 text-white" : "bg-slate-100 text-slate-400"
                }`}
              >
                {state === "done" ? <Check className="h-4 w-4" /> : state === "active" ? <Loader2 className="h-4 w-4 animate-spin" /> : i + 1}
              </span>
              <span className={state === "todo" ? "text-slate-400" : "font-medium text-slate-800"}>{stage.label}</span>
            </li>
          );
        })}
      </ol>

      <div className="mt-5 rounded-xl bg-slate-950 p-4 font-mono text-xs text-slate-300">
        <div className="max-h-40 space-y-1 overflow-y-auto scrollbar-thin">
          {progress.log.slice(-8).map((line, i, arr) => (
            <div key={`${i}-${line}`} className={i === arr.length - 1 ? "text-brand-500" : ""}>
              <span className="text-slate-600">›</span> {line}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
