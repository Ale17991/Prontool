# LGPD — data retention and anonymization

How patient PII is stored, how long we keep it, and how to erase it on
request or at the end of the retention window.

## 1. What counts as PII here

Stored encrypted-at-rest (BYTEA via `pgcrypto` + a platform-owned key
in `PATIENT_DATA_ENCRYPTION_KEY`):

- `patients.full_name_enc`
- `patients.cpf_enc`
- `patients.phone_enc`
- `patients.email_enc`
- `patients.birth_date_enc`

Plus patient-authored content in `clinical_records`:

- Text records: `content` column (plain text).
- File records: `file_name`, `file_url` in Supabase Storage bucket
  `clinical-files`, with optional metadata.

Everything else on the platform (atendimentos, price history, commission
history, audit log, TUSS catalog) is administrative / financial data.
It contains foreign-key references to patients but never copies the
PII columns.

## 2. Retention policy

- **Active patients**: kept as long as the tenant is an active customer
  and has at least one atendimento referencing the patient in the past
  5 fiscal years.
- **Inactive patients** (no atendimento in the last 5 fiscal years):
  eligible for anonymization on the next scheduled sweep. The 5-year
  floor aligns with LGPD Art. 16 and CFM Resolução 1.821/2007 for
  medical records (20 years via the `clinical_records` retention, which
  continues independently — see §4).
- **Right to erasure on request** (LGPD Art. 18 VI): tenant admin can
  anonymize a specific patient at any time via the tenant endpoint
  (§3a). The request is fulfilled synchronously; evidence of the
  request should be kept by the tenant (e.g. DPO ticket number) and
  passed as the `reason` body field.

Audit-log rows for the anonymization itself are kept for the same
20-year window as clinical records, so future auditors can trace the
action back to the requester.

## 3. Anonymization procedures

### 3a. Tenant-admin, on request

Endpoint: `POST /api/pacientes/<patient_id>/anonymize`
Access: tenant `admin` role only (enforced by `requireRole`).
Body:
```json
{ "reason": "DPO ticket DPO-2026-0317" }
```
`reason` is required (≥ 10 chars) and is persisted to `audit_log.reason`
so the DPO can trace the decision later. The acting user id and tenant
id are recorded in the same row.

### 3b. Platform-operator retention sweep

Endpoint: `POST /api/platform/patients/<patient_id>/anonymize`
Access: public of tenant auth, but gated on `X-Platform-Operator-Token`
matching `PLATFORM_OPERATOR_TOKEN` via constant-time comparison.
Body:
```json
{ "tenant_id": "<uuid>" }
```
Reason is hard-coded to `lgpd-retention-anonymization`; audit row
records `actor_id=null` with `actor_label='platform-operator'`.

This endpoint exists for an operator-driven script that sweeps patients
eligible under §2. Do not wire it to any tenant-facing UI.

### What gets replaced, what stays

After either call:

| Row                                     | Before              | After                                      |
| --------------------------------------- | ------------------- | ------------------------------------------ |
| `patients.full_name_enc`                | encrypted real name | encrypted `[anonimizado]` placeholder      |
| `patients.cpf_enc`                      | encrypted CPF       | encrypted `[anonimizado]` placeholder      |
| `patients.phone_enc` / `email_enc` / `birth_date_enc` | encrypted | `NULL`                               |
| `patients.anonymized_at`                | `NULL`              | `now()`                                    |
| `clinical_records.content` (type=texto) | authored text       | `[anonimizado]`                            |
| `clinical_records.file_name` / `file_url` / `file_size_bytes` | metadata / URL to bucket | `[arquivo-removido]` / `[arquivo-removido]` / `0` |
| Storage object in `clinical-files`      | present             | removed (best effort)                      |
| `appointments.*`                        | unchanged           | **unchanged** — `patient_id` stays valid   |
| `audit_log`                             | —                   | one row with `entity='patients'`, `field='anonymized_at'`, `reason` as above |

`patient_id` is preserved because financial reports (and the append-only
atendimentos / comissão ledger) reference it. Anonymization erases the
human identity, not the ledger.

### Idempotency

A second call on an already-anonymized patient returns HTTP 409
`PATIENT_ALREADY_ANONYMIZED` without modifying anything. The audit
trail therefore only records the first successful anonymization.

### Irreversibility

The operation is irreversible. The encrypted placeholder is generated
with `enc_text_with_key(...'[anonimizado]'...)` — there is no
ciphertext anywhere that can be decrypted back to the original PII.
Backups of the row from before anonymization should be purged per the
backup retention policy (TODO: document once the backup pipeline is
in place — T157).

## 4. Clinical records retention

Clinical records that belong to an anonymized patient are anonymized
alongside the patient (§3). The row itself stays in the table so the
tenant's medical-record audit trail remains intact (CFM Resolução
1.821/2007 requires a 20-year retention for the metadata — dates,
author, type — even when content is erased).

## 5. Audit log retention

- Retention: 20 years (aligned with clinical-record retention).
- RLS: tenant admins can `SELECT` their own tenant's rows; no one can
  `UPDATE` or `DELETE` (enforced by `enforce_append_only` trigger on
  `audit_log`).
- Contents never include decrypted PII. `old_value` / `new_value` on
  the patient anonymization row carries the *timestamp*, not the name.

## 6. Environment / configuration

- `PATIENT_DATA_ENCRYPTION_KEY` — 32-byte hex. Owned by the platform,
  same value across prod and staging (rotating it invalidates every
  encrypted column). Rotation, when it finally happens, requires a
  re-encryption migration.
- `PLATFORM_OPERATOR_TOKEN` — 32+ chars, platform-owned. The route
  rejects comparison with `< 32` chars to make sure no one accidentally
  ships a weak secret to production.
- Both secrets live in the deployment-platform vault, never in the
  repo.

## 7. DPO contact and record-of-processing

Out of scope for this doc — the tenant's DPO workflow lives outside the
platform. This file documents only the platform-side procedures and
endpoints the operations team is responsible for running.
