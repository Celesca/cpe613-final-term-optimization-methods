"use client";
// "Source & pipeline" tab: where the data comes from and how each script transforms it.
// Numbers come from src/01_explore.py, src/02_model_and_dataset.py, data/model_report.json and the Phase I report.
import accounts from "@/data/accounts.json";
import modelReport from "@/data/model_report.json";
import { int, pct, sColor, thb } from "@/lib/format";
import { DEFAULT_CONFIG, STRATEGIES, buildInstance } from "@/lib/optimizer/model";

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

const STAGES: { step: string; title: string; script: string; input: string; output: string; points: React.ReactNode[] }[] = [
  {
    step: "1", title: "Extract defaulted loans", script: "src/01_explore.py",
    input: "archive-2/loan.csv (LendingClub, 2007–2018, 2.26 M loans × 145 columns)",
    output: "data/defaulted_raw.csv.gz (36 columns kept)",
    points: [
      <>Reads the file in 300,000-row chunks and keeps loans whose <code>loan_status</code> is <b>Charged Off</b>, <b>Default</b> or <b>Does not meet the credit policy. Status: Charged Off</b> → 262,447 loans.</>,
      <>Defines exposure at default <code>EAD = funded_amnt − total_rec_prncp</code> and the historical recovery rate <code>recoveries / EAD</code>.</>,
      <>Profiles recovery by grade: on average only ≈ {pct(modelReport.mean_actual_rate * 100)} of the exposure was ever recovered, and the rate barely changes from grade A to G.</>,
    ],
  },
  {
    step: "2", title: "Learn the recovery rate ρᵢ (two-part hurdle model)", script: "src/02_model_and_dataset.py",
    input: "data/defaulted_raw.csv.gz",
    output: "classifier + regressor (in memory), data/model_report.json",
    points: [
      <>Drops tiny exposures (EAD ≤ $500) → <b>{int(modelReport.n_defaulted_used)}</b> loans. Splits 75% train / 25% test (seed 613).</>,
      <><b>Part 1 – will they pay anything?</b> <code>HistGradientBoostingClassifier</code> predicts P(recoveries &gt; 0). Test AUC <b>{modelReport.classifier_auc}</b> vs {modelReport.classifier_auc_grade_only} using grade alone; Brier {modelReport.classifier_brier}.</>,
      <><b>Part 2 – how much, if they pay?</b> <code>HistGradientBoostingRegressor</code> trained only on loans that recovered something predicts the recovery rate (MAE {pct(modelReport.rate_mae_given_recovered * 100, 2)}).</>,
      <>24 input features known before collection starts — grade, sub-grade, interest rate, term, instalment, income, DTI, employment length, revolving balance &amp; utilisation, open/total accounts, inquiries, past delinquencies, public records, bankruptcies, mortgages, EAD, share of principal repaid, late fees, issue year, home ownership, verification status, purpose. <b>No leakage:</b> <code>recoveries</code>, <code>collection_recovery_fee</code> and <code>total_pymnt</code> are never used as inputs.</>,
      <>Calibration check: mean predicted rate {pct(modelReport.mean_predicted_rate * 100, 2)} = mean actual rate {pct(modelReport.mean_actual_rate * 100, 2)}.</>,
    ],
  },
  {
    step: "3", title: "Build the Thai collection portfolio", script: "src/02_model_and_dataset.py",
    input: "defaulted loans + the two fitted models",
    output: "data/accounts_pool.csv (300 accounts), data/accounts_N30.csv",
    points: [
      <>Stratified sample by grade: A 25 · B 50 · C 75 · D 65 · E 45 · F 25 · G 15 = 300 accounts, then shuffled and renamed <code>TH0001…TH0300</code>.</>,
      <>Converts USD to baht at <b>{modelReport.fx_thb_per_usd} THB/USD</b>: <code>balance_thb = EAD × 33</code> rounded to ฿100.</>,
      <><b>Synthetic fields</b> (LendingClub has no collection-stage data): days past due <code>dpd</code> ∈ {"{30, 60, 90, 120, 180}"} with probabilities {"{0.30, 0.25, 0.20, 0.15, 0.10}"}; phone <code>reachable</code> with probability 0.85 (0.70 for grades E–G). Random seed 613, so the dataset is reproducible.</>,
      <>Base recovery rate: <code>ρᵢ = P(pay) × E[rate | pay] × e^(−0.004·(dpd − 30))</code>, clipped to [0.01, 0.60] — older debts are harder to collect.</>,
    ],
  },
  {
    step: "4", title: "Optimize and benchmark", script: "src/optimizer.py · 03_run_experiments.py · 03b_phase1_benchmark.py",
    input: "accounts_pool.csv + strategy table + resource limits",
    output: "results_N30.json, optimal_assignment_N30.csv, phase1_*.csv/json, docs/fig_*.png",
    points: [
      <>Each strategy multiplies ρᵢ by a lift λₖ; value of strategy k for account i is <code>vᵢₖ = Bᵢ·min(0.9, ρᵢλₖ)·(1 − commission) − cost</code>.</>,
      <>Cohorts: <b>N30_main</b> = TH0001–0030 (the report instance), <b>N30_unseenB</b> = TH0031–0060, <b>N100</b> = first 100, <b>N300</b> = all 300.</>,
      <>This website runs the same model on the server (TypeScript port, tested to match the Python optimum) and reads the result files on the <i>Report instance</i> and <i>Phase I</i> tabs.</>,
    ],
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

      <h2 className="section-title">Pipeline, step by step</h2>
      <div className="stages">
        {STAGES.map((s) => (
          <div className="card stage" key={s.step}>
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
