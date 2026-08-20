# Feature Specification: Construtor de automações de mensagem

**Feature Branch**: `056-automacoes-mensagem`
**Created**: 2026-08-11
**Status**: Draft
**Input**: User description: "Construtor de automações de mensagem por WhatsApp: a clínica monta GATILHOS (fontes: lembrete de consulta, confirmação de agendamento, aniversário do paciente, paciente sem retorno há N meses, e condições sobre o checklist de hábitos) e associa a cada gatilho uma MENSAGEM personalizável de um catálogo próprio. Gatilho e mensagem são entidades independentes. Consentimento próprio do paciente, separado do opt-in de lembrete de consulta."

## Contexto

Hoje a clínica tem **uma** mensagem automática possível — o lembrete de consulta — com **um** texto fixo por clínica, gravado numa coluna do perfil. Qualquer outra comunicação automática exige código novo.

Esta feature inverte isso: a clínica passa a **montar** suas próprias automações. Escolhe **quando** (gatilho) e **o que** (mensagem), de forma independente, sem depender de desenvolvimento para cada nova ideia.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Montar a primeira automação e vê-la disparar (Priority: P1)

A administradora da clínica abre a tela de automações, cria uma mensagem ("Feliz aniversário, {paciente}! A equipe da {clinica} deseja um ótimo dia."), cria um gatilho de aniversário, liga os dois e ativa. No dia do aniversário de um paciente que consentiu, a mensagem sai.

**Why this priority**: É o laço completo — gatilho, mensagem, consentimento, envio e registro. Entregue sozinho, já resolve um pedido real de clínica e prova que a estrutura funciona. Aniversário é a fonte mais simples: não depende de agenda nem de checklist, e o dado já existe no cadastro.

**Independent Test**: Criar mensagem + gatilho de aniversário, marcar um paciente com aniversário no dia seguinte e consentimento ativo, rodar o ciclo diário e conferir que a mensagem saiu uma vez, com o nome substituído, e que ficou registrada.

**Acceptance Scenarios**:

1. **Given** uma automação de aniversário ativa e um paciente com consentimento e telefone, **When** o ciclo diário roda no dia do aniversário, **Then** a mensagem é enviada uma vez e fica registrada com o desfecho.
2. **Given** o mesmo cenário, **When** o ciclo diário roda uma segunda vez no mesmo dia, **Then** nenhuma mensagem nova é enviada.
3. **Given** um paciente sem consentimento para automações, **When** o ciclo roda no aniversário dele, **Then** nada é enviado e o motivo fica registrado.
4. **Given** uma automação desativada, **When** o ciclo roda, **Then** ela é ignorada.

---

### User Story 2 - Catálogo de mensagens reutilizáveis (Priority: P2)

A clínica mantém uma lista de mensagens próprias, cada uma com nome interno e texto com variáveis. A mesma mensagem pode ser usada por mais de um gatilho, e trocar a mensagem de um gatilho não exige recriar o gatilho.

**Why this priority**: É o que torna o construtor um construtor, e não uma lista de casos especiais. Sem isso, cada gatilho carrega seu próprio texto e a clínica passa a manter o mesmo conteúdo em vários lugares.

**Independent Test**: Criar uma mensagem, associá-la a dois gatilhos diferentes, editar o texto uma vez e conferir que os dois disparos seguintes usam o texto novo.

**Acceptance Scenarios**:

1. **Given** uma mensagem usada por dois gatilhos, **When** o texto é editado, **Then** os dois passam a usar o texto novo no próximo disparo.
2. **Given** uma mensagem com variável não reconhecida, **When** a clínica tenta salvar, **Then** o sistema recusa e aponta qual variável é inválida.
3. **Given** uma mensagem em uso por algum gatilho, **When** a clínica tenta excluí-la, **Then** o sistema recusa e informa quais gatilhos dependem dela.
4. **Given** uma variável cujo dado não existe para aquele paciente, **When** a mensagem é montada, **Then** o envio é pulado e o motivo fica registrado, em vez de sair texto com lacuna.

---

