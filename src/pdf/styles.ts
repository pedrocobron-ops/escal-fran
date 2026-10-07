import { Font, StyleSheet } from '@react-pdf/renderer';

// Sem hifenização: palavras quebram só entre si, nunca no meio ("Estoma-tologia").
Font.registerHyphenationCallback((word) => [word]);

// Preto e branco legível em impressão; cor só como apoio leve.
export const pdfStyles = StyleSheet.create({
  page: { padding: 24, fontSize: 8.3, fontFamily: 'Helvetica', color: '#000' },
  title: { fontSize: 15, fontFamily: 'Helvetica-Bold', marginBottom: 2 },
  subtitle: { fontSize: 10, marginBottom: 1 },
  meta: { fontSize: 8.5, color: '#333', marginBottom: 8 },
  h2: { fontSize: 11, fontFamily: 'Helvetica-Bold', marginTop: 8, marginBottom: 3 },
  // Bordas por linha (e não na tabela): quando a tabela continua na página seguinte,
  // não sobram traços soltos, e o cabeçalho (fixed) se repete com a borda de cima.
  table: { width: '100%' },
  row: { flexDirection: 'row', borderStyle: 'solid', borderColor: '#000', borderLeftWidth: 0.8 },
  cell: { borderStyle: 'solid', borderWidth: 0.8, borderColor: '#000', borderLeftWidth: 0, borderTopWidth: 0, padding: 2.5, flexGrow: 1, flexBasis: 0 },
  head: { backgroundColor: '#e6e6e6', fontFamily: 'Helvetica-Bold', borderTopWidth: 0.8 },
  bold: { fontFamily: 'Helvetica-Bold' },
  muted: { color: '#555' },
  warn: { fontFamily: 'Helvetica-Bold', color: '#7a0000' },
  // Falta grave (sala sem ASB): texto branco em fundo preto, que se destaca impresso em preto e branco.
  alarm: { fontFamily: 'Helvetica-Bold', color: '#fff', backgroundColor: '#000' },
  small: { fontSize: 7.5 },
  footer: { position: 'absolute', bottom: 12, left: 24, right: 24, fontSize: 7.5, color: '#555', flexDirection: 'row', justifyContent: 'space-between' },
  bullet: { flexDirection: 'row', marginBottom: 2 },
  bulletDot: { width: 10 },
  bulletText: { flex: 1 },
});
