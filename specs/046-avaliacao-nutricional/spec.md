# Feature Specification: Avaliação Nutricional

**Feature Branch**: `046-avaliacao-nutricional`
**Created**: 2026-07-16
**Status**: Draft
**Input**: User description: "Avaliação nutricional (módulo `nutri_avaliacao`): antropometria/composição corporal por dobras cutâneas + gasto energético (TMB/GET) + metas, como tela própria no menu, reusando o motor de medições longitudinais (feature 030)."

## Visão Geral

Dá ao profissional de nutrição uma **tela de avaliação** onde, a partir de um paciente, ele registra medidas (dobras cutâneas, circunferências, peso/altura) e parâmetros clínicos, e o sistema **calcula automaticamente** a composição corporal (percentual de gordura, massa gorda e magra, IMC, relação cintura-quadril) e as **necessidades energéticas** (taxa metabólica basal, gasto energético total e valor energético da meta, com distribuição de macronutrientes). Cada avaliação é um **registro imutável** (retrato da consulta) que também **alimenta o histórico de medições** do paciente, aproveitando os gráficos de evolução, metas e portal do paciente já existentes.

Disponível apenas para clínicas com o módulo **`nutri_avaliacao`** ativado no painel de administração.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Avaliar composição corporal por dobras cutâneas (Priority: P1)

O profissional abre a tela de Avaliação Nutricional, seleciona o paciente, escolhe um protocolo de dobras cutâneas, informa as dobras exigidas por aquele protocolo (mais circunferências e peso/altura) e vê, ao vivo, o percentual de gordura, a massa gorda e magra, o IMC com classificação e a relação cintura-quadril com classificação. Ao salvar, a avaliação fica registrada e os resultados entram na evolução do paciente.

**Why this priority**: É o cálculo central e o motivo pelo qual a nutricionista hoje mantém planilhas próprias — sem ele não há "avaliação". Entrega valor sozinho (a clínica passa a medir composição corporal dentro do sistema).

**Independent Test**: Selecionar um paciente, escolher um protocolo, inserir dobras/medidas e conferir que os resultados calculados batem com os valores de referência conhecidos daquele protocolo; salvar e confirmar que a avaliação aparece no histórico.

**Acceptance Scenarios**:

1. **Given** um paciente com sexo e data de nascimento cadastrados, **When** o profissional escolhe um protocolo e informa as dobras exigidas, **Then** o sistema exibe percentual de gordura, massa gorda, massa magra, IMC (com classificação) e RCQ (com classificação) calculados.
2. **Given** um protocolo escolhido, **When** falta uma das dobras exigidas por ele, **Then** o sistema sinaliza o campo faltante e não conclui o cálculo daquele bloco.
3. **Given** os resultados calculados, **When** o profissional salva a avaliação, **Then** ela é gravada de forma imutável e os derivados (percentual de gordura, massa magra, IMC) passam a compor o histórico de medições do paciente.
4. **Given** o paciente já tem bioimpedância registrada, **When** o profissional escolhe "bioimpedância" como fonte de composição, **Then** o percentual de gordura é usado diretamente (sem exigir dobras).

---

### User Story 2 - Calcular necessidades energéticas (TMB → GET → meta) (Priority: P1)

Na mesma avaliação, o profissional escolhe a equação de taxa metabólica basal, o nível de atividade física e, quando aplicável, um fator de injúria/estresse ou o adicional de gestação; informa o objetivo (déficit, manutenção ou superávit) e a distribuição de macronutrientes. O sistema calcula a taxa metabólica basal, o gasto energético total, o valor energético da meta e os gramas de cada macronutriente.

**Why this priority**: Junto com a composição corporal, é o núcleo da consulta nutricional e a base para prescrever o plano alimentar. Entrega valor mesmo sem o plano (a clínica já obtém a meta calórica e de macros do paciente).

