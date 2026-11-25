"""Phase I comprehensive benchmark, scaling, ablation, and statistical logger.

Uses src/optimizer.py solver implementations cleanly across:
  - N=30 (main benchmark cohort TH0001-TH0030)
  - N=30_B (unseen disjoint cohort TH0031-TH0060)
  - N=100, N=300 under Regime 1 (capacities scaled N/30, contract F=40k & L=3 fixed)
  - N=100, N=300 under Regime 2 (all capacities strictly frozen at N=30 baseline)
  - SA initial temperature ablation on N=30 (T0=20,000 vs T0=1,000,000)

Outputs:
  data/phase1_benchmark.json
  data/phase1_summary_table.csv
  data/phase1_seed_runs.csv
  docs/fig_p1_*.png
"""
import json
import math
import pathlib
import sys
import time

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from scipy.stats import wilcoxon

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "src"))

from optimizer import (
    DEFAULT_CFG,
    K,
    STRATEGIES,
    Instance,
    branch_and_bound,
    dp_budget,
    genetic_algorithm,
    greedy,
    lp_relaxation,
    problem_size,
    simulated_annealing,
    solve_milp,
)

SEEDS = [0, 1, 2]
OUT_JSON = ROOT / "data" / "phase1_benchmark.json"
OUT_SUMMARY_CSV = ROOT / "data" / "phase1_summary_table.csv"
OUT_SEEDS_CSV = ROOT / "data" / "phase1_seed_runs.csv"


def count_model_dimensions(inst: Instance) -> dict:
    """Compute active binary variables and non-redundant structural constraints."""
    n_x = int(inst.allowed.sum())
    n_legal_elig = int(inst.allowed[:, 5].sum())
    n_vars = n_x + 1
    n_cons = inst.n + 4 + n_legal_elig + 1
    return {
        "accounts": inst.n,
        "binary_x": n_x,
        "binary_y": 1,
        "total_vars": n_vars,
        "c1_assign": inst.n,
        "c2_c5_resources": 4,
        "c6_legal_link": n_legal_elig,
        "c7_legal_min": 1,
        "total_constraints": n_cons,
    }


def make_cfg(n: int, scale_caps: bool) -> dict:
    """Build parameter config keeping contract terms F and L invariant across N."""
    s = (n / 30.0) if scale_caps else 1.0
    return dict(
        DEFAULT_CFG,
        budget=round(DEFAULT_CFG["budget"] * s, 2),
        call_hours=round(DEFAULT_CFG["call_hours"] * s, 4),
        field_slots=int(round(DEFAULT_CFG["field_slots"] * s)),
        hard_cap=int(round(DEFAULT_CFG["hard_cap"] * s)),
        legal_retainer=DEFAULT_CFG["legal_retainer"],
        legal_min_cases=DEFAULT_CFG["legal_min_cases"],
    )


def summarize_runs(runs: list, opt_z: float) -> dict:
    """Compute parametric and non-parametric statistics for stochastic runs."""
    objs = np.array([r["objective"] for r in runs], dtype=float)
    gaps = 100.0 * (opt_z - objs) / opt_z
    times = np.array([r["time"] for r in runs], dtype=float)
    feas = [bool(r["feasible"]) for r in runs]
    law_firms = [int(r["law_firm"]) for r in runs]
    return {
        "n_runs": len(runs),
        "best": float(objs.max()),
        "worst": float(objs.min()),
        "mean": float(objs.mean()),
        "std": float(objs.std(ddof=1)) if len(objs) > 1 else 0.0,
        "median": float(np.median(objs)),
        "iqr": float(np.percentile(objs, 75) - np.percentile(objs, 25)),
        "gap_best_pct": float(gaps.min()),
        "gap_mean_pct": float(gaps.mean()),
        "gap_median_pct": float(np.median(gaps)),
        "gap_worst_pct": float(gaps.max()),
        "feasible_count": int(sum(feas)),
        "optimal_hit_count": int(sum(g < 0.01 for g in gaps)),
        "within_1pct_count": int(sum(g <= 1.0 for g in gaps)),
        "law_firm_active_count": int(sum(law_firms)),
        "mean_time_s": float(times.mean()),
        "std_time_s": float(times.std(ddof=1)) if len(times) > 1 else 0.0,
    }


