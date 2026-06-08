# Feature Specification: Página do Paciente (Portal) + Módulo de Endocrinologia

**Feature Branch**: `030-portal-paciente-endocrino`
**Created**: 2026-06-02
**Status**: Draft
**Input**: User description: "Página do Paciente (portal de consulta) + Módulo de Endocrinologia — o paciente consulta seu histórico de atendimento e a evolução de métricas corporais e metabólicas; login leve por CPF + data de nascimento, sem criar conta; equipe registra as métricas no prontuário."

## Contexto e Decisões

Primeira **superfície voltada ao paciente** do sistema (hoje tudo é só para a equipe da clínica). O paciente passa a **consultar** (somente leitura) o próprio histórico e a evolução das suas métricas, com foco em **endocrinologia** (peso/IMC + métricas metabólicas). Estrategicamente, os dados de evolução são modelados por um **motor de medições genérico** reutilizável por outras especialidades no futuro — endocrinologia é a primeira configuração.

**Decisões do dono (já tomadas):**
- **Acesso sem conta:** o paciente entra com **CPF** (login) + **data de nascimento, só números** (senha), num link **por clínica** (ex.: `/paciente/[clínica]`). Não há criação de conta nem senha própria.
- **Métricas do MVP:** peso/IMC (reaproveitados) **+ metabólicas novas** (glicemia de jejum, HbA1c, circunferência abdominal, perfil lipídico).
- **Segurança é requisito, não opção** (dado de saúde / LGPD): por ser autenticação fraca, o MVP **obriga** anti-força-bruta, sessão curta só-leitura, auditoria e consentimento (ver Requisitos de Segurança).

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Paciente entra e vê sua evolução (Priority: P1)

Uma paciente em acompanhamento endócrino recebe da clínica o link do portal. Ela abre, informa **CPF e a data de nascimento (só números)**, aceita o aviso de privacidade e entra numa **página única** onde vê: seu **histórico de atendimentos**, o **gráfico de evolução do peso/IMC** e os **gráficos das métricas metabólicas** (glicemia, HbA1c, circunferência, lipídios). Ela não consegue editar nada, e só vê os **próprios** dados.

**Why this priority**: É o coração da feature e a razão de existir — o paciente consultar a própria evolução. Entrega valor sozinho (engajamento/retenção) assim que houver dados.

**Independent Test**: Com um paciente que tem medições registradas, fazer login com CPF + nascimento e confirmar que a página mostra histórico + gráficos apenas desse paciente; tentar com nascimento errado e ver o acesso negado.

**Acceptance Scenarios**:

1. **Given** uma paciente cadastrada na clínica com CPF e medições, **When** ela informa CPF + data de nascimento corretos e aceita o aviso, **Then** vê sua página com histórico de atendimentos e gráficos de evolução, sem opções de edição.
2. **Given** a mesma paciente, **When** ela informa a data de nascimento errada, **Then** o acesso é negado com mensagem genérica (sem revelar se o CPF existe).
3. **Given** duas clínicas com pacientes de mesmo CPF, **When** a paciente acessa o link da Clínica A, **Then** vê somente os dados dela na Clínica A (nunca da Clínica B).
4. **Given** uma paciente logada, **When** tenta acessar dados de outro paciente (ex.: manipulando a navegação), **Then** o sistema impede e não retorna dado de terceiro.

---

### User Story 2 — Equipe registra as métricas metabólicas no prontuário (Priority: P1)

O profissional de saúde, durante/depois do atendimento, registra no prontuário do paciente as **métricas metabólicas** (glicemia, HbA1c, circunferência abdominal, perfil lipídico) com a **data da medição**. Esses valores passam a compor a evolução que o paciente enxerga.

**Why this priority**: Sem entrada de dados, o portal do paciente fica vazio. É o lado que alimenta a US1 — os dois juntos formam o MVP.

**Independent Test**: Registrar, como profissional, uma HbA1c com data; confirmar que aparece no histórico/evolução do paciente e que recepcionista não consegue registrar (RBAC).

**Acceptance Scenarios**:

1. **Given** um profissional no prontuário de um paciente, **When** registra uma métrica metabólica (tipo, valor, unidade, data), **Then** ela é salva e passa a aparecer na evolução.
2. **Given** uma medição já registrada, **When** alguém tenta apagá-la, **Then** o sistema impede (registro append-only; correção é nova medição).
3. **Given** um valor fora de faixa plausível (ex.: HbA1c 99), **When** o profissional tenta salvar, **Then** o sistema avisa/bloqueia.

---

### User Story 3 — Histórico de atendimentos no portal (Priority: P2)

A paciente vê a **lista dos seus atendimentos** (data, profissional, e um resumo/tipo), para entender sua jornada de cuidado.

