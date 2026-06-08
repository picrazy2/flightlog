import { HttpError } from "../flights/http.ts";

const GMAIL_BASE = "https://gmail.googleapis.com/gmail/v1/users/me";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

export type PdfAttachment = {
  filename: string;
  // base64 (standard, not url-safe) — ready for Gemini inline_data
  data: string;
};

export type GmailMessage = {
  id: string;
  subject: string;
  from: string;
  date: string;
  body: string;
  attachments?: PdfAttachment[];
};

const MAX_PDFS_PER_MESSAGE = 1; // itinerary PDF; e-receipt is redundant & doubles memory
const MAX_PDF_BYTES = 5 * 1024 * 1024;

export type GmailScanResult = {
  messages: GmailMessage[];
  historyId: string;
};

export async function refreshGmailAccessToken(
  clientId: string,
  clientSecret: string,
  refreshToken: string,
): Promise<string> {
  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new HttpError(500, `Gmail token refresh failed: ${text}`);
  }

  const data = await res.json() as { access_token: string };
  return data.access_token;
}

// Sends a plain-text email as the authenticated user (requires gmail.send scope).
export async function sendEmail(
  accessToken: string,
  to: string,
  subject: string,
  body: string,
): Promise<void> {
  const mime = [
    `To: ${to}`,
    `Subject: =?UTF-8?B?${b64(subject)}?=`,
    "Content-Type: text/plain; charset=UTF-8",
    "MIME-Version: 1.0",
    "",
    body,
  ].join("\r\n");

  const res = await fetch(`${GMAIL_BASE}/messages/send`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ raw: b64url(mime) }),
  });

  if (!res.ok) {
    throw new HttpError(500, `Gmail send failed: ${await res.text()}`);
  }
}

function b64(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (const byte of bytes) bin += String.fromCharCode(byte);
  return btoa(bin);
}

