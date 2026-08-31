export interface ParsedEmailLine {
  email: string;
  lineNumber: number;
}

export interface SkippedEmailImport {
  email: string;
  lineNumber: number;
  reason: "existing" | "duplicate_in_import";
}

export function emailImportKey(email: string): string {
  return email.trim().toLowerCase();
}

export function filterDuplicateEmailImports(
  lines: ParsedEmailLine[],
  existingEmails: Array<{ email: string }>,
): { lines: ParsedEmailLine[]; skipped: SkippedEmailImport[] } {
  const existingKeys = new Set(existingEmails.map((item) => emailImportKey(item.email)));
  const seenInBatch = new Set<string>();
  const kept: ParsedEmailLine[] = [];
  const skipped: SkippedEmailImport[] = [];

  for (const line of lines) {
    const key = emailImportKey(line.email);
    if (existingKeys.has(key)) {
      skipped.push({ email: line.email, lineNumber: line.lineNumber, reason: "existing" });
      continue;
    }
    if (seenInBatch.has(key)) {
      skipped.push({ email: line.email, lineNumber: line.lineNumber, reason: "duplicate_in_import" });
      continue;
    }
    seenInBatch.add(key);
    kept.push(line);
  }

  return { lines: kept, skipped };
}

export function formatEmailImportSkipMessage(
  importedCount: number,
  skipped: SkippedEmailImport[],
  invalidCount = 0,
): string {
  const parts: string[] = [];

  if (importedCount > 0) {
    parts.push(`Imported ${importedCount} email${importedCount === 1 ? "" : "s"}.`);
  }

  if (invalidCount > 0) {
    parts.push(`Skipped ${invalidCount} invalid line${invalidCount === 1 ? "" : "s"}.`);
  }

  if (skipped.length > 0) {
    const skippedNames = skipped.map((entry) => entry.email).join(", ");
    parts.push(
      `Skipped ${skipped.length} duplicate email${skipped.length === 1 ? "" : "s"}: ${skippedNames}.`,
    );
  }

  if (parts.length === 0) {
    return "Nothing was imported.";
  }

  if (importedCount === 0 && (skipped.length > 0 || invalidCount > 0)) {
    parts.push("Nothing was imported.");
  }

  return parts.join(" ");
}

export function parseBulkEmailLines(text: string): {
  lines: ParsedEmailLine[];
  errors: string[];
} {
  const errors: string[] = [];
  const lines: ParsedEmailLine[] = [];

  text.split(/\r?\n/).forEach((raw, index) => {
    const line = raw.trim();
    if (!line || line.startsWith("#")) {
      return;
    }

    if (!line.includes("@") || line.split("@").length !== 2 || !line.split("@")[1]?.includes(".")) {
      errors.push(`Line ${index + 1}: expected a valid email address`);
      return;
    }

    lines.push({ email: line, lineNumber: index + 1 });
  });

  return { lines, errors };
}
