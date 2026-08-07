import { useEffect, useMemo, useState } from "react";
import { exportProfiles, previewExport } from "../lib/exportEngine";
import type { ExportFormat, ExportOptions, ExportTemplate, Profile } from "../lib/types";
import { getProfile } from "../lib/api";
import { saveTextFile } from "../lib/saveFile";
import { copyToClipboard } from "../hooks/useAppData";
import { Field } from "./ui";

interface ExportPanelProps {
  selectedProfileIds: string[];
  exportTemplates: ExportTemplate[];
  onSaveTemplate: (template: ExportTemplate) => Promise<void>;
}

const GENERIC_FORMATS: { value: ExportFormat; label: string; filename: string }[] = [
  { value: "json", label: "JSON", filename: "profiles.json" },
  { value: "jsonl", label: "JSON Lines", filename: "profiles.jsonl" },
  { value: "csv", label: "CSV", filename: "profiles.csv" },
  { value: "tsv", label: "TSV", filename: "profiles.tsv" },
  { value: "yaml", label: "YAML", filename: "profiles.yaml" },
  { value: "xml", label: "XML", filename: "profiles.xml" },
  { value: "text", label: "Plain text", filename: "profiles.txt" },
  { value: "template", label: "Custom template", filename: "custom" },
];

const BOT_FORMATS: { value: ExportFormat; label: string; filename: string }[] = [
  { value: "aycd", label: "AYCD", filename: "aycd.json" },
  { value: "stellar_aio", label: "Stellar AIO", filename: "stellar_aio.json" },
];

const DEFAULT_FORMATS: ExportFormat[] = ["aycd", "stellar_aio"];

