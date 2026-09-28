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
  HOURS, WEEKDAY_LABEL, allowedHours, dataForDate, analyze, baseDay, canAssign, canAssignOn, dentistsAt, effectiveDay, formatBlock, formatDate,
  adjustedSlotCount, findAsbAnywhere, formatHour, formatRange, isExternalSubstitute, isTeamSubstitute, isValidIso, proteseAlerts, todayIso, validHours, weekdayOf,
} from '../../domain';
import {
  addExtraHour, boardExtrasOn, clearDayOverrides, clearSchedule, hasDayOverrides, removeSlotAt, setDaySlots, useData, useStore, type CellTarget,
} from '../../store/useStore';
import { colorMap, tint } from '../colors';
import { useConfirm } from '../common/Modal';
import { DateInput } from '../common/fields';
import { DayPdfButton } from '../../pdf/PdfButtons';
import { AlertsPanel } from './AlertsPanel';
import { Chip, ChipOverlay, type DragItem } from './Chip';
import { ChoiceDialog, RangeDialog, type Choice } from './RangeDialog';
import { cellKey, columnKeyOf, columnsFor, type Column } from './model';
import { isRoomEntry, placeInBase, placeInDay, sameTarget } from './placement';

type Mode = 'base' | 'day';
type SlotItem = DragItem & { type: 'slot' };