def strip_exact(res: dict) -> dict:
    """Drop assignment vector for compact JSON logging."""
    return {k: v for k, v in res.items() if k not in ("assign", "history")}


def run_instance(label: str, df: pd.DataFrame, cfg: dict, bb_nodes: int) -> dict:
    """Execute full solver suite on one portfolio configuration."""
    t_start = time.perf_counter()
    inst = Instance(df.reset_index(drop=True), cfg)
    dims = count_model_dimensions(inst)
    psize = problem_size(inst)
    total_balance = float(df["balance_thb"].sum())

    ex = solve_milp(inst)
    z_opt = float(ex["objective"])

    lp = lp_relaxation(inst)
    lp_gap = 100.0 * (lp["bound"] - z_opt) / z_opt

    dp = dp_budget(inst)
    dp_gap = 100.0 * (dp["objective"] - z_opt) / z_opt

    gr = greedy(inst)
    gr_gap = 100.0 * (z_opt - gr["objective"]) / z_opt

    bb = branch_and_bound(inst, max_nodes=bb_nodes) if bb_nodes > 0 else None
    bb_gap = (100.0 * (z_opt - bb["objective"]) / z_opt) if bb else None

    # MILP marginal sensitivity check (+1 operational unit)
    marginal = {}
    for key, step in [("budget", 1000.0), ("call_hours", 0.75), ("field_slots", 1), ("hard_cap", 1)]:
        c2 = dict(cfg)
        c2[key] = cfg[key] + step
        gain = solve_milp(Instance(df.reset_index(drop=True), c2))["objective"] - z_opt
        marginal[key] = {"step": step, "milp_gain": float(gain), "lp_shadow": float(lp["shadow"][key])}

    ga_runs = [genetic_algorithm(inst, seed=sd) for sd in SEEDS]
    sa_runs = [simulated_annealing(inst, seed=sd) for sd in SEEDS]
    ga_stats = summarize_runs(ga_runs, z_opt)
    sa_stats = summarize_runs(sa_runs, z_opt)

    # Verification check on MILP feasibility
    milp_viol = float(inst.violation(ex["assign"]))

    print(
        f"[{label}] N={inst.n} | Z*={z_opt:,.2f} ({ex['time']:.3f}s) | LP_gap={lp_gap:.3f}% ({lp['fractional']} frac) | "
        f"DP_UB={dp['objective']:,.2f} ({dp['time']:.3f}s) | Greedy_gap={gr_gap:.2f}% ({gr['time']:.2f}s) | "
        f"GA_mean_gap={ga_stats['gap_mean_pct']:.2f}% ({ga_stats['mean_time_s']:.2f}s) | "
        f"SA_mean_gap={sa_stats['gap_mean_pct']:.2f}% ({sa_stats['mean_time_s']:.2f}s) | wall={time.perf_counter()-t_start:.1f}s"
    )

    return {
        "label": label,
        "total_balance_thb": total_balance,
        "cfg": cfg,
        "dimensions": dims,
        "problem_size": {"size": psize["size"], "log10": psize["log10"], "unrestricted": psize["unrestricted"]},
        "exact_milp": {**strip_exact(ex), "violation": milp_viol},
        "lp_relaxation": {
            "bound": float(lp["bound"]),
            "integrality_gap_pct": float(lp_gap),
            "fractional_vars": int(lp["fractional"]),
            "shadow_prices": {k: float(v) for k, v in lp["shadow"].items()},
        },
        "marginal_sensitivity": marginal,
        "dp_relaxation": {**strip_exact(dp), "gap_to_opt_pct": float(dp_gap)},
        "greedy": {**strip_exact(gr), "gap_pct": float(gr_gap)},
        "custom_bnb": ({**strip_exact(bb), "gap_pct": float(bb_gap)} if bb else None),
        "ga_stats": ga_stats,
        "sa_stats": sa_stats,
        "ga_runs": [
            {**strip_exact(r), "seed": sd, "gap_pct": float(100.0 * (z_opt - r["objective"]) / z_opt), "history": r["history"]}
            for sd, r in zip(SEEDS, ga_runs)
        ],
        "sa_runs": [
            {**strip_exact(r), "seed": sd, "gap_pct": float(100.0 * (z_opt - r["objective"]) / z_opt), "history": r["history"]}
            for sd, r in zip(SEEDS, sa_runs)
        ],
    }


