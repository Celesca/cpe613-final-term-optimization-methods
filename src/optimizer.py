"""Debt-collection strategy allocation: model + solvers (CPE 613 term project).

Solvers: exact MILP (HiGHS), LP relaxation + duals, hand-written Branch & Bound,
Dynamic Programming (budget-only relaxation), Greedy, Genetic Algorithm, Simulated Annealing,
and an epsilon-constraint Pareto front.
"""
import heapq
import json
import math
import time
from dataclasses import dataclass, field

import numpy as np
import pandas as pd
from scipy.optimize import Bounds, LinearConstraint, linprog, milp

# ---------------------------------------------------------------- parameters
STRATEGIES = [
    # name, lift, fixed cost (THB), % of balance cost, commission, agent hours
    dict(key="none",   name="No action / self-cure",       lift=0.30, cost=0,    cost_pct=0.00, commission=0.00, hours=0.00),
    dict(key="sms",    name="SMS + LINE OA reminder",      lift=0.55, cost=25,   cost_pct=0.00, commission=0.00, hours=0.00),
    dict(key="call",   name="In-house call center",        lift=1.00, cost=350,  cost_pct=0.00, commission=0.00, hours=0.75),
    dict(key="field",  name="Field collector visit",       lift=1.40, cost=1800, cost_pct=0.00, commission=0.00, hours=0.00),
    dict(key="agency", name="External collection agency",  lift=1.70, cost=500,  cost_pct=0.00, commission=0.25, hours=0.00),
    dict(key="legal",  name="Legal action (law firm)",     lift=2.30, cost=8000, cost_pct=0.02, commission=0.00, hours=0.00),
]

DEFAULT_CFG = dict(
    budget=150_000,            # B_max  total collection budget (THB)
    call_hours=12.0,           # H      call-center agent hours available
    field_slots=5,             # V      field visits available
    hard_cap=10,               # M      max accounts escalated to agency + legal
    legal_retainer=40_000,     # F      fixed retainer if the law firm is engaged
    legal_min_cases=3,         # L      minimum legal cases if engaged
    legal_min_balance=100_000, # legal only eligible when balance >= this
    must_act_dpd=90,           # accounts with dpd >= this cannot get "No action"
    unreachable_factor=0.40,   # SMS / call effectiveness if phone unreachable
    rate_cap=0.90,
    strategy_priority=[1.0] * 6,   # pi_k  soft preference weights
    account_priority="none",       # none | balance | dpd | grade
)
K = len(STRATEGIES)
NONE, SMS, CALL, FIELD, AGENCY, LEGAL = range(K)
PHI = np.array([s["commission"] for s in STRATEGIES])


@dataclass
class Instance:
    df: pd.DataFrame
    cfg: dict
    R: np.ndarray = field(init=False)       # expected gross recovery  E[R_ik]
    C: np.ndarray = field(init=False)       # direct cost c_ik (counts against budget)
    V: np.ndarray = field(init=False)       # true net value  E[R](1-phi) - c
    W: np.ndarray = field(init=False)       # objective coefficient incl. priorities
    allowed: np.ndarray = field(init=False)

    def __post_init__(self):
        cfg, df = self.cfg, self.df
        bal = df["balance_thb"].to_numpy(float)
        rho = df["rho"].to_numpy(float)
        reach = df["reachable"].to_numpy(int)
        n = len(df)
        lift = np.array([s["lift"] for s in STRATEGIES])
        r = rho[:, None] * lift[None, :]
        r[reach == 0, SMS] *= cfg["unreachable_factor"]
        r[reach == 0, CALL] *= cfg["unreachable_factor"]
        self.r = np.minimum(r, cfg["rate_cap"])
        self.R = bal[:, None] * self.r
        self.C = np.array([[s["cost"] + s["cost_pct"] * b for s in STRATEGIES] for b in bal])
        phi = np.array([s["commission"] for s in STRATEGIES])
        self.V = self.R * (1 - phi) - self.C
        w = account_weights(df, cfg["account_priority"])
        pi = np.array(cfg["strategy_priority"], float)
        self.W = w[:, None] * pi[None, :] * self.R * (1 - phi) - self.C
        self.allowed = np.ones((n, K), bool)
        self.allowed[bal < cfg["legal_min_balance"], LEGAL] = False
        self.allowed[df["dpd"].to_numpy() >= cfg["must_act_dpd"], NONE] = False
        self.hours = np.array([s["hours"] for s in STRATEGIES])

    @property
    def n(self):
        return len(self.df)

    # ---- evaluation of an assignment vector a (len n, values 0..K-1)
    def evaluate(self, a, use_priority=True):
        idx = np.arange(self.n)
        y = int((a == LEGAL).any())
        F = self.cfg["legal_retainer"] * y
        obj = (self.W if use_priority else self.V)[idx, a].sum() - F
        return dict(
            objective=float(obj),
            net_recovery=float(self.V[idx, a].sum() - F),
            gross_recovery=float(self.R[idx, a].sum()),
            cost=float(self.C[idx, a].sum() + F),
            commission=float((self.R[idx, a] * PHI[a]).sum()),
            call_hours=float(self.hours[a].sum()),
            field=int((a == FIELD).sum()),
            hard=int(((a == AGENCY) | (a == LEGAL)).sum()),
            legal=int((a == LEGAL).sum()),
            law_firm=y,
            mix={STRATEGIES[k]["key"]: int((a == k).sum()) for k in range(K)},
        )

    def violation(self, a):
        """Total (scaled) constraint violation; 0 means feasible."""
        e, cfg = self.evaluate(a), self.cfg
        v = max(0, e["cost"] - cfg["budget"]) / 1000
        v += max(0, e["call_hours"] - cfg["call_hours"]) * 10
        v += max(0, e["field"] - cfg["field_slots"]) * 10
        v += max(0, e["hard"] - cfg["hard_cap"]) * 10
        if e["law_firm"] and e["legal"] < cfg["legal_min_cases"]:
            v += (cfg["legal_min_cases"] - e["legal"]) * 10
        v += (~self.allowed[np.arange(self.n), a]).sum() * 100
        return v


