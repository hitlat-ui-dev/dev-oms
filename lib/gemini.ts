// @/lib/gemini.ts
// Minimal Gemini Vision OCR helper — plain REST fetch (no SDK dependency,
// matches this codebase's pattern of calling external APIs directly rather
// than pulling in a new package for one integration). Used by
// /api/dd-entries/scan to pre-fill a DD entry form from a scanned document.
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3.6-flash";

export interface ExtractedDDDetails {
  ddNumber: string | null;
  amount: number | null;
  ddDate: string | null; // ISO "YYYY-MM-DD" if found
  payeeName: string | null;
}

const EXTRACTION_PROMPT = `You are reading a scanned Indian bank Demand Draft (DD). Extract exactly these four fields and return ONLY a JSON object, no markdown, no explanation:
{
  "ddNumber": string or null,
  "amount": number or null (numeric value only, no currency symbol or commas),
  "ddDate": string or null (the DD's issue date, formatted strictly as YYYY-MM-DD),
  "payeeName": string or null (the "Pay to" / payee name printed on the DD)
}
If a field is not clearly visible, use null for it rather than guessing.`;

export async function extractDDDetailsFromImage(buffer: Buffer, mimeType: string): Promise<ExtractedDDDetails> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not configured — DD scan OCR is unavailable until it's set.");
  }

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { text: EXTRACTION_PROMPT },
              { inline_data: { mime_type: mimeType, data: buffer.toString("base64") } },
            ],
          },
        ],
        generationConfig: { temperature: 0, responseMimeType: "application/json" },
      }),
    }
  );

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Gemini API error (${res.status}): ${errText.slice(0, 300)}`);
  }

  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    throw new Error("Gemini returned no extractable text for this document.");
  }

  let parsed: any;
  try {
    parsed = JSON.parse(text);
  } catch {
    // Fallback: model occasionally wraps JSON in a fenced code block despite
    // the responseMimeType hint - strip fences and retry once.
    const stripped = text.replace(/^```(json)?/i, "").replace(/```$/, "").trim();
    parsed = JSON.parse(stripped);
  }

  return {
    ddNumber: parsed.ddNumber ?? null,
    amount: typeof parsed.amount === "number" ? parsed.amount : parsed.amount ? Number(parsed.amount) : null,
    ddDate: parsed.ddDate ?? null,
    payeeName: parsed.payeeName ?? null,
  };
}

// Used by the GeM Bill Auto-Submit browser extension's captcha OCR call
// (/api/gem-captcha-ocr) so GeM's login captcha can be auto-filled instead of
// left for a human to type. GeM's captcha text is always exactly 6
// characters, uppercase letters and digits only (see content-gem.js).
const CAPTCHA_PROMPT = `This image shows exactly 6 stylized characters (uppercase letters A-Z and digits 0-9 only - no lowercase, spaces, or symbols) rendered on a textured background. Transcribe the 6 characters exactly as drawn, left to right, and return ONLY those 6 characters as plain text - no punctuation, no explanation, nothing else.`;

async function callGeminiForCaptcha(apiKey: string, buffer: Buffer, mimeType: string): Promise<Response> {
  return fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [
        {
          parts: [
            { text: CAPTCHA_PROMPT },
            { inline_data: { mime_type: mimeType, data: buffer.toString("base64") } },
          ],
        },
      ],
      generationConfig: { temperature: 0 },
    }),
  });
}

export async function extractCaptchaTextFromImage(buffer: Buffer, mimeType: string): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not configured — captcha OCR is unavailable until it's set.");
  }

  // Gemini returns a transient 503 ("high demand") often enough in practice
  // (confirmed live 19-Sep-2026, twice) that a captcha-reading caller with
  // no other retry of its own would otherwise fall back to manual entry on
  // what's usually just a several-second blip. Two retries with a short
  // backoff, only for 503, before giving up for real.
  let res = await callGeminiForCaptcha(apiKey, buffer, mimeType);
  for (let attempt = 0; res.status === 503 && attempt < 2; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 1500 * (attempt + 1)));
    res = await callGeminiForCaptcha(apiKey, buffer, mimeType);
  }

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Gemini API error (${res.status}): ${errText.slice(0, 300)}`);
  }

  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    throw new Error("Gemini returned no text for this captcha.");
  }

  const cleaned = text.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  if (!cleaned) {
    throw new Error("Gemini's captcha reading had no usable characters.");
  }
  return cleaned;
}
