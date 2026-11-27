"use client";
import type { ChartConfiguration } from "chart.js";
import { useCallback, useMemo, useState } from "react";
import { postStream } from "@/lib/client-stream";
import { int, kThb, ms, pct, sColor, thb } from "@/lib/format";
import { GA_DEFAULTS, type GAParams, SA_DEFAULTS, type SAParams } from "@/lib/optimizer/heuristics";
import {
  type AccountPriority, type Config, DEFAULT_CONFIG, PRESETS, STRATEGIES, type Strategy, TH_NAMES, buildInstance, searchSpaceLog10,
} from "@/lib/optimizer/model";
import type { ParetoResponse, RunResponse } from "@/lib/optimizer/types";
import modelReport from "@/data/model_report.json";
import { DataTable } from "./DataTable";
import { ChartCanvas, type ThemeColors } from "./LineChart";

const NUM_FIELDS: { id: keyof Config; label: React.ReactNode; step: number; hint?: string }[] = [
  { id: "n", label: "Accounts N", step: 1, hint: "First N accounts of the 300-account LendingClub pool (N = 30 is the report instance)." },
  { id: "fx", label: "FX rate (THB / USD)", step: 0.1 },
  { id: "budget", label: <>Budget B<sub>max</sub> (฿)</>, step: 5000 },
  { id: "call_hours", label: "Call-center hours H", step: 0.75 },
  { id: "field_slots", label: "Field visits V", step: 1 },
  { id: "hard_cap", label: "Hard-collection cap M", step: 1, hint: "Max accounts sent to agency + legal (customer-conduct policy)." },
  { id: "legal_retainer", label: "Law-firm retainer F (฿)", step: 5000 },
  { id: "legal_min_cases", label: "Min legal cases L", step: 1 },
  { id: "legal_min_balance", label: "Legal min balance (฿)", step: 10000 },
  { id: "must_act_dpd", label: "Must-act DPD ≥", step: 30, hint: "These accounts cannot receive “No action”." },
];

const fresh = () => ({ cfg: { ...DEFAULT_CONFIG }, strategies: STRATEGIES.map((s) => ({ ...s })), ga: { ...GA_DEFAULTS }, sa: { ...SA_DEFAULTS } });

