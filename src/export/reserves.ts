import type { VolResult } from '../reserves/volumetrics';
import type { McResult } from '../reserves/uncertainty';

export interface ReservesInput {
  zone: string;
  source: 'manual' | 'logs';
  wellCount: number;
  logWells?: number;
  params: { ng: number; phi: number; sw: number; bo: number; rf: number };
  owc: number | null;
  pinchoutVertices: number | null;
  det: VolResult;
  mc: McResult | null;
  spreadPct?: number;
  date: string;
}

/** CSV-escape a field (quote if it contains delimiter, quote or newline). */
function esc(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

const trim = (x: number, d: number) => String(Number(x.toFixed(d)));
const int = (x: number) => String(Math.round(x));
const sourceLabel = (r: ReservesInput) =>
  r.source === 'logs' ? `Из логов${r.logWells ? ` (${r.logWells} скв.)` : ''}` : 'Ручные';

/** Reserves report as a key/value CSV (BOM added by downloadText; Excel-friendly). */
export function buildReservesCsv(r: ReservesInput): string {
  const lines: string[] = [];
  const row = (...cells: (string | number)[]) => lines.push(cells.map((c) => esc(String(c))).join(','));

  row('Отчёт о запасах', r.zone);
  row('Дата', r.date);
  row('Скважин', r.wellCount);
  row('Источник параметров', sourceLabel(r));
  row('');
  row('Параметр', 'Значение', 'Ед.');
  row('N/G', trim(r.params.ng, 3));
  row('Пористость φ', trim(r.params.phi, 3));
  row('Водонасыщенность Sw', trim(r.params.sw, 3));
  row('Bo', trim(r.params.bo, 3));
  row('ККИН', trim(r.params.rf, 3));
  if (r.owc != null) row('ВНК', int(r.owc), 'м');
  if (r.pinchoutVertices != null) row('Полигон выклинивания', r.pinchoutVertices, 'вершин');
  row('');
  row('Показатель', 'Значение', 'Ед.');
  row(r.owc != null ? 'Площадь в ВНК' : 'Площадь', trim(r.det.areaKm2, 3), 'км²');
  row(r.owc != null ? 'Ср. HC-толщина' : 'Ср. толщина', trim(r.det.meanThickness, 1), 'м');
  row('GRV', int(r.det.grossM3), 'м³');
  row('HCPV', int(r.det.hcpvM3), 'м³');
  row('STOOIP', int(r.det.stooipM3), 'м³');
  row('STOOIP', int(r.det.stooipBbl), 'барр');
  row('Извлекаемые', int(r.det.recoverableBbl), 'барр');
  if (r.mc) {
    row('');
    row(`Вероятностная оценка · барр${r.spreadPct != null ? ` (±${r.spreadPct}%)` : ''}`, 'P90', 'P50', 'P10');
    row('STOOIP', int(r.mc.stooip.p90), int(r.mc.stooip.p50), int(r.mc.stooip.p10));
    row('Извлекаемые', int(r.mc.recoverable.p90), int(r.mc.recoverable.p50), int(r.mc.recoverable.p10));
  }
  return lines.join('\n');
}

// --- Canvas one-pager (Cyrillic-safe) → JPEG for the image-based PDF ---

type Op =
  | { t: 'title'; s: string }
  | { t: 'sub'; s: string }
  | { t: 'meta'; s: string }
  | { t: 'head'; s: string }
  | { t: 'row'; k: string; v: string; strong?: boolean }
  | { t: 'row3'; k: string; a: string; b: string; c: string; header?: boolean }
  | { t: 'div' }
  | { t: 'gap'; h: number }
  | { t: 'note'; s: string };

const OP_H: Record<Op['t'], number> = { title: 40, sub: 26, meta: 21, head: 30, row: 27, row3: 27, div: 15, gap: 0, note: 19 };

const mln = (x: number) => `${(x / 1e6).toFixed(2)} млн`;

function buildOps(r: ReservesInput): Op[] {
  const ops: Op[] = [
    { t: 'title', s: 'Подсчёт запасов' },
    { t: 'sub', s: r.zone },
    { t: 'gap', h: 8 },
    { t: 'meta', s: `Дата: ${r.date}` },
    { t: 'meta', s: `Скважин: ${r.wellCount}   ·   Параметры: ${sourceLabel(r)}` },
    { t: 'gap', h: 10 },
    { t: 'head', s: 'Параметры' },
    { t: 'row', k: 'N/G · нетто/брутто', v: trim(r.params.ng, 3) },
    { t: 'row', k: 'φ · пористость', v: trim(r.params.phi, 3) },
    { t: 'row', k: 'Sw · водонасыщенность', v: trim(r.params.sw, 3) },
    { t: 'row', k: 'Bo · объёмный коэф.', v: trim(r.params.bo, 3) },
    { t: 'row', k: 'ККИН', v: trim(r.params.rf, 3) },
  ];
  if (r.owc != null) ops.push({ t: 'row', k: 'ВНК · контакт', v: `${Math.round(r.owc)} м` });
  if (r.pinchoutVertices != null) ops.push({ t: 'row', k: 'Полигон выклинивания', v: `${r.pinchoutVertices} вершин` });
  ops.push(
    { t: 'gap', h: 8 }, { t: 'div' }, { t: 'gap', h: 8 },
    { t: 'head', s: 'Результат' },
    { t: 'row', k: r.owc != null ? 'Площадь в ВНК' : 'Площадь', v: `${r.det.areaKm2.toFixed(2)} км²` },
    { t: 'row', k: r.owc != null ? 'Ср. HC-толщина' : 'Ср. толщина', v: `${r.det.meanThickness.toFixed(1)} м` },
    { t: 'row', k: r.owc != null ? 'HC объём (GRV)' : 'Объём породы (GRV)', v: `${mln(r.det.grossM3)} м³` },
    { t: 'row', k: 'УВ поровый (HCPV)', v: `${mln(r.det.hcpvM3)} м³` },
    { t: 'row', k: 'STOOIP', v: `${mln(r.det.stooipM3)} м³`, strong: true },
    { t: 'row', k: 'STOOIP', v: `${mln(r.det.stooipBbl)} барр` },
    { t: 'row', k: 'Извлекаемые', v: `${mln(r.det.recoverableBbl)} барр`, strong: true },
  );
  if (r.mc) {
    ops.push(
      { t: 'gap', h: 8 }, { t: 'div' }, { t: 'gap', h: 8 },
      { t: 'head', s: `Вероятностная оценка${r.spreadPct != null ? ` · ±${r.spreadPct}%` : ''}` },
      { t: 'row3', k: '', a: 'P90', b: 'P50', c: 'P10', header: true },
      { t: 'row3', k: 'STOOIP, млн барр', a: (r.mc.stooip.p90 / 1e6).toFixed(2), b: (r.mc.stooip.p50 / 1e6).toFixed(2), c: (r.mc.stooip.p10 / 1e6).toFixed(2) },
      { t: 'row3', k: 'Извлек., млн барр', a: (r.mc.recoverable.p90 / 1e6).toFixed(2), b: (r.mc.recoverable.p50 / 1e6).toFixed(2), c: (r.mc.recoverable.p10 / 1e6).toFixed(2) },
      { t: 'note', s: `${r.mc.samples} реализаций · треугольные распределения` },
    );
  }
  ops.push({ t: 'gap', h: 10 }, { t: 'note', s: 'GeoViewer · интеграл по площади карты, замыкание не учитывается' });
  return ops;
}

/** Render the reserves report to a JPEG data URL (for jpegToPdf). */
export function renderReservesJpeg(r: ReservesInput): { dataUrl: string; width: number; height: number } {
  const ops = buildOps(r);
  const S = 2, W = 620, padX = 40, padTop = 40, padBot = 34;
  const bodyH = ops.reduce((h, op) => h + (op.t === 'gap' ? op.h : OP_H[op.t]), 0);
  const H = padTop + bodyH + padBot;

  const canvas = document.createElement('canvas');
  canvas.width = W * S;
  canvas.height = H * S;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(S, S);

  const cs = getComputedStyle(document.documentElement);
  const v = (name: string, fb: string) => cs.getPropertyValue(name).trim() || fb;
  const bg = v('--panel', '#1b2127'), text = v('--text', '#f4f7fa'), text2 = v('--text-2', '#aeb9c6');
  const text3 = v('--text-3', '#636e83'), accent = v('--accent', '#3aa3c9'), accent2 = v('--accent-2', '#7ad0a8');
  const hair = v('--hairline', 'rgba(151,178,196,0.10)');
  const mono = 'ui-monospace, SFMono-Regular, Menlo, monospace';
  const sans = 'system-ui, -apple-system, Segoe UI, sans-serif';

  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = accent;
  ctx.fillRect(0, 0, 4, H);

  let y = padTop;
  const rx = W - padX;
  for (const op of ops) {
    switch (op.t) {
      case 'title':
        ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
        ctx.fillStyle = text; ctx.font = `650 26px ${sans}`;
        ctx.fillText(op.s, padX, y + 26); break;
      case 'sub':
        ctx.fillStyle = accent2; ctx.font = `600 16px ${mono}`;
        ctx.fillText(op.s, padX, y + 18); break;
      case 'meta':
        ctx.fillStyle = text3; ctx.font = `13px ${sans}`;
        ctx.fillText(op.s, padX, y + 15); break;
      case 'head':
        ctx.fillStyle = text2; ctx.font = `600 12px ${sans}`;
        ctx.fillText(op.s.toUpperCase(), padX, y + 18); break;
      case 'row':
        ctx.fillStyle = text2; ctx.font = `14px ${sans}`; ctx.textAlign = 'left';
        ctx.fillText(op.k, padX, y + 18);
        ctx.fillStyle = op.strong ? accent2 : text; ctx.font = `${op.strong ? '600 ' : ''}14px ${mono}`;
        ctx.textAlign = 'right'; ctx.fillText(op.v, rx, y + 18);
        ctx.textAlign = 'left'; break;
      case 'row3': {
        const col = [W - padX - 260, W - padX - 130, rx];
        ctx.font = op.header ? `600 11px ${sans}` : `14px ${mono}`;
        ctx.fillStyle = text2; ctx.textAlign = 'left';
        if (op.k) ctx.fillText(op.k, padX, y + 18);
        ctx.textAlign = 'right';
        [op.a, op.b, op.c].forEach((cell, i) => {
          ctx.fillStyle = op.header ? text3 : i === 1 ? accent2 : text;
          if (!op.header && i === 1) ctx.font = `600 14px ${mono}`;
          else if (!op.header) ctx.font = `14px ${mono}`;
          ctx.fillText(cell, col[i], y + 18);
        });
        ctx.textAlign = 'left'; break;
      }
      case 'div':
        ctx.strokeStyle = hair; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(padX, y + 7.5); ctx.lineTo(rx, y + 7.5); ctx.stroke(); break;
      case 'note':
        ctx.fillStyle = text3; ctx.font = `11px ${sans}`;
        ctx.fillText(op.s, padX, y + 13); break;
    }
    y += op.t === 'gap' ? op.h : OP_H[op.t];
  }

  return { dataUrl: canvas.toDataURL('image/jpeg', 0.94), width: canvas.width, height: canvas.height };
}
