# Feature Specification: Marca da clínica no portal e área de composição corporal

**Feature Branch**: `058-portal-marca-composicao`
**Created**: 2026-08-14
**Status**: Draft
**Input**: User description: "a clínica pode escolher a paleta e a logo da página do paciente" + "adicionar uma área com a composição corporal apresentando um gráfico em pizza, ou o avatar com as descrições como é nos demais sistemas do tipo, isolada como função de nutri para dar manutenção pela página de admin"

## Contexto

Duas frentes, pedidas como uma tarefa só. O que as une é o portal do paciente
ter deixado de ser uma tela genérica: ele agora é a cara da clínica para quem é
atendido por ela, e é onde o resultado do trabalho da nutricionista chega ao
paciente.

A feature 057 preparou o terreno sem que esse fosse o objetivo: ao trocar toda
cor escrita na mão por tokens de tema, ela tornou possível uma clínica ter a
própria paleta sem reescrever tela nenhuma.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A clínica se reconhece no portal (Priority: P1)

O administrador da clínica define a cor da marca e confirma o logo. O paciente
abre o portal e vê a identidade da clínica que o atende, não a de um sistema.

**Why this priority**: é o que transforma o portal de "uma tela do fornecedor"
em "a área da minha clínica". Vale sozinha, sem nada da composição corporal.

**Independent Test**: definir uma cor numa clínica, abrir o portal dela e o de
outra clínica, e confirmar que cada uma aparece com a sua identidade.

**Acceptance Scenarios**:

1. **Given** o administrador na configuração do portal, **When** escolhe a cor da marca e salva, **Then** o portal daquela clínica passa a usar essa cor nos elementos de destaque.
2. **Given** duas clínicas com cores diferentes, **When** pacientes de cada uma abrem seus portais, **Then** cada portal usa a cor da sua clínica, sem vazamento entre elas.
3. **Given** uma clínica que nunca escolheu cor, **When** o paciente abre o portal, **Then** ele aparece com a paleta padrão do produto, sem nada quebrado.
4. **Given** uma cor de marca muito clara, **When** ela é aplicada, **Then** o texto sobre ela continua legível, porque a cor de frente é calculada e não escolhida.
5. **Given** o logo da clínica já cadastrado, **When** o paciente abre qualquer página do portal, **Then** o logo aparece identificando a clínica.

---

### User Story 2 - O paciente vê a sua composição corporal (Priority: P2)

O paciente abre a área de composição corporal e vê do que o seu peso é feito,
com a evolução ao longo das avaliações.

**Why this priority**: é conteúdo novo para o paciente e depende de a clínica ter
o módulo. A US1 entrega valor sem ela.

**Independent Test**: com uma avaliação nutricional registrada, abrir a área no
portal e conferir que os valores batem com os da avaliação.

**Acceptance Scenarios**:

1. **Given** paciente com avaliação nutricional que calculou composição, **When** abre a área, **Then** vê percentual de gordura, massa gorda e massa magra da avaliação mais recente.
2. **Given** paciente com mais de uma avaliação, **When** abre a área, **Then** vê a evolução entre elas.
3. **Given** avaliações feitas por métodos diferentes (dobras e bioimpedância), **When** aparecem juntas, **Then** cada uma declara o método pelo qual foi obtida.
4. **Given** paciente sem nenhuma avaliação com composição, **When** a área é aberta, **Then** ela explica a ausência em vez de mostrar tela vazia.

---

### User Story 3 - A clínica liga e desliga a área (Priority: P2)

A composição corporal é módulo de nutrição: existe para as clínicas que
contrataram, é ligada por clínica no `/admin`, e a própria clínica decide se
expõe ao paciente.

**Why this priority**: sem isso, a área nasceria visível para todo mundo,
inclusive para clínicas que não fazem avaliação nutricional.

**Independent Test**: com o módulo desligado no `/admin`, confirmar que a área
não aparece no portal nem pelo endereço direto.

**Acceptance Scenarios**:

1. **Given** clínica sem o módulo, **When** o paciente abre o portal, **Then** não existe card nem página de composição corporal.
2. **Given** clínica com o módulo mas com a seção desligada, **When** alguém abre o endereço direto, **Then** é devolvido à tela inicial.
3. **Given** o administrador da plataforma no `/admin`, **When** liga o módulo para uma clínica, **Then** a seção passa a poder ser habilitada por ela.

---

### Edge Cases

- **Cor de marca ilegível** (muito clara para texto branco, muito escura para texto escuro): a cor de frente é derivada da cor escolhida, nunca informada por quem configura.
- **Cor de marca inválida ou corrompida**: o portal cai na paleta padrão em vez de renderizar sem cor.
- **Clínica sem logo**: o portal mostra o nome da clínica, como já faz hoje.
- **Composição calculada por percentual informado direto** (sem dobras nem equação): continua sendo um método, e é declarado como tal.
- **Avaliação antiga sem os campos de composição**: não entra na evolução, e a ausência não vira zero.
- **Paciente com uma única avaliação**: mostra o valor atual sem afirmar tendência. Um ponto não é evolução.
- **Módulo revogado depois de ligado**: a área some do portal, sem apagar dado nenhum.

## Requirements *(mandatory)*

### Functional Requirements

#### Marca da clínica

