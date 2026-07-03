# Feature Specification: Conformidade Memed — Checklist Pré-Produção

**Feature Branch**: `027-memed-conformidade`
**Created**: 2026-05-29
**Status**: Draft
**Input**: User description: "Conformidade Memed (homologação→produção). A Memed pede que o integrador confirme 5 pontos antes de liberar produção, e o produto precisa atender cada um. Além disso, a chave de produção pode ser revogada por 4 outros motivos. Esta spec captura todos os critérios como conformidade auditável, mapeia para a feature 026 (já em curso) e serve como checklist final pré-produção."

> **Escopo desta spec**: esta é uma spec de **conformidade auditável**, não de funcionalidade nova. A funcionalidade da Memed (registrar prescritor, prescrever, capturar eventos) está no spec **026-memed-prescricao-digital**. Aqui o foco é a **prova auditável** de que cada critério da Memed é atendido, com cenários de teste que servem para a avaliação que a Memed executa antes de liberar a chave de produção (e que pode revogar a qualquer momento depois).

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Cadastro do Prescritor completo e correto (Priority: P1)

Quando um profissional de saúde é registrado como prescritor na Memed, o payload enviado contém **todos** os campos obrigatórios exigidos pela documentação da Memed: nome, sobrenome, e-mail, registro profissional + UF, especialidade, data de nascimento e CPF. Se algum campo falta no cadastro do profissional dentro do Clinni, o sistema bloqueia a habilitação com mensagem clara apontando o que completar.

**Why this priority**: A Memed audita exatamente este cadastro. Se vier incompleto, a chave de produção é negada/revogada — bloqueio absoluto da feature.

**Independent Test**: Habilitar um prescritor com os 7 campos preenchidos e verificar que o payload enviado à Memed (capturável em log mascarado) contém os 7 valores. Em paralelo, tentar habilitar com cada campo faltando isoladamente (7 testes) e verificar que cada um é bloqueado com mensagem específica.

**Acceptance Scenarios**:

1. **Given** um profissional com nome completo "Maria Silva Santos", e-mail definido, CRM 12345 / SP, especialidade "Cardiologia", nascimento 1980-05-15 e CPF informado, **When** o administrador habilita como prescritor, **Then** o payload enviado à Memed inclui `name="Maria"`, `surname="Silva Santos"`, `email`, `board.code/number/state`, `specialty`, `birth_date`, `cpf` — todos preenchidos e o registro retorna `status=registered`.
2. **Given** um profissional **sem CPF cadastrado**, **When** o administrador tenta habilitar, **Then** o sistema bloqueia e exibe "CPF é obrigatório para registrar como prescritor — edite o perfil do profissional".
3. **Given** um profissional **sem UF do conselho**, **When** habilitar, **Then** mensagem específica "UF do conselho é obrigatória".
4. **Given** um profissional com nome único "Maria" (sem sobrenome), **When** habilitar, **Then** o sistema bloqueia ou solicita sobrenome — Memed exige os dois campos separados.

---

### User Story 2 - Comando SetPaciente com dados completos (Priority: P1)

Quando o profissional aciona "Prescrever" para um paciente, o comando `setPaciente` é chamado com **todos** os campos obrigatórios da Memed: nome, sobrenome, e-mail, telefone, data de nascimento e CPF. Se algum campo falta no cadastro do paciente, o sistema impede a abertura da tela de prescrição e orienta qual dado completar.

**Why this priority**: A Memed exige que o paciente seja identificável e contactável para receita digital com validade legal. Cadastro incompleto na hora da prescrição é critério de revogação.

**Independent Test**: Com um prescritor habilitado, abrir prescrição para paciente com 6 campos completos e verificar que `setPaciente` foi chamado com payload completo (logado em modo mascarado). Repetir com cada um dos 6 campos faltando e verificar bloqueio com mensagem específica.

**Acceptance Scenarios**:

1. **Given** um paciente com nome completo "João Pedro Souza", CPF, e-mail, telefone, nascimento, **When** o profissional aciona "Prescrever", **Then** a tela da Memed abre com paciente pré-carregado e `setPaciente` foi chamado com `name="João"`, `surname="Pedro Souza"`, `email`, `phone`, `birth_date`, `cpf`.
2. **Given** paciente sem e-mail, **When** acionar "Prescrever", **Then** o sistema bloqueia com "E-mail do paciente é obrigatório para prescrição digital. Complete o cadastro do paciente." e oferece atalho para edição.
3. **Given** paciente sem telefone, **When** acionar, **Then** bloqueio análogo apontando telefone.
4. **Given** paciente sem CPF, **When** acionar, **Then** bloqueio análogo apontando CPF.

