# Feature Specification: Sidebar enxuta + Configurações como hub

**Feature Branch**: `014-sidebar-config-hub`
**Created**: 2026-05-18
**Status**: Draft
**Input**: User description: "Reorganização da sidebar e configurações como hub centralizado. Notificações e alertas saem da sidebar e ficam apenas no sininho da topbar. Configurações vira um botão único que abre uma página hub (`/configuracoes`) com grid de cards para todas as opções (Clínica, Meu Perfil, Usuários, Procedimentos, Convênios, Profissionais, Modelos de Anamnese, Integrações, Auditoria). Cards filtrados por RBAC. Auditoria sai de Análise e entra como card. Pura UI — sem mudanças no backend/banco."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Sidebar simplificada para uso diário (Priority: P1)

Como qualquer usuário autenticado (admin, financeiro, recepcionista, profissional de saúde), ao abrir o dashboard quero ver uma navegação lateral curta e focada nas atividades operacionais — sem itens administrativos misturados às tarefas do dia. Hoje a sidebar tem três seções com até 15 itens; depois desta feature passa a ter no máximo 7 itens visíveis (Operação: Agenda, Pacientes, Tarefas; Análise: Relatórios, Comissões, Despesas; e um botão único de Configurações abaixo de um separador), com cada item filtrado por RBAC e feature-flag como já acontece hoje.

**Why this priority**: Esta é a mudança visual mais imediata e a base para as outras três histórias. Sem ela, a feature inteira fica sem efeito visível. Reduz carga cognitiva no uso diário e libera espaço para que a topbar (sininho) absorva notificações/alertas.

**Independent Test**: Pode ser totalmente verificada fazendo login com cada papel (admin, financeiro, recepcionista, profissional de saúde) e contando os itens visíveis na sidebar. Para um admin: exatamente 7 entradas (3 em Operação + 3 em Análise + 1 botão Configurações). Para os demais papéis: subconjunto correspondente ao RBAC vigente, sem itens fora dessas três seções. A reorganização não introduz funcionalidade nova — só remove/move itens — então o teste é puramente visual + RBAC.

**Acceptance Scenarios**:

1. **Given** um usuário admin autenticado, **When** ele abre qualquer página do dashboard, **Then** a sidebar mostra somente: seção "Operação" com Agenda, Pacientes, Tarefas; seção "Análise" com Relatórios, Comissões, Despesas; um separador visual; e um único item "Configurações" no rodapé das seções de navegação.
2. **Given** um usuário recepcionista autenticado, **When** ele abre o dashboard, **Then** a sidebar mostra apenas os itens de Operação para os quais tem permissão (no mínimo Agenda e Pacientes) e o item Configurações (que ao clicar leva ao hub filtrado para seu papel) — nenhum item de Análise aparece se ele não tem permissão sobre relatórios/comissões/despesas.
3. **Given** qualquer usuário autenticado, **When** ele inspeciona a sidebar, **Then** não existem mais os itens "Notificações", "Alertas do sistema", "Pendências (DLQ)" nem "Auditoria" listados na navegação lateral — todos foram movidos (notificações/alertas para o sininho, auditoria para o hub de configurações; pendências também consolidadas no sininho, ver US2).
4. **Given** um usuário com >1 tenant ativo, **When** ele abre a sidebar, **Then** o atalho "Trocar clínica" permanece visível abaixo do nome da clínica (não foi afetado pela reorganização).

---

### User Story 2 - Notificações e alertas concentrados no sininho (Priority: P1)

Como qualquer usuário autenticado, quero acessar minhas notificações pessoais e os alertas do sistema (quando tenho permissão) a partir de um único ponto: o sininho na topbar. Hoje preciso lembrar de dois itens na sidebar; depois desta feature o sininho passa a ser a porta única, e a página `/operacao/notificacoes` exibe ambas as informações (notificações pessoais como visão principal e alertas do sistema como sub-seção, visível apenas para quem tem `alert.read`).

**Why this priority**: Empata em prioridade com US1 porque a remoção de itens da sidebar (US1) deixaria notificações/alertas inacessíveis se a página unificada não estivesse no ar. As duas precisam entrar juntas para o usuário não perder acesso.

