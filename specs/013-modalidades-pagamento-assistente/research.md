# Research: Modalidades de pagamento + Profissional assistente

**Phase 0** — resolução de decisões técnicas para a feature 013.
Status: ✅ todas as decisões resolvidas; nenhum NEEDS CLARIFICATION pendente.

---

## Decisão 1 — Modelagem de modalidade: ENUM + history unificado

**Decisão**: ENUM PostgreSQL `payment_mode` ∈ {`comissionado`, `fixo`, `liberal`} como coluna em `doctors`; parâmetros financeiros (percentage_bps, monthly_amount_cents+billing_day, liberal_default_cents) versionados em **tabela unificada** `doctor_payment_terms_history` (append-only) com colunas nullable + CHECK por modalidade.

**Rationale**:

- ENUM nativo evita strings livres e dá validação no banco (Constitution I — não permite estados ilegais).
- History unificado mirror do padrão `doctor_commission_history`/0005, mas suporta as três modalidades numa única timeline por doctor (ordenação cronológica clara).
- Coluna `payment_mode` em `doctors` é denormalização do head-of-chain do history (espelha o padrão `doctor_commission_current`/0005 view) — query rápida sem JOIN.
- CHECK constraint garante que exatamente o conjunto de campos da modalidade correta está preenchido — defesa em profundidade contra estado inconsistente.

**Alternativas consideradas**:

- **TEXT com CHECK IN(...)**: aceito porque ENUM tem custo de migration ao adicionar novos valores. Rejeitado: as 3 modalidades são taxativas no domínio; novas modalidades exigiriam discussão de produto antes (ENUM força esse rito).
- **Tabelas separadas por modalidade** (`doctor_commission_history`, `doctor_fixed_pay_history`, `doctor_liberal_pay_history`): rejeitado — explode em N tabelas o que é conceitualmente "1 timeline de termos de pagamento por doctor". Migração e listagem do histórico viram chatas (UNION ALL).
- **Colunas modais direto em `doctors`** (sem history): rejeitado — viola Constitution I (mudanças apagariam valores anteriores). Mudança de modalidade já é audit-relevant per spec.

---

## Decisão 2 — Backfill: 1 row por doctor existente com mode='comissionado'

**Decisão**: na migration 0084, popular `doctor_payment_terms_history` com uma row inicial por doctor existente:

```sql
INSERT INTO doctor_payment_terms_history (
  tenant_id, doctor_id, payment_mode, percentage_bps, valid_from, reason, created_by
)
SELECT
  d.tenant_id, d.id, 'comissionado'::payment_mode,
  COALESCE(c.percentage_bps, 0), -- fallback 0 se não houver commission_history
  COALESCE(c.valid_from, CURRENT_DATE),
  'Backfill 0084 — preserva modalidade comissionado existente',
  '00000000-0000-0000-0000-000000000000' -- system actor
FROM doctors d
LEFT JOIN LATERAL (
  SELECT percentage_bps, valid_from
  FROM doctor_commission_history
  WHERE doctor_id = d.id
  ORDER BY valid_from DESC, created_at DESC
  LIMIT 1
) c ON true;
```

**Rationale**:

- FR-008/SC-002: 0 regressões em comissionados existentes — todos aparecem como Comissionado após deploy, sem ação manual.
- Cria base de auditoria — admin pode ver "desde quando este profissional é comissionado" mesmo para os cadastrados antes da feature (não-determinístico mas suficiente: usa a `valid_from` da commission atual).
- `commission_history` continua sendo a fonte autoritativa de **histórico de comissão por data** (necessária para `appointments.frozen_commission_bps` que faz lookup nela). A nova tabela é a fonte autoritativa de **modalidade vigente**.

**Alternativas consideradas**:

- **Sem backfill — só populate em mudança futura**: rejeitado — query de "qual a modalidade?" exigiria fallback "se não tem entry → comissionado", lógica espalhada. Backfill simplifica.
- **`reason` deixar vazio**: rejeitado — Constitution II exige `reason` não-vazio em tabelas auditáveis; texto fixo do backfill é aceitável e auditável.

