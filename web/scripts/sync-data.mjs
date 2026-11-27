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

// ---- Python code excerpts shown on /data → "Source & pipeline".
// Each snippet = first line matching `start` through the first later line matching `end` (inclusive),
// so the website always shows the code exactly as it is in src/.
const SNIPPETS = {
  extract:     ["01_explore.py", /^chunks = \[\]/, /^df\["rec_rate"\]/],
  features:    ["02_model_and_dataset.py", /^df = pd\.read_csv/, /"purpose_cat"\]$/],
  train:       ["02_model_and_dataset.py", /^X, y_cls, y_reg/, /^rho_te = /],
  portfolio:   ["02_model_and_dataset.py", /^QUOTA = /, /^pool\["annual_inc_thb"\]/],
  strategies:  ["optimizer.py", /^STRATEGIES = \[/, /^\]/],
  values:      ["optimizer.py", /^    def __post_init__/, /^        self\.hours = /],
  build_lp:    ["optimizer.py", /^def build_lp/, /^    return c, np\.array\(rows\)/],
  solve_milp:  ["optimizer.py", /^def solve_milp/, /^    return dict\(method="MILP/],
  lp_relax:    ["optimizer.py", /^def lp_relaxation/, /fractional=int/],
  greedy:      ["optimizer.py", /^def greedy/, /^    return dict\(method="Greedy/],
  violation:   ["optimizer.py", /^    def violation/, /^        return v$/],
  penalty:     ["optimizer.py", /^def penalised/, /^def random_allowed/],
  ga:          ["optimizer.py", /^def genetic_algorithm/, /feasible=inst\.violation\(a\) == 0/],
  sa:          ["optimizer.py", /^def simulated_annealing/, /feasible=inst\.violation\(best\) == 0/],
  pareto:      ["optimizer.py", /^def pareto_front/, /^    return pts/],
  make_cfg:    ["03b_phase1_benchmark.py", /^def make_cfg/, /^    \)$/],
  cohorts:     ["03b_phase1_benchmark.py", /^    pool = pd\.read_csv/, /results\["N300_frozen"\]/],
  wilcoxon:    ["03b_phase1_benchmark.py", /^    ga_all_gaps = /, /^    stat_w, p_val = /],
};
const snippets = {};
for (const [id, [file, start, end]] of Object.entries(SNIPPETS)) {
  const lines = readFileSync(join(ROOT, "src", file), "utf8").split(/\r?\n/);
  const s = lines.findIndex((l) => start.test(l));
  const e = s < 0 ? -1 : lines.findIndex((l, i) => i > s && end.test(l));
  if (s < 0 || e < 0) throw new Error(`snippet "${id}": markers not found in src/${file}`);
  let body = lines.slice(s, e + 1);
  if (id === "penalty") body = body.slice(0, -1);                 // end marker is the next def
  while (body.length && !body.at(-1).trim()) body.pop();
  const indent = Math.min(...body.filter((l) => l.trim()).map((l) => l.match(/^ */)[0].length));
  snippets[id] = { file: `src/${file}`, startLine: s + 1, endLine: s + body.length, code: body.map((l) => l.slice(indent)).join("\n") };
}
write("code_snippets.json", snippets);

for (const f of readdirSync(join(ROOT, "docs")).filter((f) => f.startsWith("fig_") && f.endsWith(".png"))) {
  copyFileSync(join(ROOT, "docs", f), join(FIG_OUT, f));
  console.log("copied public/figures/" + f);
}
