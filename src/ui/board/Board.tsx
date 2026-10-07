import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  pointerWithin,
  rectIntersection,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { getEventCoordinates } from '@dnd-kit/utilities';
import type { Alert, AppData, Asb, EffectiveDay, EffectiveSlot, IsoDate, SlotKind } from '../../domain';
import {
  HOURS, WEEKDAY_SHORT, addDays, allowedHours, dataForDate, analyze, baseDay, canAssign, canAssignOn, canLunchAt, dentistsAt, lunchWindowOf, effectiveDay, formatBlock, formatDate,
  formatDayMonth, adjustedSlotCount, findAsbAnywhere, formatHour, formatRange, isExternalSubstitute, isTeamSubstitute, isValidIso, mondayOf, proteseAlerts, todayIso, validHours, weekdayOf,
} from '../../domain';
import { addExtraHour, boardExtrasOn, clearDayOverrides, clearSchedule, clearWeekOverrides, copyWeekOverrides, dropDayOverrides, hasDayOverrides, removeSlotAt, setDaySlots, setWeekSlots, type CellTarget, useData, useStore, weekEntriesAt, weekPlanAt } from '../../store/useStore';
import { colorMap, tint } from '../colors';
import { useConfirm } from '../common/Modal';
import { DateInput } from '../common/fields';
import { DayPdfButton } from '../../pdf/PdfButtons';
import { AlertsPanel } from './AlertsPanel';
import { Chip, ChipOverlay, type DragItem } from './Chip';
import { ChoiceDialog, RangeDialog, type Choice } from './RangeDialog';
import { cellKey, columnKeyOf, columnsFor, type Column } from './model';
import { isRoomEntry, placeInBase, placeInDay, placeInWeek, roomDropKind, sameTarget, type PlaceMode } from './placement';

type Mode = 'base' | 'week';
type SlotItem = DragItem & { type: 'slot' };

// Modo, data e alcance ficam lembrados enquanto a página está aberta (ao trocar de tela e voltar).
let lastMode: Mode = 'week';
let lastDate: IsoDate | null = null;
/** O que se arrasta na escala da semana vale para a semana inteira (pedido do cliente) ou só para o dia. */
type Scope = 'week' | 'day';
let lastScope: Scope = 'week';

/** Dias da semana (segunda em diante) em que o CEO abre, com as datas da semana de `date`. */
function weekDaysOf(data: Pick<AppData, 'openDays'>, date: IsoDate): IsoDate[] {
  const monday = mondayOf(date);
  const out: IsoDate[] = [];
  for (let i = 0; i < 7; i++) {
    const d = addDays(monday, i);
    if (data.openDays.includes(weekdayOf(d))) out.push(d);
  }
  return out.length > 0 ? out : [monday];
}

/** A própria data se o CEO abre nesse dia da semana; senão o próximo dia de funcionamento. */
function pickOpenDay(data: Pick<AppData, 'openDays'>, date: IsoDate): IsoDate {
  for (let i = 0; i < 7; i++) {
    const d = addDays(date, i);
    if (data.openDays.includes(weekdayOf(d))) return d;
  }
  return date;
}

