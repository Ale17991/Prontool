# Feature Specification: Micronutrientes, DRIs, Análise de Adequação e Recordatório Alimentar (R24h)

**Feature Branch**: `049-micronutrientes-dri-recordatorio`
**Created**: 2026-07-27
**Status**: Draft
**Input**: Completar a paridade da vertical de nutrição com as planilhas base (`nutri-doc/Evonut.xlsm`, `nutri-doc/AF..xlsm`): micronutrientes na base de alimentos, tabela de DRIs, análise de adequação e recordatório alimentar (R24h). Itens de **prioridade alta** do gap analysis.

## Clarifications

### Session 2026-07-27

- Q: Estratégia da base de micronutrientes (a atual é TACO/POF sem micros; a BD ALIMENTOS da AF tem 6570 alimentos COM micros)? → A: Importar a **BD ALIMENTOS da AF como base global autoritativa com micros, coexistindo** com a atual (consistente com as listas de equivalência já importadas; alimentos/planos existentes seguem funcionando).
- Q: O recordatório é de um dia (R24h clássico) ou período configurável? → A: **Um dia (R24h clássico)** — as refeições de um dia.
- Q: Como classificar a adequação de cada nutriente vs. a DRI? → A: **<90% abaixo · 90–110% adequado · >110% acima** (faixa padrão, ajustável depois; não bloqueia, só informa).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Micronutrientes na base de alimentos (Priority: P1)

A nutricionista precisa enxergar não só energia e macronutrientes, mas também os **micronutrientes** (vitaminas, minerais, colesterol, tipos de gordura, açúcares) dos alimentos e do plano montado. Hoje a base só tem energia, proteína, carboidrato, lipídio e fibra. As planilhas que ela usava traziam ~37 micronutrientes por alimento (por 100 g).

**Why this priority**: É **pré-requisito** das outras três histórias — sem os valores de micronutrientes nos alimentos, não há o que somar nem comparar. Sozinha já entrega valor: mostrar o perfil de micronutrientes de um alimento e o total do plano.

**Independent Test**: Buscar um alimento e ver seus micronutrientes; montar um plano e ver os totais de micronutrientes do dia somados corretamente; cadastrar um alimento próprio informando (opcionalmente) micronutrientes.

**Acceptance Scenarios**:

1. **Given** a base de alimentos com micronutrientes, **When** a nutricionista busca um alimento, **Then** vê seus micronutrientes por porção de referência (cálcio, ferro, vitaminas etc.), além de energia/macros/fibra.
2. **Given** um plano alimentar com vários itens, **When** ela monta o cardápio, **Then** os totais do dia incluem os micronutrientes somados por regra de três, batendo com a soma manual.
3. **Given** o cadastro de alimento próprio, **When** ela informa (opcionalmente) valores de micronutrientes, **Then** eles são salvos e passam a contar nos planos que usam esse alimento.
4. **Given** um alimento sem valor para um micronutriente (dado ausente na fonte), **When** ele entra no plano, **Then** o total daquele micronutriente ignora o ausente e sinaliza que o valor pode estar subestimado.

---

### User Story 2 - Análise de adequação (plano × recomendação) (Priority: P2)

Dado um plano alimentar (ou um recordatório) e o paciente (idade e sexo já no cadastro), a nutricionista quer ver **quão adequado** o plano está frente à recomendação de ingestão (DRI) daquele paciente: por nutriente, o quanto ele atinge da recomendação (**abaixo / adequado / acima**), destacando carências e excessos.

**Why this priority**: É a leitura clínica que transforma "o plano tem X mg de ferro" em "o plano cobre 80% do ferro recomendado para esta paciente". Depende da US1 (micros nos alimentos) e da tabela de DRIs.

**Independent Test**: Com um paciente de idade/sexo conhecidos e um plano montado, abrir a análise e conferir o % de adequação de energia, macros e micronutrientes contra a DRI correspondente, com a classificação abaixo/adequado/acima.

**Acceptance Scenarios**:

1. **Given** um paciente com idade e sexo no cadastro e um plano montado, **When** a nutricionista abre a análise de adequação, **Then** vê, por nutriente, o total do plano, a recomendação (DRI) e o % de adequação classificado (abaixo/adequado/acima).
2. **Given** um nutriente muito abaixo ou muito acima da recomendação, **When** a análise é exibida, **Then** ele é destacado como carência ou excesso.
3. **Given** um paciente sem idade/sexo no cadastro, **When** a análise é aberta, **Then** o sistema pede/permite informar idade e sexo para escolher a faixa de DRI, sem bloquear o resto.
4. **Given** um nutriente sem DRI definida na tabela, **When** a análise roda, **Then** ele aparece com o total, mas sem % de adequação (marcado "sem referência").

---

### User Story 3 - Recordatório alimentar (R24h) (Priority: P3)

