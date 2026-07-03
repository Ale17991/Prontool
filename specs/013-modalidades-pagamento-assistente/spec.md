# Feature Specification: Modalidades de pagamento + Profissional assistente

**Feature Branch**: `013-modalidades-pagamento-assistente`
**Created**: 2026-05-14
**Status**: Draft
**Input**: User description: "Modalidades de pagamento para profissionais e profissional assistente no atendimento. Suportar 3 modalidades: comissionado (atual), fixo (salário mensal) e liberal (cobra por participação como assistente em atendimentos). Refletir em cadastro, formulário de atendimento e relatórios."

## User Scenarios & Testing _(mandatory)_

> **Dependência entre stories**: US1 estabelece o modelo de dados (modalidade no cadastro). US2 e US3 dependem de US1 estar entregue, mas são independentes entre si — pode-se entregar US2 sem US3 ou vice-versa. Cada story é descrita como "deliverable vertical" — inclui cadastro + UI + impacto onde aplicável.

### User Story 1 — Cadastro de modalidades de pagamento no profissional (Priority: P1)

Como admin, quero classificar cada profissional em uma das três modalidades de pagamento (Comissionado, Fixo ou Liberal) e capturar os parâmetros financeiros correspondentes, para que o sistema reflita corretamente como cada um é remunerado.

**Why this priority**: Esta é a base de dados que habilita US2 e US3. Sem ela, não há "liberais" para selecionar como assistentes nem "fixos" para aparecer no relatório. É também o caminho mais visível para o admin: sem mudança no cadastro, nada na operação muda. Entregar isolada já permite que a clínica documente formalmente o vínculo financeiro de cada profissional, mesmo que os efeitos em atendimento e relatório venham depois.

**Independent Test**: Admin abre cadastro de novo profissional, escolhe modalidade "Fixo", preenche valor mensal e dia de faturamento, salva. Lista de profissionais exibe esse novo profissional com badge "Fixo" e a coluna "Valor" mostra "R$ X / mês (dia Y)". Edição preserva os campos e permite trocar de modalidade — mudança fica registrada no audit log. Profissionais existentes aparecem com modalidade "Comissionado" sem necessidade de migração manual.

**Acceptance Scenarios**:

1. **Given** sou admin e nenhum profissional foi cadastrado ainda, **When** crio um profissional escolhendo "Comissionado" e preencho comissão 30%, **Then** o profissional é salvo com modalidade Comissionado e comissão 30%, e na listagem aparece com badge "Comissionado" e coluna "Valor" mostrando "30%".
2. **Given** sou admin, **When** crio um profissional escolhendo "Fixo" com valor mensal R$ 8.000 e dia de faturamento 5, **Then** o profissional é salvo e a listagem mostra badge "Fixo" e coluna "Valor" exibindo "R$ 8.000 / mês (dia 5)".
3. **Given** sou admin, **When** crio um profissional escolhendo "Liberal" com valor padrão de participação R$ 350, **Then** o profissional é salvo e a listagem mostra badge "Liberal" e coluna "Valor" exibindo "R$ 350 / participação".
4. **Given** sou admin editando um profissional Comissionado existente, **When** mudo a modalidade para "Fixo" e preencho os novos campos, **Then** a mudança é salva, o audit log registra a troca com timestamp e ator, e atendimentos já realizados pelo profissional permanecem contabilizados como comissão (sem retroatividade).
5. **Given** sou admin no formulário de cadastro, **When** seleciono "Comissionado", **Then** vejo apenas o campo "Comissão %"; ao selecionar "Fixo" os campos passam a ser "Valor mensal" + "Dia de faturamento"; ao selecionar "Liberal" passa a ser apenas "Valor por participação".
6. **Given** sou recepcionista (não admin), **When** acesso o cadastro de profissional, **Then** o campo de modalidade aparece como somente-leitura ou inacessível — apenas admin pode definir/alterar modalidade.
7. **Given** profissionais antigos cadastrados antes desta feature, **When** consulto a listagem após o deploy, **Then** todos aparecem como "Comissionado" (modalidade default) com seus campos de comissão preservados.

---

### User Story 2 — Profissional assistente no atendimento (Priority: P2)

Como recepcionista, quero adicionar um ou mais profissionais assistentes (liberais) a um atendimento, com valor editável por participação, para registrar quem mais participou (ex: anestesista) e capturar o custo correspondente.

