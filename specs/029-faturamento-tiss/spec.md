# Feature Specification: Faturamento TISS de Convênios

**Feature Branch**: `029-faturamento-tiss`
**Created**: 2026-06-02
**Status**: Draft
**Input**: User description: "Faturamento TISS de convênios. Permitir que clínicas que atendem convênios gerem, validem, organizem em lotes e exportem guias no padrão TISS da ANS para receber das operadoras — reaproveitando o que já existe (tuss_codes/tuss_catalog_versions, procedures, health_plans/convênios, appointments, doctors, taxes/financeiro)."

## Contexto Regulatório _(leitura obrigatória — base da pesquisa)_

O **TISS (Troca de Informação em Saúde Suplementar)** é o padrão **obrigatório** da ANS (base legal **RN nº 501/2022**) para a troca eletrônica de dados de atenção à saúde entre prestadores e operadoras de planos de saúde. Não existe formato proprietário aceito: para faturar convênio, o sistema **DEVE** produzir XML TISS válido que valide contra o schema XSD oficial da ANS. Pontos verificados na pesquisa (fontes oficiais gov.br/ans, RN 501/2022, release ANS Jan/2026):

- **Versão-alvo (CONFIRMADA — release oficial Maio/2026, pub. 28/05/2026):** o **Componente de Comunicação** (mensagens) vigente é o **04.03.00** (o paralelo `01.06.00` cobre apenas Monitoramento e **não** substitui o de mensagens), **fim de implantação obrigatório 30/06/2026**. Demais componentes do release Maio/2026: Organizacional **202605**, Representação/TUSS **202605** (atualizou tabelas 19/OPME, 20/medicamentos e 64), Conteúdo e Estrutura **202511** e Segurança e Privacidade **202511** (ambos com fim de implantação 30/06/2026). A RN 501/2022 (Art. 7) obriga uso da "versão vigente" — o fornecedor não escolhe versão arbitrária. **Alvo do sistema: Comunicação 04.03.00 + Conteúdo e Estrutura 202511 + TUSS 202605.** Fonte: PDF oficial `PadroTISS_ComponenteOrganizacional_202605.pdf` (item 314 — Prazos) e legenda `Componente de Conteúdo e Estrutura_202511` (gov.br/ans). _(Reconfirmar o release vigente e rebaixar os XSDs a cada início de ciclo de manutenção, pois a ANS publica releases periódicos.)_
- **5 componentes do padrão:** Organizacional, Conteúdo e Estrutura (campos obrigatórios das guias), Representação de Conceitos em Saúde (terminologia/TUSS), Segurança e Privacidade (sigilo/assinatura/log) e Comunicação (XML + meios de troca).
- **Estrutura da mensagem/lote:** raiz `mensagemTISS` → `cabecalho` (cabeçalho de transação) → escolha `prestadorParaOperadora` / `operadoraParaPrestador` → `epilogo` (com **hash** de integridade) → assinatura digital **opcional** no XSD. O lote do prestador usa `loteGuias`; namespace alvo `http://www.ans.gov.br/padroes/tiss/schemas`.
- **Procedimentos nunca são texto livre:** toda linha de procedimento exige o par **Tabela** (domínio nº 87 — "tabela de tabelas", ex.: `22` procedimentos, `18` diárias/taxas/gases, `20` medicamentos, `00` tabela própria) **+ Código do Procedimento**, ambos obrigatórios.
- **Guia de Consulta — campos obrigatórios (CONFIRMADO na legenda oficial 202511):** Registro ANS (dom. da operadora), Nº da guia no prestador, Nº da carteira do beneficiário, Atendimento a RN (S/N), Nome do beneficiário, Código do contratado executante na operadora, Nome do contratado, **CNES** (preencher `9999999` se não houver), Conselho Profissional (dom. 26), Número no conselho, **UF (dom. 59)**, **CBO (dom. 24)**, **Indicação de Acidente (dom. 36)**, Regime de atendimento (dom. 76), Data do Atendimento, **Tipo de Consulta (dom. 52)**, **Tabela** (referência do procedimento) + **Código do procedimento** + **Valor do procedimento** (zero quando não definível por contrato), Assinatura do profissional executante e Assinatura do beneficiário/responsável. _Condicionados:_ Nome do profissional executante (quando o contratado for **pessoa jurídica**), Nome social, Cobertura Especial (dom. 75), Validade da carteira, Nº da guia atribuído pela operadora.
- **SP/SADT — estrutura (CONFIRMADO na legenda oficial 202511):** separa blocos **Solicitante** e **Executante**, cada um com **Conselho Profissional** (dom. 26), **Número no conselho**, **UF (dom. 59)** e **CBO (dom. 24)**. Cabeçalho com Caráter do Atendimento (dom. 23), Tipo de Atendimento (dom. 50), Indicação de Acidente (dom. 36), Tipo de Consulta (dom. 52, quando atendimento = consulta); **Senha** condicionada (quando autorização com senha). Linha de procedimento realizado: **Tabela (dom. 87)** + **Código** + Descrição + Qtde + Via de acesso (cirúrgico) + **Técnica (dom. 48)** + Valor Unitário + Valor Total; totalizadores por categoria (procedimentos, taxas/aluguéis, materiais, OPME, medicamentos, gases). Profissional executante por linha condicionado a haver honorários (dom. 26/59/24 + Grau de Participação dom. 35).
- **Glosas:** os motivos de recusa são padronizados na **Tabela 38** (Mensagens — Glosas, Negativas e Outras); faixa `9901-9999` reservada a motivos próprios da operadora.
- **Mensagens XML confirmadas na legenda 202511:** existem mensagens dedicadas `loteGuias` (envio prestador→operadora), `recebimentoLote` (protocolo de recebimento), `demonstrativosRetorno` / `Demonstrativo Analise Conta` / `Demonstrativo Pagamento` (retorno — follow-up) e `recursoGlosa` (recurso — follow-up). Confirma a estrutura de lote do MVP e o caminho dos itens deixados fora do MVP.

