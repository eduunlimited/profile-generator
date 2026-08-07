import type { AppTab } from "../lib/types";

const NAV_ITEMS: { id: AppTab; label: string; icon: string }[] = [
  { id: "profiles", label: "Profiles", icon: "◫" },
  { id: "cards", label: "Cards", icon: "💳" },
  { id: "credentials", label: "Accounts", icon: "🔑" },
  { id: "jigs", label: "Jigs", icon: "⌘" },
];

interface AppNavProps {
  activeTab: AppTab;
  onTabChange: (tab: AppTab) => void;
}

export function AppNav({ activeTab, onTabChange }: AppNavProps) {
  return (
    <nav className="app-nav">
      <div className="app-nav-logo" title="Profile Generator">
        <span className="app-nav-logo-icon">⚙</span>
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
        <span className="app-nav-version">v0.1</span>
      </div>
    </nav>
  );
}
