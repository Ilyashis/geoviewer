import { useEffect, useRef, useState, type RefObject } from 'react';
import { Download, Milestone, Layers, Image as ImageIcon, FileText, Route, GitBranch } from 'lucide-react';
import { useStore } from '../store';
import { buildTopsCsv } from '../export/tops';
import { buildLithologyCsv } from '../export/lithology';
import { buildDevFile } from '../export/dev';
import { buildFaultsCsv } from '../export/faults';
import { exportCorrelationPng, exportCorrelationJpeg } from '../export/image';
import { jpegToPdf } from '../export/pdf';
import { downloadText, triggerDownload } from '../export/download';
import { metricWells } from '../wells/coords';

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
  const faults = useStore((s) => s.faults);
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

  const exportFaultsCsv = () => {
    downloadText(`faults-${stamp()}.csv`, buildFaultsCsv(faults, markers));
    setOpen(false);
  };

  const coordWells = metricWells(wells).filter((w) => Number.isFinite(w.x) && Number.isFinite(w.y));
  const exportDev = () => {
    // One file per well — that's what .dev is — so stagger the downloads a
    // little; firing a dozen at once in one tick loses some of them.
    coordWells.forEach((w, i) => {
      setTimeout(() => downloadText(`${w.name}.dev`, buildDevFile(w), 'text/plain'), i * 150);
    });
    setOpen(false);
  };

  const exportPng = () => {
    const url = bodyRef.current && exportCorrelationPng(bodyRef.current, markers, depthWindow);
    if (url) triggerDownload(`correlation-${stamp()}.png`, url);
    setOpen(false);
  };

  const exportPdf = () => {
    const img = bodyRef.current && exportCorrelationJpeg(bodyRef.current, markers, depthWindow);
    if (img) {
      const url = URL.createObjectURL(jpegToPdf(img.dataUrl, img.width, img.height));
      triggerDownload(`correlation-${stamp()}.pdf`, url, true);
    }
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
          <button className="menu-item" onClick={exportFaultsCsv} disabled={faults.length === 0}>
            <GitBranch size={15} strokeWidth={1.75} /> Разломы (CSV)
          </button>
          <button className="menu-item" onClick={exportDev} disabled={coordWells.length === 0} title="Petrel-совместимый .dev на каждую скважину с координатами">
            <Route size={15} strokeWidth={1.75} /> Траектории (.dev)
          </button>
          <button className="menu-item" onClick={exportPng}>
            <ImageIcon size={15} strokeWidth={1.75} /> Планшет (PNG)
          </button>
          <button className="menu-item" onClick={exportPdf}>
            <FileText size={15} strokeWidth={1.75} /> Планшет (PDF)
          </button>
        </div>
      )}
    </div>
  );
}
