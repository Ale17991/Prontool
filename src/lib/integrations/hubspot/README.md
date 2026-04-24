# HubSpot adapter (placeholder)

Not implemented yet. To implement:

1. Create `adapter.ts` implementing `IntegrationAdapter<HubspotConfig, HubspotCredentials>` from `../types.ts`.
2. Define `configSchema` (portal_id, event subscriptions) and `credentialsSchema` (private app token).
3. Add `'hubspot'` to the `CHECK` constraint of `tenant_integrations.provider` via a new migration.
4. Register in `../registry.ts`.
5. Test in `tests/integration/integrations/hubspot/`.
