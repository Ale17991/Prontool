# Implementation Plan: Página do Paciente (Portal) + Módulo de Endocrinologia

**Branch**: `030-portal-paciente-endocrino` | **Date**: 2026-06-03 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/030-portal-paciente-endocrino/spec.md`

## Summary

Primeira superfície voltada ao **paciente**: um portal **somente leitura**, por clínica (`/paciente/[slug]`), onde o paciente entra com **CPF + data de nascimento (só números)** — sem criar conta — e vê seu **histórico de atendimentos** e a **evolução de métricas** (peso/IMC + metabólicas). Estrategicamente, as métricas vivem num **motor de medições genérico** (`patient_measurements`) reutilizável por outras especialidades; endocrinologia é a primeira configuração. A equipe registra as métricas metabólicas no prontuário (lado que alimenta o portal).

A autenticação leve do paciente reaproveita **integralmente** os padrões já existentes do agendamento público (feature 017): resolução de clínica por slug, busca de paciente por CPF (DEFINER que decifra), rate-limit append-only + hash de IP, e o padrão de **cookie HMAC assinado** (da cápsula OAuth GHL). **Nenhuma dependência nova.**

## Technical Context

**Language/Version**: TypeScript 5.4 sobre Node.js 20 LTS (runtime Vercel)
**Primary Dependencies**: Next.js 14.2 (App Router, RSC, Route Handlers, Server Actions), `@supabase/ssr` 0.5 / `@supabase/supabase-js` 2.45, Zod 3.23, `recharts` (já em uso), Pino 9, Tailwind/shadcn. **Sem novas deps** — sessão do paciente via **cookie HMAC-SHA256** (Node `crypto` nativo, reusando o padrão de `src/lib/integrations/ghl/oauth/state.ts`); gráficos via `recharts` já existente.
**Storage**: PostgreSQL via Supabase com RLS por `tenant_id`. **Migration nova**: `0113_patient_portal_measurements.sql` (a 0112 está **reservada pela feature 029/TISS**, ainda não mesclada — usar 0113 evita a colisão de numeração). **Tabelas novas**: `patient_measurements` (motor de medições, append-only), `patient_metric_types` (catálogo de métricas + faixas plausíveis, seed endócrino), `patient_portal_access_log` (auditoria de acesso do paciente, append-only). **Tabela tocada**: `public_booking_rate_limits` (ALTER do CHECK de `action` para incluir `'patient_login'`). **Reuso (sem schema change)**: `vital_signs` (peso/IMC/PA), `appointments` (histórico), `patients` (PII cifrada via RPC), `tenant_clinic_profile` (slug). **RPC nova**: `patient_portal_verify_login(p_slug, p_cpf, p_birthdate, p_key)` SECURITY DEFINER.
**Testing**: Vitest — contract (isolamento: paciente só vê o próprio; append-only das medições; RBAC da entrada staff; rate-limit; erro de login genérico) + integration (fluxo de login, bundle do portal, registro de métrica). `pnpm typecheck`, `pnpm lint:auth`.
**Target Platform**: Web **responsivo** (sem app nativo). Páginas do portal e endpoints rodam **server-side**; PII decifrada só no servidor; nada de credencial/segredo no browser.
**Project Type**: Web application full-stack (Next.js), estrutura existente do repositório, com **novo route group público** fora de `(dashboard)`.
**Performance Goals**: login + render do portal em ≤1 min de ponta a ponta para o paciente (SC-001); sessão sem hit de banco por request (cookie HMAC stateless).
**Constraints**: autenticação **fraca por escolha do dono** (CPF+nascimento) → mitigações OBRIGATÓRIAS (rate-limit + bloqueio, sessão curta httpOnly só-leitura, mensagens genéricas, auditoria, consentimento, IP com hash); PII server-side; paciente só-leitura e escopado a `patient_id`+`tenant_id`; timestamps UTC; isolamento multi-tenant; `lint:auth` em `/api/*`.
**Scale/Scope**: 3 tabelas novas + 1 ALTER + 1 RPC; 1 cápsula `patient-portal/`; ~5–7 Route Handlers; novo route group `paciente/[slug]`; 1 seção de entrada de métricas no prontuário (staff). Métricas endócrino seedadas: glicemia_jejum, hba1c, circunferencia_abdominal, colesterol_total, ldl, hdl, triglicerides.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Princípio | Avaliação | Como o plano atende |
|-----------|-----------|---------------------|
| **I. Integridade Financeira Imutável** | ✅ (por analogia) | Não há registro financeiro. Ainda assim, `patient_measurements` e `patient_portal_access_log` são **append-only** (trigger anti-update/delete). Correção de medição = nova linha. |
| **II. Auditabilidade Total** | ✅ | Cada **acesso do paciente** (login ok/falha, consulta) vai para `patient_portal_access_log` (append-only). Registro de métrica pela equipe emite `log_audit_event`. IP sempre com **hash** (LGPD). |
| **III. Isolamento Multi-Tenant** | ✅ | Todas as tabelas com `tenant_id` + RLS. O paciente é um principal **separado**: a sessão (cookie HMAC) carrega `patient_id`+`tenant_id` verificados; toda leitura do portal filtra por ambos via service-role. `tenant_id` **nunca** vem do cliente — é resolvido do slug no servidor. |
| **IV. Conformidade TUSS/ANS** | ✅ N/A | Não toca faturamento/TUSS. |
| **V. Segurança por Perfil (RBAC)** | ✅ | Entrada de métricas = `admin`/`profissional_saude` (requireRole + RLS). Recepcionista/financeiro **não** registram. O paciente **não** tem nenhum acesso ao painel da clínica — sessão isolada, só-leitura, escopo próprio. |
| **Domínio/LGPD/Segredos** | ⚠️→✅ com mitigações | Login CPF+nascimento é **autenticação fraca** (decisão consciente do dono). Mitigado por: rate-limit + bloqueio (reusa `public_booking_rate_limits`), sessão curta httpOnly/Secure/SameSite, mensagens genéricas (não revela se CPF existe), auditoria, consentimento, IP com hash. PII cifrada (padrão `patients` _enc). Registrado em **Complexity Tracking**. |

**Resultado**: Sem violação de princípio. O trade-off de autenticação fraca é decisão de produto documentada com mitigações (Complexity Tracking).

## Project Structure

### Documentation (this feature)

```text
specs/030-portal-paciente-endocrino/
├── plan.md              # Este arquivo
├── research.md          # Phase 0 — decisões (auth leve, motor de medições, reuso)
├── data-model.md        # Phase 1 — tabelas, RLS, triggers, seed endócrino, RPC login
├── quickstart.md        # Phase 1 — como rodar/testar o portal localmente
├── contracts/
│   ├── internal-endpoints.md   # Route Handlers (login/logout/dados do portal + entrada staff)
│   └── patient-session.md      # contrato do cookie de sessão + login verify RPC
├── checklists/
│   └── requirements.md  # checklist de qualidade da spec (já criado)
└── tasks.md             # Phase 2 (/speckit.tasks — NÃO criado aqui)
```

### Source Code (repository root)

```text
src/
├── app/
│   ├── paciente/[slug]/                         # NOVO route group PÚBLICO (fora de (dashboard))
│   │   ├── page.tsx                             # login (CPF + nascimento) + consentimento
│   │   └── painel/page.tsx                      # portal (histórico + evolução), exige sessão
│   ├── api/paciente/
│   │   ├── login/route.ts                       # POST verifica (rate-limit) e seta cookie
│   │   ├── logout/route.ts                      # POST limpa cookie
│   │   └── dados/route.ts                       # GET bundle do portal (escopo da sessão)
│   ├── api/pacientes/[id]/medicoes/route.ts     # POST registrar métrica (staff: admin/profissional)
│   └── (dashboard)/operacao/pacientes/[id]/
│       └── metabolic-metrics-section.tsx        # entrada das métricas no prontuário (staff)
├── lib/core/patient-portal/                     # CÁPSULA do portal
│   ├── session.ts                               # cookie HMAC (create/verify) — reusa padrão oauth/state
│   ├── login.ts                                 # verifyPatientLogin (RPC + rate-limit + audit)
│   ├── measurements.ts                          # listMeasurements + recordMeasurement + metric types
│   ├── read-portal.ts                           # bundle: vitals + measurements + appointments (escopo paciente)
│   ├── audit.ts                                 # log de acesso do paciente
│   └── metric-types.ts                          # config das métricas endócrino
└── supabase/migrations/
    └── 0113_patient_portal_measurements.sql

tests/
├── contract/
│   ├── patient-portal-isolation.spec.ts         # paciente só vê o próprio; outra clínica invisível
│   ├── patient-portal-login.spec.ts             # nascimento errado nega; erro genérico; rate-limit bloqueia
│   ├── patient-measurements-append-only.spec.ts # DELETE/UPDATE bloqueados
│   └── patient-measurements-rbac.spec.ts        # recepcionista/financeiro não registram
└── integration/
    ├── patient-portal-login-and-read.spec.ts    # login ok → bundle com histórico + evolução
    └── staff-record-metabolic-metric.spec.ts    # profissional registra HbA1c → aparece p/ paciente
```

**Structure Decision**: Web app full-stack. O portal vive num **route group público novo** `paciente/[slug]` (espelha `agendar/[slug]` do agendamento público), exempto do middleware de staff. A lógica vive na cápsula `src/lib/core/patient-portal/`. A **sessão do paciente** é um **cookie HMAC stateless** (sem hit de banco por request), reusando o padrão de `oauth/state.ts`; o login é verificado por uma **RPC DEFINER** que resolve a clínica pelo slug, acha o paciente por CPF e confere a data de nascimento server-side. As leituras do portal usam service-role com **filtro explícito `patient_id`+`tenant_id`** vindos da sessão verificada (nunca do cliente).

## Phasing (entrega faseada)

- **Fase A — Fundação** (bloqueante): migration 0113 (3 tabelas + ALTER rate-limit + seed métricas endócrino + RPC `patient_portal_verify_login` + triggers append-only/RLS), cápsula `session.ts` + `audit.ts`, middleware exempta `/paciente`, testes de contrato (isolamento, append-only, rate-limit). Validável: login verifica e seta cookie.
- **Fase B — US1 (P1)**: página `/paciente/[slug]` (login + consentimento) → `/painel` com **evolução de peso/IMC** (reusa vital_signs + recharts) + **métricas metabólicas** (reusa motor). Endpoint `GET /api/paciente/dados`. MVP de valor (paciente vê evolução).
- **Fase C — US2 (P1)**: seção `metabolic-metrics-section.tsx` no prontuário + `POST /api/pacientes/[id]/medicoes` (RBAC) — equipe registra glicemia/HbA1c/circunferência/lipídios. Fecha o ciclo (dados alimentam o portal). **MVP = A+B+C.**
- **Fase D — US3 (P2)**: histórico de atendimentos no portal (reusa appointments, sem financeiro).
- **Fase E — Polish**: alerta de expiração de sessão, estados vazios, acessibilidade/responsivo, revisão de segurança (vazamento de PII, mensagens genéricas), validação do quickstart.

## Complexity Tracking

> Sem violação de princípio. Decisões com trade-off explícito:

| Decisão | Por que | Alternativa rejeitada |
|---------|---------|------------------------|
| **Login CPF + data de nascimento (auth fraca)** | Decisão do dono — acesso sem fricção, sem criar conta. Mitigado por rate-limit+bloqueio, sessão curta só-leitura, mensagens genéricas, auditoria, consentimento, IP com hash. | Conta com senha/magic-link: mais seguro, mas o dono quer acesso sem conta. Fator extra (código WhatsApp) fica como **follow-up recomendado**. |
| **Sessão por cookie HMAC stateless (sem DB)** | Sem hit de banco por request; reusa padrão `oauth/state.ts`; TTL no payload. | Token em tabela (stateful, revogável): mais pesado; revogação não é crítica para visão só-leitura curta. |
| **Motor de medições genérico** (`patient_measurements`) | Reuso por nutri/pediatria depois; endócrino é só config. | Tabela específica de endócrino: viraria silo; contradiz a estratégia de módulos por especialidade. |
| **Migration 0113 (pula 0112)** | 0112 reservada pela feature 029/TISS (em voo, não mesclada) — evita colisão de numeração no merge. | Usar 0112: colisão garantida quando 029 e 030 mesclarem. |
| **Reusar `public_booking_*`** (slug, CPF, rate-limit) | Já testado, LGPD-aware (IP hash), DEFINER que decifra. | Reimplementar: retrabalho e risco. |
