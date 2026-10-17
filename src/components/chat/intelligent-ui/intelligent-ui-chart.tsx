"use client";

import { TableIcon } from "lucide-react";
import { useExtracted, useLocale } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { niceTicks } from "@/lib/intelligent-ui/format";
import type { IntelligentUiBlockOf } from "@/lib/intelligent-ui/schema";
import { cn } from "@/lib/utils";

type ChartBlock = IntelligentUiBlockOf<"chart">;

const MAX_SLICES = 8;
const seriesColor = (index: number) => `var(--iui-series-${(index % MAX_SLICES) + 1})`;

const MARGIN = { top: 12, right: 12, bottom: 28 };

function useElementWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      setWidth(Math.floor(entry.contentRect.width));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

function useValueFormatter(chart: ChartBlock) {
  const locale = useLocale();
  const compact = new Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: 1 });
  const full = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 });
  const wrap = (value: string) => `${chart.valuePrefix ?? ""}${value}${chart.valueSuffix ?? ""}`;
  return {
    // Long units ("people") would crowd the axis; the tooltip and table still show them.
    axis: (value: number) =>
      `${chart.valuePrefix ?? ""}${compact.format(value)}${
        (chart.valueSuffix?.trim().length ?? 0) <= 3 ? (chart.valueSuffix ?? "") : ""
      }`,
    value: (value: number) => wrap(full.format(value)),
  };
}

/** A bar whose data end (away from the baseline) has 4px rounded corners. */
function barPath(x: number, from: number, to: number, width: number, rounded: boolean) {
  const height = Math.abs(to - from);
  const radius = rounded ? Math.min(4, width / 2, height) : 0;
  const up = to <= from;
  const end = to;
  const inner = up ? end + radius : end - radius;
  return [
    `M${x},${from}`,
    `L${x},${inner}`,
    `Q${x},${end} ${x + radius},${end}`,
    `L${x + width - radius},${end}`,
    `Q${x + width},${end} ${x + width},${inner}`,
    `L${x + width},${from}`,
    "Z",
  ].join(" ");
}

function truncateLabel(label: string, max: number) {
  return label.length > max ? `${label.slice(0, Math.max(max - 1, 1))}…` : label;
}

function ChartLegend({ chart }: { chart: ChartBlock }) {
  if (chart.series.length < 2) return null;
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {chart.series.map((series, index) => (
        <li key={`${series.name}-${index}`} className="flex items-center gap-1.5">
          <span
            aria-hidden
            className="size-2.5 rounded-[3px]"
            style={{ background: seriesColor(index) }}
          />
          {series.name}
        </li>
      ))}
    </ul>
  );
}

