# Feature Specification: Notificações por comportamento do paciente

**Feature Branch**: `053-notificacoes-comportamento`
**Created**: 2026-08-04
**Status**: Draft
**Input**: Mensagens automáticas ao paciente disparadas por dados dele — checklist de hábitos, medições e metas, acesso ao portal, ausência de retorno — e não por agendamento. Catálogo de regras prontas parametrizáveis, sem construtor livre de condições.

## Contexto e problema

Hoje o único aviso automático que sai da clínica para o paciente é o lembrete de
consulta: dispara por `appointments`, e nada mais. Tudo que o paciente registra
**entre** consultas fica parado esperando alguém olhar. Quem largou o checklist
na segunda semana só é descoberto na consulta seguinte, quando já passou um mês
— e aí o mês perdido não volta.

A feature fecha essa lacuna: a clínica liga regras prontas, escolhe os
parâmetros, e o sistema fala com o paciente quando o comportamento dele bate a
condição.

### A ambiguidade que governa o desenho inteiro

`habit_checklist_marks` **não tem coluna "não fez"**. Linha presente significa
"marcou"; linha ausente pode significar "não fez" **ou** "não abriu o app".
Desmarcar apaga a linha. Isso foi decisão consciente da feature de hábitos, e
não vai mudar aqui.

A consequência é que **o sistema nunca sabe que o paciente não fez** — sabe
apenas que não viu registro. Como a mensagem vai direto ao paciente, essa
distinção deixa de ser sutileza técnica e vira regra de produto: uma mensagem
que afirma "você não bebeu água há 5 dias" para quem bebeu e não registrou é
uma acusação falsa vinda da clínica em que ele confia. O custo de errar não é
simétrico — errar para menos é um lembrete a menos; errar para mais queima o
canal.

## Clarifications

### Session 2026-08-04

- Q: Como o paciente para de receber as mensagens de acompanhamento (FR-017)? → A: Falar com a clínica — a mensagem traz um contato real da clínica e a equipe desliga o aceite na ficha. Sem link de descadastro e sem controle no portal nesta versão.
- Q: Qual o teto de mensagens automáticas por paciente, somando todas as regras? → A: 2 por semana como padrão, ajustável pela clínica de 1 a 7. É configuração da clínica, não da regra.
- Q: Como a regra resolve o público "pacientes de um profissional"? → A: Pelo profissional da consulta mais recente do paciente, derivado de `appointments` — `patients` não tem vínculo direto com profissional.
- Q: Que tamanho e forma esse catálogo de gatilhos deve ter? → A: Catálogo grande, de 14 famílias, com metade **celebrando** em vez de cobrando. Segue fechado (sem construtor livre de condições).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A clínica liga a primeira regra e ela chega (Priority: P1)

A nutricionista abre a tela de notificações automáticas, vê um catálogo de
regras prontas, liga "Hábito sem registro", escolhe o item do checklist, define
"3 dias seguidos", revisa o texto sugerido e salva. No dia seguinte, os
pacientes que se enquadram recebem a mensagem no WhatsApp.

**Why this priority**: é a feature inteira em miniatura — catálogo, parâmetro,
público, mensagem, envio. Sem isto nada mais tem valor; com isto só isto, a
clínica já recupera pacientes que estavam se perdendo em silêncio.

**Independent Test**: ligar uma regra, colocar um paciente na condição, rodar o
ciclo e receber a mensagem no celular. Entregável sozinho.

**Acceptance Scenarios**:

1. **Given** uma regra "hábito sem registro por 3 dias" ligada e um paciente com
   o hábito sem marcação há 3 dias, **When** o ciclo diário roda, **Then** o
   paciente recebe uma mensagem que fala em "não vimos seu registro", nunca em
   "você não fez".
2. **Given** o mesmo paciente e a mesma regra, **When** o ciclo roda de novo no
   dia seguinte e a condição continua verdadeira, **Then** nenhuma segunda
   mensagem é enviada, porque o silêncio configurado ainda não venceu.
