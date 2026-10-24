
require("dotenv").config();
const model = "gemini-3.1-flash-lite";
const key = (process.env.GEMINI_API_KEY || "").trim();

async function testGemini() {
  if (!key) {
    console.log("ERROR: GEMINI_API_KEY not found in .env");
    return;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);

  try {
    console.log("Testing Gemini model:", model);
    console.log("Sending a small test request...");

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": key
        },
        body: JSON.stringify({
          contents: [
            { parts: [{ text: "Reply with only the word OK." }] }
          ],
          generationConfig: {
            maxOutputTokens: 20,
            temperature: 0
          }
        }),
        signal: controller.signal
      }
    );

    const data = await response.json();
    console.log("HTTP STATUS:", response.status);

    if (!response.ok) {
      console.log("API ERROR:", data.error?.message || data);
      return;
    }

    console.log(
      "GEMINI RESPONSE:",
      data.candidates?.[0]?.content?.parts
        ?.map(part => part.text || "")
        .join("") || "No text returned"
    );
  } catch (error) {
    console.log(
      "TEST ERROR:",
      error.name === "AbortError"
        ? "Request timed out after 20 seconds."
        : error.message
    );
  } finally {
    clearTimeout(timer);
  }
}

testGemini();
