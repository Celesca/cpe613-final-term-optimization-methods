"""Step 5: embed the account pool + model report into the single-file simulator."""
import json
import sys

import pandas as pd

sys.path.insert(0, "src")
from optimizer import DEFAULT_CFG, STRATEGIES

pool = pd.read_csv("data/accounts_pool.csv")
cols = ["account_id", "grade", "sub_grade", "dpd", "reachable", "balance_thb", "p_pay", "rate_if_pay", "rho"]
payload = dict(
    accounts=pool[cols].round(4).to_dict("records"),
    strategies=STRATEGIES,
    cfg=DEFAULT_CFG,
    model=json.load(open("data/model_report.json")),
    python=json.load(open("data/results_N30.json"))["exact"]["objective"],
)
tpl = open("frontend/template.html", encoding="utf-8").read()
html = tpl.replace("/*__DATA__*/null", json.dumps(payload, separators=(",", ":")))
open("frontend/index.html", "w", encoding="utf-8").write(html)
print("wrote frontend/index.html", len(html) // 1024, "KB")