---

### User Story 3 - Evento prescricaoImpressa capturado e persistido (Priority: P1)

Toda vez que a Memed dispara o evento JavaScript `prescricaoImpressa` no iframe de prescrição, o Clinni captura imediatamente o evento, persiste um registro de prescrição vinculado ao atendimento/paciente/profissional, e disponibiliza os dados (ID Memed, link do PDF, data) para o prontuário.

**Why this priority**: Sem este registro, o Clinni não tem prova auditável de quais prescrições foram emitidas. A Memed exige porque é o ponto onde a receita ganha validade — sem captura, o prontuário do paciente fica incompleto e a Memed considera integração inadequada (motivo de revogação).

**Independent Test**: Emitir uma prescrição de teste em homologação e verificar que (a) um registro foi criado em `prescription_records` com `status=issued` e os identificadores Memed; (b) o evento de auditoria `prescription.issued` foi gerado; (c) o atendimento mostra o indicador "Prescrição emitida".

**Acceptance Scenarios**:

1. **Given** prescrição sendo emitida pelo profissional, **When** a Memed dispara `prescricaoImpressa` com `prescriptionId` e `pdfUrl`, **Then** o Clinni cria registro `prescription_records (status=issued, memed_id=X, pdf_url=Y, appointment_id, patient_id, doctor_id, issued_at=now)` e o atendimento passa a indicar "1 prescrição emitida" no resumo.
2. **Given** a mesma prescrição já registrada, **When** o evento `prescricaoImpressa` é re-disparado (ex.: reentrada do iframe), **Then** o sistema é idempotente — não cria duplicata, retorna sucesso silencioso.
3. **Given** falha de rede no momento do POST do evento, **When** o evento `prescricaoImpressa` ocorre, **Then** o sistema tenta novamente até 3 vezes com backoff e, se persistir, registra alerta interno (não bloqueia o profissional, que vê confirmação na tela da Memed).

---

### User Story 4 - Evento prescricaoExcluida capturado e refletido (Priority: P1)

Quando uma prescrição é excluída na interface da Memed, o evento `prescricaoExcluida` é capturado e o registro local transita de `issued` para `deleted` (com `deleted_at` preenchido). O prontuário deixa de exibir essa prescrição como ativa, evitando que o profissional tente abrir uma prescrição que não existe mais na Memed.

**Why this priority**: Sem captura da exclusão, o Clinni mostra prescrição como ativa enquanto a Memed retorna 404 ao tentar abrir o PDF — divergência crítica que a Memed audita. Item específico de revogação.

**Independent Test**: Emitir uma prescrição → registrar como `issued` → excluir na interface Memed → verificar que `prescricaoExcluida` foi capturado e o registro está com `status=deleted, deleted_at=now`. O prontuário deve mostrar a prescrição como "cancelada" (ou ocultá-la conforme regra de negócio).

**Acceptance Scenarios**:

1. **Given** prescrição emitida e registrada com `status=issued`, **When** a Memed dispara `prescricaoExcluida` com o mesmo `prescriptionId`, **Then** o registro transita para `status=deleted, deleted_at=now` e a UI do prontuário reflete a exclusão.
2. **Given** evento de exclusão chega para um `prescriptionId` que não existe localmente (cenário raro de race), **When** evento é processado, **Then** o sistema registra o evento em log para investigação, sem quebrar.
3. **Given** um registro já com `status=deleted`, **When** chega novamente o evento de exclusão, **Then** idempotência: nenhuma mudança de estado, retorno sucesso.

---

### User Story 5 - Credenciais Memed nunca expostas no front-end (Priority: P1)

A `api_key` e a `secret_key` da Memed **nunca** são enviadas ao navegador. Toda chamada à API REST da Memed é proxied pelo backend do Clinni. O navegador só recebe o `token` curto do prescritor (gerado pela Memed via `GET /usuarios/{external_id}`) para inicializar o iframe de prescrição.

**Why this priority**: A Memed audita o tráfego do navegador procurando chaves expostas. Encontrar `api_key`/`secret_key` em qualquer resposta HTTP, código JS, cookie, localStorage ou header = revogação imediata da chave de produção.

