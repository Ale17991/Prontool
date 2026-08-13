# Feature Specification: Home do portal do paciente + áreas em páginas próprias

**Feature Branch**: `057-portal-paciente-home`
**Created**: 2026-08-13
**Status**: Draft
**Input**: User description: "o portal do paciente tenha na tela inicial apenas as metas e o checklist, as demais áreas vão virar cards clicáveis que vão me direcionar para a página final da área que desejo ver"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A tela inicial mostra só o que eu acompanho todo dia (Priority: P1)

O paciente entra no portal e vê, imediatamente, as suas metas e o checklist de
hábitos — a única coisa que ele de fato *faz* ali. Tudo o mais que a clínica
liberou aparece logo abaixo como uma grade de cards nomeados, não como conteúdo
aberto.

**Why this priority**: hoje o portal é uma rolagem única em que resumo, gráficos,
histórico, treino, dieta e exames empurram o checklist para o meio da página. No
celular — onde o paciente está — a ação que sustenta o engajamento fica abaixo de
várias telas de conteúdo que ele só consulta de vez em quando. Sozinha, esta
história já entrega o portal utilizável.

**Independent Test**: entrar como paciente de uma clínica com metas e hábitos
ativos e verificar que a primeira tela contém apenas saudação, metas, checklist e
os cards — nenhum gráfico, plano ou histórico aberto.

**Acceptance Scenarios**:

1. **Given** paciente com metas ativas e checklist do período em aberto, **When** faz login, **Then** a tela inicial mostra metas e checklist e nenhuma outra área em conteúdo expandido.
2. **Given** a clínica tem evolução, atendimentos e plano alimentar ligados, **When** o paciente abre a tela inicial, **Then** as três aparecem como cards nomeados, na ordem do catálogo de seções.
3. **Given** a clínica desligou uma seção, **When** o paciente abre a tela inicial, **Then** não existe card para ela.
4. **Given** o paciente tem consulta marcada para 14/08 às 15h e a área de atendimentos está ligada, **When** abre a tela inicial, **Then** o cabeçalho traz "Sua próxima consulta: 14/08 às 15h" em uma linha discreta.
5. **Given** o paciente não tem consulta futura, **When** abre a tela inicial, **Then** o cabeçalho não traz linha de próxima consulta nem menção à ausência.

---

### User Story 2 - Cada área abre em página própria (Priority: P2)

Tocar num card leva à página daquela área — evolução, atendimentos, orientações,
resultados de exames, rotina de treino ou plano alimentar — com o conteúdo
completo e um caminho de volta para a tela inicial.

**Why this priority**: é o que dá sentido aos cards. Sem as páginas, a US1 teria
escondido conteúdo sem oferecer onde encontrá-lo.

**Independent Test**: a partir da tela inicial, tocar em cada card e confirmar
que a página correspondente abre com o conteúdo daquela área e volta para a home.

**Acceptance Scenarios**:

1. **Given** o card "Plano alimentar" na tela inicial, **When** o paciente toca nele, **Then** abre a página do plano alimentar com as refeições prescritas.
2. **Given** o paciente está numa página de área, **When** aciona o caminho de volta, **Then** retorna à tela inicial do portal.
3. **Given** uma seção que a clínica NÃO liberou, **When** alguém abre o endereço direto daquela área, **Then** o portal devolve a pessoa à tela inicial sem mostrar o conteúdo.
4. **Given** qualquer página de área, **When** ela é aberta, **Then** o acesso é registrado na trilha do portal como acesso a dado de saúde.

---

### User Story 3 - Área ligada e ainda vazia não vira beco (Priority: P3)

Quando a clínica liberou uma área mas ainda não há nada nela (o nutricionista
não cadastrou o plano, a equipe não escreveu orientações), o card aparece
apagado, diz o que falta e de quem depende, e não leva a lugar nenhum.

