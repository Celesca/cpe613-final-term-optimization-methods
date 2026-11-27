# Debt Collection Optimizer — web app

Next.js app for the CPE 613 project. The solvers run **on the server** (Next.js route handlers, Node runtime):

| Route | What it does |
| :--- | :--- |
| `/` | Simulator UI. Calls `POST /api/solve` and `POST /api/pareto`, streams progress. |
| `/data` | Data & results: 300-account pool, ML model report, N=30 report results, Phase I benchmarks, figures. |
| `/about` | Model formulation, algorithms, API reference. |
| `POST /api/solve` | Exact MILP (HiGHS) + LP duals, Greedy, GA, SA. Body `{ cfg, strategies, ga, sa }`, all optional. NDJSON stream. |
| `POST /api/pareto` | ε-constraint Pareto front (21 exact MILPs). |
| `GET /api/data[/<name>][?format=csv]` | Datasets exported by the Python pipeline. |

Solver code: `src/lib/optimizer/` (TypeScript port of `../src/optimizer.py`).
`tests/optimizer.test.ts` checks it reproduces the Python results (N=30 optimum ฿1,099,661.34, LP bound, greedy, N=100/300 optima).

## Run locally

```bash
cd web
npm install
npm run dev        # http://localhost:3000
npm test           # parity tests against the Python results
```

## Refresh the data

After re-running the Python pipeline (`../src/*.py`), copy the outputs into the app and commit them:

```bash
npm run sync-data  # ../data/*.csv|json -> src/data/*.json, ../docs/fig_*.png -> public/figures/
```

## Deploy to Vercel

1. Push the repo to GitHub.
2. In Vercel: **Add New → Project**, import the repo, set **Root Directory = `web`** (framework is detected as Next.js).
3. Deploy. No environment variables are needed.

The solver routes set `maxDuration = 60`; a default N=30 run takes well under a second, N=300 about 2 s.
`next.config.ts` ships `highs.wasm` with the solver functions (`outputFileTracingIncludes`).
