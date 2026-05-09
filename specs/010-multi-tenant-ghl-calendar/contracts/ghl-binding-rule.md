# Contract — GHL 1:1 Binding Rule (US1)

**Feature**: 010 | **Group**: integration safety

Esta story **não adiciona endpoints** — modifica o comportamento de endpoints existentes da feature 008 para enforçar a regra 1:1 com mensagens de erro específicas e auditoria.

---

## Internal helper: `assertGhlBindingFree`

`src/lib/core/integrations/ghl/binding-check.ts` exporta:

```ts
export async function assertGhlBindingFree(
  supabase: SupabaseClient<Database>,
  args: { tenantId: string | null; locationId: string }
): Promise<void>
```

**Behavior**:

1. **Tenant-side check (FR-001)** — apenas se `tenantId !== null`:
   - SELECT `tenant_integrations` WHERE `tenant_id = :tenantId AND provider = 'ghl' AND enabled = true`.
   - Se existir → throw `ConflictError('GHL_TENANT_ALREADY_CONNECTED', 'Esta clínica já está conectada a outra conta GoHighLevel. Desconecte primeiro.')`.

2. **Location-side check (FR-002)**:
   - SELECT `tenant_integrations` WHERE `provider = 'ghl' AND enabled = true AND location_id = :locationId AND (tenantId IS NULL OR tenant_id <> :tenantId)`.
   - Se existir → throw `ConflictError('GHL_LOCATION_ALREADY_BOUND', 'Esta conta GoHighLevel já está vinculada a outra clínica no Prontool.')`.

**Reuse**: chamado por `connectGhlTenant`, pelo handler do callback OAuth e pelo handler do webhook de install (este último com `tenantId: null` quando ainda vai criar o tenant).

---

## Modified: `connectGhlTenant`

`src/lib/core/integrations/ghl/connect-tenant.ts` ganha no início:

```ts
await assertGhlBindingFree(supabase, {
  tenantId: input.tenantId,
  locationId: input.location.id,
})
```

Em seguida, faz upsert como hoje. Se o partial unique index do banco rejeitar (race entre o pre-flight e o upsert), o erro é capturado e mapeado para `ConflictError('GHL_LOCATION_ALREADY_BOUND', ...)` para mensagem consistente.

**Audit em rejeição** (FR-008):

```ts
catch (err) {
  if (err instanceof ConflictError &&
      ['GHL_TENANT_ALREADY_CONNECTED', 'GHL_LOCATION_ALREADY_BOUND'].includes(err.code)) {
    await supabase.from('audit_log').insert({
      tenant_id: input.tenantId,
      actor_id: input.actorUserId,
      actor_label: input.actorLabel,
      entity: 'tenant_integrations',
      entity_id: input.tenantId,
      field: `connect.rejected:${err.code.toLowerCase()}`,
      old_value: null,
      new_value: JSON.stringify({ location_id: input.location.id, source: input.source }),
      reason: err.message,
      ip: input.ip,
      user_agent: input.userAgent,
      result: 'conflict',
    })
  }
  throw err  // re-throw para o handler retornar 409
}
```

---

## Modified: `POST /api/oauth/ghl/callback`

Já é admin-only via `requireRole('admin')`. Acrescenta:

1. ANTES de chamar `connectGhlTenant`, chama `assertGhlBindingFree({ tenantId: session.tenantId, locationId: tokenResponse.locationId })`.
2. Se lança `ConflictError`, o `toHttpResponse` retorna **HTTP 409** com `body.error.code` e `body.error.message`.
3. UI da página `/configuracoes/integracoes/ghl` interpreta o code para destacar o aviso correto.

**Possible response codes**:

| Code | Meaning |
|------|---------|
| `200` | Conexão criada/atualizada com sucesso |
| `400` | Parâmetros do callback inválidos (state mismatch, etc.) |
| `409 GHL_TENANT_ALREADY_CONNECTED` | FR-001 |
| `409 GHL_LOCATION_ALREADY_BOUND` | FR-002 |

---

## Modified: `POST /api/webhooks/ghl/install`

Webhook do Marketplace (HMAC-validado). Adicional:

1. ANTES de criar tenant (auto-provisioning), chama `assertGhlBindingFree({ tenantId: null, locationId: payload.locationId })` para checar FR-002.
2. Se lança `GHL_LOCATION_ALREADY_BOUND`:
   - Retorna **HTTP 409** com body `{ error: { code: 'GHL_LOCATION_ALREADY_BOUND', message: '...' } }` para o GHL.
   - Audit `entity='tenant_integrations', entity_id=NULL, field='connect.rejected:ghl_location_already_bound', new_value={ location_id, source: 'marketplace_install' }, result='conflict'`.
   - **Nenhum tenant é criado.**
3. Se a checagem passa: cria tenant + provisiona admin + chama `connectGhlTenant` (que faz nova verificação como defesa em profundidade).

---

## Modified UI: `/configuracoes/integracoes/ghl`

A página da feature 008 ganha:

1. Quando **conectada**: bloco de informação adicional embaixo do card existente:
   - "Conta: <sub_account_name>"
   - "ID: <location_id>"
   - "Conectada em <data formatada>"
   - Botão "Desconectar" (já existe).

2. Quando **desconectada**: caixa de aviso:
   - "Cada clínica pode ser conectada a apenas uma conta GoHighLevel. Antes de conectar, certifique-se de que a sub-account não está vinculada a outra clínica do Prontool."

3. Em qualquer toast/alert pós-conexão que retorne `ConflictError`:
   - `GHL_TENANT_ALREADY_CONNECTED` → mostra "Esta clínica já está conectada a outra conta GoHighLevel. Desconecte primeiro." + link "Desconectar".
   - `GHL_LOCATION_ALREADY_BOUND` → mostra "Esta conta GoHighLevel já está vinculada a outra clínica no Prontool. Cada clínica pode usar apenas uma sub-account." (sem revelar qual clínica é a outra — Princípio III).

---

## Disconnect path (existente, sem alteração)

`disconnectGhlTenant` já libera ambos os lados (seta `enabled=false`) — após disconnect, o partial unique index não considera mais a row, e o pre-flight também não vê mais. FR-005 satisfeito sem mudança.
