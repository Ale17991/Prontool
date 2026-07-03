# Data Model — 017 Public Booking

**Phase 1 output.** Entidades novas + alterações em entidades existentes, com relacionamentos, validações e funções DB.

---

## Visão geral

```
tenant_clinic_profile  (existente, ALTER +5 colunas)
        │
        │ 1:N
        ▼
public_booking_doctors  (NOVA)
        │
        │ 1:N
        ▼
public_booking_doctor_procedures  (NOVA, 1:N médico→procedimento)
        │
        │ N:1
        ▼
procedures  (existente, sem mudança)

doctors  (existente, sem mudança) ───┐
                                     │ N:1
                                     ▼
                            public_booking_doctors

appointments  (existente, sem nova coluna) ◄── audit_log (event_type='public_booking_created')

public_booking_tokens  (NOVA) ──► appointments

public_booking_rate_limits  (NOVA, append-only com TTL)

notifications  (existente, CHECK constraint expandido)
```

---

## 1. ALTER: `tenant_clinic_profile`

Adicionar 5 colunas para suportar a feature pública. Tabela existente; demais campos preservados.

| Coluna                             | Tipo    | Constraint                                                                                                    | Default |
| ---------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------- | ------- |
| `public_booking_slug`              | TEXT    | UNIQUE NULL; validado por regex `^[a-z0-9][a-z0-9-]{2,31}$` (3-32 chars, começa com letra/dígito, kebab-case) | NULL    |
| `public_booking_enabled`           | BOOLEAN | NOT NULL                                                                                                      | FALSE   |
| `public_booking_min_hours_advance` | INT     | NOT NULL CHECK ≥ 0 AND ≤ 168 (uma semana)                                                                     | 24      |
| `public_booking_max_days_advance`  | INT     | NOT NULL CHECK ≥ 1 AND ≤ 180 (6 meses)                                                                        | 30      |
| `public_booking_cancel_min_hours`  | INT     | NOT NULL CHECK ≥ 0 AND ≤ 168                                                                                  | 6       |

**Constraint adicional**: `public_booking_enabled = TRUE` requer `public_booking_slug IS NOT NULL` (CHECK).

**RLS adicional** (para o slug ser legível por `anon`):

```sql
CREATE POLICY public_slug_read ON public.tenant_clinic_profile
  FOR SELECT TO anon
  USING (public_booking_enabled = TRUE);
```

Esta policy expõe **apenas** os campos lidos pela RPC `public_booking_resolve_slug` — RPC valida o que pode retornar (não retorna `cnpj`, `endereço completo` etc.).

---

## 2. NOVA: `public_booking_doctors`

Médicos que aparecem no link público de cada tenant. **1:N** com `tenant_clinic_profile`; vincula a `doctors` existente.

| Coluna               | Tipo        | Constraint             | Notas                                                                                |
| -------------------- | ----------- | ---------------------- | ------------------------------------------------------------------------------------ |
| `tenant_id`          | UUID        | NOT NULL               | FK → tenants(id)                                                                     |
| `doctor_id`          | UUID        | NOT NULL               | FK → doctors(id) com (tenant_id, doctor_id)                                          |
| `display_order`      | INT         | NOT NULL               | DEFAULT 0; ORDER BY this ASC, then doctor name                                       |
| `bio`                | TEXT        | NULL                   | CHECK length ≤ 500. Texto curto público (ex.: "Ortopedista, 15 anos de experiência") |
| `available_weekdays` | SMALLINT[]  | NOT NULL               | DEFAULT '{1,2,3,4,5}' (seg-sex); valores 0-6 (dom-sáb); CHECK 1 ≤ array_length ≤ 7   |
| `available_from`     | TIME        | NOT NULL               | DEFAULT '08:00'                                                                      |
| `available_until`    | TIME        | NOT NULL               | DEFAULT '18:00'; CHECK > available_from                                              |
| `lunch_break_from`   | TIME        | NULL                   | Se NOT NULL, lunch_break_until também não pode ser NULL                              |
| `lunch_break_until`  | TIME        | NULL                   | CHECK > lunch_break_from quando NOT NULL                                             |
| `created_at`         | TIMESTAMPTZ | NOT NULL DEFAULT now() |                                                                                      |
| `updated_at`         | TIMESTAMPTZ | NOT NULL DEFAULT now() | trigger atualiza                                                                     |

