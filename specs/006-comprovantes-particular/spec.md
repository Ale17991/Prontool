# Feature Specification: Múltiplos comprovantes em despesas + checkbox de atendimento particular

**Feature Branch**: `006-comprovantes-particular`
**Created**: 2026-04-28
**Status**: Draft
**Input**: User description: "Multiplos comprovantes em despesas (com upload posterior, lista com previews, soft-delete admin) + checkbox 'Atendimento particular' em todos os formularios de procedimento (atendimento + etapa do plano), com auto-detect baseado no plano do paciente."

## Contexto

A feature toca duas áreas operacionais distintas mas relacionadas pela operação financeira/clínica diária da clínica. Estão consolidadas numa única spec porque a equipe pediu juntas e os usuários afetados são os mesmos (admin, financeiro, recepcionista).

**Estado atual relevante**:

- `expenses` recebeu na sprint anterior 3 colunas `receipt_file_*` para anexar **um** comprovante por despesa (commit `37df456`). Esta feature **expande** o modelo para 1:N (uma despesa pode ter vários comprovantes — nota fiscal + boleto + transferência).
- `appointments.plan_id` é hoje `NOT NULL` — registrar atendimento particular exige tornar essa FK opcional ou usar plano sentinela. A spec assume que a coluna passa a aceitar `NULL` (decisão de plan).
- `procedures.default_amount_cents` (particular) e `procedures.covered_by_plan` já existem desde a feature 002 — basta consumir.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Anexar múltiplos comprovantes a uma despesa (Priority: P1)

A profissional do financeiro registra a despesa "Compra de instrumentais" no valor de R$ 4.500,00 e quer anexar três arquivos: a nota fiscal em PDF, o boleto pago em PDF, e o comprovante de transferência em JPG. Ela faz upload dos três no momento do cadastro (ou pode anexar mais tarde acessando a despesa). Outro usuário visualizando a lista vê o ícone de clipe com a contagem "3" e, ao expandir, baixa ou visualiza qualquer um dos arquivos.

**Why this priority**: É o pilar funcional desta sprint do lado de despesas. A versão single-receipt em produção é insuficiente para a realidade contábil — fornecedores normalmente exigem nota fiscal **+** comprovante de pagamento. Sem N:1, o usuário precisa escolher qual arquivo mantém.

**Independent Test**: Pode ser entregue isoladamente da Feature 2 (atendimento particular). Validação: criar despesa com 3 anexos, verificar contagem na lista, expandir e baixar cada um. Tentar anexar arquivo > 10 MB ou tipo não suportado → rejeitado.

**Acceptance Scenarios**:

1. **Given** estou cadastrando nova despesa, **When** seleciono 3 arquivos (PDF, PDF, JPG) e submeto, **Then** os 3 são anexados à despesa criada e aparecem na lista expandida.
2. **Given** uma despesa já cadastrada existe sem comprovante, **When** abro a despesa e clico em "Adicionar comprovante", **Then** posso fazer upload de um arquivo e ele passa a constar na despesa, sem alterar valor/categoria/data (campos imutáveis).
3. **Given** uma despesa já tem 2 comprovantes anexados, **When** clico em "+ Adicionar comprovante" e subo um terceiro, **Then** o terceiro é incluído sem afetar os 2 anteriores.
4. **Given** tento subir um arquivo de 12 MB ou um `.docx`, **When** o sistema valida, **Then** rejeita com mensagem clara ("máximo 10 MB" ou "PDF, JPG ou PNG apenas") e o cadastro da despesa não é afetado.
5. **Given** a despesa cadastrada não pertence ao meu tenant, **When** tento acessar via URL direta a `/api/despesas/[id]/comprovantes`, **Then** recebo 404 (sem vazamento de existência).

---

### User Story 2 - Visualizar e baixar comprovantes (Priority: P2)

A administradora abre `/cadastros/despesas` e quer auditar os comprovantes. Na lista, despesas com anexo mostram um clipe + contagem; ao clicar, ela vê os arquivos com preview (thumbnail para JPG/PNG, ícone de PDF) e pode visualizar (abrir em nova aba) ou baixar.

**Why this priority**: Sem visualização, o upload sozinho não fecha o ciclo de auditoria. Mas pode ser entregue depois de US1 — por enquanto o usuário ainda baixa pela URL assinada.

