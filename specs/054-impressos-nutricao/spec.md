# Feature Specification: Impressos da consulta de nutrição

**Feature Branch**: `054-impressos-nutricao`
**Created**: 2026-08-03
**Status**: Draft
**Input**: Gerar em PDF os documentos que a nutricionista entrega ao paciente, no mesmo formato da planilha de trabalho (`nutri-doc/AF..xlsm`): anamnese, recordatório alimentar, exames laboratoriais, antropometria, bioimpedância, avaliação infantil, avaliação gestacional, plano alimentar e orientações. Hoje o sistema só exporta o rótulo nutricional.

## Contexto

O sistema já **calcula e guarda** tudo o que estes documentos mostram — a
avaliação nutricional (046), o plano alimentar (047), o recordatório (049), os
exames (050), as curvas de crescimento e os hábitos. O que falta é a saída em
papel.

Na prática isso significa que a consulta termina e a paciente vai embora de mãos
vazias, ou a profissional recorre à planilha para imprimir. É a lacuna que mais
aparece no dia a dia, porque acontece em **toda** consulta, não em um caso
particular.

A planilha de referência tem **nove telas de impressão**, e três delas
(antropometria, bioimpedância, avaliação infantil e gestacional) mostram **até
três avaliações lado a lado** — ou seja, o impresso não é uma foto do dia, é a
evolução. É esse formato que o paciente leva para casa e compara.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Entregar o plano alimentar impresso (Priority: P1)

Ao terminar de montar o cardápio, a nutricionista gera um PDF do plano e entrega
ao paciente (impresso ou por mensagem). O documento traz as refeições com
horário, os alimentos com quantidade e medida caseira, as opções de substituição
("ou"), os totais de energia e macronutrientes e as observações.

**Why this priority**: é o documento que o paciente mais usa, todo dia, na
cozinha e no mercado. Sem ele o plano existe só dentro do sistema, e a adesão
depende de o paciente lembrar do que foi combinado.

**Independent Test**: montar um plano com quatro refeições, uma delas com grupo
de substituição, e gerar o PDF; conferir que as quantidades e as opções batem
com a tela.

**Acceptance Scenarios**:

1. **Given** um plano com refeições e itens, **When** a profissional gera o
   impresso, **Then** o PDF traz cada refeição com seus itens, quantidade,
   medida caseira e os totais do dia.
2. **Given** uma refeição com grupo de substituição, **When** o PDF é gerado,
   **Then** as opções aparecem como alternativas equivalentes, e não como itens
   somados.
3. **Given** um plano ainda em rascunho, **When** a profissional gera o impresso,
   **Then** o documento sai marcado como rascunho, para não circular como se
   fosse a prescrição final.

---

### User Story 2 - Entregar a evolução da avaliação (Priority: P1)

A nutricionista gera o impresso de antropometria mostrando **as três últimas
avaliações lado a lado**: peso, IMC, dobras, percentual de gordura, massa magra,
circunferências e as classificações. O paciente vê a trajetória, não um número
solto.

**Why this priority**: é o que sustenta a adesão. Ver a coluna de hoje ao lado da
de dois meses atrás é o que faz o paciente entender que o trabalho está
funcionando — ou que parou.

**Independent Test**: com três avaliações salvas do mesmo paciente, gerar o
impresso e conferir que as três colunas aparecem em ordem cronológica com os
valores corretos.

**Acceptance Scenarios**:

1. **Given** um paciente com três ou mais avaliações, **When** o impresso é
   gerado, **Then** aparecem as três mais recentes, da mais antiga para a mais
   nova, com a variação entre elas.
2. **Given** um paciente com uma única avaliação, **When** o impresso é gerado,
   **Then** sai uma coluna só, sem colunas vazias fingindo histórico.
3. **Given** uma avaliação feita por bioimpedância, **When** o impresso é
   gerado, **Then** o documento identifica o método usado, porque dobras e
   bioimpedância não são comparáveis entre si.

---

### User Story 3 - Entregar orientações e anamnese (Priority: P2)

A profissional imprime as orientações escritas para aquele paciente e, quando
precisa, a anamnese preenchida — para arquivo, para outro profissional ou para o
próprio paciente.

**Why this priority**: as orientações já existem em texto no sistema e são
entregues com frequência; a anamnese impressa serve mais a arquivo e
encaminhamento do que ao paciente.

