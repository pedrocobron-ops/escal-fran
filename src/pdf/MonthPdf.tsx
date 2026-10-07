import { Document, Page, Text, View } from '@react-pdf/renderer';
import type { MonthPdfModel } from './model';
import { pdfStyles as s } from './styles';

function Footer({ text }: { text: string }) {
  return (
    <View style={s.footer} fixed>
      <Text>{text}</Text>
      <Text render={({ pageNumber, totalPages }) => `Página ${pageNumber} de ${totalPages}`} />
    </View>
  );
}

function Header({ m }: { m: MonthPdfModel }) {
  return (
    <View>
      <Text style={s.title}>{m.title}</Text>
      <Text style={s.subtitle}>{capitalize(m.monthLabel)}</Text>
      <Text style={s.meta}>{m.hoursLabel}</Text>
      {m.closedDays && <Text style={[s.meta, { marginTop: -6 }]}>{m.closedDays}</Text>}
    </View>
  );
}

/** "SEM ASB" em destaque (branco no preto); o resto da célula em negrito. */
export function AsbText({ text }: { text: string }) {
  if (!text.startsWith('SEM ASB')) return <Text style={s.bold}>{text}</Text>;
  return (
    <Text>
      <Text style={s.alarm}> SEM ASB </Text>
      <Text style={s.bold}>{text.slice('SEM ASB'.length)}</Text>
    </Text>
  );
}

function capitalize(t: string): string {
  return t.charAt(0).toUpperCase() + t.slice(1);
}