export function Simulator() {
  const [cfg, setCfg] = useState<Config>(fresh().cfg);
  const [strategies, setStrategies] = useState<Strategy[]>(fresh().strategies);
  const [ga, setGa] = useState<GAParams>(fresh().ga);
  const [sa, setSa] = useState<SAParams>(fresh().sa);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState<React.ReactNode>("Solvers run on the server. Press Run optimization.");
  const [run, setRun] = useState<RunResponse | null>(null);
  const [pareto, setPareto] = useState<ParetoResponse | null>(null);

  const facts = useMemo(() => {
    const I = buildInstance(cfg, strategies);
    const bal = I.acc.reduce((s, a) => s + a.balance, 0);
    const rho = I.acc.reduce((s, a) => s + a.rho, 0) / I.n;
    return { n: I.n, bal, rho, log10: searchSpaceLog10(I) };
  }, [cfg, strategies]);

  const setStrat = (k: number, patch: Partial<Strategy>) =>
    setStrategies((ss) => ss.map((s, i) => (i === k ? { ...s, ...patch } : s)));
  const body = () => ({ cfg, strategies, ga, sa });

  async function onRun() {
    setBusy(true); setProgress(0.01); setStatus("Sending model to the server…");
    try {
      const r = await postStream<RunResponse>("/api/solve", body(), (stage, p) => { setStatus(stage); setProgress(p); });
      setRun(r); setProgress(1);
      setStatus(<><span className="ok">Done</span> on the server in {ms(r.totalMs)} · {r.instance.n} accounts · {r.instance.vars} variables / {r.instance.constraints} constraints · search space ≈ 10^{r.instance.log10Space.toFixed(1)}</>);
    } catch (e) {
      setStatus(<span className="bad">{(e as Error).message}</span>);
    } finally { setBusy(false); }
  }
  async function onPareto() {
    setBusy(true); setProgress(0.01); setStatus("Pareto front: solving ε-constraint MILPs on the server…");
    try {
      const r = await postStream<ParetoResponse>("/api/pareto", body(), (stage, p) => { setStatus(stage); setProgress(p); });
      setPareto(r); setProgress(1);
      setStatus(<><span className="ok">Pareto front:</span> {r.points.length} non-dominated points in {ms(r.totalMs)}.</>);
    } catch (e) {
      setStatus(<span className="bad">{(e as Error).message}</span>);
    } finally { setBusy(false); }
  }
  function onReset() {
    const f = fresh();
    setCfg(f.cfg); setStrategies(f.strategies); setGa(f.ga); setSa(f.sa);
  }

  const best = run?.methods.find((m) => m.method === run.best);
  const e = best?.eval;

  return (
    <>
      <header className="pagehead">
        <div>
          <h1>Debt Collection Strategy Optimizer</h1>
          <p>Assign one collection strategy per delinquent account to maximise expected net recovery (THB), subject to budget, staff and policy limits. Exact MILP vs Greedy vs GA vs SA — all solved live on the server.</p>
        </div>
        <div className="facts">
          <div>Accounts<b>{facts.n}</b></div>
          <div>Outstanding<b>{thb(facts.bal)}</b></div>
          <div>Mean ρ<sub>i</sub><b>{pct(facts.rho * 100)}</b></div>
          <div>Search space<b>≈ 10^{facts.log10.toFixed(1)}</b></div>
          <div>Model AUC<b>{modelReport.classifier_auc}</b></div>
        </div>
      </header>

      <main className="layout">
        <aside className="controls">
          <div className="card">
            <h2>Portfolio &amp; constraints</h2>
            {NUM_FIELDS.map((f) => (
              <div className="field" key={f.id}>
                <label htmlFor={f.id}>{f.label}</label>
                <input type="number" id={f.id} step={f.step} value={cfg[f.id] as number}
                  onChange={(ev) => setCfg((c) => ({ ...c, [f.id]: +ev.target.value }))} />
                {f.hint && <small>{f.hint}</small>}
              </div>
            ))}
            <div className="field">
              <label htmlFor="account_priority">Account priority w<sub>i</sub></label>
              <select id="account_priority" value={cfg.account_priority}
                onChange={(ev) => setCfg((c) => ({ ...c, account_priority: ev.target.value as AccountPriority }))}>
                <option value="none">Equal</option>
                <option value="balance">Larger balance first</option>
                <option value="dpd">Older delinquency first</option>
                <option value="grade">Riskier grade first</option>
              </select>
            </div>
          </div>

          <div className="card">
            <h2>Strategies &amp; priority π<sub>k</sub></h2>
            <div className="presets btns" style={{ margin: "0 0 8px" }}>
              <button onClick={() => setStrategies((ss) => ss.map((s, k) => ({ ...s, priority: PRESETS.default[k] })))}>Neutral</button>
              <button onClick={() => setStrategies((ss) => ss.map((s, k) => ({ ...s, priority: PRESETS.friendly[k] })))}>Customer-friendly</button>
              <button onClick={() => setStrategies((ss) => ss.map((s, k) => ({ ...s, priority: PRESETS.aggressive[k] })))}>Aggressive recovery</button>
            </div>
            {strategies.map((s, k) => (
              <div className="strat" key={s.key}>
                <div className="strat-head">
                  <label>
                    <input type="checkbox" checked={s.enabled} onChange={(ev) => setStrat(k, { enabled: ev.target.checked })} />
                    <span className="dot" style={{ background: sColor(k) }} />{s.name}
                  </label>
                  <span className="th">{TH_NAMES[k]}{s.cost_pct ? ` · +${s.cost_pct * 100}% of balance` : ""}{s.hours ? ` · ${s.hours} h/account` : ""}</span>
                </div>
                <div className="strat-grid">
                  <label>Lift<input type="number" step={0.05} value={s.lift} onChange={(ev) => setStrat(k, { lift: +ev.target.value })} /></label>
                  <label>Cost ฿<input type="number" step={25} value={s.cost} onChange={(ev) => setStrat(k, { cost: +ev.target.value })} /></label>
                  <label>Comm.<input type="number" step={0.05} value={s.commission} onChange={(ev) => setStrat(k, { commission: +ev.target.value })} /></label>
                </div>
                <div className="strat-pri">
                  <span>Priority π</span>
                  <input type="range" min={0.5} max={1.5} step={0.05} value={s.priority} onChange={(ev) => setStrat(k, { priority: +ev.target.value })} />
                  <span className="mono">{s.priority.toFixed(2)}</span>
                </div>
              </div>
            ))}
            <p className="note">Lift multiplies the ML base recovery rate ρ<sub>i</sub>. Priority π<sub>k</sub> &gt; 1 favours a strategy in the objective; reported THB figures always use the true values.</p>
          </div>

          <div className="card">
            <details>
              <summary>Meta-heuristic parameters</summary>
              <h3 style={{ marginTop: 8 }}>Genetic Algorithm</h3>
              <ParamField label="Population" value={ga.pop} step={10} onChange={(v) => setGa({ ...ga, pop: v })} />
              <ParamField label="Generations" value={ga.gens} step={50} onChange={(v) => setGa({ ...ga, gens: v })} />
              <ParamField label="Crossover prob. p_c" value={ga.pc} step={0.05} onChange={(v) => setGa({ ...ga, pc: v })} />
              <ParamField label="Seed" value={ga.seed} step={1} onChange={(v) => setGa({ ...ga, seed: v })} />
              <p className="note">Elitism 2 · tournament size 3 · uniform crossover · mutation p_m = 1.5/N.</p>
              <h3 style={{ marginTop: 12 }}>Simulated Annealing</h3>
              <ParamField label="Iterations" value={sa.iters} step={5000} onChange={(v) => setSa({ ...sa, iters: v })} />
              <ParamField label="Initial temp. T₀" value={sa.T0} step={100000} onChange={(v) => setSa({ ...sa, T0: v })} />
              <ParamField label="Cooling α" value={sa.alpha} step={0.00005} onChange={(v) => setSa({ ...sa, alpha: v })} />
              <ParamField label="Seed" value={sa.seed} step={1} onChange={(v) => setSa({ ...sa, seed: v })} />
              <p className="note">Flip move + 30% swap move · penalty ρ = 100,000 per unit violation. Try T₀ = 20,000 to reproduce the Phase I ablation (SA gets stuck without the law firm).</p>
            </details>
          </div>

          <div className="card">
            <div className="btns" style={{ marginTop: 0 }}>
              <button className="primary" onClick={onRun} disabled={busy}>Run optimization</button>
              <button onClick={onPareto} disabled={busy}>Pareto front</button>
              <button onClick={onReset} disabled={busy}>Reset</button>
            </div>
            <div className="progress"><i style={{ width: `${(progress * 100).toFixed(0)}%` }} /></div>
            <div className="status">{status}</div>
          </div>
        </aside>

        <section className="stack">
          <div className="kpis">
            {e && run ? (
              <>
                <Kpi label="Expected net recovery" value={thb(e.net)} sub="after cost & commission" />
                <Kpi label="Expected gross recovery" value={thb(e.gross)} sub={`${pct((e.gross / run.instance.totalBalance) * 100)} of outstanding`} />
                <Kpi label="Collection cost" value={thb(e.cost)} sub={`budget ${thb(run.instance.cfg.budget)}`} />
                <Kpi label="Return on cost" value={(e.net / Math.max(e.cost, 1)).toFixed(1) + "×"} sub="net ฿ per ฿ spent" />
              </>
            ) : (
              <Kpi label="Expected net recovery" value="—" sub="run the optimizer" />
            )}
          </div>

          <div className="card">
            <h2>Method comparison (single objective: max net recovery)</h2>
            {run ? (
              <>
                <DataTable rows={run.methods} columns={[
                  { key: "method", label: "Method", render: (m) => <>{m.method} <span className="tag">{m.method.startsWith("Exact") ? "exact" : m.method.startsWith("Greedy") ? "heuristic" : "meta-heuristic"}</span></> },
                  { key: "obj", label: "Objective (with π, w)", num: true, value: (m) => m.eval.objective, render: (m) => thb(m.eval.objective) },
                  { key: "net", label: "Net recovery", num: true, value: (m) => m.eval.net, render: (m) => thb(m.eval.net) },
                  { key: "cost", label: "Cost", num: true, value: (m) => m.eval.cost, render: (m) => thb(m.eval.cost) },
                  { key: "gap", label: "Gap to exact", num: true, value: (m) => m.gapPct ?? 0, render: (m) => (m.gapPct === null ? "—" : pct(Math.max(0, m.gapPct), 2)) },
                  { key: "ms", label: "Time (server)", num: true, render: (m) => ms(m.ms) },
                  { key: "feasible", label: "Feasible", render: (m) => <span className={m.feasible ? "ok" : "bad"}>{m.feasible ? "yes" : "no"}</span> },
                ]} />
                <p className="note">Best feasible: <b>{run.best}</b>. LP-relaxation bound {thb(run.lp.bound)} (root integrality gap {pct(run.lp.gapPct, 3)}). Objective includes priority weights; “Net recovery” is the unweighted THB value.</p>
              </>
            ) : <div className="empty">Press <b>Run optimization</b>.</div>}
          </div>

          <div className="grid2">
            <div className="card">
              <h2>Strategy mix (best solution)</h2>
              {e && run ? <Mix mix={e.mix} n={run.instance.n} y={e.y} legal={e.legal} /> : <div className="empty">No solution yet</div>}
            </div>
            <div className="card">
              <h2>Resource use &amp; shadow prices</h2>
              {e && run ? <Util run={run} /> : <div className="empty">No solution yet</div>}
            </div>
          </div>

          <div className="grid2">
            <div className="card">
              <h2>Meta-heuristic convergence</h2>
              {run ? <Convergence run={run} /> : <div className="empty">No run yet</div>}
              <p className="note">Best penalised fitness so far. GA: one point per generation · SA: ~400 samples across the run.</p>
            </div>
            <div className="card">
              <h2>Pareto front: gross recovery vs cost</h2>
              {pareto ? <ParetoChart pareto={pareto} curCost={e?.cost} curGross={e?.gross} /> : <div className="empty">Press <b>Pareto front</b>.</div>}
              <p className="note">Multi-objective: max f<sub>1</sub> (gross recovery), min f<sub>2</sub> (cost) via ε-constraint — max f<sub>1</sub> s.t. f<sub>2</sub> ≤ ε, all other constraints kept.</p>
            </div>
          </div>

          <div className="card">
            <h2>Account assignment (best solution)</h2>
            {run ? (
              <DataTable tall rows={run.assignment} columns={[
                { key: "account_id", label: "Account", render: (r) => <span className="mono">{r.account_id}</span> },
                { key: "sub_grade", label: "Grade" },
                { key: "dpd", label: "DPD", num: true, render: (r) => r.dpd },
                { key: "reachable", label: "Phone", render: (r) => (r.reachable ? "reachable" : <span className="bad">no</span>) },
                { key: "balance", label: "Balance", num: true, render: (r) => thb(r.balance) },
                { key: "rho", label: <>ρ<sub>i</sub></>, num: true, render: (r) => pct(r.rho * 100) },
                { key: "strategy", label: "Strategy", render: (r) => <span className="chip" style={{ background: sColor(r.strategy) }}>{strategies[r.strategy].key}</span> },
                { key: "recovery", label: "E[recovery]", num: true, render: (r) => thb(r.recovery) },
                { key: "cost", label: "Cost", num: true, render: (r) => thb(r.cost) },
                { key: "net", label: "Net", num: true, render: (r) => thb(r.net) },
              ]} />
            ) : <div className="empty">No solution yet</div>}
          </div>
        </section>
      </main>
    </>
  );
}