> **Pendência residual (não bloqueia o spec):** as exigências concretas do **Componente de Segurança e Privacidade 202511** (formato exato da assinatura digital por tipo de mensagem) serão lidas do componente oficial no `/speckit.plan`, junto ao download dos XSDs da 04.03.00.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Configurar um convênio para faturamento TISS (Priority: P1)

Um administrador da clínica abre um convênio já cadastrado (health_plan) e habilita o faturamento TISS, informando os dados que a operadora exige para reconhecer o prestador: **Registro ANS** da operadora, **versão TISS** adotada por aquela operadora, **código do prestador/contratado** na operadora, **CNPJ** do contratado (e **CNES**, quando aplicável) e os **mapeamentos de tabela de procedimentos** necessários para aquela operadora.

**Why this priority**: Sem a identificação correta do prestador e da operadora, nenhuma guia gerada será aceita. É a fundação de tudo e o ponto onde mais glosas administrativas nascem ("código do prestador inválido", "registro ANS incorreto"). É independentemente testável e entrega valor (cadastro auditável) mesmo antes de gerar qualquer guia.

**Independent Test**: Cadastrar a configuração TISS de uma operadora fictícia, salvar, reabrir e confirmar persistência + trilha de auditoria, isolada por tenant.

**Acceptance Scenarios**:

1. **Given** um convênio sem configuração TISS, **When** o admin preenche Registro ANS, versão TISS, código do contratado e CNPJ e salva, **Then** o convênio passa a exibir "TISS habilitado" e os dados ficam disponíveis para preencher guias.
2. **Given** um campo obrigatório vazio (ex.: Registro ANS), **When** o admin tenta salvar, **Then** o sistema bloqueia e indica exatamente qual dado falta.
3. **Given** uma configuração TISS existente, **When** outro tenant consulta convênios, **Then** ele não vê nem acessa a configuração do primeiro tenant.

---

### User Story 2 - Gerar e validar uma Guia de Consulta a partir de um atendimento (Priority: P1)

Um faturista seleciona um atendimento de consulta já registrado e gera a **Guia de Consulta** TISS correspondente. O sistema preenche automaticamente beneficiário (paciente + número da carteira), contratado/profissional executante (médico + conselho/UF/CBO), procedimento (código TUSS + tabela) e valor, a partir dos dados já existentes. Antes de marcar a guia como "pronta", o sistema **valida os campos obrigatórios** e mostra, em linguagem clara, o que falta — no mesmo espírito do bloqueio de prescrição que já existe.

**Why this priority**: É o caso de uso mais frequente de uma clínica (consultas) e o menor incremento que entrega valor real: transformar um atendimento em uma guia válida. Independentemente testável.

