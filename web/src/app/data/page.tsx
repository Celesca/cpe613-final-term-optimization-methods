import type { Metadata } from "next";
import { DataExplorer } from "@/components/DataExplorer";

export const metadata: Metadata = { title: "Data & results · Debt Collection Optimizer" };

export default function DataPage() {
  return (
    <>
      <header className="pagehead">
        <div>
          <h1>Data &amp; results</h1>
          <p>The input dataset, the ML recovery model, and the experiment results behind the report. Every table is also available as JSON/CSV from <code>/api/data</code>.</p>
        </div>
      </header>
      <main className="page">
        <DataExplorer />
      </main>
    </>
  );
}
