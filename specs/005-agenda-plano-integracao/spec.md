# Feature Specification: Integração agenda ↔ plano de tratamento + validação de conflito de horário

**Feature Branch**: `005-agenda-plano-integracao`
**Created**: 2026-04-28
**Status**: Draft
**Input**: User description: "Integração completa entre plano de tratamento e agenda de atendimentos com horários — horário início/fim obrigatórios, validação de conflito por profissional bloqueante no banco, etapa do plano vincula a um atendimento, calendário como visualização padrão."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Bloqueio de conflito de horário por profissional (Priority: P1)

A recepcionista está agendando um atendimento (pelo formulário "Novo atendimento" ou criando uma etapa no plano de tratamento de um paciente). Ela escolhe a Dra. Aline e o horário 14:00 às 14:30. Mas a Dra. Aline já tem outro paciente agendado das 14:15 às 14:45. O sistema **deve impedir** o agendamento, mostrar quem está no slot conflitante, e não permitir salvar até que o horário seja ajustado.

**Why this priority**: É o requisito mais crítico desta feature. "Tolerância zero" foi a expressão do usuário. Se o sistema permitir conflito, a clínica pode receber dois pacientes no mesmo horário — falha operacional grave que motiva a feature inteira. Toda a arquitetura (constraint no banco, validação dupla front+back, integração agenda↔plano) gira em torno disso.

**Independent Test**: Pode ser entregue isoladamente — antes mesmo da integração agenda↔plano. Validação: criar dois atendimentos para o mesmo profissional com horários sobrepostos, confirmar que o segundo é rejeitado com erro claro identificando o conflito. Repetir com horários adjacentes (back-to-back, ex: 14:00–14:30 e 14:30–15:00) e confirmar que esses são aceitos.

**Acceptance Scenarios**:

1. **Given** a Dra. Aline tem agendamento das 14:00 às 14:30, **When** tento criar outro atendimento para ela das 14:15 às 14:45, **Then** o sistema rejeita o agendamento, retorna erro com código de conflito (HTTP 409), e a mensagem inclui o nome do paciente já agendado e o intervalo conflitante.
2. **Given** a Dra. Aline tem agendamento das 14:00 às 14:30, **When** crio outro atendimento para ela das 14:30 às 15:00 (back-to-back, sem sobreposição), **Then** o agendamento é aceito sem erro.
3. **Given** a Dra. Aline tem agendamento estornado das 14:00 às 14:30 (status `estornado`), **When** crio outro atendimento para ela no mesmo horário, **Then** o agendamento é aceito — atendimentos estornados não bloqueiam o slot.
4. **Given** o agendamento conflitante foi inserido por bypass do frontend (chamada direta de API ou seed/script), **When** a verificação roda, **Then** o banco rejeita via constraint/trigger, garantindo que nenhum caminho consegue inserir conflito.
5. **Given** dois agendamentos de profissionais **diferentes** no mesmo horário, **When** os agendamentos coexistem, **Then** ambos são aceitos — conflito é por profissional, não por slot global.
6. **Given** estou no formulário de "Novo atendimento" e seleciono profissional + horário que conflitam, **When** o cursor sai do campo de horário, **Then** o frontend já exibe aviso preventivo "Conflito com [paciente] das [HH:MM] às [HH:MM]" antes de o usuário tentar salvar.

---

### User Story 2 - Etapa do plano de tratamento vincula a um atendimento (Priority: P1)

A profissional planejando o tratamento de um paciente cria uma etapa "Sessão 1 — Avaliação" para a próxima terça às 14:00 (30 min). O sistema automaticamente cria o atendimento agendado correspondente, que aparece no calendário da clínica. Quando a paciente comparece e a etapa é marcada como concluída no plano, o atendimento vinculado também muda para "ativo" — sem precisar registrar duas vezes.

**Why this priority**: Resolve a duplicação de trabalho denunciada no contexto da feature ("são desconectados — criar uma etapa no plano não aparece no calendário"). É o segundo pilar da feature.

