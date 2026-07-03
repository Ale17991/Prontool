# Contract — Extensão de `POST /api/atendimentos/manual`

A Feature 007 estende o endpoint **existente** `/api/atendimentos/manual` para aceitar um campo opcional `materiais[]` no payload. Quando presente e não vazio, os materiais são persistidos atomicamente com o atendimento.

Endpoint, autenticação e demais campos do body permanecem **inalterados** — esta é uma extensão backward-compatible.

---

## Body schema (atualizado)

```ts
const bodySchema = z.object({
  patient_id: z.string().uuid(),
  doctor_id: z.string().uuid(),
  procedure_id: z.string().uuid(),
  plan_id: z.string().uuid().nullable(),
  appointment_at: z.string().datetime(),
  amount_cents_override: z.number().int().min(0).optional(),
  duration_minutes: z.number().int().min(5).max(480).optional(),
  observacoes: z.string().trim().max(500).optional(),

  // ✨ NOVO
  materiais: z
    .array(
      z.object({
        tuss_code: z.string().min(1).max(20),
        tuss_description: z.string().min(1).max(500),
        quantity: z.number().int().positive().default(1),
      }),
    )
    .max(50)
    .optional(),
})
```

Diferenças vs. `/api/atendimentos/[id]/materiais`:

- Aqui `materiais` é **opcional** (atendimento sem materiais é o caminho mais comum).
- Não tem `min(1)` — array vazio é tratado como "sem materiais" (mesmo comportamento de ausência).

---

## Comportamento

### Caminho A — sem materiais (caso comum)

`materiais` ausente, `null` ou `[]`. Handler segue o caminho atual:

1. `requireRole(['admin', 'recepcionista'])`.
2. Validação Zod.
3. `createAppointmentManually(supabase, input)` — INSERT direto na `appointments`.
4. `publishDomainEvent('appointment.created', ...)`.
5. Resposta 201 com payload existente (sem mudança).

### Caminho B — com materiais

`materiais` é array com ≥ 1 item:

1. `requireRole(['admin', 'recepcionista'])`.
2. Validação Zod (incluindo cada material).
3. **Pré-validação dos códigos TUSS no service** — verificar que cada `tuss_code` pertence à tabela 19 e está vigente. Falha → `400 MATERIAL_TUSS_INVALID` antes de tocar o banco. (Defesa redundante ao trigger SQL — feedback mais rápido ao cliente.)
4. `createAppointmentManually(supabase, { ...input, materiais })`. Internamente:
   - Resolve preço, comissão, valida FKs (igual hoje).
   - Em vez do INSERT direto, monta payload e chama `supabase.rpc('create_appointment_with_materials', { p_appointment, p_materials })`.
   - Recebe `{ appointment_id, materials_count }`.
5. `publishDomainEvent('appointment.created', ...)`.
6. Resposta 201:

```json
{
  "appointment_id": "...",
  "frozen_amount_cents": 12000,
  "frozen_commission_bps": 3000,
  "price_version_id": "...",
  "commission_history_id": "...",
  "amount_was_overridden": false,
  "vigente_amount_cents": 12000,
  "is_particular": false,
  "materials_count": 2
}
```

A nova chave `materials_count` é adicionada **apenas quando `materiais` foi enviado** — clientes existentes não veem mudança no shape da resposta.

---

## Erros

Códigos existentes (`PATIENT_NOT_FOUND`, `PROCEDURE_NOT_FOUND`, `TUSS_CODE_UNKNOWN`, `APPOINTMENT_CONFLICT`, etc.) inalterados.

Códigos novos quando `materiais` enviado:

- `400 MATERIAL_TUSS_INVALID` — algum `tuss_code` enviado não pertence à tabela 19 ou não está vigente.
- `400 MATERIAL_QUANTITY_INVALID` — quantity ≤ 0 (já capturado pelo Zod, mas service revalida como defesa).

---

## Atomicidade

