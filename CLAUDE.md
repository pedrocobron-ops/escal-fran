# Escala CEO

Sistema de escala de ASBs e dentistas de um Centro de Especialidades Odontológicas. Site estático, sem backend e sem login. Fonte da verdade: `docs/SPEC.md`. Dúvidas em aberto com o cliente: `docs/PERGUNTAS.md` (não inventar respostas; manter a escala como está no `seed.json`).

## Stack

- Vite + React 19 + TypeScript (strict). Deploy no GitHub Pages via GitHub Actions (`vite build` com `base` igual ao nome do repositório).
- Drag and drop: `@dnd-kit/core` + `@dnd-kit/sortable`.
- Estado: Zustand com persistência em `localStorage` via `src/store/storage.ts` (camada isolada para trocar por Supabase depois). Exportar e importar backup JSON.
- PDF: `@react-pdf/renderer`, A4 paisagem, legível em preto e branco.
- Testes: Vitest, cobrindo `src/domain/` (lógica pura).

## Comandos

```
npm run dev       # servidor local
npm test          # vitest run
npm run build     # tsc -b && vite build
npm run lint      # tsc --noEmit
```

## Convenções

- Interface em português do Brasil.
- Horas no formato `07h` e faixas como `11h–15h` (hífen em `–` só entre horas). Nunca usar em dash `—` em texto de interface; usar hífen, vírgula ou parênteses.
- Confirmações com modal próprio. Nunca `confirm()` ou `alert()`.
- Salvar automaticamente a cada mudança, com indicador "salvo às 14:32".
- Alertas nunca bloqueiam silenciosamente: mostrar como lista e como borda na célula. O único bloqueio é o drop fora do horário de contrato.
- `seed.json` é dado do cliente: não alterar valores. O alerta conhecido (Sala 2 às 18h sem ASB) deve continuar aparecendo até o cliente responder.
- Blocos de hora: 07→08 até 18→19 (12 blocos). Dias da semana: 0=dom ... 6=sáb.
- Datas em ISO (`YYYY-MM-DD`), sem fuso horário (usar helpers de `src/domain/dates.ts`).
- Commits pequenos por etapa. Rodar `npm test` e `npm run build` antes de cada commit.

## Estrutura

```
src/
  data/seed.json
  domain/           # tipos, validações, resolução de tarefas, escala efetiva (puro, testável)
    types.ts
    dates.ts        # helpers de data e semanas do mês
    schedule.ts     # effectiveDay, analyze
    tasks.ts        # taskHolder, rodízios
  store/            # zustand + storage.ts (localStorage agora, Supabase depois)
  pdf/              # documentos @react-pdf/renderer
  ui/
    board/          # quadro drag and drop
    tasks/ absences/ team/ month/ settings/
tests/              # vitest para domain/
.github/workflows/deploy.yml
```
