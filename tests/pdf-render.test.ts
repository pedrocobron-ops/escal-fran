import { describe, expect, it } from 'vitest';
import { createElement, type ReactElement } from 'react';
import { renderToBuffer, type DocumentProps } from '@react-pdf/renderer';
import { seedData } from '../src/store/storage';
import { MonthPdf } from '../src/pdf/MonthPdf';
import { DayPdf } from '../src/pdf/DayPdf';
import { dayPdfModel, monthPdfModel } from '../src/pdf/model';

const pages = (buf: Buffer) => (buf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length;
const render = (el: ReactElement) => renderToBuffer(el as ReactElement<DocumentProps>);

describe('PDFs renderizados', () => {
  it('mês da escala inicial cabe em 2 páginas', async () => {
    const buf = await render(createElement(MonthPdf, { m: monthPdfModel(seedData(), 2026, 9) }));
    expect(pages(buf)).toBe(2);
  }, 30000);

  it('dia fechado (feriado) sai numa página só, sem a escala', async () => {
    const d = seedData();
    d.closedDates = [{ date: '2026-10-12', note: 'Feriado' }];
    const m = dayPdfModel(d, '2026-10-12');
    expect(m.open).toBe(false);
    expect(m.closedNote).toBe('Feriado');
    const buf = await render(createElement(DayPdf, { m }));
    expect(pages(buf)).toBe(1);
  }, 30000);

  it('linha da ASB mostra os dois lugares quando ela cobre duas salas', () => {
    const d = seedData();
    const laura = d.asbs.find((a) => a.name === 'Laura')!;
    d.base.slots.push({ asbId: laura.id, hour: 10, kind: 'sala', roomId: d.rooms[1].id });
    const row = dayPdfModel(d, '2026-09-29').asbRows.find((r) => r.name === 'Laura')!;
    expect(row.morning).toContain(' + Sala 2');
  });
});
