// Appends rows to a Google Sheet via a Google Apps Script Web App bound to
// that sheet. This avoids needing a Google Cloud project, service account,
// or API key at all (Cloud projects created on a free trial commonly block
// service-account key creation by an org policy — Apps Script sidesteps
// that entirely, since it runs as the sheet's own owner).
//
// Setup (done once, in the Google Sheet itself):
//   1. Open the Sheet -> Extensions -> Apps Script.
//   2. Paste the doPost() script Claude provided, with a secret string.
//   3. Deploy -> New deployment -> type "Web app" -> Execute as: Me,
//      Who has access: Anyone -> Deploy. Copy the resulting /exec URL.
//
// Requires these Netlify environment variables:
//   APPS_SCRIPT_URL     - the Web App's /exec URL
//   APPS_SCRIPT_SECRET  - the same secret string used in the Apps Script code

async function appendRow(tabName, values) {
  const url = process.env.APPS_SCRIPT_URL;
  const secret = process.env.APPS_SCRIPT_SECRET;
  if (!url) throw new Error("Missing APPS_SCRIPT_URL env var");

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    // Apps Script web apps often 302-redirect a POST to a script.googleusercontent.com
    // URL; fetch follows redirects by default, so this "just works".
    body: JSON.stringify({ sheet: tabName, values, secret }),
    redirect: "follow",
  });

  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    data = { raw: text.slice(0, 300) };
  }

  if (!res.ok || data.ok === false) {
    throw new Error("Apps Script append failed: " + JSON.stringify(data));
  }
  return data;
}

module.exports = { appendRow };
