# Feature Specification: Odontograma Interativo (Módulo Odontológico — Fase 1)

**Feature Branch**: `039-odontograma-interativo`
**Created**: 2026-06-19
**Status**: Draft
**Input**: User description: "Módulo odontológico — Odontograma interativo (Fase 1). Odontograma clicável em notação FDI/ISO 3950 (dentes permanentes 11–48 e decíduos 51–85), renderizado em SVG. Cada dente tem 5 faces clicáveis e status no nível do dente inteiro e da face. Status mudam a cor/aparência. Catálogo de status administrável pelo painel /admin (super-only) com label, cor, ícone, escopo (dente ou face) e código TUSS odontológico. Registros append-only com auditoria, vinculáveis a um atendimento. Plano de tratamento, periograma, anexos de imagem e evolução clínica ficam para fases futuras."

## Visão Geral

Esta é a **Fase 1** de um módulo odontológico. Entrega o registro clínico do estado dentário de um paciente por meio de um **odontograma interativo**: o profissional abre o prontuário do paciente, vê uma carta dentária com todos os dentes, clica em um dente (ou numa das suas faces) e marca um status (cárie, restauração, ausente, implante, etc.). O status muda a cor/aparência do dente na hora. Cada marcação é um registro **append-only** auditado, opcionalmente vinculado a um atendimento.

O conjunto de status disponíveis (rótulo, cor, ícone, se vale para o dente todo ou para uma face, e o código TUSS odontológico associado) é um **catálogo administrável** pela equipe de plataforma no painel `/admin`, de modo que nenhum status fique fixo no código.

Fora de escopo nesta fase (fases futuras): plano de tratamento/orçamento a partir do odontograma, periograma (periodontia), anexos de imagem (RX/fotos) e linha do tempo de evolução clínica dedicada.

## Clarifications

### Session 2026-06-19

- Q: O catálogo de status é global da plataforma ou customizável por clínica? → A: Global da plataforma (gerido só por super-admin no `/admin`; customização por clínica fica para fase futura).
- Q: Qual tabela TUSS o status deve referenciar? → A: Tabela 22 (procedimentos) — não a 19 (materiais).
- Q: Como o profissional aplica um status ao clicar? → A: Modelo "paleta + pintar" (seleciona o status numa paleta e clica nos dentes/faces para aplicar).
- Q: Cada marcação pode ter observação textual livre? → A: Sim, nota textual opcional por marcação (append-only preservado).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Registrar e visualizar o estado dentário no odontograma (Priority: P1)

O profissional de saúde abre o prontuário de um paciente, acessa a seção **Odontograma** e vê a carta dentária completa em notação FDI. Cada dente é clicável e cada dente expõe suas 5 faces clicáveis (mesial, distal, oclusal/incisal, vestibular, lingual/palatina). Ao clicar num dente ou numa face, o profissional escolhe um status do catálogo (ex.: cárie, restauração, ausente, coroa, implante, extração indicada). O dente/face muda imediatamente de cor/aparência conforme o status. Ao reabrir o prontuário depois, o odontograma reflete o estado atual (o último status registrado por dente/face).

**Why this priority**: É o coração do módulo e o que entrega valor imediato — sem ele não há odontograma. É um MVP demonstrável sozinho (com o catálogo padrão semeado).

**Independent Test**: Abrir um paciente, marcar "cárie" na face oclusal do dente 16 e "ausente" no dente 38, recarregar a página e confirmar que as marcações persistem com as cores corretas. Não depende da UI de administração do catálogo (usa os status padrão semeados).

**Acceptance Scenarios**:

1. **Given** um paciente sem nenhum registro odontológico, **When** o profissional abre a seção Odontograma, **Then** vê todos os dentes permanentes em estado "sem registro" (aparência neutra padrão).
2. **Given** o odontograma aberto, **When** o profissional clica numa face de um dente e seleciona um status de escopo "face", **Then** apenas aquela face muda de cor/aparência conforme a cor do status.
3. **Given** o odontograma aberto, **When** o profissional seleciona um status de escopo "dente" (ex.: "ausente"), **Then** o dente inteiro reflete o status (e suas faces individuais ficam visualmente subordinadas a esse estado).
4. **Given** marcações já feitas, **When** o profissional recarrega o prontuário, **Then** o odontograma mostra o estado atual de cada dente/face (último status registrado vence).
5. **Given** um status já aplicado a uma face, **When** o profissional aplica um status diferente à mesma face, **Then** o novo status passa a ser o estado atual exibido (o anterior permanece no histórico).
6. **Given** um status aplicado, **When** o profissional escolhe a opção de remover/limpar a marcação daquela face/dente, **Then** a face/dente volta ao estado "sem registro" (registrado como novo evento, sem apagar o histórico).

