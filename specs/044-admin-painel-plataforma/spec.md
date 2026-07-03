# Feature Specification: Painel /admin — financeiro, uso, auditoria e saúde do sistema

**Feature Branch**: `044-admin-painel-plataforma`
**Created**: 2026-06-26
**Status**: Draft
**Input**: Reforma do /admin (super-admin) com 4 painéis: visão financeira (MRR), saúde & uso das clínicas, auditoria/segurança global e saúde do sistema — tudo leitura agregada cross-tenant.

## Resumo

Hoje o dono da plataforma enxerga as clínicas uma a uma (plano, status, usuários), mas não tem **visão consolidada** de receita, uso, segurança e saúde operacional. Esta feature acrescenta ao `/admin` quatro painéis somente-leitura que respondem: "quanto estou faturando e de quem?", "quais clínicas estão sumindo (risco de churn)?", "o que de sensível aconteceu na plataforma?" e "o que está quebrado agora?". Tudo restrito ao super-admin, reusando dados já existentes.

## Clarifications

### Session 2026-06-26

- Q: Onde ficam os preços dos planos? → A: Config editável no /admin (tabela de preço por plano, editável pela tela; o MRR usa o valor atual, sem deploy quando mudar).
- Q: Plano Legado entra no MRR? → A: Sim — Legado tem preço próprio configurável e entra no MRR como os demais (R$ 0 se for cortesia).
- Q: Dias sem atividade para marcar "em risco"? → A: 14 dias (padrão; ajustável na UI).

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Visão financeira / MRR (Priority: P1)

O dono da plataforma abre o painel financeiro e vê a **receita mensal recorrente (MRR)** total e por plano, quantas clínicas estão em cada status de cobrança (trial / ativo / inadimplente / cancelado), os **trials terminando em breve** e os **inadimplentes** — para agir (cobrar, converter trial, recuperar).

**Why this priority**: É a visão de negócio que hoje não existe e a mais pedida; orienta decisões de receita.

**Independent Test**: Com preços de plano definidos, conferir que o MRR total = soma (clínicas ativas por plano × preço do plano), e que os contadores por status batem com as clínicas.

**Acceptance Scenarios**:

1. **Given** clínicas em planos com preços definidos, **When** o super-admin abre o painel financeiro, **Then** vê o **MRR total** e o **MRR por plano**, em reais.
2. **Given** clínicas em diferentes status de cobrança, **When** o painel carrega, **Then** mostra a contagem por status (trial / ativo / past_due / canceled).
3. **Given** trials com data de término, **When** o painel carrega, **Then** lista os **trials terminando** nos próximos N dias.
4. **Given** clínicas `past_due`, **When** o painel carrega, **Then** lista os **inadimplentes** (com plano e valor).
5. **Given** cancelamentos no período, **When** o painel carrega, **Then** mostra o **churn** (clínicas canceladas) do período.

---

### User Story 2 - Saúde & uso das clínicas (Priority: P2)

O dono da plataforma vê, por clínica, o **uso recente** (atendimentos no período, usuários ativos, última atividade) e um **sinal de risco** para clínicas inativas — para agir antes do cancelamento.

**Why this priority**: Previne churn (complementa o financeiro); usa dados já existentes.

**Independent Test**: Uma clínica sem atividade há mais de N dias aparece marcada como "em risco"; uma ativa não.

**Acceptance Scenarios**:

1. **Given** clínicas com atendimentos no período, **When** o painel carrega, **Then** cada clínica mostra atendimentos no período, nº de usuários ativos e a data da última atividade.
2. **Given** uma clínica sem atividade há mais de N dias, **When** o painel carrega, **Then** ela é destacada como **em risco/inativa**.
3. **Given** a lista de clínicas, **When** o super-admin ordena por uso (ou por risco), **Then** a ordenação reflete o critério escolhido.

---

### User Story 3 - Auditoria / segurança global (Priority: P2)

O dono da plataforma vê um **feed cross-tenant das ações sensíveis** (impersonação início/fim, mudanças de plano/módulo, mudanças de permissão/papel, criação/desativação de usuário, resets de senha), com filtros, para acompanhar segurança e conformidade.

**Why this priority**: Visibilidade de segurança/conformidade; os dados já são auditados, falta a tela consolidada.

**Independent Test**: Após impersonar uma clínica e mudar o plano de outra, ambos os eventos aparecem no feed com ator, clínica, antes/depois e horário; filtrar por tipo de ação reduz a lista corretamente.

**Acceptance Scenarios**:

1. **Given** ações sensíveis registradas, **When** o super-admin abre a auditoria global, **Then** vê um feed cronológico com ator, clínica, tipo de ação, antes/depois e horário.
2. **Given** o feed, **When** filtra por tipo de ação, clínica, ator ou período, **Then** a lista reflete o filtro.
3. **Given** uma impersonação ocorrida, **When** o super-admin filtra por "impersonação", **Then** vê quem entrou em qual clínica e quando (início e fim).

---

### User Story 4 - Saúde do sistema (Priority: P3)

O dono da plataforma vê num só lugar **o que está quebrado agora**: alertas abertos, integrações falhando, fila de erros (DLQ) e status de lembretes/crons.

**Why this priority**: Operacional; reduz tempo de detecção de problemas. Menos frequente que financeiro/uso.

**Acceptance Scenarios**:

1. **Given** alertas operacionais abertos, **When** o super-admin abre a saúde do sistema, **Then** vê os alertas (tipo, clínica afetada, quando).
2. **Given** integrações com falha de sincronização, **When** o painel carrega, **Then** lista as integrações falhando (clínica × provedor × última falha).
3. **Given** itens na fila de erros (DLQ), **When** o painel carrega, **Then** mostra a contagem/lista pendente.
4. **Given** o painel, **When** carrega, **Then** indica o status recente dos lembretes/crons (último ciclo, falhas).