3. **Given** um paciente que marcou o hábito ontem, **When** o ciclo roda,
   **Then** ele não recebe nada.
4. **Given** uma regra ligada e um paciente sem consentimento para mensagens de
   acompanhamento, **When** o ciclo roda, **Then** nada é enviado e o motivo
   fica registrado como recusa, não como falha.

---

### User Story 2 - A regra não cobra quem sumiu do portal (Priority: P1)

O paciente parou de abrir o portal há duas semanas. As regras baseadas em
registro (hábito, medição) deixam de cobrá-lo, porque cobrar registro de quem
não está entrando é cobrar a coisa errada. Em vez disso, ele entra na regra de
reengajamento, que fala do sumiço e não do hábito.

**Why this priority**: é o que separa uma feature útil de uma que irrita. Sem
isto, o paciente que abandonou o portal recebe cobrança sobre hábitos que talvez
esteja cumprindo — a pior mensagem possível. Tem a mesma prioridade da US1
porque, entregue sem ela, a US1 gera dano.

**Independent Test**: dois pacientes idênticos em ausência de marcação, um com
acesso recente ao portal e outro sem; verificar que só o primeiro recebe a
mensagem de hábito e só o segundo recebe a de reengajamento.

**Acceptance Scenarios**:

1. **Given** um paciente sem marcação há 5 dias e sem acesso ao portal há 5
   dias, **When** o ciclo roda, **Then** ele não recebe a mensagem de hábito.
2. **Given** o mesmo paciente e a regra de reengajamento ligada, **When** o ciclo
   roda, **Then** ele recebe a mensagem de reengajamento.
3. **Given** um paciente sem marcação há 5 dias mas que entrou no portal ontem,
   **When** o ciclo roda, **Then** ele recebe a mensagem de hábito — a ausência
   de registro é informativa, porque ele esteve lá e não marcou.

---

### User Story 3 - A clínica escreve a mensagem com a própria voz (Priority: P2)

Cada regra traz um texto sugerido, editável, com campos que o sistema preenche
(nome do paciente, nome do hábito, quantidade de dias, nome da clínica). A
clínica vê uma prévia com dados de exemplo antes de salvar.

**Why this priority**: o texto padrão já entrega valor, mas tom é identidade —
a mesma frase soa acolhedora numa clínica e invasiva em outra. Depende da US1.

**Independent Test**: editar o texto de uma regra, ver a prévia preenchida e
receber a mensagem com o texto novo.

**Acceptance Scenarios**:

1. **Given** uma regra com texto editado contendo campos de preenchimento,
   **When** a mensagem é montada para um paciente, **Then** os campos aparecem
   preenchidos com os dados daquele paciente.
2. **Given** um texto com um campo que a regra não fornece, **When** a clínica
   tenta salvar, **Then** o sistema recusa e diz qual campo não existe.

---

### User Story 4 - Ninguém recebe demais (Priority: P2)

A clínica define quantas mensagens automáticas um paciente pode receber por
semana, somando todas as regras. Atingido o teto, as demais regras silenciam
para aquele paciente e voltam na semana seguinte.

**Why this priority**: uma condição de ausência permanece verdadeira todo dia, e
regras diferentes se sobrepõem no mesmo paciente — quem largou o acompanhamento
tende a disparar as quatro ao mesmo tempo. Sem teto global, a feature vira spam
exatamente com quem está mais fragilizado.

**Independent Test**: ligar três regras que se aplicam ao mesmo paciente, com
teto de 1 por semana, e verificar que só uma mensagem sai.

**Acceptance Scenarios**:

1. **Given** teto de 2 por semana e um paciente que se enquadra em 4 regras,
   **When** o ciclo roda, **Then** ele recebe no máximo 2 mensagens.
2. **Given** um paciente que atingiu o teto, **When** a semana vira, **Then**
   ele volta a poder receber.
3. **Given** duas regras aplicáveis e teto de 1, **When** o ciclo roda, **Then**
   a escolha entre elas é determinística e a regra preterida fica registrada
   como adiada, não como enviada.

---

### User Story 5 - A clínica reconhece, não só cobra (Priority: P2)

