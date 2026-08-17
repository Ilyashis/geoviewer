import { describe, it, expect } from 'vitest';
import { isInclinometryTable, parseInclinometry, parseSurveyAny } from './inclinometry';

/**
 * Both fixtures copy the *shape* of real exports — the wrapped headers, the
 * legend written into the header rows, the row of column numbers, the three
 * azimuth flavours — with invented wells and numbers.
 */

// Multi-well summary: five header rows, an unrelated legend sharing them, an
// unnamed well column, and a row of column numbers before the data.
const SUMMARY = [
  ';№;Глубина;Зенит;Азимут;Ист.;Удлиние;Ист.;Абс. Глубина-(алт+удл)',
  'угол;Радиус;Интенсть;алтитуда',
  'гр.доли;;;;',
  ';п/п;м;Угол;;Азимут;;Глубина;Глубина',
  ';;;доли;гр.доли;гр.доли;м;м;м',
  '1;2;3;4;5;6;7;8;9',
  'W-1;1;0;0,00;-;-;0,00;0,00;120,00',
  'W-1;2;500;1,25;-;-;0,10;499,90;-379,90',
  'W-1;3;1000;1,50;-;-;0,25;999,75;-879,75',
  'W-2;1;0;0,00;10,00;21,00;0,00;0,00;120,00',
  'W-2;2;500;3,00;10,00;21,00;0,30;499,70;-379,70',
  'W-2;3;1000;6,50;12,00;23,00;1,20;998,80;-878,80',
].join('\n');

// Single-well MWD report: metadata preamble, then true/magnetic/grid azimuths.
const REPORT = [
  ';ПРОФИЛЬ СКВАЖИНЫ;;Halliburton Sperry Drilling',
  ';',
  'Скважина:;T-1;Альтитуда точки отсчета;12,500m над уровнем моря',
  'Ствол:;T-1 H1;Альтитуда морского дна/земли;3,200m над уровнем моря',
  'Заказчик:;NN;Азимут Вертикальной Секции:;135Grid North',
  ';',
  'Комментарии;Глубина по стволу (м);Зенитный угол (град);Азимут Истинный (град);Азимут Магнитный (град);Азимут Картографический (град);Вертикаль (м)',
  ';;;;;;',
  ';0;0;0;0;0;0',
  '324mm;100;1,50;150,000;128,900;151,200;99,97',
  ';200;15,00;150,000;128,900;151,200;198,20',
  ';300;30,00;152,500;131,400;153,700;290,10',
].join('\n');

describe('isInclinometryTable', () => {
  it('распознаёт таблицу замеров по зениту и азимуту', () => {
    expect(isInclinometryTable(SUMMARY)).toBe(true);
    expect(isInclinometryTable(REPORT)).toBe(true);
  });

  it('не срабатывает на таблице разбивок', () => {
    expect(isInclinometryTable('Well;Surface;MD\nW-1;БС8;2500')).toBe(false);
  });
});

describe('сводная таблица с многострочной шапкой', () => {
  const p = parseInclinometry(SUMMARY);

  it('склеивает шапку по столбцам и находит роли', () => {
    expect(p.columns.md).toContain('Глубина');
    expect(p.columns.inc).toContain('Зенит');
  });

  it('берёт истинный азимут, а не магнитный', () => {
    // Колонки различаются на склонение (11°): взять первую попавшуюся —
    // значит развернуть всю траекторию.
    expect(p.azimuth).toBe('истинный');
    expect(p.rows.find((r) => r.well === 'W-2' && r.md === 500)?.azi).toBe(21);
  });

  it('не путает MD с «Ист. Глубина» и «Абс. Глубина»', () => {
    expect(p.rows.map((r) => r.md)).toEqual([0, 500, 1000, 0, 500, 1000]);
  });

  it('находит колонку скважины, хотя она без названия', () => {
    // Подпись колонки — это чужая легенда, поэтому в отчёт идёт номер колонки.
    expect(p.columns.well).toBe('колонка 1 (без заголовка)');
    expect(p.wells).toBe(2);
    expect([...new Set(p.rows.map((r) => r.well))]).toEqual(['W-1', 'W-2']);
  });

  it('отбрасывает строку с номерами колонок', () => {
    // Иначе она читается как скважина «1» с единственной станцией.
    expect(p.rows.some((r) => r.well === '1')).toBe(false);
  });

  it('обнуляет зенит там, где азимут не записан', () => {
    // «-» значит «направление не определено»: оставить зенит с выдуманным
    // азимутом — это увести почти вертикальный ствол вбок на десятки метров.
    const w1 = p.rows.filter((r) => r.well === 'W-1');
    expect(w1.every((r) => r.inc === 0 && r.azi === 0)).toBe(true);
  });
});

