/**
 * Tiny standalone API for the Calorie Tracker app. No framework, no database.
 *
 *   GET  /api/health        -> { ok, configured, model }
 *   POST /api/analyze-food  -> body { imageBase64, mimeType } -> AnalyzeFoodResponse
 *                              (rate limited per IP + global daily cap, see scan-limits.ts)
 *   POST /api/scan-menu     -> body { imageBase64, mimeType, mode: "auto"|"menu"|"recipe" } -> ScanMenuResponse
 *                              (PortionSnap Pro; same per-IP limits + global cap as analyze-food)
 *   POST /api/coach         -> body { question, history, summary } -> CoachResponse
 *                              (PortionSnap Pro; COACH_LIMIT_PER_IP_DAY (default 20) + global cap)
 *   POST /api/crash-report  -> app error report, logged as one "CRASH_REPORT {json}" line
 *   GET  /privacy, /privacy-policy, /disclaimer, /terms -> public HTML legal pages (no token), see legal.ts
 *
 * Env: GEMINI_API_KEY (required), GEMINI_MODEL (optional), APP_TOKEN (optional shared
 * secret the app sends as "x-app-token"), PORT (default 3000), DAILY_SCAN_CAP (default 500),
 * SCAN_LIMIT_PER_IP_HOUR (default 30), SCAN_LIMIT_PER_IP_DAY (default 100),
 * SCAN_MAX_BODY_BYTES (default 8 MB), COACH_LIMIT_PER_IP_DAY (default 20), TRUST_PROXY_HOPS (default 1),
 * PRIVACY_CONTACT_EMAIL (shown on the legal pages; default placeholder CONTACT_EMAIL_HERE).
 */
import http from "node:http";
import { analyzeFoodImage, analyzeMenuImage, askCoach, DEFAULT_GEMINI_MODEL } from "./gemini";
import {
  CRASH_MAX_BODY_BYTES,
  createRateLimiter,
  formatCrashLogLine,
  validateCrashReport,
} from "./crash-report";
import {
  clientIp,
  coachPerIpDayFromEnv,
  COACH_LIMIT_MESSAGES,
  createCoachLimiter,
  createScanLimiter,
  DEFAULT_SCAN_MAX_BODY_BYTES,
  formatScanLimitLogLine,
  LIMIT_MESSAGES,
  retryAfterSeconds,
  type CoachLimitReason,
  type LimitReason,
} from "./scan-limits";
import { legalPageFor } from "./legal";
import { normalizeMenuMode } from "../shared/menu-analysis";
import { COACH_MAX_BODY_BYTES, SAFETY_REPLY, needsSafetyReply, validateCoachRequest } from "../shared/coach";

try {
  process.loadEnvFile?.(); // load .env if present (Node 20.12+)
} catch {
  // no .env file
}

const PORT = Number(process.env.PORT) || 3000;
const API_KEY = process.env.GEMINI_API_KEY ?? "";
const MODEL = process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL;
const APP_TOKEN = process.env.APP_TOKEN ?? "";
const MAX_BODY_BYTES = Number(process.env.SCAN_MAX_BODY_BYTES) > 0 ? Number(process.env.SCAN_MAX_BODY_BYTES) : DEFAULT_SCAN_MAX_BODY_BYTES;

function send(res: http.ServerResponse, status: number, body: unknown, extraHeaders: Record<string, string> = {}) {
  res.writeHead(status, {
    ...extraHeaders,
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, x-app-token",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  });
  res.end(JSON.stringify(body));
}

function sendHtml(res: http.ServerResponse, html: string, headOnly: boolean) {
  res.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "public, max-age=300",
    "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
  });
  res.end(headOnly ? undefined : html);
}

const allowCrashReport = createRateLimiter();
const scanLimiter = createScanLimiter();
const coachLimiter = createCoachLimiter(coachPerIpDayFromEnv(), scanLimiter);

function sendLimited(res: http.ServerResponse, reason: LimitReason, ip: string) {
  console.warn(formatScanLimitLogLine(reason, ip, scanLimiter.stats()));
  return send(
    res,
    429,
    { success: false, error: LIMIT_MESSAGES[reason], code: "rate_limited" },
    { "Retry-After": String(retryAfterSeconds(reason)) }
  );
}

function sendCoachLimited(res: http.ServerResponse, reason: CoachLimitReason, ip: string) {
  console.warn(formatScanLimitLogLine(reason === "global_day" ? "global_day" : "ip_day", ip, scanLimiter.stats()).replace("SCAN_LIMIT", "COACH_LIMIT"));
  return send(
    res,
    429,
    { success: false, error: COACH_LIMIT_MESSAGES[reason], code: "rate_limited" },
    { "Retry-After": String(retryAfterSeconds("ip_day")) }
  );
}