**Independent Test**: Após US1 estar pronta (precisamos do horário fim para o vínculo). Validação: criar etapa com horário, verificar que aparece no calendário; concluir etapa, verificar que atendimento muda para ativo; criar atendimento avulso com procedimento que coincide com etapa pendente do paciente, verificar que o vínculo é proposto/feito.

**Acceptance Scenarios**:

1. **Given** estou no plano de tratamento do paciente Pedro e crio uma etapa "Restauração D-12" para sexta 09:00–09:45, **When** a etapa é salva, **Then** um atendimento é criado automaticamente com status "agendado", vinculado à etapa, e aparece no calendário da clínica como bloco azul-claro com "Pedro · Restauração D-12 · 09:00–09:45".
2. **Given** a etapa foi criada e tem `appointment_id` apontando para o atendimento agendado, **When** marco a etapa como **concluída** no plano, **Then** o atendimento vinculado passa de "agendado" para "ativo" automaticamente, sem nova entrada manual.
3. **Given** marco como **realizado** o atendimento agendado diretamente pelo calendário (botão "Marcar realizado" no detalhe), **When** a operação completa, **Then** a etapa vinculada no plano de tratamento muda para "concluída" automaticamente.
4. **Given** estorno (cancelo) um atendimento que está vinculado a uma etapa, **When** a operação completa, **Then** a etapa vinculada muda para "cancelada" automaticamente.
5. **Given** marco uma etapa como **cancelada** no plano, **When** a operação completa, **Then** o atendimento vinculado é estornado automaticamente.
6. **Given** estou no formulário "Novo atendimento" e seleciono o paciente Pedro + procedimento "Restauração D-12" que coincide com uma etapa pendente do plano dele, **When** salvo, **Then** o atendimento criado é automaticamente vinculado à etapa pendente correspondente; a UI confirma o vínculo na resposta.
7. **Given** crio um atendimento para Pedro com procedimento que **não** corresponde a nenhuma etapa pendente, **When** salvo, **Then** o atendimento é criado como avulso (sem `treatment_step_id`), sem erro.
8. **Given** vejo a ficha do paciente Pedro, **When** olho o plano de tratamento, **Then** as etapas pendentes mostram horário (data + início + fim) e a etapa concluída mostra a referência cruzada ao atendimento (link clicável para `/operacao/atendimentos/[id]`).

---

### User Story 3 - Calendário como visualização padrão da agenda (Priority: P2)

A recepcionista entra em `/operacao/atendimentos` várias vezes por dia para conferir agenda. Hoje a página abre na visualização Lista. Para a operação dela, o calendário é mais útil como tela inicial. A preferência (Lista ou Calendário) deve ser lembrada por usuário.

**Why this priority**: UX, não bloqueante. US1 e US2 funcionam com lista também. Mas reduz fricção diária.

**Independent Test**: Independente de US1/US2. Validação: abrir `/operacao/atendimentos`, ver calendário (não lista) por padrão; alternar para Lista; recarregar a página; ver Lista (preferência salva). Trocar para Calendário; recarregar; ver Calendário.

**Acceptance Scenarios**:

1. **Given** é a primeira vez que acesso `/operacao/atendimentos` (sem preferência salva), **When** a página carrega, **Then** vejo a visualização Calendário (não Lista).
2. **Given** estou no Calendário e clico em "Lista", **When** a UI alterna, **Then** vejo a Lista.
3. **Given** preferência atual é Lista e recarrego a página, **When** a página carrega, **Then** continuo vendo Lista.
4. **Given** mudo para Calendário e recarrego, **When** a página carrega, **Then** vejo Calendário.
5. **Given** estou em outro navegador/dispositivo onde nunca acessei a página, **When** abro `/operacao/atendimentos`, **Then** vejo Calendário (default global, preferência é por dispositivo).

---

### User Story 4 - Conflitos visíveis no calendário (Priority: P3)

Em casos raros (dados antigos importados, bug de inserção, ou edição direta no banco), pode haver conflitos pré-existentes que escaparam à constraint. O calendário deve sinalizar visualmente esses conflitos (blocos vermelhos sobrepostos com indicador) para que a recepcionista perceba e resolva.

