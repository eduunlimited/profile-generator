import { stringify as yamlStringify } from "yaml";
import { exportProfileAddress, exportProfileName } from "./exportProfileFields";
import { exportAycdJson, exportStellarAioJson } from "./botExportFormats";
import type {
  ExportFormat,
  ExportOptions,
  ExportTemplate,
  Profile,
} from "./types";

type FlatProfile = Record<string, string>;

function escapeCsv(value: string): string {
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildExportPayload(
  profile: Profile,
  options: ExportOptions,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    id: profile.id,
    locale: profile.locale,
  };

  if (options.fields.identity) {
    payload.name = exportProfileName(profile);
  }
  if (options.fields.address) {
    payload.address = exportProfileAddress(profile);
  }
  if (options.fields.payment) {
    payload.payment = profile.payment;
  }
  if (options.fields.logins) {
    payload.logins = profile.logins;
  }

  return payload;
}

function flattenProfile(profile: Profile, options: ExportOptions): FlatProfile {
  const name = exportProfileName(profile);
  const address = exportProfileAddress(profile);
  const login = profile.logins[0];
  const flat: FlatProfile = {
    id: profile.id,
    locale: profile.locale,
  };

  if (options.fields.identity) {
    flat.first_name = name.first;
    flat.last_name = name.last;
    flat.full_name = name.full;
  }
  if (options.fields.address) {
    flat.street = address.street ?? "";
    flat.unit = address.unit ?? "";
    flat.city = address.city ?? "";
    flat.state = address.state ?? "";
    flat.postal_code = address.postalCode ?? "";
    flat.country = address.country ?? "";
    flat.address_formatted = address.formatted ?? "";
  }
  if (options.fields.payment) {
    flat.card_number = profile.payment.number;
    flat.card_expiry = profile.payment.expiry;
    flat.card_cvv = profile.payment.cvv;
    flat.card_brand = profile.payment.brand;
  }
  if (options.fields.logins && login) {
    flat.login_label = login.label;
    flat.login_username = login.username;
    flat.login_email = login.email;
    flat.login_password = login.password;
  }

  return flat;
}

function resolvePlaceholder(profile: Profile, token: string): string {
  const loginMatch = token.match(/^login\[(\d+)\]\.(.+)$/);
  if (loginMatch) {
    const login = profile.logins[Number(loginMatch[1])];
    if (!login) return "";
    return String(login[loginMatch[2] as keyof typeof login] ?? "");
  }

  const [group, field] = token.split(".");
  switch (group) {
    case "profile":
      if (field === "id") return profile.id;
      if (field === "locale") return profile.locale;
      if (field.startsWith("name.")) {
        const nameField = field.replace("name.", "") as keyof typeof profile.name;
        const name = exportProfileName(profile);
        return String(name[nameField] ?? "");
      }
      return "";
    case "address": {
      const address = exportProfileAddress(profile);
      if (field === "formatted") return address.formatted ?? "";
      return String(address[field as keyof typeof address] ?? "");
    }
    case "payment":
      return String(profile.payment[field as keyof typeof profile.payment] ?? "");
    case "login": {
      const login = profile.logins[0];
      if (!login) return "";
      return String(login[field as keyof typeof login] ?? "");
    }
    case "meta":
      if (field === "exportedAt") return new Date().toISOString();
      if (field === "locale") return profile.locale;
      return "";
    default:
      return "";
  }
}

function renderTemplate(profile: Profile, template: ExportTemplate): string {
  return template.body.replace(/\{\{([^}]+)\}\}/g, (_, token: string) =>
    resolvePlaceholder(profile, token.trim()),
  );
}

export function exportProfiles(
  profiles: Profile[],
  options: ExportOptions,
  templates: ExportTemplate[] = [],
): { filename: string; content: string; mimeType: string }[] {
  if (profiles.length === 0 || options.formats.length === 0) return [];

  return options.formats.flatMap((format) =>
    exportProfilesForFormat(profiles, { ...options, formats: [format] }, templates),
  );
}

