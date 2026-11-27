import type { Metadata } from "next";
import { DataExplorer } from "@/components/DataExplorer";

export const metadata: Metadata = { title: "Data & results · Debt Collection Optimizer" };

export default function DataPage() {
  return (
    <>
      <header className="pagehead">
        <div>
          <h1>Data &amp; results</h1>
          <p>Where the data comes from (LendingClub on Kaggle), how the pipeline turns it into a Thai collection portfolio, and the experiment results behind the report. Every table is also available as JSON/CSV from <code>/api/data</code>.</p>
        </div>
      </header>
      <main className="page">
        <DataExplorer />
      </main>
    </>
  );
}
