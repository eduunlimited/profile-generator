import { useEffect, useMemo, useRef, useState } from "react";
import { ACCOUNT_SITES, DEFAULT_ACCOUNT_SITE } from "../lib/profileEmailUtils";

export const ADD_SITE_OPTION = "__add_site__";
export const NONE_SITE_OPTION = "";

interface AccountSiteSelectProps {
  site: string;
  onSiteChange: (site: string) => void;
  extraSites?: string[];
  allowNone?: boolean;
  noneLabel?: string;
}

export function AccountSiteSelect({
  site,
  onSiteChange,
  extraSites = [],
  allowNone = false,
  noneLabel = "No account link",
}: AccountSiteSelectProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const presetSites = useMemo(() => {
    const builtins = [...ACCOUNT_SITES];
    const custom = [
      ...new Set(
        extraSites.filter((entry) => entry.trim() && !builtins.includes(entry as (typeof ACCOUNT_SITES)[number])),
      ),
    ].sort((a, b) => a.localeCompare(b));
    return [...builtins, ...custom];
  }, [extraSites]);

  const isPresetSite = site.trim() !== "" && presetSites.includes(site);
  const [isAdding, setIsAdding] = useState(!isPresetSite && site.trim() !== "");

  useEffect(() => {
    if (isPresetSite) {
      setIsAdding(false);
    }
  }, [isPresetSite]);

  useEffect(() => {
    if (isAdding) {
      inputRef.current?.focus();
    }
  }, [isAdding]);

  if (isAdding || (site.trim() !== "" && !presetSites.includes(site))) {
    return (
      <input
        ref={inputRef}
        className="inline-combobox-control"
        value={site}
        placeholder="Enter site name"
        autoComplete="off"
        onChange={(event) => onSiteChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            setIsAdding(false);
            onSiteChange(allowNone ? NONE_SITE_OPTION : DEFAULT_ACCOUNT_SITE);
          }
        }}
      />
    );
  }

  const selectValue = isPresetSite ? site : allowNone ? NONE_SITE_OPTION : DEFAULT_ACCOUNT_SITE;

  return (
    <select
      className="inline-combobox-control"
      value={selectValue}
      onChange={(event) => {
        const value = event.target.value;
        if (value === ADD_SITE_OPTION) {
          setIsAdding(true);
          onSiteChange("");
          return;
        }
        onSiteChange(value);
      }}
    >
      {allowNone ? (
        <option value={NONE_SITE_OPTION}>{noneLabel}</option>
      ) : null}
      {presetSites.map((entry) => (
        <option key={entry} value={entry}>
          {entry}
        </option>
      ))}
      <option value={ADD_SITE_OPTION}>+ Add site</option>
    </select>
  );
}
