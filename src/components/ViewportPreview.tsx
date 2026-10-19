"use client";

import { useState } from "react";
import { Image as ImageIcon, Monitor, MonitorPlay, Smartphone } from "lucide-react";
import type { AuditReport } from "@/lib/types";

type View = "snapshot" | "live";

export default function ViewportPreview({ report }: { report: AuditReport }) {
  const [view, setView] = useState<View>(report.screenshots.desktop ? "snapshot" : "live");
  const hasShots = Boolean(report.screenshots.desktop || report.screenshots.mobile);

  return (
    <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">Desktop vs. mobile</h2>
        <div className="flex rounded-lg bg-slate-100 p-1 text-xs">
          <button
            onClick={() => setView("snapshot")}
            disabled={!hasShots}
            className={`flex items-center gap-1 rounded-md px-2.5 py-1 font-medium disabled:opacity-40 ${view === "snapshot" ? "bg-white shadow-sm" : "text-slate-500"}`}
          >
            <ImageIcon className="h-3.5 w-3.5" /> Snapshot
          </button>
          <button
            onClick={() => setView("live")}
            className={`flex items-center gap-1 rounded-md px-2.5 py-1 font-medium ${view === "live" ? "bg-white shadow-sm" : "text-slate-500"}`}
          >
            <MonitorPlay className="h-3.5 w-3.5" /> Live
          </button>
        </div>
      </div>

      <div className="mt-4 flex items-start gap-3">
        {/* Desktop frame */}
        <div className="min-w-0 flex-[3]">
          <div className="mb-1.5 flex items-center gap-1 text-xs font-medium text-slate-500">
            <Monitor className="h-3.5 w-3.5" /> Desktop · 1440px
          </div>
          <div className="overflow-hidden rounded-lg ring-1 ring-slate-300">
            <div className="flex items-center gap-1 bg-slate-200 px-2 py-1.5">
              <span className="h-2 w-2 rounded-full bg-red-400" />
              <span className="h-2 w-2 rounded-full bg-amber-400" />
              <span className="h-2 w-2 rounded-full bg-emerald-400" />
              <span className="ml-2 truncate rounded bg-white px-2 text-[10px] text-slate-500">{report.url}</span>
            </div>
            <div className="relative h-72 overflow-y-auto bg-white scrollbar-thin">
              {view === "snapshot" && report.screenshots.desktop ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={report.screenshots.desktop} alt="Desktop rendering" className="w-full" />
              ) : view === "live" ? (
                <ScaledFrame src={report.url} width={1440} height={1800} scale={0.25} />
              ) : (
                <NoShot />
              )}
            </div>
          </div>
        </div>

        {/* Mobile frame */}
        <div className="w-28 shrink-0 sm:w-32">
          <div className="mb-1.5 flex items-center gap-1 text-xs font-medium text-slate-500">
            <Smartphone className="h-3.5 w-3.5" /> 390px
          </div>
          <div className="rounded-[1.25rem] bg-slate-900 p-1.5 shadow-lg">
            <div className="relative h-[16.5rem] overflow-y-auto rounded-[0.9rem] bg-white scrollbar-thin">
              {view === "snapshot" && report.screenshots.mobile ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={report.screenshots.mobile} alt="Mobile rendering" className="w-full" />
              ) : view === "live" ? (
                <ScaledFrame src={report.url} width={390} height={1600} scale={0.3} />
              ) : (
                <NoShot />
              )}
            </div>
          </div>
        </div>
      </div>
      {view === "live" && (
        <p className="mt-3 text-xs text-slate-400">Live preview may be blank if the site blocks embedding (X-Frame-Options / CSP).</p>
      )}
    </section>
  );
}

function ScaledFrame({ src, width, height, scale }: { src: string; width: number; height: number; scale: number }) {
  return (
    <div style={{ width: width * scale, height: height * scale }} className="max-w-full overflow-hidden">
      <iframe
        src={src}
        title={`${width}px preview`}
        sandbox="allow-scripts allow-same-origin"
        loading="lazy"
        style={{ width, height, transform: `scale(${scale})`, transformOrigin: "0 0", border: 0 }}
      />
    </div>
  );
}

function NoShot() {
  return <div className="flex h-full items-center justify-center p-4 text-center text-xs text-slate-400">No snapshot (static renderer)</div>;
}