**Why this priority**: Defesa em profundidade — backup visual contra falhas da constraint. Não é o caminho principal de prevenção (que é US1).

**Independent Test**: Inserir manualmente dois atendimentos sobrepostos no banco (bypassando a constraint, ex: via SQL direto), abrir o calendário, ver que ambos aparecem com indicador visual de conflito.

**Acceptance Scenarios**:

1. **Given** dois atendimentos do mesmo profissional se sobrepõem no banco (vindo de dados legados ou inserção forçada), **When** abro o calendário, **Then** os blocos aparecem com borda/cor vermelha e ícone de aviso, e clicar em qualquer um expande detalhes do conflito.
2. **Given** vejo um conflito visualmente, **When** abro um dos blocos, **Then** a página de detalhe mostra um aviso "Este atendimento conflita com [outro_id] das [HH:MM] às [HH:MM]" com link para o outro.

---

### Edge Cases

- **Atendimento estornado no horário**: Não bloqueia o slot. Profissional pode receber novo agendamento no mesmo horário do estornado.
- **Edição de horário** de um atendimento existente: re-roda a verificação de conflito ignorando o próprio registro. Se passar, persiste; se conflitar, rejeita.
- **Múltiplos profissionais no mesmo paciente** simultaneamente (raro mas possível em odonto, ex: dentista + auxiliar): cada profissional tem seu agendamento separado, conflito é por profissional.
- **Atendimento que cruza meia-noite** (ex: 23:30 com 60 min): considerar `[start, end)` em UTC; sem case especial.
- **Etapa sem horário** (registros legados antes desta feature): manter NULL e UI marca "Sem horário definido — completar antes de aparecer no calendário". Não há backfill destrutivo.
- **Etapa cancelada antes de o atendimento ser criado**: registra cancelamento direto na etapa, não cria atendimento (e portanto não estorno).
- **Vincular atendimento a etapa quando há mais de uma etapa pendente do mesmo procedimento** para o paciente: linka à mais antiga (FIFO por `created_at`). Se o usuário quer outra, precisa cancelar essa primeiro.
- **Calendário renderiza muitos atendimentos** (50+ na semana): performance ainda dentro do limite SC-002 da feature 004 (≤ 1,5 s).
- **Slot da etapa fora do horário visível** (07:00–22:00): banner "N etapas fora do horário visível" como na 004.
- **Conflito detectado ao recarregar a tela** (etapa vinculada teve seu atendimento estornado por outro usuário): a UI exibe estado real do banco (etapa pendente sem appointment), permite recriar via "Reagendar".
- **Constraint do banco rejeita por race condition** (dois POST simultâneos no mesmo slot): o segundo retorna 409, frontend mostra mensagem clara e re-fetch.

## Requirements *(mandatory)*

### Functional Requirements

#### Horário (US1)
- **FR-001**: O formulário "Novo atendimento" e o formulário "Nova etapa do plano de tratamento" MUST exigir, além da data, um horário de início e um horário de fim — todos os três obrigatórios.
- **FR-002**: O Sistema MUST validar `horário_fim > horário_início`. Caso contrário, mostra erro inline e impede submit.

#### Conflito (US1)
- **FR-010**: O Sistema MUST impedir a persistência de qualquer atendimento cujo intervalo `[início, fim)` se sobreponha ao intervalo `[início_existente, fim_existente)` de outro atendimento ativo do **mesmo profissional** no mesmo tenant. Atendimentos com status `estornado` NÃO contam para o cálculo de conflito.
- **FR-011**: A verificação de conflito MUST ser executada na camada de banco de dados (constraint, trigger, ou exclusion constraint), não apenas na aplicação. Bypass do frontend e inserções via service-role devem ser bloqueados.
- **FR-012**: Quando há conflito, o Sistema MUST retornar resposta HTTP 409 com payload incluindo: id do atendimento conflitante, nome do paciente do conflito, intervalo conflitante (início e fim), e procedimento. Frontend renderiza essa mensagem.
- **FR-013**: O frontend MUST executar uma verificação preventiva no momento em que o usuário ajusta horário ou profissional, exibindo aviso antes do submit. A verificação preventiva é UX — o veto autoritativo continua sendo o do banco.
- **FR-014**: A verificação de conflito MUST tratar bordas como intervalo semi-aberto: `[start, end)`. 14:00–14:30 e 14:30–15:00 são adjacentes, não conflitantes.

