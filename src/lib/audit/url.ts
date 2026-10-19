import { lookup } from "node:dns/promises";
import net from "node:net";

const SKIP_EXTENSIONS =
  /\.(pdf|jpe?g|png|gif|webp|avif|svg|ico|css|js|mjs|json|xml|txt|zip|rar|gz|mp4|mov|webm|mp3|wav|docx?|xlsx?|pptx?|woff2?|ttf|eot)(\?.*)?$/i;

const SKIP_PATHS = /\/(wp-admin|wp-login\.php|wp-json|xmlrpc\.php|feed|cart|checkout|my-account)(\/|$|\?)/i;

/** Normalises user input like "example.com" into an absolute https URL. */
export function normalizeInputUrl(input: string): URL {
  const trimmed = input.trim();
  if (!trimmed) throw new Error("Please enter a website URL.");
  const withProtocol = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withProtocol);
  } catch {
    throw new Error(`"${input}" is not a valid URL.`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only http:// and https:// URLs can be audited.");
  }
  url.hash = "";
  return url;
}

/** Resolves an href against a base URL, returning null for unparsable values. */
export function resolveUrl(href: string, base: string): URL | null {
  try {
    return new URL(href, base);
  } catch {
    return null;
  }
}

/** Canonical key used to de-duplicate crawled pages. */
export function pageKey(url: URL | string): string {
  const u = new URL(url.toString());
  u.hash = "";
  const path = u.pathname.replace(/\/+$/, "") || "/";
  return `${u.protocol}//${u.host.replace(/^www\./, "")}${path}${u.search}`;
}

export function sameSite(a: URL, b: URL): boolean {
  return a.hostname.replace(/^www\./, "") === b.hostname.replace(/^www\./, "");
}

/** Whether a link is worth crawling as an HTML page. */
export function isCrawlable(url: URL, root: URL): boolean {
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  if (!sameSite(url, root)) return false;
  if (SKIP_EXTENSIONS.test(url.pathname)) return false;
  if (SKIP_PATHS.test(url.pathname)) return false;
  return true;
}

function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return (
      a === 10 ||
      a === 127 ||
      a === 0 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127)
    );
  }
  const lower = ip.toLowerCase();
  if (lower.startsWith("::ffff:")) return isPrivateIp(lower.slice(7));
  return lower === "::1" || lower === "::" || lower.startsWith("fc") || lower.startsWith("fd") || lower.startsWith("fe80");
}

/**
 * Private/loopback targets are refused in production unless ALLOW_PRIVATE_HOSTS=true,
 * so a publicly hosted PilotAudit cannot be used to probe internal networks.
 */
export function privateHostsAllowed(): boolean {
  if (process.env.ALLOW_PRIVATE_HOSTS) return process.env.ALLOW_PRIVATE_HOSTS === "true";
  return process.env.NODE_ENV !== "production";
}

export async function assertPublicHost(url: URL): Promise<void> {
  if (privateHostsAllowed()) return;
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal")) {
    throw new Error("Auditing localhost/internal hosts is disabled on this server.");
  }
  const addresses = net.isIP(host) ? [host] : (await lookup(host, { all: true })).map((r) => r.address);
  if (addresses.some(isPrivateIp)) {
    throw new Error("Auditing private network addresses is disabled on this server.");
  }
}

export function shortPath(url: string): string {
  try {
    const u = new URL(url);
    return (u.pathname + u.search) || "/";
  } catch {
    return url;
  }
}