export function ExportPanel({
  selectedProfileIds,
  exportTemplates,
  onSaveTemplate,
}: ExportPanelProps) {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [selectedFormats, setSelectedFormats] = useState<ExportFormat[]>(DEFAULT_FORMATS);
  const [previewFormat, setPreviewFormat] = useState<ExportFormat>("aycd");
  const [templateId, setTemplateId] = useState("");
  const [oneFilePerProfile, setOneFilePerProfile] = useState(false);
  const [fields, setFields] = useState({
    identity: true,
    address: true,
    payment: true,
    logins: true,
  });
  const [templateDraft, setTemplateDraft] = useState<ExportTemplate>({
    id: crypto.randomUUID(),
    name: "",
    description: "",
    extension: ".json",
    mimeType: "application/json",
    body: '{\n  "email": "{{login.email}}"\n}',
  });
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    void Promise.all(selectedProfileIds.map((id) => getProfile(id))).then(setProfiles);
  }, [selectedProfileIds]);

  useEffect(() => {
    if (selectedFormats.length === 0) return;
    if (!selectedFormats.includes(previewFormat)) {
      setPreviewFormat(selectedFormats[0]);
    }
  }, [previewFormat, selectedFormats]);

  const options = useMemo<ExportOptions>(
    () => ({
      formats: selectedFormats,
      templateId: selectedFormats.includes("template") ? templateId : undefined,
      profileIds: selectedProfileIds,
      fields,
      oneFilePerProfile,
    }),
    [fields, oneFilePerProfile, selectedFormats, selectedProfileIds, templateId],
  );

  const previewOptions = useMemo<ExportOptions>(
    () => ({
      ...options,
      formats: [previewFormat],
    }),
    [options, previewFormat],
  );

  const preview = useMemo(() => {
    if (profiles.length === 0) return "";
    try {
      return previewExport(profiles, previewOptions, exportTemplates);
    } catch (error) {
      return error instanceof Error ? error.message : "Preview failed.";
    }
  }, [exportTemplates, previewOptions, profiles]);

  const toggleFormat = (format: ExportFormat) => {
    setSelectedFormats((current) =>
      current.includes(format)
        ? current.filter((item) => item !== format)
        : [...current, format],
    );
  };

  const exportFiles = async () => {
    if (profiles.length === 0) {
      setStatus("Select at least one profile to export.");
      return;
    }
    if (selectedFormats.length === 0) {
      setStatus("Select at least one export format.");
      return;
    }
    if (selectedFormats.includes("template") && !templateId) {
      setStatus("Select a custom template or uncheck Custom template.");
      return;
    }
    try {
      const files = exportProfiles(profiles, options, exportTemplates);
      for (const file of files) {
        await saveTextFile(file.filename, file.content);
      }
      setStatus(`Exported ${files.length} file(s): ${files.map((file) => file.filename).join(", ")}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Export failed.");
    }
  };

  const copyPreview = async () => {
    await copyToClipboard(preview);
    setStatus("Preview copied to clipboard.");
  };

  const saveTemplate = async () => {
    if (!templateDraft.name.trim()) return;
    await onSaveTemplate(templateDraft);
    setTemplateDraft({
      id: crypto.randomUUID(),
      name: "",
      description: "",
      extension: ".json",
      mimeType: "application/json",
      body: '{\n  "email": "{{login.email}}"\n}',
    });
    setStatus("Export template saved.");
  };

  const usesBotFormats = selectedFormats.some((format) => format === "aycd" || format === "stellar_aio");

  return (
    <div className="panel-grid export-panel-grid">
      <section className="card">
        <div className="card-header">
          <div>
            <h2>Formats &amp; options</h2>
          </div>
        </div>

        <h3 className="subsection-title">Bot formats</h3>
        <div className="checkbox-grid">
          {BOT_FORMATS.map((item) => (
            <label key={item.value} className="checkbox-row">
              <input
                type="checkbox"
                checked={selectedFormats.includes(item.value)}
                onChange={() => toggleFormat(item.value)}
              />
              {item.label} ({item.filename})
            </label>
          ))}
        </div>

        <h3 className="subsection-title">Generic formats</h3>
        <div className="checkbox-grid">
          {GENERIC_FORMATS.map((item) => (
            <label key={item.value} className="checkbox-row">
              <input
                type="checkbox"
                checked={selectedFormats.includes(item.value)}
                onChange={() => toggleFormat(item.value)}
              />
              {item.label} ({item.filename})
            </label>
          ))}
        </div>

        <div className="form-grid">
          <Field label="Preview format">
            <select
              value={previewFormat}
              onChange={(event) => setPreviewFormat(event.target.value as ExportFormat)}
            >
              {selectedFormats.map((format) => {
                const item = [...BOT_FORMATS, ...GENERIC_FORMATS].find((entry) => entry.value === format);
                return (
                  <option key={format} value={format}>
                    {item?.label ?? format}
                  </option>
                );
              })}
            </select>
          </Field>
          {selectedFormats.includes("template") ? (
            <Field label="Template">
              <select value={templateId} onChange={(event) => setTemplateId(event.target.value)}>
                <option value="">Select template</option>
                {exportTemplates.map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.name}
                  </option>
                ))}
              </select>
            </Field>
          ) : null}
        </div>

        {!usesBotFormats ? (
          <div className="checkbox-grid">
            {Object.entries(fields).map(([key, enabled]) => (
              <label key={key} className="checkbox-row">
                <input
                  type="checkbox"
                  checked={enabled}
                  onChange={(event) => setFields({ ...fields, [key]: event.target.checked })}
                />
                Include {key}
              </label>
            ))}
          </div>
        ) : (
          <p className="muted">Bot formats always include name, address, payment, and login email.</p>
        )}

        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={oneFilePerProfile}
            onChange={(event) => setOneFilePerProfile(event.target.checked)}
          />
          One file per profile
        </label>

        <div className="button-row">
          <button type="button" className="btn-primary" onClick={() => void exportFiles()}>
            Export selected formats
          </button>
          <button type="button" className="btn-secondary" onClick={() => void copyPreview()}>
            Copy preview
          </button>
        </div>
        {status ? <p className="status-banner">{status}</p> : null}
      </section>

      <section className="card">
        <div className="card-header">
          <h2>Preview</h2>
        </div>
        <pre className="preview-box">{preview || "No profiles to preview."}</pre>
      </section>

      <section className="card">
        <div className="card-header">
          <h2>Custom export template</h2>
        </div>
        <div className="form-grid">
          <Field label="Name">
            <input
              value={templateDraft.name}
              onChange={(event) => setTemplateDraft({ ...templateDraft, name: event.target.value })}
            />
          </Field>
          <Field label="Extension">
            <input
              value={templateDraft.extension}
              onChange={(event) => setTemplateDraft({ ...templateDraft, extension: event.target.value })}
            />
          </Field>
        </div>
        <Field label="Template body">
          <textarea
            rows={12}
            value={templateDraft.body}
            onChange={(event) => setTemplateDraft({ ...templateDraft, body: event.target.value })}
          />
        </Field>
        <p className="muted">
          Placeholders: {"{{profile.name.full}}"}, {"{{address.street}}"}, {"{{payment.number}}"}, {"{{login.email}}"}
        </p>
        <div className="button-row">
          <button type="button" className="btn-secondary" onClick={() => void saveTemplate()}>
            Save template
          </button>
        </div>
      </section>
    </div>
  );
}