**Independent Test**: Após US1 estar funcional. Validação: lista mostra contagem; expandir mostra preview + botões; "Visualizar" abre nova aba; "Baixar" salva o arquivo localmente.

**Acceptance Scenarios**:

1. **Given** uma despesa tem 3 comprovantes, **When** vejo a linha na lista, **Then** o ícone de clipe mostra a contagem `3`.
2. **Given** uma despesa não tem nenhum comprovante, **When** vejo a linha na lista, **Then** não há ícone de clipe; um botão "Anexar" aparece para usuários com permissão.
3. **Given** estou na visualização expandida da despesa, **When** vejo a lista de comprovantes, **Then** cada item tem nome do arquivo, tamanho, data do upload, quem anexou, e botões "Visualizar" e "Baixar".
4. **Given** clico em "Visualizar" em um PDF ou imagem, **When** a ação completa, **Then** o arquivo abre em nova aba (URL assinada de duração curta).
5. **Given** sou recepcionista (papel de leitura), **When** abro a despesa, **Then** vejo a lista de comprovantes mas não vejo botões "Adicionar" nem "Remover".

---

### User Story 3 - Remover comprovante com soft-delete (Priority: P3)

Em casos raros (arquivo errado anexado, dado pessoal sensível subido por engano), a administradora precisa remover um comprovante específico de uma despesa sem perder a despesa em si nem o histórico de auditoria. Apenas papel `admin` pode executar essa ação. O arquivo no storage permanece (audit forense), mas o usuário e o front-end não veem mais a referência.

**Why this priority**: Caso minoritário mas requerido pelo time financeiro. Não bloqueia o fluxo principal.

**Independent Test**: Como admin, abrir despesa com comprovante, clicar em "Remover" em um item, confirmar prompt, ver o item desaparecer da lista. Como usuário não-admin, o botão "Remover" não aparece.

**Acceptance Scenarios**:

1. **Given** sou admin e a despesa tem 2 comprovantes, **When** clico em "Remover" em um deles e confirmo, **Then** o comprovante some da lista; a contagem na linha vai de 2 para 1.
2. **Given** sou financeiro/recepcionista, **When** abro o detalhe de despesa com comprovante, **Then** o botão "Remover" não aparece em nenhum item.
3. **Given** um comprovante foi soft-deleted, **When** consulto o registro de auditoria, **Then** vejo entrada com ator + timestamp + nome do arquivo + motivo da remoção.
4. **Given** um comprovante foi soft-deleted, **When** verifico o storage diretamente, **Then** o arquivo binário ainda existe (soft-delete preserva evidência).

---

### User Story 4 - Checkbox "Atendimento particular" em formulários de procedimento (Priority: P1)

A recepcionista cadastra um novo atendimento para a paciente Júlia, que não tem plano de saúde. O sistema marca automaticamente "Atendimento particular" no formulário, esconde o select de plano e usa o valor particular do procedimento como default. No próximo dia, ela cadastra atendimento para o paciente Pedro, que tem plano Unimed; o checkbox vem desmarcado, o select aparece pré-selecionado em Unimed, e o valor vem da tabela de preços por convênio. Mesmo comportamento no formulário de "Nova etapa do plano de tratamento".

**Why this priority**: É o pilar funcional do lado de atendimentos. Hoje o sistema **força** seleção de plano (sentinela `__none__` em algumas telas, mas inconsistente). A clínica do usuário tem ~40% de pacientes particulares — o fluxo atual é fricção desnecessária.

**Independent Test**: Pode ser entregue isolada de US1/US2/US3 (despesas é outro domínio). Validação: criar atendimento sem plano (particular) com paciente sem plano cadastrado → checkbox vem marcado, valor vem do procedimento, registro salvo com `plan_id = NULL` e badge "Particular" aparece.

**Acceptance Scenarios**:

1. **Given** cadastro novo atendimento para paciente sem `plan_id` (Júlia), **When** o formulário carrega, **Then** o checkbox "Atendimento particular" vem **marcado**, o select de plano fica oculto/desabilitado, e o campo de valor pré-preenche com `default_amount_cents` do procedimento selecionado.
2. **Given** cadastro novo atendimento para paciente com `plan_id` (Pedro com Unimed), **When** o formulário carrega, **Then** o checkbox vem **desmarcado**, o select de plano aparece pré-selecionado com Unimed, e o valor pré-preenche com `price_versions` para (procedimento, plano).
3. **Given** estou no fluxo particular e o procedimento selecionado tem `default_amount_cents IS NULL`, **When** seleciono o procedimento, **Then** vejo aviso "Valor particular não cadastrado para este procedimento" e o campo de valor fica em branco para preenchimento manual.
4. **Given** marco o checkbox "Atendimento particular" manualmente em um paciente que tinha plano pré-selecionado, **When** o checkbox é marcado, **Then** o select de plano se esconde, o `plan_id` do payload muda para `null`, e o valor é recalculado pelo `default_amount_cents` do procedimento.
5. **Given** desmarco o checkbox em um atendimento que estava como particular, **When** o checkbox volta a desmarcado, **Then** o select de plano reaparece (vazio ou pré-preenchido com plano do paciente), e o valor é recalculado por `price_versions`.
6. **Given** salvo o atendimento como particular, **When** o registro é persistido, **Then** `plan_id` é `NULL` na tabela de atendimentos, e a UI passa a mostrar badge "Particular" no detalhe e na listagem.
7. **Given** crio uma etapa do plano de tratamento marcando particular, **When** salvo, **Then** o atendimento auto-criado pela etapa também tem `plan_id = NULL` e badge "Particular".

---

### Edge Cases

- **Despesa cadastrada sem comprovante e mais tarde anexada por usuário sem permissão de write**: botão "Anexar" não aparece — sem fallback silencioso.
- **Upload em rede instável**: arquivo de 9 MB cai no meio. Sistema deve detectar (timeout HTTP) e mostrar erro claro; não deve marcar a referência no banco.
- **Múltiplos arquivos com o mesmo nome anexados na mesma despesa**: o segundo upload renomeia internamente (sufixo numérico) ou rejeita com mensagem clara — escolha pra produzir caminho único no storage.
- **Despesa soft-deleted (a despesa em si) com comprovantes anexados**: comprovantes ficam invisíveis; permanecem no banco vinculados; admin pode "restaurar" a despesa e os comprovantes voltam (fora do escopo desta feature).
- **Tenant isolation no storage**: usuário X do tenant A consegue, via URL bruta do bucket, acessar arquivo do tenant B? Resposta: não — RLS no `storage.objects` usa `(storage.foldername(name))[1] = jwt_tenant_id()`.
- **Particular sem `default_amount_cents`**: valor manual obrigatório com motivo (FR-024).
- **Particular sem plano e sem valor manual**: bloqueia salvar com erro inline.
- **Paciente sem plano de saúde mas o usuário desmarca particular manualmente**: select de plano aparece mas vazio; sistema bloqueia salvar até escolher plano OU re-marcar particular.
- **Paciente com plano + procedimento que não está coberto pelo plano** (`procedures.covered_by_plan = false`): forçar marcar particular automaticamente; mostrar nota explicativa na UI.
- **Estorno de atendimento particular**: mesmo fluxo do convencional; reversal sem efeito sobre o `plan_id` (que continua NULL).
- **Migração: 1:1 → 1:N comprovantes**: a entrega precisa absorver o(s) comprovante(s) já anexados pelos usuários da versão anterior — coluna `receipt_file_url` existente vira primeiro item na nova tabela.

## Requirements _(mandatory)_

### Functional Requirements

#### Feature 1 — Comprovantes (US1, US2, US3)

