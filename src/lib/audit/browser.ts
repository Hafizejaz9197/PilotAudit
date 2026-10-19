import type { Browser, BrowserContext, Page } from "playwright";
import { errorMessage, httpGet, USER_AGENT } from "./http";

export interface Resource {
  url: string;
  type: string;
  status: number;
  contentType: string;
  bytes: number;
}

export interface PageSnapshot {
  url: string;
  finalUrl: string;
  status: number;
  html: string;
  loadTimeMs: number;
  resources: Resource[];
  /** True when the HTML came from a real browser (runtime annotations available). */
  rendered: boolean;
  error?: string;
}

export interface MobileMetrics {
  url: string;
  viewportMeta: string | null;
  viewportWidth: number;
  scrollWidth: number;
  overflowOffenders: string[];
  smallTapTargets: { count: number; samples: string[] };
  smallText: { count: number; samples: string[] };
  hasPhoneLink: boolean;
  phoneAboveFold: boolean;
}

const DESKTOP = { width: 1440, height: 900 };
const MOBILE = { width: 390, height: 844 };
const MOBILE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1 PilotAudit/1.0";

/**
 * Records which elements get click-like listeners so the audit can tell a CTA
 * <button> wired up by JavaScript from a dead one. Runs before any page script.
 */
const CLICK_TRACKER = `(() => {
  const marked = new WeakSet();
  Object.defineProperty(window, "__paClick", { value: marked, enumerable: false });
  const types = new Set(["click","mousedown","mouseup","pointerdown","pointerup","touchstart","touchend","submit"]);
  const original = EventTarget.prototype.addEventListener;
  EventTarget.prototype.addEventListener = function (type, ...rest) {
    if (types.has(type)) { try { marked.add(this); } catch (e) {} }
    return original.call(this, type, ...rest);
  };
})();`;

/** tsx/esbuild may wrap functions passed to page.evaluate in a __name() helper; provide a no-op. */
const NAME_SHIM = `window.__name = window.__name || ((fn) => fn);`;

export async function launchBrowser(): Promise<{ browser: Browser | null; error?: string }> {
  try {
    const { chromium } = await import("playwright");
    const browser = await chromium.launch({
      headless: true,
      executablePath: process.env.CHROMIUM_PATH || undefined,
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
    });
    return { browser };
  } catch (err) {
    return { browser: null, error: errorMessage(err).split("\n")[0] };
  }
}

export class Renderer {
  private desktop?: BrowserContext;
  private mobile?: BrowserContext;

  constructor(private browser: Browser) {}

  private async desktopContext() {
    if (!this.desktop) {
      this.desktop = await this.browser.newContext({ viewport: DESKTOP, userAgent: USER_AGENT, ignoreHTTPSErrors: true });
      await this.desktop.addInitScript(NAME_SHIM);
      await this.desktop.addInitScript(CLICK_TRACKER);
    }
    return this.desktop;
  }

  private async mobileContext() {
    if (!this.mobile) {
      this.mobile = await this.browser.newContext({
        viewport: MOBILE,
        userAgent: MOBILE_UA,
        isMobile: true,
        hasTouch: true,
        deviceScaleFactor: 2,
        ignoreHTTPSErrors: true,
      });
      await this.mobile.addInitScript(NAME_SHIM);
    }
    return this.mobile;
  }