function b64url(s: string): string {
  return b64(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// Each clause is an independent Gmail search; results are unioned. Keeping them
// separate is clearer (and avoids fragile precedence) than one mega-query.
export const FLIGHT_SEARCH_QUERIES = [
  // English: bookings / itineraries / tickets ("Ticket Details", e-ticket, etc.)
  'subject:(confirmation OR itinerary OR "e-ticket" OR ticket OR booking OR reservation) (flight OR airline)',
  // English: boarding passes & check-ins — flights actually flown
  'subject:("boarding pass" OR "checked in" OR "checked-in" OR "e-boarding")',
  // Google Flights itineraries (and self-forwards of them)
  'subject:"Google Flights"',
  // Online travel agencies / points portals (Chase Travel "Travel Reservation
  // Center Trip ID #…", Expedia/Kiwi itineraries) — full flight detail, generic subject
  'subject:("travel reservation center" OR "trip id" OR "trip confirmation" OR "your trip to") (flight OR airline OR airport)',
  // Award/points redemptions whose body carries the itinerary (e.g. LifeMiles
  // "You've redeemed lifemiles!"), but whose subject lacks a flight keyword
  'subject:(redeemed OR redemption OR "miles") (itinerary OR flight OR airline OR reservation)',
  // English: changes, cancellations & refunds (these supersede existing bookings)
  'subject:(refund OR cancelled OR canceled OR cancellation OR "schedule change" OR "flight change" OR "itinerary has changed" OR "flight has changed" OR rescheduled OR "time change" OR "change to your booking" OR "confirmation of changes")',
  // Chinese — ticket/flight/itinerary/checkin/boarding/booking/confirm/refund/change/cancel
  "subject:(机票 OR 航班 OR 行程 OR 值机 OR 登机牌 OR 预订 OR 确认 OR 退票 OR 退款 OR 变更 OR 取消)",
  // Japanese — ticket/booking/boarding/flight/e-ticket/cancellation/change/refund
  "subject:(航空券 OR 予約 OR 搭乗 OR フライト OR eチケット OR 欠航 OR 変更 OR 払い戻し)",
  // Korean — ticket/booking/boarding/flight/cancel/change/refund/itinerary
  "subject:(항공권 OR 예약 OR 탑승 OR 항공편 OR 취소 OR 변경 OR 환불 OR 일정)",
  // Italian — flight/booking/ticket/itinerary/cancellation/refund
  "subject:(volo OR prenotazione OR biglietto OR itinerario OR annullamento OR rimborso OR cancellazione)",
  // Spanish / Catalan — flight/booking/ticket/itinerary/trip/invoice/cancellation/refund
  "subject:(vuelo OR vol OR reserva OR billete OR bitllet OR factura OR itinerari OR viatge OR cancelación OR reembolso)",
  // French — booking/ticket/itinerary/cancellation/refund/plane
  "subject:(réservation OR billet OR itinéraire OR annulation OR remboursement OR avion)",
  // Turkish — flight/booking/ticket/cancel/refund/boarding
  "subject:(uçuş OR rezervasyon OR bilet OR iptal OR iade OR biniş)",
  // Portuguese — flight/boarding/ticket/cancellation/refund
  "subject:(voo OR embarque OR bilhete OR cancelamento OR reembolso)",
  // Travel-agent / GDS itineraries whose subject carries no flight keyword
  // (Amadeus agent forwards like "GUO/ALEXANDER MR 13MAR BOS PEK", or airline
  // "Important information for travellers" sent via Amadeus). Low volume.
  "from:amadeus.com",
  // Ctrip / Trip.com / Tongcheng (ly.com) bookings — Chinese OTAs that mail an
  // (often PDF) e-ticket itinerary. Chinese subjects are also covered above.
  "from:(trip.com OR ctrip.com OR ly.com) (confirm OR itinerary OR booking OR ticket OR 机票 OR 行程 OR 出票)",
  // Airline-app / Chinese e-ticket subjects ("出票成功确认", "电子客票行程单")
  "subject:(出票成功 OR 电子客票 OR 行程单 OR 行程确认)",
  // Flight receipts whose subject says "receipt" (e.g. Delta "Your Flight Receipt")
  'subject:("flight receipt" OR "e-receipt" OR "your receipt") (flight OR airline OR air)',
  // Expedia / OTA travel confirmations (subject lacks a flight keyword)
  "from:(expedia.com OR expediamail.com) subject:(confirmation OR itinerary OR trip)",
  // LOT and other carriers fronted by Amadeus/LOT.com booking desks
  "from:(lot.com OR amadeus.net)",
  // Forwarded e-tickets from family (parents forward bookings made for the trip)
  'subject:("Fwd:" OR "Fw:") (e-ticket OR eticket OR itinerary OR "flight booking" OR confirmation OR 行程 OR 机票)',
];

const DEFAULT_LOOKBACK_DAYS = 7;
const MAX_IDS_PER_QUERY = 1500;
// Drop Gmail-categorized marketing. Spam/Trash are already excluded by default.
const EXCLUSIONS = "-category:promotions";

export type ScanOptions = {
  // Days back to search. null = whole inbox (used for backfill).
  lookbackDays?: number | null;
  // Explicit window (YYYY/MM/DD). When set, overrides lookbackDays — used to
  // backfill in fixed chunks (e.g. 90 days at a time) so runs don't time out.
  after?: string;
  before?: string;
  queries?: string[];
};

// Runs each flight-search clause (so Gemini is never called on arbitrary mail),
// unions and de-duplicates the message ids, and fetches the bodies.
// Deduplication of already-processed messages is handled by the caller.
// `lookbackDays` keeps steady-state runs cheap; pass null for a full backfill.
export async function scanNewMessages(
  accessToken: string,
  _lastHistoryId: string | null,
  options: ScanOptions = {},
): Promise<GmailScanResult> {
  const queries = options.queries ?? FLIGHT_SEARCH_QUERIES;
  const lookbackDays = options.lookbackDays === undefined
    ? DEFAULT_LOOKBACK_DAYS
    : options.lookbackDays;

  // Explicit window takes priority; otherwise derive `after` from lookbackDays.
  const windowParts: string[] = [];
  if (options.after || options.before) {
    if (options.after) windowParts.push(`after:${options.after}`);
    if (options.before) windowParts.push(`before:${options.before}`);
  } else if (lookbackDays !== null) {
    windowParts.push(`after:${afterDate(lookbackDays)}`);
  }

  const historyId = await getCurrentHistoryId(accessToken);

  const seen = new Set<string>();
  for (const clause of queries) {
    const q = [clause, ...windowParts, EXCLUSIONS].join(" ");
    for (const id of await listMessageIdsBySearch(accessToken, q)) {
      seen.add(id);
    }
  }

  const messages = await fetchMessages(accessToken, [...seen]);
  return { messages, historyId };
}

function afterDate(days: number): string {
  const since = new Date();
  since.setDate(since.getDate() - days);
  return [
    since.getFullYear(),
    String(since.getMonth() + 1).padStart(2, "0"),
    String(since.getDate()).padStart(2, "0"),
  ].join("/");
}

async function getCurrentHistoryId(accessToken: string): Promise<string> {
  const res = await gmailFetch(accessToken, "profile");
  const data = await res.json() as { historyId: string };
  return data.historyId;
}

const EMPTY_PAGE_RETRIES = 2;

async function listMessageIdsBySearch(
  accessToken: string,
  q: string,
  maxResults = MAX_IDS_PER_QUERY,
): Promise<string[]> {
  const ids: string[] = [];
  let pageToken: string | undefined;
  let firstPage = true;

  while (ids.length < maxResults) {
    const params = new URLSearchParams({
      q,
      maxResults: String(Math.min(500, maxResults - ids.length)),
    });
    if (pageToken) params.set("pageToken", pageToken);

    // Gmail's messages.list intermittently returns an empty result under load
    // (it's a 200, not an error), which silently drops a whole window. Retry an
    // empty first page a couple times with backoff before trusting the 0.
    let data: { messages?: Array<{ id: string }>; nextPageToken?: string } = {};
    for (let attempt = 0; ; attempt++) {
      const res = await gmailFetchWithRetry(accessToken, `messages?${params}`);
      data = await res.json();
      const count = (data.messages ?? []).length;
      if (
        firstPage && count === 0 && !data.nextPageToken &&
        attempt < EMPTY_PAGE_RETRIES
      ) {
        await sleep(700 * (attempt + 1));
        continue;
      }
      break;
    }

    ids.push(...(data.messages ?? []).map((m) => m.id));
    firstPage = false;
    pageToken = data.nextPageToken;
    if (!pageToken) break;
  }

  return ids;
}

// Retries transient Gmail API failures (429/5xx) with backoff. Free — Gmail API
// calls are quota-limited, not billed, and never invoke Gemini.
async function gmailFetchWithRetry(
  accessToken: string,
  path: string,
  retries = 3,
): Promise<Response> {
  let lastError: unknown;
  for (let i = 0; i < retries; i++) {
    try {
      return await gmailFetch(accessToken, path);
    } catch (error) {
      lastError = error;
      await sleep(500 * (i + 1));
    }
  }
  throw lastError;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchMessages(
  accessToken: string,
  messageIds: string[],
): Promise<GmailMessage[]> {
  const messages: GmailMessage[] = [];

  for (const id of messageIds) {
    try {
      messages.push(await fetchMessage(accessToken, id));
    } catch {
      // Skip messages that fail to fetch individually
    }
  }

  return messages;
}

async function fetchMessage(
  accessToken: string,
  messageId: string,
): Promise<GmailMessage> {
  const params = new URLSearchParams({ format: "full" });
  const res = await gmailFetch(accessToken, `messages/${messageId}?${params}`);
  const raw = await res.json() as GmailMessageRaw;

  return {
    id: raw.id,
    subject: extractHeader(raw.payload?.headers ?? [], "Subject") ?? "",
    from: extractHeader(raw.payload?.headers ?? [], "From") ?? "",
    date: extractHeader(raw.payload?.headers ?? [], "Date") ?? "",
    body: extractBody(raw.payload),
    attachments: await fetchPdfAttachments(accessToken, messageId, raw.payload),
  };
}

// Itinerary emails (e.g. Trip.com) often put the real flight detail in a PDF.
// We pull up to a few PDFs so Gemini can read them directly.
async function fetchPdfAttachments(
  accessToken: string,
  messageId: string,
  payload: GmailPart | undefined,
): Promise<PdfAttachment[]> {
  if (!payload) return [];

  const pdfParts: GmailPart[] = [];
  const walk = (part: GmailPart) => {
    const isPdf = part.mimeType === "application/pdf" ||
      (part.filename ?? "").toLowerCase().endsWith(".pdf");
    if (isPdf && part.body?.attachmentId) pdfParts.push(part);
    for (const sub of part.parts ?? []) walk(sub);
  };
  walk(payload);

  const out: PdfAttachment[] = [];
  for (const part of pdfParts.slice(0, MAX_PDFS_PER_MESSAGE)) {
    if ((part.body?.size ?? 0) > MAX_PDF_BYTES) continue;
    try {
      const res = await gmailFetch(
        accessToken,
        `messages/${messageId}/attachments/${part.body!.attachmentId}`,
      );
      const data = await res.json() as { data?: string };
      if (data.data) {
        out.push({
          filename: part.filename || "attachment.pdf",
          data: data.data.replace(/-/g, "+").replace(/_/g, "/"),
        });
      }
    } catch {
      // Skip attachments that fail to fetch
    }
  }
  return out;
}

async function gmailFetch(
  accessToken: string,
  path: string,
): Promise<Response> {
  const res = await fetch(`${GMAIL_BASE}/${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok && res.status !== 404) {
    const text = await res.text();
    throw new HttpError(500, `Gmail API error ${res.status}: ${text}`);
  }

  return res;
}

type GmailPart = {
  mimeType: string;
  filename?: string;
  body?: { data?: string; attachmentId?: string; size?: number };
  parts?: GmailPart[];
};

type GmailMessageRaw = {
  id: string;
  payload?: GmailPart & {
    headers?: Array<{ name: string; value: string }>;
  };
};

function extractHeader(
  headers: Array<{ name: string; value: string }>,
  name: string,
): string | null {
  return (
    headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ??
    null
  );
}

const MAX_BODY_CHARS = 20000;

function extractBody(payload: GmailPart | undefined): string {
  if (!payload) return "";

  // Use whichever of text/plain or (HTML→text) has MORE content. Some senders
  // (e.g. Virgin/Adobe Campaign e-tickets) put only a legal footer in
  // text/plain and the real itinerary in the HTML — blindly preferring plain
  // text there feeds Gemini the footer and it sees no flight. Converting HTML
  // to text also keeps CSS/markup from eating the char budget.
  const plainPart = findPartByMimeType(payload, "text/plain");
  const htmlPart = findPartByMimeType(payload, "text/html");
  const plain = plainPart?.body?.data
    ? decodeBase64Url(plainPart.body.data)
    : "";
  const html = htmlPart?.body?.data
    ? htmlToText(decodeBase64Url(htmlPart.body.data))
    : "";
  const best = html.length > plain.length ? html : plain;
  if (best) return best.slice(0, MAX_BODY_CHARS);

  if (payload.body?.data) {
    const raw = decodeBase64Url(payload.body.data);
    const text = payload.mimeType === "text/html" ? htmlToText(raw) : raw;
    return text.slice(0, MAX_BODY_CHARS);
  }

  return "";
}

// Strip HTML to readable text: drop style/script/head/comments, turn block-level
// tags into newlines, remove remaining tags, decode common entities, collapse
// whitespace. Keeps the actual content (flight legs, times) within budget.
function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<head[\s\S]*?<\/head>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<\/(p|div|tr|td|li|h[1-6]|table)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;|&hairsp;|&#8199;|&#847;|&zwnj;|&#8204;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&[a-z0-9#]+;/gi, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function findPartByMimeType(
  part: GmailPart,
  mimeType: string,
): GmailPart | null {
  if (part.mimeType === mimeType) return part;

  for (const sub of part.parts ?? []) {
    const found = findPartByMimeType(sub, mimeType);
    if (found) return found;
  }

  return null;
}

function decodeBase64Url(encoded: string): string {
  const base64 = encoded.replace(/-/g, "+").replace(/_/g, "/");
  try {
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return "";
  }
}
