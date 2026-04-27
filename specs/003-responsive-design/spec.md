# Feature Specification: Responsividade total (mobile, tablet e desktop)

**Feature Branch**: `003-responsive-design`
**Created**: 2026-04-27
**Status**: Draft
**Input**: User description: "Tornar o Pronttu totalmente responsivo para tablets e celulares. O sistema precisa funcionar perfeitamente em telas de 360px (celular) até 1920px (desktop). Problemas: sidebar fixa de 256px sempre visível (crítico), tab bar de navegação sem overflow (alto), modais sem max-h+overflow (médio), padding p-8 fixo (médio), tabelas sem indicador de scroll (baixo), action bar da ficha do paciente sem flex-col (baixo)."

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Recepcionista cadastra paciente pelo celular durante atendimento na recepção (Priority: P1)

Recepcionista atende um paciente em pé na recepção, sem acesso a desktop. Ela usa o celular (viewport ~360-414px) pra abrir o sistema, autenticar, navegar até "Operação → Pacientes → Novo paciente" e cadastrar o paciente. O fluxo precisa ser executável de ponta a ponta sem que ela precise pinçar/zoom, sem conteúdo cortado e sem campos sobrepondo a sidebar.

**Why this priority**: Hoje o sistema é literalmente inutilizável em mobile — a sidebar de 256px consome ~70% de uma tela de 360px, espremendo o conteúdo e tornando forms ilegíveis. Sem isso resolvido, qualquer melhoria menor é irrelevante. Essa é a porta de entrada do uso mobile.

**Independent Test**: Pode ser totalmente testada abrindo o sistema em DevTools com viewport `375×667` (iPhone SE), logando como recepcionista, navegando até o cadastro de paciente, preenchendo todos os campos obrigatórios e salvando. Sucesso: paciente criado, sem nenhum campo do formulário sobreposto pela navegação, sem texto cortado.

**Acceptance Scenarios**:

1. **Given** o usuário abre o sistema em viewport ≤ 768px, **When** carrega qualquer página interna, **Then** a navegação principal (categorias) NÃO ocupa espaço horizontal permanente — fica acessível via botão hamburger no topo.
2. **Given** o usuário está na ficha do paciente em viewport 360px, **When** abre a navegação via hamburger, **Then** ela aparece como overlay/drawer cobrindo o conteúdo, com botão de fechar e fechamento ao tocar fora.
3. **Given** o usuário está na lista de Cadastros (que tem 6 abas), **When** o viewport for 360px, **Then** as abas ficam acessíveis via scroll horizontal suave dentro da barra de tabs, sem cortar nem empurrar para fora da viewport.
4. **Given** o usuário preenche o formulário "Novo paciente" em 360px, **When** rola a página, **Then** todos os campos ficam empilhados em uma coluna, com labels visíveis e inputs ocupando 100% da largura disponível.

---

### User Story 2 — Profissional de saúde consulta a ficha do paciente em tablet durante consulta (Priority: P2)

Profissional usa tablet (768-1024px) ao lado da maca durante atendimento. Abre a ficha do paciente, lê alergias, antecedentes, sinais vitais, registra evolução SOAP, imprime o prontuário. Em modais (Limpar dados, Imprimir prontuário, Registrar pagamento) o conteúdo precisa caber sem cortar e sem o body atrás scrollar quando o modal já tem conteúdo alto.

**Why this priority**: Tablets são o caso de uso mais comum em consultórios — relativamente bem servido pelo grid `md:` atual, mas modais altos quebram o fluxo, e o action bar da ficha (Voltar / Imprimir / Limpar dados) pode apertar.

**Independent Test**: Em viewport `768×1024` (iPad), abrir uma ficha de paciente com >5 evoluções + >10 sinais vitais + alergias + antecedentes, abrir os 3 modais principais e validar que cada um scrolla internamente sem fazer o background scrollar. Sucesso: nenhum botão "Confirmar/Cancelar" fica fora da viewport quando o modal está aberto.

