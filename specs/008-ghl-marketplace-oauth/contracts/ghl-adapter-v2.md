# Contract — GHL Adapter v2 (`IntegrationAdapter<GhlConfigV2, GhlOAuthCredentials>`)

**Feature**: 008-ghl-marketplace-oauth
**File**: `src/lib/integrations/ghl/adapter.ts` (modificado)

Atualização do adapter GHL existente para usar OAuth 2.0 per-tenant em vez do proxy compartilhado em Homio Operations. Mantém o contrato `IntegrationAdapter` da Feature 002 — registry e dispatcher continuam idênticos.

---

## Shape

```ts
export const ghlAdapter: IntegrationAdapter<GhlConfigV2, GhlOAuthCredentials> = {
  provider: 'ghl',
  label: 'GoHighLevel',
  description:
    'CRM e automação de marketing. Contato sincronizado bidirecionalmente; atendimento vira nota.',
  configSchema: ghlConfigV2Schema,           // de oauth/types.ts
  credentialsSchema: ghlOAuthCredentialsSchema,
  redactCredentials: (c) => ({
    access_token: '***',
    refresh_token: '***',
    expires_at: c.expires_at,                 // não-sensível
    scopes: c.scopes.join(','),
    location_id: c.location_id,
  }),
  handleInboundWebhook: handleGhlInboundWebhook,
  handleDomainEvent: handleGhlDomainEvent,
}
```

`redactCredentials` retorna **apenas** campos não-sensíveis. `expires_at` e `scopes` ajudam debugging na UI sem expor segredos.

---

## `handleDomainEvent`

```ts
async function handleGhlDomainEvent(
  ctx: AdapterContext<GhlConfigV2, GhlOAuthCredentials>,
  event: DomainEvent,
): Promise<void> {
  // Token resolution: middleware withGhlAuth re-reads tenant_integrations,
  // refreshes if needed (advisory lock), and returns a fresh access_token.
  // ctx.credentials may already be stale by the time this runs, so we DON'T
  // use ctx.credentials.access_token directly.
  const auth = await withGhlAuth(ctx.supabase, ctx.tenantId)
  if (auth.kind === 'token_expired') {
    // Refresh failed — alert + skip. Operation already committed locally.
    await recordSyncFailure(ctx.supabase, ctx.tenantId, {
      kind: kindFor(event),
      error_code: 'TOKEN_EXPIRED',
      error_message: 'Refresh token revoked or invalid',
    })
    return
  }

  switch (event.type) {
    case 'patient.created': {
      const ghlContactId = await createContactInGhl({
        accessToken: auth.accessToken,
        locationId: ctx.config.location_id,
        customFieldIds: ctx.config.custom_field_ids,
        patient: event.patient,
      })
      // Write back so future appointment events can attach notes.
      const upd = await ctx.supabase
        .from('patients')
        .update({ ghl_contact_id: ghlContactId })
        .eq('id', event.patient.id)
        .eq('tenant_id', ctx.tenantId)
      if (upd.error) throw new Error(`patients.ghl_contact_id update failed: ${upd.error.message}`)
      await recordSyncSuccess(ctx.supabase, ctx.tenantId, { kind: 'outbound_contact', detail: { patient_id: event.patient.id } })
      return
    }

    case 'appointment.created': {
      if (!event.patient.ghlContactId) {
        // Patient pre-dates the connection or sync failed; skip silently.
        ctx.logger.info({ patient_id: event.patient.id }, 'ghl-adapter-skip-note-no-contact')
        return
      }
      await createNoteInGhl({
        accessToken: auth.accessToken,
        contactId: event.patient.ghlContactId,
        body: formatAppointmentNote(event),
      })
      await recordSyncSuccess(ctx.supabase, ctx.tenantId, { kind: 'outbound_note', detail: { appointment_id: event.appointment.id } })
      return
    }

    case 'appointment.reversed': {
      // Out of scope for v1; log only.
      ctx.logger.debug({ appointment_id: event.original.id }, 'ghl-adapter-skip-reversal-note')
      return
    }
  }
}
```

### Erros que o adapter pode lançar

- **NUNCA bloquear a operação local**. Toda chamada externa é `try/catch` no caller (`dispatchDomainEvent`) que registra alerta `integration_sync_failed` e segue.
- O adapter **lança** `Error` quando há corrupção interna (ex.: `patients` update falha). Isso é raro e deve ir para alerta também.
- Para `withGhlAuth.kind='token_expired'`, o adapter **não lança** — apenas grava sync-log e retorna. Estado da integração já foi marcado `token_expired` por dentro do `withGhlAuth`.

---

## `handleInboundWebhook`

Mantém a estrutura existente em `handleGhlWebhook` (em `adapter.ts:158`), mas:

1. **Adiciona discriminação por `type` do payload** (`ContactCreate`, `ContactUpdate`, `OpportunityStatusUpdate`):
   - `ContactCreate`/`ContactUpdate` → upsert em `patients` usando `extract-custom-fields.ts` indexado por `custom_field_ids` salvos.
   - `OpportunityStatusUpdate` → caminho legado da Feature 002 (criar/promover atendimento), mantido sem mudança funcional.
2. **Validação de assinatura usa `webhook_secret_enc` por tenant** — esse caminho **não muda** com OAuth (webhooks GHL pós-conexão usam um shared secret por subscription, não o access_token). Continua usando `verify-signature.ts`.
3. Após processar, registra `integration_sync_log(kind='inbound_contact'\|'inbound_opportunity', status='success')`.

### Identificação do tenant em inbound webhook

O caminho legado scaneia `tenant_integrations` rows e tenta verificar HMAC contra cada `webhook_secret_enc` (vide `adapter.ts:245`). Para a Feature 008 mantemos esse comportamento — o GHL não inclui `locationId` em todos os payloads de webhook de eventos, e a assinatura é o que liga payload→tenant. Quando estiver presente (`payload.locationId`), o lookup vira O(1) por unique index — otimização opcional para v1.

---

## Fonte de verdade para credentials

```ts
// oauth/with-auth.ts (esqueleto)
export async function withGhlAuth(
  supabase: SupabaseClient<Database>,
  tenantId: string,
): Promise<
  | { kind: 'connected'; accessToken: string; locationId: string; tokenJustRefreshed: boolean }
  | { kind: 'token_expired' }
  | { kind: 'not_connected' }
> {
  // 1. Read row.
  const row = await getIntegrationConfig(supabase, tenantId, 'ghl')
  if (!row || !row.enabled || row.status === 'disconnected') return { kind: 'not_connected' }
  if (row.status === 'token_expired') return { kind: 'token_expired' }

  const creds = await decryptCredentials(supabase, row, ghlOAuthCredentialsSchema)

  // 2. Fast path: still fresh.
  const now = Date.now()
  const expiresAt = Date.parse(creds.expires_at)
  if (expiresAt - now > 60_000) {
    return { kind: 'connected', accessToken: creds.access_token, locationId: creds.location_id, tokenJustRefreshed: false }
  }

  // 3. Refresh path: advisory lock + double-check.
  return refreshUnderLock(supabase, tenantId, row, creds)
}
```

Detalhes de `refreshUnderLock` em `oauth/refresh-lock.ts`. Lógica chave:

- `BEGIN; SELECT pg_advisory_xact_lock(hashtext('ghl:' || tenant_id::text));`
- Re-read row + creds.
- Se outro processo já refrescou (expires_at agora > now + 60s), retorna sem chamar GHL.
- Se ainda não, `POST /oauth/token` com `grant_type=refresh_token`. Persiste novo par (`UPDATE tenant_integrations SET credentials_enc=..., status='connected'`).
- Se falhar com 4xx (refresh_token revogado): `UPDATE tenant_integrations SET status='token_expired'`, registra `audit_log` + alerta + sync-log, retorna `{ kind: 'token_expired' }`.
- Se falhar com 5xx ou timeout: NÃO marca token_expired (problema transient); deixa `expires_at` como está e retorna `{ kind: 'connected' }` com token possivelmente vencido — próxima call tentará de novo. Em pratica, 5xx do `/oauth/token` é raro e a janela de 60s antes do vencimento dá tempo para próxima call.
- `COMMIT;`

---

## Tests (contract)

`tests/contract/integration-adapter.spec.ts` (existente — atualizar mock):

- `redactCredentials` nunca expõe `access_token`/`refresh_token`.
- `configSchema.parse` aceita config v2 e rejeita v1 (com aviso opcional para migration path).
- `credentialsSchema.parse` exige access_token/refresh_token/expires_at.

`tests/integration/integrations/ghl/auto-refresh.spec.ts`:

- Token quase vencendo → próxima chamada faz refresh, persiste novo par, segue.
- Refresh com 401 do GHL → estado vira `token_expired`, audit + alerta gravados, próxima chamada retorna sem hit ao /oauth/token.
- 2 calls concorrentes ao adapter quando token está vencendo → apenas 1 hit em /oauth/token (advisory lock).

`tests/integration/integrations/ghl/sync-bidirectional.spec.ts`:

- Inbound `ContactCreate` → upsert em `patients` com custom_fields mapeados pelos IDs salvos.
- Inbound `ContactUpdate` para paciente existente (lookup por `ghl_contact_id`) → atualiza campos.
- Outbound `patient.created` → POST contato no GHL com custom_fields preenchidos; `patients.ghl_contact_id` atualizado.
- Outbound `appointment.created` → POST nota no contato, formato esperado.
- Outbound quando `withGhlAuth` retorna `token_expired` → NENHUMA chamada ao GHL, sync-log entry `failure` `error_code='TOKEN_EXPIRED'`, operação local commitada.
