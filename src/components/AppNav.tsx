import type { AppTab } from "../lib/types";
import { APP_VERSION } from "../lib/appVersion";
import { EpgsAppIcon } from "./EpgsBrand";

const NAV_ITEMS: { id: AppTab; label: string; icon: string }[] = [
  { id: "profiles", label: "Profiles", icon: "◫" },
  { id: "sessions", label: "Sessions", icon: "🌐" },
  { id: "cards", label: "Cards", icon: "💳" },
  { id: "emails", label: "Emails", icon: "@" },
  { id: "credentials", label: "Accounts", icon: "🔑" },
  { id: "mail", label: "Mail", icon: "✉" },
  { id: "jigs", label: "Jigs", icon: "⌘" },
];

interface AppNavProps {
  activeTab: AppTab;
  onTabChange: (tab: AppTab) => void;
}

export function AppNav({ activeTab, onTabChange }: AppNavProps) {
  return (
    <nav className="app-nav">
      <div className="app-nav-logo" title="EPGS — Easy Profile Generator Software">
        <EpgsAppIcon size={34} className="app-nav-logo-icon" />
      </div>
      <div className="app-nav-items">
        {NAV_ITEMS.map((item) => (
          <button
            key={item.id}
            type="button"
            className={activeTab === item.id ? "nav-item active" : "nav-item"}
            onClick={() => onTabChange(item.id)}
            title={item.label}
          >
            <span className="nav-item-icon">{item.icon}</span>
            <span className="nav-item-label">{item.label}</span>
          </button>
        ))}
      </div>
      <div className="app-nav-footer">
        <span className="app-nav-version">{APP_VERSION}</span>
      </div>
    </nav>
  );
}
