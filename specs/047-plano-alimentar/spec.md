# Feature Specification: Plano Alimentar

**Feature Branch**: `047-plano-alimentar`
**Created**: 2026-07-16
**Status**: Draft
**Input**: User description: "Plano alimentar (módulo `dieta`): cadastro de alimentos com seus nutrientes (base pronta TACO/IBGE + cadastro próprio da clínica), grupos alimentares, listas de substituição/equivalentes, e montagem de cardápio por refeições com cálculo automático de energia/macros e comparação com a meta da avaliação nutricional."

## Visão Geral

Dá ao profissional de nutrição um **construtor de plano alimentar**: a partir de uma **base de alimentos** (com energia e macronutrientes por porção), ele monta o **cardápio do paciente por refeição**, com **opções de substituição** organizadas por **grupo alimentar**, e o sistema **soma automaticamente** os nutrientes por refeição e por dia, comparando com a **meta** (calorias e macros) definida na Avaliação Nutricional (feature 046). O plano prescrito é entregue ao paciente no portal.

É a contraparte da Avaliação: **a Avaliação define a meta; o Plano Alimentar a realiza.** Disponível apenas para clínicas com o módulo **`dieta`** ativado no painel de administração.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Ter uma base de alimentos utilizável (Priority: P1)

O profissional consulta uma **base de alimentos pronta** (padrão TACO/IBGE) e também **cadastra seus próprios alimentos** (com marcas, porções e nutrientes), incluindo a medida caseira. Cada alimento tem grupo alimentar e valores nutricionais por porção de referência.

**Why this priority**: Sem alimentos com nutrientes, não há cálculo nem cardápio — é a fundação de tudo. Entrega valor sozinha (a clínica passa a ter um catálogo nutricional consultável).

**Independent Test**: Buscar um alimento da base pronta e conferir seus nutrientes; cadastrar um alimento próprio com porção e macros e confirmar que ele fica disponível só para a clínica.

**Acceptance Scenarios**:

1. **Given** a base pronta carregada, **When** o profissional busca um alimento, **Then** vê nome, grupo, porção de referência, medida caseira e nutrientes (energia, proteína, carboidrato, lipídio, fibra).
2. **Given** um alimento próprio, **When** o profissional o cadastra com porção e macros, **Then** ele fica disponível **apenas para a clínica dele** e não afeta a base global nem outras clínicas.
3. **Given** um alimento sem energia informada, **When** é salvo, **Then** a energia é calculada a partir dos macros (proteína×4 + carboidrato×4 + lipídio×9).
4. **Given** um alimento próprio criado, **When** a clínica edita/desativa esse alimento, **Then** os planos passados que já o usam **preservam os valores** que estavam vigentes quando foram prescritos.

---

### User Story 2 - Montar o cardápio com cálculo automático (Priority: P1)

O profissional cria um plano alimentar para o paciente, organiza-o em **refeições** (café, almoço, lanche, jantar…) e adiciona **itens** (alimento + quantidade/medida caseira). O sistema soma **energia e macros por refeição e por dia** e mostra a comparação com a **meta** do paciente.

**Why this priority**: É o coração da prescrição dietética e o motivo do módulo. Entrega valor com a base do US1 (a clínica monta e calcula cardápios).

**Independent Test**: Criar um plano com algumas refeições e itens e conferir que os totais por refeição e por dia batem com a soma dos alimentos, e que a comparação com a meta aparece.

**Acceptance Scenarios**:

1. **Given** um paciente e alimentos na base, **When** o profissional adiciona itens a uma refeição, **Then** o sistema mostra os totais de energia e macros da refeição e do dia atualizados ao vivo.
2. **Given** um plano com meta definida na avaliação, **When** o profissional monta o cardápio, **Then** o sistema mostra a diferença entre o total do plano e a meta (calorias e macros).
3. **Given** um item com quantidade em medida caseira, **When** é adicionado, **Then** o sistema converte para gramas e calcula os nutrientes proporcionalmente.
4. **Given** um plano em elaboração, **When** o profissional o **prescreve**, **Then** o plano vira uma versão registrada (retrato imutável do que foi prescrito) e fica disponível para entrega.

---

### User Story 3 - Grupos alimentares e substituições/equivalentes (Priority: P2)

O profissional organiza alimentos por **grupo alimentar** e monta **listas de substituição** (opções equivalentes dentro de um grupo). No cardápio, cada item pode ter **opções "ou"** — alimentos do mesmo grupo com valor nutricional equivalente — que o paciente pode trocar.

**Why this priority**: É o que dá flexibilidade ao paciente (o "OU" das planilhas) e agiliza a montagem, mas depende da base e do cardápio (US1/US2).

**Independent Test**: Definir uma porção equivalente para um grupo e associar alimentos; conferir que, ao usar o grupo no cardápio, as opções equivalentes aparecem como substituições.

**Acceptance Scenarios**:

1. **Given** um grupo alimentar com porção equivalente definida, **When** o profissional associa alimentos ao grupo, **Then** eles ficam disponíveis como opções de substituição equivalentes.
2. **Given** um item no cardápio com substituições, **When** o paciente/profissional troca por uma opção "ou", **Then** o total do plano permanece coerente com o grupo (equivalência nutricional).

