import { HttpError } from "../flights/http.ts";

const GMAIL_BASE = "https://gmail.googleapis.com/gmail/v1/users/me";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

export type GmailMessage = {
  id: string;
  subject: string;
  from: string;
  date: string;
  body: string;
};

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

const BOOKING_SEARCH_QUERY =
  'subject:(confirmation OR itinerary OR "e-ticket" OR booking) AND (flight OR airline)';

export async function scanNewMessages(
  accessToken: string,
  lastHistoryId: string | null,
): Promise<GmailScanResult> {
  if (lastHistoryId) {
    try {
      return await scanFromHistory(accessToken, lastHistoryId);
    } catch (error) {
      if (!(error instanceof HttpError) || error.status !== 404) {
        throw error;
      }
      // History expired — fall through to initial scan
    }
  }

  return await initialScan(accessToken);
}

async function initialScan(accessToken: string): Promise<GmailScanResult> {
  const historyId = await getCurrentHistoryId(accessToken);

  const since = new Date();
  since.setDate(since.getDate() - 90);
  const afterDate = [
    since.getFullYear(),
    String(since.getMonth() + 1).padStart(2, "0"),
    String(since.getDate()).padStart(2, "0"),
  ].join("/");

  const messageIds = await listMessageIdsBySearch(
    accessToken,
    `${BOOKING_SEARCH_QUERY} after:${afterDate}`,
  );
  const messages = await fetchMessages(accessToken, messageIds);
  return { messages, historyId };
}

async function scanFromHistory(
  accessToken: string,
  startHistoryId: string,
): Promise<GmailScanResult> {
  const { messageIds, historyId } = await listMessageIdsFromHistory(
    accessToken,
    startHistoryId,
  );
  const messages = await fetchMessages(accessToken, messageIds);
  return { messages, historyId };
}

async function getCurrentHistoryId(accessToken: string): Promise<string> {
  const res = await gmailFetch(accessToken, "profile");
  const data = await res.json() as { historyId: string };
  return data.historyId;
}

async function listMessageIdsBySearch(
  accessToken: string,
  q: string,
  maxResults = 100,
): Promise<string[]> {
  const params = new URLSearchParams({ q, maxResults: String(maxResults) });
  const res = await gmailFetch(accessToken, `messages?${params}`);
  const data = await res.json() as { messages?: Array<{ id: string }> };
  return (data.messages ?? []).map((m) => m.id);
}

async function listMessageIdsFromHistory(
  accessToken: string,
  startHistoryId: string,
): Promise<{ messageIds: string[]; historyId: string }> {
  const params = new URLSearchParams({
    startHistoryId,
    historyTypes: "messageAdded",
    maxResults: "100",
  });

  const res = await gmailFetch(accessToken, `history?${params}`);

  if (res.status === 404) {
    throw new HttpError(404, "Gmail history expired");
  }

  const data = await res.json() as {
    history?: Array<{
      messagesAdded?: Array<{ message: { id: string } }>;
    }>;
    historyId: string;
  };

  const seen = new Set<string>();
  const messageIds: string[] = [];

  for (const record of data.history ?? []) {
    for (const added of record.messagesAdded ?? []) {
      const id = added.message.id;
      if (!seen.has(id)) {
        seen.add(id);
        messageIds.push(id);
      }
    }
  }

  return { messageIds, historyId: data.historyId };
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
  };
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
  body?: { data?: string };
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