Garantida pelo RPC SQL (ver `data-model.md`). Cenários cobertos:

- Falha no INSERT do appointment (FK, conflict, trigger) → nenhum material persiste.
- Falha no INSERT de qualquer material (TUSS inválido, quantity zero, tenant mismatch) → appointment não persiste.
- Falha de rede/timeout no meio → PostgreSQL desfaz a transação implícita.

A consequência é que o cliente sempre recebe ou um `appointment_id` válido com **todos** os materiais persistidos, ou erro com **nada** persistido.

---

## Compatibilidade

- Clientes que não enviam `materiais`: zero impacto.
- Clientes que enviam `materiais`: ganham comportamento novo. Resposta inclui `materials_count`.
- Cliente UI (`new-appointment-form.tsx`): ajustado para enviar `materiais` quando o usuário adicionar itens na seção opcional.

---

## Service layer (mudanças em `create-manual.ts`)

```ts
export interface CreateManualAppointmentInput {
  // ... campos atuais
  materiais?: Array<{
    tuss_code: string
    tuss_description: string
    quantity: number
  }>
}

export async function createAppointmentManually(
  supabase: SupabaseClient<Database>,
  input: CreateManualAppointmentInput,
): Promise<CreateManualAppointmentResult & { materialsCount?: number }> {
  // ... validações de FK e TUSS do procedimento (como hoje)

  // ✨ Pré-validação dos materiais (se enviados)
  if (input.materiais && input.materiais.length > 0) {
    const codes = input.materiais.map(m => m.tuss_code)
    const { data: validCodes } = await supabase
      .from('tuss_codes')
      .select('code')
      .in('code', codes)
      .eq('tuss_table', '19')
      .is('valid_to', null)
    const validSet = new Set((validCodes ?? []).map(r => r.code))
    const invalid = codes.filter(c => !validSet.has(c))
    if (invalid.length > 0) {
      throw new DomainError('MATERIAL_TUSS_INVALID',
        `Códigos TUSS inválidos ou não vigentes: ${invalid.join(', ')}`,
        { status: 400 })
    }
  }

  // ... resolveCommission, resolvePrice (como hoje)

  // ✨ Branch entre INSERT direto e RPC
  if (input.materiais && input.materiais.length > 0) {
    const { data, error } = await supabase.rpc('create_appointment_with_materials', {
      p_appointment: { ...baseRow, duration_minutes: input.durationMinutes ?? null },
      p_materials: input.materiais,
    })
    if (error) {
      // mapear codes → DomainError; fallback genérico
      throw new Error(`createAppointmentWithMaterials failed: ${error.message}`)
    }
    return {
      appointmentId: data.appointment_id,
      // ... demais campos
      materialsCount: data.materials_count,
    }
  }

  // Caminho atual (INSERT direto), sem mudanças
  const inserted = await supabase.from('appointments').insert({...}).select('id').single()
  // ...
}
```

A chave aqui: caminho atual permanece **inalterado** quando `materiais` não é enviado. Risco de regressão isolado ao novo branch.

---

## Testes mínimos

- **Contract**: POST sem `materiais` → resposta atual sem `materials_count` (forma backward-compatible).
- **Atomicity**: simular falha no segundo material via `tuss_code` inválido → appointment não persiste no banco (`SELECT count(*) FROM appointments WHERE patient_id=...` retorna 0 imediatamente após a tentativa).
- **Materials count**: POST com 3 materiais → response inclui `materials_count: 3`; query no banco confirma 3 rows em `appointment_materials`.
- **Empty array**: POST com `materiais: []` → segue caminho A (sem RPC), resposta sem `materials_count`. **Equivalente** a omitir o campo.
- **Quantity validation**: POST com `quantity: 0` → 400 INVALID_BODY (Zod).
- **Tenant isolation**: tentar enviar `tuss_code` de tabela 19 mas atendimento de outro tenant → não aplica (tenant é do JWT, payload não permite override). RPC valida via RLS.
