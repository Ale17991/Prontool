# Feature Specification: Exames Laboratoriais (resultados com faixas de referência)

**Feature Branch**: `050-exames-laboratoriais`
**Created**: 2026-07-28
**Status**: Draft
**Input**: Registro de resultados de exames laboratoriais com faixas de referência por sexo/idade, flag automático (baixo/normal/alto), evolução no tempo e leitura no portal. **Cross-especialidade** (útil a qualquer clínica), gated pelo módulo `exames_lab`. Item de prioridade média do gap analysis das planilhas de nutrição (`nutri-doc/`).

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Registrar resultado com flag automático (Priority: P1)

O profissional lança os resultados de exames de um paciente (valor + data) e o sistema **classifica automaticamente** cada resultado como **baixo / normal / alto** comparando com a **faixa de referência** daquele exame para o **sexo e idade** do paciente, destacando os alterados. Hoje isso vive nas planilhas.

**Why this priority**: É o valor central — transforma "glicose 110" em "acima do normal para este paciente". Sozinha já entrega: registrar e enxergar o que está alterado.

**Independent Test**: Escolher um paciente, lançar alguns resultados (ex.: glicose, colesterol, vitamina D) e conferir a classificação baixo/normal/alto e o destaque dos alterados.

**Acceptance Scenarios**:

1. **Given** um catálogo de exames com faixas por sexo/idade, **When** o profissional lança um resultado, **Then** o sistema mostra o valor, a faixa de referência aplicável e a classificação (baixo/normal/alto).
2. **Given** um resultado fora da faixa, **When** ele é exibido, **Then** aparece destacado como alterado (alto ou baixo).
3. **Given** um paciente sem sexo/idade no cadastro, **When** um resultado é lançado, **Then** o valor é registrado e a tela permite informar sexo/idade para escolher a faixa, sem bloquear.
4. **Given** um exame sem faixa de referência aplicável, **When** um resultado é lançado, **Then** ele é registrado e exibido com o valor, marcado "sem referência" (sem flag).
5. **Given** um histórico de exames, **When** o profissional abre a tela, **Then** vê os resultados mais recentes por exame com data e classificação.

---

### User Story 2 - Evolução do exame no tempo (Priority: P2)

O profissional quer ver como um exame evoluiu ao longo do tempo (ex.: glicemia caindo mês a mês), num gráfico por exame, para acompanhar a resposta ao tratamento.

**Why this priority**: Acompanhamento longitudinal é o que dá sentido clínico à série de resultados. Depende da US1 (dados registrados).

**Independent Test**: Com vários resultados do mesmo exame em datas diferentes, abrir a evolução e ver a linha do tempo daquele exame.

**Acceptance Scenarios**:

1. **Given** um exame com ≥2 resultados em datas diferentes, **When** o profissional abre a evolução, **Then** vê um gráfico do valor ao longo do tempo.
2. **Given** a faixa de referência do exame, **When** o gráfico é exibido, **Then** a faixa normal é indicada como referência visual (quando aplicável).

---

### User Story 3 - Resultados no portal do paciente (Priority: P3)

O paciente vê seus resultados de exames recentes no portal, com a classificação (normal/alterado), de forma simples e sem jargão financeiro.

**Why this priority**: Dá transparência ao paciente e reduz retorno de dúvidas. Reusa a entrega do portal já existente.

**Independent Test**: Logar no portal do paciente e conferir a seção de exames com os resultados recentes e o flag.

**Acceptance Scenarios**:

1. **Given** resultados registrados, **When** o paciente abre o portal, **Then** vê os exames recentes com valor, data e se está normal ou alterado.
2. **Given** um exame alterado, **When** exibido no portal, **Then** é destacado de forma clara (sem alarmismo).

---

### Edge Cases

- **Sexo/idade ausentes**: a faixa depende deles; a tela permite informar manualmente sem travar; sem esses dados, o resultado fica sem flag.
- **Faixa por estado** (ex.: gestante) quando a fonte trouxer — escolher a faixa certa; caso não haja, usar a padrão.
- **Exame sem faixa** na fonte: registra o valor, marca "sem referência".
- **Unidades**: cada exame tem sua unidade; o valor e a faixa respeitam a mesma unidade; conversão de unidade fica fora do escopo v1 (assume a unidade do catálogo).
- **Valor implausível** (erro de digitação): sinalizar, não bloquear (mesmo espírito dos avisos da nutrição).
- **Isolamento multi-tenant**: resultados de uma clínica não aparecem em outra; o catálogo de exames e faixas é global (compartilhado).

## Requirements _(mandatory)_

### Functional Requirements

**Catálogo de exames + faixas (base — US1)**

