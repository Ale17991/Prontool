# Feature Specification: Motor de lembretes automáticos de consulta — email (Fase 1)

**Feature Branch**: `018-appointment-reminders`
**Created**: 2026-05-19
**Status**: Draft
**Input**: User description: ver `/speckit-specify` argumentos completos no histórico

## Clarifications

### Session 2026-05-19

- Q: Quantos lembretes por ciclo (15min) o motor deve tentar enviar antes de pausar para o próximo ciclo? → A: Batch limitado a 200 lembretes por ciclo; excesso cai no ciclo seguinte (perda máxima de pontualidade ≈ 15 minutos).
- Q: Reenvio manual pode ser usado em lembretes já enviados com sucesso, ou só em falhados/pulados? → A: Permitir em qualquer status (sent, failed, skipped); cada reenvio cria registro novo e é sempre auditado — admin assume a decisão.
- Q: No email de lembrete, quando o agendamento veio pela via interna (não pela rota pública), o que aparece em "como cancelar"? → A: Link clicável para a landing pública da clínica (`/agendar/[slug]`) quando a clínica tem essa página habilitada — paciente vê telefone/endereço e contato. Sem token de cancelamento direto. Se a clínica não tiver a landing pública habilitada, o email exibe apenas o telefone da clínica como instrução textual.
- Q: Se o profissional ou procedimento foi alterado/removido entre o agendamento e o envio do lembrete, qual dado aparece no email? → A: Dados atuais no momento do envio (JOIN com estado vigente). Reflete a realidade da clínica que o paciente encontrará; divergências em relação ao agendamento original são raras e devem ser gerenciadas manualmente pela clínica nesses casos extremos.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Clínica configura motor de lembretes em poucos minutos (Priority: P1)

A clínica habilita o motor de lembretes no painel administrativo, define quando os lembretes serão enviados (ex.: 24h antes), define a janela de horário permitido (ex.: 08h–20h) e opcionalmente customiza o template de mensagem. A partir desse momento, todos os agendamentos futuros entram automaticamente no ciclo de lembretes.

**Why this priority**: sem esta configuração, nenhum lembrete é enviado. É o portão de entrada da feature e deve estar disponível antes que qualquer paciente receba comunicação automática. Sem configuração explícita, a clínica controla quando o sistema começa a falar em nome dela — fundamental para conformidade LGPD e para construção de confiança em rollout gradual.

**Independent Test**: como admin, abrir o painel de configuração de lembretes, habilitar o toggle, salvar com antecedência padrão de 24h e janela 08–20h, recarregar a página e ver os valores persistidos. Não precisa do motor de envio rodando para validar esta entrega.

**Acceptance Scenarios**:

1. **Given** que sou admin e ainda não habilitei lembretes, **When** abro `/configuracoes/lembretes`, **Then** vejo a feature como desabilitada por padrão e um formulário com defaults sensatos (24h de antecedência, janela 08–20h, fins de semana habilitados).
2. **Given** que habilitei e salvei configuração de 24h, **When** recarrego a página, **Then** os valores aparecem persistidos e o status mostra "Lembretes ativos".
3. **Given** que sou recepcionista, **When** acesso `/configuracoes/lembretes`, **Then** consigo editar configuração igual ao admin.
4. **Given** que sou profissional de saúde (papel sem permissão), **When** tento acessar `/configuracoes/lembretes`, **Then** sou redirecionado e não consigo modificar a configuração.
5. **Given** que defini múltiplos offsets (ex.: 48h e 2h), **When** salvo, **Then** ambos são persistidos e ambos serão usados pelo motor.

---

### User Story 2 - Sistema envia lembrete automaticamente antes da consulta (Priority: P1)

Para cada agendamento que está prestes a entrar na janela de antecedência configurada (ex.: faltam ~24h para o horário marcado), o sistema envia automaticamente um email para o paciente com data, hora, profissional, endereço da clínica e instruções de cancelamento/contato. O envio acontece em um job recorrente que roda a cada 15 minutos, é idempotente (um lembrete por combinação `appointment × offset`) e respeita opt-out do paciente.

