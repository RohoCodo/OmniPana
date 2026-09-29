"use client";
import Link from "next/link";
import { CircleAlert } from "lucide-react";
export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) { return <div className="standalone-state"><CircleAlert size={42} /><p className="eyebrow">A small interruption</p><h1>Something didn’t go as planned.</h1><p>Your work matters. Try loading this page again.</p><div className="inline-actions"><button className="button" onClick={reset}>Try again</button><Link className="button secondary" href="/dashboard">Back to overview</Link></div></div>; }