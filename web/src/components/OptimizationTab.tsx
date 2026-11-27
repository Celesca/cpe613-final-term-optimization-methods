"use client";
// "Optimization" tab: how MILP, GA and SA are set up, how each improves its answer, and how to change settings.
// Describes build_lp, solve_milp, penalised, violation, genetic_algorithm and simulated_annealing in src/optimizer.py.
import Link from "next/link";
import phase1 from "@/data/phase1_benchmark.json";
import { int, pct, secs, thb } from "@/lib/format";
import { GA_DEFAULTS, SA_DEFAULTS } from "@/lib/optimizer/heuristics";
import { DEFAULT_CONFIG, PENALTY } from "@/lib/optimizer/model";
import { CodeTabs } from "./CodeBlock";

type Row = string[];

function Table({ head, rows }: { head?: string[]; rows: Row[] }) {
  return (
    <div className="scroll">
      <table className="wrap">
        {head && <thead><tr>{head.map((h) => <th key={h}>{h}</th>)}</tr></thead>}
        <tbody>{rows.map((r) => <tr key={r[0]}>{r.map((c, i) => <td key={i}>{i === 0 ? <b>{c}</b> : c}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

function Steps({ items }: { items: React.ReactNode[] }) {
  return <ol className="prose">{items.map((s, i) => <li key={i} style={{ margin: "4px 0" }}>{s}</li>)}</ol>;
}

export function OptimizationTab() {
  const c = DEFAULT_CONFIG;
  const R = phase1.results.N30_main;
  const cold = phase1.ablation_sa_T0.T0_20k_stats;
  const mutation = 1.5 / c.n;
  const endT = SA_DEFAULTS.T0 * SA_DEFAULTS.alpha ** SA_DEFAULTS.iters;
  const worseBy = 10_000;

  const constraints: Row[] = [
    ["C1 One strategy", "Each account gets exactly one strategy", "For each account, its six x values add up to 1"],
    ["C2 Budget", `Direct costs plus the law firm fee are at most ${thb(c.budget)}`, "sum of cost × x, plus fee × y ≤ budget"],
    ["C3 Call hours", `At most ${c.call_hours} call center hours`, "sum of call hours × x ≤ H"],
    ["C4 Field visits", `At most ${c.field_slots} field visits`, "sum of field x ≤ V"],
    ["C5 Hard collection", `At most ${c.hard_cap} accounts go to an agency or legal action`, "sum of agency x and legal x ≤ M"],
    ["C6 Link to law firm", "An account can use legal action only if the law firm is hired", "legal x ≤ y, one rule per eligible account"],
    ["C7 Minimum cases", `If the law firm is hired, send at least ${c.legal_min_cases} cases`, `${c.legal_min_cases} × y ≤ sum of legal x`],
  ];

  return (
    <div className="stack">
      <div className="card">
        <h2>The problem all three methods solve</h2>
        <div className="prose">
          <p style={{ marginTop: 0 }}>
            <b>Choose one strategy for each account so that total expected net recovery is as high as possible, while following every rule.</b>{" "}
            MILP, GA and SA receive the same accounts, strategies and limits. They differ in <b>how they search</b> for the plan.
          </p>
          <p style={{ marginBottom: 0 }}>
            With priority weights turned on, the methods maximize a weighted version of net recovery. By default all weights are equal.
          </p>
        </div>
        <p className="mono" style={{ margin: "14px 0" }}>account data + strategies + limits → MILP, GA or SA → one strategy per account</p>
        <Table head={["Method", "Simple picture", "Guarantees the best plan?"]} rows={[
          ["MILP (HiGHS)", "Write the problem as equations, then rule out choices that cannot do better", "Yes, when the solver reports “optimal”, within its numerical tolerance"],
          ["GA", "Keep many plans and make new ones by mixing good plans", "No"],
          ["SA", "Improve one plan with small changes, sometimes accepting a worse one", "No"],
        ]} />
      </div>

      <h2 className="section-title">1. MILP: the exact method</h2>
      <div className="card">
        <h3>How we set it up</h3>
        <p><b>Decisions (variables).</b> Every decision is 0 (no) or 1 (yes).</p>
        <ul className="prose">
          <li><code>x[account, strategy]</code> = 1 if we give this strategy to this account.</li>
          <li><code>y</code> = 1 if we hire the law firm.</li>
        </ul>
        <p><b>Goal (objective).</b> Maximize:</p>
        <p className="mono">sum of (net recovery × x) − law firm fixed fee × y</p>
        <p><b>Rules (constraints).</b></p>
        <Table head={["Rule", "In plain words", "As a formula"]} rows={constraints} />
        <p className="note">
          <b>Blocked choices:</b> if a choice is not allowed, its x is fixed at 0. This covers legal action for balances below{" "}
          {thb(c.legal_min_balance)}, and “No action” at {c.must_act_dpd} or more days past due. For the N=30 main setup,{" "}
          {R.dimensions.binary_x} x choices are open, plus 1 y, with {R.dimensions.total_constraints} rules from C1–C7.
        </p>
      </div>
      <div className="card stage">
        <div>
          <h3>How HiGHS works toward the answer</h3>
          <Steps items={[
            <><b>Relax:</b> temporarily allow fractions, such as 0.5 of a field visit. This easier problem gives an <b>upper bound</b>: no valid plan can do better.</>,
            <><b>Find valid plans:</b> keep the best plan found so far in which every decision is 0 or 1.</>,
            <><b>Branch:</b> split on a fractional decision. One branch sets it to 0, the other to 1.</>,
            <><b>Cut:</b> add extra rules that remove fractional answers without removing valid 0/1 plans.</>,
            <><b>Drop and stop:</b> drop a branch that cannot beat the best valid plan. When nothing better can remain, that plan is optimal.</>,
          ]} />
          <p className="note">
            HiGHS handles these internal steps and may do them in a different order or use extra techniques. We give it the goal, rules and a
            60-second time limit in Python. If it stops because of the limit, the plan is not proven best.
          </p>
          <p className="note">
            <b>N=30 main example:</b> our separate relaxed solve gives an upper bound of {thb(R.lp_relaxation.bound)}, with{" "}
            {R.lp_relaxation.fractional_vars} fractional values. The best valid 0/1 plan is {thb(R.exact_milp.objective)}.
          </p>
        </div>
        <CodeTabs items={[{ id: "build_lp", label: "build_lp (setup)" }, { id: "solve_milp", label: "solve_milp" }, { id: "lp_relax", label: "lp_relaxation" }]} />
      </div>

      <h2 className="section-title">How GA and SA write a plan and judge it</h2>
      <div className="card stage">
        <div>
          <p style={{ marginTop: 0 }}>
            A plan is a list with <b>one strategy number per account</b>: 0 none, 1 SMS, 2 call, 3 field, 4 agency, 5 legal. For example,{" "}
            <code>[2, 1, 4, …]</code> means call for account 1, SMS for account 2 and agency for account 3.
          </p>
          <p>
            This always gives one strategy per account, and new choices come from the allowed list. The law firm is counted as hired if any
            account has strategy 5. A plan can still break shared limits, so we <b>lower its score</b> with a penalty:
          </p>
          <p className="mono">score = objective − {int(PENALTY)} × violation</p>
          <Table head={["What is broken", "Violation added", "Score lowered by"]} rows={[
            ["Budget exceeded by ฿1,000", "1", thb(PENALTY)],
            ["1 call hour too many", "10", thb(10 * PENALTY)],
            ["1 field visit too many", "10", thb(10 * PENALTY)],
            ["1 agency or legal case too many", "10", thb(10 * PENALTY)],
            ["1 legal case below the minimum", "10", thb(10 * PENALTY)],
            ["1 blocked choice", "100", thb(100 * PENALTY)],
          ]} />
          <p className="note">
            The penalty is only a search score, not real money. It strongly discourages broken limits but does not guarantee a valid result,
            so the code checks that the final plan has zero violation.
          </p>
        </div>
        <CodeTabs items={[{ id: "violation", label: "violation" }, { id: "penalty", label: "penalised" }]} />
      </div>

      <h2 className="section-title">2. Genetic Algorithm (GA)</h2>
      <div className="card stage">
        <div>
          <h3>How it updates the plans</h3>
          <p className="note">Think of a group of plans. Better plans are more likely to pass their choices to the next group.</p>
          <Steps items={[
            <><b>Start</b> with {GA_DEFAULTS.pop} plans: one low-cost plan (SMS, or call if SMS is blocked) and the rest random.</>,
            <><b>Score</b> every plan.</>,
            <><b>Keep the best 2</b> unchanged (called <i>elites</i>).</>,
            <><b>Pick two parents.</b> For each parent, draw 3 random plans and take the highest score (<i>tournament</i>).</>,
            <><b>Mix them</b> with a {pct(GA_DEFAULTS.pc * 100, 0)} chance: for each account, take the strategy from either parent with equal chance (<i>crossover</i>). Otherwise copy the first parent.</>,
            <><b>Change a little:</b> each account has a 1.5 ÷ N chance to get a random allowed strategy (<i>mutation</i>). For N={c.n}, that is {pct(mutation * 100, 0)}. The random pick can be the same strategy.</>,
            <>Repeat steps 4–6 until there are {GA_DEFAULTS.pop} plans. Then score them. This is one <b>generation</b>.</>,
            <>After {GA_DEFAULTS.gens} generations, <b>return the highest-scoring plan</b>.</>,
          ]} />
          <Table head={["Setting", "Value", "If you increase it"]} rows={[
            ["pop (population)", String(GA_DEFAULTS.pop), "Tries more plans per generation; takes longer"],
            ["gens (generations)", String(GA_DEFAULTS.gens), "Searches longer"],
            ["pc (crossover chance)", String(GA_DEFAULTS.pc), "Mixes two parents more often"],
            ["pm (mutation chance)", "1.5 ÷ N", "More random change; can also break good combinations"],
            ["seed", "0, 1, 2 in the cohort tests", "Only changes the random choices; a larger number is not better"],
          ]} />
        </div>
        <CodeTabs items={[{ id: "ga", label: "genetic_algorithm" }]} />
      </div>

      <h2 className="section-title">3. Simulated Annealing (SA)</h2>
      <div className="card stage">
        <div>
          <h3>How it updates the plan</h3>
          <p className="note">The name comes from slowly cooling metal. A high “temperature” allows bold moves; a low one is careful.</p>
          <Steps items={[
            <><b>Start</b> with one low-cost plan (SMS, or call if SMS is blocked).</>,
            <><b>Make a nearby plan:</b> pick an account and give it a random allowed strategy. With a 30% chance, instead try to swap two accounts’ strategies. If the swap is not allowed, keep the one-account change.</>,
            <><b>Compare scores.</b> If the new plan is equal or better, accept it.</>,
            <><b>If it is worse,</b> sometimes accept it, with chance <code>e^(change in score ÷ T)</code>. The change is negative. This helps escape a dead end.</>,
            <><b>Remember the best plan</b> seen so far.</>,
            <><b>Cool down:</b> multiply the temperature T by {SA_DEFAULTS.alpha}.</>,
            <>Repeat for {int(SA_DEFAULTS.iters)} steps, then <b>return the best plan remembered</b>.</>,
          ]} />
          <p><b>Chance of accepting a plan whose score is {int(worseBy)} worse</b></p>
          <Table head={["Temperature T", "Chance of accepting"]} rows={[SA_DEFAULTS.T0, 10_000, 1_000].map((T) => [int(T), pct(Math.exp(-worseBy / T) * 100, T === 1_000 ? 3 : 1)])} />
          <Table head={["Setting", "Value", "What it controls"]} rows={[
            ["T0 (start temperature)", int(SA_DEFAULTS.T0), `Higher accepts worse plans more easily. T ends near ${endT.toFixed(2)}`],
            ["alpha (cooling)", String(SA_DEFAULTS.alpha), "Closer to 1 cools more slowly"],
            ["iters (steps)", int(SA_DEFAULTS.iters), "How long it searches"],
            ["seed", "0, 1, 2 in the cohort tests", "Only changes the random choices"],
          ]} />
          <p className="note">
            <b>Why the start temperature matters:</b> hiring the law firm costs a fixed fee and needs several cases, so the search may have to
            cross worse plans first. On N=30 main, starting at 20,000 left SA {pct(cold.gap_mean_pct, 2)} below the best and it used the law
            firm in {cold.law_firm_active_count} of {cold.n_runs} runs. Starting at {int(SA_DEFAULTS.T0)} reached the best in{" "}
            {R.sa_stats.optimal_hit_count} of {R.sa_stats.n_runs} runs.
          </p>
        </div>
        <CodeTabs items={[{ id: "sa", label: "simulated_annealing" }]} />
      </div>

      <div className="card">
        <h2>Saved results on N=30 main</h2>
        <Table head={["Method", "Net recovery", "Gap below best", "Time"]} rows={[
          ["MILP", thb(R.exact_milp.objective), "0% (exact best)", secs(R.exact_milp.time)],
          ["GA, average of 3 runs", thb(R.ga_stats.mean), pct(R.ga_stats.gap_mean_pct, 3), secs(R.ga_stats.mean_time_s)],
          ["SA, average of 3 runs", thb(R.sa_stats.mean), pct(R.sa_stats.gap_mean_pct, 3), secs(R.sa_stats.mean_time_s)],
        ]} />
        <p className="note">
          Times are from one saved Python test run and will differ on other computers. See the Cohorts tab for the other setups. These
          results are for these settings and data; they do not show that one method is always better.
        </p>
      </div>

      <div className="card">
        <h2>How to change the settings</h2>
        <p><b>Quick experiment: use the <Link href="/">simulator</Link>.</b> Change the values and run it. This does not change the saved results shown on these data tabs.</p>
        <p><b>Change the Python experiments:</b> edit these places, then run the scripts again.</p>
        <Table head={["What to change", "Where (Python)", "Also for the website simulator’s defaults"]} rows={[
          ["Limits and rules", "DEFAULT_CFG in src/optimizer.py", "DEFAULT_CONFIG in web/src/lib/optimizer/model.ts"],
          ["Strategy multipliers, costs, commissions", "STRATEGIES in src/optimizer.py", "STRATEGIES in web/src/lib/optimizer/model.ts"],
          ["GA settings", "Arguments of genetic_algorithm()", "GA_DEFAULTS and the code in web/src/lib/optimizer/heuristics.ts"],
          ["SA settings", "Arguments of simulated_annealing()", "SA_DEFAULTS in web/src/lib/optimizer/heuristics.ts"],
          ["MILP time limit", "time_limit in solve_milp()", "timeLimit in web/src/lib/optimizer/exact.ts"],
          ["A new or changed rule", "build_lp() for MILP; violation() and evaluate() for GA and SA", "lpModel() in exact.ts; violation() and evaluate() in model.ts"],
        ]} />
        <p className="note">
          Cohort tests build their limits with <code>make_cfg()</code> in <code>src/03b_phase1_benchmark.py</code>. Change a rule in every
          solver; otherwise they solve different problems and their results cannot be compared.
        </p>
        <pre><code>{`python src/03_run_experiments.py    # N=30 report results
python src/03b_phase1_benchmark.py  # cohort results
cd web && npm run sync-data         # copy results and code excerpts to the website`}</code></pre>
        <p className="note">
          The website simulator is a separate TypeScript version with the same default settings. It uses a different random number generator
          and has a 30-second default MILP time limit, so GA and SA results and run times can differ from Python, even with the same seed.
          Some text on these tabs describes the current settings, so check it after a change.
        </p>
      </div>
    </div>
  );
}