**PK**: `(tenant_id, doctor_id)`.

**Índice**: `idx_pb_doctors_tenant_order` em `(tenant_id, display_order)`.

**Audit**: trigger `enforce_append_only_pb_doctors_audit` registra mudanças via `log_audit_event`.

**RLS**: leitura para `anon` apenas quando o tenant tem `public_booking_enabled=TRUE`. Escrita só via app server (`requireRole(['admin', 'recepcionista'])`).

---

## 3. NOVA: `public_booking_doctor_procedures`

Procedimentos publicados **por médico** (relação 1:N — clarification Q1). Cada `(tenant_id, doctor_id, procedure_id)` é registro único; o mesmo procedimento pode existir publicado para vários médicos com `display_name` e `duration_minutes` distintos.

| Coluna             | Tipo        | Constraint             | Notas                                                                                       |
| ------------------ | ----------- | ---------------------- | ------------------------------------------------------------------------------------------- |
| `tenant_id`        | UUID        | NOT NULL               | FK                                                                                          |
| `doctor_id`        | UUID        | NOT NULL               | FK                                                                                          |
| `procedure_id`     | UUID        | NOT NULL               | FK → procedures(id)                                                                         |
| `display_name`     | TEXT        | NOT NULL               | CHECK length 3-100; nome amigável ao paciente (ex.: "Consulta clínica" em vez do nome TUSS) |
| `duration_minutes` | INT         | NOT NULL               | CHECK ≥ 5 AND ≤ 480 (entre 5min e 8h)                                                       |
| `display_order`    | INT         | NOT NULL DEFAULT 0     |                                                                                             |
| `created_at`       | TIMESTAMPTZ | NOT NULL DEFAULT now() |                                                                                             |

**PK**: `(tenant_id, doctor_id, procedure_id)`.

**Constraint adicional**: `(tenant_id, doctor_id)` em `public_booking_doctor_procedures` MUST referenciar uma linha em `public_booking_doctors` — i.e., só pode publicar procedimento de médico que esteja publicado. FK composta + ON DELETE CASCADE.

**Índice**: `idx_pb_doctor_procs_lookup` em `(tenant_id, doctor_id, display_order)`.

**RLS**: leitura para `anon` via JOIN com `tenant_clinic_profile.public_booking_enabled`. Escrita só admin/recepcionista.

---

## 4. NOVA: `public_booking_tokens`

Tokens únicos para cancelamento via link (sem login).

| Coluna           | Tipo        | Constraint                   | Notas                                                                                          |
| ---------------- | ----------- | ---------------------------- | ---------------------------------------------------------------------------------------------- |
| `id`             | UUID        | PK DEFAULT gen_random_uuid() |                                                                                                |
| `tenant_id`      | UUID        | NOT NULL                     | FK                                                                                             |
| `appointment_id` | UUID        | NOT NULL                     | FK → appointments(id), UNIQUE constraint por action                                            |
| `token_hash`     | TEXT        | NOT NULL UNIQUE              | SHA-256 hex do token raw                                                                       |
| `action`         | TEXT        | NOT NULL                     | CHECK IN ('cancel', 'reschedule'). MVP usa apenas 'cancel'; 'reschedule' reservado para fase 2 |
| `created_at`     | TIMESTAMPTZ | NOT NULL DEFAULT now()       |                                                                                                |
| `expires_at`     | TIMESTAMPTZ | NOT NULL                     | DEFAULT now() + interval '30 days'                                                             |
| `used_at`        | TIMESTAMPTZ | NULL                         | Marca quando o token foi efetivamente usado                                                    |

