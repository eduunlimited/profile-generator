export interface ParsedCredentialLine {
  username: string;
  password: string;
  lineNumber: number;
}

export interface SkippedAccountImport {
  username: string;
  lineNumber: number;
  reason: "existing" | "duplicate_in_import";
}

export function accountImportKey(site: string, username: string): string {
  return `${site.trim().toLowerCase()}::${username.trim().toLowerCase()}`;
}

export function filterDuplicateAccountImports(
  site: string,
  lines: ParsedCredentialLine[],
  existingCredentials: Array<{ site: string; username: string }>,
): { lines: ParsedCredentialLine[]; skipped: SkippedAccountImport[] } {
  const existingKeys = new Set(
    existingCredentials.map((credential) => accountImportKey(credential.site, credential.username)),
  );
  const seenInBatch = new Set<string>();
  const kept: ParsedCredentialLine[] = [];
  const skipped: SkippedAccountImport[] = [];

  for (const line of lines) {
    const key = accountImportKey(site, line.username);
    if (existingKeys.has(key)) {
      skipped.push({ username: line.username, lineNumber: line.lineNumber, reason: "existing" });
      continue;
    }
    if (seenInBatch.has(key)) {
      skipped.push({ username: line.username, lineNumber: line.lineNumber, reason: "duplicate_in_import" });
      continue;
    }
    seenInBatch.add(key);
    kept.push(line);
  }

  return { lines: kept, skipped };
}

export function formatAccountImportSkipMessage(
  site: string,
  importedCount: number,
  skipped: SkippedAccountImport[],
): string {
  if (skipped.length === 0) {
    return importedCount === 1 ? "Imported 1 account." : `Imported ${importedCount} accounts.`;
  }

  const skippedNames = skipped.map((entry) => entry.username).join(", ");
  const parts: string[] = [];

  if (importedCount > 0) {
    parts.push(`Imported ${importedCount} account${importedCount === 1 ? "" : "s"}.`);
  }

  parts.push(
    `Skipped ${skipped.length} duplicate account${skipped.length === 1 ? "" : "s"} for ${site}: ${skippedNames}.`,
  );

  if (importedCount === 0) {
    parts.push("Nothing was imported.");
  }

  return parts.join(" ");
}

export function parseBulkCredentialLines(text: string): {
  lines: ParsedCredentialLine[];
  errors: string[];
} {
  const errors: string[] = [];
  const lines: ParsedCredentialLine[] = [];

  text.split(/\r?\n/).forEach((raw, index) => {
    const line = raw.trim();
    if (!line || line.startsWith("#")) {
      return;
    }

    const colonIndex = line.indexOf(":");
    if (colonIndex <= 0) {
      errors.push(`Line ${index + 1}: expected username:password`);
      return;
    }

    const username = line.slice(0, colonIndex).trim();
    const password = line.slice(colonIndex + 1);

    if (!username) {
      errors.push(`Line ${index + 1}: username is empty`);
      return;
    }
    if (!password) {
      errors.push(`Line ${index + 1}: password is empty`);
      return;
    }

    lines.push({ username, password, lineNumber: index + 1 });
  });

  return { lines, errors };
}
