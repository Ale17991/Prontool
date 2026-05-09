# Feature Specification: Multi-Tenant Lifecycle, GHL 1:1 Binding e Filtros do Calendário

**Feature Branch**: `010-multi-tenant-ghl-calendar`
**Created**: 2026-05-08
**Status**: Draft
**Input**: User description: "Seletor de clínica, onboarding, signup, nome da clínica na sidebar, integração GHL 1:1 e filtros avançados no calendário."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Vínculo 1:1 entre clínica e sub-account GHL (Priority: P1)

Hoje, em tese, duas clínicas distintas no Prontool poderiam acabar conectadas à mesma sub-account do GoHighLevel — basta um admin colar o `location_id` de outra clínica no fluxo de OAuth, ou rodar dois marketplace installs em sequência. Isso corromperia o fluxo de eventos: webhooks da sub-account passariam a alimentar dois prontuários diferentes; tokens de uma clínica seriam sobrescritos pelos de outra; relatórios financeiros misturariam dados que nunca poderiam se misturar. A regra de negócio deste sistema é simples e inegociável: **uma clínica do Prontool corresponde a no máximo uma sub-account do GHL, e vice-versa**.

**Why this priority**: É um problema de **integridade de dados**, não de UX. Sem essa garantia, a primeira ocorrência em produção pode misturar dados clínicos e financeiros entre clínicas diferentes — incidente de LGPD e contabilidade ao mesmo tempo. Tem que ser P1 e tem que ir antes de qualquer expansão do funil de cadastro (US2/US3) que aumentaria o número de tenants vivos.

**Independent Test**: pode ser totalmente validado sem nenhuma das outras stories — basta um tenant já existente, conectar via OAuth a uma sub-account, depois tentar conectar uma SEGUNDA clínica do Prontool à MESMA sub-account; o sistema deve recusar a segunda tentativa com mensagem clara.

**Acceptance Scenarios**:

1. **Given** uma clínica A do Prontool ainda sem integração ativa, **When** a admin de A inicia o fluxo OAuth e seleciona uma sub-account GHL X, **Then** a conexão é registrada e o `location_id` de X passa a estar vinculado a A.
2. **Given** uma clínica A já conectada à sub-account X, **When** a admin de A tenta iniciar uma nova conexão (a outra sub-account ou à mesma), **Then** o sistema rejeita com mensagem clara: "Esta clínica já está conectada a outra conta GoHighLevel. Desconecte primeiro."
3. **Given** uma sub-account X já vinculada à clínica A, **When** a admin de uma clínica B tenta conectar a sub-account X, **Then** o sistema rejeita com mensagem clara: "Esta conta GoHighLevel já está vinculada a outra clínica no Prontool."
4. **Given** uma instalação via Marketplace que cria uma clínica C automaticamente vinculada à sub-account Y, **When** alguém depois tenta conectar Y a uma clínica diferente, **Then** o sistema rejeita pelo mesmo motivo do cenário 3.
5. **Given** uma clínica A conectada à sub-account X, **When** a admin de A clica "Desconectar" e confirma, **Then** ambos os lados ficam livres — A pode conectar-se a outra sub-account e X pode ser conectada a outra clínica; nenhum dado existente é apagado (Princípio I — append-only).
6. **Given** uma instalação via Marketplace que tenta criar uma clínica para uma sub-account Y já vinculada a outra clínica B, **When** o webhook de install chega, **Then** o sistema responde com erro de conflito ao GHL (sem criar tenant duplicado e sem alterar a vinculação existente de B com Y).
7. **Given** qualquer admin abrindo a página de integração GHL, **When** a página renderiza, **Then** quando conectada exibe "Conta: <nome da sub-account> · ID: <location_id> · Conectada em <data>"; quando desconectada exibe o botão "Conectar ao GoHighLevel" com aviso "Cada clínica pode ser conectada a apenas uma conta GoHighLevel."

---

### User Story 2 - Cadastro próprio + onboarding da primeira clínica (Priority: P2)

