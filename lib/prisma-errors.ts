const RESTRICT_FOREIGN_KEY_MESSAGE =
  /\bforeign key\b|\bviolates?\b[^.\r\n]{0,160}\bconstraint\b|\brestrict(?:ed|ion)?\b[^.\r\n]{0,160}\b(?:constraint|delete|relation)\b|\bdelete\b[^.\r\n]{0,160}\brestrict(?:ed|ion)?\b/i;

export function isRestrictForeignKeyError(error: unknown): boolean {
  const candidate = error as { code?: unknown; message?: unknown } | null;
  if (candidate?.code === "P2003" || candidate?.code === "P2014") return true;

  const message = String(candidate?.message ?? error).toLowerCase();
  return RESTRICT_FOREIGN_KEY_MESSAGE.test(message);
}