**Why this priority**: refinamento. O portal funciona sem isso, mas some ou
frustra: esconder o card apagaria da vista da pessoa algo que a clínica ofereceu,
e deixá-lo clicável a levaria a uma página em branco.

**Independent Test**: com uma seção ligada e sem conteúdo, confirmar que o card
existe, está visivelmente apagado, explica a ausência e não navega.

**Acceptance Scenarios**:

1. **Given** a seção de treino ligada e nenhum plano cadastrado, **When** o paciente abre a tela inicial, **Then** o card aparece apagado com a explicação de que o profissional ainda não cadastrou a rotina.
2. **Given** um card apagado, **When** o paciente toca nele, **Then** nada acontece — não há navegação.
3. **Given** uma área sem conteúdo alcançada pelo endereço direto, **When** a página abre, **Then** ela explica a ausência em vez de mostrar tela vazia.

---

### Edge Cases

- **Nenhuma área liberada além de metas e hábitos**: a tela inicial mostra metas, checklist e nenhuma grade de cards — sem espaço vazio nem título órfão.
- **Metas e hábitos desligados pela clínica**: a tela inicial passa a mostrar o texto de boas-vindas (se houver) e a primeira área com conteúdo, aberta (FR-017).
- **Hábitos ligados mas sem checklist montado para o paciente**: conta como "sem hábitos" para decidir a promoção. A tela inicial precisa saber disso ANTES de se desenhar — hoje essa verificação acontece só depois que a tela já está montada, e sem resolver isso a promoção não tem como ser decidida com segurança.
- **Texto de boas-vindas cadastrado, mas metas e hábitos ativos**: o texto não aparece. Ele é o preenchimento de uma tela inicial que ficaria vazia, não um recado permanente.
- **Sessão expira durante a navegação entre áreas**: só acontece após 30 minutos parado ou 12 horas desde o login (FR-022/FR-023). A pessoa volta ao login com o aviso de sessão expirada.
- **Teto de 12 horas atingido com o paciente em uso**: a sessão cai mesmo assim. É o comportamento pretendido, não uma falha.
- **Paciente sem nenhum dado em nenhuma área**: a tela inicial informa que ainda não há informações, em vez de aparecer quebrada.
- **Exame que também é métrica de acompanhamento**: um mesmo resultado não pode aparecer ao mesmo tempo na área de evolução e na de exames.
- **Área liberada pelo plano da clínica mas ainda não construída no produto**: não gera card.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: A tela inicial do portal MUST exibir, como conteúdo aberto, apenas as metas do paciente e o checklist de hábitos — quando essas seções estiverem liberadas e tiverem conteúdo.
- **FR-002**: Todas as demais áreas liberadas MUST aparecer na tela inicial como cards nomeados que levam à página daquela área.
- **FR-003**: A ordem dos cards MUST seguir a ordem do catálogo de seções do portal, igual para todas as clínicas — nunca a ordem em que a clínica ligou as seções.
- **FR-004**: Cada card MUST trazer uma prévia curta do que há dentro (por exemplo, quando foi a atualização mais recente ou quantos itens existem), para não ser um menu cego.
- **FR-005**: Cada área liberada MUST ter uma página própria, alcançável por endereço estável e com caminho de volta visível para a tela inicial.
- **FR-006**: O portal MUST recusar o acesso à página de uma área não liberada para aquela clínica — seja porque a clínica a desligou, seja porque o plano não a inclui — mesmo quando o endereço é digitado à mão, devolvendo a pessoa à tela inicial.
- **FR-007**: Cada abertura de página do portal MUST ser registrada na trilha de acesso do paciente, identificando **qual área** foi aberta. Sem isso, a navegação multiplicaria linhas idênticas — mais volume e nenhuma informação a mais sobre que dado de saúde foi consultado.
- **FR-007a**: Os registros já existentes MUST permanecer como estão, sem área. A trilha é append-only e não se reescreve o passado; a ausência de área identifica os acessos anteriores a esta feature.
- **FR-008**: Área liberada e sem conteúdo MUST aparecer como card apagado, com texto que informe a ausência e de quem depende o preenchimento, e MUST NOT navegar.
- **FR-009**: A página de uma área sem conteúdo MUST explicar a ausência em vez de exibir tela vazia.
- **FR-010**: O portal MUST continuar somente-leitura para o paciente, com a única exceção já existente: a marcação do checklist de hábitos.
- **FR-011**: A reformulação MUST NOT alterar quais dados o paciente pode ver — apenas onde eles ficam. Nenhum dado financeiro, nenhum valor de exame sem interpretação e nenhuma seção sensível passa a ser exibida por efeito desta mudança.
- **FR-012**: Um mesmo resultado de exame MUST NOT aparecer simultaneamente na área de evolução e na área de exames.
- **FR-013**: A identificação da clínica (nome e logo) MUST permanecer visível em todas as páginas do portal, não só na tela inicial.
- **FR-014**: O cabeçalho da tela inicial MUST exibir uma linha discreta com a data e a hora da próxima consulta do paciente quando houver consulta futura — por exemplo, "Sua próxima consulta: 14/08 às 15h". É uma linha de cabeçalho, não um bloco de conteúdo: não conta contra o FR-001 nem contra o SC-005.
- **FR-015**: A linha da próxima consulta MUST respeitar o liga/desliga da área de atendimentos. Clínica que desligou a área não exibe a próxima consulta no cabeçalho — senão o cabeçalho contornaria a decisão da clínica.
- **FR-016**: Sem consulta futura, a linha MUST NOT aparecer, e o cabeçalho MUST NOT anunciar a ausência. A data e a hora MUST ser as do fuso da clínica.
- **FR-017**: Quando nem as metas nem o checklist de hábitos têm o que exibir, a tela inicial MUST exibir o texto de boas-vindas da clínica (quando cadastrado) e, abaixo dele, a primeira área com conteúdo na ordem do catálogo, aberta como conteúdo.
- **FR-018**: O texto de boas-vindas MUST ser opcional e escrito pela clínica na configuração do portal. Sem texto cadastrado, a tela inicial exibe apenas a área promovida.
- **FR-019**: A área promovida à tela inicial MUST NOT aparecer também como card na mesma tela — a mesma coisa não se mostra duas vezes.
- **FR-020**: Não havendo texto nem nenhuma área com conteúdo, a tela inicial MUST informar que ainda não há informações, como já faz hoje.
- **FR-021**: A promoção MUST valer apenas enquanto metas e hábitos não têm o que exibir. Voltando a existir meta ou checklist, a tela inicial volta a mostrá-los e a área promovida retorna à condição de card.
- **FR-022**: A sessão do paciente MUST renovar-se a cada página do portal aberta. Os 30 minutos passam a valer como janela de **inatividade**, não de duração total.
- **FR-023**: A sessão MUST expirar de forma definitiva 12 horas após o login, por mais ativo que o paciente esteja. A autenticação do portal é fraca por decisão de produto (CPF + data de nascimento), e sem teto absoluto uma aba esquecida num aparelho compartilhado ficaria viva indefinidamente.
- **FR-024**: Expirada por qualquer um dos dois motivos, a pessoa MUST voltar ao login com o aviso de sessão expirada, sem distinguir se foi inatividade ou teto — como já ocorre hoje.