// Modo e data ficam lembrados enquanto a página está aberta (ao trocar de tela e voltar).
let lastMode: Mode = 'base';
let lastDate: IsoDate | null = null;

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
      return { mode: 'day' as Mode, date: fromHash };
    }
    return { mode: lastMode, date: lastDate ?? todayIso() };
  });
  const [mode, setModeState] = useState<Mode>(initial.mode);
  const [date, setDateState] = useState<IsoDate>(initial.date);
  const setMode = (m: Mode) => { lastMode = m; setModeState(m); };
  const setDate = (d: IsoDate) => { lastDate = d; setDateState(d); };
  useEffect(() => { lastMode = initial.mode; lastDate = initial.date; }, [initial]);
  const [rangeMode, setRangeMode] = useState(false);
  const [active, setActive] = useState<DragItem | null>(null);
  const [pending, setPending] = useState<PendingRange | null>(null);
  const [choice, setChoice] = useState<PendingChoice | null>(null);
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

  const isDay = mode === 'day';
  // No Modo Dia de uma data passada, salas, ASBs e dentistas vêm de como eram naquele dia.
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

  /** Onde a ASB pode ter slot: contrato, ou hora extra no Modo Dia. */
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
      if (a.roomId === undefined || a.hour === undefined || a.level === 'info') continue;
      const k = cellKey(`sala:${a.roomId}`, a.hour);
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

  /** O que a ASB faz nessa hora hoje (Modo Dia), como alvos de célula. */
  const entriesAt = useCallback(
    (asbId: string, hour: number): CellTarget[] =>
      day.slots
        .filter((s) => s.hour === hour && s.who.type === 'asb' && s.who.asbId === asbId)
        .map((s) => ({ kind: s.kind, roomId: s.roomId })),
    [day.slots],
  );

  const roomName = useCallback((id?: string) => data.rooms.find((r) => r.id === id)?.name ?? '', [data.rooms]);
  /** "na Sala 1" / "no apoio da Sala 1" e "da Sala 1" / "do apoio da Sala 1". */
  const inPlace = (x: CellTarget) => (x.kind === 'sala' ? `na ${roomName(x.roomId)}` : `no apoio da ${roomName(x.roomId)}`);
  const fromPlace = (x: CellTarget) => (x.kind === 'sala' ? `da ${roomName(x.roomId)}` : `do apoio da ${roomName(x.roomId)}`);

  /** A ficha foi posta pelo app (substituta ou remanejamento)? Tirá-la vira "não usar para cobrir aqui". */
  const isAutomatic = useCallback(
    (asbId: string, hour: number, kind: SlotKind, roomId?: string) =>
      day.slots.some((s) => s.hour === hour && s.who.type === 'asb' && s.who.asbId === asbId && s.kind === kind && (s.roomId ?? '') === (roomId ?? '') && (s.origin === 'auto' || s.origin === 'substitute')),
    [day.slots],
  );

  /** Monta a mudança de colocar a ASB nas horas `hours` da coluna (ver placement.ts). */
  const placement = useCallback(
    (asbId: string, hours: number[], column: Column, additive: boolean, orig?: SlotItem, asApoio = false) => {
      const target: CellTarget = asApoio && column.roomId ? { kind: 'apoio', roomId: column.roomId } : targetOf(column);
      const p = { asbId, hours, target, additive, orig };
      if (!isDay) return (d: AppData) => placeInBase(d, p);
      // Mexer numa ficha posta pelo app (substituta ou remanejada) é decisão manual: o app não a recoloca.
      const hold = !!orig && isAutomatic(orig.asbId, orig.hour, orig.kind, orig.roomId);
      return (d: AppData) => placeInDay(d, date, p, (h) => entriesAt(asbId, h), hold);
    },
    [isDay, date, entriesAt, isAutomatic],
  );

  const removeChip = useCallback(
    (asbId: string, hour: number, kind: SlotKind, roomId?: string) => {
      if (!isDay) {
        apply((d) => removeSlotAt(d, asbId, hour, kind, roomId));
        return;
      }
      const t: CellTarget = { kind, roomId };
      const hold = isAutomatic(asbId, hour, kind, roomId);
      apply((d) => setDaySlots(d, date, asbId, [hour], entriesAt(asbId, hour).filter((e) => !sameTarget(e, t)), { hold }));
    },
    [apply, isDay, date, entriesAt, isAutomatic],
  );

  /** Horas como texto: "às 10h" ou "das 08h às 11h". */
  const whenText = (hours: number[]) =>
    hours.length === 1 ? `às ${formatHour(hours[0])}` : `das ${formatHour(hours[0])} às ${formatHour(hours[hours.length - 1] + 1)}`;

  /**
   * Coloca a ASB nas horas da coluna, perguntando antes quando a sala já tem ASB
   * ou quando ela está em outra sala nesses horários (vale para arraste simples, faixa
   * e hora extra). `extraHour`: registra também a hora extra desse bloco, na mesma mudança.
   */
  const decide = (asb: Asb, hours: number[], column: Column, orig?: SlotItem, extraHour?: number) => {
    const target = targetOf(column);
    const others: CellTarget[] = [];
    const occupants = new Set<string>();
    const occupied = new Set<number>();
    if (target.kind === 'sala') {
      for (const h of hours) {
        // Trocar uma ficha de lugar na mesma hora mantém os outros lugares: não pergunta.
        if (!(orig && h === orig.hour)) {
          for (const x of entriesAt(asb.id, h)) {
            if (isRoomEntry(x) && x.roomId !== target.roomId && !others.some((o) => sameTarget(o, x))) others.push(x);
          }
        }
        for (const s of day.slots) {
          if (s.kind !== 'sala' || s.roomId !== target.roomId || s.hour !== h) continue;
          if (s.who.type === 'asb' && s.who.asbId === asb.id) continue;
          occupants.add(s.who.type === 'asb' ? asbById.get(s.who.asbId)?.name ?? '' : `${s.who.name} (externa)`);
          occupied.add(h);
        }
      }
    }
    const room = column.label;
    const when = whenText(hours);
    const range = hours.length > 1;
    const occ = [...occupants].join(' e ');
    const many = occupants.size > 1;
    const stay = others.map(inPlace).join(' e ');
    const leave = others.map(fromPlace).join(' e ');
    // Apoio só faz sentido onde a sala tem ASB; nas outras horas da faixa ela entra como ASB da sala.
    const freeHours = hours.filter((h) => !occupied.has(h));
    const go = (additive: boolean, asApoio: boolean) => () => {
      setChoice(null);
      const steps =
        asApoio && freeHours.length > 0
          ? [placement(asb.id, hours.filter((h) => occupied.has(h)), column, additive, orig, true), placement(asb.id, freeHours, column, additive, orig, false)]
          : [placement(asb.id, hours, column, additive, orig, asApoio)];
      apply((d) => {
        if (extraHour !== undefined) addExtraHour(d, asb.id, date, extraHour);
        for (const step of steps) step(d);
      });
    };
    const freeNote = freeHours.length > 0 ? ` ${whenText(freeHours)[0].toUpperCase()}${whenText(freeHours).slice(1)}, sem ASB na sala, ela entra como ASB da sala.` : '';
    if (occupants.size > 0) {
      const choices: Choice[] = [
        {
          label: `Apoio da ${room}`,
          hint: `${asb.name} ajuda na ${room}; ${occ} ${many ? 'continuam' : 'continua'} como ASB da sala.${freeNote}${others.length > 0 ? ` Sai ${leave}.` : ''}`,
          primary: true,
          onChoose: go(false, true),
        },
      ];
      if (others.length > 0) {
        choices.push({ label: `Apoio da ${room} e continuar ${stay}`, hint: `Fica nas duas; gera aviso de sala dividida.${freeNote}`, onChoose: go(true, true) });
      }
      choices.push({
        label: `Também como ASB da ${room}`,
        hint: `${others.length > 0 ? `Sai ${leave}. ` : ''}Duas ASBs na mesma sala; gera aviso.`,
        onChoose: go(false, false),
      });
      setChoice({
        title: `${room} já tem ASB ${range ? 'nesse horário' : when}`,
        message: range
          ? `Entre ${formatHour(hours[0])} e ${formatHour(hours[hours.length - 1] + 1)}, ${occ} já ${many ? 'estão' : 'está'} na ${room} (em todo ou em parte do horário). Como colocar ${asb.name}?`
          : `${occ} já ${many ? 'estão' : 'está'} na ${room} ${when}. Como colocar ${asb.name}?`,
        choices,
      });
      return;
    }
    if (others.length > 0) {
      setChoice({
        title: `${asb.name} já está em outra sala`,
        message: range
          ? `Entre ${formatHour(hours[0])} e ${formatHour(hours[hours.length - 1] + 1)}, ${asb.name} está ${stay} (em todo ou em parte do horário). O que fazer com a ${room}?`
          : `${when[0].toUpperCase()}${when.slice(1)}, ${asb.name} está ${stay}. O que fazer com a ${room}?`,
        choices: [
          { label: `Mover para a ${room}`, hint: `Sai ${leave}.`, primary: true, onChoose: go(false, false) },
          { label: 'Cobrir as duas salas', hint: 'A ficha fica nas duas salas e gera um aviso, para você saber que ela está dividida.', onChoose: go(true, false) },
        ],
      });
      return;
    }
    go(false, false)();
  };

  /**
   * Modo Dia: soltar fora do contrato oferece registrar hora extra nesse bloco. A ficha
   * arrastada do quadro fica onde estava (o gesto é "fica mais uma hora"), e a sala de
   * destino passa pelas mesmas perguntas de sala ocupada.
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
          hint: 'Aparece em Ausências e extras e entra no total do mês para pagamento. Sai junto se você limpar os ajustes do dia.',
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
      if (isDay && HOURS.includes(over.hour)) askExtra(asb, over.column, over.hour, orig);
      return;
    }
    if (wantRange && allowedAt(asb, over.hour + 1)) {
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

  return (
    <div>
      <div className="toolbar">
        <div style={{ display: 'flex', gap: 4 }}>
          <button className={`btn${!isDay ? ' active' : ''}`} onClick={() => setMode('base')}>Escala base</button>
          <button className={`btn${isDay ? ' active' : ''}`} onClick={() => setMode('day')}>Modo Dia</button>
        </div>
        {isDay && (
          <>
            <DateInput value={date} onChange={setDate} ariaLabel="Data" />
            <span className="muted">
              {WEEKDAY_LABEL[weekdayOf(date)]}, {formatDate(date)}
              {!day.open && ' (CEO fechado)'}
            </span>
            <DayPdfButton date={date} />
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
            {isDay ? (
              <button className="btn danger" onClick={onClear} disabled={!hasDayOverrides(data, date)}>
                Limpar ajustes do dia{overridesCount > 0 ? ` (${overridesCount})` : ''}
              </button>
            ) : (
              <button className="btn danger" onClick={onClear} disabled={data.base.slots.length === 0}>Limpar escala</button>
            )}
          </>
        )}
      </div>

      {!isDay && <TodayHint current={current} onOpen={() => { setDate(todayIso()); setMode('day'); }} />}
      {isDay && date < todayIso() && (
        <p className="muted small" style={{ marginTop: -4 }}>
          Dia passado: o quadro mostra a escala como estava nesse dia
          {current.historySince && date < current.historySince ? ` (o registro começou em ${formatDate(current.historySince)}; antes disso vale a escala mais antiga registrada)` : ''}.
          Ajustes aqui servem para registrar o que aconteceu de fato.
        </p>
      )}
      {isDay && <DaySummary day={day} data={data} />}

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
          threshold: { x: 0.04, y: 0.06 },
          acceleration: 3,
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
                  extraOk={isDay && !readOnly}
                  colors={colors}
                  asbById={asbById}
                  readOnly={readOnly}
                  onRemove={removeChip}
                />
              ))}
            </div>
            </div>
          </div>
          <Palette ref={paletteRef} day={day} asbs={data.asbs} colors={colors} readOnly={readOnly} isDay={isDay} active={active} alerts={alerts} />
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
  extraOk: boolean;
  colors: Map<string, string>;
  asbById: Map<string, Asb>;
  readOnly: boolean;
  onRemove: (asbId: string, hour: number, kind: SlotKind, roomId?: string) => void;
}

function RowCells({ hour, columns, day, slotsByCell, cellAlerts, activeAsb, allowedAt, extraOk, colors, asbById, readOnly, onRemove }: RowProps) {
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
  /** Modo Dia: fora do contrato aceita soltar, oferecendo hora extra. */
  extraOk: boolean;
  colors: Map<string, string>;
  asbById: Map<string, Asb>;
  readOnly: boolean;
  onRemove: (asbId: string, hour: number, kind: SlotKind, roomId?: string) => void;
}

