import { validateConfig } from "./recommendations";

export const catalogueUnavailableMessage = "The model catalogue is temporarily unavailable. Please try again shortly.";

export type FinderSearchParams = Record<string, string | string[] | undefined>;
export type FinderCandidate = {
  chip?: string;
  memoryGb?: number;
  diskGb?: number;
  workload?: string;
};

const configurationFields = ["chip", "memoryGb", "diskGb", "workload"] as const;

export function firstQueryValue(params: FinderSearchParams, key: string): string | undefined {
  const value = params[key];
  return Array.isArray(value) ? value[0] : value;
}

export function parseFinderRequest(params: FinderSearchParams) {
  const value = (key: string) => firstQueryValue(params, key);
  const memoryGb = value("memoryGb");
  const diskGb = value("diskGb");
  const submitted = configurationFields.some((key) => value(key) !== undefined);
  const candidate: FinderCandidate = {
    chip: value("chip"),
    memoryGb: memoryGb === undefined ? undefined : Number(memoryGb),
    diskGb: diskGb === undefined ? undefined : Number(diskGb),
    workload: value("workload"),
  };

  return { submitted, candidate, validation: submitted ? validateConfig(candidate) : undefined };
}
