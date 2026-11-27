// POST /api/pareto — epsilon-constraint Pareto front (max gross recovery s.t. cost <= eps), 21 exact MILPs.
import { parseInput, runPareto } from "@/lib/optimizer/run";
import { ndjsonStream, readJson } from "@/lib/stream";

export const maxDuration = 60;

export async function POST(req: Request) {
  const input = parseInput(await readJson(req));
  return ndjsonStream((emit) => runPareto(input, emit));
}
