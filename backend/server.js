
const express = require("express");
const cors = require("cors");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json({ limit: "1mb" }));

const CALL_STAGES = [
  "Opening",
  "Purpose",
  "Permission",
  "Their Business",
  "Their Need",
  "Objection",
  "Next Step",
  "Close",
];

const OUTCOMES = [
  "Interested",
  "Callback Requested",
  "Not Interested",
  "No Answer",
  "Wrong Person",
  "Call Ended",
  "Other",
];

const SUPABASE_URL = (process.env.SUPABASE_URL || "")
  .trim()
  .replace(/\/+$/, "");

const SUPABASE_KEY = (
  process.env.SUPABASE_SERVICE_ROLE_KEY || ""
).trim();

const GEMINI_KEY = (process.env.GEMINI_API_KEY || "").trim();
const GEMINI_MODEL =
  process.env.GEMINI_MODEL || "gemini-3.8-flash";

const CALL_SELECT =
  "id,transcript_id,transcript,summary,stage,stage_event,prospect_words,outcome,next_step,created_at,updated_at";

function supabaseReady() {
  try {
    const url = new URL(SUPABASE_URL);

    return (
      url.protocol === "https:" &&
      url.hostname.endsWith(".supabase.co") &&
      !!SUPABASE_KEY
    );
  } catch {
    return false;
  }
}

async function supabaseRequest(path, options = {}) {
  if (!supabaseReady()) {
    throw new Error(
      "Supabase configuration is invalid. Check backend/.env."
    );
  }

  const url = new URL(
    `/rest/v1/${path.replace(/^\/+/, "")}`,
    SUPABASE_URL
  );

  const response = await fetch(url, {
    ...options,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });

  const text = await response.text();
  let data = null;

  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error(
        `Invalid Supabase response (HTTP ${response.status}).`
      );
    }
  }

  if (!response.ok) {
    console.error("Supabase error:", {
      status: response.status,
      message: data?.message,
      code: data?.code,
    });

    throw new Error(
      data?.message ||
        `Supabase request failed (HTTP ${response.status}).`
    );
  }

  return data;
}

function cleanText(value, maxLength = 2000) {
  return typeof value === "string"
    ? value.trim().slice(0, maxLength)
    : "";
}

function validStage(value) {
  return CALL_STAGES.includes(value);
}

function normalizeOutcome(value) {
  if (typeof value !== "string") return "Other";

  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");

  const aliases = {
    interested: "Interested",
    "callback requested": "Callback Requested",
    callback: "Callback Requested",
    "not interested": "Not Interested",
    "no answer": "No Answer",
    "wrong person": "Wrong Person",
    "call ended": "Call Ended",
    other: "Other",
    "next step agreed": "Interested",
    "meeting scheduled": "Interested",
  };

  return aliases[normalized] || "Other";
}

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    message: "AI Call Assistant backend is running",
    supabaseConfigured: supabaseReady(),
    geminiConfigured: !!GEMINI_KEY,
    model: GEMINI_MODEL,
    stages: CALL_STAGES,
  });
});

app.get("/api/test-supabase", async (req, res) => {
  try {
    await supabaseRequest(
      "calls?select=transcript_id,stage_event,prospect_words,outcome,next_step&limit=1"
    );

    res.json({
      status: "ok",
      message: "Supabase connection and required columns are working.",
    });
  } catch (error) {
    res.status(500).json({
      status: "error",
      error: error.message,
    });
  }
});

app.get("/api/calls", async (req, res) => {
  try {
    const calls = await supabaseRequest(
      `calls?select=${CALL_SELECT}&order=created_at.desc`
    );

    res.json({
      calls: Array.isArray(calls) ? calls : [],
      stages: CALL_STAGES,
    });
  } catch (error) {
    console.error("Load calls error:", error.message);

    res.status(500).json({
      error: error.message || "Unable to load saved calls.",
    });
  }
});

