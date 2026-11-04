# Debt Collection Strategy Allocation in Thai Baht

**CPE 613 Optimization Methods — Term Project Proposal**

| | |
| :--- | :--- |
| **Project name** | Debt Collection Strategy Allocation using Mathematical Programming and Meta-Heuristics |
| **Student name** | _[Full name]_ (Student ID: _[ID]_) |
| **Course** | CPE 613 Optimization Methods, 2026 |
| **Problem category** | Financial modelling / resource allocation (multiple-choice knapsack with side constraints) |
| **Date** | 4 November 2026 |

> This proposal follows the *CPE 613 Term Project Report Guideline*. It covers items 1–8 and 11. Items 9
> (Experimental results) and 10 (Result discussion and verification) are left for the final report.

---

## 1. Project name

**Debt Collection Strategy Allocation using Mathematical Programming and Meta-Heuristics**
(การจัดสรรกลยุทธ์การติดตามหนี้ด้วยการโปรแกรมเชิงคณิตศาสตร์และเมตาฮิวริสติก)

## 2. Student name

_[Full name]_ — Student ID _[ID]_

---

## 3. Project description and scope

### 3.1 Problem description

A Thai consumer lender holds a book of delinquent loan accounts. For each account, the collections team must
choose **one** collection strategy:

| $k$ | Strategy | Thai |
| :-: | :--- | :--- |
| 0 | No action / self-cure | ไม่ดำเนินการ |
| 1 | SMS + LINE OA reminder | SMS / LINE |
| 2 | In-house call center | คอลเซ็นเตอร์ |
| 3 | Field collector visit | ลงพื้นที่ |
| 4 | External collection agency | บริษัทติดตามหนี้ |
| 5 | Legal action through a law firm | ดำเนินคดี |

Stronger strategies recover more money, but they cost more and use scarce resources: collection budget,
call-center agent-hours, field-visit slots and a customer-conduct limit on "hard" collection. Legal action
also needs a law firm on retainer, which is paid once and only pays off if enough cases are filed.

The task is to **assign one strategy to each account so that the expected net recovery, in Thai baht (THB),
is as large as possible** within these limits. This is a combinatorial assignment problem: a
*multiple-choice knapsack* with extra capacity constraints and a fixed charge.

### 3.2 Why this problem fits the course

The term project brief asks for a problem that is:

| Requirement in the brief | How this project meets it |
| :--- | :--- |
| Solved with a traditional mathematical programming technique | Mixed-integer linear program (MILP), solved exactly with HiGHS and with a hand-written Branch & Bound |
| Solved with a meta-heuristic such as GA or SA | Genetic Algorithm **and** Simulated Annealing, both written from scratch |
| Single-objective first | Maximise expected net recovery (§5.4) |
| Then multiple objectives at once | Maximise gross recovery and minimise collection cost; ε-constraint Pareto front (§5.5) |
| At least $3 \times 10^6$ possible solutions | About $5.5 \times 10^{21}$ feasible-by-eligibility assignments for N = 30 (§7) |
| Topic from the suggested list | *Financial Modeling* and *Knapsack Problem* categories |

### 3.3 Objectives of the study

1. Build a realistic Thai-baht collection book from real defaulted-loan data.
2. Formulate the strategy-allocation problem as a single-objective MILP and as a bi-objective problem.
3. Solve it with exact methods (MILP, Branch & Bound) and meta-heuristics (GA, SA).
4. Compare the methods on solution quality (gap to the proven optimum), feasibility and computation time.
5. Build the trade-off curve between recovery and cost, and read business insights from it.
6. Provide an interactive browser simulator so the user can change strategy priorities and limits and re-solve.

### 3.4 Scope

**In scope**

* One planning period (one collection cycle): every account gets exactly one strategy.
* Main instance: **N = 30 accounts**. Scale tests on the 300-account pool.
* Six strategies, four shared resources (budget, call hours, field slots, hard-collection cap), one law-firm
  retainer decision.
* Expected-value (risk-neutral) objective.
* Implementation in Python (SciPy/HiGHS, NumPy, scikit-learn) and a single-file HTML simulator.

**Out of scope**

* Multi-period sequencing (for example, SMS this week and a call next week if still unpaid).
* Scheduling individual agents or routing field collectors.
* Risk measures such as variance or CVaR of recovery.
* Live deployment on real Thai bank data.

### 3.5 Planned deliverables

