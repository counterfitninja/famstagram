export function getSafeLoginRedirect(value: string | null | undefined) {
  const next = value?.trim();
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.includes("\\")) return "/";
  return next.slice(0, 512);
}