- **FR-001**: Sistema MUST permitir anexar 0..N comprovantes a uma despesa, no momento da criação ou em qualquer momento posterior (até a despesa ser soft-deleted).
- **FR-002**: Sistema MUST aceitar arquivos PDF, JPG/JPEG, e PNG com tamanho ≤ 10 MB cada. Tipos não suportados ou tamanhos maiores são rejeitados antes do upload (validação client + server).
- **FR-003**: Sistema MUST armazenar comprovantes com isolamento por tenant — nenhum usuário consegue acessar arquivo de outro tenant, nem por URL direta, nem por listagem.
- **FR-004**: Sistema MUST exibir contador de comprovantes em cada linha da listagem de despesas, com ícone de clipe quando count > 0.
- **FR-005**: Sistema MUST oferecer visualização expandida da despesa com lista de comprovantes mostrando: nome do arquivo, tamanho, data do upload, ator (quem fez upload), botões "Visualizar" e "Baixar".
- **FR-006**: Botão "Visualizar" MUST abrir o arquivo em nova aba via URL assinada de curta duração (segurança contra link compartilhado).
- **FR-007**: Botão "Baixar" MUST iniciar download do arquivo no navegador.
- **FR-008**: Apenas papéis `admin` e `financeiro` MUST conseguir fazer upload de comprovantes.
- **FR-009**: Apenas papel `admin` MUST conseguir remover comprovantes (soft-delete).
- **FR-010**: Soft-delete MUST marcar a referência como deletada (timestamp + ator), mantendo o arquivo binário no storage para auditoria forense.
- **FR-011**: Toda operação de upload e remoção MUST gerar entrada em audit log com ator, timestamp, nome do arquivo, despesa associada, e (no caso de remoção) motivo opcional.
- **FR-012**: Papéis `recepcionista` e `profissional_saude` MUST conseguir visualizar a lista de comprovantes e baixar/visualizar arquivos das despesas que já podem ler hoje, sem botões de modificação.

#### Feature 2 — Atendimento particular (US4)

- **FR-020**: Formulário "Novo atendimento" MUST exibir checkbox "Atendimento particular" antes ou ao lado do select de plano de saúde.
- **FR-021**: Formulário "Nova etapa do plano de tratamento" MUST exibir o mesmo checkbox.
- **FR-022**: Quando o checkbox está marcado: select de plano fica oculto/desabilitado; valor pré-preenche com `default_amount_cents` do procedimento; payload submete `plan_id = null`.
- **FR-023**: Quando o checkbox está desmarcado: select de plano fica visível e obrigatório; valor pré-preenche via lookup em `price_versions` para (procedimento, plano).
- **FR-024**: Se "Atendimento particular" e o procedimento selecionado tem `default_amount_cents IS NULL`, sistema MUST mostrar aviso "Valor particular não cadastrado" e exigir preenchimento manual do valor antes de permitir salvar.
- **FR-025**: O valor (sugerido por `default_amount_cents` ou `price_versions`) MUST ser editável pelo usuário no momento do cadastro; alteração registra como override.
- **FR-026**: Se o paciente selecionado **não** tem plano cadastrado (`patients.plan_id IS NULL`), checkbox vem **marcado** por padrão.
- **FR-027**: Se o paciente tem plano, checkbox vem **desmarcado** e o select de plano vem pré-selecionado com o plano do paciente.
- **FR-028**: Se o procedimento tem `covered_by_plan = false`, sistema MUST forçar `particular = true` (checkbox desabilitado em modo marcado, com nota "Procedimento não coberto por plano").
- **FR-029**: Atendimentos com `plan_id = NULL` MUST exibir badge "Particular" no detalhe, no calendário, na lista, e no card de etapa do plano de tratamento.
- **FR-030**: Endpoint de criação de atendimento MUST aceitar `plan_id` nulo e validar que `frozen_amount_cents > 0` foi informado quando `plan_id IS NULL`. O fluxo de validação que hoje exige `price_versions` deve pular a checagem quando `plan_id IS NULL`.

### Key Entities _(include if feature involves data)_

- **Despesa (`expenses`)**: já existe. Não muda em estrutura nesta feature; apenas perde gradualmente a relevância das colunas single-receipt `receipt_file_*` (que são marcadas legadas e mantidas até backfill da nova entidade).
- **Comprovante de despesa (novo, `expense_receipts`)**: nova entidade. Atributos: id, tenant_id, expense_id, file_name, storage_path, file_size_bytes, content_type, uploaded_by, uploaded_at, deleted_at (nullable), deleted_by, deleted_reason. UNIQUE não-deletados por (expense_id, file_name) ou path único garantido por suffix.
- **Atendimento (`appointments`)**: tabela existente. Mudança: `plan_id` deixa de ser `NOT NULL` — passa a ser opcional. Trigger de validação de preço (`enforce_appointment_preconditions`) atualizado para pular price_versions quando plan_id é null.
- **Etapa de plano de tratamento (`treatment_plan_steps`)**: tabela existente. Mudança: `plan_id` já é nullable; sem alteração de schema, apenas a UI passa a usar checkbox em vez de sentinela `__none__`.
- **Audit log (`audit_log`)**: já existe. Recebe novos `entity = 'expense_receipts'` com eventos `upload` e `soft_delete`.

