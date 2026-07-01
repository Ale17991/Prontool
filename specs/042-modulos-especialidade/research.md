# Phase 0 — Research: Módulos de Especialidade

## R1. Padrão de gating por módulo

- **Decision**: Reusar o padrão `endocrino`: ler o entitlement no Server Component com `getTenantEntitlements(supabase, tenantId)` (de `src/lib/core/entitlements/read.ts`) e passar `ent.hasModule('convenio'|'odonto'|'oftalmo')` como prop booleana para os componentes client, que escondem a área. Para itens declarativos (sidebar, hub cards) usar os predicados `show(ctx)` já existentes em `sidebar-sections.ts` e `_cards.ts`, que recebem `ent` no `ctx`.
- **Rationale**: É o mecanismo já em produção (`page.tsx` do paciente usa `hasEndocrino`; `_cards.ts` usa `ent.hasModule('portal_paciente')`; `sidebar-sections.ts` usa `ent.hasModule('tiss')`). Zero infraestrutura nova, consistente, testável.
- **Alternatives**: Context React client com entitlements — rejeitado (duplicaria fonte da verdade; o servidor já resolve por request).

## R2. Catálogo de módulos — `tiss` → `convenio`

- **Decision**: Em `plans.ts`, remover `'tiss'` do tipo `ModuleId` e de `ALL_MODULES`; adicionar `'convenio'`, `'odonto'`, `'oftalmo'`. Atualizar `MODULE_LABEL` em `clinic-detail.tsx` (remover `tiss`, adicionar `convenio: 'Convênio'`, `odonto: 'Odontologia'`, `oftalmo: 'Oftalmologia'`).
- **Rationale**: `getTenantEntitlements` filtra `row.modules` por `ALL_MODULES` — qualquer `'tiss'` remanescente nos dados é silenciosamente ignorado. Logo a migração de dados (R5) é obrigatória para não "perder" quem tinha `tiss`.
- **Risk**: Tipos quebram em todo uso de `ModuleId` que mencione `tiss` (apenas `sidebar-sections.ts` e `clinic-detail.tsx`). Cobertos pelas edições.

## R3. Sinais de uso para auto-ativação (FR-013/014/015)

Tabelas confirmadas (read-only no backfill):

| Módulo     | Sinal de "uso real"                                                       | Tabela(s)                                                                                 |
| ---------- | ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `convenio` | ≥1 procedimento de atendimento com convênio **OU** TISS configurado/usado | `appointment_procedures.plan_id IS NOT NULL`; `tenant_tiss_operator_config`; `tiss_guias` |
| `odonto`   | ≥1 registro odontológico                                                  | `dental_chart_entries`; `perio_exams`                                                     |
| `oftalmo`  | ≥1 exame oftalmológico                                                    | `ophthalmology_exams`                                                                     |

- **Decision**: Backfill por `EXISTS (... WHERE tenant_id = t.tenant_id)` para cada sinal. Mera existência de `health_plans` **NÃO** conta (clarificação Q1).
- **Rationale**: Evita super-ativação por convênios cadastrados mas nunca usados.

## R4. Escopo "esconder tudo de convênio"

Pontos de gating do `convenio` (off ⇒ esconder):

1. Sidebar: itens "Faturamento TISS" e "Recebíveis Convênio" (`sidebar-sections.ts`).
2. Configurações: card "Convênios" (`_cards.ts`); a página de integração TISS (`/configuracoes/integracoes/tiss`) — gate na origem (card/sub-rota).
3. Atendimento: seletor convênio×particular / seleção de `plan_id` em `new-appointment-form.tsx` e `_components/add-procedure-section.tsx`. Off ⇒ atendimento tratado como particular (sem seletor).
4. Cadastro do paciente: campo de convênio/plano (`cadastro-tab.tsx`) — clarificação Q3.

- **Decision**: Em cada ponto, esconder a área quando `!hasConvenio`. Para a sub-rota TISS, além de sumir o ponto de entrada, a página pode (defensivamente) redirecionar; bloqueio forte de API fica como follow-up (plan §Complexity).

## R5. Migração `0162_specialty_modules.sql`

- **Decision**: Migração idempotente que, para cada linha de `tenant_entitlements`:
  1. Substitui `'tiss'` por `'convenio'` em `modules` (dedup).
  2. Acrescenta `'convenio'`, `'odonto'`, `'oftalmo'` conforme os sinais de R3 (array_append condicional + dedup).
  - Não toca tenants `legacy` de forma significativa (recebem todos via `buildEntitlements`), mas a operação é segura mesmo se aplicada a eles.
- **Rationale**: Atende FR-012/016 e o objetivo de não-regressão (FR-017). `tenant_entitlements.modules` é config mutável (a função `set_tenant_entitlement` já faz UPSERT/UPDATE), então `UPDATE` aqui não fere o Princípio I (não é dado financeiro/histórico).
- **Idempotência**: Reexecutar não duplica módulos (uso de `SELECT DISTINCT unnest` / `array(...)` com dedup) e o rename de `tiss` é no-op na segunda passada.

## R6. Modelos de laudo são de oftalmo?

- **Decision**: Sim — `exam_report_templates.exam_type` nasce `'oftalmologico'` (migração 0150). Gatear os modelos de laudo por `oftalmo` resolve o item deferido na clarificação. Caso futuramente surjam outros `exam_type`, reavaliar (gate por tipo em vez de por módulo).
- **Rationale**: Hoje é 100% oftalmológico; coerente com "esconder o que não se aplica".

## R7. New tenants default-off (Q2)

- **Decision**: Não alterar `create_first_tenant` para incluir os novos módulos. Clínicas novas (`essencial`) nascem sem `convenio/odonto/oftalmo` (default-off); super-admin liga no `/admin`. `legacy` continua com tudo via `buildEntitlements`.
- **Rationale**: Módulos de especialidade são contratáveis; default-off mantém a UI enxuta no onboarding.
