// Plain-language walkthrough for the "Source & pipeline" tab:
// why two models → what rho is → how strategies change recovery → optimizer input and output.
// All baht amounts are computed with the same code as the simulator.
import optimal from "@/data/optimal_assignment_n30.json";
import results from "@/data/results_n30.json";
import { int, pct, sColor, thb } from "@/lib/format";
import { AGENCY, DEFAULT_CONFIG, LEGAL, STRATEGIES, buildInstance } from "@/lib/optimizer/model";

const INPUT_FIELDS: { field: string; meaning: string; use: string }[] = [
  { field: "balance_thb", meaning: "Unpaid balance in baht", use: "Calculates expected recovery and the legal action cost, and decides whether legal action is allowed" },
  { field: "rho", meaning: "Predicted base recovery rate", use: "Calculates expected recovery" },
  { field: "dpd", meaning: "Days past due: how many days the payment is late", use: `At ${DEFAULT_CONFIG.must_act_dpd} days or more, “No action” is not allowed` },
  { field: "reachable", meaning: "Whether the phone number works", use: "If not, SMS and calls are less effective" },
  { field: "grade", meaning: "Loan credit grade", use: "Only used if you choose to prioritise by grade (off by default)" },
];

const LIMITS: [string, string][] = [
  ["Total budget", thb(DEFAULT_CONFIG.budget)],
  ["Call center time", `${DEFAULT_CONFIG.call_hours} hours`],
  ["Field visits", `${DEFAULT_CONFIG.field_slots} at most`],
  ["Agency and legal accounts combined", `${DEFAULT_CONFIG.hard_cap} at most`],
  ["Law firm, if used", `${thb(DEFAULT_CONFIG.legal_retainer)} fixed fee and at least ${DEFAULT_CONFIG.legal_min_cases} cases`],
  ["Legal action", `Only for balances of ${thb(DEFAULT_CONFIG.legal_min_balance)} or more`],
];

