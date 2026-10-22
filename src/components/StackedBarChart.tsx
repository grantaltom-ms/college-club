"use client";

import { useState } from "react";
import { useElementWidth } from "./useElementWidth";

export interface StackedRow {
  key: string;
  /** Text to the left of the bar. */
  label: string;
  /** Text to the right of the bar, such as the share that matters most. */
  note: string;
  /** One count per part, in the same order as `colors`. The bar always fills the width (100%). */
  values: number[];
  /** First line is shown large; the rest are details. */
  tooltip: [string, ...string[]];
}

interface Props {
  rows: StackedRow[];
  colors: string[];
  ariaLabel: string;
}

const ROW_H = 34;
const GAP = 14;
const LABEL_W = 132;
const NOTE_W = 176;

/** Horizontal bars that each fill the full width, split into parts by their share of the row (100% stacked). */
export function StackedBarChart({ rows, colors, ariaLabel }: Props) {
  const [ref, width] = useElementWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);

  // On a phone the labels would squeeze the bars, so they go above and below instead of beside.
  const narrow = width > 0 && width < 520;
  const left = narrow ? 0 : LABEL_W;
  const right = narrow ? 0 : NOTE_W;
  const barW = Math.max(0, width - left - right);
  const rowH = narrow ? ROW_H + 40 : ROW_H;
  const height = rows.length * rowH + (rows.length - 1) * GAP;

  const activeRow = active === null ? null : rows[active];
  const tipY = active === null ? 0 : active * (rowH + GAP) - 6;
  const tipX = Math.min(Math.max(left + barW / 2, 90), Math.max(90, width - 90));

  return (
    <div className="chart-wrap" ref={ref}>
      {width > 0 && (
        <svg className="chart-svg" width={width} height={height} role="group" aria-label={ariaLabel} onPointerLeave={() => setActive(null)}>
          {rows.map((row, i) => {
            const top = i * (rowH + GAP);
            const barY = top + (narrow ? 20 : (rowH - 22) / 2);
            const total = row.values.reduce((sum, v) => sum + v, 0);
            let x = left;
            return (
              <g key={row.key} data-testid={`stack-${row.key}`}>
                <text x={0} y={narrow ? top + 12 : barY + 16} fontWeight={500}>
                  {row.label}
                </text>
                {row.values.map((v, s) => {
                  if (v <= 0 || total <= 0) return null;
                  const w = (v / total) * barW;
                  const part = (
                    <rect
                      key={s}
                      x={x}
                      y={barY}
                      width={w}
                      height={22}
                      fill={colors[s]}
                      stroke={w >= 6 ? "#ffffff" : undefined}
                      strokeWidth={w >= 6 ? 1.5 : undefined}
                      opacity={active === null || active === i ? 1 : 0.55}
                    />
                  );
                  x += w;
                  return part;
                })}
                <text x={narrow ? 0 : left + barW + 10} y={narrow ? barY + 40 : barY + 16}>
                  {row.note}
                </text>
                <rect
                  className="col-hit"
                  x={0}
                  y={top}
                  width={width}
                  height={rowH}
                  tabIndex={0}
                  role="img"
                  aria-label={row.tooltip.join(", ")}
                  onPointerEnter={() => setActive(i)}
                  onFocus={() => setActive(i)}
                  onBlur={() => setActive(null)}
                />
              </g>
            );
          })}
        </svg>
      )}
      {activeRow && (
        <div className="chart-tip" style={{ left: tipX, top: tipY }} role="status">
          <strong>{activeRow.tooltip[0]}</strong>
          {activeRow.tooltip.slice(1).map((line) => (
            <span key={line} style={{ display: "block" }}>
              {line}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
