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

## Sincronizar entre aparelhos (opcional)

Com um projeto no [Supabase](https://supabase.com) (plano gratuito serve), a escala fica guardada na nuvem e qualquer computador ou celular com o "código da escala" vê e altera a mesma escala.

1. No projeto, rode o SQL de `docs/supabase.sql` (SQL Editor). Ele cria a tabela e as três funções que o app usa; a chave pública (anon) só consegue chamar essas funções, e só quem sabe o código lê ou grava.
2. Coloque o endereço e a chave pública do projeto no build, como segredos do repositório usados pelo workflow: `VITE_SUPABASE_URL` e `VITE_SUPABASE_KEY` (ou digite os dois em Ajustes, no primeiro aparelho).
3. No app, em Ajustes, "Sincronizar entre aparelhos": "Criar código novo e enviar esta escala". Anote o código. Nos outros aparelhos, "Entrar com o código".

Sem internet o app continua funcionando com a cópia local e envia as mudanças quando a conexão volta. Se dois aparelhos mudarem a escala ao mesmo tempo, vale a última gravação, e o outro aparelho recebe a versão nova com um aviso. No plano gratuito o Supabase pausa projetos sem uso por 7 dias; aí basta reativar no painel.
