"use client";

import { useId, useState, type ReactNode } from "react";

export interface LegendItem {
  label: string;
  color: string;
}

interface Props {
  title: string;
  subtitle?: string;
  legend?: LegendItem[];
  /** Same numbers as the chart, so every value is reachable without hovering. */
  table: { headers: string[]; rows: (string | number)[][] };
  children: ReactNode;
}

export function ChartCard({ title, subtitle, legend, table, children }: Props) {
  const [view, setView] = useState<"chart" | "table">("chart");
  const id = useId();

  return (
    <section className="card" aria-labelledby={`${id}-title`}>
      <div className="card-head">
        <div>
          <h2 className="card-title" id={`${id}-title`}>
            {title}
          </h2>
          {subtitle && <p className="card-sub">{subtitle}</p>}
        </div>
        <button
          type="button"
          className="link-button"
          aria-pressed={view === "table"}
          onClick={() => setView(view === "chart" ? "table" : "chart")}
        >
          {view === "chart" ? "View as table" : "View as chart"}
        </button>
      </div>
      {legend && legend.length > 1 && view === "chart" && (
        <ul className="legend" aria-label="Legend">
          {legend.map((item) => (
            <li key={item.label}>
              <span className="legend-key" style={{ background: item.color }} aria-hidden="true" />
              {item.label}
            </li>
          ))}
        </ul>
      )}
      {view === "chart" ? (
        children
      ) : (
        <div className="table-scroll" tabIndex={0} role="region" aria-label={`${title}, as a table`}>
          <table className="data-table num">
            <thead>
              <tr>
                {table.headers.map((h, i) => (
                  <th key={h} scope="col" className={i > 0 ? "right" : undefined}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((row) => (
                <tr key={String(row[0])}>
                  {row.map((cell, i) => (
                    <td key={i} className={i > 0 ? "right" : undefined}>
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
