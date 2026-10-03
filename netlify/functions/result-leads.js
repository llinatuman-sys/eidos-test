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
      telegram: data.telegram,
      primaryRole: data.primaryRole,
      secondaryRole: data.secondaryRole,
      resultUrl: data.resultUrl,
      at: new Date().toISOString(),
    };
    console.log("EIDOS result lead:", JSON.stringify(record));

    try {
      // Telegram is appended as a NEW last column so existing columns keep
      // their position. Add a "Telegram" header in the next free column of
      // the Leads tab in the Sheet - the Apps Script just writes whatever
      // array it receives as a new row, so no script change should be
      // needed, but worth a quick test submission to confirm.
      await appendRow("Leads", [
        record.at,
        record.email || "",
        record.primaryRole || "",
        record.secondaryRole || "",
        record.resultUrl || "",
        record.telegram || "",
      ]);
    } catch (sheetErr) {
      // Don't fail the request just because the sheet write failed —
      // log it so it's visible in the Netlify function logs.
      console.error("EIDOS lead sheet write failed:", sheetErr.message);
    }

    try {
      // Kick off the background function that generates this visitor's PDF
      // and pushes it to Lina's Telegram. It's a Netlify "background
      // function" — this fetch resolves almost instantly (a 202, work
      // keeps running after), so awaiting it doesn't meaningfully delay the
      // response below. Wrapped in try/catch same as the sheet write:
      // never block unlocking the visitor's result on this.
      const origin = process.env.URL || process.env.DEPLOY_PRIME_URL || "";
      await fetch(`${origin}/.netlify/functions/notify-lead-pdf-background`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: record.email,
          telegram: record.telegram,
          primaryRole: data.primaryRole,
          secondaryRole: data.secondaryRole,
          ranking: data.ranking,
          resultUrl: data.resultUrl,
        }),
      });
    } catch (notifyErr) {
      console.error("EIDOS notify-lead-pdf trigger failed:", notifyErr.message);
    }

    return { statusCode: 200, headers: {"Content-Type":"application/json"}, body: JSON.stringify({ ok: true }) };
  } catch (e) {
    return { statusCode: 200, headers: {"Content-Type":"application/json"}, body: JSON.stringify({ ok: true }) };
  }
};
