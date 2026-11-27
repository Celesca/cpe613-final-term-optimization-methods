"use client";
import { type ReactNode, useMemo, useState } from "react";

export interface Column<T> {
  key: string;
  label: ReactNode;
  num?: boolean;
  value?: (row: T) => number | string;   // used for sorting (defaults to row[key])
  render?: (row: T) => ReactNode;        // used for display
}

export function DataTable<T extends object>({ rows, columns, tall, highlight, empty = "No rows" }: {
  rows: T[]; columns: Column<T>[]; tall?: boolean; highlight?: (row: T) => boolean; empty?: string;
}) {
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null);
  const sorted = useMemo(() => {
    if (!sort) return rows;
    const col = columns.find((c) => c.key === sort.key)!;
    const get = col.value ?? ((r: T) => (r as Record<string, unknown>)[col.key] as number | string);
    return [...rows].sort((a, b) => {
      const x = get(a), y = get(b);
      return (typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y))) * sort.dir;
    });
  }, [rows, columns, sort]);
  return (
    <div className={tall ? "scroll tall" : "scroll"}>
      <table>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} className={(c.num ? "num " : "") + "sortable"}
                onClick={() => setSort((s) => (s?.key === c.key ? { key: c.key, dir: s.dir === 1 ? -1 : 1 } : { key: c.key, dir: c.num ? -1 : 1 }))}>
                {c.label}{sort?.key === c.key ? (sort.dir === 1 ? " ▲" : " ▼") : ""}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.length === 0 && <tr><td colSpan={columns.length} className="empty">{empty}</td></tr>}
          {sorted.map((r, i) => (
            <tr key={i} className={highlight?.(r) ? "hl" : undefined}>
              {columns.map((c) => (
                <td key={c.key} className={c.num ? "num" : undefined}>
                  {c.render ? c.render(r) : String((r as Record<string, unknown>)[c.key] ?? "")}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
