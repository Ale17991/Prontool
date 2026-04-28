# Feature Specification: Calendário de atendimentos, typeahead TUSS aprimorado, catálogo odonto e navegação

**Feature Branch**: `004-calendario-atendimentos`
**Created**: 2026-04-27
**Status**: Draft
**Input**: User description: "Adicionar visualização em calendário nos atendimentos, melhorar typeahead TUSS, completar catálogo odontológico e adicionar navegação de volta. Incluir filtro de profissionais no calendário."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Visualização em calendário dos atendimentos com filtro por profissional (Priority: P1)

A recepcionista ou administradora abre `/operacao/atendimentos` e precisa entender rapidamente como está a agenda da semana — quem atende quando, onde há buracos para encaixar paciente, e onde há sobreposição. Hoje só existe lista cronológica, e isso é insuficiente para tomar decisões de agendamento. Ela alterna para a visualização Calendário, escolhe o(s) profissional(is) que quer enxergar (um, vários, ou todos), navega entre semanas, e consegue clicar em um slot vazio para criar atendimento já com a hora pré-preenchida.

**Why this priority**: É o ganho funcional mais visível da feature e o que diferencia o produto perante a concorrência. Resolve uma dor diária da operação. Os outros itens (typeahead, navegação, catálogo) são polish.

**Independent Test**: Pode ser entregue isoladamente — basta a aba "Calendário" funcionando com leitura dos atendimentos existentes e o filtro de profissional, mesmo sem os campos novos `appointment_time`/`duration_minutes` (caem no default 30 min). Validação: alternar Lista/Calendário, ver blocos posicionados pelo `appointment_at`, navegar entre semanas, filtrar por 1 profissional e ver só os blocos dele.

**Acceptance Scenarios**:

1. **Given** estou em `/operacao/atendimentos` na aba Lista, **When** clico no botão "Calendário", **Then** a interface troca para um grid semanal (domingo–sábado) com horas de 07:00 a 22:00 em slots de 1h, mostrando os atendimentos dos últimos 7 dias.
2. **Given** estou na aba Calendário com a semana atual carregada, **When** observo a tela durante o dia, **Then** vejo uma linha horizontal vermelha cruzando a coluna do dia atual na altura da hora corrente (atualizada periodicamente).
3. **Given** estou na aba Calendário, **When** vejo os blocos, **Then** atendimentos ativos aparecem em azul, estornados/cancelados em vermelho, concluídos em verde — cada bloco mostra nome do paciente e nome do procedimento, com altura proporcional à duração.
4. **Given** estou na aba Calendário, **When** clico em um bloco existente, **Then** sou levada para `/operacao/atendimentos/[id]` (mesma rota da lista).
5. **Given** estou na aba Calendário em um slot vazio (ex.: terça 14:00), **When** clico no slot, **Then** sou levada para `/operacao/atendimentos/novo` com data e hora pré-preenchidas para esse slot.
6. **Given** estou na aba Calendário, **When** clico no seletor "Dia / Semana / Mês", **Then** a granularidade muda; em Semana navego com setas anterior/próxima, e o botão "Hoje" volta para a semana atual.
7. **Given** estou na aba Calendário, **When** abro o filtro de profissionais e seleciono apenas "Dra. X", **Then** apenas atendimentos com `doctor_id = X` aparecem; ao marcar "Todos" volto a ver todos. A seleção persiste entre navegações de semana dentro da mesma sessão.
8. **Given** acesso a tela em um dispositivo móvel (largura < 640px), **When** entro na aba Calendário, **Then** vejo automaticamente a visualização de Dia (não a semana inteira), com setas de dia anterior/próximo.

---

### User Story 2 - Typeahead TUSS exibe nome completo + "Ver em lista" (Priority: P2)

Uma profissional cadastrando um novo procedimento ou montando uma etapa de plano de tratamento digita parte do nome do procedimento (ex: "restauração") e quer ver o nome completo de cada resultado. Hoje os nomes longos ficam truncados com "…", forçando-a a clicar para descobrir qual é qual. Além disso, em situações onde quer revisar o catálogo TUSS inteiro (não só buscar), ela usa um botão "Ver em lista" que abre uma tabela paginada para conferência.

**Why this priority**: Reduz erro de seleção e tempo gasto no cadastro. Já recebeu reclamação direta. Mas é polish, não bloqueia operação.

**Independent Test**: Pode ser testada sozinha mudando o componente de typeahead — abrir o dropdown de TUSS em `/cadastros/procedimentos`, em "Novo atendimento" e em "Nova etapa" e confirmar que os nomes longos aparecem completos (até 2 linhas). Para o "Ver em lista", basta o botão renderizar a tabela paginada.