**Independent Test**: Em uma sessão de navegador inspecionando rede + console + storage + DOM, abrir o fluxo de prescrição completo e confirmar que (a) nenhuma das duas chaves aparece em qualquer payload de resposta, qualquer URL, qualquer cookie, qualquer `localStorage`/`sessionStorage`, qualquer atributo HTML; (b) os logs do servidor mascaram as chaves.

**Acceptance Scenarios**:

1. **Given** integração Memed conectada, **When** inspeciono o tráfego do navegador na aba Network durante o fluxo completo de prescrição, **Then** nenhuma resposta contém `api_key` ou `secret_key` (busca textual case-insensitive em todos os payloads).
2. **Given** uma falha de upstream da Memed, **When** o backend retorna o erro para o navegador, **Then** a mensagem de erro **não** contém echo das credenciais (verificado por teste de contrato).
3. **Given** um desenvolvedor adiciona código no front que tenta `process.env.MEMED_API_KEY`, **When** o pipeline de build/lint roda, **Then** o build falha com regra "frontend não pode ler chaves Memed" (mesma estratégia de `lint:auth` já aplicada a GHL).
4. **Given** logs do servidor com `pino`, **When** uma chamada à Memed é loggada, **Then** as chaves aparecem mascaradas (ex.: `mk_***ab12` para os últimos 4 caracteres).

---

### User Story 6 - `setFeatureToggle` respeitado pela UI (Priority: P2)

Quando o iframe da Memed desativa funcionalidades via comando `setFeatureToggle` (ex.: ocultar botão de prescrição manuscrita), o Clinni respeita essas desativações — não força reativação, não esconde elementos da Memed, não injeta CSS que sobreponha o estado desejado pela Memed. Funcionalidades desativadas permanecem invisíveis ou inativas.

**Why this priority**: A Memed reserva controle sobre quais features estão habilitadas (em função de regulamentação, contrato, ou política comercial). Sobrepor desativações é motivo explícito de revogação. Prioridade P2 porque só se manifesta se a Memed efetivamente ativar toggles que afetem nosso fluxo — em situação default, sem toggles, o critério é trivialmente atendido.

**Independent Test**: Simular um toggle desativando um botão dentro do iframe e verificar que o botão permanece invisível/desabilitado, sem CSS do Clinni forçando display ou pointer-events.

**Acceptance Scenarios**:

1. **Given** o iframe da Memed recebe `setFeatureToggle({ manualPrescription: false })`, **When** o usuário interage com a tela de prescrição, **Then** nenhum elemento relacionado à prescrição manual aparece, e o CSS do Clinni não força visibilidade.
2. **Given** auditoria visual da página de prescrição, **When** comparada com o estado padrão da Memed (sem nosso wrapper), **Then** elementos ocultados pela Memed continuam ocultos no Clinni.

---

### User Story 7 - Aceite institucional do termo de responsabilidade (Priority: P3)

O aceite dos 9 itens de conformidade (incluindo "Sim, estou ciente de que a integração deve ser feita por profissional qualificado") é registrado e arquivado pela operação do Clinni no portal Memed, antes do pedido de chave de produção. Documentação interna referencia esse registro.

**Why this priority**: Item operacional/jurídico, sem implementação técnica. Mas a omissão impede a abertura do processo de aprovação. Prioridade P3 porque é checklist humano, não automação.

**Independent Test**: Verificar no `specs/027-memed-conformidade/` (ou docs/legal) existe arquivo `memed-acceptance-record.md` com data, responsável, conteúdo aceito e link/captura do portal Memed.

**Acceptance Scenarios**:

1. **Given** a operação acessa o portal Memed para solicitar chave de produção, **When** chega ao formulário com os 9 itens "Sim, estou ciente", **Then** todos os itens são marcados após confirmação técnica de que o produto atende ao critério.
2. **Given** o aceite foi feito, **When** auditoria interna pergunta "quando aceitamos os termos?", **Then** há registro em docs com data, responsável e referência cruzada para a evidência de cada item técnico.

---

### Edge Cases

