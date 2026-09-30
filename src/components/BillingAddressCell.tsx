import { AddressCheckBadge } from "./AddressCheckBadge";
import type { AddressCheckStatus } from "../lib/types";

interface BillingAddressCellProps {
  name?: string;
  line1: string;
  line2: string;
  line3: string;
  checkStatus?: AddressCheckStatus;
  checkMessage?: string;
  checkDisplayLabel?: string;
  masterMatch?: boolean;
  successCount?: number;
  cancelCount?: number;
  cancelSiteLabel?: string;
}

export function BillingAddressCell({
  name,
  line1,
  line2,
  line3,
  checkStatus,
  checkMessage,
  checkDisplayLabel,
  masterMatch,
  successCount,
  cancelCount,
  cancelSiteLabel,
}: BillingAddressCellProps) {
  if (!name && !line1 && !line2 && !line3) return <>—</>;
  return (
    <div className="address-cell">
      <AddressCheckBadge
        status={checkStatus}
        message={checkMessage}
        displayLabel={checkDisplayLabel}
        masterMatch={masterMatch}
        successCount={successCount}
        cancelCount={cancelCount}
        cancelSiteLabel={cancelSiteLabel}
      />
      {name ? <span className="address-cell-line address-cell-name">{name}</span> : null}
      {line1 ? <span className="address-cell-line">{line1}</span> : null}
      {line2 ? <span className="address-cell-line">{line2}</span> : null}
      {line3 ? <span className="address-cell-line">{line3}</span> : null}
    </div>
  );
}
