import type { ProfileOpportunity, ProfileOpportunityId } from "../lib/profileOpportunities";

interface ProfileOpportunitiesProps {
  opportunities: ProfileOpportunity[];
  activeOpportunityId: ProfileOpportunityId | null;
  onSelect: (opportunityId: ProfileOpportunityId | null) => void;
}

export function ProfileOpportunities({
  opportunities,
  activeOpportunityId,
  onSelect,
}: ProfileOpportunitiesProps) {
  if (opportunities.length === 0) {
    return null;
  }

  return (
    <div className="profile-opportunities">
      <p className="profile-opportunities-title">Opportunities</p>
      <ul className="profile-opportunities-list">
        {opportunities.map((opportunity) => {
          const active = activeOpportunityId === opportunity.id;
          const buttonText =
            opportunity.id === "unused-cards"
              ? opportunity.label
              : `${opportunity.label} · ${opportunity.count} profile${opportunity.count === 1 ? "" : "s"}`;

          return (
            <li key={opportunity.id}>
              <button
                type="button"
                className={`profile-opportunity-btn${active ? " active" : ""}`}
                aria-pressed={active}
                onClick={() => onSelect(active ? null : opportunity.id)}
              >
                {buttonText}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
