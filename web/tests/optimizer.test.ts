// Parity checks against the Python reference results (data/results_N30.json, data/phase1_summary_table.csv).
import { describe, expect, it } from "vitest";
import results from "@/data/results_n30.json";
import summary from "@/data/phase1_summary.json";
import { lpRelaxation, solveExact } from "@/lib/optimizer/exact";
import { greedy } from "@/lib/optimizer/heuristics";
import { DEFAULT_CONFIG, STRATEGIES, buildInstance, evaluate, violation } from "@/lib/optimizer/model";
import { parseInput, runOptimization, runPareto } from "@/lib/optimizer/run";

const n30 = () => buildInstance(DEFAULT_CONFIG, STRATEGIES);

describe("model + exact solver match optimizer.py", () => {
  it("N=30 MILP optimum equals the Python/HiGHS optimum", async () => {
    const I = n30();
    const r = await solveExact(I);
    const e = evaluate(I, r.assign);
    expect(violation(I, r.assign)).toBe(0);
    expect(e.objective).toBeCloseTo(results.exact.objective, 2);
    expect(e.cost).toBeCloseTo(results.exact.cost, 2);
    expect(e.mix).toEqual(Object.values(results.exact.mix));
  });

  it("LP relaxation bound matches", async () => {
    const lp = await lpRelaxation(n30());
    expect(lp.bound).toBeCloseTo(results.lp.bound, 0);
  });

  it("greedy reproduces the Python greedy value (law firm never opened)", () => {
    const I = n30();
    const e = evaluate(I, greedy(I).assign);
    expect(e.objective).toBeCloseTo(results.greedy.objective, 2);
    expect(e.y).toBe(0);
  });

  it.each([
    ["N100_prop", 100, 10 / 3],
    ["N300_prop", 300, 10],
  ])("%s MILP optimum matches Phase I", async (label, n, scale) => {
    const cfg = { ...DEFAULT_CONFIG, n, budget: 150_000 * scale, call_hours: 12 * scale,
      field_slots: Math.round(5 * scale), hard_cap: Math.round(10 * scale) };
    const I = buildInstance(cfg, STRATEGIES);
    const e = evaluate(I, (await solveExact(I)).assign);
    const ref = summary.find((r) => r.instance === label)!;
    expect(e.objective / ref.milp_opt).toBeCloseTo(1, 5);
  });
});

describe("full run", () => {
  it("returns feasible GA/SA solutions close to the optimum at N=30", async () => {
    const res = await runOptimization(parseInput({ cfg: DEFAULT_CONFIG }), () => {});
    const [exact, , ga, sa] = res.methods;
    expect(exact.gapPct).toBeCloseTo(0, 6);
    expect(ga.feasible && sa.feasible).toBe(true);
    expect(sa.gapPct!).toBeLessThan(1);
    expect(ga.gapPct!).toBeLessThan(3);
    expect(res.assignment).toHaveLength(30);
  });

  it("pareto front is monotone in cost and gross", async () => {
    const { points } = await runPareto(parseInput({}), () => {});
    expect(points.length).toBeGreaterThan(5);
    for (let i = 1; i < points.length; i++) expect(points[i].gross).toBeGreaterThanOrEqual(points[i - 1].gross - 1);
  });

  it("parseInput clamps abusive parameters", () => {
    const p = parseInput({ cfg: { n: 10_000 }, ga: { pop: 1e9, gens: 1e9 }, sa: { iters: 1e12 } });
    expect(p.cfg.n).toBe(300);
    expect(p.ga.pop).toBe(300);
    expect(p.sa.iters).toBe(200_000);
  });
});
