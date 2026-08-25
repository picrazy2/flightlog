// Cloudflare Email Worker for journia@akguo.com. Parses the incoming email (body +
// image/PDF attachments), pushes it to the Supabase ingest-email endpoint (Gemini
// extracts the flights), then replies to the sender with what was filed.
// Set up via Cloudflare → Email → Routing → "Send to a Worker".
//
// The envelope sender is what decides whose log the flights land in, so one shared
// address works for everyone: ingest-email matches message.from against users.email.
import PostalMime from "postal-mime";
import { EmailMessage } from "cloudflare:email";
import { createMimeMessage } from "mimetext";

function bytesToB64(bytes) {
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  return btoa(bin);
}
// Always return base64, whether postal-mime gave us bytes or a decoded string.
function toB64(content) {
  if (typeof content === "string") return bytesToB64(new TextEncoder().encode(content));
  return bytesToB64(new Uint8Array(content));
}
// Gemini reads itinerary PDFs and screenshots; anything else is noise (logos, vcards).
const isSupported = (a) => {
  const m = (a.mimeType || "").toLowerCase();
  return m === "application/pdf" || /^image\/(png|jpe?g|webp|heic|heif)$/.test(m);
};

// Ryanair and friends put the entire HTML document in the text/plain part, so
// parsed.text is not necessarily text. Strip markup from whichever candidate carries
// it and keep the longer real-text result; otherwise the 20k slice keeps 20k of CSS
// and cuts off the fare total, which sits near the end of an itinerary.
const looksLikeMarkup = (s) => /<\s*(?:!doctype\s+html|html\b|body\b|table\b)/i.test((s || "").slice(0, 2000));

const stripTags = (s) =>
  (s || "")
    .replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<\/(p|div|tr|td|li|h[1-6]|table)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/[ \t\u00a0]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();

// Matches the 20k the Gmail scan feeds Gemini, so both paths see the same budget.
function bodyText(parsed) {
  const text = looksLikeMarkup(parsed.text) ? stripTags(parsed.text) : (parsed.text || "");
  const html = stripTags(parsed.html);
  return (html.length > text.length ? html : text).slice(0, 20000);
}

export default {
  async email(message, env) {
    const parsed = await new PostalMime().parse(message.raw);

    const attachments = (parsed.attachments || [])
      .filter(isSupported)
      // PDFs first: an itinerary PDF beats a screenshot when a message carries both.
      .sort((a, b) => Number(b.mimeType === "application/pdf") - Number(a.mimeType === "application/pdf"))
      .slice(0, 4)
      .map((a) => ({
        mimeType: a.mimeType,
        filename: a.filename || "",
        dataB64: toB64(a.content),
      }));

    const subject = parsed.subject || message.headers.get("subject") || "";
    const payload = {
      message_id: message.headers.get("message-id") || `cf-${message.from}-${subject}`,
      from: message.from,
      subject,
      date: parsed.date || new Date().toISOString(),
      body: bodyText(parsed),
      attachments,
    };

    let reply = "";
    try {
      const res = await fetch(env.INGEST_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.INGEST_SECRET}` },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      reply = data?.reply || (data?.ok === false ? `⚠️ ${data.error || "Import failed"}` : "");
      console.log("ingest status", res.status, "user", data?.user_id, "outcome", data?.outcome);
    } catch (err) {
      console.error("ingest fetch failed:", err?.stack || String(err));
      reply = "";
    }

    if (reply) {
      try {
        const msg = createMimeMessage();
        msg.setSender({ name: "Journia", addr: message.to });
        msg.setRecipient(message.from);
        msg.setSubject(subject.startsWith("Re:") ? subject : `Re: ${subject || "Journia import"}`);
        // Cloudflare validates the reply's References against the original: it must be
        // the incoming chain PLUS that message's own Message-ID. Sending only the
        // Message-ID is rejected outright ("provided References header is invalid"),
        // which silently killed every reply to a threaded forward — the common case,
        // since people forward from an existing conversation.
        const mid = message.headers.get("Message-ID");
        const refs = message.headers.get("References");
        if (mid) {
          msg.setHeader("In-Reply-To", mid);
          msg.setHeader("References", refs ? `${refs} ${mid}` : mid);
        }
        msg.addMessage({ contentType: "text/plain", data: reply });
        await message.reply(new EmailMessage(message.to, message.from, msg.asRaw()));
        console.log("reply sent to", message.from);
      } catch (err) {
        // Best-effort: the import already happened. Cloudflare only allows replying to
        // DMARC-passing mail, which forwards often are not.
        console.error("reply failed:", err?.stack || String(err));
      }
    }
  },
};