| Deliverable | Description |
| :--- | :--- |
| Dataset | Extracted LendingClub defaulted loans and a 300-account THB pool |
| Recovery model | Machine-learning model that predicts each account's base recovery rate |
| Optimizer | Python module with MILP, B&B, LP relaxation, DP, Greedy, GA, SA and Pareto routines |
| Simulator | `frontend/index.html`: in-browser MILP (HiGHS WebAssembly) and heuristics |
| Final report | Proposal items plus experimental results, discussion and verification |

---

## 4. Assumptions

1. **Expected value.** The strategy is chosen before the outcome is known, so the model maximises expected
   recovery $\mathbb{E}[R_{i,k}] = B_i\,r_{i,k}$ (risk-neutral decision maker).
2. **Independence between accounts.** The recovery of one account does not depend on the strategy given to
   another.
3. **Strategy effect as a multiplier.** Each strategy multiplies a data-driven base recovery rate $\rho_i$ by a
   fixed lift $\lambda_k$. The call center is the reference channel ($\lambda_2 = 1$). Lifts are planning
   assumptions, because LendingClub does not record which channel produced a recovery.
4. **Recovery cap.** No strategy can recover more than 90 % of the balance in one cycle.
5. **Unreachable debtors.** If the phone number does not work, SMS and call recovery is reduced to 40 % of
   normal.
6. **Currency.** USD amounts are converted at a fixed **33.0 THB/USD** (October 2026 rate ≈ 33.1–33.3;
   2026 range 30.9–33.8). The rate is a parameter.
7. **Costs are deterministic** planning figures for a Thai lender (SMS gateway, agent time, travel, handover
   fee, court and lawyer fees). Agency commission is 25 % of the amount recovered, close to the 16.6 % average
   collection fee seen in the data.
8. **Regulation.** The *Debt Collection Act B.E. 2558 (2015)* limits how and how often debtors may be
   contacted. This is modelled with the hard-collection cap $M$ and with limited agent-hours, not with
   per-contact rules.
9. **Synthetic fields.** Days past due (`dpd`) and phone reachability (`reachable`) are not in LendingClub.
   They are generated with a fixed random seed (613) and labelled as synthetic.
10. **Eligibility rules.** Legal action is not allowed for balances under ฿100,000, and accounts that are 90 or
    more days past due cannot be left with "no action".

---

## 5. Model formulation with notation description

### 5.1 Sets

| Symbol | Meaning |
| :--- | :--- |
| $I = \{1,\dots,N\}$ | delinquent accounts (N = 30 for the main instance) |
| $K = \{0,\dots,5\}$ | collection strategies (§3.1) |
| $A \subseteq I \times K$ | allowed account–strategy pairs: $(i,5)\notin A$ if $B_i < ฿100{,}000$; $(i,0)\notin A$ if $\text{dpd}_i \ge 90$ |
| $K_i = \{k : (i,k)\in A\}$ | strategies allowed for account $i$ |

### 5.2 Parameters

| Symbol | Meaning | Default value |
| :--- | :--- | ---: |
| $B_i$ | outstanding balance of account $i$ (THB) | from data |
| $\rho_i$ | predicted base recovery rate of account $i$ | from ML model, $[0.01, 0.60]$ |
| $\lambda_k$ | recovery lift of strategy $k$ | 0.30, 0.55, 1.00, 1.40, 1.70, 2.30 |
| $r_{i,k}$ | recovery rate: $\min(0.90,\ \rho_i \lambda_k u_{i,k})$ | derived |
| $u_{i,k}$ | reachability factor: 0.40 if $k\in\{1,2\}$ and phone unreachable, else 1 | derived |
| $\mathbb{E}[R_{i,k}]$ | expected gross recovery $B_i\,r_{i,k}$ | derived |
| $c_{i,k}$ | direct cost: 0, 25, 350, 1,800, 500, 8,000 + 2 % of $B_i$ | THB |
| $\varphi_k$ | commission share (25 % for agency, 0 otherwise) | 0.25 |
| $v_{i,k}$ | true net value $\mathbb{E}[R_{i,k}](1-\varphi_k) - c_{i,k}$ | derived |
| $h_k$ | agent-hours per account ($h_2 = 0.75$, else 0) | 0.75 h |
| $B_{\max}$ | collection budget | ฿150,000 |
| $H$ | call-center agent-hours available | 12 h |
| $V$ | field-visit slots | 5 |
| $M$ | maximum accounts in hard collection (agency + legal) | 10 |
| $F$ | law-firm retainer, paid once if any case is filed | ฿40,000 |
| $L$ | minimum number of legal cases if the firm is engaged | 3 |
| $w_i$ | account priority weight (equal, or by balance, DPD or grade) | 1, range $[1, 1.5]$ |
| $\pi_k$ | strategy priority weight (user preference in the simulator) | 1, range $[0.5, 1.5]$ |

