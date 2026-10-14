"use client";

import { useState } from "react";
import { useElementWidth } from "./useElementWidth";

export interface Column {
  key: string;
  /** Short text under the column, or null to skip it. */
  xLabel: string | null;
  value: number;
  /** Drawn in the emphasis color when true. */
  emphasis?: boolean;
  /** First line is the value (shown large); the rest are details. */
  tooltip: [string, ...string[]];
}

interface Props {
  columns: Column[];
  ariaLabel: string;
  height?: number;
  baseColor?: string;
  emphasisColor?: string;
  /** Keeps the axis at least this tall, so several charts can share one scale. */
  maxValue?: number;
  /** Formats y-axis ticks. */
  tick?: (n: number) => string;
}

const MARGIN = { top: 10, right: 8, bottom: 30, left: 44 };

/** Round the top of the axis up to a tidy number and pick ~4 even steps. */
export function niceScale(max: number): { top: number; ticks: number[] } {
  if (max <= 0) return { top: 1, ticks: [0, 1] };
  const rough = max / 4;
  const mag = 10 ** Math.floor(Math.log10(rough));
  const norm = rough / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag;
  const top = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let v = 0; v <= top + step / 2; v += step) ticks.push(v);
  return { top, ticks };
}

export const compact = (n: number) => (n >= 1000 ? `${+(n / 1000).toFixed(1)}K` : String(n));

/** A bar with a square foot and a 4px rounded top. */
export function barPath(x: number, y: number, w: number, h: number): string {
  const r = Math.min(4, w / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

export function ColumnChart({
  columns,
  ariaLabel,
  height = 240,
  baseColor = "#536872",
  emphasisColor = "#2b3a42",
  maxValue = 0,
  tick = compact,
}: Props) {
  const [ref, width] = useElementWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);

  const innerW = Math.max(0, width - MARGIN.left - MARGIN.right);
  const innerH = height - MARGIN.top - MARGIN.bottom;
  const { top, ticks } = niceScale(Math.max(maxValue, ...columns.map((c) => c.value)));
  const slot = columns.length ? innerW / columns.length : 0;
  const barW = Math.max(2, Math.min(24, slot - 2));
  const yOf = (v: number) => MARGIN.top + innerH - (v / top) * innerH;
  const focusable = columns.length <= 31;

  const activeColumn = active === null ? null : columns[active];
  const tipX = active === null ? 0 : Math.min(Math.max(MARGIN.left + slot * active + slot / 2, 70), width - 70);
  const tipY = activeColumn ? yOf(activeColumn.value) - 8 : 0;

  return (
    <div className="chart-wrap" ref={ref}>
      {width > 0 && (
        <svg
          className="chart-svg"
          width={width}
          height={height}
          role="group"
          aria-label={ariaLabel}
          onPointerLeave={() => setActive(null)}
        >
          {ticks.map((t) => (
            <g key={t}>
              <line x1={MARGIN.left} x2={width - MARGIN.right} y1={yOf(t)} y2={yOf(t)} stroke={t === 0 ? "#c9c1ac" : "#e6e1d4"} strokeWidth={1} />
              <text x={MARGIN.left - 8} y={yOf(t) + 4} textAnchor="end">
                {tick(t)}
              </text>
            </g>
          ))}
          {columns.map((c, i) => {
            const x = MARGIN.left + slot * i + (slot - barW) / 2;
            const h = innerH - (yOf(c.value) - MARGIN.top);
            return (
              <g key={c.key}>
                {c.value > 0 && (
                  <path
                    d={barPath(x, yOf(c.value), barW, h)}
                    fill={c.emphasis ? emphasisColor : baseColor}
                    opacity={active === null || active === i ? 1 : 0.55}
                  />
                )}
                {c.xLabel && (
                  <text x={MARGIN.left + slot * i + slot / 2} y={height - 8} textAnchor="middle">
                    {c.xLabel}
                  </text>
                )}
                <rect
                  className="col-hit"
                  x={MARGIN.left + slot * i}
                  y={MARGIN.top}
                  width={slot}
                  height={innerH}
                  tabIndex={focusable ? 0 : undefined}
                  role="img"
                  aria-label={c.tooltip.join(", ")}
                  onPointerEnter={() => setActive(i)}
                  onFocus={() => setActive(i)}
                  onBlur={() => setActive(null)}
                />
              </g>
            );
          })}
        </svg>
      )}
      {activeColumn && (
        <div className="chart-tip" style={{ left: tipX, top: tipY }} role="status">
          <strong>{activeColumn.tooltip[0]}</strong>
          {activeColumn.tooltip.slice(1).map((line) => (
            <span key={line} style={{ display: "block" }}>
              {line}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
