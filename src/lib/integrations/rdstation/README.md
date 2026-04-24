# RD Station adapter (placeholder)

Not implemented yet. To implement:

1. Create `adapter.ts` implementing `IntegrationAdapter<RdConfig, RdCredentials>` from `../types.ts`.
2. `credentialsSchema`: `{ client_id, client_secret, refresh_token }` with OAuth refresh flow.
3. Add `'rdstation'` to `tenant_integrations.provider` CHECK constraint.
4. Register in `../registry.ts`.
5. Test in `tests/integration/integrations/rdstation/`.