function exportProfilesForFormat(
  profiles: Profile[],
  options: ExportOptions,
  templates: ExportTemplate[] = [],
): { filename: string; content: string; mimeType: string }[] {
  const format = options.formats[0];
  if (!format) return [];

  const payloads = profiles.map((profile) => buildExportPayload(profile, options));

  if (format === "template") {
    const template = templates.find((item) => item.id === options.templateId);
    if (!template) {
      throw new Error("Export template not found.");
    }
    if (options.oneFilePerProfile) {
      return profiles.map((profile) => ({
        filename: `profile-${profile.id.slice(0, 8)}${template.extension}`,
        content: renderTemplate(profile, template),
        mimeType: template.mimeType,
      }));
    }
    return [
      {
        filename: `profiles${template.extension}`,
        content: profiles
          .map((profile) => renderTemplate(profile, template))
          .join("\n\n"),
        mimeType: template.mimeType,
      },
    ];
  }

  if (options.oneFilePerProfile) {
    return profiles.map((profile) => {
      const single = exportProfilesForFormat([profile], {
        ...options,
        oneFilePerProfile: false,
      }, templates);
      return {
        ...single[0],
        filename: `${filenameStemForProfile(profile)}${extensionForFormat(format)}`,
      };
    });
  }

  switch (format) {
    case "json":
      return [
        {
          filename: "profiles.json",
          content: JSON.stringify({ profiles: payloads }, null, 2),
          mimeType: "application/json",
        },
      ];
    case "jsonl":
      return [
        {
          filename: "profiles.jsonl",
          content: payloads.map((item) => JSON.stringify(item)).join("\n"),
          mimeType: "application/x-ndjson",
        },
      ];
    case "csv":
    case "tsv": {
      const delimiter = format === "csv" ? "," : "\t";
      const rows = profiles.map((profile) => flattenProfile(profile, options));
      const headers = Array.from(new Set(rows.flatMap((row) => Object.keys(row))));
      const lines = [
        headers.join(delimiter),
        ...rows.map((row) =>
          headers
            .map((header) =>
              format === "csv"
                ? escapeCsv(row[header] ?? "")
                : (row[header] ?? ""),
            )
            .join(delimiter),
        ),
      ];
      return [
        {
          filename: `profiles.${format}`,
          content: lines.join("\n"),
          mimeType: format === "csv" ? "text/csv" : "text/tab-separated-values",
        },
      ];
    }
    case "yaml":
      return [
        {
          filename: "profiles.yaml",
          content: yamlStringify({ profiles: payloads }),
          mimeType: "application/yaml",
        },
      ];
    case "xml": {
      const items = payloads
        .map((payload) => {
          const lines = [`  <profile id="${escapeXml(String(payload.id ?? ""))}">`];
          if (payload.name) {
            lines.push("    <name>");
            for (const [key, value] of Object.entries(payload.name as Record<string, string>)) {
              lines.push(`      <${key}>${escapeXml(String(value ?? ""))}</${key}>`);
            }
            lines.push("    </name>");
          }
          if (payload.address) {
            lines.push("    <address>");
            for (const [key, value] of Object.entries(payload.address as Record<string, string>)) {
              lines.push(`      <${key}>${escapeXml(String(value ?? ""))}</${key}>`);
            }
            lines.push("    </address>");
          }
          if (payload.payment) {
            lines.push("    <payment>");
            for (const [key, value] of Object.entries(payload.payment as Record<string, string>)) {
              lines.push(`      <${key}>${escapeXml(String(value ?? ""))}</${key}>`);
            }
            lines.push("    </payment>");
          }
          if (payload.logins) {
            lines.push("    <logins>");
            for (const login of payload.logins as Profile["logins"]) {
              lines.push(`      <login label="${escapeXml(login.label)}">`);
              lines.push(`        <username>${escapeXml(login.username)}</username>`);
              lines.push(`        <email>${escapeXml(login.email)}</email>`);
              lines.push(`        <password>${escapeXml(login.password)}</password>`);
              lines.push("      </login>");
            }
            lines.push("    </logins>");
          }
          lines.push("  </profile>");
          return lines.join("\n");
        })
        .join("\n");
      return [
        {
          filename: "profiles.xml",
          content: `<profiles exportedAt="${new Date().toISOString()}">\n${items}\n</profiles>`,
          mimeType: "application/xml",
        },
      ];
    }
    case "text":
      return [
        {
          filename: "profiles.txt",
          content: profiles
            .map((profile) => {
              const flat = flattenProfile(profile, options);
              return Object.entries(flat)
                .map(([key, value]) => `${key}: ${value}`)
                .join("\n");
            })
            .join("\n\n---\n\n"),
          mimeType: "text/plain",
        },
      ];
    case "aycd":
      return [
        {
          filename: "aycd.json",
          content: exportAycdJson(profiles),
          mimeType: "application/json",
        },
      ];
    case "stellar_aio":
      return [
        {
          filename: "stellar_aio.json",
          content: exportStellarAioJson(profiles),
          mimeType: "application/json",
        },
      ];
    default:
      throw new Error(`Unsupported export format: ${format satisfies never}`);
  }
}

function filenameStemForProfile(profile: Profile): string {
  const slug = profile.name.full.trim().replace(/[^a-zA-Z0-9-_]+/g, "-").replace(/^-|-$/g, "");
  return slug ? slug : `profile-${profile.id.slice(0, 8)}`;
}

function extensionForFormat(format: ExportFormat): string {
  switch (format) {
    case "json":
      return ".json";
    case "jsonl":
      return ".jsonl";
    case "csv":
      return ".csv";
    case "tsv":
      return ".tsv";
    case "yaml":
      return ".yaml";
    case "xml":
      return ".xml";
    case "text":
      return ".txt";
    case "template":
      return ".txt";
    case "aycd":
      return "_aycd.json";
    case "stellar_aio":
      return "_stellar_aio.json";
    default:
      return ".txt";
  }
}

export function previewExport(
  profiles: Profile[],
  options: ExportOptions,
  templates: ExportTemplate[] = [],
): string {
  const files = exportProfiles(profiles, options, templates);
  return files.map((file) => `# ${file.filename}\n${file.content}`).join("\n\n");
}
