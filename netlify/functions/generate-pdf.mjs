// Generates the same PDF the "Завантажити PDF" button used to get via
// window.print() — server-side, so the visitor gets a file handed straight
// to them with no browser print dialog and no manual "turn off headers and
// footers" step.
//
// This version calls PDFShift (https://pdfshift.io), a managed HTML-to-PDF
// API, instead of launching headless Chromium ourselves inside this
// function. Two earlier approaches were tried and dropped:
//   - @sparticuz/chromium + puppeteer-core, launching Chromium directly in
//     the function: kept failing at runtime in production (batch49/50),
//     and with no shell access inside a serverless function, the exact
//     cause (dependency bundling? binary download? missing system lib?)
//     was never confirmed.
//   - html2canvas, rendering the PDF entirely in the visitor's browser:
//     dropped whole sections of content and mis-rendered overlays, because
//     it re-implements CSS rendering instead of using a real browser.
// PDFShift runs actual headless-browser infrastructure as its product, so
// it reproduces the exact same print rendering (`use_print: true` below)
// that was already verified pixel-correct with Puppeteer locally, without
// this function needing to launch or ship a browser itself.
//
// Requires a Netlify environment variable, set in the Netlify UI under
// Site configuration -> Environment variables:
//   PDFSHIFT_API_KEY - the API key from your PDFShift account (Account /
//   API Keys in the PDFShift dashboard)
//
// Netlify Functions v2 (ESM): exports a default function taking a standard
// Request and returning a standard Response, which streams the binary PDF
// straight back (no 6MB base64-JSON cap like v1/CommonJS functions have).

const ROLES = ["architect", "craft", "friend", "guide", "method", "provoker", "scout"];

function isValidRole(r) {
  return ROLES.includes(r);
}

function isValidRank(rank) {
  const parts = rank.split(",");
  if (parts.length !== ROLES.length) return false;
  const seen = new Set(parts);
  if (seen.size !== ROLES.length) return false;
  return parts.every(isValidRole);
}

export default async (req, context) => {
  const url = new URL(req.url);
  const result = url.searchParams.get("result") || "";
  const rank = url.searchParams.get("rank") || "";

  const [dom, comp] = result.split("-");
  if (!isValidRole(dom) || !isValidRole(comp) || dom === comp || !isValidRank(rank)) {
    return new Response("Invalid result/rank parameters", { status: 400 });
  }

  const apiKey = process.env.PDFSHIFT_API_KEY;
  if (!apiKey) {
    console.error("generate-pdf: missing PDFSHIFT_API_KEY environment variable");
    return new Response("PDF generation is not configured", { status: 500 });
  }

  // Same page the old Puppeteer pipeline rendered, with the same query
  // params the site already uses - PDFShift just needs a URL it can load.
  const pageUrl = `${url.origin}/index.html?result=${encodeURIComponent(result)}&rank=${encodeURIComponent(rank)}`;

  try {
    const pdfshiftRes = await fetch("https://api.pdfshift.io/v3/convert/pdf", {
      method: "POST",
      headers: {
        "X-API-Key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        source: pageUrl,
        format: "A4",
        use_print: true, // apply the site's @media print rules, not the screen ones
        margin: { top: "25mm", bottom: "25mm", left: "20mm", right: "20mm" },
        // The result page is long and image-heavy (12 printed pages), so
        // PDFShift's own page-render sometimes takes 20+ seconds - confirmed
        // by testing the live endpoint directly: one run finished in ~10.5s,
        // another in ~21s, both with a valid PDF. 25s was cutting that off
        // mid-render on the slower runs, which caused intermittent
        // "Не вдалося згенерувати PDF" failures.
        //
        // 30 is the max this field accepts on our PDFShift plan - a value
        // above that is rejected outright with a 400 ("You cannot set a
        // timeout value higher than 30s"), confirmed from the Netlify
        // function log on 2026-10-03. An earlier version of this fix set it
        // to 45, which looked safe against Netlify's own 60s function limit
        // but silently broke every single PDF generation (every request hit
        // that 400, not just the slow ones). 30 is both the plan's ceiling
        // and comfortably above the ~21s slow case observed above.
        timeout: 30,
      }),
    });

    if (!pdfshiftRes.ok) {
      const errText = await pdfshiftRes.text().catch(() => "");
      console.error("generate-pdf: PDFShift error", pdfshiftRes.status, errText.slice(0, 500));
      // Temporary: include PDFShift's own error text in the response body (not
      // just a generic message) so the real cause (bad/expired key, exhausted
      // credits, etc.) can be seen directly by calling this endpoint, without
      // needing to open the Netlify function log. The site's own "Завантажити
      // PDF" button still only ever shows the visitor the generic
      // "Не вдалося згенерувати PDF" alert - it doesn't read this body - so
      // this is safe to leave in.
      return new Response(
        `PDF generation failed (PDFShift ${pdfshiftRes.status}): ${errText.slice(0, 300)}`,
        { status: 502 }
      );
    }

    const pdfBuffer = await pdfshiftRes.arrayBuffer();

    return new Response(pdfBuffer, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="eidos-${dom}-${comp}.pdf"`,
      },
    });
  } catch (err) {
    console.error("generate-pdf failed:", err);
    return new Response("PDF generation failed", { status: 500 });
  }
};
