# Research — 017 Public Booking

**Phase 0 output.** Decisões técnicas resolvidas antes do design (Phase 1) e antes da implementação.

---

## 1. Fonte de disponibilidade do médico ⚠ DECISÃO CRÍTICA

**Achado**: O projeto **não tem tabela de "disponibilidade declarada do médico"**. `schedule_blocks` (migration 0083) representa **bloqueios** (férias, reunião), não disponibilidade positiva. Buscas por `doctor_availability`, `working_hours`, `work_schedule` retornaram zero arquivos.

A spec (FR-013) assume "blocos com ação 'disponível'" — essa estrutura **não existe** no codebase.

**Decisão**: adicionar campos mínimos de disponibilidade **no próprio escopo da feature pública**, evitando criar nova tabela genérica que afetaria features paralelas (agenda interna).

**Schema decidido** (parte da migration 0093_public_booking.sql):

Adicionar em `public.public_booking_doctors`:

- `available_weekdays SMALLINT[] NOT NULL` — array de 0-6 (dom-sáb) que o médico aceita agendamento público
- `available_from TIME NOT NULL DEFAULT '08:00'` — hora local da clínica que começa a aceitar
- `available_until TIME NOT NULL DEFAULT '18:00'` — hora local da clínica que termina
- `lunch_break_from TIME NULL` — pausa almoço opcional início
- `lunch_break_until TIME NULL` — pausa almoço opcional fim

**Cálculo do slot**: para um dia D dentro da janela `[now + min_hours_advance, now + max_days_advance]`:

1. Se `EXTRACT(DOW FROM D)` não está em `available_weekdays` → dia inteiro indisponível.
2. Janela bruta = `available_from..available_until` (com pausa almoço subtraída se configurada).
3. Subtrair `schedule_blocks` cobrindo o dia (`block_date = D` ou range).
4. Subtrair `appointment_slot_locks` (existentes em `0055_appointment_conflict_and_completion.sql`) — confirma que slot já tem booking.
5. Discretizar em slots da duração `public_booking_doctor_procedures.duration_minutes`.

**Rationale**: minimiza superfície de mudança (não adiciona tabela genérica), preserva flexibilidade (cada médico publica horário próprio), reusa `schedule_blocks` existente para bloqueios.

**Alternativas consideradas**:

- **Tabela `doctor_availability` genérica**: mais correta semanticamente, mas afeta agenda interna e features futuras. Postponed para feature dedicada quando agenda interna precisar.
- **Open-by-default 8h-18h hardcoded**: descartado — clínicas dermatológicas/odonto trabalham horários muito diferentes.
- **Inferência via histórico de appointments**: descartado — pouco confiável; clínica nova não tem histórico.

**Limitação aceita**: disponibilidade é por médico **homogênea durante a semana** (todo dia útil tem mesma janela). Não suporta "médico atende seg/qua 8-12h e ter/qui 14-18h". Para diferenciação por dia da semana, médico precisa criar `schedule_blocks` específicos para os turnos não-atendidos. **Documentar na UI admin como limitação intencional do MVP.**

---

## 2. Resolução de tenant por slug

**Achado**: já existe `tenants.slug TEXT NOT NULL UNIQUE` (migration 0002), mas **sem padrão de resolução por slug em rota pública**. O acesso interno usa JWT `auth_hook_custom_claims`.

**Decisão**: NÃO reusar `tenants.slug` — criar `tenant_clinic_profile.public_booking_slug` separado. Razões:

1. `tenants.slug` é identidade administrativa interna (já usado em URLs autenticadas como `/selecionar-clinica`). Mudá-lo quebraria referências internas.
2. `public_booking_slug` é "endereço público" — pode ser mais amigável (`dra-marta-cardiologia` vs `tenant-uuid-12345`).
3. Admin pode editar `public_booking_slug` sem impacto operacional.

**Pattern de resolução**:

```sql
CREATE FUNCTION public.public_booking_resolve_slug(p_slug TEXT)
RETURNS TABLE (
  tenant_id UUID,
  clinic_display_name TEXT,
  clinic_logo_path TEXT,
  min_hours_advance INT,
  max_days_advance INT,
  cancel_min_hours INT
) LANGUAGE plpgsql SECURITY INVOKER AS $$
BEGIN
  RETURN QUERY
    SELECT
      tcp.tenant_id, tcp.display_name, tcp.logo_path,
      tcp.public_booking_min_hours_advance,
      tcp.public_booking_max_days_advance,
      tcp.public_booking_cancel_min_hours
    FROM public.tenant_clinic_profile tcp
    WHERE tcp.public_booking_slug = p_slug
      AND tcp.public_booking_enabled = TRUE
    LIMIT 1;
END $$;
GRANT EXECUTE ON FUNCTION public.public_booking_resolve_slug TO anon, authenticated;
```

