"""Step 4: run every solver on the N=30 instance and save results + figures."""
import json, sys
import numpy as np, pandas as pd
import matplotlib; matplotlib.use("Agg")
import matplotlib.pyplot as plt
sys.path.insert(0, "src")
from optimizer import *

df = pd.read_csv("data/accounts_N30.csv")
cfg = dict(DEFAULT_CFG)
inst = Instance(df, cfg)
out = {"cfg": cfg, "size": problem_size(inst)}
print("problem size:", out["size"]["size"], "log10", out["size"]["log10"])

ex = solve_milp(inst); print(ex["method"], round(ex["objective"]), ex["mix"], round(ex["time"], 3))
lp = lp_relaxation(inst); print("LP bound", round(lp["bound"]), "shadow", lp["shadow"], "fractional", lp["fractional"])
bb = branch_and_bound(inst); print(bb["method"], round(bb["objective"]), bb["log"], round(bb["time"], 2))
dp = dp_budget(inst); print(dp["method"], round(dp["objective"]), dp["mix"], "feasible:", dp["feasible_full"])
gr = greedy(inst); print(gr["method"], round(gr["objective"]), gr["mix"])

runs = {"GA": [], "SA": []}
for s in range(10):
    runs["GA"].append(genetic_algorithm(inst, seed=s))
    runs["SA"].append(simulated_annealing(inst, seed=s))
for k, rs in runs.items():
    o = np.array([r["objective"] if r["feasible"] else np.nan for r in rs])
    print(k, "best", np.nanmax(o).round(), "gap%", (100*(1-np.nanmax(o)/ex["objective"])).round(2), "mean", np.nanmean(o).round(), "std", np.nanstd(o).round(),
          "feasible", sum(r["feasible"] for r in rs), "time", np.mean([r["time"] for r in rs]).round(2))

# exact marginal value of +1 resource unit (re-solve MILP), cf. midterm Problem 2
marg = {}
for key, step in [("budget", 1000), ("call_hours", 0.75), ("field_slots", 1), ("hard_cap", 1)]:
    c2 = dict(cfg); c2[key] = cfg[key] + step
    marg[key] = dict(step=step, gain=solve_milp(Instance(df, c2))["objective"] - ex["objective"])
print("MILP marginal gains:", marg)

pts = pareto_front(df, cfg, np.linspace(10_000, 400_000, 27))
def strip(r): return {k: v for k, v in r.items() if k not in ("assign", "history")} | {"assign": [int(x) for x in r["assign"]]}
out.update(exact=strip(ex), lp={k: v for k, v in lp.items() if k != "x"}, bnb=strip(bb), dp=strip(dp),
           greedy=strip(gr), marginal=marg, pareto=pts,
           meta={k: [dict(objective=r["objective"], feasible=bool(r["feasible"]), time=r["time"]) for r in rs] for k, rs in runs.items()})
json.dump(out, open("data/results_N30.json", "w"), indent=2, default=float)

# assignment table
tab = df[["account_id", "grade", "dpd", "reachable", "balance_thb", "rho"]].copy()
tab["strategy"] = [STRATEGIES[k]["name"] for k in ex["assign"]]
tab["exp_recovery_thb"] = inst.R[np.arange(inst.n), ex["assign"]].round()
tab["cost_thb"] = inst.C[np.arange(inst.n), ex["assign"]].round()
tab.to_csv("data/optimal_assignment_N30.csv", index=False)

# figures
plt.rcParams.update({"font.size": 10, "axes.spines.top": False, "axes.spines.right": False})
fig, ax = plt.subplots(figsize=(6.5, 3.6))
ax.plot([p["cost"] / 1e3 for p in pts], [p["gross"] / 1e6 for p in pts], "o-", color="#2a6f97", label="Pareto front (gross recovery)")
ax.plot([p["cost"] / 1e3 for p in pts], [p["net"] / 1e6 for p in pts], "s--", color="#c97b2a", ms=4, label="Net recovery at that point")
ax.axvline(cfg["budget"] / 1e3, color="grey", lw=0.8, ls=":"); ax.text(cfg["budget"] / 1e3 + 4, ax.get_ylim()[0] + 0.02, "B_max", color="grey")
ax.set_xlabel("Collection cost f2 (thousand THB)"); ax.set_ylabel("Million THB"); ax.legend(frameon=False)
fig.tight_layout(); fig.savefig("docs/fig_pareto.png", dpi=180)

fig, ax = plt.subplots(figsize=(6.5, 3.4))
ax.plot(runs["GA"][0]["history"], color="#2a6f97", label="GA (best of population)")
ax.plot(np.linspace(0, len(runs["GA"][0]["history"]), len(runs["SA"][0]["history"])), runs["SA"][0]["history"], color="#c97b2a", label="SA (best so far, rescaled x)")
ax.axhline(ex["objective"], color="k", ls=":", lw=1, label="MILP optimum")
ax.set_ylim(ex["objective"] * 0.8, ex["objective"] * 1.02)
ax.set_xlabel("Generation"); ax.set_ylabel("Penalised objective (THB)"); ax.legend(frameon=False)
fig.tight_layout(); fig.savefig("docs/fig_convergence.png", dpi=180)

fig, ax = plt.subplots(figsize=(6.5, 3.2))
meths = [("MILP", ex), ("DP*", dp), ("Greedy", gr), ("GA best", max(runs["GA"], key=lambda r: r["objective"] * r["feasible"])),
         ("SA best", max(runs["SA"], key=lambda r: r["objective"] * r["feasible"]))]
cols = ["#bfbfbf", "#9ecae1", "#2a6f97", "#f2b880", "#c97b2a", "#7a2e0e"]
left = np.zeros(len(meths))
for k in range(K):
    v = np.array([m["mix"][STRATEGIES[k]["key"]] for _, m in meths])
    ax.barh([m for m, _ in meths], v, left=left, color=cols[k], label=STRATEGIES[k]["key"]); left += v
ax.invert_yaxis(); ax.set_xlabel("Number of accounts"); ax.legend(ncol=6, frameon=False, fontsize=8, loc="upper center", bbox_to_anchor=(0.5, 1.18))
fig.tight_layout(); fig.savefig("docs/fig_mix.png", dpi=180)
print("done")