function ParamField({ label, value, step, onChange }: { label: string; value: number; step: number; onChange: (v: number) => void }) {
  return (
    <div className="field">
      <label>{label}</label>
      <input type="number" step={step} value={value} onChange={(ev) => onChange(+ev.target.value)} />
    </div>
  );
}

function Kpi({ label, value, sub }: { label: string; value: string; sub: string }) {
  return <div className="kpi"><span>{label}</span><b>{value}</b><em>{sub}</em></div>;
}

function Mix({ mix, n, y, legal }: { mix: number[]; n: number; y: number; legal: number }) {
  return (
    <>
      <div className="mixbar">
        {mix.map((c, k) => (c ? <div key={k} title={`${STRATEGIES[k].name}: ${c}`} style={{ width: `${(c / n) * 100}%`, background: sColor(k) }} /> : null))}
      </div>
      {mix.map((c, k) => (
        <div className="mixrow" key={k}>
          <span><span className="dot" style={{ background: sColor(k) }} />{STRATEGIES[k].key}</span>
          <div className="bar"><i style={{ width: `${(c / n) * 100}%`, background: sColor(k) }} /></div>
          <span className="mono" style={{ textAlign: "right" }}>{c}</span>
        </div>
      ))}
      <p className="note">Law firm engaged (y): <b>{y ? "yes" : "no"}</b> · legal cases {legal}</p>
    </>
  );
}

