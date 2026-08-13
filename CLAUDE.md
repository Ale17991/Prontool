# Clinni Development Guidelines

Sistema de gestão para clínicas e consultórios. Última atualização: 2026-04-27

## Active Technologies
- TypeScript 5.4 sobre Node.js 20 LTS (runtime Vercel) + Next.js 14.2 (App Router, RSC, Server Actions, Route Handlers), `@supabase/ssr` 0.5, `@supabase/supabase-js` 2.45, Zod 3.23, Tailwind 3.4, shadcn/ui (Radix), `lucide-react`, `@react-pdf/renderer` (PDF), `exceljs` (Excel) — **sem novas deps** (045-custo-materiais-financeiro)
- PostgreSQL via Supabase (local: `supabase start` :54321) com RLS por `tenant_id`. **Migration nova**: `0172_material_costs.sql` (045-custo-materiais-financeiro)
- TypeScript 5.4 sobre Node.js 20 LTS (runtime Vercel) + Next.js 14.2 (App Router, RSC, Server Actions, Route Handlers), `@supabase/ssr` 0.5, `@supabase/supabase-js` 2.45, Zod 3.23, Tailwind 3.4, shadcn/ui (Radix), `recharts` (gráficos de evolução já em uso). **Sem novas deps** — o motor de cálculo é TS puro (sem libs de estatística/nutrição). (047-plano-alimentar)
- PostgreSQL via Supabase (local: `supabase start` :54321) com RLS por `tenant_id`. **Migration nova**: `0175_nutrition_assessments.sql`. Reuso: `patient_measurements`, `patient_metric_types` (+1 métrica), `patient_metric_goals`, `patients`, `vital_signs`. (047-plano-alimentar)
- TypeScript 5.4 sobre Node.js 20 LTS (runtime Vercel) + Next.js 14.2 (App Router, RSC, Server Actions, Route Handlers), `@supabase/ssr` 0.5, `@supabase/supabase-js` 2.45, Zod 3.23, Tailwind 3.4, shadcn/ui (Radix), `lucide-react`. **Sem novas deps** — o cálculo é aritmética simples (regra de três sobre a porção de referência). (047-plano-alimentar)
- PostgreSQL via Supabase (local: `supabase start` :54321) com RLS por `tenant_id`. **Migration nova**: `0176_food_catalog_and_diet_plan.sql`. **Tabelas novas**: `food_groups`, `foods`, `food_household_measures`, `food_equivalence_lists`, `food_equivalence_items`, `diet_plan_prescriptions`. **Tabelas estendidas**: `diet_plans`, `diet_meal_items`. **Reuso (leitura)**: `nutrition_assessments` (meta VET/macros da 046), `patients`, `tenant_entitlements`. (047-plano-alimentar)
- TypeScript 5.4 sobre Node.js 20 LTS (runtime Vercel) + Next.js 14.2 (App Router, RSC, Server Actions, Route Handlers), `@supabase/ssr` 0.5, `@supabase/supabase-js` 2.45, Zod 3.23, Tailwind 3.4, shadcn/ui (Radix), `recharts` (gráficos, já em uso), `lucide-react`. **Sem novas dependências** — cálculo é aritmética simples (regra de três + comparação com faixa). (049-micronutrientes-dri-recordatorio)
- PostgreSQL via Supabase (local: `supabase start` :54321) com RLS por `tenant_id`. **Migrations novas** (próximo número livre após 0180): `micronutrients JSONB` em `foods`; tabela global `dietary_reference_intakes`; tabelas `food_recalls` + `food_recall_items`. **Seed**: micros importados da `BD ALIMENTOS` (AF, 6570 alimentos) como base global; DRIs da `BD_DRIs` (Evonut). Gabarito = planilhas em `nutri-doc/`. (049-micronutrientes-dri-recordatorio)
- TypeScript 5.4 sobre Node.js 20 LTS (runtime Vercel) + Next.js 14.2 (App Router, RSC, Route Handlers), `@supabase/ssr` 0.5, `@supabase/supabase-js` 2.45, Zod 3.23, Tailwind 3.4, shadcn/ui (Radix), `recharts` (já em uso), `lucide-react`. **Sem novas dependências** — comparação com faixa é aritmética simples; a banda de referência no gráfico usa `ReferenceArea`, já disponível no recharts instalado. (050-exames-laboratoriais)
- PostgreSQL via Supabase (local: `supabase start` :54321) com RLS por `tenant_id`. **Migration nova**: `0184_lab_reference_ranges.sql` — tabela global `lab_reference_ranges` + seed dos exames em `patient_metric_types` (`specialty='laboratorio'`) + refresh do `catalog_baseline.patient_metric_types` (gotcha 0170). **Sem alteração** em `patient_measurements` (resultados usam o schema existente). **Gabarito das faixas**: `nutri-doc/Evonut.xlsm` → aba `BD_Exames` (a aba do AF tem as colunas de unidade e faixa **100% vazias** — ver research.md D9). (050-exames-laboratoriais)
- TypeScript 5.4 sobre Node.js 20 LTS (runtime Vercel) + Next.js 14.2 (App Router, RSC, Server Actions, Route Handlers), `@supabase/ssr` 0.5, `@supabase/supabase-js` 2.45, Zod 3.23, Tailwind 3.4, shadcn/ui (Radix), `@upstash/qstash` (já instalado, usado no fluxo GHL), `lucide-react`, Pino 9. **Sem novas dependências** — o QR chega como base64 pronto do serviço de envio. O serviço em si é projeto Supabase separado (Deno/Edge Functions) sobre a Evolution API. (051-whatsapp-evolution)
- PostgreSQL via Supabase (local: `supabase start` :54321) com RLS por `tenant_id`. **Migration nova**: `0185_whatsapp_reminders.sql` — tabelas `tenant_whatsapp_config` (credencial cifrada) e `whatsapp_delivery_events` (append-only); expansão do CHECK de `status` em `appointment_reminders`; `patients.reminders_whatsapp_opt_in`; 3 colunas de canal em `tenant_clinic_profile`. (051-whatsapp-evolution)
- TypeScript 5.4 sobre Node.js 20 LTS (runtime Vercel) + Next.js 14.2 (App Router, RSC, Route Handlers), `@supabase/ssr` 0.5 / `@supabase/supabase-js` 2.45, Zod 3.23, Tailwind 3.4, shadcn/ui (Radix), `lucide-react`, `@react-pdf/renderer` (já em uso — receituário e relatórios). **Sem novas dependências** — o cálculo é regra de três mais comparação com limite. (052-rotulo-nutricional)
- PostgreSQL via Supabase (local: `supabase start` :54321) com RLS por `tenant_id`. **Migration nova**: `0187_nutrition_labels.sql` (última é a `0186` da feature 051) — tabelas `nutrition_labels` e `nutrition_label_ingredients`. **Sem alteração** em `foods` (os nutrientes de rótulo já existem no JSONB de micronutrientes desde a 049). **Sem tabela de referências normativas** (research D2). (052-rotulo-nutricional)
- TypeScript 5.4 sobre Node.js 20 LTS (runtime Vercel) + Next.js 14.2 (App Router, RSC, Server Actions, Route Handlers), `@supabase/ssr` 0.5 / `@supabase/supabase-js` 2.45, Zod 3.23, Tailwind 3.4, shadcn/ui (Radix), `lucide-react`. **Sem novas dependências** — a avaliação é consulta SQL mais aritmética de datas, e o envio já existe. (056-automacoes-mensagem)
- PostgreSQL via Supabase com RLS por `tenant_id`. **Migration nova**: `0196_message_automations.sql` (última é a `0195`). **Tabelas novas**: `message_templates`, `automation_triggers`, `automations`, `automation_occurrences`. **Coluna nova**: `patients.automations_opt_in`. (056-automacoes-mensagem)

