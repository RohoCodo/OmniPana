"use client";

import { useMemo, useState } from "react";
import { Upload, FileSpreadsheet, CheckCircle2, AlertTriangle } from "lucide-react";
import { useWorkspace } from "./workspace";
import { Notice, request } from "./ui";
import type { ImportPreview } from "./types";

type ImportKind = "sales" | "menu" | "inventory";

interface ImportSummary {
  importId: string;
  kind: ImportKind;
  rowCount: number;
  imported: number;
  skipped: number;
  createdMenuItems: number;
  createdProducts: number;
  duplicate: boolean;
  warnings: string[];
}

const kindFields: Record<ImportKind, { required: string[]; optional: string[] }> = {
  sales: {
    required: ["menuItemName", "quantity", "soldAt"],
    optional: ["externalId", "toastItemId", "category"],
  },
  menu: {
    required: ["menuItemName"],
    optional: ["toastItemId", "category", "externalId"],
  },
  inventory: {
    required: ["productName", "bottleSizeMl", "quantity"],
    optional: ["unitCost", "brand", "category", "externalId"],
  },
};

function label(field: string) {
  return field.replace(/([A-Z])/g, " $1").replace(/^./, c => c.toUpperCase());
}

async function readText(file: File): Promise<string> {
  const text = await file.text();
  if (!text.trim()) throw new Error("Selected file is empty.");
  return text;
}

