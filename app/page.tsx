import { FinderForm } from "@/app/components/finder-form";
import { Results } from "@/app/components/results";
import { Hero } from "@/app/components/hero";
import { PresetLinks } from "@/app/components/preset-links";
import { SiteFooter } from "@/app/components/site-footer";
import { getRecommendations, isCatalogueUnavailableError } from "@/lib/recommendation-service";
import { catalogueUnavailableMessage, parseFinderRequest, type FinderSearchParams } from "@/lib/request";
import type { MacConfig } from "@/lib/hardware";

const initial: MacConfig = { chip: "m4", memoryGb: 16, diskGb: 80, workload: "balanced", runtime: "ollama", context: "normal" };

export default async function Home({ searchParams }: { searchParams: Promise<FinderSearchParams> }) {
  const params = await searchParams;
  const { submitted, candidate, validation: submittedValidation } = parseFinderRequest(params);
  const validation = submittedValidation ?? { valid: true as const, data: initial };
  const selectedConfig = validation.valid ? validation.data : undefined;
  let result;
  let catalogueError = "";
  if (submitted && validation.valid) {
    try { result = await getRecommendations(validation.data); }
    catch (error) {
      if (isCatalogueUnavailableError(error)) catalogueError = catalogueUnavailableMessage;
      else throw error;
    }
  }
  return <main>
    <a className="skip-link" href="#finder">Skip to the model finder</a>
    <Hero />
    <PresetLinks />
    <FinderForm config={validation.valid ? validation.data : candidate} submitted={submitted} errors={validation.valid ? [] : validation.errors} fieldErrors={validation.valid ? {} : validation.fieldErrors} catalogueError={catalogueError} />
    {result && selectedConfig && <Results result={result} config={selectedConfig} />}
    <SiteFooter />
  </main>;
}