function CartesianChart({ chart }: { chart: ChartBlock }) {
  const [containerRef, width] = useElementWidth<HTMLDivElement>();
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const format = useValueFormatter(chart);
  const height = width < 480 ? 200 : 240;
  const plotHeight = height - MARGIN.top - MARGIN.bottom;
  const count = chart.labels.length;
  const isBar = chart.kind === "bar";
  const stacked = isBar && chart.stacked === true && chart.series.length > 1;

  let dataMin = Infinity;
  let dataMax = -Infinity;
  for (let index = 0; index < count; index += 1) {
    if (stacked) {
      let positive = 0;
      let negative = 0;
      for (const series of chart.series) {
        const value = series.values[index];
        if (value >= 0) positive += value;
        else negative += value;
      }
      dataMax = Math.max(dataMax, positive);
      dataMin = Math.min(dataMin, negative);
    } else {
      for (const series of chart.series) {
        dataMax = Math.max(dataMax, series.values[index]);
        dataMin = Math.min(dataMin, series.values[index]);
      }
    }
  }
  // Bars and areas are read against zero, so their scale always includes it.
  if (chart.kind !== "line") {
    dataMin = Math.min(dataMin, 0);
    dataMax = Math.max(dataMax, 0);
  }
  const ticks = niceTicks(dataMin, dataMax, height < 220 ? 4 : 5);
  const longestTick = Math.max(...ticks.map((tick) => format.axis(tick).length));
  const marginLeft = Math.min(Math.max(longestTick * 6.5 + 14, 32), 120);
  const plotWidth = Math.max(width - marginLeft - MARGIN.right, 0);
  const domainMin = ticks[0];
  const domainMax = ticks.at(-1) ?? 1;
  const y = (value: number) =>
    MARGIN.top + plotHeight - ((value - domainMin) / (domainMax - domainMin || 1)) * plotHeight;
  const band = count > 0 ? plotWidth / count : 0;
  const xCenter = (index: number) =>
    marginLeft +
    (isBar
      ? band * index + band / 2
      : count === 1
        ? plotWidth / 2
        : (plotWidth / (count - 1)) * index);
  const baseline = y(Math.min(Math.max(0, domainMin), domainMax));

  const labelEvery = Math.max(1, Math.ceil(count / Math.max(Math.floor(plotWidth / 64), 1)));
  const maxLabelChars = Math.max(4, Math.floor((band * labelEvery) / 7));

  const tooltipLeft = hoverIndex === null ? 0 : xCenter(hoverIndex);

  return (
    <div ref={containerRef} className="relative w-full" onPointerLeave={() => setHoverIndex(null)}>
      {width > 0 ? (
        <svg
          aria-hidden
          className="block overflow-visible"
          height={height}
          width={width}
          viewBox={`0 0 ${width} ${height}`}
        >
          {ticks.map((tick) => (
            <g key={tick}>
              <line
                stroke="var(--iui-grid)"
                strokeWidth={1}
                x1={marginLeft}
                x2={marginLeft + plotWidth}
                y1={y(tick)}
                y2={y(tick)}
              />
              <text
                className="fill-muted-foreground tabular-nums"
                dominantBaseline="middle"
                fontSize={11}
                textAnchor="end"
                x={marginLeft - 8}
                y={y(tick)}
              >
                {format.axis(tick)}
              </text>
            </g>
          ))}
          <line
            stroke="var(--iui-axis)"
            strokeWidth={1}
            x1={marginLeft}
            x2={marginLeft + plotWidth}
            y1={baseline}
            y2={baseline}
          />

          {chart.labels.map((label, index) =>
            index % labelEvery === 0 ? (
              <text
                key={`${label}-${index}`}
                className="fill-muted-foreground"
                fontSize={11}
                textAnchor="middle"
                x={xCenter(index)}
                y={height - 8}
              >
                {truncateLabel(label, maxLabelChars)}
              </text>
            ) : null,
          )}

          {isBar ? (
            <BarMarks
              marginLeft={marginLeft}
              band={band}
              baseline={baseline}
              chart={chart}
              hoverIndex={hoverIndex}
              stacked={stacked}
              y={y}
            />
          ) : (
            <LineMarks
              baseline={baseline}
              chart={chart}
              hoverIndex={hoverIndex}
              xCenter={xCenter}
              y={y}
            />
          )}

          {!isBar && hoverIndex !== null ? (
            <line
              stroke="var(--iui-axis)"
              strokeDasharray="3 3"
              x1={tooltipLeft}
              x2={tooltipLeft}
              y1={MARGIN.top}
              y2={MARGIN.top + plotHeight}
            />
          ) : null}

          {chart.labels.map((label, index) => {
            const hitWidth = isBar ? band : count === 1 ? plotWidth : plotWidth / (count - 1);
            return (
              <rect
                key={`hit-${label}-${index}`}
                fill="transparent"
                height={plotHeight + MARGIN.bottom}
                onPointerEnter={() => setHoverIndex(index)}
                onPointerDown={() => setHoverIndex(index)}
                width={hitWidth}
                x={isBar ? marginLeft + band * index : xCenter(index) - hitWidth / 2}
                y={MARGIN.top}
              />
            );
          })}
        </svg>
      ) : (
        <div style={{ height }} />
      )}

      {hoverIndex !== null ? (
        <div
          className="pointer-events-none absolute top-0 z-10 min-w-32 rounded-md border bg-popover px-2.5 py-2 text-xs text-popover-foreground shadow-md"
          style={{
            left: Math.min(Math.max(tooltipLeft, 72), Math.max(width - 72, 72)),
            transform: "translateX(-50%)",
          }}
        >
          <p className="mb-1 font-medium">{chart.labels[hoverIndex]}</p>
          <ul className="space-y-0.5">
            {chart.series.map((series, index) => (
              <li key={`${series.name}-${index}`} className="flex items-center gap-2">
                <span
                  aria-hidden
                  className="size-2 shrink-0 rounded-[2px]"
                  style={{ background: seriesColor(index) }}
                />
                <span className="text-muted-foreground">{series.name}</span>
                <span className="ml-auto pl-3 font-medium whitespace-nowrap tabular-nums">
                  {format.value(series.values[hoverIndex])}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function BarMarks({
  chart,
  marginLeft,
  band,
  baseline,
  hoverIndex,
  stacked,
  y,
}: {
  chart: ChartBlock;
  marginLeft: number;
  band: number;
  baseline: number;
  hoverIndex: number | null;
  stacked: boolean;
  y: (value: number) => number;
}) {
  const groupWidth = band * (chart.labels.length > 12 ? 0.8 : 0.7);
  const seriesCount = stacked ? 1 : chart.series.length;
  const gap = seriesCount > 1 ? 2 : 0;
  const barWidth = Math.max((groupWidth - gap * (seriesCount - 1)) / seriesCount, 1);

  return chart.labels.map((label, index) => {
    const groupX = marginLeft + band * index + (band - groupWidth) / 2;
    const dimmed = hoverIndex !== null && hoverIndex !== index;
    if (stacked) {
      let positive = 0;
      let negative = 0;
      const lastPositive = chart.series.findLastIndex((series) => series.values[index] > 0);
      const lastNegative = chart.series.findLastIndex((series) => series.values[index] < 0);
      return (
        <g key={`${label}-${index}`} opacity={dimmed ? 0.55 : 1}>
          {chart.series.map((series, seriesIndex) => {
            const value = series.values[index];
            if (value === 0) return null;
            const start = value > 0 ? positive : negative;
            const end = start + value;
            if (value > 0) positive = end;
            else negative = end;
            const from = y(start);
            const to = y(end);
            // A 2px surface gap separates stacked segments.
            const inset = Math.min(1, Math.abs(to - from) / 2);
            return (
              <path
                key={`${series.name}-${seriesIndex}`}
                d={barPath(
                  groupX,
                  start === 0 ? from : from + (value > 0 ? -inset : inset),
                  to,
                  groupWidth,
                  seriesIndex === (value > 0 ? lastPositive : lastNegative),
                )}
                fill={seriesColor(seriesIndex)}
              />
            );
          })}
        </g>
      );
    }
    return (
      <g key={`${label}-${index}`} opacity={dimmed ? 0.55 : 1}>
        {chart.series.map((series, seriesIndex) => (
          <path
            key={`${series.name}-${seriesIndex}`}
            d={barPath(
              groupX + seriesIndex * (barWidth + gap),
              baseline,
              y(series.values[index]),
              barWidth,
              true,
            )}
            fill={seriesColor(seriesIndex)}
          />
        ))}
      </g>
    );
  });
}

function LineMarks({
  chart,
  baseline,
  hoverIndex,
  xCenter,
  y,
}: {
  chart: ChartBlock;
  baseline: number;
  hoverIndex: number | null;
  xCenter: (index: number) => number;
  y: (value: number) => number;
}) {
  const showMarkers = chart.labels.length <= 12;
  return chart.series.map((series, seriesIndex) => {
    const points = series.values.map((value, index) => [xCenter(index), y(value)] as const);
    const line = points.map(([px, py], index) => `${index === 0 ? "M" : "L"}${px},${py}`).join(" ");
    const color = seriesColor(seriesIndex);
    return (
      <g key={`${series.name}-${seriesIndex}`}>
        {chart.kind === "area" && points.length > 1 ? (
          <path
            d={`${line} L${points.at(-1)?.[0]},${baseline} L${points[0][0]},${baseline} Z`}
            fill={color}
            fillOpacity={chart.series.length > 1 ? 0.12 : 0.18}
          />
        ) : null}
        <path
          d={line}
          fill="none"
          stroke={color}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
        />
        {points.map(([px, py], index) =>
          showMarkers || hoverIndex === index ? (
            <circle
              key={index}
              cx={px}
              cy={py}
              fill={color}
              r={hoverIndex === index ? 5 : 4}
              stroke="var(--card)"
              strokeWidth={2}
            />
          ) : null,
        )}
      </g>
    );
  });
}

function arcPath(cx: number, cy: number, outer: number, inner: number, start: number, end: number) {
  // A full circle cannot be drawn as one arc; stop just short of it.
  const sweep = Math.min(end - start, Math.PI * 2 - 1e-4);
  const finish = start + sweep;
  const large = sweep > Math.PI ? 1 : 0;
  const point = (radius: number, angle: number) =>
    `${cx + radius * Math.sin(angle)},${cy - radius * Math.cos(angle)}`;
  if (inner <= 0) {
    return `M${cx},${cy} L${point(outer, start)} A${outer},${outer} 0 ${large} 1 ${point(outer, finish)} Z`;
  }
  return [
    `M${point(outer, start)}`,
    `A${outer},${outer} 0 ${large} 1 ${point(outer, finish)}`,
    `L${point(inner, finish)}`,
    `A${inner},${inner} 0 ${large} 0 ${point(inner, start)}`,
    "Z",
  ].join(" ");
}

function PieChart({ chart }: { chart: ChartBlock }) {
  const locale = useLocale();
  const format = useValueFormatter(chart);
  const t = useExtracted();
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  // Colors are never cycled: past eight slices, the smallest fold into "Other".
  let labels = chart.labels;
  let values = chart.series[0].values;
  if (values.length > MAX_SLICES) {
    const order = values
      .map((value, index) => ({ value, index }))
      .toSorted((left, right) => right.value - left.value);
    const kept = order.slice(0, MAX_SLICES - 1);
    const rest = order.slice(MAX_SLICES - 1).reduce((sum, entry) => sum + entry.value, 0);
    labels = [...kept.map((entry) => chart.labels[entry.index]), t("Other")];
    values = [...kept.map((entry) => entry.value), rest];
  }
  const total = values.reduce((sum, value) => sum + value, 0);
  const percent = new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 1 });
  const size = 180;
  const radius = size / 2;
  const inner = chart.kind === "donut" ? radius * 0.6 : 0;
  let angle = 0;
  const slices = values.map((value, index) => {
    const start = angle;
    angle += total > 0 ? (value / total) * Math.PI * 2 : 0;
    return { index, start, end: angle, value };
  });
  const focus = hoverIndex ?? null;

  return (
    <div
      className="flex flex-col items-center gap-4 sm:flex-row sm:items-center"
      onPointerLeave={() => setHoverIndex(null)}
    >
      <div className="relative shrink-0">
        <svg aria-hidden height={size} viewBox={`0 0 ${size} ${size}`} width={size}>
          {slices.map((slice) =>
            slice.value > 0 ? (
              <path
                key={slice.index}
                d={arcPath(radius, radius, radius - 2, inner, slice.start, slice.end)}
                fill={seriesColor(slice.index)}
                onPointerDown={() => setHoverIndex(slice.index)}
                onPointerEnter={() => setHoverIndex(slice.index)}
                opacity={focus === null || focus === slice.index ? 1 : 0.5}
                stroke="var(--card)"
                strokeLinejoin="round"
                strokeWidth={2}
              />
            ) : null,
          )}
        </svg>
        {chart.kind === "donut" ? (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
            <span className="text-base font-semibold tabular-nums">
              {format.value(focus === null ? total : values[focus])}
            </span>
            <span className="max-w-20 truncate text-[11px] text-muted-foreground">
              {focus === null ? null : labels[focus]}
            </span>
          </div>
        ) : null}
      </div>
      <ul className="grid w-full min-w-0 gap-1 text-sm">
        {labels.map((label, index) => (
          <li
            key={`${label}-${index}`}
            className={cn(
              "flex items-center gap-2 rounded-md px-2 py-1",
              focus === index && "bg-muted",
            )}
            onPointerEnter={() => setHoverIndex(index)}
          >
            <span
              aria-hidden
              className="size-2.5 shrink-0 rounded-[3px]"
              style={{ background: seriesColor(index) }}
            />
            <span className="min-w-0 truncate">{label}</span>
            <span className="ml-auto shrink-0 pl-2 tabular-nums text-muted-foreground">
              {format.value(values[index])}
              {total > 0 ? ` · ${percent.format(values[index] / total)}` : null}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ChartDataTable({ chart }: { chart: ChartBlock }) {
  const t = useExtracted();
  const format = useValueFormatter(chart);
  const series =
    chart.kind === "pie" || chart.kind === "donut" ? chart.series.slice(0, 1) : chart.series;
  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
          <tr>
            <th className="px-3 py-2 font-medium">{t("Label")}</th>
            {series.map((entry, index) => (
              <th key={`${entry.name}-${index}`} className="px-3 py-2 text-right font-medium">
                {entry.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {chart.labels.map((label, index) => (
            <tr key={`${label}-${index}`} className="border-t">
              <td className="px-3 py-1.5">{label}</td>
              {series.map((entry, seriesIndex) => (
                <td
                  key={`${entry.name}-${seriesIndex}`}
                  className="px-3 py-1.5 text-right tabular-nums"
                >
                  {format.value(entry.values[index])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function IntelligentUiChart({ chart }: { chart: ChartBlock }) {
  const t = useExtracted();
  const [showTable, setShowTable] = useState(false);
  const isPie = chart.kind === "pie" || chart.kind === "donut";
  const summary = chart.title ?? chart.series.map((series) => series.name).join(", ");

  return (
    <figure aria-label={summary} className="m-0 space-y-3">
      <div className="flex items-start justify-between gap-2">
        {isPie ? <span /> : <ChartLegend chart={chart} />}
        <Button
          aria-pressed={showTable}
          className="-mt-1 ml-auto h-7 shrink-0 gap-1.5 px-2 text-xs text-muted-foreground"
          onClick={() => setShowTable((value) => !value)}
          size="sm"
          type="button"
          variant="ghost"
        >
          <TableIcon className="size-3.5" />
          {showTable ? t("Show chart") : t("Show data")}
        </Button>
      </div>
      {showTable ? (
        <ChartDataTable chart={chart} />
      ) : isPie ? (
        <PieChart chart={chart} />
      ) : (
        <CartesianChart chart={chart} />
      )}
    </figure>
  );
}
