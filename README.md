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

A escala pode ficar guardada na nuvem, no projeto Supabase "clientes-basicos" (plano gratuito, schema `escala_ceo`); qualquer computador ou celular com o "código da escala" vê e altera a mesma escala.

- O endereço e a chave pública do projeto estão em `src/config/cloud.ts`. A chave pública vai para o navegador de qualquer jeito e só consegue chamar as três funções de `docs/supabase.sql`, que exigem o código; o código é o segredo. Para apontar para outro projeto, defina `VITE_SUPABASE_URL` e `VITE_SUPABASE_KEY` no build.
- Para recriar o banco em outro projeto, rode `docs/supabase.sql` no SQL Editor.
- No app, em Ajustes, "Sincronizar entre aparelhos": no primeiro aparelho, "Criar código novo e enviar esta escala" e anote o código; nos outros, "Entrar com o código".

Sem internet o app continua funcionando com a cópia local e envia as mudanças quando a conexão volta. Se dois aparelhos mudarem a escala ao mesmo tempo, vale a última gravação, e o outro aparelho recebe a versão nova com um aviso. No plano gratuito o Supabase pausa projetos sem uso por 7 dias; aí basta reativar no painel.

## Cléo, a assistente (opcional)

O botão "Cléo", no canto da tela, abre uma conversa: dá para perguntar como está a escala ("quem está na Sala 2 amanhã?") e pedir mudanças em palavras ("a Laura vai faltar sexta", "põe a Amanda na Sala 3 das 15h às 17h", "a Andrea troca para 07h às 13h na quinta"). No Chrome e no Safari dá para falar pelo microfone e ouvir a resposta.

Como funciona:

- O app monta a conversa e manda para a função `cleo` do projeto Supabase (`supabase/functions/cleo/`), junto com o código da escala. A função confere o código e o limite diário (`public.cleo_autoriza`, tabela `escala_ceo.cleo_uso`, em `docs/supabase.sql`) e repassa à API da Anthropic com a chave guardada nos segredos do projeto. O navegador nunca vê a chave.
- As mudanças acontecem no próprio navegador, pelas mesmas funções das telas (`src/ai/tools.ts`): tudo pode ser desfeito pelo botão Desfazer. Remover algo ou limpar ajustes só acontece depois que a pessoa confirma na conversa.
- Precisa de internet e de a escala estar na nuvem (Ajustes, Sincronizar entre aparelhos).

Para ativar (uma vez), no painel do Supabase, projeto "clientes-basicos", Edge Functions, Secrets:

- `ANTHROPIC_API_KEY`: chave criada em console.anthropic.com (API Keys), com crédito na conta.
- `CLEO_MODEL` (opcional): modelo; padrão `claude-haiku-4-5-20251001`.
- `CLEO_LIMITE_DIA` (opcional): chamadas por dia por código; padrão 300.

Para publicar a função de novo depois de mudar o código: `supabase functions deploy cleo --no-verify-jwt` (ou pelo MCP do Supabase).