export function MonthPdf({ m }: { m: MonthPdfModel }) {
  const weekCols = m.weekHeaders.length;
  return (
    <Document title={`${m.title} ${m.monthLabel}`} author="Escala CEO" language="pt-BR">
      <Page size="A4" orientation="landscape" style={s.page}>
        <Header m={m} />

        <Text style={s.h2}>1. Escala base diária das ASBs</Text>
        <View style={s.table}>
          <View style={[s.row, s.head]} fixed>
            <Text style={[s.cell, { flexBasis: 70, flexGrow: 0 }]}>ASB</Text>
            <Text style={[s.cell, { flexBasis: 60, flexGrow: 0 }]}>Contrato</Text>
            <Text style={s.cell}>Manhã (07h–13h)</Text>
            <Text style={[s.cell, { flexBasis: 60, flexGrow: 0 }]}>Almoço</Text>
            <Text style={s.cell}>Tarde (13h–19h)</Text>
          </View>
          {m.asbRows.map((r) => (
            <View style={s.row} key={r.name} wrap={false}>
              <Text style={[s.cell, s.bold, { flexBasis: 70, flexGrow: 0 }]}>{r.name}</Text>
              <Text style={[s.cell, { flexBasis: 60, flexGrow: 0 }]}>{r.contract}</Text>
              <Text style={s.cell}>{r.morning}</Text>
              <Text style={[s.cell, { flexBasis: 60, flexGrow: 0 }, r.lunch === 'sem bloco' ? s.warn : {}]}>{r.lunch}</Text>
              <Text style={s.cell}>{r.afternoon}</Text>
            </View>
          ))}
        </View>

        <View>
        <Text style={s.h2} minPresenceAhead={90}>2. Ocupação das salas por horário</Text>
        <View style={s.table}>
          <View style={[s.row, s.head]} fixed>
            <Text style={[s.cell, { flexBasis: 60, flexGrow: 0 }]}>Horário</Text>
            {m.roomNames.map((n) => <Text key={n} style={s.cell}>{n}</Text>)}
          </View>
          {m.roomRows.map((r) => (
            <View style={s.row} key={r.hour} wrap={false}>
              <Text style={[s.cell, s.bold, { flexBasis: 60, flexGrow: 0 }]}>{r.hour}</Text>
              {r.cells.map((c, i) => (
                <View key={i} style={s.cell}>
                  <Text style={c.dentist === 'sala vazia' ? s.muted : {}}>{c.dentist}</Text>
                  {c.asb ? <AsbText text={c.asb} /> : null}
                </View>
              ))}
            </View>
          ))}
        </View>
        </View>

        <Text style={s.h2} minPresenceAhead={60}>3. Rodízio de tarefas especiais</Text>
        {m.weeklyRows.length === 0 ? (
          <Text style={s.muted}>Nenhum rodízio semanal cadastrado.</Text>
        ) : (
          <View style={s.table}>
            <View style={[s.row, s.head]} fixed>
              <Text style={[s.cell, { flexBasis: 150, flexGrow: 0 }]}>Tarefa</Text>
              {m.weekHeaders.map((h) => <Text key={h} style={s.cell}>{h}</Text>)}
            </View>
            {m.weeklyRows.map((r) => (
              <View style={s.row} key={r.task} wrap={false}>
                <View style={[s.cell, { flexBasis: 150, flexGrow: 0 }]}>
                  <Text style={s.bold}>{r.task}</Text>
                  <Text style={[s.small, s.muted]}>{r.when}</Text>
                </View>
                {r.cells.map((c, i) => <Text key={i} style={s.cell}>{c}</Text>)}
              </View>
            ))}
          </View>
        )}
        {m.monthlyRows.length > 0 && (
          <View style={[s.table, { marginTop: 6 }]}>
            <View style={[s.row, s.head]} fixed>
              <Text style={[s.cell, { flexBasis: 150, flexGrow: 0 }]}>Tarefa mensal</Text>
              <Text style={s.cell}>Responsável no mês</Text>
            </View>
            {m.monthlyRows.map((r) => (
              <View style={s.row} key={r.task} wrap={false}>
                <View style={[s.cell, { flexBasis: 150, flexGrow: 0 }]}>
                  <Text style={s.bold}>{r.task}</Text>
                  <Text style={[s.small, s.muted]}>{r.when}</Text>
                </View>
                <Text style={s.cell}>{r.holder}</Text>
              </View>
            ))}
          </View>
        )}
        <Text style={[s.small, s.muted, { marginTop: 3 }]}>Semanas contadas de segunda a sexta. {weekCols} semana{weekCols > 1 ? 's' : ''} tocam o mês.</Text>

        {m.taskRows.length > 0 && (
          <View style={[s.table, { marginTop: 6 }]} minPresenceAhead={60}>
            <View style={[s.row, s.head]} fixed>
              <Text style={[s.cell, { flexBasis: 150, flexGrow: 0 }]}>Tarefa diária</Text>
              <Text style={s.cell}>Quem faz no mês</Text>
            </View>
            {m.taskRows.map((r) => (
              <View style={s.row} key={r.task} wrap={false}>
                <View style={[s.cell, { flexBasis: 150, flexGrow: 0 }]}>
                  <Text style={s.bold}>{r.task}</Text>
                  <Text style={[s.small, s.muted]}>{r.when}</Text>
                </View>
                <Text style={s.cell}>{r.who}</Text>
              </View>
            ))}
          </View>
        )}

        <View>
          <Text style={s.h2} minPresenceAhead={40}>4. Regras fixas</Text>
          {m.rules.map((r, i) => (
            <View key={i} style={s.bullet}>
              <Text style={s.bulletDot}>•</Text>
              <Text style={s.bulletText}>{r}</Text>
            </View>
          ))}
        </View>

        {m.absences.length > 0 && (
          <View>
            <Text style={s.h2} minPresenceAhead={60}>5. Ausências e coberturas do mês</Text>
            <View style={s.table}>
              <View style={[s.row, s.head]} fixed>
                <Text style={s.cell}>ASB</Text>
                <Text style={s.cell}>Período</Text>
                <Text style={s.cell}>Motivo</Text>
                <Text style={s.cell}>Quem cobre</Text>
              </View>
              {m.absences.map((a, i) => (
                <View style={s.row} key={i} wrap={false}>
                  <Text style={[s.cell, s.bold]}>{a.asb}</Text>
                  <Text style={s.cell}>{a.period}</Text>
                  <Text style={s.cell}>{a.reason}</Text>
                  <Text style={s.cell}>{a.cover}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {m.dentistAbsences.length > 0 && (
          <View wrap={false}>
            <Text style={s.h2}>{m.absences.length > 0 ? '6' : '5'}. Folgas de dentista do mês</Text>
            <View style={s.table}>
              <View style={[s.row, s.head]} fixed>
                <Text style={s.cell}>Dentista</Text>
                <Text style={s.cell}>Período</Text>
                <Text style={s.cell}>Motivo</Text>
              </View>
              {m.dentistAbsences.map((a, i) => (
                <View style={s.row} key={i}>
                  <Text style={[s.cell, s.bold]}>{a.dentist}</Text>
                  <Text style={s.cell}>{a.period}</Text>
                  <Text style={s.cell}>{a.reason}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {m.shiftChanges.length > 0 && (
          <View>
            <Text style={s.h2} minPresenceAhead={40}>{5 + (m.absences.length > 0 ? 1 : 0) + (m.dentistAbsences.length > 0 ? 1 : 0)}. Trocas de horário do mês</Text>
            <View style={s.table}>
              <View style={[s.row, s.head]} fixed>
                <Text style={s.cell}>ASB</Text>
                <Text style={s.cell}>Período</Text>
                <Text style={s.cell}>Horário nesses dias</Text>
                <Text style={s.cell}>Obs.</Text>
              </View>
              {m.shiftChanges.map((c, i) => (
                <View style={s.row} key={i} wrap={false}>
                  <Text style={[s.cell, s.bold]}>{c.asb}</Text>
                  <Text style={s.cell}>{c.period}</Text>
                  <Text style={s.cell}>{c.hours}</Text>
                  <Text style={s.cell}>{c.note}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {m.extras.length > 0 && (
          <View>
            <Text style={s.h2} minPresenceAhead={40}>{5 + (m.absences.length > 0 ? 1 : 0) + (m.dentistAbsences.length > 0 ? 1 : 0) + (m.shiftChanges.length > 0 ? 1 : 0)}. Horas extras do mês</Text>
            <View style={s.table}>
              <View style={[s.row, s.head]} fixed>
                <Text style={s.cell}>ASB</Text>
                <Text style={s.cell}>Data</Text>
                <Text style={s.cell}>Horário</Text>
                <Text style={s.cell}>Obs.</Text>
              </View>
              {m.extras.map((e, i) => (
                <View style={s.row} key={i} wrap={false}>
                  <Text style={[s.cell, s.bold]}>{e.asb}</Text>
                  <Text style={s.cell}>{e.date}</Text>
                  <Text style={s.cell}>{e.hours}</Text>
                  <Text style={s.cell}>{e.note}</Text>
                </View>
              ))}
            </View>
            {m.extraTotals.length > 0 && (
              <Text style={[s.bold, { marginTop: 4 }]}>
                Total no mês (horas fora do contrato): {m.extraTotals.map((t) => `${t.asb} ${t.hours}h`).join(', ')}.
              </Text>
            )}
          </View>
        )}

        <Footer text={m.generatedAt} />
      </Page>
    </Document>
  );
}