### Key Entities

- **Seção do portal**: área que a clínica pode ligar ou desligar (metas, atendimentos, evolução, orientações, exames, treino, dieta, hábitos). Tem nome, ordem de exibição, sensibilidade e, às vezes, um módulo pago exigido. Já existe; esta feature não cria nem remove seções.
- **Card de área**: representação da seção na tela inicial — nome, prévia do conteúdo, estado (com conteúdo ou vazio) e destino.
- **Página de área**: destino do card, com o conteúdo completo daquela seção e o caminho de volta.
- **Trilha de acesso**: registro de que o paciente abriu o portal, usado para prestação de contas de LGPD.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Em tela de celular, o paciente alcança a marcação do checklist de hábitos sem passar da primeira rolagem da tela inicial.
- **SC-002**: Qualquer área liberada e com conteúdo é alcançada a partir da tela inicial em **um único toque**.
- **SC-003**: 100% das áreas não liberadas permanecem inacessíveis pelo endereço direto.
- **SC-004**: Nenhum card com aparência clicável leva a uma página sem conteúdo.
- **SC-005**: A tela inicial exibe, no máximo, dois blocos de conteúdo aberto — metas e checklist no caso comum; texto de boas-vindas e área promovida quando aqueles não se aplicam — mais a grade de cards.
- **SC-006**: O conjunto de dados visível ao paciente antes e depois da mudança é idêntico — nenhuma informação nova é exposta e nenhuma some.
- **SC-007**: Paciente em uso contínuo não é interrompido por expiração antes das 12 horas; sessão parada expira em 30 minutos.

