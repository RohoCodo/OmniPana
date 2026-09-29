"use client";

import { useMemo, useState } from "react";
import { Camera, CheckCircle2, RefreshCw, Upload } from "lucide-react";
import { useWorkspace } from "./workspace";
import { Badge, Empty, Field, Notice, PageHeader, Panel, ProductSelect, date, errorMessage, format, number, request } from "./ui";
import type { BottleResult, Photo } from "./types";

type DraftBottle = {
  productName: string;
  productId: string;
  bottleSizeMl: string;
  fillPercent: string;
  quantity: string;
  confidence: string;
  ignore: boolean;
};

function toDraftRows(photo: Photo | undefined): DraftBottle[] {
  const rows = (photo?.reviewedResult?.bottles ?? photo?.result?.bottles ?? []) as BottleResult[];
  return rows.map(row => ({
    productName: row.productName || "",
    productId: row.productId ?? "",
    bottleSizeMl: row.bottleSizeMl == null ? "750" : String(row.bottleSizeMl),
    fillPercent: row.fillPercent == null ? "50" : String(row.fillPercent),
    quantity: String(row.quantity ?? 1),
    confidence: String(row.confidence ?? 0.5),
    ignore: Boolean(row.ignore),
  }));
}

export function PhotosWorkflow() {
  const { data, reload } = useWorkspace();
  const [files, setFiles] = useState<FileList | null>(null);
  const [selectedPhotoId, setSelectedPhotoId] = useState("");
  const [draftByPhoto, setDraftByPhoto] = useState<Record<string, DraftBottle[]>>({});
  const [uploading, setUploading] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const photos = useMemo(() => data.photos.slice().sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)), [data.photos]);
  const currentPhotoId = photos.some(photo => photo.id === selectedPhotoId) ? selectedPhotoId : (photos[0]?.id ?? "");
  const selected = photos.find(photo => photo.id === currentPhotoId);
  const draft = currentPhotoId ? (draftByPhoto[currentPhotoId] ?? toDraftRows(selected)) : [];

  async function uploadPhoto(file: File) {
    const body = new FormData();
    body.append("file", file);
    body.append("capturedAt", new Date().toISOString());
    const response = await fetch("/api/photos/upload", { method: "POST", body });
    const result = await response.json().catch(() => null) as { error?: string } | null;
    if (!response.ok) throw new Error(result?.error ?? `Upload failed (${response.status})`);
  }

  async function onUpload() {
    if (!files?.length) {
      setError("Select one or more photos first.");
      return;
    }
    setUploading(true);
    setError("");
    setSuccess("");
    try {
      for (const file of Array.from(files)) await uploadPhoto(file);
      setFiles(null);
      await reload();
      setSuccess("Photos uploaded and queued for analysis.");
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
      await request("/api/photos/process", { photoId: selected.id });
      await reload();
      setSuccess("Photo analysis refreshed.");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setProcessing(false);
    }
  }

  async function onConfirm() {
    if (!selected) return;
    setError("");
    setSuccess("");
    try {
      const bottles = draft.map(row => ({
        productName: row.productName.trim(),
        productId: row.productId,
        bottleSizeMl: row.bottleSizeMl,
        fillPercent: row.fillPercent,
        quantity: row.quantity,
        confidence: row.confidence,
        ignore: row.ignore,
      }));
      if (!bottles.some(row => !row.ignore)) throw new Error("Keep at least one reviewed bottle row.");
      if (bottles.some(row => !row.ignore && !row.productId)) throw new Error("Map every kept bottle to a product.");
      await request("/api/photos/confirm", { photoId: selected.id, bottles });
      await reload();
      setSuccess("Physical count confirmed and posted.");
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="PHOTO INVENTORY"
        title="Count My Bar"
        description="Take or upload photos, review AI detections, then confirm counts. AI never updates inventory without your approval."
      >
        <button className="button" type="button" onClick={() => void onUpload()} disabled={uploading || !files?.length}>
          <Upload size={16} />
          {uploading ? "Uploading…" : "Upload photos"}
        </button>
      </PageHeader>

      <div className="two-columns">
        <Panel title="1) Upload photos" subtitle="Multiple images supported. Use clear shelf angles for better fill estimates.">
          <div className="panel-body">
            <Field label="Choose photo files">
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                multiple
                onChange={event => setFiles(event.target.files)}
              />
            </Field>
            <Notice>Primary workflow: upload → analyze → review → confirm.</Notice>
            {error && <Notice kind="error">{error}</Notice>}
            {success && <Notice kind="success">{success}</Notice>}
          </div>
        </Panel>

        <Panel title="2) Select a photo" subtitle="Review status and reopen any upload for edits.">
          <div className="panel-body">
            {photos.length === 0 ? (
              <Empty title="No photos yet" description="Upload bar photos to start AI-assisted counting." />
            ) : (
              <Field label="Uploaded photos">
                <select
                  value={currentPhotoId}
                  onChange={event => {
                    const nextId = event.target.value;
                    setSelectedPhotoId(nextId);
                    setDraftByPhoto(current => {
                      if (!nextId || current[nextId]) return current;
                      const nextPhoto = photos.find(photo => photo.id === nextId);
                      return { ...current, [nextId]: toDraftRows(nextPhoto) };
                    });
                  }}
                >
                  {photos.map(photo => (
                    <option key={photo.id} value={photo.id}>
                      {photo.filename} · {photo.status} · {date(photo.createdAt, true)}
                    </option>
                  ))}
                </select>
              </Field>
            )}
          </div>
        </Panel>
      </div>

      <Panel
        title="3) Review detections"
        subtitle="Edit product, size, fill, and confidence. Unknown or ambiguous bottles should be ignored."
        action={
          selected ? (
            <div className="heading-actions">
              <button className="button secondary" type="button" onClick={() => void onReprocess()} disabled={processing}>
                <RefreshCw size={16} />
                {processing ? "Refreshing…" : "Reanalyze"}
              </button>
              <button className="button" type="button" onClick={() => void onConfirm()}>
                <CheckCircle2 size={16} /> Confirm count
              </button>
            </div>
          ) : undefined
        }
      >
        {!selected ? (
          <Empty title="Waiting for your first image" description="Upload photos to unlock AI-assisted bottle review." />
        ) : (
          <>
            <div className="panel-body">
              <div className="stats-grid three">
                <div className="stat"><div className="stat-label">Status</div><strong>{selected.status}</strong><span>{selected.isDemo ? "DEMO simulated analysis" : "Live analysis"}</span></div>
                <div className="stat"><div className="stat-label">Detected bottles</div><strong>{draft.length}</strong><span>Rows currently in review</span></div>
                <div className="stat"><div className="stat-label">Confirmed at</div><strong>{selected.confirmedAt ? date(selected.confirmedAt, true) : "Pending"}</strong><span>Ledger posts only after confirm</span></div>
              </div>
              {selected.isDemo && <Notice>DEMO result: values are simulated and should be reviewed before confirmation.</Notice>}
              {selected.error && <Notice kind="error">{selected.error}</Notice>}
            </div>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Keep</th>
                    <th>Detected name</th>
                    <th>Mapped product</th>
                    <th>Size ml</th>
                    <th>Fill %</th>
                    <th>Qty</th>
                    <th>Confidence</th>
                  </tr>
                </thead>
                <tbody>
                  {draft.map((row, index) => (
                    <tr key={`${selected.id}-${index}`}>
                      <td>
                        <input
                          aria-label={`Keep row ${index + 1}`}
                          type="checkbox"
                          checked={!row.ignore}
                          onChange={event => setDraftByPhoto(current => ({
                            ...current,
                            [currentPhotoId]: draft.map((entry, i) => (i === index ? { ...entry, ignore: !event.target.checked } : entry)),
                          }))}
                        />
                      </td>
                      <td>
                        <input
                          value={row.productName}
                          onChange={event => setDraftByPhoto(current => ({
                            ...current,
                            [currentPhotoId]: draft.map((entry, i) => (i === index ? { ...entry, productName: event.target.value } : entry)),
                          }))}
                        />
                      </td>
                      <td>
                        <ProductSelect
                          products={data.products}
                          value={row.productId}
                          onChange={value => setDraftByPhoto(current => ({
                            ...current,
                            [currentPhotoId]: draft.map((entry, i) => (i === index ? { ...entry, productId: value } : entry)),
                          }))}
                          required={!row.ignore}
                        />
                      </td>
                      <td>
                        <input
                          type="number"
                          step="any"
                          min="50"
                          value={row.bottleSizeMl}
                          onChange={event => setDraftByPhoto(current => ({
                            ...current,
                            [currentPhotoId]: draft.map((entry, i) => (i === index ? { ...entry, bottleSizeMl: event.target.value } : entry)),
                          }))}
                        />
                      </td>
                      <td>
                        <input
                          type="number"
                          step="any"
                          min="0"
                          max="100"
                          value={row.fillPercent}
                          onChange={event => setDraftByPhoto(current => ({
                            ...current,
                            [currentPhotoId]: draft.map((entry, i) => (i === index ? { ...entry, fillPercent: event.target.value } : entry)),
                          }))}
                        />
                      </td>
                      <td>
                        <input
                          type="number"
                          step="1"
                          min="0"
                          value={row.quantity}
                          onChange={event => setDraftByPhoto(current => ({
                            ...current,
                            [currentPhotoId]: draft.map((entry, i) => (i === index ? { ...entry, quantity: event.target.value } : entry)),
                          }))}
                        />
                      </td>
                      <td>
                        <div className="inline-actions">
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            max="1"
                            value={row.confidence}
                            onChange={event => setDraftByPhoto(current => ({
                              ...current,
                              [currentPhotoId]: draft.map((entry, i) => (i === index ? { ...entry, confidence: event.target.value } : entry)),
                            }))}
                          />
                          <Badge tone={number(row.confidence) >= 0.8 ? "green" : number(row.confidence) >= 0.5 ? "amber" : "red"}>
                            {format(number(row.confidence) * 100, 0)}%
                          </Badge>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Panel>

      <Panel title="Recent uploads" subtitle="Track processing outcomes and review queue.">
        {photos.length === 0 ? (
          <Empty title="No photo uploads" description="Use Count My Bar to upload shelf images." />
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Filename</th>
                  <th>Status</th>
                  <th>Demo</th>
                  <th>Created</th>
                  <th>Confirmed</th>
                </tr>
              </thead>
              <tbody>
                {photos.slice(0, 12).map(photo => (
                  <tr key={photo.id}>
                    <td>{photo.filename}</td>
                    <td><Badge tone={photo.status === "COMPLETED" ? "green" : photo.status === "FAILED" ? "red" : "amber"}>{photo.status}</Badge></td>
                    <td>{photo.isDemo ? "DEMO" : "Live"}</td>
                    <td>{date(photo.createdAt, true)}</td>
                    <td>{photo.confirmedAt ? date(photo.confirmedAt, true) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Notice>
        <Camera size={16} />
        Neutral variance guidance: low confidence or unexplained discrepancy means review recommended, never an accusation.
      </Notice>
    </>
  );
}
