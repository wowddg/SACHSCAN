/**
 * AI Detector API text detection (server-only).
 *
 * POST https://aidetectorapi.com/v1/detect
 * Authorization: Bearer <HvlkIT7Kxp38dvkW2tA5KY2WVrL9XJF8eC4hE4TpCrJiOlRtPp0T12cihbmQapB2dPbqr-NlWSGmR8Q2UcSb0Q%3D%3D>   (server env var, never client)
 *
 * The API key is read inside the call and never returned to the client. If the
 * request fails, times out, is rate limited, or returns no usable score, this
 * module throws — a detection score is never fabricated.
 */

// Production API host documented in the AI Detector API quickstart, with the
// aidetectorapi.com alias as a fallback.
const ENDPOINTS = ["https://api.sapling.ai/api/v1/aidetect"];
const TIMEOUT_MS = 45_000;

export interface SentenceScore {
  text: string;
  /** 0-100 AI probability for this sentence. */
  aiProbability: number;
}

export interface TextDetectionResult {
  /** 0-100 AI probability taken directly from the API response. */
  aiProbability: number;
  /** The exact response field the percentage was read from. */
  sourceField: string;
  classification: "LIKELY_AI" | "LIKELY_HUMAN" | "UNCERTAIN";
  /** Classification/label string returned by the API, when present. */
  apiLabel: string | null;
  language: string | null;
  wordCount: number | null;
  sentences: SentenceScore[];
  /** Extra scalar/string fields returned by the API, for transparent display. */
  extra: { key: string; value: string }[];
}

function asNumber(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** Normalises a 0-1 or 0-100 score to a 0-100 percentage. */
function toPercent(value: number): number {
  const pct = value <= 1 ? value * 100 : value;
  return Math.max(0, Math.min(100, Math.round(pct * 10) / 10));
}

function pickScore(payload: Record<string, unknown>): { value: number; field: string } | null {
  const candidates = [
    "ai_probability",
    "aiProbability",
    "ai_score",
    "aiScore",
    "fake_probability",
    "probability_ai",
    "ai_percentage",
    "score",
    "confidence",
  ];
  for (const key of candidates) {
    const n = asNumber(payload[key]);
    if (n !== null) return { value: n, field: key };
  }
  // Nested result containers used by some responses.
  for (const container of ["result", "data", "detection", "analysis"]) {
    const nested = payload[container];
    if (nested && typeof nested === "object") {
      const found = pickScore(nested as Record<string, unknown>);
      if (found) return { value: found.value, field: `${container}.${found.field}` };
    }
  }
  return null;
}

function pickLabel(payload: Record<string, unknown>): string | null {
  for (const key of ["classification", "label", "verdict", "prediction", "result_label"]) {
    const v = payload[key];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  for (const container of ["result", "data", "detection", "analysis"]) {
    const nested = payload[container];
    if (nested && typeof nested === "object") {
      const found = pickLabel(nested as Record<string, unknown>);
      if (found) return found;
    }
  }
  return null;
}

function pickSentences(payload: Record<string, unknown>): SentenceScore[] {
  const containers: unknown[] = [
    payload["sentences"],
    payload["sentence_scores"],
    payload["sentenceScores"],
    (payload["result"] as Record<string, unknown> | undefined)?.["sentences"],
    (payload["data"] as Record<string, unknown> | undefined)?.["sentences"],
    (payload["analysis"] as Record<string, unknown> | undefined)?.["sentences"],
  ];
  for (const c of containers) {
    if (!Array.isArray(c)) continue;
    const out: SentenceScore[] = [];
    for (const item of c) {
      if (!item || typeof item !== "object") continue;
      const row = item as Record<string, unknown>;
      const text =
        typeof row["sentence"] === "string"
          ? row["sentence"]
          : typeof row["text"] === "string"
            ? row["text"]
            : null;
      const scoreEntry = pickScore(row);
      if (!text || !scoreEntry) continue;
      out.push({ text, aiProbability: toPercent(scoreEntry.value) });
    }
    if (out.length) return out;
  }
  return [];
}

function pickExtra(payload: Record<string, unknown>): { key: string; value: string }[] {
  const skip = new Set([
    "sentences",
    "sentence_scores",
    "sentenceScores",
    "text",
    "result",
    "data",
    "detection",
    "analysis",
  ]);
  const out: { key: string; value: string }[] = [];
  for (const [key, value] of Object.entries(payload)) {
    if (skip.has(key)) continue;
    if (typeof value === "number" || typeof value === "boolean") out.push({ key, value: String(value) });
    else if (typeof value === "string" && value.length <= 120) out.push({ key, value });
  }
  return out.slice(0, 12);
}

function classify(pct: number, apiLabel: string | null): TextDetectionResult["classification"] {
  if (apiLabel) {
    const l = apiLabel.toLowerCase();
    if (l.includes("human")) return "LIKELY_HUMAN";
    if (l.includes("ai") || l.includes("machine") || l.includes("generated")) return "LIKELY_AI";
    if (l.includes("mixed") || l.includes("uncertain") || l.includes("unclear")) return "UNCERTAIN";
  }
  if (pct >= 70) return "LIKELY_AI";
  if (pct <= 30) return "LIKELY_HUMAN";
  return "UNCERTAIN";
}

/** Calls the AI Detector API with the submitted text and returns the real result. */
export async function detectAiText(text: string): Promise<TextDetectionResult> {
  const apiKey = process.env["AI_DETECTOR_API_KEY"];
  if (!apiKey) {
    throw new Error("Text-detection credentials are not configured on the server ().");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let response: Response | null = null;
  try {
    for (const endpoint of ENDPOINTS) {
      try {
        response = await fetch(endpoint, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({ text }),
          signal: controller.signal,
        });
      } catch (cause) {
        if (cause instanceof Error && cause.name === "AbortError") {
          throw new Error("The detection service did not respond in time. Please retry.");
        }
        response = null;
        continue;
      }
      // A 404 means this host does not serve the endpoint; try the next one.
      if (response.status !== 404) break;
      response = null;
    }
  } finally {
    clearTimeout(timer);
  }
  if (!response) {
    throw new Error("The detection service could not be reached. Please retry.");
  }

  const raw = await response.text();
  if (!response.ok) {
    if (response.status === 429) {
      throw new Error("The detection service rate limit was reached. Please wait a moment and retry.");
    }
    // A Cloudflare challenge page (HTML) is an edge block, not a credential problem.
    const isHtml = (response.headers.get("content-type") ?? "").includes("text/html");
    if (response.status === 403 && isHtml) {
      throw new Error("The detection service blocked this request at its edge. Please retry.");
    }
    if (response.status === 401 || response.status === 403) {
      throw new Error("The detection service rejected the server credentials.");
    }
    throw new Error(`The detection service returned an error (HTTP ${response.status}).`);
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new Error("The detection service returned an unreadable response.");
  }

  const score = pickScore(payload);
  if (!score) {
    throw new Error("The detection service returned no AI-probability score for this text.");
  }

  const aiProbability = toPercent(score.value);
  const apiLabel = pickLabel(payload);
  const nested = (payload["result"] ?? payload["data"] ?? {}) as Record<string, unknown>;

  return {
    aiProbability,
    sourceField: score.field,
    classification: classify(aiProbability, apiLabel),
    apiLabel,
    language:
      typeof payload["language"] === "string"
        ? (payload["language"] as string)
        : typeof nested["language"] === "string"
          ? (nested["language"] as string)
          : null,
    wordCount: asNumber(payload["word_count"]) ?? asNumber(nested["word_count"]),
    sentences: pickSentences(payload),
    extra: pickExtra(payload),
  };
}