- TypeScript 5.4 sobre Node.js 20 LTS (runtime Vercel) + Next.js 14.2 (App Router), React 18.3, Tailwind CSS 3.4, shadcn/ui (Radix primitives), framer-motion 12, lucide-react (003-responsive-design)
- N/A — feature de UI pura, não persiste nada (003-responsive-design)
- TypeScript 5.4 sobre Node.js 20 LTS (runtime Vercel). + Next.js 14.2 (App Router), React 18.3, `@supabase/ssr` 0.5, `@supabase/supabase-js` 2.45, Zod 3.23, Tailwind CSS 3.4, shadcn/ui (Radix primitives), `date-fns` 4.1, `framer-motion` 12, `lucide-react`. (004-calendario-atendimentos)
- PostgreSQL via Supabase (local dev: `supabase start`, porta 54321) com RLS por `tenant_id`. Tabelas tocadas: `appointments` (acrescenta `duration_minutes`), `tuss_codes` + `tuss_catalog_versions` (registro documental). Catálogo TUSS é leitura. (004-calendario-atendimentos)
- TypeScript 5.4 sobre Node.js 20 LTS (runtime Vercel). + Next.js 14.2 (App Router), React 18.3, `@supabase/ssr` 0.5, `@supabase/supabase-js` 2.45, Zod 3.23, Tailwind CSS 3.4, shadcn/ui, `date-fns` 4.1, Pino 9. (005-agenda-plano-integracao)
- PostgreSQL via Supabase. **Nova extensão**: `btree_gist` (no schema `extensions`) para suportar EXCLUDE com `=` em UUIDs + `&&` em `tstzrange`. Tabelas tocadas: `appointments` (sem mudança de colunas — só novos triggers/índices), `appointment_reversals` (apenas leitura por trigger novo), `treatment_plan_steps` (acrescenta `appointment_id` via column-guard relaxado para essa coluna no INSERT). Tabelas novas: `appointment_completions`, `appointment_slot_locks`. (005-agenda-plano-integracao)
- TypeScript 5.4 sobre Node.js 20 LTS (runtime Vercel). + Next.js 14.2 (App Router), React 18.3, `@supabase/ssr` 0.5, `@supabase/supabase-js` 2.45, Zod 3.23, Tailwind CSS 3.4, shadcn/ui, `lucide-react`, `date-fns` 4.1. (006-comprovantes-particular)
- PostgreSQL via Supabase + Supabase Storage. Tabelas tocadas: `appointments` (ALTER `plan_id` para nullable), `expenses` (3 colunas legadas mantidas até 0060), `audit_log` (uso, sem schema change). Tabelas novas: `expense_receipts`. Bucket: `expense-receipts` (já criado em 0058). (006-comprovantes-particular)
- TypeScript 5.4 sobre Node.js 20 LTS (runtime Vercel) + Next.js 14.2 (App Router), React 18.3, `@supabase/ssr` 0.5, `@supabase/supabase-js` 2.45, Zod 3.23, Tailwind CSS 3.4, shadcn/ui (Radix primitives), `date-fns` 4.1, `lucide-react`, Pino 9 (007-linguagem-simples-materiais-whatsapp)
- PostgreSQL via Supabase (local dev: `supabase start`, porta 54321) com RLS por `tenant_id`. Próxima migration: **`0061_appointment_materials.sql`**. Tabelas tocadas: nova `appointment_materials`; tabela existente `tuss_codes` (somente leitura, filtro `tuss_table='19'`); `audit_log` (uso, sem schema change). Sem mudanças em banco para Features 2 e 3. (007-linguagem-simples-materiais-whatsapp)
- TypeScript 5.4 sobre Node.js 20 LTS (runtime Vercel). + Next.js 14.2 (App Router), `@supabase/ssr` 0.5, `@supabase/supabase-js` 2.45, Zod 3.23 (schemas OAuth + payloads webhook), Pino 9, React 18.3, shadcn/ui (Radix), TailwindCSS 3.4. **Sem novas deps de runtime** — `fetch` nativo + `AbortSignal.timeout(5000)` para chamadas GHL; `crypto.randomUUID` + `crypto.timingSafeEqual` para state/csrf e verificação de assinatura. (008-ghl-marketplace-oauth)
- PostgreSQL via Supabase (local: `supabase start` :54321) com RLS por `tenant_id`. **Tabelas tocadas**: `tenant_integrations` (acrescenta colunas `status TEXT`, `connected_at TIMESTAMPTZ`, `location_id TEXT GENERATED ALWAYS AS (config->>'location_id') STORED` para índice unique), `audit_log` (uso, sem schema change), `alerts` (uso). **Tabelas novas**: `integration_sync_log` (append-only, retenção das últimas 10 entradas por tenant×provider via trigger). **Migration nova**: `0062_ghl_oauth_marketplace.sql`. Catálogo de custom fields é dado externo (sub-account GHL) — IDs persistidos em `tenant_integrations.config.custom_field_ids`. (008-ghl-marketplace-oauth)
- TypeScript 5.4 sobre Node.js 20 LTS (runtime Vercel). + Next.js 14.2 (App Router), `@supabase/ssr` 0.5, `@supabase/supabase-js` 2.45 (incluindo `auth.admin` via Service Role), Zod 3.23, Tailwind CSS 3.4, shadcn/ui (Radix), `lucide-react`, `@react-pdf/renderer` 3.4 (já presente — receberá o novo header). **Sem novas deps de runtime** — ViaCEP via `fetch` nativo com `AbortSignal.timeout(3000)`; validação de CNPJ feita por helper puro local; máscaras com `react-input-mask` opcional ou implementação inline (preferível inline para evitar nova dep). (009-configuracoes-clinica-equipe)
- PostgreSQL via Supabase (local `supabase start` :54321) com RLS por `tenant_id`. **Migration nova**: `0064_clinic_profile_and_team_management.sql`. **Tabelas tocadas**: `user_tenants` (acrescenta `status`, `disabled_at`, `disabled_by`); `audit_log` (uso, sem schema change). **Tabelas novas**: `tenant_clinic_profile`, `user_profile`. **Buckets novos**: `clinic-logos` (privado, leitura por mesmo tenant via RLS em `storage.objects`), `user-avatars` (privado, leitura para autenticados do mesmo tenant). Funções DB novas: `is_last_active_admin(tenant_id, user_id)` e trigger `enforce_last_admin` em `user_tenants`. (009-configuracoes-clinica-equipe)
- TypeScript 5.4 sobre Node.js 20 LTS (runtime Vercel). + Next.js 14.2 (App Router), `@supabase/ssr` 0.5, `@supabase/supabase-js` 2.45, Zod 3.23, Tailwind 3.4, shadcn/ui (Radix), `date-fns` 4.1, `lucide-react`. **Sem novas deps de runtime**. Para o calendário usamos `date-fns` (já em deps) — para semana/mês/range; mini-calendário é componente próprio (não há libs no projeto que façam render de mês compacto, e adicionar uma só para isso é overkill). (010-multi-tenant-ghl-calendar)
- PostgreSQL via Supabase (local `supabase start` :54321). **Migration nova**: `0065_active_tenant_and_signup.sql`. **Tabelas tocadas**: nenhuma alteração de schema em `tenants`, `tenant_integrations` ou `user_tenants` (todos os FRs se apoiam nas estruturas existentes). **Tabela nova**: `user_active_tenant` (1:1 com `auth.users`, persiste última clínica usada). **Função nova**: `create_first_tenant(p_user_id, p_name, p_slug, p_cnpj, p_phone)` SECURITY DEFINER — atomicidade da criação onboarding (insert tenants + insert user_tenants admin + insert user_active_tenant). **Função alterada**: `auth_hook_custom_claims` recebe nova prioridade de leitura `user_active_tenant`. (010-multi-tenant-ghl-calendar)
- TypeScript 5.4 sobre Node.js 20 LTS (runtime Vercel). + Next.js 14.2 (App Router), `@supabase/ssr` 0.5, `@supabase/supabase-js` 2.45, Zod 3.23, Tailwind CSS 3.4, shadcn/ui (Radix primitives), `lucide-react`, Pino 9. **Sem novas deps**. (011-cadastro-impostos)
- PostgreSQL via Supabase (local: `supabase start` :54321) com RLS por `tenant_id`. **Migration nova**: `0076_taxes_and_plan_tax_rate.sql` cria `public.taxes`, acrescenta `health_plans.tax_rate_bps`, acrescenta `expenses.tax_id`. Triggers de append-only e audit usam o padrão existente (`enforce_append_only`, `log_audit_event`, `session_uuid('app.actor_id')`). (011-cadastro-impostos)
- TypeScript 5.4 sobre Node.js 20 LTS (runtime Vercel). + Next.js 14.2 (App Router), `@supabase/ssr` 0.5, `@supabase/supabase-js` 2.45 (incluindo `auth.admin.createUser`), Zod 3.23, Tailwind CSS 3.4, shadcn/ui (Radix), `lucide-react`, `date-fns` 4.1. **Sem novas deps**. (012-tarefas-notificacoes-usuarios)
- PostgreSQL via Supabase (local: `supabase start` :54321) com RLS por `tenant_id`. **Migration nova**: `0078_tasks_notifications_user_link.sql`. **Tabelas novas**: `public.tasks`, `public.notifications`. **Tabela alterada**: `public.doctors` (adiciona `user_id UUID NULL` + UNIQUE parcial `(tenant_id, user_id) WHERE user_id IS NOT NULL`). **RPC nova**: `generate_user_notifications(p_tenant_id UUID, p_user_id UUID) RETURNS jsonb` (SECURITY DEFINER) — gera lazy as 4 categorias usando UPSERT com `ON CONFLICT DO NOTHING` sobre UNIQUE natural key. (012-tarefas-notificacoes-usuarios)
- TypeScript 5.4 sobre Node.js 20 LTS (runtime Vercel). + Next.js 14.2 (App Router), `@supabase/ssr` 0.5, `@supabase/supabase-js` 2.45, Zod 3.23, Tailwind CSS 3.4, shadcn/ui (Radix), `lucide-react`, `date-fns` 4.1, Pino 9. **Sem novas deps**. (013-modalidades-pagamento-assistente)
- TypeScript 5.4 sobre Node.js 20 LTS (runtime Vercel) + Next.js 14.2 (App Router), React 18.3, Tailwind CSS 3.4, shadcn/ui (Radix primitives), `lucide-react`. **Sem novas deps** — usa apenas o que já está no projeto. (014-sidebar-config-hub)
- N/A — feature pura de UI; nenhuma migration, RLS, função SQL ou bucket é tocado. (014-sidebar-config-hub)
- TypeScript 5.4 sobre Node.js 20 LTS (runtime Vercel) + Next.js 14.2 (App Router), React 18.3, Tailwind CSS 3.4, shadcn/ui (Radix primitives), `lucide-react ^1.8.0` (já instalado; ícones verificados), `next/font/google` (novo uso, sem nova dep — já em Next.js) (016-designer-palette-rollout)
- N/A (feature pura de UI/CSS — `FR-027` proíbe qualquer mudança em DB) (016-designer-palette-rollout)
- TypeScript 5.4 sobre Node.js 20 LTS (runtime Vercel). + Next.js 14.2 (App Router + Server Actions + RSC), `@supabase/ssr` 0.5, `@supabase/supabase-js` 2.45, Zod 3.23 (validação payload público), Tailwind CSS 3.4, shadcn/ui (Radix), `date-fns` 4.1 + `date-fns-tz` (formatação timezone), Pino 9 (observabilidade). **Novas deps**: `ics` (~30kb gzipped, MIT). **Novas env vars**: `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`. (017-public-booking)
- PostgreSQL via Supabase. **Migration nova**: `0084_public_booking.sql`. **Tabelas tocadas**: `tenant_clinic_profile` (acrescenta 5 colunas), `notifications` (expande CHECK constraint do `type`). **Tabelas novas**: `public_booking_doctors`, `public_booking_doctor_procedures`, `public_booking_tokens`, `public_booking_rate_limits`. **Funções DB novas**: `public_booking_resolve_slug` (INVOKER), `public_booking_slots` (DEFINER), `public_booking_find_patient_by_cpf` (DEFINER, helper privado). (017-public-booking)
- TypeScript 5.4 sobre Node.js 20 LTS (runtime Vercel). + Next.js 14.2 (App Router + Server Actions + RSC), `@supabase/ssr` 0.5, `@supabase/supabase-js` 2.45, Zod 3.23 (validação payload), Tailwind CSS 3.4, shadcn/ui (Radix), `lucide-react`, `date-fns` 4.1 + `date-fns-tz` (já presente — fuso da clínica), Pino 9 (observabilidade), Resend (já presente — `resend-client.ts`). **Sem novas deps de runtime.** (018-appointment-reminders)
- PostgreSQL via Supabase (local stack: `supabase start` :54321) com RLS por `tenant_id`. **Migration nova**: `0094_appointment_reminders.sql`. **Tabelas tocadas**: `tenant_clinic_profile` (acrescenta 6 colunas de configuração de lembrete + 1 coluna histórica de último ciclo), `patients` (acrescenta `reminders_opt_in BOOLEAN DEFAULT TRUE`), `audit_log` (uso via `log_audit_event`, sem schema change). **Tabela nova**: `appointment_reminders` (append-only com trigger anti-update fora do path `queued→sent/failed`). **Sem mudanças em RLS de tabelas existentes** (só adiciona policies novas para as colunas e tabela acrescentadas). (018-appointment-reminders)
- TypeScript 5.4 sobre Node.js 20 LTS (runtime Vercel) + Next.js 14.2 (App Router + RSC + Server Actions), `@supabase/ssr` 0.5, `@supabase/supabase-js` 2.45, Tailwind CSS 3.4, shadcn/ui (Radix `Sheet`, `Dialog`, `Tabs` já presentes — confirmado em `src/components/ui/`), `date-fns` 4.1, `lucide-react`, `recharts` (já em uso por `VitalSignsSection`) (019-prontuario-timeline-quickview)
- PostgreSQL via Supabase — **somente leitura** dos schemas existentes. Tabelas tocadas (read-only): `patients`, `appointments_effective` (view), `clinical_records`, `vital_signs`, `patient_allergies`, `patient_diagnoses`, `patient_history`, `treatment_plan_steps`, `appointments`, `payment_records`/`expenses`, `doctors`, `user_profile`, `health_plans`, `procedures`. **Sem migration nova.** (019-prontuario-timeline-quickview)
- TypeScript 5.4 sobre Node.js 20 LTS (runtime Vercel) + Next.js 14.2 (App Router + RSC + Server Actions), `@supabase/ssr` 0.5, `@supabase/supabase-js` 2.45, Zod 3.23, Tailwind CSS 3.4, shadcn/ui (Radix `Dialog`, `Sheet`, `Tabs`, `Table` já presentes), `date-fns` 4.1 + `date-fns-tz`, `lucide-react`, `recharts` (já em uso), Pino 9. **Sem novas deps de runtime**. (023-financeiro-fluxo-repasse)
- PostgreSQL via Supabase (local: `supabase start` :54321) com RLS por `tenant_id`. **Migration nova**: `0096_financeiro_operacional.sql`. **Tabelas novas**: `installment_payments`, `monthly_payouts`, `monthly_payouts_adjustments`, `monthly_payouts_reopens`, `tenant_cash_balance_adjustments`. **Tabela alterada**: `expenses` (6 colunas novas, todas nullable — backwards compatible). **Funções DB novas**: `close_monthly_payout(p_tenant_id, p_month)` SECURITY DEFINER, `reopen_monthly_payout(p_tenant_id, p_month, p_reason)` SECURITY DEFINER, `record_installment_payment(...)` SECURITY DEFINER, `tenant_cash_balance_at(p_tenant_id, p_date)`. **Triggers**: anti-UPDATE/DELETE em tabelas append-only + auto-geração de `monthly_payouts_adjustments` quando atendimento de mês fechado é estornado. (023-financeiro-fluxo-repasse)
- TypeScript 5.4 sobre Node.js 20 LTS (runtime Vercel). + Next.js 14.2 (App Router + Server Actions + RSC), React 18.3, shadcn/ui (`Sheet` já presente em `src/components/ui/sheet.tsx`, baseado em `@radix-ui/react-dialog`), `lucide-react`, Tailwind CSS 3.4. **Sem novas deps.** (025-agenda-sheet-modal)
- N/A — feature pura de UI/orquestração. Não toca em migrations, RLS, funções SQL ou buckets. (025-agenda-sheet-modal)
- TypeScript 5.4 sobre Node.js 20 LTS (runtime Vercel) + Next.js 14.2 (App Router, Route Handlers, Server Actions, RSC), `@supabase/ssr` 0.5 / `@supabase/supabase-js` 2.45, Zod 3.23, Pino 9, Tailwind 3.4, shadcn/ui. **Sem novas deps de runtime** — `fetch` nativo + `AbortSignal.timeout(5000)` para a API Memed; carregamento do script Memed via `<script>` no cliente. (026-memed-prescricao-digital)
- PostgreSQL via Supabase (local: `supabase start` :54321) com RLS por `tenant_id`. **Migration nova**: `0110_memed_prescription.sql` (renumerada de 0108 por colisão com `0108_audit_public_booking_security_definer.sql` e `0109_support_tickets.sql` já em produção/master). **Tabelas novas**: `tenant_memed_config` (credenciais por clínica, cifradas via `enc_text_with_key`), `memed_prescribers`, `prescription_records`. **Tabelas tocadas (uso)**: `audit_log` (via `log_audit_event`). **Sem mudança** em `tenant_integrations` (decisão D1: Memed é request/response, não event-bus — tabela dedicada em vez de reusar o provider GHL), nem em `doctors`/`patients` (campos já existem: `doctors.cpf/council_state/birth_date` da 0107; paciente em `_enc`). (026-memed-prescricao-digital)
- TypeScript 5.4 sobre Node.js 20 LTS (mesma stack do app) (027-memed-conformidade)
- nenhuma migração nova. Lê apenas: `tenant_memed_config`, `memed_prescribers`, `prescription_records`, `audit_log` — criadas pelo spec 026. (027-memed-conformidade)
- TypeScript 5.4 sobre Node.js 20 LTS (runtime Vercel) + Next.js 14.2 (App Router, RSC, Route Handlers, Server Actions), `@supabase/ssr` 0.5 / `@supabase/supabase-js` 2.45, Zod 3.23, `recharts` (já em uso), Pino 9, Tailwind/shadcn. **Sem novas deps** — sessão do paciente via **cookie HMAC-SHA256** (Node `crypto` nativo, reusando o padrão de `src/lib/integrations/ghl/oauth/state.ts`); gráficos via `recharts` já existente. (030-portal-paciente-endocrino)
- PostgreSQL via Supabase com RLS por `tenant_id`. **Migration nova**: `0113_patient_portal_measurements.sql` (a 0112 está **reservada pela feature 029/TISS**, ainda não mesclada — usar 0113 evita a colisão de numeração). **Tabelas novas**: `patient_measurements` (motor de medições, append-only), `patient_metric_types` (catálogo de métricas + faixas plausíveis, seed endócrino), `patient_portal_access_log` (auditoria de acesso do paciente, append-only). **Tabela tocada**: `public_booking_rate_limits` (ALTER do CHECK de `action` para incluir `'patient_login'`). **Reuso (sem schema change)**: `vital_signs` (peso/IMC/PA), `appointments` (histórico), `patients` (PII cifrada via RPC), `tenant_clinic_profile` (slug). **RPC nova**: `patient_portal_verify_login(p_slug, p_cpf, p_birthdate, p_key)` SECURITY DEFINER. (030-portal-paciente-endocrino)
- TypeScript 5.4 sobre Node.js 20 LTS (runtime Vercel) + Next.js 14.2 (App Router, Route Handlers, Server Actions, RSC), `@supabase/ssr` 0.5 / `@supabase/supabase-js` 2.45, Zod 3.23, Pino 9, Tailwind 3.4, shadcn/ui. **Novas deps de runtime** (justificadas — padrão ANS exige XML+XSD+assinatura, não se faz à mão com segurança): (029-faturamento-tiss)
- PostgreSQL via Supabase (local: `supabase start` :54321) com RLS por `tenant_id`. **Migration nova**: `0112_tiss_faturamento.sql` (próximo número livre — última é `0111_memed_platform_keys.sql`). **Tabelas novas**: `tenant_tiss_operator_config`, `tenant_tiss_certificates`, `tiss_guias`, `tiss_guia_procedures`, `tiss_lotes`, `tiss_glosas`, `tiss_domain_tables`. **Tabelas tocadas (uso, sem schema change)**: `audit_log` (via `log_audit_event`), `appointments`/`appointment_procedures`/`appointments_effective`, `health_plans`, `doctors`, `patients` (decifra via RPC), `tuss_codes`. **Sem alteração** em `health_plans` (o Registro ANS e o código do contratado ficam na nova `tenant_tiss_operator_config`, 1:1 com o convênio — evita poluir a tabela base e mantém TISS opt-in). (029-faturamento-tiss)
- TypeScript 5.4 sobre Node.js 20 LTS (runtime Vercel) + Next.js 14.2 (App Router, RSC, Route Handlers), `@supabase/ssr` 0.5 / `@supabase/supabase-js` 2.45, Zod 3.23, Tailwind CSS 3.4, shadcn/ui (Radix), `lucide-react`. **Sem novas deps** — odontograma renderizado em SVG inline. (039-odontograma-interativo)
- PostgreSQL via Supabase (local: `supabase start` :54321) com RLS por `tenant_id`. **Migration nova**: `0133_odontogram.sql`. **Tabelas novas**: `dental_status_catalog` (global, sem tenant_id — padrão `tuss_codes`), `dental_chart_entries` (per-tenant, append-only). **RPC nova**: `dental_chart_current(p_tenant_id, p_patient_id)` (DEFINER) — estado atual por posição. **Tabelas tocadas (uso)**: `tuss_codes` (leitura, `tuss_table='22'`), `audit_log` (via `log_audit_event`). (039-odontograma-interativo)
- TypeScript 5.4 sobre Node.js 20 LTS (runtime Vercel) + Next.js 14.2 (App Router, RSC, Route Handlers), `@supabase/ssr` 0.5 / `@supabase/supabase-js` 2.45, Zod 3.23, Tailwind CSS 3.4, shadcn/ui (Radix), `lucide-react`. **Sem novas deps** — grade do periograma em tabela HTML/React; comparação reusa `recharts` (já presente) apenas se houver gráfico de evolução (opcional). (041-periograma)
- PostgreSQL via Supabase (local: `supabase start` :54321) com RLS por `tenant_id`. **Migration nova**: `0161_perio_chart.sql`. **Tabelas novas**: `perio_exams` (cabeçalho do exame, ciclo rascunho→finalizado), `perio_site_measurements` (6 sítios/dente), `perio_tooth_findings` (mobilidade/furca/ausente/implante). **Tabelas tocadas (uso)**: `patients`, `appointments` (FK opcional + consistência tenant), `audit_log` (via `log_audit_event`). **RPC nova**: `perio_exam_indicators(p_tenant_id, p_exam_id)` (DEFINER) — indicadores agregados. (041-periograma)
- TypeScript 5.4 / Node.js 20 LTS (runtime Vercel) + Next.js 14.2 (App Router, RSC, Server Actions), React 18.3, `@supabase/ssr` 0.5 / `@supabase/supabase-js` 2.45, Tailwind 3.4, shadcn/ui. **Sem novas deps.** (042-modulos-especialidade)
- PostgreSQL via Supabase. Tabela tocada: `tenant_entitlements` (coluna `modules TEXT[]`, só dados — sem mudança de schema). Migração nova: `0162_specialty_modules.sql`. Tabelas LIDAS para o sinal de uso (read-only): `appointment_procedures` (plan_id), `tenant_tiss_operator_config`, `tiss_guias`, `dental_chart_entries`, `perio_exams`, `ophthalmology_exams`. (042-modulos-especialidade)
- TypeScript 5.4 / Node.js 20 LTS (runtime Vercel) + Next.js 14.2 (App Router, RSC, Server Actions, Route Handlers), `@supabase/ssr` 0.5 / `@supabase/supabase-js` 2.45, Zod 3.23, Tailwind 3.4, shadcn/ui. **Sem novas deps.** (043-permissoes-granulares-admin)
- PostgreSQL via Supabase, RLS por `tenant_id`. **Migration nova**: `0163_user_permission_overrides.sql`. **Tabela nova**: `user_permission_overrides`. **Tabelas tocadas (uso)**: `audit_log`, `user_tenants` (papel/status — já existe), `tenant_clinic_profile` (edição pelo /admin). **Funções existentes reusadas**: `enforce_last_admin`, `log_audit_event`. (043-permissoes-granulares-admin)
- TypeScript 5.4 / Node.js 20 LTS (runtime Vercel) + Next.js 14.2 (App Router, RSC, Server Actions), `@supabase/ssr` 0.5 / `@supabase/supabase-js` 2.45, Zod 3.23, Tailwind 3.4, shadcn/ui, `recharts` (já em uso, p/ gráficos opcionais), `date-fns`. **Sem novas deps.** (044-admin-painel-plataforma)
- PostgreSQL via Supabase. **Migration nova**: `0165_plan_prices.sql`. **Tabela nova**: `plan_prices` (global, sem tenant_id — preço por plano, em centavos). **Tabelas LIDAS (cross-tenant, service client)**: `tenant_entitlements` (plan/status/trial_ends_at), `tenants`, `user_tenants`, `appointments`, `audit_log`, `alerts`, `integration_sync_log`, `appointment_reminders`. `audit_log` (uso na edição de preço). (044-admin-painel-plataforma)

