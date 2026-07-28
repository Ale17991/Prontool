# Implementation Plan: Lembretes de consulta por WhatsApp

**Branch**: `051-whatsapp-evolution` | **Date**: 2026-07-28 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/051-whatsapp-evolution/spec.md`

## Summary

Acrescentar WhatsApp como canal do motor de lembretes da feature 018, que hoje só sai por
e-mail. O envio acontece através de um serviço separado já existente (repo
`Homio-CRM/clinni-whatsapp`, Supabase + Edge Functions sobre a Evolution API), com um número por
clínica conectado por QR Code em autoatendimento.

Do lado do Clinni, isso é: uma cápsula `src/lib/core/whatsapp/` com tabela dedicada de conexão
(seguindo o precedente da Memed, **não** o registry de `IntegrationAdapter` — ver D1),
parametrização de canal no motor de lembretes existente, uma rota pública de callback para as
confirmações de entrega, e espaçamento dos envios via QStash para não disparar em rajada.

Do lado do serviço, quatro correções de segurança/robustez são pré-requisito de mandar mensagem
para paciente real (D7).

## Technical Context

**Language/Version**: TypeScript 5.4 sobre Node.js 20 LTS (runtime Vercel); Deno no braço
**Primary Dependencies**: Next.js 14.2 (App Router, RSC, Server Actions, Route Handlers),
`@supabase/ssr` 0.5, `@supabase/supabase-js` 2.45, Zod 3.23, Tailwind 3.4, shadcn/ui (Radix),
`@upstash/qstash` (já instalado, usado no fluxo GHL), `lucide-react`, Pino 9.
**Sem novas dependências** — o QR Code chega como imagem base64 pronta do braço, então não é
preciso biblioteca de geração de QR.
**Storage**: PostgreSQL via Supabase com RLS por `tenant_id`. Migration nova:
`0185_whatsapp_reminders.sql`. Tabelas novas: `tenant_whatsapp_config`,
`whatsapp_delivery_events`. Alteradas: `appointment_reminders` (CHECK de status),
`patients` (+1 coluna), `tenant_clinic_profile` (+3 colunas).
**Testing**: Vitest — `tests/unit`, `tests/integration`, `tests/contract`.
**Target Platform**: Vercel (app) + Supabase (banco e serviço de WhatsApp).
**Project Type**: Web app multi-tenant.
**Performance Goals**: lote de até 200 lembretes por ciclo diário, espaçados em ~4s por clínica.
**Constraints**:
- Cron **diário** e só diário — mais frequente trava todos os deploys no plano Hobby.
- `appointment_reminders` é append-only com trigger que só permite `queued → terminal`.
- Telefone de paciente é dado sensível: cifrado em repouso, nunca em log.
**Scale/Scope**: dezenas de clínicas, um número de WhatsApp cada.

## Constitution Check

*GATE: avaliado antes da Phase 0 e reavaliado após a Phase 1.*

| Princípio | Aplica? | Como o desenho atende |
|---|---|---|
| **I. Integridade Financeira Imutável** | Indireto | Nada financeiro é tocado. Mas a postura append-only é respeitada onde importa: `whatsapp_delivery_events` é append-only e **não** relaxa o trigger anti-mutação de `appointment_reminders` (D4). |
| **II. Auditabilidade Total** | Sim | Conexão, desconexão e ativação do canal geram `log_audit_event`. O trigger de auditoria de `appointment_reminders` já cobre INSERT e transição de status. Alteração de opt-out do paciente é auditada pelo trigger existente em `patients`. |
| **III. Isolamento Multi-Tenant** | Sim | Toda tabela nova carrega `tenant_id` + RLS. O cron usa service-role mas filtra `tenant_id` explicitamente em cada query (padrão já vigente em `select-due.ts`). No callback, o `tenant_id` é derivado do lembrete, **nunca** do corpo da requisição. A `api_key` de uma clínica não alcança instância de outra. |
| **IV. Conformidade TUSS/ANS** | Não | Feature não toca catálogo nem faturamento. |
| **V. RBAC** | Sim | Conectar/desconectar o número e ativar o canal exigem `admin` (FR-024), avaliado no servidor. A rota de callback é legitimamente pública e autenticada por segredo compartilhado — o prefixo `webhooks/` já é isento em `check-require-role.mjs:34`. |

**Restrições de domínio**:
- LGPD: telefone decifrado só existe em memória entre a RPC e a chamada de envio; nunca
  persistido em claro fora do cadastro cifrado, nunca logado (SC-007).
- Credenciais em cofre, não em env: `api_key` da clínica vai cifrada em
  `tenant_whatsapp_config.api_key_enc` via `enc_text_with_key` (D2).
- Timestamps UTC na persistência; conversão para o fuso da clínica só na renderização.
- Idempotência com ID externo de correlação: `externalId` = id do lembrete (D6).

**Resultado do gate (pré-Phase 0)**: passa, sem violações a justificar.

**Reavaliação (pós-Phase 1)**: passa. O desenho final não introduziu tabela sem `tenant_id`,
não relaxou trigger existente, não colocou segredo em env de tenant e não criou rota em `/api/*`
sem autenticação. A seção *Complexity Tracking* fica vazia e por isso foi removida.

## Project Structure

### Documentation (this feature)

```text
specs/051-whatsapp-evolution/
├── plan.md              # este arquivo
├── spec.md
├── research.md          # D1–D10 + riscos aceitos
├── data-model.md        # migration 0185 + máquina de estados
├── quickstart.md        # como subir e testar ponta a ponta
├── contracts/
│   ├── whatsapp-service.md    # Clinni → braço (provision, conexão, envio)
│   └── status-callback.md     # braço → Clinni (confirmação de entrega)
├── checklists/
│   └── requirements.md
└── tasks.md             # gerado por /speckit.tasks
```

### Source Code (repository root)

```text
src/
├── lib/core/whatsapp/                    # NOVO — cápsula do canal
│   ├── config.ts                         # CRUD de tenant_whatsapp_config (creds cifradas)
│   ├── service-client.ts                 # cliente HTTP do braço (provision/conexão/envio)
│   ├── phone.ts                          # normalização BR (portada do braço — D9)
│   └── delivery.ts                       # gravação e leitura de whatsapp_delivery_events
├── lib/core/reminders/                   # ESTENDIDO — feature 018
│   ├── types.ts                          # + novos status, + canal nos tipos
│   ├── select-due.ts                     # channel parametrizado; passa a olhar phone_enc
│   ├── send-one.ts                       # despacha por canal em vez de e-mail fixo
│   ├── send-one-whatsapp.ts              # NOVO — envio pelo canal WhatsApp
│   ├── render-whatsapp.ts                # NOVO — template texto puro (D10)
│   └── process-batch.ts                  # itera canais; enfileira no QStash com delay
├── app/api/webhooks/whatsapp-status/     # NOVO — callback de confirmação
├── app/api/workers/send-whatsapp-reminder/  # NOVO — worker de envio individual (QStash)
└── app/(dashboard)/configuracoes/
    ├── whatsapp/                         # NOVO — tela de conexão (QR + estado)
    └── lembretes/                        # ESTENDIDO — escolha de canal + status de entrega

supabase/migrations/
└── 0185_whatsapp_reminders.sql           # NOVO

tests/
├── unit/         # phone, render-whatsapp, precedência de status de entrega
├── integration/  # ciclo do cron por canal, opt-out por canal, fallback
└── contract/     # rota de callback (auth, isolamento de tenant, idempotência)
```

**Structure Decision**: seguimos o layout já vigente do repo — domínio em `src/lib/core/<área>`,
rotas em `src/app/api`, telas em `src/app/(dashboard)`. A cápsula `core/whatsapp` é irmã de
`core/reminders`, não subordinada: quem quiser mandar WhatsApp para outra coisa no futuro
(confirmação de agendamento, resultado de exame) usa a mesma cápsula sem passar pelo motor de
lembretes.

### Repositório separado `Homio-CRM/clinni-whatsapp`

```text
supabase/
├── migrations/0002_hardening.sql         # RLS + unique(external_id) + webhook_token
└── functions/
    ├── provision-tenant/                 # NOVO — criação de tenant por master key
    ├── status-webhook/                   # autenticação + escopo de instância no lookup
    └── send-message/                     # idempotência por (tenant_id, external_id)
```

## Fases de entrega

Ordem pensada para que cada fase seja demonstrável sozinha.

**Fase 0 — Endurecer o serviço** (pré-requisito, repo separado)
Autenticação do `status-webhook`, RLS nas 4 tabelas, unique de `external_id`, escopo de
instância no lookup do ACK, endpoint `provision-tenant`. Sem isso não se manda mensagem para
paciente real.

**Fase 1 — Fundação no Clinni**
Migration 0185, cápsula `core/whatsapp` (config cifrada, cliente HTTP, phone), testes unitários.
Nada visível ao usuário ainda.

**Fase 2 — US1: conectar o número**
Tela `/configuracoes/whatsapp` com QR e estado, server actions sob `admin`, provisionamento no
braço. Demonstrável: a clínica conecta e vê "Conectado".

**Fase 3 — US2: o lembrete sai por WhatsApp**
`render-whatsapp`, `send-one-whatsapp`, canal parametrizado em `select-due`/`send-one`,
enfileiramento com delay no QStash, worker de envio. Demonstrável: paciente recebe.

**Fase 4 — US3: escolha de canal**
Colunas de canal em `tenant_clinic_profile`, UI em `/configuracoes/lembretes`, fallback para
e-mail, guarda de "não ligar sem número conectado".

**Fase 5 — US4 + US5: entrega e consentimento**
Rota de callback, `whatsapp_delivery_events`, coluna de status no histórico, opt-out por canal
no cadastro do paciente.

## Riscos de execução

- **Migration 0185 não pode ser aplicada à mão em produção** — a integração GitHub da Supabase
  aplica no push para `master`. Aplicar duas vezes quebra o deploy.
- **O banco Supabase local é compartilhado com outra sessão de trabalho.** `vitest` chama
  `resetDatabase()` e apaga tudo. Nenhuma execução de suíte sem combinar antes; re-semear com
  `pnpm seed:demo`.
- **Deploy com `MIDDLEWARE_INVOCATION_FAILED`** = cache de build da Vercel; redeploy
  desmarcando "Use existing Build Cache".
- **Detectar bloqueio de número exige mudança no braço** (FR-012a, clarificação de 2026-07-28):
  hoje o `status-webhook` grava `status_reason` como `connection.update: ${state}` — o estado,
  não o motivo. Distinguir "bloqueado" de "apenas desconectado" exige capturar o código de
  motivo do payload da Evolution.

**Resolvido desde a redação inicial**: o SC-004 era inverificável (não há medição de abertura de
e-mail); virou alvo absoluto na clarificação de 2026-07-28.
