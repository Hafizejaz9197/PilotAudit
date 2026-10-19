"use client";

import { useState } from "react";
import type { AuditReport } from "@/lib/types";
import { pathOf } from "@/lib/report/format";

export default function PagesTable({ report }: { report: AuditReport }) {
  const [tab, setTab] = useState<"pages" | "links">("pages");
  const broken = report.links.list.filter((l) => !l.ok);

  return (
    <section className="rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
      <div className="flex gap-4 border-b border-slate-200 px-5 pt-4 text-sm">
        {(["pages", "links"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={`border-b-2 pb-3 font-semibold ${tab === t ? "border-brand-500 text-slate-900" : "border-transparent text-slate-400"}`}>
            {t === "pages" ? `Pages scanned (${report.pages.length})` : `Broken links (${broken.length})`}
          </button>
        ))}
      </div>
      <div className="max-h-80 overflow-y-auto scrollbar-thin">
        {tab === "pages" ? (
          <table className="w-full text-sm">
            <tbody className="divide-y divide-slate-100">
              {report.pages.map((p) => (
                <tr key={p.url}>
                  <td className="max-w-0 px-5 py-2.5">
                    <a href={p.url} target="_blank" rel="noreferrer" className="block truncate font-mono text-xs text-slate-700 hover:text-brand-700">
                      {pathOf(p.url)}
                    </a>
                    <div className="truncate text-xs text-slate-400">{p.title || p.error || "—"}</div>
                  </td>
                  <td className="px-2 py-2.5 text-right">
                    <StatusPill status={p.status} />
                  </td>
                  <td className="whitespace-nowrap px-5 py-2.5 text-right text-xs tabular-nums text-slate-500">
                    {p.loadTimeMs ? `${(p.loadTimeMs / 1000).toFixed(1)}s` : "—"}
                    {p.bytes > 0 && <div className="text-slate-400">{(p.bytes / 1024 / 1024).toFixed(1)} MB</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : broken.length === 0 ? (
          <div className="px-5 py-8 text-center text-sm text-slate-500">All {report.links.checked} checked links are healthy 🎉</div>
        ) : (
          <ul className="divide-y divide-slate-100 text-sm">
            {broken.map((l) => (
              <li key={l.url} className="flex items-start gap-3 px-5 py-2.5">
                <StatusPill status={l.status} />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-mono text-xs">{l.url}</div>
                  <div className="truncate text-xs text-slate-400">
                    {l.internal ? "Internal" : "External"} {l.source} · on {l.foundOn.map(pathOf).slice(0, 3).join(", ")}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function StatusPill({ status }: { status: number }) {
  const bad = status === 0 || status >= 400;
  return (
    <span className={`inline-block rounded-md px-1.5 py-0.5 font-mono text-xs font-semibold ${bad ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-700"}`}>
      {status || "ERR"}
    </span>
  );
}