/** Data pedida pelo endereço (#/quadro/2026-09-30), por exemplo ao clicar num dia do calendário. */
function dateFromHash(): IsoDate | null {
  const part = window.location.hash.replace(/^#\/?/, '').split('/')[1];
  return part && isValidIso(part) ? part : null;
}

interface CellData {
  type: 'cell';
  column: Column;
  hour: number;
}

interface PaletteDrop {
  type: 'palette';
}

type DropData = CellData | PaletteDrop;

interface PendingRange {
  asbId: string;
  column: Column;
  fromHour: number;
  orig?: SlotItem;
}

interface PendingChoice {
  title: string;
  message: string;
  choices: Choice[];
}

/**
 * Alvo do arraste = o que está de fato visível sob o dedo ou o mouse. Uma célula coberta
 * pela paleta fixa ou fora da área visível do quadro nunca recebe a ficha.
 */
const collision: CollisionDetection = (args) => {
  const p = args.pointerCoordinates;
  if (p && typeof document !== 'undefined') {
    const el = document.elementFromPoint(p.x, p.y);
    if (el) {
      const hit = args.droppableContainers.find((c) => c.node.current?.contains(el));
      return hit ? [{ id: hit.id, data: { droppableContainer: hit, value: 0 } }] : [];
    }
  }
  const within = pointerWithin(args);
  return within.length > 0 ? within : rectIntersection(args);
};

/** Altura do que fica preso no topo da tela: a barra do app (computador) ou a paleta (celular). */
function useStickyTop(): number {
  const [top, setTop] = useState(0);
  useEffect(() => {
    const mobile = window.matchMedia('(max-width: 900px)');
    const measure = () => {
      const el = document.querySelector(mobile.matches ? '.palette' : '.app-header');
      setTop(el ? Math.round(el.getBoundingClientRect().height) : 0);
    };
    measure();
    const ro = new ResizeObserver(measure);
    for (const sel of ['.palette', '.app-header']) {
      const el = document.querySelector(sel);
      if (el) ro.observe(el);
    }
    mobile.addEventListener('change', measure);
    return () => { ro.disconnect(); mobile.removeEventListener('change', measure); };
  }, []);
  return top;
}

function targetOf(column: Column): CellTarget {
  return column.kind === 'sala' ? { kind: 'sala', roomId: column.roomId } : { kind: column.kind };
}

export function Board() {
  const current = useData();
  const apply = useStore((s) => s.apply);
  const confirm = useConfirm();
  const [initial] = useState(() => {
    const fromHash = dateFromHash();
    if (fromHash) {
      window.history.replaceState(null, '', '#/quadro');
      return { mode: 'week' as Mode, date: pickOpenDay(current, fromHash) };
    }
    return { mode: lastMode, date: lastDate ?? pickOpenDay(current, todayIso()) };
  });
  const [mode, setModeState] = useState<Mode>(initial.mode);
  const [date, setDateState] = useState<IsoDate>(initial.date);
  const setMode = (m: Mode) => { lastMode = m; setModeState(m); };
  const setDate = (d: IsoDate) => { lastDate = d; setDateState(d); };
  useEffect(() => { lastMode = initial.mode; lastDate = initial.date; }, [initial]);
  const [rangeMode, setRangeMode] = useState(false);
  const [scope, setScopeState] = useState<Scope>(lastScope);
  const setScope = (s: Scope) => { lastScope = s; setScopeState(s); };
  const monday = useMemo(() => mondayOf(date), [date]);
  const [active, setActive] = useState<DragItem | null>(null);
  const [pending, setPending] = useState<PendingRange | null>(null);
  const [choice, setChoice] = useState<PendingChoice | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const notify = (msg: string) => {
    setFlash(msg);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlash(null), 3000);
  };
  const shiftRef = useRef(false);
  const headRef = useRef<HTMLDivElement>(null);
  const paletteRef = useRef<HTMLElement>(null);
  const overPaletteRef = useRef(false);
  const stickyTop = useStickyTop();

  useEffect(() => {
    const down = (e: KeyboardEvent) => { if (e.key === 'Shift') shiftRef.current = true; };
    const up = (e: KeyboardEvent) => { if (e.key === 'Shift') shiftRef.current = false; };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
  }, []);

  // Escala da semana: cada dia é a escala efetiva da data (base + ausências + ajustes do dia).
  const isDay = mode === 'week';
  const weekDays = useMemo(() => weekDaysOf(current, date), [current, date]);
  // Numa data passada, salas, ASBs e dentistas vêm de como eram naquele dia.
  const data = useMemo(() => (isDay ? dataForDate(current, date) : current), [current, isDay, date]);
  const columns = useMemo(() => columnsFor(data), [data]);
  const colors = useMemo(() => colorMap(data.asbs), [data.asbs]);
  const asbById = useMemo(() => new Map(data.asbs.map((a) => [a.id, a])), [data.asbs]);
  const day: EffectiveDay = useMemo(() => (isDay ? effectiveDay(data, date) : baseDay(data)), [data, isDay, date]);
  const alerts: Alert[] = useMemo(
    () => (isDay ? analyze(data, day) : [...analyze(data, day), ...proteseAlerts(data, todayIso())]),
    [data, day, isDay],
  );
  const readOnly = isDay && !day.open;

  /** Onde a ASB pode ter slot: contrato, ou hora extra na escala da semana. */
  const allowedAt = useCallback(
    (asb: Asb, hour: number) => (isDay ? canAssignOn(asb, hour, day.extraShifts) : canAssign(asb, hour)),
    [isDay, day.extraShifts],
  );

  const slotsByCell = useMemo(() => {
    const m = new Map<string, EffectiveSlot[]>();
    for (const s of day.slots) {
      const k = cellKey(columnKeyOf(s), s.hour);
      const list = m.get(k) ?? [];
      list.push(s);
      m.set(k, list);
    }
    return m;
  }, [day]);

  const cellAlerts = useMemo(() => {
    const m = new Map<string, Alert['level']>();
    for (const a of alerts) {
      if (a.hour === undefined || a.level === 'info') continue;
      if (a.roomId === undefined && a.code !== 'almoco-fora-do-horario') continue;
      const k = a.roomId !== undefined ? cellKey(`sala:${a.roomId}`, a.hour) : cellKey('kind:almoco', a.hour);
      const cur = m.get(k);
      if (cur !== 'critico') m.set(k, a.level);
    }
    return m;
  }, [alerts]);

  const activeAsb: Asb | undefined = active ? asbById.get(active.asbId) : undefined;

  const sensors = useSensors(
    // Mouse e toque separados: no toque, segurar 400 ms começa o arrasto e
    // deslizar antes disso rola a tela normalmente (uma pausa curta não vira arrasto).
    useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 400, tolerance: 8 } }),
    useSensor(KeyboardSensor),
  );

  /** O que a ASB faz nessa hora neste dia, como alvos de célula. */
  const entriesAt = useCallback(
    (asbId: string, hour: number): CellTarget[] =>
      day.slots
        .filter((s) => s.hour === hour && s.who.type === 'asb' && s.who.asbId === asbId)
        .map((s) => ({ kind: s.kind, roomId: s.roomId })),
    [day.slots],
  );
  /** O que a ASB faz nessa hora no plano da semana (base com os ajustes da semana, sem ausências). */
  const weekEntries = useCallback((asbId: string, hour: number): CellTarget[] => weekEntriesAt(data, monday, asbId, hour), [data, monday]);
  /** A ficha veio de algo que só vale neste dia (ajuste do dia, cobertura ou remanejamento do app)? */
  const dayOnlyChip = useCallback(
    (orig: SlotItem) =>
      day.slots.some((s) => s.hour === orig.hour && s.who.type === 'asb' && s.who.asbId === orig.asbId && s.kind === orig.kind && (s.roomId ?? '') === (orig.roomId ?? '') && s.origin !== 'base' && s.origin !== 'week'),
    [day.slots],
  );
  /** Alcance de uma mudança: a semana inteira, a não ser que seja "só este dia" ou uma ficha que só existe neste dia. */
  const scopeFor = useCallback((orig?: SlotItem): Scope => (isDay && scope === 'week' && !(orig && dayOnlyChip(orig)) ? 'week' : 'day'), [isDay, scope, dayOnlyChip]);

  /** A ficha foi posta pelo app (substituta ou remanejamento)? Tirá-la vira "não usar para cobrir aqui". */
  const isAutomatic = useCallback(
    (asbId: string, hour: number, kind: SlotKind, roomId?: string) =>
      day.slots.some((s) => s.hour === hour && s.who.type === 'asb' && s.who.asbId === asbId && s.kind === kind && (s.roomId ?? '') === (roomId ?? '') && (s.origin === 'auto' || s.origin === 'substitute')),
    [day.slots],
  );

  /** Monta a mudança de colocar a ASB nas horas `hours` da coluna (ver placement.ts). */
  const placement = useCallback(
    (asbId: string, hours: number[], column: Column, mode: PlaceMode, orig?: SlotItem, asApoio = false) => {
      const target: CellTarget = asApoio && column.roomId ? { kind: 'apoio', roomId: column.roomId } : targetOf(column);
      const p = { asbId, hours, target, mode, orig };
      if (!isDay) return (d: AppData) => placeInBase(d, p);
      // Mexer numa ficha posta pelo app (substituta ou remanejada) é decisão manual: o app não a recoloca.
      const hold = !!orig && isAutomatic(orig.asbId, orig.hour, orig.kind, orig.roomId);
      if (scopeFor(orig) === 'week') {
        return (d: AppData) => {
          // O que a pessoa manda valer para a semana, estando neste dia, vence um ajuste
          // "só este dia" dela nessas horas (senão nada mudaria na tela e ela não saberia por quê).
          dropDayOverrides(d, date, asbId, orig ? [...hours, orig.hour] : hours);
          placeInWeek(d, monday, p, (h) => weekEntries(asbId, h), hold);
        };
      }
      return (d: AppData) => placeInDay(d, date, p, (h) => entriesAt(asbId, h), hold);
    },
    [isDay, date, monday, entriesAt, weekEntries, isAutomatic, scopeFor],
  );

  const removeChip = useCallback(
    (asbId: string, hour: number, kind: SlotKind, roomId?: string) => {
      if (!isDay) {
        apply((d) => removeSlotAt(d, asbId, hour, kind, roomId));
        return;
      }
      const t: CellTarget = { kind, roomId };
      const hold = isAutomatic(asbId, hour, kind, roomId);
      if (scopeFor({ type: 'slot', asbId, hour, kind, roomId }) === 'week') {
        apply((d) => setWeekSlots(d, monday, asbId, [hour], weekEntries(asbId, hour).filter((e) => !sameTarget(e, t)), { hold }));
        return;
      }
      apply((d) => setDaySlots(d, date, asbId, [hour], entriesAt(asbId, hour).filter((e) => !sameTarget(e, t)), { hold }));
    },
    [apply, isDay, date, monday, entriesAt, weekEntries, isAutomatic, scopeFor],
  );

  /**
   * Coloca a ASB nas horas da coluna, sem perguntas (pedido do cliente).
   * - Coluna de apoio, CME, almoxarifado ou almoço: ela sai de tudo o que fazia nessa hora.
   * - Sala, ficha da lista: acrescenta. Sala livre (e ela sem outra sala) = ASB da sala;
   *   senão apoio. Nada mais muda nessa hora.
   * - Sala, ficha do quadro, na mesma hora: sala com ASB (ou ela em outra sala) = entra de
   *   apoio e continua onde estava; sala livre = muda de lugar. Para outra hora: a ficha
   *   sempre sai da hora de origem. Numa faixa, vale a decisão da primeira hora para todas,
   *   para o resultado não sair misturado.
   * `extraHour`: registra também a hora extra desse bloco, na mesma mudança.
   */
  const decide = (asb: Asb, hours: number[], column: Column, orig?: SlotItem, extraHour?: number) => {
    const target = targetOf(column);
    const weekScope = scopeFor(orig) === 'week';
    const roomHasAsbAt = (h: number) =>
      weekScope
        ? weekPlanAt(data, monday, h).some((x) => x.kind === 'sala' && x.roomId === target.roomId && x.asbId !== asb.id)
        : day.slots.some((x) => x.kind === 'sala' && x.roomId === target.roomId && x.hour === h && !(x.who.type === 'asb' && x.who.asbId === asb.id));
    const inAnotherRoomAt = (h: number) =>
      (weekScope ? weekEntries(asb.id, h) : entriesAt(asb.id, h)).some((x) => isRoomEntry(x) && x.roomId !== target.roomId && !(orig && h === orig.hour && sameTarget(x, { kind: orig.kind, roomId: orig.roomId })));
    const steps: Array<(d: AppData) => void> = [];
    if (target.kind !== 'sala') {
      steps.push(placement(asb.id, hours, column, 'replace', orig));
    } else if (!orig) {
      for (const h of hours) steps.push(placement(asb.id, [h], column, 'add', undefined, roomDropKind(roomHasAsbAt(h), inAnotherRoomAt(h)) === 'apoio'));
    } else {
      const kind = roomDropKind(roomHasAsbAt(hours[0]), inAnotherRoomAt(hours[0]));
      const sameHour = hours.includes(orig.hour);
      steps.push(placement(asb.id, hours, column, kind === 'apoio' && sameHour ? 'add' : 'move', orig, kind === 'apoio'));
    }
    const dayHours = weekScope ? hours.filter((h) => (current.dayOverrides ?? []).some((o) => o.date === date && o.asbId === asb.id && o.hour === h)) : [];
    apply((d) => {
      if (extraHour !== undefined) addExtraHour(d, asb.id, date, extraHour);
      for (const step of steps) step(d);
    });
    if (dayHours.length > 0) notify(`${asb.name} tinha um ajuste "só este dia" às ${dayHours.map(formatHour).join(', ')} em ${formatDayMonth(date)}; ele saiu e vale o da semana.`);
  };

  /**
   * Escala da semana: soltar fora do contrato oferece registrar hora extra nesse bloco. A ficha
   * arrastada do quadro fica onde estava (o gesto é "fica mais uma hora").
   */
  const askExtra = (asb: Asb, column: Column, hour: number, orig?: SlotItem) => {
    setChoice({
      title: 'Fora do horário de contrato',
      message: `${asb.name} trabalha ${formatRange(asb.start, asb.end)}. Registrar hora extra das ${formatHour(hour)} às ${formatHour(hour + 1)} em ${formatDate(date)} e colocá-la em ${column.label}?${
        orig ? ` Ela continua também onde está às ${formatHour(orig.hour)}.` : ''
      }`,
      choices: [
        {
          label: 'Registrar hora extra e colocar',
          hint: 'Aparece em Ausências, extras e trocas de horário e entra no total do mês para pagamento. Sai junto se você limpar os ajustes do dia.',
          primary: true,
          onChoose: () => {
            setChoice(null);
            decide(asb, [hour], column, undefined, hour);
          },
        },
      ],
    });
  };

  const onDragStart = (e: DragStartEvent) => {
    const item = e.active.data.current as DragItem | undefined;
    setActive(item ?? null);
  };

  const onDragEnd = (e: DragEndEvent) => {
    const item = e.active.data.current as DragItem | undefined;
    const over = e.over?.data.current as DropData | undefined;
    const wantRange = rangeMode || shiftRef.current;
    setActive(null);
    if (!item || !over) return;
    const asb = asbById.get(item.asbId);
    if (!asb) return;
    const orig = item.type === 'slot' ? item : undefined;
    if (over.type === 'palette') {
      if (orig) removeChip(orig.asbId, orig.hour, orig.kind, orig.roomId);
      return;
    }
    if (!allowedAt(asb, over.hour)) {
      if (isDay && HOURS.includes(over.hour) && over.column.kind !== 'almoco' && scopeFor(orig) === 'week') notify(`Hora extra é de um dia só: escolha "Só este dia" e solte de novo para registrar a hora extra de ${asb.name} às ${formatHour(over.hour)}.`);
      else if (isDay && HOURS.includes(over.hour) && over.column.kind !== 'almoco') askExtra(asb, over.column, over.hour, orig);
      else notify(`${asb.name} trabalha ${formatRange(asb.start, asb.end)}: às ${formatHour(over.hour)} ela não está no CEO${isDay ? '' : ' (na escala da semana dá para registrar hora extra)'}.`);
      return;
    }
    // Almoço só dentro do horário de almoço (12h–15h por padrão).
    if (over.column.kind === 'almoco' && !canLunchAt(data, over.hour)) {
      const lw = lunchWindowOf(data);
      notify(`Almoço só entre ${formatHour(lw.start)} e ${formatHour(lw.end)} (ajustável em Ajustes).`);
      return;
    }
    if (wantRange && allowedAt(asb, over.hour + 1) && over.column.kind !== 'almoco') {
      setPending({ asbId: asb.id, column: over.column, fromHour: over.hour, orig });
      return;
    }
    // Soltou onde a ASB já está nessa hora (inclusive a própria ficha): nada muda.
    // Evita que um toque demorado ao rolar a tela tire a ASB de um horário sem querer.
    if (entriesAt(asb.id, over.hour).some((x) => columnKeyOf(x) === over.column.key)) return;
    decide(asb, [over.hour], over.column, orig);
  };

  const applyRange = (endHour: number) => {
    if (!pending) return;
    const asb = asbById.get(pending.asbId);
    setPending(null);
    if (!asb) return;
    const hours: number[] = [];
    for (let h = pending.fromHour; h < endHour; h++) hours.push(h);
    decide(asb, hours, pending.column, pending.orig);
  };

  const onClear = async () => {
    if (isDay && scope === 'week' && !readOnly) {
      const n = adjustedSlotCount((current.weekOverrides ?? []).filter((o) => o.week === monday));
      const ok = await confirm({
        title: `Voltar a semana de ${formatDayMonth(weekDays[0])} a ${formatDayMonth(weekDays[weekDays.length - 1])} à escala base?`,
        message: `${n === 1 ? 'O ajuste feito para esta semana sai' : `Os ${n} ajustes feitos para esta semana saem`} e os dias voltam a seguir a escala base (ausências, folgas e ajustes de um dia só continuam). Dá para desfazer no botão Desfazer, no topo.`,
        confirmLabel: 'Voltar à escala base',
        danger: true,
      });
      if (ok) apply((d) => clearWeekOverrides(d, monday));
      return;
    }
    if (isDay) {
      const ok = await confirm({
        title: `Desfazer os ajustes de ${formatDate(date)}?`,
        message: `O dia volta a seguir a escala base (com as ausências e folgas cadastradas).${
          boardExtrasOn(current, date).length > 0
            ? ` As horas extras registradas pelo quadro nesta data também saem: ${boardExtrasOn(current, date).map((e) => `${findAsbAnywhere(current, e.asbId)?.name ?? '?'} ${formatRange(e.start, e.end)}`).join(', ')}.`
            : ''
        } Dá para desfazer no botão Desfazer, no topo.`,
        confirmLabel: 'Limpar ajustes do dia',
        danger: true,
      });
      if (ok) apply((d) => clearDayOverrides(d, date));
      return;
    }
    const ok = await confirm({
      title: 'Limpar a escala base?',
      message: 'Todas as fichas do quadro serão removidas. Dá para desfazer no botão Desfazer, no topo.',
      confirmLabel: 'Limpar',
      danger: true,
    });
    if (ok) apply(clearSchedule);
  };

  const isEmpty = current.asbs.length === 0 && current.base.slots.length === 0;
  if (isEmpty) return <EmptyState />;

  // Quantos horários (ASB e hora) têm ajuste nesta data, inclusive os que deixaram de valer.
  const gridStyle = {
    gridTemplateColumns: `var(--hour-w) repeat(${columns.length}, minmax(var(--cell-min), 1fr))`,
    minWidth: `calc(var(--hour-w) + ${columns.length} * var(--cell-min))`,
  };
  const overridesCount = isDay ? adjustedSlotCount((current.dayOverrides ?? []).filter((o) => o.date === date)) : 0;
  const weekCount = isDay ? adjustedSlotCount((current.weekOverrides ?? []).filter((o) => o.week === monday)) : 0;
  const copyWeek = () => {
    const next = addDays(monday, 7);
    apply((d) => { copyWeekOverrides(d, monday, next); });
    notify(`Ajustes desta semana copiados para a semana de ${formatDayMonth(next)}. Abra a semana seguinte para conferir.`);
  };

  return (
    <div>
      <div className="toolbar">
        <div style={{ display: 'flex', gap: 4 }}>
          <button className={`btn${!isDay ? ' active' : ''}`} onClick={() => setMode('base')}>Escala base</button>
          <button className={`btn${isDay ? ' active' : ''}`} onClick={() => setMode('week')}>Escala da semana</button>
        </div>
        {isDay && (
          <>
            <span className="week-nav">
              <button className="btn icon" onClick={() => setDate(pickOpenDay(current, addDays(mondayOf(date), -7)))} aria-label="Semana anterior" title="Semana anterior">‹</button>
              <strong className="week-label">Semana de {formatDayMonth(weekDays[0])} a {formatDayMonth(weekDays[weekDays.length - 1])}</strong>
              <button className="btn icon" onClick={() => setDate(pickOpenDay(current, addDays(mondayOf(date), 7)))} aria-label="Próxima semana" title="Próxima semana">›</button>
            </span>
            <button className="btn sm" onClick={() => setDate(pickOpenDay(current, todayIso()))} disabled={weekDays.includes(todayIso()) && date === todayIso()}>Hoje</button>
            <DateInput value={date} onChange={(d) => setDate(pickOpenDay(current, d))} ariaLabel="Ir para a data" />
            <DayPdfButton date={date} />
            {!readOnly && (
              <span className="scope-toggle" role="radiogroup" aria-label="O que se arrasta vale para">
                <button className={`btn sm${scope === 'week' ? ' active' : ''}`} onClick={() => setScope('week')} title="Cada ficha que você soltar vale de segunda a sexta desta semana">Vale para a semana inteira</button>
                <button className={`btn sm${scope === 'day' ? ' active' : ''}`} onClick={() => setScope('day')} title="Cada ficha que você soltar vale só para este dia">Só este dia</button>
              </span>
            )}
          </>
        )}
        {readOnly && hasDayOverrides(current, date) && (
          <>
            <span className="spacer" />
            <button className="btn danger" onClick={onClear}>Limpar ajustes do dia ({overridesCount})</button>
          </>
        )}
        {!readOnly && (
          <>
            <button className={`btn${rangeMode ? ' active' : ''}`} onClick={() => setRangeMode((v) => !v)} title="Ao soltar a ficha, pergunta até que horas preencher">
              Preencher em faixa
            </button>
            <span className="muted small hint-shift">ou segure Shift ao soltar</span>
            <span className="spacer" />
            {isDay && weekCount > 0 && (
              <button className="btn sm" onClick={copyWeek} title="Leva os ajustes desta semana para a semana seguinte">Copiar para a próxima semana</button>
            )}
            {isDay && scope === 'week' ? (
              <button className="btn danger" onClick={onClear} disabled={weekCount === 0}>
                Voltar a semana à base{weekCount > 0 ? ` (${weekCount})` : ''}
              </button>
            ) : isDay ? (
              <button className="btn danger" onClick={onClear} disabled={!hasDayOverrides(data, date)}>
                Limpar ajustes do dia{overridesCount > 0 ? ` (${overridesCount})` : ''}
              </button>
            ) : (
              <button className="btn danger" onClick={onClear} disabled={data.base.slots.length === 0}>Limpar escala</button>
            )}
          </>
        )}
      </div>

      {isDay && <DayTabs current={current} days={weekDays} date={date} onPick={setDate} />}
      {flash && <p className="note warn flash" role="status">{flash}</p>}
      {!isDay && <TodayHint current={current} onOpen={() => { setDate(pickOpenDay(current, todayIso())); setMode('week'); }} />}
      {isDay && date < todayIso() && (
        <p className="muted small" style={{ marginTop: -4 }}>
          Dia passado: o quadro mostra a escala como estava nesse dia
          {current.historySince && date < current.historySince ? ` (o registro começou em ${formatDate(current.historySince)}; antes disso vale a escala mais antiga registrada)` : ''}.
          Ajustes aqui servem para registrar o que aconteceu de fato.
        </p>
      )}
      {isDay && <DaySummary day={day} data={data} weekCount={weekCount} scope={scope} />}

      <DndContext
        sensors={sensors}
        collisionDetection={collision}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDragCancel={() => setActive(null)}
        onDragMove={(e) => {
          // Com o dedo sobre a paleta, a página não rola sozinha (a paleta fixa não pode fugir).
          const start = getEventCoordinates(e.activatorEvent);
          const rect = paletteRef.current?.getBoundingClientRect();
          if (!start || !rect) return;
          const x = start.x + e.delta.x;
          const y = start.y + e.delta.y;
          overPaletteRef.current = x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
        }}
        // Rolagem automática só bem perto da borda e devagar: no celular (em pé ou deitado)
        // a coluna da borda precisa poder ser alvo sem o quadro correr para a seguinte.
        autoScroll={{
          threshold: { x: 0.04, y: 0.05 },
          acceleration: 2,
          interval: 15,
          canScroll: (el) => el.classList.contains('board-scroll') || (el === document.scrollingElement && !overPaletteRef.current),
        }}
      >
        <div className="board-layout">
          <div className="board-col">
            {/* Cabeçalho das colunas fora da área que rola de lado: fica preso no topo da tela
                enquanto a página desce, e acompanha a rolagem lateral do quadro. */}
            <div className="board-head" ref={headRef} style={{ top: stickyTop }}>
              <div className="board" style={gridStyle}>
                <div className="hcell">Hora</div>
                {columns.map((c) => (
                  <div key={c.key} className="hcell" style={c.color ? { background: tint(c.color, 0.8) } : undefined}>
                    {c.label}
                  </div>
                ))}
              </div>
            </div>
            <div className="board-scroll" onScroll={(e) => { if (headRef.current) headRef.current.scrollLeft = e.currentTarget.scrollLeft; }}>
            <div className="board" style={gridStyle}>
              {HOURS.map((hour) => (
                <RowCells
                  key={hour}
                  hour={hour}
                  columns={columns}
                  day={day}
                  slotsByCell={slotsByCell}
                  cellAlerts={cellAlerts}
                  activeAsb={activeAsb}
                  allowedAt={allowedAt}
                  lunchOk={canLunchAt(data, hour)}
                  extraOk={isDay && !readOnly && scope === 'day'}
                  colors={colors}
                  asbById={asbById}
                  readOnly={readOnly}
                  onRemove={removeChip}
                />
              ))}
            </div>
            </div>
          </div>
          <Palette ref={paletteRef} day={day} asbs={data.asbs} colors={colors} readOnly={readOnly} isDay={isDay} scope={scope} active={active} alerts={alerts} />
        </div>
        <DragOverlay dropAnimation={null} style={{ pointerEvents: 'none' }}>
          {activeAsb ? <ChipOverlay label={activeAsb.name} color={colors.get(activeAsb.id) ?? '#555'} /> : null}
        </DragOverlay>
      </DndContext>

      <AlertsPanel alerts={alerts} title={isDay ? `Alertas de ${formatDate(date)}` : 'Alertas da escala base'} />

      {pending && asbById.get(pending.asbId) && (
        <RangeDialog
          asb={asbById.get(pending.asbId)!}
          column={pending.column}
          fromHour={pending.fromHour}
          allowed={isDay ? allowedHours(asbById.get(pending.asbId)!, day.extraShifts) : validHours(asbById.get(pending.asbId)!)}
          onPick={applyRange}
          onClose={() => setPending(null)}
        />
      )}
      {choice && <ChoiceDialog title={choice.title} message={choice.message} choices={choice.choices} onClose={() => setChoice(null)} />}
    </div>
  );
}