**Independent Test**: A partir de um atendimento-consulta completo, gerar a guia, ver todos os campos preenchidos e o status "pronta"; a partir de um atendimento com paciente sem carteirinha, ver a guia bloqueada com a mensagem do dado faltante.

**Acceptance Scenarios**:

1. **Given** um atendimento de consulta com paciente, médico e procedimento completos, **When** o faturista gera a Guia de Consulta, **Then** o sistema cria a guia com beneficiário, executante, procedimento e valor preenchidos e status "pronta".
2. **Given** um atendimento cujo paciente não tem número de carteira do convênio, **When** o faturista gera a guia, **Then** a guia é criada como "rascunho" e a validação lista "Número da carteira do beneficiário ausente" como impedimento para avançar.
3. **Given** um médico sem número de conselho/UF/CBO preenchidos, **When** o faturista gera a guia, **Then** a validação aponta os dados do profissional executante faltantes.

---

### User Story 3 - Gerar e validar uma Guia de SP/SADT (Priority: P2)

Para atendimentos que envolvem serviços profissionais ou serviços auxiliares de diagnóstico e terapia (exames, procedimentos), o faturista gera a **Guia de SP/SADT**, que carrega blocos distintos de profissional **Solicitante** e **Executante** (cada um com Conselho/Número/UF/CBO) e **uma ou mais linhas de procedimento** com Tabela (domínio 87) + Código, quantidade, via, técnica e valores. A validação cobre as regras adicionais desse tipo de guia.

**Why this priority**: Amplia a cobertura além de consultas para o segundo tipo de guia mais comum em clínicas. Depende da fundação da US1/US2 mas é uma fatia independente (outro tipo de guia, outras regras).

**Independent Test**: Gerar uma SP/SADT com dois procedimentos a partir de um atendimento, ver solicitante e executante distintos e as duas linhas com tabela/código/valores; validar que falta de "via de acesso" em uma linha bloqueia o avanço.

**Acceptance Scenarios**:

1. **Given** um atendimento com dois procedimentos TUSS, **When** o faturista gera a SP/SADT, **Then** a guia tem duas linhas de procedimento, cada uma com Tabela + Código + Qtde + Valor, e blocos solicitante/executante preenchidos.
2. **Given** uma linha de procedimento sem o par Tabela+Código completo, **When** a validação roda, **Then** a guia é impedida de avançar com mensagem clara da linha problemática.

---

### User Story 4 - Organizar guias em lote e exportar o XML TISS (Priority: P1)

O faturista agrupa guias "prontas" de uma mesma operadora em um **lote**, o sistema gera o **número de lote**, monta o XML no schema da ANS (com cabeçalho, guias e epílogo/hash de integridade) e oferece o **download do arquivo** para que o faturista faça o upload no portal da operadora. O sistema **valida o XML contra o schema** antes de liberar o download e impede a exportação se houver erro estrutural.

**Why this priority**: É o entregável que efetivamente faz a clínica receber. Sem o XML válido do lote, todo o resto não vira faturamento. Junto com US1/US2 forma o MVP mínimo de ponta a ponta (configurar → gerar consulta → lote → XML).

**Independent Test**: Selecionar 3 guias prontas da mesma operadora, fechar o lote, baixar o XML e validá-lo contra o XSD oficial da versão-alvo (deve validar sem erros); tentar incluir guia de outra operadora no mesmo lote e ver o bloqueio.

**Acceptance Scenarios**:

1. **Given** 3 guias prontas da operadora X, **When** o faturista fecha o lote, **Then** o sistema gera número de lote, produz o XML TISS e o arquivo valida contra o schema oficial da versão-alvo.
2. **Given** um lote com pelo menos uma guia que não passa na validação de conteúdo, **When** o faturista tenta fechar/exportar, **Then** o sistema impede e lista as guias pendentes.
3. **Given** um lote exportado, **When** o faturista reabre a tela, **Then** o lote aparece com status "exportado" e o arquivo pode ser baixado novamente (mesmo conteúdo/lote).

---

### User Story 5 - Acompanhar status, registrar glosas e reapresentar (Priority: P2)

