import { carrierLabel } from "../lib/orderEmail/carrier";
import { INCOMING_VISIBLE_ROWS, type IncomingHouse } from "../lib/orderEmail/incoming";

interface IncomingHouseTilesProps {
  houses: IncomingHouse[];
  activeId: string | null;
  onSelect: (orderId: string) => void;
}

export function IncomingHouseTiles({ houses, activeId, onSelect }: IncomingHouseTilesProps) {
  return (
    <div className="orders-incoming-grid">
      {houses.map((house) => {
        const extra = Math.max(0, house.shipments.length - INCOMING_VISIBLE_ROWS);
        return (
          <article key={house.id} className="orders-incoming-tile">
            <header className="orders-incoming-head">
              <h3 title={house.addressLine}>{house.addressLine}</h3>
              <span>{house.shipments.length} on the way</span>
            </header>
            <div className="orders-incoming-cols">
              <span>Tracking</span>
              <span>Site</span>
              <span>Delivery date</span>
            </div>
            <div className="orders-incoming-list">
              <div className="orders-incoming-list-scroll">
                {house.shipments.map((shipment) => (
                  <button
                    key={shipment.orderId}
                    type="button"
                    className={`orders-incoming-row${activeId === shipment.orderId ? " is-active" : ""}`}
                    onClick={() => onSelect(shipment.orderId)}
                  >
                    <span className="orders-incoming-tracking" title={carrierLabel(shipment.carrier) || undefined}>
                      {shipment.tracking}
                    </span>
                    <span className="orders-incoming-site">{shipment.site}</span>
                    <span
                      className={`orders-incoming-eta${shipment.hasDate ? " has-date" : ""}`}
                      title={carrierLabel(shipment.carrier) || undefined}
                    >
                      {shipment.eta}
                    </span>
                  </button>
                ))}
              </div>
            </div>
            {extra > 0 ? <div className="orders-incoming-more">+{extra} more</div> : null}
          </article>
        );
      })}
    </div>
  );
}
