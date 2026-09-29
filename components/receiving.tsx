"use client";

import { useMemo, useState } from "react";
import { CheckCircle2, FileUp, RefreshCw } from "lucide-react";
import { useWorkspace } from "./workspace";
import { Badge, Empty, Field, Notice, PageHeader, Panel, ProductSelect, date, errorMessage, money, number, request } from "./ui";
import type { Invoice, InvoiceLine } from "./types";

type DraftLine = {
  productName: string;
  productId: string;
  bottleSizeMl: string;
  quantity: string;
  unitCost: string;
};

function toDraft(invoice: Invoice | undefined): { vendor: string; invoiceNumber: string; date: string; lines: DraftLine[] } {
  const result = invoice?.reviewedResult ?? invoice?.result;
  const lines = ((result?.lineItems ?? []) as InvoiceLine[]).map(line => ({
    productName: line.productName || "",
    productId: line.productId ?? "",
    bottleSizeMl: line.bottleSizeMl == null ? "750" : String(line.bottleSizeMl),
    quantity: String(line.quantity ?? 1),
    unitCost: line.unitCost == null ? "0" : String(line.unitCost),
  }));
  const dateValue = result?.date && /^\d{4}-\d{2}-\d{2}$/.test(result.date) ? result.date : "";
  return {
    vendor: result?.vendor ?? "",
    invoiceNumber: result?.invoiceNumber ?? "",
    date: dateValue,
    lines,
  };
}

