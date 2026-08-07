import { getJigPresetById } from "./presets";
import type { JigPreset } from "./types";

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
