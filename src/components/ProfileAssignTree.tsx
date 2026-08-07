import { useMemo, useState } from "react";
import type { MasterProfile, ProfileSummary } from "../lib/types";
import {
  buildProfileAssignCategories,
  isProfileInParentSelection,
  type ProfileAssignCategory,
} from "../lib/profileAssignTree";

interface ProfileAssignTreeProps {
  profiles: ProfileSummary[];
  masterProfiles: MasterProfile[];
  credentialCount: number;
  selectedProfileIds: string[];
  selectedParentCategoryIds: string[];
  onSelectedProfileIdsChange: (ids: string[]) => void;
  onSelectedParentCategoryIdsChange: (ids: string[]) => void;
}

export function ProfileAssignTree({
  profiles,
  masterProfiles,
  credentialCount,
  selectedProfileIds,
  selectedParentCategoryIds,
  onSelectedProfileIdsChange,
  onSelectedParentCategoryIdsChange,
}: ProfileAssignTreeProps) {
  const categories = useMemo(
    () => buildProfileAssignCategories(profiles, masterProfiles),
    [profiles, masterProfiles],
  );

  const [expanded, setExpanded] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(categories.map((category) => [category.id, true])),
  );

  const toggleExpand = (categoryId: string) => {
    setExpanded((current) => ({ ...current, [categoryId]: !current[categoryId] }));
  };

  const toggleParent = (category: ProfileAssignCategory) => {
    const isSelected = selectedParentCategoryIds.includes(category.id);
    if (isSelected) {
      onSelectedParentCategoryIdsChange(selectedParentCategoryIds.filter((id) => id !== category.id));
      return;
    }

    onSelectedParentCategoryIdsChange([...selectedParentCategoryIds, category.id]);
    const childIds = new Set(category.profiles.map((profile) => profile.id));
    onSelectedProfileIdsChange(selectedProfileIds.filter((id) => !childIds.has(id)));
    setExpanded((current) => ({ ...current, [category.id]: true }));
  };

  const toggleProfile = (category: ProfileAssignCategory, profileId: string) => {
    if (selectedParentCategoryIds.includes(category.id)) return;

    onSelectedProfileIdsChange(
      selectedProfileIds.includes(profileId)
        ? selectedProfileIds.filter((id) => id !== profileId)
        : [...selectedProfileIds, profileId],
    );
  };

  if (categories.length === 0) {
    return <p className="muted">No profiles available.</p>;
  }

  return (
    <div className="assign-profile-tree">
      {categories.map((category) => {
        const parentSelected = selectedParentCategoryIds.includes(category.id);
        const isOpen = expanded[category.id] ?? true;
        const parentTake = Math.min(credentialCount, category.profiles.length);

        return (
          <div key={category.id} className="assign-profile-category">
            <div className="assign-profile-category-header">
              <button
                type="button"
                className="assign-tree-toggle"
                aria-expanded={isOpen}
                onClick={() => toggleExpand(category.id)}
              >
                {isOpen ? "▾" : "▸"}
              </button>
              <label className="assign-option-row assign-profile-parent-row">
                <input
                  type="checkbox"
                  checked={parentSelected}
                  onChange={() => toggleParent(category)}
                />
                <span className="assign-option-label">
                  <strong>{category.label}</strong>
                  <span className="muted">
                    {" "}
                    · {category.profiles.length} profile{category.profiles.length === 1 ? "" : "s"}
                    {parentSelected && credentialCount > 0
                      ? ` · first ${parentTake} will be assigned`
                      : ""}
                  </span>
                </span>
              </label>
            </div>
            {isOpen ? (
              <div className="assign-profile-children">
                {category.profiles.map((profile, index) => {
                  const inParentRange = isProfileInParentSelection(
                    category.id,
                    index,
                    selectedParentCategoryIds,
                    credentialCount,
                  );
                  const checked = inParentRange || selectedProfileIds.includes(profile.id);
                  const disabled = parentSelected;

                  return (
                    <label
                      key={profile.id}
                      className={`assign-option-row assign-profile-child-row${inParentRange ? " assign-profile-child-in-range" : ""}${disabled && !inParentRange ? " assign-option-row-disabled" : ""}`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={disabled}
                        onChange={() => toggleProfile(category, profile.id)}
                      />
                      <span className="assign-option-content">
                        {inParentRange ? (
                          <span className="assign-card-order" aria-hidden="true">
                            {index + 1}
                          </span>
                        ) : null}
                        <span className="assign-option-label">
                          {profile.name || "Unnamed"}
                          <span className="muted"> · {profile.accounts}</span>
                        </span>
                      </span>
                    </label>
                  );
                })}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
