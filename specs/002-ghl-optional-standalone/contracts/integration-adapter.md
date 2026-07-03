# Contract: `IntegrationAdapter` (TS interface)

Todo provider em `src/lib/integrations/<provider>/adapter.ts` **DEVE** implementar esta interface e ser registrado em `src/lib/integrations/registry.ts`.

O contrato é validado em CI via `tests/contract/integration-adapter.spec.ts`, que roda a mesma suíte contra cada adapter registrado.

## Interface

```ts
export interface IntegrationAdapter<Config = unknown, Credentials = unknown> {
  provider: ProviderId
  label: string
  description: string
  configSchema: z.ZodSchema<Config>
  credentialsSchema: z.ZodSchema<Credentials>
  redactCredentials(c: Credentials): Record<string, string>
  extractTenantIdFromWebhook?(req: Request): Promise<string | null>
  handleInboundWebhook?(ctx: AdapterContext<Config, Credentials>, req: Request): Promise<Response>
  handleDomainEvent(ctx: AdapterContext<Config, Credentials>, event: DomainEvent): Promise<void>
}
```

## Required methods

### `provider: ProviderId`

Identificador único no registry. Kebab/snake. Imutável.

### `label: string` / `description: string`

Strings curtas usadas pela UI (`GET /api/configuracoes/integracoes`). `label` ≤ 40 chars; `description` ≤ 160 chars.

### `configSchema: z.ZodSchema<Config>`

Schema Zod da **parte pública** da configuração (não secreta). É serializado como JSON Schema e enviado para a UI montar o formulário dinâmico. Inclui campos como `location_id`, URLs de outbound, mapeamentos de campos, lista de eventos a receber.

### `credentialsSchema: z.ZodSchema<Credentials>`

Schema Zod da **parte secreta**. Nunca é retornada em response de API (mesmo redacted — só o shape em `credentials_redacted`). É o que será cifrado e gravado em `tenant_integrations.credentials_enc`.

### `redactCredentials(c: Credentials): Record<string, string>`

Recebe credenciais **decifradas** e retorna objeto com todos os valores mascarados (`'***'` ou prefixo + últimos 4 chars). Usado por:

- `GET /api/configuracoes/integracoes/[provider]` em `credentials_redacted`.
- `audit_log` `before_value` / `after_value`.

**Contract test assertion**: fuzz com 20 strings "supersecret\_<random>" — nenhuma pode aparecer no output.

### `handleDomainEvent(ctx, event): Promise<void>`

Consome eventos de domínio. Implementação pode ignorar eventos não-suportados (noop). **Deve**:

- Respeitar timeout de 5s (usar `AbortSignal.timeout(5000)` em `fetch`).
- Não lançar em eventos desconhecidos — discriminated union do TS cuida disso, mas adapter pode ter `switch` com `default: return;`.
- Se falha, lançar erro normal — o dispatcher captura e gera alerta `integration_sync_failed`.

## Optional methods (inbound)

### `extractTenantIdFromWebhook?(req): Promise<string | null>`

Cada provider manda o `tenant_id` de forma diferente (header, query param, body field). Implementação obrigatória se o provider tem webhooks inbound. `null` → webhook rejeitado 400.

### `handleInboundWebhook?(ctx, req): Promise<Response>`

Chamado pelo roteador em `/api/webhooks/[provider]`. Recebe já com `ctx` populado (config + credentials decifradas). Tipicamente:

1. Verifica assinatura com `ctx.credentials.inbound_webhook_secret`.
2. Persiste `raw_webhook_events` (quando aplicável).
3. Enfileira em QStash (ou processa inline) → `createAppointmentFromEvent` (core já existente).
4. Retorna `Response` (200 idempotente, 401 em assinatura inválida, 422 em payload inválido).

## Contract test suite (aplicada a todo adapter)

```ts
// tests/contract/integration-adapter.spec.ts
for (const provider of listProviders()) {
  const adapter = registry[provider];
  describe(`adapter ${provider}`, () => {
    it('has label and description', () => {...});
    it('configSchema accepts a valid config', () => {...});
    it('configSchema rejects invalid config', () => {...});
    it('credentialsSchema accepts valid credentials', () => {...});
    it('redactCredentials never leaks values', () => {
      const creds = adapter.credentialsSchema.parse(fixtureForProvider(provider));
      const redacted = adapter.redactCredentials(creds);
      for (const v of Object.values(creds)) {
        for (const r of Object.values(redacted)) {
          expect(r).not.toContain(String(v));
        }
      }
    });
    it('handleDomainEvent is a noop for unsupported event types', () => {...});
    it('handleDomainEvent respects 5s timeout', async () => {...});
    if (adapter.handleInboundWebhook) {
      it('extractTenantIdFromWebhook returns null on unsigned request', () => {...});
    }
  });
}
```

## Adding a new provider (checklist)

1. `mkdir src/lib/integrations/<provider>`
2. Implementar `adapter.ts` com a interface acima.
3. Adicionar ao `ProviderId` union em `types.ts`.
4. Registrar em `registry.ts`.
5. Adicionar ao CHECK constraint da migration (nova migration `00NN_add_provider_<provider>.sql`).
6. Rodar `pnpm test:contract` — suite genérica tem que passar sem mudança.
7. Adicionar teste específico em `tests/integration/integrations/<provider>/*.spec.ts`.
8. Documentar no quickstart (seção "Providers suportados").
