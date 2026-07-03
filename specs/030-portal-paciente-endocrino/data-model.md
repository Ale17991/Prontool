# Phase 1 — Data Model: Portal do Paciente + Endocrinologia

Migration: **`0113_patient_portal_measurements.sql`** (0112 reservada pelo TISS/029). Padrões: PK UUID, `tenant_id` FK→tenants ON DELETE CASCADE, RLS, append-only via `enforce_append_only_columns`, valores numéricos como `NUMERIC` (clínico, não monetário), timestamps UTC. Limpeza de testes coberta pelo `TRUNCATE ... tenants CASCADE` (tabelas FK→tenants).

## 1. `patient_measurements` (motor de medições — append-only)

| Coluna               | Tipo                                      | Regra                   |
| -------------------- | ----------------------------------------- | ----------------------- |
| `id`                 | UUID PK                                   |                         |
| `tenant_id`          | UUID FK tenants                           | RLS                     |
| `patient_id`         | UUID FK patients ON DELETE CASCADE        | escopo                  |
| `metric_type`        | TEXT FK→patient_metric_types(metric_type) | ex.: `hba1c`            |
| `value`              | NUMERIC NOT NULL                          | valor medido            |
| `unit`               | TEXT NOT NULL                             | ex.: `%`, `mg/dL`, `cm` |
| `measured_at`        | DATE NOT NULL                             | data da medição         |
| `notes`              | TEXT NULL                                 |                         |
| `created_at`         | TIMESTAMPTZ default now()                 |                         |
| `created_by_user_id` | UUID FK auth.users                        | quem registrou (staff)  |

- **Append-only** (`enforce_append_only_columns('')` — bloqueia UPDATE/DELETE). Correção = nova linha.
- **Coerência (BEFORE INSERT)**: `metric_type` existe em `patient_metric_types`; `value` dentro de `[min_plausible, max_plausible]` do tipo → senão exceção clara.
- Índice: `(tenant_id, patient_id, metric_type, measured_at DESC)`.
- **RLS**: leitura staff `tenant_id = jwt_tenant_id()`; escrita `jwt_role() IN ('admin','profissional_saude')`. (O paciente lê via service-role escopado, não por RLS.)

## 2. `patient_metric_types` (catálogo/config — seed)

| Coluna                            | Tipo                 | Regra                 |
| --------------------------------- | -------------------- | --------------------- |
| `metric_type`                     | TEXT PK              | ex.: `glicemia_jejum` |
| `label`                           | TEXT                 | rótulo PT-BR          |
| `unit`                            | TEXT                 | unidade padrão        |
| `min_plausible` / `max_plausible` | NUMERIC              | faixa de validação    |
| `specialty`                       | TEXT                 | ex.: `endocrino`      |
| `display_order`                   | INT                  | ordem na UI           |
| `active`                          | BOOLEAN default true |                       |

- Read-only de referência (sem `tenant_id` — catálogo global). RLS: SELECT `true` para autenticado; append-only.
- **Seed endócrino**: `glicemia_jejum` (mg/dL,20–600), `hba1c` (%,2–20), `circunferencia_abdominal` (cm,30–250), `colesterol_total` (mg/dL,50–800), `ldl` (mg/dL,10–600), `hdl` (mg/dL,5–200), `triglicerides` (mg/dL,20–5000). _Faixas a revisar clinicamente nas tasks._

## 3. `patient_portal_access_log` (auditoria de acesso — append-only)

| Coluna       | Tipo                                           | Regra                    |
| ------------ | ---------------------------------------------- | ------------------------ |
| `id`         | UUID PK                                        |                          |
| `tenant_id`  | UUID FK tenants                                |                          |
| `patient_id` | UUID FK patients NULL                          | nulo em falha de login   |
| `action`     | TEXT CHECK in ('login_ok','login_fail','view') |                          |
| `ip_hash`    | TEXT                                           | nunca IP em claro (LGPD) |
| `user_agent` | TEXT NULL                                      |                          |
| `created_at` | TIMESTAMPTZ default now()                      |                          |

- Append-only. RLS: leitura staff por tenant; escrita só service-role (server-side).
- Índice: `(tenant_id, created_at DESC)`.

## 4. ALTER `public_booking_rate_limits`

- Expandir o CHECK de `action` para incluir **`'patient_login'`** (mantendo os valores existentes). Reusa `checkRateLimit`/`bumpRateLimit`/`hashIpForTenant`.

## 5. RPC `patient_portal_verify_login` (SECURITY DEFINER)

```
patient_portal_verify_login(p_slug TEXT, p_cpf TEXT, p_birthdate TEXT, p_key TEXT)
  RETURNS TABLE (patient_id UUID, tenant_id UUID, full_name TEXT)
```

- Resolve `tenant_id` pelo slug (em `tenant_clinic_profile`); acha paciente por CPF (decifra `cpf_enc` com `p_key`), confere `birth_date_enc` (comparando só dígitos), exclui `anonymized_at IS NOT NULL`. Retorna vazio se não casar (o caller trata como falha **genérica**).
- `SECURITY DEFINER`, grant só a `service_role`. Não usado por RLS.

## Reuso (sem schema change)

- **`vital_signs`** (0052): `weight_grams`, `height_cm`, `bmi`, PA — fonte da evolução de peso/IMC. Leitura via `listVitalSigns` escopada ao paciente.
- **`appointments`** — histórico (data, profissional), sem campos financeiros expostos ao paciente.
- **`patients`** — PII cifrada; nome via `get_patient_for_tenant`.
- **`tenant_clinic_profile`** — slug → clínica (via `public_booking_resolve_slug`/dentro da RPC de login).

## Máquina de estados / fluxo de sessão

```
[/paciente/slug] login (CPF+nasc) → rate-limit OK → verify_login casa →
   set cookie HMAC {patientId,tenantId,exp~30min} → /paciente/slug/painel (read-only)
falha → log login_fail + bump rate-limit + mensagem genérica
expira → volta ao login
```

## Triggers

- `enforce_append_only_columns('')` em `patient_measurements`, `patient_portal_access_log` (e `enforce_append_only` em `patient_metric_types`).
- Coerência BEFORE INSERT em `patient_measurements` (tipo existe + faixa plausível).
- `log_audit_event` (camada de app) ao registrar medição (staff).
