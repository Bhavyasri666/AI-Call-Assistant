
require("dotenv").config();

async function main() {
  const key = (process.env.GEMINI_API_KEY || "").trim();

  if (!key) {
    console.log("API key missing from .env");
    return;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);

  try {
    const response = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models",
      {
        headers: { "x-goog-api-key": key },
        signal: controller.signal
      }
    );

    const data = await response.json();
    console.log("HTTP STATUS:", response.status);

    if (!response.ok) {
      console.log("API ERROR:", data.error?.message || data);
      return;
    }

    const models = (data.models || [])
      .filter(m => (m.supportedGenerationMethods || []).includes("generateContent"))
      .map(m => m.name);

    console.log("Available generation models:");
    console.log(models.join("\n"));
  } catch (e) {
    console.log("ERROR:", e.name === "AbortError" ? "Timed out" : e.message);
  } finally {
    clearTimeout(timer);
  }
}

main();
