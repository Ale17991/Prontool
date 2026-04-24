# Contract: `POST /api/pacientes` (existing — comportamento ajustado para multi-provider)

Endpoint já existe em `src/app/api/pacientes/route.ts`. O contrato HTTP (path, body, status codes) é preservado; o que muda é o comportamento interno: ao invés de chamar `createContactInGhl` direto, agora publica um evento de domínio e o dispatcher fan-out para cada integração ativa.

## Auth

`requireRole(['admin', 'recepcionista'])` (inalterado).

## Request

Schema Zod preservado:

```ts
z.object({
  full_name: z.string().trim().min(2).max(200),
  cpf: cpfDigits,
  phone: z.string().trim().max(40).optional().nullable(),
  email: z.string().trim().email().max(200).optional().nullable(),
  birth_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  plan_id: z.string().uuid().optional().nullable(),
})
```

## Response 201

```json
{
  "patient_id": "3b1c3c88-4e76-4f1c-95e8-8e33b9ab1d09",
  "ghl_contact_id": null,
  "integrations_dispatched": [
    { "provider": "ghl", "ok": true, "detail": "contact_created" }
  ]
}
```

- `ghl_contact_id` continua presente por back-compat com clientes existentes; preenchido quando o adapter GHL retornar sucesso.
- `integrations_dispatched` novo: array com 1 entrada por provider ativo do tenant. Vazio em modo standalone.
- Campo anterior `ghl_synced` fica **deprecated** mas ainda retornado (mirror de `integrations_dispatched.find(i => i.provider === 'ghl')?.ok ?? false`). Clientes novos devem preferir `integrations_dispatched`.

## Behavior change (internal)

`src/lib/core/patients/create-manual.ts` passa a:

1. Encrypt PII (inalterado).
2. INSERT em `patients` com `ghl_contact_id=NULL` (será atualizado no passo 4 se GHL adapter tiver sucesso).
3. Publicar evento `patient.created` no event bus.
4. Dispatcher `events/dispatch.ts`:
   - Busca `getEnabledIntegrations(tenantId)`.
   - Para cada integração, chama `adapter.handleDomainEvent(ctx, { type: 'patient.created', patient })` via `Promise.allSettled`.
   - Adapter GHL, ao criar o contato com sucesso, faz UPDATE em `patients.ghl_contact_id` (responsabilidade do adapter — provider-específico). Outros adapters que não têm esse conceito simplesmente não tocam.
5. Standalone (lista vazia) ⇒ dispatcher retorna imediatamente; nenhuma chamada externa, nenhum alerta, nenhum log sobre integração.

## Testing delta

- `tests/integration/patients/create-manual-standalone.spec.ts`: seed tenant sem linhas em `tenant_integrations`, POST → 201, `integrations_dispatched=[]`, MSW global com `.all(() => { throw new Error('should not fetch') })` garante zero outbound.
- `tests/integration/patients/create-manual-multi-provider.spec.ts`: seed tenant com GHL + generic_webhook ativos, POST → 201, dois elementos em `integrations_dispatched`.
- `tests/integration/patients/create-manual-provider-failure.spec.ts`: adapter GHL falhando, generic_webhook OK. Paciente persiste, alerta `integration_sync_failed` criado só para GHL.