**Independent Test**: Clicar no sininho da topbar e verificar que (a) abre `/operacao/notificacoes`; (b) a página mostra notificações pessoais como conteúdo principal; (c) se o usuário tem `alert.read`, há uma sub-seção "Alertas do sistema" (ou aba/área dedicada) na mesma página, exibindo o mesmo conteúdo que hoje aparece em `/operacao/alertas`; (d) navegando direto para `/operacao/alertas` o usuário é levado à mesma página unificada (sem 404, sem perda de contexto).

**Acceptance Scenarios**:

1. **Given** qualquer usuário autenticado, **When** ele clica no ícone de sininho na topbar, **Then** é redirecionado para `/operacao/notificacoes` e vê suas notificações pessoais como conteúdo principal.
2. **Given** um usuário com permissão `alert.read`, **When** ele está em `/operacao/notificacoes`, **Then** vê uma sub-seção/aba claramente rotulada "Alertas do sistema" com o mesmo conteúdo (lista, filtros, ações) que hoje existe em `/operacao/alertas`.
3. **Given** um usuário **sem** `alert.read`, **When** ele abre `/operacao/notificacoes`, **Then** vê apenas suas notificações pessoais (a sub-seção de alertas do sistema não aparece, nem como aba vazia).
4. **Given** qualquer usuário com a URL antiga `/operacao/alertas` em um bookmark ou link interno, **When** ele acessa essa rota, **Then** continua chegando à área de alertas (seja por redirect para `/operacao/notificacoes?tab=alertas` ou similar) sem 404 e sem perda das ações que executava antes (marcar como lido, etc.).
5. **Given** um administrador com acesso a "Pendências" (`dlq.read`), **When** ele olha a sidebar, **Then** não vê mais o item "Pendências" na navegação lateral — ele acessa essa fila como uma terceira sub-seção/aba dentro de `/operacao/notificacoes` (ao lado de notificações pessoais e alertas do sistema), visível apenas para quem tem `dlq.read`.
6. **Given** um usuário com a URL antiga `/operacao/dlq` em bookmark, **When** ele acessa essa rota, **Then** continua chegando à fila DLQ via redirect para `/operacao/notificacoes?tab=dlq` (ou equivalente), sem 404 e sem perda das ações.

---

### User Story 3 - Hub de configurações com cards (Priority: P2)

Como usuário (com perfil variando), ao clicar no botão único "Configurações" da sidebar quero abrir uma página `/configuracoes` que apresenta um grid de cards — um card por área (Clínica, Meu Perfil, Usuários, Procedimentos, Convênios, Profissionais, Modelos de Anamnese, Integrações, Auditoria). Cada card tem ícone, título e uma descrição curta (uma linha) explicando o que faço lá. Vejo apenas os cards das áreas para as quais tenho permissão; o card "Auditoria" aparece por último porque é o mais técnico/administrativo.

**Why this priority**: Depende de US1 (que cria o botão único) e é a entrega de valor mais densa, mas pode ser feita logo após US1+US2 e antes do polimento final.

**Independent Test**: Fazer login com cada papel e abrir `/configuracoes`. Para admin: ver os 9 cards listados na ordem (Clínica, Meu Perfil, Usuários, Procedimentos, Convênios, Profissionais, Modelos de Anamnese, Integrações, Auditoria — Auditoria sempre por último). Para outros papéis: ver apenas o subconjunto permitido pelo RBAC atual (no mínimo "Meu Perfil" para qualquer autenticado). Clicar em cada card e verificar que leva à mesma página que hoje (mesma rota, mesma funcionalidade — só a porta de entrada mudou).

**Acceptance Scenarios**:

1. **Given** um usuário admin autenticado, **When** ele clica em "Configurações" na sidebar, **Then** abre `/configuracoes` (sem mais redirect automático para `/configuracoes/clinica`) com um grid de 9 cards: Clínica, Meu Perfil, Usuários, Procedimentos, Convênios, Profissionais, Modelos de Anamnese, Integrações, Auditoria — nessa ordem, Auditoria por último.
2. **Given** o admin no hub, **When** ele clica no card "Clínica", **Then** navega para `/configuracoes/clinica` e encontra a mesma página/funcionalidade que existe hoje (nenhuma feature removida ou alterada).
3. **Given** um usuário recepcionista autenticado, **When** ele clica em "Configurações" e abre `/configuracoes`, **Then** vê apenas os cards aos quais tem acesso pelo RBAC vigente — no mínimo "Meu Perfil"; cards de áreas restritas a admin (Clínica, Usuários, Integrações, Modelos de Anamnese, Auditoria) não aparecem.
4. **Given** o admin no hub, **When** ele clica no card "Auditoria", **Then** navega para `/configuracoes/auditoria` (ou a rota canônica adotada — ver FR-008) e encontra a mesma página de auditoria que hoje vive em `/analise/auditoria`.
5. **Given** qualquer usuário, **When** ele encontra um card no grid, **Then** o card mostra ícone visível, título e uma descrição curta de uma linha (ex.: "Dados, logo e identidade visual da clínica" para Clínica), suficiente para entender para onde o card leva sem clicar.

---

### User Story 4 - Rotas legadas continuam funcionando (Priority: P3)

Como usuário com bookmarks antigos, links internos ou histórico de navegador, quero que todas as URLs anteriores continuem levando ao destino certo. Em particular `/analise/auditoria` deve continuar abrindo a auditoria (via redirect para a nova rota dentro do hub, ou mantendo a antiga como alias) e `/operacao/alertas` deve continuar acessível (US2 já cobre).

**Why this priority**: P3 porque é uma rede de segurança — sem isso, a feature ainda funciona para quem navega pela sidebar, mas usuários com bookmarks ou links em e-mails antigos veriam 404. Importante para a transição limpa, mas não é o que entrega o valor principal.

**Independent Test**: Acessar diretamente as URLs `/analise/auditoria`, `/operacao/alertas` (e a antiga rota de DLQ se aplicável, ver clarification em US2) e confirmar que cada uma leva ao destino esperado (com ou sem redirect) sem 404 e sem perda das query strings/filtros que o usuário tinha.

**Acceptance Scenarios**:

1. **Given** um usuário com permissão `audit.read`, **When** ele acessa `/analise/auditoria` diretamente, **Then** chega à página de auditoria (redirecionada para a nova rota canônica dentro do hub, mantendo qualquer query string).
2. **Given** um usuário com permissão `alert.read`, **When** ele acessa `/operacao/alertas` diretamente, **Then** chega à página unificada de notificações na aba/sub-seção de alertas, sem 404.
3. **Given** um usuário **sem** permissão para uma rota legada, **When** ele acessa essa rota diretamente, **Then** vê o mesmo comportamento de negação de hoje (não é o redirect que cria um vazamento de acesso).

---

### Edge Cases

- Usuário com permissões mínimas (apenas `appointment.read` e `task.read`, ex.: profissional de saúde): a sidebar mostra Operação (Agenda, Pacientes, Tarefas) e o botão Configurações; o hub `/configuracoes` deve mostrar pelo menos "Meu Perfil" — nunca aparecer vazio.
- Feature-flag desligado (ex.: `comissoes=false`): o item correspondente some da sidebar — comportamento idêntico ao de hoje, a reorganização não muda essa lógica.
- Acesso em viewport mobile (<md): o drawer lateral exibe a mesma estrutura simplificada; o sininho na topbar continua acessível; o grid de cards do hub colapsa para 1 coluna em viewports <md, 2 colunas em md e 3 colunas em lg+ (default adotado, consistente com o estilo de grids já usados no dashboard).
- Usuário acessa `/operacao/notificacoes?tab=alertas` mas não tem `alert.read`: a página deve cair silenciosamente na aba de notificações pessoais (ignorar o query param), nunca exibir um estado de "acesso negado" dentro da própria página.
- Estado de "carregando" no hub: enquanto a página resolve quais cards mostrar, deve evitar flash de cards proibidos (renderização server-side com o role já resolvido, como o restante do dashboard).

## Requirements *(mandatory)*

### Functional Requirements

**Sidebar simplificada**