def account_weights(df, mode):
    if mode == "balance":
        b = df["balance_thb"].to_numpy(float)
        return 1 + 0.5 * (b - b.min()) / (b.max() - b.min() + 1e-9)
    if mode == "dpd":
        return 1 + 0.5 * (df["dpd"].to_numpy(float) - 30) / 150
    if mode == "grade":
        return 1 + 0.5 * df["grade"].map({g: i for i, g in enumerate("ABCDEFG")}).to_numpy(float) / 6
    return np.ones(len(df))


# ---------------------------------------------------------------- exact MILP
def build_lp(inst):
    """Return c, A, lb, ub, bounds for variables [x_00..x_{n-1,K-1}, y]."""
    n, cfg = inst.n, inst.cfg
    nv = n * K + 1
    Y = n * K
    xi = lambda i, k: i * K + k
    rows, lo, hi, names = [], [], [], []

    def add(coefs, l, u, name):
        row = np.zeros(nv)
        for j, v in coefs:
            row[j] += v
        rows.append(row); lo.append(l); hi.append(u); names.append(name)

    for i in range(n):
        add([(xi(i, k), 1) for k in range(K)], 1, 1, f"assign_{i}")
    add([(xi(i, k), inst.C[i, k]) for i in range(n) for k in range(K)] + [(Y, cfg["legal_retainer"])],
        -np.inf, cfg["budget"], "budget")
    add([(xi(i, CALL), inst.hours[CALL]) for i in range(n)], -np.inf, cfg["call_hours"], "call_hours")
    add([(xi(i, FIELD), 1) for i in range(n)], -np.inf, cfg["field_slots"], "field_slots")
    add([(xi(i, k), 1) for i in range(n) for k in (AGENCY, LEGAL)], -np.inf, cfg["hard_cap"], "hard_cap")
    for i in range(n):
        add([(xi(i, LEGAL), 1), (Y, -1)], -np.inf, 0, f"link_{i}")
    add([(Y, cfg["legal_min_cases"])] + [(xi(i, LEGAL), -1) for i in range(n)], -np.inf, 0, "legal_min")

    c = np.zeros(nv)
    c[:Y] = -inst.W.ravel()                 # milp minimises
    c[Y] = cfg["legal_retainer"]
    ub = np.ones(nv)
    ub[:Y] = inst.allowed.ravel().astype(float)
    return c, np.array(rows), np.array(lo), np.array(hi), np.zeros(nv), ub, names


def solve_milp(inst, time_limit=60):
    c, A, lo, hi, lb, ub, _ = build_lp(inst)
    t = time.perf_counter()
    res = milp(c, constraints=LinearConstraint(A, lo, hi), integrality=np.ones_like(c),
               bounds=Bounds(lb, ub), options=dict(time_limit=time_limit))
    dt = time.perf_counter() - t
    a = res.x[:-1].reshape(inst.n, K).argmax(1)
    return dict(method="MILP (HiGHS B&B)", assign=a, time=dt, status=res.message, **inst.evaluate(a))


def lp_relaxation(inst):
    """LP relaxation with dual values (shadow prices) of the resource constraints."""
    c, A, lo, hi, lb, ub, names = build_lp(inst)
    eq = np.isclose(lo, hi)
    res = linprog(c, A_ub=A[~eq], b_ub=hi[~eq], A_eq=A[eq], b_eq=hi[eq],
                  bounds=list(zip(lb, ub)), method="highs")
    ub_names = [nm for nm, e in zip(names, eq) if not e]
    duals = {nm: -float(m) for nm, m in zip(ub_names, res.ineqlin.marginals)}
    return dict(bound=-res.fun, x=res.x,
                shadow={k: duals[k] for k in ("budget", "call_hours", "field_slots", "hard_cap")},
                fractional=int(((res.x > 1e-6) & (res.x < 1 - 1e-6)).sum()))


