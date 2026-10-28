import "./helpers/pro-env";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { server } from "../server/index";

// Stub only the Gemini URL; count calls.
let geminiCalls = 0;
let geminiText = "";
const realFetch = globalThis.fetch;
globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
  if (String(url).includes("generativelanguage.googleapis.com")) {
    geminiCalls++;
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: geminiText }] } }] }));
  }
  return realFetch(url, init);
}) as typeof fetch;

await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
const port = (server.address() as AddressInfo).port;
after(() => server.close());

function post(path: string, body: unknown, headers: Record<string, string> = {}): Promise<{ status: number; json: any }> {
  const data = typeof body === "string" ? body : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port, path, method: "POST", headers: { "Content-Type": "application/json", ...headers } },
      (res) => {
        let s = "";
        res.on("data", (c) => (s += c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, json: s ? JSON.parse(s) : null }));
      }
    );
    req.on("error", reject);
    req.end(data);
  });
}

const AUTH = { "x-app-token": "fake-app-token" };
const SUMMARY = { goals: { calories: 2000 }, eaten: { calories: 500 }, remaining: { calories: 1500 }, foods: [] };

test("both Pro endpoints require the app token", async () => {
  assert.equal((await post("/api/scan-menu", { imageBase64: "AAAA" })).status, 401);
  assert.equal((await post("/api/coach", { question: "hi", summary: SUMMARY })).status, 401);
});

test("scan-menu validates input and returns parsed dishes", async () => {
  assert.equal((await post("/api/scan-menu", "{bad", AUTH)).status, 400);
  assert.equal((await post("/api/scan-menu", { mode: "menu" }, AUTH)).status, 400);
  geminiText = JSON.stringify({ kind: "menu", dishes: [{ name: "Burger", calories: 750, protein: 40 }] });
  const r = await post("/api/scan-menu", { imageBase64: "AAAA", mimeType: "image/jpeg", mode: "menu" }, { ...AUTH, "cf-connecting-ip": "1.1.1.1" });
  assert.equal(r.status, 200);
  assert.equal(r.json.success, true);
  assert.equal(r.json.data.dishes[0].name, "Burger");
  assert.equal(r.json.data.dishes[0].calories, 750);
});

test("coach: validation, safety reply without a model call, answers, per-IP limit", async () => {
  const ip = { ...AUTH, "cf-connecting-ip": "2.2.2.2" };
  assert.equal((await post("/api/coach", { question: "" }, ip)).status, 400);
  assert.equal((await post("/api/coach", { question: "x".repeat(600) }, ip)).status, 400);
  assert.equal((await post("/api/coach", { question: "x".repeat(40000) }, ip)).status, 413);

  const before = geminiCalls;
  const safe = await post("/api/coach", { question: "how to make myself throw up", summary: SUMMARY }, ip);
  assert.equal(safe.status, 200);
  assert.equal(safe.json.safety, true);
  assert.equal(geminiCalls, before, "no Gemini call for the safety reply");

  geminiText = "Try grilled chicken with rice (~600 kcal).";
  for (let i = 0; i < 3; i++) {
    const r = await post("/api/coach", { question: "dinner idea?", summary: SUMMARY }, ip);
    assert.equal(r.status, 200);
    assert.equal(r.json.reply, geminiText);
  }
  const limited = await post("/api/coach", { question: "dinner idea?", summary: SUMMARY }, ip);
  assert.equal(limited.status, 429);
  assert.equal(limited.json.code, "rate_limited");
  const other = await post("/api/coach", { question: "dinner idea?", summary: SUMMARY }, { ...AUTH, "cf-connecting-ip": "3.3.3.3" });
  assert.equal(other.status, 200);
});