  async snapshot(url: string, { screenshot = false } = {}): Promise<PageSnapshot & { screenshot?: string }> {
    const context = await this.desktopContext();
    const page = await context.newPage();
    const resources: Promise<Resource | null>[] = [];
    page.on("response", (response) => {
      resources.push(
        (async () => {
          const request = response.request();
          let bytes = Number(response.headers()["content-length"] ?? 0);
          if (!bytes) bytes = (await request.sizes().catch(() => null))?.responseBodySize ?? 0;
          return {
            url: response.url(),
            type: request.resourceType(),
            status: response.status(),
            contentType: response.headers()["content-type"] ?? "",
            bytes,
          };
        })().catch(() => null),
      );
    });

    try {
      const started = Date.now();
      const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
      await page.waitForLoadState("load", { timeout: 15000 }).catch(() => undefined);
      await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => undefined);
      const loadTimeMs = await page
        .evaluate(() => {
          const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
          return nav && nav.loadEventEnd > 0 ? Math.round(nav.loadEventEnd) : 0;
        })
        .catch(() => 0);
      await autoScroll(page);
      await annotateDom(page);
      const html = await page.content();
      let shot: string | undefined;
      if (screenshot) shot = await capture(page, 3200);
      return {
        url,
        finalUrl: page.url(),
        status: response?.status() ?? 0,
        html,
        loadTimeMs: loadTimeMs || Date.now() - started,
        resources: (await Promise.all(resources)).filter((r): r is Resource => r !== null),
        rendered: true,
        screenshot: shot,
      };
    } catch (err) {
      return { url, finalUrl: url, status: 0, html: "", loadTimeMs: 0, resources: [], rendered: true, error: errorMessage(err).split("\n")[0] };
    } finally {
      await page.close().catch(() => undefined);
    }
  }

  async mobileCheck(url: string, { screenshot = false } = {}): Promise<{ metrics: MobileMetrics | null; screenshot?: string }> {
    const context = await this.mobileContext();
    const page = await context.newPage();
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
      await page.waitForLoadState("load", { timeout: 15000 }).catch(() => undefined);
      await page.waitForLoadState("networkidle", { timeout: 4000 }).catch(() => undefined);
      const metrics = await page.evaluate(collectMobileMetrics);
      let shot: string | undefined;
      if (screenshot) {
        await autoScroll(page);
        shot = await capture(page, 2600);
      }
      return { metrics: { ...metrics, url }, screenshot: shot };
    } catch {
      return { metrics: null };
    } finally {
      await page.close().catch(() => undefined);
    }
  }

  async close() {
    await this.desktop?.close().catch(() => undefined);
    await this.mobile?.close().catch(() => undefined);
  }
}

/** Fallback when no browser is available: plain HTTP fetch, no runtime data. */
export async function staticSnapshot(url: string): Promise<PageSnapshot> {
  const started = Date.now();
  const res = await httpGet(url, { readBody: true, timeoutMs: 20000 });
  return {
    url,
    finalUrl: res.finalUrl,
    status: res.status,
    html: res.contentType.includes("html") || !res.contentType ? res.body ?? "" : "",
    loadTimeMs: Date.now() - started,
    resources: [],
    rendered: false,
    error: res.error,
  };
}

async function capture(page: Page, maxHeight: number): Promise<string> {
  await page.evaluate(() => window.scrollTo(0, 0));
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  const width = page.viewportSize()?.width ?? DESKTOP.width;
  const buffer = await page.screenshot({
    type: "jpeg",
    quality: 60,
    fullPage: true,
    scale: "css",
    clip: { x: 0, y: 0, width, height: Math.min(Math.max(height, 400), maxHeight) },
  });
  return `data:image/jpeg;base64,${buffer.toString("base64")}`;
}

/** Scrolls through the page so lazy-loaded images get a chance to load. */
async function autoScroll(page: Page) {
  await page
    .evaluate(async () => {
      const step = Math.max(window.innerHeight * 0.8, 400);
      const limit = Math.min(document.documentElement.scrollHeight, 20000);
      for (let y = 0; y < limit; y += step) {
        window.scrollTo(0, y);
        await new Promise((r) => setTimeout(r, 120));
      }
      window.scrollTo(0, 0);
    })
    .catch(() => undefined);
  await page.waitForLoadState("networkidle", { timeout: 3000 }).catch(() => undefined);
  await page.waitForTimeout(400);
}

/** Writes runtime facts onto DOM nodes as data-pa-* attributes so the HTML analysers can read them. */
async function annotateDom(page: Page) {
  await page
    .evaluate(() => {
      const marked = (window as unknown as { __paClick?: WeakSet<EventTarget> }).__paClick;
      // "direct": the element or a wrapper below <body> has a listener.
      // "delegated": only document/window/body/html listen, so it may or may not be handled.
      const handlerKind = (el: Element) => {
        for (let node: Element | null = el; node && node !== document.body; node = node.parentElement) {
          if (marked?.has(node) || (node as HTMLElement).onclick || (node as HTMLFormElement).onsubmit) return "direct";
        }
        const roots: EventTarget[] = [document, window, document.body, document.documentElement];
        return roots.some((r) => marked?.has(r)) ? "delegated" : "";
      };
      document.querySelectorAll("img").forEach((img) => {
        const src = img.getAttribute("src");
        let state = "ok";
        if (!img.complete) state = "pending";
        else if (src && img.naturalWidth === 0) state = "broken";
        img.setAttribute("data-pa-state", state);
        img.setAttribute("data-pa-natural", `${img.naturalWidth}x${img.naturalHeight}`);
        img.setAttribute("data-pa-rendered", `${Math.round(img.clientWidth)}x${Math.round(img.clientHeight)}`);
        if (img.currentSrc) img.setAttribute("data-pa-current", img.currentSrc);
      });
      document
        .querySelectorAll("a, button, [role=button], input[type=submit], input[type=button], form")
        .forEach((el) => {
          const kind = handlerKind(el);
          if (kind) el.setAttribute("data-pa-click", kind);
          const rect = el.getBoundingClientRect();
          if (rect.width === 0 && rect.height === 0) el.setAttribute("data-pa-hidden", "1");
        });
      document.querySelectorAll("svg").forEach((svg) => {
        const rect = svg.getBoundingClientRect();
        svg.setAttribute("data-pa-rendered", `${Math.round(rect.width)}x${Math.round(rect.height)}`);
      });
    })
    .catch(() => undefined);
}

