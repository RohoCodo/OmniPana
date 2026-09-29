"use client";

import Link from "next/link";
import { useState, type FormEvent, type ReactNode } from "react";
import { ArrowUpRight, CheckCircle2, CircleAlert, LoaderCircle, PackageOpen } from "lucide-react";
import type { DecimalValue, Product } from "./types";

export const number = (value: DecimalValue | null | undefined) => Number(value ?? 0);
export const format = (value: DecimalValue | null | undefined, digits = 1) => value == null ? "—" : new Intl.NumberFormat("en-US", { maximumFractionDigits: digits }).format(number(value));
export const money = (value: DecimalValue | null | undefined) => value == null ? "—" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(number(value));
export const date = (value?: string | null, time = false) => !value || Number.isNaN(Date.parse(value)) ? "—" : new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", ...(time ? { hour: "numeric", minute: "2-digit" } : {}) }).format(new Date(value));
export const human = (value: string) => value.replaceAll("_", " ").toLowerCase();
const ansiPattern = /\u001b\[[0-9;]*m/g;
export const errorMessage = (error: unknown) => {
  if (!(error instanceof Error)) return "Something went wrong. Please try again.";
  return error.message.replace(ansiPattern, "").trim() || "Something went wrong. Please try again.";
};

export async function request<T>(url: string, body?: unknown): Promise<T> {
  const response = await fetch(url, body === undefined ? { cache: "no-store" } : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (response.status === 401 && !url.startsWith("/api/auth/")) window.location.replace("/login");
  const result: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new Error(result && typeof result === "object" && "error" in result && typeof result.error === "string" ? result.error : `Request failed (${response.status}). Please try again.`);
  return result as T;
}
export function PageHeader({ eyebrow, title, description, children }: { eyebrow?: string; title: string; description: string; children?: ReactNode }) {
  return <header className="page-heading"><div>{eyebrow && <p className="eyebrow">{eyebrow}</p>}<h1>{title}</h1><p className="muted">{description}</p></div><div className="heading-actions">{children}</div></header>;
}
export function Panel({ title, subtitle, action, children, className = "" }: { title?: string; subtitle?: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return <section className={`panel ${className}`}>{(title || action) && <div className="panel-heading"><div><h2>{title}</h2>{subtitle && <p className="muted small">{subtitle}</p>}</div>{action}</div>}{children}</section>;
}
export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "green" | "amber" | "red" }) { return <span className={`badge ${tone}`}>{children}</span>; }
export function Notice({ children, kind = "info" }: { children: ReactNode; kind?: "info" | "success" | "error" }) { return <div className={`notice ${kind}`} role={kind === "error" ? "alert" : "status"}>{kind === "success" ? <CheckCircle2 size={18} /> : <CircleAlert size={18} />}<div>{children}</div></div>; }
export function Empty({ title, description, href, action }: { title: string; description: string; href?: string; action?: string }) { return <div className="empty"><PackageOpen size={34} strokeWidth={1.3} /><h3>{title}</h3><p>{description}</p>{href && <Link className="button secondary" href={href}>{action}<ArrowUpRight size={16} /></Link>}</div>; }
export function Field({ label, children, hint, className = "" }: { label: string; children: ReactNode; hint?: string; className?: string }) { return <label className={`field ${className}`}><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>; }
export function ProductSelect({ products, value, onChange, required = true, disabled = false }: { products: Product[]; value: string; onChange: (value: string) => void; required?: boolean; disabled?: boolean }) {
  return <select value={value} onChange={e => onChange(e.target.value)} required={required} disabled={disabled}><option value="">Select a product</option>{products.map(p => <option key={p.id} value={p.id}>{p.name} · {format(p.bottleSizeMl)} ml</option>)}</select>;
}
export function Submit({ pending, children, disabled = false }: { pending: boolean; children: ReactNode; disabled?: boolean }) { return <button type="submit" className="button" disabled={pending || disabled}>{pending && <LoaderCircle size={16} className="spin" />}{pending ? "Saving…" : children}</button>; }
export function useOperation() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const run = async (operation: () => Promise<void>, message = "Changes saved.") => {
    setPending(true); setError(""); setSuccess("");
    try { await operation(); setSuccess(message); return true; }
    catch (err) { setError(errorMessage(err)); return false; }
    finally { setPending(false); }
  };
  return { pending, error, success, run, feedback: <>{error && <Notice kind="error">{error}</Notice>}{success && <Notice kind="success">{success}</Notice>}</> };
}
export function ActionForm({ children, onSubmit, className = "" }: { children: ReactNode; onSubmit: () => void | Promise<unknown>; className?: string }) {
  return <form className={`form-stack ${className}`} onSubmit={(event: FormEvent) => { event.preventDefault(); void onSubmit(); }}>{children}</form>;
}
export function Stat({ label, value, detail, icon }: { label: string; value: string; detail: string; icon?: ReactNode }) { return <div className="stat"><div className="stat-label">{label}{icon}</div><strong>{value}</strong><span>{detail}</span></div>; }