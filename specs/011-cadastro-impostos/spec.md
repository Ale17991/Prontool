# Feature Specification: Cadastro de Impostos e Imposto por Convênio

**Feature Branch**: `011-cadastro-impostos`
**Created**: 2026-05-13
**Status**: Draft
**Input**: User description: "Cadastro de impostos e imposto por convênio. (Feature 1) Cadastro de impostos da clínica em Despesas → Impostos com nome, alíquota, descrição, categoria (Municipal/Estadual/Federal/Outro), status. (Feature 2) Alíquota de imposto do convênio armazenada em `health_plans.tax_rate_bps`, com checkbox 'Convênio cobra imposto?' na página do convênio. (Feature 3) Despesa pode ser vinculada a imposto cadastrado via checkbox, categorizando-a como 'Impostos'. (Feature 4) Relatórios deduzem imposto do convênio e impostos da clínica do faturamento; dashboard exibe card 'Impostos' consolidado."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Cadastrar impostos da clínica (Priority: P1)

A administradora financeira da clínica precisa registrar os impostos a que a clínica está sujeita (ISS municipal, IRPJ/CSLL/PIS/COFINS federais, INSS, etc.) para uso futuro como referência ao classificar despesas e nos relatórios financeiros consolidados. Hoje os impostos são lançados de forma livre como despesa comum, dificultando a apuração de carga tributária.

**Why this priority**: É a fundação das demais features — sem impostos cadastrados, não há como vincular despesas (US3) nem totalizar a carga tributária da clínica nos relatórios (US4). É também a entrega de menor risco (CRUD simples por tenant, sem alterar tabelas existentes além de criar uma nova).

**Independent Test**: Como admin/financeiro, acesso Despesas → Impostos, cadastro "ISS 5%" como Municipal e o vejo na listagem com status ativo. Posso editar a alíquota para 5,5% e desativar (sem deletar). Um usuário com perfil "atendimento" vê a lista em modo leitura apenas.

**Acceptance Scenarios**:

1. **Given** sou admin e estou em Despesas → Impostos, **When** preencho "ISS" com alíquota 5,00, categoria Municipal e salvo, **Then** o imposto aparece na lista como ativo com a alíquota formatada como "5,00 %".
2. **Given** já existe o imposto "IRPJ" ativo, **When** clico em Desativar, **Then** o imposto permanece visível na lista com status "Inativo" e fica indisponível para vinculação em despesas futuras (US3), mas despesas já vinculadas continuam preservadas.
3. **Given** sou um usuário com perfil "atendimento", **When** acesso Despesas → Impostos, **Then** vejo a listagem dos impostos cadastrados mas não vejo botões de criar/editar/desativar.
4. **Given** já existe um imposto "ISS" ativo, **When** tento cadastrar outro com o mesmo nome (independente de maiúsculas/minúsculas) no mesmo tenant, **Then** a operação é bloqueada com mensagem "Já existe um imposto com este nome".

---

### User Story 2 - Definir alíquota de imposto do convênio (Priority: P1)

Cada convênio (operadora de plano de saúde) tem uma retenção tributária própria sobre o faturamento (ex.: 6,5%). A pessoa administradora precisa registrar essa alíquota diretamente no cadastro do convênio para que ela seja deduzida automaticamente nos relatórios por plano.

**Why this priority**: É independente da US1 (não exige impostos cadastrados) e habilita o cálculo correto da receita líquida por convênio nos relatórios (US4). Sem ela, o resultado operacional por plano fica inflado, impedindo decisões sobre quais convênios manter.

**Independent Test**: Edito o convênio "Unimed", marco "Convênio cobra imposto?" e informo 6,50%. Após salvar, a alíquota persiste e ao reabrir a página o checkbox está marcado e o campo preenchido com 6,50. Ao desmarcar e salvar, a alíquota volta a zero. A criação de um novo convênio também oferece o mesmo controle, desmarcado por padrão.

**Acceptance Scenarios**:

1. **Given** edito o convênio "Unimed" que ainda não tem alíquota cadastrada, **When** marco o checkbox "Convênio cobra imposto?", **Then** aparece o campo "Alíquota do convênio %" inicialmente vazio.
2. **Given** preenchi a alíquota com 6,50 e salvei, **When** reabro a página do mesmo convênio, **Then** o checkbox está marcado e o campo mostra 6,50.
3. **Given** um convênio com alíquota 6,50 cadastrada, **When** desmarco o checkbox e salvo, **Then** a alíquota é zerada e ao reabrir a página o checkbox volta a estar desmarcado.
4. **Given** estou criando um novo convênio, **When** abro o formulário, **Then** o checkbox "Convênio cobra imposto?" está desmarcado por padrão e o campo de alíquota não é exibido.
5. **Given** sou um usuário sem permissão para administrar convênios, **When** acesso a página do convênio, **Then** vejo a alíquota (se houver) mas não consigo editá-la.

---

### User Story 3 - Vincular despesa a imposto cadastrado (Priority: P2)

Ao lançar uma despesa, a pessoa do financeiro pode marcar que aquela despesa é o pagamento de um imposto cadastrado (US1). Isso categoriza automaticamente a despesa como "Impostos" e permite que os relatórios separem carga tributária das despesas operacionais.

**Why this priority**: Depende da US1 estar entregue. Sem ela, a despesa de imposto continua sendo lançada como despesa operacional comum — o sistema ainda funciona, mas a separação no relatório fica imprecisa.

**Independent Test**: Crio uma despesa, marco "Vincular a imposto cadastrado?", seleciono "ISS" no select. Após salvar, a despesa aparece categorizada como "Impostos" e referencia o imposto "ISS". Nos relatórios, ela é somada na coluna "Impostos da clínica" e não em "Despesas operacionais".

**Acceptance Scenarios**:

1. **Given** estou criando uma despesa e existem impostos ativos cadastrados, **When** marco "Vincular a imposto cadastrado?", **Then** aparece um select com apenas impostos ativos do tenant.
2. **Given** marquei o checkbox e selecionei "ISS", **When** salvo, **Then** a despesa é gravada com categoria "Impostos" e referência ao imposto selecionado.
3. **Given** o imposto "ISS" está inativo, **When** abro o select de impostos no formulário de despesa, **Then** "ISS" não aparece como opção.
4. **Given** uma despesa foi vinculada a um imposto que posteriormente foi desativado, **When** consulto a despesa, **Then** o vínculo é preservado e a referência ao imposto continua exibida (mesmo inativo) para fins de rastreabilidade histórica.
5. **Given** desmarco o checkbox no formulário, **When** salvo, **Then** o select desaparece e a despesa segue o fluxo de categorização padrão (sem vínculo com imposto).

---

### User Story 4 - Ver impacto nos relatórios e dashboard (Priority: P2)

A administração precisa ver, no relatório por plano e no dashboard financeiro, quanto cada convênio está retendo em impostos e quanto a clínica está pagando em impostos, separando isso das despesas operacionais.

**Why this priority**: Depende de US2 (alíquota do convênio) e idealmente também de US3 (vínculo despesa→imposto) para ser plenamente útil. Sem US4, as outras três entregam dados isolados mas o usuário não consegue ver o resultado consolidado.

**Independent Test**: No relatório por plano, para um convênio com alíquota 6,5% e faturamento bruto de R$ 10.000, vejo uma linha "Imposto do convênio: −R$ 650,00" deduzida do bruto. No dashboard financeiro, o card "Impostos" mostra a soma de (a) total retido pelos convênios + (b) total pago em despesas vinculadas a impostos cadastrados, no período filtrado.

**Acceptance Scenarios**:

1. **Given** no período filtrado um convênio com `tax_rate_bps = 650` faturou R$ 10.000 bruto, **When** abro o relatório por plano, **Then** vejo as linhas: Bruto R$ 10.000,00 / Imposto do convênio −R$ 650,00 / (demais deduções) / Líquido.
2. **Given** o resultado operacional consolidado, **When** o sistema o calcula, **Then** ele aplica a fórmula: `faturamento bruto − comissões − impostos do convênio − impostos da clínica − despesas operacionais = lucro`, em que "impostos da clínica" é a soma das despesas com vínculo a imposto cadastrado e "despesas operacionais" exclui essas mesmas despesas (não há dupla contagem).
3. **Given** estou na dashboard financeira, **When** observo o card "Impostos" no período selecionado, **Then** vejo o total consolidado (convênio + clínica) e o detalhamento entre os dois componentes ao expandir o card.
4. **Given** um convênio sem alíquota cadastrada (`tax_rate_bps = 0`), **When** o relatório por plano é gerado, **Then** a linha "Imposto do convênio" mostra R$ 0,00 (ou é omitida se a UI optar por suprimir linhas zeradas, mantendo o cálculo correto).

---

### Edge Cases

- **Alíquota com mais de duas casas decimais**: o sistema arredonda na entrada para duas casas (centésimos de ponto percentual) e armazena internamente em basis points (inteiro). Ex.: 6,505 → 6,51 → 651 bps.
- **Alíquota maior que 100% ou negativa**: bloqueada na validação com mensagem clara. Limite superior aceito: 100,00%.
- **Exclusão de imposto vinculado a despesas**: não é permitida exclusão física. O fluxo é apenas desativar (status=inactive), preservando a referência histórica das despesas vinculadas.
- **Edição de alíquota de imposto após despesas vinculadas**: a alíquota cadastrada é apenas "padrão de referência"; a despesa lançada é sempre um valor monetário absoluto, então alterar a alíquota do imposto não recalcula despesas antigas.
- **Mudança da alíquota do convênio no meio do período de um relatório**: o relatório aplica a alíquota *atual* do convênio sobre o faturamento bruto do período. Não há versionamento temporal de `tax_rate_bps` nesta versão. (Documentado como limitação intencional para manter o modelo simples — pode evoluir em feature futura se demanda surgir.)
- **Convênio com checkbox desmarcado mas `tax_rate_bps > 0` por estado legado**: na primeira edição após o deploy, o checkbox vem marcado se `tax_rate_bps > 0`, garantindo consistência com o dado existente.
- **Despesa vinculada a imposto + categoria manual conflitante**: ao marcar "Vincular a imposto", a categoria é forçada para "Impostos" e o campo de categoria manual fica desabilitado/oculto, evitando inconsistência.
- **Multi-tenant**: impostos são escopados por `tenant_id` (RLS); um tenant nunca vê impostos de outro. Alíquota do convênio também é por tenant (já que `health_plans` já é multi-tenant).

## Requirements *(mandatory)*

### Functional Requirements

**Cadastro de impostos (US1)**

- **FR-001**: O sistema MUST permitir, para usuários com perfil admin ou financeiro, cadastrar impostos da clínica com os campos: nome (obrigatório, texto curto), alíquota padrão em percentual com duas casas decimais (obrigatório, faixa 0,00 a 100,00), descrição (opcional, texto livre), categoria (obrigatório, valores fixos: Municipal, Estadual, Federal, Outro) e status (ativo/inativo, default ativo).
- **FR-002**: O sistema MUST armazenar a alíquota internamente em basis points (inteiro), onde 100 bps = 1,00 %. Conversão da entrada (5,00 → 500) e saída (500 → 5,00 %) MUST ser consistente e arredondar half-up no segundo decimal.
- **FR-003**: O sistema MUST impedir cadastro de dois impostos ativos com o mesmo nome (comparação case-insensitive e ignorando espaços em branco nas pontas) dentro do mesmo tenant.
- **FR-004**: O sistema MUST oferecer uma listagem dos impostos em Despesas → Impostos com colunas Nome | Alíquota | Categoria | Status | Ações (Editar, Desativar/Reativar), escopada ao tenant atual.
- **FR-005**: O sistema MUST permitir desativar e reativar um imposto sem perder o histórico; despesas previamente vinculadas a um imposto inativo MUST manter a referência.
- **FR-006**: O sistema MUST NOT permitir deleção física de impostos via UI. Apenas desativação.
- **FR-007**: Usuários sem perfil admin ou financeiro MUST poder visualizar a listagem em modo leitura, sem botões de criação/edição/desativação.