A nutricionista quer registrar o que o paciente **de fato comeu** num período (recordatório de 24h): montar as refeições com alimentos e quantidades (reusando a busca e as medidas caseiras da base), ver energia/macros/micros ao vivo e rodar a análise de adequação sobre o que foi consumido. Mantém histórico por paciente para comparar com o plano prescrito.

**Why this priority**: É um segundo modo de entrada (consumo real, não planejado) que reusa toda a base da US1/US2. Tem módulo de entitlement próprio (`nutri_recordatorio`) já previsto, hoje sem tela.

**Independent Test**: Com o módulo `nutri_recordatorio` ligado, criar um recordatório para um paciente, adicionar refeições e alimentos com quantidades, ver os totais ao vivo, salvar, e reabrir o histórico.

**Acceptance Scenarios**:

1. **Given** o módulo `nutri_recordatorio` ativo, **When** a nutricionista abre a tela de recordatório e escolhe um paciente, **Then** pode montar refeições com alimentos e quantidades (gramas ou medida caseira) e ver energia/macros/micros somados ao vivo.
2. **Given** um recordatório preenchido, **When** ela salva, **Then** ele fica registrado no histórico do paciente com data e totais.
3. **Given** um recordatório salvo, **When** ela abre a análise de adequação sobre ele, **Then** vê o consumo × DRI do paciente (mesma leitura da US2).
4. **Given** o módulo `nutri_recordatorio` desligado, **When** alguém tenta acessar a tela, **Then** o item de menu some e o acesso direto por URL é negado.

---

### Edge Cases

- **Micronutriente ausente na fonte**: alimentos sem valor para um nutriente não devem quebrar a soma; o total ignora o ausente e sinaliza possível subestimação.
- **Idade/sexo do paciente ausentes**: a análise permite informar manualmente sem travar; sem esses dados não há como escolher a faixa de DRI.
- **Faixa etária pediátrica / gestante / lactante**: a DRI muda; a tabela deve cobrir as faixas presentes na fonte (`BD_DRIs`), e a análise escolher a faixa certa por idade/sexo (e estado quando informado).
- **Alimento próprio sem micros**: continua válido; conta como zero (com sinalização) nos micronutrientes.
- **Unidades**: micronutrientes vêm em mg/mcg conforme o nutriente; a soma e a comparação devem respeitar a unidade de cada um.
- **Isolamento multi-tenant**: alimentos próprios e recordatórios de uma clínica não aparecem em outra; a base global e a tabela de DRIs são compartilhadas.

## Requirements *(mandatory)*

### Functional Requirements

**Micronutrientes (US1)**
- **FR-001**: O sistema MUST associar a cada alimento (base global e próprio da clínica) um conjunto de micronutrientes por porção de referência, cobrindo ao menos os presentes na fonte `BD ALIMENTOS` da planilha AF: cálcio, magnésio, manganês, fósforo, ferro, sódio, sódio de adição, potássio, cobre, zinco, selênio, retinol, vitamina A, tiamina (B1), riboflavina (B2), niacina (B3), equivalente de B3, piridoxina (B6), cobalamina (B12), folato, vitamina D, vitamina E, vitamina C, colesterol, ácidos graxos saturados, monoinsaturados e poli-insaturados (incluindo 18:2 e 18:3), gordura trans, açúcar total e açúcar de adição.
- **FR-002**: O sistema MUST importar a `BD ALIMENTOS` (planilha AF, 6570 alimentos, valores por 100 g) como base global autoritativa de micronutrientes, **coexistindo** com a base atual (TACO/POF); alimentos próprios e planos existentes seguem funcionando.
- **FR-003**: Os cálculos de total do plano alimentar e do recordatório MUST somar os micronutrientes por regra de três sobre a porção, além de energia e macros.
- **FR-004**: O cadastro de alimento próprio MUST permitir informar micronutrientes (todos opcionais); ausência de um valor é tratada como desconhecida (não zero forçado) e sinalizada nos totais.
- **FR-005**: A busca/visualização de alimento MUST exibir os micronutrientes disponíveis de forma legível (com unidade de cada um).

**DRIs (US2)**
- **FR-006**: O sistema MUST manter uma tabela de referência de ingestão recomendada (DRI) por micronutriente, faixa etária e sexo, incluindo estados especiais quando presentes na fonte (gestante/lactante), a partir da fonte `BD_DRIs` (planilha Evonut) usada como gabarito.
- **FR-007**: A tabela de DRIs MUST ser um catálogo global (compartilhado por todas as clínicas), não editável pela clínica.

**Análise de adequação (US2)**
- **FR-008**: O sistema MUST calcular, para um plano ou recordatório e um paciente, a adequação por nutriente = total consumido/planejado ÷ recomendação (DRI) da faixa do paciente, expressa em % e classificada em **abaixo (<90%) / adequado (90–110%) / acima (>110%)** — faixa padrão ajustável, não-bloqueante.
- **FR-009**: A análise MUST destacar carências (muito abaixo) e excessos (muito acima) e cobrir energia, macros e micronutrientes.
- **FR-010**: A idade usada MUST ser derivada da data de nascimento do paciente quando disponível; sexo, do cadastro; ambos ajustáveis manualmente na tela sem bloquear.
- **FR-011**: Nutrientes sem DRI aplicável MUST aparecer com o total mas sem % de adequação, marcados como "sem referência".

