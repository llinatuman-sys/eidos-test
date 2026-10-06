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

    const leadText = [
      `Новий лід EIDOS`,
      `Email: ${data.email || "—"}`,
      data.telegram ? `Telegram: ${data.telegram}` : null,
      `Результат: ${primaryRole} + ${secondaryRole}`,
      data.resultUrl ? `Сторінка: ${data.resultUrl}` : null,
    ]
      .filter(Boolean)
      .join("\n");

    const tg = (method, body) =>
      fetch(`https://api.telegram.org/bot${botToken}/${method}`, { method: "POST", body }).then(async (res) => {
        if (!res.ok) {
          const errText = await res.text().catch(() => "");
          throw new Error(`Telegram ${method} ${res.status}: ${errText.slice(0, 300)}`);
        }
      });
    const sendText = (text) => {
      const form = new FormData();
      form.append("chat_id", chatId);
      form.append("text", text);
      form.append("disable_web_page_preview", "true");
      return tg("sendMessage", form);
    };

    // 1. Lead data goes first, as plain text - it must arrive even if the
    //    PDF or the picture fails to generate.
    await sendText(leadText).catch((e) => console.error("notify-lead-pdf:", e));

    // 2. PDF, then the picture - one after the other, not in parallel:
    //    PDFShift may reject a second simultaneous conversion, which is how
    //    the PDF went missing while the picture still arrived. A failed
    //    attempt is retried once after a short pause.
    const withRetry = async (fn) => {
      try {
        return await fn();
      } catch (first) {
        console.error("notify-lead-pdf: first attempt failed, retrying", first);
        await new Promise((r) => setTimeout(r, 4000));
        return fn();
      }
    };

    try {
      const pdf = await withRetry(() => generatePdfBuffer({ primaryRole, secondaryRole, rank, origin }));
      const form = new FormData();
      form.append("chat_id", chatId);
      form.append("caption", `PDF: ${data.email || ""}`.trim());
      form.append("document", new Blob([pdf], { type: "application/pdf" }), `eidos-${primaryRole}-${secondaryRole}.pdf`);
      await tg("sendDocument", form);
    } catch (e) {
      console.error("notify-lead-pdf: PDF failed", e);
      // Say so in Telegram too, with the reason - otherwise a missing PDF
      // is invisible unless someone opens the Netlify function logs.
      await sendText(`⚠️ PDF для ${data.email || "ліда"} не згенерувався.\nПричина: ${String(e && e.message || e).slice(0, 500)}`)
        .catch((err) => console.error("notify-lead-pdf:", err));
    }

    try {
      const card = await withRetry(() => generateShareCardBuffer({ primaryRole, secondaryRole, rank, origin }));
      const form = new FormData();
      form.append("chat_id", chatId);
      form.append("photo", new Blob([card], { type: "image/png" }), `eidos-${primaryRole}-${secondaryRole}-card.png`);
      await tg("sendPhoto", form);
    } catch (e) {
      console.error("notify-lead-pdf: share card failed", e);
      await sendText(`⚠️ Картинка для ${data.email || "ліда"} не згенерувалась.\nПричина: ${String(e && e.message || e).slice(0, 500)}`)
        .catch((err) => console.error("notify-lead-pdf:", err));
    }
  } catch (err) {
    console.error("notify-lead-pdf-background failed:", err);
  }
};
