"use client";
// "Source & pipeline" tab: where the data comes from and how each script transforms it.
// Numbers come from src/01_explore.py, src/02_model_and_dataset.py, data/model_report.json and the Phase I report.
import accounts from "@/data/accounts.json";
import modelReport from "@/data/model_report.json";
import { int, pct, sColor, thb } from "@/lib/format";
import { DEFAULT_CONFIG, STRATEGIES, buildInstance } from "@/lib/optimizer/model";
import { CodeTabs, type SnippetId } from "./CodeBlock";

const KAGGLE = "https://www.kaggle.com/datasets/adarshsng/lending-club-loan-data-csv";

type Kind = "data" | "model" | "synthetic" | "opt";
const FLOW: { kind: Kind; title: string; count: string; sub: string }[] = [
  { kind: "data", title: "LendingClub loan.csv", count: "2,260,668 loans", sub: "145 columns · Kaggle" },
  { kind: "data", title: "Defaulted loans", count: "262,447", sub: "Charged Off / Default" },
  { kind: "data", title: "Exposure > $500", count: `${int(modelReport.n_defaulted_used)}`, sub: "EAD = funded − principal repaid" },
  { kind: "model", title: "Recovery model", count: `AUC ${modelReport.classifier_auc}`, sub: "24 features · 75/25 split" },
  { kind: "synthetic", title: "300-account pool", count: "THB ×33", sub: "+ DPD, phone (synthetic)" },
  { kind: "opt", title: "Optimizer cohorts", count: "N = 30 / 100 / 300", sub: "MILP · Greedy · GA · SA" },
];

const KIND_LABEL: Record<Kind, string> = { data: "real data", model: "machine learning", synthetic: "real + synthetic", opt: "optimization" };

type Stage = {
  step: string; title: string; script: string; input: string; output: string;
  points: React.ReactNode[]; code: { id: SnippetId; label: string }[];
};

