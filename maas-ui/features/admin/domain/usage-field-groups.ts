export type UsageFieldGroup = "input" | "output" | "total" | "other";

// Classification is presentation only. Never combine aliases or derive totals.
export function usageFieldGroup(key: string): UsageFieldGroup {
  const name = key.replace(/_/g, "").toLowerCase();
  if (["totaltokens", "totaltokencount"].includes(name)) return "total";
  if (/^(input|prompt|cache|cached)/.test(name)) return "input";
  if (/^(output|completion|candidate|thought|reasoning|acceptedprediction|rejectedprediction)/.test(name)) return "output";
  return "other";
}
