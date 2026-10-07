// Ferramentas da Cléo: o que ela consegue consultar e mudar na escala. Tudo roda no
// navegador, em cima do store (desfazer continua funcionando). Puro e testável.
import type { AbsenceReason, AppData, IsoDate, Person, SlotKind } from '../domain';
import {
  ABSENCE_REASONS, HOURS, SLOT_KIND_LABEL, WEEKDAY_LABEL, WEEKDAY_SHORT, absenceFor, absencesBetween, addDays, analyze, canAssignOn, coverageSuggestions,
  dataForDate, dentistAbsencesBetween, dentistsAt, effectiveDay, extraShiftsOn, findAsbAnywhere, findDentistAnywhere, formatDate, formatHour,
  formatRange, isReasonablePeriod, lunchWindowOf, mondayOf, overlappingAbsences, overlappingDentistAbsences, overlappingExtras, overlappingShiftChanges,
  resolveTasksForDate, shiftChangesBetween, stillUncovered, validExtraShiftsBetween, weekdayOf,
} from '../domain';
import { clearDayOverrides, clearWeekOverrides, newId, setDaySlots, setWeekSlots, weekEntriesAt, weekPlanAt, type CellTarget } from '../store/useStore';
import { placeInBase, placeInDay, placeInWeek, roomDropKind } from '../ui/board/placement';
import { findAsb, findDentist, findRoom, findTask, parseHour, parseHours, resolveDate } from './resolve';

export interface ToolDef {
  name: string;
  description: string;
  input_schema: { type: 'object'; properties: Record<string, unknown>; required?: string[] };
}

export interface ToolContext {
  /** Dados atuais (lidos a cada chamada: uma ferramenta vê o que a anterior mudou). */
  data: () => AppData;
  apply: (mutator: (draft: AppData) => void) => void;
  undo: () => boolean;
  today: IsoDate;
}

export interface ToolResult {
  text: string;
  /** true quando mudou a escala (a interface avisa e lembra do Desfazer). */
  changed?: boolean;
}

const DATE = { type: 'string', description: 'Data em ISO (AAAA-MM-DD). Também aceita "hoje", "amanhã" ou dia da semana.' };
const HOUR = { type: 'integer', description: 'Hora inteira, de 7 a 19 (ex.: 7 = 07h).' };
const CONFIRM = { type: 'boolean', description: 'Só true depois que a pessoa confirmou em palavras. Sem isso a ferramenta só descreve o que faria.' };

