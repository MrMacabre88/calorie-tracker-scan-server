import {
  ANALYZE_FAILED_MESSAGE,
  buildFoodAnalysisPrompt,
  parseFoodAnalysis,
  type AnalyzeFoodResponse,
} from "../shared/food-analysis";
import {
  MENU_SCAN_FAILED_MESSAGE,
  buildMenuAnalysisPrompt,
  parseMenuAnalysis,
  type MenuScanMode,
  type ScanMenuResponse,
} from "../shared/menu-analysis";
import {
  COACH_FAILED_MESSAGE,
  buildCoachSystemPrompt,
  cleanCoachReply,
  formatSummaryForPrompt,
  type CoachRequest,
  type CoachResponse,
} from "../shared/coach";

export const DEFAULT_GEMINI_MODEL = "gemini-3.5-flash-lite";

export interface AnalyzeOptions {
  apiKey: string;
  model?: string;
  attempts?: number;
  fetchImpl?: typeof fetch;
  /** Called before each retry (attempt 2+). Return false to skip it (e.g. daily cap reached). */
  beforeRetry?: () => boolean;
}

/** Text of the first candidate, ignoring any "thought" parts. */
export function geminiText(body: unknown): string {
  const parts = (body as any)?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return "";
  return parts
    .filter((p: any) => typeof p?.text === "string" && !p.thought)
    .map((p: any) => p.text)
    .join("");
}

/**
 * Send a food photo to Google Gemini and return the parsed nutrition estimate.
 * Retries once if the model answer is empty/unparseable or the call fails.
 */
export async function analyzeFoodImage(
  input: { imageBase64: string; mimeType?: string },
  { apiKey, model = DEFAULT_GEMINI_MODEL, attempts = 2, fetchImpl = fetch, beforeRetry }: AnalyzeOptions
): Promise<AnalyzeFoodResponse> {
  const data = input.imageBase64.replace(/^data:[^;]+;base64,/, "");
  const mimeType = input.mimeType?.startsWith("image/") ? input.mimeType : "image/jpeg";

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const body = JSON.stringify({
    systemInstruction: { parts: [{ text: buildFoodAnalysisPrompt() }] },
    contents: [
      {
        role: "user",
        parts: [
          { text: "Analyze the food in this image and estimate the nutritional content." },
          { inlineData: { mimeType, data } },
        ],
      },
    ],
    generationConfig: { responseMimeType: "application/json", temperature: 0.2 },
  });

  for (let attempt = 1; attempt <= attempts; attempt++) {
    if (attempt > 1 && beforeRetry && !beforeRetry()) {
      console.warn("[analyze-food] retry skipped: daily scan cap reached");
      break;
    }
    try {
      const res = await fetchImpl(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body,
      });
      if (!res.ok) {
        const detail = (await res.text()).slice(0, 500);
        console.error(`[analyze-food] Gemini HTTP ${res.status} (attempt ${attempt}): ${detail}`);
        // Bad key / bad request won't fix itself on retry
        if (res.status === 400 || res.status === 401 || res.status === 403) break;
        continue;
      }
      const parsed = parseFoodAnalysis(geminiText(await res.json()));
      if (parsed) return { success: true, data: parsed };
      console.warn(`[analyze-food] unusable Gemini answer (attempt ${attempt})`);
    } catch (error) {
      console.error(`[analyze-food] Gemini call failed (attempt ${attempt}):`, error);
    }
  }
  return { success: false, error: ANALYZE_FAILED_MESSAGE };
}

/**
 * Shared Gemini call loop for the Pro endpoints: POST the request, parse the text with `parse`,
 * retry once on failure/unusable output (each retry asks `beforeRetry` so it counts on the cap).
 * Never logs the key or request body.
 */
export async function generateWithRetry<T>(
  tag: string,
  request: Record<string, unknown>,
  parse: (text: string) => T | null,
  { apiKey, model = DEFAULT_GEMINI_MODEL, attempts = 2, fetchImpl = fetch, beforeRetry }: AnalyzeOptions
): Promise<T | null> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const body = JSON.stringify(request);
  for (let attempt = 1; attempt <= attempts; attempt++) {
    if (attempt > 1 && beforeRetry && !beforeRetry()) {
      console.warn(`[${tag}] retry skipped: daily cap reached`);
      break;
    }
    try {
      const res = await fetchImpl(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body,
      });
      if (!res.ok) {
        const detail = (await res.text()).slice(0, 500);
        console.error(`[${tag}] Gemini HTTP ${res.status} (attempt ${attempt}): ${detail}`);
        if (res.status === 400 || res.status === 401 || res.status === 403) break;
        continue;
      }
      const parsed = parse(geminiText(await res.json()));
      if (parsed !== null) return parsed;
      console.warn(`[${tag}] unusable Gemini answer (attempt ${attempt})`);
    } catch (error) {
      console.error(`[${tag}] Gemini call failed (attempt ${attempt}):`, error);
    }
  }
  return null;
}

/** Menu & recipe scan: photo of a menu or recipe -> per-dish / per-serving estimates. */
export async function analyzeMenuImage(
  input: { imageBase64: string; mimeType?: string; mode: MenuScanMode },
  options: AnalyzeOptions
): Promise<ScanMenuResponse> {
  const data = input.imageBase64.replace(/^data:[^;]+;base64,/, "");
  const mimeType = input.mimeType?.startsWith("image/") ? input.mimeType : "image/jpeg";
  const parsed = await generateWithRetry(
    "scan-menu",
    {
      systemInstruction: { parts: [{ text: buildMenuAnalysisPrompt(input.mode) }] },
      contents: [
        {
          role: "user",
          parts: [
            { text: "Read this menu or recipe and estimate the nutrition as instructed." },
            { inlineData: { mimeType, data } },
          ],
        },
      ],
      generationConfig: { responseMimeType: "application/json", temperature: 0.2 },
    },
    (text) => parseMenuAnalysis(text, input.mode),
    options
  );
  return parsed ? { success: true, data: parsed } : { success: false, error: MENU_SCAN_FAILED_MESSAGE };
}

/** Gemini "contents" for a coach question: prior turns, then today's summary + the question. */
export function buildCoachContents(request: CoachRequest) {
  const turns = [...request.history];
  while (turns.length && turns[0].role !== "user") turns.shift();
  return [
    ...turns.map((t) => ({ role: t.role === "coach" ? "model" : "user", parts: [{ text: t.text }] })),
    {
      role: "user",
      parts: [{ text: `${formatSummaryForPrompt(request.summary)}\n\nQuestion: ${request.question}` }],
    },
  ];
}

/** AI coach: short food/nutrition answer using today's summary. */
export async function askCoach(request: CoachRequest, options: AnalyzeOptions): Promise<CoachResponse> {
  const reply = await generateWithRetry(
    "coach",
    {
      systemInstruction: { parts: [{ text: buildCoachSystemPrompt() }] },
      contents: buildCoachContents(request),
      generationConfig: { temperature: 0.5 },
    },
    (text) => {
      const cleaned = cleanCoachReply(text);
      return cleaned ? cleaned : null;
    },
    options
  );
  return reply ? { success: true, reply } : { success: false, error: COACH_FAILED_MESSAGE };
}
