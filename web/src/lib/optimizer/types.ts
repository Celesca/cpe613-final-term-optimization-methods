// Request / response shapes shared by the API routes and the client.
import type { GAParams, SAParams } from "./heuristics";
import type { Config, Evaluation, Strategy } from "./model";

export interface RunInput {
  cfg: Config;
  strategies: Strategy[];
  ga: GAParams;
  sa: SAParams;
}

export interface MethodResult {
  method: string;
  ms: number;
  assign: number[];
  eval: Evaluation;
  feasible: boolean;
  gapPct: number | null;
  history?: number[];
  status?: string;
}

export interface AssignmentRow {
  account_id: string;
  sub_grade: string;
  dpd: number;
  reachable: number;
  balance: number;
  rho: number;
  strategy: number;
  recovery: number;
  cost: number;
  net: number;
}

export interface RunResponse {
  instance: {
    n: number;
    totalBalance: number;
    log10Space: number;
    vars: number;
    constraints: number;
    cfg: Config;
    gaParams: GAParams;
    saParams: SAParams;
  };
  methods: MethodResult[];
  best: string;
  exactObjective: number;
  lp: { bound: number; duals: Record<string, number>; fractional: number; gapPct: number };
  assignment: AssignmentRow[];
  totalMs: number;
}

export interface ParetoPoint { eps: number; cost: number; gross: number; net: number; mix: number[] }
export interface ParetoResponse { points: ParetoPoint[]; totalMs: number }

/** One line of the NDJSON stream returned by /api/solve and /api/pareto. */
export type StreamEvent<T> =
  | { type: "progress"; stage: string; p: number }
  | { type: "result"; data: T }
  | { type: "error"; message: string };