**Acceptance Scenarios**:

1. **Given** estou em qualquer formulário com typeahead TUSS, **When** digito termo de busca e abro o dropdown, **Then** o popover é largo o suficiente para mostrar nomes longos, e nomes que ultrapassem uma linha aparecem em até 2 linhas (sem reticências).
2. **Given** estou em qualquer typeahead TUSS, **When** clico no botão "Ver em lista" ao lado do campo, **Then** abre uma visualização (modal ou drawer) com tabela contendo as colunas: Código TUSS, Nome completo, Tabela (badge 22/19/20).
3. **Given** estou na visualização "Ver em lista", **When** vejo o rodapé, **Then** há paginação a cada 20 linhas, com controles de página anterior/próxima e indicador da página atual.
4. **Given** estou na visualização "Ver em lista", **When** clico em uma linha, **Then** o item é selecionado no formulário de origem e a visualização fecha.
5. **Given** uso o sistema em qualquer typeahead TUSS (Procedimentos cadastro, Novo atendimento, Nova etapa de plano), **Then** o comportamento de largura, wrap em 2 linhas e botão "Ver em lista" é idêntico — não há divergência entre páginas.

---

### User Story 3 - Botão Voltar nas páginas de atendimento (Priority: P3)

Profissional ou recepcionista terminando de criar um atendimento em `/operacao/atendimentos/novo` ou consultando um detalhe em `/operacao/atendimentos/[id]` precisa de um caminho óbvio para voltar à listagem sem usar o botão do navegador. Hoje há um link textual pequeno em cima; falta um botão visualmente claro.

**Why this priority**: Pequena melhoria de UX. Não bloqueia ninguém — o link de voltar discreto já existe.

**Independent Test**: Validar isoladamente abrindo as duas páginas e confirmando que o botão "Voltar" está presente, é facilmente clicável, e leva de volta para `/operacao/atendimentos`.

**Acceptance Scenarios**:

1. **Given** estou em `/operacao/atendimentos/[id]`, **When** olho para o topo da página, **Then** vejo um botão "Voltar" claramente visível (não apenas texto pequeno).
2. **Given** estou em `/operacao/atendimentos/novo`, **When** olho para o topo da página, **Then** vejo o mesmo botão "Voltar" no mesmo padrão visual.
3. **Given** clico no botão "Voltar" em qualquer dessas páginas, **When** a navegação acontece, **Then** sou levada para `/operacao/atendimentos` (não para o histórico do navegador).

---

### User Story 4 - Auditoria e completude do catálogo TUSS odontológico (Priority: P3)

A administradora suspeita que o catálogo TUSS Tabela 22 importado (5.851 códigos) está incompleto na seção odontológica. Antes de pedir importação manual, o sistema precisa reconciliar com a fonte oficial mais recente da ANS e expor de forma clara quantos códigos odonto existem por capítulo — e, se houver lacunas reais, importá-las.

**Why this priority**: Investigação pontual; a integridade dos códigos cadastrados não impede operação imediata. Se confirmar lacuna real, a importação é uma migration baixa-complexidade.

**Independent Test**: Verificar contagem por prefixo (81 a 88) na base atual; comparar com a publicação oficial mais recente da ANS (Padrão TISS Janeiro/2025); reportar diferença e, se aplicável, popular os códigos faltantes.

**Acceptance Scenarios**:

1. **Given** o sistema executou a auditoria contra a publicação oficial vigente da ANS, **When** consulto o relatório de reconciliação (em log do seed ou em página de admin), **Then** vejo a contagem de códigos odontológicos por prefixo (81, 82, 83, 84, 85, 86, 87, 88) e a diferença vs. a fonte oficial.
2. **Given** existem códigos da Tabela 22 oficial ausentes do catálogo local, **When** a importação é executada, **Then** todos os códigos faltantes são adicionados, vinculados a uma versão de catálogo (`tuss_catalog_versions`) que documenta a origem e a data.
3. **Given** a fonte oficial ANS Tabela 22 vigente NÃO contém códigos com prefixo 88, **When** o relatório é gerado, **Then** o relatório explicita "0 códigos com prefixo 88" como esperado (não como erro), evitando interpretação equivocada.

---

### Edge Cases

