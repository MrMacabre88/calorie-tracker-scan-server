/**
 * Abuse/cost protection for POST /api/analyze-food (the only endpoint that calls Gemini).
 * In-memory counters: fine for a single instance, reset on restart/redeploy.
 *
 *   - per IP: SCAN_LIMIT_PER_IP_HOUR (default 30) per rolling-start hour window
 *   - per IP: SCAN_LIMIT_PER_IP_DAY  (default 100) per UTC day
 *   - global: DAILY_SCAN_CAP          (default 500) Gemini calls per UTC day (resets 00:00 UTC)
 */
import type http from "node:http";

export const DEFAULT_PER_IP_HOUR = 30;
export const DEFAULT_PER_IP_DAY = 100;
export const DEFAULT_DAILY_SCAN_CAP = 500;
export const DEFAULT_SCAN_MAX_BODY_BYTES = 8 * 1024 * 1024;

const HOUR_MS = 60 * 60 * 1000;

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
}

export function utcDay(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

export interface ScanLimitConfig {
  perIpHour: number;
  perIpDay: number;
  dailyCap: number;
}

export function scanLimitConfigFromEnv(): ScanLimitConfig {
  return {
    perIpHour: intEnv("SCAN_LIMIT_PER_IP_HOUR", DEFAULT_PER_IP_HOUR),
    perIpDay: intEnv("SCAN_LIMIT_PER_IP_DAY", DEFAULT_PER_IP_DAY),
    dailyCap: intEnv("DAILY_SCAN_CAP", DEFAULT_DAILY_SCAN_CAP),
  };
}

export type LimitReason = "ip_hour" | "ip_day" | "global_day";

export const LIMIT_MESSAGES: Record<LimitReason, string> = {
  ip_hour: "You've scanned a lot of photos in the last hour. Please wait a bit and try again.",
  ip_day: "You've reached today's photo scan limit. Please try again tomorrow, or add food manually.",
  global_day: "Photo scanning is very busy today and has hit its daily limit. Please try again tomorrow, or add food manually.",
};

export function createScanLimiter(config: ScanLimitConfig = scanLimitConfigFromEnv()) {
  const hour = new Map<string, { start: number; count: number }>();
  const day = new Map<string, { day: string; count: number }>();
  let globalDay = "";
  let globalCount = 0;

  function prune(now: number) {
    const today = utcDay(now);
    if (hour.size > 5000) for (const [k, v] of hour) if (now - v.start >= HOUR_MS) hour.delete(k);
    if (day.size > 5000) for (const [k, v] of day) if (v.day !== today) day.delete(k);
  }

  function rollGlobal(now: number) {
    const today = utcDay(now);
    if (globalDay !== today) {
      globalDay = today;
      globalCount = 0;
    }
  }

  /** Which limit (if any) would block one more scan from this IP. Does not count anything. */
  function check(ip: string, now = Date.now()): LimitReason | null {
    rollGlobal(now);
    if (globalCount >= config.dailyCap) return "global_day";
    const h = hour.get(ip);
    if (h && now - h.start < HOUR_MS && h.count >= config.perIpHour) return "ip_hour";
    const d = day.get(ip);
    if (d && d.day === utcDay(now) && d.count >= config.perIpDay) return "ip_day";
    return null;
  }

  /** Checks and, if allowed, counts one scan (= one Gemini call) for this IP. */
  function consume(ip: string, now = Date.now()): LimitReason | null {
    const blocked = check(ip, now);
    if (blocked) return blocked;
    prune(now);
    const h = hour.get(ip);
    if (!h || now - h.start >= HOUR_MS) hour.set(ip, { start: now, count: 1 });
    else h.count += 1;
    const today = utcDay(now);
    const d = day.get(ip);
    if (!d || d.day !== today) day.set(ip, { day: today, count: 1 });
    else d.count += 1;
    globalCount += 1;
    return null;
  }

  /** Counts one extra Gemini call (a retry) against the global cap only. False = cap reached, skip it. */
  function consumeGlobalOnly(now = Date.now()): boolean {
    rollGlobal(now);
    if (globalCount >= config.dailyCap) return false;
    globalCount += 1;
    return true;
  }

  function stats(now = Date.now()) {
    rollGlobal(now);
    return { day: globalDay, globalCount, dailyCap: config.dailyCap };
  }

  return { check, consume, consumeGlobalOnly, stats, config };
}

/** Seconds until the limit that blocked the request could clear (for Retry-After). */
export function retryAfterSeconds(reason: LimitReason, now = Date.now()): number {
  if (reason === "ip_hour") return 60 * 60;
  const d = new Date(now);
  const midnight = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
  return Math.max(1, Math.ceil((midnight - now) / 1000));
}

/**
 * Real client IP behind Render. Render puts Cloudflare in front of every service and its
 * proxy only *appends* to X-Forwarded-For, so the leftmost XFF entry is client-controlled.
 * Order: CF-Connecting-IP / True-Client-IP (set by Cloudflare, overwrites client values),
 * then the Nth-from-right XFF entry (TRUST_PROXY_HOPS, default 1 = rightmost), then the socket.
 */
export function clientIp(req: http.IncomingMessage, trustedHops = intEnv("TRUST_PROXY_HOPS", 1)): string {
  const h = (name: string) => {
    const v = req.headers[name];
    return (Array.isArray(v) ? v[v.length - 1] : v)?.trim() || "";
  };
  const cf = h("cf-connecting-ip") || h("true-client-ip");
  if (cf) return cf;
  const raw = req.headers["x-forwarded-for"];
  const list = (Array.isArray(raw) ? raw.join(",") : raw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (list.length && trustedHops > 0) {
    return list[Math.max(0, list.length - trustedHops)];
  }
  return req.socket.remoteAddress || "unknown";
}

/** One log line per blocked scan. Never includes tokens, keys or request bodies. */
export function formatScanLimitLogLine(reason: LimitReason, ip: string, stats: { globalCount: number; dailyCap: number }) {
  return `SCAN_LIMIT ${JSON.stringify({ at: new Date().toISOString(), reason, ip, globalCount: stats.globalCount, dailyCap: stats.dailyCap })}`;
}
