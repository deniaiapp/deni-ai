"use client";

import {
  ArrowDownWideNarrowIcon,
  ArrowUpDownIcon,
  ArrowUpNarrowWideIcon,
  CheckIcon,
  CircleCheckIcon,
  CircleDotIcon,
  CircleIcon,
  MinusIcon,
  TrendingDownIcon,
  TrendingUpIcon,
  XIcon,
} from "lucide-react";
import { useExtracted, useLocale } from "next-intl";
import { useState } from "react";
import { Streamdown } from "streamdown";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { streamdownLinkSafety } from "@/components/chat/streamdown-link-safety";
import type { IntelligentUiBlockOf, IntelligentUiCellValue } from "@/lib/intelligent-ui/schema";
import { cn } from "@/lib/utils";

function useCellFormatter() {
  const t = useExtracted();
  const locale = useLocale();
  const numberFormat = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 });
  return (value: IntelligentUiCellValue) => {
    if (value === true) {
      return (
        <span className="inline-flex items-center text-[var(--iui-good)]">
          <CheckIcon className="size-4" />
          <span className="sr-only">{t("Yes")}</span>
        </span>
      );
    }
    if (value === false) {
      return (
        <span className="inline-flex items-center text-muted-foreground">
          <XIcon className="size-4" />
          <span className="sr-only">{t("No")}</span>
        </span>
      );
    }
    if (value === null || value === "") {
      return <span className="text-muted-foreground">—</span>;
    }
    return typeof value === "number" ? numberFormat.format(value) : value;
  };
}

export function IntelligentUiStats({ block }: { block: IntelligentUiBlockOf<"stats"> }) {
  const locale = useLocale();
  const numberFormat = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 });
  return (
    <dl
      className={cn(
        "grid gap-2",
        block.items.length === 1 ? "grid-cols-1" : "grid-cols-2",
        block.items.length >= 3 && "sm:grid-cols-3",
      )}
    >
      {block.items.map((item, index) => {
        const TrendIcon =
          item.sentiment === "positive"
            ? TrendingUpIcon
            : item.sentiment === "negative"
              ? TrendingDownIcon
              : MinusIcon;
        return (
          <div key={`${item.label}-${index}`} className="rounded-lg border bg-background/60 p-3">
            <dt className="truncate text-xs text-muted-foreground">{item.label}</dt>
            <dd className="mt-1 text-2xl font-semibold leading-tight tracking-tight">
              {typeof item.value === "number" ? numberFormat.format(item.value) : item.value}
            </dd>
            {item.change ? (
              <dd
                className={cn(
                  "mt-1 flex items-center gap-1 text-xs font-medium",
                  item.sentiment === "positive" && "text-[var(--iui-good)]",
                  item.sentiment === "negative" && "text-[var(--iui-critical)]",
                  (!item.sentiment || item.sentiment === "neutral") && "text-muted-foreground",
                )}
              >
                {item.sentiment ? <TrendIcon aria-hidden className="size-3.5" /> : null}
                {item.change}
              </dd>
            ) : null}
            {item.detail ? (
              <dd className="mt-1 text-xs text-muted-foreground">{item.detail}</dd>
            ) : null}
          </div>
        );
      })}
    </dl>
  );
}

