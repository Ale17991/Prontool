# Specification Quality Checklist: Múltiplos comprovantes em despesas + atendimento particular

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-04-28
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

## Notes

- Items marked incomplete require spec updates before `/speckit.clarify` or `/speckit.plan`.
- Nomes de tabelas/colunas (`expenses`, `appointments.plan_id`, `procedures.default_amount_cents`, `procedures.covered_by_plan`, `expense_receipts`, `audit_log`) aparecem como **âncoras de dados** identificando entidades existentes ou planejadas, não escolhas de implementação.
- Esta feature **substitui** o modelo single-receipt entregue no commit `37df456`. As 3 colunas `receipt_file_*` em `expenses` permanecem como back-compat até backfill — decisão de plan.
- A migração de `appointments.plan_id` para nullable + ajuste do trigger `enforce_appointment_preconditions` (0015) é o item de maior risco arquitetural; resolvido no plano.
- Múltiplos arquivos com mesmo nome anexados na mesma despesa: comportamento documentado em Edge Cases — escolha exata (sufixo numérico vs. rejeição) fica para o plan.
