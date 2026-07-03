# Contract — Server Action `saveReminderConfig`

**Localização**: `src/app/(dashboard)/configuracoes/lembretes/actions.ts`.
**Acesso**: requer sessão autenticada com role `admin` ou `recepcionista` (FR-006).

---

## Signature

```typescript
export async function saveReminderConfig(input: ReminderConfigUpdate): Promise<
  | { ok: true }
  | {
      ok: false
      error: 'UNAUTHORIZED' | 'INVALID_PAYLOAD'
      details?: Array<{ field: string; message: string }>
    }
>
```

## Input schema (Zod)

```typescript
export const ReminderConfigUpdateSchema = z
  .object({
    enabled: z.boolean(),
    offsets: z.array(z.number().int().min(0).max(168)).min(1).max(5),
    sendWeekends: z.boolean(),
    windowStart: z.string().regex(/^\d{2}:\d{2}$/), // HH:MM
    windowEnd: z.string().regex(/^\d{2}:\d{2}$/),
    templateSubject: z.string().max(200).nullable(),
    templateBody: z.string().max(10000).nullable(),
  })
  .refine((v) => v.windowEnd > v.windowStart, {
    message: 'Janela inválida: fim deve ser maior que início',
    path: ['windowEnd'],
  })
  .refine((v) => !v.enabled || v.offsets.length >= 1, {
    message: 'Para habilitar, defina ao menos uma antecedência',
    path: ['enabled'],
  })
```

## Flow

1. `getSession()` → se null OU role não está em `['admin', 'recepcionista']` → `{ ok: false, error: 'UNAUTHORIZED' }`.
2. Parse Zod → falha → `{ ok: false, error: 'INVALID_PAYLOAD', details: zodIssuesAsFieldMessages(...) }`.
3. UPDATE `tenant_clinic_profile` com `tenant_id = session.tenantId` (RLS-bound client via `createSupabaseServerClient`).
4. Trigger de audit dispara automaticamente (mudança nas colunas é registrada via padrão existente).
5. `revalidatePath('/configuracoes/lembretes')`.
6. Retornar `{ ok: true }`.

## Errors

- `UNAUTHORIZED` (403 UX equivalente): role não habilitada.
- `INVALID_PAYLOAD` (400 UX equivalente): regex/range fora dos limites.
- Erros de DB são propagados como exceções e capturados pelo `error.tsx` boundary do Next.js.

## Audit

UPDATE em `tenant_clinic_profile` já dispara `audit_log` via trigger existente em features anteriores (009/017). Nenhum audit explícito necessário aqui.

## Outras actions no mesmo arquivo

### `setPatientReminderOptIn(patientId: string, optIn: boolean)`

- Mesmo gateway RBAC (`admin` / `recepcionista`).
- UPDATE `patients SET reminders_opt_in = ? WHERE id = ? AND tenant_id = session.tenantId`.
- Audit via trigger existente em `patients`.
- Retorna `{ ok: true }` ou erros mapeados.