A clínica liga regras de celebração: o paciente que bateu a meta, que manteve a
sequência de hábitos, que fez aniversário, que saiu da consulta há três dias.
Essas mensagens não cobram nada — reconhecem.

**Why this priority**: é o contrapeso do resto da feature, e é mais barato de
construir que qualquer família de ausência: o evento está presente no dado, então
não passa pelo filtro de portal nem pela validação de linguagem. Sobe para P2
porque uma feature que só sabe cobrar não é um sistema de notificações — é um
sistema de cobrança, e o paciente aprende a ignorá-lo por inteiro.

**Independent Test**: um paciente que atinge a meta recebe o reconhecimento, sem
que nenhuma regra de ausência precise existir.

**Acceptance Scenarios**:

1. **Given** um paciente com meta ativa e uma medição que a alcança, **When** o
   ciclo roda, **Then** ele recebe a mensagem de reconhecimento.
2. **Given** um paciente que se enquadra em uma celebração e em duas ausências,
   com teto de 1, **When** o ciclo roda, **Then** a celebração é a que sai.
3. **Given** uma família de celebração, **When** a clínica salva um texto,
   **Then** a validação de expressões proibidas não se aplica.

---

### User Story 6 - O resto do catálogo de ausência (Priority: P3)

A clínica liga as demais regras de ausência: medição parada, meta se afastando,
exame solicitado e não realizado, avaliação vencida, recordatório em branco,
plano alimentar sem revisão, retorno vencido.

**Why this priority**: ampliam alcance para além de nutrição, mas o motor já
provou valor antes delas. A regra de retorno é a única que serve clínica de
qualquer especialidade — e a mais próxima de receita.

**Independent Test**: ligar cada regra isoladamente e verificar disparo com um
paciente construído para a condição.

**Acceptance Scenarios**:

1. **Given** um paciente sem registro de peso há 15 dias e a regra ligada com
   N=14, **When** o ciclo roda, **Then** ele recebe a mensagem.
2. **Given** um paciente com meta ativa de redução cujas duas últimas medições
   subiram, **When** o ciclo roda, **Then** ele recebe a mensagem de meta, com
   texto que **não** julga o resultado nem menciona número.
3. **Given** um paciente sem consulta há 7 meses e sem agendamento futuro, com a
   regra em N=6 meses, **When** o ciclo roda, **Then** ele recebe o convite de
   retorno.
4. **Given** o mesmo paciente mas com consulta futura já marcada, **When** o
   ciclo roda, **Then** nada é enviado.

---

### Edge Cases

- **Paciente inativo ou arquivado**: nunca recebe, mesmo que a condição seja
  verdadeira. Status do cadastro tem precedência sobre qualquer regra.
- **Paciente sem telefone e sem e-mail**: a ocorrência é registrada como
  impossível de entregar, sem tentativa e sem erro.
- **WhatsApp da clínica desconectado**: uma única ocorrência agregada por ciclo,
  não uma por paciente.
- **Checklist criado ontem**: uma grade recém-criada não pode disparar "sem
  registro há 5 dias" com base em dias anteriores à existência dela.
- **Regra desligada no meio do ciclo**: mensagens já enfileiradas não saem.
- **Módulo revogado depois de a regra estar ligada**: o motor para de enviar,
  sem depender de alguém desligar a regra na tela.
- **Paciente que se enquadra na mesma regra por dois itens diferentes** (dois
  hábitos abandonados): recebe uma mensagem, não duas.
- **Mudança de parâmetro** (de 3 para 7 dias): não redispara para quem já
  recebeu sob o parâmetro antigo dentro da janela de silêncio.
- **Fuso**: "dia" é sempre o dia do fuso da clínica, nunca o do servidor nem o
  do dispositivo do paciente.
- **Paciente que responde a mensagem no WhatsApp**: fora de escopo — o serviço
  de envio não recebe mensagens de entrada.

## Requirements *(mandatory)*

### Funcionais — catálogo e configuração