## Success Criteria _(mandatory)_

### Measurable Outcomes

#### Feature 1 — Comprovantes

- **SC-001**: 100% dos uploads de tipo permitido (PDF/JPG/PNG ≤ 10 MB) são bem-sucedidos em condições normais de rede; falhas são reportadas com mensagem específica em ≤ 5 s.
- **SC-002**: Tentativas de cross-tenant access via URL direta (sem token assinado) recebem 403/404 em 100% dos casos — verificado em teste automatizado.
- **SC-003**: Despesas com 0 comprovantes não mostram ícone de clipe; despesas com 1+ mostram com contagem exata. Verificado em até 50 ms p95 na renderização da lista.
- **SC-004**: Soft-delete preserva 100% dos arquivos binários no storage (auditoria forense intacta).
- **SC-005**: Audit log registra `upload` e `soft_delete` para 100% das operações de comprovante, com nome do arquivo, ator, e timestamp.

#### Feature 2 — Atendimento particular

- **SC-010**: Para pacientes sem plano cadastrado, 100% dos formulários de novo atendimento ou nova etapa abrem com "Particular" pré-marcado.
- **SC-011**: Em testes automatizados, atendimentos salvos como particular têm `plan_id IS NULL`, badge "Particular" visível em todas as áreas que exibem o atendimento.
- **SC-012**: O fluxo de criação particular elimina ≥ 1 clique por cadastro em comparação ao fluxo atual (clínica com 40% de particulares: ganho proporcional).
- **SC-013**: Procedimentos sem `default_amount_cents` cadastrado bloqueiam salvar com mensagem clara em 100% dos casos — sem inserir registro com valor 0.

## Assumptions

- A clínica continua a ter o catálogo de procedimentos atualizado com `default_amount_cents` quando cobra particular. Procedimentos sem esse valor são minoria, tratados pelo aviso de UI.
- A versão single-receipt em produção (commit `37df456`) é considerada legada — esta feature substitui o modelo. As 3 colunas existentes em `expenses` permanecem para back-compat até backfill ser concluído (decisão de plan).
- `appointments.plan_id` passa a ser nullable; trigger `enforce_appointment_preconditions` atualizado em migration desta feature para pular o lookup em `price_versions` quando `plan_id` é null. Atendimentos antigos têm `plan_id` preenchido; apenas novos podem ser null.
- Nenhuma mudança em `treatment_plan_steps` schema — `plan_id` já é nullable. UI passa a usar checkbox em vez de sentinela `__none__`.
- Soft-delete dos comprovantes não toca o arquivo binário no storage. Limpeza física é responsabilidade de um job futuro (fora do escopo) que respeite período de retenção legal.
- Visualização (URL assinada) usa expiração de 60 segundos — alinhado com o helper já em uso no sistema.
- Uploads são feitos via multipart pela API server-side (não pré-signed URL direto do browser para o Storage); preserva validação centralizada de tipo, tamanho e RBAC.
- Thumbnails de imagens podem ser geradas on-demand pelo browser (preview client-side) em vez de pipeline server-side de processamento — simplifica a feature.
- Backfill da feature 1: se houver 0 ou poucos registros com `receipt_file_url` em produção (recente), backfill é trivial. Plan decide a estratégia exata.

## NEEDS CLARIFICATION

Nenhuma dúvida bloqueante. As 3 zonas de risco arquitetural — todas com default razoável — ficam para o `/speckit.plan`:

1. **Schema do `expense_receipts`**: tabela separada vs. JSONB array em `expenses`. Default: tabela separada (auditoria + queries por arquivo).
2. **Migração `appointments.plan_id NOT NULL → NULL`**: requer atualizar o trigger 0015. Default: ALTER COLUMN + atualizar trigger no mesmo migration.
3. **Backfill do single-receipt para multi-receipt**: a tabela `expense_receipts` vira o sistema de registro; as 3 colunas em `expenses` ficam legadas (nullable, marcadas DEPRECATED). Default: backfill copia receitas existentes para a nova tabela em DO block na migration.