/** Reads the body. Small endpoints pass `drain` so a too-large body still gets a 413 reply. */
function readBody(req: http.IncomingMessage, maxBytes = MAX_BODY_BYTES, drain = false): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    let over = false;
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      if (over) return;
      size += chunk.length;
      if (size > maxBytes) {
        over = true;
        reject(new Error("too_large"));
        if (!drain) req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

export const server = http.createServer(async (req, res) => {
  const path = (req.url ?? "/").split("?")[0];
  if (req.method === "OPTIONS") return send(res, 204, {});
  if (req.method === "GET" || req.method === "HEAD") {
    const page = legalPageFor(path);
    if (page) return sendHtml(res, page, req.method === "HEAD");
  }
  if (req.method === "GET" && path === "/api/health") {
    return send(res, 200, { ok: true, configured: Boolean(API_KEY), model: MODEL });
  }
  if (req.method === "POST" && path === "/api/crash-report") {
    if (APP_TOKEN && req.headers["x-app-token"] !== APP_TOKEN) {
      return send(res, 401, { success: false, error: "Unauthorized" });
    }
    if (!allowCrashReport(clientIp(req))) {
      return send(res, 429, { success: false, error: "Too many reports." });
    }
    let body: unknown;
    try {
      body = JSON.parse(await readBody(req, CRASH_MAX_BODY_BYTES, true));
    } catch (error) {
      const tooLarge = (error as Error).message === "too_large";
      return send(res, tooLarge ? 413 : 400, { success: false, error: tooLarge ? "Report too large." : "Invalid JSON." });
    }
    const checked = validateCrashReport(body);
    if (!checked.ok) return send(res, 400, { success: false, error: checked.error });
    console.log(formatCrashLogLine(checked.report));
    return send(res, 200, { success: true });
  }
  if (req.method === "POST" && path === "/api/coach") {
    if (APP_TOKEN && req.headers["x-app-token"] !== APP_TOKEN) {
      return send(res, 401, { success: false, error: "Unauthorized" });
    }
    if (!API_KEY) {
      return send(res, 500, { success: false, error: "Server is missing GEMINI_API_KEY." });
    }
    const ip = clientIp(req);
    const preBlocked = coachLimiter.check(ip);
    if (preBlocked) {
      req.resume();
      return sendCoachLimited(res, preBlocked, ip);
    }
    let body: unknown;
    try {
      body = JSON.parse(await readBody(req, COACH_MAX_BODY_BYTES, true));
    } catch (error) {
      const tooLarge = (error as Error).message === "too_large";
      return send(res, tooLarge ? 413 : 400, { success: false, error: tooLarge ? "Request too large." : "Invalid request." });
    }
    const checked = validateCoachRequest(body);
    if (!checked.ok) return send(res, 400, { success: false, error: checked.error });
    // Clear self-harm / purging requests get a fixed supportive reply; no model call.
    if (needsSafetyReply(checked.request.question)) {
      return send(res, 200, { success: true, reply: SAFETY_REPLY, safety: true });
    }
    const blocked = coachLimiter.consume(ip);
    if (blocked) return sendCoachLimited(res, blocked, ip);
    const result = await askCoach(checked.request, {
      apiKey: API_KEY,
      model: MODEL,
      beforeRetry: () => scanLimiter.consumeGlobalOnly(),
    });
    return send(res, 200, result);
  }
  const isMenu = path === "/api/scan-menu";
  if (req.method !== "POST" || (path !== "/api/analyze-food" && !isMenu)) {
    return send(res, 404, { success: false, error: "Not found" });
  }
  if (APP_TOKEN && req.headers["x-app-token"] !== APP_TOKEN) {
    return send(res, 401, { success: false, error: "Unauthorized" });
  }
  if (!API_KEY) {
    return send(res, 500, { success: false, error: "Server is missing GEMINI_API_KEY." });
  }
  const ip = clientIp(req);
  // Cheap pre-check so a blocked client doesn't make us read a multi-MB body
  const preBlocked = scanLimiter.check(ip);
  if (preBlocked) {
    req.resume();
    return sendLimited(res, preBlocked, ip);
  }
  if (Number(req.headers["content-length"]) > MAX_BODY_BYTES) {
    req.resume();
    return send(res, 413, { success: false, error: "Photo is too large." }, { Connection: "close" });
  }

  let input: { imageBase64?: unknown; mimeType?: unknown; mode?: unknown };
  try {
    input = JSON.parse(await readBody(req, MAX_BODY_BYTES, true));
  } catch (error) {
    const tooLarge = (error as Error).message === "too_large";
    if (tooLarge) {
      // Reply 413, then drop the connection so the client can't keep streaming
      res.on("finish", () => req.destroy());
      return send(res, 413, { success: false, error: "Photo is too large." }, { Connection: "close" });
    }
    return send(res, 400, { success: false, error: "Invalid request." });
  }
  if (typeof input.imageBase64 !== "string" || input.imageBase64.length === 0) {
    return send(res, 400, { success: false, error: "Missing imageBase64." });
  }
  const blocked = scanLimiter.consume(ip);
  if (blocked) return sendLimited(res, blocked, ip);

  const image = {
    imageBase64: input.imageBase64,
    mimeType: typeof input.mimeType === "string" ? input.mimeType : undefined,
  };
  const options = { apiKey: API_KEY, model: MODEL, beforeRetry: () => scanLimiter.consumeGlobalOnly() };
  const result = isMenu
    ? await analyzeMenuImage({ ...image, mode: normalizeMenuMode(input.mode) }, options)
    : await analyzeFoodImage(image, options);
  return send(res, 200, result);
});

if (process.env.NODE_ENV !== "test") {
  server.listen(PORT, () => {
    const c = scanLimiter.config;
    console.log(`Calorie Tracker API listening on :${PORT} (model ${MODEL}${API_KEY ? "" : ", GEMINI_API_KEY NOT SET"})`);
    console.log(`Scan limits (photo + menu scans): ${c.perIpHour}/hour and ${c.perIpDay}/day per IP, ${c.dailyCap} Gemini calls/day total (UTC), max body ${MAX_BODY_BYTES} bytes`);
    console.log(`Coach limit: ${coachLimiter.perIpDay} questions/day per IP (also counts toward the global cap)`);
  });
}