`SECURITY INVOKER` (não DEFINER) porque retorna **apenas dados não-sensíveis** já públicos por design (slug + nome de fantasia + logo + políticas). RLS sobre `tenant_clinic_profile` precisa permitir SELECT desses campos para `anon` — ou usar DEFINER se quiser ser mais conservador.

**Decisão final**: usar **SECURITY INVOKER** + política RLS específica em `tenant_clinic_profile`: `CREATE POLICY public_slug_read ON tenant_clinic_profile FOR SELECT TO anon USING (public_booking_enabled = TRUE)`. Defesa em profundidade: a função só lê campos públicos, RLS permite o subset, banco aplica os limites.

---

## 3. RPC `public_booking_slots` — slots disponíveis

**Decisão**: SECURITY DEFINER, parâmetros tipados, sem dependência de chave de paciente.

```sql
CREATE FUNCTION public.public_booking_slots(
  p_slug TEXT,
  p_doctor_id UUID,
  p_procedure_id UUID,
  p_from DATE,
  p_to DATE
) RETURNS TABLE (
  slot_start TIMESTAMPTZ,
  slot_end TIMESTAMPTZ
) LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_tenant_id UUID;
  v_min_h INT;
  v_max_d INT;
  v_now TIMESTAMPTZ := now();
BEGIN
  -- Resolve tenant. Filtra implicitamente por enabled.
  SELECT tcp.tenant_id, tcp.public_booking_min_hours_advance, tcp.public_booking_max_days_advance
    INTO v_tenant_id, v_min_h, v_max_d
    FROM public.tenant_clinic_profile tcp
    WHERE tcp.public_booking_slug = p_slug
      AND tcp.public_booking_enabled = TRUE;
  IF v_tenant_id IS NULL THEN RETURN; END IF;

  -- Valida que doctor e procedure estão publicados pra este tenant.
  IF NOT EXISTS (
    SELECT 1 FROM public.public_booking_doctor_procedures pbdp
      WHERE pbdp.tenant_id = v_tenant_id
        AND pbdp.doctor_id = p_doctor_id
        AND pbdp.procedure_id = p_procedure_id
  ) THEN RETURN; END IF;

  -- Clamp janela
  -- ... (gera slots conforme algoritmo §1 desta research)
END $$;

REVOKE ALL ON FUNCTION public.public_booking_slots FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_booking_slots TO anon, authenticated;
```

**Rationale**: `SECURITY DEFINER` necessário porque `appointment_slot_locks` tem RLS que `anon` não passaria. A função roda como dono da função (postgres) com `set search_path = public`, valida tenant via slug+enabled (não JWT), retorna apenas slots agregados (sem PII).

**Hardening**:

- `REVOKE ALL FROM PUBLIC` antes do GRANT (não estava no padrão atual, mas spec FR-034 exige minimização).
- `SET search_path = public, pg_temp` na declaração para impedir search-path attacks.

---

## 4. Criação de paciente público + appointment (transação)

**Achado**: criação de paciente existente em `src/lib/core/patients/create-manual.ts` exige sessão autenticada e usa env `PATIENT_DATA_ENCRYPTION_KEY` para encriptar PII em SQL via `extensions.pgp_sym_encrypt`.

**Decisão**: criar função server-side `lib/core/public-booking/create-booking.ts` que:

1. Recebe payload validado por Zod (sem trust no client).
2. Resolve tenant via slug (FR-001..004).
3. Re-valida Turnstile no servidor (FR-016).
4. Re-valida rate limit (FR-017..019) — incrementa hash IP.
5. Re-valida que `(doctor, procedure)` está em `public_booking_doctor_procedures`.
6. Tenta achar paciente por CPF (se fornecido) via RPC `find_patient_by_cpf_for_tenant` (criar — análoga a `list_patients_for_tenant` mas filtrada por CPF).
7. Se match: atualiza email/phone (FR-011a), audita mudança.
8. Se não match: cria paciente novo via `createPatient` existente.
9. Cria `appointment` via `createAppointment` existente, com:
   - `source = 'public_booking'` (campo novo em appointments — alternativa: campo em `appointment_metadata` se tabela existir)
   - `status = 'agendado'`
   - `actor_user_id = NULL` (sistema)