**Why this priority**: é o coração da feature. Sem o envio, a configuração do US1 não tem efeito prático. É o que entrega valor de negócio (redução de no-show) e o que o cliente realmente vai sentir.

**Independent Test**: criar um agendamento para daqui a 24h (com paciente que tem email cadastrado e opt-in), aguardar o próximo ciclo do motor de envio (ou disparar manualmente em ambiente de teste) e verificar (a) entrega real do email na caixa do paciente, (b) registro de envio bem-sucedido no histórico de lembretes da clínica, (c) entrada no log de auditoria registrando o envio.

**Acceptance Scenarios**:

1. **Given** que existe agendamento daqui a 24h ± 7min de um paciente com email e opt-in, **When** o motor de envio executa o ciclo, **Then** um email de lembrete é despachado ao paciente e um registro com status "enviado" é criado no histórico.
2. **Given** que o motor já enviou lembrete para uma combinação agendamento+antecedência, **When** o motor roda novamente 15 minutos depois, **Then** nenhum novo email é enviado para a mesma combinação (idempotência).
3. **Given** que o paciente fez opt-out, **When** o motor processa um agendamento dele dentro da janela, **Then** o sistema registra a tentativa como "pulado por opt-out" e NÃO envia email.
4. **Given** que o agendamento foi estornado entre a seleção e o envio, **When** o motor tenta enviar, **Then** o registro recebe status "pulado por estorno" e nada é enviado.
5. **Given** que o horário atual está fora da janela configurada (ex.: 03h), **When** o motor executa, **Then** o agendamento é deixado para o próximo ciclo dentro da janela.

---

### User Story 3 - Admin acompanha histórico e reenvia manualmente quando necessário (Priority: P2)

O admin abre o painel de lembretes e vê os últimos envios (paciente, profissional, horário, canal, status, motivo de falha quando aplicável) e os próximos lembretes que serão disparados nas próximas 24h. Para casos excepcionais (paciente reportou que não recebeu, mudança de email), pode acionar reenvio manual de um lembrete específico — auditado.

**Why this priority**: dá confiança operacional (a clínica vê o motor funcionando, não opera no escuro) e fornece um botão de escape para os casos atípicos. Não é bloqueante para o valor central mas é essencial para adoção em larga escala.

**Independent Test**: depois de alguns lembretes terem sido enviados (US2), abrir `/configuracoes/lembretes`, ver a tabela de histórico paginada, clicar em "Reenviar" em um registro específico e confirmar que um novo email é despachado + um novo registro de auditoria é criado marcando reenvio manual.

**Acceptance Scenarios**:

1. **Given** que existem 5 lembretes enviados no último mês, **When** abro o painel, **Then** vejo os 5 em uma lista paginada com paciente, horário do agendamento, data/hora do envio e status.
2. **Given** que há um lembrete com status=failed, **When** olho o registro, **Then** vejo a razão amigável da falha (ex.: "Email do paciente inválido").
3. **Given** que sou admin, **When** clico em "Reenviar" em um lembrete já enviado com sucesso, **Then** o sistema dispara novo email e cria um registro distinto no histórico, marcado como envio manual; o registro original permanece intacto.
4. **Given** que sou recepcionista, **When** vejo o painel, **Then** consigo ver histórico e disparar reenvio (mesmo nível operacional do admin).
5. **Given** que abro o painel, **When** olho a seção "Próximos envios", **Then** vejo até 20 lembretes agendados para as próximas 24h.

---

### User Story 4 - Paciente controla se quer receber lembretes (Priority: P3)

A clínica registra, no perfil de cada paciente, se ele autoriza ou não receber lembretes automáticos. Pacientes opt-out continuam podendo ser atendidos, mas o sistema não envia comunicação automática para eles. A flag é gerenciada manualmente pela equipe na ficha do paciente (self-service do paciente fica para Fase 2).

