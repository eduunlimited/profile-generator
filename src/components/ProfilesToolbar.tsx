interface ProfilesToolbarProps {
  selectedCount: number;
  selectedMasterId: string | null;
  canDeleteMaster: boolean;
  selectedMasterJigCount: number;
  tableQuery: string;
  onTableQueryChange: (value: string) => void;
  canDeleteSelectedCategory: boolean;
  canUnassignCards?: boolean;
  createMasterDisabled?: boolean;
  onCreateMaster: () => void;
  onGenerate: () => void;
  onEdit: () => void;
  onMove: () => void;
  onCopy: () => void;
  onDelete: () => void;
  onRejig: () => void;
  onAssignCards: () => void;
  onUnassignCards?: () => void;
  onMassDistribute: () => void;
  onExport: () => void;
  onImport: () => void;
  onDeleteCategory: () => void;
  profileActionsLocked?: boolean;
  generateLocked?: boolean;
}

export function ProfilesToolbar({
  selectedCount,
  selectedMasterId,
  canDeleteMaster,
  selectedMasterJigCount,
  tableQuery,
  onTableQueryChange,
  canDeleteSelectedCategory,
  canUnassignCards = false,
  createMasterDisabled = false,
  onCreateMaster,
  onGenerate,
  onEdit,
  onMove,
  onCopy,
  onDelete,
  onRejig,
  onAssignCards,
  onUnassignCards,
  onMassDistribute,
  onExport,
  onImport,
  onDeleteCategory,
  profileActionsLocked = false,
  generateLocked = false,
}: ProfilesToolbarProps) {
  const hasJigSelection = selectedCount > 0;
  const hasMasterSelection = Boolean(selectedMasterId);
  const canEdit = (hasMasterSelection || hasJigSelection) && !profileActionsLocked;
  const canMove = (hasJigSelection || (hasMasterSelection && selectedMasterJigCount > 0)) && !profileActionsLocked;
  const canDelete = (hasJigSelection || (hasMasterSelection && canDeleteMaster)) && !profileActionsLocked;
  const lockHint = "Unlock the category to change these profiles";

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
          <button
            type="button"
            className="btn-secondary btn-compact"
            disabled={generateLocked}
            title={generateLocked ? "Unlock the category to generate profiles" : undefined}
            onClick={onGenerate}
          >
            Generate Jigs
          </button>
        </div>

        <div className="toolbar-group-separator" aria-hidden="true" />

        <div className="toolbar-group">
          <button
            type="button"
            className="btn-secondary btn-compact"
            disabled={!canEdit}
            title={profileActionsLocked ? lockHint : undefined}
            onClick={onEdit}
          >
            Edit
          </button>
          <button
            type="button"
            className="btn-secondary btn-compact"
            disabled={!canMove}
            title={profileActionsLocked ? lockHint : undefined}
            onClick={onMove}
          >
            Move
          </button>
          <button
            type="button"
            className="btn-secondary btn-compact"
            disabled={!hasJigSelection}
            onClick={onCopy}
          >
            Copy
          </button>
          <button
            type="button"
            className="btn-secondary btn-compact ghost-button danger"
            disabled={!canDelete}
            title={profileActionsLocked ? lockHint : undefined}
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
            disabled={!hasJigSelection || profileActionsLocked}
            title={profileActionsLocked ? lockHint : undefined}
            onClick={onRejig}
          >
            Re-jig
          </button>
          <button
            type="button"
            className="btn-secondary btn-compact"
            disabled={!hasJigSelection || profileActionsLocked}
            title={profileActionsLocked ? lockHint : undefined}
            onClick={onAssignCards}
          >
            Assign cards
          </button>
          <button
            type="button"
            className="btn-secondary btn-compact"
            disabled={!canUnassignCards || profileActionsLocked}
            title={profileActionsLocked ? lockHint : undefined}
            onClick={() => onUnassignCards?.()}
          >
            Unassign cards
          </button>
          <button
            type="button"
            className="btn-secondary btn-compact"
            disabled={!hasJigSelection || profileActionsLocked}
            title={profileActionsLocked ? lockHint : undefined}
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