- **FR-001**: A clínica MUST poder definir a cor da sua marca para o portal do paciente, na configuração do portal.
- **FR-002**: O portal MUST aplicar a cor da clínica aos elementos de destaque (ações, ícones de seção, indicadores de progresso), mantendo fundo e texto de leitura na paleta neutra.
- **FR-003**: A cor de frente usada sobre a cor da marca MUST ser derivada dela, garantindo contraste mínimo de leitura. Quem configura escolhe a cor da marca, nunca a cor do texto sobre ela.
- **FR-004**: Clínica sem cor definida MUST exibir o portal na paleta padrão do produto.
- **FR-005**: Cor inválida MUST fazer o portal cair na paleta padrão, sem quebrar a página.
- **FR-006**: A identidade de uma clínica MUST NOT vazar para o portal de outra.
- **FR-007**: O logo já cadastrado da clínica MUST aparecer em todas as páginas do portal.
- **FR-008**: A personalização MUST alcançar apenas o portal do paciente. As telas internas da equipe seguem na paleta do produto.

#### Composição corporal

- **FR-009**: O portal MUST ter uma área de composição corporal, com card na tela inicial e página própria, como as demais áreas.
- **FR-010**: A área MUST exibir percentual de gordura, massa gorda e massa magra da avaliação mais recente.
- **FR-011**: Havendo mais de uma avaliação, a área MUST mostrar a evolução desses valores ao longo do tempo.
- **FR-012**: Cada valor exibido MUST declarar o método pelo qual foi obtido. Dobras e bioimpedância não são comparáveis, e sem o rótulo uma troca de instrumento pareceria evolução.
- **FR-013**: A área MUST NOT recalcular nada: exibe o que a avaliação nutricional já apurou.
- **FR-014**: Ausência de dado MUST NOT virar zero, nem no valor nem no gráfico.
- **FR-015**: A área MUST NOT classificar o paciente (por exemplo "acima do ideal") sem faixa de referência cadastrada. Quem interpreta é a equipe.

#### Módulo e permissão

- **FR-016**: A área de composição corporal MUST ser controlada por um módulo de nutrição, ligável por clínica na página `/admin`.
- **FR-017**: A clínica com o módulo MUST poder ligar e desligar a seção para os seus pacientes, como já faz com as demais.
- **FR-018**: Sem o módulo, a área MUST ser inacessível também pelo endereço direto, não apenas escondida.
- **FR-019**: Revogar o módulo MUST remover a área do portal sem apagar dado clínico.

### Key Entities

- **Marca da clínica**: cor escolhida para o portal, mais o logo já existente. Uma por clínica, opcional.
- **Composição corporal**: resultado já apurado pela avaliação nutricional (percentual de gordura, massa gorda, massa magra) mais o método usado e a data.
- **Módulo de nutrição**: o que a plataforma libera por clínica e a clínica expõe ao paciente.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Um administrador define a cor da marca e vê o portal mudar em menos de 1 minuto, sem ajuda.
- **SC-002**: 100% das combinações de cor de marca escolhíveis mantêm contraste de leitura suficiente sobre os elementos em que são aplicadas.
- **SC-003**: Nenhuma clínica consegue ver ou aplicar a identidade de outra.
- **SC-004**: Clínicas sem personalização continuam com o portal idêntico ao de hoje.
- **SC-005**: Os valores de composição exibidos ao paciente são idênticos aos da avaliação correspondente, sem divergência.
- **SC-006**: 100% das clínicas sem o módulo permanecem sem acesso à área, inclusive por endereço direto.
- **SC-007**: Todo valor de composição exibido informa o método que o originou.

## Clarifications

Perguntas em aberto, a responder em `/speckit.clarify`.

### Q1 — Alcance da paleta

- **NEEDS CLARIFICATION**: a clínica escolhe apenas UMA cor de marca (e o sistema deriva os tons e as cores de frente, garantindo legibilidade), ou escolhe um conjunto (por exemplo cor de destaque + cor de fundo), com mais liberdade e o risco de produzir uma tela ilegível?

### Q2 — Representação da composição

Levantamento feito no código antes de escrever este spec: o motor de composição
da 046 apura **percentual de gordura, massa gorda e massa magra**. Não há água
corporal, massa óssea, massa muscular nem gordura visceral, que é justamente o
que os aparelhos de bioimpedância mostram em volta do avatar.

- **NEEDS CLARIFICATION**: a área mostra um gráfico de proporção com o que existe hoje (duas partes: gorda e magra), ou um avatar no formato dos sistemas de bioimpedância, aceitando que ele nasça com menos rótulos do que o formato sugere, ou que a feature passe a capturar os dados que faltam?

### Q3 — Qual módulo

- **NEEDS CLARIFICATION**: a composição corporal entra como módulo NOVO (vendável à parte, permitindo uma clínica ter composição sem plano alimentar), ou como parte de um módulo de nutrição já existente (`dieta`), o que simplifica a venda e faz a área aparecer para quem já contratou?

## Assumptions

- **O logo já existe e já é exibido.** A clínica cadastra o logo hoje, e o portal o mostra no cabeçalho. Esta feature garante presença e prominência, não cria o cadastro.
- **A personalização não altera contraste de conteúdo clínico.** Valores, faixas e alertas continuam na semântica do produto (sucesso, atenção, alerta), porque significado não é marca.
- **A composição corporal usa dado que já existe.** A avaliação nutricional da 046 já apura e grava; a feature expõe ao paciente.
- **Nenhuma entrada de dado pelo paciente.** O portal segue somente leitura, com a única exceção existente do checklist de hábitos.
- **A área segue as regras de seção do portal**: ordem vinda do catálogo, card com prévia, card apagado quando vazio, gate na página, e registro na trilha de acesso.
- **Haverá mudança de banco**: ao menos a cor da marca por clínica e o registro do módulo novo, se a Q3 apontar para módulo próprio.
- **A paleta padrão do produto continua sendo o padrão.** Personalizar é opt-in; nada muda para quem não escolher.