interface RowProps {
  hour: number;
  columns: Column[];
  day: EffectiveDay;
  slotsByCell: Map<string, EffectiveSlot[]>;
  cellAlerts: Map<string, Alert['level']>;
  activeAsb?: Asb;
  allowedAt: (asb: Asb, hour: number) => boolean;
  /** O almoço pode ser marcado nesta hora? */
  lunchOk: boolean;
  extraOk: boolean;
  colors: Map<string, string>;
  asbById: Map<string, Asb>;
  readOnly: boolean;
  onRemove: (asbId: string, hour: number, kind: SlotKind, roomId?: string) => void;
}

function RowCells({ hour, columns, day, slotsByCell, cellAlerts, activeAsb, allowedAt, lunchOk, extraOk, colors, asbById, readOnly, onRemove }: RowProps) {
  return (
    <>
      <div className="hour" title={formatBlock(hour)}>
        <span className="hour-full">{formatBlock(hour)}</span>
        <span className="hour-short">{formatHour(hour)}</span>
      </div>
      {columns.map((c) => (
        <Cell
          key={c.key}
          column={c}
          hour={hour}
          day={day}
          slots={slotsByCell.get(cellKey(c.key, hour)) ?? []}
          alertLevel={cellAlerts.get(cellKey(c.key, hour))}
          activeAsb={activeAsb}
          allowedAt={allowedAt}
          lunchOk={lunchOk}
          extraOk={extraOk}
          colors={colors}
          asbById={asbById}
          readOnly={readOnly}
          onRemove={onRemove}
        />
      ))}
    </>
  );
}

