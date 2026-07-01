# Research: Motor de lembretes automáticos de consulta (Fase 1)

**Feature**: 018-appointment-reminders
**Date**: 2026-05-19

## §1. Scheduler — Vercel Cron vs externo (Inngest, QStash, Trigger.dev)

**Decision**: Vercel Cron (declarativo em `vercel.json`).

**Rationale**:

- Projeto já usa Vercel; sem nova dependência ou conta a gerenciar.
- Vercel Cron expõe endpoint HTTP — mesmo modelo do `/api/workers/process-ghl-event` existente.
- Granularidade de 15min coberta pelo plano atual (cron supports `*/15 * * * *`).
- Sem custo adicional (incluído no plano).
- Limite de 30s de execução é aceitável para batch ≤200 com I/O bound (envios de email em paralelo).

**Alternatives considered**:

- **Inngest / Trigger.dev**: melhor para workflows long-running e retries sofisticados, mas adicionam serviço externo + custo + complexidade de setup. Overkill para Fase 1.
- **QStash (Upstash)**: bom mas idem — dependência nova; sem necessidade enquanto o trabalho cabe em 30s.
- **Worker próprio (Edge Function periódica)**: Supabase tem `pg_cron` mas requer extensão e admin; nosso `0093` já demonstrou que pg_cron exige setup adicional que não vale para Fase 1.

## §2. Batch processing — paralelismo

**Decision**: `Promise.allSettled` com cap de 200 itens por ciclo (vindo da clarificação Q1).

**Rationale**:

- Resend SDK suporta concorrência (plano atual 100 req/s); 200 em ~5s não estoura.
- `Promise.allSettled` garante isolamento — falha em 1 não derruba os outros (FR-014).
- Cap pragmático: 200 envios \* ~200ms p99 cada = 40s teórico, mas concorrência puxa para ≤10s. Sobra de tempo para audit log + INSERT de registros.
- Excesso (raro: tenant grande em pico) cai no próximo ciclo 15min depois — perda de pontualidade aceitável (FR-007).

**Alternatives considered**:

- **Sem cap (todos elegíveis)**: risco de timeout em tenant grande (1000+ agendamentos no mesmo período). Rejeitado.
- **Cap por tenant (50/tenant/ciclo)**: complica a query (precisaria de janela por tenant) sem ganho real — multi-tenant isolation já é resolvida via RLS. Rejeitado.
- **Queue persistente (Redis/BullMQ)**: necessária só na Fase 2+ quando volume crescer. Hoje, idempotência via UNIQUE constraint atende.

## §3. Idempotência

**Decision**: UNIQUE composta `(appointment_id, scheduled_offset_hours, channel)` na tabela `appointment_reminders` + cláusula `ON CONFLICT DO NOTHING` no INSERT.

**Rationale**:

- Mesmo padrão usado em `notifications` (feature 012) e `public_booking_tokens` (feature 017) — provado e auditado.
- Resolve race entre 2 execuções consecutivas do cron (raro mas possível em recovery do Vercel).
- Funciona transparente: se conflito, o segundo cron simplesmente não cria registro novo; o existente já cobre.

**Alternatives considered**:

- **Lock distribuído (advisory lock por appointment+offset)**: pesado e exige pgBouncer-aware setup; UNIQUE é suficiente.
- **Lock pessimista (`FOR UPDATE SKIP LOCKED`)**: necessário para queue style, não para o nosso caso (cron tem 1 instância).

## §4. Retry de falhas de provedor

**Decision**: SEM retry automático na Fase 1.

**Rationale**:

- Falhas Resend são raras (rate limit ou indisponibilidade transitória) e geralmente se resolvem em ~minutos.
- Admin tem botão "Reenviar manual" (FR-018, Q2) que cobre os casos edge.
- Implementar retry exponencial requer estado de retry persistido + janela exponencial + dead-letter — escopo de Fase 2.

**Alternatives considered**:

- **Retry imediato (mesmo ciclo, 1 tentativa adicional)**: agrega ~50% no time budget sem ganho material (se Resend falhou agora, provavelmente vai falhar de novo em 100ms).
- **Re-enfileirar para próximo ciclo automaticamente**: precisaria de status "retry_pending" diferente de "failed" — complica o data model sem necessidade Fase 1.

## §5. Template de mensagem — armazenamento e renderização

**Decision**: Templates (assunto + corpo) armazenados como `TEXT` em `tenant_clinic_profile`; render server-side com substituição manual de placeholders (`{{paciente}}`, `{{medico}}`, `{{horario}}`, `{{clinica}}`) + escape HTML em **todos** os valores substituídos.

**Rationale**:

- 4 placeholders fixos cobrem 99% dos casos; engine de template (Handlebars/EJS) é overkill.
- Substitução manual = controle absoluto de escape (XSS proof).
- Default fornecido quando admin não customiza (`reminder_template_subject IS NULL OR reminder_template_body IS NULL`).

**Alternatives considered**:

- **Handlebars/Mustache**: requer sanitização extra + ataque de template injection se admin coloca conteúdo malicioso. Rejeitado.
- **MJML**: produz HTML responsivo mas exige build step; nosso template padrão já é responsivo com inline styles (segue padrão `booking-template.ts` da 017).
- **Template visual editor**: produto futuro; Fase 1 é admin com textarea.

## §6. Timezone — interpretação da janela de envio

**Decision**: Janela `reminder_window_start`/`end` interpretada no fuso configurado da clínica. Default `America/Sao_Paulo`. Uso de `date-fns-tz` (já presente — feature 010 e 017).

