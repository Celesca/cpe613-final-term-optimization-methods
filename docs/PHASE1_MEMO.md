# Phase I Engineering Memo: Scaling, Statistical Benchmarks & Contract Invariance

**Project:** Debt Collection Strategy Allocation (`CPE 613`)  
**Team:** Yuil Tripathee (`69070701612`), Sawit Koseeyaumporn (`69070701621`)  
**Reproducibility Script:** `src/03b_phase1_benchmark.py` (uses `src/optimizer.py`, fixed seeds `0, 1, 2`)  
**Generated Artifacts:** `data/phase1_benchmark.json`, `data/phase1_summary_table.csv`, `data/phase1_seed_runs.csv`, `docs/fig_p1_*.png`

---

## 1. Executive Takeaways (Layman & Operations Summary)

1. **What the optimizer does in plain terms:** Given overdue loans (`balance`, delinquency age `dpd`, phone reachability, and ML base payment probability $\rho_i$), it picks **one collection channel per loan** (Do Nothing, SMS/LINE, Call Center, Field Visit, Agency, Legal) to maximize net cash recovered after subtracting execution costs and agency commissions—subject to budget, staff hours, doorstep slots, regulatory hard-collection limits, and a ฿40,000 law-firm retainer.
2. **Why `N = 30 -> 100 -> 300` requires fixed contract terms (`F = ฿40,000`, `L = 3`):**
   * Operational capacities ($B_{\max}, H, V, M$) represent bank staff and budget pools that scale proportionally with portfolio volume (`×10/3` at $N=100$, `×10` at $N=300$—matching `"scaled ×10"` in `DOCUMENTATION.md` §14, not 10%).
   * Law-firm terms ($F = \text{THB~}40{,}000$, minimum $L = 3$ lawsuits) belong to one external retainer contract ($y \in \{0,1\}$) and stay invariant with $N$.
   * **Empirical confirmation:** When $L$ stayed fixed at $3$, SA stayed within **`0.26%–0.68%`** of optimal on $N=100$ and $N=300$. When $L$ was mistakenly scaled to $30$, SA hit a 30-case penalty barrier and stayed trapped at $y=0$ (`19.86%` gap).
3. **What happens under capacity scarcity (`Prop.` vs. `Frozen`):**
   * **Proportional scaling:** Call center (~43%–47% of accounts), field visits (17%), agency (13%–20%), and litigation (13%–20%) maintain stable shares; the legal channel stays profitable even at $N=300$ (`60` lawsuits).
   * **Frozen staff/budget (`N=100, 300` with $N=30$ limits):** With only 12 call hours and 5 visits available for 300 accounts, optimal strategy shifts heavily to cheap digital outreach—SMS/LINE climbs from `3.3%` ($N=30$) to **`77.3%` (`232/300`)**, while the marginal value of 1 call-center hour jumps from **`฿0/h`** to **`฿42,910/h`** and 1 field visit hits **`฿71,653/visit`**.
4. **Algorithmic verdict (honest comparison):**
   * **HiGHS MILP** is the exact reference (`0.40–2.01 s`, `0.00%` gap across all 6 cohorts) because disaggregated linking ($x_{i,5} \le y$) drives the root LP integrality gap down from `1.411%` ($N=30$) to `0.013%` ($N=300$).
   * **Greedy fails structurally (`14.4%–21.0%` gap on Regime 1)** because single-account steps never justify the upfront ฿40k retainer (`y=0`). Its nested $O(N^2 K)$ scan also slows to **`55.70 s` at $N=300$**—nearly **$3\times$ slower** than GA and SA.
   * **Custom Python B&B** verifies `N=30 Unseen B` in `1,697` nodes (`11.80 s`), finds optimal $Z^*$ on `N=30 Main` within 10k nodes (still open due to tied fractional LP leaves; 20k-node run in `results_N30.json` closed at `6,267` nodes), and stalls at the Greedy incumbent (`20.65%` gap) at `1,000` nodes on $N=100$.
   * **Simulated Annealing outperforms Genetic Algorithm** across all 18 paired runs (mean gap **`0.720%` vs `1.816%`**, two-sided Wilcoxon $p = 0.00035$). Uniform crossover disrupts tightly saturated capacity combinations at $N=300$ (`2.29%` GA gap vs `0.68%` SA gap), whereas SA's local flip/swap moves preserve feasibility (`100%` across all runs) and stay flat in runtime (`16.4–29.4 s`).

