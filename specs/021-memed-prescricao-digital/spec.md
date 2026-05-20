# Feature Specification: Prescrição digital via Memed

**Feature Branch**: `021-memed-prescricao-digital`
**Created**: 2026-05-20
**Status**: Draft
**Input**: User description: "Integrar Memed (líder brasileiro em prescrição digital) ao Prontool para que o médico prescreva durante o atendimento sem sair da plataforma. A receita 'vive' no Memed; o Prontool guarda apenas a referência (ID + PDF URL + status). Per-tenant config + per-doctor CRM. Plugin adapter no padrão existente. Sem reinventar prescrição, signing ICP-Brasil, ou base de medicamentos — tudo Memed."

## Clarifications

### Session 2026-05-20

- Q: Modo de integração Memed (widget iframe vs. REST API headless vs. OAuth/SSO redirect)? → A: **Pendente** — usuário ainda não consultou documentação/produto Memed. Esta feature está **bloqueada para `/speckit.plan`** até a decisão. Reabrir `/speckit.clarify` após levantamento.

> ⚠️ **STATUS DA FEATURE: BLOCKED**
>
> A decisão arquitetural fundamental (modo de integração Memed) está pendente
> de levantamento técnico/comercial pelo stakeholder. Não avance para
> `/speckit.plan` até resolver — o plano de implementação muda
> substancialmente entre as três opções (widget iframe, REST headless,
> OAuth/SSO redirect), e voltar atrás depois custaria refazer plan + tasks.
>
> **Próximos passos para destravar:**
> 1. Acessar a documentação técnica da Memed (https://memed.com.br/desenvolvedores ou contato comercial).
> 2. Confirmar qual produto/SDK o tenant tem (ou pretende ter) contrato.
> 3. Re-rodar `/speckit.clarify` para completar as 4-5 perguntas restantes (cancelamento, status enum, visibilidade entre médicos, webhook retry).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Médico prescreve durante atendimento (Priority: P1)

Durante uma consulta, o profissional de saúde (médico com CRM cadastrado) está na ficha do paciente e precisa receitar um medicamento. Clica em "Prescrever" na sidebar (ou no rodapé da evolução SOAP que acabou de salvar). O editor da Memed abre com contexto do paciente já preenchido (nome, CPF, alergias para alerta, CIDs ativos para indicação). O médico seleciona medicamentos, posologia e duração; salva. A receita é assinada digitalmente pela Memed, enviada ao paciente via WhatsApp/email, e volta ao Prontool aparecendo imediatamente como evento "Prescrição" na timeline do paciente, com link para o PDF.

**Why this priority**: É o ganho central que justifica a feature inteira. Sem isso, médico continua saindo do Prontool para prescrever — gatilho número 1 de retorno a iClinic/Amplimed.

**Independent Test**: Com tenant Memed configurado (US2) e médico com CRM cadastrado (US3), abrir paciente real com CPF + telefone preenchidos. Clicar "Prescrever" → editor Memed abre → criar receita com 1 medicamento → salvar → fechar editor. Verificar que (1) prescrição aparece como evento novo na timeline do Prontool em ≤5s; (2) paciente recebe WhatsApp/email com link da receita; (3) `audit_log` tem entrada `memed.prescription.created` com tenant_id + médico_id + paciente_id + memed_prescription_id.

**Acceptance Scenarios**:

1. **Given** médico com CRM válido + tenant Memed configurado + paciente com CPF, **When** clica "Prescrever" e cria receita com 1 medicamento, **Then** a receita é gerada na Memed e referência (id + pdf_url) é persistida no Prontool.
2. **Given** médico sem CRM cadastrado, **When** abre a ficha do paciente, **Then** o botão "Prescrever" não aparece na sidebar; uma mensagem informativa em `/configuracoes/perfil` explica como cadastrar o CRM.
3. **Given** tenant sem Memed configurado, **When** qualquer médico abre uma ficha de paciente, **Then** o botão "Prescrever" não aparece em lugar algum (silencioso, sem ansiedade).
4. **Given** paciente sem CPF, **When** o médico clica "Prescrever", **Then** o sistema exibe erro claro pedindo cadastro completo antes de prosseguir; nenhuma prescrição é criada.
5. **Given** paciente anonimizado por LGPD, **When** a ficha é renderizada, **Then** o botão "Prescrever" não aparece.
6. **Given** médico desativado (`doctors.active=false`), **When** tenta prescrever, **Then** o botão não aparece e endpoint `/api/memed/prescribe` retorna 403.
7. **Given** Memed indisponível (timeout ou 5xx), **When** o médico tenta prescrever, **Then** mensagem clara "Memed temporariamente indisponível — tente novamente" + entrada em `audit_log` registra a tentativa falha; nenhum estado parcial é persistido.

---

### User Story 2 - Admin configura conta Memed do tenant (Priority: P1)

Antes que qualquer médico possa prescrever, a clínica precisa conectar sua conta Memed ao Prontool. O admin do tenant vai em `/configuracoes/integracoes/memed`, segue o fluxo de conexão (OAuth ou inserção de API key, conforme produto Memed escolhido), e a configuração fica salva criptografada. A página de status mostra "Conectado" e quais médicos do tenant já têm CRM cadastrado vs. faltando.

**Why this priority**: Pré-requisito hard. Sem isso, US1 não funciona. Setup é one-time por tenant.

**Independent Test**: Admin acessa `/configuracoes/integracoes/memed`, completa o fluxo de autenticação Memed, retorna ao Prontool. Verificar que (1) o registro em `tenant_integrations` tem `provider='memed'` + `status='connected'` + `credentials_enc` populado; (2) a página mostra "Memed conectado em [data]" com botão "Desconectar"; (3) lista os médicos do tenant com indicador de quais têm CRM cadastrado.

**Acceptance Scenarios**:

1. **Given** admin logado em tenant sem Memed, **When** completa o fluxo de conexão em `/configuracoes/integracoes/memed`, **Then** o tenant ganha registro ativo em `tenant_integrations`.
2. **Given** Memed retorna erro de credenciais inválidas, **When** o admin tenta conectar, **Then** mensagem clara aparece e nenhum estado parcial fica persistido.
3. **Given** Memed conectado, **When** admin clica "Desconectar", **Then** confirmação pede dupla validação; após confirmar, o registro vai para `status='disabled'` (não delete) e botão "Prescrever" para de aparecer para todos os médicos do tenant. Histórico de prescrições anteriores permanece visível.
4. **Given** apenas admin tem acesso a essa página, **When** financeiro/recepcionista/profissional_saude tentam acessar, **Then** redirect para 403.

---

### User Story 3 - Médico cadastra CRM e ativa Memed para si (Priority: P1)

Cada médico do tenant precisa ter `crm_number` + `crm_state` cadastrados antes de prescrever (Memed valida). O médico vai em `/configuracoes/perfil` (ou na seção "Profissionais" se admin), informa CRM + UF, salva. Opcionalmente, completa um fluxo de "vincular conta Memed pessoal" caso o produto Memed escolhido exija autenticação por médico (não apenas por tenant).

**Why this priority**: Pré-requisito hard por médico. Sem CRM, prescrição não pode ser assinada juridicamente.

**Independent Test**: Médico logado vai em `/configuracoes/perfil`, preenche "CRM" e "UF", salva. Verificar que (1) `doctors.crm_number` e `doctors.crm_state` ficam populados para esse user; (2) após salvar, ao voltar para qualquer ficha de paciente, botão "Prescrever" aparece (se tenant também tem Memed configurado).

**Acceptance Scenarios**:

1. **Given** médico logado sem CRM, **When** preenche CRM + UF em `/configuracoes/perfil` e salva, **Then** o `doctors` row do tenant atualiza ambos os campos.
2. **Given** CRM inválido (não-numérico ou UF inexistente), **When** salva, **Then** validação client+server retorna erro sem persistir.
3. **Given** CRM já cadastrado pelo médico, **When** abre paciente com tenant Memed ativo, **Then** botão "Prescrever" aparece na sidebar.
4. **Given** admin acessa lista de médicos, **When** vê um médico sem CRM, **Then** indicador visual mostra "CRM pendente" com link rápido para edição.

---

### User Story 4 - Histórico de prescrições visível na timeline (Priority: P2)

Após prescrever, e em consultas seguintes, qualquer membro autorizado (admin, financeiro, profissional_saude — todos com `anamnesis.read`) vê o histórico de prescrições do paciente integrado à timeline cronológica unificada (feature 019). Cada prescrição mostra: data, médico prescritor, contagem de itens, status atual (criada/enviada/baixada/retirada), e link para o PDF Memed. Um novo chip de filtro "Prescrições" é adicionado à timeline. O PDF do prontuário (`prontuario-pdf.tsx`) ganha uma seção "Prescrições no período" listando as prescrições do range de datas selecionado.

**Why this priority**: Quality-of-life e cobertura forense; sem isso, a feature funciona mas o histórico fica fragmentado.

**Independent Test**: Paciente com 3 prescrições anteriores. Abrir a ficha → ver na timeline 3 eventos "Prescrição" com data + médico + contagem de itens + status. Clicar em uma → expande mostrando link PDF. Aplicar filtro "Prescrições" → só esses 3 eventos visíveis. Gerar PDF do prontuário com range que inclua os 3 → seção "Prescrições" aparece com a lista.

**Acceptance Scenarios**:

1. **Given** paciente com prescrições, **When** a ficha carrega, **Then** cada prescrição aparece como evento na timeline na data de criação.
2. **Given** a timeline tem 7 chips de filtro hoje, **When** Memed está conectado no tenant, **Then** aparece um 8º chip "Prescrições" com contagem.
3. **Given** uma prescrição expande, **When** o usuário clica no link do PDF, **Then** abre o PDF da Memed em nova aba (mesma URL que o paciente recebeu).
4. **Given** PDF do prontuário é gerado, **When** o range cobre as prescrições, **Then** seção "Prescrições no período" aparece com data + médico + medicamentos resumidos + status.
5. **Given** uma prescrição muda de status (ex.: "baixada pelo paciente"), **When** a ficha é aberta novamente, **Then** o status reflete o mais recente.

---

### User Story 5 - Eventos pós-prescrição via webhook (Priority: P3)

A Memed emite webhooks para eventos de ciclo de vida da prescrição (criada, enviada, baixada pelo paciente, retirada na farmácia). O Prontool recebe esses webhooks, valida HMAC, e atualiza o status da prescrição local. O médico, ao consultar a timeline, vê não só "prescreveu em DD/MM" mas também "paciente baixou em DD/MM" — útil para acompanhamento de adesão.

**Why this priority**: Funcionalidade avançada de observabilidade. Sem ela, a feature ainda funciona (status fica em "criada"); com ela, ganha um diferencial vs. concorrentes.

**Independent Test**: Disparar manualmente um webhook simulado da Memed com `event=prescription.viewed` para uma prescrição existente. Verificar que (1) o evento entra na tabela de eventos da prescrição; (2) o status mais recente aparece na timeline.

**Acceptance Scenarios**:

1. **Given** webhook válido (HMAC OK) chega da Memed para prescrição existente no tenant, **When** processado, **Then** evento é persistido e timeline reflete novo status.
2. **Given** webhook com HMAC inválido, **When** chega, **Then** é rejeitado com 401 e registrado em log de segurança.
3. **Given** webhook chega para prescrição que não existe localmente (race condition, dado obsoleto), **When** processado, **Then** é logado e descartado sem erro — idempotência.
4. **Given** webhook com replay (mesmo evento + mesma assinatura chegando 2x), **When** processado, **Then** segunda inserção é deduplicada por chave única `(memed_prescription_id, event_type, occurred_at)`.

---

### Edge Cases

- **Paciente sem telefone/email**: a Memed pode exigir um canal de entrega. Se ambos faltarem, mostrar erro pedindo cadastro completo antes de prescrever (similar ao caso "sem CPF").
- **Médico com CRM válido mas suspenso pelo CFM**: a Memed valida na criação e retorna erro. Mostrar mensagem clara ao médico, registrar tentativa em auditoria, não bloquear o uso geral do sistema.
- **Tenant desabilita Memed enquanto há prescrições em curso**: prescrições já criadas permanecem visíveis (read-only); novos botões "Prescrever" somem; eventuais webhooks tardios continuam sendo processados (não bloqueamos por desconexão).
- **Médico exclui o próprio CRM acidentalmente**: confirmação dupla antes de salvar campo vazio; histórico mostra prescrições antigas mesmo após reset (referência ao médico permanece).
- **Memed muda a estrutura do webhook payload**: validação Zod no handler do webhook; payloads incompatíveis vão para uma fila de erro (DLQ existente) e geram alerta para admin.
- **Conexão de um tenant sendo trocada por outra conta Memed**: o status atual fica `disabled`, novo registro é criado; prescrições antigas continuam referenciando IDs Memed da conta anterior — links continuam abrindo (o Memed mantém os PDFs).
- **Múltiplas prescrições na mesma consulta**: usuário pode disparar "Prescrever" várias vezes; cada uma vira evento separado na timeline. Sem limite artificial.

## Requirements *(mandatory)*

### Functional Requirements

#### Configuração do tenant (US2)

- **FR-001**: O sistema MUST oferecer uma página `/configuracoes/integracoes/memed` acessível apenas a usuários com papel `admin` do tenant.
- **FR-002**: A página MUST permitir conectar a conta Memed do tenant via fluxo de autenticação apropriado (ver clarificação Q1 sobre modo de integração).
- **FR-003**: As credenciais Memed do tenant MUST ser armazenadas criptografadas em `tenant_integrations.credentials_enc` (padrão das features 002/008).
- **FR-004**: A página MUST mostrar o status atual da integração (Conectado em [data] / Desconectado / Erro), e permitir desconectar com dupla confirmação.
- **FR-005**: Desconectar uma integração MUST mudar `status='disabled'` (sem delete físico); prescrições anteriores permanecem visíveis; novos botões "Prescrever" deixam de aparecer.
- **FR-006**: A página MUST listar os médicos do tenant com indicador de quais já têm `crm_number` cadastrado vs. pendente, com link rápido para configurar.

#### Configuração do médico (US3)

- **FR-007**: Cada `doctors` row MUST acrescentar os campos `crm_number` (texto, ≥4 dígitos) e `crm_state` (UF brasileira, 2 letras).
- **FR-008**: A página `/configuracoes/perfil` MUST permitir ao médico cadastrar/editar seu próprio CRM e UF; admin pode editar o de qualquer médico do tenant.
- **FR-009**: Validação MUST garantir: `crm_number` apenas dígitos, comprimento mínimo 4, e `crm_state` ∈ lista de UFs do IBGE.
- **FR-010**: Edição do CRM MUST ser registrada em `audit_log` com `event_type='doctor.crm.updated'`.

#### Botão e fluxo de prescrição (US1)

- **FR-011**: O botão "Prescrever" MUST aparecer no `PatientQuickView` (sidebar da ficha) **somente se** TODAS estas condições forem verdadeiras simultaneamente:
  - tenant tem `tenant_integrations` ativa para `provider='memed'` com `status='connected'`;
  - usuário logado tem papel `profissional_saude` E está vinculado a um `doctors` row do tenant (via `doctors.user_id`);
  - esse `doctors` row tem `crm_number` + `crm_state` preenchidos E `active=true`;
  - paciente atual tem `cpf` cadastrado E `phone` OU `email` (pelo menos um canal de entrega);
  - paciente NÃO está anonimizado (`anonymizedAt IS NULL`).
- **FR-012**: O sistema MUST também oferecer um botão "Prescrever desta evolução" no Sheet de Nova Evolução SOAP (após salvamento bem-sucedido), com os mesmos gates de FR-011.
- **FR-013**: Ao clicar em "Prescrever", o sistema MUST iniciar o editor Memed (modo a definir em Q1) com contexto pré-preenchido contendo, no mínimo: nome do paciente, CPF, data de nascimento, telefone/e-mail, lista de alergias ativas (substância + severidade), lista de CIDs ativos, identificação do médico (nome + CRM/UF).
- **FR-014**: Após a criação bem-sucedida da prescrição no Memed, o sistema MUST persistir uma linha em `memed_prescriptions` com: tenant_id, patient_id, doctor_id, memed_prescription_id, memed_pdf_url, status inicial, created_by user_id, created_at.
- **FR-015**: A persistência da referência MUST gerar entrada em `audit_log` (`event_type='memed.prescription.created'`) com payload mascarado conforme padrão LGPD (sem PII em texto claro).
- **FR-016**: Se o Memed retornar erro (timeout, 5xx, credenciais inválidas, paciente rejeitado), nenhuma linha em `memed_prescriptions` é criada; o erro é exibido ao usuário e registrado em `audit_log` como tentativa falha.

#### Visibilidade e histórico (US4)

- **FR-017**: A timeline da ficha do paciente (feature 019) MUST incluir prescrições como eventos do tipo `memed_prescription`, ordenadas cronologicamente desc por `created_at` (igual aos demais eventos).
- **FR-018**: Cada item de prescrição na timeline MUST exibir: data/hora, nome do médico prescritor, contagem de medicamentos (se disponível), status atual, link para o PDF Memed em nova aba.
- **FR-019**: O chip de filtro "Prescrições" MUST ser adicionado à timeline (8º chip), e MUST aparecer **somente** se o tenant tem Memed conectado OU se já houver pelo menos 1 prescrição histórica do paciente.
- **FR-020**: A geração do PDF do prontuário (`prontuario-pdf.tsx`) MUST incluir uma nova seção "Prescrições no período" listando prescrições cujo `created_at` cai no range de datas selecionado.
- **FR-021**: Prescrições MUST permanecer visíveis na timeline mesmo após o tenant desconectar a integração Memed (read-only).

#### Webhook de eventos (US5)

- **FR-022**: O sistema MUST expor um endpoint `/api/webhooks/memed` que valide assinatura HMAC do payload conforme spec do Memed.
- **FR-023**: O endpoint MUST identificar o tenant a partir do payload (chave Memed → tenant_id) e persistir um evento em `memed_prescription_events` (append-only), com chave única `(memed_prescription_id, event_type, occurred_at)` para idempotência.
- **FR-024**: O status visível na timeline MUST refletir o evento mais recente para aquela prescrição (criada → enviada → baixada → retirada).
- **FR-025**: Webhooks para prescrições não existentes localmente (race condition / dado obsoleto) MUST ser registrados em log e descartados sem erro.
- **FR-026**: Webhooks com HMAC inválido MUST retornar 401 e gerar entrada em log de segurança (não em `audit_log`, que é trilha de ações de usuário).

#### RBAC e LGPD

- **FR-027**: Apenas usuários com papel `profissional_saude` (vinculados a `doctors` ativo com CRM cadastrado) podem **disparar** prescrições. Demais papéis podem **ler** o histórico se tiverem permissão `anamnesis.read` (atual).
- **FR-028**: A página de configuração do tenant em `/configuracoes/integracoes/memed` é exclusiva do papel `admin`.
- **FR-029**: Os dados do paciente enviados ao Memed MUST se limitar ao mínimo necessário (nome, CPF, data nascimento, telefone/email, alergias ativas, CIDs ativos). Endereço, histórico financeiro e antecedentes detalhados NÃO devem ser enviados.
- **FR-030**: Pacientes anonimizados LGPD MUST ter o fluxo de prescrição completamente bloqueado (botão oculto + endpoint rejeita).

### Open Clarifications

- **Q1 [NEEDS CLARIFICATION]**: A Memed oferece pelo menos dois modos de integração (a) **widget iframe embarcado** — UX mais rápida, menos controle visual; (b) **REST API headless** — UX customizada no Prontool, mas exige mais trabalho e algumas funcionalidades do editor Memed teriam que ser re-implementadas; (c) **OAuth/SSO redirect** — abre nova aba/popup na Memed. Qual é o produto Memed que o tenant assina (ou pretende assinar) e qual modo melhor casa com a UX do Prontool?

### Key Entities

- **Memed Tenant Integration**: registro em `tenant_integrations` com `provider='memed'`, `status` (`connected`/`disabled`/`error`), `credentials_enc` (cifrado), `config` (JSON com configurações públicas — não-sensíveis), `connected_at`. Reutiliza tabela existente das features 002/008.
- **Doctor CRM**: 2 colunas novas em `doctors`: `crm_number` (texto, nullable até cadastro) e `crm_state` (UF, nullable). Opcionalmente `memed_user_id` se modo de integração exigir.
- **Memed Prescription**: nova entidade `memed_prescriptions` — referência ao que vive no Memed. Campos: `id` (UUID local), `tenant_id`, `patient_id`, `doctor_id`, `memed_prescription_id` (string da Memed), `memed_pdf_url`, `status` (criada/enviada/baixada/retirada/cancelada), `medication_count` (int opcional), `created_by` (user_id), `created_at`, `updated_at`. Append-only — alterações de status vão pela tabela de eventos.
- **Memed Prescription Event**: nova entidade `memed_prescription_events` — append-only. Campos: `id`, `tenant_id`, `prescription_id` (FK), `event_type` (criada/enviada/baixada/retirada/cancelada), `occurred_at`, `received_at`, `payload_masked` (JSON com PII mascarada para auditoria). UNIQUE em `(prescription_id, event_type, occurred_at)` para idempotência.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Após onboarding Memed (US2 + US3 completos), um médico consegue gerar a primeira prescrição do zero (clique → assinada → enviada ao paciente) em ≤90 segundos para uma receita simples de 1 medicamento.
- **SC-002**: Tempo médio entre o usuário clicar "Prescrever" e o editor Memed estar pronto para uso ≤3 segundos em conexão 3G boa.
- **SC-003**: Tempo médio entre fechar o editor Memed (após salvar a receita) e a prescrição aparecer na timeline do Prontool ≤5 segundos.
- **SC-004**: 100% das prescrições criadas via Prontool MUST ser também visíveis no portal do paciente da Memed (verificação cruzada por amostragem em 10 receitas).
- **SC-005**: Zero vazamento de dados de paciente para tenants distintos: testes de tenant isolation cobrem tentativas de criar prescrição cross-tenant e MUST retornar 403/404.
- **SC-006**: 100% das prescrições criadas geram entrada em `audit_log` com payload conforme política LGPD (PII mascarada).
- **SC-007**: Após desconectar Memed do tenant, o botão "Prescrever" desaparece em ≤1 ciclo de page refresh para todos os usuários do tenant.
- **SC-008**: Webhook de Memed processa ≥99% dos eventos em ≤2 segundos do recebimento (medido via traces). Erros vão para fila de retry/DLQ existente.
- **SC-009**: Suite de regressão (acceptance scenarios das 5 user stories + edge cases) passa 100% antes do merge.

## Assumptions

- **A-001**: O Prontool tem (ou pode obter rapidamente) uma conta business Memed com acesso a documentação técnica e ambiente sandbox. Sem isso, esta feature não pode ser iniciada.
- **A-002**: A Memed oferece uma API/widget pública estável documentada — não é necessário engenharia reversa.
- **A-003**: O custo financeiro da Memed (R$/prescrição ou plano fixo) é gerenciado fora desta feature (contrato direto entre o tenant e a Memed, ou Prontool repassa via `expenses` no padrão atual).
- **A-004**: Os médicos do tenant são CRM-habilitados e ativos no CFM — verificação fica a cargo do Memed, não do Prontool.
- **A-005**: CPF do paciente é exigido pela Memed (obrigatório para emissão da receita digital). Pacientes sem CPF não podem ter receita assinada digitalmente — feature não tenta contornar isso.
- **A-006**: O endpoint do webhook Memed (`/api/webhooks/memed`) usa o padrão de validação HMAC já implementado nas features 008 (GHL Marketplace) — reutilizar utilitários existentes.
- **A-007**: A feature 019 (timeline) e 020 (sheets + mobile) estão estáveis em produção — esta feature acrescenta um novo tipo de evento à timeline sem reescrever a arquitetura.
- **A-008**: O design system 016 (paleta designer + tokens semânticos) é seguido — chips de filtro, badges e cores semânticas usam tokens existentes.
- **A-009**: PDFs da receita são servidos pelo Memed via URL pública (assinada/temporária ou permanente) — Prontool apenas linka. Cache local NÃO está nesta feature.

## Out of Scope (não-objetivos explícitos)

- **OS-001**: Motor próprio de prescrição (base de medicamentos, posologia, interações) — tudo Memed.
- **OS-002**: Assinatura ICP-Brasil própria — Memed cuida.
- **OS-003**: Armazenamento local do PDF da receita — apenas referência. Cache opcional em iteração futura.
- **OS-004**: Atestados, declarações, solicitação de exames — features próprias separadas (Memed também oferece, mas escopo distinto).
- **OS-005**: Verificação ativa de CRM no CFM — Memed valida na criação.
- **OS-006**: Prescrição em lote (várias receitas de uma vez) — uma por vez, manual.
- **OS-007**: Modificação de receita já assinada — Memed bloqueia por design; Prontool não tenta.
- **OS-008**: Notificação de "retirada na farmácia" via push do Prontool — visível na timeline ao reabrir a ficha, mas sem push proativo nesta versão.
- **OS-009**: Suporte a múltiplas contas Memed por tenant (clínicas com várias filiais usando Memeds diferentes) — uma conta Memed por tenant; multi-conta vira escopo futuro.
- **OS-010**: Migração de prescrições históricas em papel — escopo manual da clínica, não-feature.