### 5.3 Decision variables

$$
x_{i,k} = \begin{cases}1 & \text{if strategy } k \text{ is assigned to account } i\\0 & \text{otherwise}\end{cases}
\qquad (i,k)\in A
$$

$$
y = \begin{cases}1 & \text{if the law firm is engaged (retainer paid)}\\0 & \text{otherwise}\end{cases}
$$

### 5.4 Single-objective model (MILP)

**Objective — maximise expected net recovery (THB):**

$$
\max_{x,y}\; Z = \sum_{(i,k)\in A} \Big( w_i\,\pi_k\,\mathbb{E}[R_{i,k}]\,(1-\varphi_k) - c_{i,k} \Big)\,x_{i,k} \;-\; F\,y
$$

With $w_i = \pi_k = 1$ (the default), $Z$ is the true expected net recovery $\sum v_{i,k}x_{i,k} - Fy$.

**Constraints:**

$$
\begin{aligned}
&\textstyle\sum_{k\in K_i} x_{i,k} = 1 && \forall i\in I && \text{(C1) one strategy per account}\\
&\textstyle\sum_{(i,k)\in A} c_{i,k}\,x_{i,k} + F\,y \le B_{\max} && && \text{(C2) collection budget}\\
&\textstyle\sum_{i\in I} h_2\,x_{i,2} \le H && && \text{(C3) call-center hours}\\
&\textstyle\sum_{i\in I} x_{i,3} \le V && && \text{(C4) field-visit slots}\\
&\textstyle\sum_{i\in I} (x_{i,4}+x_{i,5}) \le M && && \text{(C5) hard-collection cap}\\
&x_{i,5} \le y && \forall i:(i,5)\in A && \text{(C6) legal only if the firm is engaged}\\
&L\,y \le \textstyle\sum_{i} x_{i,5} && && \text{(C7) minimum legal package}\\
&x_{i,k}\in\{0,1\},\; y\in\{0,1\} && && \text{(C8) binary variables}
\end{aligned}
$$

**Notes on the formulation**

* $F y$ is a *fixed charge*: the retainer is paid once, whatever the number of cases.
* (C6) is written per account rather than as $\sum_i x_{i,5} \le N y$, because the per-account form gives a
  tighter LP relaxation and so a stronger bound for Branch & Bound.
* (C6) and (C7) together mean "if the firm is engaged, file at least $L$ cases; otherwise file none".
* Eligibility rules are handled by defining variables only on $A$, not with extra constraints.

### 5.5 Multi-objective model

The two business goals conflict, since recovering more costs more:

$$
\begin{aligned}
\max\; f_1(\mathbf{x}) &= \textstyle\sum_{(i,k)\in A}\mathbb{E}[R_{i,k}]\,x_{i,k} && \text{(gross expected recovery)}\\
\min\; f_2(\mathbf{x},y) &= \textstyle\sum_{(i,k)\in A}c_{i,k}\,x_{i,k} + F y && \text{(total collection cost)}
\end{aligned}
$$

subject to (C1) and (C3)–(C8).

The Pareto front will be built with the **ε-constraint method**: maximise $f_1$ subject to $f_2 \le \varepsilon$
and all other constraints, for a sweep of $\varepsilon$ values (§8.4).

### 5.6 Model size (N = 30)

| Item | Count |
| :--- | ---: |
| Binary assignment variables $x_{i,k}$ (one per allowed pair) | 160 |
| Retainer variable $y$ | 1 |
| Assignment constraints (C1) | 30 |
| Resource constraints (C2)–(C5) | 4 |
| Linking constraints (C6) (one per legal-eligible account) | 26 |
| Minimum legal package (C7) | 1 |

---

## 6. Input dataset

### 6.1 Source

* **Dataset:** *LendingClub Loan Data* (Kaggle), file `loan.csv`: 2,260,668 US consumer loans, 145 columns,
  1.19 GB.
