# Escala CEO: especificação do sistema

Sistema de escala de ASBs (auxiliares de saúde bucal) e dentistas de um Centro de Especialidades Odontológicas (CEO). Uso interno de um único cliente, sem login. Hospedado como site estático no GitHub Pages.

Este arquivo é o briefing para o desenvolvimento. `seed.json` traz os dados iniciais extraídos dos documentos do cliente. `PERGUNTAS.md` lista o que ainda depende de resposta do cliente.

---

## 1. Contexto do negócio

- O CEO funciona das **07h às 19h**, de segunda a sexta (confirmar sábado).
- Tem **4 salas** de atendimento. Cada dentista atende numa sala fixa, num turno fixo (07–11, 08–11, 11–15 ou 15–19). Salas 2 e 3 ficam vazias em alguns períodos.
- Cada sala com dentista atendendo precisa de **uma ASB** presente o tempo todo.
- Cada ASB tem **horário de contrato** próprio (ex.: 07h–13h, 10h–19h). Algumas não saem para almoço (Andrea, Nicélia); as demais precisam de **1 hora de almoço**, e a sala delas precisa ser coberta nesse intervalo.
- Além das salas, há **tarefas** com regras de quem faz:
  - **Segue o dentista**: quem estiver escalada com fulano faz (CME/Arsenal da manhã segue a Estomatologia; CME da tarde segue o Dr. Edson; conferência de prótese segue quem está na Prótese).
  - **Segue a sala**: quem estiver na Sala 4 faz (troca de líquidos de RX, manhã e tarde).
  - **Rodízio semanal**: pedido de almoxarifado e organização do armário (seg ou ter, 09h–14h, uma ASB por semana, rotação).
  - **Rodízio mensal**: planilhas de Semio (Estomatologia), uma ASB por mês, rotação.
  - **Fixa**: drenar compressor, qua e sex às 18h50, ASB do período da tarde, 5 min.
- **Regras fixas** (não dependem da escala): validade de instrumental e reposição de insumos são da ASB responsável pela sala; reposição de anestésicos é do dentista.
- **Regra da Prótese** (mensagem do cliente no WhatsApp): quem ficar de auxiliar na Prótese fica **1 mês** sem rotacionar nas outras salas.

## 2. Usuário e objetivo

Uma pessoa (coordenação do CEO) monta a escala, atualiza quando alguém entra, sai, tira férias ou falta, e **distribui um PDF** para a equipe. Não precisa de login. Precisa ser intuitivo para quem não é de TI.

## 3. Stack recomendada

- **Vite + React + TypeScript**. Deploy no **GitHub Pages** via GitHub Actions (`vite build` com `base` configurado para o nome do repositório).
- **Drag and drop**: `@dnd-kit/core` + `@dnd-kit/sortable` (funciona com mouse e toque, acessível por teclado).
- **Estado**: Zustand (ou Context) com persistência em `localStorage`, mais exportar/importar JSON como backup. Se o cliente precisar usar em mais de um computador, trocar a persistência por Supabase depois; manter a camada de dados isolada (um módulo `storage.ts`) para essa troca ser barata.
- **PDF**: `@react-pdf/renderer` (documento vetorial, texto selecionável, layout controlado). Alternativa mais simples: rota `/imprimir` com CSS de impressão e `window.print()`. Recomendo a primeira: o cliente quer um PDF pronto para mandar no WhatsApp.
- Sem backend, sem banco, sem login.

## 4. Modelo de dados

```ts
type Id = string;

interface Room { id: Id; name: string; color: string; order: number }

interface Dentist {
  id: Id; name: string; specialty: string;
  roomId: Id; start: number; end: number;     // horas inteiras, ex.: 11 e 15
  days?: number[];                              // 0=dom..6=sáb; vazio = seg a sex
}

interface Asb {
  id: Id; name: string;
  start: number; end: number;                   // contrato, ex.: 7 e 16
  lunch: boolean;                               // true = precisa de 1h de almoço
  active: boolean;
}

// O que uma ASB está fazendo num bloco de 1 hora
type SlotKind = 'sala' | 'apoio' | 'recepcao' | 'cme' | 'almox' | 'almoco';
interface Slot { asbId: Id; hour: number; kind: SlotKind; roomId?: Id }

// Escala base: vale para todos os dias úteis
interface BaseSchedule { slots: Slot[] }

type TaskMode =
  | { mode: 'dentist'; dentistId: Id }                        // quem está com o dentista
  | { mode: 'room'; roomId: Id; hour: number }                // quem está na sala nesse horário
  | { mode: 'rotation'; period: 'week' | 'month'; order: Id[]; startDate: string } // ISO
  | { mode: 'fixed'; asbIds: Id[] };

interface Task {
  id: Id; name: string; when: string; rule: string;
  days: number[];                                             // dias em que acontece
  assignment: TaskMode;
}

interface Absence {
  id: Id; asbId: Id; from: string; to: string;                // ISO, inclusivo
  reason: 'Férias' | 'Atestado' | 'Falta' | 'Folga' | 'Licença' | 'Outro';
  substitute?: { asbId: Id } | { externalName: string };
}

interface AppData {
  version: number;
  rooms: Room[]; dentists: Dentist[]; asbs: Asb[];
  base: BaseSchedule; tasks: Task[]; rules: string[]; absences: Absence[];
  openDays: number[];                                         // padrão [1,2,3,4,5]
}
```

