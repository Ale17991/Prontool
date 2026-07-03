# Feature Specification: Periograma (periodontograma) odontológico

**Feature Branch**: `041-periograma`
**Created**: 2026-06-23
**Status**: Draft
**Input**: Fase 3 do módulo de odontologia — registro periodontal completo (6 sítios por dente) com exames datados e comparação ao longo do tempo, como nova seção do hub "Odonto-Space" no prontuário do paciente.

## Clarifications

### Session 2026-06-23

- Q: Como registrar a margem gengival para o cálculo do CAL ficar sem ambiguidade? → A: Guardar recessão com sinal em mm (positivo = recessão / margem apical à JCE; negativo = margem coronal/hiperplasia). CAL = profundidade de sondagem + recessão.
- Q: Quantos exames em rascunho um paciente pode ter ao mesmo tempo? → A: No máximo um rascunho por paciente; criar um novo exige finalizar ou descartar o anterior.
- Q: Como validar valores fora de faixa clínica plausível (PD/margem)? → A: Rejeitar valores fora da faixa — profundidade de sondagem 0–15 mm; recessão −5 a +15 mm.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Registrar um exame periodontal completo (Priority: P1)

O profissional de saúde abre o prontuário de um paciente, vai à aba **Odonto-Space → Periograma** e cria um novo exame. Em uma grade no formato clássico de periograma (dentes nas colunas; linhas de profundidade de sondagem, margem gengival e sangramento para as arcadas vestibular e lingual/palatina), ele percorre os dentes e registra, por sítio, a profundidade de sondagem e a margem gengival, marcando sangramento, supuração e placa onde houver. Por dente, registra mobilidade, furca e marca dentes ausentes/implantes. Ao terminar, finaliza o exame, que passa a ser um registro imutável.

**Why this priority**: É o núcleo da feature — sem capturar o exame, nada mais existe. Entrega valor isolado: o periograma vira parte do prontuário clínico do paciente.

**Independent Test**: Criar um exame em rascunho, preencher medições de alguns dentes/sítios, salvar, reabrir e confirmar que os valores persistiram; finalizar e confirmar que vira somente-leitura.

**Acceptance Scenarios**:

1. **Given** um paciente sem exames periodontais, **When** o profissional cria um exame e registra a profundidade de sondagem de um sítio, **Then** o valor é salvo e exibido na grade na posição correta (dente/sítio/arcada).
2. **Given** um exame em rascunho com medições, **When** o profissional registra margem gengival e profundidade num sítio, **Then** o nível de inserção clínica (CAL) desse sítio é calculado e exibido automaticamente (CAL = profundidade + recessão).
3. **Given** um exame em rascunho, **When** o profissional marca um dente como ausente, **Then** os sítios daquele dente ficam desabilitados/ignorados nos indicadores.
4. **Given** um exame em rascunho preenchido, **When** o profissional finaliza o exame, **Then** o exame fica imutável e nenhuma medição pode mais ser alterada.
5. **Given** um usuário sem permissão de escrita clínica, **When** abre a seção Periograma, **Then** consegue visualizar exames mas não criar nem editar.

---

### User Story 2 - Comparar exames ao longo do tempo (Priority: P2)

O profissional, acompanhando a evolução periodontal do paciente, seleciona dois exames datados e visualiza a comparação: como mudaram a profundidade de sondagem e o sangramento por sítio entre as datas, além da variação dos indicadores gerais (% de sangramento, bolsas ≥4 mm, CAL médio).

**Why this priority**: É o que justifica o modelo de snapshot datado — mostrar melhora/piora do quadro periodontal entre tratamentos. Depende da US1.

**Independent Test**: Com dois exames finalizados em datas diferentes para o mesmo paciente, abrir a comparação e confirmar que as variações por sítio e os deltas dos indicadores são exibidos corretamente.

**Acceptance Scenarios**:

1. **Given** um paciente com dois ou mais exames finalizados, **When** o profissional seleciona duas datas, **Then** a tela mostra, por sítio, a profundidade de sondagem de cada data e a variação entre elas.
2. **Given** uma comparação entre dois exames, **When** a tela é exibida, **Then** mostra a variação do % de sangramento, do número de bolsas ≥4 mm e do CAL médio entre as datas.
3. **Given** um paciente com apenas um exame, **When** abre a comparação, **Then** o sistema informa que são necessários ao menos dois exames.

