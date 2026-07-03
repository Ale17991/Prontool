# Feature Specification: Módulos de Especialidade (Convênio, Odontologia, Oftalmologia)

**Feature Branch**: `042-modulos-especialidade`
**Created**: 2026-06-25
**Status**: Draft
**Input**: Gating de áreas/dados por módulo de tenant — transformar `tiss` em `convenio` (TISS vira parte do convênio) e criar `odonto` e `oftalmo`, escondendo na UI tudo que só faz sentido para clínicas que usam cada especialidade.

## Resumo

Hoje o sistema mostra a TODAS as clínicas áreas que só fazem sentido para alguns nichos: faturamento/recebíveis de convênio, odontograma/periograma, exames oftalmológicos. Isso polui a interface de quem não usa esses recursos (ex.: um nutricionista vê "Odonto-Space"; uma clínica 100% particular vê "Faturamento TISS" e o seletor de convênio).

A solução é amarrar cada conjunto de áreas a um **módulo de especialidade** no sistema de entitlements já existente, de modo que a área **só apareça quando o módulo da clínica estiver ativo**. O módulo `tiss` é absorvido por um módulo `convenio` mais amplo (TISS passa a ser parte do convênio). São criados os módulos `odonto` e `oftalmo`. Clínicas que já usam cada área são **auto-ativadas** na migração para não perderem acesso.

## Clarifications

### Session 2026-06-25

- Q: Critério de auto-ativação do `convenio` na migração → A: Uso real — ativa se o tenant tem ≥1 atendimento/procedimento com `plan_id` OU configuração/guia TISS existente (não basta haver convênio cadastrado).
- Q: Estado padrão de `convenio`/`odonto`/`oftalmo` em clínicas novas (não-legacy) → A: Desligados por padrão; super-admin liga no /admin conforme o nicho.
- Q: Campo de convênio/plano no cadastro do paciente quando `convenio` off → A: Esconder também (coerente com "esconder tudo de convênio").

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Clínica sem convênio não vê áreas de convênio (Priority: P1)

Uma clínica que atende **somente particular** não deve ver nada relacionado a convênio: nem faturamento TISS, nem recebíveis de convênio, nem cadastro de convênios, nem a opção de marcar um atendimento como "convênio". Para essa clínica, todo atendimento é particular.

**Why this priority**: É o caso mais comum e o que mais polui a UI hoje; o convênio toca navegação, configurações e o fluxo de atendimento.

**Independent Test**: Em uma clínica com o módulo `convenio` desligado, confirmar que as áreas de convênio somem da sidebar, das Configurações e do atendimento; em uma clínica com `convenio` ligado, confirmar que tudo aparece normalmente.

**Acceptance Scenarios**:

1. **Given** uma clínica com módulo `convenio` desligado, **When** o usuário abre a sidebar, **Then** os itens "Faturamento TISS" e "Recebíveis Convênio" não aparecem.
2. **Given** o módulo `convenio` desligado, **When** o usuário abre o hub de Configurações, **Then** o card "Convênios" não aparece e a integração TISS fica indisponível.
3. **Given** o módulo `convenio` desligado, **When** o usuário cria/edita um atendimento, **Then** não há seleção de convênio×particular (o atendimento é tratado como particular) e nenhum seletor de plano de convênio é exibido.
4. **Given** o módulo `convenio` ligado, **When** o usuário navega pelas mesmas telas, **Then** todas as áreas de convênio (TISS, recebíveis, cadastro, seletor) aparecem.
5. **Given** uma clínica que hoje usa TISS (módulo `tiss` antigo), **When** a migração roda, **Then** ela passa a ter o módulo `convenio` ativo (sem perda de acesso).

---

### User Story 2 - Clínica sem odontologia não vê a área odontológica (Priority: P2)

Uma clínica que não é odontológica não deve ver a aba "Odonto-Space" (odontograma, periograma e plano de tratamento odontológico) no prontuário do paciente.

**Why this priority**: Reduz ruído para a maioria das clínicas (médicas/nutri/etc.); área concentrada no prontuário, escopo menor que convênio.

**Independent Test**: Com `odonto` desligado, abrir um paciente e confirmar que a aba Odonto-Space não existe; com `odonto` ligado, a aba aparece e funciona.

**Acceptance Scenarios**:

1. **Given** uma clínica com módulo `odonto` desligado, **When** o usuário abre o prontuário de um paciente, **Then** a aba "Odonto-Space" não é exibida.
2. **Given** o módulo `odonto` desligado e a URL apontando para `?tab=odontograma`, **When** a página carrega, **Then** o sistema cai em uma aba padrão válida em vez de mostrar a área odontológica.
3. **Given** o módulo `odonto` ligado, **When** o usuário abre o prontuário, **Then** a aba "Odonto-Space" aparece com odontograma, periograma e plano de tratamento.
4. **Given** uma clínica que já registrou dados odontológicos, **When** a migração roda, **Then** ela passa a ter `odonto` ativo.