- TypeScript 5.4+ sobre Node.js 20 LTS (runtime Vercel) + Next.js 14.2 (App Router), `@supabase/ssr` 0.5, `@supabase/supabase-js` 2.45, Zod 3.23, Pino 9, React 18.3, Radix UI, TailwindCSS 3.4 (002-ghl-optional-standalone)
- PostgreSQL via Supabase (local stack: `supabase start` :54321) com RLS por `tenant_id`. Tabelas de integrações multi-provider: `tenant_integrations` (source-of-truth de "o tenant está conectado?" — zero linhas = standalone), `alerts` (type `integration_sync_failed` com `detail.provider`), `audit_log` (`event_type` `integration.{connect,reconfigure,disconnect}`). Tabela legada `tenant_ghl_config` ainda é lida pelo worker de ingestão GHL — drop planejado (migration 0041 já existe como NOOP placeholder). (002-ghl-optional-standalone)

- TypeScript 5.4+ sobre Node.js 20 LTS (runtime Vercel). (001-faturamento-medico-ghl)

## Integration architecture (features 002, 008)

- **Plugin adapter pattern**: `src/lib/integrations/<provider>/adapter.ts` implementa `IntegrationAdapter<Config, Credentials>` (veja `src/lib/integrations/types.ts`). Registrado em `src/lib/integrations/registry.ts`. Providers hoje: `ghl` (inbound + outbound) e `generic_webhook` (outbound). Placeholders: hubspot, rdstation, pipedrive.
- **Event bus**: core publica `DomainEvent` (`patient.created`, `appointment.created`, `appointment.reversed`) via `src/lib/core/events/publish.ts`. `dispatch.ts` faz fan-out `Promise.allSettled` com timeout 5 s por adapter; falhas geram alerta `integration_sync_failed` com `detail.provider`.
- **Standalone mode**: tenant sem linha ativa em `tenant_integrations` → `getEnabledIntegrations` retorna `[]` → dispatcher retorna `[]` → zero chamadas externas, zero alertas, zero menções a providers na UI (sidebar badge fica null).
- **Inbound webhooks**: `/api/webhooks/[provider]` rota dinâmica delega para `adapter.handleInboundWebhook(supabase, req)`. `/api/webhooks/ghl` mantido como thin-forward por back-compat.
- **Credenciais**: JSON serializado e cifrado em `tenant_integrations.credentials_enc` via `enc_text_with_key`. Adapter decripta via `src/lib/core/integrations/credentials.ts`. Lint:auth rejeita `process.env.GHL_*` / `HUBSPOT_*` / etc. em arquivos de adapter.
- **Config UI**: `/configuracoes/integracoes` + `/configuracoes/integracoes/[provider]`, admin-only. Schema do form vem do `configSchema` / `credentialsSchema` do adapter serializado como JSON Schema pela rota.

