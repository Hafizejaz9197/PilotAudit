"use client";

import { Globe, Loader2, Play, Sparkles, Square, Zap, Layers } from "lucide-react";
import type { ScanMode } from "@/lib/types";

interface Props {
  url: string;
  mode: ScanMode;
  running: boolean;
  onUrlChange: (url: string) => void;
  onModeChange: (mode: ScanMode) => void;
  onScan: () => void;
  onCancel: () => void;
  onDemo: () => void;
}

const MODES: { id: ScanMode; label: string; hint: string; icon: typeof Zap }[] = [
  { id: "quick", label: "Quick Scan", hint: "Homepage + header/footer + lead form pages", icon: Zap },
  { id: "full", label: "Full Scan", hint: "Crawls all internal links, up to 20 pages", icon: Layers },
];

export default function ScanBar({ url, mode, running, onUrlChange, onModeChange, onScan, onCancel, onDemo }: Props) {
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onScan();
      }}
      className="rounded-2xl bg-white/5 p-3 ring-1 ring-white/10 sm:p-4"
    >
      <div className="flex flex-col gap-3 lg:flex-row">
        <label className="flex flex-1 items-center gap-3 rounded-xl bg-white px-4 py-3 text-slate-900 shadow-sm focus-within:ring-2 focus-within:ring-brand-500">
          <Globe className="h-5 w-5 shrink-0 text-slate-400" />
          <input
            type="text"
            inputMode="url"
            autoComplete="url"
            spellCheck={false}
            value={url}
            disabled={running}
            onChange={(e) => onUrlChange(e.target.value)}
            placeholder="Enter Website URL — e.g. brightsmiledental.com"
            className="w-full bg-transparent text-base outline-none placeholder:text-slate-400 disabled:opacity-60"
          />
        </label>

        <div className="flex rounded-xl bg-navy-800 p-1 ring-1 ring-white/10" role="radiogroup" aria-label="Scan mode">
          {MODES.map(({ id, label, hint, icon: Icon }) => (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={mode === id}
              title={hint}
              disabled={running}
              onClick={() => onModeChange(id)}
              className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition lg:flex-none ${
                mode === id ? "bg-white text-navy-900 shadow" : "text-slate-300 hover:text-white"
              }`}
            >
              <Icon className="h-4 w-4" />
              {label}
            </button>
          ))}
        </div>

        {running ? (
          <button
            type="button"
            onClick={onCancel}
            className="flex items-center justify-center gap-2 rounded-xl bg-slate-700 px-6 py-3 font-semibold text-white hover:bg-slate-600"
          >
            <Loader2 className="h-4 w-4 animate-spin" />
            Scanning… <Square className="h-3.5 w-3.5 fill-current" />
          </button>
        ) : (
          <button
            type="submit"
            disabled={!url.trim()}
            className="flex items-center justify-center gap-2 rounded-xl bg-brand-500 px-6 py-3 font-semibold text-navy-900 shadow-lg shadow-brand-500/20 transition hover:bg-brand-100 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Play className="h-4 w-4 fill-current" />
            Run Audit
          </button>
        )}
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 px-1 text-xs text-slate-400">
        <span>{MODES.find((m) => m.id === mode)?.hint}</span>
        {!running && (
          <button type="button" onClick={onDemo} className="flex items-center gap-1 text-brand-500 hover:text-brand-100">
            <Sparkles className="h-3.5 w-3.5" />
            Try the bundled demo clinic site (seeded with AI bugs)
          </button>
        )}
      </div>
    </form>
  );
}
