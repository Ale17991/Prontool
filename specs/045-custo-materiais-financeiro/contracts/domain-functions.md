# Contract — Funções de domínio (`src/lib/core`)

## `materials-catalog/` (NOVO)

- `createMaterial(supabase, { tenantId, name, unitCostCents, tussCode?, actorUserId })` → `MaterialRow`
  - Valida `name` (1–200), `unitCostCents >= 0`, `tussCode` opcional (tabela 19). Requer `admin|financeiro`.
- `updateMaterial(supabase, { tenantId, id, name?, unitCostCents?, active?, reason?, actorUserId })` → `MaterialRow`
  - Edita custo/nome/situação; auditado. Requer `admin|financeiro`.
- `listMaterials(supabase, { tenantId, includeInactive? })` → `MaterialRow[]`
  - Ativos por padrão (para o seletor); `includeInactive` para a tela de gestão.

`MaterialRow = { id, name, unitCostCents, tussCode|null, active, updatedAt }`

## `appointments/materials/` (ESTENDER)

- `attachMaterialsToAppointment(...)` — `MaterialInput` ganha `unitCostCents?: number` (default 0) e `materialId?: string`.
- `listAppointmentMaterials(...)` — `AppointmentMaterial` ganha `unitCostCents`, `totalCostCents` (derivado) e `costPending: boolean` (`unitCostCents === 0`).
- `setAppointmentMaterialCost(supabase, { tenantId, materialRowId, unitCostCents, materialId?, reason, actorUserId })` → `AppointmentMaterial` (NOVO; chama a RPC; requer `admin|financeiro`).

## `reports/materials-cost.ts` (NOVO — agregador único)

- `sumMaterialsCost(supabase, { tenantId, from, to })` → `number` (centavos) — exclui estornados; fronteiras no fuso do tenant.
- `materialsCostByDoctor(supabase, { tenantId, from, to })` → `Map<doctorId, cents>`
- `materialsCostByPlan(supabase, { tenantId, from, to })` → `Map<planId|null, cents>`
- `materialsCostDetail(supabase, { tenantId, from, to })` → linhas para drilldown (`{ appointmentId, name, quantity, unitCostCents, totalCostCents }`)

## `reports/operating-result.ts` (ESTENDER)

- `OperatingResultLines` ganha `materialsCostCents`.
- `netProfitCents` subtrai `materialsCostCents`.
- `drilldowns` ganha `materials: '/relatorios/materiais?from=…&to=…'`.

## `reports/by-professional.ts` / `by-plan.ts` / `monthly.ts` / `financial-report.ts` (ESTENDER)
- Cada linha de resumo ganha `materialsCostCents` (via `materialsCostByDoctor`/`ByPlan`) e, onde fizer sentido, `netAfterMaterialsCents`.

## Exports (`export-*.ts` / `export-*.tsx`) (ESTENDER)
- Adicionar coluna "Gasto com materiais" nos Excel e PDF de resultado, por profissional, por convênio e mensal.