### Feature 008 — GHL Marketplace OAuth 2.0 (extensão)

- **Cápsula `oauth/`** em `src/lib/integrations/ghl/oauth/` é o **único** lugar autorizado a ler `process.env.GHL_CLIENT_ID/SECRET/REDIRECT_URI/SCOPES/MARKETPLACE_SHARED_SECRET/SSO_*`. Adapter (`adapter.ts`, `create-contact.ts`, `create-note.ts`, `update-contact.ts`) recebe `accessToken` via `withGhlAuth(supabase, tenantId)` que faz auto-refresh com CAS sobre `updated_at` (sem advisory lock, incompatível com pgBouncer transaction-mode).
- **Marketplace lifecycle**: `/api/oauth/ghl/{authorize,callback,refresh}` para conexão manual; `/api/webhooks/ghl/{install,uninstall}` (HMAC-SHA256 + janela ±5min) para o Marketplace. Ambos convergem em `connectGhlTenant`/`disconnectGhlTenant` em `src/lib/core/integrations/ghl/`.
- **Post-connect setup**: `runPostConnectSetup` (em `src/lib/core/integrations/ghl/post-connect-setup.ts`) orquestra `customFieldsSetup` (6 fields, sufixa "(Clinni)" em colisão de tipo) + `webhooksSetup` (3 hooks) + `customMenuSetup` (best-effort). Roda fire-and-forget em produção, `await` em testes.
- **Tabela `integration_sync_log`** (migration 0062) é append-only com RLS read-only-tenant; populada via `recordSyncSuccess/Failure` em `src/lib/core/integrations/ghl/sync-log.ts` com PII mascarada (`mask-pii.ts`). UI lê últimas 10 entradas em `/configuracoes/integracoes/ghl`.
- **SSO/Custom Menu** (US5): `/api/sso/ghl` valida JWT contexto via JWKS (`verify-sso-token.ts` — RS256 com `crypto.createPublicKey({format:'jwk'})`, sem `jose`). Auto-login completo (mintar JWT Supabase) é follow-up.