export function SalesImport() {
  const { reload } = useWorkspace();
  const [kind, setKind] = useState<ImportKind>("sales");
  const [file, setFile] = useState<File | null>(null);
  const [content, setContent] = useState("");
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [error, setError] = useState("");
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [importing, setImporting] = useState(false);

  const fields = useMemo(() => [...kindFields[kind].required, ...kindFields[kind].optional], [kind]);

  const missingRequired = kindFields[kind].required.filter(field => !mapping[field]);

  async function handlePreview() {
    if (!file) {
      setError("Choose a CSV or JSON export file first.");
      return;
    }
    setLoadingPreview(true);
    setError("");
    setSummary(null);
    try {
      const nextContent = await readText(file);
      setContent(nextContent);
      const result = await request<ImportPreview & { kind: ImportKind; filename: string }>("/api/sales/import/preview", {
        kind,
        filename: file.name,
        content: nextContent,
      });
      setPreview({ headers: result.headers, rows: result.rows, mapping: result.mapping });
      setMapping(result.mapping);
    } catch (err) {
      setPreview(null);
      setMapping({});
      setError(err instanceof Error ? err.message : "Unable to preview this import.");
    } finally {
      setLoadingPreview(false);
    }
  }

  async function handleImport() {
    if (!preview || !file || !content) return;
    if (missingRequired.length) {
      setError(`Map required fields before importing: ${missingRequired.map(label).join(", ")}`);
      return;
    }
    setImporting(true);
    setError("");
    try {
      const filtered = Object.fromEntries(Object.entries(mapping).filter(([, header]) => Boolean(header)));
      const result = await request<ImportSummary>("/api/sales/import/commit", {
        kind,
        filename: file.name,
        content,
        mapping: filtered,
      });
      setSummary(result);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed.");
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="mx-auto max-w-5xl p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Toast import</h1>
        <p className="mt-2 text-sm text-gray-600">
          Upload CSV/JSON exports, map fields, validate, and import to your ledger-ready data model.
        </p>
      </div>

      <section className="rounded-xl border border-gray-200 bg-white p-4 space-y-4">
        <div className="grid gap-4 md:grid-cols-3">
          <label className="space-y-2 text-sm">
            <span className="font-medium">Import type</span>
            <select
              className="w-full rounded-md border border-gray-300 px-3 py-2"
              value={kind}
              onChange={e => {
                const next = e.target.value as ImportKind;
                setKind(next);
                setPreview(null);
                setSummary(null);
                setMapping({});
              }}
            >
              <option value="sales">Sales/orders</option>
              <option value="menu">Menu/items</option>
              <option value="inventory">Opening inventory</option>
            </select>
          </label>

          <label className="space-y-2 text-sm md:col-span-2">
            <span className="font-medium">Upload export file</span>
            <input
              type="file"
              accept=".csv,.json,text/csv,application/json"
              onChange={e => setFile(e.target.files?.[0] ?? null)}
              className="w-full rounded-md border border-gray-300 px-3 py-2"
            />
          </label>
        </div>

        <button
          type="button"
          onClick={() => void handlePreview()}
          disabled={!file || loadingPreview}
          className="inline-flex items-center gap-2 rounded-md bg-black px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
        >
          <Upload size={16} />
          {loadingPreview ? "Analyzing file…" : "Preview mapping"}
        </button>

        {error && <Notice kind="error">{error}</Notice>}
      </section>

      {preview && (
        <section className="rounded-xl border border-gray-200 bg-white p-4 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">Field mapping</h2>
            <span className="text-xs text-gray-500">Detected {preview.headers.length} columns</span>
          </div>

          {missingRequired.length > 0 && (
            <Notice kind="error">Required mappings missing: {missingRequired.map(label).join(", ")}.</Notice>
          )}

          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b text-left text-gray-600">
                  <th className="py-2 pr-4">Target field</th>
                  <th className="py-2 pr-4">Source column</th>
                  <th className="py-2">Required</th>
                </tr>
              </thead>
              <tbody>
                {fields.map(field => (
                  <tr key={field} className="border-b last:border-b-0">
                    <td className="py-2 pr-4 font-medium">{label(field)}</td>
                    <td className="py-2 pr-4">
                      <select
                        value={mapping[field] ?? ""}
                        onChange={e => setMapping(previous => ({ ...previous, [field]: e.target.value }))}
                        className="w-full rounded-md border border-gray-300 px-3 py-1.5"
                      >
                        <option value="">Not mapped</option>
                        {preview.headers.map(header => (
                          <option key={header} value={header}>{header}</option>
                        ))}
                      </select>
                    </td>
                    <td className="py-2">{kindFields[kind].required.includes(field) ? "Yes" : "No"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div>
            <h3 className="text-sm font-semibold text-gray-700">Sample rows</h3>
            <div className="mt-2 overflow-x-auto">
              <table className="min-w-full text-xs">
                <thead>
                  <tr className="border-b text-left text-gray-500">
                    {preview.headers.map(header => (
                      <th key={header} className="py-1.5 pr-3">{header}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.slice(0, 5).map((row, index) => (
                    <tr key={index} className="border-b last:border-b-0">
                      {preview.headers.map(header => (
                        <td key={`${index}-${header}`} className="py-1.5 pr-3 text-gray-700">{row[header] ?? ""}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <button
            type="button"
            onClick={() => void handleImport()}
            disabled={importing || missingRequired.length > 0}
            className="inline-flex items-center gap-2 rounded-md bg-emerald-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
          >
            <FileSpreadsheet size={16} />
            {importing ? "Importing…" : "Import file"}
          </button>
        </section>
      )}

      {summary && (
        <section className="rounded-xl border border-gray-200 bg-white p-4 space-y-3">
          <h2 className="text-lg font-semibold">Import summary</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 text-sm">
            <div className="rounded-lg bg-gray-50 p-3"><p className="text-gray-500">Rows read</p><p className="text-xl font-semibold">{summary.rowCount}</p></div>
            <div className="rounded-lg bg-gray-50 p-3"><p className="text-gray-500">Imported</p><p className="text-xl font-semibold">{summary.imported}</p></div>
            <div className="rounded-lg bg-gray-50 p-3"><p className="text-gray-500">Skipped</p><p className="text-xl font-semibold">{summary.skipped}</p></div>
            <div className="rounded-lg bg-gray-50 p-3"><p className="text-gray-500">New items</p><p className="text-xl font-semibold">{summary.createdMenuItems + summary.createdProducts}</p></div>
          </div>

          {summary.duplicate ? (
            <Notice kind="info"><span className="inline-flex items-center gap-2"><CheckCircle2 size={16} />Duplicate file detected. No records changed.</span></Notice>
          ) : null}

          {summary.warnings.length > 0 && (
            <div className="space-y-2">
              {summary.warnings.map((warning, index) => (
                <Notice key={index} kind="error"><span className="inline-flex items-center gap-2"><AlertTriangle size={16} />{warning}</span></Notice>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