Após enviar o lote pelo portal da operadora, o faturista acompanha o ciclo de vida de cada guia/lote (**rascunho → pronta → exportada/enviada → paga/glosada**). Quando a operadora devolve o demonstrativo, o faturista **registra manualmente** as glosas (selecionando o motivo da **Tabela 38** + valor glosado) por guia/procedimento, e pode **reabrir/reapresentar** as guias glosadas em um novo lote.

**Why this priority**: Fecha o ciclo financeiro e organiza a recuperação de receita glosada — alto valor para a clínica, mas depende de todo o resto existir primeiro. O registro é manual no MVP (importação automática do retorno fica para follow-up).

**Independent Test**: Marcar uma guia exportada como glosada com motivo da Tabela 38 e valor; gerar um novo lote de reapresentação contendo essa guia; ver o histórico/auditoria da glosa.

**Acceptance Scenarios**:

1. **Given** uma guia exportada, **When** o faturista registra uma glosa com motivo (Tabela 38) e valor glosado, **Then** a guia passa a "glosada" e o valor glosado fica visível no acompanhamento.
2. **Given** uma guia glosada, **When** o faturista a inclui em um novo lote de reapresentação, **Then** o sistema permite e mantém o vínculo com a apresentação anterior para auditoria.
3. **Given** qualquer mudança de status ou registro de glosa, **When** ocorre, **Then** fica registrada na trilha de auditoria append-only com autor e momento.

---

### User Story 6 - Integração com o financeiro (conta a receber da operadora) (Priority: P3)

Quando um lote é exportado/enviado, as guias correspondentes geram um **valor a receber da operadora** no financeiro existente; quando o pagamento é conciliado (parcial, no caso de glosa), entra no fluxo financeiro e **respeita o modelo de repasse médico** já existente.

**Why this priority**: Conecta o faturamento de convênio ao restante do sistema (caixa, repasse), mas a clínica já obtém valor com US1–US5 mesmo sem a conciliação automática. Por isso é P3 e pode ficar para o fim do MVP ou início do follow-up.

**Independent Test**: Exportar um lote e verificar que surge uma conta a receber da operadora com o valor apresentado; registrar um pagamento parcial (com glosa) e ver o repasse médico calculado sobre o valor efetivamente recebido.

**Acceptance Scenarios**:

1. **Given** um lote exportado de R$ X, **When** a exportação ocorre, **Then** existe uma conta a receber da operadora no valor apresentado.
2. **Given** uma guia paga parcialmente (parte glosada), **When** o pagamento é conciliado, **Then** o repasse do médico considera o valor recebido conforme as regras de repasse já modeladas.

---

### Edge Cases

- **Versão TISS divergente entre operadoras:** operadoras diferentes podem aceitar versões diferentes durante janelas de transição — o sistema deve gerar o XML na versão configurada **por operadora**, não uma versão global única.
- **Paciente com dados incompletos** (sem carteira, sem validade do plano, sem CPF quando exigido): guia fica em rascunho com lista de pendências; nunca exporta dado faltante.
- **Médico/contratado pessoa física x pessoa jurídica:** as regras de obrigatoriedade do bloco "profissional executante" mudam conforme contratado seja PF ou PJ.
- **Tabela TUSS desatualizada:** procedimento referenciando código fora da versão de catálogo vigente deve ser sinalizado antes da exportação (causa comum de glosa).
- **Procedimento sem o par Tabela+Código:** bloqueio rígido — nunca exportar procedimento como texto livre.
- **Reapresentação de guia glosada:** precisa rastrear a apresentação original (vínculo) para não parecer guia duplicada à operadora.
- **Valor zerado ou negativo / quantidade zero** em linha de procedimento: bloqueio na validação.
- **Lote misturando operadoras:** proibido — um lote pertence a exatamente uma operadora/contrato.
- **Reexportação do mesmo lote:** deve reproduzir o mesmo conteúdo (mesmo número de lote/hash) para evitar duplicidade no portal.
- **Hash/epílogo:** o XML precisa do hash de integridade exigido pelo padrão; arquivo sem hash válido é rejeitado pela operadora.
- **Assinatura digital:** o lote é assinado com ICP-Brasil no MVP (decisão D2); falha/ausência de certificado válido deve bloquear a exportação com mensagem clara.

## Requirements _(mandatory)_

### Functional Requirements

**Configuração por operadora (US1)**