10. Cria `appointment_slot_lock` (já é trigger automático? Ou explicit insert?)
11. Cria `public_booking_tokens` com action='cancel' e hash do token.
12. Cria `audit_log` via `log_audit_event` com actor=NULL, actor_label='public_booking'.
13. Cria `notifications` para admin(s) do tenant (FR-024a).
14. Dispara email do paciente (.ics) + email admin (fire-and-forget).
15. Retorna token raw + redirect URL para tela de sucesso.

**Tudo dentro de transação** Postgres (`BEGIN ... COMMIT`) — qualquer falha rollback total.

**Pegadinha do `source`**: `appointments` provavelmente **não tem coluna source** hoje. Alternativas:

- A. ALTER appointments ADD COLUMN source TEXT DEFAULT 'internal' (afeta todos os call-sites — mudança ampla)
- B. Criar `appointment_metadata` table 1:N (mais limpo, sem migration agressiva em tabela financeira)
- C. Usar campo existente livre (procurar se há `notes` ou similar)
- **D. Usar entrada de `audit_log` com `event_type='public_booking_created'`** como marcador. Sem nova coluna. Recomendado pelo princípio constitucional I (não alterar tabela financeira sem necessidade).

**Decisão**: **Option D** — não adiciona coluna em `appointments`. O fato de "origem é pública" é provado pelo `audit_log` correspondente. Consulta interna pode usar JOIN com `audit_log` se precisar listar bookings públicos.

---

## 5. Captcha — Cloudflare Turnstile

**Decisão**: Turnstile conforme clarification.

**Integração**:

- **Client**: `<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>` + widget invisible (`data-action="public-booking"` + `data-sitekey={env.NEXT_PUBLIC_TURNSTILE_SITE_KEY}`).
- **Server-side verify**: POST para `https://challenges.cloudflare.com/turnstile/v0/siteverify` com `secret` (env `TURNSTILE_SECRET_KEY`) + `response` (token do client).
- **Resposta**: `{ success: boolean, "error-codes"?: string[] }`.
- **Falha**: bloqueia submit com erro genérico (FR-016).

**Env vars novas**:

```
NEXT_PUBLIC_TURNSTILE_SITE_KEY=<sitekey-de-cloudflare>
TURNSTILE_SECRET_KEY=<secret-de-cloudflare>
```

**Dev mode**: Cloudflare oferece sitekeys de teste públicas (`1x00000000000000000000AA` = sempre passa, `2x00000000000000000000AB` = sempre falha). Documentar em `quickstart.md`.

**Sem nova dep npm** — chamada via `fetch` nativo no servidor.

---

## 6. Geração de `.ics` — package `ics`

**Decisão**: adicionar `ics` (~30kb gzipped, sem deps transitivas pesadas, MIT). Suporta timezone via VTIMEZONE block.

```bash
pnpm add ics
```

**API usada**: `createEvent({ start, end, title, description, location, organizer, ... })` retorna `{ value, error }` com string `.ics` válido (RFC 5545).

**Timezone**: gerar com `dtstart/dtend` em UTC + comment textual "horário de Brasília (UTC-3)" no description, conforme FR-024. Reusa `getTenantTz()` existente em `src/lib/utils/tenant-tz.ts`.

**Alternativas rejeitadas**:

- `ical-generator`: mais features mas API menos limpa.
- DIY `.ics` string template: caso simples cabe em 30 linhas, mas perde validação RFC. Para MVP, package vale a pena.

---

## 7. Email do paciente — extensão do Resend wrapper

**Achado**: `src/lib/integrations/email/resend-client.ts` tem `sendAlertEmail` mas **sem suporte a anexos**. Resend SDK suporta `attachments: [{ filename, content (base64) }]`.

**Decisão**: criar nova função `sendBookingConfirmationEmail` em `src/lib/integrations/email/resend-client.ts` reusando o singleton existente, com suporte a anexo `.ics`:

```typescript
export interface BookingEmailInput {
  to: string
  clinicName: string
  subject: string
  patientName: string
  appointmentDateTime: string // formatado em TZ tenant
  doctorName: string
  procedureName: string
  clinicAddress?: string
  clinicPhone?: string
  tenantTimezone: string // "America/Sao_Paulo"
  cancelLink: string
  icsContent: string // string .ics gerada
}

export async function sendBookingConfirmationEmail(input: BookingEmailInput) {
  const resend = getResend(process.env.RESEND_API_KEY)
  const html = renderBookingHtml(input)
  const ics = Buffer.from(input.icsContent).toString('base64')
  return resend.emails.send({
    from: process.env.RESEND_FROM,
    to: input.to,
    subject: input.subject,
    html,
    attachments: [{ filename: 'consulta.ics', content: ics }],
  })
}
```