---

## Decisão 3 — Assistant linkage: append-only com soft-unlink via `removed_at`

**Decisão**: `appointment_assistants` é append-only stricto. Campos imutáveis após INSERT: `id, tenant_id, appointment_id, assistant_doctor_id, frozen_amount_cents, created_by, created_at`. **Única mutação permitida**: setar `removed_at IS NOT NULL` + `removed_by IS NOT NULL` (UPDATE single-shot via RPC `remove_appointment_assistant(p_id, p_actor)`).

**Rationale**:

- Constitution I: nada some, tudo é rastreável.
- Spec FR-015: "remoção não apaga fisicamente o registro; uma nova versão marca a remoção".
- UPDATE-single-shot (não múltiplo) — trigger `enforce_appointment_assistants_mutation` permite só `removed_at` mudar de NULL → not NULL; rejeita qualquer outra alteração e segundo set de `removed_at`.
- `frozen_amount_cents` capturado no INSERT a partir de `doctor_payment_terms_current.liberal_default_cents` (FR-014) — UI permite override (campo editável) mas o valor que vai pro banco é o passado pelo client, não relido depois.

**Alternativas consideradas**:

- **`is_active BOOLEAN` mutável**: rejeitado — perderíamos a data exata da remoção; flag boolean não é audit trail rica.
- **Hard DELETE**: rejeitado — viola Constitution I.
- **Tabela paralela de "removals"**: rejeitado — overhead de JOIN sem ganho semântico claro; `removed_at`/`removed_by` na própria row é equivalente em força probatória.

---

## Decisão 4 — Validação de modalidade Liberal no banco (defense in depth)

**Decisão**: trigger `check_assistant_doctor_is_liberal` (BEFORE INSERT em `appointment_assistants`) consulta `doctors.payment_mode` e bloqueia INSERT se `payment_mode <> 'liberal'`.

**Rationale**:

- Constitution V: RBAC server-side é o controle de borda; trigger é defesa em profundidade contra service layer com bug ou pedido cru via REST (Supabase REST API permite INSERT direto se RLS deixar).
- O serviço já filtra o seletor de UI para mostrar apenas liberais (FR-011); o trigger garante que mesmo um cliente malicioso/bug não consegue cadastrar comissionado/fixo como assistente.

**Edge case tratado**: se um doctor muda de Liberal → Comissionado depois de ter sido assistente em atendimentos antigos, **os registros antigos permanecem válidos** — o trigger só roda em INSERT. O relatório por profissional dele ainda mostra as participações passadas. Constitution I: histórico congela.

**Alternativas consideradas**:

- **Validação só no service layer**: rejeitado — RLS + REST API direta permitiriam bypass. Já existe precedente: `check_material_tuss_table` em 0061 valida TUSS table no banco.

---

## Decisão 5 — Liberal NÃO pode ser principal: validação em service layer

**Decisão**: o seletor de "profissional principal" no formulário de atendimento filtra por `payment_mode IN ('comissionado', 'fixo')`. No service `createAppointmentManually`, validação adicional: se `doctor.payment_mode === 'liberal'`, retorna `ValidationError` com código `LIBERAL_AS_PRINCIPAL`.

**Rationale**:

- O usuário texto diz: "Liberal cobra por participação como assistente" → indica exclusividade do papel.
- Validação em service (não trigger) porque atendimentos antigos podem ter `doctor_id` que mais tarde mudou para Liberal — bloqueio retroativo destruiria histórico (Constitution I).
- Trigger seria mais agressivo e ainda assim opaco — service layer com erro tipado dá feedback claro pra UI.

**Alternativas consideradas**:

- **Trigger BEFORE INSERT em appointments**: rejeitado — interfere em histórico se modalidade mudou após o fato.
- **Sem validação (UI-only)**: aceitável mas frágil; usuário pode forçar via DevTools ou API direta. Mantemos service validation por defesa.

---

## Decisão 6 — `monthly_fixed_pay_lines`: view virtualizada (não materializada)

