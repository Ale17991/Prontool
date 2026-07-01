# Contract — Atendimento particular

**Locais**: `src/app/api/atendimentos/manual/route.ts` (modificado), `src/app/api/pacientes/[id]/etapas/route.ts` (modificado), `src/lib/core/appointments/create-manual.ts` (modificado), trigger SQL `enforce_appointment_preconditions` v2 em 0059.

## Payloads

### POST /api/atendimentos/manual

```ts
const bodySchema = z.object({
  patient_id: z.string().uuid(),
  doctor_id: z.string().uuid(),
  procedure_id: z.string().uuid(),
  plan_id: z.string().uuid().nullable(), // nullable a partir desta feature
  appointment_at: z.string().datetime(),
  amount_cents_override: z.number().int().min(0).optional(),
  duration_minutes: z.number().int().min(5).max(480).optional(),
  observacoes: z.string().trim().max(500).optional(),
})
```

**Comportamento**:

- `plan_id = null` → atendimento particular. Servidor:
  - **Não** chama `resolvePrice` (pula busca em `price_versions`).
  - Usa `procedure.default_amount_cents` como sugestão; se `amount_cents_override` veio no payload, usa override; se nenhum dos dois, falha com `PARTICULAR_AMOUNT_REQUIRED`.
  - Insere com `plan_id = NULL` e `source_price_version_id = NULL`.
- `plan_id` UUID → fluxo atual (busca price_versions).

### POST /api/pacientes/[id]/etapas

```ts
const createSchema = z.object({
  procedure_id: z.string().uuid(),
  doctor_id: z.string().uuid(),
  health_plan_id: z.string().uuid().nullable(), // nullable indica particular
  title: z.string().min(1).max(200),
  notes: z.string().max(2000).optional().nullable(),
  scheduled_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  start_time: z.string().regex(/^\d{2}:\d{2}$/),
  end_time: z.string().regex(/^\d{2}:\d{2}$/),
  amount_cents_override: z.number().int().min(0).optional(),
})
```

A função RPC `create_step_with_appointment` (criada na feature 005, ajustada na 0056) precisa **aceitar `p_plan_id NULL`**. Atualização na 0059:

```sql
-- Trecho relevante:
INSERT INTO public.appointments (..., plan_id, ...) VALUES (..., p_plan_id, ...);  -- ja aceita null
INSERT INTO public.treatment_plan_steps (..., plan_id, ...) VALUES (..., p_plan_id, ...);  -- ja nullable
```

Sem mudança no RPC — o `ALTER COLUMN DROP NOT NULL` em `appointments.plan_id` libera o caminho.

## Trigger `enforce_appointment_preconditions` v2

Ver `data-model.md` para o pseudo-código completo. Resumo:

| Caso                | `plan_id` | `source_price_version_id` | Comportamento                                                                                                        |
| ------------------- | --------- | ------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Convênio            | UUID      | NULL ou UUID              | Busca `price_versions`. Se ausente, falha. Se UUID já veio, usa o que veio. Se NULL, preenche com `active_price.id`. |
| Particular          | NULL      | NULL                      | Pula `price_versions`. CHECK `frozen_amount_cents > 0` já cobre validação de valor.                                  |
| Particular inválido | NULL      | UUID                      | Falha com `APPOINTMENT_PARTICULAR_NO_PRICE_VERSION` — caller bugado.                                                 |

TUSS check (validity dates) roda nos dois caminhos.

## Auto-detect na UI

Matriz para determinar estado inicial do checkbox:

| `paciente.plan_id` | `procedimento.covered_by_plan` | Checkbox inicial | Editável?                   |
| ------------------ | ------------------------------ | ---------------- | --------------------------- |
| NULL               | TRUE                           | marcado          | sim                         |
| NULL               | FALSE                          | marcado          | sim                         |
| UUID               | TRUE                           | desmarcado       | sim                         |
| UUID               | FALSE                          | marcado          | **não** (forçado, com nota) |

Sem paciente selecionado: checkbox desmarcado e desabilitado.

## Lógica do client component

```ts
const [particular, setParticular] = useState(false)
const [particularLocked, setParticularLocked] = useState(false)
const [userOverrode, setUserOverrode] = useState(false)

// Auto-detect:
useEffect(() => {
  if (userOverrode) return // respeita override manual

  if (selectedProcedure?.coveredByPlan === false) {
    setParticular(true)
    setParticularLocked(true)
    return
  }
  setParticularLocked(false)

  if (selectedPatient?.planId == null) {
    setParticular(true)
    return
  }
  setParticular(false)
}, [selectedPatient, selectedProcedure])

function onParticularChange(checked: boolean) {
  setUserOverrode(true)
  setParticular(checked)
}
```

## Badge "Particular"

Renderização condicional baseada em:

- Listagem de atendimentos: `plan_id === null` → badge.
- Detalhe atendimento: idem.
- Calendar block: idem (na linha `Paciente · Procedimento`).
- Step row do plano: `step.healthPlanId === null` → badge.

Estilo:

```tsx
<Badge variant="secondary" className="border-amber-200 bg-amber-50 text-amber-800">
  Particular
</Badge>
```

## Cenários de teste

1. **Paciente sem plano + INSERT** → trigger aceita; row tem `plan_id = NULL, source_price_version_id = NULL`.
2. **Paciente com plano + INSERT sem source_price_version_id** → trigger preenche com active_price; mantém `plan_id`.
3. **plan_id NULL + source_price_version_id SET** (caller bugado) → trigger rejeita com `APPOINTMENT_PARTICULAR_NO_PRICE_VERSION`.
4. **plan_id SET sem price_versions ativa para a combinação** → trigger rejeita com `APPOINTMENT_PRICE_MISSING` (caminho convênio inalterado).
5. **TUSS retired + plan_id NULL** → falha com `TUSS_CODE_RETIRED` (TUSS check roda nos dois caminhos).
6. **Etapa criada com plan_id NULL + horário** → RPC `create_step_with_appointment` cria appointment particular + step com `plan_id NULL`.
7. **Estorno de atendimento particular** → trigger `release_slot_lock` libera slot; reversal não toca `plan_id`.
8. **UI auto-detect — paciente sem plano** → checkbox marcado.
9. **UI auto-detect — procedimento `covered_by_plan = false`** → checkbox marcado e desabilitado.
10. **UI override manual** → marcação do usuário fica fixa após mudar paciente/procedimento.
