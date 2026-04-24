# Phase 0 Research: Faturamento Médico GHL/Homio

**Date**: 2026-04-16
**Feature**: [spec.md](./spec.md)
**Plan**: [plan.md](./plan.md)

This document resolves every technical unknown introduced by the user's
suggested stack and by the spec's clarifications, and records rejected
alternatives so future readers understand why the chosen path exists.

---

## R1. Backend: Express separado vs Next.js Route Handlers unificados

**Decision**: Next.js 14 Route Handlers (App Router `src/app/api/*`).
Express é removido.

**Rationale**:
- Vercel hospeda Next.js nativamente; Express rodando na Vercel usa o mesmo
  runtime Node.js — dois frameworks no mesmo processo não entregam valor.
- Route Handlers dão file-based routing type-safe, compartilham middleware
  (auth, tenant scoping, logging) com páginas SSR, e eliminam um processo
  de build/deploy.
- Shared core library em `src/lib/core/*` é chamada tanto das Server
  Actions quanto dos Route Handlers → evita duplicação entre frontend e
  "backend Express".
- Constitution não exige separação física frontend/backend; Principle III
  (isolamento) e Principle V (RBAC) são atendidos em qualquer topologia
  desde que server-side.

**Alternatives considered**:
- **Express em Render/Fly.io** (fora da Vercel): dobra o deploy pipeline,
  adiciona latência cross-region DB→backend→Vercel, exige sincronização de
  env vars em dois ambientes. Rejeitado.
- **Next.js + tRPC**: adiciona camada type-safe entre cliente e servidor,
  mas aumenta curva de aprendizado e complica testes de contrato. Podemos
  adotar depois se necessário. Rejeitado para v1.
- **Supabase Edge Functions para toda a API**: runtime Deno/Rust, limita
  ecossistema de libraries (ex.: `@react-pdf/renderer` não suporta Deno
  out-of-box). Rejeitado como fonte primária; usado apenas em pontos
  específicos se necessário.

**Impact on user's stated preference**: o usuário pediu "Node.js com
Express no backend". Sinalizado na seção Summary do plan.md como
simplificação. Revert é trivial se stakeholders insistirem.

---

## R2. Fila de processamento para o modelo híbrido de webhook (FR-008a–d)

**Decision**: **Upstash QStash**.

**Rationale**:
- Modelo HTTP-native: QStash recebe um evento via HTTP POST, enfileira, e
  entrega via HTTP POST para um callback URL — casa perfeitamente com
  Vercel serverless (não precisa de worker long-running).
- Retries com backoff exponencial + DLQ nativos, sem código.
- Assinatura HMAC verificável no endpoint consumidor
  (`src/app/api/workers/process-ghl-event/route.ts`) → impede replay e
  chamadas não autorizadas.
- Região São Paulo (`sa-east-1`) disponível → latência baixa.
- Pricing previsível (pay-per-message).

**Alternatives considered**:
- **Inngest**: mais recursos (step functions, fan-out), mas SDK
  proprietário que abstrai demais o controle de retry e DLQ. Rejeitado.
- **Trigger.dev**: similar ao Inngest, curva de aprendizado maior.
  Rejeitado.
- **Supabase pgmq + pg_cron**: fila embarcada no Postgres; elegante, mas
  `pg_cron` roda dentro do Postgres e não consegue invocar endpoints
  externos por si só — precisaria de um worker HTTP externo, o que anula
  a simplicidade. Podemos revisitar se a Supabase lançar invocação direta
  de Edge Function a partir do pgmq.
- **AWS SQS**: overkill; requer IAM setup e SDK AWS na Vercel.

**Impact on user's stated preference**: o usuário disse "Arquitetura
escalável com filas para processamento de webhooks (DLQ incluído)", sem
especificar fornecedor. QStash atende plenamente.

---

## R3. Biblioteca Excel: `xlsx` vs `exceljs`

**Decision**: **exceljs**.

