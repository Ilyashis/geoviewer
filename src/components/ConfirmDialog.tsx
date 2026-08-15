import { AlertTriangle } from 'lucide-react';

interface Props {
  title: string;
  message: string;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Every destructive action in the app (clear project, delete a project, a
 * well, a marker, a fault, a section line) used to fire on a single
 * unguarded click, autosaved within 500ms — a misclick was permanent. This
 * is the one shared confirmation surface for all of them, reusing the same
 * `.modal-scrim`/`.modal` chrome the import dialog already established
 * rather than a native `confirm()` that would look foreign next to it.
 */
export function ConfirmDialog({ title, message, confirmLabel = 'Удалить', onConfirm, onCancel }: Props) {
  return (
    <div className="modal-scrim" onMouseDown={onCancel}>
      <div className="modal confirm-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span className="modal-title"><AlertTriangle size={16} strokeWidth={1.75} /> {title}</span>
        </div>
        <p className="modal-hint">{message}</p>
        <div className="modal-actions">
          <span style={{ flex: 1 }} />
          <button className="btn ghost" onClick={onCancel}>Отмена</button>
          <button className="btn danger" onClick={onConfirm} autoFocus>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}
