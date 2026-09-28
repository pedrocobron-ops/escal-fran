import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import type { Alert, AppData, Asb, EffectiveDay, EffectiveSlot, IsoDate, SlotKind } from '../../domain';
import {
  HOURS, WEEKDAY_LABEL, allowedHours, dataForDate, analyze, baseDay, canAssign, canAssignOn, dentistsAt, effectiveDay, formatBlock, formatDate,
  formatHour, formatRange, isExternalSubstitute, isTeamSubstitute, proteseAlerts, todayIso, validHours, weekdayOf,
} from '../../domain';
import {
  clearDayOverrides, clearSchedule, hasDayOverrides, removeSlotAt, setDaySlots, setSlots, useData, useStore, type CellTarget,
} from '../../store/useStore';
import { colorMap, tint } from '../colors';
import { useConfirm } from '../common/Modal';
import { AlertsPanel } from './AlertsPanel';
import { Chip, ChipOverlay, type DragItem } from './Chip';
import { ChoiceDialog, RangeDialog, type Choice } from './RangeDialog';
import { cellKey, columnKeyOf, columnsFor, type Column } from './model';

type Mode = 'base' | 'day';

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
  orig?: DragItem & { type: 'slot' };
}

interface PendingChoice {
  title: string;
  message: string;
  choices: Choice[];
}

const collision: CollisionDetection = (args) => {
  const within = pointerWithin(args);
  return within.length > 0 ? within : rectIntersection(args);
};

function targetOf(column: Column): CellTarget {
  return column.kind === 'sala' ? { kind: 'sala', roomId: column.roomId } : { kind: column.kind };
}

