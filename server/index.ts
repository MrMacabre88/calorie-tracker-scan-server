/**
 * Tiny standalone API for the Calorie Tracker app. No framework, no database.
 *
 *   GET  /api/health        -> { ok, configured, model }
 *   POST /api/analyze-food  -> body { imageBase64, mimeType } -> AnalyzeFoodResponse
 *
 * Env: GEMINI_API_KEY (required), GEMINI_MODEL (optional), APP_TOKEN (optional shared
 * secret the app sends as "x-app-token"), PORT (default 3000).
 */
import http from "node:http";
import { analyzeFoodImage, DEFAULT_GEMINI_MODEL } from "./gemini";

try {
  process.loadEnvFile?.(); // load .env if present (Node 20.12+)
} catch {
  // no .env file
}

const PORT = Number(process.env.PORT) || 3000;
const API_KEY = process.env.GEMINI_API_KEY ?? "";
const MODEL = process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL;
const APP_TOKEN = process.env.APP_TOKEN ?? "";
const MAX_BODY_BYTES = 15 * 1024 * 1024;

function send(res: http.ServerResponse, status: number, body: unknown) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, x-app-token",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  });
  res.end(JSON.stringify(body));
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("too_large"));
        req.destroy();
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
  if (req.method === "GET" && path === "/api/health") {
    return send(res, 200, { ok: true, configured: Boolean(API_KEY), model: MODEL });
  }
  if (req.method !== "POST" || path !== "/api/analyze-food") {
    return send(res, 404, { success: false, error: "Not found" });
  }
  if (APP_TOKEN && req.headers["x-app-token"] !== APP_TOKEN) {
    return send(res, 401, { success: false, error: "Unauthorized" });
  }
  if (!API_KEY) {
    return send(res, 500, { success: false, error: "Server is missing GEMINI_API_KEY." });
  }

  let input: { imageBase64?: unknown; mimeType?: unknown };
  try {
    input = JSON.parse(await readBody(req));
  } catch (error) {
    const tooLarge = (error as Error).message === "too_large";
    return send(res, tooLarge ? 413 : 400, {
      success: false,
      error: tooLarge ? "Photo is too large." : "Invalid request.",
    });
  }
  if (typeof input.imageBase64 !== "string" || input.imageBase64.length === 0) {
    return send(res, 400, { success: false, error: "Missing imageBase64." });
  }

  const result = await analyzeFoodImage(
    {
      imageBase64: input.imageBase64,
      mimeType: typeof input.mimeType === "string" ? input.mimeType : undefined,
    },
    { apiKey: API_KEY, model: MODEL }
  );
  return send(res, 200, result);
});

if (process.env.NODE_ENV !== "test") {
  server.listen(PORT, () => {
    console.log(`Calorie Tracker API listening on :${PORT} (model ${MODEL}${API_KEY ? "" : ", GEMINI_API_KEY NOT SET"})`);
  });
}
