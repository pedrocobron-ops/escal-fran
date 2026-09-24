import { StyleSheet } from '@react-pdf/renderer';

// Preto e branco legível em impressão; cor só como apoio leve.
export const pdfStyles = StyleSheet.create({
  page: { padding: 28, fontSize: 8.5, fontFamily: 'Helvetica', color: '#000' },
  title: { fontSize: 15, fontFamily: 'Helvetica-Bold', marginBottom: 2 },
  subtitle: { fontSize: 10, marginBottom: 1 },
  meta: { fontSize: 8.5, color: '#333', marginBottom: 8 },
  h2: { fontSize: 11, fontFamily: 'Helvetica-Bold', marginTop: 10, marginBottom: 4 },
  table: { width: '100%', borderStyle: 'solid', borderWidth: 0.8, borderColor: '#000', borderRightWidth: 0, borderBottomWidth: 0 },
  row: { flexDirection: 'row' },
  cell: { borderStyle: 'solid', borderWidth: 0.8, borderColor: '#000', borderLeftWidth: 0, borderTopWidth: 0, padding: 3, flexGrow: 1, flexBasis: 0 },
  head: { backgroundColor: '#e6e6e6', fontFamily: 'Helvetica-Bold' },
  bold: { fontFamily: 'Helvetica-Bold' },
  muted: { color: '#555' },
  warn: { fontFamily: 'Helvetica-Bold', color: '#7a0000' },
  small: { fontSize: 7.5 },
  footer: { position: 'absolute', bottom: 14, left: 28, right: 28, fontSize: 7.5, color: '#555', flexDirection: 'row', justifyContent: 'space-between' },
  bullet: { flexDirection: 'row', marginBottom: 2 },
  bulletDot: { width: 10 },
  bulletText: { flex: 1 },
});
