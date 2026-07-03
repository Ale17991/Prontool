# Specification Quality Checklist: Financeiro robusto — Fluxo de Caixa + Contas a Pagar/Receber + Repasse Médico

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-05-20
**Feature**: [spec.md](../spec.md)

## Content Quality

- [x] No implementation details (languages, frameworks, APIs)
- [x] Focused on user value and business needs
- [x] Written for non-technical stakeholders
- [x] All mandatory sections completed

## Requirement Completeness

- [x] No [NEEDS CLARIFICATION] markers remain
- [x] Requirements are testable and unambiguous
- [x] Success criteria are measurable
- [x] Success criteria are technology-agnostic (no implementation details)
- [x] All acceptance scenarios are defined
- [x] Edge cases are identified
- [x] Scope is clearly bounded
- [x] Dependencies and assumptions identified

## Feature Readiness

- [x] All functional requirements have clear acceptance criteria
- [x] User scenarios cover primary flows
- [x] Feature meets measurable outcomes defined in Success Criteria
- [x] No implementation details leak into specification

## Validation Notes

### Iteration 1 (2026-05-20)

**Content Quality — PASS**

- Spec referencia entidades do banco (`payment_installments`, `expenses`, `appointments_effective`, `monthly_payouts`) **apenas como contrato de domínio** — comunica WHERE o dado vive sem dizer COMO implementar.
- Funções existentes (`computeOperatingResult`, `buildFinancialReport`) são mencionadas como **contratos de paridade** (SC-006, SC-010, A-002) — apropriado para feature que estende, não reescreve.
- Sem nomes de framework/lib/SDK na spec (apenas em Assumptions, onde é apropriado).

**Requirement Completeness — PASS**

- Zero `[NEEDS CLARIFICATION]` markers.
- 46 FRs no formato "X MUST Y" testáveis.
- 10 SCs com métricas explícitas (tempo, %, contagem, fps, paridade absoluta).
- 10 edge cases cobrindo: reversão de pagamento, estorno pós-fechamento, payment_terms mudando, despesa recorrente encerrada, parcela crítica, performance >500 eventos, tenant vazio, pagamento parcial, multi-moeda (out), fuso horário.
- 10 assumptions documentadas + 12 out-of-scope explícitos.

**Feature Readiness — PASS**

- 5 user stories priorizadas (P1/P1/P2/P2/P3) com Acceptance Scenarios Given/When/Then e Independent Test.
- US1 (contas a receber) e US2 (contas a pagar) podem ser entregues independentemente — cada uma é MVP utilizável sozinha. US3 (fluxo de caixa) depende dos dados de US1+US2 mas pode ser independent test com seeds.
- US4 (repasse médico) é o workflow mais complexo mas autônomo; US5 (dashboard) é polish opcional.

**Constitution alignment** (verificação preliminar):

- Princípio I (imutabilidade): FR-016, FR-031, FR-037, FR-043 explicitam append-only para valores calculados.
- Princípio II (auditoria): FR-042 cobre todas as operações.
- Princípio III (tenant isolation): pressupõe RLS atual cobrir tabelas novas (`monthly_payouts`, `monthly_payouts_adjustments`).
- Princípio V (RBAC): FR-001, FR-009, FR-019, FR-027 documentam acesso por papel.
- LGPD: FR-045 explícita.

### Conclusão

Spec aprovada na primeira iteração. Sem clarificações pendentes — o usuário forneceu contexto excelente (com survey de código já feito), permitindo elaborar a feature sem ambiguidades críticas.

**Pronta para `/speckit.plan`**. `/speckit.clarify` pode ser usado opcionalmente para refinar algum detalhe, mas não é necessário — scope está bem delimitado, decisões críticas (snapshot append-only, RLS por doctor.user_id, projeção determinística) já foram explicitadas em FRs.

### Iteration 2 (2026-05-20) — pós `/speckit.clarify`

5 perguntas de alto/médio impacto resolvidas e propagadas. Todas reforçam alinhamento com a Constituição:

1. **Reajuste de despesa recorrente** → versionar via `recurring_starts_at` + `recurring_ends_at` + `superseded_by`. Princípio I-compliant. Impacto: FR-013, FR-014, FR-014a (nova), FR-014b (nova), edge cases, Key Entity Expense.
2. **Pagamento parcial de parcela** → nova tabela `installment_payments` append-only com SUM. Princípio I + II-compliant. Impacto: FR-005, FR-017, edge case, nova Key Entity.
3. **Médico vê valor bruto + percentual + comissão** → transparência total. Impacto: FR-036.
4. **Reabrir mês fechado** → janela de 24h + sem repasses pagos + audit obrigatório via `monthly_payouts_reopens`. Impacto: FR-032, FR-032a (nova), FR-032b (nova), edge case, nova Key Entity.
5. **Saldo de caixa do tenant** → append-only via `tenant_cash_balance_adjustments` com `effective_from`. Princípio I-compliant. Impacto: FR-021 reescrita, FR-021a (nova), FR-021b (nova), A-004 atualizada, nova Key Entity.

**Novas tabelas introduzidas** (vs. iteração 1): `installment_payments`, `monthly_payouts_reopens`, `tenant_cash_balance_adjustments`. Total agora: **5 tabelas novas** + colunas em `expenses` (`paid_at`, `paid_amount_cents`, `payment_method`, `recurring_starts_at`, `recurring_ends_at`, `superseded_by`).

**Validação pós-clarify**:

- [x] Clarifications section com 5 bullets (1 por pergunta).
- [x] Nenhuma marca [NEEDS CLARIFICATION] remanescente.
- [x] Sem contradições — FRs antigos reescritos onde necessário (FR-021, FR-032).
- [x] Terminologia consistente: "snapshot", "append-only", "versionar", "ajuste".
- [x] Constitution alignment FORTE — todas as 5 decisões reforçam Princípio I (imutabilidade).

**Pronta para `/speckit.plan`**.
