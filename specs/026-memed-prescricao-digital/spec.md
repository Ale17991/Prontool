# Feature Specification: Integração Memed — Prescrição Digital

**Feature Branch**: `026-memed-prescricao-digital`  
**Created**: 2026-05-26  
**Status**: Draft  
**Input**: User description: "Integração com a Memed (prescrição digital) no Prontool — permitir que profissionais de saúde emitam prescrição digital dentro do fluxo de atendimento/prontuário, atendendo qualquer tipo de clínica, com credenciais seguras, registro de prescritor, proxy de token, frontend de prescrição e conformidade de produção."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Emitir prescrição digital durante o atendimento (Priority: P1)

Um profissional de saúde, com um paciente em atendimento aberto, aciona "Prescrever", a tela de prescrição da Memed abre já com o paciente carregado, ele monta a receita (com os alertas de interação medicamentosa da Memed) e a emite em poucos cliques. A prescrição emitida fica registrada e vinculada àquele atendimento e paciente.

**Why this priority**: É o coração da feature e a única parte que entrega valor direto ao usuário final (o profissional). Sem ela, nada mais tem propósito.

**Independent Test**: Com um prescritor já habilitado e um paciente com dados completos, abrir um atendimento, acionar "Prescrever", confirmar que o paciente aparece pré-carregado, emitir uma prescrição de teste em homologação e verificar que ela foi registrada e vinculada ao atendimento.

**Acceptance Scenarios**:

1. **Given** um atendimento aberto com paciente que tem nome, CPF, e-mail, celular e nascimento, e um profissional habilitado como prescritor, **When** o profissional aciona "Prescrever", **Then** a tela de prescrição abre já com o paciente carregado, sem necessidade de redigitar dados.
2. **Given** a tela de prescrição aberta, **When** o profissional emite a prescrição, **Then** o sistema registra a prescrição vinculada ao atendimento/paciente/profissional e a confirmação é refletida na tela de atendimento.
3. **Given** um paciente sem um dos dados obrigatórios para prescrição (ex.: CPF ausente), **When** o profissional aciona "Prescrever", **Then** o sistema impede o início e orienta, em linguagem clara, qual dado do paciente precisa ser completado.

---

### User Story 2 - Habilitar um profissional como prescritor (Priority: P1)

Um administrador prepara um profissional para prescrever: o sistema confere se os dados exigidos (CPF, conselho + UF, data de nascimento) estão preenchidos e, estando completos, registra/atualiza esse profissional como prescritor junto à Memed, deixando-o pronto para emitir.

**Why this priority**: É pré-requisito técnico do US1 — sem um prescritor registrado e com token válido, não há prescrição. É um corte independente: dá para validar o registro sem ainda ter a tela de prescrição pronta.

**Independent Test**: Em um profissional com os 3 campos preenchidos, acionar a habilitação como prescritor e confirmar que ele passa a constar como registrado e apto; em um profissional com dados faltando, confirmar que a habilitação é bloqueada com mensagem que aponta para a edição do profissional.

**Acceptance Scenarios**:

1. **Given** um profissional com CPF, conselho+UF e nascimento preenchidos, **When** o administrador o habilita como prescritor, **Then** o sistema o registra na Memed e passa a indicá-lo como apto a prescrever.
2. **Given** um profissional sem um dos campos obrigatórios, **When** o administrador tenta habilitá-lo, **Then** o sistema bloqueia e informa exatamente o que falta, com atalho para completar o cadastro.
3. **Given** um profissional já registrado cujos dados mudaram (ex.: correção de CPF), **When** o cadastro é atualizado, **Then** o registro do prescritor é mantido consistente com os dados atuais.

---

### User Story 3 - Registrar e auditar prescrições emitidas e excluídas (Priority: P2)

Toda prescrição emitida e toda exclusão de prescrição ficam registradas e auditáveis, vinculadas ao atendimento, paciente e profissional, para rastreabilidade clínica e exigência da própria Memed.

**Why this priority**: É requisito de conformidade da Memed e de rastreabilidade clínica/LGPD, mas a emissão (US1) já entrega valor antes do histórico estar completo.

**Independent Test**: Emitir uma prescrição e confirmar o registro de auditoria correspondente; excluir uma prescrição na tela da Memed e confirmar que a exclusão também é capturada e auditada.

