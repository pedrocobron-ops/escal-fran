# Backup e recuperação da escala

Há três camadas, da mais rápida para a mais segura:

1. **Cópias no navegador** (Ajustes, "Cópias de segurança"): quando a versão do aparelho é trocada pela da nuvem, a do aparelho fica guardada ali.
2. **Histórico na nuvem** (`escala_ceo.escalas_versoes`): toda gravação guarda a versão anterior. Para voltar uma versão, quem cuida do app consulta a tabela no Supabase.
3. **Backup diário fora do Supabase** (branch `backups` deste repositório, arquivos `backups/escala-AAAA-MM-DD.asc`): gerado pelo workflow `backup.yml`, criptografado com a chave pública que está dentro de `public.backup_cifrado()`. Vale mesmo se o projeto Supabase sumir.

## Abrir um backup diário

Precisa da **chave privada** (`escala-ceo-chave-privada.asc`) e da **senha da chave**, guardadas fora do sistema (não ficam no GitHub nem no Supabase).

```sh
gpg --import escala-ceo-chave-privada.asc            # uma vez, pede a senha
gpg --decrypt escala-2026-10-27.asc > backup.json
# a escala de cada conta está em .escalas[].data; para importar no app (Ajustes, Importar backup):
python3 -c "import json;d=json.load(open('backup.json'));e=[x for x in d['escalas'] if x['email']=='fpnetto@usp.br'][0];json.dump(e['data'],open('escala.json','w'),ensure_ascii=False)"
```

O arquivo `escala.json` entra em Ajustes, "Importar backup". Ou peça ao Claude: ele abre o backup e devolve a escala para a conta.
