
import { useCallback, useEffect, useState } from "react";
import "./App.css";

const API_URL = (
  import.meta.env.VITE_API_URL || "https://ai-call-assistant-x06j.onrender.com"
).replace(/\/$/, "");

const STAGES = [
  {
    name: "Opening",
    purpose: "Reach the right person and introduce the caller.",
    events: [
      "Correct person reached",
      "Caller introduced themselves",
      "Wrong person reached",
      "Call ended during opening",
    ],
  },
  {
    name: "Purpose",
    purpose: "Explain the reason for the call in one or two sentences.",
    events: [
      "Purpose explained",
      "Prospect asked why they were called",
      "Prospect interrupted the explanation",
      "Call ended during purpose",
    ],
  },
  {
    name: "Permission",
    purpose: "Ask whether the prospect can talk now or prefers another time.",
    events: [
      "Prospect agreed to talk",
      "Prospect was busy",
      "Callback requested",
      "Call ended during permission",
    ],
  },
  {
    name: "Their Business",
    purpose: "Ask about the prospect's company before discussing the offer.",
    events: [
      "Business details discussed",
      "Caller asked about current work",
      "Prospect gave limited information",
      "Call ended during business discussion",
    ],
  },
  {
    name: "Their Need",
    purpose: "Capture the prospect's need in their exact words.",
    events: [
      "Need stated clearly",
      "Need discussed but not clearly stated",
      "No specific need shared",
      "Call ended before need was captured",
    ],
  },
  {
    name: "Objection",
    purpose: "Listen to the prospect's reason for hesitation or refusal.",
    events: [
      "Price or budget concern",
      "Timing or availability concern",
      "Not interested",
      "No objection raised",
    ],
  },
  {
    name: "Next Step",
    purpose: "Record a concrete action, including when and how it will happen.",
    events: [
      "Callback time agreed",
      "Follow-up message or email agreed",
      "Meeting or demo agreed",
      "No next step agreed",
    ],
  },
  {
    name: "Close",
    purpose: "Record the outcome, next step, and prospect's exact words.",
    events: [
      "Interested",
      "Callback requested",
      "Not interested",
      "No answer or call ended",
    ],
  },
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

function createId() {
  return globalThis.crypto?.randomUUID
    ? `CALL-${globalThis.crypto.randomUUID()}`
    : `CALL-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function readResponse(response) {
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || `Request failed (${response.status}).`);
  }

  return data;
}

function App() {
  const [transcript, setTranscript] = useState("");
  const [summary, setSummary] = useState("");
  const [transcriptId, setTranscriptId] = useState(createId);
  const [stageIndex, setStageIndex] = useState(0);
  const [selectedEvents, setSelectedEvents] = useState({});
  const [prospectWords, setProspectWords] = useState("");
  const [outcome, setOutcome] = useState("");
  const [nextStep, setNextStep] = useState("");
  const [calls, setCalls] = useState([]);
  const [view, setView] = useState("workspace");
  const [loading, setLoading] = useState(false);
  const [loadingCalls, setLoadingCalls] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [copied, setCopied] = useState(false);

  const stage = STAGES[stageIndex];
  const stageName = stage.name;
  const selectedEvent = selectedEvents[stageIndex] || "";

  const loadCalls = useCallback(async () => {
    setLoadingCalls(true);

    try {
      const response = await fetch(`${API_URL}/api/calls`);
      const data = await readResponse(response);
      setCalls(data.calls || []);
      setError("");
    } catch (err) {
      setError(err.message || "Could not load saved calls.");
    } finally {
      setLoadingCalls(false);
    }
  }, []);

  useEffect(() => {
    loadCalls();
  }, [loadCalls]);

  function resetWorkspace() {
    setTranscript("");
    setSummary("");
    setTranscriptId(createId());
    setStageIndex(0);
    setSelectedEvents({});
    setProspectWords("");
    setOutcome("");
    setNextStep("");
    setError("");
    setNotice("New call workspace ready.");
    setCopied(false);
    setView("workspace");
  }

  function openCall(call) {
    setTranscriptId(call.transcript_id);
    setTranscript(call.transcript || "");
    setSummary(call.summary || "");

    const index = STAGES.findIndex((item) => item.name === call.stage);
    const restoredIndex = index >= 0 ? index : 0;

    setStageIndex(restoredIndex);
    setProspectWords(call.prospect_words || "");
    setOutcome(call.outcome || "");
    setNextStep(call.next_step || "");

    setSelectedEvents(
      call.stage_event
        ? { [restoredIndex]: call.stage_event }
        : {}
    );

    setError("");
    setNotice(`Opened saved call ${call.transcript_id}.`);
    setView("workspace");
  }

  async function persistDetails(overrides = {}) {
    const details = {
      stage: stageName,
      stage_event: selectedEvent,
      prospect_words: prospectWords,
      outcome,
      next_step: nextStep,
      ...overrides,
    };

    const response = await fetch(
      `${API_URL}/api/calls/${encodeURIComponent(transcriptId)}/stage`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(details),
      }
    );

    const data = await readResponse(response);

    setCalls((current) => {
      const exists = current.some(
        (call) => call.transcript_id === transcriptId
      );

      if (exists) {
        return current.map((call) =>
          call.transcript_id === transcriptId
            ? { ...call, ...data.call }
            : call
        );
      }

      return [data.call, ...current];
    });

    return data.call;
  }

  async function saveDetails() {
    setError("");
    setNotice("");
    setSaving(true);

    try {
      const existing = calls.some(
        (call) => call.transcript_id === transcriptId
      );

      if (existing) {
        await persistDetails();
      } else {
        if (!transcript.trim()) {
          throw new Error(
            "Enter the call transcript and generate the summary first."
          );
        }

        await generateAndSave();
      }

      setNotice("Call details saved successfully.");
      await loadCalls();
    } catch (err) {
      setError(err.message || "Unable to save call details.");
    } finally {
      setSaving(false);
    }
  }

  async function generateAndSave(finalOutcome = outcome) {
    if (!transcript.trim()) {
      throw new Error("Please enter the call transcript before saving.");
    }

    const response = await fetch(`${API_URL}/api/summarize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        transcript,
        transcriptId,
        stage: stageName,
        stage_event: selectedEvent,
        prospect_words: prospectWords,
        outcome: finalOutcome,
        next_step: nextStep,
      }),
    });

    const data = await readResponse(response);

    setSummary(data.summary || "");

    if (data.call) {
      setCalls((current) => {
        const exists = current.some(
          (call) => call.transcript_id === transcriptId
        );

        return exists
          ? current.map((call) =>
              call.transcript_id === transcriptId
                ? { ...call, ...data.call }
                : call
            )
          : [data.call, ...current];
      });
    }

    return data;
  }

  async function generateSummary() {
    setError("");
    setNotice("");
    setCopied(false);
    setLoading(true);

    try {
      await generateAndSave();
      setNotice("Summary generated and call saved.");
      await loadCalls();
    } catch (err) {
      setError(err.message || "Unable to generate summary.");
    } finally {
      setLoading(false);
    }
  }

  async function chooseStageEvent(eventText) {
    const updated = {
      ...selectedEvents,
      [stageIndex]: eventText,
    };

    setSelectedEvents(updated);
    setError("");
    setNotice("");

    const exists = calls.some(
      (call) => call.transcript_id === transcriptId
    );

    if (!exists) {
      setNotice("Event selected. It will be saved with the call.");
      return;
    }

    setSaving(true);

    try {
      await persistDetails({
        stage: stageName,
        stage_event: eventText,
      });

      setNotice("Stage event saved successfully.");
    } catch (err) {
      setError(err.message || "Unable to save stage event.");
    } finally {
      setSaving(false);
    }
  }

  async function moveToStage(index) {
    if (index < 0 || index >= STAGES.length || index === stageIndex) {
      return;
    }

    const previous = stageIndex;
    setStageIndex(index);
    setError("");
    setNotice("");

    const exists = calls.some(
      (call) => call.transcript_id === transcriptId
    );

    if (!exists) {
      setNotice(`Stage selected: ${STAGES[index].name}.`);
      return;
    }

    setSaving(true);

    try {
      await persistDetails({
        stage: STAGES[index].name,
        stage_event: selectedEvents[index] || "",
      });

      setNotice(`Stage saved: ${STAGES[index].name}.`);
    } catch (err) {
      setStageIndex(previous);
      setError(err.message || "Unable to save stage.");
    } finally {
      setSaving(false);
    }
  }

  async function endCall() {
    setError("");
    setNotice("");
    setLoading(true);

    try {
      const finalOutcome = outcome || "Call Ended";
      await generateAndSave(finalOutcome);
      setOutcome(finalOutcome);
      setNotice(`Call ended and saved at stage: ${stageName}.`);
      await loadCalls();
      setView("history");
    } catch (err) {
      setError(err.message || "Unable to save the call.");
    } finally {
      setLoading(false);
    }
  }

  async function copySummary() {
    try {
      await navigator.clipboard.writeText(summary);
      setCopied(true);
      setError("");
    } catch {
      setError("Copy failed. Please copy the summary manually.");
    }
  }

  const currentCall = calls.find(
    (call) => call.transcript_id === transcriptId
  );

  return (
    <main className="app">
      <header className="topbar">
        <div className="brand">
          <div className="logo">AI</div>
          <div>
            <h1>AI Call Assistant</h1>
            <p>Every conversation, one clear next step.</p>
          </div>
        </div>

        <div className="actions">
          <button
            className="secondary-button"
            onClick={() =>
              setView(view === "history" ? "workspace" : "history")
            }
          >
            {view === "history" ? "Call workspace" : "Past calls"}
          </button>

          <button className="new-call-button" onClick={resetWorkspace}>
            + New call
          </button>
        </div>
      </header>

      <section className="hero">
        <span className="hero-kicker">AI CALL ASSISTANT</span>
        <h2>Capture the call. Keep the next step clear.</h2>
        <p>
          Track the conversation through eight stages, preserve the
          prospect&apos;s exact words, and save the call outcome.
        </p>
        <div className="hero-tags">
          <span>✦ AI summaries</span>
          <span>↗ 8 call stages</span>
          <span>◈ Saved records</span>
        </div>
      </section>

      {error && <p className="message error" role="alert">{error}</p>}
      {notice && !error && (
        <p className="message success" role="status">{notice}</p>
      )}

      {view === "history" ? (
        <section className="card">
          <div className="section-heading">
            <div>
              <span className="eyebrow">CALL HISTORY</span>
              <h2>Past calls</h2>
            </div>
            <button className="secondary-button" onClick={loadCalls}>
              Refresh
            </button>
          </div>

          {loadingCalls ? (
            <p className="empty-state">Loading saved calls...</p>
          ) : calls.length === 0 ? (
            <p className="empty-state">No saved calls yet.</p>
          ) : (
            <div className="call-list">
              {calls.map((call) => (
                <button
                  type="button"
                  key={call.transcript_id}
                  className="call-record"
                  onClick={() => openCall(call)}
                >
                  <span className="record-topline">
                    <span className="record-marker" />
                    <span>Stage reached: {call.stage || "Unknown"}</span>
                  </span>
                  <strong>{call.transcript_id}</strong>
                  <span className="record-summary">
                    {call.summary || "No summary available"}
                  </span>
                  <span className="record-date">
                    Event: {call.stage_event || "Not recorded"}
                  </span>
                  <span className="record-date">
                    Outcome: {call.outcome || "Not recorded"}
                  </span>
                  <span className="record-date">
                    Exact words: {call.prospect_words || "Not recorded"}
                  </span>
                  <span className="record-date">
                    Next step: {call.next_step || "Not recorded"}
                  </span>
                  <span className="record-date">
                    {call.created_at
                      ? new Date(call.created_at).toLocaleString()
                      : ""}
                  </span>
                </button>
              ))}
            </div>
          )}
        </section>
      ) : (
        <div className="workspace">
          <div className="main-column">
            <section className="card">
              <div className="section-heading">
                <div>
                  <span className="eyebrow">01 / CALL PROGRESS</span>
                  <h2>
                    {String(stageIndex + 1).padStart(2, "0")} — {stage.name}
                  </h2>
                </div>
                <span className="status-pill">
                  {saving ? "Saving..." : `Stage ${stageIndex + 1} of 8`}
                </span>
              </div>

              <div className="record-id">
                <div>
                  <span className="field-label">CALL ID</span>
                  <strong>{transcriptId}</strong>
                </div>
                <button
                  className="text-button"
                  onClick={() =>
                    navigator.clipboard.writeText(transcriptId)
                      .then(() => setNotice("Call ID copied."))
                      .catch(() => setError("Could not copy call ID."))
                  }
                >
                  Copy ID
                </button>
              </div>

              <p className="hint">{stage.purpose}</p>

              <div className="stage-progress" aria-label="Call stages">
                {STAGES.map((item, index) => (
                  <button
                    type="button"
                    key={item.name}
                    className={`stage-item ${
                      index <= stageIndex ? "stage-completed" : ""
                    } ${index === stageIndex ? "stage-current" : ""}`}
                    onClick={() => moveToStage(index)}
                  >
                    <span className="stage-dot">
                      {index < stageIndex ? "✓" : index + 1}
                    </span>
                    <span className="stage-label">{item.name}</span>
                  </button>
                ))}
              </div>

              <h3>What happened at this stage?</h3>
              <p className="hint">
                Select the event that matches the call. These are event labels,
                not verified quotations from the transcript dataset.
              </p>

              <div className="event-options">
                {stage.events.map((item) => (
                  <button
                    type="button"
                    key={item}
                    className={`secondary-button ${
                      selectedEvent === item ? "selected" : ""
                    }`}
                    aria-pressed={selectedEvent === item}
                    onClick={() => chooseStageEvent(item)}
                  >
                    {selectedEvent === item ? "✓ " : ""}
                    {item}
                  </button>
                ))}
              </div>

              <div className="actions">
                <button
                  className="secondary-button"
                  disabled={stageIndex === 0 || saving}
                  onClick={() => moveToStage(stageIndex - 1)}
                >
                  ← Previous stage
                </button>

                <button
                  className="primary-button"
                  disabled={stageIndex === 7 || saving}
                  onClick={() => moveToStage(stageIndex + 1)}
                >
                  Next stage →
                </button>

                <button
                  className="secondary-button"
                  onClick={saveDetails}
                  disabled={saving || loading}
                >
                  Save details
                </button>

                <button
                  className="danger-button"
                  onClick={endCall}
                  disabled={loading || saving}
                >
                  End call
                </button>
              </div>
            </section>

            <section className="card">
              <div className="section-heading">
                <div>
                  <span className="eyebrow">02 / PROSPECT NOTES</span>
                  <h2>Record what the prospect said</h2>
                </div>
              </div>

              <label htmlFor="prospect-words">
                Exact prospect words — especially Stage 5
              </label>
              <p className="hint">
                Copy the prospect&apos;s words exactly from the transcript.
                Do not rewrite, summarize, or add assumptions.
              </p>
              <textarea
                id="prospect-words"
                rows={4}
                value={prospectWords}
                onChange={(event) => setProspectWords(event.target.value)}
                placeholder="Paste the prospect's exact words here..."
              />

              <label htmlFor="outcome">Call outcome</label>
              <select
                id="outcome"
                value={outcome}
                onChange={(event) => setOutcome(event.target.value)}
              >
                <option value="">Choose an outcome</option>
                {OUTCOMES.map((item) => (
                  <option key={item} value={item}>{item}</option>
                ))}
              </select>

              <label htmlFor="next-step">
                Next step — action, time and channel
              </label>
              <textarea
                id="next-step"
                rows={3}
                value={nextStep}
                onChange={(event) => setNextStep(event.target.value)}
                placeholder="Enter only the next action supported by the conversation."
              />

              <label htmlFor="transcript">Full call transcript</label>
              <textarea
                id="transcript"
                rows={8}
                value={transcript}
                onChange={(event) => setTranscript(event.target.value)}
                placeholder="Paste the actual call transcript here..."
              />

              <div className="actions">
                <span className="count">{transcript.length} characters</span>
                <button
                  className="primary-button"
                  onClick={generateSummary}
                  disabled={loading || saving}
                >
                  {loading ? "Processing..." : "✦ Generate summary & save"}
                </button>
              </div>
            </section>

            {summary && (
              <section className="card result-card">
                <span className="eyebrow">03 / AI-GENERATED RESULT</span>
                <h2>Call summary</h2>
                <p className="summary-text">{summary}</p>
                <div className="summary-footer">
                  <span>Linked to {transcriptId}</span>
                  <button className="secondary-button" onClick={copySummary}>
                    {copied ? "Copied ✓" : "Copy summary"}
                  </button>
                </div>
              </section>
            )}
          </div>

          <aside className="card history-card">
            <div className="section-heading">
              <div>
                <span className="eyebrow">YOUR WORKSPACE</span>
                <h2>Saved calls</h2>
              </div>
              <span className="count-badge">{calls.length}</span>
            </div>

            <p className="hint">
              Open a record to review its transcript, summary, event, outcome
              and stage reached.
            </p>

            {loadingCalls ? (
              <p className="empty-state">Loading saved calls...</p>
            ) : calls.length === 0 ? (
              <div className="empty-state">
                <span className="empty-icon">◈</span>
                <strong>No saved calls yet</strong>
                <p>Generate a summary or end a call to save its record.</p>
              </div>
            ) : (
              <div className="call-list">
                {calls.map((call) => (
                  <button
                    type="button"
                    key={call.transcript_id}
                    className={`call-record ${
                      call.transcript_id === transcriptId ? "selected" : ""
                    }`}
                    onClick={() => openCall(call)}
                  >
                    <span className="record-topline">
                      <span className="record-marker" />
                      <span>
                        Stage{" "}
                        {STAGES.findIndex((s) => s.name === call.stage) + 1 || "—"}
                        : {call.stage}
                      </span>
                    </span>
                    <strong>{call.transcript_id}</strong>
                    <span className="record-summary">
                      {call.summary || "No summary available"}
                    </span>
                    <span className="record-date">
                      Event: {call.stage_event || "Not recorded"}
                    </span>
                    <span className="record-date">
                      Outcome: {call.outcome || "Not recorded"}
                    </span>
                    <span className="record-date">
                      Exact words: {call.prospect_words || "Not recorded"}
                    </span>
                    <span className="record-date">
                      Next step: {call.next_step || "Not recorded"}
                    </span>
                    <span className="record-date">
                      {call.created_at
                        ? new Date(call.created_at).toLocaleString()
                        : ""}
                    </span>
                  </button>
                ))}
              </div>
            )}

            <button className="refresh-button" onClick={loadCalls}>
              ↻ Refresh records
            </button>
          </aside>
        </div>
      )}

      <footer className="footer">
        <span>AI Call Assistant</span>
        <span>AI summaries are based on the transcript provided.</span>
      </footer>
    </main>
  );
}

export default App;