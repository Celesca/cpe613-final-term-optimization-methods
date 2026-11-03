# CPE 613 Term Project: Debt Collection Strategy Allocation

## 1. Executive Summary & Scope

* **Course**: CPE 613 Optimization Methods
* **Project Title**: Debt Collection Strategy Allocation using Mathematical Programming and Meta-Heuristics
* **Problem Category**: Resource Allocation & Combinatorial Assignment Problem (Multidimensional Knapsack / Assignment Variant)
* **Objective**: Optimize the assignment of collection channels (e.g., SMS, Call Center, External Legal Agency) across delinquent credit/loan accounts to maximize net expected dollar recovery while satisfying operational capacity and budget constraints.

---

## 2. Recommended Public Datasets

### A. LendingClub Loan Dataset
* **Source**: [Kaggle - LendingClub Loan Data](https://www.kaggle.com/datasets/adarshsng/lending-club-loan-data-csv)
* **Description**: Contains real historical financial recovery data from defaulted/charged-off consumer loans.
* **Key Columns**:
  * `loan_status`: Filter for `Charged Off` or `Default` accounts.
  * `funded_amnt` / `out_prncp`: Outstanding balance / principal amount owed.
  * `recoveries`: Gross dollar amount recovered post-default.
  * `collection_recovery_fee`: Collection expenses incurred.
  * `grade` / `sub_grade` / `ficoRangeLow`: Risk ratings to estimate default probability and recovery rates.

### B. Default of Credit Card Clients
* **Source**: [UCI Machine Learning Repository](https://archive.ics.uci.edu/dataset/350/default+of+credit+card+clients)
* **Description**: Standard benchmark dataset with 30,000 credit card accounts (6,636 defaulted accounts).
* **Key Columns**:
  * `LIMIT_BAL`: Total credit line.
  * `PAY_0` to `PAY_6`: Historical monthly delinquency flags ($1 = 1\text{ month late}, 2 = 2\text{ months late}, \dots$).
  * `BILL_AMT1`: Latest outstanding bill balance.
  * `PAY_AMT1`: Historical payment amounts.

### C. Give Me Some Credit
* **Source**: [Kaggle - Give Me Some Credit](https://www.kaggle.com/competitions/GiveMeSomeCredit)
* **Description**: 150,000 borrower financial profile records designed for credit risk scoring.
* **Key Columns**:
  * `SeriousDlqin2yrs`: Target variable for severe delinquency (90+ days past due).
  * `RevolvingUtilizationOfUnsecuredLines`: Credit utilization ratio.
  * `NumberOfTime30-59DaysLateNotWorse`, `NumberOfTimes90DaysLate`: Behavioral risk metrics.

---

## 3. CPE 613 Mathematical Problem Formulation

### 3.1 Sets and Parameters
* **Accounts ($i \in \{1, 2, \dots, N\}$)**: Set of delinquent customer accounts (e.g., $N = 30$).
* **Collection Strategies ($k \in \{0, 1, 2, 3\}$)**:
  * $k = 0$: **No Action / Self-Cure** ($	ext{Cost}_0 = \$0$, Expected Recovery Rate $r_{i,0} = 0.10$)
  * $k = 1$: **Automated SMS / Email** ($	ext{Cost}_1 = \$5$, Expected Recovery Rate $r_{i,1} = 0.25$)
  * $k = 2$: **In-House Call Center Agent** ($	ext{Cost}_2 = \$45$, Expected Recovery Rate $r_{i,2} = 0.55$)
  * $k = 3$: **External Agency / Legal Action** ($	ext{Cost}_3 = \$200$, Expected Recovery Rate $r_{i,3} = 0.80$)
* **Outstanding Balance ($B_i$)**: Principal balance of account $i$.
* **Expected Recovery Amount ($\mathbb{E}[R_{i,k}]$)**: $\mathbb{E}[R_{i,k}] = B_i \cdot r_{i,k}$.
* **Total Budget Limit ($B_{\text{max}}$)**: Maximum total collection expenditure allowed.
* **Call Center Capacity ($C_{\text{max}}$)**: Maximum number of accounts that can be assigned to call center agents.

---

### 3.2 Decision Variables
Let $x_{i,k} \in \{0, 1\}$ be a binary decision variable indicating strategy assignment:
$$x_{i,k} = \begin{cases} 1 & \text{if strategy } k \text{ is assigned to account } i \\ 0 & \text{otherwise} \end{cases}$$

---

### 3.3 Solution Search Space Verification Requirement ($\ge 3 \times 10^6$)
For $N = 30$ delinquent accounts and $K = 4$ available collection strategies per account:
$$\text{Total Solution Space Size} = K^N = 4^{30} \approx 1.153 \times 10^{18} \quad (\gg 3 \times 10^6)$$
This easily satisfies the course requirement for minimum solution space complexity.

---

### 3.4 Single-Objective Formulation (Integer Linear Program - ILP)

**Objective**: Maximize Net Total Expected Dollar Recovery.

$$\max_{\mathbf{x}} \sum_{i=1}^{N} \sum_{k=0}^{K-1} \left( \mathbb{E}[R_{i,k}] - \text{Cost}_k \right) \cdot x_{i,k}$$

**Subject to Constraints**:
1. **Uniqueness Constraint**: Exactly one collection strategy must be assigned to each account:
   $$\sum_{k=0}^{K-1} x_{i,k} = 1 \quad \forall i \in \{1, 2, \dots, N\}$$

2. **Total Collection Budget Constraint**:
   $$\sum_{i=1}^{N} \sum_{k=0}^{K-1} \text{Cost}_k \cdot x_{i,k} \le B_{\text{max}}$$

3. **Call Center Capacity Constraint**:
   $$\sum_{i=1}^{N} x_{i, 2} \le C_{\text{max}}$$

4. **Integrity Constraint**:
   $$x_{i,k} \in \{0, 1\} \quad \forall i, k$$

---

### 3.5 Multi-Objective Formulation

Simultaneously optimize two competing goals to generate a **Pareto Frontier**:

1. **Objective 1 (Maximize Gross Recovery)**:
   $$\max f_1(\mathbf{x}) = \sum_{i=1}^{N} \sum_{k=0}^{K-1} \mathbb{E}[R_{i,k}] \cdot x_{i,k}$$

2. **Objective 2 (Minimize Operational Collection Expenses)**:
   $$\min f_2(\mathbf{x}) = \sum_{i=1}^{N} \sum_{k=0}^{K-1} \text{Cost}_k \cdot x_{i,k}$$

---

## 4. Optimization Methodologies & Comparison Plan

| Method | Approach | Implementation Tool | Goal in Project |
| :--- | :--- | :--- | :--- |
| **Traditional Exact Method** | Integer Linear Programming (ILP) | Google OR-Tools / PuLP (`CBC` / `SCIP` solver) | Obtain exact globally optimal baseline and computation time |
| **Meta-Heuristic Method** | Genetic Algorithm (GA) / Simulated Annealing (SA) | Python (`DEAP` / custom GA script) | Compare convergence speed, solution quality, and scalability |

### Meta-Heuristic Encoding (Genetic Algorithm)
* **Chromosome Representation**: An integer array of length $N = 30$, where gene $i \in \{0, 1, 2, 3\}$ indicates the strategy assigned to account $i$.
* **Fitness Function**: Objective value with dynamic penalty functions applied for constraint violations (budget and capacity limits).
