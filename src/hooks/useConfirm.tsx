import { useCallback, useState } from 'react';
import { ConfirmDialog } from '../components/ConfirmDialog';

interface PendingConfirm {
  title: string;
  message: string;
  confirmLabel?: string;
  onConfirm: () => void;
}

/**
 * Arms a confirmation for the next destructive click instead of firing it
 * immediately: `confirm({ title, message, onConfirm })` from a button's
 * onClick, render `{dialog}` once near the component's root. One pending
 * confirmation at a time, scoped to wherever this is called — a well
 * plate's delete doesn't need to know about a marker's.
 */
export function useConfirm() {
  const [pending, setPending] = useState<PendingConfirm | null>(null);

  // Stable identity — safe to put in a useEffect's dependency array (the
  // keyboard-shortcut delete path needs to, since it captures fresh store
  // state via getState() rather than closing over reactive props).
  const confirm = useCallback((opts: PendingConfirm) => setPending(opts), []);

  const dialog = pending ? (
    <ConfirmDialog
      title={pending.title}
      message={pending.message}
      confirmLabel={pending.confirmLabel}
      onConfirm={() => { pending.onConfirm(); setPending(null); }}
      onCancel={() => setPending(null)}
    />
  ) : null;

  return { confirm, dialog };
}