---

## 2. Phase I Master Summary Table (`seeds = 0, 1, 2`)

| Cohort & Regime | $N$ | Vars / Cons | MILP $Z^*$ (THB) | MILP Time | Root LP Gap | Greedy Gap (Time) | GA Mean Gap (Time) | SA Mean Gap (Time) |
| :--- | :---: | :---: | ---: | :---: | :---: | :---: | :---: | :---: |
| **`N30_main`** (`TH0001–TH0030`) | 30 | 161 / 61 | `1,099,661.34` | `0.40 s` | `1.411%` | `15.63%` (`0.54 s`) | `0.202%` (`15.78 s`) | **`0.000%`** (`16.40 s`) |
| **`N30_unseenB`** (`TH0031–TH0060`) | 30 | 157 / 61 | `1,365,227.21` | `0.56 s` | `1.929%` | `14.38%` (`0.32 s`) | `0.568%` (`14.56 s`) | **`0.000%`** (`17.75 s`) |
| **`N100_prop`** ($\text{caps}\times 3.33$, $L=3$) | 100 | 533 / 191 | `4,260,700.84` | `1.77 s` | `0.086%` | `20.65%` (`5.13 s`) | `0.778%` (`18.97 s`) | **`0.265%`** (`21.79 s`) |
| **`N300_prop`** ($\text{caps}\times 10$, $L=3$) | 300 | 1625 / 576 | `15,493,104.26` | `1.71 s` | `0.013%` | `20.99%` (`55.70 s`) | `2.287%` (`17.18 s`) | **`0.683%`** (`18.31 s`) |
| **`N100_frozen`** ($N=30$ caps fixed) | 100 | 533 / 191 | `2,803,548.13` | `1.61 s` | `1.269%` | `9.50%` (`2.30 s`) | `3.123%` (`14.34 s`) | **`0.456%`** (`16.35 s`) |
| **`N300_frozen`** ($N=30$ caps fixed) | 300 | 1625 / 576 | `7,158,140.96` | `2.01 s` | `1.280%` | `4.19%` (`19.23 s`) | `3.941%` (`21.96 s`) | **`2.914%`** (`29.35 s`) |

*All 36 stochastic runs (`18` GA + `18` SA) returned `100%` constraint feasibility (`violation == 0`).*

---

## 3. SA Initial-Temperature Ablation (`N=30`, 3 Seeds)

| Configuration | Mean Net Recovery | Gap to $Z^*$ | Law Firm Activated (`y=1`) | Interpretation |
| :--- | ---: | :---: | :---: | :--- |
| **`T0 = 20,000`** | `฿944,293.22` (`std=0.0`) | `14.13%` | **`0 / 3`** | Metropolis acceptance too cold to traverse the $F + L\cdot\text{penalty}$ barrier; all seeds freeze in $y=0$ basin |
| **`T0 = 1,000,000`** | `฿1,099,661.34` (`std=0.0`) | **`0.00%`** | **`3 / 3`** | High initial temperature crosses the fixed-charge valley early, then converges cleanly |

---

## 4. Scope Audit Against CPE 613 Phase I Requirements

* Checked `CPE613+term+project+info+2026.pdf` and course syllabus: **no "unseen test case" or "dynamic multi-period" optimization is required for Phase I.**
* Even so, we verified generalization twice: (1) the ML base recovery predictor $\rho_i$ uses a strict 25% held-out test split (`AUC = 0.766` vs `0.530` grade-only), and (2) `N30_unseenB` tests completely unseen debtors (`TH0031–TH0060`) confirming identical behavior (`0.00%` SA gap, `0.57%` GA gap, `1,697` B&B nodes).
* Dynamic multi-period sequencing remains documented out-of-scope for single-period Phase I; multi-objective NSGA-II / HV / GD comparisons belong to Phase II.