export function RhoExplainer() {
  const I = buildInstance(DEFAULT_CONFIG, STRATEGIES);
  const a = I.acc[0];
  const base = a.balance * a.rho;
  const agencyCommission = I.R[0][AGENCY] * STRATEGIES[AGENCY].commission;
  const saved = optimal[0].strategy;
  const examples = [optimal[0], optimal[3]];
  const ex = results.exact;

  return (
    <>
      <h2 className="section-title">In plain words: from account data to a collection plan</h2>
      <div className="stack">
        <div className="card">
          <h3>1. Why do we use two models?</h3>
          <div className="prose">
            <p>
              The optimizer needs to know how much money each account is likely to give back. <b>Nobody knows this when the strategy is chosen</b>,
              so we <b>predict first, then optimize</b> (this is called <i>predict-then-optimize</i>). The two models predict the{" "}
              <b>base recovery rate</b>, written <code>rho</code> (the Greek letter ρ), which becomes an input to the optimizer.
            </p>
            <ul>
              <li><b>Model 1:</b> what is the chance of collecting <b>any money</b>?</li>
              <li><b>Model 2:</b> if we collect something, <b>what share</b> of the unpaid balance will it be?</li>
              <li><b>Combine:</b> multiply the two answers, then reduce the result for accounts that are further past due. The result is <code>rho</code>, kept between 1% and 60%.</li>
            </ul>
            <p>
              <b>Why not use the amount that was actually recovered?</b> That would be <b>data leakage</b>. It is only known after collection,
              so the optimizer would be using information nobody has when making the decision. Past results are used to train and test the
              models, but never as a model feature or an optimizer input.
            </p>
            <p>
              <b>The unpaid balance</b> starts from <b>EAD (Exposure at Default)</b>: the amount lent minus the principal already repaid, which is
              what is still at risk when the borrower stops paying. We convert it to baht.
            </p>
          </div>
        </div>

        <div className="card">
          <h3>2. How do different strategies change the expected recovery and net recovery?</h3>
          <p className="mono" style={{ margin: "0 0 4px" }}>expected recovery = balance × rho × strategy multiplier</p>
          <p className="mono" style={{ margin: "0 0 8px" }}>net recovery = expected recovery − commission − direct cost</p>
          <div className="prose">
            <p>
              For <code>{a.account_id}</code>, the balance is <b>{thb(a.balance)}</b> and <code>rho</code> is <b>{a.rho}</b> ({pct(a.rho * 100)}).
              The call center is the baseline (×1.00): {thb(a.balance)} × {a.rho} = <b>{thb(base)}</b>. Another strategy changes this amount,
              and <b>it can go up or down</b>. The recovery rate is capped at {pct(DEFAULT_CONFIG.rate_cap * 100, 0)}, and SMS and calls are
              multiplied by {DEFAULT_CONFIG.unreachable_factor} if the phone is unreachable.
            </p>
            <p>
              <b>Net recovery</b> starts from the base recovery rate (<code>rho</code>), which gives the expected recovery for the chosen
              strategy. Then we subtract <b>what we have to pay</b> to get that money:
            </p>
            <ul>
              <li><b>Commission:</b> a share of the recovered money. By default only the collection agency takes it ({pct(STRATEGIES[AGENCY].commission * 100, 0)}).</li>
              <li><b>Direct cost:</b> the cost of the action for that account. Legal action costs {thb(STRATEGIES[LEGAL].cost)} plus {pct(STRATEGIES[LEGAL].cost_pct * 100, 0)} of the balance.</li>
              <li><b>Law firm fixed fee:</b> {thb(DEFAULT_CONFIG.legal_retainer)}, subtracted <b>once from the total of all accounts</b> if any account goes to legal action.</li>
            </ul>
            <p>
              Example, <code>{a.account_id}</code> with the collection agency: {thb(I.R[0][AGENCY])} − {thb(agencyCommission)} commission −{" "}
              {thb(I.C[0][AGENCY])} direct cost = <b>{thb(I.V[0][AGENCY])}</b> net recovery. (Each amount is rounded separately, so the shown figures can differ by ฿1.)
            </p>
          </div>
          <div className="scroll">
            <table>
              <thead>
                <tr><th>Strategy</th><th className="num">Multiplier</th><th className="num">Expected recovery</th><th className="num">Cost and commission</th><th className="num">Net recovery</th></tr>
              </thead>
              <tbody>
                {STRATEGIES.map((s, k) => (
                  <tr key={s.key} className={s.name === saved ? "hl" : undefined}>
                    <td><span className="dot" style={{ background: sColor(k) }} />{s.name}</td>
                    <td className="num">×{s.lift.toFixed(2)}</td>
                    <td className="num">{thb(I.R[0][k])}</td>
                    <td className="num">{thb(I.R[0][k] - I.V[0][k])}</td>
                    <td className="num">{I.allowed[0][k] ? <>{thb(I.V[0][k])}{k === LEGAL ? "*" : ""}</> : "not allowed"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="note">
            * Before the law firm’s {thb(DEFAULT_CONFIG.legal_retainer)} fixed fee. It is paid once if any account goes to legal action, and then
            at least {DEFAULT_CONFIG.legal_min_cases} accounts must go. The highlighted row is the choice in the saved 30-account result.
          </p>
          <div className="prose">
            <ul>
              <li><b>Higher expected recovery does not always mean higher net recovery.</b> The agency recovers more than a field visit, but is worth less here because of its commission.</li>
              <li><b>Not every account can get its best option.</b> Budget, staff time, visit slots and case limits are shared, so the optimizer maximizes the total net recovery across all accounts.</li>
              <li><b>The multipliers are assumptions.</b> The two models do not learn them. They are planning values that you can change in the simulator.</li>
            </ul>
          </div>
        </div>

        <div className="card">
          <h3>3. What goes into the optimizer?</h3>
          <p className="note" style={{ margin: "0 0 8px" }}><b>A. Account data</b>, one row per account</p>
          <div className="scroll">
            <table className="wrap">
              <thead><tr><th>Field</th><th>Meaning</th><th>How the optimizer uses it</th></tr></thead>
              <tbody>
                {INPUT_FIELDS.map((f) => (
                  <tr key={f.field}><td><code>{f.field}</code></td><td>{f.meaning}</td><td>{f.use}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="note" style={{ margin: "14px 0 0" }}>
            <b>B. Six strategies:</b> {STRATEGIES.map((s) => s.name).join(", ")}. Each has a recovery multiplier, cost, commission and staff hours (some are zero).
          </p>
          <p className="note" style={{ margin: "14px 0 8px" }}><b>C. Limits and rules</b> (default values)</p>
          <div className="scroll">
            <table className="wrap">
              <tbody>
                {LIMITS.map(([rule, value]) => <tr key={rule}><td>{rule}</td><td>{value}</td></tr>)}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card">
          <h3>4. What comes out?</h3>
          <div className="prose">
            <p>
              <b>One chosen strategy for each account</b>, plus a yes/no decision on whether to hire the law firm. The goal is to{" "}
              <b>maximize total expected net recovery</b> (recovery minus commissions, direct costs and any law firm fee) while following all
              the rules. Optional priority weights can change this goal, but by default they are all equal.
            </p>
          </div>
          <div className="scroll">
            <table>
              <thead><tr><th>Account</th><th>Chosen strategy</th><th className="num">Expected recovery before commission</th><th className="num">Direct cost</th></tr></thead>
              <tbody>
                {examples.map((r) => (
                  <tr key={r.account_id}><td><code>{r.account_id}</code></td><td>{r.strategy}</td><td className="num">{thb(r.exp_recovery_thb)}</td><td className="num">{thb(r.cost_thb)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="note" style={{ margin: "14px 0 8px" }}><b>Totals for {int(optimal.length)} accounts</b>, saved result from the exact solver</p>
          <div className="scroll">
            <table className="wrap">
              <tbody>
                <tr><td>Expected recovery before costs</td><td className="num">{thb(ex.gross_recovery)}</td></tr>
                <tr><td>Total cost, including the law firm fee but not commission</td><td className="num">{thb(ex.cost)}</td></tr>
                <tr><td>Agency commission</td><td className="num">{thb(ex.commission)}</td></tr>
                <tr><td><b>Expected net recovery</b></td><td className="num"><b>{thb(ex.net_recovery)}</b></td></tr>
              </tbody>
            </table>
          </div>
          <p className="note">These are model estimates, not money actually collected.</p>
          <p style={{ marginBottom: 0 }}>
            <b>In short:</b> account data + strategies + limits → optimizer → a strategy for each account and the expected totals.
          </p>
        </div>
      </div>
    </>
  );
}