const STAGES: Stage[] = [
  {
    step: "1", title: "Extract defaulted loans", script: "src/01_explore.py",
    input: "archive-2/loan.csv (LendingClub, 2007–2018, 2.26 M loans × 145 columns)",
    output: "data/defaulted_raw.csv.gz (36 columns kept)",
    points: [
      <>Reads the 2.26 M-row file in 300,000-row chunks (it does not fit in memory at once) and keeps loans whose <code>loan_status</code> is <b>Charged Off</b>, <b>Default</b> or <b>Does not meet the credit policy. Status: Charged Off</b> → <b>262,447</b> loans.</>,
      <>Defines exposure at default <code>EAD = funded_amnt − total_rec_prncp</code> (what was still owed) and the historical recovery rate <code>recoveries / EAD</code>.</>,
      <>On average only ≈ {pct(modelReport.mean_actual_rate * 100)} of the exposure was ever recovered, and the rate barely changes from grade A to G.</>,
    ],
    code: [{ id: "extract", label: "filter + EAD" }],
  },
  {
    step: "2", title: "Clean the data and build features", script: "src/02_model_and_dataset.py",
    input: "data/defaulted_raw.csv.gz",
    output: "feature table X (24 columns) + targets",
    points: [
      <>Drops tiny exposures (EAD ≤ $500) → <b>{int(modelReport.n_defaulted_used)}</b> loans.</>,
      <>Two targets: <code>recovered</code> (did we get anything back? 0/1) and <code>rec_rate</code> (share of EAD recovered, clipped to 0–1).</>,
      <>Turns text columns into numbers (term “36 months” → 36, grade A–G → 0–6, categories → codes) and keeps 24 features known <i>before</i> collection starts.</>,
      <><b>No leakage:</b> <code>recoveries</code>, <code>collection_recovery_fee</code> and <code>total_pymnt</code> describe the outcome, so they are never inputs.</>,
    ],
    code: [{ id: "features", label: "features" }],
  },
  {
    step: "3", title: "Train the two-part recovery model", script: "src/02_model_and_dataset.py",
    input: "X, recovered, rec_rate",
    output: "classifier + regressor, data/model_report.json",
    points: [
      <>Splits 75% train / 25% test (seed 613) so the scores below are measured on loans the model never saw.</>,
      <><b>Part 1 – will they pay anything?</b> <code>HistGradientBoostingClassifier</code> → P(pay). Test AUC <b>{modelReport.classifier_auc}</b> vs {modelReport.classifier_auc_grade_only} with grade alone.</>,
      <><b>Part 2 – how much, if they pay?</b> <code>HistGradientBoostingRegressor</code> trained only on loans that recovered something (MAE {pct(modelReport.rate_mae_given_recovered * 100, 2)}).</>,
      <>Expected recovery rate = P(pay) × E[rate | pay]. Mean predicted {pct(modelReport.mean_predicted_rate * 100, 2)} = mean actual {pct(modelReport.mean_actual_rate * 100, 2)}.</>,
    ],
    code: [{ id: "train", label: "train + evaluate" }],
  },
  {
    step: "4", title: "Build the Thai collection portfolio", script: "src/02_model_and_dataset.py",
    input: "defaulted loans + the two fitted models",
    output: "data/accounts_pool.csv (300 accounts), data/accounts_N30.csv",
    points: [
      <>Stratified sample by grade: A 25 · B 50 · C 75 · D 65 · E 45 · F 25 · G 15 = 300 accounts, renamed <code>TH0001…TH0300</code>.</>,
      <>Scores each account with both models → <code>p_pay</code>, <code>rate_if_pay</code>.</>,
      <><b>Synthetic fields</b> (LendingClub has no collection-stage data): days past due <code>dpd</code> and phone <code>reachable</code>, drawn with seed 613 so the dataset is reproducible.</>,
      <><code>ρᵢ = P(pay) × E[rate | pay] × e^(−0.004·(dpd − 30))</code>, clipped to [0.01, 0.60]; baht balance = EAD × {modelReport.fx_thb_per_usd}.</>,
    ],
    code: [{ id: "portfolio", label: "sample + ρ" }],
  },
  {
    step: "5", title: "Turn accounts into an optimization model", script: "src/optimizer.py",
    input: "accounts + strategy table + limits (DEFAULT_CFG)",
    output: "matrices R (recovery), C (cost), V (net value), allowed (eligibility)",
    points: [
      <>Six strategies, each with a lift λₖ, a fixed cost, a % of balance cost, a commission and call hours.</>,
      <>For every account × strategy: rate <code>r = min(0.9, ρᵢ·λₖ)</code> (×0.4 for SMS/call if the phone is unreachable), recovery <code>R = B·r</code>, value <code>V = R(1 − commission) − cost</code>.</>,
      <>Eligibility rules remove options up front: no legal below ฿100k, no “none” for DPD ≥ 90.</>,
    ],
    code: [{ id: "strategies", label: "STRATEGIES" }, { id: "values", label: "Instance.__post_init__" }],
  },
  {
    step: "6", title: "Exact solution: MILP with HiGHS", script: "src/optimizer.py",
    input: "R, C, W, allowed, limits",
    output: "optimal plan Z*, LP bound and shadow prices",
    points: [
      <>Variables: one binary <code>x[i,k]</code> per allowed pair plus <code>y</code> (law firm hired). Each <code>add(…)</code> is one constraint row: one strategy per account, budget, call hours, field visits, hard-collection cap, <code>x[i,legal] ≤ y</code>, and <code>L·y ≤ Σ x[i,legal]</code>.</>,
      <><code>scipy.optimize.milp</code> (HiGHS branch-and-cut) returns the proven optimum. Solving the same model without integrality gives the LP bound and the shadow price of each resource.</>,
      <>The Greedy baseline and a hand-written Branch &amp; Bound are in the same file for comparison.</>,
    ],
    code: [{ id: "build_lp", label: "build_lp" }, { id: "solve_milp", label: "solve_milp" }, { id: "lp_relax", label: "lp_relaxation" }, { id: "greedy", label: "greedy" }],
  },
  {
    step: "7", title: "Meta-heuristics: Genetic Algorithm and Simulated Annealing", script: "src/optimizer.py",
    input: "the same instance",
    output: "best plan + convergence history per run",
    points: [
      <>A plan is a list of N strategy numbers (only allowed values), so “one strategy per account” always holds.</>,
      <>Broken limits are punished: <code>fitness = objective − 100,000 × violation</code>, where <code>violation()</code> measures how far each limit is exceeded.</>,
      <><b>GA:</b> 120 plans × 400 generations, keep the best 2, pick parents by tournament of 3, uniform crossover (p = 0.9), random mutation (1.5/N per gene).</>,
      <><b>SA:</b> 60,000 steps, change one account (sometimes swap two), always accept better plans and worse ones with probability <code>e^(Δ/T)</code>; T starts at 10⁶ and cools ×0.99975 per step.</>,
    ],
    code: [{ id: "violation", label: "violation" }, { id: "penalty", label: "penalised" }, { id: "ga", label: "genetic_algorithm" }, { id: "sa", label: "simulated_annealing" }],
  },
  {
    step: "8", title: "Benchmark across cohorts and seeds", script: "src/03b_phase1_benchmark.py",
    input: "accounts_pool.csv",
    output: "phase1_benchmark.json, phase1_summary_table.csv, phase1_seed_runs.csv, docs/fig_p1_*.png",
    points: [
      <><code>make_cfg</code> scales budget, hours, visits and cap with N (“prop”) or keeps the N=30 values (“frozen”); the law-firm contract F and L never scale.</>,
      <>Six cohorts are cut from the pool and every method runs on each; GA and SA run with seeds 0, 1, 2.</>,
      <>A Wilcoxon signed-rank test over the 18 paired GA/SA gaps checks whether SA is really better (p = 0.00035).</>,
      <>The multi-objective Pareto front (max gross recovery, min cost) uses the ε-constraint method on the exact model.</>,
    ],
    code: [{ id: "make_cfg", label: "make_cfg" }, { id: "cohorts", label: "cohorts" }, { id: "wilcoxon", label: "Wilcoxon" }, { id: "pareto", label: "pareto_front" }],
  },
];