**Recordatório (US3)**
- **FR-012**: O sistema MUST permitir criar e editar um recordatório alimentar de **um dia (R24h)** por paciente, com refeições e itens (alimento + quantidade em gramas ou medida caseira), reusando a busca de alimentos e as medidas caseiras existentes.
- **FR-013**: O recordatório MUST calcular energia/macros/micros ao vivo (mesmo motor de soma do plano) e permitir rodar a análise de adequação sobre ele.
- **FR-014**: O sistema MUST manter histórico de recordatórios por paciente (data e totais), visível para a equipe.
- **FR-015**: O acesso ao recordatório MUST ser controlado pelo módulo `nutri_recordatorio` (item de menu e rota negados quando desligado) e pelos papéis já usados na vertical de nutrição.

**Transversais**
- **FR-016**: Alimentos próprios e recordatórios MUST ser isolados por clínica (multi-tenant); a base global de alimentos e a tabela de DRIs são compartilhadas.
- **FR-017**: Os números MUST bater entre a tela (cálculo ao vivo) e o que é gravado/relido — soma sem divergência além de arredondamento.

### Key Entities *(include if feature involves data)*

- **Alimento (estendido)**: além de energia/macros/fibra, carrega os micronutrientes por porção de referência. Global (compartilhado) ou próprio da clínica.
- **DRI (recomendação)**: valor recomendado de um micronutriente por faixa etária, sexo e estado (padrão/gestante/lactante). Catálogo global.
- **Recordatório**: registro de consumo de um paciente num período (refeições + itens com quantidade), com data e totais. Por clínica.
- **Análise de adequação**: leitura derivada (não necessariamente persistida) que cruza os totais de um plano/recordatório com a DRI da faixa do paciente, produzindo % e classificação por nutriente.
- **Paciente**: fonte de idade (data de nascimento) e sexo para escolher a faixa de DRI (reuso do cadastro existente).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Ao abrir um alimento da base, a nutricionista vê os micronutrientes disponíveis daquele alimento (cobrindo os ~37 da fonte quando presentes).
- **SC-002**: Os totais de micronutrientes de um plano/recordatório batem exatamente com a soma manual dos itens (à parte arredondamento) — verificável com um caso conhecido.
- **SC-003**: Para um paciente com idade e sexo definidos, a análise de adequação mostra, para cada nutriente com DRI, o % de adequação e a classificação abaixo/adequado/acima.
- **SC-004**: A nutricionista consegue registrar um recordatório de um dia (4–5 refeições, ~15 itens) e ver os totais + a análise de adequação em menos de 10 minutos.
- **SC-005**: Com o módulo `nutri_recordatorio` desligado, a tela não aparece no menu e o acesso direto por URL é negado.
- **SC-006**: Alimentos próprios e recordatórios de uma clínica não são visíveis em outra; a base global e as DRIs aparecem em todas.

## Assumptions

- **Fonte dos micronutrientes** (decidido — ver Clarifications): a `BD ALIMENTOS` da planilha AF (6570 alimentos, energia+macros+micros por 100 g) é importada como **base global autoritativa de micronutrientes, coexistindo** com a base atual (TACO/POF, ~2568 alimentos sem micros). É a base própria da nutricionista e já é referenciada pelas listas de equivalência importadas; planos e alimentos próprios existentes seguem funcionando.
- **Fonte das DRIs**: a `BD_DRIs` da planilha Evonut é o gabarito; o padrão de referência que ela encoda é adotado como está (não se reinterpreta a ciência aqui).
- **Faixas de classificação** (decidido — ver Clarifications): <90% abaixo, 90–110% adequado, >110% acima. Padrão ajustável, não-bloqueante — só informa (mesmo espírito dos avisos da 046).
- **Sem novas dependências**: todo o cálculo é aritmética simples (regra de três + comparação), motor isomórfico cliente/servidor, como na 046/047.
- **Reuso**: busca de alimentos, medidas caseiras, motor de soma do plano, seletor de paciente (com criação e preenchimento de idade/sexo já entregues), gating por módulo e RLS por tenant são reaproveitados; nada disso é recriado.
- **Faseamento**: US1 (micros na base) é pré-requisito; US2 (DRIs + adequação) vem depois; US3 (recordatório) reusa as duas. A validação clínica dos valores (micros e DRIs contra a fonte) fica como polish com a nutricionista, análogo ao T047 da 047.
- **Fora de escopo (por ora)**: exames laboratoriais, rótulo nutricional, percentis/curvas pediátricas, FODMAP e impressos/PDF — são outros itens do gap analysis, não desta feature.