Hoje só entra no Prontool quem é convidado por um admin existente. Isso fecha a porta para qualquer aquisição orgânica — médicos que querem testar o produto, clínicas pequenas que estão pesquisando, leads que vêm da landing page. O caminho que precisa existir: a pessoa cria sua conta sozinha, é guiada a criar a primeira clínica, e cai direto no produto vazio pronto para usar.

**Why this priority**: É a porta de entrada nova. Sem isso, a base de usuários só cresce por convite, o que limita a velocidade de adoção. Vem depois do P1 porque qualquer fluxo que cria tenants precisa que a regra GHL 1:1 já esteja firme.

**Independent Test**: pode ser validada ponta a ponta criando uma conta nova com um e-mail nunca visto, percorrendo signup → onboarding → criação da clínica → primeira tela do dashboard com a clínica recém-criada visível na sidebar.

**Acceptance Scenarios**:

1. **Given** alguém na tela de login, **When** clica em "Não tem conta? Criar conta", **Then** chega à página de cadastro com campos nome completo, e-mail, senha, confirmar senha.
2. **Given** o formulário de cadastro preenchido com dados válidos (e-mail novo, senha forte, confirmação igual), **When** confirma, **Then** o sistema cria a conta de autenticação, autentica imediatamente, e leva ao **onboarding**.
3. **Given** uma pessoa autenticada no onboarding sem nenhuma clínica vinculada, **When** preenche "Nome da clínica" (obrigatório), CNPJ (opcional), telefone (opcional), e o slug auto-gerado (editável), **Then** ao salvar, o sistema cria uma nova clínica vinculada à pessoa como administradora e a leva ao dashboard com a nova clínica ativa.
4. **Given** alguém no onboarding que prefere esperar um convite, **When** lê o texto "Ou peça ao administrador de uma clínica existente para te convidar", **Then** entende que a alternativa existe e pode sair do fluxo.
5. **Given** um cadastro tentando usar um e-mail já existente, **When** o sistema rejeita, **Then** mostra mensagem clara — sem revelar se a conta existe sob outro estado e sem expor mais que o necessário.
6. **Given** uma pessoa já autenticada que ainda não passou pelo onboarding, **When** acessa qualquer rota interna do produto (ex.: `/operacao/atendimentos`), **Then** o sistema redireciona para `/onboarding` em vez de servir uma tela vazia ou 401.
7. **Given** um slug auto-gerado que colide com um slug existente, **When** a pessoa tenta salvar, **Then** o sistema rejeita com mensagem clara e sugere uma variação (ex.: acrescenta sufixo numérico).

---

### User Story 3 - Seletor de clínica + troca de clínica sem deslogar + nome na sidebar (Priority: P3)

Profissionais que atendem em mais de uma clínica (ex.: o dentista que cobre dois consultórios; o admin do grupo que gerencia três unidades) hoje precisam deslogar e relogar para trocar de clínica. Essa fricção é cara e leva a erros (lançar atendimento na clínica errada). Além disso, depois de logado, é fácil esquecer em qual clínica está atuando — a sidebar não mostra explicitamente o nome.

**Why this priority**: aumenta a produtividade de quem opera em múltiplas clínicas e reduz incidentes operacionais (atendimento criado na clínica errada). Não é bloqueador — quem só tem uma clínica nem percebe — mas para os que têm é um ganho significativo.

**Independent Test**: pode ser validada com qualquer usuário vinculado a duas clínicas — após login, vê o seletor; escolhe uma; entra no dashboard; clica "Trocar clínica" no rodapé da sidebar; volta ao seletor; escolhe a outra; entra no dashboard da segunda clínica sem ter deslogado.

**Acceptance Scenarios**:

1. **Given** um usuário vinculado a UMA única clínica ativa, **When** faz login, **Then** vai direto para o dashboard daquela clínica (sem ver o seletor).
2. **Given** um usuário vinculado a DUAS ou mais clínicas ativas, **When** faz login, **Then** vê uma tela de seleção com um card por clínica mostrando: nome, logo (quando houver), papel do usuário naquela clínica e — quando aplicável — um selo "GHL conectado".
3. **Given** o seletor de clínica aberto, **When** o usuário clica num card, **Then** o sistema marca aquela clínica como ativa para a sessão (persistindo entre páginas até o próximo login ou troca explícita) e leva ao dashboard.
4. **Given** o usuário com clínica ativa, **When** olha a sidebar, **Then** vê no topo o nome dessa clínica em destaque (com logo ao lado se houver), e no rodapé um botão "Trocar clínica" ao lado do bloco de e-mail/avatar.
5. **Given** o usuário no dashboard de uma clínica, **When** clica "Trocar clínica", **Then** volta ao seletor; ao escolher outra clínica, entra direto no dashboard dela sem precisar reautenticar.
6. **Given** o usuário relogando depois de já ter usado uma clínica X, **When** ele tem múltiplas clínicas, **Then** o seletor pré-marca/destaca X (a última usada).
7. **Given** o usuário tem o vínculo com a clínica Y desativado entre uma sessão e outra, **When** volta ao Prontool, **Then** Y não aparece no seletor; se Y era a clínica ativa, o sistema escolhe automaticamente outra ativa, ou — se for a única — leva ao onboarding.
8. **Given** o admin altera "Nome da clínica" em Configurações > Clínica, **When** salva, **Then** o novo nome aparece imediatamente na sidebar de todos os usuários online dessa clínica (próxima navegação) e no header dos PDFs gerados a partir dali.

---

### User Story 4 - Filtros avançados e visualização do calendário de atendimentos (Priority: P4)

A agenda é a tela de uso mais intenso do dia a dia. Hoje o calendário oferece visualização Dia e Semana, com filtro só por profissional. Quem precisa de uma visão diferente (Mês inteiro, "todas as primeiras consultas do CRM Dr. Y desta quinzena", "atendimentos de uma paciente específica neste trimestre") esbarra em UI e tem que exportar relatórios — ineficiente. Esta story traz: seletor de período visual no próprio calendário, mini-calendário de navegação rápida, filtros combinados (status, procedimento, paciente, período), Mês como visualização de 1ª classe, e persistência dos filtros na URL para compartilhar visões.

**Why this priority**: ganho de produtividade alto para a equipe operacional (recepção, profissionais), mas não bloqueia ninguém — é um upgrade de UX. Vai por último entre as stories funcionais.

**Independent Test**: pode ser validada na agenda existente com qualquer tenant que tenha 5+ atendimentos espalhados em datas diferentes — testar mini-calendário, seleção de período, alternância Dia/Semana/Mês, filtros combinados e compartilhamento via URL.

**Acceptance Scenarios**:

1. **Given** o usuário em `/operacao/atendimentos`, **When** visualiza o cabeçalho do calendário, **Then** vê um mini-calendário mensal ao lado das setas de navegação; dias com atendimentos mostram um indicador visual (ponto/destaque); clicar em um dia move o calendário principal para aquela data.
2. **Given** o calendário aberto, **When** o usuário clica em uma data dentro da grade, **Then** essa data fica selecionada; clicando em uma segunda data, forma-se um intervalo (início → fim) com fundo destacado nos dias intermediários.
3. **Given** a barra de filtros, **When** o usuário escolhe um dos atalhos "Hoje", "Esta semana", "Este mês", "Próxima semana" ou "Próximo mês", **Then** o calendário e a lista filtram para o período correspondente; a URL atualiza com os parâmetros do período.
4. **Given** o seletor de visualização Dia | Semana | Mês, **When** o usuário escolhe **Mês**, **Then** o calendário renderiza um grid de 5–6 semanas; cada dia mostra até 3 atendimentos resumidos; quando há mais, um chip "+N mais" leva à lista do dia.
5. **Given** os filtros disponíveis (Profissional, Status, Procedimento, Paciente, Período), **When** o usuário combina dois ou mais, **Then** a contagem de atendimentos exibida bate com o resultado da combinação e a URL reflete todos os filtros ativos.
6. **Given** uma URL com filtros codificados copiada por outro usuário, **When** alguém com permissão abre essa URL, **Then** vê o calendário com a mesma combinação de filtros aplicada.
7. **Given** filtros aplicados na visualização **Calendário**, **When** o usuário alterna para **Lista**, **Then** os mesmos filtros continuam ativos.
8. **Given** o usuário em qualquer visualização do calendário, **When** limpa os filtros via botão "Limpar", **Then** o calendário volta ao default (semana corrente, sem filtros, sem profissional pré-selecionado), e a URL é normalizada (sem query string de filtros).

