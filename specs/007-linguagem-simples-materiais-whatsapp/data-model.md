# Data Model — Feature 007

**Date**: 2026-04-30
**Branch**: `007-linguagem-simples-materiais-whatsapp`

Apenas a Feature 1 (Materiais) introduz mudanças no modelo de dados. Features 2 (WhatsApp) e 3 (Linguagem) **não tocam o banco**.

---

## Entidade: `AppointmentMaterial`

Representa um insumo/material consumido em um atendimento clínico. Snapshot imutável vinculado a um `appointment_id`.

### Tabela: `public.appointment_materials`

| Coluna | Tipo SQL | Constraints | Descrição |
|---|---|---|---|
| `id` | `UUID` | PK, DEFAULT `gen_random_uuid()` | Identificador único |
| `tenant_id` | `UUID` | NOT NULL, FK → `public.tenants(id)` ON DELETE RESTRICT | Clínica dona do registro (RLS scope) |
| `appointment_id` | `UUID` | NOT NULL, FK → `public.appointments(id)` ON DELETE RESTRICT | Atendimento ao qual o material pertence |
| `tuss_code` | `TEXT` | NOT NULL, FK → `public.tuss_codes(code)` ON DELETE RESTRICT | Código TUSS oficial (validado em service como pertencente à tabela 19) |
| `tuss_description` | `TEXT` | NOT NULL, CHECK `length(tuss_description) BETWEEN 1 AND 500` | Snapshot da descrição no momento do INSERT — preserva histórico se o catálogo mudar |
| `quantity` | `INTEGER` | NOT NULL, DEFAULT 1, CHECK `quantity > 0` | Quantidade utilizada (inteiro positivo) |
| `created_by` | `UUID` | NOT NULL, FK → `auth.users(id)` ON DELETE RESTRICT | Ator que registrou |
| `created_at` | `TIMESTAMPTZ` | NOT NULL, DEFAULT `now()` | Momento da inserção (UTC) |

### Constraints adicionais

- **Append-only**: trigger `enforce_appointment_materials_mutation` BEFORE UPDATE OR DELETE rejeita qualquer mutação para roles diferentes de `service_role`/`postgres`/`supabase_admin`. Mensagem: `appointment_materials: append-only. UPDATE/DELETE not permitted.`
- **Tenant consistency**: trigger `check_material_tenant_consistency` BEFORE INSERT verifica que `NEW.tenant_id = (SELECT tenant_id FROM appointments WHERE id = NEW.appointment_id)`. Rejeita inconsistência com erro `MATERIAL_TENANT_MISMATCH`.
- **TUSS table guard**: trigger `check_material_tuss_table` BEFORE INSERT verifica que `NEW.tuss_code` existe em `tuss_codes` com `tuss_table='19'` AND `valid_to IS NULL`. Rejeita com `MATERIAL_TUSS_INVALID` em caso contrário. Reforça FR-002 (apenas tabela 19, apenas códigos vigentes).

### Índices

- `appointment_materials_appointment_idx` ON `appointment_materials (appointment_id)` — caso de uso primário (listar materiais de um atendimento)
- `appointment_materials_tenant_idx` ON `appointment_materials (tenant_id, created_at DESC)` — relatórios futuros e admin lookups
- (PK `id` já tem índice implícito)

### Row-Level Security

```sql
ALTER TABLE public.appointment_materials ENABLE ROW LEVEL SECURITY;

CREATE POLICY appointment_materials_tenant_isolation
  ON public.appointment_materials
  FOR ALL
  TO authenticated
  USING (tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id = public.current_tenant_id());
```

Função `current_tenant_id()` já existe no schema `public` (introduzida em migrations anteriores; lê o `tenant_id` do JWT claim `app_metadata`).

### Trigger de auditoria

```sql
CREATE OR REPLACE FUNCTION public.audit_appointment_materials()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.audit_log (
    tenant_id, actor_user_id, entity_type, entity_id,
    event_type, event_payload, created_at
  ) VALUES (
    NEW.tenant_id, NEW.created_by, 'appointment_material', NEW.id,
    'appointment_material.created',
    jsonb_build_object(
      'appointment_id', NEW.appointment_id,
      'tuss_code', NEW.tuss_code,
      'tuss_description', NEW.tuss_description,
      'quantity', NEW.quantity
    ),
    now()
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER audit_appointment_materials_after_insert
  AFTER INSERT ON public.appointment_materials
  FOR EACH ROW EXECUTE FUNCTION public.audit_appointment_materials();
```