#### Integração agenda ↔ plano (US2)
- **FR-020**: Cada etapa do plano de tratamento (`treatment_plan_steps`) MUST referenciar opcionalmente um atendimento (`appointment_id`). O vínculo é 1:1 (uma etapa para um atendimento). Etapas pré-feature continuam funcionando com `appointment_id NULL`.
- **FR-021**: Ao criar uma etapa com data + horário início + fim + profissional, o Sistema MUST automaticamente criar um atendimento com status `agendado`, vinculado à etapa, dentro da mesma transação. Falha de qualquer um aborta tudo.
- **FR-022**: Ao marcar uma etapa como `concluído`, o Sistema MUST atualizar o estado do atendimento vinculado para `ativo` (realizado). Auditoria registra a transição.
- **FR-023**: Ao "Marcar realizado" um atendimento agendado pelo calendário, o Sistema MUST atualizar o status da etapa vinculada (se houver) para `concluído`.
- **FR-024**: Ao estornar um atendimento, o Sistema MUST atualizar a etapa vinculada (se houver) para `cancelado`.
- **FR-025**: Ao cancelar uma etapa, o Sistema MUST estornar o atendimento vinculado (se houver).
- **FR-026**: Ao criar um atendimento via "Novo atendimento" cujo `(patient_id, procedure_id)` corresponda a alguma etapa pendente do mesmo paciente sem `appointment_id`, o Sistema MUST vincular automaticamente — primeira etapa pendente por `created_at` (FIFO). Se não houver candidato, cria como avulso.

#### Visualização padrão (US3)
- **FR-030**: A página `/operacao/atendimentos` MUST abrir em modo Calendário por padrão para usuários sem preferência salva.
- **FR-031**: A preferência (`list` ou `cal`) MUST ser persistida por dispositivo. Voltar à página em outro dispositivo abre no default global.
- **FR-032**: Alternar visualização MUST atualizar a preferência salva.

#### Status `agendado` explícito (US1+US2)
- **FR-040**: Status `agendado` de um atendimento MUST ser determinado por: (a) **não** estornado, **e** (b) **não** marcado como realizado. NÃO é derivado por tempo (`appointment_at > now()`) — esse fallback da feature 004 é substituído por status explícito.
- **FR-041**: Marcar um atendimento como realizado MUST ser uma ação append-only — registra em uma tabela de "completions" (ou equivalente) com timestamp, ator e razão opcional. Atendimento original imutável.

#### Conflito visível (US4)
- **FR-050**: O calendário MUST sinalizar visualmente conflitos pré-existentes (caso a constraint do banco seja desativada manualmente ou em dados legados): blocos sobrepostos do mesmo profissional aparecem com borda vermelha e ícone de aviso.

### Key Entities *(include if feature involves data)*

