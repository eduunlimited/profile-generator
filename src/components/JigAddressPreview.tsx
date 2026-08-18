import { useEffect, useMemo, useState } from "react";
import {
  applyLocalJigRulesToMaster,
  finalizeJigFromLocalAndMisspell,
  formatAddress,
  type LocalJigSlot,
} from "../lib/jigEngine";
import { buildMisspellRequest, buildStreetVariationHint, misspellWithOpenAi } from "../lib/openaiMisspell";
import { getJigPresetById } from "../lib/presets";
import { resolveAddressJigFromGenerateOptions } from "../lib/jigPresetUtils";
import { namePartsForMisspell, resolveProfileNameBase } from "../lib/profileNameUtils";
import {
  applyPhoneLastFourJig,
  formatUsPhone,
  randomUniquePhoneLastFour,
} from "../lib/phoneUtils";
import type {
  GenerateFromMasterOptions,
  JigPreset,
  MasterProfile,
  ProfileAddress,
  ProfileName,
  NameMisspellScope,
  StreetAffixMode,
} from "../lib/types";

interface JigAddressPreviewProps {
  master: MasterProfile | null;
  nameJigPresetId: string;
  nameMisspellScope: NameMisspellScope;
  phoneJigLastFour: boolean;
  streetRandomLettersEnabled: boolean;
  streetRandomAffixMode: StreetAffixMode;
  streetRandomCharCount: number;
  addressJigPresetIds: string[];
  jigPresets: JigPreset[];
}

interface PreviewState {
  hasJigs: boolean;
  masterText: string;
  sampleText: string;
  hasNameJig: boolean;
  loading: boolean;
  error: string | null;
}

function formatNameLine(name: ProfileName, useJig: boolean): string {
  if (useJig && name.jig?.trim()) {
    return name.jig.trim();
  }
  return resolveProfileNameBase(name);
}

function formatPreviewBlock(
  name: ProfileName,
  address: ProfileAddress,
  useNameJig: boolean,
  phone?: string,
): string {
  const nameLine = formatNameLine(name, useNameJig);
  const addressLines = formatAddress(address);
  const lines = [nameLine, addressLines].filter(Boolean);
  if (phone?.trim()) {
    lines.push(formatUsPhone(phone));
  }
  return lines.join("\n");
}

function buildSamplePreviewText(
  master: MasterProfile,
  local: LocalJigSlot,
  misspell: import("../lib/openaiMisspell").OpenAiMisspellResult | undefined,
  namePreset: JigPreset | null,
  hasNameJig: boolean,
  hasPhoneJig: boolean,
): string {
  const jigged = finalizeJigFromLocalAndMisspell(master, local, misspell, namePreset);
  let samplePhone = master.phone ?? "";
  if (hasPhoneJig) {
    const lastFour = randomUniquePhoneLastFour(new Set());
    samplePhone = lastFour
      ? applyPhoneLastFourJig(master.phone ?? "", lastFour)
      : master.phone ?? "";
  }
  return formatPreviewBlock(jigged.name, jigged.address, hasNameJig, samplePhone);
}