describe('отчёт по одной скважине', () => {
  const p = parseInclinometry(REPORT);

  it('берёт имя скважины из шапки файла', () => {
    expect(p.wells).toBe(1);
    expect(p.rows[0].well).toBe('T-1');
    expect(p.columns.well).toBe('из шапки файла — T-1');
  });

  it('выбирает истинный азимут из трёх колонок', () => {
    expect(p.azimuth).toBe('истинный');
    expect(p.columns.azi).toContain('Истинный');
    expect(p.rows.find((r) => r.md === 300)?.azi).toBe(152.5);
  });

  it('не принимает «Азимут Вертикальной Секции» из преамбулы за колонку', () => {
    expect(p.columns.inc).toContain('Зенитный угол');
    expect(p.rows.find((r) => r.md === 200)?.inc).toBe(15);
  });

  it('читает альтитуду точки отсчёта, а не отметку земли', () => {
    expect(p.kb).toBeCloseTo(12.5, 6);
  });
});

describe('пропуски и повторные замеры', () => {
  const withRow = (row: string) => SUMMARY.replace('W-2;3;1000;6,50;12,00;23,00;1,20;998,80;-878,80', row);

  it('выбрасывает станцию без азимута, если ствол реально набрал угол', () => {
    // До 5° пропуск азимута — это «здесь вертикально»; выше это потеря данных.
    const p = parseInclinometry(withRow('W-2;3;1000;35,00;-;-;1,20;998,80;-878,80'));
    expect(p.rows.filter((r) => r.well === 'W-2').map((r) => r.md)).toEqual([0, 500]);
  });

  it('помечает скважину, замеренную дважды', () => {
    const p = parseInclinometry(SUMMARY + '\nW-2;4;200;3,00;10,00;21,00;0,10;199,90;-79,90');
    expect(p.resurveyed).toEqual(['W-2']);
  });

  it('отбрасывает скважину с единственной станцией', () => {
    const p = parseInclinometry(SUMMARY + '\nW-9;1;700;2,00;10,00;21,00;0,10;699,90;-579,90');
    expect(p.rows.some((r) => r.well === 'W-9')).toBe(false);
  });
});

describe('parseSurveyAny', () => {
  it('читает обычный CSV с одной строкой заголовка', () => {
    const r = parseSurveyAny('well,md,inc,azi\nA-1,1000,2.5,175\nA-1,1100,3.0,176');
    expect(r.rows).toHaveLength(2);
    expect(r.rows[0]).toEqual({ well: 'A-1', md: 1000, inc: 2.5, azi: 175 });
  });

  it('переключается на русский экспорт, когда простой разбор не подходит', () => {
    const r = parseSurveyAny(SUMMARY, 'СВОД.csv');
    expect(r.rows).toHaveLength(6);
    expect(r.note).toContain('истинный');
  });

  it('привязывает альтитуду из шапки к скважине файла', () => {
    expect(parseSurveyAny(REPORT, 'report.csv').kb).toEqual({ well: 'T-1', value: 12.5 });
  });

  it('не приписывает альтитуду из преамбулы, когда скважин в файле несколько', () => {
    // Отметка в преамбуле не говорит, к какой из скважин она относится, —
    // применить её ко всем значило бы выдумать данные.
    const many = 'Альтитуда точки отсчета;15,000m над уровнем моря\n' + SUMMARY;
    const r = parseSurveyAny(many, 'СВОД.csv');
    expect(r.rows).toHaveLength(6);
    expect(r.kb).toBeUndefined();
  });

  it('падает с внятной ошибкой, когда колонок нет вовсе', () => {
    expect(() => parseSurveyAny('a;b;c\n1;2;3\n4;5;6')).toThrow(/Не найден/);
  });
});