**Independent Test**: Informar peso/altura/idade/sexo (e massa magra quando a equação exigir), escolher equação + atividade + objetivo, e conferir que taxa metabólica basal, gasto energético total, valor energético da meta e macros batem com o cálculo de referência.

**Acceptance Scenarios**:

1. **Given** dados do paciente e uma equação escolhida, **When** o profissional define nível de atividade e objetivo, **Then** o sistema exibe taxa metabólica basal, gasto energético total e valor energético da meta.
2. **Given** uma equação baseada em massa magra, **When** não há composição corporal disponível, **Then** o sistema orienta a preencher a composição (ou escolher outra equação) antes de calcular.
3. **Given** o valor energético da meta e uma distribuição de macronutrientes, **When** os percentuais de macros não somam 100%, **Then** o sistema sinaliza a inconsistência.
4. **Given** uma paciente gestante/lactante, **When** o profissional marca a condição, **Then** o adicional energético correspondente é aplicado ao gasto energético total.
5. **Given** uma avaliação salva, **When** ela é gravada, **Then** taxa metabólica basal e gasto energético total entram no histórico de medições do paciente.

---

### User Story 3 - Acompanhar a evolução do paciente (Priority: P2)

O profissional consulta as avaliações anteriores de um paciente e vê a evolução dos principais indicadores (peso, percentual de gordura, massa magra, gasto energético) ao longo do tempo, reaproveitando os gráficos de evolução já existentes.

**Why this priority**: Acompanhamento é o valor recorrente da nutrição, mas depende de haver ao menos uma avaliação (US1/US2). Reusa a infraestrutura de medições, então é incremental.

**Independent Test**: Com duas ou mais avaliações do mesmo paciente, abrir o histórico e confirmar que as avaliações estão listadas e que a evolução dos indicadores aparece nos gráficos.

**Acceptance Scenarios**:

1. **Given** um paciente com avaliações registradas, **When** o profissional abre o histórico, **Then** vê a lista de avaliações (data, protocolo/equação, principais resultados) da mais recente para a mais antiga.
2. **Given** um paciente com pelo menos duas avaliações, **When** o profissional visualiza a evolução, **Then** os indicadores aparecem em gráficos ao longo do tempo.

---

### User Story 4 - Definir metas do paciente (Priority: P3)

O profissional define metas (peso-alvo, percentual de gordura-alvo) e a meta energética/macros para o paciente, que passam a ser exibidas junto da evolução.

**Why this priority**: Complementa o acompanhamento, mas não é pré-requisito para avaliar. Reusa o mecanismo de metas de métrica já existente.

**Independent Test**: Definir peso-alvo e %gordura-alvo e confirmar que a meta aparece junto da evolução do paciente.

**Acceptance Scenarios**:

1. **Given** um paciente avaliado, **When** o profissional define peso-alvo e/ou percentual de gordura-alvo, **Then** a meta é salva e exibida junto da evolução.

---

### Edge Cases

- Paciente **sem data de nascimento ou sexo** cadastrados: equações e protocolos dependem desses dados — o sistema deve orientar a completar o cadastro antes de calcular.
- **Faixa etária fora do protocolo** (ex.: protocolo infantil aplicado a adulto, ou vice-versa): o sistema deve avisar quando o protocolo/equação não é indicado para a idade informada.
- **Valores implausíveis** (dobra, peso, altura ou circunferência fora de faixa fisiológica): o sistema deve barrar valores impossíveis (erro de digitação) antes de calcular/salvar.
- **Correção de uma avaliação**: como o registro é imutável, corrigir significa **criar uma nova avaliação** — a anterior permanece na trilha.
- **Módulo desativado**: se a clínica não tem `nutri_avaliacao`, a tela e o item de menu não aparecem, e o acesso direto por URL é negado.
- **Isolamento entre clínicas**: uma avaliação nunca pode ser lida ou associada a paciente de outra clínica.

## Requirements *(mandatory)*

### Functional Requirements