**Acceptance Scenarios**:

1. **Given** o usuário abre o modal "Imprimir prontuário" em viewport 768px, **When** o conteúdo do modal seria mais alto que o viewport, **Then** o modal scrolla internamente — o background não scrolla.
2. **Given** a ficha do paciente em viewport 600px, **When** o usuário olha o action bar do topo, **Then** os botões "Voltar" / "Imprimir prontuário" / "Limpar dados" ficam acessíveis (empilhados verticalmente ou com wrap), sem nenhum cortado.
3. **Given** uma tabela larga (ex.: histórico de atendimentos com 6 colunas) em viewport 600px, **When** ela não cabe na largura, **Then** existe um indicador visual (sombra, fade ou seta) sugerindo que dá pra deslizar lateralmente.

---

### User Story 3 — Operações cotidianas continuam estáveis em desktop após mudanças (Priority: P3)

Usuário desktop (≥1280px) que já usa o sistema diariamente continua tendo a experiência atual: sidebar permanente à esquerda, layout de 4 colunas em dashboards, tabelas largas sem scroll horizontal, modais centralizados.

**Why this priority**: As mudanças responsivas não podem quebrar o fluxo de quem já usa em desktop. É regressão, não feature — mas precisa ser garantido.

**Independent Test**: Em viewport ≥1280px, validar que sidebar permanece fixa visível, tabs não viram scroll, modais não viram fullscreen, e os grids de 4 colunas em dashboards permanecem 4 colunas.

**Acceptance Scenarios**:

1. **Given** viewport ≥768px, **When** o usuário acessa qualquer página, **Then** a sidebar fica permanentemente visível à esquerda (sem hamburger).
2. **Given** viewport ≥1024px, **When** o usuário olha tabelas de até 7 colunas, **Then** elas cabem sem precisar scroll horizontal.
3. **Given** viewport ≥1280px, **When** o usuário abre dashboards (financeiro, por-plano, sinais vitais), **Then** os grids mantêm 3-4 colunas conforme o desktop atual.

---

### Edge Cases

- Viewport intermediário (~700-767px): borderline entre tablet/mobile — em qual lado cai a sidebar? **Decisão**: hamburger até 767px (inclusive), permanente em ≥768px (`md:` do Tailwind).
- Usuário em landscape de celular (~640×360): tela "deitada" mais baixa que larga — modais que dependem de altura podem não ter espaço suficiente. Comportamento esperado: scroll interno do modal (mesma solução do US2).
- Conteúdo de modal extremamente alto em mobile (ex.: "Limpar dados" com longa lista): footer com botões "Confirmar/Cancelar" precisa ficar sempre visível (sticky no fim do scroll interno) ou no topo do conteúdo.
- Tab bar com muitas abas em viewport mid (~640px): scroll horizontal precisa ter inércia/swipe natural em iOS, sem perder o indicador de aba ativa.
- Teclado virtual aberto sobre input dentro de modal mobile: viewport efetiva cai pela metade — modal precisa lidar com isso (ex.: fixed positioning + dvh em vez de vh quando suportado).
- Usuário rotaciona o dispositivo durante o uso: layout precisa reflowar sem perder estado (ex.: modal aberto continua aberto; drawer fechado continua fechado).
- Tabela com muitas colunas em mobile (ex.: financeiro com 7 colunas): scroll horizontal funciona mas dá impressão de "preso" — indicador de fade nas bordas da tabela mostra que tem mais conteúdo.

## Requirements *(mandatory)*

### Functional Requirements

#### Navegação principal (sidebar)

