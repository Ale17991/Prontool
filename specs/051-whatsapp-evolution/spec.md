# Feature Specification: Lembretes de consulta por WhatsApp

**Feature Branch**: `051-whatsapp-evolution`
**Created**: 2026-07-28
**Status**: Draft
**Input**: User description: "Lembretes de consulta por WhatsApp via Evolution API (canal whatsapp no motor de lembretes da 018)"

## Clarifications

### Session 2026-07-28

- Q: O SC-004 comparava a taxa de leitura do WhatsApp com a abertura de e-mail, que não é medida hoje. O que ele vira? → A: Alvo absoluto — ao menos 70% dos lembretes entregues são lidos em até 24h.
- Q: O WhatsApp precisa de janela de horário própria? → A: Não. A janela não pertence ao canal, e sim ao **tipo de notificação** — e isso, junto com segmentação e agendamento por evento (aniversário, datas comemorativas, N horas antes/depois da consulta), é escopo de uma feature separada de motor de notificações. A 051 reusa a janela existente sem acrescentar configuração nova (FR-028).
- Q: Ao detectar que o número foi bloqueado pelo WhatsApp, o sistema desliga o canal sozinho ou só avisa? → A: Só avisa, com destaque, e mantém o canal ligado — desligar sozinho arrisca parar os lembretes por falso positivo. Exige capturar o motivo da queda, não só o estado (FR-012a).
- Q: A mensagem avisa que respostas não são lidas, ou só oferece o contato? → A: Avisa explicitamente, em tom de parceria, e oferece o canal certo com a mesma hierarquia de fallback do e-mail — o paciente que responde "preciso remarcar" e nunca é lido perde a consulta achando que avisou (FR-007a).
- Q: O reenvio manual de lembrete, que já existe no e-mail, vale para WhatsApp no v1? → A: Sim, igual ao e-mail. O FR-027 proíbe mensagem **avulsa** de conteúdo livre, não o reenvio do mesmo lembrete templado — a redação anterior era ambígua e foi corrigida.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Clínica conecta o próprio número de WhatsApp (Priority: P1)

A clínica abre a tela de integrações, pede para conectar o WhatsApp, aparece um QR Code na
tela, ela escaneia com o celular do consultório e o painel passa a mostrar "Conectado" com o
número que foi vinculado. Se a conexão cair depois (celular sem bateria, sessão expirada), o
painel mostra "Desconectado" e oferece reconectar.

**Why this priority**: Sem número conectado nenhuma mensagem sai. É a pré-condição de todo o
resto e é a única parte que depende de uma ação física da clínica.

**Independent Test**: Conectar um número de teste, ver o status virar "Conectado" e disparar
uma mensagem de teste para o próprio celular. Entrega valor sozinho: a clínica já pode
verificar que o canal está de pé.

**Acceptance Scenarios**:

1. **Given** uma clínica sem WhatsApp conectado, **When** ela solicita a conexão, **Then** um
   QR Code é exibido em até 15 segundos e permanece válido até ser escaneado ou expirar.
2. **Given** um QR Code exibido, **When** a clínica escaneia com o WhatsApp do consultório,
   **Then** o painel passa a "Conectado" e mostra o número vinculado em até 30 segundos.
3. **Given** um número conectado, **When** a sessão cai, **Then** o painel mostra
   "Desconectado" e um aviso é registrado para a clínica.
4. **Given** um número conectado, **When** a clínica pede para desconectar, **Then** o vínculo
   é removido e nenhuma mensagem posterior é enviada por esse canal.

---

### User Story 2 - Paciente recebe o lembrete da consulta no WhatsApp (Priority: P1)

Com o número conectado e o motor de lembretes ligado, o paciente que tem consulta marcada
recebe, na antecedência configurada pela clínica, uma mensagem de WhatsApp com o lembrete —
nome do paciente, médico, procedimento, data e hora, e como cancelar.

