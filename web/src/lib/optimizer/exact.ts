// Exact MILP (and its LP relaxation) solved with HiGHS — the same solver scipy.milp uses in optimizer.py.
import "server-only";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import highsLoader, { type Highs } from "highs";
import { AGENCY, CALL, FIELD, type Instance, LEGAL, SMS } from "./model";

let highsPromise: Promise<Highs> | null = null;

function loadHighs(): Promise<Highs> {
  // Pass the binary explicitly: bundlers/serverless tracing cannot follow the emscripten locateFile path.
  const wasmBinary = readFileSync(join(process.cwd(), "node_modules", "highs", "build", "highs.wasm"));
  return highsLoader({ wasmBinary });
}

type Solution = ReturnType<Highs["solve"]>;

/** Solve an LP-format model. HiGHS-wasm can get into a bad state after a crash; reload once and retry. */
async function solveLP(model: string, timeLimit: number): Promise<Solution> {
  for (let attempt = 0; ; attempt++) {
    highsPromise ??= loadHighs();
    const highs = await highsPromise;
    try {
      return highs.solve(model, { time_limit: timeLimit });
    } catch (err) {
      highsPromise = null;
      if (attempt >= 1) throw err;
    }
  }
}

type Objective = "W" | "R";

/** CPLEX-LP text for the model. objective "W" = priority-weighted net value (minus retainer),
 *  "R" = gross recovery only (f1 of the multi-objective model). */
export function lpModel(I: Instance, { relax = false, objective = "W" as Objective, budget = I.cfg.budget } = {}) {
  const c = I.cfg, vars: string[] = [];
  const term = (v: number, x: string) => `${v < 0 ? "-" : "+"} ${Math.abs(v).toFixed(4)} ${x}`;
  const obj: string[] = [], rows: string[] = [];
  for (let i = 0; i < I.n; i++) for (const k of I.allowedList[i]) {
    vars.push(`x${i}_${k}`);
    obj.push(term(I[objective][i][k], `x${i}_${k}`));
  }
  if (objective === "W") obj.push(term(-c.legal_retainer, "y"));
  for (let i = 0; i < I.n; i++) rows.push(` assign_${i}: ` + I.allowedList[i].map((k) => `+ 1 x${i}_${k}`).join(" ") + " = 1");
  const sum = (pred: (k: number) => boolean, coef: (i: number, k: number) => number) => {
    const t: string[] = [];
    for (let i = 0; i < I.n; i++) for (const k of I.allowedList[i]) if (pred(k)) {
      const v = coef(i, k);
      if (v) t.push(term(v, `x${i}_${k}`));
    }
    return t;
  };
  const budgetT = sum(() => true, (i, k) => I.C[i][k]);
  budgetT.push(term(c.legal_retainer, "y"));
  rows.push(` budget: ${budgetT.join("\n ")} <= ${budget}`);
  const callT = sum((k) => k === CALL, (_i, k) => I.hours[k]);
  if (callT.length) rows.push(` call_hours: ${callT.join("\n ")} <= ${c.call_hours}`);
  const fieldT = sum((k) => k === FIELD, () => 1);
  if (fieldT.length) rows.push(` field_slots: ${fieldT.join("\n ")} <= ${c.field_slots}`);
  const hardT = sum((k) => k === AGENCY || k === LEGAL, () => 1);
  if (hardT.length) rows.push(` hard_cap: ${hardT.join("\n ")} <= ${c.hard_cap}`);
  const legalT: string[] = [];
  for (let i = 0; i < I.n; i++) if (I.allowed[i][LEGAL]) {
    rows.push(` link_${i}: + 1 x${i}_${LEGAL} - 1 y <= 0`);   // x_i,legal <= y (disaggregated linking)
    legalT.push(`- 1 x${i}_${LEGAL}`);
  }
  rows.push(` legal_min: + ${c.legal_min_cases} y ${legalT.join(" ")} <= 0`); // L*y <= sum x_i,legal
  const bounds = vars.concat("y").map((v) => ` 0 <= ${v} <= 1`);
  return `Maximize\n obj: ${obj.join("\n ")}\nSubject To\n${rows.join("\n")}\nBounds\n${bounds.join("\n")}\n` +
    (relax ? "" : `General\n ${vars.concat("y").join(" ")}\n`) + "End\n";
}

function readAssignment(I: Instance, sol: Solution): number[] {
  const a = Array(I.n).fill(SMS);
  for (const [name, col] of Object.entries(sol.Columns)) {
    const m = /^x(\d+)_(\d)$/.exec(name);
    if (m && (col as { Primal: number }).Primal > 0.5) a[+m[1]] = +m[2];
  }
  return a;
}

export interface ExactResult { method: string; assign: number[]; ms: number; status: string }

export async function solveExact(I: Instance, opts: { objective?: Objective; budget?: number; timeLimit?: number } = {}): Promise<ExactResult> {
  const t = performance.now();
  const sol = await solveLP(lpModel(I, opts), opts.timeLimit ?? 30);
  const ms = performance.now() - t;
  if (!/Optimal|Time limit/i.test(sol.Status)) throw new Error("HiGHS status: " + sol.Status);
  return { method: "Exact MILP (HiGHS)", assign: readAssignment(I, sol), ms, status: sol.Status };
}

export interface LPRelaxation { bound: number; duals: Record<string, number>; fractional: number }

/** LP relaxation: upper bound and shadow prices (duals) of the four resource constraints. */
export async function lpRelaxation(I: Instance): Promise<LPRelaxation> {
  const sol = await solveLP(lpModel(I, { relax: true }), 30);
  const duals: Record<string, number> = {};
  for (const row of (sol.Rows ?? []) as { Name: string; Dual: number }[]) {
    if (["budget", "call_hours", "field_slots", "hard_cap"].includes(row.Name)) duals[row.Name] = Math.abs(row.Dual);
  }
  const fractional = Object.values(sol.Columns).filter((c) => {
    const p = (c as { Primal: number }).Primal;
    return p > 1e-6 && p < 1 - 1e-6;
  }).length;
  return { bound: sol.ObjectiveValue, duals, fractional };
}

export const NUM_VARS = (I: Instance) => I.allowedList.reduce((s, ks) => s + ks.length, 0) + 1;
export const NUM_CONSTRAINTS = (I: Instance) =>
  I.n + 4 + I.allowed.filter((row) => row[LEGAL]).length + 1;
