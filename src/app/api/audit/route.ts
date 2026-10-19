import { runAudit } from "@/lib/audit/engine";
import type { AuditEvent, ScanMode } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Streams audit progress as newline-delimited JSON, ending with a result or error event. */
export async function POST(request: Request) {
  let body: { url?: string; mode?: ScanMode };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const url = body.url?.trim();
  if (!url) return Response.json({ error: "Missing url" }, { status: 400 });
  const mode: ScanMode = body.mode === "full" ? "full" : "quick";

  // The bundled demo site lives on this server, so auditing our own origin is always allowed.
  const own = new URL(request.url);
  let allowPrivateHost = false;
  try {
    allowPrivateHost = new URL(url).host === own.host;
  } catch {
    /* validated inside runAudit */
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: AuditEvent) => {
        try {
          controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
        } catch {
          /* client went away */
        }
      };
      try {
        const report = await runAudit(url, {
          mode,
          allowPrivateHost,
          signal: request.signal,
          onProgress: (stage, message, percent) => send({ type: "progress", stage, message, percent }),
        });
        send({ type: "result", report });
      } catch (err) {
        send({ type: "error", message: err instanceof Error ? err.message : String(err) });
      } finally {
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-store",
      "x-accel-buffering": "no",
    },
  });
}
