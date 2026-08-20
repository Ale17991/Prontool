# Feature Specification: Custo de materiais e métrica "Gasto com materiais" no financeiro

**Feature Branch**: `045-custo-materiais-financeiro`
**Created**: 2026-07-09
**Status**: Draft
**Input**: User description: "Custo de materiais nos atendimentos e métrica 'Gasto com materiais' nos relatórios financeiros."

## Resumo

Hoje a clínica registra **quais** materiais foram usados em um atendimento e em **que quantidade**, mas não registra **quanto custaram**. Como consequência, o resultado financeiro e os relatórios mostram receita, comissões, impostos e despesas — mas nunca o custo dos insumos consumidos na cadeira. A clínica não enxerga a **margem real** de um procedimento, de um dentista ou de um convênio.

Esta feature permite (1) cadastrar insumos/materiais com custo unitário, (2) registrar o custo dos materiais consumidos em cada atendimento (congelado no momento do uso) e (3) apresentar uma nova métrica **"Gasto com materiais"** deduzida no resultado operacional e detalhada nos relatórios existentes (por profissional, por convênio, mensal), incluindo os arquivos exportados.

## Clarifications

### Session 2026-07-09

- Q: O custo de material desconta o quê no financeiro? → A: Apenas a margem da clínica — não altera comissão/repasse nem os fechamentos mensais.
- Q: De onde vem o custo unitário ao lançar o material no atendimento? → A: Do catálogo do insumo por padrão, com override opcional naquele lançamento (materiais fora do catálogo aceitam custo informado manualmente).
- Q: O que acontece se um material for lançado sem custo definido? → A: Aceita com custo 0 e sinaliza como pendência de custo — não bloqueia o atendimento.
- Q: E se um material custeado for adicionado a um atendimento de um mês já fechado? → A: Reflete só nos relatórios/resultado gerencial; não altera o fechamento de repasse daquele mês.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Registrar o custo dos materiais consumidos no atendimento (Priority: P1)

O responsável clínico cadastra os insumos que a clínica usa (ex.: resina composta, anestésico, luva, broca) com um custo unitário. Ao lançar o material em um atendimento, o sistema traz o custo do insumo e o congela junto com a quantidade, produzindo o custo total daquele material naquele atendimento. O custo fica preservado mesmo que o preço do insumo mude depois.

**Why this priority**: Sem capturar o custo por uso, nada mais existe — é a base de toda a feature. Já entrega valor isolado: a clínica passa a ter o histórico de quanto gastou de material em cada atendimento.

**Independent Test**: Cadastrar um insumo com custo, lançá-lo num atendimento e confirmar que o custo total (custo unitário × quantidade) fica registrado e imutável naquele atendimento, sem afetar receita nem repasse.

**Acceptance Scenarios**:

1. **Given** um insumo cadastrado com custo unitário de R$ 12,00, **When** o operador lança 3 unidades desse insumo num atendimento, **Then** o atendimento passa a ter um custo de material de R$ 36,00 associado.
2. **Given** um material já lançado num atendimento com custo congelado, **When** o custo do insumo é atualizado no catálogo, **Then** o custo já registrado naquele atendimento permanece inalterado.
3. **Given** um insumo do dia a dia que não é código TUSS (ex.: luva), **When** o operador o cadastra e lança, **Then** o sistema aceita normalmente (não exige TUSS).
4. **Given** um material que também é código TUSS tabela 19 (convênio), **When** o operador o vincula ao TUSS opcional, **Then** o fluxo de convênio/TISS continua funcionando como antes.

---

### User Story 2 - Ver o "Gasto com materiais" deduzido no resultado do mês (Priority: P2)

O gestor abre o resultado operacional do mês e vê uma nova linha **"Gasto com materiais"** deduzida do resultado, ao lado de comissões, impostos e despesas. O lucro do mês passa a refletir o custo real dos insumos consumidos.

**Why this priority**: É a melhoria financeira principal — mostrar o lucro já descontado o material. Depende da captura (US1).

**Independent Test**: Com materiais custeados lançados no mês, abrir o resultado operacional e confirmar que existe uma linha "Gasto com materiais" com o total do mês e que o lucro é `receita − comissões − pagamentos fixos − liberais − impostos − despesas − gasto com materiais`.

**Acceptance Scenarios**:

1. **Given** atendimentos no mês com R$ 800,00 de materiais custeados, **When** o gestor abre o resultado operacional do mês, **Then** a linha "Gasto com materiais" mostra R$ 800,00 e o lucro é reduzido nesse valor.
2. **Given** um atendimento estornado no mês, **When** o resultado é calculado, **Then** o custo dos materiais desse atendimento **não** entra no "Gasto com materiais".
3. **Given** a nova linha de gasto com materiais, **When** o gestor a observa, **Then** a receita bruta e a base de comissão/repasse dos profissionais permanecem inalteradas (o custo desconta só a margem da clínica).