* **Why this dataset:** it contains real post-default recovery data (`recoveries`,
  `collection_recovery_fee`) together with borrower risk features, which is what a collection model needs.

### 6.2 Extraction and cleaning

| Step | Rule | Result |
| :--- | :--- | ---: |
| Filter defaulted loans | `loan_status` ∈ {Charged Off, Default, Does not meet the credit policy. Status:Charged Off} | 262,447 loans |
| Exposure at default | $\text{EAD} = \texttt{funded\_amnt} - \texttt{total\_rec\_prncp}$ | – |
| Remove tiny exposures | drop EAD < \$500 | 260,640 loans |
| Observed recovery rate | $\texttt{recoveries} / \text{EAD}$, clipped to $[0,1]$ | mean ≈ 10.6 % |
| Convert to THB | $B_i = 33 \times \text{EAD}_i$, rounded to ฿100 | – |

### 6.3 Recovery model (pre-processing step)

The optimizer needs the base recovery rate $\rho_i$ of every account. It is predicted with a two-part
("hurdle") model:

$$
\rho_i = P(\text{recovery}>0 \mid \mathbf{z}_i)\;\times\;\mathbb{E}[\text{rate}\mid \text{recovered},\mathbf{z}_i]\;\times\; e^{-0.004(\text{dpd}_i - 30)},
\qquad \rho_i\in[0.01, 0.60]
$$

* **Algorithms:** scikit-learn `HistGradientBoostingClassifier` and `HistGradientBoostingRegressor`
  (300 trees, learning rate 0.08), 75/25 train/test split.
* **Features (24):** grade, sub-grade, interest rate, term, instalment, income, DTI, employment length,
  revolving utilisation and balance, open/total accounts, inquiries, delinquencies, public records,
  bankruptcies, mortgages, EAD, share of principal already repaid, late fees, issue year, home ownership,
  verification status and loan purpose.
* **Leakage control:** `recoveries`, `collection_recovery_fee` and `total_pymnt` are excluded from the features.
* **Validation check:** the full model separates recovering from non-recovering accounts much better than
  grade alone (test AUC 0.77 vs 0.53), so it is used instead of a grade lookup table.

### 6.4 Project portfolio (optimizer input)

* **300-account pool**, stratified by grade: A 25, B 50, C 75, D 65, E 45, F 25, G 15.
* **Main instance:** the first 30 accounts, ฿9,037,800 outstanding in total.
* **Synthetic fields (seed 613):**

| Field | Generation rule | Purpose |
| :--- | :--- | :--- |
| `dpd` (days past due) | 30 / 60 / 90 / 120 / 180 with probabilities .30 / .25 / .20 / .15 / .10 | recovery decay; must-act rule |
| `reachable` | Bernoulli(0.85), or 0.70 for grades E–G | weakens SMS and call for unreachable debtors |

**Fields per account** (`data/accounts_N30.csv`): `account_id`, `grade`, `sub_grade`, `int_rate`, `term_m`,
`dpd`, `reachable`, `balance_thb`, `annual_inc_thb`, `dti`, `p_pay`, `rate_if_pay`, `rho`.

### 6.5 Strategy parameters

| $k$ | Strategy | Lift $\lambda_k$ | Cost $c_{i,k}$ (THB) | Commission $\varphi_k$ | Resource used |
| :-: | :--- | :-: | :--- | :-: | :--- |
| 0 | No action | 0.30 | 0 | – | – |
| 1 | SMS + LINE | 0.55 | 25 | – | – |
| 2 | Call center | 1.00 | 350 | – | 0.75 agent-hours |
| 3 | Field visit | 1.40 | 1,800 | – | 1 field slot |
| 4 | Agency | 1.70 | 500 | 25 % | hard-collection cap |
| 5 | Legal action | 2.30 | 8,000 + 2 % of $B_i$ | – | hard-collection cap, retainer $F$ |

---

## 7. Problem size or number of possible solutions

**Without eligibility rules**, each of the 30 accounts can take any of 6 strategies:

$$
6^{30} \approx 2.2 \times 10^{23} \text{ assignments.}
$$

**With the eligibility set $A$**, the N = 30 instance has 1 account with 4 allowed strategies, 18 accounts with 5
and 11 accounts with 6. The number of candidate assignments is

$$
\prod_{i\in I}\lvert K_i\rvert = 4^{1}\cdot 5^{18}\cdot 6^{11} \approx 5.54 \times 10^{21}.
$$

