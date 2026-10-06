import { spawn } from "node:child_process";

const DEFAULT_UA =
  "discord-bot-agent/0.1 (+https://github.com/local/discord-bot-agent; CS tracker; respectful bot)";

/** After one Cloudflare block, later reads of these hosts skip Node's client. */
let preferCurl = false;

export function isCloudflareChallenge(status: number, text: string): boolean {
  if (status !== 403 && status !== 503) return false;
  return /just a moment|performing security verification|cf-challenge|enable javascript and cookies/i.test(text);
}

export async function fetchText(
  url: string,
  opts: { headers?: Record<string, string>; timeoutMs?: number } = {},
): Promise<{ ok: boolean; status: number; text: string }> {
  const timeoutMs = opts.timeoutMs ?? 12_000;
  const headers = {
    "User-Agent": DEFAULT_UA,
    Accept: "text/html,application/json,*/*",
    ...opts.headers,
  };

  if (preferCurl && curlHostOk(url)) {
    const viaCurl = await fetchViaCurl(url, headers, timeoutMs);
    if (viaCurl && !isCloudflareChallenge(viaCurl.status, viaCurl.text)) return viaCurl;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, headers });
    const text = await res.text();
    const first = { ok: res.ok, status: res.status, text };
    if (!isCloudflareChallenge(first.status, first.text) || !curlHostOk(url)) return first;
    preferCurl = true;
    const viaCurl = await fetchViaCurl(url, headers, timeoutMs);
    return viaCurl ?? first;
  } catch (err) {
    if (!curlHostOk(url)) throw err;
    preferCurl = true;
    const viaCurl = await fetchViaCurl(url, headers, timeoutMs);
    if (viaCurl) return viaCurl;
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchJson<T = unknown>(
  url: string,
  opts: { headers?: Record<string, string>; timeoutMs?: number; method?: string; body?: string } = {},
): Promise<{ ok: boolean; status: number; data: T | null; text: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 12_000);
  try {
    const res = await fetch(url, {
      method: opts.method ?? "GET",
      signal: controller.signal,
      headers: {
        "User-Agent": DEFAULT_UA,
        Accept: "application/json",
        ...(opts.body ? { "Content-Type": "application/json" } : {}),
        ...opts.headers,
      },
      body: opts.body,
    });
    const text = await res.text();
    let data: T | null = null;
    try {
      data = text ? (JSON.parse(text) as T) : null;
    } catch {
      data = null;
    }
    return { ok: res.ok, status: res.status, data, text };
  } finally {
    clearTimeout(timer);
  }
}

/** Pull first number from HTML near a label (best-effort). */
export function htmlNearNumber(html: string, label: RegExp): number | undefined {
  const re = new RegExp(`${label.source}[^0-9]{0,80}([0-9]+(?:\\.[0-9]+)?)`, "i");
  const m = html.match(re);
  if (!m?.[1]) return undefined;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : undefined;
}

export function htmlMeta(html: string, property: string): string | undefined {
  const re = new RegExp(
    `<meta[^>]+(?:property|name)=["']${property}["'][^>]+content=["']([^"']+)["']`,
    "i",
  );
  const m = html.match(re);
  if (m?.[1]) return decodeHtml(m[1]);
  const re2 = new RegExp(
    `<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${property}["']`,
    "i",
  );
  const m2 = html.match(re2);
  return m2?.[1] ? decodeHtml(m2[1]) : undefined;
}

export function stripTags(html: string): string {
  return decodeHtml(html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
}

function curlHostOk(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return new URL(url).protocol === "https:" && (host === "csst.at" || host === "cstracker.gg");
  } catch {
    return false;
  }
}

function fetchViaCurl(
  url: string,
  headers: Record<string, string>,
  timeoutMs: number,
): Promise<{ ok: boolean; status: number; text: string } | null> {
  const args = ["-sS", "-L", "--max-redirs", "3", "--max-time", String(Math.ceil(timeoutMs / 1000))];
  for (const [key, value] of Object.entries(headers)) {
    if (/[\r\n]/.test(key) || /[\r\n]/.test(value)) continue;
    args.push("-H", `${key}: ${value}`);
  }
  args.push("-w", "\n__HTTP__%{http_code}", url);

  return new Promise((resolve) => {
    const child = spawn(process.platform === "win32" ? "curl.exe" : "curl", args, { windowsHide: true });
    const chunks: Buffer[] = [];
    let bytes = 0;
    child.stdout.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes <= 3_000_000) chunks.push(chunk);
    });
    child.on("error", () => resolve(null));
    child.on("close", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      const mark = raw.lastIndexOf("\n__HTTP__");
      if (mark < 0) {
        resolve(null);
        return;
      }
      const status = Number(raw.slice(mark + "\n__HTTP__".length).trim());
      const text = raw.slice(0, mark);
      if (!Number.isFinite(status)) {
        resolve(null);
        return;
      }
      resolve({ ok: status >= 200 && status < 300, status, text });
    });
  });
}

function decodeHtml(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}