- **FR-001**: O sistema MUST oferecer um catálogo fechado de regras prontas.
  A clínica liga, desliga e parametriza; NÃO monta condições próprias, não
  combina condições com E/OU e não escolhe campos livremente.
- **FR-002**: O catálogo MUST conter, na primeira versão, **catorze** famílias,
  em duas naturezas:
  - **Celebração (5)** — meta atingida, sequência de hábito mantida,
    pós-consulta, aniversário do paciente, aniversário de acompanhamento.
  - **Ausência (9)** — hábito sem registro, sem registrar medição,
    afastando-se da meta, sem acesso ao portal, sem consulta com retorno em
    aberto, exame solicitado e não realizado, avaliação vencida, recordatório em
    branco, plano alimentar sem revisão.
- **FR-002a**: Famílias de celebração MUST NOT passar pelo filtro de atividade
  no portal nem pela validação de expressões proibidas. Um evento positivo está
  **presente** no dado, não ausente dele — não há suposição a controlar nem
  acusação possível. Aplicar os mesmos filtros seria custo sem risco a mitigar.
- **FR-002b**: Quando o teto do paciente é atingido, famílias de celebração
  MUST ter precedência sobre as de ausência. Um sistema que só sabe cobrar
  treina o paciente a temer a mensagem da clínica — e um paciente que evita as
  mensagens da clínica também deixa de ler o lembrete de consulta. Deixar a
  cobrança tomar a vaga do reconhecimento é o pior uso possível da única
  mensagem da semana.
- **FR-003**: Cada regra ligada MUST ter: parâmetro de tempo, público-alvo,
  texto da mensagem, canal e janela de silêncio.
- **FR-003a**: O público MUST ser "todos os pacientes ativos" ou "pacientes de
  um profissional". Neste segundo caso, o vínculo MUST ser o profissional da
  **consulta mais recente** do paciente — não existe vínculo direto entre
  paciente e profissional no cadastro, e a consulta mais recente é a única
  leitura que continua válida para quem não retorna há meses, que é justamente
  o público da regra de retorno.
- **FR-003b**: Paciente sem nenhuma consulta registrada MUST NOT entrar em
  público "por profissional" — não há de quem ele seja.
- **FR-004**: O sistema MUST permitir mais de uma instância da mesma família de
  regra com parâmetros diferentes (dois hábitos distintos, dois limiares).
- **FR-005**: O sistema MUST validar os parâmetros contra faixas plausíveis e
  recusar valores que gerariam disparo em massa ou nunca.
- **FR-006**: Alterar ou desligar uma regra MUST valer a partir do próximo
  ciclo, sem afetar o que já foi enviado.
- **FR-007**: Toda criação, alteração e desligamento de regra MUST ficar
  registrado em auditoria, com autor.

### Funcionais — como a regra decide

- **FR-008**: Nenhuma mensagem MUST afirmar que o paciente deixou de fazer algo.
  O sistema observa **ausência de registro**, e o texto MUST refletir só isso.
  Textos padrão e validação de texto customizado MUST impedir a afirmação.
- **FR-009**: Regras que dependem de registro do paciente (hábito, medição)
  MUST suprimir o disparo quando o paciente não teve acesso ao portal dentro da
  janela avaliada — ausência de registro de quem não entrou não é sinal.
- **FR-010**: A regra de reengajamento MUST ser a que atende esse paciente, de
  modo que ele não fique sem nenhum contato.
- **FR-011**: Uma regra MUST NOT avaliar período anterior ao início do dado que
  ela observa (grade de checklist, meta, cadastro do paciente).
- **FR-012**: O sistema MUST tratar "dia" no fuso da clínica.
- **FR-013**: Quando o mesmo paciente se enquadra na mesma regra por mais de um
  item, o sistema MUST enviar uma mensagem, agregando os itens.

### Funcionais — consentimento

- **FR-014**: Mensagem de acompanhamento MUST exigir consentimento **próprio**,
  distinto do consentimento de lembrete de consulta. São finalidades diferentes:
  quem aceitou ser lembrado da consulta não aceitou por consequência ser
  acompanhado entre elas.
