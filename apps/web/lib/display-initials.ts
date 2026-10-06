export function displayInitials(name: string): string {
  return (
    name
      .trim()
      .split(/\s+/)
      .flatMap((word) => word.match(/[\p{L}\p{N}]/u)?.[0] ?? [])
      .slice(0, 2)
      .join("")
      .toLocaleUpperCase() || "N"
  );
}