**Why this priority**: requisito mínimo de LGPD/conformidade. Sem isso, a clínica não pode legalmente enviar comunicação para pacientes que recusaram. Prioridade P3 (não P1) apenas porque o default é opt-in e a maioria dos pacientes deseja receber lembretes — falta self-service do paciente em si, que vira Fase 2.

**Independent Test**: editar um paciente, desabilitar lembretes no perfil dele, criar um agendamento e ver que o ciclo de lembretes deixa de enviar para esse paciente (registra como `skipped_opt_out`).

**Acceptance Scenarios**:

1. **Given** que abro a ficha de um paciente, **When** vejo a seção de preferências, **Then** existe um toggle "Receber lembretes automáticos" habilitado por padrão.
2. **Given** que desabilito o toggle e salvo, **When** o motor processa um agendamento futuro desse paciente, **Then** o lembrete é registrado como "pulado por opt-out" (não envia email).
3. **Given** que pacientes existentes não tinham a flag, **When** a feature é habilitada pela primeira vez, **Then** todos são tratados como opt-in (default).

---

### Edge Cases

- **Clínica sem feature habilitada**: motor ignora completamente; nenhum registro é criado.
- **Paciente sem email cadastrado**: registro é criado como "pulado — sem canal de contato"; permite visibilidade ao admin sem entupir o histórico de falhas reais.
- **Múltiplas antecedências configuradas**: cada antecedência gera um registro independente; cliente recebe 2 emails (ex.: 48h antes + 2h antes); idempotência garante um envio por combinação.
- **Email do paciente foi atualizado após criar agendamento**: o motor usa o email atual no momento do envio (não congela no momento do agendamento).
- **Profissional ou procedimento foi alterado/removido após criar agendamento**: o motor usa os dados vigentes no momento do envio (mesma política do email do paciente); divergência entre o que o paciente combinou e o que aparece no lembrete deve ser tratada manualmente pela clínica.
- **Clínica em fuso horário diferente**: a janela de envio é interpretada no fuso configurado da clínica (default horário de Brasília).
- **Provedor de email indisponível (rate limit, instabilidade)**: registro fica como "falhou" com motivo legível; sem nova tentativa automática nesta fase (Fase 2 traz retry exponencial).
- **Fim de semana com toggle desligado**: lembretes que cairiam em sábado ou domingo são adiados; clínica define se aceita ou não.
- **Agendamento cancelado/estornado entre seleção e envio**: condição de corrida resolvida por verificação imediatamente antes do envio; registra como "pulado por estorno".
- **Lembrete fora da janela permitida (ex.: 03h)**: pulado e tentado novamente no próximo ciclo dentro da janela; se passar do horário do agendamento sem nunca abrir janela, fica como "pulado" (não dispara depois do horário do agendamento).
- **Reenvio manual**: cria registro independente do histórico de envios automáticos; sempre ignora opt-out parcial (admin decide assumir responsabilidade). Sempre auditado.

## Requirements _(mandatory)_

### Functional Requirements

**Configuração e governança**

- **FR-001**: O sistema MUST permitir a cada clínica habilitar ou desabilitar o motor de lembretes independentemente, com a feature desabilitada por padrão para novos tenants.
- **FR-002**: O sistema MUST permitir a cada clínica definir uma ou mais antecedências de envio (em horas antes do agendamento), com default de 24h e suporte a múltiplos valores (ex.: 48h + 2h).
- **FR-003**: O sistema MUST permitir a cada clínica definir uma janela de horário permitido para envio (horário de início e fim no fuso do tenant), com default de 08h às 20h.
- **FR-004**: O sistema MUST permitir habilitar/desabilitar envio em fins de semana, com default habilitado.
- **FR-005**: O sistema MUST permitir customizar o assunto e o corpo do email com placeholders básicos (paciente, profissional, horário, clínica), oferecendo template padrão quando não customizado.
- **FR-006**: O sistema MUST restringir a tela de configuração e a operação de reenvio manual aos papéis `admin` e `recepcionista`.

