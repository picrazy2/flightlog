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
      // Matches the 20k the Gmail scan feeds Gemini, so both paths see the same budget.
      body: (parsed.text || (parsed.html || "").replace(/<[^>]+>/g, " ")).slice(0, 20000),
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
        const mid = message.headers.get("Message-ID");
        if (mid) { msg.setHeader("In-Reply-To", mid); msg.setHeader("References", mid); }
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
