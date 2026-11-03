"""Step 3b: learn a per-account recovery model from LendingClub charged-off loans,
then build a Thai-baht collection portfolio for the optimisation model.

Model:  rho_i = P(any recovery | x_i) * E[recovery rate | recovered, x_i]
Output: data/accounts_pool.csv (300 accounts), data/accounts_N30.csv, data/model_report.json
"""
import json
import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingClassifier, HistGradientBoostingRegressor
from sklearn.metrics import roc_auc_score, mean_absolute_error, brier_score_loss
from sklearn.model_selection import train_test_split

FX = 33.0          # THB per USD (Oct-2026 ~33.1-33.3)
SEED = 613
rng = np.random.default_rng(SEED)

df = pd.read_csv("data/defaulted_raw.csv.gz", low_memory=False)
df["ead"] = (df["funded_amnt"] - df["total_rec_prncp"]).clip(lower=0)
df = df[df["ead"] > 500].copy()
df["rec_rate"] = (df["recoveries"] / df["ead"]).clip(0, 1)
df["recovered"] = (df["recoveries"] > 0).astype(int)

# --- features (no leakage: recoveries / fees / total_pymnt are excluded) ---
df["term_m"] = df["term"].str.extract(r"(\d+)").astype(float)
df["emp_years"] = df["emp_length"].str.extract(r"(\d+)").astype(float)
df["paid_frac"] = df["total_rec_prncp"] / df["funded_amnt"]
df["grade_num"] = df["grade"].map({g: i for i, g in enumerate("ABCDEFG")})
df["sub_grade_num"] = df["grade_num"] * 5 + df["sub_grade"].str[1].astype(int) - 1
df["issue_year"] = pd.to_datetime(df["issue_d"], format="%b-%Y").dt.year
for c in ["home_ownership", "verification_status", "purpose"]:
    df[c + "_cat"] = df[c].astype("category").cat.codes
FEATS = ["grade_num", "sub_grade_num", "int_rate", "term_m", "installment", "annual_inc", "dti",
         "emp_years", "revol_util", "revol_bal", "open_acc", "total_acc", "inq_last_6mths",
         "delinq_2yrs", "pub_rec", "pub_rec_bankruptcies", "mort_acc", "ead", "paid_frac",
         "total_rec_late_fee", "issue_year", "home_ownership_cat", "verification_status_cat", "purpose_cat"]
X, y_cls, y_reg = df[FEATS], df["recovered"], df["rec_rate"]
Xtr, Xte, ctr, cte, rtr, rte = train_test_split(X, y_cls, y_reg, test_size=0.25, random_state=SEED)

clf = HistGradientBoostingClassifier(max_iter=300, learning_rate=0.08, random_state=SEED).fit(Xtr, ctr)
p_te = clf.predict_proba(Xte)[:, 1]
reg = HistGradientBoostingRegressor(max_iter=300, learning_rate=0.08, random_state=SEED).fit(Xtr[ctr == 1], rtr[ctr == 1])
m_te = reg.predict(Xte).clip(0, 1)
rho_te = p_te * m_te

grade_only = df.groupby("grade_num")["recovered"].mean()
report = {
    "n_defaulted_used": int(len(df)),
    "fx_thb_per_usd": FX,
    "classifier_auc": round(roc_auc_score(cte, p_te), 4),
    "classifier_auc_grade_only": round(roc_auc_score(cte, Xte["grade_num"].map(grade_only)), 4),
    "classifier_brier": round(brier_score_loss(cte, p_te), 4),
    "rate_mae_given_recovered": round(mean_absolute_error(rte[cte == 1], m_te[cte == 1]), 4),
    "expected_rate_mae_all": round(mean_absolute_error(rte, rho_te), 4),
    "mean_actual_rate": round(float(rte.mean()), 4),
    "mean_predicted_rate": round(float(rho_te.mean()), 4),
}
print(json.dumps(report, indent=2))

# --- build the collection portfolio (stratified by grade) ---
QUOTA = {"A": 25, "B": 50, "C": 75, "D": 65, "E": 45, "F": 25, "G": 15}
pool = pd.concat([df[df["grade"] == g].sample(n=n, random_state=SEED) for g, n in QUOTA.items()],
                 ignore_index=True)
pool["p_pay"] = clf.predict_proba(pool[FEATS])[:, 1]
pool["rate_if_pay"] = reg.predict(pool[FEATS]).clip(0, 1)
# Generated fields to mimic a live Thai collection book (documented as synthetic):
pool["dpd"] = rng.choice([30, 60, 90, 120, 180], size=len(pool), p=[0.30, 0.25, 0.20, 0.15, 0.10])
pool["reachable"] = (rng.random(len(pool)) < np.where(pool["grade_num"] >= 4, 0.70, 0.85)).astype(int)
decay = np.exp(-0.004 * (pool["dpd"] - 30))           # recovery decays with days past due
pool["rho"] = (pool["p_pay"] * pool["rate_if_pay"] * decay).clip(0.01, 0.6)
pool["balance_thb"] = (pool["ead"] * FX).round(-2)
pool["annual_inc_thb"] = (pool["annual_inc"] * FX).round(-3)
out = pool.assign(account_id=[f"TH{i+1:04d}" for i in range(len(pool))])[
    ["account_id", "grade", "sub_grade", "int_rate", "term_m", "dpd", "reachable", "balance_thb",
     "annual_inc_thb", "dti", "p_pay", "rate_if_pay", "rho", "recoveries", "ead"]]
out = out.rename(columns={"recoveries": "hist_recoveries_usd", "ead": "ead_usd"})
out = out.sample(frac=1, random_state=SEED).reset_index(drop=True)
out["account_id"] = [f"TH{i+1:04d}" for i in range(len(out))]
out.round(4).to_csv("data/accounts_pool.csv", index=False)
out.head(30).round(4).to_csv("data/accounts_N30.csv", index=False)
report["pool_size"] = len(out)
report["pool_grade_counts"] = out["grade"].value_counts().sort_index().to_dict()
report["N30_total_balance_thb"] = float(out.head(30)["balance_thb"].sum())
report["grade_profile"] = df.groupby("grade").agg(n=("ead", "size"), mean_ead_thb=("ead", lambda s: round(s.mean() * FX)),
    p_recovered=("recovered", "mean"), mean_rate=("rec_rate", "mean")).round(4).reset_index().to_dict("records")
json.dump(report, open("data/model_report.json", "w"), indent=2)
print(out.head(30).describe().T[["mean", "min", "max"]])