## Clarifications

### Session 2026-08-13

- Q: A próxima consulta deve ganhar destaque próprio na tela inicial (com profissional, horário e endereço) ou continuar apenas como prévia do card de atendimentos? → A: Nenhum dos dois — uma linha discreta no cabeçalho da tela inicial ("Sua próxima consulta: 14/08 às 15h"), sem bloco novo.
- Q: Quando nem metas nem hábitos têm o que exibir, a tela inicial fica só com os cards, ou ganha conteúdo mínimo? → A: Ganha os dois, somados — o texto de boas-vindas escrito pela clínica (quando houver) e, abaixo dele, a primeira área com conteúdo, aberta.
- Q: A sessão de 30 minutos deve renovar-se com o uso, continuar fixa desde o login, ou ganhar aviso antes de expirar? → A: Renova a cada página aberta, com os 30 minutos passando a valer como janela de INATIVIDADE, e teto absoluto de 12 horas contadas do login.
- Q: A trilha de acesso passa a gravar uma linha por página aberta, todas idênticas. Manter, enriquecer ou reduzir? → A: Enriquecer — uma linha por página, gravando qual área foi aberta.

## Assumptions

- **Nenhuma seção nova é criada.** A feature reorganiza as seções que já existem e já são configuráveis pela clínica. Prescrições, documentos, vacinas e faturas seguem não construídas e continuam fora.
- **As três camadas de controle continuam valendo** — plano da clínica, liga/desliga da clínica e a cautela de seções sensíveis nascerem desligadas. A reformulação é de navegação, não de permissão.
- **O checklist de hábitos permanece a única escrita do paciente.** Nenhuma área nova aceita entrada de dados.
- **A ordem e os nomes das áreas vêm do catálogo de seções já existente**, para que duas clínicas apresentem o portal do mesmo jeito.
- **Prévia dos cards usa dado que o paciente já pode ver** — nada de informação nova exposta na tela inicial.
- **A feature deixou de ser só de tela.** Duas mudanças de banco, ambas na mesma migration nova — **0202**, conferida como o próximo número livre e a única pendente em produção (0196–0201 já aplicadas, sondadas em 2026-08-13): o texto de boas-vindas por clínica (FR-018) e a área na trilha de acesso (FR-007). Todo o resto continua sem tocar em banco.
- **A paleta atual do portal é mantida.** O realinhamento visual com a paleta de produto (feature 055) e a inclusão de gráfico na área de evolução são trabalhos separados, fora deste escopo.
- **A renovação da sessão (FR-022) precisa acontecer numa camada capaz de reescrever a credencial de sessão** — a página que o paciente abre não consegue fazer isso sozinha. Ponto a resolver no `/speckit.plan`; não muda o comportamento pedido, muda onde ele é implementado.
- **A forma de entrar no portal fica como está.** A correção dos rótulos do formulário de entrada (campos "Login"/"Senha" que na verdade pedem CPF e data de nascimento) é uma frente própria.