- **Atendimento (`appointments`)**: entidade central. Atributos relevantes adicionados/utilizados: `appointment_at` (início, já existe), `duration_minutes` (já existe, da feature 004), profissional, paciente, procedimento, status efetivo (agendado/ativo/estornado). Append-only — financeiro e horário não mutam após persistência.
- **Realização do atendimento (`appointment_completions`)**: novo registro append-only que marca quando o atendimento foi realizado. Atributos: id, atendimento, timestamp, ator. UNIQUE por atendimento.
- **Etapa do plano de tratamento (`treatment_plan_steps`)**: tabela existente. Acrescenta referência opcional ao atendimento (`appointment_id` UUID NULL). A imutabilidade existente da tabela (apenas `status`/`completed_at`/`completed_by` mutáveis) **permanece** — `appointment_id` é setado apenas no INSERT.
- **Profissional (`doctors`)**: já existe. Sem mudança de schema.
- **Conflito de horário**: não é uma entidade persistida — é uma regra de constraint sobre `appointments`. Implementado via exclusion constraint ou trigger sobre o intervalo de tempo.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% das tentativas de criar agendamentos com horários sobrepostos para o mesmo profissional são rejeitadas — verificado em testes automatizados que cobrem (a) caminho via UI, (b) chamada direta de API, (c) inserção via service-role / SQL direto.
- **SC-002**: Em uma clínica com 200 atendimentos por semana, a verificação de conflito não atrasa o salvamento em mais de 100 ms p95 — UX permanece fluida.
- **SC-003**: Após uma etapa ser concluída no plano, o atendimento vinculado aparece como `ativo` no calendário em até 1 segundo (refresh natural da UI).
- **SC-004**: 0 ocorrências de atendimentos órfãos (etapa marcada como concluída mas atendimento ainda como agendado, ou vice-versa) durante uma semana de uso normal.
- **SC-005**: 100% das etapas criadas com horário aparecem no calendário como blocos com a duração correta.
- **SC-006**: Recepcionistas chegam em "Calendário" da agenda em **0 cliques** após login (página padrão), reduzindo fricção contra os 1+ cliques anteriores.
- **SC-007**: 0 cliques redundantes para registrar a mesma operação em dois lugares — concluir etapa OU marcar realizado o atendimento produz o mesmo efeito.
- **SC-008**: Em testes de carga, 50 POSTs concorrentes para o mesmo slot do mesmo profissional resultam em exatamente 1 sucesso e 49 erros 409 — sem race condition.

## Assumptions

- A clínica opera em fuso horário do Brasil. Todos os horários renderizados são no fuso da clínica; armazenamento em UTC.
- Edição de horário de um atendimento existente é fora do escopo desta feature — usuário cria novo + estorna o anterior. Edição entra em feature subsequente se necessário.
- A constraint de conflito é por `(tenant_id, doctor_id, intervalo)` — multi-tenant naturalmente isolado.
- "Marcar realizado" um atendimento é um botão novo no detalhe do atendimento, restrito aos mesmos papéis que executam estorno (admin, profissional).
- Etapas legadas sem horário (criadas antes desta feature) **não** são backfillladas — UI mostra "Sem horário — completar para aparecer no calendário". O usuário edita o registro com horário, o que cria o atendimento na hora da edição. Esse "edit" é a única operação que escapa do append-only nas etapas legadas, restrita ao caso `start_time IS NULL` (column-guard precisa relaxar somente esse caso).
- Notificações ao paciente (SMS, e-mail) sobre o agendamento criado pela etapa estão fora do escopo — feature posterior.
- O calendário de visão "Mês" mostra blocos densos; a marcação visual de conflito reaproveita a implementação 004 (lanes), apenas com cor diferente.
- Salvamento de preferência (US3) usa storage local do navegador — não há sincronização de preferência entre dispositivos do mesmo usuário.
- Múltiplos procedimentos por atendimento/etapa (item #2 do pedido original do usuário) **não** está nesta spec — é feature paralela. Se entrar antes desta, integração foi pensada para acomodar (atendimento com 1 ou N procedimentos não muda a regra de conflito de horário).

## NEEDS CLARIFICATION

Nenhum bloqueio para iniciar planejamento — a spec tem 3 zonas de risco que merecem atenção, mas todas têm default razoável documentado:

1. **Modelo de "atendimento realizado"**: optei por uma tabela append-only `appointment_completions` (similar a `appointment_reversals`) para rastrear o evento. Decisão de plan, não de spec.
2. **Reaproveitar `duration_minutes` (feature 004) vs. armazenar `appointment_ends_at` separado**: defaulto para `duration_minutes` (já existe, integra direto). Plan formaliza.
3. **Constraint de exclusão vs. trigger**: ambos cumprem FR-010/FR-011. Plan escolhe baseado em compatibilidade com Supabase.
