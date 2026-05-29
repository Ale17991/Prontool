# Contract: Mock da API Memed

Mock HTTP usado por testes de integração e E2E. Substitui chamadas a `api.memed.com.br` (homologação e produção) por respostas determinísticas. Implementado em `tests/mocks/memed-mock-server.ts`.

## Endpoints suportados

### `POST /usuarios` — Cadastrar prescritor

**Request body esperado (FR-001)**:

```json
{
  "data": {
    "type": "usuarios",
    "attributes": {
      "external_id": "<uuid>",
      "name": "<string>",
      "surname": "<string>",
      "email": "<email>",
      "board": {
        "code": "<string>",
        "number": "<string>",
        "state": "<UF 2 letras>"
      },
      "specialty": "<string ou id>",
      "birth_date": "<YYYY-MM-DD>",
      "cpf": "<11 dígitos>"
    }
  }
}
```

**Comportamento**:

- Se TODOS os 7 campos populados (FR-001): `201 Created` com:
  ```json
  {
    "data": {
      "type": "usuarios",
      "id": "<external_id>",
      "attributes": {
        "external_id": "<external_id>",
        "token": "<jwt curto da Memed>",
        "status": "registered"
      }
    }
  }
  ```
- Se qualquer campo vazio/null: `422 Unprocessable Entity` com:
  ```json
  {
    "errors": [
      { "field": "<campo>", "message": "obrigatório" }
    ]
  }
  ```

### `GET /usuarios/{external_id}` — Recuperar token do prescritor

**Comportamento**:
- Se `external_id` previamente registrado: `200 OK` com `{ data: { attributes: { token } } }`.
- Caso contrário: `404 Not Found`.

### `GET /catalogos/especialidades` — Lista de especialidades

Retorna 5 especialidades fixas:
```json
[
  { "id": "cardiologia", "nome": "Cardiologia" },
  { "id": "pediatria", "nome": "Pediatria" },
  { "id": "clinica-geral", "nome": "Clínica Geral" },
  { "id": "ortopedia", "nome": "Ortopedia" },
  { "id": "ginecologia", "nome": "Ginecologia" }
]
```

## Headers obrigatórios em todas as requests

O mock **MUST** verificar e retornar `400` se faltar:
- `Accept: application/vnd.api+json`
- `Content-Type: application/vnd.api+json` (apenas em POST/PATCH)
- `Authorization: Bearer <token>` (HEADER, não querystring — alinha com prática moderna)

Isso garante que o client da feature 026 está enviando headers corretos.

## Iframe Memed — comportamento simulado

Para E2E, o "iframe" é um stub HTML servido pelo mock em `/iframe-stub.html` que:

1. Aceita comandos via `window.addEventListener('message', ...)`:
   - `setPaciente` — registra payload recebido em variável global `window.__lastSetPaciente`
   - `logout` — limpa estado
2. Emite eventos via `parent.postMessage(...)`:
   - `core:moduleInit` — disparado 200ms após carregar
   - `prescricaoImpressa` — disparado quando teste chama `window.__emitPrescricaoImpressa({ prescriptionId })`
   - `prescricaoExcluida` — disparado via `window.__emitPrescricaoExcluida({ prescriptionId })`
   - `setFeatureToggle` — disparado via `window.__emitFeatureToggle({ feature, enabled })`

## Limites e idempotência

- O mock é **stateful** durante uma execução de teste (mantém set de external_ids registrados).
- **Reset entre testes** via endpoint `POST /__reset` (apenas no mock, não na Memed real). Setup do Vitest/Playwright chama antes de cada teste.

## Como executar

```bash
pnpm tsx tests/mocks/memed-mock-server.ts --port 4001
# servirá em http://localhost:4001
```

Em testes, o client Memed (`src/lib/core/integrations/memed/client.ts` do spec 026) deve respeitar a env `MEMED_BASE_URL`; testes setam para `http://localhost:4001` antes de chamar.