---

### User Story 4 - Entregar o plano ao paciente (Priority: P2)

O plano prescrito é **entregue ao paciente** — visível na seção "Plano alimentar" do portal do paciente e disponível para impressão/compartilhamento.

**Why this priority**: A entrega é o valor final para o paciente, mas depende de existir um plano prescrito (US2).

**Independent Test**: Prescrever um plano e confirmar que o paciente o vê no portal e que há uma versão para impressão.

**Acceptance Scenarios**:

1. **Given** um plano prescrito, **When** o paciente acessa o portal, **Then** vê o plano alimentar vigente (refeições, itens e substituições).
2. **Given** um plano prescrito, **When** o profissional gera a versão para entrega, **Then** o conteúdo corresponde exatamente ao que foi prescrito.

---

### Edge Cases

- **Alimento sem nutrientes completos**: o sistema deve exigir ao menos energia ou os macros para permitir o cálculo; campos de micronutrientes são opcionais.
- **Edição da base após prescrição**: alterar/desativar um alimento **não** pode mudar planos já prescritos (o valor usado é congelado no momento da prescrição).
- **Conversão de medida caseira**: quando o alimento não tem medida caseira definida, o item deve exigir a quantidade em gramas.
- **Plano sem avaliação/meta**: deve ser possível montar o plano mesmo sem meta (a comparação simplesmente não é exibida), mas quando há meta, ela é mostrada.
- **Isolamento entre clínicas**: alimentos próprios e planos de uma clínica nunca são visíveis para outra; a base pronta é global e somente leitura.
- **Módulo desativado**: sem o módulo `dieta`, a tela e o item de menu não aparecem e o acesso direto é negado.

## Requirements *(mandatory)*

### Functional Requirements

**Acesso e escopo**
- **FR-001**: O sistema MUST expor o Plano Alimentar apenas quando a clínica tem o módulo `dieta` ativado.
- **FR-002**: O sistema MUST permitir criar/editar/prescrever planos e cadastrar alimentos próprios apenas para os papéis **administrador** e **profissional de saúde**.
- **FR-003**: O sistema MUST isolar por clínica os alimentos próprios e os planos; a base pronta é **global e somente leitura**.

**Base de alimentos (US1)**
- **FR-004**: O sistema MUST oferecer uma **base de alimentos pronta** (padrão TACO/IBGE) consultável por todas as clínicas.
- **FR-005**: O sistema MUST permitir **cadastro de alimentos próprios** por clínica, com nome, grupo alimentar, porção de referência, medida caseira e nutrientes.
- **FR-006**: Cada alimento MUST registrar ao menos energia e macronutrientes (proteína, carboidrato, lipídio) e fibra; micronutrientes são **opcionais**.
- **FR-007**: O sistema MUST calcular a energia a partir dos macros (Atwater: proteína×4 + carboidrato×4 + lipídio×9) quando ela não for informada.
- **FR-008**: O sistema MUST permitir **medidas caseiras** (equivalência medida→gramas) por alimento.

**Cardápio e cálculo (US2)**
- **FR-009**: O sistema MUST permitir montar um plano organizado em **refeições**, cada uma com **itens** (alimento + quantidade em gramas ou medida caseira).
- **FR-010**: O sistema MUST **somar automaticamente** energia e macros por refeição e por dia, atualizando ao vivo conforme o cardápio muda.
- **FR-011**: O sistema MUST **comparar** o total do plano com a **meta** (calorias e macros) do paciente definida na Avaliação Nutricional, quando existir.
- **FR-012**: O sistema MUST converter quantidades em medida caseira para gramas e calcular os nutrientes proporcionalmente à porção de referência.
- **FR-013**: O sistema MUST permitir **prescrever** o plano, gerando uma **versão registrada** (retrato imutável do que foi prescrito, com os valores nutricionais congelados).

**Grupos e substituições (US3)**
- **FR-014**: O sistema MUST manter um catálogo de **grupos alimentares** e permitir associar alimentos a grupos.
- **FR-015**: O sistema MUST permitir definir **listas de substituição/equivalentes** por grupo (porção equivalente + alimentos elegíveis) e usá-las como opções "ou" no cardápio.

**Entrega (US4)**
- **FR-016**: O sistema MUST disponibilizar o plano prescrito ao paciente na seção **"Plano alimentar" do portal** e em versão para **impressão/compartilhamento**.

**Proveniência e atribuição das fontes**
- **FR-020**: O sistema MUST registrar a **fonte** de cada alimento (TACO, IBGE/POF ou cadastro próprio da clínica) e exibi-la ao profissional na tela do catálogo. A atribuição das bases oficiais — **"Fonte: Tabela Brasileira de Composição de Alimentos – TACO, 4ª ed., NEPA/UNICAMP, 2011"** e **"IBGE, POF 2008-2009"** — MUST aparecer na tela do catálogo e em **todo material exportado/impresso** que contenha valores nutricionais dessas bases. *(A citação da TACO é condição da licença de uso da base, não item estético.)*

