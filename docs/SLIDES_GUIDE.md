# Midterm Presentation — Slide Guide

**Project:** Debt Collection Strategy Allocation using Mathematical Programming and Meta-Heuristics
**Source:** [PROPOSAL.md](PROPOSAL.md)
**Length:** 13 slides, about 12–15 minutes (roughly 1 minute per slide; slides 5 and 8 need 2 minutes)

The story follows how a real collections team thinks: *what happens to a bad loan* → *how much can we get back* →
*what can we do about it* → *what data we have* → *how we turn it into a model* → *how we solve it*.

Each slide has:
- **Message**: the one sentence the audience should remember.
- **On the slide**: what to put on it.
- **Visual**: what to draw.
- **Say**: speaker notes.

---

## Title slide

- **On the slide:** project name, Thai title (การจัดสรรกลยุทธ์การติดตามหนี้ด้วยการโปรแกรมเชิงคณิตศาสตร์และเมตาฮิวริสติก),
  your name and student ID, CPE 613 Optimization Methods, date.
- **Visual:** one clean background; optionally a small icon of a loan file going through channels.
- **Say:** "Our project decides how a bank should chase each overdue loan when its people and money are limited."

---

## Slide 1 — The debt recovery process

- **Message:** Collections is a pipeline, and the key decision is *which channel to use for each account*.
- **On the slide:** the workflow diagram below, with the decision step highlighted.
- **Visual:**

```
 Loan issued ──► Payment missed ──► Delinquent account (DPD 30 / 60 / 90 / 120 / 180)
                                            │
                                            ▼
                              Score the account (how likely to pay?)
                                            │
                                            ▼
                ┌───────────  ★ ASSIGN A COLLECTION STRATEGY ★  ───────────┐   ◄── our optimization
                ▼            ▼            ▼            ▼            ▼            ▼
             No action    SMS/LINE     Call center   Field visit   Agency     Legal action
                └────────────┴────────────┴─────┬──────┴────────────┴────────────┘
                                                ▼
                               Outcome: paid / partly paid / no payment
                                                ▼
                         Next cycle: escalate or write off
```

- **Say:**
  - When a borrower misses payments, the account moves into collections and is grouped by days past due (DPD).
  - Every cycle, the team chooses an action for each account, from doing nothing up to suing.
  - Stronger actions recover more but cost more and use limited staff.
  - In Thailand, the *Debt Collection Act B.E. 2558* also limits how hard and how often debtors can be contacted.
  - Our project optimizes the starred step.

---

## Slide 2 — Each loan has a different chance of recovery

- **Message:** Recovery is low and uneven, and grade alone does not predict it, so we use a model.
- **On the slide:**
  - Defaulted loans recover only **about 10.6 % of exposure** on average.
  - A small table by grade (from the data):

    | Grade | P(any recovery) | Mean recovery rate |
    | :-: | :-: | :-: |
    | A | 59.4 % | 10.4 % |
    | C | 67.6 % | 10.5 % |
    | E | 70.1 % | 10.9 % |
    | G | 72.2 % | 11.1 % |

  - The base recovery rate $\rho_i$ depends on:
    - **Loan:** grade, sub-grade, interest rate, term, instalment, purpose, issue year
    - **Borrower:** income, debt-to-income (DTI), employment length, home ownership, verification status
    - **Credit history:** revolving utilisation and balance, open/total accounts, inquiries, delinquencies,
      public records, bankruptcies, mortgages
    - **Exposure:** amount still owed (EAD), share of principal already repaid, late fees
    - **Collections state:** days past due (older debt recovers less) and phone reachability
  - The model: $\rho_i = P(\text{pays anything}) \times \mathbb{E}[\text{rate} \mid \text{pays}] \times e^{-0.004(\text{dpd}_i-30)}$
  - Model AUC **0.77**, versus **0.53** for grade alone.
- **Visual:** bar chart of recovery rate by grade (nearly flat), with a callout: "grade barely separates accounts".
- **Say:**
  - Grade is set when the loan is issued, so it is an input, not a prediction.
  - On its own, grade is almost a coin flip at telling who will pay.
  - We therefore trained a two-part gradient-boosting model on 24 features. Its output $\rho_i$ is the starting
    point for every strategy.

---

## Slide 3 — Strategies to recover the debt

- **Message:** Six channels, each a trade-off between recovery, cost and scarce resources.
- **On the slide:**

  | $k$ | Strategy | Lift $\lambda_k$ | Cost (THB) | Uses |
  | :-: | :--- | :-: | :--- | :--- |
  | 0 | No action / self-cure | 0.30 | 0 | – |
  | 1 | SMS + LINE OA | 0.55 | 25 | – |
  | 2 | Call center | 1.00 | 350 | 0.75 agent-hours |
  | 3 | Field visit | 1.40 | 1,800 | 1 field slot |
  | 4 | Collection agency | 1.70 | 500 + 25 % commission | hard-collection cap |
  | 5 | Legal action | 2.30 | 8,000 + 2 % of balance | hard cap + ฿40,000 law-firm retainer |

  - Recovery rate: $r_{i,k} = \min(0.90,\ \rho_i \lambda_k u_{i,k})$. SMS and calls drop to 40 % if the phone is
    unreachable.
