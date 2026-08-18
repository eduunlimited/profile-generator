import { useEffect, useMemo, useState } from "react";
import {
  buildExportFilename,
  buildExportFilenameContext,
  exportProfiles,
  previewExport,
} from "../lib/exportEngine";
import type {
  ExportFormat,
  ExportOptions,
  ExportTemplate,
  MasterProfile,
  Profile,
  ProfileCategory,
} from "../lib/types";
import { getProfile } from "../lib/api";
import { saveTextFile } from "../lib/saveFile";
import { copyToClipboard } from "../hooks/useAppData";
import { formatError } from "../lib/errorUtils";
import { Field } from "./ui";

interface ExportPanelProps {
  selectedProfileIds: string[];
  exportTemplates: ExportTemplate[];
  masterProfiles: MasterProfile[];
  profileCategories: ProfileCategory[];
  onSaveTemplate: (template: ExportTemplate) => Promise<void>;
  onLastAction?: (label: string) => void;
}

const GENERIC_FORMATS: { value: ExportFormat; label: string }[] = [
  { value: "json", label: "JSON" },
  { value: "jsonl", label: "JSON Lines" },
  { value: "csv", label: "CSV" },
  { value: "tsv", label: "TSV" },
  { value: "yaml", label: "YAML" },
  { value: "xml", label: "XML" },
  { value: "text", label: "Plain text" },
  { value: "template", label: "Custom template" },
];

const BOT_FORMATS: { value: ExportFormat; label: string }[] = [
  { value: "aycd", label: "AYCD" },
  { value: "stellar_aio", label: "Stellar AIO" },
];

const DEFAULT_FORMATS: ExportFormat[] = ["aycd", "stellar_aio"];

export function ExportPanel({
  selectedProfileIds,
  exportTemplates,
  masterProfiles,
  profileCategories,
  onSaveTemplate,
  onLastAction,
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
  const [profilesLoading, setProfilesLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (selectedProfileIds.length === 0) {
      setProfiles([]);
      setProfilesLoading(false);
      return () => {
        cancelled = true;
      };
    }

    setProfilesLoading(true);
    void (async () => {
      const results = await Promise.all(
        selectedProfileIds.map(async (id) => {
          try {
            return await getProfile(id);
          } catch (error) {
            console.error(`Failed to load profile ${id} for export:`, error);
            return null;
          }
        }),
      );
      if (cancelled) return;
      const loaded = results.filter((profile): profile is Profile => profile !== null);
      setProfiles(loaded);
      setProfilesLoading(false);
      if (loaded.length === 0) {
        setStatus("Could not load the selected profiles for export.");
      } else if (loaded.length < selectedProfileIds.length) {
        setStatus(`Loaded ${loaded.length} of ${selectedProfileIds.length} selected profiles.`);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedProfileIds]);

  useEffect(() => {
    if (selectedFormats.length === 0) return;
    if (!selectedFormats.includes(previewFormat)) {
      setPreviewFormat(selectedFormats[0]);
    }
  }, [previewFormat, selectedFormats]);

  const filenameContext = useMemo(
    () => buildExportFilenameContext(profiles, masterProfiles, profileCategories),
    [masterProfiles, profileCategories, profiles],
  );

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
      return previewExport(profiles, previewOptions, exportTemplates, filenameContext);
    } catch (error) {
      return error instanceof Error ? error.message : "Preview failed.";
    }
  }, [exportTemplates, filenameContext, previewOptions, profiles]);

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
      const files = exportProfiles(profiles, options, exportTemplates, filenameContext);
      const saved: string[] = [];
      const cancelled: string[] = [];
      for (const file of files) {
        const wrote = await saveTextFile(file.filename, file.content);
        if (wrote) saved.push(file.filename);
        else cancelled.push(file.filename);
      }
      if (saved.length === 0) {
        setStatus(cancelled.length > 0 ? "Export cancelled." : "Nothing to export.");
        return;
      }
      const cancelledNote =
        cancelled.length > 0 ? ` (${cancelled.length} save dialog${cancelled.length === 1 ? "" : "s"} cancelled)` : "";
      const message = `Exported ${saved.length} file(s): ${saved.join(", ")}${cancelledNote}`;
      setStatus(message);
      onLastAction?.(message);
    } catch (error) {
      setStatus(formatError(error, "Export failed."));
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
  const selectedTemplate = exportTemplates.find((template) => template.id === templateId);
  const sampleFilename = (format: ExportFormat) =>
    buildExportFilename(format, filenameContext, {
      templateExtension: format === "template" ? selectedTemplate?.extension : undefined,
    });


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
              {item.label} ({sampleFilename(item.value)})
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
              {item.label} ({sampleFilename(item.value)})
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
        <pre className="preview-box">
          {profilesLoading ? "Loading profiles…" : preview || "No profiles to preview."}
        </pre>
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
