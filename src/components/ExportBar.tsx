"use client";

import { useState } from "react";
import { Check, Download, FileText, Loader2, MessageSquare, Ticket } from "lucide-react";
import type { AuditReport } from "@/lib/types";
import { copyText, downloadBlob } from "@/lib/client";
import { slackSummary } from "@/lib/report/slack";
import { reportHtml } from "@/lib/report/pdfHtml";
import JiraModal from "./JiraModal";

type Status = "idle" | "busy" | "done";

export default function ExportBar({ report }: { report: AuditReport }) {
  const [slack, setSlack] = useState<Status>("idle");
  const [pdf, setPdf] = useState<Status>("idle");
  const [jiraOpen, setJiraOpen] = useState(false);
  const [pdfNote, setPdfNote] = useState<string | null>(null);

  const copySlack = async () => {
    await copyText(slackSummary(report));
    setSlack("done");
    setTimeout(() => setSlack("idle"), 2000);
  };

  const downloadPdf = async () => {
    setPdf("busy");
    setPdfNote(null);
    try {
      const res = await fetch("/api/report/pdf", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ report }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`);
      const host = new URL(report.url).hostname.replace(/^www\./, "");
      downloadBlob(await res.blob(), `pilotaudit-${host}-${report.finishedAt.slice(0, 10)}.pdf`);
      setPdf("done");
      setTimeout(() => setPdf("idle"), 2000);
    } catch (err) {
      // Fall back to the browser's print dialog ("Save as PDF").
      const blob = new Blob([reportHtml(report, { autoPrint: true })], { type: "text/html" });
      window.open(URL.createObjectURL(blob), "_blank");
      setPdfNote(`Server PDF unavailable (${err instanceof Error ? err.message : err}) — opened a printable version instead.`);
      setPdf("idle");
    }
  };

  const openPreview = () => {
    const blob = new Blob([reportHtml(report)], { type: "text/html" });
    window.open(URL.createObjectURL(blob), "_blank");
  };

  const button = "flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left text-sm font-semibold transition";

  return (
    <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">One-click reporting</h2>
      <p className="mt-1 text-xs text-slate-400">Client-ready exports for leadership and the dev team</p>
      <div className="mt-4 space-y-2">
        <button onClick={copySlack} className={`${button} bg-[#4A154B] text-white hover:bg-[#611f64]`}>
          {slack === "done" ? <Check className="h-5 w-5" /> : <MessageSquare className="h-5 w-5" />}
          <span className="flex-1">{slack === "done" ? "Copied to clipboard!" : "Copy Slack Summary"}</span>
        </button>
        <button onClick={downloadPdf} disabled={pdf === "busy"} className={`${button} bg-navy-900 text-white hover:bg-navy-800 disabled:opacity-70`}>
          {pdf === "busy" ? <Loader2 className="h-5 w-5 animate-spin" /> : pdf === "done" ? <Check className="h-5 w-5" /> : <Download className="h-5 w-5" />}
          <span className="flex-1">{pdf === "busy" ? "Rendering PDF…" : pdf === "done" ? "PDF downloaded" : "Download PDF Report"}</span>
        </button>
        <button onClick={() => setJiraOpen(true)} className={`${button} bg-[#0052CC] text-white hover:bg-[#0747a6]`}>
          <Ticket className="h-5 w-5" />
          <span className="flex-1">Send to Jira</span>
          <span className="rounded-full bg-white/20 px-2 text-xs">{report.counts.critical + report.counts.warning}</span>
        </button>
        <button onClick={openPreview} className={`${button} bg-slate-50 text-slate-700 ring-1 ring-slate-200 hover:bg-slate-100`}>
          <FileText className="h-5 w-5" />
          <span className="flex-1">Preview report</span>
        </button>
      </div>
      {pdfNote && <p className="mt-3 text-xs text-amber-700">{pdfNote}</p>}
      {jiraOpen && <JiraModal report={report} onClose={() => setJiraOpen(false)} />}
    </section>
  );
}