export const TOOLS: ToolDef[] = [
  { name: 'consultar_dia', description: 'Escala efetiva de um dia: quem está em cada sala a cada hora, ausências, horas extras, trocas de horário e alertas. Use para responder perguntas sobre um dia.', input_schema: { type: 'object', properties: { data: DATE }, required: ['data'] } },
  { name: 'consultar_semana', description: 'Resumo da semana (segunda a sexta) da data: ausências, folgas de dentista, trocas, horas extras e alertas críticos por dia.', input_schema: { type: 'object', properties: { data: DATE }, required: ['data'] } },
  { name: 'consultar_equipe', description: 'ASBs (horário de contrato, almoço), dentistas (sala, horário, dias), salas, dias de funcionamento e janela do almoço.', input_schema: { type: 'object', properties: {} } },
  { name: 'consultar_ausencias', description: 'Ausências de ASB, folgas de dentista, horas extras e trocas de horário num período.', input_schema: { type: 'object', properties: { de: DATE, ate: DATE }, required: ['de'] } },
  { name: 'consultar_tarefas', description: 'Quem é responsável por cada tarefa fixa ou rodízio numa data (conferência de prótese, planilha de prótese etc.).', input_schema: { type: 'object', properties: { data: DATE }, required: ['data'] } },
  { name: 'sugerir_cobertura', description: 'Quem pode cobrir uma ASB ausente num período e quantos blocos cada uma cobre (e com quanta hora extra).', input_schema: { type: 'object', properties: { asb: { type: 'string' }, de: DATE, ate: DATE }, required: ['asb', 'de'] } },
  { name: 'cadastrar_ausencia', description: 'Registra folga, falta, férias, atestado ou licença de uma ASB, com ou sem substituta. Responde com sugestões de cobertura quando falta gente.', input_schema: { type: 'object', properties: { asb: { type: 'string' }, de: DATE, ate: { ...DATE, description: 'Fim (inclusivo). Se faltar, é só o dia "de".' }, motivo: { type: 'string', enum: ABSENCE_REASONS }, substituta: { type: 'string', description: 'Nome da ASB que cobre, ou "externa: Nome" para alguém de fora. Opcional.' } }, required: ['asb', 'de'] } },
  { name: 'remover_ausencia', description: 'Remove a ausência de uma ASB que vale numa data (e as horas extras criadas para cobri-la). Pede confirmação.', input_schema: { type: 'object', properties: { asb: { type: 'string' }, data: DATE, confirmado: CONFIRM }, required: ['asb', 'data'] } },
  { name: 'cadastrar_hora_extra', description: 'Registra hora extra de uma ASB numa data (fora do horário de contrato dela), para pagamento.', input_schema: { type: 'object', properties: { asb: { type: 'string' }, data: DATE, inicio: HOUR, fim: { ...HOUR, description: 'Hora de fim (exclusiva), ex.: 19 = até 19h.' }, obs: { type: 'string' } }, required: ['asb', 'data', 'inicio', 'fim'] } },
  { name: 'remover_hora_extra', description: 'Remove as horas extras de uma ASB numa data. Pede confirmação.', input_schema: { type: 'object', properties: { asb: { type: 'string' }, data: DATE, confirmado: CONFIRM }, required: ['asb', 'data'] } },
  { name: 'cadastrar_troca_horario', description: 'Troca de horário: em certos dias a ASB trabalha em outro horário (ex.: 07h–16h em vez de 09h–18h). Não é hora extra.', input_schema: { type: 'object', properties: { asb: { type: 'string' }, de: DATE, ate: DATE, entra: { ...HOUR, description: 'Hora em que entra nesses dias.' }, sai: { ...HOUR, description: 'Hora em que sai nesses dias (exclusiva), ex.: 16 = sai às 16h.' }, obs: { type: 'string' } }, required: ['asb', 'de', 'entra', 'sai'] } },
  { name: 'remover_troca_horario', description: 'Remove a troca de horário de uma ASB que vale numa data. Pede confirmação.', input_schema: { type: 'object', properties: { asb: { type: 'string' }, data: DATE, confirmado: CONFIRM }, required: ['asb', 'data'] } },
  { name: 'cadastrar_folga_dentista', description: 'Folga ou ausência de um dentista: a sala dele fica sem atendimento e o app remaneja a ASB sozinho.', input_schema: { type: 'object', properties: { dentista: { type: 'string' }, de: DATE, ate: DATE, motivo: { type: 'string', enum: ABSENCE_REASONS } }, required: ['dentista', 'de'] } },
  { name: 'remover_folga_dentista', description: 'Remove a folga de um dentista que vale numa data. Pede confirmação.', input_schema: { type: 'object', properties: { dentista: { type: 'string' }, data: DATE, confirmado: CONFIRM }, required: ['dentista', 'data'] } },
  {
    name: 'colocar_no_quadro',
    description: 'Coloca uma ASB numa sala, apoio, CME, almoxarifado ou almoço em certas horas. Por padrão vale para a semana inteira (segunda a sexta) da data; "dia" vale só nessa data; "base" muda a escala base (o modelo que se repete). Ela sai do que fazia nessas horas, a não ser que acrescentar=true. Sala ocupada por outra ASB: entra como apoio.',
    input_schema: {
      type: 'object',
      properties: {
        asb: { type: 'string' },
        data: DATE,
        horas: { type: 'array', items: HOUR, description: 'Horas de início de cada bloco. Ex.: 15h às 17h = [15, 16].' },
        destino: { type: 'string', enum: ['sala', 'apoio', 'cme', 'almox', 'almoco'], description: 'sala = ASB da sala; apoio = apoio/recepção (de uma sala, se "sala" vier junto); cme = CME/arsenal; almox = almoxarifado; almoco = almoço.' },
        sala: { type: 'string', description: 'Nome ou número da sala, quando destino é sala ou apoio de uma sala.' },
        escopo: { type: 'string', enum: ['semana', 'dia', 'base'] },
        acrescentar: { type: 'boolean', description: 'true = mantém o que ela já fazia nessas horas (ex.: apoio de outra sala).' },
      },
      required: ['asb', 'data', 'horas', 'destino'],
    },
  },
  { name: 'tirar_do_quadro', description: 'Tira uma ASB do quadro em certas horas (ou o dia todo, se "horas" faltar). Mesmos escopos de colocar_no_quadro.', input_schema: { type: 'object', properties: { asb: { type: 'string' }, data: DATE, horas: { type: 'array', items: HOUR }, escopo: { type: 'string', enum: ['semana', 'dia', 'base'] } }, required: ['asb', 'data'] } },
  { name: 'limpar_ajustes', description: 'Desfaz os ajustes feitos no quadro: "dia" volta a data ao que vale na semana; "semana" volta a semana inteira à escala base. Pede confirmação.', input_schema: { type: 'object', properties: { data: DATE, escopo: { type: 'string', enum: ['dia', 'semana'] }, confirmado: CONFIRM }, required: ['data', 'escopo'] } },
  { name: 'fixar_responsavel', description: 'Deixa uma ASB fixa numa tarefa durante um período (ex.: conferência de prótese o mês inteiro), acima do rodízio.', input_schema: { type: 'object', properties: { tarefa: { type: 'string' }, asb: { type: 'string' }, de: DATE, ate: DATE }, required: ['tarefa', 'asb', 'de', 'ate'] } },
  { name: 'remover_responsavel_fixo', description: 'Remove o responsável fixo de uma tarefa que vale numa data (volta ao rodízio). Pede confirmação.', input_schema: { type: 'object', properties: { tarefa: { type: 'string' }, data: DATE, confirmado: CONFIRM }, required: ['tarefa', 'data'] } },
  { name: 'fechar_dia', description: 'Marca uma data como fechada (feriado, ponto facultativo): sem escala, alertas nem horas extras nesse dia.', input_schema: { type: 'object', properties: { data: DATE, motivo: { type: 'string' } }, required: ['data'] } },
  { name: 'reabrir_dia', description: 'Tira uma data da lista de dias fechados.', input_schema: { type: 'object', properties: { data: DATE }, required: ['data'] } },
  { name: 'desfazer', description: 'Desfaz a última mudança feita na escala (igual ao botão Desfazer).', input_schema: { type: 'object', properties: {} } },
];

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : v === undefined || v === null ? '' : String(v));
const fail = (text: string): ToolResult => ({ text: `ERRO: ${text}` });

function nameOf(data: AppData, p: Person): string {
  return p.type === 'asb' ? findAsbAnywhere(data, p.asbId)?.name ?? '?' : `${p.name} (externa)`;
}

function periodLabel(from: IsoDate, to: IsoDate): string {
  return from === to ? formatDate(from) : `${formatDate(from)} a ${formatDate(to)}`;
}

function dateArg(v: unknown, today: IsoDate, label = 'data'): IsoDate | ToolResult {
  const iso = resolveDate(str(v), today);
  return iso ?? fail(`Não entendi a ${label} "${str(v)}". Use AAAA-MM-DD.`);
}
const isFail = (v: unknown): v is ToolResult => typeof v === 'object' && v !== null && 'text' in v;