- **Profissional remove um dado obrigatório após habilitar como prescritor** (ex.: admin edita CPF para vazio): a integração detecta na próxima chamada e o registro Memed passa para `status=error` com mensagem visível na UI; novas prescrições para esse profissional são bloqueadas até correção.
- **Paciente é anonimizado (LGPD) após receber prescrição**: registros em `prescription_records` permanecem (são histórico clínico legal); mas qualquer chamada à Memed para esse paciente retorna erro porque os dados do `setPaciente` não estão mais disponíveis — comportamento esperado e documentado.
- **Memed temporariamente fora do ar**: chamada da habilitação ou de `setPaciente` falha; o sistema mostra erro amigável "Serviço de prescrição temporariamente indisponível"; profissional pode tentar novamente; não há retry automático para evitar lock-step com upstream caído.
- **Token de prescritor expirado** (Memed devolve 401): o backend renova via `GET /usuarios/{external_id}` automaticamente e re-injeta no iframe; usuário não percebe.
- **Tenant tem credenciais Memed mas ainda está em homologação**: UI mostra claramente "Modo homologação — prescrições NÃO têm validade legal"; banner persistente em toda tela de prescrição.

## Requirements _(mandatory)_

### Functional Requirements

**Cadastro do Prescritor (mapeia US1):**

- **FR-001**: O sistema MUST enviar à Memed, ao registrar um prescritor, payload contendo: `name` (1º termo de `doctors.full_name`), `surname` (demais termos), `email` (de `auth.users` via `doctors.user_id`), `board.code` (de `council_name`), `board.number` (de `council_number`), `board.state` (de `council_state`), `specialty` (id da US4 do spec 026 quando mapeado, senão texto livre), `birth_date`, `cpf`.
- **FR-002**: O sistema MUST bloquear a habilitação como prescritor se qualquer campo da FR-001 estiver vazio/nulo, retornando mensagem específica indicando o campo faltante e link para edição do profissional.
- **FR-003**: O sistema MUST refletir no `memed_prescribers.status` o resultado da habilitação: `registered` (sucesso), `error` (falha com `error_message`), `pending` (em retry/manual).

**SetPaciente (mapeia US2):**

- **FR-004**: O sistema MUST executar `setPaciente` com payload contendo: `name`, `surname` (split de `patients.full_name`), `email`, `phone`, `birth_date`, `cpf` — todos populados.
- **FR-005**: O sistema MUST bloquear a abertura do iframe de prescrição se qualquer campo do paciente exigido por FR-004 estiver vazio, com mensagem específica e atalho para edição do paciente.

**Eventos de Prescrição (mapeia US3, US4):**

- **FR-006**: O sistema MUST registrar listener para o evento `prescricaoImpressa` no iframe da Memed e, ao recebê-lo, criar registro em `prescription_records` (idempotente por `memed_prescription_id`).
- **FR-006a**: O sistema MUST aplicar retry com backoff exponencial até 3 tentativas no POST do evento `prescricaoImpressa` caso a primeira chamada falhe (rede, 5xx do backend). Após a 3ª falha, MUST registrar `alert` com `type='prescription_capture_failed'` contendo `memed_prescription_id`, `tenant_id` e `doctor_id`; MUST NÃO bloquear a UI do profissional (ele já vê a confirmação dentro do iframe da Memed).
- **FR-007**: O sistema MUST registrar listener para `prescricaoExcluida` e, ao recebê-lo, transicionar o registro correspondente para `status=deleted, deleted_at=now()`.
- **FR-008**: A tabela `prescription_records` MUST ser append-only por trigger: `DELETE` proibido; `UPDATE` permitido somente para a transição `issued → deleted`.
- **FR-009**: O sistema MUST gerar entrada de auditoria (`log_audit_event`) para cada `prescription.issued` e `prescription.deleted`.

**Segurança de Credenciais (mapeia US5):**

- **FR-010**: O sistema MUST proxy todas as chamadas à API REST da Memed pelo backend do Clinni; o navegador NUNCA executa fetch direto a `api.memed.com.br` ou similar.
- **FR-011**: O sistema MUST armazenar `api_key` e `secret_key` cifradas em `tenant_memed_config` (via `enc_text_with_key`).
- **FR-012**: O sistema MUST mascarar `api_key`/`secret_key` em todos os logs (mostrar apenas `mk_***últimos4`).
- **FR-013**: O pipeline de lint MUST falhar se algum arquivo dentro de `src/app/*`/`src/components/*` referenciar `process.env.MEMED_*` ou strings literais que pareçam credenciais Memed (mesma estratégia de `lint:auth` para GHL).
- **FR-014**: Respostas de erro da API interna que façam proxy à Memed MUST NÃO incluir as credenciais; mensagens são genéricas ("upstream error") com `traceId` para correlação interna.

