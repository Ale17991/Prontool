# Specification Quality Checklist: Rótulo Nutricional de Produto

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-07-29
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

- **Correção sobre a planilha de origem**: a aba "Rótulos Nutricionais" do `AF..xlsm` calcula o %VD contra as **metas do paciente** (≈1956 kcal, 75 g de proteína, 300 g de açúcares adicionados em vez de 50 g). Num rótulo comercial isso é irregular — um produto doce apareceria com açúcar seis vezes subestimado. O spec fixa que os valores de referência vêm da norma. A planilha segue valendo como gabarito de **layout** e de campos de entrada, não de cálculo.
- **Os números da norma não estão no spec de propósito.** Valores diários de referência, limites da rotulagem frontal e regras de arredondamento serão transcritos e conferidos contra o texto oficial na fase de planejamento — mesmo tratamento dado às equações de gasto energético na feature 048. O spec fixa a regra; o plano fixa os números.
- **US2 é viabilidade, não melhoria.** A cobertura da base para açúcares adicionados é de ~7% dos alimentos; sem entrada manual, a US1 não produz rótulo utilizável na maioria dos casos reais.
- **Risco a acompanhar**: o produto final é um documento que vai para uma embalagem comercial. A tela precisa deixar explícito que a responsabilidade técnica é da nutricionista, e a exportação de rótulo incompleto precisa ser inequivocamente marcada como não utilizável.