**Alíquota do convênio (US2)**

- **FR-008**: O modelo de dados de convênio (plano de saúde) MUST possuir uma alíquota tributária, armazenada como inteiro em basis points, com valor padrão 0 (zero = "não cobra imposto").
- **FR-009**: A página de edição do convênio (`/configuracoes/convenios/[id]`) e o formulário de novo convênio MUST exibir um checkbox "Convênio cobra imposto?", inicialmente desmarcado para novo convênio e marcado se a alíquota persistida do convênio for maior que zero.
- **FR-010**: Quando o checkbox estiver marcado, o sistema MUST exibir um único campo "Alíquota do convênio %" (faixa 0,01 a 100,00, duas casas decimais). Quando desmarcado, o campo MUST ficar oculto e o valor persistido MUST ser zerado ao salvar.
- **FR-011**: A persistência da alíquota do convênio MUST seguir as mesmas regras de RBAC já aplicadas à edição do cadastro do convênio (apenas admin/financeiro escrevem).
- **FR-012**: O sistema MUST NÃO criar uma tabela de relacionamento entre convênio e impostos cadastrados; a alíquota do convênio é um campo simples e independente dos impostos cadastrados em US1.

**Vínculo despesa→imposto (US3)**

- **FR-013**: O formulário de criação de despesa MUST oferecer um checkbox "Vincular a imposto cadastrado?", desmarcado por padrão.
- **FR-014**: Quando marcado, o formulário MUST exibir um select com os impostos *ativos* do tenant atual, ordenados por nome. Impostos inativos NÃO devem aparecer no select.
- **FR-015**: Ao salvar uma despesa com imposto vinculado, o sistema MUST definir automaticamente a categoria da despesa como "Impostos" e gravar a referência ao imposto selecionado.
- **FR-016**: Despesas com vínculo a imposto MUST manter a referência mesmo se o imposto for posteriormente desativado, para fins de rastreabilidade e relatórios históricos.
- **FR-017**: Ao desmarcar o checkbox no formulário antes de salvar, o sistema MUST limpar a seleção e seguir o fluxo padrão de categorização de despesas.

**Relatórios e dashboard (US4)**

- **FR-018**: No relatório por plano, o sistema MUST exibir uma linha "Imposto do convênio" calculada como `faturamento_bruto * tax_rate_bps / 10000`, deduzida do bruto, antes do líquido.
- **FR-019**: O cálculo de resultado operacional consolidado MUST aplicar a fórmula: `lucro = faturamento_bruto − comissões − impostos_do_convênio − impostos_da_clínica − despesas_operacionais`, garantindo que despesas vinculadas a impostos cadastrados sejam contadas apenas em "impostos_da_clínica" e excluídas de "despesas_operacionais".
- **FR-020**: A dashboard financeira MUST exibir um card "Impostos" no período filtrado, com o total consolidado (impostos retidos pelos convênios + impostos pagos pela clínica) e a possibilidade de detalhar os dois componentes.
- **FR-021**: O cálculo do imposto do convênio MUST usar a alíquota *atual* do convênio (não há versionamento histórico nesta versão).

**Auditoria e governança**

- **FR-022**: Toda criação, edição, desativação e reativação de imposto cadastrado MUST gerar um registro no log de auditoria existente, com `tenant_id`, ator, ação e valores antes/depois.
- **FR-023**: Toda alteração de alíquota do convênio MUST gerar um registro no log de auditoria, com valor anterior e novo.
- **FR-024**: Todas as operações de escrita MUST respeitar o RLS por `tenant_id` já vigente no sistema.

### Key Entities