function slotTag(s: EffectiveSlot, asbById: Map<string, Asb>, freeRoom: boolean): string | undefined {
  const parts: string[] = [];
  if (s.coveringFor) parts.push(`cobre ${asbById.get(s.coveringFor)?.name ?? '?'}`);
  if (s.kind === 'apoio' && s.roomId) parts.push('apoio');
  if (s.origin === 'auto') parts.push(s.movedFrom || s.movedFromKind ? 'remanejada' : 'colocada pelo app');
  if (s.origin === 'override') parts.push('ajuste');
  if (s.extra) parts.push('hora extra');
  // Dentista de folga: a ASB fica na sala dela, mas está livre para ser usada em outro lugar.
  if (freeRoom && s.kind === 'sala' && s.origin !== 'auto') parts.push('disponível');
  return parts.length > 0 ? parts.join(', ') : undefined;
}

function Cell({ column, hour, day, slots, alertLevel, activeAsb, allowedAt, extraOk, colors, asbById, readOnly, onRemove }: CellProps) {
  const valid = activeAsb ? allowedAt(activeAsb, hour) : undefined;
  const asExtra = valid === false && extraOk && column.kind !== 'almoco';
  const { setNodeRef, isOver } = useDroppable({
    id: `cell:${column.key}:${hour}`,
    data: { type: 'cell', column, hour } satisfies CellData,
    disabled: readOnly || (valid === false && !asExtra),
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
  const tip = valid && noDentist ? 'Sala sem dentista neste bloco: aceita, mas gera aviso' : asExtra ? 'Fora do contrato: soltar aqui pergunta se é hora extra' : undefined;
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
              tag={slotTag(s, asbById, freeRoom)}
              origin={s.origin}
              item={readOnly ? undefined : { type: 'slot', asbId: asb.id, hour, kind: s.kind, roomId: s.roomId }}
              disabled={readOnly}
              onRemove={readOnly ? undefined : () => onRemove(asb.id, hour, s.kind, s.roomId)}
              title={`${asb.name}, ${formatRange(asb.start, asb.end)}`}
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
  active: DragItem | null;
  alerts: Alert[];
}

function Palette({ ref, day, asbs, colors, readOnly, isDay, active, alerts }: PaletteProps) {
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
                ? 'Ajustes feitos aqui valem só para esta data. Soltar fora do horário da ASB pergunta se é hora extra.'
                : 'Arraste uma ficha para o quadro. No celular, segure a ficha antes de arrastar. Para a mesma ASB cobrir duas salas, solte na segunda sala e escolha Cobrir as duas.'}
        </p>
        {!readOnly && (
          <p className="muted hint-touch">
            Segure a ficha meio segundo e arraste.{isDay ? ' Fora do horário dela, pergunta se é hora extra.' : ''} Solte na paleta para tirar.
          </p>
        )}
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
                    {formatRange(asb.start, asb.end)}{asb.lunch ? '' : ', sem almoço'}
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

function DaySummary({ day, data }: { day: EffectiveDay; data: AppData }) {
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
  const adjusted = adjustedSlotCount(day.overrides);
  if (adjusted > 0) items.push(`${adjusted} ajuste${adjusted > 1 ? 's' : ''} feito${adjusted > 1 ? 's' : ''} só para este dia (fichas tracejadas).`);
  if (items.length === 0) return <p className="muted small">Sem ausências, folgas ou horas extras nesta data. O dia segue a escala base. Arraste fichas para ajustar só este dia.</p>;
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
 * que só aparece no Modo Dia.
 */
function TodayHint({ current, onOpen }: { current: AppData; onOpen: () => void }) {
  const today = todayIso();
  const day = useMemo(() => effectiveDay(current, today), [current, today]);
  const futureAdjusted = useMemo(
    () => new Set((current.dayOverrides ?? []).filter((o) => o.date > today).map((o) => o.date)).size,
    [current.dayOverrides, today],
  );
  const parts: string[] = [];
  if (day.open) {
    if (day.absences.length > 0) parts.push(`${day.absences.length} ausência${day.absences.length > 1 ? 's' : ''}`);
    if (day.dentistsOff.length > 0) parts.push(`${day.dentistsOff.length} dentista${day.dentistsOff.length > 1 ? 's' : ''} de folga`);
    if (day.extraShifts.length > 0) parts.push(`${day.extraShifts.length} hora${day.extraShifts.length > 1 ? 's' : ''} extra${day.extraShifts.length > 1 ? 's' : ''}`);
    if (day.overrides.length > 0) parts.push('ajustes feitos para hoje');
  }
  if (parts.length === 0 && futureAdjusted === 0) return null;
  return (
    <p className="note" style={{ marginTop: -4 }}>
      {parts.length > 0 ? `Hoje (${formatDate(today)}) tem ${parts.join(', ')}. ` : ''}
      Esta é a escala base, que se repete toda semana; o que muda em cada data aparece no Modo Dia.
      {futureAdjusted > 0 ? ` Há ajustes feitos para ${futureAdjusted} dia${futureAdjusted > 1 ? 's' : ''} à frente.` : ''}{' '}
      <button className="btn sm" onClick={onOpen}>Ver hoje no Modo Dia</button>
    </p>
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
