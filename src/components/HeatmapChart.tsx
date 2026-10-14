"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { fmtInt, heatColor, type Heatmap } from "@/lib/stats";

interface Props {
  data: Heatmap;
  ariaLabel: string;
}

const fmt = (n: number) => (n >= 10 ? String(Math.round(n)) : n.toFixed(1));

/** Days down the side, hours across the top; darker means more door entries. */
export function HeatmapChart({ data, ariaLabel }: Props) {
  const [tip, setTip] = useState<{
    x: number;
    above: number;
    below: number;
    flip?: boolean;
    lines: [string, ...string[]];
  } | null>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  // The scroll wrapper clips anything above the grid, so the top rows show their tip below the cell.
  useLayoutEffect(() => {
    const el = tipRef.current;
    if (tip && tip.flip === undefined && el) {
      setTip({ ...tip, flip: tip.above - el.offsetHeight < 0 });
    }
  }, [tip]);
  const columns = `56px repeat(${data.hours.length}, minmax(0, 1fr))`;

  return (
    <div>
      <div className="heat-scroll">
        <div className="heat" role="group" aria-label={ariaLabel} onPointerLeave={() => setTip(null)}>
          <div className="heat-grid" style={{ gridTemplateColumns: columns }}>
            <span />
            {data.rows[0]?.cells.map((c, i) => {
              const labelled = c.hour % 3 === 0;
              const span = Math.min(3, data.hours.length - i);
              return (
                <span
                  key={c.hour}
                  className="heat-hour"
                  style={labelled ? { gridColumn: `${i + 2} / span ${span}` } : { display: "none" }}
                >
                  {labelled ? c.label : ""}
                </span>
              );
            })}
            {data.rows.map((row) => [
              <span key={`${row.short}-name`} className="heat-day">
                {row.short}
              </span>,
              ...row.cells.map((c) => (
                <span
                  key={`${row.short}-${c.hour}`}
                  className="heat-cell"
                  role="img"
                  aria-label={`${row.name} ${c.label}: ${fmt(c.perDay)} entries`}
                  style={{ background: heatColor(c.perDay, data.max) }}
                  onPointerEnter={(e) => {
                    const el = e.currentTarget;
                    setTip({
                      x: el.offsetLeft + el.offsetWidth / 2,
                      above: el.offsetTop - 4,
                      below: el.offsetTop + el.offsetHeight + 4,
                      lines: [`${fmt(c.perDay)} entries`, `${row.name}, ${c.label}`, `${fmtInt(c.entries)} in total over ${row.days} days`],
                    });
                  }}
                />
              )),
            ])}
          </div>
          {tip && (
            <div
              ref={tipRef}
              className={tip.flip ? "chart-tip chart-tip-below" : "chart-tip"}
              style={{ left: tip.x, top: tip.flip ? tip.below : tip.above, visibility: tip.flip === undefined ? "hidden" : undefined }}
              role="status"
            >
              <strong>{tip.lines[0]}</strong>
              {tip.lines.slice(1).map((line) => (
                <span key={line} style={{ display: "block" }}>
                  {line}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="heat-scale" aria-hidden="true">
        <span>0</span>
        <span className="heat-ramp" style={{ background: `linear-gradient(to right, ${heatColor(0, 1)}, ${heatColor(1, 1)})` }} />
        <span>{fmt(data.max)} entries an hour</span>
      </div>
    </div>
  );
}
