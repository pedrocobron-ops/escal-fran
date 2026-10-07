# Pedidos do cliente depois da primeira versão

Francisco (responsável técnico do CEO, quem usa o sistema) mandou áudios e mensagens em 24/09 e 28/09/2026. Não são respostas a `PERGUNTAS.md`, que continuam em aberto.

## O que ele pediu

1. Incluir as auxiliares que entram mais cedo ou saem mais tarde para pagar hora (horas extras), por dia.
2. Essas horas extras cobrem as salas que ficam descobertas quando outra auxiliar folga.
3. Poder colocar a mesma auxiliar cobrindo duas salas, ou de apoio para uma sala.
4. Ao incluir uma folga, o app já sugerir a cobertura.
5. Folga e ausência de dentista: no dia da folga, o app remaneja sozinho a auxiliar dele para outra sala.

## Como ficou no app

- **Ausências, extras e trocas de horário** (antes "Ausências") tem quatro abas: folgas e faltas de ASB, horas extras, trocas de horário e folgas de dentista. O calendário mostra as quatro.
- **Hora extra** (`extraShifts`): ASB, data (ou período, repetindo nos dias úteis), horário. Atalhos "entra mais cedo" e "sai mais tarde". Na data, o quadro aceita a ficha nesses horários.
- **Folga de ASB**: o formulário lista as sugestões de cobertura (quantos blocos cada uma cobre e quantos cobriria com hora extra). Ao escolher a substituta, oferece criar a hora extra que falta para ela cobrir tudo.
- **Folga de dentista** (`dentistAbsences`): o dentista some do dia, a célula mostra "de folga", e a ASB que estaria com ele é remanejada sozinha para uma sala com dentista e sem ASB. O remanejamento aparece como "remanejada" na ficha e na lista de alertas (nível informativo).
- **Remanejamento automático** também usa quem tem hora extra sem atribuição naquele horário.
- **Modo Dia editável** (`dayOverrides`): arrastar no Modo Dia muda só aquela data (fichas tracejadas, botão "Limpar ajustes do dia"). A escala base não muda.
- **Duas salas ao mesmo tempo**: ao soltar uma ASB numa sala quando ela já está em outra no mesmo horário, o app pergunta "Mover" ou "Cobrir as duas". Cobrir as duas gera um aviso (não crítico).
- **Apoio de uma sala**: ao soltar uma ASB numa sala que já tem ASB, o app pergunta se ela fica "de apoio" daquela sala (etiqueta "apoio" na célula, não conta como ASB da sala e não gera aviso) ou se entra também como ASB da sala. Dá para ser apoio de uma sala e continuar na outra (gera aviso de sala dividida).
- **Total de horas extras do mês** por ASB, contando só as horas fora do contrato (para pagamento), na Visão do mês e no PDF do mês.
- **Histórico**: dias passados mostram a escala como estava naquele dia, mesmo depois de mudar salas, dentistas, ASBs, escala base, tarefas, dias de funcionamento ou regras fixas. Remover alguém da equipe preserva o que já passou (inclusive quando a pessoa removida era substituta numa ausência em andamento). Remover uma ausência que já começou pergunta se é para encerrar ontem (os dias passados ficam) ou apagar tudo.
- **Hora extra pelo quadro**: no Modo Dia, soltar uma ASB fora do horário dela pergunta se é hora extra e já registra (junta com a hora extra encostada).
- **Folga de dentista com prévia**: o formulário mostra, nos primeiros dias, quem é remanejada para onde e quem fica disponível.
- **Feriados e dias fechados** (`closedDates`, em Ajustes): nessas datas o quadro do dia fica vazio, sem alertas, tarefas nem horas extras a pagar.
- **Quadro**: lembra o modo e a data ao trocar de tela; na escala base avisa o que muda hoje; tocar num dia do calendário abre o Modo Dia nessa data; botão "PDF deste dia".
- **Duas abas abertas**: a aba que ficou para trás passa a mostrar o que foi gravado na outra, em vez de apagar.
- **Desfazer e Refazer** no topo de todas as telas (também no celular). Desfazer uma importação ou a volta à escala inicial devolve também o histórico.
- **Editar uma ausência que já começou** mantém as horas extras dos dias que já passaram (já trabalhadas); só o que ainda vai acontecer é refeito.
- PDF do mês ganhou "Folgas de dentista do mês" e "Horas extras do mês". PDF do dia lista folgas e horas extras e marca "(extra)".

## Áudio de 07/10/2026