**Template HTML**: novo arquivo `src/lib/integrations/email/booking-template.ts` com `renderBookingHtml`, escapando todos os campos com `escapeHtml` existente.

---

## 8. Email do admin (notificação à clínica)

**Decisão**: enviar via mesmo Resend, função separada `sendAdminBookingNotificationEmail` (sem anexo). Destinatários: lista de usuários com role `admin` no tenant que tenham `email_notifications_enabled=TRUE` (campo a verificar — se não existe, mandar pra todos os admins).

**Failsafe**: se o tenant tiver >5 admins, mandar email apenas para o admin "owner" (primeiro a se cadastrar) para evitar spam. **Decisão final**: enviar para **TODOS os admins** no MVP, simples. Otimização futura.

---

## 9. Sino de notificação — expansão do enum `type`

**Achado**: `public.notifications.type` é CHECK CONSTRAINT em 4 valores (`atendimento`, `tarefa`, `tarefa_atrasada`, `aniversarios_mes`). Para esta feature, precisamos adicionar `public_booking`.

**Decisão**: na migration 0084, expandir o CHECK constraint:

```sql
ALTER TABLE public.notifications DROP CONSTRAINT notifications_type_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN ('atendimento', 'tarefa', 'tarefa_atrasada', 'aniversarios_mes', 'public_booking'));
```

Sem mudança no `notification-item.tsx` componente atual — adicionar mapping `public_booking: { icon: CalendarPlus, color: 'text-info-text bg-info-bg' }` em `COLOR_BY_TYPE` e `ICON_BY_TYPE`.

**Reference**: `reference_id` aponta para `appointment.id`. `reference_type` = `'appointment'`. `reference_key` = appointment_id (deduplicação).

---

## 10. Tokens de cancelamento — hash e armazenamento

**Decisão**: gerar token via `crypto.randomBytes(32).toString('base64url')` (32 bytes = 256 bits entropia, base64url safe para URL). Armazenar **apenas** `token_hash = sha256(token)` na coluna `public_booking_tokens.token_hash`.

**Link no email**: `https://prontool.com.br/agendar/[slug]/cancelar/[token-raw]`.

**Verificação**: ao receber requisição, calcular sha256 do token raw e fazer `WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()`. Constant-time comparison via `crypto.timingSafeEqual`.

**Expiração**: `created_at + INTERVAL '30 days'` por padrão. Pacientes que perderem o link após 30 dias precisam contatar a clínica.

---

## 11. Rate limit — armazenamento em Postgres

**Decisão**: usar Postgres em vez de Redis (sem nova dep). Tabela `public_booking_rate_limits` (id, tenant_id, ip_hash, action, created_at).

**Verificação**:

```sql
SELECT count(*) FROM public_booking_rate_limits
  WHERE ip_hash = $1
    AND tenant_id = $2
    AND action = 'view_slots'
    AND created_at > now() - INTERVAL '1 minute';
-- Se count >= 10, bloquear.
```

**Limpeza**: cron job (Supabase scheduled function ou pg_cron) roda a cada hora:

```sql
DELETE FROM public_booking_rate_limits WHERE created_at < now() - INTERVAL '7 days';
```

**Trade-off vs Redis**: latência ~5-10ms maior (Postgres vs Redis ~1ms), mas elimina dep. Para 10 RPS por tenant, é aceitável.

---

## 12. Hash de IP — formato

**Decisão**: SHA-256 do IP + salt específico do tenant. Salt evita correlation cross-tenant.

```typescript
async function hashIp(ip: string, tenantId: string): Promise<string> {
  const data = new TextEncoder().encode(`${ip}:${tenantId}`)
  const hash = await crypto.subtle.digest('SHA-256', data)
  return Buffer.from(hash).toString('hex')
}
```

IP original **nunca** é logado (FR-018). Hash sai como hex de 64 chars.

---

## 13. Slot lock — release no cancelamento

**Achado crítico do audit**: `appointment_slot_locks` (migration 0055) **persiste mesmo se appointment é estornado**. Isso significa que se Ana cancelar via link, o slot **continua bloqueado** — outra pessoa não consegue agendar no mesmo horário.

**Decisão**: ao cancelar booking público:

1. Atualizar appointment `status='cancelado'` (ou 'estornado' conforme política existente).
2. **DELETE FROM appointment_slot_locks WHERE appointment_id = $1** — libera o slot.
3. Marca `public_booking_tokens.used_at = now()`.
4. Cria `audit_log` para cancelamento (`event_type='public_booking_cancelled'`).
5. Cria `notifications` para admin com type='public_booking' indicando "cancelado".

