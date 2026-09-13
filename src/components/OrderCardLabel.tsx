import { formatOrderCardDisplay } from "../lib/orderEmail";
import type { CreditCard, ParsedOrder, ProfileSummary } from "../lib/types";

interface OrderCardLabelProps {
  order: ParsedOrder;
  cards: CreditCard[];
  profiles?: ProfileSummary[];
  fallback?: string;
}

export function OrderCardLabel({ order, cards, profiles = [], fallback = "" }: OrderCardLabelProps) {
  const display = formatOrderCardDisplay(order, cards, profiles, fallback);
  if (!display.primary) return "—";
  if (!display.secondary) return display.primary;
  return (
    <div className="address-cell">
      <span className="address-cell-line">{display.primary}</span>
      <span className="address-cell-line is-card-brand">{display.secondary}</span>
    </div>
  );
}
