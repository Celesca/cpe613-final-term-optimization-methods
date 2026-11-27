import type { Metadata } from "next";

export const metadata: Metadata = { title: "Model & API · Debt Collection Optimizer" };

export default function About() {
  return (
    <>
      <header className="pagehead">
        <div>
          <h1>Model, algorithms &amp; API</h1>
          <p>What is optimised, which methods solve it, and how this site runs them.</p>
        </div>
      </header>
      <main className="page prose">
        <h2 className="section-title">Problem</h2>
        <p>Each delinquent account <i>i</i> gets exactly one collection strategy <i>k</i> ∈ {"{"}none, SMS/LINE, call center, field visit, agency, legal{"}"}.
          Binary <code>x[i,k]</code> = 1 if account <i>i</i> gets strategy <i>k</i>; binary <code>y</code> = 1 if the law firm is engaged.</p>
        <ul>
          <li><b>Single objective</b> — maximise expected net recovery Σ (E[R<sub>ik</sub>](1 − φ<sub>k</sub>) − c<sub>ik</sub>) x<sub>ik</sub> − F·y.</li>
          <li><b>Constraints</b> — one strategy per account; budget (incl. retainer F·y); call-center hours; field-visit slots; agency + legal cap;
            x<sub>i,legal</sub> ≤ y; at least L legal cases if y = 1; legal only for balances ≥ ฿100k; no “none” for DPD ≥ 90.</li>
          <li><b>Multi-objective</b> — maximise gross recovery f<sub>1</sub> and minimise cost f<sub>2</sub>; Pareto front by the ε-constraint method.</li>
          <li><b>Size</b> — at N = 30 there are ≈ 5.5 × 10<sup>21</sup> feasible-by-eligibility plans, far above the course minimum of 3 × 10<sup>6</sup>.</li>
        </ul>

        <h2 className="section-title">Methods (all real, all run on the server)</h2>
        <ul>
          <li><b>Exact MILP — HiGHS</b> (branch-and-bound + cuts). The traditional mathematical-programming method and the reference optimum. Its LP relaxation gives the upper bound and shadow prices.</li>
          <li><b>Greedy</b> — best value-per-baht upgrades. Fast but structurally blind to the law-firm retainer (≈15% gap).</li>
          <li><b>Genetic Algorithm</b> — population 120, 400 generations, tournament(3), uniform crossover p<sub>c</sub> = 0.9, mutation 1.5/N, elitism 2, penalty for constraint violation.</li>
          <li><b>Simulated Annealing</b> — 60,000 iterations, T<sub>0</sub> = 10<sup>6</sup>, α = 0.99975, flip + swap moves, same penalty.</li>
        </ul>
        <p>The course asks for a math-programming method <i>and</i> a meta-heuristic “such as GA or SA”. This project implements both meta-heuristics and compares them:
          in Phase I, SA beat GA on all 18 paired runs (mean gap 0.72% vs 1.82%, Wilcoxon p = 0.00035). GA is kept as the comparison meta-heuristic.</p>
        <p className="note">The TypeScript solvers are a port of <code>src/optimizer.py</code>; automated tests check that the server reproduces the Python optimum (฿1,099,661.34 at N = 30) and the N = 100 / 300 optima.
          GA/SA use a different random generator than numpy, so individual seeded runs differ from the Python runs while the statistics are comparable.</p>

        <h2 className="section-title">Architecture</h2>
        <pre><code>{`Browser (Next.js page)                 Server (Next.js route handlers, Node)
  Simulator form  ── POST /api/solve ──▶ parseInput → buildInstance
                  ◀── NDJSON progress ──  HiGHS MILP + LP duals, Greedy, GA, SA
  Pareto button   ── POST /api/pareto ─▶ 21 × HiGHS MILP (ε-constraint)
  Data page       ── GET  /api/data/* ─▶ datasets exported by the Python pipeline`}</code></pre>

        <h2 className="section-title">API</h2>
        <ul>
          <li><code>POST /api/solve</code> — body <code>{"{ cfg, strategies, ga, sa }"}</code> (all optional, defaults = report instance). Streams NDJSON lines <code>{"{type:\"progress\"}"}</code> then one <code>{"{type:\"result\"}"}</code>.</li>
          <li><code>POST /api/pareto</code> — same body; returns the ε-constraint Pareto points.</li>
          <li><code>GET /api/data</code> — dataset index; <code>GET /api/data/&lt;name&gt;</code> JSON, <code>?format=csv</code> for tables.</li>
        </ul>
        <pre><code>{`curl -N -X POST https://<your-app>.vercel.app/api/solve \\
  -H 'content-type: application/json' -d '{"cfg":{"n":100,"budget":500000}}'`}</code></pre>

        <h2 className="section-title">Data</h2>
        <p>Real defaulted LendingClub loans (Kaggle), a recovery model trained on 260,640 of them, and a 300-account baht portfolio. The full pipeline is on <a href="/data#pipeline">Data → Source &amp; pipeline</a>.</p>

        <h2 className="section-title">Assumptions</h2>
        <p>Strategy lifts (×0.3 … ×2.3) and baht costs are assumptions you can change in the simulator. DPD and phone reachability are synthetic, because LendingClub does not record them.</p>
      </main>
    </>
  );
}
