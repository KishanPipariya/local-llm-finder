import { validateConfig } from "./hardware";

export const catalogueUnavailableMessage = "The model catalogue is temporarily unavailable. Please try again shortly.";

export type FinderSearchParams = Record<string, string | string[] | undefined>;
export type FinderCandidate = {
  chip?: string;
  memoryGb?: number;
  diskGb?: number;
  workload?: string;
  runtime?: string;
  context?: string;
};

const configurationFields = ["chip", "memoryGb", "diskGb", "workload", "runtime", "context"] as const;
const decimalNumber = /^(?:\d+|\d*\.\d+)(?:[eE][+-]?\d+)?$/;

function parseQueryNumber(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  return decimalNumber.test(value) ? Number(value) : Number.NaN;
}

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
    memoryGb: parseQueryNumber(memoryGb),
    diskGb: parseQueryNumber(diskGb),
    workload: value("workload"),
  };
  const runtime = value("runtime");
  const context = value("context");
  // The UI uses `any` as an explicit, shareable representation of the
  // established runtime-neutral legacy behaviour. It is not part of the API
  // validation contract, which continues to accept only concrete runtimes.
  if (runtime !== undefined && runtime !== "any") candidate.runtime = runtime;
  if (context !== undefined) candidate.context = context;

  return { submitted, candidate, validation: submitted ? validateConfig(candidate) : undefined };
}