**Why this priority**: É o valor central da feature. Lembrete por WhatsApp tem taxa de leitura
muito maior que e-mail no público de clínica.

**Independent Test**: Marcar uma consulta dentro da janela de antecedência, rodar o ciclo de
lembretes e confirmar que a mensagem chegou no WhatsApp do paciente com os dados corretos.

**Acceptance Scenarios**:

1. **Given** clínica com lembretes ligados, canal WhatsApp e número conectado, **When** uma
   consulta entra na antecedência configurada, **Then** o paciente recebe uma mensagem de
   WhatsApp com os dados da consulta.
2. **Given** o mesmo agendamento e a mesma antecedência, **When** o ciclo de lembretes roda
   novamente, **Then** nenhuma segunda mensagem é enviada para o paciente.
3. **Given** um paciente sem telefone cadastrado, **When** o ciclo roda, **Then** nenhuma
   mensagem é tentada e o motivo fica registrado para a clínica consultar.
4. **Given** um agendamento estornado, **When** o ciclo roda, **Then** nenhuma mensagem é
   enviada.
5. **Given** uma consulta cujo horário de envio cai fora da janela permitida ou em fim de
   semana com envio desabilitado, **When** o ciclo roda, **Then** a mensagem não é enviada
   naquele momento, respeitando as regras já existentes de janela.

---

### User Story 3 - Clínica escolhe por qual canal o lembrete sai (Priority: P2)

Na tela de configuração de lembretes, a clínica escolhe se o lembrete sai por e-mail, por
WhatsApp, ou pelos dois. Se escolher WhatsApp e o paciente não tiver telefone, a clínica pode
optar por cair para e-mail em vez de simplesmente não avisar ninguém.

**Why this priority**: Sem isso, ligar o WhatsApp obrigaria a clínica a abrir mão do e-mail —
ou a mandar em duplicidade sem querer. Mas o v1 já entrega valor com um canal fixo.

**Independent Test**: Alternar a configuração entre os três modos e confirmar, para o mesmo
agendamento, que a mensagem sai pelo(s) canal(is) esperado(s).

**Acceptance Scenarios**:

1. **Given** a clínica configurada para "somente WhatsApp", **When** o ciclo roda, **Then**
   nenhum e-mail de lembrete é enviado.
2. **Given** a clínica configurada para "ambos", **When** o ciclo roda, **Then** o paciente
   recebe um lembrete por cada canal, cada um com seu próprio registro de envio.
3. **Given** a clínica configurada para "WhatsApp com fallback", **When** o paciente não tem
   telefone mas tem e-mail, **Then** o lembrete sai por e-mail.

---

### User Story 4 - Clínica acompanha entrega e leitura (Priority: P3)

No histórico de lembretes a clínica vê, por mensagem, se ela foi enviada, entregue no aparelho
do paciente e lida — e, quando falhou, o motivo em linguagem que a recepção entenda.

**Why this priority**: Melhora muito a confiança no canal e reduz "será que chegou?", mas o
lembrete já funciona sem isso.

**Independent Test**: Enviar um lembrete para um número de teste, abrir a mensagem no celular
e confirmar que o histórico progride para "entregue" e depois "lida".

**Acceptance Scenarios**:

1. **Given** um lembrete enviado por WhatsApp, **When** o aparelho do paciente recebe a
   mensagem, **Then** o histórico passa a mostrar "entregue".
2. **Given** um lembrete entregue, **When** o paciente abre a mensagem, **Then** o histórico
   passa a mostrar "lida".
3. **Given** um lembrete já marcado como "lida", **When** chega uma confirmação atrasada de
   "entregue", **Then** o histórico continua mostrando "lida" (o status não regride).
4. **Given** um envio que falhou, **When** a clínica abre o histórico, **Then** ela vê um
   motivo compreensível, sem jargão técnico.

---

### User Story 5 - Paciente pode recusar receber por WhatsApp (Priority: P3)