### User Story 3 - Gatilhos sobre o checklist de hábitos (Priority: P3)

A nutricionista cria um gatilho para "álcool marcado 3 ou mais vezes na semana corrente" e outro para "água sem marcação há 3 dias", cada um com sua mensagem.

**Why this priority**: É o pedido que originou a feature, mas depende do laço completo já estar de pé. Também é o que exige mais cuidado de linguagem.

**Independent Test**: Montar os dois gatilhos, produzir marcações que satisfaçam cada condição e conferir que cada um dispara a sua mensagem, uma vez por período.

**Acceptance Scenarios**:

1. **Given** um gatilho de "marcado N vezes na semana" e um paciente que atingiu N, **When** o ciclo roda, **Then** a mensagem sai uma vez naquela semana, mesmo que o paciente marque mais vezes depois.
2. **Given** um gatilho de ausência, **When** a clínica está montando a condição, **Then** a tela declara explicitamente que o dado disponível é "não marcou", e não "não cumpriu".
3. **Given** um paciente sem nenhum checklist ativo, **When** o ciclo roda, **Then** ele não entra em nenhum gatilho de checklist.
4. **Given** um item de checklist removido da grade do paciente, **When** o ciclo roda, **Then** gatilhos que dependiam daquele item não disparam para ele.

---

### User Story 4 - Gatilhos sobre a agenda (Priority: P4)

A clínica cria "confirmação de agendamento" (dispara quando o atendimento é marcado) e "paciente sem retorno há 6 meses".

**Why this priority**: Alto valor percebido, mas ambos dependem de regras sobre a agenda que são mais delicadas que aniversário — sobretudo o de retorno, que precisa de um teto para não varrer a base inteira na primeira execução.

**Independent Test**: Marcar um atendimento e conferir a confirmação; marcar um paciente com última consulta há mais de 6 meses e conferir o disparo, uma vez só.

**Acceptance Scenarios**:

1. **Given** um gatilho de confirmação ativo, **When** um atendimento é criado, **Then** a mensagem sai referente àquele atendimento.
2. **Given** um gatilho de retorno com N meses, **When** o ciclo roda pela primeira vez numa base com muitos pacientes antigos, **Then** o número de envios respeita o teto diário configurado e o restante fica para os ciclos seguintes.
3. **Given** um paciente que já recebeu a mensagem de retorno, **When** ele segue sem retornar, **Then** ele não recebe de novo antes do intervalo mínimo de repetição.

---

### Edge Cases

- Paciente atende a **dois gatilhos no mesmo dia** (aniversário e retorno): o teto de mensagens por paciente por dia decide, e o que não sai fica registrado como suprimido, não como falha.
- Paciente **sem telefone** ou com telefone inválido: registrado com motivo próprio, sem tentativa de envio.
- Clínica **sem WhatsApp conectado**: uma ocorrência agregada por ciclo, nunca uma por paciente.
- **Módulo revogado** no meio do caminho: o motor para de avaliar automações daquela clínica, independentemente de as automações continuarem marcadas como ativas.
- Automação **ativada com condição já satisfeita há meses** por muitos pacientes: primeira execução não pode virar disparo em massa.
- Mensagem **editada entre a seleção e o envio**: vale o texto do momento do envio.
- Paciente **anonimizado** (LGPD): sai de qualquer avaliação de gatilho.
- **Fuso da clínica**: "hoje" e "semana corrente" seguem o dia civil da clínica, nunca o do servidor.

## Requirements _(mandatory)_

### Functional Requirements

**Automação, gatilho e mensagem**

- **FR-001**: A clínica MUST poder criar, editar, ativar, desativar e excluir **mensagens**, cada uma com nome interno e corpo de texto.
- **FR-002**: A clínica MUST poder criar, editar, ativar, desativar e excluir **gatilhos**, escolhendo a fonte e os parâmetros dela.
- **FR-003**: Gatilho e mensagem MUST ser entidades independentes: um gatilho aponta para uma mensagem, a mesma mensagem pode servir a vários gatilhos, e trocar a mensagem de um gatilho não recria o gatilho.
- **FR-004**: O sistema MUST recusar a exclusão de uma mensagem que esteja em uso, informando quais gatilhos dependem dela.
- **FR-005**: O corpo da mensagem MUST aceitar variáveis de um conjunto declarado (ex.: paciente, clínica, profissional, data), e o sistema MUST recusar variável fora desse conjunto no momento de salvar.
- **FR-006**: Quando uma variável não puder ser preenchida para um paciente específico, o sistema MUST pular aquele envio com motivo registrado, em vez de enviar texto com lacuna.