---

### Edge Cases

- **Conta de e-mail já existente no signup**: o sistema rejeita com mensagem genérica de "não foi possível criar a conta" para não revelar a existência.
- **Onboarding com nome da clínica idêntico a outro existente**: permitido — diferenciação por slug (que é único e auto-gerado/editável).
- **Slug auto-gerado já em uso**: sistema sugere variação numérica (ex.: `clinica-x-2`); usuário pode editar para algo único.
- **Usuário fecha o navegador no meio do onboarding**: ao reabrir e logar, o sistema o reconduz a `/onboarding` (não tem clínica vinculada ainda).
- **Cookie de "última clínica" aponta para uma clínica desativada**: sistema ignora o cookie, escolhe outra clínica ativa do usuário ou abre o seletor; nunca mostra a desativada.
- **Único admin de uma clínica tenta sair (deactivate self)**: bloqueado pela regra existente de feature 009 (última admin ativa).
- **Conexão GHL via Marketplace install para uma sub-account já vinculada**: webhook responde com erro de conflito sem alterar nada.
- **Conexão OAuth iniciada por um admin de A na sub-account X já vinculada a B**: callback rejeita antes de salvar, audit registra a tentativa, e o admin de A vê mensagem clara.
- **GHL desconectado por um lado e reconectado por outro lado dentro da mesma sessão**: aceito — a relação é checada no momento do connect, não congelada por "data anterior".
- **Calendário com URL contendo filtros inválidos** (ex.: `status=foo`): o sistema ignora silenciosamente o filtro inválido e remove-o da URL na próxima navegação.
- **Mini-calendário em meses sem atendimentos**: sem indicadores; permanece navegável.
- **Mês com 6 semanas (caso comum)**: render mostra 6 linhas; sem corte das últimas datas.
- **Usuário troca de clínica enquanto tem um modal/diálogo aberto**: o modal fecha; estado da página anterior é descartado (a sessão de operação pertence à clínica antiga).
- **Marketplace install para uma conta que ainda não tem nenhum admin do Prontool conhecido**: a clínica é criada e o usuário GHL que iniciou o install é provisionado como admin (auto-provisioning, comportamento já existente da feature 008).

## Requirements *(mandatory)*

### Functional Requirements

#### US1 — GHL 1:1 binding

- **FR-001**: O sistema **MUST** garantir que uma clínica tenha no máximo uma conexão ativa com o GoHighLevel a qualquer momento.
- **FR-002**: O sistema **MUST** garantir que uma sub-account GHL (identificada por seu `location_id`) esteja vinculada a no máximo uma clínica do Prontool a qualquer momento.
- **FR-003**: Toda tentativa de conexão (OAuth manual, refresh, Marketplace install) que viole FR-001 ou FR-002 **MUST** ser rejeitada antes de qualquer escrita parcial; nenhuma linha em integrações é criada e nenhum token é armazenado.
- **FR-004**: A rejeição **MUST** retornar mensagens distintas e auditáveis: para violação de FR-001, "Esta clínica já está conectada a outra conta GoHighLevel. Desconecte primeiro."; para violação de FR-002, "Esta conta GoHighLevel já está vinculada a outra clínica no Prontool."
- **FR-005**: Ao desconectar uma clínica do GHL, ambos os lados (clínica e sub-account) **MUST** ficar livres para novas conexões; nenhum dado histórico já registrado é apagado.
- **FR-006**: A página de configuração da integração GHL **MUST**, quando conectada, exibir nome da sub-account, `location_id` e a data da conexão; quando desconectada, exibir o botão "Conectar ao GoHighLevel" e o aviso "Cada clínica pode ser conectada a apenas uma conta GoHighLevel."
- **FR-007**: O webhook de install do Marketplace, ao tentar criar/conectar uma clínica para uma sub-account já vinculada, **MUST** responder com erro de conflito sem criar nova clínica e sem alterar a vinculação existente.
- **FR-008**: Cada tentativa rejeitada por FR-003 **MUST** gerar uma entrada de auditoria (Princípio II) identificando o ator, o tenant alvo, o `location_id` envolvido e a violação específica (FR-001 ou FR-002).

