export interface PrCardData {
  title: string;
  repository: string;
  number: number;
  url: string;
  additions?: number;
  deletions?: number;
  changedFiles?: number;
  files?: { path: string; additions: number; deletions: number }[];
}

export function prCardData(evidence: unknown): PrCardData | null {
  if (!Array.isArray(evidence)) return null;
  const encoded = evidence.find(
    (value) => typeof value === "string" && value.startsWith("pr-card:"),
  );
  if (!encoded) return null;
  try {
    const data = JSON.parse(encoded.slice(8)) as PrCardData;
    if (
      typeof data.title !== "string" ||
      !/^[\w.-]+\/[\w.-]+$/.test(data.repository) ||
      !Number.isSafeInteger(data.number) ||
      data.number < 1 ||
      data.url !== `https://github.com/${data.repository}/pull/${data.number}`
    )
      return null;
    const count = (value: unknown) =>
      typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
    for (const key of ["additions", "deletions", "changedFiles"] as const)
      if (data[key] !== undefined && !count(data[key])) return null;
    if (
      data.files !== undefined &&
      (!Array.isArray(data.files) ||
        data.files.some(
          (file) =>
            typeof file.path !== "string" ||
            !count(file.additions) ||
            !count(file.deletions),
        ))
    )
      return null;
    return data;
  } catch {
    return null;
  }
}