---

### User Story 3 - Clínica sem oftalmologia não vê a área oftalmológica (Priority: P3)

Uma clínica que não faz oftalmologia não deve ver a seção de exames oftalmológicos no prontuário nem os modelos de laudo específicos de oftalmo nas Configurações.

**Why this priority**: Nicho menor; escopo concentrado e de menor impacto que os anteriores.

**Independent Test**: Com `oftalmo` desligado, confirmar que a seção de exames oftalmológicos some do prontuário; com `oftalmo` ligado, ela aparece.

**Acceptance Scenarios**:

1. **Given** uma clínica com módulo `oftalmo` desligado, **When** o usuário abre o prontuário, **Then** a seção de exames oftalmológicos não é exibida.
2. **Given** o módulo `oftalmo` desligado, **When** o usuário abre Configurações, **Then** os modelos de laudo oftalmológicos não aparecem (se forem específicos de oftalmo).
3. **Given** o módulo `oftalmo` ligado, **When** o usuário abre o prontuário, **Then** a seção de exames oftalmológicos aparece e funciona.
4. **Given** uma clínica que já registrou exames de oftalmologia, **When** a migração roda, **Then** ela passa a ter `oftalmo` ativo.

---

### User Story 4 - Administrador da plataforma controla os módulos por clínica (Priority: P1)

O super-admin precisa ligar/desligar `convenio`, `odonto` e `oftalmo` em cada clínica pelo painel `/admin`, com rótulos claros.

**Why this priority**: Sem o controle no painel, não há como operar o gating na prática (vender/ativar por clínica).

**Independent Test**: No `/admin`, abrir uma clínica e confirmar que os três módulos aparecem como toggles com rótulos legíveis; alternar um e ver a UI da clínica refletir.

**Acceptance Scenarios**:

1. **Given** o painel `/admin` de uma clínica, **When** o super-admin abre os módulos, **Then** "Convênio", "Odontologia" e "Oftalmologia" aparecem como opções, e "TISS" não aparece mais como módulo separado.
2. **Given** o super-admin liga um módulo, **When** a clínica recarrega, **Then** as áreas correspondentes passam a aparecer.

---

### Edge Cases

- **Clínica legacy**: o plano `legacy` continua liberando TODOS os módulos automaticamente — clínicas legacy não são afetadas pelo gating (mantém o comportamento grandfather atual).
- **Linha de entitlement ausente / erro de leitura**: tratado como legacy/total (fail-open), como já ocorre hoje — nunca esconder área por erro transitório.
- **Acesso direto por URL** a uma aba/área de módulo desligado: deve degradar para uma aba/estado padrão válido, sem erro.
- **Dados órfãos**: esconder a UI não apaga dados. Se o módulo for religado, os dados anteriores reaparecem.
- **Módulo `tiss` remanescente nos dados**: após a migração, nenhum tenant deve ter `tiss` no array de módulos (renomeado para `convenio`); um `tiss` remanescente seria ignorado pela leitura (filtrada por `ALL_MODULES`).
- **Atendimento histórico com convênio numa clínica que depois desligou `convenio`**: o valor já gravado permanece; apenas o seletor/novas marcações de convênio deixam de ser oferecidos.

## Requirements _(mandatory)_

### Functional Requirements

**Catálogo de módulos**

- **FR-001**: O sistema MUST oferecer os módulos de especialidade `convenio`, `odonto` e `oftalmo` no catálogo de entitlements.
- **FR-002**: O módulo `tiss` MUST deixar de ser um módulo contratável independente; suas áreas passam a pertencer ao módulo `convenio`.
- **FR-003**: O plano `legacy` MUST continuar incluindo todos os módulos (inclusive os três novos), preservando o comportamento grandfather.
- **FR-004**: Os três módulos MUST aparecer como toggles, com rótulos legíveis ("Convênio", "Odontologia", "Oftalmologia"), no painel `/admin` por clínica.
- **FR-004a**: Clínicas NOVAS (não-legacy) MUST nascer com `convenio`, `odonto` e `oftalmo` DESLIGADOS; a ativação é feita pelo super-admin no `/admin` conforme o nicho da clínica.

**Gating — Convênio**

