# Specification Quality Checklist: Notificações por comportamento do paciente

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-08-04
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

## Sessão de clarificação — 2026-08-04

Quatro perguntas feitas, quatro respondidas. Mudanças materiais:

- **Descadastro passa pela clínica** (não por link nem pelo portal). Recomendei
  o link de um clique por facilidade de revogação; a decisão foi outra e está
  registrada. Salvaguardas acrescentadas: FR-017 proíbe mandar o paciente
  responder a mensagem (ninguém lê), FR-017a exige desligar em um clique na
  ficha, FR-017b exige contato publicado antes de ligar a primeira regra, e
  SC-010 mede o tempo de atendimento do pedido.
- **Teto de 2 por semana**, configuração da clínica, ajustável de 1 a 7.
- **Público "por profissional"** resolve pelo profissional da consulta mais
  recente — `patients` não tem vínculo direto, verificado no schema.
- **Catálogo cresce de 5 para 14 famílias**, metade celebrando. Mudança de
  escopo maior desta sessão; propagada para `plan.md` e `contracts/rule-catalog.md`.

Decidido sem pergunta, registrado em Assumptions: janela horária compartilhada
com os lembretes; canal "preferencial" resolve WhatsApp→e-mail.

## Notes

Três decisões de escopo foram tomadas com o solicitante ANTES de escrever o
spec, e por isso não aparecem como `[NEEDS CLARIFICATION]`:

1. **Destinatário é o paciente**, não a equipe da clínica.
2. **Catálogo fechado de regras prontas**, não construtor livre de condições.
3. **As quatro famílias de sinal** entram todas na primeira versão (hábito,
   medição/meta, acesso ao portal, ausência de retorno).

Pontos que sobreviveram à validação mas merecem atenção no `/speckit.plan`:

- **FR-008 é o requisito mais difícil de garantir por código.** "Nenhuma
  mensagem afirma que o paciente deixou de fazer algo" é fácil nos textos
  padrão e difícil nos customizados. A validação automática do texto livre
  precisa de critério concreto no plano — provavelmente lista de expressões
  proibidas mais revisão do texto padrão, aceitando que a garantia é parcial.
- **FR-009 + FR-010 formam um par.** Suprimir a regra de hábito sem ligar a de
  reengajamento deixa o paciente sumido sem contato nenhum — pior que o
  problema original. O plano deve tratá-las como uma unidade de entrega.
- **SC-004 depende de a supressão da US2 existir**, então não é apurável antes
  da US2 estar pronta.
- **FR-014 (consentimento próprio) tem custo de adoção real**: a base existente
  nasce desligada, então a feature entrega zero mensagem no primeiro dia até a
  clínica recoletar aceite. Isso é correto em LGPD e deve ser dito à clínica na
  própria tela, não descoberto por ela.