function Util({ run }: { run: RunResponse }) {
  const c = run.instance.cfg, e = run.methods.find((m) => m.method === run.best)!.eval;
  const rows: [string, number, number, (v: number) => string, string, string][] = [
    ["Budget", e.cost, c.budget, thb, "budget", "per ฿1"],
    ["Call-center hours", e.hours, c.call_hours, (v) => v.toFixed(2) + " h", "call_hours", "per hour"],
    ["Field visits", e.field, c.field_slots, (v) => String(v), "field_slots", "per visit"],
    ["Hard-collection cap", e.hard, c.hard_cap, (v) => String(v), "hard_cap", "per account"],
  ];
  return (
    <>
      {rows.map(([label, used, cap, f, key, unit]) => {
        const p = Math.min(100, (used / Math.max(cap, 1e-9)) * 100), d = run.lp.duals[key];
        return (
          <div className="util" key={key}>
            <div className="row"><span>{label}</span><span className="mono">{f(used)} / {f(cap)}</span></div>
            <div className="bar"><i className={p > 99.5 ? "full" : ""} style={{ width: `${p}%` }} /></div>
            <div className="row note"><span>shadow price (LP)</span><span className="mono">{d === undefined ? "—" : (key === "budget" ? d.toFixed(3) : thb(d)) + " " + unit}</span></div>
          </div>
        );
      })}
      <p className="note">A resource is worth buying when its shadow price exceeds the price of one more unit.</p>
    </>
  );
}