---

### User Story 2 - Administrar o catálogo de status odontológicos no /admin (Priority: P2)

Um super-admin de plataforma acessa o painel `/admin`, abre a gestão do **catálogo de status odontológicos** e pode criar, editar, ativar/desativar status. Para cada status define: rótulo (ex.: "Restauração"), cor, ícone, escopo (dente inteiro ou face) e, opcionalmente, o código TUSS odontológico associado (tabela TUSS 22 — procedimentos). As mudanças passam a valer no odontograma de todas as clínicas.

**Why this priority**: Necessário para que o catálogo não seja fixo no código e possa evoluir sem deploy. Não bloqueia o MVP porque o sistema já vem com um conjunto padrão semeado.

**Independent Test**: Como super-admin, criar um status "Selante" (escopo face, cor verde), desativar o status "Coroa" e confirmar que, ao abrir o odontograma de um paciente, "Selante" aparece como opção e "Coroa" não aparece mais para novas marcações.

**Acceptance Scenarios**:

1. **Given** o super-admin no `/admin`, **When** cria um novo status com rótulo, cor, ícone e escopo, **Then** o status passa a estar disponível para seleção no odontograma.
2. **Given** um status existente em uso, **When** o super-admin o desativa, **Then** ele deixa de aparecer como opção para novas marcações, mas as marcações históricas que o usaram continuam exibidas corretamente.
3. **Given** o formulário de status, **When** o super-admin associa um código TUSS odontológico, **Then** o status fica vinculado a esse código (preparando integração futura com plano de tratamento/faturamento).
4. **Given** um usuário não super-admin, **When** tenta acessar a gestão do catálogo, **Then** o acesso é negado.

---

### User Story 3 - Vincular marcações a um atendimento e auditar o histórico (Priority: P3)

Ao registrar status no odontograma durante (ou a partir de) um atendimento, as marcações ficam vinculadas àquele atendimento. Cada marcação é imutável e auditada (quem, quando, o quê), permitindo rastrear a evolução do estado dentário ao longo do tempo.

**Why this priority**: Agrega rastreabilidade clínica e prepara integração com atendimentos/faturamento, mas o registro básico já tem valor sem o vínculo explícito.

**Independent Test**: Registrar uma marcação a partir de um atendimento específico, e confirmar via auditoria que o registro guarda o atendimento, o autor e o horário, e que não pode ser editado/apagado por vias normais.

**Acceptance Scenarios**:

1. **Given** um atendimento em aberto, **When** o profissional registra status no odontograma naquele contexto, **Then** as marcações ficam associadas ao atendimento.
2. **Given** uma marcação registrada, **When** se inspeciona a auditoria, **Then** constam autor, horário e o status aplicado.
3. **Given** uma marcação registrada, **When** se tenta alterá-la ou removê-la diretamente, **Then** a operação é rejeitada (correção é sempre um novo registro).

---

### Edge Cases

- **Dentição decídua/mista**: pacientes infantis usam dentes decíduos (51–85). O odontograma permite alternar/visualizar dentes permanentes e decíduos; um mesmo paciente pode ter registros nos dois conjuntos (dentição mista).
- **Status de dente vs. status de face conflitantes**: se um dente recebe status de escopo "dente" (ex.: "ausente"), o estado do dente prevalece visualmente sobre marcações de face; a seleção de status de face deve ficar indisponível ou claramente subordinada nesse caso.
- **Status desativado no catálogo**: marcações históricas que usaram um status hoje desativado continuam sendo exibidas com sua cor/rótulo originais.
- **Paciente anonimizado**: o odontograma é dado clínico (não PII direta); para paciente anonimizado o acesso segue a mesma regra dos demais dados clínicos do prontuário.
- **Catálogo vazio**: caso (hipotético) não exista nenhum status ativo, o odontograma continua renderizando os dentes mas sem opções de marcação — sem erro.
- **Face inexistente para o dente**: incisivos não têm face oclusal (têm incisal); a face oclusal/incisal é tratada como a mesma posição, rotulada conforme o tipo de dente.
- **Concorrência**: dois profissionais marcando o mesmo dente quase ao mesmo tempo — como append-only, ambos os eventos são gravados e o mais recente define o estado atual.