function collectMobileMetrics(): Omit<MobileMetrics, "url"> {
  const describe = (el: Element) => {
    const id = el.id ? `#${el.id}` : "";
    const cls = typeof el.className === "string" && el.className.trim() ? `.${el.className.trim().split(/\s+/).slice(0, 2).join(".")}` : "";
    const text = (el.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 40);
    return `<${el.tagName.toLowerCase()}${id}${cls}>${text ? ` "${text}"` : ""}`;
  };
  const visible = (el: Element) => {
    const style = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    return style.visibility !== "hidden" && style.display !== "none" && rect.width > 0 && rect.height > 0;
  };
  const vw = window.innerWidth;

  const offenders: string[] = [];
  const overflowing = new Set<Element>();
  document.querySelectorAll("body *").forEach((el) => {
    if (offenders.length >= 6 || !visible(el)) return;
    const rect = el.getBoundingClientRect();
    if (rect.right > vw + 2 && rect.width > 20) {
      overflowing.add(el);
      if (!el.parentElement || !overflowing.has(el.parentElement)) {
        // Elements inside a scroll container or with overflow hidden ancestors don't widen the page.
        let clipped = false;
        for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
          const o = getComputedStyle(p).overflowX;
          if (o === "hidden" || o === "auto" || o === "scroll" || o === "clip") {
            clipped = true;
            break;
          }
        }
        if (!clipped) offenders.push(`${describe(el)} extends to ${Math.round(rect.right)}px`);
      }
    }
  });

  const tapSamples: string[] = [];
  let tapCount = 0;
  document.querySelectorAll("a[href], button, [role=button], input[type=submit]").forEach((el) => {
    if (!visible(el)) return;
    // Inline links inside running text are exempt from tap-target sizing.
    if (el.tagName === "A" && el.closest("p, li p, td") && getComputedStyle(el).display === "inline") return;
    const rect = el.getBoundingClientRect();
    if (rect.width < 32 || rect.height < 32) {
      tapCount++;
      if (tapSamples.length < 8) tapSamples.push(`${describe(el)} (${Math.round(rect.width)}×${Math.round(rect.height)}px)`);
    }
  });

  const textSamples: string[] = [];
  let textCount = 0;
  document.querySelectorAll("p, li, span, a, td, label, small").forEach((el) => {
    const own = Array.from(el.childNodes)
      .filter((n) => n.nodeType === Node.TEXT_NODE)
      .map((n) => n.textContent ?? "")
      .join("")
      .trim();
    if (own.length < 20 || !visible(el)) return;
    const size = parseFloat(getComputedStyle(el).fontSize);
    if (size < 12) {
      textCount++;
      if (textSamples.length < 6) textSamples.push(`${describe(el)} (${size}px)`);
    }
  });

  const phoneLinks = Array.from(document.querySelectorAll('a[href^="tel:"]'));
  const phoneAboveFold = phoneLinks.some((el) => {
    if (!visible(el)) return false;
    const rect = el.getBoundingClientRect();
    return rect.top < window.innerHeight && rect.bottom > 0;
  });

  return {
    viewportMeta: document.querySelector('meta[name="viewport"]')?.getAttribute("content") ?? null,
    viewportWidth: vw,
    scrollWidth: document.documentElement.scrollWidth,
    overflowOffenders: offenders,
    smallTapTargets: { count: tapCount, samples: tapSamples },
    smallText: { count: textCount, samples: textSamples },
    hasPhoneLink: phoneLinks.length > 0,
    phoneAboveFold,
  };
}