**Fontes de gatilho**

- **FR-007**: O sistema MUST oferecer as fontes: aniversário do paciente; confirmação de agendamento; paciente sem retorno há N meses; item de checklist marcado N vezes no período; item de checklist sem marcação há N dias.
- **FR-008**: Cada fonte MUST expor seus próprios parâmetros configuráveis pela clínica (ex.: N meses, N vezes, qual item de checklist).
- **FR-009**: Ao configurar um gatilho de **ausência** de marcação, a interface MUST declarar explicitamente que o dado disponível é "não marcou", e nunca afirmar que o paciente "não cumpriu" — o checklist registra apenas o positivo.

**Execução**

- **FR-010**: A avaliação dos gatilhos MUST acontecer no ciclo diário existente.
- **FR-011**: Cada automação MUST disparar no máximo uma vez por paciente por ocorrência do gatilho, de modo que reexecutar o ciclo no mesmo dia não gere mensagem repetida.
- **FR-012**: O sistema MUST respeitar um teto de mensagens de automação por paciente por dia, e registrar como suprimido o que exceder.
- **FR-013**: O sistema MUST respeitar um teto de envios por clínica por ciclo, deixando o excedente para os ciclos seguintes, para que ativar uma automação numa base grande não vire disparo em massa.
- **FR-014**: Ao ativar um gatilho, o sistema MUST informar quantos pacientes satisfazem a condição naquele momento, antes de confirmar.

**Consentimento e privacidade**

- **FR-015**: O envio de mensagem de automação MUST exigir consentimento **próprio** do paciente, distinto do opt-in de lembrete de consulta.
- **FR-016**: O consentimento mestre de comunicações, quando negado, MUST calar também as automações.
- **FR-017**: Paciente anonimizado ou inativo MUST ser excluído de qualquer avaliação de gatilho.
- **FR-018**: Toda criação, edição, ativação e desativação de automação MUST ficar registrada em auditoria, com autor.

**Registro e visibilidade**

- **FR-019**: Cada avaliação que resulte em envio, supressão ou impedimento MUST gerar registro consultável, com o motivo.
- **FR-020**: A clínica MUST poder ver, por automação, quantas mensagens saíram e quantas foram entregues e lidas.
- **FR-021**: Clínica sem canal conectado MUST gerar uma única ocorrência agregada por ciclo, nunca uma por paciente.

**Escopo de acesso**

- **FR-022**: Apenas perfis administrativos MUST poder criar e editar automações.
- **FR-023**: A funcionalidade MUST ser controlada por módulo contratável, e o gate MUST valer também no motor de execução, não apenas na interface.

**Convivência com o lembrete de consulta**

- **FR-024**: O lembrete de consulta existente MUST permanecer com seu motor e sua configuração próprios nesta feature. O construtor cobre apenas as fontes novas.
- **FR-025**: O desenho MUST deixar a absorção futura possível sem reescrever o construtor: "lembrete de consulta" precisa caber como mais uma fonte de gatilho, e a configuração atual precisa ser convertível em automação equivalente.
- **FR-026**: Enquanto os dois coexistirem, a interface MUST deixar claro para a clínica onde cada coisa é configurada, para que ninguém procure o lembrete dentro do construtor nem o contrário.

### Key Entities

