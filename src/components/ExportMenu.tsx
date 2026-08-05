import { useEffect, useRef, useState, type RefObject } from 'react';
import { Download, Milestone, Layers, Image as ImageIcon } from 'lucide-react';
import { useStore } from '../store';
import { buildTopsCsv } from '../export/tops';
import { buildLithologyCsv } from '../export/lithology';
import { exportCorrelationPng } from '../export/image';
import { downloadText, triggerDownload } from '../export/download';

interface Props {
  bodyRef: RefObject<HTMLElement>;
  depthWindow: [number, number];
}

function stamp(): string {
  return new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
}

export function ExportMenu({ bodyRef, depthWindow }: Props) {
  const wells = useStore((s) => s.wells);
  const markers = useStore((s) => s.markers);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const exportCsv = () => {
    downloadText(`tops-${stamp()}.csv`, buildTopsCsv(markers, wells));
    setOpen(false);
  };

  const exportLithoCsv = () => {
    downloadText(`lithology-${stamp()}.csv`, buildLithologyCsv(wells));
    setOpen(false);
  };

  const hasLithology = wells.some((w) => w.lithology.length > 0);

  const exportPng = () => {
    const url = bodyRef.current && exportCorrelationPng(bodyRef.current, markers, depthWindow);
    if (url) triggerDownload(`correlation-${stamp()}.png`, url);
    setOpen(false);
  };

  return (
    <div className="menu-wrap" ref={ref}>
      <button className="iconbtn" title="Экспорт" onClick={() => setOpen((o) => !o)} disabled={wells.length === 0}>
        <Download size={16} strokeWidth={1.75} />
      </button>
      {open && (
        <div className="menu">
          <button className="menu-item" onClick={exportCsv} disabled={markers.length === 0}>
            <Milestone size={15} strokeWidth={1.75} /> Разбивки (CSV)
          </button>
          <button className="menu-item" onClick={exportLithoCsv} disabled={!hasLithology}>
            <Layers size={15} strokeWidth={1.75} /> Литология (CSV)
          </button>
          <button className="menu-item" onClick={exportPng}>
            <ImageIcon size={15} strokeWidth={1.75} /> Планшет (PNG)
          </button>
        </div>
      )}
    </div>
  );
}