---

### User Story 3 - Margem real por profissional e por convênio nos relatórios (Priority: P3)

O gestor abre os relatórios por profissional e por convênio e vê, além de receita e comissões, o **gasto com materiais** correspondente — enxergando quais dentistas e quais convênios consomem mais insumo e qual a margem real de cada um. O mesmo dado aparece nos arquivos exportados (Excel/PDF).

**Why this priority**: Aprofunda a análise; valioso mas incremental sobre US1+US2.

**Independent Test**: Lançar materiais custeados em atendimentos de dois profissionais/convênios diferentes e confirmar que cada relatório mostra o gasto com materiais atribuído corretamente e que os exports contêm a mesma informação.

**Acceptance Scenarios**:

1. **Given** materiais custeados em atendimentos do Dr. A e do Dr. B, **When** o gestor abre o relatório por profissional, **Then** cada profissional exibe seu gasto com materiais e sua margem após materiais.
2. **Given** o relatório por convênio, **When** o gestor exporta em Excel/PDF, **Then** o arquivo contém a coluna "Gasto com materiais".

---

### User Story 4 - Gerenciar o catálogo de insumos (Priority: P3)

O responsável clínico mantém o catálogo de insumos: cria, edita o custo e desativa itens. Alterações de custo são registradas para auditoria, sem alterar custos já congelados em atendimentos passados.

**Why this priority**: Necessário para manter os custos atualizados ao longo do tempo, mas o cadastro mínimo já é coberto na US1.

**Independent Test**: Editar o custo de um insumo e confirmar que novos usos passam a usar o novo custo, enquanto usos antigos preservam o custo original, e que a alteração fica auditada.

**Acceptance Scenarios**:

1. **Given** um insumo com custo R$ 10,00, **When** o custo é alterado para R$ 14,00, **Then** novos lançamentos usam R$ 14,00 e os anteriores continuam R$ 10,00.
2. **Given** um insumo desativado, **When** o operador vai lançar material num atendimento, **Then** o insumo desativado não aparece para novos lançamentos (mas continua visível no histórico).

---

### Edge Cases

- **Material sem custo definido**: se um material é lançado sem custo (insumo não cadastrado ou custo zero), o sistema aceita o lançamento com custo 0, não infla o gasto com materiais e sinaliza o material como pendência de custo, para ser completado depois. O custo também pode ser informado manualmente no momento do uso.
- **Atendimento estornado**: materiais de atendimentos estornados são excluídos do "Gasto com materiais" em todos os relatórios.
- **Alteração de custo após o uso**: o custo registrado no atendimento é um retrato (snapshot) do momento do uso e nunca muda retroativamente.
- **Mês já fechado**: adicionar um material custeado a um atendimento de um mês já fechado atualiza os relatórios e o resultado gerencial, mas NÃO altera o fechamento de repasse daquele mês (o custo não entra no repasse).
- **Fuso horário do mês**: o gasto com materiais respeita as mesmas fronteiras de mês (fuso da clínica) usadas pelo resultado operacional.
- **Material TUSS de convênio**: continua funcionando; o custo é uma informação adicional e não interfere na geração de guias/lotes TISS.

## Requirements _(mandatory)_

### Functional Requirements

**Catálogo de insumos**

- **FR-001**: O sistema DEVE permitir cadastrar insumos/materiais por clínica com nome e custo unitário (em centavos), independentemente de serem códigos TUSS.
- **FR-002**: O sistema DEVE permitir vincular, opcionalmente, um insumo a um código TUSS tabela 19, sem tornar o TUSS obrigatório.
- **FR-003**: O sistema DEVE permitir editar o custo de um insumo e desativá-lo, mantendo os itens desativados visíveis no histórico mas indisponíveis para novos lançamentos.
- **FR-004**: O sistema DEVE registrar em auditoria a criação, alteração de custo e desativação de insumos.

**Captura do custo no atendimento**

- **FR-005**: Ao lançar um material num atendimento, o sistema DEVE registrar o custo unitário e a quantidade como um retrato (snapshot) congelado no momento do uso, produzindo o custo total daquele material naquele atendimento.
- **FR-006**: O custo registrado num atendimento DEVE ser imutável — alterações posteriores no catálogo NÃO DEVEM alterar custos já registrados.
- **FR-007**: O custo unitário DEVE vir por padrão do catálogo do insumo e PODE ser ajustado (override) no momento do lançamento; materiais fora do catálogo DEVEM aceitar custo informado manualmente.
- **FR-008**: A adição de custo NÃO DEVE quebrar o fluxo atual de materiais TUSS usados para convênio/TISS.
- **FR-020**: Quando um material for lançado sem custo definido, o sistema DEVE aceitar o lançamento com custo 0 (sem inflar o gasto) e sinalizar o material como pendência de custo, para ser completado depois — sem bloquear o atendimento.

**Reflexo no resultado financeiro**