**Independent Test**: registrar duas orientações e gerar o impresso; depois
aplicar um modelo de anamnese, responder e gerar o impresso correspondente.

**Acceptance Scenarios**:

1. **Given** orientações registradas, **When** o impresso é gerado, **Then** o
   texto sai íntegro, com a data de cada uma.
2. **Given** uma anamnese respondida, **When** o impresso é gerado, **Then**
   perguntas e respostas saem na ordem do modelo, e as perguntas sem resposta
   aparecem em branco em vez de sumir.

---

### User Story 4 - Entregar recordatório e exames (Priority: P2)

A profissional imprime o recordatório alimentar de um dia (com os totais e a
análise de adequação) e o quadro de exames laboratoriais com valores, faixas de
referência e a classificação.

**Why this priority**: são documentos de acompanhamento, usados em consulta e em
encaminhamento. Valem menos que o plano no dia a dia do paciente, mas fecham o
conjunto da consulta.

**Independent Test**: com um recordatório e resultados de exames lançados, gerar
os dois impressos e conferir os valores contra a tela.

**Acceptance Scenarios**:

1. **Given** um recordatório com refeições, **When** o impresso é gerado,
   **Then** saem os itens por refeição e os totais do dia.
2. **Given** resultados com faixa de referência, **When** o impresso é gerado,
   **Then** cada exame mostra valor, faixa e se está abaixo, dentro ou acima.
3. **Given** um exame sem faixa cadastrada, **When** o impresso é gerado,
   **Then** o valor sai sem classificação, e não classificado como normal.

---

### User Story 5 - Entregar avaliação infantil e gestacional (Priority: P3)

Para criança, o impresso traz as curvas de crescimento com o ponto do paciente e
a classificação por percentil. Para gestante, traz o ganho de peso na gestação
frente à recomendação para o IMC pré-gestacional.

**Why this priority**: atendem públicos específicos. São valiosos para quem
atende esses casos e irrelevantes para quem não atende.

**Independent Test**: com um paciente pediátrico com aferições, gerar o impresso
e conferir que a curva e o percentil batem com a seção do prontuário.

**Acceptance Scenarios**:

1. **Given** uma criança com peso e estatura aferidos, **When** o impresso é
   gerado, **Then** saem as curvas com o ponto do paciente e a classificação.
2. **Given** uma gestante com IMC pré-gestacional informado, **When** o impresso
   é gerado, **Then** sai o ganho de peso acumulado e a faixa recomendada.

---

### Edge Cases

- **Dado incompleto**: o que acontece quando a avaliação não tem altura, ou o
  paciente não tem data de nascimento? O impresso precisa sair com o campo em
  branco e sem inventar cálculo — o mesmo princípio já aplicado no rótulo
  nutricional, onde dado ausente nunca vira zero.
- **Paciente sem nada registrado**: gerar impresso de algo que não existe deve
  informar isso com clareza, em vez de produzir um PDF em branco.
- **Documento longo**: um plano com muitas refeições ou uma anamnese com 60
  perguntas atravessa páginas; cabeçalho e identificação do paciente precisam se
  repetir, porque folhas soltas se separam.
- **Paciente anonimizado (LGPD)**: pacientes com dados anonimizados não podem
  gerar impresso com identificação.
- **Unidade e arredondamento**: os números impressos precisam bater com os da
  tela, dígito a dígito. Divergência entre o que a profissional viu e o que o
  paciente levou destrói a confiança no sistema.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: O sistema MUST gerar impresso em PDF para: plano alimentar,
  antropometria, bioimpedância, orientações, anamnese, recordatório, exames
  laboratoriais, avaliação infantil e avaliação gestacional.
- **FR-002**: Todo impresso MUST identificar a clínica (nome e logotipo, quando
  houver), o paciente e a data de emissão.
- **FR-003**: Todo impresso MUST identificar o profissional responsável, com
  espaço para assinatura quando o documento se destina a terceiros.
- **FR-004**: Os impressos de antropometria, bioimpedância, avaliação infantil e
  avaliação gestacional MUST mostrar **até três avaliações lado a lado**, em
  ordem cronológica.
- **FR-005**: Quando houver menos de três avaliações, o impresso MUST mostrar só
  as existentes, sem colunas vazias.
- **FR-006**: O impresso de composição corporal MUST identificar o **protocolo
  usado** em cada avaliação, porque protocolos diferentes não são comparáveis.
