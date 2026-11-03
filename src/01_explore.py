"""Step 3a: extract charged-off / default loans from the LendingClub dump and profile them."""
import sys
import pandas as pd

SRC = sys.argv[1] if len(sys.argv) > 1 else "archive-2/loan.csv"
COLS = ["loan_amnt", "funded_amnt", "term", "int_rate", "installment", "grade", "sub_grade",
        "emp_length", "home_ownership", "annual_inc", "verification_status", "issue_d",
        "loan_status", "purpose", "addr_state", "dti", "delinq_2yrs", "inq_last_6mths",
        "open_acc", "pub_rec", "revol_bal", "revol_util", "total_acc", "out_prncp",
        "total_pymnt", "total_rec_prncp", "total_rec_int", "total_rec_late_fee",
        "recoveries", "collection_recovery_fee", "last_pymnt_d", "acc_now_delinq",
        "tot_coll_amt", "pub_rec_bankruptcies", "mort_acc", "num_tl_90g_dpd_24m"]

chunks = []
for ch in pd.read_csv(SRC, usecols=COLS, chunksize=300_000, low_memory=False):
    chunks.append(ch[ch["loan_status"].isin(["Charged Off", "Default",
                  "Does not meet the credit policy. Status:Charged Off"])])
df = pd.concat(chunks, ignore_index=True)
df.to_csv("data/defaulted_raw.csv.gz", index=False)

df["ead"] = (df["funded_amnt"] - df["total_rec_prncp"]).clip(lower=0)   # exposure at default
df["rec_rate"] = (df["recoveries"] / df["ead"]).where(df["ead"] > 0)
print("rows:", len(df)); print(df["loan_status"].value_counts())
print(df[["funded_amnt", "ead", "recoveries", "collection_recovery_fee", "rec_rate"]].describe().T)
print("share with any recovery:", (df.recoveries > 0).mean())
g = df.groupby("grade").agg(n=("ead", "size"), ead=("ead", "mean"), any_rec=("recoveries", lambda s: (s > 0).mean()),
                            rec_rate=("rec_rate", "mean"), fee_ratio=("collection_recovery_fee", "sum"))
g["fee_ratio"] = g["fee_ratio"] / df.groupby("grade")["recoveries"].sum()
print(g)
