
const fs = require("fs");
const path = require("path");

const TRANSCRIPTS_DIR = path.join(
  __dirname,
  "..",
  "transcripts",
  "cold-call-transcripts-100",
  "transcripts"
);
const API_URL = "http://localhost:5000/api/summarize";
const DELAY_MS = 2000;

const sleep = (ms) =>
  new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  if (!fs.existsSync(TRANSCRIPTS_DIR)) {
    console.error("❌ Transcripts folder not found:", TRANSCRIPTS_DIR);
    process.exitCode = 1;
    return;
  }

  const files = fs
    .readdirSync(TRANSCRIPTS_DIR)
    .filter((file) => file.toLowerCase().endsWith(".txt"))
    .sort((a, b) =>
      a.localeCompare(b, undefined, { numeric: true })
    );

  if (files.length === 0) {
    console.log("No .txt transcript files found.");
    return;
  }

  console.log(`Found ${files.length} transcript files.`);
  console.log("Make sure the backend server is running.\n");

  let success = 0;
  let failed = 0;
  const failures = [];

  for (const file of files) {
    const filePath = path.join(TRANSCRIPTS_DIR, file);
    const transcript = fs.readFileSync(filePath, "utf8").trim();
    const transcriptId = path.basename(file, path.extname(file));

    if (!transcript) {
      failed++;
      failures.push({ file, error: "Empty transcript file" });
      console.log(`❌ ${file}: Empty file`);
      continue;
    }

    try {
      console.log(`⏳ Processing ${file} (${success + failed + 1}/${files.length})`);

      const response = await fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transcriptId, transcript }),
        signal: AbortSignal.timeout(130000),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || `HTTP ${response.status}`);
      }

      success++;
      console.log(
        `✅ ${file} | Stage: ${data.analysis?.stage || "N/A"} | Outcome: ${data.analysis?.outcome || "N/A"}`
      );
    } catch (error) {
      failed++;
      failures.push({ file, error: error.message });
      console.log(`❌ ${file}: ${error.message}`);
    }

    if (success + failed < files.length) {
      await sleep(DELAY_MS);
    }
  }

  const report = {
    completedAt: new Date().toISOString(),
    total: files.length,
    success,
    failed,
    failures,
  };

  const reportPath = path.join(__dirname, "transcript-test-report.json");
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

  console.log("\n========== BATCH TEST RESULTS ==========");
  console.log(`Total files : ${files.length}`);
  console.log(`Successful  : ${success}`);
  console.log(`Failed      : ${failed}`);
  console.log(`Report saved: ${reportPath}`);
}

main().catch((error) => {
  console.error("Batch test stopped:", error.message);
  process.exitCode = 1;
});