app.post("/api/summarize", async (req, res) => {
  console.log("SUMMARIZE ROUTE HIT", new Date().toISOString());

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120000);

  try {
    const {
      transcript,
      transcriptId,
      stage,
      stage_event,
      prospect_words,
      outcome,
      next_step,
    } = req.body || {};

    console.log("Request received:", {
      transcriptId,
      transcriptLength:
        typeof transcript === "string" ? transcript.length : 0,
    });

    if (typeof transcript !== "string" || !transcript.trim()) {
      return res.status(400).json({
        error: "Please enter a call transcript.",
      });
    }

    if (
      typeof transcriptId !== "string" ||
      !transcriptId.trim()
    ) {
      return res.status(400).json({
        error: "A transcript ID is required.",
      });
    }

    if (!GEMINI_KEY) {
      return res.status(500).json({
        error: "GEMINI_API_KEY is missing in backend/.env.",
      });
    }

    if (!supabaseReady()) {
      return res.status(500).json({
        error: "Supabase configuration is invalid. Check backend/.env.",
      });
    }

    if (stage && !validStage(stage)) {
      return res.status(400).json({
        error: "Invalid call stage.",
      });
    }

    const transcriptText = transcript.trim();

    const prompt = `
Analyze this sales call transcript and return ONLY a valid JSON object:
{
  "summary": "Factual summary in 1 or 2 sentences",
  "stage": "One allowed stage",
  "stage_event": "Specific event that happened",
  "prospect_words": "Exact quote from the prospect",
  "outcome": "One allowed outcome",
  "next_step": "Agreed or requested next action"
}

Allowed stages: ${JSON.stringify(CALL_STAGES)}
Allowed outcomes: ${JSON.stringify(OUTCOMES)}

Rules:
1. Read the entire transcript.
2. Choose the most advanced stage clearly reached.
3. If a meeting or follow-up is agreed, choose "Next Step".
4. Describe the actual event in stage_event.
5. prospect_words must be copied exactly from a PROSPECT line.
6. Never use a CALLER line as prospect_words.
7. Never invent a quote. Return an empty string if no suitable quote exists.
8. The next_step must be supported by the transcript.
9. Include the agreed meeting time and format when available.
10. Use "Interested" if a meeting or next step is agreed.
11. Use "Callback Requested" for a callback request without a meeting agreement.
12. Use "Not Interested" only for a clear rejection.
13. Return JSON only, without Markdown.

Transcript:
${transcriptText}
`;

    console.log("Calling Gemini model:", GEMINI_MODEL);

    const geminiResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": GEMINI_KEY,
        },
        signal: controller.signal,
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [{ text: prompt }],
            },
          ],
          generationConfig: {
            responseMimeType: "application/json",
            maxOutputTokens: 500,
            temperature: 0.1,
          },
        }),
      }
    );

    const geminiData = await geminiResponse.json();

    if (!geminiResponse.ok) {
      console.error("Gemini API error:", {
        status: geminiResponse.status,
        message: geminiData.error?.message,
      });

      return res.status(502).json({
        error:
          geminiData.error?.message ||
          `Gemini request failed (HTTP ${geminiResponse.status}).`,
      });
    }

    const raw = (
      geminiData.candidates?.[0]?.content?.parts || []
    )
      .map((part) => part.text || "")
      .join("")
      .trim();

    if (!raw) {
      console.error(
        "Gemini returned no text:",
        JSON.stringify(geminiData.candidates?.[0] || {})
      );

      return res.status(502).json({
        error: "Gemini returned an empty result. Please try again.",
      });
    }

    let result;

    try {
      result = JSON.parse(raw);
    } catch {
      console.error("Gemini JSON parsing failed:", raw);

      return res.status(502).json({
        error: "Gemini returned invalid JSON. Please try again.",
      });
    }

    console.log(
      "GEMINI PARSED:",
      JSON.stringify(result, null, 2)
    );

    const summary = cleanText(result.summary, 2000);

    const detectedStage = validStage(result.stage)
      ? result.stage
      : validStage(stage)
        ? stage
        : "Opening";

    const detectedStageEvent =
      cleanText(result.stage_event, 300) ||
      cleanText(stage_event, 300);

    const detectedWords =
      cleanText(result.prospect_words, 3000) ||
      cleanText(prospect_words, 3000);

    // Save only a quote that exactly occurs in the transcript.
    const exactProspectWords =
      detectedWords && transcriptText.includes(detectedWords)
        ? detectedWords
        : "";

    const detectedOutcome = normalizeOutcome(
      result.outcome || outcome
    );

    const detectedNextStep =
      cleanText(result.next_step, 2000) ||
      cleanText(next_step, 2000);

    if (!summary) {
      return res.status(502).json({
        error: "Gemini returned an empty summary. Please try again.",
      });
    }

    const savePayload = {
      transcript_id: transcriptId.trim(),
      transcript: transcriptText,
      summary,
      stage: detectedStage,
      stage_event: detectedStageEvent,
      prospect_words: exactProspectWords,
      outcome: detectedOutcome,
      next_step: detectedNextStep,
      updated_at: new Date().toISOString(),
    };

    console.log(
      "SAVE PAYLOAD:",
      JSON.stringify(savePayload, null, 2)
    );

    const saved = await supabaseRequest(
      "calls?on_conflict=transcript_id",
      {
        method: "POST",
        headers: {
          Prefer: "resolution=merge-duplicates,return=representation",
        },
        body: JSON.stringify(savePayload),
      }
    );

    const call = Array.isArray(saved) ? saved[0] : saved;

    if (!call) {
      throw new Error("Supabase did not return the saved call.");
    }

    console.log("CALL SAVED:", {
      transcript_id: call.transcript_id,
      stage: call.stage,
      stage_event: call.stage_event,
      prospect_words: call.prospect_words,
      outcome: call.outcome,
      next_step: call.next_step,
    });

    return res.json({
      summary: call.summary || summary,
      call,
      analysis: {
        stage: call.stage,
        stage_event: call.stage_event,
        prospect_words: call.prospect_words,
        outcome: call.outcome,
        next_step: call.next_step,
      },
    });
  } catch (error) {
    console.error("Summarize/save error:", error.message);

    if (error.name === "AbortError") {
      return res.status(504).json({
        error: "Gemini took over 120 seconds to respond. Please try again.",
      });
    }

    return res.status(500).json({
      error: error.message || "Unable to generate and save summary.",
    });
  } finally {
    clearTimeout(timeout);
  }
});

