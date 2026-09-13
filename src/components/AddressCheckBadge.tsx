import type { AddressCheckStatus } from "../lib/types";
import { addressCheckLabel } from "../lib/addressCheck";

interface AddressCheckBadgeProps {
  status?: AddressCheckStatus;
  message?: string;
  displayLabel?: string;
  masterMatch?: boolean;
  cancelCount?: number;
  cancelSiteLabel?: string;
}

export function AddressCheckBadge({
  status,
  message,
  displayLabel,
  masterMatch,
  cancelCount = 0,
  cancelSiteLabel,
}: AddressCheckBadgeProps) {
  const label = displayLabel?.trim() || addressCheckLabel(status);
  const title = message?.trim() || label;
  const inFlight = status === "queued" || Boolean(displayLabel?.trim());
  const cancelTitle =
    cancelCount > 0
      ? `${cancelCount} ${cancelSiteLabel ? `${cancelSiteLabel} ` : ""}cancellation${cancelCount === 1 ? "" : "s"}`
      : undefined;
  return (
    <span className="address-check-stack" title={title}>
      <span className={`address-check-badge address-check-${status ?? "unchecked"}`}>
        {label}
      </span>
      {!inFlight && masterMatch === true ? <span className="address-master-match">Master</span> : null}
      {!inFlight && masterMatch === false ? <span className="address-master-mismatch">Not master</span> : null}
      {cancelCount > 0 ? (
        <span className="address-cancel-count" title={cancelTitle}>
          {cancelCount}
        </span>
      ) : null}
    </span>
  );
}
