// Registry of the datasets exposed at /api/data/<name> and on the /data page.
import accounts from "@/data/accounts.json";
import modelReport from "@/data/model_report.json";
import optimalN30 from "@/data/optimal_assignment_n30.json";
import phase1 from "@/data/phase1_benchmark.json";
import seedRuns from "@/data/phase1_seed_runs.json";
import summary from "@/data/phase1_summary.json";
import resultsN30 from "@/data/results_n30.json";

export const DATASETS = {
  accounts: { data: accounts, source: "data/accounts_pool.csv", about: "300-account LendingClub pool (THB), with ML recovery rate rho" },
  "model-report": { data: modelReport, source: "data/model_report.json", about: "Recovery model metrics and grade profile" },
  "results-n30": { data: resultsN30, source: "data/results_N30.json", about: "Report instance N=30: all methods, duals, Pareto" },
  "optimal-assignment-n30": { data: optimalN30, source: "data/optimal_assignment_N30.csv", about: "Optimal strategy per account, N=30" },
  "phase1-summary": { data: summary, source: "data/phase1_summary_table.csv", about: "Phase I benchmark summary across 6 cohorts" },
  "phase1-seed-runs": { data: seedRuns, source: "data/phase1_seed_runs.csv", about: "Every GA/SA run (seeds 0,1,2)" },
  "phase1-benchmark": { data: phase1, source: "data/phase1_benchmark.json", about: "Full Phase I benchmark (histories thinned to 120 points)" },
} as const;

export type DatasetName = keyof typeof DATASETS;

export function toCsv(rows: Record<string, unknown>[]): string {
  const cols = Object.keys(rows[0] ?? {});
  const cell = (v: unknown) => {
    const s = typeof v === "object" && v !== null ? JSON.stringify(v) : String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(","), ...rows.map((r) => cols.map((c) => cell(r[c])).join(","))].join("\n");
}
