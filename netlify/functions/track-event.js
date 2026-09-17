// Minimal, anonymous funnel tracker for the quiz.
// The client (see the inline script in index.html) pings this endpoint
// with just a step number and an event type — no email, no name, no IP
// stored, nothing personal. Rows land in a "Funnel" tab of the same
// Google Sheet used for leads, so drop-off is visible as: how many
// "visit" events vs. how many rows reached each step number vs. how many
// reached "result".
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

    // Netlify Functions end the invocation as soon as the handler
    // returns, so this has to be awaited or the write may never
    // actually reach Google Sheets.
    try {
      await appendRow("Funnel", [
        new Date().toISOString(),
        evt,
        step,
        total,
      ]);
    } catch (sheetErr) {
      console.error("EIDOS track-event sheet write failed:", sheetErr.message);
    }
  } catch (e) {
    // ignore malformed beacons
  }
  return { statusCode: 204, body: "" };
};