export function Board() {
  const current = useData();
  const apply = useStore((s) => s.apply);
  const confirm = useConfirm();
  const [mode, setMode] = useState<Mode>('base');
  const [date, setDate] = useState<IsoDate>(todayIso());
  const [rangeMode, setRangeMode] = useState(false);
  const [active, setActive] = useState<DragItem | null>(null);
  const [pending, setPending] = useState<PendingRange | null>(null);
  const [choice, setChoice] = useState<PendingChoice | null>(null);
  const shiftRef = useRef(false);

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
    // Mouse e toque separados: no toque, segurar 200 ms começa o arrasto e
    // deslizar antes disso rola a tela normalmente.
    useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
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

  const sameTarget = (a: CellTarget, b: CellTarget) => a.kind === b.kind && (a.roomId ?? '') === (b.roomId ?? '');

  /** Aplica a colocação. `additive` mantém as outras salas da hora (cobrir duas salas). */
  const place = useCallback(
    (asbId: string, hours: number[], column: Column, additive: boolean, orig?: DragItem & { type: 'slot' }, asApoio = false) => {
      const target: CellTarget = asApoio && column.roomId ? { kind: 'apoio', roomId: column.roomId } : targetOf(column);
      if (!isDay) {
        apply((d) => {
          if (orig && !hours.includes(orig.hour)) removeSlotAt(d, asbId, orig.hour, orig.kind, orig.roomId);
          setSlots(d, asbId, hours, target, { additive });
        });
        return;
      }
      apply((d) => {
        if (orig && !hours.includes(orig.hour)) {
          const origTarget: CellTarget = { kind: orig.kind, roomId: orig.roomId };
          setDaySlots(d, date, asbId, [orig.hour], entriesAt(asbId, orig.hour).filter((e) => !sameTarget(e, origTarget)));
        }
        for (const hour of hours) {
          const current = entriesAt(asbId, hour).filter((e) => !sameTarget(e, target));
          const targetIsRoom = target.kind === 'sala' || (target.kind === 'apoio' && !!target.roomId);
          const kept = additive && targetIsRoom ? current.filter((e) => e.kind === 'sala') : [];
          setDaySlots(d, date, asbId, [hour], [...kept, target]);
        }
      });
    },
    [apply, isDay, date, entriesAt],
  );

  const removeChip = useCallback(
    (asbId: string, hour: number, kind: SlotKind, roomId?: string) => {
      if (!isDay) {
        apply((d) => removeSlotAt(d, asbId, hour, kind, roomId));
        return;
      }
      const t: CellTarget = { kind, roomId };
      apply((d) => setDaySlots(d, date, asbId, [hour], entriesAt(asbId, hour).filter((e) => !sameTarget(e, t))));
    },
    [apply, isDay, date, entriesAt],
  );

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
    if (!allowedAt(asb, over.hour)) return;
    if (wantRange && allowedAt(asb, over.hour + 1)) {
      setPending({ asbId: asb.id, column: over.column, fromHour: over.hour, orig });
      return;
    }
    const target = targetOf(over.column);
    const movingSameHour = orig !== undefined && orig.hour === over.hour;
    const roomName = (id?: string) => data.rooms.find((r) => r.id === id)?.name ?? '';
    const otherRooms = target.kind === 'sala' && !movingSameHour
      ? entriesAt(asb.id, over.hour).filter((x) => x.kind === 'sala' && x.roomId !== target.roomId).map((x) => roomName(x.roomId))
      : [];
    // Outra ASB já é a ASB da sala nesse horário?
    const occupants = target.kind === 'sala'
      ? day.slots
          .filter((s) => s.kind === 'sala' && s.roomId === target.roomId && s.hour === over.hour && !(s.who.type === 'asb' && s.who.asbId === asb.id))
          .map((s) => (s.who.type === 'asb' ? asbById.get(s.who.asbId)?.name ?? '' : `${s.who.name} (externa)`))
      : [];
    const room = over.column.label;
    const hourLabel = formatHour(over.hour);
    const go = (additive: boolean, asApoio: boolean) => () => { place(asb.id, [over.hour], over.column, additive, orig, asApoio); setChoice(null); };
    if (occupants.length > 0) {
      const choices: Choice[] = [
        { label: `Apoio da ${room}`, hint: `${asb.name} ajuda na ${room}; ${occupants.join(' e ')} continua como ASB da sala.`, primary: true, onChoose: go(false, true) },
      ];
      if (otherRooms.length > 0) {
        choices.push({ label: `Apoio da ${room} e continuar na ${otherRooms.join(' e ')}`, hint: 'Fica nas duas; gera aviso de sala dividida.', onChoose: go(true, true) });
      }
      choices.push({
        label: `Também como ASB da ${room}`,
        hint: `${otherRooms.length > 0 ? `Sai da ${otherRooms.join(' e ')}. ` : ''}Duas ASBs na mesma sala; gera aviso.`,
        onChoose: go(false, false),
      });
      setChoice({ title: `${room} já tem ASB às ${hourLabel}`, message: `${occupants.join(' e ')} já está na ${room} nesse horário. Como colocar ${asb.name}?`, choices });
      return;
    }
    if (otherRooms.length > 0) {
      setChoice({
        title: `${asb.name} já está em outra sala`,
        message: `Às ${hourLabel}, ${asb.name} está na ${otherRooms.join(' e ')}. O que fazer com a ${room}?`,
        choices: [
          { label: `Mover para a ${room}`, hint: `Sai da ${otherRooms.join(' e ')}.`, primary: true, onChoose: go(false, false) },
          { label: 'Cobrir as duas salas', hint: 'A ficha fica nas duas salas e gera um aviso, para você saber que ela está dividida.', onChoose: go(true, false) },
        ],
      });
      return;
    }
    place(asb.id, [over.hour], over.column, false, orig);
  };

  const applyRange = (endHour: number) => {
    if (!pending) return;
    const hours: number[] = [];
    for (let h = pending.fromHour; h < endHour; h++) hours.push(h);
    place(pending.asbId, hours, pending.column, false, pending.orig);
    setPending(null);
  };

  const onClear = async () => {
    if (isDay) {
      const ok = await confirm({
        title: `Desfazer os ajustes de ${formatDate(date)}?`,
        message: 'O dia volta a seguir a escala base (com as ausências e folgas cadastradas). Dá para desfazer com Ctrl+Z.',
        confirmLabel: 'Limpar ajustes do dia',
        danger: true,
      });
      if (ok) apply((d) => clearDayOverrides(d, date));
      return;
    }
    const ok = await confirm({
      title: 'Limpar a escala base?',
      message: 'Todas as fichas do quadro serão removidas. Dá para desfazer com Ctrl+Z.',
      confirmLabel: 'Limpar',
      danger: true,
    });
    if (ok) apply(clearSchedule);
  };

  const isEmpty = current.asbs.length === 0 && current.base.slots.length === 0;
  if (isEmpty) return <EmptyState />;

  const overridesCount = isDay ? day.overrides.length : 0;

  return (
    <div>
      <div className="toolbar">
        <div style={{ display: 'flex', gap: 4 }}>
          <button className={`btn${!isDay ? ' active' : ''}`} onClick={() => setMode('base')}>Escala base</button>
          <button className={`btn${isDay ? ' active' : ''}`} onClick={() => setMode('day')}>Modo Dia</button>
        </div>
        {isDay && (
          <>
            <input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} aria-label="Data" />
            <span className="muted">
              {WEEKDAY_LABEL[weekdayOf(date)]}, {formatDate(date)}
              {!day.open && ' (CEO fechado)'}
            </span>
          </>
        )}
        {!readOnly && (
          <>
            <button className={`btn${rangeMode ? ' active' : ''}`} onClick={() => setRangeMode((v) => !v)} title="Ao soltar a ficha, pergunta até que horas preencher">
              Preencher em faixa
            </button>
            <span className="muted small hint-shift">ou segure Shift ao soltar</span>
            <span className="spacer" />
            <UndoRedo />
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

      {isDay && date < todayIso() && (
        <p className="muted small" style={{ marginTop: -4 }}>
          Dia passado: o quadro mostra a escala como estava nesse dia
          {current.historySince && date < current.historySince ? ` (o registro começou em ${formatDate(current.historySince)}; antes disso vale a escala mais antiga registrada)` : ''}.
          Ajustes aqui servem para registrar o que aconteceu de fato.
        </p>
      )}
      {isDay && <DaySummary day={day} data={data} />}

      <DndContext sensors={sensors} collisionDetection={collision} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setActive(null)}>
        <div className="board-layout">
          <div className="board-scroll">
            <div className="board" style={{ gridTemplateColumns: `var(--hour-w) repeat(${columns.length}, minmax(var(--cell-min), 1fr))` }}>
              <div className="hcell">Hora</div>
              {columns.map((c) => (
                <div key={c.key} className="hcell" style={c.color ? { background: tint(c.color, 0.8) } : undefined}>
                  {c.label}
                </div>
              ))}
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
                  colors={colors}
                  asbById={asbById}
                  readOnly={readOnly}
                  onRemove={removeChip}
                />
              ))}
            </div>
          </div>
          <Palette day={day} asbs={data.asbs} colors={colors} readOnly={readOnly} isDay={isDay} active={active} alerts={alerts} />
        </div>
        <DragOverlay dropAnimation={null}>
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
  colors: Map<string, string>;
  asbById: Map<string, Asb>;
  readOnly: boolean;
  onRemove: (asbId: string, hour: number, kind: SlotKind, roomId?: string) => void;
}