- **Visual:** a ladder or staircase from "soft" (SMS) to "hard" (legal), with cost rising alongside.
- **Say:**
  - The call center is the reference channel (lift 1).
  - Legal action is the strongest, but it needs a law firm on retainer, which is paid once and only worth it if at
    least 3 cases are filed.
  - This "all-or-nothing" package is what makes the problem hard, as we will see later.

---

## Slide 4 — Dataset

- **Message:** Real defaulted-loan data, converted into a Thai-baht collection book.
- **On the slide:**
  - **Source:** LendingClub Loan Data (Kaggle): 2.26 M loans, 145 columns, 1.19 GB.
  - **Pipeline:**
    1. 2,260,668 loans
    2. 262,447 defaulted
    3. 260,640 after removing exposures under \$500
    4. 300-account pool, stratified by grade
    5. **N = 30 main instance** (฿9.04 M outstanding)
  - **Conversion:** balance $B_i = 33 \times \text{EAD}_i$ THB.
  - **Synthetic fields (seed 613):** `dpd` and `reachable`, clearly labelled as synthetic.
- **Visual:** a funnel graphic for the row counts, plus a sample of 3 rows from `data/accounts_N30.csv`
  (`account_id`, `grade`, `dpd`, `reachable`, `balance_thb`, `rho`).
- **Say:**
  - We used LendingClub because it records real money recovered after default.
  - It has no days-past-due or phone-status fields, so we generated those with a fixed seed and say so openly.

---

## Slide 5 — Formulation (single objective)  *(2 minutes)*

- **Message:** A 0/1 assignment model: one strategy per account, maximise net recovery, respect five limits.
- **On the slide:**
  - **Decision variables:**
    - $x_{i,k} = 1$ if account $i$ gets strategy $k$
    - $y = 1$ if the law firm is engaged
  - **Objective:**
    $$\max Z = \sum_{(i,k)\in A}\big(\mathbb{E}[R_{i,k}](1-\varphi_k) - c_{i,k}\big)x_{i,k} - F y$$
  - **Constraints:**
    - (C1) exactly one strategy per account
    - (C2) budget ≤ ฿150,000
    - (C3) call hours ≤ 12
    - (C4) field visits ≤ 5
    - (C5) agency + legal ≤ 10
    - (C6) legal only if the firm is engaged: $x_{i,5} \le y$
    - (C7) at least 3 legal cases if engaged: $3y \le \sum_i x_{i,5}$
  - **Eligibility set $A$:**
    - no legal action for balances under ฿100k
    - no "no action" when DPD ≥ 90
- **Visual:** the formula on the left; on the right, a small legend mapping each constraint to a real-world rule
  ("only 5 field officers", "conduct limit", etc.).
- **Say:**
  - $Fy$ is a fixed charge.
  - The linking constraint is written per account because that gives a tighter LP relaxation and so a stronger
    Branch & Bound.
  - The model has 160 binary variables, 1 retainer variable and 61 constraints.

---

## Slide 6 — Multi-objective formulation

- **Message:** Recovering more costs more, so we show the whole trade-off rather than one answer.
- **On the slide:**
  - $\max f_1 = \sum \mathbb{E}[R_{i,k}]\,x_{i,k}$ (gross recovery)
  - $\min f_2 = \sum c_{i,k}x_{i,k} + Fy$ (total cost)
  - **ε-constraint method:** maximise $f_1$ subject to $f_2 \le \varepsilon$, for ε from ฿10k to ฿400k (27 values).
- **Visual:** a sketch of a Pareto curve (cost on the x-axis, recovery on the y-axis). Label it "expected shape;
  results in the final report".
- **Say:** management can pick a budget and see the best recovery available at that budget.

---

## Slide 7 — Problem size

- **Message:** Far too many plans to check one by one.
- **On the slide:**
  - Unrestricted: $6^{30} \approx 2.2\times10^{23}$
  - With eligibility rules: $4^1 \cdot 5^{18} \cdot 6^{11} \approx 5.54 \times 10^{21}$
  - That is $1.8\times10^{15}$ times the course minimum of $3\times10^6$.
  - At $10^9$ checks per second, enumeration would take about **175,000 years**.
- **Visual:** one big number with a log-scale bar comparing $3\times10^6$ with $5.5\times10^{21}$.
- **Say:** this is why we need exact optimization and meta-heuristics instead of brute force.

---

## Slide 8 — Solution methods and parameter settings  *(2 minutes)*