function Convergence({ run }: { run: RunResponse }) {
  const build = useCallback((t: ThemeColors): ChartConfiguration => {
    const pts = (h: number[]) => h.map((v, i) => ({ x: (i / Math.max(1, h.length - 1)) * 100, y: v }));
    const gaH = run.methods.find((m) => m.method === "Genetic Algorithm")?.history ?? [];
    const saH = run.methods.find((m) => m.method === "Simulated Annealing")?.history ?? [];
    const ds = [
      { label: "GA best", data: pts(gaH), borderColor: t.s[2], pointRadius: 0, borderWidth: 2 },
      { label: "SA best", data: pts(saH), borderColor: t.s[4], pointRadius: 0, borderWidth: 2 },
      { label: "Exact optimum", data: [{ x: 0, y: run.exactObjective }, { x: 100, y: run.exactObjective }], borderColor: t.ink, borderDash: [4, 4], pointRadius: 0, borderWidth: 1 },
    ];
    const top = run.exactObjective, ys = [...gaH, ...saH];
    return {
      type: "line", data: { datasets: ds },
      options: {
        maintainAspectRatio: false, animation: false, parsing: false,
        scales: {
          x: { type: "linear", title: { display: true, text: "% of run" }, max: 100 },
          y: { min: Math.max(Math.min(...ys, top), top * 0.8), ticks: { callback: (v) => kThb(+v) } },
        },
        plugins: { legend: { labels: { boxWidth: 12 } }, tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${thb(c.parsed.y ?? 0)}` } } },
      },
    };
  }, [run]);
  return <ChartCanvas build={build} />;
}

function ParetoChart({ pareto, curCost, curGross }: { pareto: ParetoResponse; curCost?: number; curGross?: number }) {
  const build = useCallback((t: ThemeColors): ChartConfiguration => ({
    type: "line",
    data: {
      datasets: [
        { label: "Pareto front (gross)", data: pareto.points.map((p) => ({ x: p.cost, y: p.gross })), borderColor: t.s[2], backgroundColor: t.s[2], pointRadius: 3 },
        { label: "Net at that point", data: pareto.points.map((p) => ({ x: p.cost, y: p.net })), borderColor: t.s[4], backgroundColor: t.s[4], borderDash: [5, 3], pointRadius: 2 },
        ...(curCost !== undefined && curGross !== undefined ? [{ label: "Current solution", data: [{ x: curCost, y: curGross }], type: "scatter" as const, backgroundColor: t.ink, pointRadius: 6, pointStyle: "rectRot" as const }] : []),
      ],
    },
    options: {
      maintainAspectRatio: false, animation: false, parsing: false,
      scales: {
        x: { type: "linear", title: { display: true, text: "f₂ cost (฿)" }, ticks: { callback: (v) => int(+v / 1000) + "k" } },
        y: { title: { display: true, text: "฿" }, ticks: { callback: (v) => int(+v / 1000) + "k" } },
      },
      plugins: { legend: { labels: { boxWidth: 12 } }, tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${thb(c.parsed.y ?? 0)} @ cost ${thb(c.parsed.x ?? 0)}` } } },
    },
  }), [pareto, curCost, curGross]);
  return <ChartCanvas build={build} />;
}
