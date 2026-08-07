import { describe, it, expect } from 'vitest';
import { buildReservesCsv, type ReservesInput } from './reserves';
import type { VolResult } from '../reserves/volumetrics';

const det: VolResult = {
  areaKm2: 1.57, meanThickness: 6.7, grossM3: 10_500_000, netM3: 4_095_000,
  poreM3: 646_000, hcpvM3: 881_700, stooipM3: 734_700, stooipBbl: 4_620_000, recoverableBbl: 1_390_000,
};

const base: ReservesInput = {
  zone: 'Top A–KP S8', source: 'logs', wellCount: 6, logWells: 6,
  params: { ng: 0.39, phi: 0.158, sw: 0.5, bo: 1.2, rf: 0.3 },
  owc: 2067, det, mc: null, date: '2026-08-07 02:10',
};

describe('buildReservesCsv', () => {
  it('emits parameters, results and the contact', () => {
    const csv = buildReservesCsv(base);
    expect(csv).toContain('Отчёт о запасах,Top A–KP S8');
    expect(csv).toContain('N/G,0.39');
    expect(csv).toContain('ВНК,2067,м');
    expect(csv).toContain('Площадь в ВНК,1.57,км²');
    expect(csv).toContain('STOOIP,4620000,барр');
    expect(csv).toContain('Извлекаемые,1390000,барр');
    expect(csv).toContain('Источник параметров,Из логов (6 скв.)');
  });

  it('omits the contact row when there is no OWC and labels area plainly', () => {
    const csv = buildReservesCsv({ ...base, owc: null, source: 'manual' });
    expect(csv).not.toContain('ВНК');
    expect(csv).toContain('Площадь,1.57,км²');
    expect(csv).toContain('Источник параметров,Ручные');
  });

  it('appends the P90/P50/P10 block when Monte-Carlo is present', () => {
    const csv = buildReservesCsv({
      ...base, spreadPct: 20,
      mc: {
        stooip: { p90: 4_324_000, p50: 5_256_000, p10: 6_366_000, mean: 5_256_000 },
        recoverable: { p90: 1_255_000, p50: 1_571_000, p10: 1_946_000, mean: 1_571_000 },
        samples: 5000,
      },
    });
    expect(csv).toContain('Вероятностная оценка · барр (±20%),P90,P50,P10');
    expect(csv).toContain('STOOIP,4324000,5256000,6366000');
    expect(csv).toContain('Извлекаемые,1255000,1571000,1946000');
  });
});
