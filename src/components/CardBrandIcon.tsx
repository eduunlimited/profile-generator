import { normalizeCardBrand, type CardBrandKind } from "../lib/creditCardUtils";

interface CardBrandIconProps {
  brand: string;
  size?: "sm" | "md";
  showLabel?: boolean;
}

function BrandMark({ kind }: { kind: CardBrandKind }) {
  switch (kind) {
    case "visa":
      return (
        <svg viewBox="0 0 40 24" aria-hidden="true">
          <rect width="40" height="24" rx="3" fill="#1a1f71" />
          <text x="20" y="16" textAnchor="middle" fill="#ffffff" fontSize="10" fontWeight="700" fontFamily="Arial, sans-serif">
            VISA
          </text>
        </svg>
      );
    case "mastercard":
      return (
        <svg viewBox="0 0 40 24" aria-hidden="true">
          <rect width="40" height="24" rx="3" fill="#141413" />
          <circle cx="16" cy="12" r="7" fill="#eb001b" />
          <circle cx="24" cy="12" r="7" fill="#f79e1b" fillOpacity="0.95" />
        </svg>
      );
    case "amex":
      return (
        <svg viewBox="0 0 40 24" aria-hidden="true">
          <rect width="40" height="24" rx="3" fill="#006fcf" />
          <text x="20" y="15" textAnchor="middle" fill="#ffffff" fontSize="7.5" fontWeight="700" fontFamily="Arial, sans-serif">
            AMEX
          </text>
        </svg>
      );
    case "discover":
      return (
        <svg viewBox="0 0 40 24" aria-hidden="true">
          <rect width="40" height="24" rx="3" fill="#101820" />
          <circle cx="30" cy="12" r="6" fill="#ff6000" />
          <text x="14" y="15" textAnchor="middle" fill="#ffffff" fontSize="6.5" fontWeight="700" fontFamily="Arial, sans-serif">
            DISC
          </text>
        </svg>
      );
    default:
      return (
        <svg viewBox="0 0 40 24" aria-hidden="true">
          <rect width="40" height="24" rx="3" fill="#2a3140" stroke="#4b5563" />
          <text x="20" y="15" textAnchor="middle" fill="#9ca3af" fontSize="8" fontWeight="600" fontFamily="Arial, sans-serif">
            CARD
          </text>
        </svg>
      );
  }
}

export function CardBrandIcon({ brand, size = "md", showLabel = false }: CardBrandIconProps) {
  const kind = normalizeCardBrand(brand);
  return (
    <span className={`card-brand-icon card-brand-icon--${kind} card-brand-icon--${size}`} title={brand || "Card"}>
      <BrandMark kind={kind} />
      {showLabel && brand ? <span className="card-brand-icon-label">{brand}</span> : null}
    </span>
  );
}

interface CardProfileCellProps {
  profileName?: string;
  brand?: string;
  lastFour?: string;
}

function cardLastFour(value?: string): string {
  const digits = (value ?? "").replace(/\D/g, "");
  return digits.length >= 4 ? digits.slice(-4) : digits;
}

export function CardProfileCell({ profileName, brand, lastFour }: CardProfileCellProps) {
  const name = profileName?.trim() ?? "";
  const digits = cardLastFour(lastFour);
  if (!name && !digits) {
    return <>—</>;
  }
  return (
    <div className="card-profile-cell">
      <div className="card-profile-main">
        {brand?.trim() ? <CardBrandIcon brand={brand} size="sm" /> : null}
        {name ? <span className="card-profile-name">{name}</span> : null}
      </div>
      {digits ? <span className="card-profile-last4">{digits}</span> : null}
    </div>
  );
}