- **FR-009**: O sistema DEVE apresentar uma métrica "Gasto com materiais" igual à soma dos custos totais dos materiais dos atendimentos ativos do período.
- **FR-010**: O "Gasto com materiais" DEVE ser deduzido no resultado operacional como uma linha nova, resultando em: receita − comissões − pagamentos fixos − liberais − impostos − despesas − gasto com materiais = lucro.
- **FR-011**: O custo de materiais NÃO DEVE reduzir a receita bruta nem a base de comissão/repasse do profissional (desconta apenas a margem da clínica). [Decisão D1]
- **FR-012**: Atendimentos estornados DEVEM ser excluídos do cálculo do "Gasto com materiais".
- **FR-013**: O "Gasto com materiais" DEVE respeitar as mesmas fronteiras de mês (fuso da clínica) já usadas pelo resultado operacional.
- **FR-021**: Adicionar um material custeado a um atendimento de um mês já fechado DEVE atualizar os relatórios e o resultado gerencial, mas NÃO DEVE alterar o fechamento de repasse daquele mês (coerente com FR-011 — o custo não é repasse).

**Métrica nos relatórios**

- **FR-014**: O sistema DEVE exibir o "Gasto com materiais" no relatório de resultado operacional, com acesso ao detalhamento (drilldown) dos materiais que compõem o total.
- **FR-015**: O sistema DEVE exibir o "Gasto com materiais" no relatório por profissional, permitindo ver a margem real de cada profissional.
- **FR-016**: O sistema DEVE exibir o "Gasto com materiais" no relatório por convênio/plano.
- **FR-017**: O sistema DEVE incluir o "Gasto com materiais" nos relatórios mensal/financeiro e nos respectivos arquivos exportados (Excel e PDF).

**Segurança e multi-clínica**

- **FR-018**: Todo dado de custo (catálogo e uso) DEVE ser isolado por clínica (tenant), respeitando as regras de acesso existentes.
- **FR-019**: O registro de uso de material DEVE permanecer append-only (o custo é gravado na inserção e não é editável), consistente com o comportamento atual da tabela de materiais do atendimento.

### Key Entities _(include if feature involves data)_

- **Insumo (catálogo de materiais)**: item que a clínica consome, com nome, custo unitário (centavos), situação (ativo/desativado) e vínculo TUSS opcional. Pertence a uma clínica.
- **Material usado no atendimento**: registro de que um insumo foi consumido num atendimento, com quantidade e custo unitário congelado no momento do uso (snapshot), do qual deriva o custo total. Estende o registro de materiais já existente.
- **Linha "Gasto com materiais"**: métrica agregada derivada dos materiais usados no período, apresentada como dedução no resultado e como coluna nos relatórios (por profissional, por convênio, mensal).

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: A clínica consegue registrar o custo de um material consumido num atendimento em menos de 30 segundos, a partir de um insumo já cadastrado.
- **SC-002**: O resultado operacional do mês passa a exibir a linha "Gasto com materiais" e o lucro reflete essa dedução — verificável comparando o lucro antes e depois de lançar materiais custeados.
- **SC-003**: 100% dos materiais de atendimentos estornados são excluídos do "Gasto com materiais".
- **SC-004**: O custo registrado num atendimento permanece idêntico após qualquer alteração de preço no catálogo (0% de variação retroativa).
- **SC-005**: O gestor consegue identificar, por profissional e por convênio, quanto foi gasto em material no período, diretamente nos relatórios e nos arquivos exportados.
- **SC-006**: A introdução do custo não altera nenhum valor de receita bruta nem de repasse já calculado (0% de variação nesses números).

## Assumptions

- **Moeda e precisão**: valores monetários em centavos (BRL), consistentes com o restante do financeiro.
- **Decisão D1 (confirmada em 2026-07-09)**: o custo de material desconta apenas a margem da clínica; não altera a base de comissão/repasse do profissional nem os fechamentos mensais existentes.
- **Decisão D2 (confirmada em 2026-07-09)**: o catálogo de insumos é livre (não restrito a TUSS tabela 19), com vínculo TUSS opcional para compatibilidade com convênio/TISS.
- **Origem do custo (confirmada em 2026-07-09)**: o custo unitário vem do catálogo por padrão, com override por lançamento; materiais fora do catálogo aceitam custo manual.
- **Snapshot de custo**: o custo é congelado no momento do uso, seguindo o padrão de "congelamento" já adotado no projeto para descrições e valores.
- **Reuso**: a feature reaproveita o registro de materiais do atendimento já existente e os relatórios financeiros já existentes; não cria um relatório novo do zero.
- **Fora de escopo**: alterar a base de repasse/comissão do dentista; controle de estoque/inventário (a feature rastreia apenas custo por uso, não saldo em estoque); precificação/venda de materiais ao paciente.
- **Dependências**: depende do registro de materiais do atendimento e do cálculo de resultado operacional/relatórios já existentes no sistema.