**Acceptance Scenarios**:

1. **Given** uma prescrição emitida, **When** o evento de emissão ocorre, **Then** o sistema registra o evento (com vínculo a atendimento/paciente/profissional e horário) de forma auditável.
2. **Given** uma prescrição excluída na interface da Memed, **When** o evento de exclusão ocorre, **Then** o sistema registra a exclusão de forma auditável.
3. **Given** um histórico de prescrições de um paciente, **When** um usuário autorizado consulta o atendimento, **Then** consegue ver que houve prescrição(ões) emitida(s) naquele atendimento.

---

### User Story 4 - Mapear a especialidade do profissional para o catálogo da Memed (Priority: P2)

Como a especialidade no Prontool é texto livre e a Memed exige um identificador do catálogo dela, o sistema permite associar a especialidade do profissional ao item correspondente do catálogo Memed, melhorando a qualidade da receita.

**Why this priority**: Aumenta a fidelidade do cabeçalho da receita, mas a prescrição pode funcionar com especialidade ausente/genérica; portanto não bloqueia o MVP.

**Independent Test**: Para um profissional com especialidade em texto livre, selecionar a especialidade correspondente do catálogo Memed e confirmar que o registro do prescritor passa a refletir essa especialidade.

**Acceptance Scenarios**:

1. **Given** um profissional com especialidade em texto livre, **When** o administrador associa essa especialidade a um item do catálogo Memed, **Then** o registro do prescritor passa a usar o identificador correto.
2. **Given** uma especialidade sem correspondência selecionada, **When** o prescritor é registrado, **Then** o sistema registra sem especialidade (sem impedir a emissão) e sinaliza a pendência.

---

### User Story 5 - Operar em homologação e promover para produção com conformidade (Priority: P3)

A equipe constrói e valida toda a integração em ambiente de homologação (sem depender de aprovação externa) e, quando pronta, alterna para produção após atender aos requisitos de conformidade exigidos pela Memed (cadastro de prescritor completo, dados de paciente completos, captura dos eventos de emissão/exclusão, aceite de termo de responsabilidade e nenhuma credencial exposta no frontend).

**Why this priority**: É a etapa final que destrava o uso real, mas todo o desenvolvimento e a validação acontecem antes dela em homologação.

**Independent Test**: Validar o fluxo completo em homologação; depois, alternar a configuração para produção e confirmar que o sistema passa a usar o ambiente correto sem qualquer credencial sensível chegar ao navegador.

**Acceptance Scenarios**:

1. **Given** o ambiente de homologação configurado, **When** a equipe executa o fluxo completo de prescrição, **Then** tudo funciona sem precisar de aprovação externa.
2. **Given** os requisitos de conformidade atendidos, **When** a configuração é alternada para produção, **Then** o sistema passa a operar em produção usando as credenciais de produção, mantendo-as exclusivamente no servidor.
3. **Given** qualquer tela da feature, **When** inspecionada no navegador, **Then** nenhuma chave/segredo da Memed está presente no frontend.

---

### Edge Cases

- **Dados do paciente incompletos**: paciente sem CPF, e-mail, celular ou data de nascimento → bloquear a abertura da prescrição com mensagem clara sobre o que completar (sem expor PII desnecessária).
- **Token expirado durante a sessão**: o token do prescritor é dinâmico e expira → o sistema deve obter um token válido a cada abertura da prescrição (e tratar expiração no meio do uso sem perder o trabalho do usuário sempre que possível).
- **Máquina compartilhada (recepção)**: ao trocar de profissional prescritor no mesmo navegador, encerrar a sessão da prescrição anterior para não vazar contexto entre prescritores.
- **Indisponibilidade/timeout da Memed**: falha de rede ou serviço fora → mensagem amigável e a possibilidade de tentar novamente, sem travar o atendimento.
- **Profissional não-prescritor / dados incompletos**: profissional sem os campos obrigatórios → ação de prescrever indisponível com orientação para completar o cadastro.
- **Falha ao carregar o script de prescrição**: navegador não suportado ou bloqueio de script → comunicar requisito e impedir um estado quebrado.
- **Prescrição excluída após emitida**: refletir a exclusão no registro/auditoria.
- **Especialidade sem correspondência no catálogo Memed**: registrar sem especialidade, sinalizando pendência, sem bloquear.
- **Revogação/monitoramento pela Memed**: a integração pode ser auditada por até 180 dias e revogada por não conformidade → manter os requisitos continuamente atendidos.