O paciente que não quer receber lembretes no WhatsApp tem esse desejo respeitado — registrado
pela recepção no cadastro do paciente — sem que isso o impeça de continuar recebendo por
e-mail, se for o caso.

**Why this priority**: Exigência de LGPD e de boa educação comercial. O motor já tem opt-out
hoje; o que falta é ele valer por canal.

**Independent Test**: Marcar um paciente como recusado no WhatsApp, rodar o ciclo e confirmar
que ele não recebeu WhatsApp e continuou recebendo e-mail.

**Acceptance Scenarios**:

1. **Given** um paciente que recusou WhatsApp, **When** o ciclo roda, **Then** nenhuma
   mensagem de WhatsApp é enviada a ele e o motivo fica registrado.
2. **Given** um paciente que recusou lembretes por completo, **When** o ciclo roda, **Then**
   nenhum lembrete sai por nenhum canal.

---

### Edge Cases

- **Número desconectado na hora do envio**: o lote inteiro da clínica falharia em cascata. O
  sistema precisa detectar antes de tentar, registrar de forma agregada (não uma falha por
  paciente) e avisar a clínica.
- **Telefone que não existe no WhatsApp**: número válido no formato, mas sem conta. Deve virar
  falha individual com motivo claro, não travar o lote.
- **Telefone em formato antigo (8 dígitos, sem o 9)**: precisa ser corrigido no envio sem
  corromper números de faixas novas.
- **Número da clínica banido pelo WhatsApp**: todos os envios passam a falhar. Precisa ser
  distinguível de "desconectado" e comunicado à clínica.
- **Reenvio/retentativa do ciclo**: uma falha de rede no meio do lote não pode fazer o paciente
  receber a mesma mensagem duas vezes.
- **Paciente responde a mensagem**: fora de escopo neste v1 — mas a mensagem deve deixar claro
  para onde o paciente deve ligar/escrever, para não ficar falando com um canal que não escuta.
- **Volume concentrado**: o ciclo diário processa todos os lembretes de uma vez; disparar tudo
  em rajada aumenta risco de bloqueio do número.
- **Paciente com telefone mas sem e-mail** (e vice-versa) em cada modo de canal.
- **Clínica que nunca conectou o WhatsApp mas ligou o canal**: deve ser impedida na
  configuração, não descobrir no dia seguinte que ninguém foi avisado.

## Requirements *(mandatory)*

### Functional Requirements

**Conexão do número**

- **FR-001**: O sistema MUST permitir que cada clínica vincule um número de WhatsApp próprio,
  por autoatendimento, a partir da área de configuração.
- **FR-002**: O sistema MUST exibir o estado da conexão (conectado / conectando / desconectado)
  e o número vinculado.
- **FR-003**: O sistema MUST permitir reconectar e desvincular o número.
- **FR-004**: O sistema MUST isolar os números por clínica — uma clínica nunca pode enviar,
  listar ou desconectar pelo número de outra.
- **FR-005**: O sistema MUST impedir que o canal WhatsApp seja ativado enquanto não houver
  número conectado, explicando o que falta.

**Envio do lembrete**

- **FR-006**: O sistema MUST enviar lembretes de consulta por WhatsApp respeitando as regras já
  existentes do motor de lembretes: antecedências configuradas, janela de horário permitida,
  envio ou não em fim de semana, e agendamentos estornados.
- **FR-007**: O sistema MUST montar a mensagem em texto simples, com nome do paciente, médico,
  procedimento, data e hora da consulta, nome da clínica e a orientação de como cancelar.
- **FR-007a**: A mensagem MUST informar, em tom de parceria, que respostas naquela conversa não
  são lidas, e MUST oferecer o canal correto de contato seguindo a mesma hierarquia de fallback
  já usada no lembrete por e-mail: link de agendamento público quando houver, telefone da
  clínica quando não houver, e orientação genérica de procurar a clínica quando não houver
  nenhum dos dois.