**Decisão**: view SQL `public.monthly_fixed_pay_lines` que, para cada doctor com `payment_mode='fixo'`, gera linhas para os meses entre `valid_from` (do payment terms vigente) e o mês corrente (inclusivo) — UMA LINHA POR MÊS POR DOCTOR. Linhas só aparecem se `CURRENT_DATE >= make_date(year, month, billing_day)`.

```sql
CREATE OR REPLACE VIEW public.monthly_fixed_pay_lines AS
SELECT
  d.tenant_id,
  d.id AS doctor_id,
  d.full_name AS doctor_name,
  pt.monthly_amount_cents AS amount_cents,
  pt.billing_day,
  date_trunc('month', month_start)::date AS month_start,
  make_date(
    EXTRACT(YEAR FROM month_start)::int,
    EXTRACT(MONTH FROM month_start)::int,
    pt.billing_day
  ) AS billing_date
FROM doctors d
JOIN doctor_payment_terms_current pt ON pt.doctor_id = d.id
CROSS JOIN LATERAL generate_series(
  date_trunc('month', pt.valid_from)::date,
  date_trunc('month', CURRENT_DATE)::date,
  INTERVAL '1 month'
) AS month_start
WHERE pt.payment_mode = 'fixo'
  AND make_date(
    EXTRACT(YEAR FROM month_start)::int,
    EXTRACT(MONTH FROM month_start)::int,
    pt.billing_day
  ) <= CURRENT_DATE
  AND d.active = true;
```

**Rationale**:

- FR-020/FR-027: linhas só "aparecem" a partir do dia configurado, sem job/agendador.
- View virtualizada → não há row física no banco; "lançamento" é derivado on-demand → simplifica retroatividade (mudança de modalidade no histórico re-deriva tudo coerentemente).
- Constitution I não é violada — não existe registro financeiro "lançado" mutável; é cálculo determinístico sobre histórico imutável.
- Performance OK: tenants têm ≤ 20 Fixos × ≤ 24 meses = ≤ 480 linhas; índices em `doctors(tenant_id, payment_mode)` e `doctor_payment_terms_history(doctor_id, valid_from)` cobrem.

**Alternativas consideradas**:

- **Tabela materializada com job cron**: rejeitado — requer infraestrutura de scheduling (não temos hoje); estado mutável em produção amplifica risco; view virtualizada é mais simples e auditável.
- **Cálculo no app layer (TypeScript)**: rejeitado — duplica lógica em SQL e TS; relatórios consomem direto a view com agregações.

---

## Decisão 7 — Resultado operacional: nova rota + computação on-demand

**Decisão**: rota nova `/api/relatorios/resultado-operacional?month=YYYY-MM` (ou existente — TBD na fase de implementação) retorna JSON:

```json
{
  "month": "2026-05",
  "gross_revenue_cents": 150000_00,
  "commissions_cents": 42000_00,
  "fixed_payments_cents": 24000_00,
  "liberal_payments_cents": 3200_00,
  "taxes_cents": 12000_00,
  "operating_expenses_cents": 18500_00,
  "net_profit_cents": 50300_00
}
```

Computação:

1. `gross_revenue_cents` = SUM `appointments.frozen_amount_cents` no mês, status != estornado.
2. `commissions_cents` = SUM `frozen_amount_cents * frozen_commission_bps / 10000` para atendimentos onde `doctor.payment_mode='comissionado'` no momento do atendimento (referencia `frozen_commission_bps` que JÁ TEM em `appointments`).
3. `fixed_payments_cents` = SUM `monthly_fixed_pay_lines.amount_cents WHERE month_start = mês solicitado`.
4. `liberal_payments_cents` = SUM `appointment_assistants.frozen_amount_cents WHERE appointment_at no mês AND removed_at IS NULL AND NOT estornado`.
5. `taxes_cents` = SUM `expenses.amount_cents WHERE category='tax' AND incurred_at no mês` (já existente — feature 011).
6. `operating_expenses_cents` = SUM `expenses.amount_cents WHERE category NOT IN ('tax') AND incurred_at no mês`.
7. `net_profit_cents` = `gross - commissions - fixed - liberal - taxes - operating`.

