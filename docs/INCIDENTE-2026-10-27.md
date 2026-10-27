# Incidente de 27/10/2026: escala do Francisco sobrescrita (recuperada)

## O que aconteceu

1. O projeto Supabase gratuito pausou entre 22 e 25/10 por "pouca atividade". A chamada automática a cada 3 dias (`keepalive.yml`) só lia o banco, e isso não contou como uso.
2. Com a nuvem fora do ar, o computador do Francisco ficou sem a sessão e sem a cópia local da escala (o navegador do computador de trabalho não manteve os dados do site).
3. Em 27/10, às 09:30 (12:30 UTC), depois que o projeto foi reativado, ele entrou de novo. O navegador, com a escala inicial, gravou na nuvem por cima da escala da conta: a função `minha_escala_put` aceitava gravar sem dizer qual versão estava substituindo (`p_expected` nulo), e o app gravava sem conferir a nuvem quando não tinha conseguido lê-la.
4. O plano gratuito não tem backup.

## Como foi recuperado

O Postgres não apaga na hora a versão antiga de uma linha. Com a faxina automática desligada na tabela (`autovacuum_enabled = false`), a extensão `pg_walinspect` leu do WAL as imagens das páginas da tabela TOAST (gravadas porque os checksums estão ligados) e as copiou para `escala_ceo.recuperacao_paginas`. O script `scripts/recuperar-toast.py` remontou os pedaços, descomprimiu (pglz) e converteu o jsonb binário em JSON. A última versão antes da sobrescrita (feita até 26/10) foi validada com `parseBackup`/`migrate` e gravada de volta na conta às 13:06 UTC. A versão vazia ficou em `escala_ceo.escalas_versoes`.

## O que mudou para não se repetir

- Banco: toda gravação guarda a versão anterior (`escala_ceo.escalas_versoes`, gatilho `guarda_versao`); `minha_escala_put` recusa substituir uma escala existente sem a versão esperada (vira "conflito" e o app pergunta qual vale).
- App: antes de trocar a escala deste aparelho pela da nuvem, guarda a deste aparelho em "Cópias de segurança" e avisa; se não conseguiu ler a nuvem ao abrir, confere antes de gravar; nuvem fora do ar não derruba mais o login (`src/store/sync.ts`, `tests/perda-de-dados.test.ts`).
- Nuvem acordada: `keepalive.yml` roda todo dia e grava no banco (`public.manter_ativo`). A solução definitiva é o plano Pro do Supabase, que não pausa.
