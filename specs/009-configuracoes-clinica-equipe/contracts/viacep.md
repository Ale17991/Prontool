# Contract — ViaCEP Integration (External)

**Feature**: 009 | **Type**: external HTTP dependency

---

## Outbound call

**URL pattern**: `https://viacep.com.br/ws/{cep}/json/`
**Method**: `GET`
**Auth**: none (public service)
**Timeout**: 3000 ms (`AbortSignal.timeout(3000)`)

**Caller**: `GET /api/configuracoes/cep/:cep` Route Handler ONLY. The browser MUST NOT call ViaCEP directly (R3).

---

## Expected response (success)

```json
{
  "cep": "01310-100",
  "logradouro": "Avenida Paulista",
  "complemento": "de 612 a 1510 - lado par",
  "bairro": "Bela Vista",
  "localidade": "São Paulo",
  "uf": "SP",
  "ibge": "3550308",
  "gia": "1004",
  "ddd": "11",
  "siafi": "7107"
}
```

**Mapping** to internal shape:

| ViaCEP field | Internal               | Transform |
| ------------ | ---------------------- | --------- |
| `cep`        | `address.cep`          | strip `-` |
| `logradouro` | `address.street`       | trim      |
| `bairro`     | `address.neighborhood` | trim      |
| `localidade` | `address.city`         | trim      |
| `uf`         | `address.uf`           | uppercase |

`complemento` is **discarded** — internal field is user-input only.

---

## Expected response (CEP not found)

ViaCEP returns HTTP 200 with body `{ "erro": true }`.
→ Map to `{ ok: false, reason: 'not_found' }`.

---

## Failure modes

| Scenario              | Detection                 | Mapped response                        |
| --------------------- | ------------------------- | -------------------------------------- |
| Network unreachable   | `fetch` throws            | `{ ok: false, reason: 'unavailable' }` |
| Timeout (>3s)         | `AbortSignal` fires       | `{ ok: false, reason: 'timeout' }`     |
| Non-200 status        | `res.ok === false`        | `{ ok: false, reason: 'unavailable' }` |
| Invalid JSON          | `await res.json()` throws | `{ ok: false, reason: 'unavailable' }` |
| `{ erro: true }` body | check field               | `{ ok: false, reason: 'not_found' }`   |

The internal endpoint **never** returns 5xx for ViaCEP failures — the front continues with manual entry (FR-007 + edge case "CEP indisponível"). Status is always `200 OK` with `ok: false` payload, except for client errors (400 `invalid_cep`).

---

## Caching

`Cache-Control: public, s-maxage=86400, stale-while-revalidate=604800` — cached at the Vercel edge for 24 h, served stale up to 7 days.

Internal cache key: the full URL `https://viacep.com.br/ws/{cep}/json/`.

CEP volume: ≤ 100 unique CEPs per tenant per month → cache hit rate expected > 90%.

---

## No PII concern

CEP alone is not PII under LGPD (zip codes encompass thousands of addresses). The combination of CEP + name + number IS PII, but only the CEP traverses ViaCEP — name and number are typed locally and stored in `tenant_clinic_profile` only.
