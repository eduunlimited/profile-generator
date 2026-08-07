import { useMemo, useState } from "react";
import type { ProfileSummary } from "../lib/types";
import { EmptyState } from "./ui";

interface ProfilesSidebarProps {
  profiles: ProfileSummary[];
  selectedProfileId: string | null;
  showMasterProfile: boolean;
  masterProfileLabel: string;
  onOpenMasterProfile: () => void;
  onSelectProfile: (id: string) => void;
  onDeleteProfile: (id: string) => Promise<void>;
}

export function ProfilesSidebar({
  profiles,
  selectedProfileId,
  showMasterProfile,
  masterProfileLabel,
  onOpenMasterProfile,
  onSelectProfile,
  onDeleteProfile,
}: ProfilesSidebarProps) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const lower = query.toLowerCase();
    return profiles.filter((profile) =>
      [profile.name, profile.email, profile.city, profile.state, profile.jigPresetName, profile.credentialSites, profile.creditCardLabel]
        .filter(Boolean)
        .some((value) => value!.toLowerCase().includes(lower)),
    );
  }, [profiles, query]);

  return (
    <aside className="profiles-sidebar card">
      <div className="sidebar-header">
        <div>
          <h2>Profiles</h2>
          <p className="muted">{profiles.length} generated</p>
        </div>
      </div>

      <button
        type="button"
        className={showMasterProfile ? "master-profile-button active" : "master-profile-button"}
        onClick={onOpenMasterProfile}
      >
        <span className="master-profile-button-title">Master Profile</span>
        <span className="master-profile-button-subtitle muted">
          {masterProfileLabel} · name &amp; address
        </span>
      </button>

      <input
        className="search-input full-width"
        placeholder="Search profiles..."
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />

      <div className="profile-list">
        {filtered.length === 0 ? (
          <EmptyState
            title="No profiles yet"
            description="Set your master profile, then use the Generate tab to create jigged profiles."
          />
        ) : (
          filtered.map((profile) => {
            const active = profile.id === selectedProfileId && !showMasterProfile;
            return (
              <button
                key={profile.id}
                type="button"
                className={active ? "profile-list-item active" : "profile-list-item"}
                onClick={() => onSelectProfile(profile.id)}
              >
                <div className="profile-list-top">
                  <strong>{profile.name || "Untitled profile"}</strong>
                  {profile.jigPresetName ? <span className="pill">{profile.jigPresetName}</span> : null}
                </div>
                <div className="profile-list-meta muted">
                  <span>{profile.email || "No email"}</span>
                  <span>{profile.city}{profile.city && profile.state ? ", " : ""}{profile.state}</span>
                  {profile.creditCardLabel ? <span>Card: {profile.creditCardLabel}</span> : null}
                  {profile.credentialSites ? <span>Creds: {profile.credentialSites}</span> : null}
                </div>
                <div className="profile-list-actions" onClick={(event) => event.stopPropagation()}>
                  <button type="button" className="ghost-button danger" onClick={() => void onDeleteProfile(profile.id)}>
                    Delete
                  </button>
                </div>
              </button>
            );
          })
        )}
      </div>
    </aside>
  );
}
