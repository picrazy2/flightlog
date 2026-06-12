import type { CabinClass, Flight } from "./types";
import { programLabel } from "./loyalty";

export const CABIN_LABELS: Record<CabinClass, string> = {
  economy: "Economy",
  premium_economy: "Premium economy",
  lie_flat_business: "Business",
  recliner_first: "First (recliner)",
  international_first: "First",
};

export const cabinLabel = (c: CabinClass | null): string | null => (c ? CABIN_LABELS[c] : null);

// Compact cost label from a cash + points pair.
function fmtCost(cash: number | null, currency: string | null, points: number | null, program: string | null): { cash: string | null; points: string | null } {
  const cashStr =
    cash != null
      ? `${currency === "USD" || !currency ? "$" : ""}${Math.round(cash).toLocaleString()}${currency && currency !== "USD" ? ` ${currency}` : ""}`
      : null;
  const prog = program ? programLabel(program) : null;
  const pointsStr = points && points > 0 ? `${Math.round(points).toLocaleString()}${prog ? ` ${prog}` : " pts"}` : null;
  return { cash: cashStr, points: pointsStr };
}

// This flight's distance-weighted share of the booking.
export const segmentCost = (f: Flight) => fmtCost(f.cost_cash_segment, f.cost_currency, f.cost_points_segment, f.points_program);
// The whole booking's cost (all legs).
export const bookingCost = (f: Flight) => fmtCost(f.cost_cash, f.cost_currency, f.cost_points, f.points_program);

// True when the segment cost is only a share of a larger multi-leg booking, so the
// per-flight figure is an estimate.
export const isMultiLeg = (f: Flight): boolean =>
  (f.cost_cash != null && f.cost_cash_segment != null && Math.round(f.cost_cash) !== Math.round(f.cost_cash_segment)) ||
  (f.cost_points != null && f.cost_points_segment != null && f.cost_points !== f.cost_points_segment);

// Gmail deep-link to a stored booking email (message_id is the Gmail message id).
export const gmailLink = (messageId: string) => `https://mail.google.com/mail/u/0/#all/${messageId}`;
