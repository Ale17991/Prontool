# Operations

Operational playbooks for the Pronttu stack. Read alongside
`docs/lgpd.md` for anything touching patient data.

## 1. Triaging a DLQ spike

### What you'll see

- Alerts of `type='webhook_rejected'` from Resend (no PII in the body
  per FR-037 — expect a `raw_event_id`, a tenant id, and a failure code).
- `dlq_events` view on Supabase has rows with the affected tenants.
- Dashboard: `/dashboard/dlq` lists the events with the payload headers
  (signature headers are redacted at ingest time — safe to share).

### Terminal failure codes from the worker

| Code                         | Meaning                                                                 | Action                                                                             |
| ---------------------------- | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `WEBHOOK_PAYLOAD_INVALID`    | Zod extraction rejected the custom fields (required field missing).     | Check the tenant's `tenant_ghl_config` field map vs. the GHL workflow.             |
| `TUSS_CODE_UNKNOWN`          | Procedure has a TUSS code not present in `tuss_codes`.                  | Run the catalog refresh (see §3). If code is legit-but-retired, tenant must remap. |
| `TUSS_CODE_RETIRED`          | TUSS code was active at setup but has `valid_to` in the past now.       | Tenant needs to pick a replacement TUSS code before reprocessing.                  |
| `APPOINTMENT_PRICE_MISSING`  | No `price_versions` row covers (procedure, plan) at appointment time.   | Admin creates the price version (backdate `valid_from` if needed), then reprocess. |
| `PROCEDURE_INACTIVE`         | Tenant deactivated the procedure after the appointment was scheduled.   | Reactivate the procedure or tell the tenant to cancel on GHL side.                 |

### Reprocessing

1. Fix the tenant-side cause (price, TUSS mapping, field-map).
2. Open `/dashboard/dlq/<event_id>` and click **Reprocessar**, or POST
   `/api/alertas/dlq/<event_id>/reprocess` (admin only).
3. The endpoint re-enqueues the event in QStash with a fresh trace id;
   watch the alert resolve and the atendimento appear in
   `/dashboard/atendimentos` within ~1 min.

### Duplicate webhooks

`raw_webhook_events` has `UNIQUE (tenant_id, ghl_event_id)` — the second
delivery returns `{ received: true, duplicate: true }` in under 1 s and
is never enqueued. No action needed; this is by design (FR-005a).

## 2. Rotating a tenant's webhook secret

Only the platform operator should do this. Tenant admins never see the
plaintext secret.

1. Generate a new random secret, 32+ bytes:
   `openssl rand -hex 32`.
2. Update `tenant_ghl_config.webhook_secret_enc` via a direct SQL
   session using `enc_text_with_key(plain, $PATIENT_DATA_ENCRYPTION_KEY)`
   so the ciphertext matches what the webhook handler expects to
   decrypt.
3. Tell the tenant to update the shared secret in GHL's webhook settings
   **at the same time** — any window where the two sides differ will
   register as `signature_failure` alerts.
4. Verify: tail the next real delivery in the worker logs and confirm
   the trace lands at `webhook-event-received` with the correct
   `tenant_id`.

A helper script for this is tracked in T157 (production provisioning).

## 3. Updating the TUSS catalog

The catalog is pinned to a commit of
[`charlesfgarcia/tabelas-ans`](https://github.com/charlesfgarcia/tabelas-ans)
(see `scripts/seed-tuss.ts` and `docs/data-sources.md` once T152 lands).

```bash
pnpm seed:tuss
```

The script:
1. Downloads the pinned commit as a zipball.
2. Verifies the repo's LICENSE file (aborts on missing or incompatible).
3. Batches the JSON into `tuss_codes` via `UPSERT`, records the import
   as a new `tuss_catalog_versions` row (commit SHA + content hash).
4. Runs `detect-deprecated`, which scans each tenant's `procedures` /
   `price_versions` for codes whose `valid_to` just became non-null and
   fans out one `tuss_deprecated` alert per affected tenant.

**Before switching the pinned commit**, open the upstream diff and make
sure no previously-active code was dropped entirely (deprecation is
flagged via `valid_to`; deletion breaks referential integrity). If a
code was removed, add it back to the catalog manually or pin a prior
commit.

## 4. Alert triage workflow

Alert types in play today:

- `webhook_rejected` — see §1.
- `signature_failure` — HMAC verification failed against every known
  tenant secret. Usually either a rotated tenant secret out of sync
  (§2) or a malformed/test delivery. Investigate which tenant sent it
  (IP, timestamp) before replying.
- `tuss_deprecated` — emitted by the post-catalog-refresh scan (§3).
  One per `(tenant, tuss_code)`. Work with the tenant to pick a
  replacement; new price versions must reference an active TUSS code,
  so incoming webhooks for the old code will DLQ until remapped.

**Dedup window**: `dispatchAlert` dedupes by `(tenant_id, type,
subject_ref)` within a 1 h window. If you resolve an alert and it
re-triggers within the hour, the dispatcher logs `alert-deduplicated`
and no new row / email is sent — that's by design to avoid paging
storms during a back-and-forth with a tenant.

**Resolving**: admin marks the alert as resolved via
`/dashboard/alertas` (or `POST /api/alertas/<id>/resolve`). That writes
an entry in `alert_status_transitions`; nothing else.

## 5. On-call cheat sheet

| Situation                                    | First thing to check                                                      |
| -------------------------------------------- | ------------------------------------------------------------------------- |
| Flood of `webhook_rejected`                  | Did a TUSS catalog update just run? Table of codes vs. new `valid_to`.    |
| One tenant silent, no events                 | `signature_failure` alerts? Secret desync since their last GHL save.      |
| Report totals look wrong                     | Check for reversals in the period; view `appointments_effective`.         |
| Monthly export takes > 30 s                  | Confirm tenant-month has < 5 000 atendimentos; SC-004 threshold.          |
| Worker stuck retrying                        | Non-terminal error (5xx from Supabase). QStash will back off automatically; check Supabase status page. |