export function IntelligentUiTimeline({ block }: { block: IntelligentUiBlockOf<"timeline"> }) {
  const t = useExtracted();
  return (
    <ol className="relative space-y-4">
      {block.items.map((item, index) => {
        const status = item.status ?? "upcoming";
        const Icon =
          status === "done" ? CircleCheckIcon : status === "current" ? CircleDotIcon : CircleIcon;
        const isLast = index === block.items.length - 1;
        return (
          <li key={`${item.title}-${index}`} className="relative flex gap-3">
            {isLast ? null : (
              <span
                aria-hidden
                className="absolute top-6 bottom-[-1rem] left-[9px] w-px bg-foreground/20"
              />
            )}
            <Icon
              aria-hidden
              className={cn(
                "relative mt-0.5 size-[19px] shrink-0 bg-card",
                status === "done" && "text-[var(--iui-good)]",
                status === "current" && "text-foreground",
                status === "upcoming" && "text-muted-foreground",
              )}
            />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <p className={cn("font-medium", status === "upcoming" && "text-foreground/80")}>
                  {item.title}
                </p>
                {item.time ? (
                  <span className="text-xs tabular-nums text-muted-foreground">{item.time}</span>
                ) : null}
                {status === "current" ? (
                  <Badge className="h-5 px-1.5 text-[10px]" variant="secondary">
                    {t("Now")}
                  </Badge>
                ) : null}
              </div>
              {item.detail ? (
                <p className="mt-0.5 text-sm text-muted-foreground">{item.detail}</p>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export function IntelligentUiComparison({ block }: { block: IntelligentUiBlockOf<"comparison"> }) {
  const formatCell = useCellFormatter();
  return (
    <div className="-mx-1 overflow-x-auto px-1">
      <table className="w-full min-w-[28rem] border-separate border-spacing-0 text-sm">
        <thead>
          <tr>
            <th className="w-1/4" />
            {block.columns.map((column, index) => (
              <th
                key={`${column.name}-${index}`}
                className={cn(
                  "rounded-t-lg px-3 pt-3 pb-2 text-left align-bottom font-semibold",
                  column.highlight && "bg-muted",
                )}
                scope="col"
              >
                <div className="flex flex-wrap items-center gap-1.5">
                  {column.name}
                  {column.badge ? (
                    <Badge className="h-5 px-1.5 text-[10px]">{column.badge}</Badge>
                  ) : null}
                </div>
                {column.summary ? (
                  <p className="mt-1 text-xs font-normal text-muted-foreground">{column.summary}</p>
                ) : null}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {block.rows.map((row, rowIndex) => (
            <tr key={`${row.label}-${rowIndex}`}>
              <th
                className="border-t py-2 pr-3 text-left align-top text-xs font-medium text-muted-foreground"
                scope="row"
              >
                {row.label}
              </th>
              {row.values.map((value, columnIndex) => (
                <td
                  key={columnIndex}
                  className={cn(
                    "border-t px-3 py-2 align-top",
                    block.columns[columnIndex]?.highlight && "bg-muted",
                    block.columns[columnIndex]?.highlight &&
                      rowIndex === block.rows.length - 1 &&
                      "rounded-b-lg",
                  )}
                >
                  {formatCell(value)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const compareCells = (left: IntelligentUiCellValue, right: IntelligentUiCellValue) => {
  if (left === right) return 0;
  if (left === null || left === "") return 1;
  if (right === null || right === "") return -1;
  if (typeof left === "number" && typeof right === "number") return left - right;
  return String(left).localeCompare(String(right), undefined, { numeric: true });
};

export function IntelligentUiTable({ block }: { block: IntelligentUiBlockOf<"table"> }) {
  const t = useExtracted();
  const formatCell = useCellFormatter();
  const [sort, setSort] = useState<{ column: number; descending: boolean } | null>(null);
  const rows = sort
    ? [...block.rows].sort((left, right) => {
        const result = compareCells(left[sort.column], right[sort.column]);
        return sort.descending ? -result : result;
      })
    : block.rows;
  const numericColumns = block.columns.map((_, index) =>
    block.rows.every((row) => typeof row[index] === "number" || row[index] === null),
  );

  return (
    <div className="max-h-[28rem] overflow-auto rounded-md border">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-muted text-xs text-muted-foreground">
          <tr>
            {block.columns.map((column, index) => {
              const active = sort?.column === index;
              const SortIcon = active
                ? sort.descending
                  ? ArrowDownWideNarrowIcon
                  : ArrowUpNarrowWideIcon
                : ArrowUpDownIcon;
              return (
                <th
                  key={`${column}-${index}`}
                  aria-sort={active ? (sort.descending ? "descending" : "ascending") : "none"}
                  className={cn("p-0 font-medium", numericColumns[index] && "text-right")}
                  scope="col"
                >
                  <button
                    className={cn(
                      "flex w-full items-center gap-1 px-3 py-2 hover:text-foreground",
                      numericColumns[index] && "justify-end",
                      active && "text-foreground",
                    )}
                    onClick={() =>
                      setSort((current) =>
                        current?.column === index
                          ? current.descending
                            ? null
                            : { column: index, descending: true }
                          : { column: index, descending: false },
                      )
                    }
                    title={t("Sort by {column}", { column })}
                    type="button"
                  >
                    {column}
                    <SortIcon aria-hidden className="size-3 shrink-0 opacity-70" />
                  </button>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex} className="border-t">
              {row.map((value, columnIndex) => (
                <td
                  key={columnIndex}
                  className={cn(
                    "px-3 py-1.5",
                    numericColumns[columnIndex] && "text-right tabular-nums",
                  )}
                >
                  {formatCell(value)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function IntelligentUiTabs({ block }: { block: IntelligentUiBlockOf<"tabs"> }) {
  return (
    <Tabs defaultValue={0}>
      <TabsList className="h-auto max-w-full flex-wrap justify-start">
        {block.tabs.map((tab, index) => (
          <TabsTrigger key={`${tab.label}-${index}`} value={index}>
            {tab.label}
          </TabsTrigger>
        ))}
      </TabsList>
      {block.tabs.map((tab, index) => (
        <TabsContent key={`${tab.label}-${index}`} className="pt-2 text-sm" value={index}>
          <Streamdown
            className="[&>*:first-child]:mt-0 [&>*:last-child]:mb-0"
            linkSafety={streamdownLinkSafety}
            mode="static"
          >
            {tab.content}
          </Streamdown>
        </TabsContent>
      ))}
    </Tabs>
  );
}
