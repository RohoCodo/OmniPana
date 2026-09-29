import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = { title: { default: "OmniPana — Your bar, in balance", template: "%s · OmniPana" }, description: "Thoughtful inventory, photo counts, receiving, and sales for a better-run bar." };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="en"><body>{children}</body></html>; }