- **FR-015**: O consentimento MUST ser hierárquico no padrão já existente — a
  recusa geral do paciente cala tudo; a recusa específica cala só o canal.
- **FR-016**: A clínica MUST conseguir ver e alterar o consentimento no cadastro
  do paciente, e a alteração MUST ficar auditada.
- **FR-017**: Toda mensagem MUST informar como parar de recebê-las, apontando um
  **canal de contato real da clínica** (telefone ou e-mail do perfil da clínica).
  A mensagem MUST NOT instruir o paciente a responder a própria mensagem: o
  canal de envio não lê respostas, e mandar responder para um lugar onde
  ninguém lê é pior que não dizer nada.
- **FR-017a**: A clínica MUST conseguir desligar o consentimento de um paciente
  em um clique, a partir da ficha dele, sem navegar até outra tela. Como a
  revogação passa por um humano, o caminho dela precisa ser curto — pedido de
  descadastro que depende de a recepcionista lembrar onde fica o campo não é
  revogação, é atrito.
- **FR-017b**: A clínica MUST conseguir ver, no perfil da clínica, se há
  telefone e e-mail preenchidos antes de ligar a primeira regra. Regra ligada
  sem contato de saída publicado gera mensagem que promete um caminho
  inexistente.
- **FR-018**: Recusa MUST ser registrada como recusa nas ocorrências, distinta
  de falha de entrega — confundir as duas esconde problema técnico e inventa
  problema de consentimento.

### Funcionais — envio e anti-spam

- **FR-019**: O sistema MUST respeitar uma janela de silêncio por regra e por
  paciente: satisfeita a condição e enviada a mensagem, a mesma regra não volta
  a falar com o mesmo paciente antes do prazo.
- **FR-020**: O sistema MUST respeitar um teto de mensagens automáticas por
  paciente **por semana**, somando todas as regras. O teto é configuração **da
  clínica**, não da regra: o paciente percebe o volume total que recebe, não a
  origem de cada mensagem. Padrão **2**, ajustável de 1 a 7.
- **FR-021**: Atingido o teto, a escolha de qual regra fala MUST ser
  determinística e a preterida MUST ficar registrada como adiada.
- **FR-022**: O sistema MUST respeitar a janela horária de envio da clínica.
- **FR-023**: Envios por WhatsApp MUST ser espaçados por clínica, no padrão já
  usado pelos lembretes.
- **FR-024**: Reprocessar o mesmo ciclo MUST NOT gerar mensagem duplicada.
- **FR-025**: Toda ocorrência MUST ser registrada com regra, paciente, condição
  no momento, canal, desfecho e horário — inclusive as que não geraram envio.
- **FR-026**: A clínica MUST conseguir ver o histórico de disparos por regra e
  por paciente.

### Funcionais — acesso e rollout

- **FR-027**: A feature MUST ser liberada por módulo, com verificação **na tela
  e no motor** — clínica com módulo revogado para de enviar sem depender de
  alguém desligar a regra.
- **FR-028**: Configurar regras MUST exigir permissão equivalente à de
  configurar lembretes.
- **FR-029**: O envio MUST usar os canais já existentes da clínica, sem exigir
  nova conexão nem nova credencial.

### Key Entities

- **Regra ligada**: uma instância parametrizada de uma família do catálogo,
  pertencente a uma clínica. Guarda a família, os parâmetros, o público, o
  texto, o canal, a janela de silêncio e se está ativa.
- **Família de regra**: definição fechada, do produto e não da clínica, do que
  a regra observa, quais parâmetros aceita e quais campos de preenchimento
  oferece ao texto.
- **Ocorrência**: registro do encontro entre uma regra e um paciente num ciclo —
  o que foi observado, o que foi decidido (enviar, silenciar, adiar, recusar) e
  o desfecho. É o histórico e a base do anti-spam.
- **Mensagem ao paciente**: registro de comunicação enviada a um paciente **sem
  vínculo com consulta**. Existe separada do lembrete de consulta porque aquele
  registro exige agendamento e tem ciclo de status próprio.