**Why this priority**: Habilita o caso de uso operacional principal da feature — registrar quem efetivamente participou de cada atendimento e gerar a despesa correspondente. Depende de US1 ter sido entregue (precisa haver pelo menos um profissional Liberal cadastrado), mas pode ser entregue sem US3 (sem o relatório consolidado, a clínica ainda vê os assistentes no detalhe do atendimento e na ficha do paciente).

**Independent Test**: Com pelo menos um profissional Liberal cadastrado, recepcionista cria um novo atendimento, seleciona um profissional principal (Comissionado/Fixo), expande "Profissional assistente", escolhe o liberal numa lista, vê o valor padrão pré-preenchido (editável). Salva o atendimento. Ao reabrir, vê o assistente listado abaixo do profissional principal com o valor congelado daquela participação. No calendário, o bloco do atendimento exibe "(+ 1 assistente)".

**Acceptance Scenarios**:

1. **Given** existe pelo menos um profissional Liberal cadastrado, **When** crio um atendimento, **Then** vejo o campo opcional "Profissional assistente" abaixo do campo "Profissional principal".
2. **Given** estou no formulário de atendimento, **When** abro o seletor de "Profissional assistente", **Then** vejo apenas profissionais com modalidade Liberal (não vejo Comissionados nem Fixos).
3. **Given** seleciono um liberal como assistente, **When** ele é adicionado à lista, **Then** o valor padrão dele aparece pré-preenchido e posso editá-lo para este atendimento sem alterar o valor padrão do cadastro.
4. **Given** já tenho um assistente selecionado, **When** clico em "Adicionar outro assistente", **Then** posso selecionar outro liberal — multi-select é suportado e o mesmo profissional não pode aparecer duas vezes.
5. **Given** o atendimento tem 2 assistentes (R$ 350 e R$ 200), **When** salvo o atendimento, **Then** os assistentes ficam vinculados ao atendimento com valor congelado (mesmo que o valor padrão do cadastro mude depois, este atendimento mantém R$ 350/R$ 200).
6. **Given** abro a visualização de um atendimento salvo com assistentes, **When** olho a área do profissional, **Then** vejo o profissional principal e abaixo a lista de assistentes com nome e valor.
7. **Given** estou no calendário de atendimentos, **When** olho um bloco que tem assistentes, **Then** vejo o indicador "(+ N assistentes)" — onde N é a contagem.
8. **Given** um atendimento já salvo é estornado, **When** o estorno é processado, **Then** o registro do assistente permanece (append-only) mas não conta como despesa em relatórios — segue o status do atendimento pai.
9. **Given** modifico o atendimento removendo um assistente, **When** salvo, **Then** o registro original não é deletado fisicamente (append-only); uma nova versão marca a remoção e o relatório passa a desconsiderar essa participação a partir do momento da remoção.

---

### User Story 3 — Impacto nos relatórios financeiros (Priority: P3)

Como admin/financeiro, quero ver os pagamentos de profissionais Fixos e Liberais refletidos no relatório mensal, no relatório por profissional e no resultado operacional, para entender o custo real de pessoal e o lucro da clínica.

**Why this priority**: Fecha o ciclo da feature e dá visibilidade financeira completa. Depende de US1 (modalidades cadastradas) e idealmente de US2 (assistentes registrados) para gerar números reais, mas pode ser entregue de forma incremental — primeiro suporte a Fixos no mensal, depois Liberais por participação, depois o resultado operacional consolidado. A clínica sobrevive sem isto (admin pode somar manualmente), por isso P3, mas a feature só estará "completa" com ela.

**Independent Test**: Tendo pelo menos um Fixo e um Liberal cadastrados, e ao menos um atendimento com assistente Liberal: abrir o relatório mensal — aparece linha "Pagamento fixo — [profissional]" no dia configurado, com o valor cadastrado. Abrir relatório por profissional do Fixo — vê "Valor fixo mensal: R$ X" no lugar de "Comissão". Abrir relatório por profissional do Liberal — vê total acumulado em participações no período. Abrir resultado operacional — vê fórmula: faturamento bruto − comissões − fixos − liberais − impostos − despesas = lucro.

**Acceptance Scenarios**:

1. **Given** profissional Fixo com valor R$ 8.000 e dia 5, **When** abro o relatório mensal do mês corrente após o dia 5, **Then** vejo a linha "Pagamento fixo — [nome]" com valor R$ 8.000, datada no dia 5 daquele mês.
2. **Given** profissional Fixo com dia 5 e o relatório é consultado no dia 1 (antes do dia 5), **When** abro o mensal, **Then** a linha de pagamento fixo do mês corrente ainda não aparece — só será incluída a partir do dia 5.
3. **Given** profissional Liberal participou como assistente em 3 atendimentos no mês (R$ 350, R$ 200, R$ 400), **When** abro o relatório por profissional dele filtrando o mês, **Then** vejo total R$ 950 com discriminação por atendimento.
4. **Given** profissional Comissionado preexistente, **When** abro o relatório por profissional dele, **Then** o comportamento atual (cálculo por comissão) está preservado sem qualquer regressão.
5. **Given** o resultado operacional do mês, **When** abro a tela, **Then** vejo a fórmula: faturamento bruto − comissões − pagamentos fixos − pagamentos a liberais − impostos − despesas operacionais = lucro líquido.
6. **Given** um profissional mudou de Comissionado para Fixo no meio do mês, **When** consulto o relatório mensal, **Then** os atendimentos anteriores à mudança aparecem na linha de comissão (com base na comissão antiga) e a partir do dia da mudança o pagamento fixo passa a contar nos próximos meses no dia configurado — sem dupla contagem no mês da transição.
7. **Given** um atendimento com assistente Liberal foi estornado, **When** abro o relatório por profissional do Liberal, **Then** o valor daquela participação não aparece no total (segue o status do atendimento pai).

---

### Edge Cases

- **Mudança de modalidade no meio do mês**: histórico congelado — atendimentos anteriores mantêm a regra anterior; pagamento fixo passa a valer a partir do próximo dia de faturamento; sem dupla contagem.
- **Profissional Fixo realizando atendimento**: o atendimento entra no faturamento bruto normalmente, mas o profissional não ganha comissão extra — ele recebe apenas o fixo.
- **Profissional Liberal selecionado como "principal" em um atendimento**: bloqueado pela UI — o seletor de profissional principal deve exibir apenas Comissionados e Fixos. Caso a regra falhe e um Liberal seja registrado como principal, o sistema deve avisar o usuário antes de salvar.
- **Dia de faturamento 29/30/31**: restrição da UI para 1–28 (garante existência em todo mês). Tentativa de salvar fora do intervalo retorna validação.
- **Mesmo Liberal selecionado 2x como assistente do mesmo atendimento**: bloqueado pela UI (mensagem "Este profissional já foi adicionado como assistente").
- **Profissional Liberal cadastrado mas nunca participou**: aparece como opção no seletor de assistente, mas no relatório por profissional vê "0 participações no período".
- **Profissional desativado**: deixa de aparecer no seletor de novos atendimentos, mas atendimentos passados onde participou continuam exibindo o registro.
- **Atendimento estornado com assistentes**: os registros de assistente permanecem (append-only) mas não contam como despesa em relatórios — seguem o status do atendimento pai.
- **Remoção de assistente de um atendimento já salvo**: append-only — o registro original não some; uma nova versão (ou flag de remoção) garante que o relatório desconsidere a partir do momento da remoção.
- **Profissional Comissionado com comissão 0%**: válido (cenário "sócio sem comissão fixa") — comportamento atual mantido.

## Requirements _(mandatory)_

### Functional Requirements

**Cadastro de profissional (US1)**

- **FR-001**: O sistema MUST permitir registrar uma modalidade de pagamento por profissional, escolhendo entre exatamente uma das três opções: Comissionado, Fixo ou Liberal.
- **FR-002**: O sistema MUST exibir, no formulário de cadastro/edição, campos diferentes conforme a modalidade selecionada — atualizando dinamicamente sem recarregar a página.
- **FR-003**: Para a modalidade **Comissionado**, o sistema MUST capturar o percentual de comissão (0–100%), preservando o comportamento atual.
- **FR-004**: Para a modalidade **Fixo**, o sistema MUST capturar o valor mensal (em reais) e o dia de faturamento (inteiro entre 1 e 28, default 1).
- **FR-005**: Para a modalidade **Liberal**, o sistema MUST capturar o valor padrão por participação (em reais) — usado como pré-preenchimento quando o profissional for adicionado como assistente.
- **FR-006**: O sistema MUST exibir, na listagem de profissionais, uma coluna "Modalidade" com badge colorido (Comissionado/Fixo/Liberal) e uma coluna "Valor" cuja apresentação adapta-se à modalidade (ex.: "30%", "R$ 8.000 / mês (dia 5)", "R$ 350 / participação").
- **FR-007**: O sistema MUST permitir que um profissional mude de modalidade após cadastrado, sem perder histórico — toda mudança registra evento em audit log com ator, timestamp, modalidade anterior e nova.
- **FR-008**: Profissionais existentes antes desta feature MUST ser atribuídos automaticamente à modalidade Comissionado, preservando seus campos atuais de comissão sem necessidade de intervenção manual do admin.
- **FR-009**: Apenas perfis com papel **admin** MUST poder definir ou alterar a modalidade de um profissional. Outros papéis podem visualizar a modalidade mas não editá-la.