- **Calendário com muitos atendimentos no mesmo slot** (overlapping): blocos lado a lado dentro da mesma célula, com largura proporcional. Limite visual razoável (ex.: até 4 lado a lado); acima disso, mostra contagem "+N mais" e expande ao clicar.
- **Atendimento com `appointment_at` antes de 07:00 ou após 22:00**: fora da grade visível. Indicar com banner discreto "N atendimentos fora do horário visível" no topo do dia, com link para expandir o intervalo.
- **Atendimento sem `duration_minutes` cadastrado** (registros antigos): assume default de 30 min — o bloco renderiza com altura mínima (1 slot).
- **Filtro de profissional vazio**: o usuário desmarca todos os profissionais; mostra "Selecione ao menos um profissional para visualizar a agenda".
- **Profissional inativo** com atendimentos passados: aparece na lista de filtro marcado como inativo (cinza), continua selecionável para auditoria histórica.
- **Mobile com slot vazio clicado**: abre o formulário em modo simplificado (sem perder hora pré-preenchida).
- **TUSS "Ver em lista" com base muito grande** (5.000+ códigos): paginação obrigatória; busca acessível por filtro de texto dentro da tabela.
- **Botão Voltar no detalhe quando o atendimento veio de uma busca/filtro específico**: sempre volta para `/operacao/atendimentos` sem preservar filtros (decisão consciente — comportamento previsível em vez de mágica).
- **Conflito de fuso horário**: `appointment_at` é armazenado em UTC; a renderização usa o fuso da clínica (Brasil). Atendimento criado às 23:30 local não pode aparecer no dia seguinte.

## Requirements *(mandatory)*

### Functional Requirements

#### Calendário (US1)
- **FR-001**: Sistema MUST oferecer alternância entre as visualizações "Lista" e "Calendário" na página `/operacao/atendimentos`, preservando os filtros de período e status já existentes.
- **FR-002**: Sistema MUST renderizar a visualização Calendário em modo Semana por padrão, com colunas de domingo a sábado e linhas de hora de 07:00 a 22:00 em granularidade de 1 hora.
- **FR-003**: Sistema MUST exibir uma linha horizontal vermelha indicando a hora atual, posicionada apenas na coluna do dia corrente, atualizada a cada minuto.
- **FR-004**: Sistema MUST representar cada atendimento como um bloco posicionado pela hora de início, com altura proporcional à duração (`duration_minutes`), e cores: azul (status ativo), vermelho (estornado/cancelado), verde (concluído).
- **FR-005**: Cada bloco MUST exibir nome do paciente e nome do procedimento (TUSS display_name ou tuss_code).
- **FR-006**: Clicar em um bloco MUST navegar para `/operacao/atendimentos/[id]`.
- **FR-007**: Clicar em um slot vazio MUST navegar para `/operacao/atendimentos/novo` com data e hora pré-preenchidas correspondentes ao slot.
- **FR-008**: Sistema MUST oferecer botão "Hoje", setas de semana anterior/próxima, e seletor de granularidade (Dia / Semana / Mês).
- **FR-009**: Sistema MUST destacar visualmente a coluna do dia atual.
- **FR-010**: Modelo de atendimento MUST persistir hora de início (`appointment_time` derivada de `appointment_at`) e `duration_minutes` (default 30).
- **FR-011**: Em telas estreitas (< 640px), Sistema MUST exibir Calendário em modo Dia automaticamente, com setas dia anterior/próximo.
- **FR-012**: Sistema MUST oferecer um filtro de profissionais (multi-seleção, com opção "Todos" e indicação de inativos), que limita os blocos exibidos no Calendário pelo `doctor_id`. A seleção persiste durante a sessão entre navegações de semana, mas reseta entre sessões.
- **FR-013**: Sistema MUST tratar atendimentos sobrepostos no mesmo slot dispondo blocos lado a lado proporcionalmente, com fallback "+N mais" quando ultrapassar limite de legibilidade.

#### Typeahead TUSS (US2)
- **FR-020**: Todos os typeaheads de código TUSS do sistema MUST renderizar dropdown com largura suficiente para acomodar o texto completo do procedimento (até um máximo razoável da viewport).
- **FR-021**: Nomes que ultrapassem a largura disponível MUST quebrar em até 2 linhas; reticências/truncamento são proibidos.
- **FR-022**: Cada formulário com typeahead TUSS MUST oferecer botão "Ver em lista" que abre uma visualização tabular do catálogo, com colunas: Código TUSS, Nome completo, Tabela (badge identificando 22/19/20).
- **FR-023**: A visualização "Ver em lista" MUST paginar resultados a 20 por página, com navegação anterior/próxima e indicador de página.
- **FR-024**: A visualização "Ver em lista" MUST permitir busca por código ou nome.
- **FR-025**: Selecionar uma linha em "Ver em lista" MUST aplicar a seleção ao formulário de origem e fechar a visualização.

