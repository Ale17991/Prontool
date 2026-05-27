# Contrato — Endpoints internos (Route Handlers)

Todos: `requireRole(...)` server-side, escopo de tenant, runtime nodejs. Nenhuma resposta contém chaves/segredos Memed. Erros no formato `{ error: { code, message } }`.

## Conexão por clínica (admin)

### POST `/api/integracoes/memed` — conectar/atualizar conta
- Role: `admin`. Body: `{ environment: 'staging'|'production', api_key: string, secret_key: string }`.
- Efeito: cifra e faz upsert em `tenant_memed_config`. Para `production`, exige termo aceito.
- 200: `{ connected: true, environment }`. (Nunca devolve as chaves.)

### DELETE `/api/integracoes/memed` — desconectar
- Role: `admin`. Efeito: `connected=false`. 200: `{ connected: false }`.

### POST `/api/integracoes/memed/termo` — registrar aceite de termo
- Role: `admin`. Efeito: grava `terms_accepted_at/by`. 200: `{ accepted_at }`.

### GET `/api/integracoes/memed/especialidades` — proxy catálogo
- Role: `admin`. 200: `[{ id, nome }]` (para o seletor de de-para).

## Prescritor

### POST `/api/medicos/[id]/memed-prescritor` — habilitar profissional como prescritor
- Role: `admin`. Body: `{ memed_specialty_id?: string }`.
- Pré-condições: clínica conectada; doctor com `cpf`, `council_name`, `council_number`, `council_state`, `birth_date`. Faltando ⇒ **400** com mensagem que aponta a edição do profissional (FR-006/FR-014).
- Efeito: `POST/GET /usuarios` na Memed; upsert `memed_prescribers` (status `registered`). 200: `{ doctor_id, status }`.

### GET `/api/medicos/[id]/memed-token` — proxy de token (self/admin)
- Role: `profissional_saude` (dono, `id` = seu doctor) ou `admin`.
- Efeito: `GET /usuarios/{external_id}` na Memed; 200: `{ token }` (apenas o JWT).
- 409 se prescritor não registrado; 424 se conta não conectada.

## Atendimento / prescrição

### GET `/api/atendimentos/[id]/memed-paciente` — payload do paciente p/ setPaciente
- Role: `profissional_saude`/`admin` com acesso ao atendimento.
- Efeito: lê paciente via `get_patient_for_tenant` (decifra), mapeia `sex`→M/F. 200: payload do `setPaciente`.
- 422 se faltar campo obrigatório do paciente (lista o que falta).

### POST `/api/atendimentos/[id]/prescricoes` — registrar emissão
- Role: `profissional_saude`/`admin`. Body: `{ memed_prescription_id }`.
- Efeito: insert `prescription_records` (status `issued`, idempotente por `(tenant, memed_prescription_id)`) + `log_audit_event('prescription.issued')`. 201.

### PATCH `/api/atendimentos/[id]/prescricoes/[memedId]` — registrar exclusão
- Role: `profissional_saude`/`admin`. Body: `{ status: 'deleted' }`.
- Efeito: transição guardada `issued→deleted` + `deleted_at` + `log_audit_event('prescription.deleted')`. 200.

## Matriz RBAC (resumo p/ teste de contrato)

| Endpoint | admin | financeiro | recepcionista | profissional_saude |
|----------|:---:|:---:|:---:|:---:|
| POST/DELETE `/integracoes/memed` | ✅ | ❌ | ❌ | ❌ |
| GET `/integracoes/memed/especialidades` | ✅ | ❌ | ❌ | ❌ |
| POST `/medicos/[id]/memed-prescritor` | ✅ | ❌ | ❌ | ❌ |
| GET `/medicos/[id]/memed-token` | ✅ | ❌ | ❌ | ✅ (self) |
| GET `/atendimentos/[id]/memed-paciente` | ✅ | ❌ | ❌ | ✅ |
| POST/PATCH `/atendimentos/[id]/prescricoes` | ✅ | ❌ | ❌ | ✅ |