- **FR-007**: Valores calculados MUST bater com os exibidos na tela, incluindo
  arredondamento.
- **FR-008**: Dado ausente MUST aparecer em branco ou como traço, nunca como
  zero nem como valor estimado.
- **FR-009**: O impresso do plano alimentar MUST apresentar as opções de
  substituição como alternativas, e não como itens somados ao total.
- **FR-010**: O impresso de plano em rascunho MUST sair visivelmente marcado como
  não definitivo.
- **FR-011**: O impresso de exames MUST trazer valor, faixa de referência e
  classificação; exame sem faixa MUST sair sem classificação.
- **FR-012**: A geração MUST respeitar o papel do usuário e o isolamento entre
  clínicas: ninguém gera impresso de paciente de outra clínica.
- **FR-013**: Paciente anonimizado MUST NOT gerar impresso identificado.
- **FR-014**: Cada impresso MUST estar disponível a partir da tela onde o dado é
  produzido, sem obrigar a profissional a procurar num menu separado.
- **FR-015**: Documentos com mais de uma página MUST repetir a identificação do
  paciente e a numeração de páginas.

### Key Entities

- **Impresso**: um documento gerado sob demanda a partir de dados já existentes.
  Não é entidade persistida — é uma **saída**, recalculada a cada emissão. Não há
  tabela nova nesta feature.
- **Emissão**: o registro de que um documento foi gerado para um paciente, para
  fins de auditoria (quem gerou, quando, qual documento).

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: A profissional consegue emitir qualquer um dos nove documentos em
  até três cliques a partir da tela onde o dado está.
- **SC-002**: Os nove documentos existem e saem preenchidos com dados reais de um
  paciente de teste.
- **SC-003**: Em uma conferência com a nutricionista, os valores de cada impresso
  batem com os da planilha para o mesmo paciente, sem divergência numérica.
- **SC-004**: Nenhum impresso apresenta zero, "0" ou valor estimado no lugar de
  dado ausente.
- **SC-005**: A consulta termina com o paciente levando o plano alimentar
  impresso, sem a profissional precisar recorrer à planilha.
- **SC-006**: Um documento de três páginas mantém identificação do paciente em
  todas elas.

## Assumptions

- **Reuso da geração de PDF existente**: o sistema já emite PDF (rótulo
  nutricional, receituário, relatórios, orçamento odontológico). Esta feature
  segue o mesmo caminho, sem nova dependência.
- **Sem tabela nova**: os impressos leem o que já está gravado. A única gravação
  cogitada é o registro de emissão para auditoria, que reusa o log existente.
- **"Bem parecido" quer dizer conteúdo e organização**, não cópia visual pixel a
  pixel: mesmos campos, mesma ordem, mesma leitura. A identidade visual segue a
  da clínica (logotipo e cabeçalho já configurados), não a da planilha.
- **Três avaliações** é o número da planilha e vale como padrão; não há pedido
  para tornar isso configurável.
- **Gate por módulo**: cada impresso segue o módulo da funcionalidade que o
  alimenta (por exemplo, o impresso de exames exige `exames_lab`). Não se cria
  módulo novo.
- **Entrega**: baixar o PDF atende o v1. Envio automático por WhatsApp ou e-mail
  fica para depois, e depende da frente 051.

## Out of Scope

Estes itens saíram do levantamento da planilha junto com os impressos, mas são
features próprias e merecem spec separado:

- **Plano alimentar por dia da semana** (cardápio diferente por dia).
- **Prescrições estruturadas** com tipo e categoria.
- Envio automático dos impressos por WhatsApp ou e-mail.

## Correção do levantamento

O levantamento inicial listou **pedido de exames** como lacuna. Estava errado:
existe desde a migration `0149_exam_requests.sql`, com indicação clínica, lista
de exames do catálogo TUSS, PDF e seção própria na ficha do paciente. Foi
verificado no código antes do plano.

Achado real e adjacente: `anamnesis/export-pdf.tsx` **existe e não é
alcançável** — o componente monta o PDF da anamnese, mas nenhuma rota o importa.
É código morto que a US3 aproveita em vez de reescrever.

## Dependencies

- Avaliação nutricional (046), plano alimentar (047), recordatório (049), exames
  laboratoriais (050), curvas de crescimento e orientações precisam estar
  habilitados para os respectivos impressos fazerem sentido.
- Perfil da clínica configurado (nome e logotipo) para o cabeçalho.
