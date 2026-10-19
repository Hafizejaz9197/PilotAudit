"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { History, ShieldCheck } from "lucide-react";
import { loadHistory, saveHistory, clearHistory, streamAudit } from "@/lib/client";
import type { AuditReport, ScanMode, StageId } from "@/lib/types";
import ScanBar from "./ScanBar";
import ProgressPanel from "./ProgressPanel";
import ReportView from "./ReportView";
import HistoryPanel from "./HistoryPanel";
import EmptyState from "./EmptyState";

export interface ProgressState {
  stage: StageId;
  message: string;
  percent: number;
  log: string[];
}

export default function Dashboard() {
  const [url, setUrl] = useState("");
  const [mode, setMode] = useState<ScanMode>("quick");
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<ProgressState | null>(null);
  const [report, setReport] = useState<AuditReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<AuditReport[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => setHistory(loadHistory()), []);

  const start = useCallback(
    async (target = url, scanMode = mode) => {
      if (!target.trim() || running) return;
      const controller = new AbortController();
      abortRef.current = controller;
      setRunning(true);
      setError(null);
      setReport(null);
      setProgress({ stage: "fetch", message: "Starting audit…", percent: 1, log: [] });
      try {
        await streamAudit(
          target,
          scanMode,
          (event) => {
            if (event.type === "progress") {
              setProgress((prev) => ({
                stage: event.stage,
                message: event.message,
                percent: event.percent,
                log: [...(prev?.log ?? []), event.message].slice(-40),
              }));
            } else if (event.type === "result") {
              setReport(event.report);
              setHistory(saveHistory(event.report));
            } else {
              setError(event.message);
            }
          },
          controller.signal,
        );
      } catch (err) {
        if (!controller.signal.aborted) setError(err instanceof Error ? err.message : String(err));
      } finally {
        setRunning(false);
        setProgress(null);
        abortRef.current = null;
      }
    },
    [url, mode, running],
  );

  const runDemo = () => {
    const demo = `${window.location.origin}/demo-clinic/index.html`;
    setUrl(demo);
    setMode("full");
    void start(demo, "full");
  };

  return (
    <div className="min-h-screen">
      <header className="bg-navy-900 text-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-500/15 ring-1 ring-brand-500/40">
              <ShieldCheck className="h-5 w-5 text-brand-500" />
            </div>
            <div>
              <div className="text-lg font-bold tracking-tight">
                Pilot<span className="text-brand-500">Audit</span>
              </div>
              <div className="-mt-0.5 text-xs text-slate-400">AI Website QA &amp; Audit Engine</div>
            </div>
          </div>
          <button
            onClick={() => setShowHistory((v) => !v)}
            className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-300 hover:bg-white/10 hover:text-white"
          >
            <History className="h-4 w-4" />
            <span className="hidden sm:inline">Recent audits</span>
            {history.length > 0 && <span className="rounded-full bg-white/15 px-1.5 text-xs">{history.length}</span>}
          </button>
        </div>
        <div className="mx-auto max-w-7xl px-4 pb-8 pt-2 sm:px-6">
          <ScanBar
            url={url}
            mode={mode}
            running={running}
            onUrlChange={setUrl}
            onModeChange={setMode}
            onScan={() => start()}
            onCancel={() => abortRef.current?.abort()}
            onDemo={runDemo}
          />
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        {showHistory && (
          <HistoryPanel
            history={history}
            activeId={report?.id}
            onOpen={(r) => {
              setReport(r);
              setShowHistory(false);
            }}
            onClear={() => {
              clearHistory();
              setHistory([]);
            }}
            onClose={() => setShowHistory(false)}
          />
        )}
        {error && (
          <div className="mb-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            <strong>Audit failed:</strong> {error}
          </div>
        )}
        {running && progress && <ProgressPanel progress={progress} />}
        {!running && report && <ReportView report={report} onRescan={() => start(report.url, report.mode)} />}
        {!running && !report && <EmptyState onDemo={runDemo} />}
      </main>

      <footer className="pb-8 text-center text-xs text-slate-400">PilotAudit · Built for dental &amp; healthcare marketing QA</footer>
    </div>
  );
}
