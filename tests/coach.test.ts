import { test } from "node:test";
import assert from "node:assert/strict";
import {
  COACH_MAX_FOOD_ITEMS,
  COACH_MAX_HISTORY_TURNS,
  COACH_MAX_QUESTION_CHARS,
  COACH_MAX_REPLY_CHARS,
  SAFETY_REPLY,
  buildCoachSystemPrompt,
  cleanCoachReply,
  formatSummaryForPrompt,
  needsSafetyReply,
  sanitizeSummary,
  validateCoachRequest,
} from "../shared/coach";
import { askCoach, buildCoachContents } from "../server/gemini";
import { createCoachLimiter, createScanLimiter } from "../server/scan-limits";

const SUMMARY = {
  date: "2026-10-28",
  localHour: 18,
  units: "metric",
  goals: { calories: 2000, protein: 120, carbs: 220, fat: 70 },
  eaten: { calories: 1200, protein: 60, carbs: 150, fat: 40 },
  remaining: { calories: 800, protein: 60, carbs: 70, fat: 30 },
  foods: [{ meal: "lunch", name: "Chicken wrap", calories: 550, protein: 35, carbs: 50, fat: 20 }],
};

test("summary is whitelisted: unknown/personal fields are dropped, numbers clamped", () => {
  const s = sanitizeSummary({
    ...SUMMARY,
    name: "Alex",
    weightKg: 80,
    email: "a@b.c",
    goals: { calories: "2000", protein: 1e9, carbs: "x", fat: 70 },
    foods: [{ meal: "brunch", name: "x".repeat(200), calories: 10, photo: "data:..." }],
    exerciseCaloriesAdded: 250,
    steps: 9000,
  });
  const json = JSON.stringify(s);
  assert.ok(!json.includes("Alex") && !json.includes("weight") && !json.includes("a@b.c") && !json.includes("photo"));
  assert.deepEqual(s.goals, { calories: 2000, protein: 100000, carbs: 0, fat: 70 });
  assert.equal(s.foods[0].meal, "snack");
  assert.equal(s.foods[0].name.length, 60);
  assert.ok(!json.includes("exercise") && !json.includes("steps") && !json.includes("9000"), "no Health Connect data");
  assert.equal(sanitizeSummary({ date: "yesterday", localHour: 99 }).date, "");
  assert.equal(sanitizeSummary({ localHour: 99 }).localHour, 12);
  const many = sanitizeSummary({ foods: Array.from({ length: 100 }, () => ({ name: "a" })) });
  assert.equal(many.foods.length, COACH_MAX_FOOD_ITEMS);
});

test("request validation", () => {
  assert.equal(validateCoachRequest(null).ok, false);
  assert.equal(validateCoachRequest({ question: "   " }).ok, false);
  assert.equal(validateCoachRequest({ question: "x".repeat(COACH_MAX_QUESTION_CHARS + 1) }).ok, false);
  const ok = validateCoachRequest({
    question: " What should I eat for dinner? ",
    history: [...Array.from({ length: 10 }, (_, i) => ({ role: i % 2 ? "coach" : "user", text: `t${i}` })), { role: "user", text: "" }, "junk"],
    summary: SUMMARY,
  });
  assert.ok(ok.ok);
  if (ok.ok) {
    assert.equal(ok.request.question, "What should I eat for dinner?");
    assert.equal(ok.request.history.length, COACH_MAX_HISTORY_TURNS);
    assert.equal(ok.request.history.at(-1)?.text, "t9");
  }
});

test("system prompt covers the safety rules", () => {
  const p = buildCoachSystemPrompt();
  for (const needle of [/not a doctor/i, /medical advice/i, /extreme diets/i, /disordered eating/i, /registered dietitian/i, /short/i, /Only talk about food/i]) {
    assert.match(p, needle);
  }
});