## Requirements *(mandatory)*

### Functional Requirements

**Credenciais e ambiente**

- **FR-001**: O sistema MUST armazenar as credenciais da Memed (par de chaves) exclusivamente no lado servidor, nunca acessíveis pelo frontend.
- **FR-002**: O sistema MUST suportar dois ambientes — homologação e produção — e permitir operar inteiramente em homologação sem qualquer aprovação externa.
- **FR-003**: O sistema MUST armazenar as credenciais da Memed **por clínica (tenant)**: cada clínica conecta sua própria conta Memed e seu par de chaves é guardado cifrado, seguindo o padrão multi-tenant de integrações já existente no produto. Clínicas sem conta conectada simplesmente não oferecem prescrição digital.
- **FR-004**: O sistema MUST oferecer uma configuração, por clínica e restrita a administradores, para conectar/atualizar/desconectar a conta Memed e escolher o ambiente (homologação/produção) daquela clínica.
- **FR-004a**: O sistema MUST garantir que nenhuma chave ou segredo da Memed apareça no código de frontend, em respostas de API destinadas ao navegador ou em logs.

**Registro do prescritor**

- **FR-005**: O sistema MUST permitir habilitar um profissional como prescritor a partir do cadastro existente, reutilizando os dados já coletados (nome, CPF, conselho, número e UF do conselho, data de nascimento).
- **FR-006**: O sistema MUST validar a presença dos dados obrigatórios do prescritor antes de tentar o registro e, quando faltarem, MUST bloquear com mensagem clara que aponte para a edição do profissional.
- **FR-007**: O sistema MUST registrar e atualizar o prescritor junto à Memed mantendo o vínculo estável entre o profissional do Prontool e o prescritor correspondente na Memed.
- **FR-008**: O sistema MUST manter o registro do prescritor consistente quando os dados do profissional forem corrigidos/atualizados.
- **FR-009**: O sistema SHOULD derivar nome e sobrenome a partir do nome completo do profissional quando a Memed exigir os campos separados.

**Token e abertura da prescrição**

- **FR-010**: O sistema MUST obter um token de prescritor válido a cada abertura da prescrição, tratando o fato de que o token expira, sem nunca expor as chaves ao navegador.
- **FR-011**: O sistema MUST disponibilizar a ação "Prescrever" no contexto de um atendimento/prontuário, somente para profissionais habilitados como prescritores.
- **FR-012**: O sistema MUST pré-carregar os dados do paciente do atendimento na tela de prescrição (identificação, contato, nascimento, sexo e endereço quando disponíveis), sem exigir redigitação.
- **FR-013**: O sistema MUST decifrar os dados do paciente apenas no servidor e entregá-los à tela de prescrição somente para o usuário autenticado que já tem acesso àquele paciente.
- **FR-014**: O sistema MUST bloquear a abertura da prescrição quando faltarem dados obrigatórios do paciente, orientando o que completar.
- **FR-015**: O sistema MUST encerrar a sessão de prescrição anterior ao trocar de prescritor no mesmo navegador (cenário de recepção compartilhada).

**Registro e auditoria de prescrições**

- **FR-016**: O sistema MUST registrar cada prescrição emitida, vinculada ao atendimento, paciente e profissional, com data/hora.
- **FR-017**: O sistema MUST registrar cada exclusão de prescrição de forma auditável.
- **FR-018**: O sistema MUST permitir que um usuário autorizado constate, a partir do atendimento/prontuário, que houve prescrição(ões) naquele atendimento.
- **FR-019**: O sistema MUST registrar as emissões e exclusões no histórico de auditoria, respeitando a minimização de dados (sem armazenar conteúdo clínico sensível além do necessário para rastreabilidade).

**Especialidade**

- **FR-020**: O sistema MUST permitir associar a especialidade (texto livre) do profissional ao item correspondente do catálogo de especialidades da Memed.
- **FR-021**: O sistema MUST permitir registrar o prescritor sem especialidade quando não houver correspondência, sinalizando a pendência sem bloquear a emissão.