- **FR-001**: O sistema MUST permitir, por convênio (operadora), habilitar o faturamento TISS e capturar: Registro ANS da operadora, versão TISS adotada por aquela operadora, código do prestador/contratado na operadora, CNPJ do contratado e CNES (quando aplicável).
- **FR-002**: O sistema MUST permitir registrar mapeamentos de tabela de procedimentos necessários por operadora (ex.: tabela própria x TUSS), reutilizando `tuss_codes`/`tuss_catalog_versions` existentes.
- **FR-003**: O sistema MUST validar e bloquear o salvamento da configuração quando faltar qualquer dado obrigatório da operadora, indicando o campo faltante.

**Versão e schema (transversal)**

- **FR-004**: O sistema MUST gerar o XML na versão TISS **configurada por operadora** e validar o XML produzido contra o **schema XSD oficial** dessa versão antes de liberar a exportação.
- **FR-005**: O sistema MUST permitir atualizar a versão TISS suportada/seus schemas sem alteração de código de regras de negócio (catálogo versionado de schemas), dada a obrigatoriedade de acompanhar releases da ANS.
- **FR-006**: O sistema MUST registrar qual versão TISS e qual versão de catálogo de tabelas foram usadas para gerar cada guia/lote (rastreabilidade).

**Geração de guias (US2/US3)**

- **FR-007**: O sistema MUST gerar **Guia de Consulta** a partir de um atendimento, preenchendo automaticamente beneficiário (paciente + carteira), profissional executante (conselho/número/UF/CBO), procedimento (Tabela domínio 87 + Código) e valor.
- **FR-008**: O sistema MUST gerar **Guia de SP/SADT** a partir de um atendimento, com blocos distintos de profissional **solicitante** e **executante** (cada um com Conselho/Número/UF/CBO) e **uma ou mais** linhas de procedimento com Tabela+Código, quantidade, via, técnica e valores.
- **FR-009**: O sistema MUST tratar todo procedimento como o par obrigatório **Tabela (domínio 87) + Código**, nunca como texto livre.
- **FR-010**: O sistema MUST aplicar as regras de obrigatoriedade condicional do padrão (ex.: dados do profissional executante conforme contratado PF/PJ; campos "quando se aplica" como senha/data de autorização).

**Validação (US2/US3/US4)**

- **FR-011**: O sistema MUST validar o conteúdo de cada guia contra os campos obrigatórios do tipo de guia **antes** de permitir avançar de status, exibindo mensagens claras e específicas do que falta (paridade com o bloqueio de prescrição existente).
- **FR-012**: O sistema MUST impedir que uma guia que não passa na validação de conteúdo seja incluída em lote/exportada.
- **FR-013**: O sistema MUST sinalizar procedimentos cujo código não pertença à versão de catálogo TUSS vigente configurada.

**Lote e exportação (US4)**

- **FR-014**: O sistema MUST permitir agrupar guias "prontas" de **uma mesma operadora/contrato** em um lote e gerar o número do lote.
- **FR-015**: O sistema MUST montar o XML do lote conforme a estrutura do padrão (mensagem raiz, cabeçalho, guias, epílogo com **hash de integridade**) e disponibilizar o **download** do arquivo.
- **FR-016**: O sistema MUST impedir lotes que misturem operadoras distintas.
- **FR-017**: O sistema MUST permitir rebaixar o download do mesmo lote reproduzindo conteúdo idêntico (mesmo número de lote/hash), evitando duplicidade no portal.
- **FR-017a**: O sistema MUST assinar digitalmente o XML do lote com **ICP-Brasil** (reusando a assinatura da feature 024) conforme o elemento de assinatura do schema TISS, antes de disponibilizar o download. _(Decisão D2: assinatura incluída no MVP.)_

**Status, glosas e reapresentação (US5)**

- **FR-018**: O sistema MUST manter o ciclo de status por guia e por lote: rascunho → pronta → exportada/enviada → paga/glosada (incluindo parcial).
- **FR-019**: O sistema MUST permitir registrar manualmente glosas por guia/procedimento, selecionando o motivo a partir da **Tabela 38** (incluindo faixa 9901-9999 de motivos próprios da operadora) e o valor glosado.
- **FR-020**: O sistema MUST permitir reapresentar guias glosadas em novo lote, mantendo o vínculo com a apresentação anterior.

**Integração financeira (US6)**

