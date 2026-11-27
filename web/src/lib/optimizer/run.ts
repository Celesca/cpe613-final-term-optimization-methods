// Orchestrates a full optimisation run / Pareto sweep for the API routes.
import "server-only";
import { NUM_CONSTRAINTS, NUM_VARS, lpRelaxation, solveExact } from "./exact";
import { GA_DEFAULTS, SA_DEFAULTS, geneticAlgorithm, greedy, simulatedAnnealing, type HeuristicResult } from "./heuristics";
import {
  type AccountPriority, type Config, DEFAULT_CONFIG, type Evaluation, type Instance, STRATEGIES, type Strategy,
  buildInstance, evaluate, searchSpaceLog10, violation,
} from "./model";
import type { MethodResult, ParetoPoint, ParetoResponse, RunInput, RunResponse } from "./types";

export type Emit = (stage: string, p: number) => void | Promise<void>;

const num = (v: unknown, lo: number, hi: number, fallback: number) => {
  const x = Number(v);
  return Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : fallback;
};

/** Validate and clamp a client payload so a request can never exceed the function time limit. */
export function parseInput(body: unknown): RunInput {
  const b = (body ?? {}) as { cfg?: Partial<Config>; strategies?: Partial<Strategy>[]; ga?: Partial<RunInput["ga"]>; sa?: Partial<RunInput["sa"]> };
  const c: Partial<Config> = b.cfg ?? {}, d = DEFAULT_CONFIG;
  const priorities: AccountPriority[] = ["none", "balance", "dpd", "grade"];
  const cfg: Config = {
    n: Math.round(num(c.n, 5, 300, d.n)),
    fx: num(c.fx, 1, 100, d.fx),
    budget: num(c.budget, 0, 1e9, d.budget),
    call_hours: num(c.call_hours, 0, 1e5, d.call_hours),
    field_slots: Math.round(num(c.field_slots, 0, 1e4, d.field_slots)),
    hard_cap: Math.round(num(c.hard_cap, 0, 1e4, d.hard_cap)),
    legal_retainer: num(c.legal_retainer, 0, 1e8, d.legal_retainer),
    legal_min_cases: Math.round(num(c.legal_min_cases, 0, 300, d.legal_min_cases)),
    legal_min_balance: num(c.legal_min_balance, 0, 1e9, d.legal_min_balance),
    must_act_dpd: num(c.must_act_dpd, 0, 10_000, d.must_act_dpd),
    unreachable_factor: num(c.unreachable_factor, 0, 1, d.unreachable_factor),
    rate_cap: num(c.rate_cap, 0, 1, d.rate_cap),
    account_priority: priorities.includes(c.account_priority as AccountPriority) ? (c.account_priority as AccountPriority) : "none",
  };
  const strategies = STRATEGIES.map((s, k) => {
    const u: Partial<Strategy> = b.strategies?.[k] ?? {};
    return {
      ...s,
      lift: num(u.lift, 0, 10, s.lift),
      cost: num(u.cost, 0, 1e7, s.cost),
      commission: num(u.commission, 0, 1, s.commission),
      priority: num(u.priority, 0, 5, s.priority),
      enabled: u.enabled === undefined ? true : Boolean(u.enabled),
    };
  });
  const g: Partial<RunInput["ga"]> = b.ga ?? {}, s: Partial<RunInput["sa"]> = b.sa ?? {};
  return {
    cfg, strategies,
    ga: { pop: Math.round(num(g.pop, 10, 300, GA_DEFAULTS.pop)), gens: Math.round(num(g.gens, 10, 1000, GA_DEFAULTS.gens)),
      pc: num(g.pc, 0, 1, GA_DEFAULTS.pc), seed: Math.round(num(g.seed, 0, 1e6, 0)) },
    sa: { iters: Math.round(num(s.iters, 1000, 200_000, SA_DEFAULTS.iters)), T0: num(s.T0, 1, 1e9, SA_DEFAULTS.T0),
      alpha: num(s.alpha, 0.9, 0.999999, SA_DEFAULTS.alpha), seed: Math.round(num(s.seed, 0, 1e6, 0)) },
  };
}