export function JigAddressPreview({
  master,
  nameJigPresetId,
  nameMisspellScope,
  phoneJigLastFour,
  streetRandomLettersEnabled,
  streetRandomAffixMode,
  streetRandomCharCount,
  addressJigPresetIds,
  jigPresets,
}: JigAddressPreviewProps) {
  const [previewSeed, setPreviewSeed] = useState(0);
  const [preview, setPreview] = useState<PreviewState>({
    hasJigs: false,
    masterText: "",
    sampleText: "",
    hasNameJig: false,
    loading: false,
    error: null,
  });

  const jigOptionsKey = useMemo(
    () =>
      JSON.stringify({
        nameJigPresetId,
        nameMisspellScope,
        phoneJigLastFour,
        streetRandomLettersEnabled,
        streetRandomAffixMode,
        streetRandomCharCount,
        addressJigPresetIds,
        masterId: master?.id,
        previewSeed,
      }),
    [
      nameJigPresetId,
      nameMisspellScope,
      phoneJigLastFour,
      streetRandomLettersEnabled,
      streetRandomAffixMode,
      streetRandomCharCount,
      addressJigPresetIds,
      master?.id,
      previewSeed,
    ],
  );

  useEffect(() => {
    if (!master) {
      setPreview({
        hasJigs: false,
        masterText: "",
        sampleText: "",
        hasNameJig: false,
        loading: false,
        error: null,
      });
      return;
    }

    const namePreset = nameJigPresetId
      ? jigPresets.find((preset) => preset.id === nameJigPresetId) ?? getJigPresetById(nameJigPresetId) ?? null
      : null;

    const generateOptions: Pick<
      GenerateFromMasterOptions,
      "streetRandomLetters" | "addressJigPresetIds"
    > = {
      streetRandomLetters: streetRandomLettersEnabled
        ? {
            enabled: true,
            affixMode: streetRandomAffixMode,
            charCount: streetRandomCharCount,
          }
        : undefined,
      addressJigPresetIds,
    };

    const resolved = resolveAddressJigFromGenerateOptions(generateOptions, jigPresets);
    const hasNameJig = Boolean(namePreset);
    const hasAddressJigs = resolved.rules.length > 0;
    const hasPhoneJig = phoneJigLastFour && Boolean(master.phone?.trim());
    const hasJigs = hasNameJig || hasAddressJigs || hasPhoneJig;
    const masterText = formatPreviewBlock(master.name, master.address, false, master.phone);
    const local = applyLocalJigRulesToMaster(master, namePreset, [], resolved.rules, nameMisspellScope);
    const needsOpenAi = local.needsNameMisspell || local.needsStreetMisspell;

    if (!hasJigs) {
      setPreview({
        hasJigs: false,
        masterText,
        sampleText: "",
        hasNameJig: false,
        loading: false,
        error: null,
      });
      return;
    }

    if (!needsOpenAi) {
      setPreview({
        hasJigs: true,
        masterText,
        sampleText: buildSamplePreviewText(master, local, undefined, namePreset, hasNameJig, hasPhoneJig),
        hasNameJig,
        loading: false,
        error: null,
      });
      return;
    }

    let cancelled = false;
    setPreview((current) => ({
      ...current,
      hasJigs: true,
      masterText,
      sampleText: "",
      hasNameJig,
      loading: true,
      error: null,
    }));

    const nameParts = namePartsForMisspell(master.name);
    const request = buildMisspellRequest(
      local.needsNameMisspell ? nameParts.first : undefined,
      local.needsNameMisspell ? nameParts.last : undefined,
      local.needsStreetMisspell ? local.jigAddress.street : undefined,
      nameMisspellScope,
      local.needsStreetMisspell
        ? buildStreetVariationHint(previewSeed, local.jigAddress.street)
        : `preview-${previewSeed}`,
    );

    const loadPreview = async () => {
      try {
        const misspell = request ? await misspellWithOpenAi(request) : undefined;
        if (cancelled) return;

        setPreview({
          hasJigs: true,
          masterText,
          sampleText: buildSamplePreviewText(master, local, misspell, namePreset, hasNameJig, hasPhoneJig),
          hasNameJig,
          loading: false,
          error: null,
        });
      } catch (error) {
        if (cancelled) return;

        if (!local.needsNameMisspell) {
          setPreview({
            hasJigs: true,
            masterText,
            sampleText: buildSamplePreviewText(master, local, undefined, namePreset, false, hasPhoneJig),
            hasNameJig: false,
            loading: false,
            error:
              local.needsStreetMisspell
                ? "Street misspell preview unavailable — showing local address jigs only."
                : null,
          });
          return;
        }

        setPreview({
          hasJigs: true,
          masterText,
          sampleText: "Could not load OpenAI misspell preview.",
          hasNameJig,
          loading: false,
          error: error instanceof Error ? error.message : "OpenAI misspell preview failed.",
        });
      }
    };

    void loadPreview();

    return () => {
      cancelled = true;
    };
  }, [master, nameJigPresetId, nameMisspellScope, jigOptionsKey, jigPresets]);

  if (!master) {
    return null;
  }

  const usesOpenAi = preview.hasJigs && (Boolean(nameJigPresetId) || addressJigPresetIds.includes("builtin-address-misspell"));

  return (
    <div className="jig-preview">
      <div className="jig-preview-header">
        <span className="subsection-title">Preview</span>
        <button
          type="button"
          className="btn-secondary btn-compact"
          disabled={!preview.hasJigs || preview.loading}
          onClick={() => setPreviewSeed((seed) => seed + 1)}
        >
          {preview.loading ? "Loading..." : "Refresh sample"}
        </button>
      </div>
      <div className="jig-preview-grid">
        <div className="jig-preview-col">
          <span className="jig-preview-label">Master</span>
          <pre className="jig-preview-text">{preview.masterText}</pre>
        </div>
        <div className="jig-preview-col">
          <span className="jig-preview-label">Sample jig</span>
          <pre
            className={[
              "jig-preview-text",
              preview.hasJigs ? "jig-preview-text-active" : "jig-preview-text-empty",
              preview.hasNameJig ? "jig-preview-text-name-jigged" : "",
            ]
              .filter(Boolean)
              .join(" ")}
          >
            {preview.loading
              ? "Generating sample..."
              : preview.hasJigs
                ? preview.sampleText
                : "Select name, address, or phone jigs to preview"}
          </pre>
        </div>
      </div>
      {preview.error ? <p className="status-inline jig-preview-status">{preview.error}</p> : null}
      {preview.hasJigs && !preview.loading ? (
        <p className="muted jig-preview-note">
          {usesOpenAi
            ? "Name and street misspell samples use OpenAI when selected. Other jigs are local. Each profile will differ."
            : "Preview uses local jigs only. Each generated profile will differ."}
        </p>
      ) : null}
    </div>
  );
}
