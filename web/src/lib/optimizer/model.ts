// Debt-collection allocation model. Mirrors src/optimizer.py (Instance, evaluate, violation).
import accountsJson from "@/data/accounts.json";
import modelReport from "@/data/model_report.json";

export const K = 6;
export const NONE = 0, SMS = 1, CALL = 2, FIELD = 3, AGENCY = 4, LEGAL = 5;
export const BASE_FX = modelReport.fx_thb_per_usd;

export type Account = (typeof accountsJson)[number];
export const ACCOUNTS: Account[] = accountsJson;

export interface Strategy {
  key: string;
  name: string;
  lift: number;        // multiplier on the ML base recovery rate rho_i
  cost: number;        // fixed THB cost per account
  cost_pct: number;    // extra cost as a share of balance
  commission: number;  // share of recovered amount paid out (agency)
  hours: number;       // call-center hours per account
  enabled: boolean;
  priority: number;    // pi_k soft preference weight
}

export const STRATEGIES: Strategy[] = [
  { key: "none",   name: "No action / self-cure",      lift: 0.30, cost: 0,    cost_pct: 0.00, commission: 0.00, hours: 0.00, enabled: true, priority: 1 },
  { key: "sms",    name: "SMS + LINE OA reminder",     lift: 0.55, cost: 25,   cost_pct: 0.00, commission: 0.00, hours: 0.00, enabled: true, priority: 1 },
  { key: "call",   name: "In-house call center",       lift: 1.00, cost: 350,  cost_pct: 0.00, commission: 0.00, hours: 0.75, enabled: true, priority: 1 },
  { key: "field",  name: "Field collector visit",      lift: 1.40, cost: 1800, cost_pct: 0.00, commission: 0.00, hours: 0.00, enabled: true, priority: 1 },
  { key: "agency", name: "External collection agency", lift: 1.70, cost: 500,  cost_pct: 0.00, commission: 0.25, hours: 0.00, enabled: true, priority: 1 },
  { key: "legal",  name: "Legal action (law firm)",    lift: 2.30, cost: 8000, cost_pct: 0.02, commission: 0.00, hours: 0.00, enabled: true, priority: 1 },
];
export const TH_NAMES = ["ไม่ดำเนินการ", "SMS / LINE", "คอลเซ็นเตอร์", "ลงพื้นที่", "บริษัทติดตามหนี้", "ดำเนินคดี"];

export type AccountPriority = "none" | "balance" | "dpd" | "grade";

export interface Config {
  n: number;                  // first N accounts of the 300-account pool
  fx: number;                 // THB per USD
  budget: number;             // B_max
  call_hours: number;         // H
  field_slots: number;        // V
  hard_cap: number;           // M  (agency + legal)
  legal_retainer: number;     // F
  legal_min_cases: number;    // L
  legal_min_balance: number;
  must_act_dpd: number;
  unreachable_factor: number;
  rate_cap: number;
  account_priority: AccountPriority;
}

export const DEFAULT_CONFIG: Config = {
  n: 30, fx: BASE_FX, budget: 150_000, call_hours: 12, field_slots: 5, hard_cap: 10,
  legal_retainer: 40_000, legal_min_cases: 3, legal_min_balance: 100_000, must_act_dpd: 90,
  unreachable_factor: 0.4, rate_cap: 0.9, account_priority: "none",
};

export const PRESETS: Record<string, number[]> = {
  default: [1, 1, 1, 1, 1, 1],
  friendly: [1, 1.3, 1.2, 1.0, 0.8, 0.7],
  aggressive: [0.8, 0.9, 1.0, 1.1, 1.2, 1.3],
};

export interface InstanceAccount extends Account { balance: number }

export interface Instance {
  cfg: Config;
  strategies: Strategy[];
  acc: InstanceAccount[];
  n: number;
  R: number[][];   // expected gross recovery
  C: number[][];   // direct cost (counts against budget)
  V: number[][];   // true net value  R(1-phi) - C
  W: number[][];   // objective coefficient incl. priorities
  allowed: boolean[][];
  hours: number[];
  allowedList: number[][];
}

function accountWeights(acc: InstanceAccount[], mode: AccountPriority): number[] {
  if (mode === "balance") {
    const b = acc.map((a) => a.balance), lo = Math.min(...b), hi = Math.max(...b);
    return b.map((v) => 1 + (0.5 * (v - lo)) / (hi - lo + 1e-9));
  }
  if (mode === "dpd") return acc.map((a) => 1 + (0.5 * (a.dpd - 30)) / 150);
  if (mode === "grade") return acc.map((a) => 1 + (0.5 * "ABCDEFG".indexOf(a.grade)) / 6);
  return acc.map(() => 1);
}

