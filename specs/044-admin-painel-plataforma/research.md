# Phase 0 — Research: Painel /admin (financeiro, uso, auditoria, sistema)

## R1. Preços de plano (config editável)

- **Decision**: Nova tabela global `plan_prices (plan PK, price_cents INT NOT NULL DEFAULT 0, updated_at, updated_by)`. Action `adminSetPlanPriceAction(plan, priceCents)` (super-admin, audita em `audit_log`). Seed: uma linha por plano (`essencial`, `pro`, `clinica`, `legacy`) com `price_cents=0` para editar depois.
- **Rationale**: editável sem deploy (clarificação Q1); centavos (BRL). É a única escrita da feature.
- **Alternatives**: fixo no código (rejeitado — exige deploy); versionado valid_from/valid_to (follow-up se quiserem MRR histórico).

## R2. MRR (US1)

- **Decision**: MRR por plano = `count(tenant_entitlements WHERE status='active' AND plan=P) × plan_prices[P].price_cents`. MRR total = soma. Legado entra com seu preço (Q2). Trials/cancelados/past_due NÃO entram no MRR ativo, mas aparecem nas contagens por status. "Trials a vencer" = `status='trial' AND trial_ends_at` nos próximos N dias. "Inadimplentes" = `status='past_due'`. "Churn" = `status='canceled'` no período (por `updated_at` da entitlement).
- **Rationale**: cálculo simples e verificável (SC-002), só leitura de `tenant_entitlements` + `plan_prices`.
- **Open**: "ativo" para MRR = `status='active'`. Trial não conta como receita (padrão SaaS).

## R3. Uso & risco das clínicas (US2)

- **Decision**: Por tenant: atendimentos no período = `count(appointments WHERE tenant_id, appointment_at in período)`; usuários ativos = `count(user_tenants WHERE tenant_id, status='active')`; última atividade = `max(created_at)` entre `appointments` e/ou `audit_log` do tenant. Risco = última atividade > **14 dias** atrás (clarificação Q3, ajustável na UI). Ordenável por uso/risco.
- **Rationale**: dados existentes; contagens com `head/count`. Última atividade via audit_log é barata (índice por tenant_id+created_at, se houver) — senão usar appointments.appointment_at máximo.

## R4. Auditoria global (US3)

- **Decision**: Ler `audit_log` cross-tenant (service client), filtrável por tipo de ação, clínica (tenant_id), ator e período (default 30 dias), paginado. Mapear "tipos de ação" para (entity, field):
  - Impersonação: `entity='session'`, `field IN ('impersonation_start','impersonation_end','tenant_switch')`.
  - Permissões: `entity='user_permission_overrides'`.
  - Usuário (papel/criação/status): `entity='user_tenants'`.
  - Dados da clínica: `entity IN ('tenant_clinic_profile','tenants')`.
  - Plano/módulo e reset de senha: ver R6 (podem precisar de insert de auditoria).
- **Rationale**: trilha já existe; feed é leitura + filtros. Períodos limitados para performance.

## R5. Saúde do sistema (US4)

- **Decision**: Consolidar: `alerts` (abertos), `integration_sync_log` (falhas recentes por tenant×provider), DLQ de alertas (rotas `/api/alertas/dlq` já existem → reusar a query/contagem), `appointment_reminders` (último ciclo/falhas) e status de crons (ler config do `vercel.json` / último run, se disponível). Cada bloco degrada isolado.
- **Rationale**: tudo já gravado; o painel só agrega o "o que está quebrado agora".

## R6. Gaps de auditoria a preencher

- **Decision**: Alguns eventos sensíveis podem ainda NÃO gravar `audit_log` hoje — confirmar e, se faltar, acrescentar o insert (mínimo) para o feed (US3) ficar completo: **mudança de plano/módulo** (`setTenantPlanAction` / `set_tenant_entitlement`) e **reset de senha** (`adminResetPasswordAction`/`adminSendResetEmailAction`). Override de permissão, troca de papel, criação de usuário, impersonação e edição de clínica já auditam.
- **Rationale**: o feed só mostra o que está em `audit_log`; fechar esses gaps garante cobertura (SC-004).
- **Task**: verificar na implementação e adicionar inserts de auditoria onde faltar (escopo pequeno).

## R7. Navegação e gating

- **Decision**: 4 páginas novas sob `/admin/` (financeiro, uso, auditoria, sistema) + itens no `admin-nav.tsx`. O layout/guarda do /admin já restringe a super-admin (server-side). Lógica em `src/lib/core/admin/` com service client.
- **Rationale**: consistente com o /admin atual; super-admin server-side (Princípio V).