test("summary text includes goals, eaten, remaining and foods", () => {
  const t = formatSummaryForPrompt(sanitizeSummary(SUMMARY));
  assert.match(t, /Daily goals: 2000 kcal, protein 120g/);
  assert.match(t, /Remaining: 800 kcal/);
  assert.match(t, /lunch: Chicken wrap \(550 kcal/);
  assert.match(t, /18:00/);
  assert.match(formatSummaryForPrompt(sanitizeSummary({})), /nothing logged yet/);
});

test("safety pre-check catches clear purging/self-harm requests only", () => {
  assert.ok(needsSafetyReply("how do I make myself throw up after eating"));
  assert.ok(needsSafetyReply("best laxatives to lose weight fast"));
  assert.ok(needsSafetyReply("I want to starve myself"));
  assert.ok(!needsSafetyReply("what should I eat for dinner to hit my protein?"));
  assert.ok(!needsSafetyReply("is a 16:8 fast ok?"));
  assert.match(SAFETY_REPLY, /Butterfly/);
});

test("reply cleanup strips markdown and caps length", () => {
  assert.equal(cleanCoachReply("## Ideas\n* **Greek yoghurt** with berries\n\n\n\nEnjoy"), "Ideas\n- Greek yoghurt with berries\n\nEnjoy");
  const long = cleanCoachReply("Eat well. ".repeat(400));
  assert.ok(long.length <= COACH_MAX_REPLY_CHARS + 2);
  assert.equal(cleanCoachReply("   "), "");
});

test("coach contents: history first (starting with user), summary only in the last turn", () => {
  const v = validateCoachRequest({
    question: "Dinner?",
    history: [
      { role: "coach", text: "Hi!" },
      { role: "user", text: "Breakfast idea?" },
      { role: "coach", text: "Oats." },
    ],
    summary: SUMMARY,
  });
  assert.ok(v.ok);
  if (!v.ok) return;
  const c = buildCoachContents(v.request);
  assert.deepEqual(c.map((x) => x.role), ["user", "model", "user"]);
  assert.match(c[2].parts[0].text, /Remaining: 800 kcal[\s\S]*Question: Dinner\?$/);
  assert.ok(!c[0].parts[0].text.includes("Remaining"));
});

test("askCoach returns a cleaned reply or a friendly error", async () => {
  const ok = (async () =>
    new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "**Try** salmon." }] } }] }))) as unknown as typeof fetch;
  const v = validateCoachRequest({ question: "Dinner?", summary: SUMMARY });
  assert.ok(v.ok);
  if (!v.ok) return;
  assert.deepEqual(await askCoach(v.request, { apiKey: "k", fetchImpl: ok }), { success: true, reply: "Try salmon." });
  const empty = (async () => new Response(JSON.stringify({ candidates: [] }))) as unknown as typeof fetch;
  const r = await askCoach(v.request, { apiKey: "k", fetchImpl: empty, beforeRetry: () => true });
  assert.equal(r.success, false);
});

const T0 = Date.UTC(2026, 9, 28, 10, 0, 0);

test("coach limiter: per-IP daily limit, shares the global cap with scans", () => {
  const scans = createScanLimiter({ perIpHour: 100, perIpDay: 100, dailyCap: 5 });
  const coach = createCoachLimiter(2, scans);
  assert.equal(coach.consume("a", T0), null);
  assert.equal(coach.consume("a", T0), null);
  assert.equal(coach.consume("a", T0), "coach_ip_day");
  assert.equal(scans.stats(T0).globalCount, 2, "coach questions count on the global cap");
  assert.equal(scans.consume("a", T0), null, "photo scans have their own per-IP counters");
  assert.equal(coach.consume("b", T0), null);
  assert.equal(scans.consume("c", T0), null);
  assert.equal(scans.stats(T0).globalCount, 5);
  assert.equal(coach.consume("d", T0), "global_day");
  assert.equal(scans.consume("d", T0), "global_day");
  assert.equal(coach.consume("a", Date.UTC(2026, 9, 29, 0, 0, 1)), null, "resets at 00:00 UTC");
});
