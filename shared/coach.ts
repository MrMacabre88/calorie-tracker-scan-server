/**
 * AI coach (PortionSnap Pro): request/response shapes, validation and the system prompt.
 *
 * The app sends a question, the last few chat turns, and a compact summary of TODAY only:
 * goals, what's been eaten (food names + numbers), and what's left. No name, photos, age,
 * height, weight or Health Connect data. The server validates/trims everything (whitelist) before it goes to Gemini,
 * and stores nothing.
 */

export const COACH_MAX_QUESTION_CHARS = 500;
export const COACH_MAX_HISTORY_TURNS = 6;
export const COACH_MAX_HISTORY_CHARS = 800;
export const COACH_MAX_FOOD_ITEMS = 40;
export const COACH_MAX_REPLY_CHARS = 1500;
export const COACH_MAX_BODY_BYTES = 32 * 1024;

export type CoachRole = "user" | "coach";
export interface CoachTurn {
  role: CoachRole;
  text: string;
}

export interface Macros {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
}

export interface CoachFoodItem {
  meal: "breakfast" | "lunch" | "dinner" | "snack";
  name: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
}

/** Compact summary of today. Everything is optional except goals/eaten/remaining. */
export interface CoachDaySummary {
  /** Local date "YYYY-MM-DD" and local hour (0-23) so the coach knows which meal is next. */
  date: string;
  localHour: number;
  units: "metric" | "imperial";
  goals: Macros;
  eaten: Macros;
  remaining: Macros;
  foods: CoachFoodItem[];
  // Deliberately no Health Connect data (steps/exercise): that stays on the phone.
}

export interface CoachRequest {
  question: string;
  history: CoachTurn[];
  summary: CoachDaySummary;
}

export type CoachResponse =
  | { success: true; reply: string; safety?: boolean }
  | { success: false; error: string; code?: string };

export const COACH_FAILED_MESSAGE = "The coach couldn't answer just now. Please try again.";

const MEALS = ["breakfast", "lunch", "dinner", "snack"] as const;

function num(value: unknown, max = 100000): number {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(n)) return 0;
  return Math.round(Math.max(-max, Math.min(max, n)));
}

function text(value: unknown, max: number): string {
  return typeof value === "string"
    ? value
        // eslint-disable-next-line no-control-regex
        .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
        .trim()
        .slice(0, max)
    : "";
}

function macros(value: unknown): Macros {
  const v = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  return { calories: num(v.calories), protein: num(v.protein), carbs: num(v.carbs), fat: num(v.fat) };
}

/** Whitelist + clamp the summary. Unknown fields (name, weight, ...) are dropped. */
export function sanitizeSummary(value: unknown): CoachDaySummary {
  const v = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const date = typeof v.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v.date) ? v.date : "";
  const hour = num(v.localHour, 1000);
  const foods = Array.isArray(v.foods) ? v.foods : [];
  const summary: CoachDaySummary = {
    date,
    localHour: hour >= 0 && hour <= 23 ? hour : 12,
    units: v.units === "imperial" ? "imperial" : "metric",
    goals: macros(v.goals),
    eaten: macros(v.eaten),
    remaining: macros(v.remaining),
    foods: foods
      .filter((f): f is Record<string, unknown> => !!f && typeof f === "object")
      .slice(0, COACH_MAX_FOOD_ITEMS)
      .map((f) => ({
        meal: (MEALS as readonly string[]).includes(f.meal as string) ? (f.meal as CoachFoodItem["meal"]) : "snack",
        name: text(f.name, 60) || "food",
        calories: num(f.calories),
        protein: num(f.protein),
        carbs: num(f.carbs),
        fat: num(f.fat),
      })),
  };
  return summary;
}

export function validateCoachRequest(body: unknown): { ok: true; request: CoachRequest } | { ok: false; error: string } {
  if (!body || typeof body !== "object") return { ok: false, error: "Invalid request." };
  const b = body as Record<string, unknown>;
  const question = text(b.question, COACH_MAX_QUESTION_CHARS + 1);
  if (!question) return { ok: false, error: "Please type a question." };
  if (question.length > COACH_MAX_QUESTION_CHARS) {
    return { ok: false, error: `Please keep questions under ${COACH_MAX_QUESTION_CHARS} characters.` };
  }
  const history = (Array.isArray(b.history) ? b.history : [])
    .filter((t): t is Record<string, unknown> => !!t && typeof t === "object")
    .map((t) => ({ role: (t.role === "coach" ? "coach" : "user") as CoachRole, text: text(t.text, COACH_MAX_HISTORY_CHARS) }))
    .filter((t) => t.text)
    .slice(-COACH_MAX_HISTORY_TURNS);
  return { ok: true, request: { question, history, summary: sanitizeSummary(b.summary) } };
}

