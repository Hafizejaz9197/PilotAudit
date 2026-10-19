"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, Copy, Download, X } from "lucide-react";
import type { AuditReport } from "@/lib/types";
import { copyText, downloadBlob } from "@/lib/client";
import { jiraMarkdown, jiraTickets } from "@/lib/report/jira";

export default function JiraModal({ report, onClose }: { report: AuditReport; onClose: () => void }) {
  const tickets = useMemo(() => jiraTickets(report), [report]);
  const [selected, setSelected] = useState(0);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const flash = (key: string) => {
    setCopied(key);
    setTimeout(() => setCopied(null), 1800);
  };
  const ticket = tickets[selected];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-3 sm:p-6" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Jira tickets"
        className="flex max-h-full w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl md:h-[85vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <div>
            <h2 className="text-lg font-semibold">Send to Jira</h2>
            <p className="text-xs text-slate-500">{tickets.length} bug tickets formatted as Markdown — paste into a new Jira issue</p>
          </div>
          <button onClick={onClose} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>

        {tickets.length === 0 ? (
          <div className="p-10 text-center text-slate-500">No failing checks — nothing to ticket. 🎉</div>
        ) : (
          <div className="grid min-h-0 flex-1 md:grid-cols-[280px_1fr]">
            <ul className="max-h-48 overflow-y-auto border-b border-slate-200 md:max-h-none md:border-b-0 md:border-r">
              {tickets.map((t, i) => (
                <li key={t.checkId}>
                  <button
                    onClick={() => setSelected(i)}
                    className={`w-full border-l-4 px-4 py-3 text-left text-sm ${
                      i === selected ? "border-brand-500 bg-brand-50" : "border-transparent hover:bg-slate-50"
                    }`}
                  >
                    <span className={`mr-2 rounded px-1.5 py-0.5 text-[10px] font-bold text-white ${t.priority === "Highest" ? "bg-red-500" : "bg-amber-500"}`}>
                      {t.priority === "Highest" ? "CRIT" : "WARN"}
                    </span>
                    {report.checks.find((c) => c.id === t.checkId)?.label}
                  </button>
                </li>
              ))}
            </ul>
            <div className="flex min-h-0 flex-col">
              <div className="border-b border-slate-200 px-5 py-3">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Summary</div>
                <div className="flex items-start gap-2">
                  <p className="flex-1 text-sm font-medium">{ticket.title}</p>
                  <button
                    onClick={async () => {
                      await copyText(ticket.title);
                      flash("title");
                    }}
                    className="shrink-0 rounded-md p-1.5 text-slate-500 hover:bg-slate-100"
                    aria-label="Copy summary"
                  >
                    {copied === "title" ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
                  </button>
                </div>
              </div>
              <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap bg-slate-50 px-5 py-4 font-mono text-xs leading-relaxed text-slate-700">
                {ticket.body}
              </pre>
            </div>
          </div>
        )}

        <div className="flex flex-wrap justify-end gap-2 border-t border-slate-200 px-5 py-3">
          <button
            onClick={() => downloadBlob(new Blob([jiraMarkdown(report, tickets)], { type: "text/markdown" }), `pilotaudit-jira-${new URL(report.url).hostname}.md`)}
            className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50"
          >
            <Download className="h-4 w-4" /> Download .md
          </button>
          <button
            onClick={async () => {
              await copyText(jiraMarkdown(report, tickets));
              flash("all");
            }}
            className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50"
          >
            {copied === "all" ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />} Copy all tickets
          </button>
          {ticket && (
            <button
              onClick={async () => {
                await copyText(ticket.body);
                flash("body");
              }}
              className="flex items-center gap-2 rounded-lg bg-[#0052CC] px-4 py-2 text-sm font-semibold text-white hover:bg-[#0747a6]"
            >
              {copied === "body" ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />} Copy ticket description
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
