# API Contract — Periograma

Todas as rotas: `runtime = nodejs`, `dynamic = force-dynamic`, `requireRole` + `createSupabaseServiceClient`, erros via `toHttpResponse`. Base: `/api/pacientes/[id]/periograma`. `[id]` = patientId.

Papéis: leitura = `admin|financeiro|recepcionista|profissional_saude`; escrita = `admin|profissional_saude`.

---

## GET `/api/pacientes/[id]/periograma`

Lista os exames do paciente (mais recentes primeiro) com indicadores resumidos.

**200**:

```json
{
  "exams": [
    {
      "id": "uuid",
      "examDate": "2026-06-20",
      "status": "finalizado",
      "dentition": "permanent",
      "finalizedAt": "2026-06-20T13:00:00Z",
      "indicators": { "bopPct": 18.5, "pocketsGe4": 7, "pocketsGe4Pct": 4.1, "calAvgMm": 2.3 }
    }
  ],
  "draftId": "uuid|null"
}
```

## POST `/api/pacientes/[id]/periograma` _(escrita)_

Cria um exame em **rascunho**. Falha se já existir rascunho para o paciente.

**Body**: `{ "examDate"?: "YYYY-MM-DD", "dentition"?: "permanent|deciduous", "appointmentId"?: "uuid|null", "notes"?: "string|null" }`
**201**: `{ "id": "uuid" }`
**409** `DRAFT_EXISTS`: já há um rascunho aberto (retorna `{ error, draftId }`).

## GET `/api/pacientes/[id]/periograma/[examId]`

Exame completo: header + medições + achados + indicadores.

**200**:

```json
{
  "exam": {
    "id": "uuid",
    "examDate": "2026-06-20",
    "status": "rascunho",
    "dentition": "permanent",
    "notes": null,
    "appointmentId": null
  },
  "measurements": [
    {
      "toothFdi": 16,
      "site": "mb",
      "probingDepthMm": 3,
      "recessionMm": 1,
      "calMm": 4,
      "bleeding": true,
      "suppuration": false,
      "plaque": false
    }
  ],
  "findings": [
    { "toothFdi": 16, "mobility": 1, "furcation": null, "isMissing": false, "isImplant": false }
  ],
  "indicators": {
    "sitesMeasured": 168,
    "bopPct": 18.5,
    "pocketsGe4": 7,
    "pocketsGe4Pct": 4.1,
    "calAvgMm": 2.3
  }
}
```

## PATCH `/api/pacientes/[id]/periograma/[examId]` _(escrita, só rascunho)_

Salva em lote células alteradas (upsert). Aceita medições e/ou achados e/ou metadados do header.

**Body**:

```json
{
  "measurements": [
    {
      "toothFdi": 16,
      "site": "mb",
      "probingDepthMm": 3,
      "recessionMm": 1,
      "bleeding": true,
      "suppuration": false,
      "plaque": false
    }
  ],
  "findings": [
    { "toothFdi": 16, "mobility": 1, "furcation": null, "isMissing": false, "isImplant": false }
  ],
  "notes": "opcional"
}
```

Validação Zod: `probingDepthMm` 0–15; `recessionMm` −5..+15; `site ∈ {db,b,mb,dl,l,ml}`; `toothFdi` FDI válido; `mobility` 0–3; `furcation` 1–3.
**200**: `{ "ok": true, "indicators": { ... } }`
**409** `EXAM_FINALIZED`: exame não está em rascunho.

## POST `/api/pacientes/[id]/periograma/[examId]/finalizar` _(escrita)_

Transição `rascunho → finalizado` (congela). Carimba `finalizedAt/by`.
**200**: `{ "status": "finalizado", "finalizedAt": "..." }`
**409** `INVALID_TRANSITION`: já finalizado / transição inválida.

## DELETE `/api/pacientes/[id]/periograma/[examId]` _(escrita)_

Descarta um **rascunho**. Bloqueado se finalizado.
**200**: `{ "ok": true }`
**409** `EXAM_FINALIZED`: não é possível excluir exame finalizado.

## GET `/api/pacientes/[id]/periograma/comparar?from={examId}&to={examId}`

Compara dois exames finalizados.

**200**:

```json
{
  "from": {
    "id": "uuid",
    "examDate": "2026-03-01",
    "indicators": { "bopPct": 32.0, "pocketsGe4": 15, "calAvgMm": 3.1 }
  },
  "to": {
    "id": "uuid",
    "examDate": "2026-06-20",
    "indicators": { "bopPct": 18.5, "pocketsGe4": 7, "calAvgMm": 2.3 }
  },
  "sites": [
    {
      "toothFdi": 16,
      "site": "mb",
      "fromPd": 5,
      "toPd": 3,
      "deltaPd": -2,
      "fromBleeding": true,
      "toBleeding": false
    }
  ],
  "deltas": { "bopPct": -13.5, "pocketsGe4": -8, "calAvgMm": -0.8 }
}
```

**400** `NEED_TWO_EXAMS`: menos de dois exames / IDs iguais / não finalizados.

---

## Contract tests (resumo)

- Criar 2º rascunho → 409 `DRAFT_EXISTS`.
- PATCH em exame finalizado → 409 `EXAM_FINALIZED` (e bloqueio no trigger).
- PATCH com `probingDepthMm=20` → 400 (Zod) e CHECK no banco.
- Finalizar duas vezes → 2ª retorna 409 `INVALID_TRANSITION`.
- DELETE de finalizado → 409.
- Isolamento: acessar exame de outro tenant → 404/forbidden.
- RBAC: papel não-clínico em POST/PATCH/finalizar → 403.