**Índices**:

- `idx_pb_tokens_hash` UNIQUE em `(token_hash)`
- `idx_pb_tokens_appointment` em `(appointment_id, action)` — UNIQUE em `(appointment_id, action)` evita 2 tokens cancel ativos para mesmo appointment
- `idx_pb_tokens_expires` em `(expires_at)` — para limpeza periódica

**Cleanup**: cron job semanal `DELETE FROM public_booking_tokens WHERE expires_at < now() - INTERVAL '90 days'`.

**RLS**: sem RLS — acesso só via funções server-side; `GRANT SELECT, INSERT, UPDATE` para `service_role`. `anon` **não** tem GRANT.

---

## 5. NOVA: `public_booking_rate_limits`

Append-only com TTL para rate limit por IP-hash.

| Coluna       | Tipo        | Constraint                   | Notas                               |
| ------------ | ----------- | ---------------------------- | ----------------------------------- |
| `id`         | UUID        | PK DEFAULT gen_random_uuid() |                                     |
| `tenant_id`  | UUID        | NOT NULL                     | FK                                  |
| `ip_hash`    | TEXT        | NOT NULL                     | SHA-256 hex de `${ip}:${tenant_id}` |
| `action`     | TEXT        | NOT NULL                     | CHECK IN ('view_slots', 'submit')   |
| `created_at` | TIMESTAMPTZ | NOT NULL DEFAULT now()       |                                     |

**Índice**: `idx_pb_rate_lookup` em `(ip_hash, tenant_id, action, created_at)` — query principal é `WHERE ip_hash=$1 AND tenant_id=$2 AND action=$3 AND created_at > now() - interval`.

**Cleanup**: cron job a cada hora `DELETE FROM public_booking_rate_limits WHERE created_at < now() - INTERVAL '7 days'`. Implementar via `pg_cron` ou Supabase Scheduled Function.

**RLS**: sem leitura para `anon` ou `authenticated`. INSERT via `service_role` (chamado pelo server).

---

## 6. ALTER: `notifications` (expansão de CHECK constraint)

Adicionar `'public_booking'` ao enum válido de `type`.

```sql
ALTER TABLE public.notifications DROP CONSTRAINT notifications_type_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN (
    'atendimento',
    'tarefa',
    'tarefa_atrasada',
    'aniversarios_mes',
    'public_booking'
  ));
```

**Componente `notification-item.tsx`** receberá mapping novo (não é mudança de schema — UI):

```typescript
COLOR_BY_TYPE['public_booking'] = 'text-info-text bg-info-bg'
ICON_BY_TYPE['public_booking'] = CalendarPlus // de lucide-react
```

**`reference_id` / `reference_type`**: aponta para `appointment.id` com `reference_type='appointment'`. `reference_key` = `appointment_id` (deduplicação — mesmo appointment não gera 2 notifications para mesmo user).

---

## 7. NOVA: função `public_booking_resolve_slug`

Retorna dados públicos da clínica para o landing page.

```sql
CREATE OR REPLACE FUNCTION public.public_booking_resolve_slug(p_slug TEXT)
RETURNS TABLE (
  tenant_id UUID,
  display_name TEXT,
  logo_path TEXT,
  phone TEXT,
  address_line TEXT,
  min_hours_advance INT,
  max_days_advance INT,
  cancel_min_hours INT
) LANGUAGE plpgsql SECURITY INVOKER
SET search_path = public, pg_temp AS $$
BEGIN
  RETURN QUERY
    SELECT
      tcp.tenant_id,
      tcp.display_name,
      tcp.logo_path,
      tcp.phone,
      tcp.address_line,
      tcp.public_booking_min_hours_advance,
      tcp.public_booking_max_days_advance,
      tcp.public_booking_cancel_min_hours
    FROM public.tenant_clinic_profile tcp
    WHERE tcp.public_booking_slug = p_slug
      AND tcp.public_booking_enabled = TRUE
    LIMIT 1;
END $$;

REVOKE ALL ON FUNCTION public.public_booking_resolve_slug(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_booking_resolve_slug(TEXT) TO anon, authenticated;
```