**Rationale**:

- FR-024: fórmula explícita.
- Cada linha clicável: a UI faz drill-down chamando rotas existentes (por profissional, expenses, etc.).
- Reusa structures existentes (`expenses`, `appointments.frozen_*`).

**Alternativas consideradas**:

- **Tudo numa única rota`/api/relatorios/mensal`**: rejeitado — semântica diferente (mensal lista lançamentos; resultado operacional é agregado). Separar mantém SoC.

---

## Decisão 8 — Frozen value de assistente: cliente envia, servidor valida

**Decisão**: ao criar/editar atendimento com assistentes, o client envia `{assistant_doctor_id, amount_cents}[]`. O server valida que `amount_cents > 0` e `< 1_000_000_00` (sanity check, R$ 1M); persiste em `frozen_amount_cents`. Não relê o valor padrão do liberal — confia no client (que pegou da view `doctor_payment_terms_current` ao montar o form, e usuário pode ter editado).

**Rationale**:

- FR-013: valor é pré-preenchido **e editável**.
- Simplifica: server não precisa decidir se "honra o que o client mandou" ou "rebusca o padrão atual". Client é a autoridade do valor do form.
- Auditoria: o `frozen_amount_cents` final é persistido no INSERT (Constitution I) e fica registrado no audit log de criação do assistente.

**Alternativas consideradas**:

- **Server re-resolve o padrão se client mandar null**: aceitável mas adiciona caminho de execução para um caso edge sem ganho. Rejeitado.
- **Server valida que `amount = current_default ± 50%`**: rejeitado — limita flexibilidade legítima sem ganho de segurança real.

---

## Decisão 9 — Reason obrigatório em mudança de modalidade

**Decisão**: ao mudar `payment_mode` de um doctor (PATCH `/api/medicos/[id]/payment-mode`), a UI exige campo `reason TEXT min 3` ("Por que está mudando?"). Esse `reason` é gravado em `doctor_payment_terms_history.reason` e no `audit_log` (motivo).

**Rationale**:

- Constitution II: `motivo` obrigatório em audit trail.
- Espelha padrão de `doctor_commission_history` (0005) onde `reason` é `CHECK char_length >= 3 NOT NULL`.

**Alternativas consideradas**:

- **Reason opcional**: rejeitado — viola Constitution II.

---

## Decisão 10 — Profissional Fixo realizando atendimento: registra mas não comissiona

**Decisão**: `appointments.doctor_id` continua aceitando Fixo. `frozen_commission_bps` para Fixos é gravado como **0** no INSERT. Cálculo de comissão no relatório por profissional, para Fixos, retorna `0` (com badge "Pagamento fixo").

**Rationale**:

- Spec edge case: "Profissional Fixo realizando atendimento — entra no faturamento bruto normalmente, mas não ganha comissão extra".
- Aproveita `frozen_commission_bps` já existente sem schema change adicional.
- Backward compat: comissionados continuam tendo `frozen_commission_bps > 0`.

**Alternativas consideradas**:

- **NULL para comissão de Fixo**: rejeitado — NULL torna SUMs mais frágeis; 0 é o valor semanticamente correto ("sem comissão variável") e ariteticamente neutro.

---

## Pontos não decididos / abertos para implementação

- **Naming exato da view**: `monthly_fixed_pay_lines` é o working name; revisitar se `fixed_payroll_monthly_view` ou similar fica melhor. Não bloqueia.
- **Drill-down do resultado operacional**: cada linha clicável "vai para onde?" — comissões → `/relatorios/por-profissional`, fixos → mesma rota filtrada, liberais → idem, taxes → `/relatorios/despesas?category=tax`. Detalhe de UI, definido em tasks.
- **Endpoint REST direto via Supabase REST API**: bloquear INSERT/UPDATE em `doctor_payment_terms_history` e `appointment_assistants` no client direto (`REVOKE INSERT, UPDATE, DELETE ... FROM authenticated`); só via RPC ou service_role. Padrão 0061 (`appointment_materials`).