- **FR-001**: A sidebar (desktop ≥md e drawer mobile) MUST exibir somente três áreas de navegação, nesta ordem: seção "Operação" (com Agenda, Pacientes, Tarefas), seção "Análise" (com Relatórios, Comissões, Despesas) e um item único "Configurações" precedido de separador visual.
- **FR-002**: A sidebar MUST remover totalmente os itens "Notificações", "Alertas do sistema" e "Auditoria" da navegação lateral — não há mais nenhum link direto para essas áreas no menu principal.
- **FR-003**: A filtragem por RBAC e por feature-flags existente em cada item MUST ser preservada — itens cujo predicado de visibilidade retorna falso continuam sumindo, e seções sem itens visíveis continuam escondidas (comportamento atual de `dashboard-shell.tsx`).
- **FR-004**: O item "Configurações" na sidebar MUST aparecer para qualquer usuário autenticado (visível para todos os roles, pois sempre haverá ao menos "Meu Perfil" dentro do hub).

**Sininho / notificações unificadas**

- **FR-005**: O sininho da topbar (`NotificationBell`) MUST, ao clique, navegar para `/operacao/notificacoes`.
- **FR-006**: A página `/operacao/notificacoes` MUST apresentar as notificações pessoais do usuário como conteúdo principal e, condicionalmente, incluir sub-seções (abas, accordion, ou divisão equivalente) rotuladas — uma "Alertas do sistema" visível para quem tem `alert.read` (mesmo conteúdo de `/operacao/alertas` hoje) e outra "Pendências" visível para quem tem `dlq.read` (mesmo conteúdo de `/operacao/dlq` hoje). Quem não tem nenhuma das duas permissões vê apenas a aba de notificações pessoais.
- **FR-007**: As rotas legadas `/operacao/alertas` e `/operacao/dlq` MUST continuar acessíveis e levar à página unificada (via redirect para a sub-seção/aba correspondente, ex.: `/operacao/notificacoes?tab=alertas` e `/operacao/notificacoes?tab=dlq`) — usuários sem a permissão correspondente recebem o mesmo tratamento de negação que hoje.

**Hub de configurações**

- **FR-008**: A rota `/configuracoes` MUST renderizar uma página hub com grid de cards (substituindo o redirect automático atual para `/configuracoes/clinica` ou `/configuracoes/perfil`). Cada card MUST conter ícone, título e descrição curta de uma linha.
- **FR-009**: O hub MUST exibir os seguintes cards na ordem fixada (admin enxerga todos): 1. Clínica, 2. Meu Perfil, 3. Usuários, 4. Procedimentos, 5. Convênios, 6. Profissionais, 7. Modelos de Anamnese, 8. Integrações, 9. Auditoria. Auditoria SEMPRE figura como o último card visível.
- **FR-010**: A visibilidade de cada card MUST seguir o mesmo predicado RBAC + feature-flag aplicado hoje ao item correspondente da sidebar (ex.: "Clínica" e "Usuários" só para admin; "Procedimentos" para quem tem `procedure.read`; "Modelos de Anamnese" para admin + flag `anamnese`).
- **FR-011**: O card "Auditoria" MUST ser visível somente para usuários com `audit.read`, preservando a mesma regra de hoje (atualmente aplicada ao item da seção Análise).
- **FR-012**: Cada card, ao clique, MUST navegar para a rota correspondente: Clínica → `/configuracoes/clinica`; Meu Perfil → `/configuracoes/perfil`; Usuários → `/configuracoes/usuarios`; Procedimentos → `/configuracoes/procedimentos`; Convênios → `/configuracoes/convenios`; Profissionais → `/configuracoes/profissionais`; Modelos de Anamnese → `/configuracoes/modelos-anamnese`; Integrações → `/configuracoes/integracoes`; Auditoria → rota canônica do hub (ver FR-013).

**Auditoria fora de Análise**

- **FR-013**: A auditoria MUST ter como rota canônica `/configuracoes/auditoria` — o código atual de `/analise/auditoria` é movido para essa nova rota. A antiga URL `/analise/auditoria` MUST continuar respondendo via redirect permanente (HTTP 308) para `/configuracoes/auditoria`, preservando query strings de filtro.
- **FR-014**: O item "Auditoria" MUST sumir da seção Análise da sidebar (não aparece para nenhum role, mesmo admin).

**Comportamento preservado / rede de segurança**