- **Message:** Exact methods give the true optimum; meta-heuristics are tested against it.
- **On the slide:**
  - **Exact methods:**
    - MILP solved by HiGHS (branch-and-cut, 60 s limit)
    - Hand-written Branch & Bound: best-bound first, branch on $y$ first, Greedy start, 20,000-node limit
  - **Meta-heuristics:**
    - **Encoding:** integer vector $a_i \in K_i$
    - **Fitness:** $Z - 10^5 \cdot \text{violation}$
    - **GA:** population 120, 400 generations, tournament size 3, uniform crossover $p_c = 0.9$,
      mutation $p_m = 1.5/N$, 2 elites
    - **SA:** $T_0 = 10^6$, $\alpha = 0.99975$, 60,000 iterations, one-gene move plus a swap with probability 0.3
  - **Baselines and bounds:** LP relaxation (with shadow prices), DP on the budget only, Greedy.
- **Visual:** two columns, "Exact" and "Meta-heuristic", with a small chromosome picture
  `[2 | 5 | 1 | 3 | 5 | 4 | …]`.
- **Say:**
  - The GA and SA encoding always gives every account one allowed strategy, so only the resource limits need a
    penalty.
  - SA needs a high starting temperature, because opening the legal channel means paying the retainer *and*
    filing 3 cases at once, which single moves cannot do without first getting worse.

---

## Slide 9 — Experimental plan

- **Message:** How we will judge the methods.
- **On the slide:**
  - **Instances:** N = 30 (main), N = 100 and N = 300 (scaling).
  - **Runs:** 10 seeds each for GA and SA.
  - **Quality measures:** objective, gap to optimum $Z^*$, feasibility, best/mean/standard deviation, hit rate.
  - **Speed measures:** wall-clock time and convergence curves.
  - **Verification:**
    - B&B confirms the MILP optimum
    - GA and SA answers are re-checked against every constraint
  - **Sensitivity:** shadow prices, checked by re-solving (for example, "is one more field slot worth it?").
- **Visual:** a checklist, or an empty results table with column headers only (Method | Objective | Gap | Time |
  Feasible).
- **Say:** the final report will fill in this table.

---

## Slide 10 — Interactive simulator (optional live demo)

- **Message:** The model runs in the browser, so users can change priorities and re-solve.
- **On the slide:** a screenshot of `frontend/index.html`.
  - Strategy cards with priority sliders $\pi_k$
  - Resource limits
  - Choice of N from 5 to 300
  - In-browser HiGHS MILP, GA and SA
- **Visual:** a full-width screenshot. For the demo, keep the page open in a browser tab beforehand. It needs
  internet for HiGHS and Chart.js.
- **Say:** for example, the "customer-friendly" preset favours SMS and calls over legal action.

---

## Slide 11 — Assumptions and scope

- **Message:** What the model does and does not claim.
- **On the slide:**
  - **Assumptions:**
    - expected-value objective
    - accounts are independent
    - strategy lifts are planning values
    - 33 THB/USD
    - `dpd` and `reachable` are synthetic
  - **In scope:** one collection cycle, N = 30 main instance, six strategies.
  - **Out of scope:**
    - multi-period sequencing
    - agent scheduling and routing
    - risk measures (CVaR)
- **Say:** be upfront that the lifts are assumptions; a real bank would estimate them from A/B tests.

---

## Slide 12 — Summary and next steps

- **Message:** A real problem that meets every course requirement and has a clear plan.
- **On the slide:**
  - ✅ Real data, converted to THB
  - ✅ MILP with fixed charge
  - ✅ GA and SA
  - ✅ Multi-objective ε-constraint
  - ✅ $5.5\times10^{21}$ solutions
  - **Next:**
    1. Run the full experiments
    2. Build the meta-heuristic Pareto front
    3. Scaling tests
    4. Final report (results, discussion, verification)
- **Say:** close with the one-line problem statement from slide 1, then invite questions.

---

## Backup slides (only if asked)

- **References:**
  - LendingClub (Kaggle)
  - Debt Collection Act B.E. 2558
  - Sinha & Zoltners (1979), the multiple-choice knapsack problem
  - Land & Doig (1960), Branch & Bound
  - Haimes et al. (1971), ε-constraint
  - Goldberg (1989), GA
  - Kirkpatrick et al. (1983), SA
  - HiGHS
- **DP formulation:**
  - stage = account
  - state = remaining budget
  - $f_s(b) = \max_k\{W_{s,k} + f_{s+1}(b - c_{s,k})\}$
  - Explain why adding more resources leads to the curse of dimensionality.
- **Why not grade alone:** ROC curves for the full model (AUC 0.77) and grade only (AUC 0.53).
- **Full parameter table:** §5.2 of the proposal.

---

## Presenter checklist

- [ ] Replace the name and ID placeholders.
- [ ] Draw the slide 1 workflow as a proper diagram (not ASCII).
- [ ] Make the slide 2 chart from `data/model_report.json` (grade profile).
- [ ] Take the simulator screenshot for slide 10.
- [ ] Keep each slide to one message, at most 6 bullets, and formulas only on slides 2, 3, 5, 6 and 7.
- [ ] Rehearse slides 5 and 8; they carry most of the course content.