#### US2 — Signup + Onboarding

- **FR-009**: O sistema **MUST** oferecer uma página pública de cadastro de conta acessível via link "Não tem conta? Criar conta" na página de login.
- **FR-010**: O cadastro **MUST** exigir nome completo, e-mail, senha e confirmação de senha; a senha **MUST** atender à política mínima de segurança da plataforma (≥ 8 caracteres com letra e número).
- **FR-011**: A criação de conta com e-mail já existente **MUST** ser rejeitada com mensagem genérica que não revele a existência prévia da conta.
- **FR-012**: Imediatamente após o cadastro bem-sucedido, o sistema **MUST** autenticar a pessoa e redirecioná-la para o onboarding sem etapa intermediária de "verifique seu e-mail" bloqueante (verificação de e-mail é assíncrona).
- **FR-013**: O onboarding **MUST** apresentar o formulário "Criar minha clínica" com os campos: nome da clínica (obrigatório), CNPJ (opcional), telefone (opcional), slug (auto-gerado, editável); e o texto orientador "Ou peça ao administrador de uma clínica existente para te convidar".
- **FR-014**: Ao salvar o onboarding com sucesso, o sistema **MUST**, em uma única operação atômica, criar a clínica, vincular a pessoa como administradora ativa, e ativar essa clínica como a clínica ativa da sessão.
- **FR-015**: O sistema **MUST** garantir que slugs sejam únicos entre todas as clínicas; ao detectar colisão, oferecer uma sugestão imediata e clara.
- **FR-016**: Qualquer usuário autenticado sem nenhuma clínica ativa vinculada **MUST** ser redirecionado para `/onboarding` ao tentar acessar qualquer rota interna do produto (exceto rotas de cadastro/onboarding em si).
- **FR-017**: O processo de signup **MUST** registrar em auditoria (Princípio II) a criação de conta e a criação de clínica, com data/hora e e-mail do solicitante.

#### US3 — Tenant selector + switch + sidebar

- **FR-018**: Após login, o sistema **MUST**, para usuários com **uma única** clínica ativa vinculada, ir direto ao dashboard dessa clínica.
- **FR-019**: Para usuários com **duas ou mais** clínicas ativas vinculadas, o sistema **MUST** apresentar a página `/selecionar-clinica` com um card por clínica exibindo: nome, logo (se houver), papel do usuário naquela clínica, e — quando aplicável — um selo "GHL conectado".
- **FR-020**: Ao escolher uma clínica no seletor, o sistema **MUST** marcar aquela clínica como ativa para a sessão; essa escolha **MUST** persistir entre páginas até o próximo login ou troca explícita.
- **FR-021**: O sistema **MUST** lembrar a última clínica usada por cada usuário e usá-la como pré-seleção ao reapresentar o seletor.
- **FR-022**: A sidebar **MUST**, no topo, exibir o nome da clínica ativa em destaque, com a logo ao lado quando disponível.
- **FR-023**: A sidebar **MUST**, no rodapé, exibir um botão "Trocar clínica" ao lado do bloco de identificação do usuário (avatar/e-mail), visível somente para usuários com mais de uma clínica ativa vinculada.
- **FR-024**: A troca de clínica via "Trocar clínica" **MUST** preservar a sessão autenticada (sem reautenticação); apenas a clínica ativa muda.
- **FR-025**: O sistema **MUST** ignorar uma "última clínica" que esteja desativada/inválida e cair no comportamento padrão (ou outra clínica ativa, ou seletor, ou onboarding se não há nenhuma).
- **FR-026**: O nome da clínica editável em Configurações > Clínica **MUST** ser a fonte primária para o nome exibido na sidebar, no seletor de clínica, no cabeçalho dos PDFs e nos relatórios.

#### US4 — Calendário avançado

