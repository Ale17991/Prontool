# Quickstart — 017 Public Booking

Como rodar a feature local, configurar uma clínica de teste e validar.

---

## 1. Variáveis de ambiente

Adicionar em `.env.local`:

```bash
# Cloudflare Turnstile — sitekeys de desenvolvimento públicas
# (Cloudflare oferece estas para testes — não verifica server-side em dev)
NEXT_PUBLIC_TURNSTILE_SITE_KEY=1x00000000000000000000AA  # always passes
# NEXT_PUBLIC_TURNSTILE_SITE_KEY=2x00000000000000000000AB  # always fails (uso para teste de erro)
# NEXT_PUBLIC_TURNSTILE_SITE_KEY=3x00000000000000000000FF  # always renders challenge

TURNSTILE_SECRET_KEY=1x0000000000000000000000000000000AA  # always passes server-side
# TURNSTILE_SECRET_KEY=2x0000000000000000000000000000000AA  # always fails
```

**Produção**: gerar sitekey e secret no painel da Cloudflare (https://dash.cloudflare.com/?to=/:account/turnstile). Configurar como widget invisible com hostname do domínio público.

---

## 2. Aplicar migration local

```bash
pnpm supabase:reset  # aplica todas as migrations, incluindo 0084_public_booking.sql
```

ou (se preferir aplicar só a nova):

```bash
supabase migration up
```

---

## 3. Configurar um tenant para teste

Após o reset, com Supabase local rodando:

```sql
-- 1. Habilitar feature pra um tenant de teste
UPDATE tenant_clinic_profile
SET
  public_booking_slug = 'clinica-teste',
  public_booking_enabled = TRUE,
  public_booking_min_hours_advance = 2,  -- relaxa pra testar fácil
  public_booking_max_days_advance = 30,
  public_booking_cancel_min_hours = 1
WHERE tenant_id = '<seu-tenant-uuid>';

-- 2. Publicar um médico (assume que doctor X já existe no tenant)
INSERT INTO public_booking_doctors (tenant_id, doctor_id, bio, available_weekdays, available_from, available_until)
VALUES (
  '<seu-tenant-uuid>',
  '<doctor-uuid>',
  'Médico de teste — atende em horário comercial',
  ARRAY[1,2,3,4,5]::SMALLINT[],
  '08:00',
  '18:00'
);

-- 3. Publicar um procedimento pro médico
INSERT INTO public_booking_doctor_procedures (tenant_id, doctor_id, procedure_id, display_name, duration_minutes)
VALUES (
  '<seu-tenant-uuid>',
  '<doctor-uuid>',
  '<procedure-uuid>',
  'Consulta clínica',
  30
);
```

Ou via UI: `/configuracoes/agendamento-publico` após a feature US2 estar implementada.

---

## 4. Testar o fluxo público

Abrir em **navegador anônimo** (sem sessão Prontool):

```
http://localhost:3000/agendar/clinica-teste
```

Fluxo esperado:
1. Página landing mostra logo + nome da clínica + lista de médicos publicados.
2. Clicar no médico → mostra procedimentos publicados pra ele.
3. Clicar no procedimento → calendário com slots disponíveis nos próximos 30 dias.
4. Selecionar dia + horário → form de identificação.
5. Preencher nome, CPF (opcional), email, telefone, data nascimento.
6. Marcar checkbox de consentimento LGPD.
7. Turnstile valida (invisível em dev — sitekey de teste sempre passa).
8. Submit → redireciona para `/agendar/clinica-teste/sucesso/[token]`.
9. Tela de sucesso mostra resumo + botão de adicionar ao calendar + link de cancelar.
10. (Verificar inbox local — se Resend dev mode, log de email aparece no console).

---

## 5. Testar cancelamento

Pegar o token da URL de sucesso (ou do email):

```
http://localhost:3000/agendar/clinica-teste/cancelar/[token]
```

1. GET renderiza página com resumo da consulta + botão "Confirmar cancelamento".
2. Click no botão → POST /api/public/booking/cancel/[token].
3. Tela atualiza para "Cancelado com sucesso".
4. No DB: appointment.status='cancelado', slot_lock liberado, token used_at preenchido, audit_log registra evento.

---

## 6. Rodar testes

```bash
# Todos
pnpm test

# Só testes de contrato da feature
pnpm test:contract -- public-booking

# Só isolamento multi-tenant (CRÍTICO — gate constitucional)
pnpm vitest run tests/contract/public-booking-tenant-isolation.test.ts

# Só slot collision
pnpm vitest run tests/contract/public-booking-slot-collision.test.ts
```

**Antes de cada commit**: rodar `pnpm typecheck` (regra do projeto).

---

## 7. Validar isolamento multi-tenant manualmente (smoke test)

1. Criar 2 tenants no DB: `tenant-a` e `tenant-b`.
2. Configurar `clinica-a` em tenant-a e `clinica-b` em tenant-b com médicos e procedimentos próprios.
3. Tentar acessar `/agendar/clinica-a` com `doctor_id` de tenant-b via URL manual → deve retornar 403 (médico não publicado).
4. Confirmar via logs/audit que nenhuma query vazou dados entre tenants.

---

## 8. Cenários de Turnstile

```bash
# Forçar erro de captcha (teste de UX de falha)
TURNSTILE_SECRET_KEY=2x0000000000000000000000000000000AA  # sempre falha
NEXT_PUBLIC_TURNSTILE_SITE_KEY=2x00000000000000000000AB  # widget mostra erro
```

Cliente: submit → 403 `CAPTCHA_FAILED` + mensagem genérica.

```bash
# Forçar desafio visível (UX do usuário interagindo)
NEXT_PUBLIC_TURNSTILE_SITE_KEY=3x00000000000000000000FF
```

Cliente: widget mostra challenge antes do submit.

---

## 9. Cenários de rate limit

```bash
# Rapidamente fazer 11 GETs em /api/public/booking/clinica-teste/slots
for i in {1..11}; do
  curl -s "http://localhost:3000/api/public/booking/clinica-teste/slots?doctor_id=...&procedure_id=...&from=2026-05-20&to=2026-05-27"
done
```

11º request deve retornar 429 com `Retry-After`.

---

## 10. Inspecionar audit_log

```sql
SELECT timestamp_utc, event_type, actor_label, entity, entity_id, detail
FROM audit_log
WHERE tenant_id = '<seu-tenant>'
  AND event_type IN ('public_booking_created', 'public_booking_cancelled')
ORDER BY timestamp_utc DESC
LIMIT 20;
```

Cada operação pública gera exatamente 1 entrada. IP é hash (64 chars hex), nunca em texto claro.

---

## 11. Limpeza periódica (cron)

Em produção, configurar Supabase Scheduled Function:

```sql
-- A cada hora, limpa rate limits > 7d
SELECT cron.schedule(
  'public-booking-rate-limit-cleanup',
  '0 * * * *',
  $$DELETE FROM public_booking_rate_limits WHERE created_at < now() - INTERVAL '7 days'$$
);

-- A cada semana, limpa tokens > 90d
SELECT cron.schedule(
  'public-booking-tokens-cleanup',
  '0 3 * * 0',
  $$DELETE FROM public_booking_tokens WHERE expires_at < now() - INTERVAL '90 days'$$
);
```

---

## 12. Onde isso vive no código

| Coisa | Path |
|---|---|
| Migration | `supabase/migrations/0084_public_booking.sql` |
| Core domain | `src/lib/core/public-booking/*` |
| Rotas públicas (UI) | `src/app/agendar/[slug]/*` |
| Rotas API | `src/app/api/public/booking/*` |
| UI admin | `src/app/(dashboard)/configuracoes/agendamento-publico/*` |
| Componentes client | `src/components/public-booking/*` |
| Email templates | `src/lib/integrations/email/booking-template.ts` |
| ICS gen | `src/lib/utils/ics.ts` |
| Spec/plan/contracts | `specs/017-public-booking/*` |
| Testes de contrato | `tests/contract/public-booking-*.test.ts` |

---

## 13. O que NÃO fazer

- **Não aceitar `tenant_id` no body** das rotas públicas — sempre derive do slug.
- **Não armazenar IP em texto claro** — usar `ip_hash` (SHA-256).
- **Não fazer GET no cancelamento que modifica estado** — preview de email cancelaria sem usuário saber.
- **Não pular validação server-side** se UI já valida — manipulação via console deve falhar.
- **Não chamar `public_booking_find_patient_by_cpf` do client** — função é `service_role` only.
- **Não logar `cancelToken` raw** — apenas o hash. Log do raw em produção é vazamento.

---

## 14. Checklist pré-deploy

- [ ] Migration 0084 aplicada em prod e funciona em rollback dev.
- [ ] Turnstile sitekey + secret de **produção** configurados em env.
- [ ] Cron de limpeza de rate_limits + tokens configurado.
- [ ] Testes de contrato passando — incluindo o isolation test.
- [ ] Revisão de PR por mantenedor com conhecimento de domínio (gate constitucional III).
- [ ] LGPD: política de privacidade pública renderizando em `/agendar/[slug]/privacidade`.
- [ ] Resend domain verified (para emails saírem do alias da clínica ou prontool).
- [ ] Documentação de "Como divulgar o link" para a clínica (helpcenter / onboarding).
