"use client";
import type { ReactNode } from "react";
import {
  Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { CHART_COLORS } from "@/lib/constants";
import { Card, EmptyState } from "./ui";

export const SERIES = CHART_COLORS;

export function ChartCard({ title, subtitle, children, className, actions }:
  { title: string; subtitle?: string; children: ReactNode; className?: string; actions?: ReactNode }) {
  return (
    <Card className={className} title={<span>{title}{subtitle && <span className="ml-2 text-xs font-normal text-slate-500">{subtitle}</span>}</span>} actions={actions}>
      <div className="h-64">{children}</div>
    </Card>
  );
}

const axis = { tickLine: false, axisLine: false, fontSize: 11 } as const;
const tooltipStyle = { contentStyle: { borderRadius: 8, fontSize: 12 }, cursor: { fill: "rgba(148,163,184,0.12)" } };

interface Datum { name: string; [k: string]: string | number | null }
interface SeriesDef { key: string; label: string; color: string }

/** Bar chart (vertical or horizontal, optionally stacked). Clicking a bar calls onSelect(name, seriesKey). */
export function Bars({ data, series, horizontal, stacked, onSelect, valueFormat, colorByDatum }:
  { data: Datum[]; series: SeriesDef[]; horizontal?: boolean; stacked?: boolean;
    onSelect?: (name: string, key: string) => void; valueFormat?: (v: number) => string; colorByDatum?: (d: Datum) => string }) {
  if (!data.length) return <EmptyState title="No data for this selection" />;
  const fmt = (v: unknown) => (valueFormat && typeof v === "number" ? valueFormat(v) : String(v));
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} layout={horizontal ? "vertical" : "horizontal"} margin={{ top: 4, right: 12, bottom: 0, left: horizontal ? 8 : -12 }} barGap={2}>
        <CartesianGrid vertical={!!horizontal} horizontal={!horizontal} />
        {horizontal ? (
          <>
            <XAxis type="number" {...axis} tickFormatter={(v) => fmt(v)} />
            <YAxis type="category" dataKey="name" width={110} {...axis} tickFormatter={(v: string) => (v.length > 16 ? v.slice(0, 15) + "…" : v)} />
          </>
        ) : (
          <>
            <XAxis dataKey="name" {...axis} interval="preserveStartEnd" tickFormatter={(v: string) => (v.length > 12 ? v.slice(0, 11) + "…" : v)} />
            <YAxis {...axis} allowDecimals={false} tickFormatter={(v) => fmt(v)} />
          </>
        )}
        <Tooltip {...tooltipStyle} formatter={(v) => fmt(v)} />
        {series.length > 1 && <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />}
        {series.map((s, i) => (
          <Bar key={s.key} dataKey={s.key} name={s.label} fill={s.color} stackId={stacked ? "a" : undefined}
            stroke="var(--chart-gap, #fff)" strokeWidth={stacked ? 1 : 0}
            radius={stacked ? (i === series.length - 1 ? (horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0]) : 0) : horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0]}
            maxBarSize={36} cursor={onSelect ? "pointer" : undefined}
            onClick={onSelect ? (d: unknown) => onSelect(String((d as { name?: string; payload?: Datum }).payload?.name ?? (d as { name?: string }).name), s.key) : undefined}>
            {colorByDatum && data.map((d) => <Cell key={d.name} fill={colorByDatum(d)} />)}
          </Bar>
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

export function Lines({ data, series, onSelect }: { data: Datum[]; series: SeriesDef[]; onSelect?: (name: string) => void }) {
  if (!data.length) return <EmptyState title="No data for this selection" />;
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 4, right: 12, bottom: 0, left: -12 }}
        onClick={onSelect ? (e: unknown) => { const l = (e as { activeLabel?: string })?.activeLabel; if (l) onSelect(l); } : undefined}>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="name" {...axis} interval="preserveStartEnd" />
        <YAxis {...axis} allowDecimals={false} />
        <Tooltip contentStyle={tooltipStyle.contentStyle} />
        {series.length > 1 && <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />}
        {series.map((s) => (
          <Line key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={s.color} strokeWidth={2}
            dot={false} activeDot={{ r: 5, strokeWidth: 2, stroke: "#fff" }} />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
