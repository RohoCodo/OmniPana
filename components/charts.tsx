"use client";
import { useId } from "react";
import type { PhysicalCount, Product, Transaction } from "./types";
import { date, Empty, format, number } from "./ui";

export function StockChart({ product, transactions, counts }: { product: Product; transactions: Transaction[]; counts: PhysicalCount[] }) {
  const id = useId().replaceAll(":", "");
  const ledger = transactions.filter(t => t.productId === product.id && t.type !== "PHYSICAL_COUNT").sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  const observations = counts.filter(c => c.productId === product.id).sort((a, b) => Date.parse(a.countedAt) - Date.parse(b.countedAt));
  if (!ledger.length && !observations.length) return <Empty title="A fresh start" description="Opening counts, deliveries, and sales will build your stock history here." />;
  const starting = number(product.theoreticalBottles) - ledger.reduce((sum, t) => sum + number(t.quantityBottles), 0);
  const points = ledger.reduce<Array<{ time: number; value: number }>>((acc, t) => {
    const previous = acc.length ? acc[acc.length - 1].value : starting;
    acc.push({ time: Date.parse(t.createdAt), value: previous + number(t.quantityBottles) });
    return acc;
  }, []);
  const physical = observations.map(c => ({ time: Date.parse(c.countedAt), value: number(c.quantityBottles) }));
  const all = [...points, ...physical]; const minTime = Math.min(...all.map(p => p.time)); const maxTime = Math.max(...all.map(p => p.time));
  const low = Math.min(0, ...all.map(p => p.value)); const high = Math.max(1, ...all.map(p => p.value)) * 1.12;
  const x = (time: number) => 55 + (time - minTime) / (maxTime - minTime || 1) * 625;
  const y = (value: number) => 190 - (value - low) / (high - low) * 165;
  const line = points.map((p, i) => `${i ? "L" : "M"}${x(p.time)},${y(p.value)}`).join(" ");
  return <div className="stock-chart"><div className="chart-legend"><span><i className="legend-green" />Theoretical bottles</span><span><i className="legend-gold" />Physical count</span></div><svg viewBox="0 0 720 230" role="img" aria-labelledby={`${id}-title ${id}-desc`}><title id={`${id}-title`}>{product.name} inventory history</title><desc id={`${id}-desc`}>Theoretical inventory from signed ledger entries, excluding physical-count observations. Physical counts are shown as gold dots. {date(new Date(minTime).toISOString())} to {date(new Date(maxTime).toISOString())}.</desc><defs><linearGradient id={id} x1="0" y1="0" x2="0" y2="1"><stop stopColor="#34765a" stopOpacity=".18" /><stop offset="1" stopColor="#34765a" stopOpacity="0" /></linearGradient></defs>{[0, 1, 2, 3].map(i => { const value = low + (high - low) * i / 3; return <g key={i}><line x1="55" x2="680" y1={y(value)} y2={y(value)} stroke="#e7e8e1" strokeDasharray="4 5" /><text x="42" y={y(value) + 4} textAnchor="end" className="chart-label">{format(value)}</text></g>; })}{points.length > 1 && <path d={`${line} L${x(points[points.length - 1].time)},190 L${x(points[0].time)},190 Z`} fill={`url(#${id})`} />}{line && <path d={line} fill="none" stroke="#34765a" strokeWidth="2.8" strokeLinejoin="round" />}{points.map((p, i) => <circle key={i} cx={x(p.time)} cy={y(p.value)} r="3" fill="#34765a"><title>{date(new Date(p.time).toISOString(), true)}: {format(p.value)} bottles</title></circle>)}{physical.map((p, i) => <circle key={i} cx={x(p.time)} cy={y(p.value)} r="5" fill="#c39950" stroke="white" strokeWidth="2"><title>Physical · {date(new Date(p.time).toISOString(), true)}: {format(p.value)} bottles</title></circle>)}<text x="55" y="219" className="chart-label">{date(new Date(minTime).toISOString())}</text><text x="680" y="219" textAnchor="end" className="chart-label">{date(new Date(maxTime).toISOString())}</text></svg></div>;
}