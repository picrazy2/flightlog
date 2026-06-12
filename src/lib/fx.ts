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
