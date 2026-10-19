import { pdfFileName, renderPdf } from "@/lib/report/pdf";
import type { AuditReport } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  let report: AuditReport;
  try {
    report = (await request.json()).report;
    if (!report?.checks || !report.url) throw new Error("missing report");
  } catch {
    return Response.json({ error: "Expected { report } in the request body" }, { status: 400 });
  }
  try {
    const pdf = await renderPdf(report);
    return new Response(new Uint8Array(pdf), {
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `attachment; filename="${pdfFileName(report)}"`,
        "cache-control": "no-store",
      },
    });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 503 });
  }
}
