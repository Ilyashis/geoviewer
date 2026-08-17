import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Search } from 'lucide-react';

export interface SurfaceOption {
  id: string;
  label: string;
  color?: string;
}

interface Props {
  label: string;
  options: SurfaceOption[];
  value: string | undefined;
  onChange: (id: string) => void;
  disabled?: boolean;
}

/**
 * Above this many options the inline buttons become the problem rather than the
 * affordance. A real project carried 48 mappable surfaces: as buttons they made
 * the floating map panel 998 x 264 px — two thirds of the width and a third of
 * the height of the very map they sit on — and the seismic panel was worse,
 * a full-width band over the section. Below the threshold buttons still win:
 * three of them are one click, where a dropdown is two.
 */
const INLINE_MAX = 6;

export function SurfacePicker({ label, options, value, onChange, disabled }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [rect, setRect] = useState<DOMRect | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  const current = options.find((o) => o.id === value);

  // Close on outside click or Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (btnRef.current?.contains(t) || popRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // The popover is portalled to <body>: every floating panel here uses
  // backdrop-filter, which makes it the containing block for fixed children —
  // a dropdown rendered inside would be clipped by the panel it opens from.
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

  if (options.length <= INLINE_MAX) {
    return (
      <div className="map-surf-row">
        <span className="map-row-label">{label}</span>
        {options.map((o) => (
          <button key={o.id} className={`map-surf ${o.id === value ? 'on' : ''}`}
            disabled={disabled} onClick={() => onChange(o.id)}>
            {o.color && <span className="map-surf-dot" style={{ background: o.color }} />}{o.label}
          </button>
        ))}
      </div>
    );
  }

  const q = query.trim().toLowerCase();
  const filtered = q ? options.filter((o) => o.label.toLowerCase().includes(q)) : options;

  // Flip above the button when there isn't room below.
  const below = rect ? window.innerHeight - rect.bottom : 0;
  const flipUp = rect != null && below < 260 && rect.top > below;

  return (
    <div className="map-surf-row">
      <span className="map-row-label">{label}</span>
      <button ref={btnRef} className={`picker-btn ${open ? 'on' : ''}`} disabled={disabled}
        onClick={() => { setOpen((v) => !v); setQuery(''); }}>
        {current?.color && <span className="map-surf-dot" style={{ background: current.color }} />}
        <span className="picker-val">{current?.label ?? '— выбрать —'}</span>
        <span className="picker-count">{options.length}</span>
        <ChevronDown size={13} strokeWidth={1.75} />
      </button>

      {open && rect && createPortal(
        <div ref={popRef} className="picker-pop" style={{
          left: Math.min(rect.left, window.innerWidth - 268),
          ...(flipUp ? { bottom: window.innerHeight - rect.top + 6 } : { top: rect.bottom + 6 }),
        }}>
          <div className="picker-search">
            <Search size={13} strokeWidth={1.75} />
            <input autoFocus value={query} placeholder="Поиск пласта…"
              onChange={(e) => setQuery(e.target.value)} />
          </div>
          <div className="picker-list">
            {filtered.map((o) => (
              <button key={o.id} className={`picker-item ${o.id === value ? 'on' : ''}`}
                onClick={() => { onChange(o.id); setOpen(false); }}>
                {o.color && <span className="map-surf-dot" style={{ background: o.color }} />}
                <span className="picker-item-label">{o.label}</span>
              </button>
            ))}
            {filtered.length === 0 && <div className="picker-empty">Ничего не найдено</div>}
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