- **Mensagem**: texto reutilizável da clínica, com nome interno, corpo com variáveis e estado ativo/inativo. Não sabe quando será usada.
- **Gatilho**: condição configurada pela clínica — fonte + parâmetros — com estado ativo/inativo. Não sabe qual texto será enviado.
- **Automação**: o vínculo entre um gatilho e uma mensagem. É o que a clínica liga e desliga como unidade.
- **Ocorrência**: o registro de que um gatilho se satisfez para um paciente num momento, com o desfecho (enviado, suprimido, impedido) e o motivo. É o que garante o "uma vez só" e o que alimenta a visibilidade.
- **Consentimento de automações**: manifestação do paciente, distinta do opt-in de lembrete de consulta.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: Uma administradora sem treinamento consegue criar e ativar sua primeira automação em menos de 5 minutos.
- **SC-002**: Nenhum paciente recebe mais mensagens de automação por dia do que o teto configurado, verificável no registro de ocorrências.
- **SC-003**: Reexecutar o ciclo diário no mesmo dia não produz nenhuma mensagem repetida.
- **SC-004**: Ativar uma automação numa base de 5.000 pacientes com metade satisfazendo a condição não produz mais envios num único ciclo do que o teto por clínica.
- **SC-005**: 100% dos envios de automação têm consentimento próprio registrado no momento do envio.
- **SC-006**: A clínica consegue responder, para qualquer automação, quantas mensagens saíram e quantas foram lidas, sem pedir ajuda ao suporte.
- **SC-007**: Nenhum texto de gatilho de ausência apresentado pela interface afirma que o paciente deixou de cumprir algo.

## Assumptions

- **Canal**: v1 envia por **WhatsApp**, reusando o canal e o registro de entrega já existentes. E-mail fica fora — o canal exige assunto próprio e hoje sequer está operante em produção.
- **Cadência**: a avaliação roda no ciclo diário. Automações com granularidade menor que um dia estão fora do escopo.
- **Teto por paciente**: padrão de 1 mensagem de automação por paciente por dia, ajustável pela clínica. Lembrete de consulta não conta nesse teto.
- **Repetição**: gatilhos de estado contínuo (ex.: sem retorno há N meses) só repetem após um intervalo mínimo configurável, para não virar cobrança diária.
- **Períodos**: "semana corrente" e "hoje" seguem o dia civil da clínica, no mesmo critério já usado pelo checklist de hábitos.
- **Consentimento existente**: pacientes atuais **não** são migrados como consentidos — o consentimento de automações nasce negado e precisa ser coletado.
- **Reuso**: a entrega, a confirmação de leitura e o gate de módulo reaproveitam a infraestrutura de mensagens já existente; esta feature não cria um segundo caminho de envio.
- **Autoria**: perfis administrativos criam automações; os demais apenas visualizam.

## Dependências

- Canal de mensagem conectado por clínica, com confirmação de entrega.
- Ciclo diário de execução em funcionamento.
- Checklist de hábitos, para as fontes de gatilho baseadas em marcação.
- Cadastro de paciente com data de nascimento e telefone, para as fontes correspondentes.

## Fora de escopo

- Resposta do paciente: o canal é de mão única e ninguém lê o que o paciente responder.
- Envio avulso, manual, para um paciente escolhido na hora.
- Automação com granularidade de hora ou minuto.
- Sequências encadeadas (mensagem que dispara outra depois de N dias).
- Segmentação por lista arbitrária de pacientes fora das fontes previstas.

## Decisão registrada — o lembrete de consulta fica de fora, por ora

Decidido em 2026-08-11. O construtor **nasce convivendo** com o motor de lembrete
existente; a absorção vira fase própria, depois.

A razão é de risco, não de preferência. O motor de lembrete passou a funcionar em
produção **neste mesmo dia** — até então nunca havia executado sozinho uma única
vez, por um defeito silencioso no método HTTP do disparo diário. Reescrevê-lo
agora seria trocar uma certeza recém-conquistada por uma promessa, e perder a
janela de observá-lo rodando de verdade.

O custo aceito é a clínica ter dois lugares para configurar comunicação
automática enquanto durar a convivência — daí o FR-026. O FR-025 existe para que
essa dívida seja paga depois sem retrabalho: se o construtor nascer incapaz de
receber o lembrete como fonte, a fase de absorção vira reescrita.
