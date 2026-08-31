import { useMemo } from "react";
import { RejigPanel } from "./RejigPanel";
import type {
  JigPreset,
  MasterProfile,
  ProfileSummary,
  RejigProfilesOptions,
  RejigProfilesResult,
} from "../lib/types";

interface RejigModalProps {
  open: boolean;
  profileIds: string[];
  profiles: ProfileSummary[];
  masterProfiles: MasterProfile[];
  jigPresets: JigPreset[];
  geocodioConfigured?: boolean;
  addressJobStatus?: string | null;
  onClose: () => void;
  onRejig: (options: RejigProfilesOptions) => Promise<RejigProfilesResult>;
  onSuccess?: (result: RejigProfilesResult) => void;
}

export function RejigModal({
  open,
  profileIds,
  profiles,
  masterProfiles,
  jigPresets,
  geocodioConfigured,
  addressJobStatus,
  onClose,
  onRejig,
  onSuccess,
}: RejigModalProps) {
  const selectedProfiles = useMemo(() => {
    const selected = new Set(profileIds);
    return profiles.filter((profile) => selected.has(profile.id));
  }, [profileIds, profiles]);

  if (!open) return null;

  return (
    <div className="modal-overlay">
      <div className="modal-dialog modal-dialog-generate" onClick={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <strong>Re-jig profiles</strong>
          <button type="button" className="tool-btn tool-btn-cyan" onClick={onClose}>
            Close
          </button>
        </div>
        <RejigPanel
          selectedProfiles={selectedProfiles}
          masterProfiles={masterProfiles}
          jigPresets={jigPresets}
          geocodioConfigured={geocodioConfigured}
          addressJobStatus={addressJobStatus}
          onRejig={onRejig}
          onSuccess={onSuccess}
        />
      </div>
    </div>
  );
}