def make_figures(results: dict, ablation: dict):
    """Generate clean, publication-grade Phase I diagnostic figures."""
    plt.rcParams.update({
        "font.size": 9.5,
        "axes.spines.top": False,
        "axes.spines.right": False,
        "axes.grid": True,
        "grid.alpha": 0.25,
    })

    keys = ["N30_main", "N100_prop", "N300_prop"]
    labels = ["N = 30", "N = 100", "N = 300"]
    x = np.arange(len(keys))

    # Figure 1: Optimality Gap (%) Scaling + LP Integrality Gap
    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(9.2, 3.6))
    greedy_gaps = [results[k]["greedy"]["gap_pct"] for k in keys]
    ga_gaps = [results[k]["ga_stats"]["gap_mean_pct"] for k in keys]
    sa_gaps = [results[k]["sa_stats"]["gap_mean_pct"] for k in keys]
    lp_gaps = [results[k]["lp_relaxation"]["integrality_gap_pct"] for k in keys]

    w = 0.24
    ax1.bar(x - w, greedy_gaps, width=w, color="#8c8c8c", label="Greedy")
    ax1.bar(x, ga_gaps, width=w, color="#2a6f97", label="GA (mean, 3 seeds)")
    ax1.bar(x + w, sa_gaps, width=w, color="#c97b2a", label="SA (mean, 3 seeds)")
    ax1.set_xticks(x); ax1.set_xticklabels(labels)
    ax1.set_ylim(0, 26.5)
    ax1.set_ylabel("Optimality Gap vs. HiGHS MILP (%)")
    ax1.set_title("Solution Quality Gap Across Portfolio Scale")
    ax1.legend(frameon=False, fontsize=8, loc="upper left", ncol=2)
    for i, v in enumerate(greedy_gaps):
        ax1.text(x[i] - w, v + 0.45, f"{v:.1f}%", ha="center", fontsize=7.5)
    for i, v in enumerate(ga_gaps):
        ax1.text(x[i], v + 0.45, f"{v:.2f}%", ha="center", fontsize=7.5)
    for i, v in enumerate(sa_gaps):
        ax1.text(x[i] + w + 0.03, v + 0.45, f"{v:.2f}%", ha="center", fontsize=7.5)

    ax2.plot([0, 1, 2], lp_gaps, "o-", color="#1b4332", lw=2, ms=6)
    ax2.set_xticks([0, 1, 2]); ax2.set_xticklabels(labels)
    ax2.set_xlim(-0.35, 2.35)
    ax2.set_ylim(0, max(lp_gaps) * 1.25)
    ax2.set_ylabel("Root LP Integrality Gap (%)")
    ax2.set_title("LP Relaxation Tightness (Disaggregated Linking)")
    offsets = [(0.14, 0.04), (0.05, 0.11), (-0.05, 0.11)]
    for i, v in enumerate(lp_gaps):
        dx, dy = offsets[i]
        ax2.text(i + dx, v + dy, f"{v:.3f}%", ha="center", fontsize=8,
                 bbox=dict(boxstyle="round,pad=0.15", fc="white", ec="none", alpha=0.8))
    fig.tight_layout()
    fig.savefig(ROOT / "docs" / "fig_p1_scaling_gap.png", dpi=200)
    plt.close(fig)

    # Figure 2: Wall-Clock CPU Time Comparison Across N
    fig, ax = plt.subplots(figsize=(7.0, 3.6))
    t_milp = [results[k]["exact_milp"]["time"] for k in keys]
    t_dp = [results[k]["dp_relaxation"]["time"] for k in keys]
    t_greedy = [results[k]["greedy"]["time"] for k in keys]
    t_ga = [results[k]["ga_stats"]["mean_time_s"] for k in keys]
    t_sa = [results[k]["sa_stats"]["mean_time_s"] for k in keys]

    ax.plot(labels, t_milp, "o-", color="#1d3557", lw=2, label="HiGHS MILP (Exact)")
    ax.plot(labels, t_dp, "d--", color="#457b9d", lw=1.6, label="DP Relaxation (Budget-Only)")
    ax.plot(labels, t_ga, "s-", color="#2a6f97", lw=2, label="Genetic Algorithm (mean)")
    ax.plot(labels, t_sa, "^-", color="#c97b2a", lw=2, label="Simulated Annealing (mean)")
    ax.plot(labels, t_greedy, "x:", color="#b5179e", lw=2, ms=7, label="Greedy Upgrade Scan O(N^2 K)")
    ax.set_ylabel("Wall-Clock Runtime (seconds)")
    ax.set_title("Algorithmic Runtime Scaling (Regime 1: Proportional Capacities)")
    ax.legend(frameon=False, fontsize=8.5, ncol=2)
    fig.tight_layout()
    fig.savefig(ROOT / "docs" / "fig_p1_scaling_time.png", dpi=200)
    plt.close(fig)

    # Figure 3: Convergence Trajectories (N=30 with T0 ablation & N=300)
    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(9.4, 3.6))
    z30 = results["N30_main"]["exact_milp"]["objective"]
    ga_h30 = results["N30_main"]["ga_runs"][0]["history"]
    sa_h30 = results["N30_main"]["sa_runs"][0]["history"]
    sa_low = ablation["T0_20k_runs"][0]["history"]
    ax1.plot(np.linspace(0, 100, len(ga_h30)), np.array(ga_h30) / 1e6, color="#2a6f97", label="GA (seed 0)")
    ax1.plot(np.linspace(0, 100, len(sa_h30)), np.array(sa_h30) / 1e6, color="#c97b2a", label="SA T0=1e6 (seed 0)")
    ax1.plot(np.linspace(0, 100, len(sa_low)), np.array(sa_low) / 1e6, color="#d62828", ls="--", label="SA T0=2e4 (trapped y=0)")
    ax1.axhline(z30 / 1e6, color="k", ls=":", lw=1, label=f"MILP Z* = {z30/1e6:.2f}M")
    ax1.set_xlabel("Search Progress (%)"); ax1.set_ylabel("Penalised Objective (Million THB)")
    ax1.set_title("N = 30 Convergence & Fixed-Charge Escape")
    ax1.set_ylim(z30 * 0.72 / 1e6, z30 * 1.03 / 1e6)
    ax1.legend(frameon=False, fontsize=7.8)

    z300 = results["N300_prop"]["exact_milp"]["objective"]
    ga_h300 = results["N300_prop"]["ga_runs"][0]["history"]
    sa_h300 = results["N300_prop"]["sa_runs"][0]["history"]
    ax2.plot(np.linspace(0, 100, len(ga_h300)), np.array(ga_h300) / 1e6, color="#2a6f97", label="GA (seed 0)")
    ax2.plot(np.linspace(0, 100, len(sa_h300)), np.array(sa_h300) / 1e6, color="#c97b2a", label="SA T0=1e6 (seed 0)")
    ax2.axhline(z300 / 1e6, color="k", ls=":", lw=1, label=f"MILP Z* = {z300/1e6:.2f}M")
    ax2.set_xlabel("Search Progress (%)"); ax2.set_ylabel("Penalised Objective (Million THB)")
    ax2.set_title("N = 300 Convergence (Proportional Caps)")
    ax2.set_ylim(z300 * 0.72 / 1e6, z300 * 1.03 / 1e6)
    ax2.legend(frameon=False, fontsize=7.8)
    fig.tight_layout()
    fig.savefig(ROOT / "docs" / "fig_p1_convergence_ablation.png", dpi=200)
    plt.close(fig)

    # Figure 4: Optimal Strategy Allocation Share (%) across Scales & Regimes
    fig, ax = plt.subplots(figsize=(7.6, 3.8))
    comp_keys = ["N30_main", "N30_unseenB", "N100_prop", "N300_prop", "N100_frozen", "N300_frozen"]
    comp_names = ["N=30 Main", "N=30 Unseen B", "N=100 Prop.", "N=300 Prop.", "N=100 Frozen", "N=300 Frozen"]
    cols = ["#bfbfbf", "#9ecae1", "#2a6f97", "#f2b880", "#c97b2a", "#7a2e0e"]
    left = np.zeros(len(comp_keys))
    for k_idx in range(K):
        skey = STRATEGIES[k_idx]["key"]
        pcts = np.array([100.0 * results[ck]["exact_milp"]["mix"][skey] / results[ck]["dimensions"]["accounts"] for ck in comp_keys])
        ax.barh(comp_names, pcts, left=left, color=cols[k_idx], label=skey)
        left += pcts
    ax.invert_yaxis()
    ax.set_xlabel("Share of Portfolio Accounts (%)")
    ax.set_title("Optimal Strategy Mix Across Cohort Scale and Capacity Regime", pad=28)
    ax.legend(ncol=6, frameon=False, fontsize=8.2, loc="lower center", bbox_to_anchor=(0.5, 1.01))
    fig.tight_layout()
    fig.savefig(ROOT / "docs" / "fig_p1_strategy_mix_scales.png", dpi=200)
    plt.close(fig)


