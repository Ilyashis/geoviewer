import { useEffect, useRef, useState } from 'react';
import { FolderOpen, ChevronDown, Plus, Pencil, Trash2, Check } from 'lucide-react';
import type { ProjectMeta } from '../persistence';

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
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) { setOpen(false); setEditingId(null); }
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const sorted = [...projects].sort((a, b) => b.updatedAt - a.updatedAt);

  const startRename = (p: ProjectMeta) => { setEditingId(p.id); setDraft(p.name); };
  const commitRename = () => {
    if (editingId && draft.trim()) onRename(editingId, draft.trim());
    setEditingId(null);
  };

  return (
    <div className="doc-wrap" ref={ref}>
      <button className="doc" onClick={() => setOpen((o) => !o)}>
        <FolderOpen size={14} strokeWidth={1.75} />
        <span className="doc-name">{name}</span>
        <ChevronDown size={14} strokeWidth={1.75} />
      </button>

      {open && (
        <div className="menu proj-menu">
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
                    onClick={() => onDelete(p.id)}
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
        </div>
      )}
    </div>
  );
}