const PROVENANCE: { field: string; origin: Kind | "assumption"; from: string }[] = [
  { field: "grade, sub_grade, int_rate, term_m, dti", origin: "data", from: "LendingClub columns, unchanged" },
  { field: "balance_thb", origin: "data", from: "LendingClub EAD (funded_amnt − total_rec_prncp) × 33, rounded to ฿100" },
  { field: "annual_inc_thb", origin: "data", from: "LendingClub annual_inc × 33" },
  { field: "hist_recoveries_usd, ead_usd", origin: "data", from: "LendingClub recoveries and computed EAD, kept for reference" },
  { field: "p_pay", origin: "model", from: "Classifier: probability of recovering anything" },
  { field: "rate_if_pay", origin: "model", from: "Regressor: recovery rate given some recovery" },
  { field: "rho (ρᵢ)", origin: "model", from: "p_pay × rate_if_pay × DPD decay" },
  { field: "dpd", origin: "synthetic", from: "Random draw (seed 613) — not in LendingClub" },
  { field: "reachable", origin: "synthetic", from: "Random draw (seed 613), lower for risky grades" },
  { field: "strategy lifts λₖ, costs, commissions", origin: "assumption", from: "Planning assumptions (editable in the simulator)" },
  { field: "budget, call hours, visits, caps, retainer", origin: "assumption", from: "Scenario limits for a mid-size Thai lender (editable)" },
];
const ORIGIN_STYLE: Record<string, string> = { data: "var(--s2)", model: "var(--s4)", synthetic: "var(--s3)", assumption: "var(--s0)", opt: "var(--s5)" };
const ORIGIN_TEXT: Record<string, string> = { data: "real (LendingClub)", model: "ML prediction", synthetic: "synthetic", assumption: "assumption" };