---

### User Story 3 - Resumo periodontal e indicadores do exame (Priority: P3)

Ao visualizar um exame (rascunho ou finalizado), o profissional vê um painel de indicadores calculados automaticamente a partir das medições: percentual de sangramento à sondagem (BOP), quantidade e percentual de sítios com bolsa ≥4 mm, e CAL médio. Esses indicadores se atualizam conforme as medições são inseridas no rascunho.

**Why this priority**: Agrega leitura clínica rápida ao exame, mas o exame e a comparação já entregam valor sem ele. Depende da US1.

**Independent Test**: Inserir um conjunto conhecido de medições e verificar que os três indicadores batem com o cálculo manual esperado.

**Acceptance Scenarios**:

1. **Given** um exame com N sítios medidos e B deles com sangramento, **When** o painel é exibido, **Then** o % de sangramento mostrado é B/N.
2. **Given** um exame com sítios de profundidade variada, **When** o painel é exibido, **Then** o número de bolsas ≥4 mm reflete a contagem real de sítios com profundidade ≥4 mm.

---

### Edge Cases

- **Dente ausente/implante**: sítios de dentes marcados como ausentes não entram nos denominadores dos indicadores (BOP, bolsas, CAL médio).
- **Sítio não medido**: um sítio em branco não conta como "sem sangramento" nem como profundidade zero — fica fora dos cálculos até ser preenchido.
- **Recessão vs. crescimento gengival**: a recessão é registrada com sinal — positivo soma à profundidade (recessão), negativo reduz (margem coronal/hiperplasia); o CAL = PD + recessão reflete os dois casos.
- **Faixas plausíveis**: valores fora da faixa (profundidade fora de 0–15 mm; recessão fora de −5 a +15 mm) são rejeitados para evitar erro de digitação.
- **Dentição decídua**: a grade deve suportar a numeração de dentes decíduos (reaproveitando o modelo FDI existente), inclusive a ausência de furca em certos dentes.
- **Exame finalizado**: qualquer tentativa de alterar medições de um exame finalizado é bloqueada (inclusive por usuários com permissão de escrita).
- **Exame em rascunho abandonado**: o paciente tem no máximo um exame em rascunho por vez; iniciar um novo exige finalizar ou descartar o anterior.
- **Paciente anonimizado**: a seção Periograma segue a mesma regra das demais do Odonto-Space (oculta quando o paciente está anonimizado).

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: O sistema MUST permitir criar um exame periodontal datado vinculado a um paciente, em estado de rascunho.
- **FR-002**: O sistema MUST registrar, por dente e por sítio (6 sítios: disto/centro/mésio nas arcadas vestibular e lingual/palatina), profundidade de sondagem (mm), recessão com sinal (mm; positivo = recessão/margem apical à JCE, negativo = margem coronal/hiperplasia), sangramento à sondagem (sim/não), supuração (sim/não) e placa (sim/não).
- **FR-003**: O sistema MUST registrar, por dente, mobilidade (grau 0–3), envolvimento de furca (grau I–III), e marcação de dente ausente e de implante.
- **FR-004**: O sistema MUST calcular e exibir o nível de inserção clínica (CAL) de cada sítio como profundidade de sondagem somada à recessão com sinal (CAL = PD + recessão).
- **FR-005**: O sistema MUST calcular e exibir, por exame, indicadores agregados: percentual de sangramento à sondagem (BOP), número e percentual de sítios com bolsa ≥4 mm, e CAL médio — considerando apenas dentes presentes e sítios medidos.
- **FR-006**: Usuários com permissão de escrita clínica MUST poder editar livremente as medições enquanto o exame está em rascunho.
- **FR-007**: O sistema MUST permitir finalizar um exame; após finalizado, o exame e suas medições MUST ser imutáveis (somente leitura), tornando-se um snapshot histórico.
- **FR-008**: O sistema MUST listar os exames periodontais de um paciente ordenados por data, indicando estado (rascunho/finalizado) e indicadores resumidos.
- **FR-009**: O sistema MUST permitir selecionar dois exames finalizados e exibir a comparação da evolução por sítio (profundidade de sondagem e sangramento) e dos indicadores agregados entre as datas.
- **FR-010**: O sistema MUST oferecer a entrada de dados em uma grade no formato clássico de periograma, com dentes nas colunas e linhas por arcada, e MUST permitir navegação rápida entre sítios por teclado.
- **FR-011**: O sistema MUST suportar dentição permanente e decídua reaproveitando a notação FDI já adotada no módulo odontológico.
- **FR-012**: O sistema MUST restringir a criação/edição/finalização de exames a usuários com papel de escrita clínica (admin/profissional de saúde); demais papéis autorizados têm acesso somente de leitura.
- **FR-013**: O sistema MUST isolar os dados por clínica (tenant), de modo que um exame só seja visível e editável dentro da clínica à qual pertence.
- **FR-014**: O sistema MUST registrar em auditoria a criação e a finalização de um exame periodontal.
- **FR-015**: O sistema MUST rejeitar valores fora da faixa clínica plausível — profundidade de sondagem 0–15 mm e recessão −5 a +15 mm — para reduzir erro de digitação.
- **FR-016**: A seção Periograma MUST aparecer como uma nova seção dentro do hub Odonto-Space do prontuário, junto de Odontograma e Plano de tratamento, e seguir as mesmas regras de visibilidade (ex.: oculta para paciente anonimizado).
- **FR-017**: O sistema MUST permitir, opcionalmente, vincular um exame periodontal a um atendimento, sem exigir esse vínculo.
- **FR-018**: O sistema MUST limitar o paciente a no máximo um exame periodontal em rascunho por vez; criar um novo exame MUST exigir que o rascunho anterior seja finalizado ou descartado.

