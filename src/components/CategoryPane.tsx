interface CategoryPaneProps {
  totalCount: number;
  masterProfileLabel: string;
  childCount: number;
  activeCategory: "all" | "master";
  onSelectAll: () => void;
  onSelectMaster: () => void;
}

export function CategoryPane({
  totalCount,
  masterProfileLabel,
  childCount,
  activeCategory,
  onSelectAll,
  onSelectMaster,
}: CategoryPaneProps) {
  return (
    <aside className="category-pane">
      <div className="category-pane-header">
        <input className="category-search" placeholder="Search categories" readOnly />
      </div>
      <div className="category-list">
        <button
          type="button"
          className={activeCategory === "all" ? "category-item active" : "category-item"}
          onClick={onSelectAll}
        >
          <span className="category-item-name">All jig profiles</span>
          <span className="category-item-count">{totalCount}</span>
        </button>
        <button
          type="button"
          className={activeCategory === "master" ? "category-item active" : "category-item"}
          onClick={onSelectMaster}
        >
          <span className="category-item-name">{masterProfileLabel}</span>
          <span className="category-item-meta">Master · {childCount} jig(s)</span>
        </button>
      </div>
    </aside>
  );
}