## Project Structure

```text
src/
├── app/(dashboard)/            # SSR pages; layout.tsx lê getEnabledIntegrations via RLS client
├── app/api/                    # Route Handlers; cada um chama requireRole
├── lib/integrations/           # Adapters (um diretório por provider) + registry + types
├── lib/core/                   # Domain (patients, appointments, events, integrations/config+credentials)
└── lib/db/                     # Supabase clients (service vs server vs browser)

supabase/migrations/
```

## Commands

```bash
pnpm test              # vitest full suite
pnpm test:integration  # integration tests only
pnpm test:contract     # contract tests (aplicado a todo adapter)
pnpm typecheck
pnpm lint:auth         # requireRole em /api/* + adapters sem env direto
pnpm supabase:reset    # aplica todas as migrations localmente
pnpm supabase:gen-types
```

## Code Style

TypeScript 5.4+ sobre Node.js 20 LTS (runtime Vercel).: Follow standard conventions

## Recent Changes
- 056-automacoes-mensagem: Added TypeScript 5.4 sobre Node.js 20 LTS (runtime Vercel) + Next.js 14.2 (App Router, RSC, Server Actions, Route Handlers), `@supabase/ssr` 0.5 / `@supabase/supabase-js` 2.45, Zod 3.23, Tailwind 3.4, shadcn/ui (Radix), `lucide-react`. **Sem novas dependências** — a avaliação é consulta SQL mais aritmética de datas, e o envio já existe.
- 052-rotulo-nutricional: Added TypeScript 5.4 sobre Node.js 20 LTS (runtime Vercel) + Next.js 14.2 (App Router, RSC, Route Handlers), `@supabase/ssr` 0.5 / `@supabase/supabase-js` 2.45, Zod 3.23, Tailwind 3.4, shadcn/ui (Radix), `lucide-react`, `@react-pdf/renderer` (já em uso — receituário e relatórios). **Sem novas dependências** — o cálculo é regra de três mais comparação com limite.
- 051-whatsapp-evolution: Added canal WhatsApp no motor de lembretes da 018. Envio via serviço separado (Supabase + Edge Functions sobre a Evolution API), um número por clínica. **Sem novas dependências** — espaçamento dos envios pelo `@upstash/qstash` já instalado.


<!-- MANUAL ADDITIONS START -->

## Exames laboratoriais (feature 050)

Resultado de exame **não tem tabela própria**: reusa o motor de medições da 030.
Cada analito é uma linha em `patient_metric_types` com `specialty='laboratorio'`
(os 6 exames da 0113 — `glicemia_jejum`, `hba1c`, `colesterol_total`, `ldl`,
`hdl`, `triglicerides` — mantêm `specialty='endocrino'` e a **chave legada**,
porque linhas globais são append-only); cada resultado é uma linha append-only em
`patient_measurements`.

- **Catálogo TS**: `src/lib/core/labs/catalog.ts` (85 analitos) é a fonte da
  verdade de "o que é exame e em que painel aparece" — resolve o fato de os
  legados estarem marcados como endócrino. `units.ts` normaliza as unidades da
  planilha e **lança** em grafia desconhecida.
- **Faixas**: `lab_reference_ranges` (0184), catálogo global read-only espelhando
  `dietary_reference_intakes`, com `ref_min`/`ref_max` **nuláveis independentes**
  (há exame só-com-teto e só-com-piso). Seed: `pnpm seed:lab-ranges`
  (fonte: `nutri-doc/Evonut.xlsm` → aba `BD_Exames`; a aba do AF tem as faixas
  vazias e não serve).
- **Classificação** (`classify.ts`) é **derivada, nunca persistida**: corrigir uma
  faixa reclassifica o histórico sem reescrever registro.
- **Limitação conhecida**: a fonte só recorta por **sexo**. O schema e o lookup
  implementam sexo × idade × estado, mas o seed grava tudo como `0–130/padrao`.
  Inserir faixas etárias depois não exige código novo.
- `min_plausible`/`max_plausible` do catálogo são **anti-typo, não faixa clínica**
  — ficam folgados (~10× o limite de referência) para não rejeitar no INSERT o
  resultado gravemente alterado.

<!-- MANUAL ADDITIONS END -->

## Lembretes por WhatsApp (feature 051)

O canal WhatsApp do motor de lembretes (018). O envio **não** acontece aqui: passa
por um **serviço separado** (repo `Homio-CRM/clinni-whatsapp`, projeto Supabase
próprio `clinni-whatsapp` em sa-east-1) que fala com a Evolution API. Um número
por clínica, conectado por QR em autoatendimento.

- **WhatsApp NÃO está no registry de `IntegrationAdapter`.** Aquele contrato é
  event-bus (`handleDomainEvent`), e lembrete é request/response disparado pelo
  cron horas depois — o adapter ficaria com o método vazio, e a tela genérica de
  `/configuracoes/integracoes/[provider]` não sabe renderizar um QR. Seguimos o
  precedente da Memed (026 D1): cápsula própria em `src/lib/core/whatsapp/` com
  tabela dedicada.
- **A confirmação de entrega vive em `whatsapp_delivery_events`**, append-only, e
  NÃO em `appointment_reminders`: o trigger `enforce_reminders_status_transition`
  (0094) só permite `queued → terminal`. "Status atual" é regra de **leitura**,
  resolvida por precedência de rank (`sent < delivered < read < error`) — nunca
  pelo evento mais recente, porque confirmações chegam fora de ordem.
- **Espaçamento via QStash com delay crescente, por clínica** (`process-batch`).
  Não é cron mais frequente: acima de diário trava TODOS os deploys no Hobby.
  Sem `QSTASH_TOKEN` o ciclo cai num envio inline de lote pequeno (dev).
- **Idempotência ponta a ponta**: o `externalId` mandado ao serviço é o **id do
  lembrete**, e o serviço tem `UNIQUE (tenant_id, external_id)`. Retentativa não
  duplica mensagem.
- **Consentimento é hierárquico**: `patients.reminders_opt_in` é o mestre e cala
  todos os canais; `reminders_whatsapp_opt_in` só é consultado quando o mestre é
  TRUE. São manifestações distintas em LGPD.
