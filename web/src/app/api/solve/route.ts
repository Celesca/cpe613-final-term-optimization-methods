// POST /api/solve — runs Exact MILP (HiGHS) + LP duals, Greedy, GA and SA on the server.
// Body: { cfg, strategies, ga, sa } (all optional; see parseInput). Streams NDJSON progress + result.
import { parseInput, runOptimization } from "@/lib/optimizer/run";
import { ndjsonStream, readJson } from "@/lib/stream";

export const maxDuration = 60;

export async function POST(req: Request) {
  const input = parseInput(await readJson(req));
  return ndjsonStream((emit) => runOptimization(input, emit));
}
