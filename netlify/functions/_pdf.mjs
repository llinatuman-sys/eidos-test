// Shared PDF-generation helper used by both generate-pdf.mjs (legacy
// client-triggered download - no longer linked from the UI, kept for manual
// use) and notify-lead-pdf-background.mjs (automatic: fires the moment a
// visitor leaves their email, pushes the finished PDF to Lina's Telegram).
//
// Pulling this into one file means the PDFShift request (timeout value,
// margins, etc.) only exists in one place - the earlier bug where the
// timeout was changed in generate-pdf.mjs but nothing else used the same
// value shouldn't be able to happen again once there's only one copy.

const ROLES = ["architect", "craft", "friend", "guide", "method", "provoker", "scout"];

export function isValidRole(r) {
  return ROLES.includes(r);
}

export function isValidRank(rank) {
  const parts = (rank || "").split(",");
  if (parts.length !== ROLES.length) return false;
  const seen = new Set(parts);
  if (seen.size !== ROLES.length) return false;
  return parts.every(isValidRole);
}

// Renders the result page (same one a visitor sees) through PDFShift and
// returns the PDF as a Buffer. Throws on any failure - callers decide how
// to handle that (generate-pdf.mjs returns an error Response to the
// visitor; notify-lead-pdf-background.mjs just logs it, since nobody is
// waiting on the other end of a background function).
export async function generatePdfBuffer({ primaryRole, secondaryRole, rank, origin }) {
  const apiKey = process.env.PDFSHIFT_API_KEY;
  if (!apiKey) {
    throw new Error("Missing PDFSHIFT_API_KEY environment variable");
  }

  const result = `${primaryRole}-${secondaryRole}`;
  const pageUrl = `${origin}/index.html?result=${encodeURIComponent(result)}&rank=${encodeURIComponent(rank)}`;

  const pdfshiftRes = await fetch("https://api.pdfshift.io/v3/convert/pdf", {
    method: "POST",
    headers: {
      "X-API-Key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      source: pageUrl,
      format: "A4",
      use_print: true,
      margin: { top: "25mm", bottom: "25mm", left: "20mm", right: "20mm" },
      // 30 is the hard max this PDFShift plan accepts - see the long comment
      // that used to live in generate-pdf.mjs for the full story. Do not
      // raise this without checking the plan's actual ceiling first.
      timeout: 30,
    }),
  });

  if (!pdfshiftRes.ok) {
    const errText = await pdfshiftRes.text().catch(() => "");
    throw new Error(`PDFShift ${pdfshiftRes.status}: ${errText.slice(0, 300)}`);
  }

  const arrayBuffer = await pdfshiftRes.arrayBuffer();
  return Buffer.from(arrayBuffer);
}