**Acesso e escopo**
- **FR-001**: O sistema MUST expor a Avaliação Nutricional como uma **tela própria no menu**, visível apenas quando a clínica tem o módulo `nutri_avaliacao` ativado.
- **FR-002**: O sistema MUST permitir criar/salvar avaliações apenas para os papéis **administrador** e **profissional de saúde**; demais papéis não criam avaliações.
- **FR-003**: O sistema MUST restringir toda avaliação ao paciente e à clínica corrente (isolamento por clínica).

**Composição corporal (US1)**
- **FR-004**: O sistema MUST oferecer os protocolos de dobras cutâneas: **Jackson-Pollock 3 dobras**, **Jackson-Pollock 7 dobras**, **Durnin-Womersley**, **Faulkner**, **Guedes**, **Slaughter (infantil)** e **bioimpedância** (entrada direta de percentual de gordura).
- **FR-005**: Para cada protocolo, o sistema MUST indicar **quais dobras** são exigidas e validar que foram informadas antes de calcular.
- **FR-006**: O sistema MUST calcular **densidade corporal → percentual de gordura** (fórmula de Siri ou Brozek), **massa gorda** e **massa magra** a partir das dobras e do peso.
- **FR-007**: O sistema MUST calcular **IMC** e sua **classificação**, e a **relação cintura-quadril** e sua **classificação**, a partir de peso/altura/circunferências.
- **FR-008**: O sistema MUST diferenciar os coeficientes por **sexo** e respeitar a **faixa etária** de validade de cada protocolo.

**Necessidades energéticas (US2)**
- **FR-009**: O sistema MUST oferecer as equações de taxa metabólica basal: **Mifflin-St Jeor**, **Harris-Benedict (1984)**, **FAO/OMS (Schofield, por faixa etária)**, **Katch-McArdle**, **Cunningham** e **EER/IOM**.
- **FR-010**: O sistema MUST calcular a **taxa metabólica basal** conforme a equação escolhida (usando massa magra quando a equação exigir).
- **FR-011**: O sistema MUST aplicar um **fator de atividade física** e, quando informado, um **fator de injúria/estresse** e o **adicional de gestação/lactação** para obter o **gasto energético total**.
- **FR-012**: O sistema MUST calcular o **valor energético da meta** como gasto energético total ajustado por objetivo (déficit/manutenção/superávit, em kcal ou percentual).
- **FR-013**: O sistema MUST calcular a **distribuição de macronutrientes** (gramas de proteína, carboidrato e lipídio) a partir do valor energético da meta e da distribuição informada (por percentual e/ou por grama por quilo), validando que os percentuais somam 100%.

**Registro e histórico (US1/US2/US3)**
- **FR-014**: O sistema MUST persistir cada avaliação como um **registro imutável** contendo as entradas (medidas, protocolo/equação, fatores) e os resultados calculados (retrato da consulta).
- **FR-015**: Ao salvar, o sistema MUST **lançar os indicadores derivados** (percentual de gordura, massa magra, massa gorda, IMC, taxa metabólica basal, gasto energético total) no **histórico de medições longitudinais** do paciente.
- **FR-016**: O sistema MUST exibir o **histórico de avaliações** do paciente (mais recente primeiro) e a **evolução** dos indicadores ao longo do tempo.
- **FR-017**: O sistema MUST tratar correção como **nova avaliação**, preservando as anteriores.

**Metas (US4)**
- **FR-018**: O sistema MUST permitir definir **metas** do paciente (peso-alvo, percentual de gordura-alvo) reaproveitando o mecanismo de metas de métrica existente, e exibi-las junto da evolução.

**Qualidade e conformidade**
- **FR-019**: O sistema MUST **barrar valores implausíveis** (fora de faixa fisiológica) nas entradas antes de calcular/salvar.
- **FR-020**: O sistema MUST **auditar** a criação de cada avaliação (quem, quando, para qual paciente).
- **FR-021**: O sistema MUST orientar o profissional quando faltarem **dados obrigatórios do paciente** (sexo, data de nascimento) ou quando o **protocolo/equação não for indicado para a idade**.