- **Rollout por módulo** `whatsapp` (`ent.hasModule`), ligável por clínica no
  `/admin`. O gate está na PÁGINA e no **MOTOR** (`process-batch.ts`), não só no
  card do hub: `reminder_channels` é estado persistido, então o gate de UI só
  impede de LIGAR o canal — sem a checagem no motor, uma clínica que teve o
  módulo revogado continuaria enviando para sempre. Módulo desligado não gera
  alerta (não é falha operacional, é ausência de contratação).
- **O SC-004 é derivado, nunca gravado** (`whatsapp/metrics.ts`): a taxa de
  leitura em 24h é recomposta de `whatsapp_delivery_events` a cada leitura, então
  corrigir a regra reapura o histórico. A apuração é em DOIS passos — descobre os
  candidatos, depois lê o histórico completo de cada um — porque julgar um
  lembrete por um pedaço da sua linha do tempo erra nas duas bordas: no fim a
  leitura que atravessa a virada some, no início um `read` órfão é contado neste
  período E no anterior. Taxa é `null` (não `0`) quando não houve entrega.
- **Migrations**: `0185_whatsapp_reminders.sql` (tabelas + colunas de canal) e
  `0186_whatsapp_callback_secret.sql` (Bearer do callback, por clínica).
- **Risco aceito**: Evolution/Baileys é não-oficial. Se o número **da clínica**
  for bloqueado, o problema é de suporte nosso, não da Meta. Decisão consciente
  de 2026-07-28. A única mitigação implementada é o espaçamento.
- **Testes**: `setup.ts` SOBRESCREVE `WHATSAPP_SERVICE_URL` para um host fake. O
  `.env.local` de desenvolvimento aponta para o serviço de **produção**, e sem o
  override um teste de integração mandaria mensagem de verdade.

## Rótulo nutricional (feature 052)

Consultoria para quem **vende** comida: a nutricionista monta o preparo e obtém
a tabela INFORMAÇÃO NUTRICIONAL da embalagem (IN 75/2020 + RDC 429/2020). O
rótulo **não pertence a paciente nenhum** — é o produto de um cliente da
clínica, então as tabelas (`nutrition_labels`, `nutrition_label_ingredients`,
migration **0187**) não têm `patient_id` e as rotas ficam em `/api/rotulos`, não
sob `/api/pacientes/[id]`. Módulo `nutri_rotulo`.

- **Os números da norma são código, não tabela** (`labeling/reference.ts`): ~25
  constantes federais que clínica nenhuma pode editar. Em TS ficam versionadas
  no git, revisáveis em PR e cobertas por teste — tratamento que um número
  impresso em embalagem merece. **Não copiar da planilha `nutri-doc/AF..xlsm`**:
  ela usa a revogada RDC 360/2003 e declara açúcares adicionados contra 300 g em
  vez de 50 g, subdeclarando o %VD de um doce em seis vezes.
- **Dois zeros distintos, e confundi-los é falsear rótulo.** O zero do Anexo IV
  é declaratório e correto ("praticamente não tem sódio"); o dado ausente é
  `null` e a linha inteira fica `incompleto` com a lista de quais ingredientes
  faltaram. Um único ingrediente sem a chave já torna o total **indefinido** —
  somar só o conhecido subdeclararia. Isto é o oposto de `diet/totals.ts`, onde
  micro ausente simplesmente não entra na soma.
- **A entrada manual é o caminho principal, não a exceção**: a base tem **7%**
  de cobertura de açúcares adicionados e 18% de trans. Sobrescrita por chave em
  `manual_values`; `null` no PATCH **apaga a chave** do JSONB (gravar null
  deixaria o motor com valor presente-porém-nulo e o desfazer não voltaria ao
  calculado).
- **O `LabelResult` nunca é gravado** — só os insumos, e a tabela é recomposta a
  cada leitura. Assim uma correção na base ou na norma alcança o rótulo. É o
  oposto da prescrição da 047, que congela snapshot de propósito porque o
  documento já foi entregue ao paciente.
- **Arredondar só na apresentação** (`rounding.ts`, Anexo III): antes de somar
  propaga erro; antes de gravar torna o informado irrecuperável. A sobrescrita
  de 18,5 g fica 18,5 no banco e sai 19 na tabela.
- **A lupa nunca conclui pela ausência** (`inconclusivo`, jamais `nao_aplica`):
  concluir "liberado" a partir de dado faltante põe produto irregular na
  prateleira. Compara o valor **declarado** (já arredondado) para a marca nunca
  contradizer o número impresso ao lado.
- **PDF incompleto sai marcado** (FR-018): tarja de "não utilizável em
  embalagem" + lista dos pendentes. Não existe exportação limpa de rótulo com
  lacuna.
- **`/api/alimentos` deixou de exigir `dieta`**: o catálogo serve plano
  alimentar (047), recordatório (049) e rótulo (052), vendidos separadamente —
  exigir `dieta` tornava o plano alimentar pré-requisito dos outros dois.
- **Conferência normativa feita em 2026-08-02** (T033, registro em
  `specs/052-rotulo-nutricional/research.md`): os 10 VDR batem, inclusive trans
  (2 g). A conferência pegou um erro real — açúcares adicionados **não tem
  limiar de quantidade não significativa**: o Anexo IV trata esse nutriente por
  CRITÉRIO ("sem adição de açúcares"), não por grandeza. `insignificantAtOrBelow`
  é `null` nesse caso, e `null` significa "não existe zero declaratório aqui".
  O código antes usava 0,5 g e declararia zero para um produto que TEM açúcar
  adicionado.

## Impressos da consulta (feature 054)

Os documentos que a nutricionista entrega ao paciente, em PDF, no formato da
planilha `nutri-doc/AF..xlsm`. É **camada de apresentação pura**: sem tabela,
sem migration, sem estado. O impresso é recomposto a cada emissão — arquivar
criaria cópia de PII fora do banco e congelaria número que envelhece.

- **Nenhum componente recalcula nada.** Cada PDF recebe o resultado pronto do
  mesmo motor que alimenta a tela (`diet/totals`, `classifyLabResults`,
  `buildGrowthReport`, `getRecall`, `getDietPlanForPatient`). Recalcular
  reintroduziria pela impressão a divergência entre papel e tela que a revisão
  de fórmulas de agosto acabou de eliminar. Travado por teste em `printedTotals`
  (recordatório) e nos testes de comparação do plano.
- **Por isso a 054 EXTRAIU motores de dentro de rotas**: `labs/panel-for-patient.ts`
  saiu de `/api/pacientes/[id]/exames`. Quando o impresso precisa do que a tela
  mostra, a resposta certa é extrair, nunca reimplementar.
- **`printouts/guard.ts` é a porta única** de todo impresso: RBAC, gate de
  módulo, **404 e nunca 403** para paciente de outra clínica (403 confirmaria a
  existência), **409** para anonimizado, `pdfHeaders` com `no-store`,
  `printoutFilename` e `auditPrintout`. `lint:auth` foi ensinado a reconhecer
  `openPrintout` como autenticador (`scripts/check-require-role.mjs`) — **não é
  isenção**: o guard comprovadamente chama `requireRole`.
- **Ausência nunca vira zero** (`dash()`), nos nove documentos. Vale também para
  texto: pergunta de anamnese sem resposta **continua na folha**, com travessão.
  Omiti-la produziria documento que parece completo escondendo o que não foi
  coletado.
- **Exame sem faixa cadastrada sai SEM situação** — nunca "dentro da faixa".
  Afirmar normalidade a partir de dado ausente vira tranquilidade infundada num
  papel que fica com o paciente.
- **Toda coluna de evolução declara o método.** Dobras e bioimpedância não são
  comparáveis; sem o rótulo, troca de instrumento parece evolução.
- **A curva de crescimento é desenhada** (`Svg`/`Polyline`/`Circle` do próprio
  `@react-pdf/renderer`), não tabelada: a leitura é posicional. `recharts` não
  serve — é React DOM. O eixo cobre bandas **e** pontos do paciente: recortar no
  P97 esconderia a criança justamente onde a curva precisa ser lida.
- **Botão fica na tela onde o dado nasce**, não num menu de impressos. Na
  anamnese ele substituiu o `window.print()` do navegador, que dependia do CSS
  da tela e saía diferente em cada máquina; a evolução SOAP segue no caminho
  antigo (fora de escopo).
- **Datas de `TIMESTAMPTZ` usam `brDateTz`**, não o corte da string ISO: uma
  orientação escrita às 23h sairia com a data do dia seguinte, divergindo da
  tela pela qual a profissional a reconhece. `brDate` continua para colunas
  `DATE`, que não têm fuso.
- **O impresso gestacional NÃO existe e não é esquecimento**: não há peso
  pré-gestacional, série de ganho nem faixa recomendada gravados em lugar
  nenhum. `pregnancyWeeks` (046) só soma depósito ao GET. Emitir exigiria criar
  a avaliação gestacional inteira — feature própria, com migration. Registrado
  em `specs/054-impressos-nutricao/tasks.md` (T035).