def branch_and_bound(inst, max_nodes=20000):
    """Textbook best-bound B&B on the LP relaxation (mirrors midterm Problem 3.2).
    The greedy solution is the first incumbent; nodes whose LP bound cannot beat it are pruned."""
    c, A, lo, hi, lb0, ub0, _ = build_lp(inst)
    eq = np.isclose(lo, hi)
    Aub, bub, Aeq, beq = A[~eq], hi[~eq], A[eq], hi[eq]
    g = greedy(inst)
    best, best_a = g["objective"], g["assign"]
    log = dict(nodes=0, pruned_bound=0, pruned_infeasible=0, integer_leaves=0, root_bound=None,
               incumbent_start=best)
    t = time.perf_counter()

    def relax(lb, ub):
        r = linprog(c, A_ub=Aub, b_ub=bub, A_eq=Aeq, b_eq=beq, bounds=list(zip(lb, ub)), method="highs")
        return (None, None) if r.status != 0 else (-r.fun, r.x)

    z0, x0 = relax(lb0, ub0)
    log["root_bound"] = z0
    heap, tie = [(-z0, 0, lb0, ub0, x0)], 1
    while heap and log["nodes"] < max_nodes:
        negz, _, lb, ub, x = heapq.heappop(heap)
        log["nodes"] += 1
        if -negz <= best + 1e-6:                 # bound no better than incumbent -> prune
            log["pruned_bound"] += 1; continue
        frac = np.abs(x - np.round(x))
        frac[-1] *= 10                           # branch on the law-firm decision y first
        j = int(frac.argmax())
        if frac[j] < 1e-6:                       # integral -> new incumbent
            best, best_a = -negz, np.round(x[:-1]).reshape(inst.n, K).argmax(1)
            log["integer_leaves"] += 1; continue
        for v in (0, 1):                         # branch x_j = 0 / x_j = 1
            l2, u2 = lb.copy(), ub.copy(); l2[j] = u2[j] = v
            z, x2 = relax(l2, u2)
            if z is None:
                log["pruned_infeasible"] += 1
            elif z <= best + 1e-6:
                log["pruned_bound"] += 1
            else:
                heapq.heappush(heap, (-z, tie, l2, u2, x2)); tie += 1
    log["proved_optimal"] = not heap
    return dict(method="Branch & Bound (custom)", assign=best_a, time=time.perf_counter() - t,
                log=log, **inst.evaluate(best_a))


