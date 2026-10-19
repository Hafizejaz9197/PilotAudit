export const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 PilotAudit/1.0";

export interface HttpResult {
  status: number;
  finalUrl: string;
  contentType: string;
  body?: string;
  error?: string;
}

/**
 * GET with a timeout. Uses GET rather than HEAD because many WordPress/CDN setups
 * answer HEAD with 403/405 even when the page is fine.
 */
export async function httpGet(
  url: string,
  { timeoutMs = 12000, readBody = false }: { timeoutMs?: number; readBody?: boolean } = {},
): Promise<HttpResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "user-agent": USER_AGENT,
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "en-US,en;q=0.9",
      },
    });
    const contentType = res.headers.get("content-type") ?? "";
    let body: string | undefined;
    if (readBody) body = await res.text();
    else await res.body?.cancel().catch(() => undefined);
    return { status: res.status, finalUrl: res.url || url, contentType, body };
  } catch (err) {
    const message =
      err instanceof Error && err.name === "AbortError" ? `Timed out after ${timeoutMs / 1000}s` : errorMessage(err);
    return { status: 0, finalUrl: url, contentType: "", error: message };
  } finally {
    clearTimeout(timer);
  }
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error) {
    const cause = (err as Error & { cause?: { code?: string; message?: string } }).cause;
    return cause?.code ? `${err.message} (${cause.code})` : err.message;
  }
  return String(err);
}

/** Runs async tasks with bounded concurrency, preserving input order. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}