**Atendimento com assistente (US2)**

- **FR-010**: O formulário de criação/edição de atendimento MUST exibir um campo opcional "Profissional assistente" abaixo do campo de profissional principal.
- **FR-011**: O seletor de assistente MUST listar exclusivamente profissionais com modalidade Liberal ativos no tenant — Comissionados e Fixos não aparecem nesse seletor.
- **FR-012**: O seletor de assistente MUST permitir selecionar mais de um liberal (multi-select), impedindo seleção duplicada do mesmo profissional no mesmo atendimento.
- **FR-013**: Ao adicionar um assistente, o sistema MUST pré-preencher o valor da participação com o valor padrão cadastrado para aquele liberal, permitindo edição livre por atendimento (sem alterar o valor padrão do cadastro).
- **FR-014**: O valor da participação do assistente MUST ser congelado no momento do salvamento do atendimento — mudanças posteriores no valor padrão do cadastro do liberal NÃO retroagem em atendimentos já salvos.
- **FR-015**: O sistema MUST permitir adicionar e remover assistentes em atendimentos já salvos, com persistência append-only — remoção não apaga fisicamente o registro; mantém auditoria de quando deixou de participar.
- **FR-016**: A visualização de um atendimento (página de detalhe e card no histórico do paciente) MUST mostrar o profissional principal seguido da lista de assistentes (nome + valor por participação).
- **FR-017**: O bloco visual do atendimento no calendário MUST exibir o indicador "(+ N assistentes)" quando houver pelo menos um assistente — onde N é a contagem.
- **FR-018**: O custo total do atendimento (faturamento bruto) MUST permanecer inalterado; a soma dos valores de assistentes entra como **despesa de atendimento** no resultado operacional, não como aumento de receita.
- **FR-019**: Quando o atendimento for estornado, os registros de assistente MUST permanecer (append-only) mas NÃO contam no relatório financeiro do liberal nem como despesa operacional.

**Relatórios (US3)**

- **FR-020**: O relatório mensal MUST incluir uma linha "Pagamento fixo — [profissional]" para cada profissional Fixo, datada no dia de faturamento configurado do mês em questão. Antes do dia de faturamento do mês corrente, a linha não aparece naquele mês.
- **FR-021**: O relatório por profissional MUST exibir, para um Fixo, o campo "Valor fixo mensal: R$ X" (e seu dia de faturamento) no lugar das informações de comissão.
- **FR-022**: O relatório por profissional MUST exibir, para um Liberal, o total acumulado pago em participações no período filtrado, com discriminação por atendimento (data, paciente, valor congelado).
- **FR-023**: O relatório por profissional para Comissionados MUST preservar 100% do comportamento atual — sem regressão visual ou de cálculo.
- **FR-024**: O resultado operacional MUST apresentar a fórmula: **faturamento bruto − comissões − pagamentos fixos − pagamentos a liberais − impostos − despesas operacionais = lucro líquido**, com cada linha clicável/expandível para detalhamento.
- **FR-025**: Pagamentos fixos MUST ser classificados como categoria "Despesa de pessoal" nos relatórios de custos operacionais.
- **FR-026**: Pagamentos a liberais MUST ser classificados como categoria "Despesa de atendimento" nos relatórios de custos operacionais.
- **FR-027**: Quando um profissional mudar de modalidade no meio do mês, o relatório mensal MUST contabilizar atendimentos antes da mudança pela regra anterior; o pagamento fixo (se aplicável após a mudança) só será incluído no próximo dia de faturamento — sem dupla contagem no mês da transição.

### Key Entities

