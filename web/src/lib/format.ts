const fmtB = new Intl.NumberFormat("th-TH", { style: "currency", currency: "THB", maximumFractionDigits: 0 });
const fmtN = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
export const thb = (v: number) => fmtB.format(Math.round(v));
export const int = (v: number) => fmtN.format(v);
export const kThb = (v: number) => "฿" + fmtN.format(v / 1000) + "k";
export const pct = (v: number, d = 1) => v.toFixed(d) + "%";
export const ms = (v: number) => (v < 1000 ? v.toFixed(0) + " ms" : (v / 1000).toFixed(2) + " s");
export const secs = (v: number) => (v < 1 ? (v * 1000).toFixed(0) + " ms" : v.toFixed(2) + " s");
export const css = (v: string) =>
  typeof window === "undefined" ? "" : getComputedStyle(document.documentElement).getPropertyValue(v).trim();
export const sColor = (k: number) => `var(--s${k})`;
export const STRATEGY_KEYS = ["none", "sms", "call", "field", "agency", "legal"];