---

### Edge Cases

- **Plano `legacy` no MRR**: entra como os demais, com **preço próprio configurável** (R$ 0 se for cortesia). Aparece no MRR e nas contagens.
- **Sem preço definido para um plano**: o MRR daquele plano é tratado como R$ 0 e a clínica aparece sinalizada como "sem preço" (não quebra o cálculo).
- **Limiar de inatividade (US2)**: **14 dias** sem atividade marcam a clínica como "em risco" (padrão; ajustável na UI).
- **Clínica suspensa/cancelada**: não entra no MRR ativo; aparece nos contadores de status e no churn.
- **Volume grande de audit_log (US3)**: o feed é paginado e limitado por período (default: últimos 30 dias) para não pesar.
- **Tenant sem integrações (US4)**: simplesmente não aparece na lista de falhas (standalone).
- **Performance**: as agregações usam contagens eficientes e janelas de tempo limitadas; o painel nunca pode derrubar o /admin por timeout — degrada para "indisponível" naquele card.

## Requirements _(mandatory)_

### Functional Requirements

**Geral**

- **FR-001**: Todos os painéis MUST ser restritos ao **super-admin** (validação server-side) e nunca expostos a usuários de clínica.
- **FR-002**: Todos os painéis são **somente-leitura agregada** — não criam/alteram dados de domínio (única exceção possível: a configuração de preços de plano, FR-005).
- **FR-003**: Falha de leitura em um card MUST degradar só aquele card ("indisponível"), sem derrubar a página.

**US1 — Financeiro**

- **FR-004**: O sistema MUST exibir o **MRR total** e o **MRR por plano** (em reais), calculado como soma das clínicas ativas por plano × preço mensal do plano.
- **FR-005**: O sistema MUST ter uma **configuração editável no /admin** de preço mensal por plano (Essencial/Pro/Clínica/Legado), em centavos (BRL); o MRR usa o valor vigente. Editar o preço é a única escrita da feature (auditada) e restrita ao super-admin.
- **FR-006**: O sistema MUST exibir a **contagem de clínicas por status de cobrança** (trial / ativo / past_due / canceled).
- **FR-007**: O sistema MUST listar **trials terminando** nos próximos N dias e **inadimplentes** (past_due), e o **churn** (cancelamentos) do período.

**US2 — Uso/saúde das clínicas**

- **FR-008**: Por clínica, o sistema MUST mostrar **atendimentos no período**, **usuários ativos** e **última atividade**.
- **FR-009**: O sistema MUST destacar clínicas **inativas/em risco** (sem atividade há mais de **14 dias**, padrão ajustável na UI) e permitir ordenar por uso/risco.

**US3 — Auditoria global**

- **FR-010**: O sistema MUST exibir um **feed cross-tenant** das ações sensíveis (impersonação início/fim, mudança de plano/módulo, mudança de permissão/papel, criação/desativação de usuário, reset de senha) com ator, clínica, antes/depois e horário.
- **FR-011**: O feed MUST ser filtrável por **tipo de ação, clínica, ator e período**, e paginado.

**US4 — Saúde do sistema**

- **FR-012**: O sistema MUST consolidar **alertas abertos**, **integrações falhando**, **fila de erros (DLQ)** e **status de lembretes/crons** num painel único.

### Key Entities _(include if feature involves data)_

- **Preço de plano**: valor mensal (centavos, BRL) por plano — fonte do MRR (nova config, a definir).
- **Resumo financeiro**: agregação derivada (MRR total/por plano, contagens por status, trials a vencer, inadimplentes, churn).
- **Uso por clínica**: agregação derivada (atendimentos no período, usuários ativos, última atividade, flag de risco).
- **Evento de auditoria**: registro existente (`audit_log`) — ator, tenant, entidade/campo, antes/depois, motivo, horário.
- **Item de saúde do sistema**: alerta / falha de integração / item de DLQ / status de lembrete-cron (todos já existentes).

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: O super-admin vê o MRR total e por plano em **1 tela**, sem precisar abrir clínica por clínica.
- **SC-002**: O MRR total bate exatamente com a soma (clínicas ativas por plano × preço do plano) — verificável.
- **SC-003**: 100% das clínicas sem atividade além do limiar aparecem sinalizadas como "em risco".
- **SC-004**: Toda ação sensível (impersonação, mudança de plano/módulo/permissão, reset) aparece no feed de auditoria em até 1 minuto após ocorrer.
- **SC-005**: O super-admin identifica "o que está quebrado agora" (alertas/integrações/DLQ) em **1 tela**.
- **SC-006**: Nenhum dos painéis é acessível por usuário não-super-admin.
- **SC-007**: Cada painel carrega em tempo aceitável (sob ~3s em volume normal) ou degrada o card sem quebrar a página.

## Assumptions

- O super-admin já existe e é validado server-side (padrão do /admin atual).
- As leituras cross-tenant são legítimas para o super-admin (já é o padrão via service client).
- MRR é um **cálculo** a partir de plano × preço configurado — sem gateway de pagamento real (fora de escopo).
- Valores monetários em centavos (BRL), inteiros (constituição).
- Os dados de auditoria, alertas, integrações e DLQ já são gravados; a feature só os lê e consolida.
- Períodos default razoáveis (ex.: financeiro/uso = mês corrente; auditoria = 30 dias) podem ser ajustados na UI.
- Não altera o modelo de entitlements (features 042/043) nem expõe nada a não-super-admins.
