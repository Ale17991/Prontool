# Pipedrive adapter (placeholder)

Not implemented yet. To implement:

1. Create `adapter.ts` implementing `IntegrationAdapter<PipedriveConfig, PipedriveCredentials>` from `../types.ts`.
2. `credentialsSchema`: `{ api_token }` or OAuth credentials.
3. Add `'pipedrive'` to `tenant_integrations.provider` CHECK constraint.
4. Register in `../registry.ts`.
5. Map `appointment.created` → Pipedrive activity.
