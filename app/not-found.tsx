import Link from "next/link";
import { Wine } from "lucide-react";
export default function NotFound() { return <div className="standalone-state"><Wine size={44} /><p className="eyebrow">404 · Off the menu</p><h1>This page isn’t on our list.</h1><p>Let’s head back to familiar territory.</p><Link className="button" href="/dashboard">Back to overview</Link></div>; }