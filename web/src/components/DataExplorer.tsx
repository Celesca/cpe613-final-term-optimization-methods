"use client";
import type { ChartConfiguration } from "chart.js";
import { useCallback, useEffect, useMemo, useState } from "react";
import accounts from "@/data/accounts.json";
import modelReport from "@/data/model_report.json";
import optimalN30 from "@/data/optimal_assignment_n30.json";
import phase1 from "@/data/phase1_benchmark.json";
import seedRuns from "@/data/phase1_seed_runs.json";
import summary from "@/data/phase1_summary.json";
import resultsN30 from "@/data/results_n30.json";
import { STRATEGY_KEYS, int, kThb, pct, sColor, secs, thb } from "@/lib/format";
import { DataTable } from "./DataTable";
import { ChartCanvas, type ThemeColors } from "./LineChart";
import { PipelineTab } from "./PipelineTab";

const TABS = ["Source & pipeline", "Accounts", "ML recovery model", "Report instance N=30", "Phase I benchmarks", "Figures"] as const;
type Tab = (typeof TABS)[number];
const HASH: Record<Tab, string> = {
  "Source & pipeline": "pipeline", Accounts: "accounts", "ML recovery model": "model",
  "Report instance N=30": "n30", "Phase I benchmarks": "phase1", Figures: "figures",
};
const tabFromHash = (): Tab | undefined => {
  const h = typeof window === "undefined" ? "" : window.location.hash.slice(1);
  return TABS.find((t) => HASH[t] === h);
};

export function DataExplorer() {
  const [tab, setTab] = useState<Tab>("Source & pipeline");
  // Deep links like /data#phase1 select a tab; tab clicks update the hash.
  useEffect(() => {
    const sync = () => { const t = tabFromHash(); if (t) setTab(t); };
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);
  const select = (t: Tab) => { setTab(t); history.replaceState(null, "", `#${HASH[t]}`); };
  return (
    <>
      <div className="tabs" role="tablist">
        {TABS.map((t) => <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? "active" : ""} onClick={() => select(t)}>{t}</button>)}
      </div>
      {tab === "Source & pipeline" && <PipelineTab />}
      {tab === "Accounts" && <Accounts />}
      {tab === "ML recovery model" && <Model />}
      {tab === "Report instance N=30" && <ReportN30 />}
      {tab === "Phase I benchmarks" && <Phase1 />}
      {tab === "Figures" && <Figures />}
    </>
  );
}

/* ---------------------------------------------------------------- accounts */
type Acc = (typeof accounts)[number];

