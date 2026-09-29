"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowUpRight, Filter } from "lucide-react";
import { useWorkspace } from "./workspace";
import { Badge, Empty, Field, PageHeader, Panel, date, format, money, number } from "./ui";

export function VarianceView() {
  const { data } = useWorkspace();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [status, setStatus] = useState("");
  const [minAbsBottles, setMinAbsBottles] = useState("0");

  const categories = useMemo(() => Array.from(new Set(data.products.map(product => product.category))).sort(), [data.products]);

  const rows = useMemo(() => {
    const threshold = number(minAbsBottles);
    return data.products
      .filter(product => product.physicalBottles != null && product.varianceBottles != null)
      .filter(product => {
        const matchesQuery = `${product.name} ${product.brand}`.toLowerCase().includes(query.toLowerCase());
        const matchesCategory = !category || product.category === category;
        const matchesStatus = !status || product.status === status;
        const magnitude = Math.abs(number(product.varianceBottles));
        const matchesMagnitude = Number.isFinite(threshold) ? magnitude >= threshold : true;
        return matchesQuery && matchesCategory && matchesStatus && matchesMagnitude;
      })
      .sort((a, b) => Math.abs(number(b.varianceBottles ?? 0)) - Math.abs(number(a.varianceBottles ?? 0)));
  }, [category, data.products, minAbsBottles, query, status]);

  const reviewCount = rows.filter(row => row.status === "REVIEW").length;

  return (
    <>
      <PageHeader
        eyebrow="UNEXPLAINED VARIANCE"
        title="Inventory discrepancy review"
        description="Compare physical vs theoretical inventory and prioritize products that need attention."
      />

      <div className="stats-grid three">
        <div className="stat"><div className="stat-label">Products with counts</div><strong>{rows.length}</strong><span>Currently filter-matched rows</span></div>
        <div className="stat"><div className="stat-label">Review recommended</div><strong>{reviewCount}</strong><span>Neutral discrepancy workflow</span></div>
        <div className="stat"><div className="stat-label">Estimated value impact</div><strong>{money(rows.reduce((sum, row) => sum + number(row.dollarVariance ?? 0), 0))}</strong><span>Summed dollar variance of visible rows</span></div>
      </div>

      <Panel title="Variance filters" subtitle="Filter by category, status, product, and discrepancy magnitude.">
        <div className="filter-bar">
          <label className="search-field">
            <Filter size={17} />
            <span className="sr-only">Search product</span>
            <input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search product or brand…" />
          </label>
          <Field label="Category">
            <select value={category} onChange={event => setCategory(event.target.value)}>
              <option value="">All categories</option>
              {categories.map(value => <option key={value}>{value}</option>)}
            </select>
          </Field>
          <Field label="Status">
            <select value={status} onChange={event => setStatus(event.target.value)}>
              <option value="">All statuses</option>
              <option value="NORMAL">NORMAL</option>
              <option value="REVIEW">REVIEW</option>
              <option value="CONFIRMED">CONFIRMED</option>
            </select>
          </Field>
        </div>
        <div className="panel-body">
          <Field label="Minimum absolute variance (bottles)">
            <input type="number" step="0.1" min="0" value={minAbsBottles} onChange={event => setMinAbsBottles(event.target.value)} />
          </Field>
        </div>
      </Panel>

      <Panel title="Variance table" subtitle="Use neutral language: discrepancy, below theoretical, above theoretical, review recommended.">
        {rows.length === 0 ? (
          <Empty title="No rows match current filters" description="Try widening filters or complete more physical counts." />
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Theoretical</th>
                  <th>Physical</th>
                  <th>Variance</th>
                  <th>Estimated $</th>
                  <th>Last count</th>
                  <th>Status</th>
                  <th><span className="sr-only">Details</span></th>
                </tr>
              </thead>
              <tbody>
                {rows.map(row => (
                  <tr key={row.id}>
                    <td>
                      <strong>{row.name}</strong>
                      <div className="muted small">{row.brand} · {row.category}</div>
                    </td>
                    <td className="numeric">{format(row.theoreticalBottles, 2)}</td>
                    <td className="numeric">{format(row.physicalBottles, 2)}</td>
                    <td className="numeric">
                      {number(row.varianceBottles) > 0 ? "+" : ""}
                      {format(row.varianceBottles, 2)}
                    </td>
                    <td className="numeric">{money(row.dollarVariance)}</td>
                    <td>{row.countedAt ? date(row.countedAt, true) : "—"}</td>
                    <td>
                      <Badge tone={row.status === "REVIEW" ? "amber" : row.status === "CONFIRMED" ? "green" : "neutral"}>
                        {row.status || "NORMAL"}
                      </Badge>
                    </td>
                    <td>
                      <Link href={`/inventory/${row.id}`} className="icon-button" aria-label={`Open ${row.name}`}>
                        <ArrowUpRight size={16} />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <NoticeBanner reviewCount={reviewCount} />
    </>
  );
}

function NoticeBanner({ reviewCount }: { reviewCount: number }) {
  return (
    <div className="notice">
      <AlertTriangle size={16} />
      <div>
        {reviewCount > 0
          ? `${reviewCount} product${reviewCount === 1 ? "" : "s"} currently flagged as review recommended.`
          : "No products are currently flagged for review."}
      </div>
    </div>
  );
}
