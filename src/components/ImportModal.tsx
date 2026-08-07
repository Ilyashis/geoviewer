import { useRef, useState } from 'react';
import { X, Upload, Milestone, Layers, Spline } from 'lucide-react';
import { useStore } from '../store';
import { parseTopsCsv } from '../tops/csv';
import { parseLithologyCsv } from '../lithology/csv';
import { parseSurveyCsv } from '../survey/csv';

type Kind = 'tops' | 'litho' | 'survey';

interface Props {
  onClose: () => void;
}

const PLACEHOLDER: Record<Kind, string> = {
  tops: `Well,Surface,MD
UT-1058,Top A,2048
UT-1058,KP S8,2096
UT-1059,Top A,2055`,
  litho: `Well,Top,Base,Lithology,Saturation
UT-1058,2000,2012,Sandstone,Oil
UT-1058,2012,2020,Shale,
UT-1058,2020,2035,Limestone,Water`,
  survey: `Well,MD,Inc,Azi
UT-1059,0,0,97
UT-1059,1600,0,97
UT-1059,2200,34,97
UT-1059,3200,34,97`,
};

export function ImportModal({ onClose }: Props) {
  const wells = useStore((s) => s.wells);
  const importTops = useStore((s) => s.importTops);
  const importLithology = useStore((s) => s.importLithology);
  const importSurveys = useStore((s) => s.importSurveys);
  const [kind, setKind] = useState<Kind>('tops');
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const [warn, setWarn] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const reset = () => { setError(null); setSummary(null); setWarn(null); };

  const run = () => {
    reset();
    try {
      if (kind === 'tops') {
        const { rows } = parseTopsCsv(text);
        if (rows.length === 0) { setError('Нет валидных строк с пикировками.'); return; }
        const r = importTops(rows);
        setSummary(`Импортировано: ${r.surfaces} пластов, ${r.picks} пикировок.`);
        if (r.unmatchedWells.length) setWarn(`Не найдены скважины: ${r.unmatchedWells.join(', ')}`);
      } else if (kind === 'litho') {
        const { rows } = parseLithologyCsv(text);
        if (rows.length === 0) { setError('Нет валидных строк с интервалами.'); return; }
        const r = importLithology(rows);
        setSummary(`Импортировано: ${r.intervals} интервалов в ${r.wells} скважин.`);
        if (r.unmatchedWells.length) setWarn(`Не найдены скважины: ${r.unmatchedWells.join(', ')}`);
      } else {
        const { rows } = parseSurveyCsv(text);
        if (rows.length === 0) { setError('Нет валидных строк со станциями.'); return; }
        const r = importSurveys(rows);
        setSummary(`Импортировано: ${r.stations} станций в ${r.wells} скважин.`);
        if (r.unmatchedWells.length) setWarn(`Не найдены скважины: ${r.unmatchedWells.join(', ')}`);
      }
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="modal-scrim" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span className="modal-title"><Upload size={16} strokeWidth={1.75} /> Импорт из CSV</span>
          <button className="insp-x" onClick={onClose}><X size={16} strokeWidth={1.75} /></button>
        </div>

        <div className="seg">
          <button className={`seg-btn ${kind === 'tops' ? 'on' : ''}`} onClick={() => { setKind('tops'); reset(); }}>
            <Milestone size={14} strokeWidth={1.75} /> Разбивки
          </button>
          <button className={`seg-btn ${kind === 'litho' ? 'on' : ''}`} onClick={() => { setKind('litho'); reset(); }}>
            <Layers size={14} strokeWidth={1.75} /> Литология
          </button>
          <button className={`seg-btn ${kind === 'survey' ? 'on' : ''}`} onClick={() => { setKind('survey'); reset(); }}>
            <Spline size={14} strokeWidth={1.75} /> Инклинометрия
          </button>
        </div>

        {wells.length === 0 ? (
          <p className="modal-hint">Сначала загрузите скважины — данные привязываются к ним по имени.</p>
        ) : kind === 'tops' ? (
          <p className="modal-hint">
            Колонки <b>скважина</b>, <b>пласт</b>, <b>глубина</b>. Одноимённые пласты сливаются в один маркер.
          </p>
        ) : kind === 'litho' ? (
          <p className="modal-hint">
            Колонки <b>скважина</b>, <b>кровля</b>, <b>подошва</b>, <b>литотип</b>, опц. <b>насыщение</b>.
            Литология скважины заменяется целиком.
          </p>
        ) : (
          <p className="modal-hint">
            Колонки <b>скважина</b>, <b>MD</b>, <b>наклон</b> (зенит), <b>азимут</b> — град. Одна строка = станция;
            траектория и TVD считаются по минимальной кривизне.
          </p>
        )}

        <textarea
          className="modal-textarea"
          placeholder={PLACEHOLDER[kind]}
          value={text}
          onChange={(e) => setText(e.target.value)}
          spellCheck={false}
        />

        {error && <div className="modal-error">{error}</div>}
        {summary && (
          <div className="modal-ok">
            {summary}
            {warn && <div className="modal-warn">{warn}</div>}
          </div>
        )}

        <div className="modal-actions">
          <input
            ref={fileRef}
            type="file"
            accept=".csv,.tsv,.txt"
            hidden
            onChange={async (e) => { const f = e.target.files?.[0]; if (f) setText(await f.text()); e.target.value = ''; }}
          />
          <button className="btn ghost" onClick={() => fileRef.current?.click()}>
            <Upload size={15} strokeWidth={1.75} /> Загрузить файл
          </button>
          <span style={{ flex: 1 }} />
          {summary ? (
            <button className="btn" onClick={onClose}>Готово</button>
          ) : (
            <>
              <button className="btn ghost" onClick={onClose}>Отмена</button>
              <button className="btn" disabled={!text.trim() || wells.length === 0} onClick={run}>
                Импортировать
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
