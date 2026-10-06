// Fires automatically every time a visitor leaves their email on the
// result page (triggered server-side by result-leads.js, right after it
// saves the lead to the Sheet). Generates that visitor's PDF and pushes it
// to Lina's own Telegram via a personal bot - the bot only ever messages
// Lina, never the visitor. This is what lets her see "new lead + their
// finished PDF" show up in Telegram before the visitor has even opened a
// chat with her.
//
// A Netlify "background function": the caller (result-leads.js) gets an
// immediate 202 and doesn't wait for this to finish, so the visitor never
// sees a delay for the PDF generation. Background functions can run up to
// 15 minutes and can't return anything to the original caller - any result
// here (success or failure) only ever reaches Telegram or the function
// logs, never result-leads.js or the visitor.
//
// Requires two Netlify environment variables, set in the Netlify UI under
// Site configuration -> Environment variables:
//   TELEGRAM_BOT_TOKEN - from @BotFather after creating a bot (Telegram:
//     message @BotFather, /newbot, follow the prompts)
//   TELEGRAM_CHAT_ID   - Lina's own numeric Telegram id, e.g. from
//     @userinfobot (message it, it replies with your Id instantly)

import { isValidRole, isValidRank, generatePdfBuffer } from "./_pdf.mjs";
import { generateShareCardBuffer } from "./_sharecard.mjs";

export const config = { background: true };

export default async (req) => {
  try {
    const data = await req.json();

    const primaryRole = data.primaryRole;
    const secondaryRole = data.secondaryRole;
    const rank = Array.isArray(data.ranking) ? data.ranking.join(",") : "";

    if (
      !isValidRole(primaryRole) ||
      !isValidRole(secondaryRole) ||
      primaryRole === secondaryRole ||
      !isValidRank(rank)
    ) {
      console.error("notify-lead-pdf: invalid role/rank data", primaryRole, secondaryRole, rank);
      return;
    }

    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    if (!botToken || !chatId) {
      console.error("notify-lead-pdf: missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID environment variable");
      return;
    }

    const origin = process.env.URL || new URL(req.url).origin;

    const caption = [
      `Новий лід EIDOS`,
      `Email: ${data.email || "—"}`,
      data.telegram ? `Telegram: ${data.telegram}` : null,
      `Результат: ${primaryRole} + ${secondaryRole}`,
      data.resultUrl ? `Сторінка: ${data.resultUrl}` : null,
    ]
      .filter(Boolean)
      .join("\n");

    // PDF and share-card generation are independent - if one fails (e.g. a
    // PDFShift hiccup), the other should still reach Telegram rather than
    // the whole notification silently disappearing.
    const [pdfResult, cardResult] = await Promise.allSettled([
      generatePdfBuffer({ primaryRole, secondaryRole, rank, origin }),
      generateShareCardBuffer({ primaryRole, secondaryRole, rank, origin }),
    ]);

    if (pdfResult.status === "fulfilled") {
      const form = new FormData();
      form.append("chat_id", chatId);
      form.append("caption", caption);
      form.append(
        "document",
        new Blob([pdfResult.value], { type: "application/pdf" }),
        `eidos-${primaryRole}-${secondaryRole}.pdf`
      );
      const tgRes = await fetch(`https://api.telegram.org/bot${botToken}/sendDocument`, {
        method: "POST",
        body: form,
      });
      if (!tgRes.ok) {
        const errText = await tgRes.text().catch(() => "");
        console.error("notify-lead-pdf: Telegram sendDocument failed", tgRes.status, errText.slice(0, 300));
      }
    } else {
      console.error("notify-lead-pdf: PDF generation failed", pdfResult.reason);
    }

    if (cardResult.status === "fulfilled") {
      const form = new FormData();
      form.append("chat_id", chatId);
      form.append(
        "photo",
        new Blob([cardResult.value], { type: "image/png" }),
        `eidos-${primaryRole}-${secondaryRole}-card.png`
      );
      const tgRes = await fetch(`https://api.telegram.org/bot${botToken}/sendPhoto`, {
        method: "POST",
        body: form,
      });
      if (!tgRes.ok) {
        const errText = await tgRes.text().catch(() => "");
        console.error("notify-lead-pdf: Telegram sendPhoto failed", tgRes.status, errText.slice(0, 300));
      }
    } else {
      console.error("notify-lead-pdf: share-card generation failed", cardResult.reason);
    }
  } catch (err) {
    console.error("notify-lead-pdf-background failed:", err);
  }
};
