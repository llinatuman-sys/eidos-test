// Minimal, anonymous funnel tracker for the quiz.
// The client (see the inline script in index.html) pings this endpoint
// twice per visit, not once per question: once with event "visit" when
// the page loads, and once more when the visitor leaves (tab closed,
// navigated away, or PDF downloaded) with event "exit" (still mid-quiz —
// step/total show where they stopped) or "result" (finished — result
// holds the two role names, e.g. "Провідник / Провокатор"). No per-step
// rows in between, no email, no name, no IP — nothing personal.
//
// The "exit"/"result" beacon also carries `answers`: one comma-separated
// entry per question, in question order, so column position = question
// number (e.g. "guide,method,provoker,..."). A question that lets the
// visitor split weight across roles (the point-allocation and slider
// question types) encodes as "role:weight+role:weight" for that slot.
// A question the visitor never reached is left blank at that position,
// so the array stays aligned to question number even for drop-offs.
//
// Rows land in a "Funnel" tab of the same Google Sheet used for leads,
// so drop-off is visible as: how many "visit" rows vs. how many "exit"
// rows stalled at each step vs. how many "result" rows (and which
// combination they got), plus — via the answers column — which role
// people leaned toward on each individual question.
//
// This is fire-and-forget from the client (sendBeacon/fetch keepalive),
// so it always returns fast and never throws — a failed sheet write is
// just logged, never surfaced to the visitor.
const { appendRow } = require("./_sheets");

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "" };
  }
  try {
    const data = JSON.parse(event.body || "{}");
    const evt = typeof data.event === "string" ? data.event.slice(0, 40) : "view";
    const step = Number.isFinite(data.step) ? data.step : "";
    const total = Number.isFinite(data.total) ? data.total : "";
    const result = typeof data.result === "string" ? data.result.slice(0, 120) : "";
    const answers = typeof data.answers === "string" ? data.answers.slice(0, 2000) : "";

    // Netlify Functions end the invocation as soon as the handler
    // returns, so this has to be awaited or the write may never
    // actually reach Google Sheets.
    try {
      await appendRow("Funnel", [
        new Date().toISOString(),
        evt,
        step,
        total,
        result,
        answers,
      ]);
    } catch (sheetErr) {
      console.error("EIDOS track-event sheet write failed:", sheetErr.message);
    }
  } catch (e) {
    // ignore malformed beacons
  }
  return { statusCode: 204, body: "" };
};