interface CellProps {
  column: Column;
  hour: number;
  day: EffectiveDay;
  slots: EffectiveSlot[];
  alertLevel?: Alert['level'];
  activeAsb?: Asb;
  allowedAt: (asb: Asb, hour: number) => boolean;
  lunchOk: boolean;
  /** Escala da semana: fora do contrato aceita soltar, oferecendo hora extra. */
  extraOk: boolean;
  colors: Map<string, string>;
  asbById: Map<string, Asb>;
  readOnly: boolean;
  onRemove: (asbId: string, hour: number, kind: SlotKind, roomId?: string) => void;
}

/** Etiqueta visível na ficha: só "apoio" (pedido do cliente: a ficha mostra o nome). */
function slotTag(s: EffectiveSlot): string | undefined {
  return s.kind === 'apoio' && s.roomId ? 'apoio' : undefined;
}

/** O que a ficha não mostra fica na dica (mouse em cima). */
function slotTip(s: EffectiveSlot, asb: Asb, asbById: Map<string, Asb>, freeRoom: boolean): string {
  const parts: string[] = [`${asb.name}, ${formatRange(asb.start, asb.end)}`];
  if (s.coveringFor) parts.push(`cobre ${asbById.get(s.coveringFor)?.name ?? '?'}`);
  if (s.origin === 'auto') parts.push(s.movedFrom || s.movedFromKind ? 'remanejada pelo app' : 'colocada pelo app');
  if (s.origin === 'override') parts.push('colocada só neste dia');
  if (s.extra) parts.push('hora extra');
  if (freeRoom && s.kind === 'sala' && s.origin !== 'auto') parts.push('dentista de folga: disponível para outra sala');
  return parts.join(' · ');
}

