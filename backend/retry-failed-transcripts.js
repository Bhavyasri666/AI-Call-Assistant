
const fs = require("fs");
const path = require("path");

const TRANSCRIPTS_DIR = path.join(
  __dirname,
  "..",
  "transcripts",
  "cold-call-transcripts-100",
  "transcripts"
);

const API_URL = "https://ai-call-assistant-x06j.onrender.com/api/summarize";
const FAILED_IDS = ["T030", "T075", "T076", "T081", "T084"];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  const results = [];

  for (const id of FAILED_IDS) {
    const filePath = path.join(TRANSCRIPTS_DIR, `${id}.txt`);

    if (!fs.existsSync(filePath)) {
      results.push({ id, status: "FAILED", error: "File not found" });
      continue;
    }

    const transcript = fs.readFileSync(filePath, "utf8").trim();
    let completed = false;

    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        console.log(`${id}: attempt ${attempt}/3`);

        const response = await fetch(API_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ transcriptId: id, transcript }),
          signal: AbortSignal.timeout(130000),
        });

        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || `HTTP ${response.status}`);
        }

        console.log(`✅ ${id}: saved successfully`);
        results.push({ id, status: "SUCCESS" });
        completed = true;
        break;
      } catch (error) {
        console.log(`⚠️ ${id}: ${error.message}`);

        if (attempt < 3) {
          await sleep(10000 * attempt);
        }
      }
    }

    if (!completed) {
      results.push({ id, status: "FAILED after 3 attempts" });
    }

    await sleep(3000);
  }

  const reportPath = path.join(__dirname, "retry-report.json");
  fs.writeFileSync(reportPath, JSON.stringify(results, null, 2));

  console.log("\nRetry results:");
  console.table(results);
  console.log(`Report saved: ${reportPath}`);
}

main().catch(console.error);
