import { Document, Page, Text, View } from '@react-pdf/renderer';
import type { DayPdfModel } from './model';
import { pdfStyles as s } from './styles';

export function DayPdf({ m }: { m: DayPdfModel }) {
  return (
    <Document title={`${m.title} ${m.dateLabel}`} author="Escala CEO" language="pt-BR">
      <Page size="A4" orientation="landscape" style={s.page}>
        <Text style={s.title}>{m.title}</Text>
        <Text style={s.subtitle}>{m.dateLabel}</Text>
        <Text style={s.meta}>{m.hoursLabel}</Text>

        {!m.open && <Text style={s.warn}>O CEO não abre neste dia da semana.</Text>}

        <Text style={s.h2}>Ausências e coberturas</Text>
        {m.absences.length === 0 ? (
          <Text style={s.muted}>Sem ausências. A escala do dia é igual à escala base.</Text>
        ) : (
          <View style={s.table}>
            <View style={[s.row, s.head]}>
              <Text style={s.cell}>ASB</Text>
              <Text style={s.cell}>Período</Text>
              <Text style={s.cell}>Motivo</Text>
              <Text style={s.cell}>Quem cobre</Text>
            </View>
            {m.absences.map((a, i) => (
              <View style={s.row} key={i}>
                <Text style={[s.cell, s.bold]}>{a.asb}</Text>
                <Text style={s.cell}>{a.period}</Text>
                <Text style={s.cell}>{a.reason}</Text>
                <Text style={s.cell}>{a.cover}</Text>
              </View>
            ))}
          </View>
        )}

        <Text style={s.h2}>Quadro do dia</Text>
        <View style={s.table}>
          <View style={[s.row, s.head]}>
            <Text style={[s.cell, { flexBasis: 52, flexGrow: 0 }]}>Horário</Text>
            {m.columns.map((c) => <Text key={c} style={s.cell}>{c}</Text>)}
          </View>
          {m.rows.map((r) => (
            <View style={s.row} key={r.hour} wrap={false}>
              <Text style={[s.cell, s.bold, { flexBasis: 52, flexGrow: 0 }]}>{r.hour}</Text>
              {r.cells.map((c, i) => (
                <View key={i} style={s.cell}>
                  {c.dentist ? <Text style={[s.small, c.dentist === 'sala vazia' ? s.muted : {}]}>{c.dentist}</Text> : null}
                  {c.asb ? <Text style={c.asb === 'SEM ASB' ? s.warn : s.bold}>{c.asb}</Text> : null}
                </View>
              ))}
            </View>
          ))}
        </View>

        <Text style={s.h2} break>Escala das ASBs no dia</Text>
        <View style={s.table}>
          <View style={[s.row, s.head]}>
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
              <Text style={[s.cell, { flexBasis: 60, flexGrow: 0 }]}>{r.lunch}</Text>
              <Text style={s.cell}>{r.afternoon}</Text>
            </View>
          ))}
        </View>

        <Text style={s.h2}>Tarefas do dia</Text>
        {m.tasks.length === 0 ? (
          <Text style={s.muted}>Nenhuma tarefa neste dia.</Text>
        ) : (
          <View style={s.table}>
            <View style={[s.row, s.head]}>
              <Text style={[s.cell, { flexBasis: 170, flexGrow: 0 }]}>Tarefa</Text>
              <Text style={[s.cell, { flexBasis: 110, flexGrow: 0 }]}>Quem faz</Text>
              <Text style={s.cell}>Por quê</Text>
            </View>
            {m.tasks.map((t, i) => (
              <View style={s.row} key={i} wrap={false}>
                <View style={[s.cell, { flexBasis: 170, flexGrow: 0 }]}>
                  <Text style={s.bold}>{t.task}</Text>
                  <Text style={[s.small, s.muted]}>{t.when}</Text>
                </View>
                <Text style={[s.cell, { flexBasis: 110, flexGrow: 0 }, t.holder === 'ninguém' || t.holder === 'sem substituta' ? s.warn : {}]}>{t.holder}</Text>
                <Text style={s.cell}>{t.reason}</Text>
              </View>
            ))}
          </View>
        )}

        {m.alerts.length > 0 && (
          <View>
            <Text style={s.h2}>Alertas</Text>
            {m.alerts.map((a, i) => (
              <View key={i} style={s.bullet}>
                <Text style={s.bulletDot}>•</Text>
                <Text style={[s.bulletText, a.startsWith('CRÍTICO') ? s.warn : {}]}>{a}</Text>
              </View>
            ))}
          </View>
        )}

        <View style={s.footer} fixed>
          <Text>{m.generatedAt}</Text>
          <Text render={({ pageNumber, totalPages }) => `Página ${pageNumber} de ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}
