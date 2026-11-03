# Project Summary (Plain-Language Version)

## The problem in one sentence

A Thai bank has 30 customers who stopped paying their loans. For each customer it must choose **one way to
collect the money**, and it wants to **get back as much money as possible** without spending more than it can
afford.

## The 6 ways to collect (the "strategies")

| # | Strategy | Cost per customer | How well it works |
| :-: | :--- | ---: | :--- |
| 0 | Do nothing, wait | ฿0 | weakest |
| 1 | Send SMS / LINE | ฿25 | weak |
| 2 | Phone call from our staff | ฿350 | normal (the baseline) |
| 3 | Send a person to visit | ฿1,800 | stronger |
| 4 | Hand to a collection agency | ฿500 + 25 % of what it collects | strong |
| 5 | Sue in court (law firm) | ฿8,000 + 2 % of the debt | strongest |

Stronger methods cost more, and the bank's resources are limited:

- **Budget:** ฿150,000 in total.
- **Phone staff:** 12 hours, and each call takes 0.75 hours.
- **Visits:** only 5.
- **Agency + court:** at most 10 customers, so the bank isn't too harsh on customers.
- **Law firm:** costs ฿40,000 up front to hire and must take at least 3 cases. Only debts of ฿100,000 or more may go to court.
- **Customers 90+ days late** must get some action; "do nothing" is not allowed for them.

So the question is: **which customer gets which strategy?**

## Why this is hard (and fits CPE 613)

Each of the 30 customers has up to 6 choices, which gives about **5.5 × 10²¹ possible plans**. Checking them one
by one would take a computer about 175,000 years, so we need optimization methods. The course requires at
least 3 × 10⁶ possible plans, so this easily qualifies.

---

## What I did, step by step

### Step 1: Research
- Read your midterm and listed its topics: integer programming, shadow prices, Branch & Bound, DP, greedy,
  reliability and problem size. I designed the project so it uses each of them.
- Looked up Thailand's Debt Collection Act and the 2026 THB exchange rate (about ฿33 per US$).

### Step 2: Took real data from LendingClub (`archive-2/loan.csv`)
- The file has 2.26 million loans. I kept only the **262,447 loans that defaulted**.
- In that data, the bank got back on average only **about 10.6 %** of what was owed.

### Step 3: Trained a machine-learning model
- **What it predicts:** "how much of this customer's debt we can expect to get back", called **ρ (rho)**.
  For example, ρ = 8 % on a ฿300,000 debt means we expect about ฿24,000 back.
- **Why not predict the grade?** The loan grade (A–G) is already given in the data, so we use it as an
  **input**. On its own the grade is a poor predictor; the full model is much better (AUC 0.77 vs 0.53).
- **Effect of each strategy:** the strategy multiplies ρ. A call is ×1.0, a visit ×1.4, court ×2.3, and so on.
  These multipliers are assumptions that you can change.

### Step 4: Made the dataset look like a Thai bank's
- Converted US$ to baht (×33).
- Picked 300 customers, and used the first 30 for the report.
- Added two made-up columns that real collection data would have: **days late (DPD)** and **phone
  reachable or not**.

### Step 5: Wrote the math model
- **Decision:** $x_{i,k} = 1$ if customer $i$ gets strategy $k$, otherwise 0.
- **Goal:** maximize (expected money recovered − cost).
- **Rules:** one strategy per customer, the budget, phone hours, visits, the agency/court limit, and the
  law-firm rules.

This is a **Mixed-Integer Linear Program (MILP)**, the same type of model as midterm Problem 1.

### Step 6: Solved it with several methods and compared them

| Method | What it is | Result | Gap to best |
| :--- | :--- | ---: | ---: |
| **Exact solver (HiGHS)** | Finds the guaranteed best answer | **฿1,099,661** | 0 % |
| My own Branch & Bound | The method from midterm Problem 3, written by hand | ฿1,099,661 | 0 % |
| Simulated Annealing | Random search that slowly "cools down" | best ฿1,099,661 | 0.05 % average |
| Genetic Algorithm | Random search inspired by evolution | best ฿1,099,661 | 0.44 % average |
| Greedy | Always take the best-value step right now | ฿927,781 | 15.6 % worse |

**Why greedy fails:** hiring the law firm costs ฿40,000 and needs 3 cases at once. One case at a time never looks
worth it, so greedy never uses court. This is the same lesson as midterm Problem 6: greedy can miss the best
answer.

### Step 7: "Should we buy more resources?" (midterm Problem 2 idea)
- **Budget:** each extra ฿1 brings back more than ฿1. **Yes, increase the budget.**
- **Visits:** one more visit is worth about ฿7,700–9,300, more than it costs. **Yes, buy.**
- **Phone hours:** the 12 hours aren't all used. **No, don't buy.**

### Step 8: Trade-off chart (Pareto front)
The chart shows how much money comes back at each spending level. More spending brings back more money, but the
curve flattens once the 10-customer limit for agency and court is reached.

### Step 9: Built the web page (`frontend/index.html`)
Open it in your browser. You can:
- Change the budget, staff hours, number of visits, exchange rate and number of customers.
- Change the cost and strength of each strategy, or turn a strategy off.
- Set a **priority slider** for each strategy, or click *Customer-friendly* or *Aggressive recovery*.
- Click **Run optimization** to see the best plan, compare the methods, and see who gets what.
- Click **Pareto front** to see the trade-off chart.

---

## Which file is what

| File | What it is |
| :--- | :--- |
| `SUMMARY.md` | This file: the simple explanation |
| `docs/DOCUMENTATION.md` / `.pdf` | The full report with all the math, for submitting |
| `frontend/index.html` | The interactive web page |
| `src/01_explore.py` | Step 2: pull the defaulted loans out of the big CSV |
| `src/02_model_and_dataset.py` | Steps 3–4: train the model and build the baht dataset |
| `src/optimizer.py` | Steps 5–6: the math model and all the solving methods |
| `src/03_run_experiments.py` | Steps 6–8: run everything and make the charts |
| `src/04_build_frontend.py` | Puts the data into the web page |
| `src/05_build_pdf.py` | Turns the report into a PDF |
| `data/` | The generated datasets and results |

## Things that are assumptions, not real data
- How much each strategy improves recovery (×0.3 … ×2.3) and the baht cost of each strategy.
- The "days late" and "phone reachable" columns are made up, because LendingClub doesn't record them.

You can change all of these in the web page, and you should mention them in your presentation.