**Why this priority**: Complementa a evolução com o contexto dos atendimentos. Depende do login (US1) mas é uma fatia independente (reaproveita dados que já existem).

**Independent Test**: Logar como paciente com atendimentos passados e ver a lista correta, somente leitura, apenas do próprio paciente.

**Acceptance Scenarios**:

1. **Given** uma paciente com 3 atendimentos, **When** abre o histórico, **Then** vê os 3 com data e profissional, em ordem cronológica.
2. **Given** o histórico, **When** a paciente o consulta, **Then** não vê valores financeiros nem dados de outros pacientes.

---

### Edge Cases

- **Paciente sem CPF cadastrado:** não consegue usar o portal (CPF é a chave de login) — mensagem orientando procurar a clínica.
- **CPF repetido na mesma clínica:** dois cadastros com o mesmo CPF devem ser tratados de forma determinística (bloquear acesso ambíguo e sinalizar à clínica), nunca expor o prontuário errado.
- **Data de nascimento ausente no cadastro:** sem a "senha", o acesso é impossível — orientar a clínica a completar.
- **Tentativas repetidas (força-bruta):** após N tentativas falhas, bloquear temporariamente por CPF/IP.
- **Sessão expirada:** após o tempo-limite, o paciente precisa logar de novo.
- **Paciente anonimizado/LGPD:** paciente com anonimização ativa não acessa o portal.
- **Sem medições ainda:** a página mostra estado vazio amigável ("ainda não há medições registradas"), não erro.
- **Métrica sem evolução suficiente (1 ponto):** mostrar o valor mesmo sem linha de tendência.

## Requirements *(mandatory)*

### Functional Requirements

**Acesso do paciente (US1)**
- **FR-001**: O sistema MUST permitir que o paciente acesse um portal **por clínica** informando **CPF** e **data de nascimento (somente números)**, sem criar conta.
- **FR-002**: O sistema MUST conceder acesso somente quando CPF **e** data de nascimento conferirem com um cadastro de paciente **daquela clínica**.
- **FR-003**: O sistema MUST exibir, ao paciente autenticado, **somente os dados do próprio paciente**, escopados àquela clínica — nunca de terceiros nem de outra clínica.
- **FR-004**: O paciente MUST ter acesso **somente leitura**; nenhuma ação de edição de prontuário é exposta no portal.
- **FR-005**: O sistema MUST exibir um **aviso/consentimento de privacidade (LGPD)** antes de liberar o conteúdo.

**Conteúdo do portal (US1/US3)**
- **FR-006**: O sistema MUST apresentar uma **página única** ("centralizada") com: histórico de atendimentos, evolução de peso/IMC e evolução das métricas metabólicas.
- **FR-007**: O sistema MUST apresentar a **evolução de peso e IMC** ao longo do tempo (gráfico) com a classificação de faixa de IMC, reaproveitando os sinais vitais já registrados.
- **FR-008**: O sistema MUST apresentar a **evolução das métricas metabólicas** (glicemia de jejum, HbA1c, circunferência abdominal, perfil lipídico: colesterol total, LDL, HDL, triglicérides), cada uma com gráfico no tempo.
- **FR-009**: O sistema MUST apresentar o **histórico de atendimentos** do paciente (data, profissional, resumo/tipo), sem dados financeiros.
- **FR-010**: O sistema MUST exibir **estados vazios amigáveis** quando não houver medições/atendimentos.

**Registro pela equipe (US2)**
- **FR-011**: O sistema MUST permitir que **profissional de saúde** (e admin) registre métricas metabólicas no prontuário do paciente, informando tipo, valor, unidade e **data da medição**.
- **FR-012**: O sistema MUST tratar cada medição como **append-only** (correção = nova medição; não há edição/exclusão física).
- **FR-013**: O sistema MUST **validar faixas plausíveis** por tipo de métrica e bloquear valores impossíveis, com mensagem clara.
- **FR-014**: O sistema MUST impedir que papéis sem permissão clínica (ex.: recepcionista/financeiro) registrem medições.

**Motor de medições (transversal/estratégico)**
- **FR-015**: O sistema MUST armazenar as métricas num **modelo genérico de medições longitudinais** (tipo de métrica + valor + unidade + data + autor), reutilizável por outras especialidades no futuro.
- **FR-016**: O sistema MUST permitir definir **quais métricas compõem o módulo de endocrinologia** sem exigir novo modelo de dados para cada especialidade.

