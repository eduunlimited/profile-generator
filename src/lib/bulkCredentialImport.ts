export interface ParsedCredentialLine {
  username: string;
  password: string;
  lineNumber: number;
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