**Qualidade e conformidade**
- **FR-017**: O sistema MUST **congelar** os valores nutricionais usados no momento da prescrição, de modo que edições posteriores na base não alterem planos já prescritos.
- **FR-018**: O sistema MUST **auditar** a prescrição de planos e o cadastro/edição de alimentos próprios.
- **FR-019**: O sistema MUST **barrar valores implausíveis** nos nutrientes e quantidades (erro de digitação) antes de salvar.

### Key Entities *(include if feature involves data)*

- **Alimento**: item da base nutricional. Global (base TACO/IBGE, somente leitura) **ou** próprio da clínica. Guarda nome, grupo alimentar, porção de referência (em gramas), medida(s) caseira(s) e valores nutricionais por porção (energia, proteína, carboidrato, lipídio, fibra e micronutrientes opcionais) com a fonte.
- **Grupo alimentar**: categoria (proteínas, carboidratos, frutas, gorduras, laticínios, leguminosas…) usada para organizar e para as listas de substituição.
- **Lista de substituição/equivalentes**: por grupo, define uma porção equivalente e os alimentos que se encaixam (as opções "ou").
- **Plano alimentar**: o cardápio do paciente, organizado em refeições e itens (alimento + quantidade). Tem estado de elaboração e, quando prescrito, uma **versão registrada** com valores congelados.
- **Meta (existente, feature 046)**: calorias e macros-alvo do paciente, usados para a comparação — vêm da Avaliação Nutricional.
- **Módulo `dieta` (existente)**: o entitlement que habilita a feature por clínica.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Um profissional consegue montar um cardápio de um dia (várias refeições) para um paciente em **menos de 10 minutos**, usando a base de alimentos.
- **SC-002**: Os totais de energia e macros (por refeição e por dia) **conferem exatamente** com a soma dos itens (diferença apenas de arredondamento).
- **SC-003**: Quando há meta definida na avaliação, o profissional vê a **diferença entre plano e meta** sem nenhum passo manual.
- **SC-004**: Editar ou desativar um alimento **não altera** nenhum plano já prescrito (valores congelados verificados por teste).
- **SC-005**: Alimentos próprios e planos de uma clínica **nunca** são visíveis para outra (isolamento verificado por teste).
- **SC-006**: Clínicas **sem** o módulo `dieta` não veem a tela nem o item de menu, e o acesso direto é negado.
- **SC-007**: O paciente vê no portal **exatamente** o plano que foi prescrito.
- **SC-008**: A atribuição das fontes oficiais (TACO, IBGE/POF) aparece na tela do catálogo e em todo material impresso/exportado com valores nutricionais dessas bases.

## Assumptions

- **Base pronta = catálogo global**: a base é semeada como catálogo global somente leitura (padrão dos catálogos existentes, ex.: tabela de procedimentos); os alimentos próprios são por clínica (padrão de métricas customizadas já existente no projeto). **Fonte da base pronta (definido na pesquisa, ver `research.md` D1)**: **IBGE/POF 2008-2009** como espinha dorsal (única base pública com **medida caseira** de licença utilizável) + **TACO 4ª ed.** sobreposta nos alimentos onde existe (análise laboratorial brasileira; licença de atribuição). A **TBCA foi descartada** por licença CC BY-NC-ND (proíbe uso comercial e alteração). *Risco aberto*: a licença do IBGE é **não confirmada** (estatística pública, redistribuição sem outorga expressa) — mitigação é confirmar com o IBGE antes de clientes que auditam fornecedor.
- **Ausência de industrializados/marcas**: ambas as bases oficiais são de 2011 e **não contêm produtos industrializados nem marcas comerciais** (ex.: "Whey marca X", "iogurte marca Y"). Por isso o **cadastro de alimentos próprios por clínica (US1) é condição de viabilidade do módulo**, não conveniência — é o que cobre o dia a dia do consultório.
- **Conexão com a Avaliação (046)**: a meta (calorias/macros) vem da feature 046 quando existir; o plano também funciona **sem** meta (sem a comparação).
- **Reuso do portal do paciente**: a entrega usa a seção "Plano alimentar" já existente no portal; o armazenamento de plano existente (estrutura básica atual) é estendido, não recriado.
- **Versionamento por prescrição**: o plano é editável enquanto em elaboração; ao prescrever, gera uma versão imutável (padrão de versionamento já usado no projeto para preços/comissões).
- **Nutrientes v1**: o cálculo e a comparação com a meta focam **energia e macronutrientes** (proteína, carboidrato, lipídio, fibra); micronutrientes são cadastráveis e exibíveis, mas a análise detalhada vs. DRI fica para depois.
- **Fora de escopo v1**: classificação FODMAP, recordatório alimentar, rótulo nutricional e exames laboratoriais são frentes/módulos próprios; análise completa de micronutrientes vs. DRI; geração de lista de compras.
- **Constituição**: imutabilidade do que foi prescrito, auditoria, isolamento por clínica e validação de papéis server-side seguem os padrões do projeto.
