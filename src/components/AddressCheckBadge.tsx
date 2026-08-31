import type { AddressCheckStatus } from "../lib/types";
import { addressCheckLabel } from "../lib/addressCheck";

interface AddressCheckBadgeProps {
  status?: AddressCheckStatus;
  message?: string;
  displayLabel?: string;
  masterMatch?: boolean;
}

export function AddressCheckBadge({ status, message, displayLabel, masterMatch }: AddressCheckBadgeProps) {
  const label = displayLabel?.trim() || addressCheckLabel(status);
  const title = message?.trim() || label;
  const inFlight = status === "queued" || Boolean(displayLabel?.trim());
  return (
    <span className="address-check-stack" title={title}>
      <span className={`address-check-badge address-check-${status ?? "unchecked"}`}>
        {label}
      </span>
      {!inFlight && masterMatch === true ? <span className="address-master-match">Master</span> : null}
      {!inFlight && masterMatch === false ? <span className="address-master-mismatch">Not master</span> : null}
    </span>
  );
}