def print_audit_summary(payload: dict):
    """Print detailed scalar audit metrics from saved benchmark JSON."""
    results = payload["results"]
    for k, blk in results.items():
        bnb = blk["custom_bnb"]
        bnb_str = (
            f"Z={bnb['objective']:,.2f} nodes={bnb['log']['nodes']} pruned={bnb['log']['pruned_bound']} "
            f"opt={bnb['log'].get('proved_optimal', False)} t={bnb['time']:.2f}s"
            if bnb else "not run"
        )
        print(
            f"[{k}] bal={blk['total_balance_thb']:,.0f} vars={blk['dimensions']['total_vars']} cons={blk['dimensions']['total_constraints']} | "
            f"Z*={blk['exact_milp']['objective']:,.2f} cost={blk['exact_milp']['cost']:,.0f} call_h={blk['exact_milp']['call_hours']} "
            f"field={blk['exact_milp']['field']} hard={blk['exact_milp']['hard']} legal={blk['exact_milp']['legal']} viol={blk['exact_milp']['violation']}\n"
            f"  mix={blk['exact_milp']['mix']}\n"
            f"  LP_frac={blk['lp_relaxation']['fractional_vars']} shadow={ {sk: round(sv,2) for sk,sv in blk['lp_relaxation']['shadow_prices'].items()} }\n"
            f"  DP_hard={blk['dp_relaxation']['hard']} DP_calls={blk['dp_relaxation']['call_hours']} | BnB: {bnb_str}"
        )
    print("Ablation T0=20k:", payload["ablation_sa_T0"]["T0_20k_stats"])
    print("Pooled:", payload["pooled_stats"])


