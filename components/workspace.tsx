"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ArrowUpRight, Camera, ChartNoAxesCombined, ChevronDown, ClipboardList, LayoutDashboard, LogOut, MapPin, Menu, Package, RefreshCw, Settings, ShoppingBag, Sparkles, Wine, X, BookOpen } from "lucide-react";
import type { WorkspaceData } from "./types";
import { errorMessage, Notice, request } from "./ui";

interface WorkspaceContextValue { data: WorkspaceData; reload: () => Promise<void>; mutate: <T = unknown>(action: string, values?: Record<string, unknown>) => Promise<T> }
const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);
export function useWorkspace() { const context = useContext(WorkspaceContext); if (!context) throw new Error("Workspace is not available."); return context; }
const navigation = [
  { href: "/dashboard", label: "Overview", icon: LayoutDashboard },
  { href: "/inventory", label: "Inventory", icon: Package },
  { href: "/sales", label: "Sales & imports", icon: ChartNoAxesCombined },
  { href: "/recipes", label: "Recipes", icon: BookOpen },
  { href: "/photos", label: "Photo counts", icon: Camera },
  { href: "/receiving", label: "Receiving", icon: ShoppingBag },
  { href: "/variance", label: "Variance", icon: ClipboardList },
];
export function Brand() { return <span className="brand"><span className="brand-icon"><Wine size={23} strokeWidth={1.5} /></span>OMNIPANA<span className="brand-dot">.</span></span>; }
export function Workspace({ children }: { children: ReactNode }) {
  const [data, setData] = useState<WorkspaceData | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const pathname = usePathname(); const router = useRouter();
  const reload = useCallback(async () => { const next = await request<WorkspaceData>("/api/workspace"); setData(next); setError(""); }, []);
  useEffect(() => { let active = true; request<WorkspaceData>("/api/workspace").then(value => { if (active) setData(value); }).catch(err => { if (active) setError(errorMessage(err)); }).finally(() => { if (active) setLoading(false); }); return () => { active = false; }; }, []);
  useEffect(() => {
    if (!mobileOpen) return;
    const old = document.body.style.overflow; document.body.style.overflow = "hidden";
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") setMobileOpen(false); };
    document.addEventListener("keydown", escape);
    return () => { document.body.style.overflow = old; document.removeEventListener("keydown", escape); };
  }, [mobileOpen]);
  const mutate = useCallback(async <T,>(action: string, values: Record<string, unknown> = {}) => {
    const result = await request<T>("/api/actions", { ...values, action });
    try { await reload(); } catch { setError("Your change was saved, but the workspace could not refresh. Refresh to see the latest data."); }
    return result;
  }, [reload]);
  const logout = async () => { setLoggingOut(true); try { await request("/api/auth/logout", {}); router.replace("/login"); router.refresh(); } catch (err) { setError(errorMessage(err)); setLoggingOut(false); } };
  return <div className="workspace"><a className="skip-link" href="#main">Skip to content</a>
    {mobileOpen && <button className="sidebar-backdrop" aria-label="Close navigation" onClick={() => setMobileOpen(false)} />}
    <aside className={`sidebar ${mobileOpen ? "open" : ""}`} aria-label="Main navigation">
      <div className="sidebar-brand"><Link href="/dashboard" aria-label="OmniPana overview" onClick={() => setMobileOpen(false)}><Brand /></Link><button className="icon-button mobile-only" aria-label="Close navigation" onClick={() => setMobileOpen(false)}><X size={20} /></button></div>
      <div className="workspace-picker"><span className="location-icon"><MapPin size={18} /></span><div><strong>{data?.organization.name || "Your workspace"}</strong><span>{data?.location.name || "Bar operations"}</span></div><ChevronDown size={14} /></div>
      <p className="nav-caption">WORKSPACE</p>
      <nav>{navigation.map(({ href, label, icon: Icon }) => <Link key={href} href={href} className={`nav-link ${pathname === href || pathname.startsWith(href + "/") ? "active" : ""}`} aria-current={pathname === href || pathname.startsWith(href + "/") ? "page" : undefined} onClick={() => setMobileOpen(false)}><Icon size={19} strokeWidth={1.7} />{label}{href === "/photos" && <span className="nav-new">AI</span>}</Link>)}</nav>
      <div className="sidebar-bottom"><div className="sidebar-tip"><Sparkles size={20} /><strong>Less counting.<br />More hospitality.</strong><p>Your next stocktake starts with a photo.</p><Link href="/photos" onClick={() => setMobileOpen(false)}>Count my bar <ArrowUpRight size={15} /></Link></div><Link href="/settings" className={`nav-link ${pathname === "/settings" ? "active" : ""}`} aria-current={pathname === "/settings" ? "page" : undefined} onClick={() => setMobileOpen(false)}><Settings size={19} />Settings</Link><button className="nav-link logout" disabled={loggingOut} onClick={() => void logout()}><LogOut size={18} />{loggingOut ? "Signing out…" : "Sign out"}</button></div>
    </aside>
    <div className="workspace-main"><header className="topbar"><div className="topbar-location"><button className="icon-button mobile-only" aria-label="Open navigation" aria-expanded={mobileOpen} onClick={() => setMobileOpen(true)}><Menu size={22} /></button><MapPin size={16} className="desktop-only" /><span>{data?.location.name || "Workspace"}</span><span className="topbar-divider">/</span><span className="muted desktop-only">Bar operations, simplified</span></div><div className="topbar-user">{data?.demo && <span className="badge amber">DEMO</span>}<span className="user-name">{data?.user.name}</span><Link className="avatar" href="/settings" aria-label="Account settings">{data?.user.name?.trim().slice(0, 1).toUpperCase() || "P"}</Link></div></header>
      <main id="main" className="page-content">{error && <div className="workspace-error"><Notice kind="error">{error}</Notice><button className="button secondary" onClick={() => { setLoading(true); void reload().catch(err => setError(errorMessage(err))).finally(() => setLoading(false)); }}><RefreshCw size={15} />Retry</button></div>}
        {loading && !data ? <div className="loading-view" role="status"><div className="skeleton skeleton-title" /><div className="stats-grid">{[1, 2, 3, 4].map(i => <div className="skeleton skeleton-card" key={i} />)}</div><div className="skeleton skeleton-body" /><span className="muted">Loading your workspace…</span></div> : data ? <WorkspaceContext.Provider value={{ data, reload, mutate }}>{children}</WorkspaceContext.Provider> : <div className="empty"><Wine size={40} /><h1>Let’s get you connected.</h1><p>The workspace is unavailable. Retry above or sign in again.</p><Link href="/login" className="button secondary">Back to sign in</Link></div>}
      </main><footer className="workspace-footer"><span>OMNIPANA · A little clarity behind the bar.</span><span>Made for your daily pour.</span></footer>
    </div><Link className="mobile-count button" href="/photos"><Camera size={20} />Count My Bar</Link>
  </div>;
}