1. **A ficha mostra só o nome.** Arrastar uma ASB para um horário não escreve mais "ajuste" (nem "remanejada", "hora extra" etc.) na ficha; só "apoio" aparece, quando ela é apoio da sala. O resto fica na dica do mouse e no resumo "Este dia".
2. **Escala da semana** ao lado da escala base: sempre de segunda a sexta (os dias de funcionamento), com uma aba por dia. Cada dia mostra a escala efetiva da data. É a tela que abre por padrão. Substitui o antigo "Modo Dia". (Refinado nos áudios das 10:18, abaixo: o que se arrasta vale para a semana inteira.)
3. **Salvo em qualquer computador**: sincronização pela nuvem com um "código da escala", em Ajustes. Projeto Supabase "clientes-basicos" (gratuito), schema `escala_ceo`, SQL em `docs/supabase.sql`. A cópia local continua valendo sem internet; se dois aparelhos mudarem a escala ao mesmo tempo, o app pergunta qual versão vale e guarda a outra como cópia.
4. **Quem está de férias não aparece nos blocos** no período: a escala da semana já tira a pessoa ausente das células (só a escala base, que é o modelo que se repete, mostra todo mundo).
5. **Conferência de prótese com alguém fixa o mês inteiro**: em Tarefas e rodízios, "Responsável fixo por período" em qualquer tarefa (botões "Este mês" e "Mês que vem"). A Visão do mês e o PDF do mês ganharam a tabela "Tarefas diárias e responsáveis", onde a conferência de prótese aparece escrita com quem faz.
6. **Duas pessoas por célula, sem perguntas**: soltar uma ASB numa sala que já tem ASB, ou quando ela já está em outra sala naquela hora, entra como "apoio"; sala livre, entra como ASB da sala. Da lista lateral para uma sala: acrescenta, sem tirar de onde ela está (outra sala, almoxarifado, apoio). Ficha do quadro: na mesma hora, para sala ocupada vira apoio e continua onde estava; para sala livre, muda de lugar; para outra hora, sai da hora de origem. Para as colunas de apoio, CME, almoxarifado e almoço ela sai de tudo o que fazia naquela hora. Quem está de apoio conta como presença (a sala não fica "sem ASB"), e ficar em duas salas virou só informação, não aviso.
7. **Almoço entre 12h e 15h**: o 11h–12h não existe. A coluna Almoço não aceita ficha fora desse horário (ajustável em Ajustes) e avisa se alguma ASB estiver com almoço fora dele. Na escala inicial, a Pâmela ficou de apoio às 11h e sem almoço marcado até o cliente dizer o horário dela (PERGUNTAS.md, item 4).
8. **Alertas só na tela**: o PDF do dia não imprime mais a lista de alertas.

## Áudios de 07/10/2026 (10:18, 10:19 e 10:22)

1. **A escala da semana vale para a semana inteira.** Na escala da semana, arrastar uma ficha vale de segunda a sexta daquela semana (`weekOverrides`, por segunda-feira), não só para o dia aberto. O botão "Vale para a semana inteira" / "Só este dia" troca o alcance; "Só este dia" cria um ajuste da data (`dayOverrides`), que vence o da semana só naquele dia. Ausências, folgas de dentista e remanejamentos continuam valendo por cima. Botões "Copiar para a próxima semana" e "Voltar a semana à base". A escala base continua sendo o modelo que se repete.
2. **Troca de horário da ASB**, na aba "Trocas de horário" da tela **Ausências, extras e trocas de horário** (`shiftChanges`): ASB, período (de/até), entra às, sai às, observação. Nesses dias o horário dela passa a ser o novo (ex.: Amanda 07h–16h em vez de 09h–18h): a lista lateral do quadro mostra "(trocado)", os blocos da base fora do novo horário somem, ela pode ser colocada nas horas novas, os alertas e o PDF usam o novo horário e nada conta como hora extra. Ausência vale acima da troca. Aparece no calendário (roxo, "⇄ nome"), no resumo "Este dia", na Visão do mês e no PDF do mês ("Trocas de horário do mês").
3. **Planilha de prótese como rodízio mensal**, em Tarefas e rodízios: duas tarefas, "Planilha de prótese (manhã)" e "Planilha de prótese (tarde)", rodízio mensal começando em outubro/2026 com Pâmela de manhã e Nicélia à tarde; a ordem segue a equipe ativa e pode ser mudada na tela. Criadas uma vez só (`applied: ["planilha-protese"]`): se o cliente apagar, o app não recria. Entram na tabela "Tarefas diárias e responsáveis" do mês e do PDF.

## Pedido por WhatsApp (07/10/2026): "falar com a IA e pedir as alterações"

**Cléo**, assistente dentro do app (botão no canto da tela). Entende pedidos em português, consulta a escala de verdade (não inventa) e faz as mudanças pelas mesmas funções das telas: ausências e substitutas, horas extras, trocas de horário, folgas de dentista, colocar e tirar do quadro (semana, dia ou base), responsável fixo em tarefa, fechar dia, desfazer. Remover ou limpar pede confirmação. Dá para falar pelo microfone e ouvir a resposta (Chrome e Safari). Precisa da escala na nuvem (código da escala) e da chave da API da Anthropic nos segredos do projeto Supabase (ver README). Limite de 300 conversas por dia por código.
