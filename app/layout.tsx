import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = { title: "Local / LLM — Mac model finder", description: "Find current local chat and coding models that fit your Mac." };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="en"><body>{children}</body></html>; }
