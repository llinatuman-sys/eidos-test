// Handles the "Відкрити PDF" email-capture form on the result page.
// The original site posted this to a backend that logged the email before
// revealing the PDF download button. This static export has no backend of
// its own, so this function just accepts the submission (always succeeds)
// and logs it to the Netlify function log, which is enough for the client
// to unlock the "Завантажити PDF" button. It never blocks the visitor.
exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  try {
    const data = JSON.parse(event.body || "{}");
    // Simple honeypot check (the client sends a hidden "website" field).
    if (data.website) {
      return { statusCode: 200, body: JSON.stringify({ ok: true }) };
    }
    console.log("EIDOS result lead:", JSON.stringify({
      email: data.email,
      primaryRole: data.primaryRole,
      secondaryRole: data.secondaryRole,
      resultUrl: data.resultUrl,
      at: new Date().toISOString(),
    }));
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ok: true }),
    };
  } catch (e) {
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ok: true }),
    };
  }
};