- **FR-008**: O sistema MUST garantir que o mesmo agendamento, na mesma antecedência e no mesmo
  canal, gere no máximo uma mensagem — mesmo que o ciclo seja executado mais de uma vez ou que
  haja retentativa por falha de rede.
- **FR-009**: O sistema MUST normalizar o telefone do paciente para o formato aceito pelo
  WhatsApp antes de enviar, sem corromper números de faixas novas.
- **FR-010**: O sistema MUST registrar cada tentativa de envio de forma permanente e
  não-editável, indicando canal, resultado e motivo em caso de não-envio.
- **FR-011**: O sistema MUST distinguir, no registro, "não enviado por falta de telefone",
  "não enviado por recusa do paciente", "não enviado por número da clínica indisponível" e
  "falha no envio".
- **FR-012**: O sistema MUST verificar que o número da clínica está conectado antes de iniciar
  o lote, e registrar uma única ocorrência agregada quando não estiver — em vez de uma falha
  por paciente.
- **FR-012a**: O sistema MUST distinguir "número bloqueado pelo WhatsApp" de "número apenas
  desconectado", capturando o motivo da queda da conexão e não só o estado. Ao detectar
  bloqueio, MUST avisar a clínica com destaque na tela de conexão e MUST NOT desligar o canal
  automaticamente — a decisão de reconectar ou trocar de número é da clínica.

<!-- FR-007a e FR-012a foram acrescentados na sessão de clarificação de 2026-07-28; a
     numeração com sufixo evita renumerar requisitos já referenciados em plan.md e tasks.md. -->
- **FR-013**: O sistema MUST espaçar os envios de um mesmo número ao longo do lote, para
  reduzir o risco de bloqueio do número da clínica.
- **FR-014**: O sistema MUST continuar processando os demais pacientes quando um envio
  individual falhar.

**Escolha de canal e consentimento**

- **FR-015**: A clínica MUST poder escolher se os lembretes saem por e-mail, por WhatsApp ou
  por ambos.
- **FR-016**: O sistema MUST respeitar a recusa do paciente em receber lembretes, com granularidade
  por canal.
- **FR-017**: O sistema MUST permitir que a recepção registre e altere essa recusa a partir do
  cadastro do paciente, com registro de auditoria de quem alterou.

**Confirmação de entrega**

- **FR-018**: O sistema MUST refletir, no histórico de lembretes, a evolução do status de cada
  mensagem: enviada, entregue no aparelho e lida.
- **FR-019**: O sistema MUST NOT permitir que o status regrida (uma confirmação atrasada não
  pode rebaixar uma mensagem já lida).
- **FR-020**: O sistema MUST aceitar confirmações de status apenas de origem autenticada,
  descartando qualquer confirmação não autenticada.
- **FR-021**: O sistema MUST apresentar os motivos de falha em linguagem compreensível para a
  recepção, sem jargão técnico.

**Privacidade e segurança**

- **FR-022**: O sistema MUST tratar o telefone do paciente como dado pessoal: nunca exposto em
  logs, nunca gravado em texto claro fora do cadastro cifrado do paciente.
- **FR-023**: O sistema MUST guardar as credenciais de acesso ao serviço de WhatsApp de forma
  cifrada, nunca em variável de ambiente ou em texto claro.
- **FR-024**: O sistema MUST restringir a conexão/desconexão do número ao papel administrativo
  da clínica.
- **FR-025**: O sistema MUST registrar em auditoria a ativação do canal, a conexão e a
  desconexão do número.

**Escopo negativo (v1)**

- **FR-026**: O sistema MUST NOT processar mensagens recebidas dos pacientes neste v1.
- **FR-027**: O sistema MUST NOT oferecer envio de mensagem **avulsa** — de conteúdo livre
  digitado pela recepção — neste v1. O **reenvio manual de um lembrete existente**, que já é
  comportamento vigente no canal de e-mail, MUST valer também para o WhatsApp, com o mesmo
  conteúdo templado e o mesmo registro de auditoria.