- **FR-001**: Em viewports ≥768px, a navegação principal (lista de categorias: Operação, Cadastros, Análise, Configurações) DEVE permanecer permanentemente visível à esquerda da tela, ocupando largura fixa, igual ao layout desktop atual.
- **FR-002**: Em viewports <768px, a navegação principal DEVE estar oculta por padrão e acessível através de um botão "abrir menu" (ícone hamburger) posicionado no header.
- **FR-003**: Quando aberta em viewports <768px, a navegação DEVE aparecer como overlay sobre o conteúdo (drawer/sheet), com fundo semi-transparente cobrindo o restante da tela.
- **FR-004**: O drawer DEVE oferecer três formas de fechamento: (1) tocar/clicar no ícone de fechar dentro dele, (2) tocar/clicar no fundo semi-transparente fora dele, (3) tecla Escape.
- **FR-005**: Ao clicar em qualquer link de navegação dentro do drawer, ele DEVE fechar automaticamente após a navegação.
- **FR-006**: A largura do drawer aberto em mobile DEVE ser no máximo 80% da viewport, garantindo que parte do conteúdo continue visível atrás do overlay.

#### Tab bar de navegação secundária (categorias)

- **FR-007**: A barra de abas que aparece abaixo do header (Pacientes/Atendimentos/Alertas etc.) DEVE permanecer dentro da largura da viewport sem cortar nenhuma aba, em qualquer viewport ≥360px.
- **FR-008**: Quando o conjunto de abas exceder a largura disponível, a barra DEVE scrollar horizontalmente com gesto de swipe e mouse-drag.
- **FR-009**: A aba ativa DEVE ser visualmente destacada e DEVE estar visível ao carregar a página (auto-scroll para trazê-la pra área visível se estiver fora).

#### Modais e diálogos

- **FR-010**: Todo modal/diálogo DEVE limitar sua altura máxima a 90% da altura da viewport, com scroll interno quando o conteúdo exceder esse limite.
- **FR-011**: Em viewports <640px, os modais DEVEM usar largura próxima a 100% da viewport (com pequena margem lateral), sem cantos arredondados forçados, e sem quebrar quando o teclado virtual abre sobre um input.
- **FR-012**: O background atrás de um modal aberto NÃO DEVE scrollar — apenas o conteúdo do modal scrolla.
- **FR-013**: Botões de ação primários do modal (Confirmar, Salvar) DEVEM permanecer acessíveis mesmo quando o conteúdo é mais alto que o viewport.

#### Padding e densidade de conteúdo

- **FR-014**: O padding lateral do conteúdo principal DEVE ser reduzido em viewports <768px para aproveitar melhor o espaço horizontal disponível.
- **FR-015**: O header do dashboard (faixa superior com título da seção) DEVE adaptar seu padding lateral aos breakpoints, mantendo legibilidade sem desperdiçar espaço em telas pequenas.

#### Tabelas

- **FR-016**: Tabelas que excedem a largura da viewport DEVEM continuar oferecendo scroll horizontal (já implementado).
- **FR-017**: Quando uma tabela tem scroll horizontal disponível, DEVE haver indicação visual clara de que existe mais conteúdo lateralmente — através de gradiente/sombra nas bordas, ou outro indicador visual perceptível.

#### Action bars (barras de ações)

- **FR-018**: Barras de ações secundárias na ficha do paciente (Voltar / Imprimir prontuário / Limpar dados, e similares) DEVEM se reorganizar em viewports estreitos: empilhar verticalmente, fazer wrap, ou outra estratégia que mantenha todos os botões acessíveis sem cortar.
- **FR-019**: O header de cards com título + botão de ação (ex.: "Pacientes" + "Novo paciente") DEVE manter ambos visíveis em qualquer viewport ≥360px, usando wrap ou empilhamento quando necessário.

#### Acessibilidade da navegação

- **FR-020**: O botão hamburger DEVE ter rótulo acessível ("Abrir menu" / "Open menu") e estado anunciado por leitores de tela (aberto/fechado).
- **FR-021**: Quando o drawer estiver aberto, o foco do teclado DEVE ser preso dentro dele até que seja fechado.

#### Compatibilidade e regressão

