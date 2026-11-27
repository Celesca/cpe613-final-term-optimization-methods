"use client";
// "Cohorts" tab: plain-language guide to the six Phase I test setups.
// Numbers come from data/phase1_benchmark.json (src/03b_phase1_benchmark.py) and accounts.json.
import accounts from "@/data/accounts.json";
import phase1 from "@/data/phase1_benchmark.json";
import { int, pct, sColor, secs, thb } from "@/lib/format";
import { STRATEGIES } from "@/lib/optimizer/model";

type CohortId = keyof typeof phase1.results;

const COHORTS: { id: CohortId; name: string; from: number; to: number; limits: string; question: string; story: string }[] = [
  { id: "N30_main", name: "N=30 main", from: 1, to: 30, limits: "Base limits",
    question: "Does the model work on our main example?",
    story: "The main example used in the report. It is small enough to read the chosen strategy of every account." },
  { id: "N30_unseenB", name: "N=30 unseen", from: 31, to: 60, limits: "Base limits",
    question: "Do the methods still work on a different set of accounts?",
    story: "The same size and limits as the main example, but 30 different accounts. It checks that the results are not special to the first 30." },
  { id: "N100_prop", name: "N=100 scaled limits", from: 1, to: 100, limits: "Grow with the number of accounts",
    question: "What happens when the company and its portfolio both grow?",
    story: "More accounts, with the budget, staff time, visits and case limit increased by about the same proportion." },
  { id: "N300_prop", name: "N=300 scaled limits", from: 1, to: 300, limits: "Grow with the number of accounts",
    question: "Can the methods handle a much larger problem?",
    story: "The whole pool, with limits 10 times the base values. This is the largest test with enough resources for its size." },
  { id: "N100_frozen", name: "N=100 same limits", from: 1, to: 100, limits: "Stay at the base values",
    question: "What if there are more accounts but no extra resources?",
    story: "100 accounts must share the resources of the 30-account example. This is a stress test." },
  { id: "N300_frozen", name: "N=300 same limits", from: 1, to: 300, limits: "Stay at the base values",
    question: "What gets priority when resources are very scarce?",
    story: "300 accounts share the same resources as 30. This is the hardest stress test for resources." },
];

const WORDS: [string, string][] = [
  ["Cohort", "A group of accounts used in one test. Here, each setup also has its own limits."],
  ["N", "The number of accounts. N=30 means 30 accounts."],
  ["Exact best", "The highest total expected net recovery that follows all the rules, found by the exact solver (MILP, using the HiGHS software)."],
  ["Gap", "How far a method is below the exact best. 0% means it matched the best; lower is better."],
  ["Greedy", "A simple shortcut: keep making the one account upgrade that looks like the best value right now."],
  ["GA (Genetic Algorithm)", "Keeps many plans, combines and randomly changes them, and keeps improving the better ones."],
  ["SA (Simulated Annealing)", "Changes one plan step by step. Early on it can accept a worse plan, which helps it escape a dead end."],
  ["Run (seed)", "GA and SA use random choices, so each was run 3 times with different starting random numbers (seeds 0, 1, 2)."],
];

function facts(c: (typeof COHORTS)[number]) {
  const r = phase1.results[c.id];
  const group = accounts.slice(c.from - 1, c.to);
  return {
    r,
    ids: `TH${String(c.from).padStart(4, "0")} – TH${String(c.to).padStart(4, "0")}`,
    n: group.length,
    meanRho: group.reduce((s, a) => s + a.rho, 0) / group.length,
  };
}

