"use client";

import { useState } from "react";
import { barPath, compact, niceScale } from "./ColumnChart";
import { useElementWidth } from "./useElementWidth";

export interface ColumnGroup {
  key: string;
  /** Text under the group, or null to leave it blank. */
  xLabel: string | null;
  /** One bar per series, in the same order as `colors`. Zero leaves a gap. */
  values: number[];
  /** First line is shown large; the rest are details. */
  tooltip: [string, ...string[]];
}

interface Props {
  groups: ColumnGroup[];
  colors: string[];
  ariaLabel: string;
  height?: number;
  tick?: (n: number) => string;
  /** Stack the series in one column (parts of a whole) instead of side by side. */
  stacked?: boolean;
}

const MARGIN = { top: 10, right: 8, bottom: 30, left: 44 };

/**
 * Columns in groups (one group per month, one bar per year), so each month compares side by side.
 * With `stacked`, the series sit on top of each other in one column instead.
 */
export function GroupedColumnChart({ groups, colors, ariaLabel, height = 260, tick = compact, stacked = false }: Props) {
  const [ref, width] = useElementWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);

  const innerW = Math.max(0, width - MARGIN.left - MARGIN.right);
  const innerH = height - MARGIN.top - MARGIN.bottom;
  const heightOf = (g: ColumnGroup) => (stacked ? g.values.reduce((sum, v) => sum + v, 0) : Math.max(0, ...g.values));
  const { top, ticks } = niceScale(Math.max(0, ...groups.map(heightOf)));
  const slot = groups.length ? innerW / groups.length : 0;
  const series = stacked ? 1 : colors.length;
  const barW = Math.max(2, Math.min(stacked ? 28 : 22, (slot - 8) / series - 2));
  const groupW = barW * series + 2 * (series - 1);
  // On a phone there is no room for "Jan Feb Mar", so use one letter each.
  const narrow = slot < 36;
  const yOf = (v: number) => MARGIN.top + innerH - (v / top) * innerH;

  const activeGroup = active === null ? null : groups[active];
  const tipX = active === null ? 0 : Math.min(Math.max(MARGIN.left + slot * active + slot / 2, 90), width - 90);
  const tipY = activeGroup ? yOf(heightOf(activeGroup)) - 8 : 0;

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
          {groups.map((g, i) => {
            const left = MARGIN.left + slot * i + (slot - groupW) / 2;
            const label = g.xLabel && narrow && /^[A-Z][a-z]{2}$/.test(g.xLabel) ? g.xLabel.slice(0, 1) : g.xLabel;
            return (
              <g key={g.key}>
                {stacked && <Stack values={g.values} colors={colors} x={left} width={barW} yOf={yOf} dim={active !== null && active !== i} />}
                {!stacked && g.values.map((v, s) =>
                  v > 0 ? (
                    <path
                      key={s}
                      d={barPath(left + s * (barW + 2), yOf(v), barW, innerH - (yOf(v) - MARGIN.top))}
                      fill={colors[s]}
                      opacity={active === null || active === i ? 1 : 0.55}
                    />
                  ) : null,
                )}
                {label && (
                  <text x={MARGIN.left + slot * i + slot / 2} y={height - 8} textAnchor="middle">
                    {label}
                  </text>
                )}
                <rect
                  className="col-hit"
                  x={MARGIN.left + slot * i}
                  y={MARGIN.top}
                  width={slot}
                  height={innerH}
                  tabIndex={0}
                  role="img"
                  aria-label={g.tooltip.join(", ")}
                  onPointerEnter={() => setActive(i)}
                  onFocus={() => setActive(i)}
                  onBlur={() => setActive(null)}
                />
              </g>
            );
          })}
        </svg>
      )}
      {activeGroup && (
        <div className="chart-tip" style={{ left: tipX, top: tipY }} role="status">
          <strong>{activeGroup.tooltip[0]}</strong>
          {activeGroup.tooltip.slice(1).map((line) => (
            <span key={line} style={{ display: "block" }}>
              {line}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/** One column made of parts, first value at the bottom; only the top part gets the rounded corners. */
function Stack({ values, colors, x, width, yOf, dim }: { values: number[]; colors: string[]; x: number; width: number; yOf: (v: number) => number; dim: boolean }) {
  const topIndex = values.reduce((last, v, i) => (v > 0 ? i : last), -1);
  // Running totals: part s spans from starts[s] to starts[s] + values[s].
  const starts = values.map((_, s) => values.slice(0, s).reduce((sum, v) => sum + v, 0));
  return (
    <>
      {values.map((v, s) => {
        const from = starts[s];
        if (v <= 0) return null;
        const y = yOf(from + v);
        const h = yOf(from) - y;
        return s === topIndex ? (
          <path key={s} d={barPath(x, y, width, h)} fill={colors[s]} opacity={dim ? 0.55 : 1} />
        ) : (
          <rect key={s} x={x} y={y} width={width} height={h} fill={colors[s]} opacity={dim ? 0.55 : 1} />
        );
      })}
    </>
  );
}
