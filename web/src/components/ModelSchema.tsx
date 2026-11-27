// "ML recovery model" tab: why the models exist, what they predict, and their input/output schema.
// The schema mirrors FEATS and the targets in src/02_model_and_dataset.py.
import accounts from "@/data/accounts.json";
import modelReport from "@/data/model_report.json";
import { int, pct } from "@/lib/format";

type Field = { name: string; type: string; meaning: string };

const INPUT_GROUPS: { group: string; fields: Field[] }[] = [
  { group: "Loan", fields: [
    { name: "grade_num", type: "integer 0–6", meaning: "Credit grade, A = 0 to G = 6" },
    { name: "sub_grade_num", type: "integer 0–34", meaning: "Detailed grade, A1 = 0 to G5 = 34" },
    { name: "int_rate", type: "number (%)", meaning: "Interest rate of the loan" },
    { name: "term_m", type: "number (months)", meaning: "Loan length" },
    { name: "installment", type: "number (USD)", meaning: "Monthly payment" },
    { name: "issue_year", type: "integer (year)", meaning: "Year the loan was issued" },
    { name: "purpose_cat", type: "category code", meaning: "Reason for borrowing" },
  ] },
  { group: "Unpaid amount and payment history", fields: [
    { name: "ead", type: "number (USD)", meaning: "Exposure at Default: amount lent minus principal already repaid" },
    { name: "paid_frac", type: "ratio 0–1", meaning: "Share of the amount lent that was already repaid" },
    { name: "total_rec_late_fee", type: "number (USD)", meaning: "Late fees received on the loan" },
  ] },
  { group: "Borrower", fields: [
    { name: "annual_inc", type: "number (USD)", meaning: "Yearly income" },
    { name: "dti", type: "number (%)", meaning: "Debt-to-income: monthly debt payments compared with monthly income" },
    { name: "emp_years", type: "number (years)", meaning: "Years employed, taken from text: “10+ years” becomes 10, and “< 1 year” becomes 1" },
    { name: "home_ownership_cat", type: "category code", meaning: "For example rent, own or mortgage" },
    { name: "verification_status_cat", type: "category code", meaning: "Whether the income information was verified" },
  ] },
  { group: "Credit record", fields: [
    { name: "revol_util", type: "number (%)", meaning: "Share of the revolving credit limit in use (for example, credit cards)" },
    { name: "revol_bal", type: "number (USD)", meaning: "Revolving credit balance" },
    { name: "open_acc", type: "count", meaning: "Open credit accounts" },
    { name: "total_acc", type: "count", meaning: "All credit accounts" },
    { name: "inq_last_6mths", type: "count", meaning: "Credit checks in the last 6 months" },
    { name: "delinq_2yrs", type: "count", meaning: "Payments 30 or more days late in the past 2 years" },
    { name: "pub_rec", type: "count", meaning: "Negative public records" },
    { name: "pub_rec_bankruptcies", type: "count", meaning: "Bankruptcy records" },
    { name: "mort_acc", type: "count", meaning: "Mortgage accounts" },
  ] },
];
const N_FEATURES = INPUT_GROUPS.reduce((s, g) => s + g.fields.length, 0);

