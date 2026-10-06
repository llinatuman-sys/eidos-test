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

    const ROLE_NAMES = {
      architect: "Архітектор", craft: "Ремісник", friend: "Друг", guide: "Провідник",
      method: "Методолог", provoker: "Провокатор", scout: "Розвідник",
    };
    const leadNumber = Number(data.leadNumber);
    const leadText = [
      Number.isFinite(leadNumber) && leadNumber > 0 ? `Лід №${leadNumber} · EIDOS` : `Новий лід EIDOS`,
      `Email: ${data.email || "—"}`,
      data.telegram ? `Telegram: ${data.telegram}` : null,
      `Результат: ${ROLE_NAMES[primaryRole]} + ${ROLE_NAMES[secondaryRole]}`,
      data.resultUrl ? `Сторінка: ${data.resultUrl}` : null,
    ]
      .filter(Boolean)
      .join("\n");

    // Telegram call; returns the sent message's id (needed to attach the PDF as a reply)
    const tg = async (method, body) => {
      const res = await fetch(`https://api.telegram.org/bot${botToken}/${method}`, { method: "POST", body });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) {
        throw new Error(`Telegram ${method} ${res.status}: ${JSON.stringify(json).slice(0, 300)}`);
      }
      return json.result && json.result.message_id;
    };
    const baseForm = (replyTo) => {
      const form = new FormData();
      form.append("chat_id", chatId);
      if (replyTo) form.append("reply_parameters", JSON.stringify({ message_id: replyTo, allow_sending_without_reply: true }));
      return form;
    };
    const sendText = (text, replyTo) => {
      const form = baseForm(replyTo);
      form.append("text", text);
      form.append("link_preview_options", JSON.stringify({ is_disabled: true }));
      return tg("sendMessage", form);
    };
    const reason = (e) => String((e && e.message) || e).slice(0, 400);

    // PDFShift is called one conversion at a time (a second simultaneous
    // conversion may be rejected - that's how the PDF once went missing),
    // and a failed attempt is retried once after a short pause.
    const withRetry = async (fn) => {
      try {
        return await fn();
      } catch (first) {
        console.error("notify-lead-pdf: first attempt failed, retrying", first);
        await new Promise((r) => setTimeout(r, 4000));
        return fn();
      }
    };

    // Both files are generated first (one at a time), then sent together as
    // ONE message: a Telegram album of two files - the picture and the PDF -
    // with the lead data as the caption at the bottom of the album.
    const cardName = `eidos-${primaryRole}-${secondaryRole}-card.png`;
    const pdfName = `eidos-${primaryRole}-${secondaryRole}.pdf`;
    let card = null, pdf = null;
    const problems = [];
    try {
      card = await withRetry(() => generateShareCardBuffer({ primaryRole, secondaryRole, rank, origin }));
    } catch (e) {
      console.error("notify-lead-pdf: share card failed", e);
      problems.push(`⚠️ Картинка не згенерувалась: ${reason(e)}`);
    }
    try {
      pdf = await withRetry(() => generatePdfBuffer({ primaryRole, secondaryRole, rank, origin }));
    } catch (e) {
      console.error("notify-lead-pdf: PDF failed", e);
      problems.push(`⚠️ PDF не згенерувався: ${reason(e)}`);
    }
    const caption = [leadText, ...problems].join("\n\n").slice(0, 1024);

    try {
      if (card && pdf) {
        const form = baseForm();
        form.append("media", JSON.stringify([
          { type: "document", media: "attach://card" },
          { type: "document", media: "attach://pdf", caption },
        ]));
        form.append("card", new Blob([card], { type: "image/png" }), cardName);
        form.append("pdf", new Blob([pdf], { type: "application/pdf" }), pdfName);
        await tg("sendMediaGroup", form);
      } else if (card || pdf) {
        // only one file came out - send it alone, with the data and the reason
        const form = baseForm();
        form.append("caption", caption);
        form.append("document", card ? new Blob([card], { type: "image/png" }) : new Blob([pdf], { type: "application/pdf" }), card ? cardName : pdfName);
        await tg("sendDocument", form);
      } else {
        await sendText(caption);
      }
    } catch (e) {
      // if Telegram rejected the album for any reason, the data still has to arrive
      console.error("notify-lead-pdf: sending failed", e);
      await sendText(`${caption}\n\n⚠️ Не вдалося надіслати файли: ${reason(e)}`)
        .catch((err) => console.error("notify-lead-pdf:", err));
    }
  } catch (err) {
    console.error("notify-lead-pdf-background failed:", err);
  }
};