(The retainer $y$ is implied by the assignment: $y = 1$ exactly when some account gets legal action.)

This is about $1.8 \times 10^{15}$ times the course minimum of $3 \times 10^{6}$. At $10^{9}$ evaluations per
second, full enumeration would take about 175,000 years, so exhaustive search is not an option and
proper optimization methods are needed. The 300-account pool is far larger still ($\approx 2 \times 10^{219}$).

---

## 8. Algorithm and parameter setting

### 8.1 Methods

| Method | Role | Implementation | Guarantee |
| :--- | :--- | :--- | :--- |
| **MILP (HiGHS)** | main exact method | `scipy.optimize.milp` (Python); `highs-js` 1.15.3 (browser) | global optimum |
| **Branch & Bound** | exact method, written by hand | LP relaxations with `scipy.optimize.linprog` | global optimum, with a node log |
| **Genetic Algorithm** | main meta-heuristic | custom Python / JavaScript | none |
| **Simulated Annealing** | main meta-heuristic | custom Python / JavaScript | none |
| LP relaxation | upper bound and shadow prices | HiGHS LP | upper bound |
| Dynamic Programming | relaxation using only the budget | NumPy, budget as state | optimum of the relaxed problem |
| Greedy | simple baseline | value per extra baht | none |

### 8.2 Traditional mathematical programming

**MILP with HiGHS.** The model in §5.4 is passed to HiGHS (branch-and-cut), with a time limit of 60 s. The result is
the reference optimum $Z^*$ used to measure every other method.

**Custom Branch & Bound.**

* LP relaxation at every node.
* Best-bound-first node selection.
* Branch on $y$ first, then on the most fractional $x_{i,k}$.
* Starting incumbent: the Greedy solution.
* A node is pruned when its LP bound is no better than the incumbent.
* Node limit 20,000.
* Output: nodes explored, nodes pruned, root LP bound and integrality gap.

**Dynamic Programming (relaxation).** Keeping only the budget constraint turns the problem into a
multiple-choice knapsack that DP solves exactly:

* stage $s$ = account $s$;
* state $b$ = remaining budget in ฿100 units;
* decision $k \in K_s$;
* $f_s(b) = \max_{k}\{W_{s,k} + f_{s+1}(b - \lceil c_{s,k}\rceil)\}$, with $f_{N+1}(\cdot) = 0$;
* run twice, once with $y=0$ and once with $y=1$ (budget $B_{\max}-F$), and keep the better result.

Adding hours, field slots and the hard cap would make the state four-dimensional (the *curse of
dimensionality*), so DP is used as a bound, not as the main solver.

**Greedy baseline.** Start each account on its cheapest allowed strategy. Then repeatedly apply the single
upgrade with the highest gain per extra baht that keeps every constraint satisfied.

### 8.3 Meta-heuristics

Both meta-heuristics use the same **encoding** and **fitness**:

* **Solution encoding:** integer vector $\mathbf{a} = (a_1,\dots,a_N)$, where $a_i \in K_i$ is the strategy of
  account $i$. Genes are sampled only from allowed strategies, so constraint (C1) and the eligibility rules always
  hold. The retainer is implied: $y = 1$ if any $a_i = 5$.
* **Fitness (penalty method):**
  $\text{fit}(\mathbf{a}) = Z(\mathbf{a}) - \mu\cdot\text{viol}(\mathbf{a})$, with $\mu = 10^5$.
  `viol` is the budget overrun in ฿1,000 units, plus 10 × each unit of capacity overrun (hours, field slots,
  hard cap), plus 10 × each missing legal case under (C7).

**Genetic Algorithm — parameter setting**

| Parameter | Value |
| :--- | :--- |
| Population size | 120 |
| Generations | 400 |
| Selection | tournament, size 3 |
| Crossover | uniform, $p_c = 0.9$ |
| Mutation | per gene, $p_m = 1.5/N$ (resample from $K_i$) |
| Elitism | 2 best individuals kept |
| Initial population | random allowed strategies |

**Simulated Annealing — parameter setting**

| Parameter | Value |
| :--- | :--- |
| Initial solution | random allowed assignment |
| Neighbourhood move | change one gene to another allowed strategy; with probability 0.3 also swap two genes |
| Acceptance rule | Metropolis: accept a worse move with probability $e^{\Delta/T}$ |
| Initial temperature $T_0$ | $10^6$ |
| Cooling schedule | geometric, $T \leftarrow \alpha T$, $\alpha = 0.99975$ |
| Iterations | 60,000 |

