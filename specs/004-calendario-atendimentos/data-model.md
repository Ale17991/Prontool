# Phase 1 — Data Model: Calendário de atendimentos

**Feature**: 004-calendario-atendimentos
**Date**: 2026-04-27

## Entidades tocadas

### `appointments` (modificada)

Adiciona uma coluna opcional para suportar a duração visual do bloco no calendário. Atendimentos pré-existentes ficam com `NULL` e são renderizados com default de 30 min na camada de leitura — preservando imutabilidade (Princípio I).

```sql
ALTER TABLE public.appointments
  ADD COLUMN duration_minutes INTEGER NULL
    CHECK (duration_minutes IS NULL OR duration_minutes BETWEEN 5 AND 480);
```

**Campos relevantes para esta feature**:

| Campo                 | Tipo         | Notas                                                                  |
| --------------------- | ------------ | ---------------------------------------------------------------------- |
| `id`                  | UUID         | PK existente                                                           |
| `tenant_id`           | UUID         | FK → `tenants.id`. RLS aplica.                                         |
| `patient_id`          | UUID         | FK → `patients.id`. Join para nome no bloco.                           |
| `doctor_id`           | UUID         | FK → `doctors.id`. Filtro do calendário.                               |
| `procedure_id`        | UUID         | FK → `procedures.id`. Join para `tuss_code` + `display_name` no bloco. |
| `appointment_at`      | TIMESTAMPTZ  | Início do atendimento. UTC; renderiza no fuso da clínica.              |
| `duration_minutes`    | INTEGER NULL | **NOVO**. NULL para registros antigos.                                 |
| `frozen_amount_cents` | BIGINT       | Não usado pela feature, mas presente no DTO existente.                 |

**Validações**:

- `duration_minutes` BETWEEN 5 AND 480 (ou NULL).
- Default em leitura: `COALESCE(duration_minutes, 30)`.
- Form de novo atendimento envia `duration_minutes` no payload (default 30 quando não informado).

**Transições de estado**: nenhuma — `duration_minutes` é metadado descritivo, não tem máquina de estados.

### `tuss_catalog_versions` (modificada por INSERT)

Acrescenta row documentando a versão de catálogo ANS 202501 que serviu como referência da reconciliação odontológica. Não modifica `tuss_codes`.

```sql
INSERT INTO public.tuss_catalog_versions
  (source_ref, content_hash, code_count, notes)
VALUES
  ('ans_official_202501',
   'sha256:reference-only-no-code-import',
   5964,
   'TUSS Tabela 22 oficial v202501 - registrada como referencia da reconciliacao odonto (feature 004). 0 codigos importados; investigacao confirmou que a fonte oficial tem 370 codigos odonto (charlesfgarcia: 380); prefixo 88 nao existe na Tabela 22 oficial.')
ON CONFLICT DO NOTHING;
```

**Rationale do INSERT documental**: Princípio IV exige catálogo versionado e sincronizado. Mesmo sem importar códigos, registrar a versão consultada cria evidência auditável de que a reconciliação foi feita e com qual fonte.

### `appointments_effective` (view — mantida)

A view existente faz `SELECT a.*` de `appointments`, então `duration_minutes` é incluído automaticamente. **Não** precisa de `CREATE OR REPLACE VIEW` nesta migration — a coluna nova flui para a view sem mudança de DDL.

## DTOs (camada de aplicação)

### `AppointmentWeekRow` (consumido pelo `<CalendarView>`)

```ts
type AppointmentWeekRow = {
  id: string
  patientId: string
  patientName: string // descriptografado via RPC ou via join
  doctorId: string
  doctorName: string
  procedureId: string
  procedureLabel: string // display_name ?? tuss_code
  appointmentAt: string // ISO with offset
  durationMinutes: number // COALESCE(duration_minutes, 30)
  effectiveStatus: 'ativo' | 'estornado'
}
```

Status `'concluido'` da spec não é uma coluna persistida hoje em `appointments_effective` (a view só calcula `ativo` vs `estornado`). Para esta feature, mapeamos:

- `effective_status = 'estornado'` → vermelho
- `effective_status = 'ativo'` → azul (sem distinção visual entre "agendado" e "concluído" nesta entrega; ver edge note abaixo)

> **Edge note — "concluído"**: a spec menciona cor verde para status concluído. O domínio atual não tem `concluido` como status persistido em `appointments`. Manter o requisito visual (verde) implementado, mas vinculado a uma fonte de verdade futura — neste plano, `treatment_plan_steps.status='concluido'` quando o atendimento foi realizado dentro de uma etapa de plano. Se essa correlação não estiver disponível para um atendimento avulso, fica em azul. Tarefa de polish (ver tasks.md futuro).

### `DoctorOption` (consumido pelo `<DoctorFilter>`)

```ts
type DoctorOption = {
  id: string
  fullName: string
  active: boolean
}
```

Lista vem de `doctors` filtrada pelo tenant (RLS); inativos retornam ordenados ao final.

## Relacionamentos relevantes

```text
appointments
  ├── patients (patient_id)         → patients.full_name (descriptografada)
  ├── doctors (doctor_id)           → doctors.full_name
  ├── procedures (procedure_id)     → procedures.tuss_code + display_name
  └── tenants (tenant_id)           → RLS isolation
```

A query do calendário faz join único (`patients`, `doctors`, `procedures`) via Supabase select com hint de FK explícito, retornando ~10–60 rows por semana — sem N+1.

## Migration 0053 (resumo executável)

```sql
-- 0053_appointments_duration_and_catalog_version.sql

-- 1) duration_minutes em appointments (NULLABLE para preservar imutabilidade)
ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS duration_minutes INTEGER NULL
    CHECK (duration_minutes IS NULL OR duration_minutes BETWEEN 5 AND 480);

COMMENT ON COLUMN public.appointments.duration_minutes IS
  'Duracao em minutos. NULL em registros pre-feature-004; cliente le com COALESCE(.., 30). Range 5-480.';

-- 2) Registro documental da versao oficial ANS 202501 (referencia da reconciliacao odonto)
INSERT INTO public.tuss_catalog_versions
  (source_ref, content_hash, code_count, notes)
VALUES
  ('ans_official_202501',
   'sha256:reference-only-no-code-import',
   5964,
   'TUSS Tabela 22 oficial v202501 - referencia da reconciliacao odonto (feature 004). Nenhum codigo importado.')
ON CONFLICT DO NOTHING;
```

**Reversibilidade**: `ALTER TABLE ... DROP COLUMN duration_minutes;` em dev. Em prod, manter — coluna NULLABLE não quebra nada e remove perde histórico de novos atendimentos.

## Índices

Os índices existentes em `appointments`:

- `appointments_tenant_at_idx (tenant_id, appointment_at DESC)`
- `appointments_tenant_doctor_at_idx (tenant_id, doctor_id, appointment_at DESC)`

cobrem completamente as queries do calendário (filtragem por tenant + intervalo + opcionalmente doctor). **Sem novos índices nesta feature.**

## RLS

Sem mudanças. Policies existentes em `appointments` (filtro por `tenant_id` derivado do JWT) continuam vigentes para a query nova `listAppointmentsForWeek`.
