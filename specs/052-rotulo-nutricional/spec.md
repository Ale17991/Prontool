# Feature Specification: Rótulo Nutricional de Produto

**Feature Branch**: `052-rotulo-nutricional`
**Created**: 2026-07-29
**Status**: Draft
**Input**: Geração da tabela de informação nutricional de um produto alimentício conforme a legislação brasileira de rotulagem, a partir de um preparo com ingredientes e quantidades. Inclui a determinação automática da rotulagem nutricional frontal ("lupa"). Gated pelo módulo `nutri_rotulo`, que já existe no catálogo de módulos mas ainda não tem tela. Origem: aba "Rótulos Nutricionais" de `nutri-doc/AF..xlsm`.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Gerar a tabela nutricional de um produto (Priority: P1)

A nutricionista atende um cliente que **vende** comida (marmitaria, confeitaria, padaria). Ela monta o preparo — os ingredientes e quanto entra de cada um —, informa o rendimento total da receita, o tamanho da porção e quantas porções há na embalagem. O sistema calcula e exibe a tabela **INFORMAÇÃO NUTRICIONAL** pronta para a embalagem, com as três colunas exigidas (por 100 g ou 100 mL, por porção, e %VD da porção).

**Why this priority**: É o produto da consultoria. Sem isso não há entrega; hoje a conta é feita numa planilha e transcrita à mão para a arte da embalagem, com risco de erro de digitação.

**Independent Test**: Montar um preparo simples (ex.: bolo de cenoura com 6 ingredientes), informar rendimento de 1200 g e porção de 60 g, e conferir a tabela resultante contra o cálculo manual.

**Acceptance Scenarios**:

1. **Given** um preparo com ingredientes e quantidades e um rendimento total informado, **When** a nutricionista gera o rótulo, **Then** o sistema exibe a tabela com valor energético, carboidratos totais, açúcares totais, açúcares adicionados, proteínas, gorduras totais, gorduras saturadas, gorduras trans, fibra alimentar e sódio, nas colunas por 100 g/100 mL, por porção e %VD.
2. **Given** um rendimento total e um tamanho de porção, **When** a tabela é calculada, **Then** os valores por porção correspondem à proporção entre a porção e o rendimento total, e os valores por 100 g/100 mL à proporção equivalente.
3. **Given** um produto líquido, **When** a nutricionista indica que a base é mililitros, **Then** a coluna de referência passa a ser 100 mL e os limites da rotulagem frontal usados são os de líquidos.
4. **Given** um ingrediente sem informação de um nutriente na base, **When** a tabela é gerada, **Then** o nutriente aparece sinalizado como **incompleto** — nunca como zero — e a nutricionista é avisada de que precisa informar o valor antes de usar o rótulo.
5. **Given** uma medida caseira informada (ex.: "1 fatia"), **When** o rótulo é exibido, **Then** a porção aparece como "Porção de X g (1 fatia)".

---

### User Story 2 - Completar e corrigir valores à mão (Priority: P1)

A base de alimentos não cobre todos os nutrientes de todos os itens — especialmente gorduras trans e açúcares. A nutricionista precisa poder **informar ou sobrescrever** qualquer valor da tabela, e o rótulo precisa deixar claro o que veio da base e o que foi informado por ela.

**Why this priority**: Sem isso, a US1 não produz um rótulo utilizável na maior parte dos casos reais — a cobertura de açúcares adicionados na base é baixa. É requisito de viabilidade, não melhoria.

**Independent Test**: Gerar um rótulo com um ingrediente sem dado de açúcares adicionados, informar o valor à mão, e conferir que a tabela recalcula e passa a marcar aquele nutriente como informado manualmente.

**Acceptance Scenarios**:

1. **Given** um nutriente marcado como incompleto, **When** a nutricionista informa o valor, **Then** a tabela recalcula e o nutriente deixa de estar incompleto.
2. **Given** um nutriente calculado pela base, **When** a nutricionista sobrescreve o valor, **Then** o valor informado prevalece e fica visivelmente distinguível do valor calculado.
3. **Given** um valor sobrescrito, **When** a nutricionista desfaz a sobrescrita, **Then** o valor volta ao calculado pela base.
4. **Given** um rótulo com nutrientes ainda incompletos, **When** a nutricionista tenta finalizá-lo, **Then** o sistema avisa quais faltam e não trata a ausência como zero.

---

### User Story 3 - Rotulagem frontal (a "lupa") (Priority: P2)

O sistema informa automaticamente se o produto se enquadra como **alto em açúcares adicionados**, **alto em gorduras saturadas** ou **alto em sódio**, comparando a composição com os limites da norma e distinguindo produtos sólidos de líquidos.

**Why this priority**: É obrigatório na embalagem quando o produto se enquadra, e é a informação que o cliente da nutricionista mais desconhece. Depende da US1 (composição calculada).

**Independent Test**: Gerar o rótulo de um produto notoriamente doce e conferir que o sistema aponta "alto em açúcares adicionados"; repetir com um produto neutro e conferir que não aponta nada.

**Acceptance Scenarios**:

1. **Given** um produto sólido cuja composição ultrapassa o limite de açúcares adicionados por 100 g, **When** o rótulo é gerado, **Then** o sistema indica que a embalagem deve trazer a marca de alto em açúcares adicionados.
2. **Given** um produto líquido, **When** a avaliação é feita, **Then** são usados os limites de líquidos, e não os de sólidos.
3. **Given** um produto que não ultrapassa nenhum limite, **When** o rótulo é gerado, **Then** nenhuma marca frontal é indicada.
4. **Given** um nutriente relevante para a lupa ainda incompleto, **When** a avaliação é feita, **Then** o sistema informa que **não é possível concluir** sobre aquela marca — em vez de concluir que o produto não se enquadra.

---

### User Story 4 - Salvar e imprimir o rótulo (Priority: P2)

A nutricionista salva o rótulo por cliente/produto para reabrir e ajustar depois, e exporta uma versão para impressão que o cliente leva para a gráfica ou para o designer da embalagem.

**Why this priority**: Sem salvar, cada consulta recomeça do zero. Sem exportar, a informação continua sendo transcrita à mão — que é justamente o erro que a feature quer eliminar.

**Independent Test**: Salvar um rótulo, fechar, reabrir e conferir que todos os campos e valores informados manualmente foram preservados; exportar e conferir o documento.

**Acceptance Scenarios**:

1. **Given** um rótulo preenchido, **When** a nutricionista salva, **Then** ele fica associado ao cliente/produto e pode ser reaberto com todos os valores, inclusive os informados manualmente.
2. **Given** um rótulo salvo, **When** a nutricionista exporta para impressão, **Then** o documento traz a tabela, a lista de ingredientes, os alérgenos, as instruções de conservação e as marcas frontais aplicáveis.
3. **Given** um rótulo com nutrientes incompletos, **When** a nutricionista exporta, **Then** o documento deixa explícito que o rótulo está incompleto e não deve ser usado na embalagem.

---

### Edge Cases

- **Rendimento menor que a porção**: a porção não pode ser maior que o rendimento total — o sistema recusa e explica.
- **Rendimento não informado**: sem ele não há como converter para 100 g nem para a porção; o cálculo não prossegue.
- **Perda por cocção**: o rendimento final costuma ser menor que a soma dos ingredientes crus (evaporação). O rendimento é informado pela nutricionista, não deduzido da soma — é o que torna o cálculo correto.
- **Produto com um único ingrediente**: caso válido, sem tratamento especial.
- **Valores muito pequenos**: as regras de arredondamento da norma definem quando um valor é declarado como zero; isso é diferente de "dado desconhecido".
- **Ingrediente próprio da clínica**: alimentos cadastrados pela própria clínica valem como ingrediente, com os mesmos avisos de dado faltante.
- **Isolamento multi-tenant**: rótulos de uma clínica não aparecem em outra.

## Requirements *(mandatory)*

### Functional Requirements

**Composição do preparo (US1)**

- **FR-001**: O sistema MUST permitir montar um preparo com N ingredientes e a quantidade de cada um, reusando a base de alimentos existente (global e própria da clínica).
- **FR-002**: O sistema MUST exigir o **rendimento total** do preparo (em gramas ou mililitros), informado pela nutricionista, e MUST NOT deduzi-lo da soma dos ingredientes.
- **FR-003**: O sistema MUST permitir informar o **tamanho da porção**, a **medida caseira** correspondente e a **quantidade de porções por embalagem**.
- **FR-004**: O sistema MUST identificar se o produto é **sólido** (base 100 g) ou **líquido** (base 100 mL).

**Tabela nutricional (US1)**

- **FR-005**: O sistema MUST declarar exatamente os nutrientes obrigatórios da norma: valor energético, carboidratos totais, açúcares totais, açúcares adicionados, proteínas, gorduras totais, gorduras saturadas, gorduras trans, fibra alimentar e sódio.
- **FR-006**: O sistema MUST exibir cada nutriente em três colunas: por 100 g/100 mL, por porção, e **%VD** da porção.
- **FR-007**: O %VD MUST ser calculado sobre os **valores diários de referência fixados na norma**, iguais para todos os produtos. O sistema MUST NOT usar metas nutricionais de nenhum paciente para esse cálculo.
- **FR-008**: O sistema MUST aplicar as regras de arredondamento da norma na apresentação dos valores.
- **FR-009**: Nutrientes que a norma não associa a valor diário MUST ser exibidos sem %VD.

**Dado faltante (US2)**

- **FR-010**: Quando um ingrediente não tiver informação de um nutriente, o sistema MUST tratar como **desconhecido** e MUST NOT somar como zero.
- **FR-011**: O sistema MUST sinalizar visivelmente cada nutriente cujo total esteja incompleto, indicando quais ingredientes faltam.
- **FR-012**: A nutricionista MUST poder informar ou sobrescrever o valor de qualquer nutriente, e o sistema MUST distinguir na tela o valor calculado do valor informado.
- **FR-013**: O sistema MUST permitir desfazer uma sobrescrita, voltando ao valor calculado.

**Rotulagem frontal (US3)**