function Cell({ column, hour, day, slots, alertLevel, activeAsb, allowedAt, lunchOk, extraOk, colors, asbById, readOnly, onRemove }: CellProps) {
  const valid = activeAsb ? allowedAt(activeAsb, hour) && (column.kind !== 'almoco' || lunchOk) : undefined;
  const asExtra = valid === false && extraOk && column.kind !== 'almoco' && (!activeAsb || !allowedAt(activeAsb, hour));
  // Célula inválida continua recebendo o drop, para o quadro explicar por que não aceitou.
  const { setNodeRef, isOver } = useDroppable({
    id: `cell:${column.key}:${hour}`,
    data: { type: 'cell', column, hour } satisfies CellData,
    disabled: readOnly,
  });
  const dentists = column.roomId ? dentistsAt(day.dentists, column.roomId, hour) : [];
  const off = column.roomId ? dentistsAt(day.dentistsOff, column.roomId, hour) : [];
  const noDentist = column.kind === 'sala' && dentists.length === 0;
  const cls = [
    'cell',
    readOnly ? 'readonly' : '',
    valid === true ? (noDentist ? 'valid no-dentist' : 'valid') : asExtra ? 'extra-ok' : valid === false ? 'invalid' : '',
    isOver && (valid || asExtra) ? 'over' : '',
    alertLevel ? `alert-${alertLevel}` : '',
  ].join(' ');
  const bg = column.color && !alertLevel && valid === undefined ? tint(column.color, 0.93) : undefined;
  const freeRoom = column.kind === 'sala' && dentists.length === 0 && off.length > 0;
  const tip = valid && noDentist
    ? 'Sala sem dentista neste bloco: aceita, mas gera aviso'
    : asExtra
      ? 'Fora do contrato: soltar aqui pergunta se é hora extra'
      : column.kind === 'almoco' && !lunchOk
        ? 'Fora do horário de almoço'
        : undefined;
  return (
    <div ref={setNodeRef} className={cls} style={{ background: bg }} title={tip}>
      {column.kind === 'sala' &&
        (dentists.length > 0 ? (
          <div className="dentist">{dentists.map((d) => `${d.name} (${d.specialty})`).join(', ')}</div>
        ) : off.length > 0 ? (
          <div className="dentist empty">{off.map((d) => d.name).join(', ')} de folga</div>
        ) : (
          <div className="dentist empty">sala vazia</div>
        ))}
      <div className="chips">
        {slots.map((s, i) => {
          if (s.who.type === 'external') {
            const covering = s.coveringFor ? asbById.get(s.coveringFor)?.name : undefined;
            return <Chip key={`ext-${i}`} id={`ext:${column.key}:${hour}:${i}`} label={s.who.name} color="#555" external tag={covering ? `cobre ${covering}` : 'externa'} />;
          }
          const asb = asbById.get(s.who.asbId);
          if (!asb) return null;
          return (
            <Chip
              key={`${asb.id}-${i}`}
              id={`slot:${asb.id}:${hour}:${column.key}`}
              label={asb.name}
              color={colors.get(asb.id) ?? '#555'}
              tag={slotTag(s)}
              item={readOnly ? undefined : { type: 'slot', asbId: asb.id, hour, kind: s.kind, roomId: s.roomId }}
              disabled={readOnly}
              onRemove={readOnly ? undefined : () => onRemove(asb.id, hour, s.kind, s.roomId)}
              title={slotTip(s, asb, asbById, freeRoom)}
            />
          );
        })}
      </div>
    </div>
  );
}

