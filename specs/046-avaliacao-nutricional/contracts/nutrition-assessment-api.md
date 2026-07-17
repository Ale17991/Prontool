# Contrato de API — Avaliação Nutricional (046)

Todas as rotas: `runtime = 'nodejs'`, `dynamic = 'force-dynamic'`, `requireRole` + gate de módulo `nutri_avaliacao`. Erros via `toHttpResponse`. Cálculo "ao vivo" acontece no **cliente** (motor puro isomórfico) — não há endpoint de preview.

## POST `/api/pacientes/[id]/avaliacao-nutricional`

Cria uma avaliação (calcula no servidor a partir das entradas, grava o snapshot e lança os derivados nas medições).

- **RBAC**: `requireRole(['admin','profissional_saude'])` + `hasModule('nutri_avaliacao')` (senão 404/403).
- **Body** (Zod):
  ```jsonc
  {
    "assessed_at": "2026-07-16",          // AAAA-MM-DD
    "weight_kg": 82.5,
    "height_cm": 178,
    "skinfolds": { "peitoral": 12, "abdominal": 20, "coxa": 15 },   // mm, conforme protocolo
    "circumferences": { "cintura": 88, "quadril": 100 },            // cm
    "dobra_protocol": "jp3",              // ou "bioimpedancia" (então envia fat_pct_input)
    "fat_pct_input": null,                // usado só quando dobra_protocol = "bioimpedancia"
    "tmb_equation": "mifflin",
    "activity_factor": 1.55,
    "injury_factor": 1.0,
    "extra_kcal": 0,                      // adicional gestante/lactante
    "objective": "deficit",               // deficit | manutencao | superavit
    "objective_delta_kcal": -500,
    "target_macros": { "prot_pct": 30, "carb_pct": 40, "lip_pct": 30 },
    "notes": null
  }
  ```
  - `sex` e `age_years` são derivados do paciente no servidor (não vêm no body) e congelados na avaliação.
- **Cálculo** (servidor, motor `src/lib/core/nutrition/`): densidade→%gordura (Siri)→massas; IMC/RCQ + classes; TMB→GET→VET-meta→macros em g.
- **201**: `{ id, fat_pct, fat_mass_kg, lean_mass_kg, imc, imc_class, waist_hip_ratio, waist_hip_class, tmb_kcal, get_kcal, target_kcal, target_macros }`.
- **Erros**:
  - `400 INVALID_BODY` (Zod).
  - `422 MISSING_PATIENT_DATA` (sexo/nascimento ausentes no paciente).
  - `422 MISSING_SKINFOLDS` (protocolo exige sítios não informados).
  - `422 MISSING_LEAN_MASS` (equação por MLG sem composição).
  - `422 MEASUREMENT_OUT_OF_RANGE` / `MACROS_SUM_INVALID` (valor implausível / macros ≠ 100%).
  - `404 patient` (fora do tenant).

## GET `/api/pacientes/[id]/avaliacao-nutricional`

Lista as avaliações do paciente (mais recente primeiro) para o histórico.

- **RBAC**: `requireRole(['admin','financeiro','recepcionista','profissional_saude'])` + gate de módulo (leitura pode ser mais ampla; escrita só admin/profissional_saude).
- **200**: `{ assessments: [{ id, assessed_at, dobra_protocol, tmb_equation, fat_pct, imc, tmb_kcal, get_kcal, target_kcal }] }`.

## (Opcional) GET `/api/pacientes/[id]/avaliacao-nutricional/[assessmentId]`

Detalhe completo de uma avaliação (todas as entradas + resultados) para reabrir/visualizar.

## Notas de contrato

- **Imutável**: não há PATCH/DELETE — correção é novo POST (nova avaliação).
- **Isolamento**: toda rota filtra por `tenant_id` da sessão; paciente de outro tenant → 404.
- **Auditoria**: o POST audita a criação (`log_audit_event`).
- **Catálogo de métodos**: um endpoint estático (ou constante compartilhada TS) expõe a lista de equações/protocolos com os sítios de dobra exigidos, para a UI montar o formulário — preferência por **constante TS** (`protocols.ts`) reusada no cliente, sem round-trip.
