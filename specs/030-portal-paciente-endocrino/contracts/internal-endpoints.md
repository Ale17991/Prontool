# Contract — Route Handlers (Portal do Paciente + entrada staff)

## Portal do paciente (público, sessão própria — NÃO usa requireRole de staff)

- `POST /api/paciente/login` — Body: `{ slug, cpf, birthdate }` (birthdate = só dígitos, ex.: `15051990`).
  - **Rate-limit** por IP×slug e CPF×slug (reusa `public_booking_rate_limits`, action `patient_login`); excedeu → **429** com `retryAfter`.
  - Chama `patient_portal_verify_login`. **Casou** → grava `login_ok`, seta cookie HMAC (`httpOnly; Secure; SameSite=Strict; ~30min`), **200** `{ ok: true }`. **Não casou** → grava `login_fail`, **401** com mensagem **genérica** (`"CPF ou data de nascimento inválidos."` — sem revelar se o CPF existe).
- `POST /api/paciente/logout` — limpa o cookie. **200**.
- `GET /api/paciente/dados` — exige cookie de sessão válido (senão **401**). Deriva `patient_id`+`tenant_id` **só do cookie**. Retorna o bundle:
  ```
  { patient: { firstName }, weightImc: [...], metrics: { hba1c:[...], glicemia_jejum:[...], ... }, appointments: [...] }
  ```
  Registra `view` no access log. **Nunca** aceita patient_id/tenant_id do cliente.

> Segurança: todos os endpoints `/api/paciente/*` derivam identidade **exclusivamente** do cookie HMAC verificado. Mensagens de falha são genéricas. PII decifrada server-side; só `firstName` e dados clínicos do próprio paciente saem.

## Entrada de métricas (staff — requireRole)

- `POST /api/pacientes/[id]/medicoes` — `requireRole(['admin','profissional_saude'])`. Body: `{ metric_type, value, unit?, measured_at, notes? }`.
  - Valida `metric_type` ∈ catálogo e `value` na faixa plausível → **422** com mensagem clara se inválido.
  - Insere em `patient_measurements` (append-only) + `log_audit_event`. **201** `{ id }`.
  - Recepcionista/financeiro → **403** (audit deny).

## Códigos de status

- 401 sessão de paciente ausente/expirada ou login inválido (genérico); 403 papel staff não autorizado; 422 validação de métrica; 429 rate-limit; 200/201 sucesso.