function periodArgs(input: Record<string, unknown>, today: IsoDate): { from: IsoDate; to: IsoDate } | ToolResult {
  const from = dateArg(input.de ?? input.data, today, 'data inicial');
  if (isFail(from)) return from;
  const to = input.ate ? dateArg(input.ate, today, 'data final') : from;
  if (isFail(to)) return to;
  if (to < from) return fail('A data final vem antes da inicial.');
  if (!isReasonablePeriod(from, to)) return fail('Período grande demais (máximo de alguns meses).');
  return { from, to };
}

/** Escala efetiva do dia, hora a hora, em texto compacto. */
export function describeDay(data: AppData, date: IsoDate): string {
  const dd = dataForDate(data, date);
  const day = effectiveDay(data, date);
  const lines = [`${WEEKDAY_LABEL[weekdayOf(date)]}, ${formatDate(date)}`];
  if (!day.open) {
    lines.push(`CEO fechado nesse dia${day.closedNote ? ` (${day.closedNote})` : ''}.`);
    return lines.join('\n');
  }
  const asbName = (id: string) => findAsbAnywhere(dd, id)?.name ?? '?';
  for (const a of day.absences) {
    const sub = a.substitute ? ('asbId' in a.substitute ? `cobre: ${asbName(a.substitute.asbId)}` : `cobre: ${a.substitute.externalName} (externa)`) : 'sem substituta';
    lines.push(`Ausente: ${asbName(a.asbId)} (${a.reason}, ${periodLabel(a.from, a.to)}), ${sub}.`);
  }
  for (const a of (dd.dentistAbsences ?? []).filter((x) => x.from <= date && date <= x.to)) lines.push(`Dentista de folga: ${findDentistAnywhere(dd, a.dentistId)?.name ?? '?'} (${a.reason}).`);
  for (const a of dd.asbs.filter((x) => x.originalHours)) lines.push(`Horário trocado: ${a.name} ${formatRange(a.start, a.end)} (normal ${formatRange(a.originalHours!.start, a.originalHours!.end)}).`);
  for (const e of day.extraShifts) lines.push(`Hora extra: ${asbName(e.asbId)} ${formatRange(e.start, e.end)}${e.note ? ` (${e.note})` : ''}.`);
  const rooms = [...dd.rooms].sort((a, b) => a.order - b.order);
  for (const hour of HOURS) {
    const at = day.slots.filter((s) => s.hour === hour);
    const parts: string[] = [];
    for (const r of rooms) {
      const dents = dentistsAt(day.dentists, r.id, hour);
      const here = at.filter((s) => s.roomId === r.id && (s.kind === 'sala' || s.kind === 'apoio'));
      if (dents.length === 0 && here.length === 0) continue;
      const who = here.map((s) => `${nameOf(dd, s.who)}${s.kind === 'apoio' ? ' (apoio)' : ''}`).join(', ');
      const dent = dents.map((d) => d.name).join(', ');
      parts.push(`${r.name}${dent ? ` (${dent})` : ' (sem dentista)'}: ${who || (dents.length > 0 ? 'SEM ASB' : 'ninguém')}`);
    }
    const others: Array<[SlotKind, string]> = [['apoio', 'Apoio'], ['recepcao', 'Recepção'], ['cme', 'CME'], ['almox', 'Almox'], ['almoco', 'Almoço']];
    for (const [kind, label] of others) {
      const here = at.filter((s) => s.kind === kind && (kind !== 'apoio' || !s.roomId));
      if (here.length > 0) parts.push(`${label}: ${here.map((s) => nameOf(dd, s.who)).join(', ')}`);
    }
    lines.push(`${formatHour(hour)}: ${parts.join(' | ') || 'ninguém escalado'}`);
  }
  const alerts = analyze(data, day).filter((a) => a.level !== 'info');
  lines.push(alerts.length > 0 ? `Alertas: ${alerts.map((a) => `[${a.level}] ${a.message}`).join(' ')}` : 'Alertas: nenhum.');
  return lines.join('\n');
}

export function describeWeek(data: AppData, date: IsoDate): string {
  const monday = mondayOf(date);
  const lines = [`Semana de ${formatDate(monday)} a ${formatDate(addDays(monday, 4))}`];
  const weekCount = (data.weekOverrides ?? []).filter((o) => o.week === monday).length;
  if (weekCount > 0) lines.push(`Ajustes da semana no quadro: ${weekCount} bloco${weekCount > 1 ? 's' : ''}.`);
  for (let i = 0; i < 5; i++) {
    const d = addDays(monday, i);
    const dd = dataForDate(data, d);
    const day = effectiveDay(data, d);
    const asbName = (id: string) => findAsbAnywhere(dd, id)?.name ?? '?';
    if (!day.open) {
      lines.push(`${WEEKDAY_SHORT[weekdayOf(d)]} ${formatDate(d)}: fechado${day.closedNote ? ` (${day.closedNote})` : ''}.`);
      continue;
    }
    const bits: string[] = [];
    if (day.absences.length > 0) bits.push(`ausentes: ${day.absences.map((a) => `${asbName(a.asbId)} (${a.reason}${a.substitute ? ', cobre ' + ('asbId' in a.substitute ? asbName(a.substitute.asbId) : a.substitute.externalName) : ', sem substituta'})`).join(', ')}`);
    const dent = (dd.dentistAbsences ?? []).filter((x) => x.from <= d && d <= x.to);
    if (dent.length > 0) bits.push(`dentista de folga: ${dent.map((a) => findDentistAnywhere(dd, a.dentistId)?.name ?? '?').join(', ')}`);
    const shifted = dd.asbs.filter((x) => x.originalHours);
    if (shifted.length > 0) bits.push(`horário trocado: ${shifted.map((a) => `${a.name} ${formatRange(a.start, a.end)}`).join(', ')}`);
    if (day.extraShifts.length > 0) bits.push(`hora extra: ${day.extraShifts.map((e) => `${asbName(e.asbId)} ${formatRange(e.start, e.end)}`).join(', ')}`);
    const dayCount = (data.dayOverrides ?? []).filter((o) => o.date === d).length;
    if (dayCount > 0) bits.push(`ajustes só deste dia: ${dayCount}`);
    const crit = analyze(data, day).filter((a) => a.level === 'critico');
    bits.push(crit.length > 0 ? `críticos: ${crit.map((a) => a.message).join(' ')}` : 'sem alerta crítico');
    lines.push(`${WEEKDAY_SHORT[weekdayOf(d)]} ${formatDate(d)}: ${bits.join('; ')}.`);
  }
  return lines.join('\n');
}