**Rationale**:
- `xlsx` (SheetJS Community) tem CVEs abertos (CVE-2023-30533 "prototype
  pollution", CVE-2024-22363 "regex DoS") e a partir da v0.20.x é
  distribuído apenas via CDN próprio da SheetJS — deixou de estar no
  registro público do npm em versão estável. Isso cria risco de supply
  chain e dor operacional.
- `exceljs` é MIT, ativamente mantido (última release em 2025), suporta
  streaming, permite formatação rica, e está no npm.
- Performance para 5 k linhas (SC-004) é confortavelmente suficiente em
  ambos.

**Alternatives considered**:
- `xlsx-populate`: maduro mas menos features; sem streaming.
- SheetJS Pro (comercial): custo; não justificado.

**Impact on user's stated preference**: o usuário especificou `xlsx`.
Divergência registrada na seção Summary do plan.md. Trade-off é
segurança > familiaridade.

---

## R4. PDF rendering server-side

**Decision**: **@react-pdf/renderer** (conforme sugerido pelo usuário).

**Rationale**:
- Runtime Node.js puro; compatível com Vercel serverless.
- Declarativo via componentes React → alinhado com o restante do stack.
- Cold start aceitável (~300 ms adicionais na primeira execução); reports
  de até 5 k linhas cabem no timeout de 60 s.

**Alternatives considered**:
- **Puppeteer/Playwright headless Chrome**: bundle size ~200 MB, cold
  start de 3–5 s em serverless, custo de memória alto. Rejeitado.
- **pdfkit**: API imperativa, menos ergonômica. Rejeitado.
- **wkhtmltopdf via binário**: impraticável em Vercel serverless.

---

## R5. Catálogo TUSS — fonte e ingestão

**Decision**: Script de seed que clona/baixa
`github.com/charlesfgarcia/tabelas-ans` em horário de onboarding da
plataforma, parseia os arquivos TUSS, e popula a tabela global
`tuss_codes`. Versões são rastreadas em `tuss_catalog_versions` (snapshot
com hash do conteúdo) para disparar alerta quando divergência for detectada
(FR — "Divergência no catálogo TUSS global" em Edge Cases do spec).

**Rationale**:
- Repositório é o que o usuário indicou.
- Ingestão controlada por operador da plataforma atende Principle IV
  (catálogo não editável por tenant).

**FOLLOW-UP TODO (bloqueia Phase 2 / tasks)**:
- **Validar** licença de `charlesfgarcia/tabelas-ans` antes da primeira
  importação — GitHub público não implica direito de redistribuição; a
  TUSS é publicada pela ANS e pode ter condições.
- **Validar** frequência de atualização do repositório e formato
  (CSV/JSON/XML) para dimensionar o parser do seed.
- **Contingência**: se repositório ficar obsoleto, ingestão via PDF
  oficial da ANS ou API do padrão TISS (protocolado com ANS).

**Alternatives considered**:
- **Scraping direto da ANS**: frágil, risco de bloqueio.
- **Importação manual via UI**: não escala e afronta Principle IV
  (requer operador central).

---

## R6. Multi-tenant via Supabase RLS (Principle III)

**Decision**: Três camadas de defesa:

1. **JWT claims**: Supabase Auth emite JWT com `tenant_id` (UUID) e `role`
   como custom claims, populados via Auth Hook (`after_login`) que consulta
   a tabela `user_tenants` (user → tenant + role).
2. **RLS policies**: toda tabela de tenant possui
   ```sql
   CREATE POLICY tenant_isolation ON <table>
     USING (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);
   ```
   Onde o papel também importa, policy adicional cruza role (ex.:
   `price_versions` write só para `role IN ('admin')`).
3. **Contract tests**: `tests/integration/tenant-isolation.spec.ts` tenta
   todas as operações (read, write, join, export) como tenant B
   referenciando recursos de tenant A — todas MUST falhar.

**Service-role usage**: chave `SUPABASE_SERVICE_ROLE_KEY` é usada em
**dois pontos apenas**:
- Webhook ingestion endpoint (`/api/webhooks/ghl`): insere no
  `raw_webhook_events` dentro de uma transação que abre com
  `SET LOCAL app.tenant_id = <derivado do secret>` e usa policies que
  respeitam essa variável. Nenhum dado de tenant é lido/escrito fora do
  escopo identificado.
- Worker de processamento (`/api/workers/process-ghl-event`): mesmo
  padrão — `SET LOCAL` com o `tenant_id` do evento.

**Rationale**: Principle III exige defesa em camadas e isolamento
rigoroso; service-role bypass é contido ao canal mínimo necessário para
funcionalidade de ingestão.

**Alternatives considered**:
- **Schema-per-tenant**: inviável para 10+ clínicas (explosão de DDL).
- **Aplicação-side filtering sem RLS**: rejeita Principle III diretamente
  (camada única).

---

## R7. Append-only enforcement (Principle I)

**Decision**: Dois mecanismos em defesa em camadas:

1. **GRANT/REVOKE**: role `app_user` recebe apenas `SELECT, INSERT` em
   tabelas financeiras (`appointments`, `appointment_reversals`,
   `price_versions`, `audit_log`, `doctor_commission_history`). `UPDATE`
   e `DELETE` nunca são concedidos a este role.
2. **Trigger de guarda**: `BEFORE UPDATE OR DELETE` em cada tabela
   financeira que levanta exceção:
   ```sql
   CREATE OR REPLACE FUNCTION enforce_append_only()
   RETURNS trigger LANGUAGE plpgsql AS $$
   BEGIN
     RAISE EXCEPTION 'Append-only table: % mutation forbidden (op=%)',
       TG_TABLE_NAME, TG_OP;
   END $$;
   ```
   Trigger dispara mesmo se alguém inadvertidamente der grant — protege
   contra erro humano em DBA.

**Rationale**: Principle I é NON-NEGOTIABLE. Um único mecanismo falha
silenciosamente quando revogado; dois mecanismos exigem falha coordenada.

**Impacto em migrações**: migrações schema (ex.: adicionar coluna) exigem
entrada via role `supabase_admin` (service-role), explicitamente excluída
pelo trigger usando `SESSION_USER = 'supabase_admin'` como exceção
documentada.

---

## R8. Audit log implementation (Principle II)

**Decision**: Trigger `AFTER INSERT` em cada tabela de escrita-rastreada
(`price_versions`, `procedures`, `doctor_commission_history`,
`appointment_reversals`, etc.) que insere linha em `audit_log`. Contexto
por sessão (`current_setting('app.actor_id')`, `current_setting('app.ip')`,
`current_setting('app.user_agent')`) é populado pelo Route Handler antes
de qualquer INSERT, usando `SET LOCAL`.

**Rationale**:
- Trigger não pode ser bypassed por bug na aplicação — Principle II
  prevê auditabilidade total.
- Campos obrigatórios (ator, timestamp UTC, tenant, entidade, campo,
  valor anterior, valor novo, motivo, IP, user-agent) são capturados no
  trigger a partir dos valores OLD/NEW.

**Campos especiais**:
- Tentativas de acesso **negadas** (RBAC, optimistic concurrency failure)
  não passam por INSERT no domínio → gravadas via chamada explícita do
  Route Handler ao helper `audit.deny()` que insere em `audit_log` sem
  valor anterior/novo, com `result='denied'` e motivo detalhado.

**Alternatives considered**:
- Application-level audit apenas: deixa brecha se alguém esquecer de
  chamar. Rejeitado.
- CDC (logical replication) para tabela externa de auditoria: complexa
  demais para v1; revisitar em escala.

---

## R9. Optimistic concurrency para edição de preço (FR-005a/b)

**Decision**: **Chain head token**.

- Cada combinação (tenant, procedure, plan) forma uma **chain** de
  versões; a head é a linha de `price_versions` com o maior `valid_from`
  ≤ hoje (ou a última criada se `valid_from` futura).
- Ao abrir o form de edição, o servidor retorna `head_version_id`
  (UUID da linha atual).
- Ao submeter nova versão, o cliente envia `expected_head_id`; o servidor
  executa INSERT dentro de uma transação que valida:
  ```sql
  SELECT id FROM price_versions
  WHERE tenant_id = $1 AND procedure_id = $2 AND plan_id = $3
  ORDER BY created_at DESC LIMIT 1 FOR UPDATE;
  ```
  Se o id retornado ≠ `expected_head_id`, ROLLBACK e retorna HTTP 409 com
  mensagem "outra alteração ocorreu; recarregue e revise" (FR-005a).
- UNIQUE constraint adicional em
  `(tenant_id, procedure_id, plan_id, valid_from)` impede colisão exata
  mesmo se a verificação de chain head falhar (belt-and-suspenders).

**Rationale**:
- Compatível com modelo append-only (nunca atualiza linha; apenas insere
  nova versão).
- Clearer UX: admin sabe que precisa ver o que o colega fez antes de
  retentar.
- 409 registrado na trilha de auditoria via `audit.deny()` (FR-005b).

**Alternatives considered**:
- `updated_at`-baseado: `price_versions` é append-only, não tem
  `updated_at` semanticamente. Rejeitado.
- Lock pessimista: exige serviço stateful (Redis distributed lock) ou
  advisory locks no Postgres; cria filas operacionais. Rejeitado.

---

## R10. E-mail transacional para alertas (FR-033–37, SC-012)

**Decision**: **Resend**.

**Rationale**:
- API Node SDK simples, integração Vercel first-class.
- Domínio verificável via DNS DKIM/SPF.
- Pricing previsível (10 k e-mails/mês no free tier, suficiente para v1).
- Suporta templates React (`react-email`) — alinhado com Next.js.
- Data residency EU/US configurável; LGPD mitigada por não enviar dados
  sensíveis no corpo do e-mail (FR-037).

**Alternatives considered**:
- **Postmark**: similar, US-only data center, sem SDK tão moderno.
- **AWS SES**: IAM complexo, setup SNS para bounces.
- **Supabase Email Sending**: apenas para autenticação, não permite
  e-mails arbitrários.

---

## R11. Idempotência de webhook (FR-014, SC-007)

**Decision**: Tabela `raw_webhook_events` com `UNIQUE(tenant_id, ghl_event_id)`.
O endpoint tenta `INSERT ... ON CONFLICT DO NOTHING RETURNING id`.

- Se `id` retornar: evento novo, gravado; enfileirar para processamento
  semântico.
- Se nada retornar: duplicata; apenas responder 200 com flag
  `duplicate=true` no corpo (para telemetria; GHL ignora o corpo).

Além disso, o consumidor worker usa o mesmo `raw_event_id` como chave de
idempotência ao criar o atendimento (INSERT em `appointments` referencia
`raw_event_id` com UNIQUE constraint) → mesmo que o worker seja chamado
duas vezes para o mesmo evento por falha de fila, o atendimento é criado
uma única vez.

**Rationale**: duas barreiras (ingestão + processamento) garantem SC-007
a 100% sob qualquer cenário de reentrega.

---

## R12. Testing stack

**Decision**:
- **Vitest** para unit + integration (rápido, ESM-native, compatível com
  TypeScript 5).
- **Playwright** para E2E (fluxos admin).
- **Supabase CLI local** (Docker) como backing store real para
  integration tests — **nunca mocks de DB** (reforça Principle I:
  constitutional review exige integration tests contra schema real para
  validar append-only triggers, RLS, audit).
- **MSW (Mock Service Worker)** apenas para mockar chamadas externas:
  GHL, QStash, Resend. Nunca o DB.

**Test matrix** (derivado do constitution Section 3):
| Área | Tipo de teste | Obrigatório |
|------|---------------|-------------|
| Endpoints de preço/atendimento | Contract (OpenAPI) | Sim |
| Multi-tenant | Isolation (tenant A tenta acessar tenant B) | Sim |
| RBAC | Role × endpoint matrix | Sim |
| Append-only | Trigger (tentar UPDATE/DELETE) | Sim |
| Auditoria | Trigger (INSERT em price_versions gera audit_log) | Sim |
| Reversão | Reversão + relatório líquido | Sim |
| Relatório | Snapshot de valores congelados sob alteração de preço | Sim |

---

## R13. Campos pessoais criptografados (FR-010a, SC-011)

**Decision**: `pgcrypto` em nível de coluna para `patients.cpf`,
`patients.full_name`, `patients.phone`, `patients.email`,
`patients.birth_date`. Chave mestra em Vercel env var
`PATIENT_DATA_ENCRYPTION_KEY` rotacionável. Funções SQL wrappers:
`enc_text(plain) → bytea`, `dec_text(cipher) → text` (chamada apenas via
views com RLS).

Logging: `pino` com redaction list contendo
`req.body.patient.*`, `patient.cpf`, `patient.full_name` para garantir
SC-013.

**Alternatives considered**:
- **Supabase Vault (pgsodium)**: alinhado, mas API ainda em beta em
  algumas regiões. Revisitar quando GA.
- **Aplicação-side (Node crypto)**: mais flexível mas mistura camadas; a
  abordagem no banco é consistente com Principle I (DB é guardião).

---

## R14. Configuração por tenant (custom fields GHL, etapa-gatilho)

**Decision**: Tabela `tenant_ghl_config` com colunas:
- `tenant_id` (FK)
- `webhook_secret` (criptografado)
- `trigger_stage_name` (texto exato vindo do GHL)
- `field_map_plano` (nome do custom field GHL que contém o plano)
- `field_map_procedimento_tuss`
- `field_map_medico_identifier`
- `field_map_patient_*` (nome, CPF, telefone, email, data nasc.)
- `field_map_appointment_timestamp`

**Rationale**: Assumptions da spec declaram que esses nomes variam por
clínica. Preenchidos durante onboarding por operador da plataforma.

---

## Unresolved clarifications — resultado

Todos os `NEEDS CLARIFICATION` pendentes foram resolvidos:

| Questão | Resolução |
|---------|-----------|
| Next.js vs Express | R1 — Next.js unificado |
| Fila para webhook híbrido | R2 — Upstash QStash |
| xlsx vs exceljs | R3 — exceljs |
| TUSS import source | R5 — `charlesfgarcia/tabelas-ans` com follow-up de licença |
| Multi-tenant mecanismo | R6 — RLS + JWT claims + contract tests |
| Append-only enforcement | R7 — GRANT + trigger |
| Audit implementation | R8 — DB trigger |
| Optimistic concurrency model | R9 — chain head token + UNIQUE |
| E-mail provider | R10 — Resend |
| Idempotência | R11 — UNIQUE em raw_webhook_events + em appointments |
| Testing stack | R12 — Vitest + Playwright + Supabase local |
| Encryption em paciente | R13 — pgcrypto coluna + pino redaction |
| Config por tenant | R14 — tabela `tenant_ghl_config` |

## Deferred items (não bloqueantes para Phase 2)

- **Scale assumptions at launch** (tenant count, peak webhook rate
  agregado) — revisitar antes de provisionar QStash e Supabase tier.
- **Uptime SLO comercial** (99.0? 99.5?) — decisão de produto, não
  técnica.
- **Accessibility/localization** (apenas pt-BR para v1; WCAG AA como
  alvo) — refinar em UI specs.
- **Retenção de audit_log** — política LGPD indica mínimo 5 anos para
  dados de saúde; confirmar com legal.