- **FR-021**: O sistema MUST gerar uma conta a receber da operadora a partir do lote exportado, no valor apresentado.
- **FR-022**: O sistema MUST, na conciliação do pagamento (inclusive parcial por glosa), respeitar o modelo de repasse médico existente, calculando sobre o valor efetivamente recebido.

**Conformidade, auditoria e multi-tenant (transversal)**

- **FR-023**: O sistema MUST isolar todos os dados TISS por `tenant_id` (RLS), como o restante do sistema.
- **FR-024**: O sistema MUST registrar em trilha de auditoria append-only toda criação/alteração de configuração, guia, lote, mudança de status e registro de glosa, com autor e momento.
- **FR-025**: O sistema MUST tratar dados sensíveis do paciente nas guias conforme o padrão de cifragem/PII e LGPD já adotado, e atender às exigências do Componente de Segurança e Privacidade do TISS aplicáveis à versão-alvo.
- **FR-026**: O sistema MUST manter catálogo das tabelas de domínio TISS necessárias (no mínimo: domínio 87 tabela-de-tabelas, conselho profissional, CBO, via/técnica para SP/SADT, e Tabela 38 de glosas), versionado.

### Key Entities _(include if feature involves data)_

- **Configuração TISS da Operadora**: por convênio/tenant — Registro ANS, versão TISS adotada, código do contratado na operadora, CNPJ/CNES, mapeamentos de tabela. Relaciona-se a `health_plans`.
- **Guia TISS**: representa uma guia (Consulta ou SP/SADT) gerada a partir de um atendimento. Atributos: tipo, status, operadora, beneficiário, profissional(is), versão TISS/catálogo usados, vínculo ao atendimento e ao lote. Contém linhas de procedimento.
- **Linha de Procedimento da Guia**: Tabela (domínio 87) + Código + Descrição + Qtde + (Via/Técnica para SP/SADT) + Valor Unitário + Valor Total.
- **Lote TISS**: agrupamento de guias de uma mesma operadora; número do lote, status, versão TISS, hash/epílogo, arquivo XML gerado.
- **Glosa**: motivo (Tabela 38) + valor glosado, vinculada a guia/procedimento e à apresentação; suporta reapresentação.
- **Catálogo de Domínios/Schemas TISS**: tabelas de domínio (87, conselho, CBO, via, técnica, Tabela 38) e schemas XSD por versão — versionados.
- **Conta a Receber da Operadora**: ligação ao financeiro existente, valor apresentado x recebido x glosado; respeita repasse médico.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: 100% dos XMLs de lote exportados pelo sistema validam **sem erro** contra o schema XSD oficial da versão TISS-alvo (validação automatizada com os XSDs oficiais).
- **SC-002**: Uma guia de consulta válida pode ser gerada a partir de um atendimento completo em **menos de 1 minuto**, sem digitação manual de dados já existentes no sistema.
- **SC-003**: 0% de guias com campos obrigatórios faltantes conseguem ser incluídas em lote ou exportadas (a validação bloqueia 100% dos casos).
- **SC-004**: Para qualquer guia rejeitada/bloqueada, o faturista recebe a lista exata de pendências (nenhuma mensagem genérica), permitindo correção sem consultar documentação externa.
- **SC-005**: Toda guia/lote exportado é rastreável: versão TISS, versão de catálogo, autor, momento e conteúdo do XML ficam auditáveis.
- **SC-006**: Nenhum dado TISS de um tenant é visível/acessível por outro tenant (isolamento verificado por teste).
- **SC-007**: Glosas registradas reduzem o valor a receber correspondente e permitem reapresentação rastreável, sem perda do vínculo com a apresentação original.

## Out of Scope (MVP) _(follow-up)_

- Envio automático via **webservice SOAP** de cada operadora (no MVP o envio é por download do XML + upload manual no portal).
- **Importação automática** de retorno/demonstrativo de pagamento (Demonstrativo de Análise de Conta / Demonstrativo de Pagamento) — no MVP a glosa é registrada manualmente.
- Guias de **internação** e de **honorários** (foco do MVP: Consulta e SP/SADT).
- **Recurso de glosa eletrônico** (reapresentação no MVP é via novo lote).
- Conciliação bancária automática do pagamento da operadora.

## Pendências de Decisão _(exigem validação humana antes do /speckit.plan — "sem margem para falha")_