function describe(I: Instance, r: { method: string; assign: number[]; ms: number; history?: number[]; status?: string }, exactObj: number | null): MethodResult {
  const e = evaluate(I, r.assign);
  return {
    method: r.method, ms: r.ms, assign: r.assign, eval: e,
    feasible: violation(I, r.assign, e) === 0,
    gapPct: exactObj ? (1 - e.objective / exactObj) * 100 : null,
    history: r.history, status: r.status,
  };
}

export async function runOptimization(input: RunInput, emit: Emit): Promise<RunResponse> {
  const t0 = performance.now();
  const I = buildInstance(input.cfg, input.strategies);
  await emit("Exact MILP (HiGHS)…", 0.02);
  const exact = await solveExact(I);
  const lp = await lpRelaxation(I);
  const exactObj = evaluate(I, exact.assign).objective;
  await emit("Greedy heuristic…", 0.08);
  const gr = greedy(I);
  await emit("Genetic algorithm…", 0.12);
  const ga: HeuristicResult = await geneticAlgorithm(I, input.ga, (p) => emit("Genetic algorithm…", 0.12 + p * 0.43));
  const sa: HeuristicResult = await simulatedAnnealing(I, input.sa, (p) => emit("Simulated annealing…", 0.55 + p * 0.43));
  const methods = [describe(I, exact, exactObj), describe(I, gr, exactObj), describe(I, ga, exactObj), describe(I, sa, exactObj)];
  const feasible = methods.filter((m) => m.feasible);
  const best = (feasible.length ? feasible : methods).reduce((b, m) => (m.eval.objective > b.eval.objective ? m : b));
  const totalBalance = I.acc.reduce((s, a) => s + a.balance, 0);
  return {
    instance: {
      n: I.n, totalBalance, log10Space: searchSpaceLog10(I), vars: NUM_VARS(I), constraints: NUM_CONSTRAINTS(I),
      cfg: I.cfg, gaParams: input.ga, saParams: input.sa,
    },
    methods, best: best.method, exactObjective: exactObj, lp: { ...lp, gapPct: (lp.bound / exactObj - 1) * 100 },
    assignment: I.acc.map((a, i) => {
      const k = best.assign[i];
      return {
        account_id: a.account_id, sub_grade: a.sub_grade, dpd: a.dpd, reachable: a.reachable, balance: a.balance, rho: a.rho,
        strategy: k, recovery: I.R[i][k], cost: I.C[i][k], net: I.V[i][k],
      };
    }),
    totalMs: performance.now() - t0,
  };
}

/** epsilon-constraint: max f1 = gross recovery s.t. f2 = cost <= eps (all other constraints kept). */
export async function runPareto(input: RunInput, emit: Emit, points = 21): Promise<ParetoResponse> {
  const t0 = performance.now();
  const neutral = input.strategies.map((s) => ({ ...s, priority: 1 }));
  const I = buildInstance({ ...input.cfg, account_priority: "none" }, neutral);
  const top = Math.max(I.cfg.budget * 2.5, 50_000), pts: ParetoPoint[] = [];
  for (let j = 0; j < points; j++) {
    const eps = top * (0.03 + (0.97 * j) / (points - 1));
    await emit(`Pareto point ${j + 1} / ${points}…`, j / points);
    try {
      const r = await solveExact(I, { objective: "R", budget: eps, timeLimit: 10 });
      const e: Evaluation = evaluate(I, r.assign);
      pts.push({ eps, cost: e.cost, gross: e.gross, net: e.net, mix: e.mix });
    } catch {
      // infeasible epsilon (e.g. too small for must-act accounts) — skip the point
    }
  }
  const uniq = pts
    .filter((p, i) => !pts.slice(0, i).some((q) => Math.abs(q.cost - p.cost) < 1 && Math.abs(q.gross - p.gross) < 1))
    .sort((a, b) => a.cost - b.cost);
  return { points: uniq, totalMs: performance.now() - t0 };
}