export function describeTeam(data: AppData): string {
  const lines: string[] = [];
  const dayList = (days?: number[]) => (days && days.length > 0 ? days.map((d) => WEEKDAY_SHORT[d]).join(', ') : 'seg a sex');
  lines.push('ASBs: ' + data.asbs.filter((a) => a.active).map((a) => `${a.name} ${formatRange(a.start, a.end)}${a.lunch ? '' : ' (sem almoço)'}`).join('; ') + '.');
  const inactive = data.asbs.filter((a) => !a.active);
  if (inactive.length > 0) lines.push('Inativas: ' + inactive.map((a) => a.name).join(', ') + '.');
  const rooms = [...data.rooms].sort((a, b) => a.order - b.order);
  const roomName = (id: string) => rooms.find((r) => r.id === id)?.name ?? id;
  lines.push('Dentistas: ' + data.dentists.map((d) => `${d.name} (${d.specialty}) ${roomName(d.roomId)} ${formatRange(d.start, d.end)} ${dayList(d.days)}`).join('; ') + '.');
  lines.push('Salas: ' + rooms.map((r) => r.name).join(', ') + '.');
  lines.push(`Funcionamento: ${data.openDays.map((d) => WEEKDAY_SHORT[d]).join(', ')}, blocos de 07h a 19h. Almoço entre ${formatHour(lunchWindowOf(data).start)} e ${formatHour(lunchWindowOf(data).end)}.`);
  lines.push('Tarefas: ' + data.tasks.map((t) => t.name).join('; ') + '.');
  return lines.join('\n');
}

export function describeAbsences(data: AppData, from: IsoDate, to: IsoDate): string {
  const asbName = (id: string) => findAsbAnywhere(data, id)?.name ?? '?';
  const lines = [`Período ${periodLabel(from, to)}:`];
  const abs = absencesBetween(data, from, to);
  lines.push(abs.length > 0 ? 'Ausências de ASB: ' + abs.map((a) => `${asbName(a.asbId)} ${periodLabel(a.from, a.to)} (${a.reason}${a.substitute ? ', cobre ' + ('asbId' in a.substitute ? asbName(a.substitute.asbId) : a.substitute.externalName + ' (externa)') : ', sem substituta'})`).join('; ') + '.' : 'Ausências de ASB: nenhuma.');
  const dent = dentistAbsencesBetween(data, from, to);
  lines.push(dent.length > 0 ? 'Folgas de dentista: ' + dent.map((a) => `${findDentistAnywhere(data, a.dentistId)?.name ?? '?'} ${periodLabel(a.from, a.to)} (${a.reason})`).join('; ') + '.' : 'Folgas de dentista: nenhuma.');
  const extras = validExtraShiftsBetween(data, from, to);
  lines.push(extras.length > 0 ? 'Horas extras: ' + extras.map((e) => `${asbName(e.asbId)} ${formatDate(e.date)} ${formatRange(e.start, e.end)}${e.note ? ` (${e.note})` : ''}`).join('; ') + '.' : 'Horas extras: nenhuma.');
  const shifts = shiftChangesBetween(data, from, to);
  lines.push(shifts.length > 0 ? 'Trocas de horário: ' + shifts.map((c) => `${asbName(c.asbId)} ${periodLabel(c.from, c.to)} ${formatRange(c.start, c.end)}${c.note ? ` (${c.note})` : ''}`).join('; ') + '.' : 'Trocas de horário: nenhuma.');
  const closed = (data.closedDates ?? []).filter((c) => c.date >= from && c.date <= to);
  if (closed.length > 0) lines.push('Dias fechados: ' + closed.map((c) => `${formatDate(c.date)}${c.note ? ` (${c.note})` : ''}`).join(', ') + '.');
  return lines.join('\n');
}

export function describeTasks(data: AppData, date: IsoDate): string {
  const dd = dataForDate(data, date);
  const lines = [`Tarefas em ${WEEKDAY_LABEL[weekdayOf(date)]}, ${formatDate(date)}:`];
  for (const r of resolveTasksForDate(data, date)) {
    const task = dd.tasks.find((t) => t.id === r.taskId);
    if (!task) continue;
    if (!r.applies) {
      lines.push(`${task.name}: não acontece nesse dia da semana.`);
      continue;
    }
    const who = r.holders.length > 0 ? r.holders.map((p) => nameOf(dd, p)).join(', ') : 'ninguém';
    lines.push(`${task.name}: ${who}. ${r.reason}`);
  }
  return lines.join('\n');
}

function coverageText(data: AppData, asbId: string, from: IsoDate, to: IsoDate): string {
  const left = stillUncovered(data, asbId, from, to);
  if (left.length === 0) return 'Nada fica descoberto.';
  const sug = coverageSuggestions(data, asbId, from, to).slice(0, 4);
  const leftText = left.map((l) => `${formatDate(l.date)} ${l.hours.map(formatHour).join(', ')}`).join('; ');
  const sugText = sug.length > 0 ? ' Quem pode cobrir: ' + sug.map((s) => `${s.name} cobre ${s.covered} de ${s.total} blocos${s.needsExtra > 0 ? ` (${s.needsExtra} com hora extra)` : ''}`).join('; ') + '.' : '';
  return `Fica descoberto: ${leftText}.${sugText}`;
}

