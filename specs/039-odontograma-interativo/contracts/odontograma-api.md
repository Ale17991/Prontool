# Contract — Odontograma (prontuário do paciente)

Todas as rotas: `requireRole` server-side, `createSupabaseServiceClient` + filtro explícito de `tenant_id`, validação Zod do payload, erros via `toHttpResponse`. Timestamps UTC.

## GET `/api/pacientes/[id]/odontograma`

Retorna o estado atual do odontograma do paciente + o catálogo de status ativo (para a paleta).

- **Auth**: `requireRole(['admin','financeiro','profissional_saude'])` (leitura clínica).
- **Path**: `id` = `patient_id`.
- **Query (opcional)**: `dentition=permanent|deciduous` (filtra resposta; default ambos).

**200 Response**:

```json
{
  "patientId": "uuid",
  "current": [
    {
      "toothFdi": 16,
      "surface": "occlusal_incisal",
      "statusId": "uuid",
      "statusCode": "caries",
      "note": "cárie profunda",
      "recordedAt": "2026-06-19T12:00:00Z",
      "appointmentId": null
    }
  ],
  "catalog": [
    {
      "id": "uuid",
      "code": "caries",
      "label": "Cárie",
      "color": "#dc2626",
      "icon": null,
      "scope": "face",
      "tussCodeId": null,
      "sortOrder": 10
    }
  ]
}
```

- `current` vem da RPC `dental_chart_current`. Posições sem registro são omitidas (cliente assume "sem registro").
- `catalog` = `dental_status_catalog WHERE is_active ORDER BY sort_order`.

## POST `/api/pacientes/[id]/odontograma`

Cria uma marcação (append-only). "Limpar" = enviar `statusCode/ statusId` do status `none`.

- **Auth**: `requireRole(['admin','profissional_saude'])` (FR-021).
- **Body** (Zod):

```json
{
  "toothFdi": 16,
  "surface": "occlusal_incisal",
  "statusId": "uuid",
  "note": "opcional, <= 2000 chars",
  "appointmentId": "uuid opcional"
}
```

**Validações**:

- `toothFdi` ∈ conjunto FDI válido (`assertValidTooth`).
- `surface` ∈ enum de faces, ou ausente/null.
- Coerência escopo↔surface conforme o `scope` do status (`tooth` ⇒ surface null; `face` ⇒ surface obrigatória; `both` ⇒ qualquer). Erro **422** se violar.
- `statusId` deve existir e estar ativo. `appointmentId` (se enviado) deve pertencer ao tenant e ao paciente.

**201 Response**: a marcação criada (DTO com `id`, `toothFdi`, `surface`, `statusId`, `statusCode`, `note`, `recordedAt`, `appointmentId`, `createdBy`).

**Erros**: `400` payload inválido · `403` papel sem permissão · `404` paciente fora do tenant · `409`/`422` coerência de escopo · `500`.

## GET `/api/pacientes/[id]/odontograma/historico` _(opcional nesta fase, suporta US3)_

Histórico append-only por posição.

- **Auth**: `requireRole(['admin','financeiro','profissional_saude'])`.
- **Query**: `toothFdi` (obrigatório), `surface` (opcional).
- **200**: lista de marcações ordenadas por `recordedAt DESC` (inclui autor e status à época).

## GET `/api/dental-status`

Catálogo de status **ativo** para qualquer usuário autenticado (usado pela paleta quando carregada à parte).

- **Auth**: `authenticated` (qualquer papel logado).
- **200**: `{ "catalog": [ { id, code, label, color, icon, scope, sortOrder } ] }` (apenas `is_active`).
