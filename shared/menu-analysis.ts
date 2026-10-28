/**
 * Prompt + response parsing for Menu & recipe scan (PortionSnap Pro).
 * The user photographs a restaurant menu or a recipe; the model estimates calories and
 * macros per dish (menu) or per serving (recipe). Kept free of server/LLM imports so it
 * can be unit-tested and shared with the app.
 */
import { parseJsonObject, toConfidence, toNumber, type Confidence } from "./food-analysis";

export type MenuScanMode = "auto" | "menu" | "recipe";
export type MenuScanKind = "menu" | "recipe" | "other";

export const MENU_SCAN_MODES: readonly MenuScanMode[] = ["auto", "menu", "recipe"];
export const MAX_MENU_DISHES = 40;

export interface MenuDish {
  name: string;
  /** Short note from the menu/recipe, e.g. "with fries" (may be empty). */
  description: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  /** What one portion means, e.g. "1 restaurant plate (~450g)" or "1 serving (1/4 of recipe)". */
  servingSize: string;
  confidence: Confidence;
}

export interface MenuAnalysis {
  kind: MenuScanKind;
  /** Restaurant/section/recipe title if visible, else "". */
  title: string;
  /** Recipes only: how many servings the whole recipe makes (0 if unknown / not a recipe). */
  servings: number;
  dishes: MenuDish[];
  /** One short sentence about the photo or the estimates. */
  note: string;
}

export type ScanMenuResponse =
  | { success: true; data: MenuAnalysis }
  | { success: false; error: string; code?: string };

export const MENU_SCAN_FAILED_MESSAGE = "Could not read that menu or recipe. Please try again with a clearer photo.";

export function normalizeMenuMode(value: unknown): MenuScanMode {
  return value === "menu" || value === "recipe" ? value : "auto";
}

export function buildMenuAnalysisPrompt(mode: MenuScanMode = "auto"): string {
  const modeLine =
    mode === "menu"
      ? "The user says this photo is a RESTAURANT MENU."
      : mode === "recipe"
        ? "The user says this photo is a RECIPE."
        : "First decide whether the photo shows a restaurant MENU or a RECIPE (or neither).";
  return `You are a nutrition estimation AI for a calorie tracking app. ${modeLine}
Answer immediately from your own nutrition knowledge. Do not search the web or call any tools.
Return ONLY a JSON object with this exact structure:
{
  "kind": "menu",
  "title": "Restaurant or recipe name if visible, else empty string",
  "servings": 0,
  "dishes": [
    {
      "name": "Dish name as written",
      "description": "very short note, e.g. key ingredients or sides",
      "calories": 650,
      "protein": 35,
      "carbs": 60,
      "fat": 28,
      "servingSize": "1 restaurant plate (~450g)",
      "confidence": "medium"
    }
  ],
  "note": "One short sentence about the estimates"
}

Rules:
- "kind" is "menu", "recipe" or "other".
- MENU: list each food or drink item you can read (up to ${MAX_MENU_DISHES}, skip prices and headings). Estimate ONE typical restaurant portion of each item as served, including listed sides. Use the menu's stated calories if printed.
- RECIPE: read the ingredients and quantities, work out how many servings it makes ("servings"; use the stated yield, or your best guess), and return the nutrition for ONE serving. Normally one dish; several only if the photo shows several separate recipes. servingSize must say it is one serving, e.g. "1 serving (1/4 of recipe, ~350g)".
- "servingSize" MUST include an approximate metric weight or volume, e.g. "(~450g)" or "(~330ml)".
- calories (kcal), protein, carbs and fat (grams) must be plain numbers, not strings, no units.
- confidence: "high" only when calories are printed or quantities are clear, "medium" for typical dishes, "low" for vague names.
- Never include prices, people, or any other personal details.
- If the photo isn't a menu or recipe, return kind "other", an empty dishes array and a note saying what you see.`;
}

function toKind(value: unknown, mode: MenuScanMode): MenuScanKind {
  const v = String(value ?? "").toLowerCase();
  if (v === "menu" || v === "recipe" || v === "other") return v;
  return mode === "auto" ? "other" : mode;
}

function clip(value: unknown, max: number): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

/**
 * Parse + normalize the model output. Returns null if it isn't usable (caller retries / errors).
 */
export function parseMenuAnalysis(text: string, mode: MenuScanMode = "auto"): MenuAnalysis | null {
  const obj = parseJsonObject(text);
  if (!obj) return null;
  const list = Array.isArray(obj.dishes) ? obj.dishes : Array.isArray(obj.foods) ? obj.foods : null;
  if (!list) return null;

  const dishes: MenuDish[] = (list as unknown[])
    .filter((d): d is Record<string, unknown> => !!d && typeof d === "object")
    .map((d) => ({
      name: clip(d.name, 80) || "Unnamed dish",
      description: clip(d.description, 140),
      calories: Math.round(toNumber(d.calories)),
      protein: toNumber(d.protein),
      carbs: toNumber(d.carbs ?? d.carbohydrates),
      fat: toNumber(d.fat),
      servingSize: clip(d.servingSize ?? d.serving_size, 80) || "1 serving",
      confidence: toConfidence(d.confidence),
    }))
    .slice(0, MAX_MENU_DISHES);

  const servings = Math.round(toNumber(obj.servings));
  return {
    kind: toKind(obj.kind, mode),
    title: clip(obj.title, 80),
    servings: servings > 0 && servings <= 100 ? servings : 0,
    dishes,
    note: clip(obj.note ?? obj.description, 240),
  };
}