**Conformidade e multi-tenant**

- **FR-022**: O sistema MUST isolar dados por clínica (tenant), de modo que prescritores, prescrições e configurações de uma clínica não sejam visíveis a outra.
- **FR-023**: O sistema MUST capturar os eventos de emissão e de exclusão de prescrição (requisito de conformidade da Memed).
- **FR-024**: O sistema MUST registrar o aceite de um termo de responsabilidade exigido para uso da prescrição digital antes de habilitar a emissão em produção.
- **FR-025**: A feature MUST permanecer agnóstica a profissão — funcionar para qualquer tipo de clínica (médica, odontológica, fisioterapia, psicologia, nutrição etc.), sem pressupor uma categoria específica.

### Key Entities *(include if feature involves data)*

- **Conexão Memed da clínica**: representa a conta Memed conectada por uma clínica (tenant) — ambiente ativo (homologação/produção), estado da conexão (conectada/desconectada) e o par de chaves cifrado; nunca exposta ao frontend.
- **Prescritor**: o vínculo entre um profissional (doctor) do Prontool e seu cadastro de prescritor na Memed; carrega o identificador externo, o estado de "apto/registrado" e a referência de especialidade mapeada.
- **Registro de Prescrição**: a evidência auditável de uma prescrição emitida, vinculando atendimento, paciente e profissional, com identificador da prescrição na Memed, horário e estado (emitida/excluída).
- **Mapeamento de Especialidade**: a correspondência entre a especialidade em texto livre do profissional e o identificador do catálogo da Memed.
- **Aceite de Termo de Responsabilidade**: o registro de que a clínica/usuário responsável aceitou o termo exigido para emissão em produção.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A partir de um atendimento aberto com paciente apto, o profissional consegue abrir a tela de prescrição com o paciente já carregado em até 5 segundos e sem redigitar dados.
- **SC-002**: 100% das aberturas de prescrição ocorrem sem que qualquer credencial sensível da Memed esteja presente no navegador (verificável por inspeção).
- **SC-003**: 100% das prescrições emitidas e 100% das exclusões geram registro auditável vinculado ao atendimento/paciente/profissional.
- **SC-004**: Tentativas de prescrever com dados de prescritor ou de paciente incompletos são bloqueadas em 100% dos casos, com mensagem que identifica o dado faltante.
- **SC-005**: A equipe consegue executar o fluxo completo de ponta a ponta em homologação sem qualquer dependência de aprovação externa.
- **SC-006**: A integração atende aos 5 requisitos de conformidade exigidos para solicitar credenciais de produção (prescritor completo, paciente completo, eventos de emissão e exclusão, termo de responsabilidade, zero credenciais no frontend).
- **SC-007**: Nenhum dado de prescritor/prescrição de uma clínica é acessível a partir de outra clínica (isolamento multi-tenant verificável).

## Assumptions

- **Modelo de credenciamento**: decidido como **por clínica (tenant)** — cada clínica conecta sua própria conta Memed e guarda seu par de chaves cifrado, no mesmo padrão multi-tenant da integração GHL (feature 008). Os profissionais daquela clínica são registrados como prescritores sob a conta Memed da própria clínica.
- **Dados já existentes**: os campos do prescritor (CPF, UF do conselho, nascimento) já existem no cadastro de profissional (migration 0107) e o lado do paciente já cobre o conjunto exigido para o carregamento do paciente; esta feature não recria esses cadastros.
- **PII de paciente**: os dados do paciente são tratados como informação sensível, decifrados apenas no servidor e trafegados ao navegador somente para o usuário autenticado com acesso àquele paciente.
- **Estratégia de entrega**: homologação primeiro (credenciais públicas e fixas da documentação), com a aprovação/credenciais de produção como etapa final.
- **Ambiente de prescrição**: a experiência de prescrição é fornecida pela própria Memed (tela/módulo embutido), cabendo ao Prontool a integração, o carregamento do paciente e a captura dos eventos — o Prontool não recria a interface de prescrição.
- **Navegadores suportados**: assume-se uso em navegadores modernos compatíveis com o módulo da Memed; navegadores legados estão fora de escopo.
- **Catálogo de especialidades e cidades da Memed**: tratados como dados de referência fornecidos pela Memed.
