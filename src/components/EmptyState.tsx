"use client";

import { Sparkles } from "lucide-react";
import { MODULES, type ModuleId } from "@/lib/types";
import { MODULE_ICONS } from "./moduleIcons";

export default function EmptyState({ onDemo }: { onDemo: () => void }) {
  return (
    <section className="space-y-6">
      <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200 sm:p-8">
        <h1 className="text-2xl font-bold tracking-tight">Catch AI website bugs before patients do</h1>
        <p className="mt-2 max-w-3xl text-slate-600">
          PilotAudit renders WordPress, Webflow and custom dental &amp; healthcare sites in a real browser (desktop and iPhone viewports), runs
          five audit modules, and turns the results into a client-ready report you can paste into Slack, Jira or send as a PDF.
        </p>
        <button onClick={onDemo} className="mt-5 inline-flex items-center gap-2 rounded-lg bg-navy-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-navy-800">
          <Sparkles className="h-4 w-4 text-brand-500" />
          Run a demo audit
        </button>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {(Object.keys(MODULES) as ModuleId[]).map((id) => {
          const Icon = MODULE_ICONS[id];
          return (
            <div key={id} className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-50 text-brand-700">
                <Icon className="h-5 w-5" />
              </div>
              <div className="mt-3 text-xs font-semibold uppercase tracking-wide text-slate-400">Module {MODULES[id].letter}</div>
              <div className="font-semibold">{MODULES[id].label}</div>
              <p className="mt-1 text-sm text-slate-500">{MODULES[id].description}</p>
            </div>
          );
        })}
      </div>
    </section>
  );
}
