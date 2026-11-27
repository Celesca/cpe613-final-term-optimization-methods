// Greedy, Genetic Algorithm and Simulated Annealing. Same operators and defaults as src/optimizer.py.
import { CALL, type Instance, LEGAL, SMS, penalised, violation } from "./model";

export type Progress = (p: number) => void | Promise<void>;

export interface HeuristicResult {
  method: string;
  assign: number[];
  ms: number;
  history?: number[];
}

/** Mulberry32-style PRNG so runs are reproducible from a seed. */
export function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = (r: () => number, arr: number[]) => arr[Math.floor(r() * arr.length)];
/** Lets the event loop flush streamed progress between CPU-heavy chunks. */
export const yieldToLoop = () => new Promise<void>((res) => setImmediate(res));

const cheapSeed = (I: Instance): number[] => I.allowed.map((row) => (row[SMS] ? SMS : CALL));

/** Start at the cheapest allowed strategy, then repeatedly apply the feasible single upgrade
 *  with the best marginal value per baht. Never opens the law firm (retainer + min cases). */
export function greedy(I: Instance): HeuristicResult {
  const t = performance.now();
  const a = I.allowedList.map((ks, i) => ks.reduce((b, k) => (I.C[i][k] < I.C[i][b] ? k : b), ks[0]));
  for (;;) {
    let best: [number, number, number] | null = null;
    const hasLegal = a.includes(LEGAL);
    for (let i = 0; i < I.n; i++) {
      for (const k of I.allowedList[i]) {
        if (k === a[i]) continue;
        const dv = I.W[i][k] - I.W[i][a[i]];
        if (dv <= 0 || (k === LEGAL && !hasLegal)) continue;
        const old = a[i];
        a[i] = k;
        const feasible = violation(I, a) === 0;
        a[i] = old;
        if (!feasible) continue;
        const ratio = dv / Math.max(I.C[i][k] - I.C[i][old], 1);
        if (!best || ratio > best[0]) best = [ratio, i, k];
      }
    }
    if (!best) break;
    a[best[1]] = best[2];
  }
  return { method: "Greedy (value / cost)", assign: a, ms: performance.now() - t };
}

export interface GAParams { pop: number; gens: number; pc: number; pm?: number; seed: number }
export const GA_DEFAULTS: GAParams = { pop: 120, gens: 400, pc: 0.9, seed: 0 };

/** Elitist GA: 2 elites, tournament(3) selection, uniform crossover, per-gene reset mutation. */
export async function geneticAlgorithm(I: Instance, p: GAParams, onProgress?: Progress): Promise<HeuristicResult> {
  const r = rng(p.seed + 1), t = performance.now(), pm = p.pm ?? 1.5 / I.n, pop = p.pop;
  let P = Array.from({ length: pop }, () => I.allowedList.map((ks) => pick(r, ks)));
  P[0] = cheapSeed(I);
  let fit = P.map((a) => penalised(I, a));
  const history: number[] = [];
  const tournament = () => {
    let b = Math.floor(r() * pop);
    for (let j = 0; j < 2; j++) { const c = Math.floor(r() * pop); if (fit[c] > fit[b]) b = c; }
    return P[b];
  };
  for (let g = 0; g < p.gens; g++) {
    const order = fit.map((_, i) => i).sort((x, y) => fit[y] - fit[x]);
    const next = [P[order[0]].slice(), P[order[1]].slice()];
    while (next.length < pop) {
      const p1 = tournament(), p2 = tournament();
      const child = r() < p.pc ? p1.map((v, i) => (r() < 0.5 ? v : p2[i])) : p1.slice();
      for (let i = 0; i < I.n; i++) if (r() < pm) child[i] = pick(r, I.allowedList[i]);
      next.push(child);
    }
    P = next;
    fit = P.map((a) => penalised(I, a));
    history.push(Math.max(...fit));
    if (onProgress && g % 20 === 0) { await onProgress(g / p.gens); await yieldToLoop(); }
  }
  const bi = fit.indexOf(Math.max(...fit));
  return { method: "Genetic Algorithm", assign: P[bi], ms: performance.now() - t, history };
}

export interface SAParams { iters: number; T0: number; alpha: number; seed: number }
export const SA_DEFAULTS: SAParams = { iters: 60_000, T0: 1_000_000, alpha: 0.99975, seed: 0 };

/** SA with single-gene flip + occasional (30%) swap move, geometric cooling. */
export async function simulatedAnnealing(I: Instance, p: SAParams, onProgress?: Progress): Promise<HeuristicResult> {
  const r = rng(p.seed + 1), t = performance.now();
  let a = cheapSeed(I), fa = penalised(I, a), best = a.slice(), fb = fa, T = p.T0;
  const history: number[] = [];
  const every = Math.max(1, Math.round(p.iters / 400));
  for (let it = 0; it < p.iters; it++) {
    const b = a.slice(), i = Math.floor(r() * I.n);
    b[i] = pick(r, I.allowedList[i]);
    if (r() < 0.3) {
      const j = Math.floor(r() * I.n);
      if (I.allowed[i][a[j]] && I.allowed[j][a[i]]) { b[i] = a[j]; b[j] = a[i]; }
    }
    const f = penalised(I, b);
    if (f >= fa || r() < Math.exp((f - fa) / T)) {
      a = b; fa = f;
      if (fa > fb) { best = a.slice(); fb = fa; }
    }
    T *= p.alpha;
    if (it % every === 0) history.push(fb);
    if (onProgress && it % 5000 === 0) { await onProgress(it / p.iters); await yieldToLoop(); }
  }
  return { method: "Simulated Annealing", assign: best, ms: performance.now() - t, history };
}