### Key Entities _(include if feature involves data)_

- **Exame periodontal**: representa uma avaliação periodontal de boca toda em uma data. Atributos: paciente, clínica, data do exame, estado (rascunho/finalizado), autor, atendimento vinculado (opcional), observações. Relaciona-se a muitas medições por sítio e a achados por dente.
- **Medição por sítio**: representa um dos 6 sítios de um dente em um exame. Atributos: dente (FDI), sítio (disto/centro/mésio × vestibular/lingual-palatina), profundidade de sondagem, recessão com sinal, sangramento, supuração, placa. CAL é derivado (PD + recessão).
- **Achado por dente**: representa atributos do dente como um todo no exame. Atributos: dente (FDI), mobilidade, furca, ausente, implante.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: Um profissional consegue registrar e finalizar um exame periodontal completo de boca toda (dentição permanente) em menos de 10 minutos.
- **SC-002**: Os indicadores agregados (% de sangramento, bolsas ≥4 mm, CAL médio) exibidos coincidem com o cálculo manual de referência em 100% dos casos de teste.
- **SC-003**: Um profissional consegue comparar dois exames de datas diferentes e identificar a variação de profundidade de sondagem por sítio em menos de 1 minuto.
- **SC-004**: Nenhuma medição de exame finalizado pode ser alterada — 100% das tentativas de edição pós-finalização são bloqueadas.
- **SC-005**: 100% dos exames ficam restritos à clínica de origem (nenhum vazamento entre clínicas).

## Assumptions

- **Versão atual exclui estadiamento/grau**: a classificação periodontal AAP/EFP 2017 (estágio I–IV, grau A–C) fica como follow-up; esta versão entrega registro, indicadores básicos e comparação.
- **Sítios fixos por dente**: adota-se o padrão de 6 sítios por dente; configuração de 4 sítios não está no escopo.
- **Reuso do modelo de dentes**: a numeração FDI, faces e dentição vêm do modelo já existente no módulo odontológico; não há novo cadastro de dentes.
- **Permissões reutilizadas**: a escrita clínica usa o mesmo controle de permissão já aplicado ao odontograma; nenhum papel novo é criado.
- **Exportação/PDF**: a exportação do periograma em PDF não está no escopo desta versão (pode ser follow-up, análogo ao PDF de orçamento da Fase 2).
