# Feature Specification: Honorários e participantes (equipe) por procedimento

**Feature Branch**: `031-honorarios-participantes`
**Created**: 2026-06-18
**Status**: Draft
**Input**: User description: "Cadastrar honorários e participantes (equipe) por procedimento no atendimento, com grau de participação (padrão TISS, domínio 35) e honorário por participante; participantes de qualquer modalidade (comissionado/fixo/liberal); reflete no repasse e na guia TISS SP/SADT."

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Cadastrar a equipe de um procedimento (Priority: P1)

No detalhe de um atendimento, a clínica registra, para cada procedimento realizado, os profissionais **adicionais** que participaram além do executante (ex.: anestesista, primeiro auxiliar, instrumentador). Para cada participante escolhe o **grau de participação** (lista padrão TISS) e informa o **honorário** (valor) daquela participação. Um mesmo procedimento pode ter vários participantes; um mesmo profissional pode participar de procedimentos diferentes com graus diferentes. O médico que executa o procedimento permanece no fluxo atual do atendimento (não é cadastrado como participação aqui).

**Why this priority**: É o coração do pedido — sem registrar quem participou e quanto recebe, nada do resto (repasse, faturamento TISS) acontece. Entrega valor sozinha: a clínica passa a ter o registro correto da equipe e dos honorários por procedimento.

**Independent Test**: Abrir um atendimento com 1+ procedimentos, adicionar 2 participantes a um procedimento (graus distintos, honorários distintos), recarregar e confirmar que a equipe persistiu com os valores corretos; remover um e confirmar que sai da lista ativa sem apagar o histórico.

**Acceptance Scenarios**:

1. **Given** um atendimento realizado com um procedimento, **When** o usuário adiciona um participante escolhendo profissional, grau de participação e honorário, **Then** o participante aparece vinculado àquele procedimento com o valor congelado.
2. **Given** um procedimento com um participante de modalidade "fixo", **When** o usuário adiciona um segundo participante de modalidade "comissionado", **Then** ambos são aceitos (a equipe não é restrita a profissionais liberais).
3. **Given** um procedimento já com um participante X, **When** o usuário tenta adicionar o mesmo profissional X de novo no mesmo procedimento, **Then** o sistema impede a duplicidade na equipe ativa.
4. **Given** um participante registrado, **When** o usuário o remove, **Then** ele deixa de contar (financeiro/faturamento) mas o registro histórico permanece auditável.

---

### User Story 2 — Honorário entra no repasse do profissional (Priority: P2)

O honorário de cada participante é considerado no repasse do mês do profissional que participou, independentemente da modalidade dele (liberal, fixo ou comissionado), de forma análoga ao que hoje já ocorre com o pagamento "liberal" de assistente.

**Why this priority**: Conecta o registro da equipe ao dinheiro que o profissional recebe — é o que torna o cadastro útil para o fechamento mensal. Depende do US1 (precisa existir o participante e o honorário).

**Independent Test**: Registrar participantes em atendimentos do mês para um profissional, abrir o repasse do mês e confirmar que a soma dos honorários daquele profissional aparece na sua linha; estornar um atendimento e confirmar que o honorário correspondente sai da conta.

**Acceptance Scenarios**:

1. **Given** participações registradas num mês para o Dr. A, **When** o repasse do mês é consultado, **Then** a linha do Dr. A inclui a soma dos honorários das suas participações.
2. **Given** um atendimento estornado, **When** o repasse é consultado, **Then** os honorários dos participantes daquele atendimento não são contabilizados.

---

### User Story 3 — Equipe alimenta a guia TISS SP/SADT (Priority: P2)

Ao gerar a guia de SP/SADT de um atendimento, o bloco de equipe de cada linha de procedimento é preenchido com os participantes e seus graus de participação (domínio TISS 35), conforme o padrão exige.

**Why this priority**: Liga o cadastro ao faturamento de convênio (cirurgias têm equipe). Depende do US1 e do módulo TISS SP/SADT já existente.

**Independent Test**: Para um atendimento com participantes em um procedimento, gerar a guia SP/SADT e confirmar que a guia inclui a equipe com os graus corretos e continua válida no padrão.

**Acceptance Scenarios**:

1. **Given** um procedimento com 2 participantes de graus distintos, **When** a guia SP/SADT é gerada, **Then** a linha do procedimento traz os 2 participantes com seus graus no bloco de equipe.
2. **Given** um participante sem dados profissionais completos (conselho/UF), **When** a guia é gerada, **Then** a pendência é sinalizada (a guia não fica "pronta" enquanto a equipe estiver incompleta para o padrão).

---

### User Story 4 — Corrigir a equipe sem perder histórico (Priority: P3)

A correção de uma participação (valor errado, profissional errado, grau errado) é feita removendo a participação e adicionando a correta — o histórico do que foi registrado permanece para auditoria.

**Why this priority**: Operacional/conformidade. Reaproveita o padrão append-only com soft-unlink já existente.

**Independent Test**: Registrar uma participação com valor errado, removê-la, registrar a correta e confirmar que a auditoria mostra as duas operações e que o cálculo passa a usar a correta.

**Acceptance Scenarios**:

1. **Given** uma participação com honorário incorreto, **When** o usuário remove e registra a correta, **Then** o financeiro passa a refletir a nova e a auditoria preserva ambas.

---

### Edge Cases