**SECURITY INVOKER** (não DEFINER) pois retorna apenas campos não-sensíveis e RLS permite a leitura para `anon` via policy `public_slug_read`. Defesa em profundidade: RLS filtra + função encapsula.

---

## 8. NOVA: função `public_booking_slots`

Gera slots disponíveis para um (médico, procedimento) na janela permitida.

```sql
CREATE OR REPLACE FUNCTION public.public_booking_slots(
  p_slug TEXT,
  p_doctor_id UUID,
  p_procedure_id UUID,
  p_from DATE,
  p_to DATE
)
RETURNS TABLE (
  slot_start TIMESTAMPTZ,
  slot_end TIMESTAMPTZ
) LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
DECLARE
  v_tenant_id UUID;
  v_min_h INT;
  v_max_d INT;
  v_tz TEXT;
  v_avail_weekdays SMALLINT[];
  v_avail_from TIME;
  v_avail_until TIME;
  v_lunch_from TIME;
  v_lunch_until TIME;
  v_duration_minutes INT;
  v_now TIMESTAMPTZ := now();
  v_start TIMESTAMPTZ;
  v_end TIMESTAMPTZ;
  v_day DATE;
BEGIN
  -- 1. Resolve tenant + políticas (também valida slug habilitado)
  SELECT
    tcp.tenant_id,
    tcp.public_booking_min_hours_advance,
    tcp.public_booking_max_days_advance,
    tcp.timezone
  INTO v_tenant_id, v_min_h, v_max_d, v_tz
  FROM public.tenant_clinic_profile tcp
  WHERE tcp.public_booking_slug = p_slug
    AND tcp.public_booking_enabled = TRUE;

  IF v_tenant_id IS NULL THEN
    RETURN;  -- tenant não encontrado ou disabled
  END IF;

  -- 2. Resolve médico + janela (também valida que médico está publicado)
  SELECT
    pbd.available_weekdays,
    pbd.available_from,
    pbd.available_until,
    pbd.lunch_break_from,
    pbd.lunch_break_until
  INTO v_avail_weekdays, v_avail_from, v_avail_until, v_lunch_from, v_lunch_until
  FROM public.public_booking_doctors pbd
  WHERE pbd.tenant_id = v_tenant_id
    AND pbd.doctor_id = p_doctor_id;

  IF v_avail_weekdays IS NULL THEN
    RETURN;  -- médico não publicado
  END IF;

  -- 3. Resolve procedimento + duração (também valida que está publicado pro médico)
  SELECT pbdp.duration_minutes
  INTO v_duration_minutes
  FROM public.public_booking_doctor_procedures pbdp
  WHERE pbdp.tenant_id = v_tenant_id
    AND pbdp.doctor_id = p_doctor_id
    AND pbdp.procedure_id = p_procedure_id;

  IF v_duration_minutes IS NULL THEN
    RETURN;  -- procedimento não publicado pro médico
  END IF;

  -- 4. Clamp janela [agora + min_hours, agora + max_days]
  v_start := GREATEST((p_from::TIMESTAMPTZ AT TIME ZONE v_tz), v_now + (v_min_h || ' hours')::INTERVAL);
  v_end := LEAST((p_to::TIMESTAMPTZ AT TIME ZONE v_tz + INTERVAL '1 day'), v_now + (v_max_d || ' days')::INTERVAL);

  -- 5. Para cada dia no intervalo, gerar slots
  v_day := v_start::DATE;
  WHILE v_day <= v_end::DATE LOOP
    -- 5a. Verifica dia da semana
    IF EXTRACT(DOW FROM v_day)::SMALLINT = ANY(v_avail_weekdays) THEN
      -- 5b. Gerar slots da manhã + tarde (subtraindo lunch break)
      -- ... (loop interno gera tstzranges de duração v_duration_minutes,
      --      subtrai schedule_blocks e appointment_slot_locks daquele tenant+doctor,
      --      retorna apenas slots livres)
      RETURN QUERY
        WITH candidate_slots AS (
          SELECT
            gs AS slot_start,
            gs + (v_duration_minutes || ' minutes')::INTERVAL AS slot_end
          FROM generate_series(
            (v_day::TEXT || ' ' || v_avail_from::TEXT)::TIMESTAMPTZ AT TIME ZONE v_tz,
            (v_day::TEXT || ' ' || v_avail_until::TEXT)::TIMESTAMPTZ AT TIME ZONE v_tz - (v_duration_minutes || ' minutes')::INTERVAL,
            (v_duration_minutes || ' minutes')::INTERVAL
          ) AS gs
        ),
        filtered AS (
          SELECT cs.slot_start, cs.slot_end
          FROM candidate_slots cs
          WHERE cs.slot_start >= v_start
            AND cs.slot_end <= v_end
            AND (
              v_lunch_from IS NULL
              OR cs.slot_end <= (v_day::TEXT || ' ' || v_lunch_from::TEXT)::TIMESTAMPTZ AT TIME ZONE v_tz
              OR cs.slot_start >= (v_day::TEXT || ' ' || v_lunch_until::TEXT)::TIMESTAMPTZ AT TIME ZONE v_tz
            )
            -- subtrair schedule_blocks
            AND NOT EXISTS (
              SELECT 1 FROM public.schedule_blocks sb
              WHERE sb.tenant_id = v_tenant_id
                AND sb.doctor_id = p_doctor_id
                AND sb.deleted_at IS NULL
                AND sb.block_date = v_day
                AND (
                  sb.all_day = TRUE
                  OR (cs.slot_start::TIME < sb.end_time AND cs.slot_end::TIME > sb.start_time)
                )
            )
            -- subtrair appointment_slot_locks
            AND NOT EXISTS (
              SELECT 1 FROM public.appointment_slot_locks asl
              WHERE asl.tenant_id = v_tenant_id
                AND asl.doctor_id = p_doctor_id
                AND asl.slot_range && tstzrange(cs.slot_start, cs.slot_end)
            )
        )
        SELECT slot_start, slot_end FROM filtered ORDER BY slot_start;
    END IF;
    v_day := v_day + INTERVAL '1 day';
  END LOOP;
END $$;

REVOKE ALL ON FUNCTION public.public_booking_slots(TEXT, UUID, UUID, DATE, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_booking_slots(TEXT, UUID, UUID, DATE, DATE) TO anon, authenticated;
```

