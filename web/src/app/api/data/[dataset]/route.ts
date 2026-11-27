// GET /api/data/<dataset>[?format=csv] — the project datasets as JSON (or CSV for tabular ones).
import { DATASETS, type DatasetName, toCsv } from "@/lib/datasets";

export async function GET(req: Request, ctx: RouteContext<"/api/data/[dataset]">) {
  const { dataset } = await ctx.params;
  const entry = DATASETS[dataset as DatasetName];
  if (!entry) return Response.json({ error: "unknown dataset", available: Object.keys(DATASETS) }, { status: 404 });
  const format = new URL(req.url).searchParams.get("format");
  if (format === "csv") {
    if (!Array.isArray(entry.data)) return Response.json({ error: "CSV only available for tabular datasets" }, { status: 400 });
    return new Response(toCsv(entry.data as Record<string, unknown>[]), {
      headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${dataset}.csv"` },
    });
  }
  return Response.json(entry.data);
}