interface PaletteProps {
  ref?: RefObject<HTMLElement | null>;
  day: EffectiveDay;
  asbs: Asb[];
  colors: Map<string, string>;
  readOnly: boolean;
  isDay: boolean;
  scope: Scope;
  active: DragItem | null;
  alerts: Alert[];
}

function Palette({ ref, day, asbs, colors, readOnly, isDay, scope, active, alerts }: PaletteProps) {
  const { setNodeRef, isOver } = useDroppable({ id: 'palette', data: { type: 'palette' } satisfies PaletteDrop, disabled: readOnly || active?.type !== 'slot' });
  const setRefs = (el: HTMLElement | null) => {
    setNodeRef(el);
    if (ref) ref.current = el;
  };
  const sorted = [...asbs].filter((a) => a.active).sort((a, b) => a.start - b.start || a.name.localeCompare(b.name));
  const absenceOf = (id: string) => day.absences.find((x) => x.asbId === id);
  const lunchAlert = new Set(alerts.filter((a) => a.code === 'sem-almoco').map((a) => a.asbId));
  return (
    <aside ref={setRefs} className={`palette${isOver ? ' drop-target' : ''}${active?.type === 'slot' ? ' removing' : ''}`}>
      <div className="card">
        <h3>ASBs</h3>
        <p className="muted small">
          {readOnly
            ? 'O CEO não abre nesse dia.'
            : active?.type === 'slot'
              ? 'Solte aqui para remover.'
              : isDay
                ? `O que você arrastar aqui vale ${scope === 'week' ? 'de segunda a sexta desta semana' : 'só para este dia'}. Da lista para uma sala: acrescenta (ela continua onde estava); sala ocupada vira apoio. Para apoio, CME, almoxarifado ou almoço ela sai de onde estava. ${scope === 'week' ? 'Fora do horário dela: escolha "Só este dia" para registrar hora extra.' : 'Fora do horário dela, pergunta se é hora extra.'}`
                : 'Arraste uma ficha para o quadro. Da lista para uma sala: acrescenta (ela continua onde estava); sala ocupada vira apoio. Para apoio, CME, almoxarifado ou almoço ela sai de onde estava. Ficha do quadro: move, exceto para sala ocupada, onde vira apoio e fica também onde estava.'}
        </p>
        {!readOnly && (
          <p className="muted hint-touch">
            Segure a ficha meio segundo e arraste.{isDay ? (scope === 'week' ? ' Fora do horário dela: escolha "Só este dia" para registrar hora extra.' : ' Fora do horário dela, pergunta se é hora extra.') : ''} Solte na paleta para tirar.
          </p>
        )}
        {active?.type === 'slot' && !readOnly && <span className="palette-drop-badge">Solte aqui para tirar a ficha</span>}
        <div className="palette-list">
          {sorted.map((asb) => {
            const abs = absenceOf(asb.id);
            const hours = new Set(day.slots.filter((s) => s.who.type === 'asb' && s.who.asbId === asb.id).map((s) => s.hour));
            const allowed = isDay ? allowedHours(asb, day.extraShifts) : validHours(asb);
            const total = allowed.length;
            const filled = [...hours].filter((h) => allowed.includes(h)).length;
            const color = colors.get(asb.id) ?? '#555';
            const extras = day.extraShifts.filter((e) => e.asbId === asb.id);
            return (
              <div key={asb.id} className={`palette-item${abs ? ' absent' : ''}`}>
                <Chip id={`pal:${asb.id}`} label={asb.name} color={color} item={readOnly || abs ? undefined : { type: 'palette', asbId: asb.id }} disabled={readOnly || !!abs} />
                <div className="meta">
                  <span>
                    {formatRange(asb.start, asb.end)}{asb.originalHours ? ' (trocado)' : ''}{asb.lunch ? '' : ', sem almoço'}
                    {extras.map((e) => ` + extra ${formatRange(e.start, e.end)}`).join('')}
                  </span>
                  <span className={lunchAlert.has(asb.id) ? 'error' : undefined}>{filled} de {total} blocos</span>
                </div>
                {abs ? (
                  <div className="small muted">
                    Ausente ({abs.reason}).{' '}
                    {isTeamSubstitute(abs) ? `Cobre: ${asbs.find((a) => a.id === abs.substitute.asbId)?.name ?? '?'}` : isExternalSubstitute(abs) ? `Cobre: ${abs.substitute.externalName} (externa)` : 'Sem substituta.'}
                  </div>
                ) : (
                  <div className={`meter${filled >= total && total > 0 ? ' full' : ''}`}>
                    <div style={{ width: `${total ? Math.min(100, (filled / total) * 100) : 0}%` }} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </aside>
  );
}

function DaySummary({ day, data, weekCount, scope }: { day: EffectiveDay; data: AppData; weekCount: number; scope: Scope }) {
  if (!day.open) {
    return (
      <p className="card muted">
        {day.closedNote !== undefined
          ? `CEO fechado nesta data (${day.closedNote}). Os dias fechados ficam em Ajustes.`
          : 'O CEO não abre neste dia da semana. Ajuste os dias de funcionamento em Ajustes.'}
      </p>
    );
  }
  const name = (id: string) => findAsbAnywhere(data, id)?.name ?? '?';
  const items: string[] = [];
  for (const a of day.absences) {
    items.push(
      `${name(a.asbId)} ausente (${a.reason}). ${isTeamSubstitute(a) ? `Cobre ${name(a.substitute.asbId)}.` : isExternalSubstitute(a) ? `Cobre ${a.substitute.externalName} (externa).` : 'Sem substituta.'}`,
    );
  }
  for (const d of day.dentistsOff) {
    const abs = day.dentistAbsences.find((x) => x.dentistId === d.id);
    items.push(`${d.name} de folga${abs ? ` (${abs.reason})` : ''}: a ASB da sala fica livre e é remanejada se outra sala precisar.`);
  }
  for (const e of day.extraShifts) items.push(`${name(e.asbId)} faz hora extra ${formatRange(e.start, e.end)}${e.note ? ` (${e.note})` : ''}.`);
  if (weekCount > 0) items.push(`Esta semana tem ${weekCount} ajuste${weekCount > 1 ? 's' : ''} em relação à escala base (valem de segunda a sexta).`);
  const adjusted = adjustedSlotCount(day.overrides);
  if (adjusted > 0) items.push(`${adjusted} ajuste${adjusted > 1 ? 's' : ''} feito${adjusted > 1 ? 's' : ''} só para este dia.`);
  for (const a of data.asbs) {
    if (a.originalHours) items.push(`${a.name} está com horário trocado: ${formatRange(a.start, a.end)} (normal ${formatRange(a.originalHours.start, a.originalHours.end)})${a.originalHours.note ? `, ${a.originalHours.note}` : ''}.`);
  }
  void scope;
  if (items.length === 0) return <p className="muted small">Sem ausências, folgas ou horas extras nesta data. A semana segue a escala base. O que você arrastar vale para a semana inteira (ou só para este dia, se escolher).</p>;
  return (
    <div className="card" style={{ marginBottom: 12 }}>
      <h3>Este dia</h3>
      <ul style={{ margin: 0, paddingLeft: 18 }}>
        {items.map((t, i) => <li key={i}>{t}</li>)}
      </ul>
    </div>
  );
}

/**
 * Na escala base, lembra o que muda hoje (ausências, folgas, horas extras, ajustes),
 * que só aparece na escala da semana.
 */
function TodayHint({ current, onOpen }: { current: AppData; onOpen: () => void }) {
  const today = todayIso();
  const day = useMemo(() => effectiveDay(current, today), [current, today]);
  const futureDays = useMemo(
    () => new Set((current.dayOverrides ?? []).filter((o) => o.date > today).map((o) => o.date)).size,
    [current.dayOverrides, today],
  );
  const futureWeeks = useMemo(
    () => new Set((current.weekOverrides ?? []).filter((o) => o.week > mondayOf(today)).map((o) => o.week)).size,
    [current.weekOverrides, today],
  );
  const parts: string[] = [];
  if (day.open) {
    if (day.absences.length > 0) parts.push(`${day.absences.length} ausência${day.absences.length > 1 ? 's' : ''}`);
    if (day.dentistsOff.length > 0) parts.push(`${day.dentistsOff.length} dentista${day.dentistsOff.length > 1 ? 's' : ''} de folga`);
    if (day.extraShifts.length > 0) parts.push(`${day.extraShifts.length} hora${day.extraShifts.length > 1 ? 's' : ''} extra${day.extraShifts.length > 1 ? 's' : ''}`);
    if (day.weekOverrides.length > 0) parts.push('ajustes feitos para esta semana');
    if (day.overrides.length > 0) parts.push('ajustes feitos só para hoje');
  }
  const future = [futureWeeks > 0 ? `${futureWeeks} semana${futureWeeks > 1 ? 's' : ''}` : '', futureDays > 0 ? `${futureDays} dia${futureDays > 1 ? 's' : ''}` : ''].filter(Boolean).join(' e ');
  if (parts.length === 0 && !future) return null;
  return (
    <p className="note" style={{ marginTop: -4 }}>
      {parts.length > 0 ? `Hoje (${formatDate(today)}) tem ${parts.join(', ')}. ` : ''}
      Esta é a escala base, que se repete toda semana; o que muda em cada data aparece na escala da semana.
      {future ? ` Há ajustes feitos para ${future} à frente.` : ''}{' '}
      <button className="btn sm" onClick={onOpen}>Ver hoje na escala da semana</button>
    </p>
  );
}

/** Abas dos dias da semana (segunda a sexta, ou os dias de funcionamento), com marca quando o dia tem sala sem ASB. */
function DayTabs({ current, days, date, onPick }: { current: AppData; days: IsoDate[]; date: IsoDate; onPick: (d: IsoDate) => void }) {
  const today = todayIso();
  const marks = useMemo(() => {
    const m = new Map<IsoDate, { critical: number; closed: boolean; note?: string; absences: number }>();
    for (const d of days) {
      const dd = dataForDate(current, d);
      const day = effectiveDay(dd, d);
      const critical = day.open ? analyze(dd, day).filter((a) => a.level === 'critico').length : 0;
      m.set(d, { critical, closed: !day.open, note: day.closedNote, absences: day.absences.length + day.dentistsOff.length });
    }
    return m;
  }, [current, days]);
  return (
    <div className="day-tabs" role="tablist">
      {days.map((d) => {
        const mk = marks.get(d);
        return (
          <button
            key={d}
            role="tab"
            aria-selected={d === date}
            className={`day-tab${d === date ? ' active' : ''}${d === today ? ' today' : ''}${mk?.closed ? ' closed' : ''}`}
            onClick={() => onPick(d)}
            title={mk?.closed ? `CEO fechado${mk.note ? ` (${mk.note})` : ''}` : mk && mk.critical > 0 ? `${mk.critical} alerta${mk.critical > 1 ? 's' : ''} crítico${mk.critical > 1 ? 's' : ''} neste dia` : undefined}
          >
            <span className="day-tab-name">{WEEKDAY_SHORT[weekdayOf(d)]}</span>
            <span className="day-tab-date">{formatDayMonth(d)}</span>
            {mk?.closed ? <span className="day-tab-mark closed">fechado</span> : null}
            {mk && !mk.closed && mk.critical > 0 ? <span className="day-tab-mark bad" aria-label="alertas críticos">{mk.critical}</span> : null}
            {mk && !mk.closed && mk.critical === 0 && mk.absences > 0 ? <span className="day-tab-mark info" aria-label="ausências">{mk.absences}</span> : null}
          </button>
        );
      })}
    </div>
  );
}

function EmptyState() {
  const resetToSeed = useStore((s) => s.resetToSeed);
  const confirm = useConfirm();
  const load = async () => {
    const ok = await confirm({
      title: 'Carregar a escala inicial?',
      message: 'Salas, dentistas, ASBs, tarefas, ausências, folgas e horas extras passam a ser os dos documentos do CEO; o que estiver cadastrado agora é substituído. Dá para desfazer no botão Desfazer, no topo.',
      confirmLabel: 'Carregar escala inicial',
      danger: true,
    });
    if (ok) resetToSeed();
  };
  return (
    <div className="card empty-state">
      <h2>Nenhuma escala cadastrada</h2>
      <p className="muted">Comece pela escala montada a partir dos documentos do CEO. Depois é só ajustar no quadro.</p>
      <button className="btn primary" onClick={load}>Carregar escala inicial dos documentos</button>
    </div>
  );
}