Blocos de hora: 07→08 até 18→19 (12 blocos). Uma ASB só pode ter slot dentro do horário de contrato.

## 5. Lógica

### 5.1 Escala efetiva de um dia
1. Parte da escala base.
2. Aplica ausências do dia: os slots da ausente somem. Se houver substituta da equipe, ela herda os slots da ausente nos horários em que está livre (apoio, recepção, livre); se já estiver em sala, almoço ou fora do contrato, o slot fica **descoberto** e gera alerta. Se a substituta for externa, os slots ficam com o nome dela.
3. Resolve as tarefas do dia (ver 5.3).

### 5.2 Validações (mostrar como alertas, nunca bloquear silenciosamente)
- **Crítico**: sala com dentista atendendo e nenhuma ASB no bloco.
- **Crítico**: ASB com `lunch = true` sem bloco de almoço.
- **Aviso**: ASB em sala sem dentista naquele bloco.
- **Aviso**: bloco do contrato sem atribuição.
- **Aviso**: duas ASBs na mesma sala no mesmo bloco.
- **Aviso**: substituta com choque de sala.
- **Aviso**: mudou a ASB da Prótese antes de completar 1 mês (regra do cliente).
- **Bloqueio no drop**: soltar uma ASB num bloco fora do horário de contrato dela. O quadro deve mostrar visualmente, ao começar a arrastar, quais blocos são válidos.

### 5.3 Responsável por tarefa numa data
- `dentist`: ASBs que estão na sala do dentista durante o horário dele (na escala efetiva do dia).
- `room`: ASB na sala X no bloco Y.
- `rotation`: índice = (semanas ou meses desde `startDate`) mod tamanho da ordem. Semana começa na segunda. Se a titular estiver ausente, mostra a substituta (ou "sem substituta").
- `fixed`: a lista.

### 5.4 Semanas do mês
Para a visão mensal e o PDF: semanas de segunda a sexta que tocam o mês. Rodízios semanais mostram a titular de cada semana; mensais mostram a titular do mês.

## 6. Telas

### 6.1 Quadro (tela principal, o que o cliente pediu)
Um **quadro de arrastar e soltar**, não uma planilha.

- **Colunas**: as salas (Sala 1 a 4) mais colunas de apoio: "Apoio / Recepção", "CME / Arsenal", "Almoxarifado", "Almoço".
- **Linhas**: os 12 blocos de hora (07h–08h ... 18h–19h). Cada linha da coluna de sala mostra o dentista que está atendendo naquele bloco (ou "sala vazia", em cinza).
- **Fichas (chips)** com o nome da ASB. Uma paleta lateral lista todas as ASBs com horário de contrato e um contador "X de Y blocos preenchidos". Arrasta da paleta para uma célula; arrasta entre células para mover; arrasta de volta para a paleta (ou clique no ×) para remover.
- Ao começar a arrastar, as células fora do horário de contrato ficam desabilitadas e as válidas ganham destaque. Célula de sala sem dentista fica com aviso mas aceita.
- **Pintar em faixa**: arrastar com a tecla Shift (ou segurar um botão "preencher até") preenche vários blocos consecutivos da mesma coluna, já que a ASB fica 3 ou 4 horas na mesma sala. Alternativa: soltar a ficha abre um mini-popover "até que horas?".
- Cada ficha tem a cor da ASB; a célula tem a cor da sala. Alertas aparecem como borda vermelha na célula e como lista no rodapé/lateral.
- Desfazer / refazer (Ctrl+Z).
- Modo "Dia": mesmo quadro, mas para uma data específica, somente leitura, com ausências e substituições aplicadas. Um seletor de data em cima.

### 6.2 Tarefas e rodízios
Cards, um por tarefa. Nos rodízios, a ordem é uma lista **arrastável** de fichas de ASB, com a titular atual em destaque e a data de início. Nos modos "segue dentista/sala", o card mostra quem está resolvido hoje e por quê.

### 6.3 Ausências
Lista + formulário: ASB, período, motivo, quem cobre (da equipe ou nome externo). Um calendário do mês com as ausências marcadas ajuda.

### 6.4 Equipe e salas
Cadastro de ASBs (nome, entrada, saída, almoço sim/não, cor), dentistas (nome, especialidade, sala, horário, dias) e salas. Cadastrar uma ASB nova a coloca na paleta do quadro na hora. Remover uma ASB tira as fichas dela e a retira dos rodízios, com confirmação.

### 6.5 Visão do mês e exportar PDF
Escolhe o mês. Mostra: titulares dos rodízios por semana, titulares mensais, ausências. Botão **"Gerar PDF"**.