**Atenção constitucional**: `appointment_slot_locks` é gerenciada por triggers em `appointments` (migration 0055 — verificar). Se o trigger existir, o DELETE pode ser conflitante. Validar no plan se há trigger ON UPDATE/DELETE.

**Se houver trigger conflitante**: melhor adicionar coluna `released_at TIMESTAMPTZ NULL` em `appointment_slot_locks` e setá-la em vez de DELETE. Slot livre = `WHERE released_at IS NULL`. **Investigar no plan, ajustar migration se necessário**.

---

## 14. Política de privacidade pública

**Decisão**: template padrão LGPD-compliance fornecido pelo Prontool, hardcoded em `src/app/agendar/[slug]/privacidade/page.tsx`. Personalização (texto livre por tenant) fica para fase 2.

**Conteúdo mínimo do template** (LGPD Art. 9):

1. Identidade da clínica (nome + CNPJ).
2. Dados coletados (nome, CPF, email, telefone, DOB).
3. Finalidade (agendar consulta).
4. Período de retenção (alinhado à política da clínica, padrão 5 anos).
5. Direitos do titular (acesso, correção, exclusão).
6. Contato do DPO/encarregado (telefone/email da clínica).
7. Base legal (consentimento + execução de contrato).

---

## 15. Internacionalização e timezone

**Decisão**: tudo em **pt-BR** no MVP. Timezone via `tenant_clinic_profile.timezone` existente (verificar — senão default 'America/Sao_Paulo').

`date-fns` + `date-fns-tz` existentes (já no projeto). Formatação consistente:

- Tela: `dd 'de' MMMM 'às' HH:mm` (ex.: "23 de junho às 14:30")
- Email: idem + "(horário de Brasília)" ou TZ específico do tenant
- `.ics`: UTC + VTIMEZONE block

---

## 16. Resumo das deps externas a adicionar

| Dep                        | Versão | Tipo     | Motivo                                       |
| -------------------------- | ------ | -------- | -------------------------------------------- |
| `ics`                      | latest | npm      | Geração `.ics`                               |
| Turnstile sitekey + secret | n/a    | env vars | Captcha (no novo package — usa fetch nativo) |

**Total**: 1 npm dep nova + 2 env vars. Custo recorrente novo: R$ 0.

---

## 17. Estrutura de migrations

**Migration 0093_public_booking.sql** — uma única migration:

1. ALTER `tenant_clinic_profile` (+5 colunas: `public_booking_slug`, `public_booking_enabled`, 3 políticas de janela).
2. CREATE `public_booking_doctors` (com campos de disponibilidade — §1).
3. CREATE `public_booking_doctor_procedures` (1:N médico→procedimento).
4. CREATE `public_booking_tokens`.
5. CREATE `public_booking_rate_limits`.
6. ALTER `notifications.type` CHECK constraint (+`public_booking`).
7. CREATE FUNCTION `public_booking_resolve_slug`.
8. CREATE FUNCTION `public_booking_slots`.
9. CREATE FUNCTION `public_booking_find_patient_by_cpf` (helper privado).
10. ALTER `appointment_slot_locks` (avaliar `released_at` — §13).
11. CREATE INDEXES.
12. GRANTs específicos para `anon` e `authenticated`.

---

## 18. Resumo: o que **não** precisa de research adicional

Itens já decididos via spec + clarifications + audit:

- ✅ Provedor de captcha (Turnstile)
- ✅ Email provider (Resend, já configurado)
- ✅ Notificação dual (email + sino)
- ✅ Modelo 1:N médico→procedimento
- ✅ Recorrente: atualiza contato, preserva nome
- ✅ Domínio do link público (`prontool.com.br/agendar/[slug]` — MVP)
- ✅ Constitution compliance pattern (RPC SECURITY DEFINER + audit_log)

Itens deferidos para `/speckit-tasks`:

- Decomposição em commits por user story
- Ordem detalhada de implementação
- Testes manuais vs automatizados por feature

---

## 19. NEEDS CLARIFICATION restantes

**Nenhum** após este research. Há 1 ponto a confirmar **durante a implementação** (não bloqueia o plano):

- **§13**: se `appointment_slot_locks` tem trigger ON UPDATE/DELETE em `appointments` que conflita com o release direto. Decisão: investigar no início da Phase 4 (tasks de cancelamento via token) e ajustar migration se necessário.
