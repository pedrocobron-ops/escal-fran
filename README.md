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

## Conta e nuvem (login)

O app pede e-mail e senha ao abrir. A escala fica guardada na conta, no projeto Supabase "clientes-basicos" (plano gratuito, schema `escala_ceo`): qualquer computador ou celular em que a pessoa entrar vê e altera a mesma escala. O `localStorage` continua sendo a cópia local (abre na hora e funciona sem internet; as mudanças sobem quando a conexão volta). Se dois aparelhos mudarem a escala ao mesmo tempo, o app pergunta qual versão vale e guarda a outra como cópia em Ajustes.

- Contas: só as criadas no painel do Supabase (Authentication, Users, "Add user", com "Auto confirm"). O cadastro aberto fica desligado (Authentication, Sign In / Providers, "Allow new users to sign up" off), então ninguém cria conta sozinho.
- "Esqueci a senha" manda um e-mail com um link que volta para o site; para isso, em Authentication, URL Configuration, o Site URL precisa ser o endereço do site (https://pedrocobron-ops.github.io/escal-fran/). Quem cuida do app também pode definir uma senha nova pelo painel.
- O endereço e a chave pública do projeto estão em `src/config/cloud.ts` (a chave pública vai para o navegador de qualquer jeito; o que protege a escala é o login). Para apontar para outro projeto, defina `VITE_SUPABASE_URL` e `VITE_SUPABASE_KEY` no build e rode `docs/supabase.sql` no SQL Editor.
- Versão antiga do app usava um "código da escala": no primeiro login, o app traz o que estava no código para a conta (`minha_escala_importar_codigo`) e esquece o código.
- Sem projeto configurado (build sem `src/config/cloud.ts` apontando para a nuvem), o app roda só local, sem login.

No plano gratuito o Supabase pausa projetos sem uso por 7 dias; aí basta reativar no painel.

## Cléo, a assistente (opcional)

O botão "Cléo", no canto da tela, abre uma conversa: dá para perguntar como está a escala ("quem está na Sala 2 amanhã?") e pedir mudanças em palavras ("a Laura vai faltar sexta", "põe a Amanda na Sala 3 das 15h às 17h", "a Andrea troca para 07h às 13h na quinta"). No Chrome e no Safari dá para falar pelo microfone e ouvir a resposta.

Como funciona:

- O app monta a conversa e manda para a função `cleo` do projeto Supabase (`supabase/functions/cleo/`), com o token da sessão da conta. A função confere a conta e o limite diário (`public.cleo_autoriza_usuario`, tabela `escala_ceo.cleo_uso`, em `docs/supabase.sql`) e repassa à API da Anthropic com a chave guardada nos segredos do projeto. O navegador nunca vê a chave.
- As mudanças acontecem no próprio navegador, pelas mesmas funções das telas (`src/ai/tools.ts`): tudo pode ser desfeito pelo botão Desfazer. Remover algo ou limpar ajustes só acontece depois que a pessoa confirma na conversa.
- Precisa de internet e da conta (login). A conversa fica guardada na conta e continua em qualquer aparelho. Limite de 300 chamadas por dia por conta.

Para ativar (uma vez), no painel do Supabase, projeto "clientes-basicos", Edge Functions, Secrets:

- `ANTHROPIC_API_KEY`: chave criada em console.anthropic.com (API Keys), com crédito na conta.
- `CLEO_MODEL` (opcional): modelo; padrão `claude-haiku-4-5-20251001`.
- `CLEO_LIMITE_DIA` (opcional): chamadas por dia por conta; padrão 300.

Para publicar a função de novo depois de mudar o código: `supabase functions deploy cleo --no-verify-jwt` (ou pelo MCP do Supabase).