export function buildInstance(cfg: Config, strategies: Strategy[]): Instance {
  const n = Math.max(5, Math.min(ACCOUNTS.length, Math.round(cfg.n)));
  // Balances are stored at the base FX rate; rescale and round to ฿100 like the pipeline does.
  const acc = ACCOUNTS.slice(0, n).map((a) => ({
    ...a,
    balance: cfg.fx === BASE_FX ? a.balance_thb : Math.round((a.balance_thb * cfg.fx) / BASE_FX / 100) * 100,
  }));
  const w = accountWeights(acc, cfg.account_priority);
  const R: number[][] = [], C: number[][] = [], V: number[][] = [], W: number[][] = [], allowed: boolean[][] = [];
  acc.forEach((a, i) => {
    R.push([]); C.push([]); V.push([]); W.push([]); allowed.push([]);
    strategies.forEach((s, k) => {
      let r = a.rho * s.lift;
      if (!a.reachable && (k === SMS || k === CALL)) r *= cfg.unreachable_factor;
      r = Math.min(r, cfg.rate_cap);
      const rec = a.balance * r, cost = s.cost + s.cost_pct * a.balance;
      R[i].push(rec); C[i].push(cost);
      V[i].push(rec * (1 - s.commission) - cost);
      W[i].push(w[i] * s.priority * rec * (1 - s.commission) - cost);
      let ok = s.enabled;
      if (k === LEGAL && a.balance < cfg.legal_min_balance) ok = false;
      if (k === NONE && a.dpd >= cfg.must_act_dpd) ok = false;
      allowed[i].push(ok);
    });
    if (!allowed[i].some(Boolean)) allowed[i][SMS] = true; // keep every account assignable
  });
  const allowedList = allowed.map((row) => row.flatMap((ok, k) => (ok ? [k] : [])));
  return { cfg, strategies, acc, n, R, C, V, W, allowed, hours: strategies.map((s) => s.hours), allowedList };
}

export interface Evaluation {
  objective: number;   // with priority weights (what the solvers maximise)
  net: number;         // true THB net recovery
  gross: number;
  cost: number;
  commission: number;
  hours: number;
  field: number;
  hard: number;
  legal: number;
  y: 0 | 1;            // law firm engaged
  mix: number[];
}

export function evaluate(I: Instance, a: number[]): Evaluation {
  let obj = 0, net = 0, gross = 0, cost = 0, commission = 0, hours = 0, field = 0, hard = 0, legal = 0;
  const mix = Array(K).fill(0);
  for (let i = 0; i < I.n; i++) {
    const k = a[i];
    obj += I.W[i][k]; net += I.V[i][k]; gross += I.R[i][k]; cost += I.C[i][k];
    commission += I.R[i][k] * I.strategies[k].commission;
    hours += I.hours[k]; mix[k]++;
    if (k === FIELD) field++;
    if (k === AGENCY || k === LEGAL) hard++;
    if (k === LEGAL) legal++;
  }
  const y = legal > 0 ? 1 : 0, F = y * I.cfg.legal_retainer;
  return { objective: obj - F, net: net - F, gross, cost: cost + F, commission, hours, field, hard, legal, y, mix };
}

/** Total scaled constraint violation (0 = feasible). Same weights as optimizer.py. */
export function violation(I: Instance, a: number[], e: Evaluation = evaluate(I, a)): number {
  const c = I.cfg;
  let v = Math.max(0, e.cost - c.budget) / 1000;
  v += Math.max(0, e.hours - c.call_hours - 1e-9) * 10;
  v += Math.max(0, e.field - c.field_slots) * 10;
  v += Math.max(0, e.hard - c.hard_cap) * 10;
  if (e.y && e.legal < c.legal_min_cases) v += (c.legal_min_cases - e.legal) * 10;
  for (let i = 0; i < I.n; i++) if (!I.allowed[i][a[i]]) v += 100;
  return v;
}

export const PENALTY = 100_000;
export function penalised(I: Instance, a: number[]): number {
  const e = evaluate(I, a);
  return e.objective - PENALTY * violation(I, a, e);
}

export function searchSpaceLog10(I: Instance): number {
  return I.allowedList.reduce((t, ks) => t + Math.log10(ks.length), 0);
}
