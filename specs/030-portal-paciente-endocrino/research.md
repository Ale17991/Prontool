# Phase 0 — Research: Portal do Paciente + Endocrinologia

Decisões técnicas (Decisão / Justificativa / Alternativas), ancoradas no mapeamento do código existente.

## R1. Autenticação leve do paciente (CPF + data de nascimento)

- **Decisão**: RPC `patient_portal_verify_login(p_slug, p_cpf, p_birthdate, p_key)` **SECURITY DEFINER** que: resolve a clínica pelo slug, acha o paciente por CPF (decifrando `cpf_enc`), confere a `birth_date_enc` (só dígitos), e retorna `patient_id`+`tenant_id`+nome se casar e não anonimizado. Chamada server-side com service-role + `PATIENT_DATA_ENCRYPTION_KEY`.
- **Justificativa**: reusa o padrão já testado de `public_booking_find_patient_by_cpf` (feature 017, migration 0093) que já decifra CPF server-side; encapsular slug+CPF+nascimento numa RPC evita confiar em `tenant_id` do cliente.
- **Alternativas**: reusar `public_booking_find_patient_by_cpf` direto + verificar nascimento em TS — funciona, mas exige uma 2ª RPC para decifrar o nascimento; a RPC única é mais limpa e atômica.
- **Mitigações obrigatórias** (auth fraca): rate-limit + bloqueio, mensagens genéricas, sessão curta, auditoria, consentimento (ver R3/R4).

## R2. Sessão do paciente (cookie)

- **Decisão**: **cookie HMAC-SHA256 stateless** reusando o padrão de `src/lib/integrations/ghl/oauth/state.ts` (`createStateCookie`/`verifyStateCookie`). Payload `{ patientId, tenantId, iatMs, expMs }`, assinado com segredo de servidor; cookie `httpOnly; Secure; SameSite=Strict; Path=/; Max-Age≈1800` (30 min).
- **Justificativa**: sem hit de banco por request; TTL no payload; padrão já existe no projeto (constant-time compare). Visão é só-leitura e curta → revogação instantânea não é crítica.
- **Alternativas**: token em tabela (stateful, revogável) — mais pesado, desnecessário aqui. JWT Supabase de paciente — exigiria criar usuário em `auth.users` (o dono pediu **sem conta**).
- **Segredo**: usar um segredo dedicado de env (ex.: `PATIENT_SESSION_SECRET`) **ou** o `SUPABASE_JWT_SECRET` existente. *Decisão p/ tasks*: env dedicado, para não acoplar à rotação do segredo do Supabase.

## R3. Rate-limit / anti-força-bruta

- **Decisão**: reusar `public_booking_rate_limits` + `checkRateLimit`/`bumpRateLimit` (`src/lib/core/public-booking/rate-limit.ts`) + `hashIpForTenant` (IP nunca em claro). **ALTER** do CHECK de `action` para incluir `'patient_login'`. Limite sugerido: 5 tentativas / 15 min por (IP×clínica) e por (CPF×clínica).
- **Justificativa**: tabela append-only já LGPD-aware (IP com hash); helpers prontos.
- **Alternativas**: tabela nova de rate-limit — duplicação desnecessária.

## R4. Auditoria de acesso do paciente

- **Decisão**: tabela nova `patient_portal_access_log` (append-only): tenant, patient (nullable em falha), ação (`login_ok`/`login_fail`/`view`), ip_hash, user_agent, timestamp. Não usa `audit_log` (que é centrado em ator-usuário da equipe); acesso de paciente é principal distinto.
- **Justificativa**: rastreabilidade LGPD do acesso do paciente sem poluir o audit da equipe.

## R5. Motor de medições longitudinais

- **Decisão**: tabela genérica `patient_measurements` (tenant, patient, `metric_type`, `value NUMERIC`, `unit`, `measured_at DATE`, notes, autor) **append-only** + catálogo `patient_metric_types` (metric_type, label, unit, faixas plausíveis, specialty, ordem). Endocrino é seed de `patient_metric_types`.
- **Justificativa**: a peça estratégica — qualquer especialidade vira configuração; correção = nova linha (Princípio I). Peso/IMC/PA continuam em `vital_signs` (não duplicar) e o portal **une** as duas fontes na leitura.
- **Métricas endócrino (seed)**: `glicemia_jejum` (mg/dL, 20–600), `hba1c` (%, 2–20), `circunferencia_abdominal` (cm, 30–250), `colesterol_total` (mg/dL, 50–800), `ldl` (mg/dL, 10–600), `hdl` (mg/dL, 5–200), `triglicerides` (mg/dL, 20–5000). *Faixas plausíveis a revisar clinicamente nas tasks.*
- **Alternativas**: estender `vital_signs` com colunas de glicemia/HbA1c/etc. — viraria especialidade-específico e não escala para outras (silo).

## R6. Leitura escopada ao paciente (sem JWT de staff)

- **Decisão**: endpoints do portal usam **service-role** + filtro explícito `patient_id`+`tenant_id` vindos **da sessão verificada** (cookie HMAC). PII (nome) via `get_patient_for_tenant`. Padrão idêntico ao do agendamento público.
- **Justificativa**: não há `jwt_tenant_id()` para o paciente; a RLS de staff não se aplica. O escopo é garantido **no código** a partir da sessão assinada (cliente nunca informa patient_id/tenant_id cru).
- **Risco/verificação**: todo endpoint do portal DEVE derivar patient_id/tenant_id **só** do cookie verificado — coberto pelo teste de isolamento.

## R7. Roteamento e middleware

- **Decisão**: novo route group público `src/app/paciente/[slug]/` (espelha `agendar/[slug]`). Exemptar `/paciente` no `src/middleware.ts` (mesmo bloco de `/agendar`). A sessão do paciente é verificada **na página/endpoint**, não no middleware de staff.
- **Justificativa**: separa totalmente o paciente do login da equipe.

## R8. Reuso de evolução de peso/IMC (recharts)

- **Decisão**: extrair a lógica de gráfico de `vital-signs-section.tsx` para um componente reutilizável (sem o formulário de entrada, que é staff) e usar no portal; ler via `listVitalSigns` (escopo paciente).
- **Justificativa**: o gráfico de peso/PA já existe; o portal só consome (read-only).
