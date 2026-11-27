// Copies the Python pipeline outputs (../data, ../docs figures) into the Next.js app.
// Run from web/:  npm run sync-data
// Outputs are committed so a Vercel build (root = web/) never needs files outside web/.
import { copyFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const WEB = join(dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = join(WEB, "..");
const SRC = join(ROOT, "data");
const OUT = join(WEB, "src", "data");
const FIG_OUT = join(WEB, "public", "figures");
mkdirSync(OUT, { recursive: true });
mkdirSync(FIG_OUT, { recursive: true });

function csv(file) {
  const [head, ...lines] = readFileSync(join(SRC, file), "utf8").trim().split(/\r?\n/);
  const cols = head.split(",");
  return lines.map((line) => {
    const cells = line.split(",");
    return Object.fromEntries(cols.map((c, i) => {
      const v = cells[i];
      if (v === "True" || v === "False") return [c, v === "True"];
      return [c, v !== "" && !Number.isNaN(Number(v)) ? Number(v) : v];
    }));
  });
}
const json = (file) => JSON.parse(readFileSync(join(SRC, file), "utf8"));
const write = (name, data) => {
  writeFileSync(join(OUT, name), JSON.stringify(data));
  console.log("wrote src/data/" + name);
};
// Keep ~120 evenly spaced points of a convergence history (always keeps the last one).
const thin = (h, keep = 120) => {
  if (!Array.isArray(h) || h.length <= keep) return h;
  const step = (h.length - 1) / (keep - 1);
  return Array.from({ length: keep }, (_, i) => +h[Math.round(i * step)].toFixed(2));
};
const slimRuns = (runs) => runs.map(({ history, ...r }) => ({ ...r, history: thin(history) }));

write("accounts.json", csv("accounts_pool.csv"));
write("model_report.json", json("model_report.json"));
write("optimal_assignment_n30.json", csv("optimal_assignment_N30.csv"));
write("phase1_summary.json", csv("phase1_summary_table.csv"));
write("phase1_seed_runs.json", csv("phase1_seed_runs.csv"));

const res = json("results_N30.json");
write("results_n30.json", res);

const p1 = json("phase1_benchmark.json");
for (const r of Object.values(p1.results)) {
  r.ga_runs = slimRuns(r.ga_runs);
  r.sa_runs = slimRuns(r.sa_runs);
}
for (const [k, v] of Object.entries(p1.ablation_sa_T0)) if (k.endsWith("_runs")) p1.ablation_sa_T0[k] = slimRuns(v);
write("phase1_benchmark.json", p1);

for (const f of readdirSync(join(ROOT, "docs")).filter((f) => f.startsWith("fig_") && f.endsWith(".png"))) {
  copyFileSync(join(ROOT, "docs", f), join(FIG_OUT, f));
  console.log("copied public/figures/" + f);
}