- **FR-014**: O sistema MUST avaliar, para açúcares adicionados, gorduras saturadas e sódio, se o produto ultrapassa os limites da norma, usando os limites de sólidos ou de líquidos conforme o caso.
- **FR-015**: Quando um nutriente relevante estiver incompleto, o sistema MUST informar que a avaliação daquela marca é **inconclusiva**, e MUST NOT concluir pela ausência da marca.

**Salvar e exportar (US4)**

- **FR-016**: O sistema MUST permitir salvar o rótulo identificado por cliente e produto, preservando ingredientes, quantidades, rendimento, porção, valores informados manualmente, lista de ingredientes, alérgenos e instruções de conservação.
- **FR-017**: O sistema MUST permitir exportar o rótulo para impressão, incluindo tabela, ingredientes, alérgenos, conservação e marcas frontais.
- **FR-018**: A exportação de um rótulo com nutrientes incompletos MUST deixar explícito que ele não está pronto para uso na embalagem.

**Transversais**

- **FR-019**: O acesso MUST ser controlado pelo módulo `nutri_rotulo` (item de menu e rota negados quando desligado) e pelos papéis admin/profissional_saude.
- **FR-020**: Rótulos MUST ser isolados por clínica.
- **FR-021**: O sistema MUST registrar a versão da referência normativa usada no cálculo, para que um rótulo antigo continue explicável quando a norma mudar.

### Key Entities *(include if feature involves data)*

- **Rótulo**: um produto de um cliente da clínica — nome do produto, nome do cliente, tipo (sólido/líquido), rendimento total, tamanho da porção, medida caseira, porções por embalagem, texto de ingredientes, alérgenos, conservação. Por clínica.
- **Ingrediente do rótulo**: um alimento da base e a quantidade usada no preparo. Pertence a um rótulo.
- **Valor informado manualmente**: substituição de um nutriente pelo valor que a nutricionista declarou, com a marca de origem. Pertence a um rótulo.
- **Valor diário de referência**: tabela fixa da norma, igual para todas as clínicas — não editável pela clínica.
- **Limite de rotulagem frontal**: por nutriente e por tipo de produto (sólido/líquido), fixado na norma.
- **Resultado do rótulo**: leitura derivada — a tabela em três colunas e as marcas frontais aplicáveis, recalculável a partir do preparo e das referências.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A nutricionista monta um preparo de 6 a 10 ingredientes e obtém a tabela nutricional completa em menos de 10 minutos.
- **SC-002**: Para um preparo com dados completos, os valores por porção e por 100 g conferem com o cálculo manual — verificável com casos conhecidos.
- **SC-003**: O %VD de um mesmo produto é idêntico independentemente de qual paciente ou clínica esteja aberto no sistema.
- **SC-004**: Nenhum nutriente desconhecido é apresentado como zero em nenhuma tela ou exportação.
- **SC-005**: Um produto que ultrapassa o limite de açúcares adicionados é sinalizado como tal, e um produto abaixo do limite não é.
- **SC-006**: Um rótulo salvo é reaberto com todos os valores preservados, incluindo os informados manualmente.
- **SC-007**: Com o módulo `nutri_rotulo` desligado, a tela não aparece no menu e o acesso direto por URL é negado.
- **SC-008**: Rótulos de uma clínica não são visíveis em outra.

## Assumptions

- **Fonte dos nutrientes**: a base de alimentos existente já carrega gorduras saturadas, gorduras trans, açúcares totais e açúcares adicionados, importados na feature 049. A cobertura é irregular (saturadas ~86%, sódio ~91%, mas trans ~18%, açúcares totais ~18% e açúcares adicionados ~7% dos alimentos), o que torna a US2 condição de viabilidade e não melhoria.
- **A planilha de origem não serve de gabarito para o %VD**: a aba "Rótulos Nutricionais" calcula o percentual contra as metas do paciente (≈1956 kcal, 75 g de proteína, 300 g de açúcares adicionados). Isso é adequado a um painel informativo, mas irregular num rótulo comercial. Os valores de referência desta feature vêm da norma. A planilha continua servindo de gabarito para o **layout** e para a lista de campos de entrada.
- **Valores de referência e limites da lupa**: os números concretos serão transcritos da norma vigente e conferidos contra o texto oficial na fase de planejamento, do mesmo modo como as equações de gasto energético foram conferidas contra a literatura na feature 048. O spec fixa a regra, não os números.
- **A feature não emite parecer legal**: o sistema calcula e sinaliza; a responsabilidade técnica pelo rótulo é da nutricionista. A tela deve deixar isso claro.
- **Preparo não é plano alimentar**: um rótulo descreve um produto vendido, não a alimentação de um paciente. Não fica preso a nenhum paciente.
- **Fora do escopo v1**: arte e diagramação da embalagem, código de barras, registro em órgão regulador, formatos alternativos de tabela (rótulo simplificado, embalagens pequenas), alegações nutricionais ("fonte de", "rico em"), e versões em outros idiomas do Mercosul.

## Dependencies

- Base de alimentos e motor de soma das features 047 e 049.
- Módulo `nutri_rotulo`, já existente no catálogo de módulos.
