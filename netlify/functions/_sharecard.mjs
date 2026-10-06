// Generates the branded "share card" PNG (the vertical story-format image
// with the visitor's role combination and full ranking) server-side, via
// PDFShift's PNG endpoint - the same PDFShift account already used for the
// PDF, no separate signup needed.
//
// The card itself used to be drawn client-side with the Canvas API (see the
// N() function that used to live in the result page's bundle). That only
// ever ran in a visitor's browser. To let the notify-lead-pdf-background
// function push this image to Lina automatically, the same design was
// rebuilt as a plain HTML/CSS page - share-card.html, at the site root -
// which PDFShift renders and screenshots instead.

export async function generateShareCardBuffer({ primaryRole, secondaryRole, rank, origin }) {
  const apiKey = process.env.PDFSHIFT_API_KEY;
  if (!apiKey) {
    throw new Error("Missing PDFSHIFT_API_KEY environment variable");
  }

  const result = `${primaryRole}-${secondaryRole}`;
  const pageUrl = `${origin}/share-card.html?result=${encodeURIComponent(result)}&rank=${encodeURIComponent(rank)}`;

  const res = await fetch("https://api.pdfshift.io/v3/convert/png", {
    method: "POST",
    headers: {
      "X-API-Key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      source: pageUrl,
      viewport: "1080x1920",
      timeout: 30,
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`PDFShift (png) ${res.status}: ${errText.slice(0, 300)}`);
  }

  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}
