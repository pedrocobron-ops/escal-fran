# Pedidos do cliente depois da primeira versão

Francisco (responsável técnico do CEO, quem usa o sistema) mandou áudios e mensagens em 24/09 e 28/09/2026. Não são respostas a `PERGUNTAS.md`, que continuam em aberto.

## O que ele pediu

1. Incluir as auxiliares que entram mais cedo ou saem mais tarde para pagar hora (horas extras), por dia.
2. Essas horas extras cobrem as salas que ficam descobertas quando outra auxiliar folga.
3. Poder colocar a mesma auxiliar cobrindo duas salas, ou de apoio para uma sala.
4. Ao incluir uma folga, o app já sugerir a cobertura.
5. Folga e ausência de dentista: no dia da folga, o app remaneja sozinho a auxiliar dele para outra sala.

## Como ficou no app

- **Ausências e extras** (antes "Ausências") tem três abas: folgas e faltas de ASB, horas extras e folgas de dentista. O calendário mostra as três.
- **Hora extra** (`extraShifts`): ASB, data (ou período, repetindo nos dias úteis), horário. Atalhos "entra mais cedo" e "sai mais tarde". Na data, o quadro aceita a ficha nesses horários.
- **Folga de ASB**: o formulário lista as sugestões de cobertura (quantos blocos cada uma cobre e quantos cobriria com hora extra). Ao escolher a substituta, oferece criar a hora extra que falta para ela cobrir tudo.
- **Folga de dentista** (`dentistAbsences`): o dentista some do dia, a célula mostra "de folga", e a ASB que estaria com ele é remanejada sozinha para uma sala com dentista e sem ASB. O remanejamento aparece como "remanejada" na ficha e na lista de alertas (nível informativo).
- **Remanejamento automático** também usa quem tem hora extra sem atribuição naquele horário.
- **Modo Dia editável** (`dayOverrides`): arrastar no Modo Dia muda só aquela data (fichas tracejadas, botão "Limpar ajustes do dia"). A escala base não muda.
- **Duas salas ao mesmo tempo**: ao soltar uma ASB numa sala quando ela já está em outra no mesmo horário, o app pergunta "Mover" ou "Cobrir as duas". Cobrir as duas gera um aviso (não crítico).
- **Apoio de uma sala**: ao soltar uma ASB numa sala que já tem ASB, o app pergunta se ela fica "de apoio" daquela sala (etiqueta "apoio" na célula, não conta como ASB da sala e não gera aviso) ou se entra também como ASB da sala. Dá para ser apoio de uma sala e continuar na outra (gera aviso de sala dividida).
- **Total de horas extras do mês** por ASB, contando só as horas fora do contrato (para pagamento), na Visão do mês e no PDF do mês.
- **Histórico**: dias passados mostram a escala como estava naquele dia, mesmo depois de mudar salas, dentistas, ASBs, escala base ou tarefas. Remover alguém da equipe preserva o que já passou.
- PDF do mês ganhou "Folgas de dentista do mês" e "Horas extras do mês". PDF do dia lista folgas e horas extras e marca "(remanejada)" e "(extra)".
