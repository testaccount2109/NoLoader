const changelogFiles = import.meta.glob("../../changelogs/*.md", {
  eager: true,
  query: "?raw",
  import: "default",
}) as Record<string, string>;

export function getLauncherChangelog(version: string): string | null {
  const normalizedVersion = version.trim().replace(/^v/, "");
  const matchingEntry = Object.entries(changelogFiles).find(([path]) =>
    path.endsWith(`/${normalizedVersion}.md`),
  );

  return matchingEntry?.[1] ?? null;
}