# ---------------------------------------------------------------- DP + greedy
def dp_budget(inst, unit=100):
    """DP over accounts (stage) with remaining budget (state); ignores capacity constraints.
    Solved twice: law firm not engaged (y=0) and engaged (y=1, budget minus retainer)."""
    t = time.perf_counter()
    best = None
    for y in (0, 1):
        cap = int((inst.cfg["budget"] - y * inst.cfg["legal_retainer"]) // unit)
        if cap < 0:
            continue
        cost = np.ceil(inst.C / unit).astype(int)
        val = np.where(inst.allowed, inst.W, -np.inf)
        if y == 0:
            val[:, LEGAL] = -np.inf
        f = np.zeros(cap + 1)                    # f_s(b): best value of accounts s..n-1 with budget b
        choice = np.zeros((inst.n, cap + 1), int)
        for i in reversed(range(inst.n)):
            g = np.full(cap + 1, -np.inf)
            for k in range(K):
                if not np.isfinite(val[i, k]):
                    continue
                cand = np.full(cap + 1, -np.inf)
                cand[cost[i, k]:] = val[i, k] + f[: cap + 1 - cost[i, k]]
                better = cand > g
                g[better], choice[i, better] = cand[better], k
            f = g
        b, a = cap, np.zeros(inst.n, int)
        for i in range(inst.n):
            a[i] = choice[i, b]; b -= cost[i, a[i]]
        z = f[cap] - y * inst.cfg["legal_retainer"]
        if best is None or z > best[0]:
            best = (z, a)
    a = best[1]
    return dict(method="DP (budget-only relaxation)", assign=a, time=time.perf_counter() - t,
                feasible_full=inst.violation(a) == 0, **inst.evaluate(a))


def greedy(inst):
    """Start every account at its cheapest allowed strategy, then repeatedly apply the
    single upgrade with the best marginal value per baht that keeps all constraints."""
    t = time.perf_counter()
    a = np.array([int(np.flatnonzero(inst.allowed[i])[np.argmin(inst.C[i, inst.allowed[i]])]) for i in range(inst.n)])
    while True:
        cur = inst.evaluate(a)["objective"]
        best = None
        for i in range(inst.n):
            for k in np.flatnonzero(inst.allowed[i]):
                if k == a[i]:
                    continue
                b = a.copy(); b[i] = k
                dv = inst.W[i, k] - inst.W[i, a[i]]
                dc = inst.C[i, k] - inst.C[i, a[i]]
                if dv <= 0:
                    continue
                if k == LEGAL and not (a == LEGAL).any():
                    continue                     # retainer + min cases make single legal moves infeasible
                if inst.violation(b) > 0:
                    continue
                ratio = dv / max(dc, 1.0)
                if best is None or ratio > best[0]:
                    best = (ratio, i, k)
        if best is None:
            break
        a[best[1]] = best[2]
        if inst.evaluate(a)["objective"] <= cur:
            break
    return dict(method="Greedy (value/cost ratio)", assign=a, time=time.perf_counter() - t, **inst.evaluate(a))


# ---------------------------------------------------------------- meta-heuristics
def penalised(inst, a, rho=100_000.0):
    return inst.evaluate(a)["objective"] - rho * inst.violation(a)


def random_allowed(inst, rng):
    return np.array([rng.choice(np.flatnonzero(inst.allowed[i])) for i in range(inst.n)])


def genetic_algorithm(inst, pop=120, gens=400, pc=0.9, pm=None, seed=0):
    rng = np.random.default_rng(seed)
    pm = pm or 1.5 / inst.n
    t = time.perf_counter()
    P = [random_allowed(inst, rng) for _ in range(pop)]
    P[0] = np.where(inst.allowed[:, SMS], SMS, CALL)     # a cheap feasible-ish seed
    fit = np.array([penalised(inst, a) for a in P])
    hist = []
    for g in range(gens):
        elite = [P[i] for i in np.argsort(-fit)[:2]]
        children = elite.copy()
        while len(children) < pop:
            p1 = P[max(rng.integers(pop, size=3), key=lambda i: fit[i])]
            p2 = P[max(rng.integers(pop, size=3), key=lambda i: fit[i])]
            child = np.where(rng.random(inst.n) < 0.5, p1, p2) if rng.random() < pc else p1.copy()
            for i in np.flatnonzero(rng.random(inst.n) < pm):
                child[i] = rng.choice(np.flatnonzero(inst.allowed[i]))
            children.append(child)
        P = children
        fit = np.array([penalised(inst, a) for a in P])
        hist.append(float(fit.max()))
    a = P[int(fit.argmax())]
    return dict(method="Genetic Algorithm", assign=a, time=time.perf_counter() - t, history=hist,
                feasible=inst.violation(a) == 0, **inst.evaluate(a))


def simulated_annealing(inst, iters=60_000, T0=1_000_000.0, alpha=0.99975, seed=0):
    rng = np.random.default_rng(seed)
    t = time.perf_counter()
    a = np.where(inst.allowed[:, SMS], SMS, CALL)
    fa = penalised(inst, a)
    best, fbest, T, hist = a.copy(), fa, T0, []
    for it in range(iters):
        b = a.copy()
        i = rng.integers(inst.n)
        b[i] = rng.choice(np.flatnonzero(inst.allowed[i]))
        if rng.random() < 0.3:                    # occasional swap move
            j = rng.integers(inst.n)
            if inst.allowed[i, a[j]] and inst.allowed[j, a[i]]:
                b[i], b[j] = a[j], a[i]
        fb = penalised(inst, b)
        if fb >= fa or rng.random() < math.exp((fb - fa) / T):
            a, fa = b, fb
            if fa > fbest:
                best, fbest = a.copy(), fa
        T *= alpha
        if it % 100 == 0:
            hist.append(float(fbest))
    return dict(method="Simulated Annealing", assign=best, time=time.perf_counter() - t, history=hist,
                feasible=inst.violation(best) == 0, **inst.evaluate(best))


# ---------------------------------------------------------------- multi-objective
def pareto_front(df, cfg, budgets):
    """epsilon-constraint: max f1 = gross recovery  s.t.  f2 = cost <= eps."""
    pts = []
    for eps in budgets:
        c2 = dict(cfg, budget=float(eps), strategy_priority=[1.0] * K, account_priority="none")
        inst = Instance(df, c2)
        inst.W = inst.R.copy()                    # objective f1 = gross recovery only
        r = solve_milp(inst)
        pts.append(dict(eps=float(eps), gross=r["gross_recovery"], cost=r["cost"], net=r["net_recovery"], mix=r["mix"]))
    return pts


def problem_size(inst):
    per = inst.allowed.sum(1)
    return dict(per_account=per.tolist(), size=float(np.prod(per.astype(float))),
                log10=float(np.log10(per).sum()), unrestricted=float(K ** inst.n))
