// Currency → USD conversion for booking spend.
//
// Preferred source is the @fawazahmed0 currency-api CDN, queried at the flight/booking
// date so a 2019 ticket is valued at 2019 rates. STATIC_USD is the fallback for dates the
// API doesn't cover (it only goes back a couple of years) and for offline failures.
//
// Keep STATIC_USD in sync with src/lib/fx.ts — the client applies the same table when a
// booking has no stored *_usd value. A currency missing from BOTH tables converts at 1:1,
// which silently inflates totals by orders of magnitude for minor units (a 41,017 HUF
// ticket read as $41,017 rather than $132), so prefer adding a rate over leaving a gap.
export const STATIC_USD: Record<string, number> = {
  USD: 1, CNY: 0.148682, EUR: 1.16814, GBP: 1.36066, HKD: 0.127517, JPY: 0.00631488,
  CAD: 0.724501, SGD: 0.786452, AUD: 0.710827, KRW: 0.000717563, TWD: 0.0314102, ZAR: 0.062109,
  MXN: 0.0590054, THB: 0.0304563, MYR: 0.247355, CHF: 1.25205, NZD: 0.59442, AED: 0.272294,
  EGP: 0.0197427, MNT: 0.000277977, VND: 0.0000382811, TRY: 0.0208531, CZK: 0.0483309, MAD: 0.108054,
  PEN: 0.29844, IDR: 0.0000561737, PHP: 0.0162288, INR: 0.0104579, HUF: 0.00320995, PLN: 0.270474,
  DKK: 0.156256, SEK: 0.105962, NOK: 0.107204, ISK: 0.00821414, RON: 0.222656, BGN: 0.59726,
  RSD: 0.00995451, UAH: 0.02239, ILS: 0.335751, SAR: 0.266667, QAR: 0.274725, KWD: 3.24418,
  BHD: 2.65957, OMR: 2.59812, JOD: 1.41044, LKR: 0.00303912, NPR: 0.00653313, PKR: 0.00361733,
  BDT: 0.00821847, KHR: 0.0002483, LAK: 0.0000446046, MMK: 0.000476314, BND: 0.786452, BRL: 0.193107,
  ARS: 0.000667967, CLP: 0.00108509, COP: 0.00032757, UYU: 0.0249935, CRC: 0.00222118, GTQ: 0.13138,
  DOP: 0.0171225, JMD: 0.00636565, TTD: 0.147934, KES: 0.00772546, TZS: 0.000377822, UGX: 0.000269141,
  NGN: 0.000742556, GHS: 0.0903726, MUR: 0.0212902, ETB: 0.00615325, TND: 0.345057, XOF: 0.00178082,
  XAF: 0.00178082, NAD: 0.062109, BWP: 0.074345, GEL: 0.383817, AZN: 0.588249, AMD: 0.00275486,
  KZT: 0.00216792, UZS: 0.0000851402, ALL: 0.0126033, MKD: 0.0189404, BAM: 0.59726, MOP: 0.123803,
  MVR: 0.0646885, FJD: 0.454471, XPF: 0.009789,
};

// Same-process memo: a multi-leg booking asks for the same (currency, date) once per leg.
const cache = new Map<string, number>();

/**
 * {currency} → USD at `date` (YYYY-MM-DD). Future dates fall back to the latest published
 * rates — an upcoming flight has no historical rate, and asking for one 404s.
 */
export async function rateToUsd(currency: string, date: string | null | undefined): Promise<number> {
  const cur = (currency || "USD").toUpperCase();
  if (cur === "USD") return 1;

  const today = new Date().toISOString().slice(0, 10);
  const asOf = date && date >= "2000-01-01" && date < today ? date : "latest";
  const key = `${cur}@${asOf}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;

  let rate: number | null = null;
  try {
    const r = await fetch(
      `https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@${asOf}/v1/currencies/${cur.toLowerCase()}.min.json`,
    );
    if (r.ok) {
      const d = await r.json();
      const v = d?.[cur.toLowerCase()]?.usd;
      if (typeof v === "number" && v > 0) rate = v;
    }
  } catch { /* offline / CDN hiccup — fall through to the static table */ }

  const resolved = rate ?? STATIC_USD[cur] ?? 1;
  cache.set(key, resolved);
  return resolved;
}

/** True when we have a real rate for this currency (as opposed to the 1:1 last resort). */
export const hasStaticRate = (currency: string): boolean =>
  (currency || "USD").toUpperCase() in STATIC_USD;