**Envio automático**

- **FR-007**: O sistema MUST verificar periodicamente (a cada 15 minutos) os agendamentos próximos e enviar lembrete para todos que entrem na janela da antecedência configurada, processando no máximo 200 lembretes por ciclo (o excedente fica elegível no ciclo seguinte).
- **FR-008**: O sistema MUST garantir idempotência por combinação `(agendamento, antecedência, canal)`: nunca enviar dois lembretes para a mesma combinação, mesmo que o job rode múltiplas vezes ou tenha falhas transitórias.
- **FR-009**: O sistema MUST registrar cada tentativa de envio (sucesso, falha, ou pulado) em uma tabela append-only com motivo legível para falhas.
- **FR-010**: O sistema MUST gravar registros de auditoria para cada envio (`reminder_sent` e `reminder_failed`).
- **FR-011**: O sistema MUST respeitar a flag de opt-out por paciente, registrando como `skipped_opt_out` quando aplicável.
- **FR-012**: O sistema MUST não enviar lembrete para agendamentos estornados, registrando como `skipped_reversed` quando detectado.
- **FR-013**: O sistema MUST respeitar a janela de horário permitido e o toggle de fins de semana, adiando envios fora dessas janelas para o próximo ciclo elegível.
- **FR-014**: O sistema MUST sobreviver a falhas individuais sem bloquear o ciclo inteiro (falha em um envio não impede os demais agendamentos do mesmo ciclo).
- **FR-015**: O sistema MUST autenticar o job recorrente com um segredo dedicado para evitar disparo externo não autorizado.

**Histórico e operação**

- **FR-016**: O sistema MUST exibir no painel administrativo um histórico paginado dos últimos lembretes enviados/tentados, incluindo paciente, profissional, data/hora do agendamento, data/hora do envio, status e motivo de falha.
- **FR-017**: O sistema MUST exibir no painel administrativo os próximos N lembretes (até 20) que serão enviados nas próximas 24h.
- **FR-018**: O sistema MUST permitir reenvio manual de um lembrete específico para um agendamento independentemente do status anterior (sucesso, falha ou pulado), registrando cada reenvio como tentativa distinta no histórico e sempre gerando registro de auditoria.

**LGPD e privacidade**

- **FR-019**: O sistema MUST registrar opt-in por padrão e oferecer opt-out por paciente, com a possibilidade de a clínica gerenciar a flag pela ficha do paciente.
- **FR-020**: O sistema MUST não armazenar email do paciente em texto claro em logs ou em registros de auditoria; o email aparece apenas no envio ao provedor.
- **FR-021**: O sistema MUST garantir isolamento multi-tenant: lembretes de uma clínica nunca acessam ou afetam agendamentos de outra (gate constitucional III; verificado por teste de contrato antes do merge).

**Conteúdo do email**

- **FR-022**: O email de lembrete MUST conter nome do paciente, data e hora do agendamento (com fuso explícito), nome do profissional, nome do procedimento, nome da clínica, e telefone/endereço quando disponíveis. Os dados de profissional, procedimento e clínica refletem o estado vigente no momento do envio, não o estado no momento do agendamento.
- **FR-023**: O email de lembrete MUST oferecer caminho claro para o paciente cancelar ou entrar em contato, com a seguinte hierarquia: (a) quando o agendamento foi criado pela rota pública, exibir link com token de cancelamento direto; (b) quando o agendamento foi criado pela via interna E a clínica tem landing pública habilitada, exibir link para a landing pública da clínica (sem token; serve para o paciente ver dados de contato); (c) quando nenhum dos dois aplica, exibir o telefone da clínica como instrução textual.

