// Generates the same PDF the "Завантажити PDF" button used to get via
// window.print() — but server-side, with headless Chromium, so the visitor
// gets a file handed straight to them with no browser print dialog and no
// manual "turn off headers and footers" step.
//
// This is a Netlify Functions v2 (ESM) function: it exports a default
// function that receives a standard Request and returns a standard
// Response, which is what lets us stream a binary PDF back directly
// (v1/CommonJS functions have to base64-encode the whole body into one
// JSON-ish payload, which is capped around 6MB — too tight for some of
// these PDFs; v2's Response path supports up to 20MB, comfortably above
// what any of these PDFs run).
//
// It reuses a warm headless-browser instance across invocations when the
// function container is reused (kept in module scope), the same way a
// long-lived script would, since spinning up Chromium is the slow part.
//
// It renders the SAME page the site already serves, at
// /index.html?result=<dom>-<comp>&rank=<comma-separated-roles> — the exact
// mechanism used throughout local testing this whole project — so the
// output is guaranteed to match what's been verified in preview, and is
// no longer at the mercy of whatever print settings a visitor's browser
// happens to have (which is what caused the squashed-cover-page bug: a
// real browser's native print pipeline evaluates some of this site's
// responsive CSS differently than expected, and only headless server-side
// rendering avoids that entirely).
//
// Uses @sparticuz/chromium-min rather than the full @sparticuz/chromium:
// the full package bundles the Chromium binary (~50MB+ compressed) directly
// into the function's deploy zip, which sits right at (or over) Netlify/
// Lambda's function size limit. The "-min" package ships no binary at all —
// instead, chromium.executablePath(url) downloads the matching prebuilt
// Chromium tarball from Sparticuz's GitHub release the first time a given
// function container runs, caches it in /tmp, and reuses it for every
// subsequent warm invocation on that same container. Trade-off: a cold
// start now includes a ~70MB one-time download (network-dependent, adds a
// few seconds) instead of a bigger deploy artifact — this is the version
// Ліна asked to try first, given the deploy-size risk of the full package.
// CHROMIUM_PACK_URL's version must always match the @sparticuz/chromium-min
// version pinned in package.json, and targets the x64 Lambda architecture
// (Netlify Functions run on x86_64, not arm64).

import chromium from "@sparticuz/chromium-min";
import puppeteer from "puppeteer-core";

const CHROMIUM_PACK_URL =
  "https://github.com/Sparticuz/chromium/releases/download/v153.0.0/chromium-v153.0.0-pack.x64.tar";

const ROLES = ["architect", "craft", "friend", "guide", "method", "provoker", "scout"];

let browserPromise = null;
function getBrowser() {
  if (!browserPromise) {
    browserPromise = (async () => {
      const executablePath = await chromium.executablePath(CHROMIUM_PACK_URL);
      return puppeteer.launch({
        args: chromium.args,
        defaultViewport: chromium.defaultViewport,
        executablePath,
        headless: chromium.headless,
      });
    })();
  }
  return browserPromise;
}

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

  let page;
  try {
    const browser = await getBrowser();
    page = await browser.newPage();

    const pageUrl = `${url.origin}/index.html?result=${encodeURIComponent(result)}&rank=${encodeURIComponent(rank)}`;
    await page.goto(pageUrl, { waitUntil: "networkidle0", timeout: 25000 });
    await new Promise((r) => setTimeout(r, 900));

    try {
      await page.waitForFunction(
        "Array.from(document.querySelectorAll('.notionResultPage img')).every(img => img.complete && img.naturalWidth > 0)",
        { timeout: 8000 }
      );
    } catch (e) {
      // proceed anyway rather than fail the whole download over one slow image
    }

    await page.emulateMediaType("print");
    await new Promise((r) => setTimeout(r, 800));

    const pdfBuffer = await page.pdf({
      format: "A4",
      margin: { top: "25mm", bottom: "25mm", left: "20mm", right: "20mm" },
      printBackground: true,
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
    return new Response("PDF generation failed", { status: 500 });
  } finally {
    if (page) {
      try {
        await page.close();
      } catch (e) {}
    }
  }
};
