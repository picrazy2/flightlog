// Rough static FX → USD. Good enough for a lifetime-spend headline; refine later
// with a rates endpoint if needed. (RMB is normalized to CNY upstream.)
const RATES: Record<string, number> = {
  USD: 1, CNY: 0.14, EUR: 1.08, GBP: 1.27, HKD: 0.128, JPY: 0.0067,
  CAD: 0.74, SGD: 0.74, AUD: 0.66, KRW: 0.00075, TWD: 0.031, ZAR: 0.054,
  MXN: 0.052, THB: 0.028, MYR: 0.22, CHF: 1.1, NZD: 0.6, AED: 0.27,
  EGP: 0.02, MNT: 0.0003, VND: 0.00004, TRY: 0.029, CZK: 0.043,
  MAD: 0.10, PEN: 0.27, IDR: 0.000062, PHP: 0.017, INR: 0.012,
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
  { code: "MAD", name: "Moroccan Dirham", symbol: "MAD " },
];

const SYMBOL: Record<string, string> = Object.fromEntries(CURRENCIES.map((c) => [c.code, c.symbol]));
export const currencySymbol = (code: string): string => SYMBOL[code] ?? `${code} `;