function confirmGate(input: Record<string, unknown>, what: string): ToolResult | null {
  if (input.confirmado === true) return null;
  return { text: `PRECISA CONFIRMAR. Pergunte à pessoa se é isso mesmo: ${what}. Só chame de novo, com confirmado=true, depois que ela disser que sim.` };
}

function criticalAfter(data: AppData, date: IsoDate): string {
  const day = effectiveDay(data, date);
  if (!day.open) return '';
  const crit = analyze(data, day).filter((a) => a.level === 'critico');
  return crit.length > 0 ? ` Alertas críticos em ${formatDate(date)}: ${crit.map((a) => a.message).join(' ')}` : ` Sem alerta crítico em ${formatDate(date)}.`;
}

export function runTool(name: string, input: Record<string, unknown>, ctx: ToolContext): ToolResult {
  const data = ctx.data();
  const today = ctx.today;
  switch (name) {
    case 'consultar_dia': {
      const d = dateArg(input.data, today);
      return isFail(d) ? d : { text: describeDay(data, d) };
    }
    case 'consultar_semana': {
      const d = dateArg(input.data, today);
      return isFail(d) ? d : { text: describeWeek(data, d) };
    }
    case 'consultar_equipe':
      return { text: describeTeam(data) };
    case 'consultar_ausencias': {
      const p = periodArgs(input, today);
      return isFail(p) ? p : { text: describeAbsences(data, p.from, p.to) };
    }
    case 'consultar_tarefas': {
      const d = dateArg(input.data, today);
      return isFail(d) ? d : { text: describeTasks(data, d) };
    }
    case 'sugerir_cobertura': {
      const asb = findAsb(data, str(input.asb));
      if (!asb.ok) return fail(asb.error);
      const p = periodArgs(input, today);
      if (isFail(p)) return p;
      const probe = structuredClone(data);
      if (!absenceFor(probe, asb.item.id, p.from)) probe.absences.push({ id: 'probe', asbId: asb.item.id, from: p.from, to: p.to, reason: 'Folga' });
      return { text: `${asb.item.name} ausente ${periodLabel(p.from, p.to)}: ${coverageText(probe, asb.item.id, p.from, p.to)}` };
    }
    case 'cadastrar_ausencia': {
      const asb = findAsb(data, str(input.asb));
      if (!asb.ok) return fail(asb.error);
      const p = periodArgs(input, today);
      if (isFail(p)) return p;
      const reason = (ABSENCE_REASONS.find((r) => r.toLowerCase() === str(input.motivo).toLowerCase()) ?? 'Folga') as AbsenceReason;
      const clash = overlappingAbsences(data, asb.item.id, p.from, p.to);
      if (clash.length > 0) return fail(`${asb.item.name} já tem ausência nesse período (${clash.map((c) => periodLabel(c.from, c.to)).join(', ')}). Remova ou edite a existente.`);
      let substitute: { asbId: string } | { externalName: string } | undefined;
      const subText = str(input.substituta);
      if (subText) {
        const ext = subText.match(/^externa?\s*:\s*(.+)$/i);
        if (ext) substitute = { externalName: ext[1].trim() };
        else {
          const sub = findAsb(data, subText);
          if (!sub.ok) return fail(sub.error);
          if (sub.item.id === asb.item.id) return fail('A substituta não pode ser a própria ausente.');
          substitute = { asbId: sub.item.id };
        }
      }
      const id = newId('abs');
      ctx.apply((d) => { d.absences.push({ id, asbId: asb.item.id, from: p.from, to: p.to, reason, substitute }); });
      const after = ctx.data();
      const subLabel = substitute ? ('asbId' in substitute ? `, ${findAsbAnywhere(after, substitute.asbId)?.name} cobre` : `, ${substitute.externalName} (externa) cobre`) : '';
      return { changed: true, text: `Feito: ${asb.item.name} ausente ${periodLabel(p.from, p.to)} (${reason})${subLabel}. ${coverageText(after, asb.item.id, p.from, p.to)}` };
    }
    case 'remover_ausencia': {
      const asb = findAsb(data, str(input.asb), { inactive: true });
      if (!asb.ok) return fail(asb.error);
      const d = dateArg(input.data, today);
      if (isFail(d)) return d;
      const a = absenceFor(data, asb.item.id, d);
      if (!a) return fail(`${asb.item.name} não tem ausência em ${formatDate(d)}.`);
      const gate = confirmGate(input, `remover a ausência de ${asb.item.name} de ${periodLabel(a.from, a.to)} (${a.reason})`);
      if (gate) return gate;
      ctx.apply((x) => {
        x.absences = x.absences.filter((y) => y.id !== a.id);
        x.extraShifts = (x.extraShifts ?? []).filter((e) => e.absenceId !== a.id);
      });
      return { changed: true, text: `Feito: ausência de ${asb.item.name} (${periodLabel(a.from, a.to)}) removida.` };
    }
    case 'cadastrar_hora_extra': {
      const asb = findAsb(data, str(input.asb));
      if (!asb.ok) return fail(asb.error);
      const d = dateArg(input.data, today);
      if (isFail(d)) return d;
      const start = parseHour(input.inicio);
      const end = parseHour(input.fim);
      if (start === undefined || end === undefined || end <= start || start < 7 || end > 19) return fail('Horário inválido: use horas inteiras entre 7 e 19, com fim depois do início.');
      const onDay = dataForDate(data, d).asbs.find((a) => a.id === asb.item.id) ?? asb.item;
      if (absenceFor(data, asb.item.id, d)) return fail(`${asb.item.name} está ausente em ${formatDate(d)}; hora extra não vale para quem está de folga.`);
      const parts: Array<[number, number]> = [];
      if (start < onDay.start) parts.push([start, Math.min(end, onDay.start)]);
      if (end > onDay.end) parts.push([Math.max(start, onDay.end), end]);
      if (parts.length === 0) return fail(`Esse horário já está dentro do contrato de ${asb.item.name} nesse dia (${formatRange(onDay.start, onDay.end)}).`);
      const clash = parts.flatMap(([a, b]) => overlappingExtras(data, asb.item.id, d, a, b));
      if (clash.length > 0) return fail(`${asb.item.name} já tem hora extra nesse horário em ${formatDate(d)}.`);
      ctx.apply((x) => {
        const list = x.extraShifts ?? (x.extraShifts = []);
        for (const [a, b] of parts) list.push({ id: newId('hx'), asbId: asb.item.id, date: d, start: a, end: b, note: str(input.obs) || undefined });
      });
      return { changed: true, text: `Feito: hora extra de ${asb.item.name} em ${formatDate(d)}, ${parts.map(([a, b]) => formatRange(a, b)).join(' e ')} (contrato ${formatRange(onDay.start, onDay.end)}). Agora ela pode ser colocada no quadro nessas horas.` };
    }
    case 'remover_hora_extra': {
      const asb = findAsb(data, str(input.asb), { inactive: true });
      if (!asb.ok) return fail(asb.error);
      const d = dateArg(input.data, today);
      if (isFail(d)) return d;
      const list = extraShiftsOn(data, d).filter((e) => e.asbId === asb.item.id);
      if (list.length === 0) return fail(`${asb.item.name} não tem hora extra em ${formatDate(d)}.`);
      const gate = confirmGate(input, `remover a hora extra de ${asb.item.name} em ${formatDate(d)} (${list.map((e) => formatRange(e.start, e.end)).join(', ')})`);
      if (gate) return gate;
      const ids = new Set(list.map((e) => e.id));
      ctx.apply((x) => { x.extraShifts = (x.extraShifts ?? []).filter((e) => !ids.has(e.id)); });
      return { changed: true, text: `Feito: hora extra de ${asb.item.name} em ${formatDate(d)} removida.` };
    }
    case 'cadastrar_troca_horario': {
      const asb = findAsb(data, str(input.asb));
      if (!asb.ok) return fail(asb.error);
      const p = periodArgs(input, today);
      if (isFail(p)) return p;
      const start = parseHour(input.entra);
      const end = parseHour(input.sai);
      if (start === undefined || end === undefined || end <= start || start < 7 || end > 19) return fail('Horário inválido: use horas inteiras entre 7 e 19, com saída depois da entrada.');
      if (start === asb.item.start && end === asb.item.end) return fail(`Esse já é o horário normal de ${asb.item.name}.`);
      const clash = overlappingShiftChanges(data, asb.item.id, p.from, p.to);
      if (clash.length > 0) return fail(`${asb.item.name} já tem troca de horário nesse período (${clash.map((c) => `${periodLabel(c.from, c.to)} ${formatRange(c.start, c.end)}`).join(', ')}).`);
      ctx.apply((x) => {
        const list = x.shiftChanges ?? (x.shiftChanges = []);
        list.push({ id: newId('tr'), asbId: asb.item.id, from: p.from, to: p.to, start, end, note: str(input.obs) || undefined });
      });
      return { changed: true, text: `Feito: ${asb.item.name} trabalha ${formatRange(start, end)} ${periodLabel(p.from, p.to)} (normal ${formatRange(asb.item.start, asb.item.end)}). Não conta como hora extra.${criticalAfter(ctx.data(), p.from)}` };
    }
    case 'remover_troca_horario': {
      const asb = findAsb(data, str(input.asb), { inactive: true });
      if (!asb.ok) return fail(asb.error);
      const d = dateArg(input.data, today);
      if (isFail(d)) return d;
      const c = (data.shiftChanges ?? []).find((x) => x.asbId === asb.item.id && x.from <= d && d <= x.to);
      if (!c) return fail(`${asb.item.name} não tem troca de horário em ${formatDate(d)}.`);
      const gate = confirmGate(input, `remover a troca de horário de ${asb.item.name} (${periodLabel(c.from, c.to)}, ${formatRange(c.start, c.end)})`);
      if (gate) return gate;
      ctx.apply((x) => { x.shiftChanges = (x.shiftChanges ?? []).filter((y) => y.id !== c.id); });
      return { changed: true, text: `Feito: troca de horário de ${asb.item.name} removida; volta ao horário normal.` };
    }
    case 'cadastrar_folga_dentista': {
      const dent = findDentist(data, str(input.dentista));
      if (!dent.ok) return fail(dent.error);
      const p = periodArgs(input, today);
      if (isFail(p)) return p;
      const reason = (ABSENCE_REASONS.find((r) => r.toLowerCase() === str(input.motivo).toLowerCase()) ?? 'Folga') as AbsenceReason;
      const clash = overlappingDentistAbsences(data, dent.item.id, p.from, p.to);
      if (clash.length > 0) return fail(`${dent.item.name} já tem folga nesse período (${clash.map((c) => periodLabel(c.from, c.to)).join(', ')}).`);
      ctx.apply((x) => { (x.dentistAbsences ?? (x.dentistAbsences = [])).push({ id: newId('dab'), dentistId: dent.item.id, from: p.from, to: p.to, reason }); });
      const day = effectiveDay(ctx.data(), p.from);
      const moved = analyze(ctx.data(), day).filter((a) => a.code === 'remanejada').map((a) => a.message).join(' ');
      return { changed: true, text: `Feito: ${dent.item.name} de folga ${periodLabel(p.from, p.to)} (${reason}). ${moved || 'Ninguém precisou ser remanejada.'}` };
    }
    case 'remover_folga_dentista': {
      const dent = findDentist(data, str(input.dentista));
      if (!dent.ok) return fail(dent.error);
      const d = dateArg(input.data, today);
      if (isFail(d)) return d;
      const a = (data.dentistAbsences ?? []).find((x) => x.dentistId === dent.item.id && x.from <= d && d <= x.to);
      if (!a) return fail(`${dent.item.name} não tem folga em ${formatDate(d)}.`);
      const gate = confirmGate(input, `remover a folga de ${dent.item.name} (${periodLabel(a.from, a.to)})`);
      if (gate) return gate;
      ctx.apply((x) => { x.dentistAbsences = (x.dentistAbsences ?? []).filter((y) => y.id !== a.id); });
      return { changed: true, text: `Feito: folga de ${dent.item.name} removida.` };
    }
    case 'colocar_no_quadro': {
      const asb = findAsb(data, str(input.asb));
      if (!asb.ok) return fail(asb.error);
      const d = dateArg(input.data, today);
      if (isFail(d)) return d;
      const hours = parseHours(input.horas).filter((h) => HOURS.includes(h));
      if (hours.length === 0) return fail('Diga as horas (ex.: [15, 16] para 15h às 17h).');
      const scope = (str(input.escopo) || 'semana') as 'semana' | 'dia' | 'base';
      const dest = str(input.destino).toLowerCase();
      const kindMap: Record<string, SlotKind> = { sala: 'sala', apoio: 'apoio', recepcao: 'recepcao', cme: 'cme', almox: 'almox', almoxarifado: 'almox', almoco: 'almoco' };
      const baseKind = kindMap[dest];
      if (!baseKind) return fail('Destino inválido: sala, apoio, cme, almox ou almoco.');
      let roomId: string | undefined;
      if (baseKind === 'sala' || (baseKind === 'apoio' && str(input.sala))) {
        const room = findRoom(data, str(input.sala));
        if (!room.ok) return fail(baseKind === 'sala' ? 'Diga qual sala. ' + room.error : room.error);
        roomId = room.item.id;
      }
      const onDay = scope === 'base' ? asb.item : dataForDate(data, d).asbs.find((a) => a.id === asb.item.id) ?? asb.item;
      const extras = scope === 'base' ? [] : extraShiftsOn(data, d).filter((e) => e.asbId === asb.item.id);
      const outside = hours.filter((h) => !canAssignOn(onDay, h, extras));
      if (outside.length > 0) return fail(`${asb.item.name} não trabalha às ${outside.map(formatHour).join(', ')} (contrato ${formatRange(onDay.start, onDay.end)}). Se for hora extra, registre antes com cadastrar_hora_extra.`);
      if (scope !== 'base' && absenceFor(data, asb.item.id, d)) return fail(`${asb.item.name} está ausente em ${formatDate(d)}.`);
      const monday = mondayOf(d);
      const day = scope === 'dia' ? effectiveDay(data, d) : null;
      const entriesAt = (h: number): CellTarget[] => {
        if (scope === 'base') return data.base.slots.filter((s) => s.asbId === asb.item.id && s.hour === h).map((s) => ({ kind: s.kind, roomId: s.roomId }));
        if (scope === 'semana') return weekEntriesAt(data, monday, asb.item.id, h);
        return day!.slots.filter((s) => s.hour === h && s.who.type === 'asb' && s.who.asbId === asb.item.id).map((s) => ({ kind: s.kind, roomId: s.roomId }));
      };
      const othersAt = (h: number): Array<{ asbId: string } & CellTarget> => {
        if (scope === 'base') return data.base.slots.filter((s) => s.hour === h && s.asbId !== asb.item.id).map((s) => ({ asbId: s.asbId, kind: s.kind, roomId: s.roomId }));
        if (scope === 'semana') return weekPlanAt(data, monday, h).filter((p) => p.asbId !== asb.item.id);
        return day!.slots.filter((s) => s.hour === h && s.who.type === 'asb' && s.who.asbId !== asb.item.id).map((s) => ({ asbId: (s.who as { asbId: string }).asbId, kind: s.kind, roomId: s.roomId }));
      };
      const add = input.acrescentar === true;
      const done: string[] = [];
      ctx.apply((x) => {
        for (const h of hours) {
          let kind = baseKind;
          if (baseKind === 'sala') {
            const roomHasAsb = othersAt(h).some((o) => o.kind === 'sala' && o.roomId === roomId);
            const inAnotherRoom = entriesAt(h).some((e) => e.kind === 'sala' && e.roomId !== roomId);
            kind = roomDropKind(roomHasAsb, add && inAnotherRoom);
          }
          const target: CellTarget = { kind, roomId: kind === 'sala' || kind === 'apoio' ? roomId : undefined };
          const p = { asbId: asb.item.id, hours: [h], target, mode: add ? ('add' as const) : ('replace' as const) };
          if (scope === 'base') placeInBase(x, p);
          else if (scope === 'semana') placeInWeek(x, monday, p, entriesAt, false);
          else placeInDay(x, d, p, entriesAt, false);
          done.push(`${formatHour(h)} ${kind === 'sala' ? 'ASB da sala' : kind === 'apoio' && roomId ? 'apoio da sala' : SLOT_KIND_LABEL[kind]}`);
        }
      });
      const roomName = roomId ? data.rooms.find((r) => r.id === roomId)?.name : undefined;
      const scopeLabel = scope === 'base' ? 'na escala base' : scope === 'semana' ? `na semana inteira (${formatDate(monday)} a ${formatDate(addDays(monday, 4))})` : `só em ${formatDate(d)}`;
      return { changed: true, text: `Feito: ${asb.item.name}${roomName ? ` na ${roomName}` : ''} ${scopeLabel}: ${done.join(', ')}.${scope === 'base' ? '' : criticalAfter(ctx.data(), d)}` };
    }
    case 'tirar_do_quadro': {
      const asb = findAsb(data, str(input.asb));
      if (!asb.ok) return fail(asb.error);
      const d = dateArg(input.data, today);
      if (isFail(d)) return d;
      const scope = (str(input.escopo) || 'semana') as 'semana' | 'dia' | 'base';
      const hours = input.horas ? parseHours(input.horas).filter((h) => HOURS.includes(h)) : HOURS.filter((h) => h >= asb.item.start && h < asb.item.end);
      if (hours.length === 0) return fail('Diga as horas.');
      const monday = mondayOf(d);
      ctx.apply((x) => {
        if (scope === 'base') x.base.slots = x.base.slots.filter((s) => !(s.asbId === asb.item.id && hours.includes(s.hour)));
        else if (scope === 'semana') setWeekSlots(x, monday, asb.item.id, hours, []);
        else setDaySlots(x, d, asb.item.id, hours, []);
      });
      const scopeLabel = scope === 'base' ? 'na escala base' : scope === 'semana' ? 'na semana inteira' : `só em ${formatDate(d)}`;
      return { changed: true, text: `Feito: ${asb.item.name} sem bloco às ${hours.map(formatHour).join(', ')} ${scopeLabel}.${scope === 'base' ? '' : criticalAfter(ctx.data(), d)}` };
    }
    case 'limpar_ajustes': {
      const d = dateArg(input.data, today);
      if (isFail(d)) return d;
      const scope = str(input.escopo) === 'semana' ? 'semana' : 'dia';
      const monday = mondayOf(d);
      const n = scope === 'semana' ? (data.weekOverrides ?? []).filter((o) => o.week === monday).length : (data.dayOverrides ?? []).filter((o) => o.date === d).length;
      if (n === 0) return { text: scope === 'semana' ? `A semana de ${formatDate(monday)} não tem ajustes.` : `${formatDate(d)} não tem ajustes só do dia.` };
      const gate = confirmGate(input, scope === 'semana' ? `voltar a semana de ${formatDate(monday)} à escala base (${n} blocos ajustados)` : `limpar os ${n} ajustes só do dia ${formatDate(d)}`);
      if (gate) return gate;
      ctx.apply((x) => { if (scope === 'semana') clearWeekOverrides(x, monday); else clearDayOverrides(x, d); });
      return { changed: true, text: `Feito: ${scope === 'semana' ? 'semana de volta à escala base' : 'ajustes do dia limpos'}.` };
    }
    case 'fixar_responsavel': {
      const task = findTask(data, str(input.tarefa));
      if (!task.ok) return fail(task.error);
      const asb = findAsb(data, str(input.asb));
      if (!asb.ok) return fail(asb.error);
      const p = periodArgs(input, today);
      if (isFail(p)) return p;
      const clash = (task.item.holdersByPeriod ?? []).filter((h) => h.from <= p.to && h.to >= p.from);
      if (clash.length > 0) return fail(`${task.item.name} já tem responsável fixo nesse período (${clash.map((h) => `${findAsbAnywhere(data, h.asbId)?.name} ${periodLabel(h.from, h.to)}`).join(', ')}). Remova antes.`);
      ctx.apply((x) => {
        const t = x.tasks.find((y) => y.id === task.item.id);
        if (t) (t.holdersByPeriod ?? (t.holdersByPeriod = [])).push({ id: newId('fix'), asbId: asb.item.id, from: p.from, to: p.to });
      });
      return { changed: true, text: `Feito: ${asb.item.name} fica fixa em "${task.item.name}" ${periodLabel(p.from, p.to)}.` };
    }
    case 'remover_responsavel_fixo': {
      const task = findTask(data, str(input.tarefa));
      if (!task.ok) return fail(task.error);
      const d = dateArg(input.data, today);
      if (isFail(d)) return d;
      const h = (task.item.holdersByPeriod ?? []).find((x) => x.from <= d && d <= x.to);
      if (!h) return fail(`"${task.item.name}" não tem responsável fixo em ${formatDate(d)}.`);
      const gate = confirmGate(input, `tirar ${findAsbAnywhere(data, h.asbId)?.name} de "${task.item.name}" (${periodLabel(h.from, h.to)})`);
      if (gate) return gate;
      ctx.apply((x) => {
        const t = x.tasks.find((y) => y.id === task.item.id);
        if (t) t.holdersByPeriod = (t.holdersByPeriod ?? []).filter((y) => y.id !== h.id);
      });
      return { changed: true, text: `Feito: "${task.item.name}" volta ao rodízio nesse período.` };
    }
    case 'fechar_dia': {
      const d = dateArg(input.data, today);
      if (isFail(d)) return d;
      if ((data.closedDates ?? []).some((c) => c.date === d)) return { text: `${formatDate(d)} já está fechado.` };
      ctx.apply((x) => { (x.closedDates ?? (x.closedDates = [])).push({ date: d, note: str(input.motivo) || undefined }); });
      return { changed: true, text: `Feito: ${formatDate(d)} fechado${str(input.motivo) ? ` (${str(input.motivo)})` : ''}.` };
    }
    case 'reabrir_dia': {
      const d = dateArg(input.data, today);
      if (isFail(d)) return d;
      if (!(data.closedDates ?? []).some((c) => c.date === d)) return { text: `${formatDate(d)} não estava fechado.` };
      ctx.apply((x) => { x.closedDates = (x.closedDates ?? []).filter((c) => c.date !== d); });
      return { changed: true, text: `Feito: ${formatDate(d)} aberto de novo.` };
    }
    case 'desfazer':
      return ctx.undo() ? { changed: true, text: 'Feito: última mudança desfeita.' } : { text: 'Não há nada para desfazer.' };
    default:
      return fail(`Ferramenta desconhecida: ${name}.`);
  }
}