## Construtor de automações de mensagem (feature 056)

A clínica escreve a **mensagem** e monta a **automação** (nome + quando + a que
horas) num ato só. Avaliado no mesmo ciclo do lembrete, em `try/catch` próprio.
Migrations `0196_message_automations.sql`, `0197_automation_delivery_events.sql`
e `0198_automation_name_and_schedule.sql`. Módulo `automacoes`.

- **O ciclo passou a rodar de 5 em 5 minutos, pelo `pg_cron` do próprio
  Supabase** (`deploy-cron-5min.sql`), e não pelo cron da Vercel — que no plano
  Hobby não aceita nada mais frequente que diário e, se aceitar, trava TODOS os
  deploys. O `pg_net` chama `/api/cron/send-reminders` com o mesmo `CRON_SECRET`,
  lido do Vault na hora. **O cron diário da Vercel fica no lugar de propósito**:
  dois despertadores independentes para um endpoint idempotente, então perder o
  pg_cron degrada para uma vez por dia em vez de nunca. Isso também **conserta a
  018**, que sempre teve `WINDOW_MINUTES = 15` e no cron diário só acertava o
  lembrete cuja consulta caísse naqueles 15 minutos.
- **O gatilho deixou de ser objeto da clínica.** Ele continua sendo a linha que o
  motor enumera — e por isso duas automações com o mesmo "quando" compartilham
  uma só (`findOrCreateTrigger` compara fonte + params JÁ VALIDADOS, nunca o que
  veio da tela) —, mas nasce por baixo, com nome derivado (`describe.ts`). O nome
  que a clínica dá é o da AUTOMAÇÃO: é ela que se procura, renomeia e desliga.
- **A antecedência é em MINUTOS, e a unidade não é guardada.** 120 volta para a
  tela como "2 horas" porque a tela escolhe a maior unidade que divide exato.
  Guardar o par (valor, unidade) criaria dois jeitos de escrever a mesma coisa —
  `{2, horas}` e `{120, minutos}` — e dois gatilhos idênticos que o motor
  varreria em dobro por não se reconhecerem.
- **Dias e horas são leituras DIFERENTES da mesma antecedência**, e a diferença é
  visível ao paciente. Múltiplo exato de um dia = dia civil, e sai no
  `send_at_local` da automação. Qualquer outra coisa = **ancorada**: sai contada
  do horário daquele paciente, e o horário do dia não se aplica (a tela desabilita
  o campo em vez de deixar escrever regra que não pode valer). Só ganham unidade
  as fontes com âncora `TIMESTAMPTZ` real — `pre_consulta`, `pos_atendimento`,
  `falta_consulta`, `boas_vindas`. Vencimento de parcela é `DATE`: não tem hora
  para ancorar, e oferecer "2 horas antes" ali seria promessa vazia.
- **`lerAntecedencia` lê as duas grafias porque o motor entrega `params` CRU**,
  direto da coluna, sem passar pelo `paramsSchema`. Consertar só o schema
  consertaria a escrita e esqueceria a leitura: gatilho gravado com `{dias: 2}`
  viraria `NaN` na janela e a automação ficaria ligada e muda.
- **`last_fired_on` e `last_ran_at` não são idempotência** — essa segue sendo o
  `UNIQUE (automation_id, patient_id, occurrence_key)`. São o corte que impede a
  automação diária de varrer 288 vezes e a janela que a ancorada usa para não
  perder as âncoras de um deploy longo. A janela ancorada tem teto de 6h: sem
  ele, um ciclo parado por um dia despejaria "sua consulta é daqui a 2 horas"
  sobre consulta de anteontem.
- **O teto por ciclo virou o ESPAÇAMENTO, e é ele que protege o número**
  (migration `0199`, valor de fábrica **1**). O ciclo a cada 5 minutos multiplicado
  por uma mensagem por ciclo é "uma a cada 5 minutos": vinte aniversariantes saem
  em quase duas horas, em vez de vinte segundos. O corte acontece ANTES de
  reservar a ocorrência — o excedente não é gravado como supressão (aquela linha
  era DELETADA em seguida e nunca apareceu no histórico de 30 dias; a 288 ciclos
  por dia, eram dezenas de milhares de escritas para produzir nada). **Quem parou
  no teto não registra a varredura**, nem o dia nem o instante: avançar
  `last_ran_at` depois de atender só o primeiro da fila jogaria a janela dos
  outros fora para sempre. E a automação **ancorada passa na frente** da diária
  na disputa pela vaga, porque a hora dela passa e não volta.
- **A prévia mede o DIA INTEIRO, não a janela do ciclo** (`previewMode`), e
  responde por fonte + parâmetros ANTES de o gatilho existir — a pergunta "quantos
  isso pega?" muda a decisão só se for respondida enquanto ela está sendo tomada.

- **O lembrete de consulta NÃO foi absorvido, e isso é decisão de risco.** Ele
  passou a funcionar em produção em 11/08/2026 depois de meses parado por dois
  defeitos mudos: o cron chamava GET e a rota só aceitava POST, e o ciclo era
  diário quando o motor pede 15 minutos. Reescrevê-lo em
  seguida trocaria uma certeza recém-conquistada por uma promessa. O que torna a
  absorção futura possível sem reescrita é o `AutomationSourceDef`: "lembrete de
  consulta" vira mais um arquivo em `sources/`, cujo `enumerate` delega para
  `selectDueAppointments`.
- **O registro de fontes não conhece fonte nenhuma nominalmente**, nem o motor.
  `sources/index.ts` é o ÚNICO arquivo que as lista, e só para importá-las. Fonte
  nova = um arquivo, sem migration: `automation_triggers.source` não tem CHECK
  enumerando valores de propósito.
- **"Uma vez só" é propriedade do BANCO**: `UNIQUE (automation_id, patient_id,
  occurrence_key)`. Cada fonte decide o que é sua ocorrência — data para
  aniversário, id do atendimento para confirmação, **mês corrente** para as de
  estado contínuo (`sem_retorno`, `sem_medicao`, `etapa_sem_agendamento`), que
  senão viram cobrança diária. `boas_vindas` usa chave FIXA: é uma vez na vida, e
  chave por data faria o paciente antigo receber de novo se alguém trocasse o
  parâmetro.
- **A ocorrência é gravada ANTES da tentativa de envio**, como `pendente`. Gravar
  depois abriria janela para envio duplicado se o processo morresse no meio — e
  mensagem repetida é o que faz denunciarem o número. Por isso `countSentToday`
  conta `pendente` junto com `enviado`.
- **`ON DELETE CASCADE` de `whatsapp_delivery_events` para `automation_occurrences`
  QUEBRA a feature** — foi tentado e revertido na própria 0197. A tabela de
  eventos tem trigger append-only `FOR EACH STATEMENT`, que dispara **mesmo com
  zero linhas afetadas**; o `DELETE` que o CASCADE emite levantava exceção e
  impedia a exclusão da ocorrência suprimida por teto. Como `releaseSuppressed`
  não relança, o sintoma era invisível: o teto deixava de ser "fica para amanhã"
  e virava "perdeu para sempre". É `RESTRICT`, e a verificação vira um SELECT.
- **Confirmação de entrega de automação chega pela MESMA rota do lembrete**
  (`/api/webhooks/whatsapp-status`), que resolve o `externalId` em cascata —
  lembrete primeiro, ocorrência depois. Antes da 0197 toda confirmação de
  automação morria ali como `unknown-reminder`, com 200 e sem rastro. Quem apura
  o **SC-004 da 051 precisa filtrar `reminder_id IS NOT NULL`**: taxa de leitura
  de lembrete e de automação são medidas diferentes.
- **Nada de contador gravado** (`metrics.ts`): enviados/entregues/lidos são
  recompostos das ocorrências e dos eventos a cada leitura, e entrega resolve por
  precedência de rank (`sent < delivered < read < error`), nunca pelo evento mais
  recente. `read` implica entrega — a Evolution nem sempre emite os dois ACKs.
- **`patients.automations_opt_in` nasce TRUE desde a `0200`** — a clínica
  desliga a pedido, e não o contrário. A 0196 tinha feito o inverso (automação é
  conteúdo não solicitado, finalidade distinta do lembrete em LGPD), e a inversão
  foi **decisão de produto da clínica**, tomada em 2026-08-13 junto com a base
  sendo ligada retroativamente. O apoio deixou de ser consentimento e passou a
  ser **legítimo interesse** (art. 7º, IX), o que só se sustenta enquanto a
  recusa for fácil e respeitada: botão na ficha do paciente, campo relido a cada
  envio, sem cache entre ciclos. O consentimento segue hierárquico —
  `reminders_opt_in` é mestre e cala tudo. **A 0200 só é segura junto da 0199**:
  ligar a base inteira sem a fila de uma mensagem a cada 5 minutos é a receita
  exata do bloqueio.
- **Os tetos não são polimento.** Sem eles, ativar uma fonte de estado contínuo
  numa base grande vira rajada no primeiro ciclo. O excedente é gravado como
  supressão e a linha é APAGADA para o ciclo seguinte reavaliar — é a única
  exclusão que o append-only permite.