**Feature Toggles (mapeia US6):**

- **FR-015**: O wrapper React do iframe Memed MUST NÃO injetar CSS que sobreponha `display`, `visibility`, `pointer-events` ou `opacity` de elementos do iframe.
- **FR-016**: O sistema MUST processar chamadas `setFeatureToggle` recebidas via `postMessage` da Memed e ajustar UI externa (quando aplicável) de forma alinhada.

**Aceite Institucional (mapeia US7):**

- **FR-017**: O repositório MUST conter `docs/legal/memed-acceptance-record.md` com data, responsável e descrição dos 9 itens aceitos, atualizado antes do pedido de produção.

### Key Entities

- **Memed Prescriber Record (`memed_prescribers`)**: vínculo 1:1 entre `doctor_id` e a identidade desse profissional na Memed. Atributos: `external_id` (= doctor_id), `status` (pending/registered/error), `error_message`, `last_registered_at`, `memed_specialty_id` (quando US4 do spec 026 está concluído).

- **Prescription Record (`prescription_records`)**: representação local de cada prescrição emitida via Memed. Atributos: `tenant_id`, `appointment_id`, `patient_id`, `doctor_id`, `memed_prescription_id` (único por tenant), `pdf_url`, `status` (issued/deleted), `issued_at`, `deleted_at`. Append-only (FR-008).

- **Memed Tenant Config (`tenant_memed_config`)**: credenciais cifradas + ambiente (`homologation`/`production`) da clínica.

- **Acceptance Record (documento)**: arquivo em `docs/legal/` com registro do aceite humano dos 9 itens. Não é entidade de banco — é prova jurídica versionada no git.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: 100% das tentativas de registrar prescritor com algum campo faltante são bloqueadas antes da chamada à Memed (verificável com bateria de 7 testes — um por campo).
- **SC-002**: 100% das aberturas de prescrição com paciente incompleto são bloqueadas com mensagem específica (6 testes — um por campo).
- **SC-003**: 100% dos eventos `prescricaoImpressa` em homologação geram registro em `prescription_records` dentro de 5 segundos (medível em log timing).
- **SC-004**: 100% dos eventos `prescricaoExcluida` em homologação resultam em transição `issued→deleted` dentro de 5 segundos.
- **SC-005**: 0 ocorrências de `api_key` ou `secret_key` em qualquer payload HTTP recebido pelo navegador, verificado por scan automático na suíte de teste E2E.
- **SC-006**: 0 ocorrências de chaves Memed em logs de aplicação após aplicar máscara (auditável grepando logs em formato JSON).
- **SC-007**: A avaliação técnica da Memed (executada por eles antes de liberar produção) é aprovada na primeira submissão.
- **SC-008**: Tempo total entre clicar "Prescrever" e ver o iframe da Memed carregado com paciente correto é ≤ 3 segundos no p95.
- **SC-009**: 0 reativações forçadas de funcionalidades desativadas por `setFeatureToggle` (auditável por diff entre estado default Memed e estado renderizado no wrapper).

## Assumptions

- O spec **026-memed-prescricao-digital** está sendo implementado em paralelo e inclui as fases necessárias (migração 0108, client da Memed, endpoints, UI). Esta spec **não duplica** trabalho — apenas valida o resultado contra os critérios da Memed.
- Credenciais de homologação da Memed estarão disponíveis para a equipe antes do início da implementação dos critérios técnicos (FR-001+).
- Avaliação da Memed para produção é manual: humanos da Memed executam um fluxo de teste e inspecionam tráfego/logs. Os critérios da spec foram desenhados pensando nesse processo.
- A revogação da chave de produção é possível a qualquer momento após aprovação inicial, se a Memed identificar regressão em qualquer dos critérios — portanto, os critérios desta spec entram no fluxo de regressão (CI deve preservar SC-005 e SC-006 indefinidamente).
- O catálogo de especialidades da Memed (US4 do spec 026) é uma melhoria de fidelidade; ausência de mapeamento não bloqueia produção, apenas degrada qualidade do cabeçalho da receita.
- O fluxo de aceite institucional (US7/FR-017) é responsabilidade da operação/jurídico, não do produto técnico; a spec apenas exige o registro versionado.
