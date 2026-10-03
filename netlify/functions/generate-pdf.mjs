// Generates the same PDF the "Завантажити PDF" button used to get via
// window.print() - server-side, so the visitor gets a file handed straight
// to them with no browser print dialog and no manual "turn off headers and
// footers" step.
//
// As of the Telegram-notification change, this endpoint is no longer linked
// from the site's UI - the result page now always shows "Написати в
// Telegram" instead of a download button, and Lina gets the PDF pushed to
// her automatically via notify-lead-pdf-background.mjs the moment someone
// leaves their email. This file is kept as a standalone way to fetch a PDF
// for a given result/rank directly (e.g. for manual testing, or in case the
// download flow is ever wanted again) - it now just calls the shared
// generatePdfBuffer() in _pdf.mjs instead of duplicating the PDFShift call.
//
// Requires a Netlify environment variable, set in the Netlify UI under
// Site configuration -> Environment variables:
//   PDFSHIFT_API_KEY - the API key from your PDFShift account (Account /
//   API Keys in the PDFShift dashboard)

import { isValidRole, isValidRank, generatePdfBuffer } from "./_pdf.mjs";

export default async (req, context) => {
  const url = new URL(req.url);
  const result = url.searchParams.get("result") || "";
  const rank = url.searchParams.get("rank") || "";

  const [dom, comp] = result.split("-");
  if (!isValidRole(dom) || !isValidRole(comp) || dom === comp || !isValidRank(rank)) {
    return new Response("Invalid result/rank parameters", { status: 400 });
  }

  try {
    const pdfBuffer = await generatePdfBuffer({
      primaryRole: dom,
      secondaryRole: comp,
      rank,
      origin: url.origin,
    });

    return new Response(pdfBuffer, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="eidos-${dom}-${comp}.pdf"`,
      },
    });
  } catch (err) {
    console.error("generate-pdf failed:", err);
    return new Response(`PDF generation failed: ${String(err.message || err).slice(0, 300)}`, { status: 502 });
  }
};