- **Consentimento de acompanhamento**: manifestação do paciente, distinta da de
  lembrete de consulta, sobre receber mensagens entre consultas.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A clínica liga a primeira regra e a deixa pronta para valer em
  menos de 3 minutos, sem ajuda e sem documentação.
- **SC-002**: Nenhum paciente recebe mais mensagens automáticas por semana que o
  teto configurado — verificável no histórico, sem exceção.
- **SC-003**: Nenhuma mensagem enviada afirma que o paciente deixou de fazer
  algo. Auditável por revisão de 100% dos textos padrão e por validação
  automática dos customizados.
- **SC-004**: Entre os pacientes que recebem mensagem de hábito, no mínimo 80%
  tiveram acesso ao portal na janela avaliada — mede se a supressão da US2 está
  de fato evitando cobrança indevida.
- **SC-005**: Ao menos 25% dos pacientes que recebem uma mensagem de
  acompanhamento registram alguma atividade (marcação, medição, acesso ou
  agendamento) nas 72h seguintes.
- **SC-006**: Menos de 2% dos pacientes que recebem mensagens de acompanhamento
  pedem para parar de recebê-las nos primeiros 3 meses.
- **SC-009**: Ao menos 30% das mensagens enviadas no período são de famílias de
  celebração. Abaixo disso, a clínica configurou um sistema de cobrança e não de
  acompanhamento — e é medida do produto, não da clínica: se ninguém liga as
  regras de reconhecimento, o catálogo as está escondendo.
- **SC-010**: Um pedido de descadastro feito à clínica é atendido no cadastro em
  até 1 dia útil — verificável pela auditoria da alteração de consentimento.
- **SC-007**: O ciclo diário conclui a avaliação de todas as clínicas dentro do
  tempo do ciclo, sem deixar clínica de fora por estouro.
- **SC-008**: Reprocessar um ciclo inteiro não gera nenhuma mensagem duplicada.

## Assumptions

- **Destinatário é só o paciente.** Notificação da mesma condição para a equipe
  da clínica fica para uma feature seguinte. Decidido com o solicitante.
- **Catálogo fechado, não construtor livre.** Decidido com o solicitante: sem
  DSL, sem editor de condição, sem E/OU.
- **Um ciclo por dia é suficiente.** As condições são todas de escala de dias;
  granularidade fina não agrega e a plataforma de deploy restringe a frequência.
- **O texto é da clínica, o gatilho é nosso.** A clínica edita a mensagem mas
  não muda o que a regra observa.
- **Canais são os já conectados** (WhatsApp da clínica e e-mail). A feature não
  introduz canal novo nem exige nova credencial.
- **A janela de silêncio tem padrão sensato por família de regra**, ajustável
  pela clínica — a clínica não precisa saber o que escolher para começar.
- **Consentimento novo nasce desligado para a base existente**, e ligado para
  cadastros novos com aceite explícito no momento do cadastro. Pedir de novo a
  quem já está na base é o preço de a finalidade ser diferente.
- **Segmentação de público na primeira versão é grosseira** — todos os pacientes
  ativos, ou os de um profissional. Segmentação fina fica para depois.
- **A janela horária é a mesma dos lembretes de consulta.** "A que horas é
  aceitável falar com meu paciente" é etiqueta da clínica, não propriedade do
  tipo de mensagem; duas janelas seriam dois lugares para errar, e o erro
  aparece como mensagem às 6 da manhã. Separar depois é acrescentar colunas, não
  redesenhar.
- **Canal "preferencial" resolve para WhatsApp quando a clínica está conectada e
  o paciente aceita esse canal; senão, e-mail.** Espelha o comportamento de
  fallback que os lembretes já têm.
- **O motor não lê nem responde mensagem de entrada.** O serviço de envio é
  send-only por decisão anterior.
- **Depende de**: motor de lembretes existente (ciclo, janela horária,
  espaçamento), canal WhatsApp da clínica, portal do paciente (fonte do sinal de
  acesso), checklist de hábitos, medições e metas.
