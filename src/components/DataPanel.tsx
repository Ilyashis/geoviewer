import { X, ArrowRight, Waves, Milestone, Layers, Activity, Radio, GitBranch, Spline, Mountain } from 'lucide-react';
import type { Marker, Well } from '../types';
import { useStore } from '../store';

interface Props {
  open: boolean;
  onClose: () => void;
  wells: Well[];
  markers: Marker[];
  onActivateWell: (id: string) => void;
  onSelectMarker: (id: string) => void;
  /** Switches the active tab; `focus` additionally asks that view to select
   * one specific item once it's open (`focusRequest` in the framework slice). */
  onShow: (tab: string, focus?: { target: 'seismicLine' | 'section'; id: string }) => void;
}

/**
 * Everything currently loaded or created in the project, in one place —
 * every other view only shows its own slice (faults live in the map's
 * panel, imported lines in the seismic picker, section lines in both), so
 * there was nowhere to see, say, "do I have an untied SEG-Y line lying
 * around" without opening that exact tab. Read-only index, not an editor:
 * each row's "Показать" jumps to the view that already owns that object
 * rather than re-implementing its detail here.
 */
export function DataPanel({ open, onClose, wells, markers, onActivateWell, onSelectMarker, onShow }: Props) {
  const checkshots = useStore((s) => s.checkshots);
  const segyLines = useStore((s) => s.segyLines);
  const faults = useStore((s) => s.faults);
  const sections = useStore((s) => s.sections);
  const seismicHorizons = useStore((s) => s.seismicHorizons);

  if (!open) return null;

  const lithoWells = wells.filter((w) => w.lithology.length > 0).length;
  const horizonRows = Object.entries(seismicHorizons).flatMap(([label, byLine]) =>
    Object.keys(byLine).map((lineId) => ({ label, lineId })));

  return (
    <aside className="datapanel">
      <div className="dp-head">
        <span className="dp-title"><Layers size={15} strokeWidth={1.75} /> Данные проекта</span>
        <button className="dp-x" title="Закрыть" onClick={onClose}><X size={16} strokeWidth={1.75} /></button>
      </div>

      <div className="dp-body">
        <Section icon={<Waves size={14} strokeWidth={1.75} />} title="Скважины" count={wells.length}>
          {wells.map((w) => (
            <Row key={w.id} label={w.name} sub={`${w.curves.length} кривых · ${w.depth.length} отсч.`}
              onShow={() => { onActivateWell(w.id); onShow('correlation'); }} />
          ))}
          {lithoWells > 0 && <div className="dp-note">Литология: {lithoWells} из {wells.length} скв.</div>}
        </Section>

        <Section icon={<Milestone size={14} strokeWidth={1.75} />} title="Разбивки" count={markers.length}>
          {markers.map((m) => {
            const n = Object.values(m.depths).filter(Number.isFinite).length;
            const seeded = m.seeded?.length ?? 0;
            return (
              <Row key={m.id} dot={m.color} label={m.label}
                sub={`${n} пикетов${seeded ? ` · ${seeded} затравлено` : ''}`}
                onShow={() => { onSelectMarker(m.id); onShow('correlation'); }} />
            );
          })}
        </Section>

        <Section icon={<Activity size={14} strokeWidth={1.75} />} title="Чекшоты" count={checkshots.length}>
          {checkshots.map((c) => (
            <Row key={c.well} label={c.well} sub={`${c.points.length} пар`} onShow={() => onShow('seismic')} />
          ))}
        </Section>

        <Section icon={<Radio size={14} strokeWidth={1.75} />} title="Импортированные линии (SEG-Y)" count={segyLines.length}>
          {segyLines.map((l) => (
            <Row key={l.id} label={l.label} sub={`${l.traceCount} трасс · ${l.tie ? 'привязана' : 'не привязана'}`}
              warn={!l.tie}
              onShow={() => onShow('seismic', { target: 'seismicLine', id: l.id })} />
          ))}
        </Section>

        <Section icon={<GitBranch size={14} strokeWidth={1.75} />} title="Разломы" count={faults.length}>
          {faults.map((f) => (
            <Row key={f.id} label={f.label}
              sub={`сечёт ${f.markerIds.length} пласт.${f.dip != null ? ` · падение ${f.dip}°` : ''}`}
              onShow={() => onShow('map')} />
          ))}
        </Section>

        <Section icon={<Spline size={14} strokeWidth={1.75} />} title="Линии разреза" count={sections.length}>
          {sections.map((s) => (
            <Row key={s.id} label={s.label} sub={`${s.points.length} точек`}
              onShow={() => onShow('section', { target: 'section', id: s.id })} />
          ))}
        </Section>

        <Section icon={<Mountain size={14} strokeWidth={1.75} />} title="Сейсмогоризонты в карте" count={horizonRows.length}>
          {horizonRows.map((h) => (
            <Row key={`${h.label}-${h.lineId}`} label={h.label} sub={`линия ${h.lineId}`}
              onShow={() => onShow('seismic', { target: 'seismicLine', id: h.lineId })} />
          ))}
        </Section>
      </div>
    </aside>
  );
}

function Section({ icon, title, count, children }: { icon: React.ReactNode; title: string; count: number; children: React.ReactNode }) {
  return (
    <section className="dp-section">
      <div className="dp-section-h">{icon}<span>{title}</span><span className="dp-count">{count}</span></div>
      {count === 0 ? <div className="dp-empty">нет</div> : <div className="dp-rows">{children}</div>}
    </section>
  );
}

function Row({ label, sub, dot, warn, onShow }: { label: string; sub: string; dot?: string; warn?: boolean; onShow: () => void }) {
  return (
    <div className="dp-row">
      {dot && <span className="dp-dot" style={{ background: dot }} />}
      <div className="dp-row-text">
        <div className="dp-row-label">{label}</div>
        <div className={`dp-row-sub ${warn ? 'warn' : ''}`}>{sub}</div>
      </div>
      <button className="dp-show" title="Показать" onClick={onShow}><ArrowRight size={13} strokeWidth={1.75} /></button>
    </div>
  );
}
