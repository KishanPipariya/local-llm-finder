import type { Metadata } from "next";
import { siteUrl } from "@/lib/site";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: "Local / LLM — Mac model finder",
  description: "Find current local chat and coding models that fit your Mac.",
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    url: "/",
    siteName: "Local / LLM",
    title: "Local / LLM — Mac model finder",
    description: "Find current local chat and coding models that fit your Mac.",
  },
  twitter: {
    card: "summary_large_image",
    title: "Local / LLM — Mac model finder",
    description: "Find current local chat and coding models that fit your Mac.",
  },
};
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="en"><body>{children}</body></html>; }