**Rationale**:

- Clínicas no Brasil estão majoritariamente em America/Sao_Paulo, mas Amazonas/Acre divergem.
- Tenant tem fuso em `user_profile.timezone` ou em `tenants` (se houver coluna) — se não, default.
- Conversão UTC↔local apenas na borda da decisão "é hora de enviar?"; persistência sempre UTC (Princípio constitucional Restrições — "Relógio").

**Alternatives considered**:

- **Sempre UTC, sem TZ por tenant**: simples mas viola UX (clínica configura "10h" e o motor envia em 13h UTC sem contexto). Rejeitado.
- **TZ por usuário (admin)**: sobrescreve o fuso da clínica; complica UX. Rejeitado.

## §7. Autenticação do cron

**Decision**: Header `Authorization: Bearer ${CRON_SECRET}` validado em `/api/cron/send-reminders/route.ts`. Pattern idêntico a `/api/workers/process-ghl-event` existente.

**Rationale**:

- Vercel Cron envia header customizável; já configurado no `vercel.json` do projeto.
- `CRON_SECRET` é env var separada de outras chaves (rotacionável).
- Não usa JWT/RLS — cron precisa rodar com privilégios cross-tenant (filtra por `tenant_id` em cada query).

**Alternatives considered**:

- **JWT assinado**: complexo demais para um caso de "endpoint privado". Rejeitado.
- **Sem auth (IP allowlist Vercel)**: viola defense-in-depth; rejeitado.

## §8. Email do paciente em logs — LGPD

**Decision**: Pino logger com `redact: { paths: ['*.email', 'patient.email', 'to.email'], censor: '[EMAIL]' }` no nível do package; reforço local em `send-one.ts` que NUNCA loga o email diretamente (loga `appointmentId` apenas).

**Rationale**:

- LGPD: email é dado pessoal; em logs em texto claro é incidente.
- Princípio constitucional "Restrições/LGPD" exige redaction.
- Padrão Pino redact já usado em `src/lib/observability/logger.ts` para outros campos sensíveis (CPF, telefone, etc.).
- Mensagem de erro do provedor pode incidentalmente trazer email — capturar mas não logar `error.message` diretamente; logar apenas `error.code`.

**Alternatives considered**:

- **Confiar só no Pino redact global**: defesa única é frágil; reforço local é cinto + suspensório.
- **Não logar nada em sucesso (só falhas)**: perde observabilidade operacional (latência, throughput).

## §9. Storage de "último ciclo do cron"

**Decision**: Coluna `reminder_last_run_at TIMESTAMPTZ` em `tenant_clinic_profile`. Tabela separada não justifica.

**Rationale**:

- 1 row por tenant; informação cross-cutting é leve.
- Painel admin lê na mesma query do resto da configuração — sem JOIN extra.
- Atualizado por cada execução do cron (UPDATE simples).

**Alternatives considered**:

- **Tabela `cron_runs` separada**: útil se houver múltiplos crons distintos no futuro; over-engineering Fase 1.
- **Inferir do MAX(`created_at`) de `appointment_reminders`**: depende de ter ao menos 1 envio no ciclo; falha quando todos os agendamentos são pulados.

## §10. Próximos lembretes a enviar (UI)

**Decision**: Query `SELECT FROM appointments JOIN tenant_clinic_profile WHERE appointment_at BETWEEN now() + min(offsets) AND now() + max(offsets) + 24h AND tenant_id = ? AND public_booking_enabled = (omit) AND patient.email IS NOT NULL AND patient.reminders_opt_in = TRUE` paginada a 20 itens.

**Rationale**:

- Mostra ao admin o que será enviado nas próximas 24h — operacional, não exato.
- Não tenta "simular" o cron — só preview baseado em configuração atual.
- Limit 20 evita explosão em clínicas grandes (admin tem botão "ver mais" se necessário — fase 2).

**Alternatives considered**:

- **Replicar lógica completa do cron na UI**: duplicação; manutenção dupla. Rejeitado.
- **Trigger no banco que materializa preview em tabela**: complexidade desnecessária.

## Constitutional gates restated

Esta seção liga as decisões acima aos princípios da constituição (para servir de checklist no PR review):

| Decisão            | Princípio          | Compromisso                                                                   |
| ------------------ | ------------------ | ----------------------------------------------------------------------------- |
| §1 (Vercel Cron)   | V (RBAC)           | Auth via `CRON_SECRET`; sem exposição cross-tenant via endpoint               |
| §2 (Batch 200)     | III (Multi-tenant) | Cap NÃO é por tenant — RLS + filtro explícito garantem isolamento             |
| §3 (Idempotência)  | II (Audit)         | Cada conflito ON CONFLICT é silencioso mas o registro original já gerou audit |
| §4 (Sem retry)     | II (Audit)         | Falhas registradas como `status=failed` — auditoria de operações negadas      |
| §5 (Escape HTML)   | LGPD/Segurança     | Defesa contra XSS em template customizável pelo admin                         |
| §6 (TZ por tenant) | LGPD/UX            | Conversa com expectativa do operador da clínica                               |
| §7 (CRON_SECRET)   | V (RBAC)           | Endpoint privado autenticado                                                  |
| §8 (Pino redact)   | LGPD/Restrições    | Email em logs nunca em texto claro                                            |
| §9 (last_run_at)   | II (Audit)         | Histórico observável sem tabela paralela                                      |
| §10 (Preview UI)   | III (Multi-tenant) | Query sempre com `tenant_id = ?` explícito                                    |

Nenhuma decisão viola a constituição; todas reforçam.