- **Imposto da clínica (clinic_tax)**: representa um imposto a que a clínica está sujeita. Por tenant. Atributos: id, tenant_id, nome (único ativo por tenant), alíquota em basis points, descrição opcional, categoria (enum: Municipal/Estadual/Federal/Outro), status (ativo/inativo), timestamps e auditoria. Relaciona-se com Despesa (1:N via referência opcional).
- **Convênio / plano de saúde (health_plan, já existente)**: ganha o atributo *alíquota tributária do convênio em basis points* (inteiro, default 0). Sem novas relações.
- **Despesa (expense, já existente)**: ganha referência opcional ao imposto cadastrado. Quando preenchida, a categoria da despesa é forçada para "Impostos".

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A pessoa do financeiro consegue cadastrar um novo imposto da clínica (preencher nome, alíquota, categoria, salvar e vê-lo na listagem) em menos de 1 minuto na primeira tentativa.
- **SC-002**: A pessoa do administrador consegue ativar a cobrança de imposto em um convênio existente (marcar checkbox, digitar alíquota, salvar) em menos de 30 segundos.
- **SC-003**: O relatório por plano apresenta a linha "Imposto do convênio" deduzida corretamente do faturamento bruto em 100 % dos planos com alíquota > 0, com tolerância de 1 centavo por divergência de arredondamento.
- **SC-004**: O dashboard financeira consolida o total de impostos (convênio + clínica) do período filtrado em até 3 segundos a partir do clique no filtro, para tenants com até 12 meses de histórico carregado.
- **SC-005**: 100 % das operações de criação/edição/desativação de imposto e de alteração de alíquota do convênio são registradas no log de auditoria, validáveis por consulta no log.
- **SC-006**: Usuários sem perfil admin ou financeiro têm 0 % de capacidade de criar, editar ou desativar impostos via UI ou API (verificável por testes automatizados de RBAC).
- **SC-007**: Após o deploy, 100 % dos convênios já existentes preservam seu comportamento atual (alíquota = 0 por default, checkbox desmarcado), sem retrabalho manual de migração.

## Assumptions

- **Estrutura de despesas existente é suficiente**: a tabela de despesas já tem suporte a categorias livres; adicionar uma coluna opcional de referência ao imposto cadastrado e padronizar a categoria "Impostos" não requer mudanças disruptivas em fluxos existentes de despesas.
- **Identidade dos perfis admin/financeiro**: estes papéis já existem no sistema de RBAC (perfis com permissão para administrar configurações e despesas). Nenhum novo papel é introduzido por esta feature.
- **Alíquota do convênio sem versionamento histórico**: relatórios usarão sempre a alíquota atual do convênio, não a alíquota vigente no momento de cada atendimento/faturamento. Caso a clínica precise de versionamento histórico no futuro, será uma evolução posterior.
- **Basis points como unidade canônica**: a escolha de armazenar alíquotas como inteiro em basis points (e não decimal/float) é intencional para evitar problemas de arredondamento monetário. A UI converte para percentual com duas casas na exibição/entrada.
- **Sem deleção física**: tanto impostos quanto convênios seguem o padrão append-only/soft-delete já vigente no sistema. Isso preserva integridade referencial em despesas e relatórios históricos.
- **Categoria "Impostos" como string padronizada**: ao vincular despesa a imposto cadastrado, a categoria da despesa será gravada com o valor "Impostos" (string padronizada), compatível com a categorização atual de despesas.
- **Cálculo de relatórios é server-side**: as fórmulas descritas em FR-018 e FR-019 são executadas no backend para evitar divergências de arredondamento entre clientes e garantir consistência de auditoria.
- **Faturamento bruto do plano já é calculado**: a feature reutiliza o cálculo de faturamento bruto por plano já existente nos relatórios financeiros; não introduz nova lógica de faturamento.
- **Locale pt-BR**: entrada e exibição de alíquotas usa vírgula como separador decimal e símbolo "%" como sufixo, coerente com o restante do produto.