export function CohortsTab() {
  const main = phase1.results.N30_main;
  const unseen = phase1.results.N30_unseenB;
  const scarce = phase1.results.N300_frozen;
  const ample = phase1.results.N300_prop;
  const all = COHORTS.map((c) => phase1.results[c.id]);
  const greedyNoLegal = all.every((r) => r.greedy.legal === 0);
  const allFeasible = all.every((r) => r.ga_stats.feasible_count === r.ga_stats.n_runs && r.sa_stats.feasible_count === r.sa_stats.n_runs);

  const saBeatsGa = all.every((r) => r.sa_stats.gap_mean_pct < r.ga_stats.gap_mean_pct);
  const exactFastest = all.every((r) => r.exact_milp.time < Math.min(r.ga_stats.mean_time_s, r.sa_stats.mean_time_s));

  return (
    <div className="stack">
      <div className="card">
        <h2>What is a cohort?</h2>
        <div className="prose">
          <p style={{ marginTop: 0 }}>
            A <b>cohort</b> is a group of accounts that we test the optimizer on. We use <b>4 groups of accounts</b> to make{" "}
            <b>6 test setups</b>: the 100 and 300 account groups are each tested twice, with different limits.
          </p>
          <p>
            All accounts come from the same 300-account pool. <b>The groups overlap:</b> the 100-account group contains both 30-account
            groups, and the 300-account group contains everything. Only <b>N=30 main</b> and <b>N=30 unseen</b> have no accounts in common.
          </p>
          <p style={{ marginBottom: 0 }}>
            <b>“Unseen” means a separate group from the main example.</b> It does not mean the recovery models never saw these loans: the
            pool was sampled from the full dataset, which includes loans used for model training. So this test checks the optimization
            methods, not the accuracy of the two models.
          </p>
        </div>
      </div>

      <div className="grid2">
        {COHORTS.map((c) => {
          const f = facts(c);
          const cfg = f.r.cfg;
          return (
            <div className="card" key={c.id} style={{ marginTop: 0 }}>
              <h3>{c.name} <span className="tag mono">{c.id}</span></h3>
              <p style={{ margin: "0 0 4px" }}><b>{c.question}</b></p>
              <p className="note" style={{ margin: "0 0 10px" }}>{c.story}</p>
              <div className="scroll">
                <table className="wrap">
                  <tbody>
                    <tr><td>Accounts</td><td className="num">{f.n} ({f.ids})</td></tr>
                    <tr><td>Total unpaid balance</td><td className="num">{thb(f.r.total_balance_thb)}</td></tr>
                    <tr><td>Average base recovery rate (<code>rho</code>)</td><td className="num">{pct(f.meanRho * 100)}</td></tr>
                    <tr><td>Limits</td><td className="num">{c.limits}</td></tr>
                    <tr><td>Budget</td><td className="num">{thb(cfg.budget)}</td></tr>
                    <tr><td>Call center hours</td><td className="num">{cfg.call_hours}</td></tr>
                    <tr><td>Field visits</td><td className="num">{cfg.field_slots}</td></tr>
                    <tr><td>Agency + legal accounts</td><td className="num">{cfg.hard_cap}</td></tr>
                  </tbody>
                </table>
              </div>
            </div>
          );
        })}
      </div>
      <p className="note">
        In every setup the law firm keeps the same contract: a {thb(main.cfg.legal_retainer)} fixed fee and at least{" "}
        {main.cfg.legal_min_cases} cases if used. It is one agreement, so it does not grow with the number of accounts. Scaled call hours and
        counts are rounded when needed.
      </p>

      <div className="card">
        <h2>Words used on this tab</h2>
        <div className="scroll">
          <table className="wrap">
            <tbody>{WORDS.map(([w, m]) => <tr key={w}><td><b>{w}</b></td><td>{m}</td></tr>)}</tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <h2>Results 1: the best plan in each setup</h2>
        <div className="scroll">
          <table>
            <thead><tr><th>Setup</th><th className="num">Exact best net recovery</th><th className="num">Share of unpaid balance</th><th className="num">Total cost</th><th className="num">Solve time</th></tr></thead>
            <tbody>
              {COHORTS.map((c) => {
                const r = phase1.results[c.id];
                return (
                  <tr key={c.id}>
                    <td>{c.name}</td>
                    <td className="num">{thb(r.exact_milp.objective)}</td>
                    <td className="num">{pct((r.exact_milp.objective / r.total_balance_thb) * 100)}</td>
                    <td className="num">{thb(r.exact_milp.cost)}</td>
                    <td className="num">{secs(r.exact_milp.time)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="note">
          Do not compare the baht totals of different account groups on their own, because their balances differ. Net recovery is a model
          estimate, not money actually collected. Total cost includes the law firm fee but not commission.
        </p>
      </div>

      <div className="card">
        <h2>Results 2: which strategies the best plan chooses</h2>
        <div className="legend">{STRATEGIES.map((s, k) => <span key={s.key}><span className="dot" style={{ background: sColor(k) }} />{s.name}</span>)}</div>
        {COHORTS.map((c) => {
          const r = phase1.results[c.id];
          const mix: Record<string, number> = r.exact_milp.mix;
          const label = STRATEGIES.map((s) => `${s.name}: ${mix[s.key]}`).join(", ");
          return (
            <div key={c.id} style={{ marginTop: 10 }}>
              <b style={{ fontSize: 13 }}>{c.name}</b>
              <div className="mixbar" role="img" aria-label={label}>
                {STRATEGIES.map((s, k) => <div key={s.key} title={`${s.name}: ${mix[s.key]}`} style={{ width: `${(mix[s.key] / r.dimensions.accounts) * 100}%`, background: sColor(k) }} />)}
              </div>
              <span className="note">{STRATEGIES.filter((s) => mix[s.key] > 0).map((s) => `${s.key} ${mix[s.key]}`).join(" · ")}</span>
            </div>
          );
        })}
        <div className="prose">
          <p style={{ marginBottom: 0 }}>
            <b>What to notice:</b> with scaled limits, N=300 sends {ample.exact_milp.mix.sms} accounts to SMS. With the 30-account limits,
            it sends <b>{scarce.exact_milp.mix.sms} of {scarce.dimensions.accounts}</b> to SMS and gives no action to{" "}
            {scarce.exact_milp.mix.none}, because the costly or limited actions are only available to a few accounts. Its expected net
            recovery falls from {thb(ample.exact_milp.objective)} to <b>{thb(scarce.exact_milp.objective)}</b> for the same 300 accounts.
          </p>
        </div>
      </div>

      <div className="card">
        <h2>Results 3: how close does each method get?</h2>
        <p className="note" style={{ margin: "0 0 8px" }}>Gap below the exact best. Lower is better. GA and SA show the average of 3 runs.</p>
        <div className="scroll">
          <table>
            <thead><tr><th>Setup</th><th className="num">Greedy gap</th><th className="num">GA gap</th><th className="num">SA gap</th><th className="num">Greedy time</th><th className="num">GA time</th><th className="num">SA time</th></tr></thead>
            <tbody>
              {COHORTS.map((c) => {
                const r = phase1.results[c.id];
                return (
                  <tr key={c.id}>
                    <td>{c.name}</td>
                    <td className="num">{pct(r.greedy.gap_pct, 2)}</td>
                    <td className="num">{pct(r.ga_stats.gap_mean_pct, 3)}</td>
                    <td className="num">{pct(r.sa_stats.gap_mean_pct, 3)}</td>
                    <td className="num">{secs(r.greedy.time)}</td>
                    <td className="num">{secs(r.ga_stats.mean_time_s)}</td>
                    <td className="num">{secs(r.sa_stats.mean_time_s)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="prose">
          <ul>
            <li><b>SA matched the exact best in {main.sa_stats.optimal_hit_count} of {main.sa_stats.n_runs} runs</b> on N=30 main and in {unseen.sa_stats.optimal_hit_count} of {unseen.sa_stats.n_runs} runs on N=30 unseen.</li>
            <li>{saBeatsGa && <b>SA’s average gap is smaller than GA’s in all 6 setups. </b>}Across all {phase1.pooled_stats.n_paired_runs} paired runs, the averages are {pct(phase1.pooled_stats.sa_mean_gap_pct, 3)} for SA and {pct(phase1.pooled_stats.ga_mean_gap_pct, 3)} for GA.</li>
            {greedyNoLegal && <li><b>Greedy never uses legal action here.</b> The first legal case must pay the fixed fee and also needs at least {main.cfg.legal_min_cases} cases, so changing one account at a time does not look worthwhile.</li>}
            {allFeasible && <li><b>All GA and SA runs followed every limit.</b></li>}
            <li><b>The exact solver is the best choice for this version of the problem:</b> it finds the best plan{exactFastest ? " and was faster than GA and SA in every setup" : ""}. Times come from the saved test run and will differ on other computers.</li>
          </ul>
        </div>
      </div>

      <div className="card">
        <h2>Extra check: our own Branch and Bound solver</h2>
        <div className="prose">
          <p style={{ margin: 0 }}>
            Branch and Bound splits the problem into smaller parts (<b>nodes</b>) and drops parts that cannot beat the best plan found. On{" "}
            <b>N=30 unseen</b> it proved the best plan after {int(unseen.custom_bnb.log.nodes)} nodes. On <b>N=30 main</b> it found the
            exact best amount but reached its limit of {int(main.custom_bnb.log.nodes)} nodes before proving it. On{" "}
            <b>N=100 scaled limits</b> it was still {pct(phase1.results.N100_prop.custom_bnb.gap_pct, 2)} below the exact best when it
            reached its limit of {int(phase1.results.N100_prop.custom_bnb.log.nodes)} nodes. It was not run on the other three setups.
          </p>
        </div>
      </div>
    </div>
  );
}