export function ModelSchema() {
  const a = accounts[0];
  const targets: (Field & { used: string })[] = [
    { name: "recovered", type: "0 or 1", meaning: "1 if any money was recovered after default, otherwise 0", used: "Model 1" },
    { name: "rec_rate", type: "ratio 0–1", meaning: "recoveries ÷ EAD, limited to 0–1", used: "Model 2 (only loans where recovered = 1)" },
  ];
  const outputs: (Field & { from: string; example: string })[] = [
    { name: "p_pay", type: "probability 0–1", meaning: "Chance of collecting any money", from: "Model 1: HistGradientBoostingClassifier", example: String(a.p_pay) },
    { name: "rate_if_pay", type: "ratio 0–1", meaning: "Share of the unpaid balance collected, if something is collected", from: "Model 2: HistGradientBoostingRegressor", example: String(a.rate_if_pay) },
    { name: "rho", type: "ratio 0.01–0.60", meaning: "Base recovery rate, the value sent to the optimizer", from: "Calculated after the two models (formula below)", example: String(a.rho) },
  ];

  return (
    <>
      <div className="card">
        <h2>Why do we need this, and what do we predict?</h2>
        <div className="prose">
          <p style={{ marginTop: 0 }}>
            The optimizer must choose a collection strategy for each account. To do that, it needs to estimate how much money each account may
            give back. <b>This is not known when we make the decision.</b> So we <b>predict first, then optimize</b> (predict-then-optimize).
          </p>
          <p>We predict two things from information about the loan and borrower:</p>
          <ul>
            <li><b>Will we collect any money?</b> (Model 1)</li>
            <li><b>If we do, what share of the unpaid balance will it be?</b> (Model 2)</li>
          </ul>
          <p>
            We combine the two answers into the <b>base recovery rate</b>, <code>rho</code>. We use two models because many defaulted loans
            give back nothing, while the others give back different amounts. Credit grade alone separates accounts too little.
          </p>
          <p style={{ marginBottom: 0 }}>
            <b>We do not predict</b> which strategy is best. The optimizer chooses strategies, using <code>rho</code> together with assumed
            strategy multipliers, costs and limits.
          </p>
        </div>
        <p className="mono" style={{ margin: "14px 0 0" }}>loan and borrower data → two models → rho → optimizer</p>
      </div>

      <div className="card">
        <h2>Input schema: {N_FEATURES} features used by both models</h2>
        <p className="note" style={{ margin: "0 0 8px" }}>
          One row per defaulted loan. All {N_FEATURES} values are sent to the models as numbers. Money is in US dollars. Text categories are
          turned into number codes; the numbers do not mean one category is better than another.
        </p>
        <div className="scroll">
          <table className="wrap">
            <thead><tr><th>Feature</th><th>Type / unit</th><th>Meaning</th></tr></thead>
            {INPUT_GROUPS.map((g) => (
              <tbody key={g.group}>
                <tr><td colSpan={3}><b>{g.group}</b></td></tr>
                {g.fields.map((f) => <tr key={f.name}><td><code>{f.name}</code></td><td>{f.type}</td><td>{f.meaning}</td></tr>)}
              </tbody>
            ))}
          </table>
        </div>
        <p className="note">
          <b>Left out to prevent data leakage:</b> <code>recoveries</code>, <code>collection_recovery_fee</code> and{" "}
          <code>total_pymnt</code> contain outcome information, so they are not features. <code>dpd</code> and <code>reachable</code> are not
          model inputs either: they are synthetic fields added later.
        </p>
      </div>

      <div className="card">
        <h2>Training targets: the answers the models learn from</h2>
        <div className="scroll">
          <table className="wrap">
            <thead><tr><th>Target</th><th>Type</th><th>Meaning</th><th>Used by</th></tr></thead>
            <tbody>{targets.map((t) => <tr key={t.name}><td><code>{t.name}</code></td><td>{t.type}</td><td>{t.meaning}</td><td>{t.used}</td></tr>)}</tbody>
          </table>
        </div>
        <p className="note">
          These come from past results in {int(modelReport.n_defaulted_used)} loans, split into 75% for training and 25% for testing. Past
          results are known for old loans, but not for a new decision.
        </p>
      </div>

      <div className="card">
        <h2>Output schema: what we get for each account</h2>
        <div className="scroll">
          <table className="wrap">
            <thead><tr><th>Output</th><th>Type / range</th><th>Meaning</th><th>Comes from</th><th className="num">{a.account_id}</th></tr></thead>
            <tbody>{outputs.map((o) => <tr key={o.name}><td><code>{o.name}</code></td><td>{o.type}</td><td>{o.meaning}</td><td>{o.from}</td><td className="num">{o.example}</td></tr>)}</tbody>
          </table>
        </div>
        <p className="mono" style={{ margin: "14px 0 0" }}>rho = p_pay × rate_if_pay × e^(−0.004 × (dpd − 30)), limited to 0.01–0.60</p>
        <p className="note">
          For {a.account_id}, days past due (<code>dpd</code>) is {a.dpd}, so rho is {pct(a.rho * 100)}. The days-past-due reduction is an
          assumption, not something the models learned. Example values are rounded.
        </p>
      </div>

      <h2 className="section-title">How well do the models do?</h2>
      <p className="note" style={{ marginTop: -4 }}>
        The scores below come from the 25% test loans. They do not test the final <code>rho</code> after the days-past-due reduction.
      </p>
    </>
  );
}