> Estas são as decisões que a pesquisa identificou como **não dedutíveis por padrão** e que mudam escopo/conformidade. Devem ser resolvidas antes de planejar a implementação.

- **D1 — Versão TISS exata e XSDs oficiais: ✅ RESOLVIDO.** Verificado direto no PDF oficial `PadroTISS_ComponenteOrganizacional_202605.pdf` (release **Maio/2026**, pub. 28/05/2026 — o mais recente): Componente de Comunicação **04.03.00** (mensagens), fim de implantação **30/06/2026**; Conteúdo e Estrutura **202511**, TUSS **202605**. **Alvo do sistema fixado: 04.03.00 + Conteúdo/Estrutura 202511 + TUSS 202605.** Os XSDs concretos (`.zip` do Componente de Comunicação) serão baixados/versionados no `/speckit.plan` a partir da página do release. _(Manutenção: reconfirmar a cada release ANS.)_
- **D2 — Assinatura digital do lote (ICP-Brasil): ✅ RESOLVIDO.** A assinatura **entra no MVP** (FR-017a), reusando a assinatura ICP-Brasil da feature 024. O formato exato (XMLDSig no elemento de assinatura do `mensagemTISS`) será fixado no `/plan` lendo o Componente de Segurança e Privacidade 202511 + XSD.
- **D3 — Campos obrigatórios da Guia de Consulta: ✅ RESOLVIDO.** Lidos da legenda oficial **Componente de Conteúdo e Estrutura 202511** (planilha/PDF oficiais). Lista confirmada e incorporada ao Contexto Regulatório acima. **Correções vs. pesquisa inicial:** Tipo de Consulta = **domínio 52** (não 53), Indicação de Acidente = **domínio 36** (não 35), UF = **domínio 59**, Técnica (SP/SADT) = **domínio 48** (não 49). A regra "Nome do profissional executante obrigatório quando contratado é PJ" foi confirmada.
- **D4 — Operadora(s) piloto: ✅ RESOLVIDO (direção).** Piloto = **uma operadora grande** (Unimed/Bradesco/Amil) para validar o XML real ponta a ponta. A operadora específica e as particularidades do seu portal serão fixadas no `/speckit.plan`.

**Resultado:** D1, D2, D3 e D4 resolvidos. Resta apenas, já dentro do `/speckit.plan`: (i) baixar e versionar os XSDs 04.03.00; (ii) ler o detalhe de assinatura no Componente de Segurança e Privacidade; (iii) escolher a operadora-piloto concreta.

## Assumptions

- **Reuso de dados existentes:** beneficiário vem de `patients` (com número de carteira do convênio), procedimentos de `tuss_codes`/`procedures`, médico/executante de `doctors` (CPF/conselho/UF — feature 027 já adicionou campos de prescritor; conselho/UF/CBO podem precisar de complemento), convênio de `health_plans`, valores/impostos do financeiro/`taxes`, e repasse do módulo financeiro (feature 023).
- **Envio é manual no MVP:** o sistema entrega o arquivo XML (assinado com ICP-Brasil — D2); o upload no portal da operadora é feito pelo faturista (sem webservice).
- **Glosa é registrada manualmente** no MVP, mapeada à Tabela 38.
- **Catálogo TUSS já existe** (`tuss_codes`/`tuss_catalog_versions`) e será estendido/versionado para cobrir os domínios TISS adicionais necessários (87, conselho, CBO, via, técnica, Tabela 38).
- **Padrões transversais herdados:** RLS por `tenant_id`, auditoria append-only, cifragem/PII e LGPD seguem exatamente os padrões já usados no projeto.
- **Personas:** faturista/financeiro (gera, valida, exporta, acompanha glosas) e admin (configura convênios TISS).

## Dependencies

- Catálogo de **schemas XSD oficiais** da versão TISS-alvo (download da ANS — D1).
- Catálogo de **tabelas de domínio TISS** (87, 26 conselho, 24 CBO, 63 via, 49 técnica, 38 glosas) versionado.
- Dados de cadastro completos: carteira do beneficiário em `patients`; conselho/número/UF/CBO em `doctors`; Registro ANS e código do contratado por operadora (US1).
- Módulo financeiro/repasse existente (feature 023) para US6.
- Assinatura ICP-Brasil existente (feature 024) caso D2 inclua assinatura no MVP.
