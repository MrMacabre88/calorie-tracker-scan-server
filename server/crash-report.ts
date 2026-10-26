/**
 * POST /api/crash-report: the app sends JS error reports here; we validate them and
 * write one "CRASH_REPORT {json}" line to stdout (visible in the Render logs).
 * Only technical fields are accepted, so no food logs, weights or other personal data.
 */

export const CRASH_MAX_BODY_BYTES = 20 * 1024;
export const CRASH_RATE_LIMIT = 20; // reports per IP per window
export const CRASH_RATE_WINDOW_MS = 60 * 60 * 1000;

export interface CrashReport {
  message: string;
  stack: string;
  componentStack?: string;
  appVersion: string;
  platform: string;
  osVersion: string;
  device?: string;
  isFatal: boolean;
  timestamp: string;
  screen?: string;
}

const LIMITS: Record<string, number> = {
  message: 1000,
  stack: 8000,
  componentStack: 4000,
  appVersion: 40,
  platform: 20,
  osVersion: 40,
  device: 100,
  timestamp: 40,
  screen: 200,
};

function str(v: unknown, max: number): string | undefined {
  if (typeof v !== "string") return undefined;
  // strip control characters (keeps newlines/tabs) so one report stays one log line after JSON.stringify
  const s = v.replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, "");
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

/** Returns a cleaned report, or an error message if required fields are missing. */
export function validateCrashReport(input: unknown): { ok: true; report: CrashReport } | { ok: false; error: string } {
  if (!input || typeof input !== "object" || Array.isArray(input)) return { ok: false, error: "Body must be a JSON object." };
  const o = input as Record<string, unknown>;
  const message = str(o.message, LIMITS.message);
  if (!message) return { ok: false, error: "Missing message." };
  const appVersion = str(o.appVersion, LIMITS.appVersion);
  const platform = str(o.platform, LIMITS.platform);
  if (!appVersion || !platform) return { ok: false, error: "Missing appVersion or platform." };
  if (typeof o.isFatal !== "boolean") return { ok: false, error: "isFatal must be a boolean." };
  const report: CrashReport = {
    message,
    stack: str(o.stack, LIMITS.stack) ?? "",
    appVersion,
    platform,
    osVersion: str(typeof o.osVersion === "number" ? String(o.osVersion) : o.osVersion, LIMITS.osVersion) ?? "",
    isFatal: o.isFatal,
    timestamp: str(o.timestamp, LIMITS.timestamp) ?? new Date().toISOString(),
  };
  const componentStack = str(o.componentStack, LIMITS.componentStack);
  if (componentStack) report.componentStack = componentStack;
  const device = str(o.device, LIMITS.device);
  if (device) report.device = device;
  const screen = str(o.screen, LIMITS.screen);
  if (screen) report.screen = screen;
  return { ok: true, report };
}

/** Very small fixed-window rate limiter keyed by IP (in memory; resets on restart). */
export function createRateLimiter(limit = CRASH_RATE_LIMIT, windowMs = CRASH_RATE_WINDOW_MS) {
  const hits = new Map<string, { start: number; count: number }>();
  return (key: string, now = Date.now()): boolean => {
    if (hits.size > 5000) {
      for (const [k, v] of hits) if (now - v.start >= windowMs) hits.delete(k);
    }
    const h = hits.get(key);
    if (!h || now - h.start >= windowMs) {
      hits.set(key, { start: now, count: 1 });
      return true;
    }
    h.count += 1;
    return h.count <= limit;
  };
}

export function formatCrashLogLine(report: CrashReport, receivedAt = new Date()): string {
  return `CRASH_REPORT ${JSON.stringify({ receivedAt: receivedAt.toISOString(), ...report })}`;
}