export function ReceivingWorkflow() {
  const { data, reload } = useWorkspace();
  const [files, setFiles] = useState<FileList | null>(null);
  const [selectedInvoiceId, setSelectedInvoiceId] = useState("");
  const [uploadDocumentDate, setUploadDocumentDate] = useState("");
  const [reviewByInvoice, setReviewByInvoice] = useState<Record<string, { vendor: string; invoiceNumber: string; date: string; lines: DraftLine[] }>>({});
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [uploading, setUploading] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const invoices = useMemo(() => data.invoices.slice().sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)), [data.invoices]);
  const currentInvoiceId = invoices.some(invoice => invoice.id === selectedInvoiceId) ? selectedInvoiceId : (invoices[0]?.id ?? "");
  const selected = invoices.find(invoice => invoice.id === currentInvoiceId);
  const review = currentInvoiceId ? (reviewByInvoice[currentInvoiceId] ?? toDraft(selected)) : { vendor: "", invoiceNumber: "", date: "", lines: [] as DraftLine[] };
  const { vendor, invoiceNumber, date: invoiceDate, lines } = review;

  async function uploadInvoice(file: File) {
    const body = new FormData();
    body.append("file", file);
    if (uploadDocumentDate) body.append("documentDate", uploadDocumentDate);
    const response = await fetch("/api/receiving/upload", { method: "POST", body });
    const result = await response.json().catch(() => null) as { error?: string } | null;
    if (!response.ok) throw new Error(result?.error ?? `Upload failed (${response.status})`);
  }

  async function onUpload() {
    if (!files?.length) {
      setError("Select invoice photo(s) or PDF(s) first.");
      return;
    }
    setUploading(true);
    setError("");
    setSuccess("");
    try {
      for (const file of Array.from(files)) await uploadInvoice(file);
      setFiles(null);
      setUploadDocumentDate("");
      await reload();
      setSuccess("Invoices uploaded and extracted for review.");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setUploading(false);
    }
  }

  async function onReprocess() {
    if (!selected) return;
    setProcessing(true);
    setError("");
    setSuccess("");
    try {
      await request("/api/receiving/process", { invoiceId: selected.id });
      await reload();
      setSuccess("Invoice extraction refreshed.");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setProcessing(false);
    }
  }

  async function onConfirm() {
    if (!selected) return;
    setConfirming(true);
    setError("");
    setSuccess("");
    try {
      if (!vendor.trim() || !invoiceNumber.trim() || !invoiceDate) throw new Error("Vendor, invoice number, and date are required.");
      if (!lines.length) throw new Error("At least one reviewed line item is required.");
      if (lines.some(line => !line.productId)) throw new Error("Map every line item to a product.");
      await request("/api/receiving/confirm", {
        invoiceId: selected.id,
        vendor: vendor.trim(),
        invoiceNumber: invoiceNumber.trim(),
        date: invoiceDate,
        lineItems: lines.map(line => ({
          productName: line.productName,
          productId: line.productId,
          quantity: line.quantity,
          bottleSizeMl: line.bottleSizeMl,
          unitCost: line.unitCost,
        })),
      });
      await reload();
      setSuccess("Receiving confirmed and ledger updated.");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setConfirming(false);
    }
  }

  const estimatedTotal = lines.reduce((sum, line) => sum + number(line.quantity) * number(line.unitCost), 0);

  return (
    <>
      <PageHeader
        eyebrow="RECEIVING"
        title="Review deliveries before posting"
        description="Upload invoices, verify extracted line items, and confirm receiving. Nothing is added to inventory until confirmed."
      >
        <button className="button" type="button" onClick={() => void onUpload()} disabled={uploading || !files?.length}>
          <FileUp size={16} />
          {uploading ? "Uploading…" : "Upload invoice"}
        </button>
      </PageHeader>

      <div className="two-columns">
        <Panel title="1) Upload invoice" subtitle="Accepts photos and PDF documents up to 15 MB.">
          <div className="panel-body">
            <Field label="Invoice file(s)">
              <input
                type="file"
                multiple
                accept="image/jpeg,image/png,image/webp,application/pdf"
                onChange={event => setFiles(event.target.files)}
              />
            </Field>
            <Field label="Document date (optional)">
              <input type="date" value={uploadDocumentDate} onChange={event => setUploadDocumentDate(event.target.value)} />
            </Field>
            {error && <Notice kind="error">{error}</Notice>}
            {success && <Notice kind="success">{success}</Notice>}
          </div>
        </Panel>

        <Panel title="2) Select upload" subtitle="Open an extracted invoice and review line mapping.">
          <div className="panel-body">
            {invoices.length === 0 ? (
              <Empty title="No receiving uploads" description="Upload an invoice to start extraction and review." />
            ) : (
              <Field label="Invoice uploads">
                <select
                  value={currentInvoiceId}
                  onChange={event => {
                    const nextId = event.target.value;
                    setSelectedInvoiceId(nextId);
                    setReviewByInvoice(current => {
                      if (!nextId || current[nextId]) return current;
                      const invoice = invoices.find(row => row.id === nextId);
                      return { ...current, [nextId]: toDraft(invoice) };
                    });
                  }}
                >
                  {invoices.map(invoice => (
                    <option key={invoice.id} value={invoice.id}>
                      {invoice.filename} · {invoice.status} · {date(invoice.createdAt, true)}
                    </option>
                  ))}
                </select>
              </Field>
            )}
          </div>
        </Panel>
      </div>

      <Panel
        title="3) Review extracted delivery"
        subtitle="Edit vendor, document metadata, product mappings, quantities, and bottle sizes before posting."
        action={
          selected ? (
            <div className="heading-actions">
              <button className="button secondary" type="button" onClick={() => void onReprocess()} disabled={processing}>
                <RefreshCw size={16} />
                {processing ? "Refreshing…" : "Reextract"}
              </button>
              <button className="button" type="button" onClick={() => void onConfirm()} disabled={confirming}>
                <CheckCircle2 size={16} />
                {confirming ? "Confirming…" : "Confirm receiving"}
              </button>
            </div>
          ) : undefined
        }
      >
        {!selected ? (
          <Empty title="Waiting for invoice" description="Upload and select an invoice to review extracted line items." />
        ) : (
          <>
            <div className="panel-body">
              <div className="form-grid">
                <Field label="Vendor">
                  <input
                    value={vendor}
                    onChange={event => setReviewByInvoice(current => ({
                      ...current,
                      [currentInvoiceId]: { ...review, vendor: event.target.value },
                    }))}
                    required
                  />
                </Field>
                <Field label="Invoice number">
                  <input
                    value={invoiceNumber}
                    onChange={event => setReviewByInvoice(current => ({
                      ...current,
                      [currentInvoiceId]: { ...review, invoiceNumber: event.target.value },
                    }))}
                    required
                  />
                </Field>
              </div>
              <div className="form-grid">
                <Field label="Invoice date">
                  <input
                    type="date"
                    value={invoiceDate}
                    onChange={event => setReviewByInvoice(current => ({
                      ...current,
                      [currentInvoiceId]: { ...review, date: event.target.value },
                    }))}
                    required
                  />
                </Field>
                <div className="field">
                  <span>Estimated total</span>
                  <strong>{money(estimatedTotal)}</strong>
                  <small>Based on reviewed quantity × unit cost.</small>
                </div>
              </div>
              {selected.isDemo && <Notice>DEMO extraction: values are simulated. Review every line before confirmation.</Notice>}
              {selected.error && <Notice kind="error">{selected.error}</Notice>}
            </div>

            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Detected item</th>
                    <th>Mapped product</th>
                    <th>Qty bottles</th>
                    <th>Size ml</th>
                    <th>Unit cost</th>
                    <th>Line total</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line, index) => (
                    <tr key={`${selected.id}-${index}`}>
                      <td>
                        <input
                          value={line.productName}
                          onChange={event => setReviewByInvoice(current => ({
                            ...current,
                            [currentInvoiceId]: { ...review, lines: lines.map((entry, i) => (i === index ? { ...entry, productName: event.target.value } : entry)) },
                          }))}
                        />
                      </td>
                      <td>
                        <ProductSelect
                          products={data.products}
                          value={line.productId}
                          onChange={value => setReviewByInvoice(current => ({
                            ...current,
                            [currentInvoiceId]: { ...review, lines: lines.map((entry, i) => (i === index ? { ...entry, productId: value } : entry)) },
                          }))}
                        />
                      </td>
                      <td>
                        <input
                          type="number"
                          step="1"
                          min="1"
                          value={line.quantity}
                          onChange={event => setReviewByInvoice(current => ({
                            ...current,
                            [currentInvoiceId]: { ...review, lines: lines.map((entry, i) => (i === index ? { ...entry, quantity: event.target.value } : entry)) },
                          }))}
                        />
                      </td>
                      <td>
                        <input
                          type="number"
                          step="any"
                          min="50"
                          value={line.bottleSizeMl}
                          onChange={event => setReviewByInvoice(current => ({
                            ...current,
                            [currentInvoiceId]: { ...review, lines: lines.map((entry, i) => (i === index ? { ...entry, bottleSizeMl: event.target.value } : entry)) },
                          }))}
                        />
                      </td>
                      <td>
                        <input
                          type="number"
                          step="any"
                          min="0"
                          value={line.unitCost}
                          onChange={event => setReviewByInvoice(current => ({
                            ...current,
                            [currentInvoiceId]: { ...review, lines: lines.map((entry, i) => (i === index ? { ...entry, unitCost: event.target.value } : entry)) },
                          }))}
                        />
                      </td>
                      <td>{money(number(line.quantity) * number(line.unitCost))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Panel>

      <Panel title="Recent receiving uploads" subtitle="Track status and confirmation history.">
        {invoices.length === 0 ? (
          <Empty title="No receiving history" description="Invoice uploads will appear here after extraction." />
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Filename</th>
                  <th>Status</th>
                  <th>Vendor</th>
                  <th>Invoice #</th>
                  <th>Created</th>
                  <th>Confirmed</th>
                </tr>
              </thead>
              <tbody>
                {invoices.slice(0, 12).map(invoice => (
                  <tr key={invoice.id}>
                    <td>{invoice.filename}</td>
                    <td><Badge tone={invoice.status === "COMPLETED" ? "green" : invoice.status === "FAILED" ? "red" : "amber"}>{invoice.status}</Badge></td>
                    <td>{invoice.vendor || "—"}</td>
                    <td>{invoice.invoiceNumber || "—"}</td>
                    <td>{date(invoice.createdAt, true)}</td>
                    <td>{invoice.confirmedAt ? date(invoice.confirmedAt, true) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </>
  );
}
