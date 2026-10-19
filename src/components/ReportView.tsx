"use client";

import { useMemo, useState } from "react";
import { RotateCw } from "lucide-react";
import type { AuditReport, ModuleId, Severity } from "@/lib/types";
import ScoreCard from "./ScoreCard";
import ExportBar from "./ExportBar";
import ModuleTiles from "./ModuleTiles";
import ChecksList from "./ChecksList";
import ViewportPreview from "./ViewportPreview";
import PagesTable from "./PagesTable";

export type SeverityFilter = Severity | "all";

export default function ReportView({ report, onRescan }: { report: AuditReport; onRescan: () => void }) {
  const [severity, setSeverity] = useState<SeverityFilter>("all");
  const [module, setModule] = useState<ModuleId | null>(null);

  const checks = useMemo(
    () =>
      report.checks.filter((c) => (severity === "all" || c.severity === severity) && (!module || c.module === module)),
    [report, severity, module],
  );

  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="min-w-0 lg:col-span-2">
          <ScoreCard report={report} onSeverity={(s) => setSeverity(s)} />
        </div>
        <ExportBar report={report} />
      </div>

      {report.notes.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {report.notes.map((note) => (
            <div key={note}>{note}</div>
          ))}
        </div>
      )}

      <ModuleTiles report={report} active={module} onSelect={(m) => setModule((cur) => (cur === m ? null : m))} />

      <div className="grid gap-6 xl:grid-cols-5">
        <div className="min-w-0 xl:col-span-3">
          <ChecksList
            report={report}
            checks={checks}
            severity={severity}
            module={module}
            onSeverity={setSeverity}
            onClearModule={() => setModule(null)}
          />
        </div>
        <div className="min-w-0 space-y-6 xl:col-span-2">
          <ViewportPreview report={report} />
          <PagesTable report={report} />
          <button
            onClick={onRescan}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-white px-4 py-3 text-sm font-semibold text-slate-700 shadow-sm ring-1 ring-slate-200 hover:bg-slate-50"
          >
            <RotateCw className="h-4 w-4" /> Re-run this {report.mode} scan
          </button>
        </div>
      </div>
    </div>
  );
}
