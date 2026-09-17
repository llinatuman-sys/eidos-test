// Handles the "Відкрити PDF" email-capture form on the result page.
// The original site posted this to a backend that logged the email before
// revealing the PDF download button. This function accepts the submission
// and appends it as a row to a "Leads" tab in a Google Sheet (see
// _sheets.js for the required env vars). Writing to the sheet is
// best-effort: if it fails (missing env vars, sheet not shared yet, etc.)
// the visitor still gets unlocked — we never block on it.
const { appendRow } = require("./_sheets");

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: JSON.stringify({ error: "Method not allowed" }) };
  }
  try {
    const data = JSON.parse(event.body || "{}");
    if (data.website) { // honeypot
      return { statusCode: 200, body: JSON.stringify({ ok: true }) };
    }

    const record = {
      email: data.email,
      primaryRole: data.primaryRole,
      secondaryRole: data.secondaryRole,
      resultUrl: data.resultUrl,
      at: new Date().toISOString(),
    };
    console.log("EIDOS result lead:", JSON.stringify(record));

    try {
      await appendRow("Leads", [
        record.at,
        record.email || "",
        record.primaryRole || "",
        record.secondaryRole || "",
        record.resultUrl || "",
      ]);
    } catch (sheetErr) {
      // Don't fail the request just because the sheet write failed —
      // log it so it's visible in the Netlify function logs.
      console.error("EIDOS lead sheet write failed:", sheetErr.message);
    }

    return { statusCode: 200, headers: {"Content-Type":"application/json"}, body: JSON.stringify({ ok: true }) };
  } catch (e) {
    return { statusCode: 200, headers: {"Content-Type":"application/json"}, body: JSON.stringify({ ok: true }) };
  }
};