- **FR-022**: Todas as funcionalidades existentes em viewports ≥1024px DEVEM continuar funcionando exatamente como hoje — nenhuma regressão visual ou de fluxo no desktop.
- **FR-023**: O sistema DEVE funcionar em viewports de no mínimo 360px de largura sem quebra de layout, scroll horizontal indesejado, ou conteúdo cortado.

### Key Entities

(Esta feature é puramente de UI/UX — não introduz novas entidades de dados, tabelas, ou colunas.)

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Em viewport de 360×640px, é possível executar o fluxo completo "logar → cadastrar paciente → adicionar evolução SOAP → ver ficha do paciente" sem precisar zoom manual e sem nenhum elemento de UI sobreposto à navegação. Verificável por teste manual cronometrado: tarefa completável em ≤3 minutos sem ajuda.
- **SC-002**: Nenhum modal apresenta seu botão de ação primário ("Confirmar"/"Salvar") fora da viewport em qualquer tamanho de tela ≥360px, mesmo quando o conteúdo do modal é maior que a tela.
- **SC-003**: A barra de tabs do dashboard mostra a aba ativa centralizada ou visível em 100% das vezes ao carregar a página, em qualquer viewport ≥360px (sem necessidade de scroll manual antes do primeiro vista).
- **SC-004**: Em viewports ≥1024px, a aparência e o comportamento permanecem idênticos ao estado atual — comparação visual lado-a-lado antes/depois mostra zero diferenças em screenshots de páginas-chave (login, lista de pacientes, ficha do paciente, dashboard financeira).
- **SC-005**: Em viewport 360px, a sidebar fechada NÃO ocupa espaço horizontal — o conteúdo principal usa 100% da largura disponível.
- **SC-006**: Tabelas com scroll horizontal mostram indicador visual de "tem mais conteúdo" em ambos os lados que tenham conteúdo oculto (ex.: scroll posicionado no meio mostra indicação à esquerda E à direita).
- **SC-007**: Em qualquer viewport entre 360px e 1920px, NÃO existe scroll horizontal na página (apenas scroll vertical natural e scroll horizontal explícito dentro de tabelas/tabs).
- **SC-008**: O drawer abre e fecha em ≤300ms percebidos pelo usuário, com animação suave (slide-in/out).

## Assumptions

- O breakpoint de transição mobile/desktop é 768px — alinhado ao breakpoint `md:` do Tailwind já em uso por todo o projeto. Hamburger ativo em <768px; sidebar fixa em ≥768px.
- A largura mínima de viewport suportada é 360px (cobre virtualmente todos os celulares modernos, incluindo iPhone SE 1ª geração e Android entry-level).
- Tablets em portrait (768-1024px) usam o layout desktop com sidebar fixa — o usuário tem espaço suficiente. Tablets em landscape (>1024px) idem.
- Tabelas mantêm a estrutura atual (mesmas colunas, mesma ordem) — não viraremos cards em mobile. Só adicionamos indicador de scroll. Reflow para cards é fora de escopo.
- Forms já utilizam `grid-cols-1 md:grid-cols-2/N` corretamente (validado no diagnóstico) — não exigem retrabalho. Só revisão de casos pontuais (action bars).
- Modais existentes (~3) recebem `max-h` + `overflow-y-auto` na base do componente Dialog — propaga para todos automaticamente, sem necessidade de tocar em cada caller.
- Padding global do conteúdo principal muda de `p-8` fixo para `p-4 md:p-8` (ou similar) — efeito direto no `<DashboardShell>`, sem necessidade de tocar em pages individuais.
- O escopo NÃO inclui: gestos avançados (swipe-to-go-back, pull-to-refresh), bottom navigation bar, dark mode, nem mudança de tipografia para mobile.
- O escopo NÃO inclui: refazer telas em formato 100% mobile-first (ex.: list views virando cards). Mantemos os layouts existentes e adicionamos comportamento responsivo onde falta.
- Não há mudanças no banco de dados, em APIs, ou em RBAC — apenas componentes de UI e CSS.
