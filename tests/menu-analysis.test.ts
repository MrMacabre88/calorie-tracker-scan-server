import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_MENU_DISHES,
  buildMenuAnalysisPrompt,
  normalizeMenuMode,
  parseMenuAnalysis,
} from "../shared/menu-analysis";
import { analyzeMenuImage } from "../server/gemini";

test("mode is normalized to auto unless menu/recipe", () => {
  assert.equal(normalizeMenuMode("menu"), "menu");
  assert.equal(normalizeMenuMode("recipe"), "recipe");
  assert.equal(normalizeMenuMode("pizza"), "auto");
  assert.equal(normalizeMenuMode(undefined), "auto");
});

test("prompt mentions the chosen mode and per-serving rule", () => {
  assert.match(buildMenuAnalysisPrompt("menu"), /RESTAURANT MENU/);
  assert.match(buildMenuAnalysisPrompt("recipe"), /is a RECIPE/);
  assert.match(buildMenuAnalysisPrompt("auto"), /First decide/);
  assert.match(buildMenuAnalysisPrompt(), /ONE serving/);
});

test("parses a menu answer and coerces numbers", () => {
  const text = "```json\n" + JSON.stringify({
    kind: "menu",
    title: "Luigi's",
    servings: 0,
    dishes: [
      { name: "Margherita pizza", description: "12 inch", calories: "850 kcal", protein: 34, carbs: "100g", fat: 30.26, servingSize: "1 pizza (~400g)", confidence: "medium" },
      { name: "", calories: -5 },
    ],
    note: "Typical portions.",
  }) + "\n```";
  const r = parseMenuAnalysis(text, "auto");
  assert.ok(r);
  assert.equal(r.kind, "menu");
  assert.equal(r.title, "Luigi's");
  assert.equal(r.dishes.length, 2);
  assert.deepEqual(
    { c: r.dishes[0].calories, p: r.dishes[0].protein, cb: r.dishes[0].carbs, f: r.dishes[0].fat },
    { c: 850, p: 34, cb: 100, f: 30.3 }
  );
  assert.equal(r.dishes[1].name, "Unnamed dish");
  assert.equal(r.dishes[1].calories, 0);
  assert.equal(r.dishes[1].servingSize, "1 serving");
  assert.equal(r.dishes[1].confidence, "medium");
});

test("recipe servings and kind fallback", () => {
  const r = parseMenuAnalysis(JSON.stringify({ kind: "??", servings: 4, dishes: [{ name: "Chilli", calories: 420 }] }), "recipe");
  assert.ok(r);
  assert.equal(r.kind, "recipe");
  assert.equal(r.servings, 4);
  const bad = parseMenuAnalysis(JSON.stringify({ servings: 900, dishes: [] }), "auto");
  assert.equal(bad?.servings, 0);
  assert.equal(bad?.kind, "other");
});

test("caps the dish list and rejects unusable answers", () => {
  const many = { kind: "menu", dishes: Array.from({ length: 80 }, (_, i) => ({ name: `D${i}`, calories: 100 })) };
  assert.equal(parseMenuAnalysis(JSON.stringify(many))?.dishes.length, MAX_MENU_DISHES);
  assert.equal(parseMenuAnalysis("not json"), null);
  assert.equal(parseMenuAnalysis(JSON.stringify({ kind: "menu" })), null);
});

function fakeGemini(answers: Array<{ status: number; text?: string }>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const impl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const a = answers[Math.min(calls.length - 1, answers.length - 1)];
    const body = { candidates: [{ content: { parts: [{ text: "thinking", thought: true }, { text: a.text ?? "" }] } }] };
    return new Response(a.status === 200 ? JSON.stringify(body) : "error", { status: a.status });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

test("analyzeMenuImage sends the image + key header and parses the answer", async () => {
  const { impl, calls } = fakeGemini([
    { status: 200, text: JSON.stringify({ kind: "recipe", servings: 2, dishes: [{ name: "Soup", calories: 300 }] }) },
  ]);
  const r = await analyzeMenuImage(
    { imageBase64: "data:image/jpeg;base64,AAAA", mode: "recipe" },
    { apiKey: "k", model: "m-1", fetchImpl: impl }
  );
  assert.equal(r.success, true);
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /models\/m-1:generateContent$/);
  assert.equal((calls[0].init.headers as Record<string, string>)["x-goog-api-key"], "k");
  const sent = JSON.parse(String(calls[0].init.body));
  assert.equal(sent.contents[0].parts[1].inlineData.data, "AAAA");
  assert.equal(sent.contents[0].parts[1].inlineData.mimeType, "image/jpeg");
  assert.match(sent.systemInstruction.parts[0].text, /is a RECIPE/);
});

test("analyzeMenuImage retries once, asking beforeRetry, then fails cleanly", async () => {
  const { impl, calls } = fakeGemini([{ status: 500 }, { status: 200, text: "nope" }]);
  let asked = 0;
  const r = await analyzeMenuImage(
    { imageBase64: "AAAA", mode: "auto" },
    { apiKey: "k", fetchImpl: impl, beforeRetry: () => (asked++, true) }
  );
  assert.equal(r.success, false);
  assert.equal(calls.length, 2);
  assert.equal(asked, 1);

  const blocked = fakeGemini([{ status: 500 }]);
  const r2 = await analyzeMenuImage(
    { imageBase64: "AAAA", mode: "auto" },
    { apiKey: "k", fetchImpl: blocked.impl, beforeRetry: () => false }
  );
  assert.equal(r2.success, false);
  assert.equal(blocked.calls.length, 1, "retry skipped when the cap is reached");
});