- Profissional duplicado na equipe ativa do mesmo procedimento → bloqueado.
- Honorário zero ou negativo → rejeitado.
- Grau de participação fora da lista padrão → rejeitado.
- Participante de outro tenant / procedimento de outro tenant → bloqueado (isolamento).
- Procedimento sem nenhum participante → permitido (nem todo procedimento tem equipe); só não alimenta equipe na guia.
- Atendimento estornado → participações não contam no financeiro nem no faturamento; registro histórico mantido.
- Remover uma participação já removida → operação idempotente/bloqueada.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: O sistema MUST permitir vincular participantes a uma **linha de procedimento** específica de um atendimento (não apenas ao atendimento como um todo).
- **FR-002**: Cada participação MUST registrar: o profissional, o **grau de participação** (valor da lista padrão TISS, domínio 35) e o **honorário** em centavos.
- **FR-003**: O sistema MUST aceitar participantes de **qualquer modalidade de pagamento** (comissionado, fixo ou liberal) — sem a restrição atual a "liberal".
- **FR-004**: O honorário MUST ser **congelado** no momento do registro (imutável); correções são feitas por remoção + novo registro (append-only com soft-unlink, padrão já usado para assistentes).
- **FR-005**: O sistema MUST impedir o **mesmo profissional duplicado** na equipe ativa de um mesmo procedimento.
- **FR-006**: O sistema MUST validar o grau contra a **lista padrão de graus de participação** (domínio TISS 35) e rejeitar valores fora dela.
- **FR-007**: O sistema MUST rejeitar honorário ausente, zero ou negativo.
- **FR-008**: O sistema MUST registrar em **auditoria** a inclusão e a remoção de cada participação (quem, quando, valores).
- **FR-009**: O sistema MUST garantir **isolamento por clínica** — participações só envolvem profissionais/atendimentos da mesma clínica.
- **FR-010**: O honorário de cada participação MUST entrar no **repasse mensal** do profissional participante, e MUST sair quando o atendimento for estornado.
- **FR-011**: Ao gerar a guia **TISS SP/SADT**, o sistema MUST preencher o bloco de **equipe** de cada linha de procedimento com os participantes e seus graus; e MUST sinalizar pendência quando a equipe estiver incompleta para o padrão.
- **FR-012**: A UI do atendimento MUST permitir **adicionar e remover** participantes por procedimento, exibindo profissional, grau e honorário, respeitando permissões (quem pode ver valores).
- **FR-013**: A lista de **graus de participação** MUST vir da fonte oficial do padrão (catálogo de domínio), e não de texto livre.
- **FR-014**: O honorário de uma participação MUST entrar no repasse mensal do profissional **independentemente da sua modalidade** (liberal, fixo ou comissionado) — é receita adicional pelo papel na equipe, somada ao que o profissional já recebe pela sua modalidade. (Decisão do usuário, 2026-06-18.)
- **FR-015**: A equipe registrada nesta feature MUST conter **apenas os participantes adicionais** (ex.: anestesista, auxiliar, instrumentador). O **executante principal** (médico do atendimento) NÃO vira uma participação com honorário aqui — permanece no fluxo atual (comissão/fixo do atendimento, inalterado), evitando dupla contagem. (Decisão do usuário, 2026-06-18.)

### Key Entities *(include if feature involves data)*

- **Participação em procedimento**: representa um profissional participando de uma linha de procedimento de um atendimento. Atributos: clínica, atendimento, linha de procedimento, profissional, grau de participação, honorário (congelado), criado por/quando, removido por/quando (soft-unlink). Substitui/estende o conceito atual de "assistente do atendimento" (que é por atendimento e só liberal).
- **Grau de participação**: item do catálogo padrão (domínio TISS 35) — ex.: cirurgião, primeiro auxiliar, segundo auxiliar, anestesista, instrumentador. Código + descrição.
- **Linha de procedimento do atendimento**: já existente; passa a ser o alvo do vínculo da equipe.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A clínica consegue registrar a equipe completa de um procedimento (vários participantes, com grau e honorário) em menos de 1 minuto por procedimento.
- **SC-002**: 100% dos honorários de participações ativas de um mês aparecem no repasse dos respectivos profissionais (soma confere com o registrado), e 0% dos honorários de atendimentos estornados são contabilizados.
- **SC-003**: Guias SP/SADT de procedimentos com equipe são geradas com o bloco de equipe preenchido e permanecem válidas no padrão em 100% dos casos de teste.
- **SC-004**: Nenhuma participação pode ser registrada com grau fora do catálogo padrão ou com honorário inválido (0 rejeições incorretas / 0 aceitações indevidas nos testes).
- **SC-005**: Toda inclusão e remoção de participação fica rastreável na auditoria (100%).

## Assumptions

- O catálogo de graus de participação (domínio TISS 35) será populado a partir da fonte oficial já versionada no projeto; enquanto não houver entradas, a validação aceita o formato e aperta quando o catálogo existir (padrão já adotado para outros domínios).
- O honorário é informado manualmente por participação (como o valor de assistente hoje), não derivado automaticamente de tabela por grau — derivação/sugestão por tabela fica como evolução futura.
- A correção de participação segue o padrão append-only com soft-unlink já existente (não há edição "in-place").
- Está **fora do escopo** nesta feature: alterar a regra de comissão/repasse do atendimento principal; tratar o executante principal como participação (decisão: equipe = só adicionais); criar relatórios novos dedicados de honorários (podem vir depois); derivar honorário automaticamente por tabela de grau.
- Reaproveita o caminho de repasse "liberal" já existente, generalizando-o para participações de qualquer modalidade (decisão: honorário soma no repasse independentemente da modalidade).