### Key Entities _(include if feature involves data)_

- **Tenant Reminder Settings**: configuração por clínica sobre quando, onde e como enviar lembretes (habilitado, offsets, janela de horário, fim de semana, template). Existe lazy — quando admin abre a tela pela primeira vez, valores default aparecem; quando salva, a configuração é persistida.
- **Patient Reminder Preference**: flag por paciente indicando se autoriza receber lembretes automáticos. Default opt-in.
- **Appointment Reminder Record**: registro append-only de cada tentativa de envio, com referência ao agendamento e ao offset, status (queued/sent/failed/skipped_opt_out/skipped_reversed), motivo de falha quando aplicável, momento do envio e identificador externo do provedor (quando há). Idempotência via unicidade de `(appointment, offset, channel)`.
- **Audit Trail**: cada envio (sucesso ou falha) gera registro de auditoria padrão da plataforma, preservando rastreabilidade exigida pela constituição (Princípio II).

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: 95% ou mais dos agendamentos elegíveis (paciente com email + opt-in + tenant com feature habilitada) recebem ao menos um lembrete dentro da janela esperada.
- **SC-002**: 98% ou mais dos envios concluem com sucesso (sem falha de provedor ou erro evitável de configuração).
- **SC-003**: 100% dos lembretes são enviados dentro da janela configurada (não enviar fora do horário definido pela clínica).
- **SC-004**: 100% das tentativas — incluindo falhas e pulos — ficam registradas e auditadas, permitindo investigação posterior.
- **SC-005**: Tempo médio para configurar o motor a partir do zero (habilitar + escolher offset + salvar): ≤ 2 minutos.
- **SC-006**: Em 60 dias após o lançamento da feature, pelo menos 40% das clínicas ativas habilitam lembretes.
- **SC-007**: Em 30 dias após o lançamento, redução média de no-show medida pelas clínicas que adotaram a feature: ≥ 10% comparado ao período anterior.
- **SC-008**: Zero violações de isolamento multi-tenant em testes de contrato (gate constitucional III).
- **SC-009**: Zero registros de email de paciente em texto claro em logs operacionais (validado por auditoria de logs e por teste).
- **SC-010**: O motor sobrevive a falhas individuais — em ciclos com erros pontuais, ≥ 99% dos demais envios completam normalmente.

## Assumptions

- A clínica é responsável por comunicar aos pacientes que poderão receber lembretes (atualizando sua política de privacidade ou termos de uso); o sistema apenas oferece o opt-out e registra o consentimento agregado.
- O canal único nesta fase é email; os mecanismos de registro e disparo já preveem distinção de canal para acomodar WhatsApp/SMS na Fase 2 sem refatoração estrutural.
- Pacientes existentes herdam opt-in por default; clínicas que considerem isso inadequado para sua base atual devem desabilitar a feature até registrarem consentimento explícito.
- O fuso horário padrão das clínicas é América/São_Paulo; tenants com fuso diferente são atendidos pelo mesmo mecanismo (janela é interpretada no fuso da clínica).
- O provedor de email atualmente em uso suporta envios em volume compatível com o crescimento esperado (até 1000 clínicas ativas com média 5 envios/dia); upgrade do plano do provedor é uma decisão operacional posterior, não bloqueia o rollout.
- A frequência de execução do motor (a cada 15 minutos) é considerada suficiente para a precisão exigida pelos clientes; precisão maior (1 minuto) é fora de escopo.
- Pacientes que clicam no link de cancelamento dentro de um email de lembrete e tinham agendamento criado pela via interna (não pública) verão uma página de login; pode ficar como melhoria de Fase 2 (estender token público para agendamentos internos).
- O motor de lembretes não envia confirmações pós-consulta nem pesquisas de NPS; aquilo é uma feature separada.
- Falhas de provedor de email são consideradas raras e transitórias o suficiente para que retry manual atenda à Fase 1; retry automático é Fase 2.
