"use client";

import type { AuditEvent, AuditReport, ScanMode } from "./types";

/** Starts an audit and feeds streamed NDJSON events to the callback. */
export async function streamAudit(url: string, mode: ScanMode, onEvent: (event: AuditEvent) => void, signal?: AbortSignal) {
  const res = await fetch("/api/audit", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url, mode }),
    signal,
  });
  if (!res.ok || !res.body) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error ?? `Audit request failed (HTTP ${res.status})`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let newline: number;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line) onEvent(JSON.parse(line) as AuditEvent);
    }
  }
  if (buffer.trim()) onEvent(JSON.parse(buffer) as AuditEvent);
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    return ok;
  }
}

export function downloadBlob(blob: Blob, filename: string) {
  const href = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = href;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 2000);
}

const HISTORY_KEY = "pilotaudit.history.v1";
const MAX_HISTORY = 8;

export function loadHistory(): AuditReport[] {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) ?? "[]") as AuditReport[];
  } catch {
    return [];
  }
}

/** Keeps recent reports per browser; only the newest keeps its screenshots to stay within storage limits. */
export function saveHistory(report: AuditReport): AuditReport[] {
  const rest = loadHistory()
    .filter((r) => r.id !== report.id)
    .map((r) => ({ ...r, screenshots: {} }));
  let history = [report, ...rest].slice(0, MAX_HISTORY);
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
  } catch {
    history = [{ ...report, screenshots: {} }, ...rest].slice(0, MAX_HISTORY);
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
    } catch {
      /* storage unavailable */
    }
  }
  return history;
}

export function clearHistory() {
  try {
    localStorage.removeItem(HISTORY_KEY);
  } catch {
    /* ignore */
  }
}