- **FR-005**: Quando `convenio` estiver desligado, o sistema MUST ocultar os itens de navegação "Faturamento TISS" e "Recebíveis Convênio".
- **FR-006**: Quando `convenio` estiver desligado, o sistema MUST ocultar o cadastro de Convênios nas Configurações e tornar a integração TISS indisponível.
- **FR-007**: Quando `convenio` estiver desligado, o sistema MUST ocultar a escolha convênio×particular e qualquer seletor de plano de convênio no fluxo de atendimento, tratando os atendimentos como particular.
- **FR-007a**: Quando `convenio` estiver desligado, o sistema MUST ocultar o campo de convênio/plano de saúde no cadastro do paciente.
- **FR-008**: Quando `convenio` estiver ligado, todas as áreas acima MUST aparecer e funcionar como hoje.

**Gating — Odontologia**

- **FR-009**: Quando `odonto` estiver desligado, o sistema MUST ocultar a aba "Odonto-Space" (odontograma, periograma, plano de tratamento odontológico) do prontuário.
- **FR-010**: O acesso direto à aba odontológica por URL com `odonto` desligado MUST degradar para uma aba padrão válida, sem erro.

**Gating — Oftalmologia**

- **FR-011**: Quando `oftalmo` estiver desligado, o sistema MUST ocultar a seção de exames oftalmológicos do prontuário e os modelos de laudo específicos de oftalmo.

**Migração / continuidade de acesso**

- **FR-012**: A migração MUST renomear `tiss` para `convenio` no conjunto de módulos de todos os tenants que o tenham.
- **FR-013**: A migração MUST ativar `convenio` para tenants com **uso real** de convênio — definido como ≥1 atendimento/procedimento com `plan_id` preenchido OU configuração/guia TISS existente. A mera existência de convênios cadastrados (`health_plans`) NÃO basta, para evitar super-ativação por planos semeados/nunca usados.
- **FR-014**: A migração MUST ativar `odonto` para tenants que já possuem dados odontológicos (odontograma ou periograma).
- **FR-015**: A migração MUST ativar `oftalmo` para tenants que já possuem exames de oftalmologia.
- **FR-016**: A migração MUST ser segura e idempotente, sem apagar dados e sem afetar tenants legacy (que já recebem todos os módulos).

**Não-regressão**

- **FR-017**: Nenhuma clínica que hoje usa convênio, odontologia ou oftalmologia MAY perder acesso a essas áreas após o deploy.
- **FR-018**: O gating MUST falhar em modo aberto (mostrar a área) em caso de erro de leitura de entitlements ou ausência de linha, mantendo a postura defensiva atual.

### Key Entities _(include if feature involves data)_

- **Entitlement do tenant**: registro por clínica com plano + lista de módulos contratados. Passa a reconhecer `convenio`, `odonto`, `oftalmo` e a não reconhecer mais `tiss`.
- **Módulo de especialidade**: rótulo/identidade de um conjunto de áreas que só aparece quando ativo (`convenio`, `odonto`, `oftalmo`).
- **Sinais de uso para auto-ativação**: convênios cadastrados / config TISS (→ convenio); odontograma/periograma (→ odonto); exames oftalmológicos (→ oftalmo).

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: Uma clínica 100% particular (sem `convenio`) não vê nenhuma das áreas de convênio (0 itens de convênio na sidebar, nas Configurações e no atendimento).
- **SC-002**: Uma clínica não-odontológica (sem `odonto`) não vê a aba Odonto-Space em nenhum prontuário.
- **SC-003**: Uma clínica não-oftalmológica (sem `oftalmo`) não vê a seção de exames oftalmológicos.
- **SC-004**: 100% das clínicas que já usavam convênio / odonto / oftalmo continuam com acesso a essas áreas imediatamente após o deploy (zero regressões de acesso).
- **SC-005**: Após a migração, nenhum tenant possui o módulo `tiss` (todos migrados para `convenio`).
- **SC-006**: O super-admin consegue ligar/desligar os três módulos por clínica e a UI da clínica reflete a mudança no próximo carregamento.

## Assumptions

- O sistema de entitlements (plano + módulos por tenant) já existe e é a base do gating; nenhuma área nova de produto é criada — apenas condiciona-se a exibição das existentes.
- O padrão de implementação segue o módulo `endocrino` já existente (entitlement lido no servidor e passado como sinal para os componentes).
- Esta fase foca em **esconder na UI**; bloqueio adicional em nível de API/banco é considerado fora de escopo (defesa em profundidade fica como follow-up).
- A maioria das clínicas em produção está no plano `legacy` (recebem todos os módulos), então o risco de regressão recai sobre tenants não-legacy, cobertos pela auto-ativação.
- Os modelos de laudo são tratados como oftalmológicos apenas se forem efetivamente específicos de oftalmo; caso contrário permanecem visíveis.
- Não há mudança nos demais módulos (`portal_paciente`, `telemedicina`, `crm`, `treino`, `dieta`, `endocrino`).
