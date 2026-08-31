import { useRef } from "react";
import { addressCheckLabel, addressMasterMatchLabel } from "../lib/addressCheck";
import { applyExcelListSelection } from "../lib/listSelection";
import type { ProfileSummary } from "../lib/types";
import { BillingAddressCell } from "./BillingAddressCell";
import { CardProfileCell } from "./CardBrandIcon";
import { RowCheckbox } from "./ui";

interface ProfilesTableProps {
  profiles: ProfileSummary[];
  selectedIds: string[];
  focusedId: string | null;
  query: string;
  onQueryChange: (query: string) => void;
  onSelectedIdsChange: (updater: (current: string[]) => string[]) => void;
  onFocusProfile: (id: string) => void;
}

export function ProfilesTable({
  profiles,
  selectedIds,
  focusedId,
  query,
  onQueryChange,
  onSelectedIdsChange,
  onFocusProfile,
}: ProfilesTableProps) {
  const anchorIndexRef = useRef<number | null>(null);

  const filtered = profiles.filter((profile) => {
    const haystack = [
      profile.name,
      profile.billingFullName,
      profile.billingEmail,
      profile.billingPhone,
      profile.billingAddressLine1,
      profile.billingAddressLine2,
      profile.billingAddressLine3,
      profile.creditCardLabel,
      profile.cardNumberMasked,
      profile.accounts,
      addressCheckLabel(profile.addressCheckStatus),
      addressMasterMatchLabel(profile.addressMasterMatch),
    ]
      .join(" ")
      .toLowerCase();
    return haystack.includes(query.toLowerCase());
  });

  const orderedIds = filtered.map((profile) => profile.id);
  const allSelected = filtered.length > 0 && filtered.every((profile) => selectedIds.includes(profile.id));

  const applySelection = (
    event: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean },
    id: string,
    index: number,
  ) => {
    onSelectedIdsChange((current) => {
      const result = applyExcelListSelection(
        current,
        anchorIndexRef.current,
        index,
        id,
        orderedIds,
        event,
      );
      anchorIndexRef.current = result.anchorIndex;
      return result.selectedIds;
    });
  };

  const handleRowClick = (
    event: React.MouseEvent,
    id: string,
    index: number,
  ) => {
    if ((event.target as HTMLElement).closest(".row-checkbox")) return;
    applySelection(event, id, index);
    onFocusProfile(id);
  };

  return (
    <div className="profiles-table-wrap">
      <div className="table-toolbar">
        <input
          className="table-search"
          placeholder="Search profiles"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
        />
        <span className="muted table-selection-hint">
          Click row to select · Shift range · Ctrl toggle · Ctrl+Shift add range
        </span>
      </div>
      <div className="table-scroll">
        <table className="profiles-table">
          <thead>
            <tr>
              <th className="col-check">
                <RowCheckbox
                  checked={allSelected}
                  aria-label="Select all profiles"
                  onClick={() => {
                    onSelectedIdsChange(() =>
                      allSelected ? [] : filtered.map((profile) => profile.id),
                    );
                    anchorIndexRef.current = null;
                  }}
                />
              </th>
              <th className="col-index">#</th>
              <th>Profile Name</th>
              <th>Billing Full Name</th>
              <th>Billing Email</th>
              <th>Phone</th>
              <th>Billing Full Address</th>
              <th>Card Profile</th>
              <th>Accounts</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={9} className="table-empty">
                  No jig profiles yet. Edit the master, then use Generate on the toolbar.
                </td>
              </tr>
            ) : (
              filtered.map((profile, index) => {
                const selected = selectedIds.includes(profile.id);
                const focused = focusedId === profile.id;
                return (
                  <tr
                    key={profile.id}
                    className={focused ? "row-focused" : selected ? "row-selected" : undefined}
                    onClick={(event) => handleRowClick(event, profile.id, index)}
                  >
                    <td className="col-check">
                      <RowCheckbox
                        checked={selected}
                        aria-label={`Select profile ${profile.name || index + 1}`}
                        onClick={(event) => {
                          applySelection(event, profile.id, index);
                          onFocusProfile(profile.id);
                        }}
                      />
                    </td>
                    <td className="col-index">{index + 1}</td>
                    <td>{profile.name || "—"}</td>
                    <td>{profile.billingFullName || "—"}</td>
                    <td className="col-email">{profile.billingEmail || "—"}</td>
                    <td className="col-phone">{profile.billingPhone || "—"}</td>
                    <td className="col-address">
                      <BillingAddressCell
                        line1={profile.billingAddressLine1}
                        line2={profile.billingAddressLine2}
                        line3={profile.billingAddressLine3}
                        checkStatus={profile.addressCheckStatus}
                        checkMessage={profile.addressCheckMessage}
                        checkDisplayLabel={profile.addressCheckDisplayLabel}
                        masterMatch={profile.addressMasterMatch}
                      />
                    </td>
                    <td className="col-card-profile">
                      <CardProfileCell
                        profileName={profile.creditCardLabel}
                        brand={profile.cardBrand}
                        lastFour={profile.cardNumberMasked || profile.paymentNumber}
                      />
                    </td>
                    <td>{profile.accounts}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