export function PipelineTab() {
  const a = accounts[0];
  const I = buildInstance(DEFAULT_CONFIG, STRATEGIES);
  const decay = Math.exp(-0.004 * (a.dpd - 30));
  const rawRho = a.p_pay * a.rate_if_pay * decay;
  return (
    <div className="stack">
      <div className="card">
        <h2>Where the data comes from</h2>
        <p style={{ margin: "0 0 4px" }}>
          The accounts are <b>real defaulted consumer loans</b> from the public{" "}
          <a href={KAGGLE} target="_blank" rel="noreferrer">LendingClub loan dataset on Kaggle</a> (US peer-to-peer lender, loans issued 2007–2018).
          We keep only loans that defaulted, learn from them how much money is typically recovered, and turn a sample of them into a baht-denominated
          collection portfolio for a Thai lender.
        </p>
        <div className="flow" aria-label="Data pipeline">
          {FLOW.map((f, i) => (
            <div className="flow-step" key={f.title}>
              <div className={`flow-box ${f.kind}`}>
                <span className="flow-kind">{KIND_LABEL[f.kind]}</span>
                <b>{f.title}</b>
                <span className="mono">{f.count}</span>
                <small>{f.sub}</small>
              </div>
              {i < FLOW.length - 1 && <span className="flow-arrow" aria-hidden>→</span>}
            </div>
          ))}
        </div>
      </div>

      <h2 className="section-title">Pipeline, step by step — with the actual Python code</h2>
      <p className="note" style={{ marginTop: -4 }}>Each code panel is copied verbatim from the repository (file and line numbers shown) by <code>npm run sync-data</code>, so it always matches the code that produced the results.</p>
      <div className="stages">
        {STAGES.map((s) => (
          <div className="card stage" key={s.step}>
            <div className="stage-text">
              <div className="stage-head">
                <span className="stage-num">{s.step}</span>
                <div>
                  <h3 style={{ margin: 0 }}>{s.title}</h3>
                  <code>{s.script}</code>
                </div>
              </div>
              <ul>{s.points.map((p, i) => <li key={i}>{p}</li>)}</ul>
              <p className="note"><b>In:</b> {s.input}<br /><b>Out:</b> {s.output}</p>
            </div>
            <CodeTabs items={s.code} />
          </div>
        ))}
      </div>

      <div className="grid2">
        <div className="card">
          <h2>What is real and what is assumed</h2>
          <div className="scroll">
            <table className="wrap">
              <thead><tr><th>Field</th><th>Origin</th><th>How it is produced</th></tr></thead>
              <tbody>
                {PROVENANCE.map((p) => (
                  <tr key={p.field}>
                    <td><code>{p.field}</code></td>
                    <td style={{ whiteSpace: "nowrap" }}><span className="chip" style={{ background: ORIGIN_STYLE[p.origin] }}>{ORIGIN_TEXT[p.origin]}</span></td>
                    <td>{p.from}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card">
          <h2>Worked example: {a.account_id}</h2>
          <table>
            <tbody>
              <tr><td>LendingClub loan</td><td className="num">grade {a.sub_grade} · {a.int_rate}% · {a.term_m} months</td></tr>
              <tr><td>Exposure at default (EAD)</td><td className="num">${a.ead_usd.toLocaleString("en-US")}</td></tr>
              <tr><td>Balance = EAD × {modelReport.fx_thb_per_usd}, rounded</td><td className="num">{thb(a.balance_thb)}</td></tr>
              <tr><td>P(pay anything) — classifier</td><td className="num">{a.p_pay.toFixed(3)}</td></tr>
              <tr><td>Rate if they pay — regressor</td><td className="num">{a.rate_if_pay.toFixed(3)}</td></tr>
              <tr><td>DPD {a.dpd} → decay e^(−0.004·{a.dpd - 30})</td><td className="num">{decay.toFixed(3)}</td></tr>
              <tr><td><b>ρ = {a.p_pay.toFixed(3)} × {a.rate_if_pay.toFixed(3)} × {decay.toFixed(3)}</b></td><td className="num"><b>{rawRho.toFixed(3)}</b></td></tr>
              <tr><td>Phone reachable (synthetic)</td><td className="num">{a.reachable ? "yes" : "no"}</td></tr>
            </tbody>
          </table>
          <h3 style={{ marginTop: 14 }}>Value of each strategy for this account (vᵢₖ)</h3>
          <div className="scroll">
            <table>
              <thead><tr><th>Strategy</th><th className="num">rate</th><th className="num">E[recovery]</th><th className="num">cost</th><th className="num">net value</th></tr></thead>
              <tbody>
                {STRATEGIES.map((s, k) => (
                  <tr key={s.key}>
                    <td><span className="dot" style={{ background: sColor(k) }} />{s.key} <span className="note">×{s.lift}</span></td>
                    <td className="num">{pct((I.R[0][k] / a.balance_thb) * 100)}</td>
                    <td className="num">{thb(I.R[0][k])}</td>
                    <td className="num">{thb(I.C[0][k])}</td>
                    <td className="num">{I.allowed[0][k] ? thb(I.V[0][k]) : "not allowed"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="note">These values are what the optimizer chooses between. Legal is worth the most for this account on its own, but the optimum still gives it a call: visits, the agency + legal cap and the budget are shared, so they go where they add the most in total.</p>
        </div>
      </div>

      <div className="card">
        <h2>Reproduce the data</h2>
        <pre><code>{`# 1. download loan.csv from Kaggle into archive-2/
python src/01_explore.py            # -> data/defaulted_raw.csv.gz
python src/02_model_and_dataset.py  # -> data/accounts_pool.csv, accounts_N30.csv, model_report.json
python src/03_run_experiments.py    # -> data/results_N30.json, optimal_assignment_N30.csv, docs/fig_*.png
python src/03b_phase1_benchmark.py  # -> data/phase1_*.json/csv, docs/fig_p1_*.png
cd web && npm run sync-data         # copy the results into this website`}</code></pre>
        <p className="note">Every file the site uses is downloadable from <code>/api/data</code> (JSON, or CSV for tables).</p>
      </div>
    </div>
  );
}