#### Catálogo odontológico (US4)
- **FR-030**: Sistema MUST executar reconciliação entre o catálogo `tuss_codes` local e a versão oficial mais recente publicada pela ANS (Padrão TISS Componente de Conteúdo) para a Tabela 22, gerando relatório de diferenças com contagem por prefixo (81–88).
- **FR-031**: Quando a reconciliação identificar códigos oficiais ausentes, Sistema MUST adicioná-los via migration ou seed, registrando a versão fonte em `tuss_catalog_versions`.
- **FR-032**: O relatório MUST explicitar quando um prefixo esperado (ex.: 88) não existe na fonte oficial, distinguindo "ausência confirmada como esperada" de "lacuna real".

#### Navegação (US3)
- **FR-040**: Páginas `/operacao/atendimentos/[id]` e `/operacao/atendimentos/novo` MUST exibir botão "Voltar" no topo, visualmente claro (não apenas link textual discreto), que navega de volta para `/operacao/atendimentos`.

### Key Entities *(include if feature involves data)*

- **Atendimento (`appointments`)**: representação de um atendimento clínico realizado. Atributos relevantes para esta feature: identificador, paciente, profissional (`doctor_id`), procedimento, data/hora de início (`appointment_at`), **duração em minutos (`duration_minutes`, novo, default 30)**, status efetivo (ativo/estornado), valor congelado.
- **Profissional (`doctors`)**: profissional de saúde da clínica. Atributos relevantes: identificador, nome completo, status ativo/inativo. Usado pelo filtro do calendário.
- **Catálogo TUSS (`tuss_codes`)**: catálogo de códigos TUSS publicados pela ANS. Atributos: código, descrição, tabela (22 procedimentos / 19 materiais / 20 medicamentos), vigência. Usado pelos typeaheads e pela reconciliação odonto.
- **Versão do catálogo TUSS (`tuss_catalog_versions`)**: identifica origem e momento de cada importação do catálogo, para rastreabilidade da reconciliação odonto.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A recepcionista consegue identificar um slot livre e abrir o formulário de novo atendimento com a hora pré-preenchida em até 3 cliques a partir de `/operacao/atendimentos`.
- **SC-002**: Em um dia típico (até 60 atendimentos espalhados na semana), o calendário carrega e renderiza todos os blocos visíveis em até 1,5 segundos após a navegação para a aba Calendário.
- **SC-003**: 90% dos atendimentos visualizados no calendário são reconhecíveis (paciente + procedimento legíveis) sem precisar abrir o detalhe.
- **SC-004**: Filtrar por um profissional específico reduz visualmente os blocos exibidos para apenas os do profissional escolhido em até 500 ms (percepção de instantâneo).
- **SC-005**: Em qualquer typeahead TUSS, profissionais não relatam mais "não consegui ver o nome completo do procedimento" em testes informais com 5+ usuários.
- **SC-006**: Após a reconciliação odontológica, o número de códigos TUSS odonto (prefixos 81–88) no banco é igual ou maior ao da publicação oficial vigente da ANS, e o sistema documenta a fonte da última importação.
- **SC-007**: Em mobile, a visualização de Dia carrega corretamente sem layout quebrado em 100% dos atendimentos da semana.
- **SC-008**: O botão "Voltar" no detalhe e no novo é clicado com sucesso (navegação para a listagem) em 100% dos casos testados, sem dependência do histórico do navegador.

## Assumptions

- A clínica opera no fuso horário do Brasil; toda renderização de horário no calendário usa o fuso da clínica, mesmo que `appointment_at` esteja em UTC.
- O horário visível padrão (07:00–22:00) cobre 99%+ dos atendimentos reais; atendimentos fora desse intervalo são raros e tratados via banner de "fora do horário".
- O campo `duration_minutes` será adicionado ao modelo de atendimentos com default 30; atendimentos legados sem o campo assumem 30 min.
- O filtro de profissional do calendário usa a tabela `doctors` já existente, com flag `active`.
- O comportamento "voltar" das páginas de atendimento sempre leva à raiz da listagem, sem preservar filtros — escolha consciente por previsibilidade.
- A fonte oficial de reconciliação do catálogo TUSS é a publicação ANS Padrão TISS Componente de Representação de Conceitos em Saúde (atual: versão 202501); investigação prévia indica que a Tabela 22 oficial NÃO contém códigos com prefixo 88, então a "ausência" desse prefixo no banco é o estado correto, não uma lacuna.
- A multi-seleção de profissionais persiste apenas durante a sessão (via state local ou query string); não há preferência salva por usuário neste escopo.
- O catálogo TUSS continua importado via seed/migration; este escopo não inclui mecanismo automático de pull periódico da ANS.
- Visualizações Dia, Semana e Mês compartilham a mesma fonte de dados (`appointments_effective`) — diferem apenas no recorte temporal e no layout.