---

## Function: `create_appointment_with_materials`

RPC SQL que executa em transação implícita do PostgreSQL — garante atomicidade entre a criação do atendimento e a inserção dos materiais.

### Assinatura

```sql
CREATE OR REPLACE FUNCTION public.create_appointment_with_materials(
  p_appointment jsonb,  -- payload da row appointments (sem id, gen pelo banco)
  p_materials   jsonb   -- array de {tuss_code, tuss_description, quantity}
)
RETURNS jsonb           -- { appointment_id, materials_count }
LANGUAGE plpgsql
SECURITY INVOKER        -- respeita RLS do chamador
AS $$
DECLARE
  v_appointment_id UUID;
  v_count INTEGER;
  v_tenant_id UUID := (p_appointment->>'tenant_id')::uuid;
  v_actor UUID := (p_appointment->>'created_by')::uuid;
BEGIN
  -- INSERT em appointments com colunas explícitas (lista alinhada ao schema atual)
  INSERT INTO public.appointments (
    tenant_id, patient_id, doctor_id, procedure_id, plan_id,
    source_price_version_id, source_commission_history_id, source_raw_event_id,
    frozen_amount_cents, frozen_commission_bps, appointment_at, source,
    duration_minutes, observacoes
  )
  SELECT
    (p_appointment->>'tenant_id')::uuid,
    (p_appointment->>'patient_id')::uuid,
    (p_appointment->>'doctor_id')::uuid,
    (p_appointment->>'procedure_id')::uuid,
    NULLIF(p_appointment->>'plan_id', '')::uuid,
    NULLIF(p_appointment->>'source_price_version_id', '')::uuid,
    (p_appointment->>'source_commission_history_id')::uuid,
    NULLIF(p_appointment->>'source_raw_event_id', '')::uuid,
    (p_appointment->>'frozen_amount_cents')::int,
    (p_appointment->>'frozen_commission_bps')::int,
    (p_appointment->>'appointment_at')::timestamptz,
    p_appointment->>'source',
    NULLIF(p_appointment->>'duration_minutes', '')::int,
    p_appointment->>'observacoes'
  RETURNING id INTO v_appointment_id;

  -- INSERT em appointment_materials para cada item do array
  INSERT INTO public.appointment_materials (
    tenant_id, appointment_id, tuss_code, tuss_description, quantity, created_by
  )
  SELECT
    v_tenant_id,
    v_appointment_id,
    (item->>'tuss_code')::text,
    (item->>'tuss_description')::text,
    COALESCE((item->>'quantity')::int, 1),
    v_actor
  FROM jsonb_array_elements(p_materials) AS item;

  GET DIAGNOSTICS v_count = ROW_COUNT;

  RETURN jsonb_build_object(
    'appointment_id', v_appointment_id,
    'materials_count', v_count
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_appointment_with_materials(jsonb, jsonb)
  TO authenticated;
```

### Garantias

- **Atomicidade**: se qualquer INSERT falhar (FK violada, trigger rejeitar, quantity ≤ 0), a transação inteira é desfeita. Nem appointment nem materials persistem.
- **Tenant safety**: o `tenant_id` vem do payload do appointment; o trigger `check_material_tenant_consistency` valida que cada material aponta para esse mesmo tenant.
- **Auditoria**: tanto o trigger de audit do `appointments` (já existente — migration 0013) quanto o de `appointment_materials` disparam normalmente.

### Quando usar

- `POST /api/atendimentos/manual` quando `body.materiais` não é vazio.
- `POST /api/treatment-steps/.../finish` (futuro — fora desta feature) quando finalizar etapa com materiais.

Quando `materiais` vem vazio ou ausente, **NÃO chamar o RPC** — manter o INSERT direto atual em `createAppointmentManually`. Isto evita regressão no caminho mais comum.

---

## Function: `attach_materials_to_appointment` (helper para o endpoint POST /api/atendimentos/[id]/materiais)

Para o endpoint que anexa materiais a um atendimento já existente:

```sql
CREATE OR REPLACE FUNCTION public.attach_materials_to_appointment(
  p_appointment_id uuid,
  p_materials jsonb
)
RETURNS jsonb           -- { materials: [...inseridos com id e created_at] }
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_tenant_id UUID;
  v_actor UUID := auth.uid();  -- pega do JWT claim
  v_status TEXT;
  v_inserted jsonb;
BEGIN
  -- Verifica que o atendimento pertence ao tenant do chamador (via RLS)
  -- e que não está cancelado (reversed)
  SELECT a.tenant_id INTO v_tenant_id
  FROM public.appointments a
  WHERE a.id = p_appointment_id;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'APPOINTMENT_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;

  -- Bloqueia anexação a atendimento cancelado
  IF EXISTS (
    SELECT 1 FROM public.appointment_reversals r
    WHERE r.appointment_id = p_appointment_id
  ) THEN
    RAISE EXCEPTION 'APPOINTMENT_REVERSED' USING ERRCODE = 'P0001';
  END IF;

  -- INSERT e retorna as rows inseridas
  WITH inserted AS (
    INSERT INTO public.appointment_materials (
      tenant_id, appointment_id, tuss_code, tuss_description, quantity, created_by
    )
    SELECT
      v_tenant_id,
      p_appointment_id,
      (item->>'tuss_code')::text,
      (item->>'tuss_description')::text,
      COALESCE((item->>'quantity')::int, 1),
      v_actor
    FROM jsonb_array_elements(p_materials) AS item
    RETURNING id, tuss_code, tuss_description, quantity, created_at
  )
  SELECT jsonb_agg(jsonb_build_object(
    'id', id,
    'tuss_code', tuss_code,
    'tuss_description', tuss_description,
    'quantity', quantity,
    'created_at', created_at
  )) INTO v_inserted FROM inserted;

  RETURN jsonb_build_object('materials', COALESCE(v_inserted, '[]'::jsonb));
END;
$$;

GRANT EXECUTE ON FUNCTION public.attach_materials_to_appointment(uuid, jsonb)
  TO authenticated;
```

### Por que separar em duas RPCs

- `create_appointment_with_materials` — fluxo atômico de criação (handler `/api/atendimentos/manual`).
- `attach_materials_to_appointment` — fluxo de anexação a atendimento já existente (handler `/api/atendimentos/[id]/materiais`).

Os dois fluxos têm contratos e verificações distintos. Tentar unificar em uma única RPC com flags polimórficas piora legibilidade sem ganho.

---

## Relacionamentos

```text
tenants (1) ──┬── (N) appointments
              │              │
              │              │ (1)
              │              │
              │              ↓ (N)
              └── (N) appointment_materials
                              │
                              │ (N)
                              ↓ (1)
                          tuss_codes (catálogo global, tabela 19)

appointment_materials (N) ─→ (1) auth.users   [created_by]
```

Cardinalidade e regras:
- Um atendimento pode ter zero ou muitos materiais.
- Um material pertence a exatamente um atendimento (FK NOT NULL).
- Material e atendimento devem compartilhar `tenant_id` (trigger).
- O catálogo TUSS é referência global (sem tenant) — qualquer clínica pode usar qualquer código vigente da tabela 19.

---

## State / Transitions

`appointment_materials` não tem máquina de estados — é append-only puro. A "remoção" só existe no estado local da UI antes do save (botão X remove da lista do componente; nunca chega ao banco).

Atendimentos cancelados (com row em `appointment_reversals`) **não podem** receber novos materiais via API regular (validado pelo `attach_materials_to_appointment` RPC). Materiais já existentes permanecem (auditoria histórica).

---

## Migration Order — `0061_appointment_materials.sql`

Ordem dentro do arquivo:
1. `CREATE TABLE public.appointment_materials (...)` com PK, FKs, CHECKs.
2. `CREATE INDEX` x2.
3. `ALTER TABLE ... ENABLE ROW LEVEL SECURITY`.
4. `CREATE POLICY appointment_materials_tenant_isolation`.
5. Função `enforce_appointment_materials_mutation()` + trigger BEFORE UPDATE/DELETE.
6. Função `check_material_tenant_consistency()` + trigger BEFORE INSERT.
7. Função `check_material_tuss_table()` + trigger BEFORE INSERT.
8. Função `audit_appointment_materials()` + trigger AFTER INSERT.
9. Função `create_appointment_with_materials(jsonb, jsonb)` + GRANT EXECUTE.
10. Função `attach_materials_to_appointment(uuid, jsonb)` + GRANT EXECUTE.

A migration é **completamente reversível** em dev (basta `DROP TABLE`, `DROP FUNCTION`, `DROP TRIGGER`); em prod, segue a regra do projeto (sem rollback automático de schema com dados).