export function buildCoachSystemPrompt(): string {
  return `You are the PortionSnap coach, a friendly food and nutrition helper inside a calorie tracking app.

What you do:
- Give practical, everyday food and nutrition guidance: meal and snack ideas, how to fit protein or fibre into the day, how to read today's numbers, general healthy-eating habits.
- Use the "Today" data provided (goals, what's been eaten, what's left). Suggest real foods with rough portions and approximate calories/protein. Respect the user's units.
- Keep answers short: at most about 120 words, plain text, a few short lines or simple "-" bullets. No markdown headings, no tables.

Safety rules (always follow):
- You are not a doctor or dietitian and do not give medical advice. Don't diagnose, don't advise on medications, supplements for conditions, or managing diseases (e.g. diabetes, kidney disease, pregnancy, allergies). For anything medical, say kindly that a doctor or registered dietitian is the right person to ask, and you can still share general healthy-eating ideas.
- Never recommend extreme diets: no eating under about 1,200 kcal a day for women or 1,500 for men, no skipping meals to "save" calories, no multi-day fasts, no detoxes or cleanses, no rapid weight loss of more than about 1 kg (2 lb) a week.
- If a request could promote disordered eating (e.g. purging, laxatives or diet pills to lose weight, hiding food, punishing yourself with exercise, eating as little as possible, "thinspiration", wanting to feel empty), do not help with it. Reply kindly and without judgement, encourage them to talk to someone they trust or a health professional, and mention that eating disorder support services can help (for example the Butterfly Foundation helpline 1800 33 4673 in Australia, or a local service). Offer to help with balanced, regular eating instead.
- If remaining calories are negative, don't suggest compensating by restricting tomorrow; it's fine to be over sometimes.
- Only talk about food, nutrition, eating habits and using the app. Politely decline other topics.
- Numbers you give are estimates. Don't claim certainty.
- Never ask for or mention personal details like name, weight, age or location.`;
}

/** Text block sent with each question (the only user data the coach sees). */
export function formatSummaryForPrompt(s: CoachDaySummary): string {
  const unitNote = s.units === "imperial" ? "Units: imperial (calories in kcal, macros in grams)." : "Units: metric.";
  const foods = s.foods.length
    ? s.foods
        .map((f) => `- ${f.meal}: ${f.name} (${f.calories} kcal, P ${f.protein}g, C ${f.carbs}g, F ${f.fat}g)`)
        .join("\n")
    : "- nothing logged yet";
  const m = (x: Macros) => `${x.calories} kcal, protein ${x.protein}g, carbs ${x.carbs}g, fat ${x.fat}g`;
  return [
    `Today${s.date ? ` (${s.date})` : ""}, local time about ${String(s.localHour).padStart(2, "0")}:00. ${unitNote}`,
    `Daily goals: ${m(s.goals)}.`,
    `Eaten so far: ${m(s.eaten)}.`,
    `Remaining: ${m(s.remaining)}.`,
    `Logged foods:\n${foods}`,
  ].join("\n");
}

/**
 * Narrow pre-check for clear self-harm / purging requests. These get a fixed, kind reply without
 * calling the model (the model's system prompt also covers the wider cases).
 */
const CRISIS_PATTERNS: RegExp[] = [
  /\b(make|making|get) (my ?self|me) (throw up|vomit|sick)\b/i,
  /\b(purg(e|ing)|self[- ]?induced vomiting)\b/i,
  /\b(laxatives?|diuretics?|diet pills?) (to|for) (lose|losing|drop|burn)\b/i,
  /\b(kill|hurt|harm) (my ?self|me)\b/i,
  /\bsuicid(e|al)\b/i,
  /\b(starve|starving) (my ?self|me)\b/i,
];

export const SAFETY_REPLY =
  "I'm really sorry you're going through this. I can't help with that, but you deserve support. Please talk to someone you trust or a doctor. In Australia you can call the Butterfly Foundation on 1800 33 4673 (eating and body image support) or Lifeline on 13 11 14, any time. If you're in danger right now, call 000 (or your local emergency number). I'm here for balanced, regular meal ideas whenever you'd like.";

export function needsSafetyReply(question: string): boolean {
  return CRISIS_PATTERNS.some((re) => re.test(question));
}

/** Trim the model reply: strip markdown emphasis/headings, cap length. */
export function cleanCoachReply(raw: string): string {
  let t = raw
    .replace(/\r/g, "")
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/^\s*\*\s+/gm, "- ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (t.length > COACH_MAX_REPLY_CHARS) {
    const cut = t.slice(0, COACH_MAX_REPLY_CHARS);
    const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("\n"));
    t = (end > COACH_MAX_REPLY_CHARS * 0.6 ? cut.slice(0, end + 1) : cut).trim() + " …";
  }
  return t;
}