**Conteúdo do PDF** (seguir o formato que o cliente já usa nos PDFs dele, ver seção 8):
1. Cabeçalho: "Escala mensal de trabalho – CEO", mês/ano, horário de funcionamento.
2. **Escala base diária das ASBs**: tabela ASB × (horário de contrato, manhã, almoço, tarde), em texto corrido por período, ex.: "Sala 4 (Dra. Juliana, 07h–11h)".
3. **Ocupação das salas por horário**: tabela horário × sala, com dentista (especialidade) e "ASB: nome".
4. **Rodízio de tarefas especiais**: tabela tarefa × semana 1..4 (ou 5) com a responsável de cada semana; mensais em linha única.
5. **Regras fixas** (a lista `rules`).
6. **Ausências e coberturas** do mês, se houver.
7. Rodapé com data de geração.

Também um **PDF do dia** (opcional): a escala efetiva de uma data, para quando há substituição.

Paisagem, A4, fonte legível em impressão preto e branco (cores só como apoio).

### 6.6 Ajustes
Dias de funcionamento, exportar/importar backup JSON, "voltar para a escala inicial" (recarrega `seed.json`).

## 7. Detalhes de UX

- Idioma: português do Brasil. Horas no formato `07h`, `11h–15h`.
- Sem em dashes no texto da interface; usar hífen, vírgula ou parênteses.
- Toques e mouse; funciona num notebook e num tablet. Celular é secundário.
- Salvar automaticamente a cada mudança, com indicador "salvo às 14:32".
- Confirmação antes de remover pessoas ou limpar a escala. Nunca `confirm()` nativo; usar modal próprio.
- Estado vazio nunca fica em branco: se não há dados, oferece "carregar escala inicial dos documentos".

## 8. Dados iniciais

Estão em `seed.json`. Resumo:

**Salas**: Sala 1, 2, 3, 4.

**Dentistas** (nome, especialidade, sala, horário):
Francisco (Estomatologia, S1, 08–11) · Victoria (COM, S3, 07–11) · Juliana (Endo, S4, 07–11) · Ana (Orto, S2, 11–15) · Priscila (Prótese, S1, 11–15) · Marco (Endo, S4, 11–15) · Mariana (PNE, S4, 15–19) · Aline (COM, S3, 15–19) · Edson (Perio, S2, 15–19) · Isac (Prótese, S1, 15–19).

**ASBs** (horário, almoço): Andrea 07–13 não sai · Nicélia 13–19 não sai · Priscila 10–19 · Ana 10–19 · Pâmela 07–16 · Amanda 09–18 · Laura 07–16.

**Escala base proposta** (segue o briefing em Word do cliente; os PDFs que ele mandou se contradizem e estão em `PERGUNTAS.md`):

| ASB | 07 | 08 | 09 | 10 | 11 | 12 | 13 | 14 | 15 | 16 | 17 | 18 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Andrea | S3 | S3 | S3 | S3 | Apoio | S1 (cobre almoço Laura) | | | | | | |
| Laura | CME | S1 | S1 | S1 | S1 | Almoço | S1 | S1 | Apoio | | | |
| Pâmela | S4 | S4 | S4 | S4 | Almoço | S4 | S4 | S4 | Apoio | | | |
| Amanda | | | Almox | Almox | Apoio | Almoço | Apoio | Apoio | S2 | S2 | S2 | |
| Priscila | | | | Apoio | S2 | S2 | S2 | Almoço | S3 | S3 | S3 | S3 |
| Ana | | | | Apoio | S4 (cobre Pâmela) | Apoio | Almoço | S2 (cobre Priscila) | S4 | S4 | S4 | S4 |
| Nicélia | | | | | | | Apoio | Apoio | S1 | S1 | S1 | S1 |

Alerta conhecido nessa escala: **Sala 2 às 18h fica sem ASB** (Amanda sai às 18h, Edson atende até 19h). É a pergunta 1 para o cliente.

**Tarefas**: ver `seed.json` (9 tarefas com os modos descritos na seção 1).

## 9. Estrutura sugerida do repositório

```
src/
  data/seed.json
  domain/           # tipos, validações, resolução de tarefas, escala efetiva (puro, testável)
    types.ts
    schedule.ts     # effectiveDay, analyze
    tasks.ts        # taskHolder, rotation math
  store/            # zustand + storage.ts (localStorage agora, Supabase depois)
  pdf/              # documentos @react-pdf/renderer
  ui/
    board/          # quadro drag and drop
    tasks/ absences/ team/ month/ settings/
tests/              # vitest para domain/ (rodízio, ausências, validações)
.github/workflows/deploy.yml
```

Testar primeiro o `domain/`: é onde a lógica de negócio mora e o que mais dói se errar (rodízio contando errado, substituta em choque não detectada).

## 10. Fora do escopo (por enquanto)

Login, múltiplos usuários simultâneos, histórico de versões da escala, notificação para os funcionários, integração com ponto.