### Key Entities *(include if feature involves data)*

- **Avaliação Nutricional**: o retrato imutável de uma consulta de avaliação. Pertence a um paciente e a uma clínica; guarda data, sexo/idade considerados, peso e altura, dobras cutâneas e circunferências informadas, protocolo de composição escolhido, equação de taxa metabólica basal escolhida, fatores (atividade, injúria, gestação, objetivo, distribuição de macros) e todos os resultados calculados (densidade, percentual de gordura, massa gorda/magra, IMC e classificação, relação cintura-quadril e classificação, taxa metabólica basal, gasto energético total, valor energético da meta e macros). Autor e data de criação registrados.
- **Indicador de medição (existente)**: os resultados-chave da avaliação (percentual de gordura, massa magra/gorda, IMC, taxa metabólica basal, gasto energético total) são registrados como medições longitudinais do paciente, reaproveitando o catálogo de métricas, os gráficos de evolução e o portal do paciente.
- **Meta de métrica (existente)**: peso-alvo e percentual de gordura-alvo do paciente.
- **Módulo `nutri_avaliacao` (existente)**: o entitlement que habilita a feature por clínica, administrável no painel `/admin`.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Um profissional consegue concluir uma avaliação completa (composição + energia) de um paciente já cadastrado em **menos de 5 minutos**.
- **SC-002**: Os resultados calculados (percentual de gordura por protocolo, taxa metabólica basal, gasto energético total, macros) **coincidem com os valores de referência** dos respectivos métodos para casos-teste conhecidos (diferença apenas de arredondamento).
- **SC-003**: Após salvar uma avaliação, os indicadores derivados aparecem no **histórico de medições e nos gráficos de evolução** do paciente sem qualquer passo manual adicional.
- **SC-004**: Clínicas **sem** o módulo `nutri_avaliacao` não veem a tela nem o item de menu, e o acesso direto é negado (**0** vazamentos de acesso).
- **SC-005**: **100%** das avaliações são imutáveis e auditadas; nenhuma edição destrutiva é possível (correção sempre gera novo registro).
- **SC-006**: Nenhuma avaliação é lida ou associada a paciente de **outra clínica** (isolamento verificado por teste).

## Assumptions

- **Reuso do motor de medições (feature 030)**: os indicadores derivados são gravados no mecanismo de medições longitudinais já existente; a métrica de **gasto energético total** (em kcal) será acrescentada ao catálogo de métricas.
- **Dados do paciente**: sexo e data de nascimento vêm do cadastro do paciente; peso e altura podem vir de medições/sinais vitais recentes ou ser informados na própria avaliação.
- **Persistência dedicada**: a avaliação é guardada em uma estrutura própria (retrato da consulta), separada das medições, para preservar entradas e método usados — decisão confirmada com o solicitante.
- **Métodos v1 (núcleo)**: o conjunto de equações e protocolos acima é o escopo da primeira versão; métodos adicionais das planilhas de referência (ex.: Tinsley, Henry, Petroski, EER 2023) podem ser somados depois, pois são apenas novos coeficientes.
- **Metas**: reaproveitam o mecanismo de metas de métrica já existente; a meta energética/macros fica registrada na própria avaliação.
- **Plano alimentar fora de escopo**: a montagem do cardápio e a base de alimentos são de outra frente (módulo `dieta`) e não fazem parte desta feature.
- **Fora de escopo v1**: percentis infantis detalhados e módulo gestacional completo além do adicional energético; rótulo nutricional; recordatório alimentar; exames laboratoriais (frentes/módulos próprios).
- **Constituição**: imutabilidade (correção = novo registro), auditoria de escrita clínica, isolamento por clínica e validação de papéis server-side seguem os padrões já adotados no projeto.
