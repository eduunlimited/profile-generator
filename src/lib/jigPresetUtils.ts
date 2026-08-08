import { getJigPresetById } from "./presets";
import { AFFIX_MODE_LABELS } from "./jigRuleLabels";
import type { AddressRule, GenerateFromMasterOptions, JigPreset, RejigProfilesOptions, StreetAffixMode } from "./types";

export const STREET_RANDOM_LETTER_PRESET_IDS = [
  "builtin-street-random-letters",
  "builtin-street-prefix-letters",
  "builtin-street-suffix-letters",
] as const;

export function isStreetRandomLetterPresetId(id: string): boolean {
  return (STREET_RANDOM_LETTER_PRESET_IDS as readonly string[]).includes(id);
}

export interface ResolvedAddressJig {
  rules: AddressRule[];
  label: string | undefined;
  presetIds: string[];
}

export function streetRandomLettersLabel(options: {
  affixMode: StreetAffixMode;
  charCount: number;
}): string {
  return `Street random letters (${AFFIX_MODE_LABELS[options.affixMode].toLowerCase()}, ${options.charCount})`;
}

export function resolveAddressJigFromGenerateOptions(
  options: Pick<
    GenerateFromMasterOptions | RejigProfilesOptions,
    "streetRandomLetters" | "addressJigPresetIds" | "addressJigPresetId"
  >,
  catalog: JigPreset[],
): ResolvedAddressJig {
  const rules: AddressRule[] = [];
  const labelParts: string[] = [];

  if (options.streetRandomLetters?.enabled) {
    const charCount = Math.max(1, Math.min(8, options.streetRandomLetters.charCount));
    rules.push({
      type: "streetRandomLetters",
      field: "street",
      charCount,
      affixMode: options.streetRandomLetters.affixMode,
    });
    labelParts.push(
      streetRandomLettersLabel({
        affixMode: options.streetRandomLetters.affixMode,
        charCount,
      }),
    );
  }

  const presetIds = resolveAddressJigPresetIds(options).filter((id) => !isStreetRandomLetterPresetId(id));
  const presets = resolveJigPresetsByIds(presetIds, catalog);
  for (const preset of presets) {
    for (const rule of preset.addressRules) {
      if (rule.type !== "splitLines") {
        rules.push(rule);
      }
    }
    labelParts.push(preset.name);
  }

  if (rules.length > 0) {
    rules.push({ type: "splitLines" });
  }

  return {
    rules,
    label: labelParts.length > 0 ? labelParts.join(" + ") : undefined,
    presetIds,
  };
}

export function sortJigPresets(items: JigPreset[], recommended: readonly string[]): JigPreset[] {
  const rank = new Map(recommended.map((id, index) => [id, index]));
  return [...items].sort((a, b) => {
    const aRank = rank.get(a.id) ?? 999;
    const bRank = rank.get(b.id) ?? 999;
    if (aRank !== bRank) return aRank - bRank;
    return a.name.localeCompare(b.name);
  });
}

export function resolveJigPresetsByIds(ids: string[] | undefined, catalog: JigPreset[]): JigPreset[] {
  if (!ids?.length) return [];
  return ids
    .map((id) => catalog.find((preset) => preset.id === id) ?? getJigPresetById(id))
    .filter((preset): preset is JigPreset => Boolean(preset));
}

export function resolveAddressJigPresetIds(options: {
  addressJigPresetIds?: string[];
  addressJigPresetId?: string;
}): string[] {
  if (options.addressJigPresetIds?.length) {
    return options.addressJigPresetIds;
  }
  if (options.addressJigPresetId) {
    return [options.addressJigPresetId];
  }
  return [];
}

export function resolveAddressJigPresetsFromOptions(
  options: { addressJigPresetIds?: string[]; addressJigPresetId?: string },
  catalog: JigPreset[],
): JigPreset[] {
  return resolveJigPresetsByIds(resolveAddressJigPresetIds(options), catalog);
}

export function addressJigPresetLabel(presets: JigPreset[]): string | undefined {
  const names = presets.map((preset) => preset.name).filter(Boolean);
  return names.length > 0 ? names.join(" + ") : undefined;
}
