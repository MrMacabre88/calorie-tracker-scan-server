import {
  ANALYZE_FAILED_MESSAGE,
  buildFoodAnalysisPrompt,
  parseFoodAnalysis,
  type AnalyzeFoodResponse,
} from "../shared/food-analysis";

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
