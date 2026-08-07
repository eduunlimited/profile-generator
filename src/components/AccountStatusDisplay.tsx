import type { AccountReviewStatus } from "../lib/types";

const STATUS_LABELS: Record<AccountReviewStatus, string> = {
  good: "Good",
  not_good: "Not Good",
};

interface AccountStatusDisplayProps {
  status: AccountReviewStatus;
}

export function AccountStatusDisplay({ status }: AccountStatusDisplayProps) {
  const good = status === "good";

  return (
    <span className={`account-status${good ? " account-status-good" : " account-status-not-good"}`}>
      <span className="account-status-icon" aria-hidden="true">
        {good ? (
          <svg className="account-status-svg" viewBox="0 0 12 12" width="8" height="8" aria-hidden="true">
            <path
              d="M2.5 6.2 5.2 8.8 9.5 3.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        ) : (
          <svg className="account-status-svg" viewBox="0 0 12 12" width="8" height="8" aria-hidden="true">
            <path
              d="M3.2 3.2 8.8 8.8 M8.8 3.2 3.2 8.8"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
            />
          </svg>
        )}
      </span>
      {STATUS_LABELS[status]}
    </span>
  );
}

export function accountStatusLabel(status: AccountReviewStatus): string {
  return STATUS_LABELS[status];
}
