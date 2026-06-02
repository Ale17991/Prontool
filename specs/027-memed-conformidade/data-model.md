# Data Model: Conformidade Memed

**Importante**: esta spec **não cria schema novo**. Todas as entidades referenciadas são criadas pelo spec 026 (`memed_prescribers`, `prescription_records`, `tenant_memed_config`). Aqui documentamos apenas as propriedades que esta spec **audita/valida**, em formato testável.

## Entidades observadas (read-only nesta spec)

### `memed_prescribers`

Vínculo 1:1 entre `doctor_id` e a identidade do prescritor na Memed.

| Propriedade auditada | Asserção | FR | Teste |
|---|---|---|---|
| `external_id = doctor_id` | Igualdade direta | FR-001 | `memed-prescriber-payload.spec.ts` |
| `status ∈ {pending, registered, error}` | Constraint CHECK no DB | FR-003 | `memed-prescribers-status-enum.spec.ts` |
| Conjunto `(tenant_id, external_id)` único | Constraint UNIQUE | (implícito) | `memed-prescribers-unique.spec.ts` |
| RLS bloqueia leitura cross-tenant | Defesa multi-tenant | Constituição III | `memed-conformity-tenant-isolation.spec.ts` |

### `prescription_records`

Cada prescrição emitida ou excluída.

| Propriedade auditada | Asserção | FR | Teste |
|---|---|---|---|
| `status ∈ {issued, deleted}` | CHECK constraint | FR-007, FR-008 | `prescription-records-status-enum.spec.ts` |
| Trigger anti-DELETE em todas as condições | `DELETE FROM ...` falha sempre | FR-008 | `memed-prescription-records-append-only.spec.ts` |
| Trigger UPDATE permite só `issued → deleted` | `UPDATE status=deleted WHERE status=issued` OK; outros falham | FR-008 | mesma spec acima |
| `memed_prescription_id` único por tenant | UNIQUE `(tenant_id, memed_prescription_id)` para idempotência | FR-006 (idempotência) | `memed-prescricaoImpressa.spec.ts` |
| `issued_at` NOT NULL quando `status=issued` | CHECK | FR-006 | `prescription-records-required-timestamps.spec.ts` |
| `deleted_at` NOT NULL quando `status=deleted` | CHECK | FR-007 | mesma |
| Linha de `audit_log` é criada em INSERT (`prescription.issued`) | Trigger ou app-layer | FR-009 | `memed-audit-events.spec.ts` |
| Linha de `audit_log` é criada em UPDATE `issued→deleted` (`prescription.deleted`) | Mesma | FR-009 | mesma |

### `tenant_memed_config`

Credenciais cifradas + ambiente.

| Propriedade auditada | Asserção | FR | Teste |
|---|---|---|---|
| `api_key_enc`, `secret_key_enc` cifradas em repouso | SELECT direto retorna ciphertext, não plaintext (verificável via `enc_text_with_key`/`dec_text_with_key`) | FR-011 | `memed-credentials-encrypted-at-rest.spec.ts` |
| `environment ∈ {homologation, production}` | CHECK constraint | (implícito) | `tenant-memed-config-env-enum.spec.ts` |
| RLS: somente `admin` do tenant pode SELECT/UPDATE | Policy | Constituição V | `memed-rbac.spec.ts` (estende matriz do spec 026) |

## Entidades auditadas em runtime (não persistidas)

### Payload do `POST /usuarios` enviado à Memed (FR-001)

Forma esperada (mock retorna 422 se faltar qualquer campo):

```json
{
  "data": {
    "type": "usuarios",
    "attributes": {
      "external_id": "<doctor.id UUID>",
      "name": "<primeiro termo de full_name>",
      "surname": "<demais termos>",
      "email": "<auth.users.email>",
      "board": {
        "code": "<doctors.council_name>",
        "number": "<doctors.council_number>",
        "state": "<doctors.council_state>"
      },
      "specialty": "<memed_specialty_id ou texto livre>",
      "birth_date": "<doctors.birth_date YYYY-MM-DD>",
      "cpf": "<doctors.cpf — 11 dígitos>"
    }
  }
}
```

### Payload do `setPaciente` no iframe (FR-004)

```json
{
  "command": "setPaciente",
  "paciente": {
    "name": "<primeiro termo de patients.full_name>",
    "surname": "<demais termos>",
    "email": "<patients.email>",
    "phone": "<patients.phone>",
    "birth_date": "<patients.birth_date>",
    "cpf": "<patients.cpf — 11 dígitos>"
  }
}
```

### Evento `prescricaoImpressa` recebido do iframe (FR-006)

```json
{
  "event": "prescricaoImpressa",
  "data": {
    "prescriptionId": "<id Memed da prescrição>",
    "pdfUrl": "<URL absoluta do PDF, opcional>"
  }
}
```

### Evento `prescricaoExcluida` recebido do iframe (FR-007)

```json
{
  "event": "prescricaoExcluida",
  "data": {
    "prescriptionId": "<id Memed da prescrição já registrada>"
  }
}
```

### Comando `setFeatureToggle` recebido do iframe (FR-016)

```json
{
  "command": "setFeatureToggle",
  "feature": "<id da feature>",
  "enabled": false
}
```

## Estados e transições — `prescription_records.status`

```text
                ┌───────────────────┐
   (criado por  │      issued       │
   prescricao-  └────────┬──────────┘
   Impressa)             │
                         │ prescricaoExcluida
                         ▼
                ┌───────────────────┐
                │     deleted       │  (terminal — append-only,
                └───────────────────┘   sem outras transições)
```

- INSERT cria sempre com `status=issued`. Não há outros estados iniciais.
- UPDATE permitido somente `issued → deleted` (validado por trigger).
- `deleted` é terminal: nem UPDATE nem DELETE.
- `issued_at` é setado no INSERT (mesmo registro); `deleted_at` é setado no UPDATE de transição.