- **O lembrete de consulta virou área SECUNDÁRIA dentro de Automações**, e o
  card próprio dele no hub só aparece para quem NÃO tem o módulo `automacoes`.
  A condição não é firula: a tela de lembretes é o **único** lugar onde se
  conecta o número de WhatsApp, e a maior parte das clínicas não contratou
  automações — esconder o card sem a condição deixaria essas clínicas sem canal e
  sem lembrete. O motor continua separado (FR-024); o que mudou foi o caminho.
- **O gate de módulo vale no MOTOR, não só na tela.** `automations.active` é
  estado persistido: módulo revogado com o gate só na UI continuaria enviando
  para sempre. Módulo desligado não gera alerta (ausência de contratação não é
  falha operacional); canal desconectado gera UM alerta agregado por ciclo, nunca
  um por paciente.
- **A fonte declara seus próprios campos** (`fields`) e seu próprio aviso
  (`warning`), e a tela só desenha. Sem isso, a tela mandava `params: {}` fixo e
  fonte com parâmetro era impossível de criar pela interface. O aviso mora na
  fonte porque o guarda-corpo pertence a quem conhece a limitação do dado: a
  fonte de ausência do checklist sabe "não marcou", nunca "não cumpriu"
  (FR-009), e a próxima fonte de ausência nasce com o aviso junto.
- **As fontes de cobrança não fornecem procedimento nem profissional**, e isso é
  guarda-corpo, não esquecimento: art. 42 do CDC proíbe constranger o
  inadimplente, e o WhatsApp aparece na tela de bloqueio de um aparelho que pode
  não ser só do paciente. O que a fonte não fornece, a clínica não consegue
  escrever — a validação de variável recusa ao associar.
- **Toda consulta de fonte pagina** (`sources/shared.ts`): o PostgREST corta em
  1.000 linhas sem avisar, e numa clínica com 1.200 pacientes os 200 do fim
  nunca fariam aniversário. Mesma classe de defeito que a 0194 achou no TUSS.
- **Elegibilidade é UMA regra** (`eligiblePatients`), não uma por fonte. Com
  dezesseis fontes, filtro copiado é garantia de a décima sétima esquecer o
  anonimizado — e mandar mensagem para quem exerceu o direito de sumir. Travado
  por teste que roda contra TODAS as fontes registradas.

## Catálogo TUSS — fonte oficial da ANS (migration 0194)

O catálogo saiu do espelho comunitário `charlesfgarcia/tabelas-ans` e passou a
vir do pacote publicado pela própria ANS
(`Padrao_TISS_Representacao_de_Conceitos_em_Saude_<AAAAMM>.zip`). Detalhes de
operação em `docs/data-sources.md`; o leitor é `scripts/tuss-ans-source.ts`,
compartilhado por `seed-tuss.ts` e `check-tuss-collision.ts`.

- **O espelho estava parado e isso era invisível.** 5.851 procedimentos contra
  5.967 do oficial; 1.114 medicamentos contra 44.574. Código publicado depois do
  último commit dele simplesmente não existia no produto — `30310172` e
  `20101406` (oftalmologia) foram os que apareceram no uso real. A falha não
  aparecia em teste nenhum: o typeahead devolvia resultado, só nunca *aquele*.
- **A versão é fixada em `ANS_VERSION_DEFAULT`, nunca descoberta.** Atualizar é
  um PR de uma linha, revisável; auto-descobrir "a mais nova" faria o mesmo seed
  produzir catálogos diferentes em dias diferentes.
- **Parse por RÓTULO de coluna, jamais por índice.** A ANS move colunas entre
  versões e põe o cabeçalho numa linha diferente em cada arquivo (22 na linha 8,
  18 na 7, 20 na 10). Contar linhas a partir de um número fixo já custou uma
  linha de dados perdida na conferência.
- **Data vem como serial do Excel.** O leitor roda com `styles: 'ignore'` (ler o
  estilo de 1,5 milhão de linhas é caro), e sem estilo o exceljs não reconhece
  a célula como data — devolve o número cru. Sem a conversão, "2009-02-13"
  virava `39857-01-01` e TODA vigência ficava errada.
- **`valid_to` passa a ser importado de verdade.** O espelho não publicava fim de
  vigência, então o trigger `enforce_tuss_code_active_on_procedure` (0024) e o
  `detect-deprecated` nunca tinham em que pegar. Na versão 202607 a colheita é
  magra: **2 códigos aposentados no total**, ambos na Tabela 18. Cuidado com a
  contagem — 205 mil linhas da Tabela 19 têm a célula de fim de vigência
  preenchida com STRING VAZIA, não com data; contar "célula não-nula" dá 205 mil
  aposentados fantasmas. O parser lê data, e por isso acerta.
- **A Tabela 19 completa tem ~1,5 milhão de linhas** e muda o que é uma consulta
  aceitável. `or=(code.ilike,description.ilike,manufacturer.ilike)` não tem
  índice que sirva: a busca virou a RPC `search_tuss_codes`, com GIN trigram
  sobre a expressão concatenada/minúscula/sem acento.
- **A RPC tem três caminhos, e isso é medido, não estética.** Num teste com
  300 mil linhas: consulta única com `ORDER BY code LIMIT 50` = **5,8 s** (o
  planejador varre o índice de código ordenado e testa o LIKE linha a linha);
  com CTE `MATERIALIZED` como barreira = **48 ms**. Termo de 1–2 caracteres cai
  em prefixo de código porque o trigram precisa de 3 (medido: 3,8 s ao digitar
  UM caractere). Termo larguíssimo tem teto de varredura de 2.000 linhas antes
  de ordenar — sem ele, "cateter" custava 2 s.
- **`detect-deprecated` parou de puxar a lista inteira de aposentados.** O
  PostgREST corta em 1.000 linhas por resposta, e tanto a varredura de
  `procedures` quanto a de códigos aposentados vinham sem paginação — o scan
  concluía em silêncio sobre um pedaço dos dados. Hoje é irrelevante em número
  (só 2 aposentados), mas o teto não some sozinho quando a ANS aposentar um
  lote. Agora consulta só os códigos que os procedimentos realmente usam, e
  pagina os procedimentos.
- **A Tabela 18 (diárias, taxas e gases) entrou** — 3.597 códigos que não
  existiam no sistema. `tuss_table_label` é coluna gerada: acrescentar um valor
  exige drop + add, que reescreve a tabela — por isso a 0194 tem que rodar
  ANTES do seed, enquanto `tuss_codes` ainda é pequena.

## Dados do paciente nos impressos (migration 0195)

A clínica escolhe o que aparece do paciente em cada documento. Padrão da casa
em `tenant_clinic_profile.printout_patient_fields`, exceção por documento em
`printout_patient_field_overrides`. Catálogo e resolução em
`src/lib/core/printouts/fields.ts`; tela em `/configuracoes/impressos`.

- **O obstáculo não era a tela de escolher, era o dado não chegar.** Quatro
  documentos (pedido de exame, receita de óculos, orçamento odonto, laudo
  oftalmo) recebiam `patientName: string` e nada mais — não mostrariam CPF nem
  que a clínica mandasse. O guard da 054 saiu de `nutrition/printouts/` para
  `printouts/` e passou de 7 para 12 documentos.
- **O guard recebe os PAPÉIS, não os impõe.** Unificar em admin+profissional
  era o caminho fácil e teria tirado o pedido de exame e o laudo da recepção
  (que entrega o papel) e o orçamento do financeiro. O guard centraliza as
  REGRAS; público de cada documento é diferença legítima.
- **A exceção do documento SUBSTITUI o padrão, não soma.** Somar impediria o
  caso que mais importa: mostrar MENOS num papel que o paciente leva na bolsa.
  O preço — mudança no padrão não alcança documento personalizado — é visível
  na tela, com "voltar ao padrão".
- **Nome é piso, não opção**, e aparece na tela desligado-e-travado para a
  ausência não parecer esquecimento de quem configura.
- **Campo ligado sem dado sai com travessão; campo desligado não vira linha.**
  Confundir os dois devolve documento que parece completo escondendo o que não
  foi coletado — mesma regra da 054 para pergunta de anamnese sem resposta.
- **A ordem impressa é a do catálogo**, nunca a ordem em que alguém marcou as
  caixas: dois papéis da mesma clínica têm que ler igual.
- **Idade recebe o DIA CIVIL, não um instante.** Emitir às 22h em São Paulo já
  é o dia seguinte em UTC, e um `Date` envelheceria o paciente na véspera do
  aniversário. Travado por teste.
- **Duas ausências deliberadas**: guia TISS (conteúdo mandatório da ANS —
  configurar o obrigatório convida glosa) e prontuário completo (lá os dados
  são a seção 1, conteúdo e não cabeçalho; completo que esconde CPF deixa de
  ser completo, e é a completude que o faz servir para portabilidade).
