import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { FolderOpen, ChevronDown, Plus, Pencil, Trash2, Check } from 'lucide-react';
import type { ProjectMeta } from '../persistence';
import { useConfirm } from '../hooks/useConfirm';

interface Props {
  name: string;
  projects: ProjectMeta[];
  currentId: string | null;
  onSwitch: (id: string) => void;
  onCreate: () => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
}

export function ProjectMenu({ name, projects, currentId, onSwitch, onCreate, onRename, onDelete }: Props) {
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [rect, setRect] = useState<DOMRect | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const { confirm, dialog } = useConfirm();

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (btnRef.current?.contains(t) || popRef.current?.contains(t)) return;
      setOpen(false); setEditingId(null);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  // Portalled to <body> — see the .menu CSS comment for why: .topbar's
  // horizontal-scroll overflow silently clips a non-portalled dropdown here.
  useLayoutEffect(() => {
    if (!open) return;
    const measure = () => setRect(btnRef.current?.getBoundingClientRect() ?? null);
    measure();
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [open]);

  const sorted = [...projects].sort((a, b) => b.updatedAt - a.updatedAt);

  const startRename = (p: ProjectMeta) => { setEditingId(p.id); setDraft(p.name); };
  const commitRename = () => {
    if (editingId && draft.trim()) onRename(editingId, draft.trim());
    setEditingId(null);
  };

  const menuStyle = rect ? {
    top: rect.bottom + 6,
    left: Math.max(8, Math.min(rect.left, window.innerWidth - 248)),
  } : undefined;

  return (
    <div className="doc-wrap">
      <button ref={btnRef} className="doc" onClick={() => setOpen((o) => !o)}>
        <FolderOpen size={14} strokeWidth={1.75} />
        <span className="doc-name">{name}</span>
        <ChevronDown size={14} strokeWidth={1.75} />
      </button>

      {open && rect && createPortal(
        <div className="menu proj-menu" ref={popRef} style={menuStyle}>
          <div className="proj-head">Проекты</div>
          {sorted.map((p) => (
            <div key={p.id} className={`proj-row ${p.id === currentId ? 'on' : ''}`}>
              {editingId === p.id ? (
                <input
                  className="proj-edit"
                  autoFocus
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') setEditingId(null); }}
                  onBlur={commitRename}
                />
              ) : (
                <button className="proj-name" onClick={() => { onSwitch(p.id); setOpen(false); }}>
                  <Check size={14} strokeWidth={2} className="proj-check" style={{ opacity: p.id === currentId ? 1 : 0 }} />
                  {p.name}
                </button>
              )}
              {editingId !== p.id && (
                <span className="proj-actions">
                  <button className="proj-ic" title="Переименовать" onClick={() => startRename(p)}>
                    <Pencil size={13} strokeWidth={1.75} />
                  </button>
                  <button
                    className="proj-ic danger"
                    title="Удалить проект"
                    onClick={() => {
                      setOpen(false);
                      confirm({
                        title: `Удалить проект «${p.name}»?`,
                        message: 'Все скважины, разбивки и остальные данные этого проекта будут удалены без возможности восстановления.',
                        onConfirm: () => onDelete(p.id),
                      });
                    }}
                  >
                    <Trash2 size={13} strokeWidth={1.75} />
                  </button>
                </span>
              )}
            </div>
          ))}
          <button className="menu-item proj-new" onClick={() => { onCreate(); setOpen(false); }}>
            <Plus size={15} strokeWidth={1.9} /> Новый проект
          </button>
        </div>,
        document.body,
      )}
      {dialog}
    </div>
  );
}