**Pegadinhas**:

- `EXTRACT(DOW)`: 0=domingo, 6=sábado. Conferir match com `available_weekdays`.
- `AT TIME ZONE`: aplica conversão correta de horário local da clínica para `TIMESTAMPTZ`.
- `generate_series` com interval — performance OK para 30 dias × ~20 slots/dia = 600 candidatos.

---

## 9. NOVA: função `public_booking_find_patient_by_cpf`

Helper privado (chamado **apenas** pelo `create-booking.ts` server-side via service-role), análoga a `list_patients_for_tenant` mas filtrada por CPF e retornando 0 ou 1 linha.

```sql
CREATE OR REPLACE FUNCTION public.public_booking_find_patient_by_cpf(
  p_tenant_id UUID,
  p_cpf TEXT,
  p_key TEXT
) RETURNS TABLE (
  patient_id UUID,
  full_name TEXT,
  email TEXT,
  phone TEXT
) LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp, extensions AS $$
BEGIN
  RETURN QUERY
    SELECT
      p.id,
      extensions.pgp_sym_decrypt(p.full_name_enc, p_key)::TEXT,
      extensions.pgp_sym_decrypt(p.email_enc, p_key)::TEXT,
      extensions.pgp_sym_decrypt(p.phone_enc, p_key)::TEXT
    FROM public.patients p
    WHERE p.tenant_id = p_tenant_id
      AND p.anonymized_at IS NULL
      AND extensions.pgp_sym_decrypt(p.cpf_enc, p_key) = p_cpf
    LIMIT 1;
END $$;

REVOKE ALL ON FUNCTION public.public_booking_find_patient_by_cpf(UUID, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_booking_find_patient_by_cpf(UUID, TEXT, TEXT) TO service_role;
```