function Accounts() {
  const [q, setQ] = useState("");
  const [grade, setGrade] = useState("all");
  const [dpd, setDpd] = useState("all");
  const [reach, setReach] = useState("all");
  const [scope, setScope] = useState("300");
  const rows = useMemo(() => accounts.slice(0, +scope).filter((a) =>
    (grade === "all" || a.grade === grade) && (dpd === "all" || a.dpd === +dpd) &&
    (reach === "all" || a.reachable === +reach) && (!q || a.account_id.toLowerCase().includes(q.toLowerCase()))), [q, grade, dpd, reach, scope]);
  const total = rows.reduce((s, a) => s + a.balance_thb, 0);
  const meanRho = rows.length ? rows.reduce((s, a) => s + a.rho, 0) / rows.length : 0;
  const dpds = [...new Set(accounts.map((a) => a.dpd))].sort((a, b) => a - b);
  return (
    <div className="stack">
      <p className="note" style={{ marginTop: 0 }}>
        The 300-account pool sampled from 260,640 defaulted LendingClub loans, converted to THB (×{modelReport.fx_thb_per_usd}).
        ρ<sub>i</sub> = P(pay) × E[rate | pay] is the ML base recovery rate. <b>DPD</b> and <b>phone reachable</b> are synthetic (LendingClub has no such columns).
        Highlighted rows are the N=30 report instance (TH0001–TH0030).
      </p>
      <div className="kpis">
        <div className="kpi"><span>Accounts shown</span><b>{rows.length}</b><em>of {accounts.length}</em></div>
        <div className="kpi"><span>Outstanding</span><b>{thb(total)}</b><em>sum of balances</em></div>
        <div className="kpi"><span>Mean ρ<sub>i</sub></span><b>{pct(meanRho * 100)}</b><em>base expected recovery</em></div>
        <div className="kpi"><span>Unreachable</span><b>{rows.filter((a) => !a.reachable).length}</b><em>SMS / call at 40% effect</em></div>
      </div>
      <div className="card">
        <div className="filters">
          <label>Search ID<input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="TH0001" /></label>
          <label>Scope<select value={scope} onChange={(e) => setScope(e.target.value)}><option value="30">N = 30</option><option value="100">N = 100</option><option value="300">All 300</option></select></label>
          <label>Grade<select value={grade} onChange={(e) => setGrade(e.target.value)}><option value="all">All</option>{"ABCDEFG".split("").map((g) => <option key={g}>{g}</option>)}</select></label>
          <label>DPD<select value={dpd} onChange={(e) => setDpd(e.target.value)}><option value="all">All</option>{dpds.map((d) => <option key={d} value={d}>{d}</option>)}</select></label>
          <label>Phone<select value={reach} onChange={(e) => setReach(e.target.value)}><option value="all">All</option><option value="1">Reachable</option><option value="0">Unreachable</option></select></label>
          <a href="/api/data/accounts?format=csv" download style={{ marginLeft: "auto", fontSize: 13 }}>Download CSV</a>
        </div>
        <DataTable<Acc> tall rows={rows} highlight={(a) => +a.account_id.slice(2) <= 30} columns={[
          { key: "account_id", label: "Account", render: (a) => <span className="mono">{a.account_id}</span> },
          { key: "sub_grade", label: "Grade" },
          { key: "int_rate", label: "Rate %", num: true, render: (a) => a.int_rate.toFixed(2) },
          { key: "term_m", label: "Term", num: true, render: (a) => a.term_m + "m" },
          { key: "dpd", label: "DPD", num: true, render: (a) => a.dpd },
          { key: "reachable", label: "Phone", render: (a) => (a.reachable ? "yes" : <span className="bad">no</span>) },
          { key: "balance_thb", label: "Balance", num: true, render: (a) => thb(a.balance_thb) },
          { key: "annual_inc_thb", label: "Income / yr", num: true, render: (a) => thb(a.annual_inc_thb) },
          { key: "dti", label: "DTI", num: true, render: (a) => a.dti.toFixed(1) },
          { key: "p_pay", label: "P(pay)", num: true, render: (a) => pct(a.p_pay * 100) },
          { key: "rate_if_pay", label: "Rate | pay", num: true, render: (a) => pct(a.rate_if_pay * 100) },
          { key: "rho", label: <>ρ<sub>i</sub></>, num: true, render: (a) => pct(a.rho * 100) },
          { key: "hist_recoveries_usd", label: "Hist. recov. $", num: true, render: (a) => int(a.hist_recoveries_usd) },
        ]} />
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- ML model */
function Model() {
  const m = modelReport;
  const build = useCallback((t: ThemeColors): ChartConfiguration => ({
    type: "bar",
    data: {
      labels: m.grade_profile.map((g) => g.grade),
      datasets: [
        { label: "P(any recovery)", data: m.grade_profile.map((g) => g.p_recovered * 100), backgroundColor: t.s[2] },
        { label: "Mean recovery rate", data: m.grade_profile.map((g) => g.mean_rate * 100), backgroundColor: t.s[4] },
      ],
    },
    options: { maintainAspectRatio: false, animation: false, scales: { y: { title: { display: true, text: "%" } } }, plugins: { legend: { labels: { boxWidth: 12 } } } },
  }), [m]);
  return (
    <div className="stack">
      <div className="kpis">
        <div className="kpi"><span>Defaulted loans used</span><b>{int(m.n_defaulted_used)}</b><em>LendingClub charged-off / default</em></div>
        <div className="kpi"><span>Classifier AUC</span><b>{m.classifier_auc}</b><em>vs {m.classifier_auc_grade_only} grade-only</em></div>
        <div className="kpi"><span>Brier score</span><b>{m.classifier_brier}</b><em>P(any recovery)</em></div>
        <div className="kpi"><span>Rate MAE</span><b>{pct(m.expected_rate_mae_all * 100, 2)}</b><em>expected rate, all accounts</em></div>
        <div className="kpi"><span>Mean rate</span><b>{pct(m.mean_actual_rate * 100, 2)}</b><em>actual = predicted {pct(m.mean_predicted_rate * 100, 2)}</em></div>
      </div>
      <div className="grid2">
        <div className="card">
          <h2>Recovery by grade (full defaulted set)</h2>
          <ChartCanvas build={build} />
          <p className="note">Grade alone barely separates outcomes — which is why the model uses it as an input, not the target.</p>
        </div>
        <div className="card">
          <h2>Grade profile</h2>
          <DataTable rows={m.grade_profile.map((g) => ({ ...g, pool: m.pool_grade_counts[g.grade as keyof typeof m.pool_grade_counts] }))} columns={[
            { key: "grade", label: "Grade" },
            { key: "n", label: "Loans", num: true, render: (g) => int(g.n) },
            { key: "mean_ead_thb", label: "Mean EAD", num: true, render: (g) => thb(g.mean_ead_thb) },
            { key: "p_recovered", label: "P(recovered)", num: true, render: (g) => pct(g.p_recovered * 100) },
            { key: "mean_rate", label: "Mean rate", num: true, render: (g) => pct(g.mean_rate * 100, 2) },
            { key: "pool", label: "In 300 pool", num: true, render: (g) => g.pool },
          ]} />
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- report N=30 */
function ReportN30() {
  const r = resultsN30;
  const opt = r.exact.objective;
  const metaRow = (name: string, runs: { objective: number; feasible: boolean; time: number }[]) => {
    const objs = runs.map((x) => x.objective), best = Math.max(...objs), mean = objs.reduce((s, v) => s + v, 0) / objs.length;
    return { method: `${name} (${runs.length} seeds)`, objective: best, cost: null as number | null, gap: (1 - mean / opt) * 100, time: runs.reduce((s, x) => s + x.time, 0) / runs.length, note: `best; mean ${thb(mean)}` };
  };
  const methods = [
    { method: r.exact.method, objective: r.exact.objective, cost: r.exact.cost as number | null, gap: 0, time: r.exact.time, note: r.exact.status.replace(/^.*\((.*)\).*$/, "$1") },
    { method: r.bnb.method, objective: r.bnb.objective, cost: r.bnb.cost, gap: (1 - r.bnb.objective / opt) * 100, time: r.bnb.time, note: `${int(r.bnb.log.nodes)} nodes, proved optimal: ${r.bnb.log.proved_optimal}` },
    { method: r.dp.method, objective: r.dp.objective, cost: r.dp.cost, gap: (1 - r.dp.objective / opt) * 100, time: r.dp.time, note: `upper bound; feasible for full model: ${r.dp.feasible_full}` },
    { method: r.greedy.method, objective: r.greedy.objective, cost: r.greedy.cost, gap: (1 - r.greedy.objective / opt) * 100, time: r.greedy.time, note: "never engages the law firm" },
    metaRow("Genetic Algorithm", r.meta.GA),
    metaRow("Simulated Annealing", r.meta.SA),
  ];
  const build = useCallback((t: ThemeColors): ChartConfiguration => ({
    type: "line",
    data: { datasets: [
      { label: "Gross recovery f₁", data: r.pareto.map((p) => ({ x: p.cost, y: p.gross })), borderColor: t.s[2], backgroundColor: t.s[2], pointRadius: 3 },
      { label: "Net", data: r.pareto.map((p) => ({ x: p.cost, y: p.net })), borderColor: t.s[4], backgroundColor: t.s[4], borderDash: [5, 3], pointRadius: 2 },
    ] },
    options: { maintainAspectRatio: false, animation: false, parsing: false,
      scales: { x: { type: "linear", title: { display: true, text: "f₂ cost (฿)" }, ticks: { callback: (v) => int(+v / 1000) + "k" } }, y: { ticks: { callback: (v) => kThb(+v) } } },
      plugins: { legend: { labels: { boxWidth: 12 } } } },
  }), [r]);
  return (
    <div className="stack">
      <p className="note" style={{ marginTop: 0 }}>Results computed by the Python pipeline (<code>src/03_run_experiments.py</code>) — the numbers used in the report. Search space Π|K<sub>i</sub>| = {r.size.size.toExponential(2)} (unrestricted 6<sup>30</sup> = {r.size.unrestricted.toExponential(2)}).</p>
      <div className="card">
        <h2>All methods, single objective</h2>
        <DataTable rows={methods} columns={[
          { key: "method", label: "Method" },
          { key: "objective", label: "Objective", num: true, render: (m) => thb(m.objective) },
          { key: "cost", label: "Cost", num: true, render: (m) => (m.cost === null ? "—" : thb(m.cost)) },
          { key: "gap", label: "Gap (mean)", num: true, render: (m) => pct(m.gap, 2) },
          { key: "time", label: "Time", num: true, render: (m) => secs(m.time) },
          { key: "note", label: "Note" },
        ]} />
      </div>
      <div className="grid2">
        <div className="card">
          <h2>Should we buy more resources?</h2>
          <DataTable rows={Object.entries(r.marginal).map(([k, v]) => ({ k, step: v.step, gain: v.gain, shadow: r.lp.shadow[k as keyof typeof r.lp.shadow] }))} columns={[
            { key: "k", label: "Resource" },
            { key: "step", label: "+1 step", num: true, render: (x) => x.step },
            { key: "gain", label: "MILP gain", num: true, render: (x) => thb(x.gain) },
            { key: "shadow", label: "LP shadow price", num: true, render: (x) => (x.k === "budget" ? x.shadow.toFixed(3) + " /฿" : thb(x.shadow)) },
          ]} />
          <p className="note">LP bound {thb(r.lp.bound)} with {r.lp.fractional} fractional variables. Buy a resource when its marginal gain exceeds its price.</p>
        </div>
        <div className="card">
          <h2>Pareto front (ε-constraint, {r.pareto.length} points)</h2>
          <ChartCanvas build={build} />
        </div>
      </div>
      <div className="card">
        <h2>Optimal assignment (exact MILP)</h2>
        <DataTable tall rows={optimalN30} columns={[
          { key: "account_id", label: "Account", render: (a) => <span className="mono">{a.account_id}</span> },
          { key: "grade", label: "Grade" },
          { key: "dpd", label: "DPD", num: true, render: (a) => a.dpd },
          { key: "reachable", label: "Phone", render: (a) => (a.reachable ? "yes" : <span className="bad">no</span>) },
          { key: "balance_thb", label: "Balance", num: true, render: (a) => thb(a.balance_thb) },
          { key: "rho", label: "ρ", num: true, render: (a) => pct(a.rho * 100) },
          { key: "strategy", label: "Strategy" },
          { key: "exp_recovery_thb", label: "E[recovery]", num: true, render: (a) => thb(a.exp_recovery_thb) },
          { key: "cost_thb", label: "Cost", num: true, render: (a) => thb(a.cost_thb) },
        ]} />
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- phase I */
type Cohort = keyof typeof phase1.results;

function Phase1() {
  const cohorts = Object.keys(phase1.results) as Cohort[];
  const [cohort, setCohort] = useState<Cohort>("N30_main");
  const ps = phase1.pooled_stats, ab = phase1.ablation_sa_T0.T0_20k_stats;
  const R = phase1.results[cohort];
  const build = useCallback((t: ThemeColors): ChartConfiguration => {
    const line = (h: number[], color: string, label: string, dash?: number[]) => ({
      label, data: h.map((v, i) => ({ x: (i / (h.length - 1)) * 100, y: v })), borderColor: color, pointRadius: 0, borderWidth: 1.6, borderDash: dash,
    });
    const opt = R.exact_milp.objective;
    const ds = [
      ...R.ga_runs.map((run, i) => line(run.history, t.s[2], `GA seed ${run.seed ?? i}`)),
      ...R.sa_runs.map((run, i) => line(run.history, t.s[4], `SA seed ${run.seed ?? i}`)),
      { label: "MILP optimum", data: [{ x: 0, y: opt }, { x: 100, y: opt }], borderColor: t.ink, borderDash: [4, 4], pointRadius: 0, borderWidth: 1 },
    ];
    return { type: "line", data: { datasets: ds }, options: { maintainAspectRatio: false, animation: false, parsing: false,
      scales: { x: { type: "linear", max: 100, title: { display: true, text: "% of run" } }, y: { min: opt * 0.85, ticks: { callback: (v) => kThb(+v) } } },
      plugins: { legend: { labels: { boxWidth: 10, font: { size: 11 } } } } } };
  }, [R]);
  return (
    <div className="stack">
      <div className="kpis">
        <div className="kpi"><span>Paired GA/SA runs</span><b>{ps.n_paired_runs}</b><em>6 cohorts × seeds 0, 1, 2</em></div>
        <div className="kpi"><span>GA mean gap</span><b>{pct(ps.ga_mean_gap_pct, 3)}</b><em>to MILP optimum</em></div>
        <div className="kpi"><span>SA mean gap</span><b>{pct(ps.sa_mean_gap_pct, 3)}</b><em>to MILP optimum</em></div>
        <div className="kpi"><span>Wilcoxon p-value</span><b>{ps.wilcoxon_p_value.toFixed(5)}</b><em>SA better than GA (two-sided)</em></div>
      </div>
      <div className="card">
        <h2>Summary across cohorts</h2>
        <DataTable rows={summary} columns={[
          { key: "instance", label: "Cohort", render: (s) => <span className="mono">{s.instance}</span> },
          { key: "N", label: "N", num: true, render: (s) => s.N },
          { key: "vars", label: "Vars / cons", num: true, render: (s) => `${s.vars} / ${s.constraints}` },
          { key: "log10_space", label: "log₁₀ space", num: true, render: (s) => s.log10_space.toFixed(1) },
          { key: "milp_opt", label: "MILP Z*", num: true, render: (s) => thb(s.milp_opt) },
          { key: "milp_time_s", label: "MILP time", num: true, render: (s) => secs(s.milp_time_s) },
          { key: "lp_igap_pct", label: "Root LP gap", num: true, render: (s) => pct(s.lp_igap_pct, 3) },
          { key: "greedy_gap_pct", label: "Greedy gap", num: true, render: (s) => pct(s.greedy_gap_pct, 2) },
          { key: "ga_gap_mean_pct", label: "GA gap", num: true, render: (s) => pct(s.ga_gap_mean_pct, 3) },
          { key: "ga_time_s", label: "GA time", num: true, render: (s) => secs(s.ga_time_s) },
          { key: "sa_gap_mean_pct", label: "SA gap", num: true, render: (s) => pct(s.sa_gap_mean_pct, 3) },
          { key: "sa_time_s", label: "SA time", num: true, render: (s) => secs(s.sa_time_s) },
        ]} />
        <p className="note"><code>_prop</code>: capacities scaled with N (law-firm terms F, L fixed). <code>_frozen</code>: N=30 capacities kept — scarcity pushes the optimum toward SMS/LINE. Times are Python on a laptop.</p>
      </div>
      <div className="card">
        <div className="filters" style={{ justifyContent: "space-between" }}>
          <h2 style={{ margin: 0 }}>GA vs SA convergence</h2>
          <label>Cohort<select value={cohort} onChange={(e) => setCohort(e.target.value as Cohort)}>{cohorts.map((c) => <option key={c}>{c}</option>)}</select></label>
        </div>
        <ChartCanvas build={build} height={320} />
        <p className="note">Best penalised fitness per run (blue = GA, orange = SA, dashed = exact optimum).</p>
      </div>
      <div className="grid2">
        <div className="card">
          <h2>SA ablation: initial temperature</h2>
          <DataTable rows={[
            { cfg: "T₀ = 20,000", mean: ab.mean, gap: ab.gap_mean_pct, law: `${ab.law_firm_active_count} / ${ab.n_runs}` },
            { cfg: "T₀ = 1,000,000", mean: phase1.results.N30_main.sa_stats.mean, gap: phase1.results.N30_main.sa_stats.gap_mean_pct, law: `${phase1.results.N30_main.sa_stats.law_firm_active_count} / ${phase1.results.N30_main.sa_stats.n_runs}` },
          ]} columns={[
            { key: "cfg", label: "Configuration" },
            { key: "mean", label: "Mean net", num: true, render: (x) => thb(x.mean) },
            { key: "gap", label: "Gap", num: true, render: (x) => pct(x.gap, 2) },
            { key: "law", label: "Law firm used" },
          ]} />
          <p className="note">Too cold and SA can never cross the ฿40,000 retainer + 3-case barrier, so it freezes without legal action.</p>
        </div>
        <div className="card">
          <h2>Every stochastic run</h2>
          <DataTable tall rows={seedRuns} columns={[
            { key: "instance", label: "Cohort", render: (s) => <span className="mono">{s.instance}</span> },
            { key: "algorithm", label: "Alg." },
            { key: "seed", label: "Seed", num: true, render: (s) => s.seed },
            { key: "objective", label: "Objective", num: true, render: (s) => thb(s.objective) },
            { key: "gap_pct", label: "Gap", num: true, render: (s) => pct(s.gap_pct, 3) },
            { key: "legal_cases", label: "Legal", num: true, render: (s) => s.legal_cases },
            { key: "time_s", label: "Time", num: true, render: (s) => secs(s.time_s) },
          ]} />
          <a href="/api/data/phase1-seed-runs?format=csv" download className="note" style={{ display: "inline-block" }}>Download CSV</a>
        </div>
      </div>
      <div className="card">
        <h2>Strategy mix of the optimum per cohort</h2>
        <DataTable rows={cohorts.map((c) => ({ c, ...phase1.results[c].exact_milp.mix, n: phase1.results[c].dimensions.accounts }))} columns={[
          { key: "c", label: "Cohort", render: (x) => <span className="mono">{x.c}</span> },
          ...STRATEGY_KEYS.map((k, i) => ({ key: k, label: <><span className="dot" style={{ background: sColor(i) }} />{k}</>, num: true,
            render: (x: Record<string, number | string>) => `${x[k]} (${pct((+x[k] / +x.n) * 100, 0)})` })),
        ]} />
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- figures */
const FIGS = [
  ["fig_convergence.png", "GA vs SA convergence (N=30)"],
  ["fig_mix.png", "Strategy mix by method"],
  ["fig_pareto.png", "Pareto front, gross recovery vs cost"],
  ["fig_p1_scaling_gap.png", "Phase I: gap to optimum vs N"],
  ["fig_p1_scaling_time.png", "Phase I: runtime vs N"],
  ["fig_p1_strategy_mix_scales.png", "Phase I: optimal strategy mix by cohort"],
  ["fig_p1_convergence_ablation.png", "Phase I: SA T₀ ablation"],
];
function Figures() {
  return (
    <div className="figs">
      {FIGS.map(([f, cap]) => (
        <figure key={f}>
          <a href={`/figures/${f}`} target="_blank" rel="noreferrer">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/figures/${f}`} alt={cap} loading="lazy" />
          </a>
          <figcaption>{cap} · <code>docs/{f}</code></figcaption>
        </figure>
      ))}
    </div>
  );
}
