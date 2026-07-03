# Contract — Painéis /admin (agregados) + preço de plano

Feature interna (super-admin). Contratos: as funções de agregação (server) e a action de preço.

## 1. Preço de plano (única escrita)

```
adminSetPlanPriceAction(plan: Plan, priceCents: number): Promise<{ ok: boolean; error?: string }>
// super-admin (superAdminUserId); priceCents ≥ 0 inteiro; upsert em plan_prices; audita em audit_log.
getPlanPrices(sb): Promise<Record<Plan, number>>  // centavos por plano (0 se não definido)
```

## 2. Agregações (server, service client, super-admin)

```
getFinancialSummary(sb, { periodFrom, periodTo, trialWindowDays })
//  → { mrrTotalCents, mrrByPlan, countByStatus, trialsEnding[], pastDue[], churn[] }

getClinicUsage(sb, { periodFrom, periodTo, riskDays = 14 })
//  → ClinicUsageRow[] { tenantId, name, appointments, activeUsers, lastActivityAt, atRisk }

getAuditFeed(sb, { type?, tenantId?, actorId?, from?, to?, page, pageSize })
//  → { rows: AuditRow[], total }   (mapa de `type` → entity/field no research R4)

getSystemHealth(sb)
//  → { alerts[], integrationFailures[], dlqCount, reminders: { lastCycle, failures }, crons[] }
```

Invariantes:

- Toda função exige super-admin (validado na página/route antes de chamar).
- Leitura cross-tenant via service client (padrão /admin); nada exposto a não-super-admin.
- Falha de uma agregação degrada o card correspondente (FR-003), não a página.
- Valores monetários em centavos (BRL), inteiros.

## 3. Páginas

| Rota                | Painel                                                                         |
| ------------------- | ------------------------------------------------------------------------------ |
| `/admin/financeiro` | MRR, status de cobrança, trials a vencer, inadimplentes, churn + editar preços |
| `/admin/uso`        | Uso & risco por clínica (ordenável)                                            |
| `/admin/auditoria`  | Feed global filtrável (tipo/clínica/ator/período)                              |
| `/admin/sistema`    | Alertas, integrações falhando, DLQ, lembretes/crons                            |

## 4. Não-objetivos

- Sem gateway de pagamento real (MRR = plano × preço configurado).
- Sem exposição a não-super-admins.
- Sem versionamento de `plan_prices` (follow-up se quiserem MRR histórico).
- Sem mudança no modelo de entitlements (042/043).