- **FR-015**: Nenhuma funcionalidade existente em qualquer subpágina de Configurações, Notificações, Alertas, Auditoria ou DLQ MUST ser removida ou alterada — esta feature é puramente uma reorganização de navegação e adição da página hub.
- **FR-016**: Mudanças nesta feature MUST ser puramente UI (componentes de layout/navegação + páginas Next.js) — sem alterações em migrations, schemas de banco, RLS, route handlers de API, ou contratos de domain events.
- **FR-017**: A página hub `/configuracoes` MUST renderizar do lado servidor com o role do usuário já resolvido (consistente com o padrão SSR do dashboard), evitando flash de cards proibidos enquanto carrega.

### Key Entities

Esta feature é puramente de UI/navegação e não introduz, altera ou remove entidades de domínio. As entidades visíveis ao usuário (notificações, alertas, registros de auditoria, dados da clínica, usuários, procedimentos, convênios, profissionais, modelos de anamnese, integrações) continuam idênticas às já existentes nas features 007, 008, 009, 011 e 012.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Um administrador autenticado, ao abrir o dashboard, vê **no máximo 7 itens** na sidebar (3 Operação + 3 Análise + 1 Configurações) — redução de pelo menos 50% em relação ao total atual (~14 itens visíveis para admin com todas as flags ligadas).
- **SC-002**: 100% das URLs anteriormente acessíveis pela sidebar (rotas listadas em `dashboard-shell.tsx` antes desta feature) continuam respondendo sem 404 — verificável por uma navegação automatizada ou checklist manual cobrindo cada rota.
- **SC-003**: Um administrador consegue chegar a qualquer área de Configurações em **no máximo 2 cliques** a partir de qualquer página do dashboard (clique no botão "Configurações" da sidebar → clique no card desejado) — mesmo número de cliques de hoje, sem regressão de produtividade.
- **SC-004**: Usuários não-admin (recepcionista, financeiro, profissional de saúde) veem apenas os cards do hub para os quais têm permissão, e nunca veem a sidebar com itens proibidos — verificável por matriz de testes role × área (sem nenhuma célula "vê" para combinação proibida).
- **SC-005**: A página `/configuracoes` carrega e é interativa em tempo equivalente ao das demais páginas SSR do dashboard (mesma faixa de TTFB / FCP — sem regressão perceptível por A/B visual), considerando que o hub é apenas um grid estático server-rendered.

## Assumptions

- **A1** — Os pontos de entrada únicos para áreas movidas (sininho da topbar para notificações/alertas; botão Configurações para hub) já existem ou são fáceis de adicionar; em particular, o componente `NotificationBell` em `src/app/(dashboard)/_components/notification-bell.tsx` já é o local certo para fazer o clique levar a `/operacao/notificacoes`.
- **A2** — A página `/operacao/notificacoes` já existe (referenciada pela sidebar atual) — a feature apenas a estende para absorver "Alertas do sistema" como sub-seção quando o usuário tem `alert.read`. Se houver detalhes de design (aba, accordion, separador) eles ficam para o plano de implementação.
- **A3** — As permissões usadas hoje (`appointment.read`, `task.read`, `report.read`, `doctor.read`, `procedure.read`, `plan.read`, `audit.read`, `alert.read`, `dlq.read`, role `admin`) e as feature-flags (`relatorios`, `comissoes`, `despesas`, `anamnese`) continuam sendo a fonte da verdade. Esta feature não cria nem remove permissões nem flags.
- **A4** — Rota canônica para auditoria pós-feature é `/configuracoes/auditoria` (decisão Q2/A): o código atual de `/analise/auditoria` é movido para a nova rota e a URL antiga vira redirect 308.
- **A5** — Grid responsivo do hub: 1 coluna em viewports <md, 2 colunas em md, 3 colunas em lg+ (default adotado, consistente com grids existentes no dashboard).
- **A6** — "Pendências" (`/operacao/dlq`) é tratado como Alertas (decisão Q1/A): absorvido como terceira sub-seção/aba dentro de `/operacao/notificacoes`, visível só para quem tem `dlq.read`. A rota legada `/operacao/dlq` vira redirect para a aba correspondente.
- **A7** — A entrega é dividida nas user stories acima (P1: US1+US2; P2: US3; P3: US4) e cada uma é independentemente entregável e testável, mantendo o dashboard sempre funcional entre as fases.