- **FR-027**: A página `/operacao/atendimentos` **MUST** exibir um mini-calendário mensal no cabeçalho do calendário; clicar em uma data nele **MUST** navegar o calendário principal para aquela data.
- **FR-028**: O mini-calendário **MUST** indicar visualmente os dias com atendimentos agendados (ponto/marcador).
- **FR-029**: O calendário principal **MUST** suportar três modos de visualização — Dia, Semana, Mês — alternáveis por botões; o modo escolhido **MUST** persistir na URL.
- **FR-030**: A visualização Mês **MUST** mostrar um grid de 5 ou 6 semanas exibindo até 3 atendimentos por célula com um chip "+N mais" quando houver excedente; clicar em "+N mais" leva à lista do dia.
- **FR-031**: O calendário **MUST** suportar seleção de uma data única (clique simples) e seleção de período (dois cliques), com destaque visual para os dias do período.
- **FR-032**: A barra de filtros **MUST** oferecer atalhos "Hoje", "Esta semana", "Este mês", "Próxima semana", "Próximo mês".
- **FR-033**: Os filtros disponíveis **MUST** incluir: Profissional, Período, Status (Todos | Agendados | Realizados | Cancelados), Procedimento, Paciente; e **MUST** poder ser combinados livremente.
- **FR-034**: Os filtros aplicados **MUST** ser refletidos na URL via parâmetros de consulta para que a mesma visão possa ser compartilhada por link.
- **FR-035**: Os filtros **MUST** funcionar identicamente nas visualizações Calendário e Lista; alternar entre as duas **MUST** preservar os filtros.
- **FR-036**: Um filtro inválido na URL (ex.: status fora do enum) **MUST** ser ignorado silenciosamente e removido na próxima navegação.
- **FR-037**: Um botão "Limpar filtros" **MUST** restaurar o estado padrão (semana corrente, sem filtros) e normalizar a URL.

#### Cross-cutting

- **FR-038**: O sistema **MUST** usar a clínica ativa da sessão para emitir as claims de tenant a cada requisição autenticada; quando a pessoa não tem clínica ativa válida, as claims **MUST** ficar vazias e o sistema **MUST** redirecionar para `/onboarding` (ou seletor, conforme o caso).
- **FR-039**: Toda criação de tenant (signup/onboarding e Marketplace install) **MUST** respeitar Princípio III (isolamento multi-tenant) — RLS continua sendo a única autoridade de visibilidade dos dados.
- **FR-040**: Qualquer redirecionamento entre `/login`, `/registrar`, `/onboarding`, `/selecionar-clinica` e dashboard **MUST** preservar a navegação intencional (deep-link funcional após login).

### Key Entities *(include if feature involves data)*

