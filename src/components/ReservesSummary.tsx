import { useMemo, useState } from 'react';
import { Download } from 'lucide-react';
import type { Marker, Well } from '../types';
import { summarizeZones, buildSummaryCsv } from '../geo/reservesSummary';
import { DEFAULT_PETRO } from '../geo/petrophysics';
import { downloadText } from '../export/download';

interface Props {
  wells: Well[];
  markers: Marker[];
}

const stamp = () => new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
const mln = (x: number) => (x / 1e6).toFixed(2);

/** Field-wide reserves summary: one row per pay zone (adjacent tops) + a total. */
export function ReservesSummary({ wells, markers }: Props) {
  const [useLogs, setUseLogs] = useState(true);
  const [manual, setManual] = useState({ ng: 0.6, phi: 0.2, sw: 0.3 });
  const [bo, setBo] = useState(1.2);
  const [rf, setRf] = useState(0.3);

  const coordWells = useMemo(() => wells.filter((w) => Number.isFinite(w.x) && Number.isFinite(w.y)), [wells]);
  const mappable = useMemo(() => {
    const ids = new Set(coordWells.map((w) => w.id));
    return markers.filter(
      (m) => Object.keys(m.depths).filter((id) => ids.has(id) && Number.isFinite(m.depths[id])).length >= 3,
    );
  }, [markers, coordWells]);

  const summary = useMemo(
    () => summarizeZones(coordWells, mappable, { manual, bo, rf, useLogs, petro: DEFAULT_PETRO }),
    [coordWells, mappable, manual, bo, rf, useLogs],
  );

  if (wells.length === 0) {
    return (
      <div className="placeholder"><div className="pc">
        <h3>Сводка запасов</h3>
        <p>Загрузите скважины и пропикируйте пласты — здесь появится подсчёт запасов по всем объектам.</p>
      </div></div>
    );
  }
  if (coordWells.length < 3 || summary.zones.length === 0) {
    return (
      <div className="placeholder"><div className="pc">
        <h3>Сводка запасов</h3>
        <p>Нужны ≥3 скважины с координатами и ≥2 пласта с общей пикировкой (соседние пласты образуют объект подсчёта).</p>
      </div></div>
    );
  }

  const exportCsv = () => downloadText(`reserves-summary-${stamp()}.csv`, buildSummaryCsv(summary));

  return (
    <div className="rsum">
      <div className="rsum-bar">
        <div className="rsum-title">Сводка запасов · {summary.zones.length} объект(а)</div>
        <div className="vol-src rsum-src">
          <button className={`vol-src-btn ${!useLogs ? 'on' : ''}`} onClick={() => setUseLogs(false)}>Ручные</button>
          <button className={`vol-src-btn ${useLogs ? 'on' : ''}`} onClick={() => setUseLogs(true)}>Из логов</button>
        </div>
        {!useLogs && (
          <>
            <NumIn label="N/G" value={manual.ng} onChange={(v) => setManual({ ...manual, ng: v })} />
            <NumIn label="φ" value={manual.phi} onChange={(v) => setManual({ ...manual, phi: v })} />
            <NumIn label="Sw" value={manual.sw} onChange={(v) => setManual({ ...manual, sw: v })} />
          </>
        )}
        <NumIn label="Bo" value={bo} onChange={setBo} />
        <NumIn label="ККИН" value={rf} onChange={setRf} />
        <button className="rsum-exp" onClick={exportCsv} title="Сводка в CSV">
          <Download size={14} strokeWidth={1.9} /> CSV
        </button>
      </div>

      <div className="rsum-table-wrap">
        <table className="rsum-table">
          <thead>
            <tr>
              <th className="l">Объект</th>
              <th>Скв.</th><th>Площадь, км²</th><th>Ср. толщ., м</th>
              <th>N/G</th><th>φ</th><th>Sw</th>
              <th>STOOIP, млн барр</th><th>Извлек., млн барр</th>
            </tr>
          </thead>
          <tbody>
            {summary.zones.map((z) => (
              <tr key={`${z.topLabel}-${z.baseLabel}`}>
                <td className="l">
                  {z.topLabel}–{z.baseLabel}
                  <span className={`rsum-tag ${z.source}`}>{z.source === 'logs' ? 'логи' : 'ручн.'}</span>
                </td>
                <td>{z.wells}</td>
                <td>{z.areaKm2.toFixed(2)}</td>
                <td>{z.meanThickness.toFixed(1)}</td>
                <td>{z.ng.toFixed(2)}</td>
                <td>{z.phi.toFixed(3)}</td>
                <td>{z.sw.toFixed(2)}</td>
                <td className="accent">{mln(z.stooipBbl)}</td>
                <td className="accent">{mln(z.recoverableBbl)}</td>
              </tr>
            ))}
            <tr className="rsum-total">
              <td className="l">ИТОГО по месторождению</td>
              <td colSpan={5} />
              <td className="accent">{mln(summary.totalStooipBbl)}</td>
              <td className="accent">{mln(summary.totalRecoverableBbl)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div className="rsum-note">
        Объекты — интервалы между соседними кровлями. {useLogs ? 'N/G, φ, Sw из каротажа по зоне; ' : ''}
        интеграл по площади карты, без учёта контакта/замыкания.
      </div>
    </div>
  );
}

function NumIn({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <label className="rsum-in">
      <span>{label}</span>
      <input type="number" step={0.05} min={0} value={value}
        onChange={(e) => { const v = parseFloat(e.target.value); if (Number.isFinite(v)) onChange(v); }} />
    </label>
  );
}