app.patch("/api/calls/:transcriptId/stage", async (req, res) => {
  try {
    const transcriptId = req.params.transcriptId;
    const body = req.body || {};

    const updates = {
      updated_at: new Date().toISOString(),
    };

    if (Object.hasOwn(body, "stage")) {
      if (!validStage(body.stage)) {
        return res.status(400).json({
          error: "Invalid call stage.",
        });
      }

      updates.stage = body.stage;
    }

    if (Object.hasOwn(body, "stage_event")) {
      updates.stage_event = cleanText(body.stage_event, 300);
    }

    if (Object.hasOwn(body, "prospect_words")) {
      const words = cleanText(body.prospect_words, 3000);

      const transcriptResult = await supabaseRequest(
        `calls?select=transcript&transcript_id=eq.${encodeURIComponent(
          transcriptId
        )}&limit=1`
      );

      const originalTranscript =
        transcriptResult?.[0]?.transcript || "";

      updates.prospect_words =
        words && originalTranscript.includes(words) ? words : "";
    }

    if (Object.hasOwn(body, "outcome")) {
      const normalized = normalizeOutcome(body.outcome);

      if (
        body.outcome &&
        !OUTCOMES.includes(body.outcome) &&
        normalized === "Other"
      ) {
        return res.status(400).json({
          error: "Invalid call outcome.",
        });
      }

      updates.outcome = normalized;
    }

    if (Object.hasOwn(body, "next_step")) {
      updates.next_step = cleanText(body.next_step, 2000);
    }

    if (Object.keys(updates).length === 1) {
      return res.status(400).json({
        error: "Provide at least one field to update.",
      });
    }

    const query = new URLSearchParams({
      transcript_id: `eq.${transcriptId}`,
      select: CALL_SELECT,
    });

    const updated = await supabaseRequest(
      `calls?${query.toString()}`,
      {
        method: "PATCH",
        headers: {
          Prefer: "return=representation",
        },
        body: JSON.stringify(updates),
      }
    );

    if (!Array.isArray(updated) || updated.length === 0) {
      return res.status(404).json({
        error: "Saved call not found. Generate and save the call first.",
      });
    }

    return res.json({ call: updated[0] });
  } catch (error) {
    console.error("Update call error:", error.message);

    return res.status(500).json({
      error: error.message || "Unable to update call.",
    });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log("Supabase configured:", supabaseReady());
  console.log("Gemini configured:", !!GEMINI_KEY);
  console.log("Gemini model:", GEMINI_MODEL);
});