## Requirements *(mandatory)*

### Functional Requirements

#### Odontograma interativo (US1)

- **FR-001**: O sistema MUST exibir um odontograma em notação FDI/ISO 3950 com os dentes permanentes (11–18, 21–28, 31–38, 41–48) e suporte aos dentes decíduos (51–55, 61–65, 71–75, 81–85).
- **FR-002**: Cada dente MUST ser clicável e MUST expor 5 faces clicáveis individualmente: mesial, distal, oclusal/incisal, vestibular e lingual/palatina.
- **FR-003**: O sistema MUST permitir aplicar um status de escopo "face" a uma face específica e um status de escopo "dente" ao dente inteiro.
- **FR-004**: Ao aplicar um status, o dente ou a face MUST mudar de cor/aparência imediatamente, conforme a cor definida no catálogo.
- **FR-004a**: A aplicação de status MUST seguir o modelo "paleta + pintar": o profissional seleciona um status numa paleta de ferramentas e, em seguida, clica em um ou mais dentes/faces para aplicá-lo (permitindo marcar vários alvos em sequência com o mesmo status selecionado).
- **FR-005**: O sistema MUST exibir, ao abrir o odontograma, o **estado atual** de cada dente/face, definido como o status mais recentemente registrado para aquela posição.
- **FR-006**: O sistema MUST permitir limpar/remover uma marcação, registrando essa remoção como um novo evento (sem apagar o histórico), voltando a posição ao estado "sem registro".
- **FR-007**: O sistema MUST permitir alternar a visualização entre dentição permanente e decídua e MUST suportar registros em ambos os conjuntos para o mesmo paciente.
- **FR-008**: O odontograma MUST estar acessível como uma seção dentro do prontuário do paciente.

#### Catálogo de status administrável (US2)

- **FR-009**: O sistema MUST manter um catálogo de status odontológicos, cada um com: rótulo, cor, ícone, escopo (`dente` ou `face`) e código TUSS odontológico opcional.
- **FR-010**: O sistema MUST permitir que apenas super-admins de plataforma criem, editem e ativem/desativem status do catálogo a partir do painel `/admin`.
- **FR-011**: O sistema MUST negar a usuários não super-admin o acesso à gestão do catálogo.
- **FR-012**: O sistema MUST oferecer, no odontograma, apenas os status **ativos** como opções de marcação, filtrados pelo escopo aplicável (status de face só para faces, de dente só para dentes).
- **FR-013**: O sistema MUST continuar exibindo corretamente marcações históricas cujo status tenha sido posteriormente desativado (preservando rótulo e cor à época do uso ou os atuais do status).
- **FR-014**: O sistema MUST vir com um conjunto padrão de status semeado (ex.: hígido/sem registro, cárie, restauração, ausente, coroa, implante, extração indicada, fratura), para que o módulo funcione sem configuração inicial.
- **FR-015**: O catálogo de status MUST permitir associação opcional a um código da tabela TUSS odontológica (tabela 22 — procedimentos), reutilizando o catálogo TUSS existente.

#### Registro, vínculo e auditoria (US3)

- **FR-016**: Cada marcação MUST ser um registro **append-only**: não pode ser alterado nem apagado por vias normais; correções são sempre novos registros.
- **FR-017**: Cada marcação MUST registrar paciente, dente (FDI), face (quando aplicável), status, autor e horário.
- **FR-017a**: Cada marcação MUST permitir uma observação textual livre opcional (ex.: "cárie profunda, avaliar canal"), gravada junto ao registro append-only.
- **FR-018**: Cada marcação MUST poder ser vinculada opcionalmente a um atendimento.
- **FR-019**: O sistema MUST auditar a criação de cada marcação (quem, quando, o quê), no mesmo padrão de auditoria das demais entidades clínicas.
- **FR-020**: O sistema MUST isolar os registros odontográficos por clínica (tenant), de modo que uma clínica nunca veja dados de outra.
- **FR-021**: A criação de marcações MUST ser restrita aos papéis com permissão clínica (ex.: administrador e profissional de saúde), seguindo o modelo de papéis existente.