**Restrição crítica**: `GRANT EXECUTE TO service_role` apenas — `anon` e `authenticated` **NÃO** podem chamar (impede ataque via JWT direto sem app). A chave `p_key` vem da env do servidor.

---

## 10. Lifecycle e state transitions

### Appointment criado publicamente

1. **Cria via `create-booking.ts`**: `INSERT INTO appointments (..., status='agendado', actor_user_id=NULL)`.
2. **Trigger existente** popula `appointment_slot_locks`.
3. **Token criado** em `public_booking_tokens` (action='cancel', expira em 30d).
4. **Audit log** registra `event_type='public_booking_created'`.
5. **Notification** criada para admin(s).

### Cancelamento via token

1. Validate token (hash + expiração + not used).
2. `UPDATE appointments SET status='cancelado' WHERE id=$1 AND status='agendado'`.
3. **Liberar slot lock**: opção A `DELETE FROM appointment_slot_locks WHERE appointment_id=$1`; opção B se houver trigger conflitante `UPDATE` com `released_at`. Decisão durante implementação (research §13).
4. `UPDATE public_booking_tokens SET used_at=now()`.
5. Audit `event_type='public_booking_cancelled'`.
6. Notification para admin tipo `public_booking` indicando "cancelado".
7. (Opcional) Email para o paciente confirmando cancelamento.

### Estados do appointment público

`agendado` → (via cancel link) `cancelado` (ou estornado conforme política).

`agendado` → (consulta acontece) → `ativo` (igual fluxo interno).

Sem novos estados específicos para a feature pública — reusa enum existente.

---

## 11. Resumo de migrations

**Migration única `0084_public_booking.sql`** contém:

1. ALTER `tenant_clinic_profile` (+5 colunas + CHECK + RLS policy)
2. CREATE `public_booking_doctors`
3. CREATE `public_booking_doctor_procedures`
4. CREATE `public_booking_tokens`
5. CREATE `public_booking_rate_limits`
6. ALTER `notifications.type` CHECK constraint
7. CREATE FUNCTION `public_booking_resolve_slug`
8. CREATE FUNCTION `public_booking_slots`
9. CREATE FUNCTION `public_booking_find_patient_by_cpf`
10. Triggers de auditoria nas novas tabelas
11. GRANTs explícitos para `anon`, `authenticated`, `service_role`

**Reversibilidade**: todas as operações são `CREATE ... IF NOT EXISTS` ou `ALTER ... ADD`. Migration é additive. Drop migration (se necessário em dev) inverte as criações na ordem reversa.

---

## 12. Entidades em resumo

| Entidade                             | Tipo               | Quantidade |
| ------------------------------------ | ------------------ | ---------- |
| `tenant_clinic_profile`              | ALTER (+5 colunas) | 1          |
| `public_booking_doctors`             | NOVA tabela        | 1          |
| `public_booking_doctor_procedures`   | NOVA tabela        | 1          |
| `public_booking_tokens`              | NOVA tabela        | 1          |
| `public_booking_rate_limits`         | NOVA tabela        | 1          |
| `notifications`                      | ALTER CHECK        | 1          |
| `public_booking_resolve_slug`        | NOVA função        | 1          |
| `public_booking_slots`               | NOVA função        | 1          |
| `public_booking_find_patient_by_cpf` | NOVA função        | 1          |

Total: 9 mudanças DB na migration 0084.
