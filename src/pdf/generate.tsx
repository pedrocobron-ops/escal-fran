// Carregado sob demanda (import dinâmico) para o react-pdf não pesar no carregamento inicial.
import { pdf } from '@react-pdf/renderer';
import type { AppData, IsoDate } from '../domain';
import { DayPdf } from './DayPdf';
import { MonthPdf } from './MonthPdf';
import { dayPdfModel, monthPdfModel } from './model';

export async function monthPdfBlob(data: AppData, year: number, month: number): Promise<Blob> {
  return pdf(<MonthPdf m={monthPdfModel(data, year, month)} />).toBlob();
}

export async function dayPdfBlob(data: AppData, date: IsoDate): Promise<Blob> {
  return pdf(<DayPdf m={dayPdfModel(data, date)} />).toBlob();
}
