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

O workflow `.github/workflows/deploy.yml` roda testes e build em todo push e publica no GitHub Pages quando o push é na branch padrão do repositório (ou manualmente em Actions, "Run workflow"). O primeiro deploy ativa o Pages sozinho; se falhar, em Settings, Pages, escolha a fonte "GitHub Actions". A base do Vite é definida automaticamente com o nome do repositório.

## Dados

Os dados ficam no `localStorage` do navegador. Em Ajustes dá para exportar e importar um backup JSON e voltar para a escala inicial (`src/data/seed.json`).
