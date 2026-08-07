interface ProfilesToolbarProps {
  selectedCount: number;
  selectedMasterId: string | null;
  canDeleteMaster: boolean;
  selectedMasterJigCount: number;
  tableQuery: string;
  onTableQueryChange: (value: string) => void;
  canDeleteSelectedCategory: boolean;
  createMasterDisabled?: boolean;
  onCreateMaster: () => void;
  onGenerate: () => void;
  onEdit: () => void;
  onMove: () => void;
  onDelete: () => void;
  onRejig: () => void;
  onAssignCards: () => void;
  onMassDistribute: () => void;
  onExport: () => void;
  onImport: () => void;
  onDeleteCategory: () => void;
}

export function ProfilesToolbar({
  selectedCount,
  selectedMasterId,
  canDeleteMaster,
  selectedMasterJigCount,
  tableQuery,
  onTableQueryChange,
  canDeleteSelectedCategory,
  createMasterDisabled = false,
  onCreateMaster,
  onGenerate,
  onEdit,
  onMove,
  onDelete,
  onRejig,
  onAssignCards,
  onMassDistribute,
  onExport,
  onImport,
  onDeleteCategory,
}: ProfilesToolbarProps) {
  const hasJigSelection = selectedCount > 0;
  const hasMasterSelection = Boolean(selectedMasterId);
  const canEdit = hasMasterSelection || hasJigSelection;
  const canMove = hasJigSelection || (hasMasterSelection && selectedMasterJigCount > 0);
  const canDelete = hasJigSelection || (hasMasterSelection && canDeleteMaster);

  return (
    <div className="profiles-table-toolbar">
      <div className="profiles-toolbar-groups">
        <div className="toolbar-group">
          <button
            type="button"
            className="btn-secondary btn-compact"
            disabled={createMasterDisabled}
            onClick={onCreateMaster}
          >
            Create Master
          </button>
          <button type="button" className="btn-secondary btn-compact" onClick={onGenerate}>
            Generate Jigs
          </button>
        </div>

        <div className="toolbar-group-separator" aria-hidden="true" />

        <div className="toolbar-group">
          <button
            type="button"
            className="btn-secondary btn-compact"
            disabled={!canEdit}
            onClick={onEdit}
          >
            Edit
          </button>
          <button
            type="button"
            className="btn-secondary btn-compact"
            disabled={!canMove}
            onClick={onMove}
          >
            Move
          </button>
          <button
            type="button"
            className="btn-secondary btn-compact ghost-button danger"
            disabled={!canDelete}
            onClick={onDelete}
          >
            Delete
          </button>
          <span className="toolbar-selected">Selected: {selectedCount}</span>
        </div>

        <div className="toolbar-group-separator" aria-hidden="true" />

        <div className="toolbar-group">
          <button
            type="button"
            className="btn-secondary btn-compact"
            disabled={!hasJigSelection}
            onClick={onRejig}
          >
            Re-jig
          </button>
          <button
            type="button"
            className="btn-secondary btn-compact"
            disabled={!hasJigSelection}
            onClick={onAssignCards}
          >
            Assign cards
          </button>
          <button
            type="button"
            className="btn-secondary btn-compact"
            disabled={!hasJigSelection}
            onClick={onMassDistribute}
          >
            Mass distribute
          </button>
        </div>

        <div className="toolbar-group-separator" aria-hidden="true" />

        <div className="toolbar-group">
          <button type="button" className="btn-secondary btn-compact" onClick={onImport}>
            Import
          </button>
          <button type="button" className="btn-secondary btn-compact" onClick={onExport}>
            Export
          </button>
          {canDeleteSelectedCategory ? (
            <button
              type="button"
              className="btn-secondary btn-compact ghost-button danger"
              onClick={onDeleteCategory}
            >
              Delete category
            </button>
          ) : null}
        </div>
      </div>

      <input
        className="table-search profiles-table-search"
        placeholder="Search jig profiles"
        value={tableQuery}
        onChange={(event) => onTableQueryChange(event.target.value)}
      />
    </div>
  );
}
