import { useEffect, useRef, useState } from "react";

interface RenameableCategoryNameProps {
  name: string;
  disabled?: boolean;
  onRename: (nextName: string) => Promise<void>;
}

export function RenameableCategoryName({ name, disabled = false, onRename }: RenameableCategoryNameProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const skipBlurCommitRef = useRef(false);

  useEffect(() => {
    if (!editing) {
      setDraft(name);
    }
  }, [editing, name]);

  useEffect(() => {
    if (!editing) return;
    skipBlurCommitRef.current = true;
    const frame = window.requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
      window.requestAnimationFrame(() => {
        skipBlurCommitRef.current = false;
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [editing]);

  const cancel = () => {
    setDraft(name);
    setEditing(false);
  };

  const commit = async () => {
    if (busy || skipBlurCommitRef.current) return;
    const nextName = draft.trim();
    if (!nextName || nextName === name) {
      setDraft(name);
      setEditing(false);
      return;
    }
    setBusy(true);
    try {
      await onRename(nextName);
      setEditing(false);
    } catch {
      setDraft(name);
      setEditing(false);
    } finally {
      setBusy(false);
    }
  };

  if (editing && !disabled) {
    return (
      <input
        ref={inputRef}
        className="accounts-category-rename-input"
        value={draft}
        aria-label="Category name"
        onChange={(event) => setDraft(event.target.value)}
        onClick={(event) => event.stopPropagation()}
        onDoubleClick={(event) => event.stopPropagation()}
        onMouseDown={(event) => event.stopPropagation()}
        onBlur={() => void commit()}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === "Enter") {
            event.preventDefault();
            void commit();
          }
          if (event.key === "Escape") {
            event.preventDefault();
            cancel();
          }
        }}
      />
    );
  }

  return (
    <span
      className="accounts-category-name"
      title={disabled ? undefined : "Double-click to rename"}
      onDoubleClick={(event) => {
        if (disabled) return;
        event.stopPropagation();
        event.preventDefault();
        setEditing(true);
      }}
    >
      {name}
    </span>
  );
}
