import type { Metadata } from "next";
import Link from "next/link";
import { repositoryUrl } from "@/lib/site";

export const metadata: Metadata = {
  title: "Privacy — Local / LLM",
  description: "How Local / LLM processes Mac configuration data and catalogue requests.",
  alternates: { canonical: "/privacy" },
};

export default function Privacy() {
  return <main className="legal-page">
    <Link className="brand" href="/" aria-label="Return to the Local LLM model finder">LOCAL / LLM</Link>
    <article aria-labelledby="privacy-title">
      <span className="eyebrow">Privacy notice · 30 August 2026</span>
      <h1 id="privacy-title">Your Mac profile is request input, not an account.</h1>
      <p className="legal-intro">Local / LLM has no accounts, advertising, application analytics, profile database, or configuration cookies.</p>

      <h2>What the finder receives</h2>
      <p>The finder receives the chip, unified memory, available storage, workload, context, and runtime choices you submit. The server-rendered form puts those values in a shareable URL. Anyone you share that URL with can read them.</p>

      <h2>How the app uses the profile</h2>
      <p>The server validates the values and uses them to rank a cached public Hugging Face catalogue. The application does not write the profile to a database, account, cookie, browser storage, or analytics service.</p>

      <h2>Hosting request logs</h2>
      <p>The public deployment is hosted by Vercel. Like other hosting providers, Vercel processes operational request information and may temporarily retain request paths and search parameters in platform logs. That means the shareable GET URL can appear in hosting logs even though this application does not persist a profile. Retention and access are governed by Vercel’s service policies.</p>

      <h2>Hugging Face requests and links</h2>
      <p>The server fetches public model metadata from Hugging Face without including your Mac profile. If you open a model link, your browser visits Hugging Face directly and its privacy terms apply. External model links do not send this page as the referrer.</p>

      <h2>Questions or security reports</h2>
      <p>For privacy questions, <a href={`${repositoryUrl}/issues`} target="_blank" rel="noreferrer">open a repository issue<span className="visually-hidden"> (opens in a new tab)</span></a>. For a security concern, use the private reporting instructions in <a href={`${repositoryUrl}/security/policy`} target="_blank" rel="noreferrer">the security policy<span className="visually-hidden"> (opens in a new tab)</span></a>.</p>
    </article>
    <p><Link href="/">← Return to the model finder</Link></p>
  </main>;
}
