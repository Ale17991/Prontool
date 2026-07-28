# Specification Quality Checklist: Exames Laboratoriais

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-07-28
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

- Decisão aberta para o `/speckit.plan`: reusar/estender o motor de medições (030)
  vs. tabela dedicada de resultados. Documentada como Assumption; não bloqueia o spec.
  **RESOLVIDA na fase de plano**: reuso do motor de medições (research.md D1).
- Pedido/solicitação de exames marcado fora do escopo v1 (API já existe; integração é follow-up).
- Validação clínica das faixas = polish com o profissional (avisar, não bloquear).

## Correções de premissa levantadas na implementação

- **FR-003 aponta a fonte errada**: não existe aba `BD EXAMES` no AF; a aba real
  (`BD EXAMES_1`) tem `Unidade`/`Ref Min`/`Ref Max` **100% vazias** nas 272 linhas.
  A única fonte de faixas é `Evonut.xlsm` → `BD_Exames`. Ver research.md D9.
- **FR-002 pede faixa por sexo E faixa etária**; a fonte só recorta por **sexo**.
  O schema e o lookup implementam os três eixos, mas o v1 classifica por sexo.
  Limitação declarada no plano, no seed e no roteiro de validação (research.md D11).
- **Escopo do catálogo**: das 319 linhas da fonte, só ~115 têm faixa. As demais são
  exames qualitativos (sem valor numérico a classificar) e 22 pseudo-painéis
  "(Completo)", que são atalhos de PEDIDO — ambos fora do v1 (research.md D10).