function RowCells({ hour, columns, day, slotsByCell, cellAlerts, activeAsb, allowedAt, colors, asbById, readOnly, onRemove }: RowProps) {
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
  colors: Map<string, string>;
  asbById: Map<string, Asb>;
  readOnly: boolean;
  onRemove: (asbId: string, hour: number, kind: SlotKind, roomId?: string) => void;
}

function slotTag(s: EffectiveSlot, asbById: Map<string, Asb>): string | undefined {
  const parts: string[] = [];
  if (s.coveringFor) parts.push(`cobre ${asbById.get(s.coveringFor)?.name ?? '?'}`);
  if (s.kind === 'apoio' && s.roomId) parts.push('apoio');
  if (s.origin === 'auto') parts.push(s.movedFrom ? 'remanejada' : 'colocada pelo app');
  if (s.origin === 'override') parts.push('ajuste');
  if (s.extra) parts.push('hora extra');
  return parts.length > 0 ? parts.join(', ') : undefined;
}

function Cell({ column, hour, day, slots, alertLevel, activeAsb, allowedAt, colors, asbById, readOnly, onRemove }: CellProps) {
  const valid = activeAsb ? allowedAt(activeAsb, hour) : undefined;
  const { setNodeRef, isOver } = useDroppable({
    id: `cell:${column.key}:${hour}`,
    data: { type: 'cell', column, hour } satisfies CellData,
    disabled: readOnly || valid === false,
  });
  const dentists = column.roomId ? dentistsAt(day.dentists, column.roomId, hour) : [];
  const off = column.roomId ? dentistsAt(day.dentistsOff, column.roomId, hour) : [];
  const noDentist = column.kind === 'sala' && dentists.length === 0;
  const cls = [
    'cell',
    readOnly ? 'readonly' : '',
    valid === true ? (noDentist ? 'valid no-dentist' : 'valid') : valid === false ? 'invalid' : '',
    isOver && valid ? 'over' : '',
    alertLevel ? `alert-${alertLevel}` : '',
  ].join(' ');
  const bg = column.color && !alertLevel && valid === undefined ? tint(column.color, 0.93) : undefined;
  return (
    <div ref={setNodeRef} className={cls} style={{ background: bg }} title={valid && noDentist ? 'Sala sem dentista neste bloco: aceita, mas gera aviso' : undefined}>
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
              tag={slotTag(s, asbById)}
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
  day: EffectiveDay;
  asbs: Asb[];
  colors: Map<string, string>;
  readOnly: boolean;
  isDay: boolean;
  active: DragItem | null;
  alerts: Alert[];
}

function Palette({ day, asbs, colors, readOnly, isDay, active, alerts }: PaletteProps) {
  const { setNodeRef, isOver } = useDroppable({ id: 'palette', data: { type: 'palette' } satisfies PaletteDrop, disabled: readOnly || active?.type !== 'slot' });
  const sorted = [...asbs].filter((a) => a.active).sort((a, b) => a.start - b.start || a.name.localeCompare(b.name));
  const absenceOf = (id: string) => day.absences.find((x) => x.asbId === id);
  const lunchAlert = new Set(alerts.filter((a) => a.code === 'sem-almoco').map((a) => a.asbId));
  return (
    <aside ref={setNodeRef} className={`palette${isOver ? ' drop-target' : ''}`}>
      <div className="card">
        <h3>ASBs</h3>
        <p className="muted small">
          {readOnly
            ? 'O CEO não abre nesse dia.'
            : active?.type === 'slot'
              ? 'Solte aqui para remover.'
              : isDay
                ? 'Ajustes feitos aqui valem só para esta data.'
                : 'Arraste uma ficha para o quadro. No celular, segure a ficha antes de arrastar.'}
        </p>
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
  if (!day.open) return <p className="card muted">O CEO não abre neste dia da semana. Ajuste os dias de funcionamento em Ajustes.</p>;
  const name = (id: string) => data.asbs.find((a) => a.id === id)?.name ?? id;
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
  if (day.overrides.length > 0) items.push(`${day.overrides.length} ajuste${day.overrides.length > 1 ? 's' : ''} feito${day.overrides.length > 1 ? 's' : ''} só para este dia (fichas tracejadas).`);
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

export function UndoRedo() {
  const past = useStore((s) => s.past.length);
  const future = useStore((s) => s.future.length);
  const undo = useStore((s) => s.undo);
  const redo = useStore((s) => s.redo);
  return (
    <>
      <button className="btn" onClick={undo} disabled={past === 0} title="Ctrl+Z">Desfazer</button>
      <button className="btn" onClick={redo} disabled={future === 0} title="Ctrl+Shift+Z">Refazer</button>
    </>
  );
}

function EmptyState() {
  const resetToSeed = useStore((s) => s.resetToSeed);
  return (
    <div className="card empty-state">
      <h2>Nenhuma escala cadastrada</h2>
      <p className="muted">Comece pela escala montada a partir dos documentos do CEO. Depois é só ajustar no quadro.</p>
      <button className="btn primary" onClick={resetToSeed}>Carregar escala inicial dos documentos</button>
    </div>
  );
}