**Segurança, privacidade e isolamento (transversal — requisito, não opção)**
- **FR-017**: O sistema MUST aplicar **proteção anti-força-bruta**: limitar tentativas e **bloquear temporariamente** por CPF/IP após um número de falhas.
- **FR-018**: O sistema MUST usar **sessão de paciente curta** e separada do login da equipe; a sessão do paciente **não concede nenhum acesso** ao painel da clínica.
- **FR-019**: Mensagens de falha de login MUST ser **genéricas** (não revelar se o CPF existe).
- **FR-020**: O sistema MUST **auditar** cada acesso do paciente (login e consultas) em trilha append-only.
- **FR-021**: O sistema MUST tratar PII conforme o **padrão de cifragem** já adotado e respeitar **multi-tenant por clínica** em todas as leituras.
- **FR-022**: O sistema MUST negar acesso a pacientes **anonimizados/inativos**.

### Key Entities *(include if data involved)*

- **Medição do Paciente (motor de evolução)**: representa um valor de uma métrica num momento — paciente, clínica, **tipo de métrica** (ex.: glicemia, HbA1c, circunferência, colesterol total/LDL/HDL/triglicérides), **valor**, **unidade**, **data da medição**, quem registrou. Append-only. Base reutilizável por outras especialidades.
- **Tipo de Métrica / Configuração de Especialidade**: catálogo de quais métricas existem e como se apresentam (unidade, faixas plausíveis, rótulo), e quais compõem o módulo de endocrinologia.
- **Sessão do Paciente**: vínculo temporário e só-leitura entre o paciente autenticado e seus dados naquela clínica; curta duração; separada do login da equipe.
- **Registro de Acesso do Paciente**: trilha de auditoria de logins e consultas (sucesso/falha), para segurança e LGPD.
- **Sinal Vital (reuso)**: peso/altura/IMC/PA já existentes — fonte da evolução de peso/IMC.
- **Atendimento (reuso)**: fonte do histórico de atendimentos exibido ao paciente.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Um paciente com CPF e data de nascimento corretos consegue acessar e ver sua evolução em **menos de 1 minuto**, sem criar conta.
- **SC-002**: 100% dos acessos retornam **somente** dados do próprio paciente e da clínica correta (verificado por teste de isolamento).
- **SC-003**: 0% de chance de um paciente editar prontuário pelo portal (somente leitura garantida por teste).
- **SC-004**: Tentativas repetidas de login com dados errados são **bloqueadas** após o limite definido (anti-força-bruta verificado por teste).
- **SC-005**: Toda métrica registrada pela equipe aparece na evolução do paciente e **não pode ser apagada** (append-only verificado por teste).
- **SC-006**: Mensagens de falha de login **não revelam** se um CPF existe (verificado por teste).
- **SC-007**: O modelo de medições suporta adicionar **uma nova métrica/especialidade** sem alteração de esquema (verificável conceitualmente no design).

## Out of Scope (MVP) *(follow-up)*

- App mobile **nativo** (o portal é web responsivo).
- **Conta de paciente** com senha própria, recuperação de senha ou login social.
- **Fator extra de verificação** (código de 4 dígitos por WhatsApp/e-mail) — follow-up de segurança recomendado.
- **Metas** (peso-alvo / HbA1c-alvo) e gamificação.
- Integração com **glicosímetro/balança/wearables**.
- **Outras especialidades** além de endocrinologia (o motor é genérico, mas só endócrino é configurado agora).
- **Edição de dados pelo paciente** (ex.: o paciente lançar o próprio peso) — possível no futuro, fora do MVP.

## Assumptions

- **Login por clínica:** o portal é acessado por um link específico da clínica; a resolução da clínica acontece pelo link (slug), como no agendamento público existente.
- **CPF como chave:** pacientes sem CPF não usam o portal; a clínica é orientada a completar o cadastro. CPF deve ser único por paciente dentro da clínica.
- **Defaults de segurança (a confirmar no plano):** limite ~5 tentativas com bloqueio temporário; sessão de ~30 minutos; consentimento exibido a cada novo acesso.
- **Reuso:** peso/IMC vêm dos sinais vitais já registrados; o histórico vem dos atendimentos já existentes; PII segue o padrão de cifragem e o isolamento multi-tenant já usados.
- **Entrada de dados:** a equipe registra as métricas no prontuário (a feature inclui essa tela); o paciente não insere dados no MVP.
- **Faixas plausíveis** por métrica seguem referências clínicas usuais (a precisar de revisão clínica no plano).

## Dependencies

- Cadastro de paciente com **CPF** e **data de nascimento** preenchidos (PII cifrada existente).
- **Sinais vitais** existentes (peso/IMC) e **atendimentos** existentes (histórico).
- Padrão de **rate-limit** já usado no agendamento público (reuso para anti-força-bruta).
- Padrões transversais: cifragem/PII, auditoria append-only, isolamento multi-tenant.
