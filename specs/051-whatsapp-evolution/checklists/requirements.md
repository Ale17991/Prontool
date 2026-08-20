# Specification Quality Checklist: Lembretes de consulta por WhatsApp

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

### Validação — passagem 1 (2026-07-28)

Dois ajustes feitos antes de fechar o checklist:

1. **"Evolution API" e "QR Code" aparecem na spec.** Avaliado e mantido. "Evolution API" só
   aparece em _Assumptions_ e _Dependencies_ — que é onde a decisão de fornecedor pertence, e
   registrá-la importa porque ela carrega o risco de bloqueio de número. "QR Code" é vocabulário
   do usuário final (é literalmente o que a clínica vê na tela), não detalhe de implementação.
   Nenhum dos dois aparece em requisito funcional ou critério de sucesso.

2. **SC-004 depende de uma linha de base que talvez não exista.** ✅ **Resolvido** na sessão de
   clarificação de 2026-07-28. Confirmou-se que não há medição de abertura de e-mail; o critério
   virou alvo absoluto (≥ 70% dos entregues lidos em 24h), apurável com os próprios dados da
   feature.

### Validação — passagem 2 (2026-07-28, pós-clarificação)

Checklist revalidado após as 5 clarificações. Todos os itens continuam passando. Duas
observações:

- **Numeração com sufixo** (`FR-007a`, `FR-012a`): os requisitos novos ganharam sufixo em vez de
  número sequencial, para não renumerar requisitos já referenciados em `plan.md` e `tasks.md`.
  Mesmo critério aplicado às tarefas novas (`T005a`, `T020a`, `T031a`).
- **Contradição corrigida**: o FR-027 dizia "não oferecer envio manual/avulso", o que se lia
  como proibição do reenvio manual de lembrete — comportamento que já existe no canal de e-mail.
  Reescrito para separar "mensagem avulsa de conteúdo livre" (fora do v1) de "reenvio do mesmo
  lembrete templado" (dentro).

### Decisões tomadas por default (não bloqueiam o plano, mas o produto pode querer virar)

Três pontos não vieram especificados e foram resolvidos com o default mais conservador. Estão
documentados em _Assumptions_, e cada um é reversível sem reescrever a spec:

- **Escolha de canal** → configurável pela clínica (e-mail / WhatsApp / ambos), em vez de
  WhatsApp substituir o e-mail. Default mais seguro: não tira nada de quem já usa e-mail.
- **Consentimento** → granular por canal, em vez de reusar o opt-out único existente. Default
  mais defensável em LGPD; recusar WhatsApp não deveria cancelar o e-mail.
- **Quem conecta o número** → autoatendimento pela clínica. Default que escala; a alternativa
  (Homio conecta para cada clínica) vira gargalo de operação.
