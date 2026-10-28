/**
 * Prompt + response parsing for the Scan Food feature.
 * Kept free of server/LLM imports so it can be unit-tested directly.
 */

export type Confidence = "high" | "medium" | "low";

export interface AnalyzedFood {
  name: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  servingSize: string;
  confidence: Confidence;
}

export interface FoodAnalysis {
  foods: AnalyzedFood[];
  totalCalories: number;
  description: string;
}

export function buildFoodAnalysisPrompt(): string {
  return `You are a nutrition analysis AI. Analyze the food in the image and estimate its nutritional content.
Answer immediately from your own nutrition knowledge. Do not search the web or call any tools.
Return ONLY a JSON object with this exact structure:
{
  "foods": [
    {
      "name": "Food item name",
      "calories": 250,
      "protein": 20,
      "carbs": 30,
      "fat": 8,
      "servingSize": "1 plate (350g)",
      "confidence": "high"
    }
  ],
  "totalCalories": 250,
  "description": "Brief description of what you see"
}

Rules:
- Identify ALL distinct food items visible in the image
- Estimate calories (kcal) and protein, carbs, fat (grams) for the portion actually visible in the photo
- "servingSize" describes that visible portion and MUST include an approximate metric weight or volume in parentheses, e.g. "1 slice (120g)", "1 bowl (300g)", "1 glass (250ml)"
- Use "high", "medium", or "low" for confidence
- If no food is detected, return an empty foods array with a description explaining what you see
- calories, protein, carbs, fat and totalCalories must be plain numbers (not strings, no units)`;
}

/** Pull the text out of an OpenAI-style message content (string or array of parts). */
export function extractMessageText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) =>
        part && typeof part === "object" && (part as { type?: string }).type === "text"
          ? String((part as { text?: unknown }).text ?? "")
          : "",
      )
      .join("");
  }
  return "";
}

/** Lenient number parse used for model output: "250 kcal" -> 250, negatives/NaN -> 0, 1 decimal. */
export function toNumber(value: unknown): number {
  let n: number;
  if (typeof value === "number") n = value;
  else if (typeof value === "string") n = parseFloat(value.replace(/,/g, "").replace(/[^0-9.\-]+/g, " ").trim());
  else n = NaN;
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * 10) / 10;
}

export function toConfidence(value: unknown): Confidence {
  const v = String(value ?? "").toLowerCase();
  return v === "high" || v === "low" ? v : "medium";
}

/** Find and parse the first JSON object in the model output (tolerates ```json fences / extra prose). */
export function parseJsonObject(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const candidates = [trimmed];
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) candidates.push(fenced[1].trim());
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start !== -1 && end > start) candidates.push(trimmed.slice(start, end + 1));
  for (const c of candidates) {
    try {
      const parsed = JSON.parse(c);
      if (parsed && typeof parsed === "object") {
        // Some models return a bare array of foods
        if (Array.isArray(parsed)) return { foods: parsed };
        return parsed as Record<string, unknown>;
      }
    } catch {
      // try next candidate
    }
  }
  return null;
}

/**
 * Parse + normalize the LLM output. Returns null when the output is empty or
 * not a usable analysis (so the caller can retry / report an error instead of
 * silently showing "no food detected").
 */
export function parseFoodAnalysis(text: string): FoodAnalysis | null {
  const obj = parseJsonObject(text);
  if (!obj || !Array.isArray(obj.foods)) return null;

  const foods: AnalyzedFood[] = (obj.foods as unknown[])
    .filter((f): f is Record<string, unknown> => !!f && typeof f === "object")
    .map((f) => ({
      name: String(f.name ?? "").trim() || "Unknown food",
      calories: Math.round(toNumber(f.calories)),
      protein: toNumber(f.protein),
      carbs: toNumber(f.carbs ?? f.carbohydrates),
      fat: toNumber(f.fat),
      servingSize: String(f.servingSize ?? f.serving_size ?? "").trim() || "1 serving",
      confidence: toConfidence(f.confidence),
    }));

  const summed = foods.reduce((sum, f) => sum + f.calories, 0);
  const total = toNumber(obj.totalCalories);

  return {
    foods,
    totalCalories: total > 0 ? Math.round(total) : summed,
    description: typeof obj.description === "string" ? obj.description : "",
  };
}

/** Values for an entry after applying a servings multiplier (matches how the log totals entries). */
export function scaleFood(food: Pick<AnalyzedFood, "calories" | "protein" | "carbs" | "fat">, servings: number) {
  const s = Number.isFinite(servings) && servings > 0 ? servings : 1;
  return {
    calories: Math.round(food.calories * s),
    protein: Math.round(food.protein * s),
    carbs: Math.round(food.carbs * s),
    fat: Math.round(food.fat * s),
  };
}

/** Response of POST /api/analyze-food (same shape the app used with the old server). */
export type AnalyzeFoodResponse =
  | { success: true; data: FoodAnalysis }
  | { success: false; error: string };

export const ANALYZE_FAILED_MESSAGE = "Could not analyze the photo. Please try again.";