- **FR-001**: O sistema MUST manter um catálogo de exames laboratoriais (nome, unidade), incluindo os comuns: glicose (jejum), HbA1c, colesterol total/HDL/LDL, triglicerídeos, TSH, T4 livre, insulina, vitamina D (25-OH), vitamina B12, ferritina, ferro sérico, hemoglobina, hematócrito, ácido úrico, creatinina, TGO, TGP, PCR.
- **FR-002**: Cada exame MUST ter faixa(s) de referência (mínimo e/ou máximo) por sexo e faixa etária (e estado quando aplicável, ex.: gestante). O catálogo é **global** (compartilhado por todas as clínicas), não editável pela clínica.
- **FR-003**: O catálogo e as faixas MUST ser semeados de uma lista padrão, usando as abas `BD EXAMES` (AF) e `BD_Exames` (Evonut) em `nutri-doc/` como gabarito.

**Registro + flag (US1)**

- **FR-004**: Usuários (admin/profissional_saude) MUST poder registrar resultados de exame por paciente (exame + valor + data), com histórico.
- **FR-005**: O sistema MUST classificar cada resultado em **baixo / normal / alto** comparando com a faixa de referência da faixa (sexo/idade/estado) do paciente, destacando os alterados.
- **FR-006**: A idade MUST ser derivada da data de nascimento quando disponível; sexo, do cadastro; ambos ajustáveis na tela sem bloquear.
- **FR-007**: Resultados de exames sem faixa aplicável MUST ser registrados e exibidos com o valor, marcados "sem referência" (sem flag).

**Evolução (US2)**

- **FR-008**: O sistema MUST exibir a evolução de um exame no tempo (gráfico), com a faixa normal como referência visual quando aplicável.

**Portal (US3)**

- **FR-009**: O portal do paciente MUST exibir os resultados recentes de exames com valor, data e a classificação (normal/alterado).

**Transversais**

- **FR-010**: O acesso à tela de exames MUST ser controlado pelo módulo `exames_lab` (item de menu e rota negados quando desligado) e pelos papéis admin/profissional_saude.
- **FR-011**: Resultados MUST ser isolados por clínica (multi-tenant); o catálogo de exames e faixas é global.

### Key Entities _(include if feature involves data)_

- **Exame (catálogo)**: nome, unidade, e faixas de referência por sexo/idade/estado. Global.
- **Faixa de referência**: min/max de um exame para um recorte (sexo, faixa etária, estado). Global.
- **Resultado de exame**: valor de um exame para um paciente numa data. Por clínica; append-only por natureza (histórico).
- **Flag/Classificação**: leitura derivada (baixo/normal/alto) do resultado × faixa aplicável do paciente.
- **Paciente**: fonte de sexo e idade (data de nascimento) para escolher a faixa (reuso do cadastro).

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: O profissional consegue lançar um conjunto de resultados de um paciente (ex.: 8–10 exames) e ver a classificação de cada um em menos de 5 minutos.
- **SC-002**: Para um paciente com sexo e idade definidos, cada resultado com faixa disponível mostra a classificação correta (baixo/normal/alto) frente à faixa da sua faixa etária/sexo — verificável com casos conhecidos.
- **SC-003**: Resultados alterados são visualmente distinguíveis dos normais na tela e no portal.
- **SC-004**: Um exame com ≥2 resultados em datas diferentes exibe a evolução no tempo.
- **SC-005**: Com o módulo `exames_lab` desligado, a tela não aparece no menu e o acesso direto por URL é negado.
- **SC-006**: Resultados de uma clínica não são visíveis em outra; o catálogo de exames/faixas aparece em todas.

## Assumptions

- **Reuso do motor de medições**: a estratégia de persistência (reusar/estender o motor de medições da feature 030 — cada exame como uma métrica com faixa de referência clínica — vs. tabela dedicada) é decisão de implementação, resolvida no plano. O importante é o comportamento acima.
- **Faixas por sexo/idade** seguem o padrão já usado nas DRIs (feature 049): catálogo global com lookup por sexo × faixa etária × estado; fallback quando faltar recorte específico.
- **Fonte das faixas**: as planilhas em `nutri-doc/` são o gabarito; a validação clínica das faixas fica como polish com o profissional, análogo ao T047 da 047 (avisar, não bloquear).
- **Pedido/solicitação de exames**: **fora do escopo v1**. Já existe uma API de solicitação de exames (`/api/pacientes/[id]/solicitacoes-exame`); integrar a geração de pedido a partir do catálogo pode ser um follow-up.
- **Conversão de unidades**: fora do escopo v1 — assume-se a unidade do catálogo; o profissional lança na mesma unidade.
- **Sem novas dependências**: comparação com faixa é aritmética simples; gráficos reusam o componente de evolução existente.
- **Cross-especialidade**: a tela é genérica (não específica de nutrição) e vale para endócrino, nutrição e clínica geral; gated só pelo módulo `exames_lab`.
