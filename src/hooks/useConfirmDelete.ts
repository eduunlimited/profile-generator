import { useState } from "react";

export interface ConfirmDeleteRequest {
  title: string;
  message: string;
  confirmLabel?: string;
  onConfirm: () => Promise<void> | void;
}

export function useConfirmDelete() {
  const [pending, setPending] = useState<ConfirmDeleteRequest | null>(null);
  const [busy, setBusy] = useState(false);

  const askConfirm = (request: ConfirmDeleteRequest) => {
    setPending(request);
  };

  const closeConfirm = () => {
    if (!busy) {
      setPending(null);
    }
  };

  const acceptConfirm = async () => {
    if (!pending || busy) return;
    setBusy(true);
    try {
      await pending.onConfirm();
      setPending(null);
    } finally {
      setBusy(false);
    }
  };

  return {
    pending,
    busy,
    askConfirm,
    closeConfirm,
    acceptConfirm,
  };
}