def main():
    if "--replot" in sys.argv:
        payload = json.loads(OUT_JSON.read_text())
        make_figures(payload["results"], payload["ablation_sa_T0"])
        print_audit_summary(payload)
        print("Re-plotted 4 PNG figures cleanly.")
        return
    pool = pd.read_csv(ROOT / "data" / "accounts_pool.csv")
    df_30 = pool.iloc[:30].copy()
    df_30_b = pool.iloc[30:60].copy()
    df_100 = pool.iloc[:100].copy()
    df_300 = pool.iloc[:300].copy()

    results = {}
    print("=== Running Phase I Benchmark Suite (3 seeds: 0, 1, 2) ===")
    results["N30_main"] = run_instance("N30_main", df_30, make_cfg(30, scale_caps=False), bb_nodes=10000)
    results["N30_unseenB"] = run_instance("N30_unseenB", df_30_b, make_cfg(30, scale_caps=False), bb_nodes=10000)
    results["N100_prop"] = run_instance("N100_prop", df_100, make_cfg(100, scale_caps=True), bb_nodes=1000)
    results["N300_prop"] = run_instance("N300_prop", df_300, make_cfg(300, scale_caps=True), bb_nodes=0)
    results["N100_frozen"] = run_instance("N100_frozen", df_100, make_cfg(30, scale_caps=False), bb_nodes=0)
    results["N300_frozen"] = run_instance("N300_frozen", df_300, make_cfg(30, scale_caps=False), bb_nodes=0)

    # SA Initial Temperature Ablation on N=30
    inst30 = Instance(df_30.reset_index(drop=True), make_cfg(30, scale_caps=False))
    z30 = results["N30_main"]["exact_milp"]["objective"]
    t20k_runs = [simulated_annealing(inst30, T0=20_000.0, seed=sd) for sd in SEEDS]
    t20k_stats = summarize_runs(t20k_runs, z30)
    print(f"[Ablation SA T0=20k on N=30] mean={t20k_stats['mean']:,.2f} (gap={t20k_stats['gap_mean_pct']:.2f}%), legal_active={t20k_stats['law_firm_active_count']}/3")

    ablation = {
        "T0_20k_stats": t20k_stats,
        "T0_20k_runs": [
            {**strip_exact(r), "seed": sd, "gap_pct": float(100.0 * (z30 - r["objective"]) / z30), "history": r["history"]}
            for sd, r in zip(SEEDS, t20k_runs)
        ],
    }

    # Paired statistical check across all 18 matched runs (6 instances x 3 seeds)
    ga_all_gaps = [r["gap_pct"] for k in results for r in results[k]["ga_runs"]]
    sa_all_gaps = [r["gap_pct"] for k in results for r in results[k]["sa_runs"]]
    stat_w, p_val = wilcoxon(sa_all_gaps, ga_all_gaps, zero_method="wilcox", alternative="two-sided")
    pooled_stats = {
        "n_paired_runs": len(ga_all_gaps),
        "ga_mean_gap_pct": float(np.mean(ga_all_gaps)),
        "sa_mean_gap_pct": float(np.mean(sa_all_gaps)),
        "wilcoxon_stat": float(stat_w),
        "wilcoxon_p_value": float(p_val),
    }
    print(f"[Pooled 18 Paired Runs] GA mean gap={pooled_stats['ga_mean_gap_pct']:.3f}% vs SA mean gap={pooled_stats['sa_mean_gap_pct']:.3f}% (Wilcoxon p={p_val:.5f})")

    # Build tidy summary CSV & seed CSV
    summary_rows = []
    seed_rows = []
    for k, blk in results.items():
        summary_rows.append({
            "instance": k,
            "N": blk["dimensions"]["accounts"],
            "vars": blk["dimensions"]["total_vars"],
            "constraints": blk["dimensions"]["total_constraints"],
            "log10_space": round(blk["problem_size"]["log10"], 2),
            "milp_opt": round(blk["exact_milp"]["objective"], 2),
            "milp_time_s": round(blk["exact_milp"]["time"], 4),
            "lp_bound": round(blk["lp_relaxation"]["bound"], 2),
            "lp_igap_pct": round(blk["lp_relaxation"]["integrality_gap_pct"], 4),
            "dp_ub": round(blk["dp_relaxation"]["objective"], 2),
            "greedy_obj": round(blk["greedy"]["objective"], 2),
            "greedy_gap_pct": round(blk["greedy"]["gap_pct"], 2),
            "greedy_time_s": round(blk["greedy"]["time"], 4),
            "ga_best": round(blk["ga_stats"]["best"], 2),
            "ga_mean": round(blk["ga_stats"]["mean"], 2),
            "ga_std": round(blk["ga_stats"]["std"], 2),
            "ga_gap_mean_pct": round(blk["ga_stats"]["gap_mean_pct"], 3),
            "ga_time_s": round(blk["ga_stats"]["mean_time_s"], 2),
            "sa_best": round(blk["sa_stats"]["best"], 2),
            "sa_mean": round(blk["sa_stats"]["mean"], 2),
            "sa_std": round(blk["sa_stats"]["std"], 2),
            "sa_gap_mean_pct": round(blk["sa_stats"]["gap_mean_pct"], 3),
            "sa_time_s": round(blk["sa_stats"]["mean_time_s"], 2),
        })
        for algo, runs in [("GA", blk["ga_runs"]), ("SA", blk["sa_runs"])]:
            for r in runs:
                seed_rows.append({
                    "instance": k,
                    "N": blk["dimensions"]["accounts"],
                    "algorithm": algo,
                    "seed": r["seed"],
                    "objective": round(r["objective"], 2),
                    "gap_pct": round(r["gap_pct"], 4),
                    "cost": round(r["cost"], 2),
                    "legal_cases": r["legal"],
                    "law_firm": r["law_firm"],
                    "feasible": r["feasible"],
                    "time_s": round(r["time"], 4),
                })

    pd.DataFrame(summary_rows).to_csv(OUT_SUMMARY_CSV, index=False)
    pd.DataFrame(seed_rows).to_csv(OUT_SEEDS_CSV, index=False)

    payload = {
        "seeds": SEEDS,
        "results": results,
        "ablation_sa_T0": ablation,
        "pooled_stats": pooled_stats,
    }
    OUT_JSON.write_text(json.dumps(payload, indent=2, default=float))
    make_figures(results, ablation)
    print(f"Saved: {OUT_JSON.name}, {OUT_SUMMARY_CSV.name}, {OUT_SEEDS_CSV.name}, and 4 PNG figures.")


if __name__ == "__main__":
    main()
