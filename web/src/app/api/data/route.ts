// GET /api/data — index of available datasets.
import { DATASETS } from "@/lib/datasets";

export async function GET() {
  return Response.json(Object.entries(DATASETS).map(([name, d]) => ({
    name, url: `/api/data/${name}`, source: d.source, about: d.about,
    rows: Array.isArray(d.data) ? d.data.length : null,
    csv: Array.isArray(d.data) ? `/api/data/${name}?format=csv` : null,
  })));
}