- **FR-028**: O sistema MUST NOT introduzir, neste v1, agendamento por tipo de notificação,
  segmentação de destinatários, mensagens de aniversário ou de data comemorativa, nem
  antecedência/posterioridade configurável por evento. A janela de envio continua sendo a única
  já existente, compartilhada por todos os canais. Essas capacidades pertencem à feature de
  motor de notificações e serão especificadas à parte.

### Key Entities

- **Conexão de WhatsApp da clínica**: o vínculo entre uma clínica e um número de WhatsApp.
  Guarda o estado da conexão, o número vinculado e quando foi conectado. Uma clínica tem no
  máximo uma conexão ativa no v1.
- **Lembrete**: registro permanente de uma tentativa de aviso ao paciente sobre uma consulta.
  Já existe; ganha o canal WhatsApp, os novos motivos de não-envio e a evolução de entrega.
- **Consentimento do paciente**: a manifestação do paciente sobre receber ou não lembretes, com
  granularidade por canal.
- **Configuração de lembretes da clínica**: já existe; ganha a escolha de canal.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Uma clínica consegue conectar o próprio número de WhatsApp sozinha, sem suporte,
  em menos de 3 minutos do primeiro clique até o status "Conectado".
- **SC-002**: Em um ciclo de lembretes de uma clínica com número conectado, ao menos 95% dos
  pacientes com telefone válido e consentimento recebem a mensagem.
- **SC-003**: Nenhum paciente recebe a mesma mensagem de lembrete duas vezes, mesmo com o ciclo
  executado repetidamente no mesmo dia.
- **SC-004**: Ao menos 70% dos lembretes entregues no WhatsApp são lidos pelo paciente em até
  24 horas.
- **SC-005**: Quando o número da clínica está desconectado, a clínica é avisada no mesmo dia,
  e o histórico mostra uma única ocorrência explicativa em vez de uma falha por paciente.
- **SC-006**: A recepção consegue identificar, olhando o histórico, por que um paciente
  específico não foi avisado, sem precisar acionar suporte.
- **SC-007**: Nenhum telefone de paciente aparece em log de sistema.

## Assumptions

- O envio usa a Evolution API já operada pela Homio, compartilhada com outro produto. A decisão
  de usar solução não-oficial (com risco de bloqueio de número) foi tomada conscientemente pelo
  responsável do produto em 2026-07-28, preferindo-a à API oficial da Meta por custo e por não
  exigir aprovação de template.
- Cada clínica conecta o **próprio** número — não existe número único da Clinni. O risco de
  bloqueio, portanto, recai sobre o número da clínica.
- O ciclo de lembretes continua sendo **diário**, na frequência que já existe hoje. A
  hospedagem atual não permite execução mais frequente sem impacto em deploy, e esta feature
  não muda isso.
- O telefone do paciente já é coletado no cadastro e já está disponível de forma decifrada para
  o motor de envio — nenhuma coleta nova de dado é necessária.
- O braço de integração com a Evolution API existe como serviço separado, com contrato de envio
  e de confirmação de status já definidos, e será endurecido (autenticação da confirmação de
  status, isolamento por clínica no armazenamento, proteção contra envio duplicado e
  espaçamento de envios) como pré-requisito desta feature.
- O histórico e a tela de configuração de lembretes já existem e serão estendidos, não
  recriados.
- Mensagens avulsas, atendimento por WhatsApp e recebimento de respostas ficam para uma feature
  posterior.

## Dependencies

- Serviço de envio de WhatsApp conectado à Evolution API, com número por clínica.
- Motor de lembretes existente (antecedências, janela, opt-out, histórico).
- Cadastro de paciente com telefone e com consentimento.