- **Conta de Usuário (auth)**: representa uma identidade global, sem vínculo intrínseco com clínica. Atributos: e-mail, nome completo (em Perfil), data de criação, data de confirmação de e-mail, data do último acesso. Pode existir sem nenhuma clínica vinculada (estado válido durante onboarding).
- **Clínica (tenant)**: a unidade fundamental de isolamento. Atributos: nome (obrigatório, exibido na sidebar e documentos), slug (único), status (ativa | suspensa). Relaciona-se com perfil clínico (logo, dados oficiais — feature 009), com vínculos de usuário (user_tenants — feature 009) e com no máximo uma integração GHL ativa (esta feature).
- **Vínculo Usuário↔Clínica**: papel do usuário em uma clínica. Atributos relevantes: status (active | disabled — feature 009), papel (admin/financeiro/recepcionista/profissional_saude). Esta feature acrescenta a noção de "última clínica usada" que pode ser persistida por usuário.
- **Conexão de Integração GHL**: o vínculo 1:1 entre clínica e sub-account GHL. Atributos: clínica, `location_id` (único), nome da sub-account, data da conexão, escopos OAuth, estado (ativa | desconectada). Histórico de conexões anteriores é preservado (Princípio I — append-only).
- **Tentativa de Conexão Rejeitada (auditoria)**: registro append-only criado quando uma tentativa de conexão GHL viola FR-001 ou FR-002. Atributos: ator, clínica alvo, `location_id`, código da violação, data/hora.
- **Estado de Filtros do Calendário (URL state, não persistido)**: o conjunto de filtros aplicados ao calendário/lista, codificado em parâmetros de consulta da URL. Atributos: visualização (dia/semana/mês), data de referência, período (de–até), profissional, status, procedimento, paciente.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Após o deploy, **0 incidentes** de duas clínicas simultaneamente conectadas à mesma sub-account GHL nos primeiros 90 dias (medida pela ausência de linhas em `tenant_integrations` ativas com `location_id` duplicado).
- **SC-002**: 100% das tentativas de violar a regra 1:1 (qualquer caminho — OAuth, refresh, install) **resultam** em rejeição com mensagem específica de FR-004 e em entrada de auditoria.
- **SC-003**: 95% dos novos usuários que iniciam o signup completam onboarding em menos de **3 minutos**, sem necessidade de suporte humano.
- **SC-004**: Para usuários com uma única clínica vinculada, o login leva ao dashboard sem a passagem pelo seletor — verificável por amostragem de logs/clickstream.
- **SC-005**: Para usuários com múltiplas clínicas, a troca de clínica via "Trocar clínica" leva no máximo **2 cliques** (botão → card) e **não exige reautenticação**.
- **SC-006**: 100% das páginas internas exibem na sidebar o nome correto da clínica ativa (sem caso "Prontool" como fallback inadequado quando a clínica tem nome cadastrado).
- **SC-007**: A visualização Mês do calendário renderiza para um mês com até **500 atendimentos** em menos de **1 segundo** percebido pelo usuário (Time to Interactive na transição).
- **SC-008**: 100% das URLs com filtros válidos do calendário, quando reabertas em outra sessão (com permissões equivalentes), reproduzem a mesma visão.
- **SC-009**: A combinação de qualquer 2 filtros do calendário (ex.: profissional + status, paciente + período) reduz a contagem exibida ao subconjunto correto, validável contra a contagem da query bruta.
- **SC-010**: Após desconectar uma clínica do GHL, é possível reconectá-la a outra sub-account (ou conectar a sub-account anterior a outra clínica) sem necessidade de intervenção técnica.

## Assumptions

- A criação de conta no signup gera um envio assíncrono de e-mail de verificação pelo serviço de autenticação adotado, mas o usuário **não** precisa confirmar antes de criar a primeira clínica — a verificação serve para recuperação de senha futura.
- O slug da clínica é gerado a partir do nome (lowercase, sem acentos, espaços viram hífens) e oferece sugestões em caso de colisão.
- A "última clínica usada" é persistida por usuário no servidor (preferência leve), de modo que sobreviva à troca de dispositivo/navegador, e é também lida via cookie para acelerar o redirecionamento pós-login.
- A regra GHL 1:1 vale para conexões **ativas**; o histórico de conexões anteriores (já desconectadas) não impede reconexões futuras.
- O nome da clínica exibido na sidebar é o "nome de exibição" editável em Configurações > Clínica; quando essa edição estiver vazia, o sistema usa o nome inicial criado no onboarding.
- O badge "GHL conectado" no seletor é informativo apenas; não muda visibilidade de dados (cada clínica continua isolada por RLS).
- Filtros do calendário são puramente UI/URL — nenhuma mudança em endpoints existentes além de aceitar parâmetros adicionais quando aplicável; nenhuma migração de banco para esta story.
- As visualizações Dia e Semana atuais já existem e permanecem inalteradas em comportamento; a story acrescenta a visualização Mês e os filtros, mas mantém compatibilidade.
- Marketplace install que cria uma clínica nova já provisiona a primeira admin com base no usuário GHL que iniciou o install (comportamento existente da feature 008).
- Para usuários multi-tenant, a troca de clínica não preserva o estado profundo da página anterior (filtros, formulários abertos) — cada clínica tem seu próprio "espaço de trabalho".
- O escopo desta feature **NÃO** cobre:
  - Convite via link público de auto-registro restrito a uma clínica específica.
  - Two-factor authentication no signup.
  - Importação em massa de clínicas.
  - Mudança de slug após a criação da clínica (slug é imutável depois do onboarding; nome de exibição continua editável).
  - Visualização Ano (apenas Dia/Semana/Mês).
  - Drag-and-drop de atendimentos entre dias na visualização Mês (apenas leitura/navegação).