- **Modalidade de Pagamento (Payment Mode)**: rótulo aplicado a um profissional, podendo ser Comissionado, Fixo ou Liberal. Cada modalidade tem parâmetros próprios (percentual, valor mensal + dia, ou valor por participação). É historicamente versionada — mudanças são registradas em audit.
- **Profissional Assistente (Appointment Assistant)**: associação append-only entre um atendimento e um profissional Liberal. Tem valor por participação congelado no momento do registro. Vinculo é "soft" — remoção mantém o histórico para auditoria, apenas marca como não-mais-vinculado a partir de uma data.
- **Linha de Pagamento Fixo (Fixed Payment Line)**: lançamento mensal derivado do cadastro do Fixo. Aparece no relatório mensal no dia de faturamento configurado, classificado como despesa de pessoal.
- **Audit Log de Mudança de Modalidade**: registro imutável de cada troca de modalidade (ator, timestamp, modalidade anterior, modalidade nova, parâmetros antigos e novos).

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: Admin consegue cadastrar um profissional Fixo (modalidade + valor mensal + dia de faturamento) em menos de **2 minutos** sem consultar documentação.
- **SC-002**: 100% dos profissionais cadastrados antes do deploy desta feature aparecem como Comissionado após o deploy, sem qualquer ação manual e sem regressão visual no cadastro ou nos relatórios deles.
- **SC-003**: Em 100% dos atendimentos com assistente, o valor congelado da participação é preservado mesmo após o valor padrão do liberal ser alterado no cadastro (verificável comparando o valor exibido no atendimento com o valor exibido no cadastro do liberal após uma edição).
- **SC-004**: O resultado operacional, ao ser comparado com cálculo manual em uma amostra de 5 meses fechados, apresenta divergência de no máximo **R$ 0,02** (tolerância de arredondamento de centavos) em 100% dos casos.
- **SC-005**: A linha "Pagamento fixo — [profissional]" aparece automaticamente no relatório mensal no dia configurado em 100% dos meses subsequentes ao cadastro do Fixo — sem nenhuma intervenção do usuário.
- **SC-006**: 0 (zero) regressões em comissões existentes — todos os relatórios e cálculos relacionados a Comissionados continuam idênticos ao período pré-deploy quando avaliados sobre a mesma amostra de atendimentos.
- **SC-007**: Recepcionista consegue adicionar um assistente a um atendimento (incluindo abrir o seletor, escolher o liberal e salvar) em menos de **30 segundos**.
- **SC-008**: 95% das mudanças de modalidade têm seu registro de audit log consultável (ator, timestamp, valores antes/depois) — verificável via consulta direta ao audit log.

## Assumptions

- **Histórico congela na mudança de modalidade**: atendimentos já realizados não são recalculados quando o profissional troca de modalidade; a nova modalidade vale apenas para eventos futuros. Texto do usuário "Um profissional pode mudar de modalidade (histórico preservado em audit)" foi interpretado nesse sentido.
- **Liberal NÃO pode ser principal**: o seletor de profissional principal em atendimentos filtra para mostrar apenas Comissionados e Fixos. Um liberal só aparece no seletor de "assistente". O texto do usuário indica que o liberal "Cobra por participação como assistente", o que sugere exclusividade desse papel.
- **Fixos não geram comissão extra**: profissionais fixos podem realizar atendimentos (o sistema continua registrando isso para fins de produtividade e auditoria), mas não recebem comissão variável. Apenas o valor fixo mensal é pago, no dia configurado.
- **Dia de faturamento limitado a 1–28**: para garantir existência em todos os meses (incluindo fevereiro). Valores 29, 30, 31 não são oferecidos como opção.
- **Append-only em assistentes**: alterações na lista de assistentes (adição/remoção) são versionadas sem deletar registros; o relatório consulta a "visão atual" mas o histórico bruto fica preservado para auditoria.
- **RBAC herda do existente**: criar/editar atendimentos com assistentes segue os papéis que já criam atendimentos (admin, recepcionista). Visualização de relatórios segue os papéis financeiros existentes (admin, financeiro).
- **Custo de assistente em atendimentos estornados**: estorno do atendimento principal cancela o "ônus" do assistente — segue o status do pai. Isso evita o caso em que a clínica paga assistente por algo que nunca aconteceu.
- **Sem impacto em comprovantes/repasses ao paciente**: a feature afeta apenas o lado de custo operacional da clínica; o paciente paga o mesmo (faturamento bruto não muda).
- **Multi-tenancy preservado**: modalidades, assistentes e relatórios são isolados por tenant — não há vazamento entre clínicas. Segue o padrão RLS já em uso no sistema.
- **Deploy em janela única**: a feature é entregue como conjunto de migrations + UI; não há flag de rollout parcial entre clínicas dentro do MVP, mas as User Stories podem ser entregues em ordem (US1 → US2 → US3) em deploys separados se necessário.
