// Static present-day FX → USD, used only as a fallback: bookings normally carry a
// cost_cash_usd converted server-side at the flight date. (RMB is normalized to CNY
// upstream.) Mirrors STATIC_USD in supabase/functions/_shared/flights/fx.ts — update both.
//
// A currency absent here converts 1:1, which is catastrophic for minor units: a
// 41,017 HUF fare read as $41,017 instead of $132 and moved lifetime spend by 27%.
// The table is deliberately long so that fallback stays unreachable in practice.
const RATES: Record<string, number> = {
  USD: 1, CNY: 0.148682, EUR: 1.16814, GBP: 1.36066, HKD: 0.127517, JPY: 0.00631488,
  CAD: 0.724501, SGD: 0.786452, AUD: 0.710827, KRW: 0.000717563, TWD: 0.0314102, ZAR: 0.062109,
  MXN: 0.0590054, THB: 0.0304563, MYR: 0.247355, CHF: 1.25205, NZD: 0.59442, AED: 0.272294,
  EGP: 0.0197427, MNT: 0.000277977, VND: 0.0000382811, TRY: 0.0208531, CZK: 0.0483309,
  MAD: 0.108054, PEN: 0.29844, IDR: 0.0000561737, PHP: 0.0162288, INR: 0.0104579,
  HUF: 0.00320995, PLN: 0.270474, DKK: 0.156256, SEK: 0.105962, NOK: 0.107204, ISK: 0.00821414,
  RON: 0.222656, BGN: 0.59726, RSD: 0.00995451, UAH: 0.02239, ILS: 0.335751, SAR: 0.266667,
  QAR: 0.274725, KWD: 3.24418, BHD: 2.65957, OMR: 2.59812, JOD: 1.41044, LKR: 0.00303912,
  NPR: 0.00653313, PKR: 0.00361733, BDT: 0.00821847, KHR: 0.0002483, LAK: 0.0000446046,
  MMK: 0.000476314, BND: 0.786452, BRL: 0.193107, ARS: 0.000667967, CLP: 0.00108509,
  COP: 0.00032757, UYU: 0.0249935, CRC: 0.00222118, GTQ: 0.13138, DOP: 0.0171225,
  JMD: 0.00636565, TTD: 0.147934, KES: 0.00772546, TZS: 0.000377822, UGX: 0.000269141,
  NGN: 0.000742556, GHS: 0.0903726, MUR: 0.0212902, ETB: 0.00615325, TND: 0.345057,
  XOF: 0.00178082, XAF: 0.00178082, NAD: 0.062109, BWP: 0.074345, GEL: 0.383817,
  AZN: 0.588249, AMD: 0.00275486, KZT: 0.00216792, UZS: 0.0000851402, ALL: 0.0126033,
  MKD: 0.0189404, BAM: 0.59726, MOP: 0.123803, MVR: 0.0646885, FJD: 0.454471, XPF: 0.009789,
};

export const toUSD = (currency: string): number => RATES[currency] ?? 1;

// USD amount → target currency amount.
export const fromUSD = (usd: number, currency: string): number => usd / (RATES[currency] ?? 1);

// Currencies we can convert + display (have a rate). Symbol used when distinctive.
export const CURRENCIES: { code: string; name: string; symbol: string }[] = [
  { code: "USD", name: "US Dollar", symbol: "$" },
  { code: "EUR", name: "Euro", symbol: "€" },
  { code: "GBP", name: "British Pound", symbol: "£" },
  { code: "JPY", name: "Japanese Yen", symbol: "¥" },
  { code: "CNY", name: "Chinese Yuan", symbol: "CN¥" },
  { code: "HKD", name: "Hong Kong Dollar", symbol: "HK$" },
  { code: "CAD", name: "Canadian Dollar", symbol: "CA$" },
  { code: "AUD", name: "Australian Dollar", symbol: "A$" },
  { code: "NZD", name: "New Zealand Dollar", symbol: "NZ$" },
  { code: "SGD", name: "Singapore Dollar", symbol: "S$" },
  { code: "CHF", name: "Swiss Franc", symbol: "CHF " },
  { code: "KRW", name: "South Korean Won", symbol: "₩" },
  { code: "TWD", name: "Taiwan Dollar", symbol: "NT$" },
  { code: "INR", name: "Indian Rupee", symbol: "₹" },
  { code: "THB", name: "Thai Baht", symbol: "฿" },
  { code: "MYR", name: "Malaysian Ringgit", symbol: "RM" },
  { code: "MXN", name: "Mexican Peso", symbol: "MX$" },
  { code: "ZAR", name: "South African Rand", symbol: "R" },
  { code: "AED", name: "UAE Dirham", symbol: "AED " },
  { code: "TRY", name: "Turkish Lira", symbol: "₺" },
  { code: "VND", name: "Vietnamese Dong", symbol: "₫" },
  { code: "CZK", name: "Czech Koruna", symbol: "Kč" },
  { code: "HUF", name: "Hungarian Forint", symbol: "Ft" },
  { code: "PLN", name: "Polish Zloty", symbol: "zł" },
  { code: "MAD", name: "Moroccan Dirham", symbol: "MAD " },
];

const SYMBOL: Record<string, string> = Object.fromEntries(CURRENCIES.map((c) => [c.code, c.symbol]));
export const currencySymbol = (code: string): string => SYMBOL[code] ?? `${code} `;
