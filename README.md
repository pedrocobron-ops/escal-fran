# Escala CEO

Sistema de escala de ASBs e dentistas de um Centro de Especialidades Odontológicas. Site estático (Vite + React + TypeScript), sem backend e sem login, publicado no GitHub Pages.

- Especificação: `docs/SPEC.md`
- Perguntas em aberto com o cliente: `docs/PERGUNTAS.md`
- Convenções de desenvolvimento: `CLAUDE.md`

## Rodar localmente

```
npm ci
npm run dev
```

Testes e build:

```
npm test
npm run build
```

## Publicar

O workflow `.github/workflows/deploy.yml` publica no GitHub Pages a cada push na branch `main` (ou manualmente em Actions, "Run workflow"). Em Settings, Pages, escolha a fonte "GitHub Actions". A base do Vite é definida automaticamente com o nome do repositório.

## Dados

Os dados ficam no `localStorage` do navegador. Em Ajustes dá para exportar e importar um backup JSON e voltar para a escala inicial (`src/data/seed.json`).
