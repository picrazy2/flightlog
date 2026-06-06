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

const MAX_PDFS_PER_MESSAGE = 3;
const MAX_PDF_BYTES = 8 * 1024 * 1024; // 8MB Gemini inline limit headroom

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
  // Booking confirmations / itineraries / e-tickets (English)
  'subject:(confirmation OR itinerary OR "e-ticket" OR booking) (flight OR airline)',
  // Boarding passes & check-in confirmations — flights actually flown
  'subject:("boarding pass" OR "checked in" OR "checked-in" OR "e-boarding")',
  // Google Flights itineraries (and self-forwards of them)
  'subject:"Google Flights"',
  // Airline schedule / itinerary change notifications
  'subject:("schedule change" OR "itinerary has changed" OR "flight has changed" OR "change to your booking" OR "confirmation of changes" OR rescheduled OR "time change")',
  // Booking confirmations (Chinese) — 机票 air ticket, 航班 flight, 行程 itinerary,
  // 值机 check-in, 登机牌 boarding pass
  "subject:(机票 OR 航班 OR 行程 OR 值机 OR 登机牌)",
  // Booking confirmations (French)
  "subject:(billet OR réservation OR vol OR avion)",
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

async function listMessageIdsBySearch(
  accessToken: string,
  q: string,
  maxResults = MAX_IDS_PER_QUERY,
): Promise<string[]> {
  const ids: string[] = [];
  let pageToken: string | undefined;

  while (ids.length < maxResults) {
    const params = new URLSearchParams({
      q,
      maxResults: String(Math.min(500, maxResults - ids.length)),
    });
    if (pageToken) params.set("pageToken", pageToken);

    const res = await gmailFetch(accessToken, `messages?${params}`);
    const data = await res.json() as {
      messages?: Array<{ id: string }>;
      nextPageToken?: string;
    };
    ids.push(...(data.messages ?? []).map((m) => m.id));
    pageToken = data.nextPageToken;
    if (!pageToken) break;
  }

  return ids;
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

function extractBody(payload: GmailPart | undefined): string {
  if (!payload) return "";

  const plainPart = findPartByMimeType(payload, "text/plain");
  if (plainPart?.body?.data) {
    return decodeBase64Url(plainPart.body.data).slice(0, 15000);
  }

  const htmlPart = findPartByMimeType(payload, "text/html");
  if (htmlPart?.body?.data) {
    return decodeBase64Url(htmlPart.body.data).slice(0, 15000);
  }

  if (payload.body?.data) {
    return decodeBase64Url(payload.body.data).slice(0, 15000);
  }

  return "";
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