The high $T_0$ is chosen on purpose. Engaging the law firm means paying $F$ and filing at least $L = 3$ cases at
the same time, so single-gene moves must cross a deep "valley" in the objective. Parameter tuning will
confirm whether lower temperatures get stuck there.

### 8.4 Multi-objective procedure

* **Exact front:** ε-constraint with the MILP, $\varepsilon$ swept over 27 values from ฿10,000 to ฿400,000.
  Only distinct, non-dominated points are kept.
* **Meta-heuristic front:** GA and SA run on the same ε values, with $f_1$ as the objective and $f_2 \le \varepsilon$
  as a penalised constraint. Each point is then compared directly with the exact front.
* **Sensitivity analysis:** LP shadow prices of (C2)–(C5), checked by re-solving the MILP with one more unit of
  each resource. This answers "is one more field slot or agent-hour worth buying?".

### 8.5 Experimental design (to be reported in the final report)

| Item | Setting |
| :--- | :--- |
| Instances | N = 30 (main); N = 100 and N = 300 from the pool for scaling |
| Runs | 1 run for deterministic methods; 10 independent seeds for GA and SA |
| Quality measures | objective value, gap to $Z^*$ in %, feasibility, best / mean / standard deviation over seeds, hit rate (runs that reach $Z^*$) |
| Time measure | wall-clock seconds on the same machine |
| Convergence | best-so-far fitness against generation or iteration |
| Verification | GA/SA solutions re-checked against every constraint; MILP optimum confirmed by the custom B&B |
| Reproducibility | fixed random seed 613; one script per pipeline step |

### 8.6 Tools

* **Python 3.14** with NumPy, pandas, SciPy (HiGHS), scikit-learn and Matplotlib.
* **Browser simulator:** HTML + JavaScript, `highs-js` 1.15.3 (WebAssembly) and Chart.js. The user can edit
  strategy costs and lifts, set priority weights $\pi_k$, change resource limits, and re-run every solver.
* Google OR-Tools (suggested in the brief) can be used as a cross-check solver.

---

## 9.–10. Experimental results; discussion and verification

Not part of the proposal. These will be included in the final report.

---

## 11. References

1. CPE 613 Optimization Methods. *Term Project Information*, 2026.
2. LendingClub Loan Data. Kaggle dataset `adarshsng/lending-club-loan-data-csv`.
   https://www.kaggle.com/datasets/adarshsng/lending-club-loan-data-csv
3. *Debt Collection Act B.E. 2558 (2015)*, Kingdom of Thailand, Royal Gazette.
4. Tilleke & Gibbins (2015). Overview of Thailand's new Debt Collection Act.
5. Sinha, P., & Zoltners, A. A. (1979). The multiple-choice knapsack problem. *Operations Research*, 27(3),
   503–515.
6. Kellerer, H., Pferschy, U., & Pisinger, D. (2004). *Knapsack Problems*. Springer.
7. Land, A. H., & Doig, A. G. (1960). An automatic method of solving discrete programming problems.
   *Econometrica*, 28(3), 497–520.
8. Huangfu, Q., & Hall, J. A. J. (2018). Parallelizing the dual revised simplex method. *Mathematical
   Programming Computation*, 10(1), 119–142. (HiGHS)
9. Haimes, Y. Y., Lasdon, L. S., & Wismer, D. A. (1971). On a bicriterion formulation of the problems of
   integrated system identification and system optimization. *IEEE Transactions on Systems, Man, and
   Cybernetics*, SMC-1(3), 296–297. (ε-constraint method)
10. Goldberg, D. E. (1989). *Genetic Algorithms in Search, Optimization, and Machine Learning*.
    Addison-Wesley.
11. Kirkpatrick, S., Gelatt, C. D., & Vecchi, M. P. (1983). Optimization by simulated annealing. *Science*,
    220(4598), 671–680.
12. Virtanen, P., et al. (2020). SciPy 1.0: Fundamental algorithms for scientific computing in Python.
    *Nature Methods*, 17, 261–272.
13. Pedregosa, F., et al. (2011). Scikit-learn: Machine learning in Python. *Journal of Machine Learning
    Research*, 12, 2825–2830.
14. Google OR-Tools. https://developers.google.com/optimization