### Key Entities *(include if feature involves data)*

- **Status odontológico (catálogo)**: tipo de marcação disponível no odontograma. Atributos: rótulo, cor, ícone, escopo (dente/face), código TUSS opcional, ativo/inativo. Catálogo de plataforma, gerido por super-admin.
- **Marcação odontográfica (registro)**: evento clínico append-only que aplica um status a uma posição. Atributos: clínica (tenant), paciente, número do dente (FDI), face (opcional, nulo para escopo dente), status aplicado, observação textual opcional, atendimento (opcional), autor, horário. Relaciona-se a Paciente, Atendimento e Status odontológico.
- **Dente / Face (modelo de posição)**: representação lógica da carta dentária (32 dentes permanentes + 20 decíduos; 5 faces por dente) usada para posicionar marcações; é conceito de domínio, não necessariamente uma tabela.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Um profissional consegue registrar o status de uma face dentária em até 3 cliques a partir do prontuário do paciente.
- **SC-002**: Após marcar qualquer dente/face e recarregar o prontuário, 100% das marcações persistidas reaparecem com a cor/aparência corretas.
- **SC-003**: A mudança de cor/aparência ao aplicar um status é percebida como instantânea pelo usuário (resposta visual em menos de 1 segundo após o clique).
- **SC-004**: Um super-admin consegue adicionar um novo status ao catálogo e vê-lo disponível no odontograma sem necessidade de novo deploy de software.
- **SC-005**: Nenhuma marcação pode ser editada ou apagada por usuários finais; toda correção gera um novo registro, comprovável pela trilha de auditoria.
- **SC-006**: Em testes com clínicas distintas, nenhuma clínica consegue visualizar registros odontográficos de outra (isolamento por tenant verificado).
- **SC-007**: O módulo opera corretamente desde o primeiro uso com o catálogo padrão semeado, sem configuração manual prévia.

## Assumptions

- **Catálogo global de plataforma**: dado que a gestão é "super-only no /admin", o catálogo de status é tratado como **global da plataforma** (compartilhado por todas as clínicas), não per-clínica. Customização por clínica fica para fase futura, se necessária. Há um conjunto padrão semeado por migração.
- **TUSS odontológico = tabela 22 (procedimentos)**: a associação de status a código TUSS usa a tabela 22 (procedimentos) do catálogo TUSS já existente. A tabela 19 (materiais) fica para fases futuras (plano de tratamento/faturamento).
- **Reuso da arquitetura existente**: isolamento por tenant (RLS), padrão de migrations, papéis/permissões, auditoria (`log_audit_event`) e o prontuário do paciente (onde a seção do odontograma será inserida) são reaproveitados.
- **Estado atual derivado do histórico**: não há "edição" de estado; o estado exibido é sempre o último registro append-only por posição (dente/face). Isso evita tabela de estado mutável e mantém histórico completo.
- **Dado clínico, sem criptografia de PII**: marcações odontográficas não são PII direta e seguem o tratamento dos demais dados clínicos (não usam as colunas cifradas de paciente).
- **Sem novas dependências de runtime**: o odontograma é renderizado com a stack já presente (SVG/React), sem bibliotecas externas de odontograma.
- **Anexos de imagem, periograma, plano de tratamento e evolução clínica dedicada estão fora de escopo** desta fase e serão especificados separadamente.

## Out of Scope (Fase 1)

- Plano de tratamento / orçamento gerado a partir do odontograma.
- Periograma (registro periodontal: sondagem, mobilidade, sangramento).
- Anexos de imagem (radiografias, fotos intraorais) por dente.
- Linha do tempo / evolução clínica dedicada ao odontograma (além do registro append-only e auditoria).
- Customização do catálogo de status por clínica (catálogo é global nesta fase).
- Faturamento TISS odontológico a partir das marcações.
