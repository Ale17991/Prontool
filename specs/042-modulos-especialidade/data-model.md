# Phase 1 — Data Model: Módulos de Especialidade

Não há schema novo. A feature reconfigura o **catálogo de módulos** (código) e faz **backfill de dados** em `tenant_entitlements.modules`.

## Catálogo de módulos (código — `src/lib/core/entitlements/plans.ts`)

`ModuleId` (depois):

| ModuleId                                                                 | Status                    | Observação                                                                                                      |
| ------------------------------------------------------------------------ | ------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `convenio`                                                               | **novo** (absorve `tiss`) | Faturamento TISS, recebíveis, cadastro de convênios, seletor convênio×particular, campo de convênio no paciente |
| `odonto`                                                                 | **novo**                  | Odonto-Space (odontograma, periograma, plano de tratamento odonto)                                              |
| `oftalmo`                                                                | **novo**                  | Exames oftalmológicos + modelos de laudo (`exam_type='oftalmologico'`)                                          |
| `tiss`                                                                   | **removido**              | Migrado para `convenio` nos dados                                                                               |
| `portal_paciente`, `telemedicina`, `crm`, `treino`, `dieta`, `endocrino` | inalterados               | —                                                                                                               |

Regras:

- `ALL_MODULES` passa a conter `convenio`, `odonto`, `oftalmo` (e não `tiss`).
- `buildEntitlements`: `legacy` adiciona todos os módulos de `ALL_MODULES` (grandfather) — clínicas legacy recebem os três automaticamente.
- `getTenantEntitlements`: filtra `row.modules` por `ALL_MODULES` ⇒ `tiss` remanescente é ignorado (reforça necessidade do backfill).

## Entidade: `tenant_entitlements` (existente, só dados)

| Coluna      | Tipo    | Mudança                                                                                                  |
| ----------- | ------- | -------------------------------------------------------------------------------------------------------- |
| `tenant_id` | UUID PK | —                                                                                                        |
| `plan`      | TEXT    | —                                                                                                        |
| `status`    | TEXT    | —                                                                                                        |
| `modules`   | TEXT[]  | **backfill**: rename `tiss`→`convenio`; append condicional de `convenio`/`odonto`/`oftalmo` por uso real |

## Sinais de auto-ativação (backfill — migração 0162)

Para cada `tenant_entitlements` (tenant `t`):

| Módulo a ativar | Condição (EXISTS para `t.tenant_id`)                                                                                                          |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `convenio`      | `'tiss' = ANY(modules)` (rename) **OU** `appointment_procedures.plan_id IS NOT NULL` **OU** `tenant_tiss_operator_config` **OU** `tiss_guias` |
| `odonto`        | `dental_chart_entries` **OU** `perio_exams`                                                                                                   |
| `oftalmo`       | `ophthalmology_exams`                                                                                                                         |

Invariantes:

- **Idempotente**: módulos deduplicados; reexecução não altera resultado.
- **Não-destrutivo**: nenhum módulo é removido (exceto o rename `tiss`→`convenio`); nenhum dado de domínio é tocado.
- **Legacy-safe**: aplicar a tenants legacy é inócuo (recebem tudo via código).

## Transições de estado (módulo por clínica)

```
[off] --(super-admin liga no /admin OU backfill por uso real)--> [on]
[on]  --(super-admin desliga no /admin)--> [off]   (dados preservados; só a UI some)
```

Clínica nova (não-legacy): nasce com os três módulos **off**.
