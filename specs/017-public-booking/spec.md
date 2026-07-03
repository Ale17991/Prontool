# Feature Specification: Link público de agendamento online

**Feature Branch**: `017-public-booking`
**Created**: 2026-05-19
**Status**: Draft
**Input**: User description: "Link público de agendamento online — paciente acessa `/agendar/[slug-da-clinica]` sem autenticação e marca consulta. Identificado como **maior gap funcional** do Prontool vs iClinic/Feegow/Doctoralia em audit competitivo recente. Resolve a falta apontada como a principal razão de clínicas pequenas/médias escolherem a concorrência."

---

## Clarifications

### Session 2026-05-19

- Q: Como modelar a relação médico × procedimento na configuração pública (matriz N:N, lista global do tenant, ou 1:N onde procedimento pertence ao médico)? → A: **Option C — 1:N (procedimento pertence ao médico no contexto público)**. Cada médico tem sua própria lista de procedimentos publicados, com `display_name` e `duration_minutes` próprios. Configuração admin é por médico: "Dr. João oferece [Consulta clínica 30min, Retorno 20min]; Dra. Maria oferece [Nutrição 60min, Retorno 30min]". Reusa procedure_id da tabela canônica de procedimentos, mas as configurações de exibição pública são do médico.
- Q: Como a clínica é notificada quando um agendamento público é criado? → A: **Option B — Email para admins + notificação no sino do dashboard** (usa Resend e notification-bell existentes). Cobre cenários on-hours (sino imediato) e off-hours (email garantido). Push WhatsApp via GHL fica como **extensão futura** quando vocês evoluírem o canal de comunicação com clientes — pode entrar na próxima fase via mesma infra de eventos.
- Q: Como tratar paciente recorrente (CPF já cadastrado) acessando o link público com contato (email/telefone) diferente do cadastro? → A: **Option A — Transparente + atualiza contato**. Reaproveita o registro pelo CPF, atualiza email/telefone se vierem diferentes (com entrada de auditoria), **NÃO** sobrescreve o nome (evita acidente de identidade). Recorrente tem zero fricção; clínica recebe info de contato atualizada como bônus.
- Q: Qual provedor de captcha usar? → A: **Cloudflare Turnstile** (Option A). Invisible por padrão, grátis ilimitado, sem cookies de terceiros, sem fingerprinting, LGPD-friendly por design, baixa latência no BR. Plano implementa via 1 script no client + 1 verify call server-side. Caso futuro de mudança (taxa de bypass, mudança de TOS), trocar para hCaptcha é refactor pontual (1 dia).

---

## User Scenarios & Testing _(mandatory)_

### User Story 1 — Paciente agenda sem login em ≤90 segundos (Priority: P1)

Ana viu um post no Instagram da clínica Dra. Marta. O post tem um link "Agende sua consulta". Ela toca, abre o navegador do celular, escolhe o profissional, escolhe o procedimento, vê os horários livres dos próximos dias, escolhe um, preenche nome+CPF+email+telefone, aceita os termos, e em menos de 90 segundos recebe um email confirmando a consulta. Ela não cria conta. Não baixa app. Não fala com ninguém.

**Why this priority**: Este é o **único caminho** que entrega valor. Sem ele, a feature inteira não existe. É também o que destrava o argumento de venda contra iClinic/Feegow.

**Independent Test**: Pode ser testada acessando `/agendar/[slug]` em modo anônimo (sem cookies do produto), completando o fluxo e verificando que a consulta aparece na agenda interna da clínica com origem identificada como pública.

**Acceptance Scenarios**:

1. **Given** clínica com link público habilitado e médicos/procedimentos publicados, **When** Ana acessa `/agendar/dra-marta` em navegador anônimo, **Then** vê o nome da clínica, logo, lista de profissionais disponíveis e pode iniciar o fluxo sem login.
2. **Given** Ana selecionou Dr. João e "Consulta clínica geral", **When** vê o calendário de horários, **Then** apenas slots dentro da janela permitida (mínimo X horas de antecedência, máximo Y dias) aparecem, e cada slot aparece como disponível ou indisponível sem ambiguidade.
3. **Given** Ana selecionou um slot, **When** preenche o formulário com nome, CPF (opcional), email, telefone e data de nascimento, e aceita o consentimento LGPD, **Then** o botão "Confirmar agendamento" fica habilitado.
4. **Given** Ana submete o formulário corretamente, **When** o sistema cria a consulta, **Then** ela é redirecionada para uma tela de sucesso com confirmação visual e recebe um email de confirmação em até 60 segundos.
5. **Given** Ana é uma paciente nova (CPF não cadastrado), **When** o sistema processa o agendamento, **Then** um novo registro de paciente é criado com seus dados (criptografados conforme política da clínica).
6. **Given** Ana já existe na base como paciente (CPF match), **When** o sistema processa, **Then** o agendamento é vinculado ao registro existente, sem duplicar paciente.
7. **Given** desde o landing até o submit, **When** medido o tempo total para Ana, **Then** o fluxo completo é executável em ≤90 segundos para um usuário familiarizado.

---

### User Story 2 — Clínica configura quais profissionais e procedimentos aparecem (Priority: P1)

Renata, administradora da clínica Dra. Marta, quer abrir o agendamento online só para Dr. João (que tem agenda regular) e só para "Consulta clínica" e "Retorno" (não procedimentos cirúrgicos). Ela acessa `/configuracoes/agendamento-publico`, habilita o link, escolhe o slug `dra-marta`, marca quais profissionais aparecem e quais procedimentos cada um oferece publicamente, define que pacientes podem agendar com no mínimo 24h de antecedência e no máximo 30 dias adiante, e que cancelamento via link só é permitido até 6h antes da consulta. Copia o link e cola no Instagram.

**Why this priority**: Sem este controle, a feature **não pode entrar em produção**. Clínicas precisam de filtros granulares; do contrário, qualquer paciente agendaria com qualquer médico em qualquer horário disponível na agenda, incluindo profissionais sem perfil público ou procedimentos não-rotineiros.

**Independent Test**: Pode ser testada como admin entrando na tela de configuração, habilitando 1 médico + 1 procedimento, e verificando no `/agendar/[slug]` que **apenas** aquele médico+procedimento aparecem; outros profissionais e procedimentos da mesma clínica ficam invisíveis no link público.

**Acceptance Scenarios**:

1. **Given** Renata é admin do tenant, **When** acessa `/configuracoes/agendamento-publico`, **Then** vê interface com toggle de ativação, campo de slug (validado por unicidade), lista de médicos com checkbox, lista de procedimentos com checkbox, e campos numéricos para as três políticas (antecedência mínima/máxima, cancelamento mínimo).
2. **Given** o slug `dra-marta` já está em uso por outro tenant, **When** Renata tenta salvar com esse slug, **Then** recebe mensagem clara "Este endereço já está em uso. Tente outro."
3. **Given** Renata marca apenas Dr. João como visível, **When** Ana acessa `/agendar/dra-marta`, **Then** apenas Dr. João aparece (mesmo havendo Dra. Beatriz cadastrada).
4. **Given** Renata desmarca um procedimento, **When** Ana já tinha aberto a página em outra aba e tenta selecionar o procedimento removido, **Then** o submit falha com mensagem clara e Ana é orientada a recomeçar.
5. **Given** Renata desabilita o link público (toggle off), **When** Ana tenta acessar `/agendar/dra-marta`, **Then** recebe página "Esta clínica não está aceitando agendamentos online no momento."
6. **Given** Renata altera o slug de `dra-marta` para `clinica-marta`, **When** alguém acessa o slug antigo, **Then** recebe 404 (não há redirect automático — slugs antigos podem ser disputados).
7. **Given** Renata só vê esta tela como `admin` ou `recepcionista`, **When** um usuário com papel `profissional_saude` ou `financeiro` tenta acessar, **Then** é redirecionado/bloqueado por RBAC.

---

### User Story 3 — Sistema protege contra abuso e race conditions (Priority: P1)

Um bot tenta criar 1000 agendamentos falsos em 1 minuto no link público de uma clínica. Em paralelo, dois pacientes humanos selecionam o mesmo slot ao mesmo tempo. Em outro caso, um spammer envia 50 submits do mesmo IP em 2 minutos. O sistema precisa **bloquear** todos os cenários abusivos preservando a experiência dos usuários legítimos.

**Why this priority**: Link público é vetor de ataque óbvio. Sem proteção, a feature **prejudica** as clínicas em vez de ajudar (agenda lotada de bookings falsos). Crítico antes de qualquer rollout.

**Independent Test**: Pode ser testada (a) com script que faz 200 submits sequenciais do mesmo IP em 10 segundos — sistema deve bloquear após o limite; (b) com dois clientes paralelos selecionando mesmo slot — apenas 1 deve confirmar; (c) com submit sem captcha válido — deve falhar antes do INSERT.

**Acceptance Scenarios**:

1. **Given** um IP fez 3 submits válidos na última hora, **When** tenta um quarto, **Then** o sistema responde com erro de rate limit e indica quando pode tentar novamente.
2. **Given** um IP fez 10 visualizações de horários no último minuto, **When** tenta uma 11ª, **Then** o sistema responde com erro temporário e indica espera.
3. **Given** um submit chega sem desafio de captcha válido, **When** processado, **Then** é rejeitado com erro genérico antes de qualquer mutação de dados.
4. **Given** dois clientes confirmam **exatamente** o mesmo slot (mesmo médico, mesma data/hora) em janela <100ms, **When** o segundo submit chega, **Then** o banco rejeita com violação de constraint e a UI mostra "Esse horário acabou de ser ocupado" oferecendo voltar à seleção.
5. **Given** o sistema armazena evidência de uso, **When** logs são auditados, **Then** o **IP não aparece em texto claro** em nenhum registro — apenas hash SHA-256.
6. **Given** uma tentativa de criar agendamento com slot fora da janela permitida (ex.: para amanhã com `min_hours=24h`), **When** o servidor valida, **Then** rejeita mesmo se o cliente tentar burlar pelo console.
7. **Given** uma tentativa de agendar com médico que **não está** na lista pública do tenant, **When** o servidor valida, **Then** rejeita com 403 ou 404 conforme aplicável.

---

### User Story 4 — Paciente cancela sem login via link no email (Priority: P2)

Ana precisa desmarcar a consulta. Ela abre o email de confirmação que recebeu, clica em "Cancelar consulta", confirma na próxima tela e recebe outro email confirmando o cancelamento. O slot fica imediatamente disponível de volta no calendário público para outros pacientes. A clínica é notificada por evento de auditoria.

**Why this priority**: Reduz no-shows (queixa universal de clínicas) e melhora a experiência. Não é crítico para o MVP funcionar, mas elimina a fricção "tenho que ligar pra cancelar". Pode ser entregue logo após US1-3 estarem prontas.

**Independent Test**: Pode ser testada acessando o link com token único do email de confirmação, completando o fluxo de cancelamento, e verificando que: (a) o appointment tem status alterado conforme o domínio (cancelado/estornado conforme regra), (b) o slot reaparece como disponível, (c) o token não pode ser reutilizado.

**Acceptance Scenarios**:

1. **Given** Ana recebeu o email com link `cancelar/[token]`, **When** clica e visualiza a página, **Then** vê resumo da consulta (data, médico, procedimento) e botão "Confirmar cancelamento".
2. **Given** Ana confirma o cancelamento dentro da janela permitida (≥6h antes do horário), **When** submete, **Then** o agendamento é cancelado, ela recebe email de confirmação, e o slot fica disponível.
3. **Given** Ana tenta cancelar a menos de 6h da consulta (configurável pelo tenant), **When** acessa o link, **Then** vê mensagem "Cancelamento online disponível até 6h antes — entre em contato com a clínica" + telefone/email da clínica.
4. **Given** Ana já cancelou (token usado), **When** clica novamente no mesmo link, **Then** vê "Esta consulta já foi cancelada em [data]."
5. **Given** o link expirou (mais de 30 dias após criação), **When** Ana acessa, **Then** vê "Link expirado" e é orientada a contatar a clínica.
6. **Given** Ana tenta acessar um link com token inválido/fabricado, **When** o servidor processa, **Then** rejeita com mensagem genérica (não revela existência ou não do appointment).

---

### User Story 5 — Paciente recebe confirmação visual e por email com .ics (Priority: P2)

Após confirmar o agendamento, Ana vê uma tela de sucesso com nome do profissional, data/hora formatados, endereço e telefone da clínica, e botões "Adicionar ao Google Calendar" / "Adicionar ao Apple Calendar" / "Cancelar consulta". Em até 60 segundos recebe um email com os mesmos dados e um anexo `.ics` que pode ser aberto em qualquer cliente de calendário.

**Why this priority**: Reduz no-show ainda mais que US4 isolada. Calendar attachment é padrão esperado (iClinic/Feegow têm). Mas se atrasar, o agendamento ainda funciona — paciente teria os dados na tela de sucesso e no email texto.

**Independent Test**: Pode ser testada inspecionando a tela de sucesso (todos os elementos presentes), recebendo o email, abrindo o `.ics` em Google Calendar e Apple Calendar, e validando que data/hora/título/local importam corretamente respeitando fuso horário.

**Acceptance Scenarios**:

1. **Given** Ana confirmou um agendamento, **When** a tela de sucesso renderiza, **Then** exibe data e hora formatadas em português, nome completo do profissional, nome do procedimento, endereço da clínica (se cadastrado), telefone (se cadastrado), e botões para adicionar ao calendário.
2. **Given** o email de confirmação é enviado, **When** Ana abre na caixa de entrada, **Then** o assunto identifica a clínica e o motivo, o corpo lista os mesmos detalhes da tela de sucesso, e há um anexo `.ics` válido.
3. **Given** Ana abre o `.ics` no Google Calendar, **When** importa, **Then** o evento aparece com a data/hora correta no fuso da clínica (com indicação clara do fuso se diferente do paciente).
4. **Given** o tenant está em São Paulo e Ana acessa o email no celular configurado em outro fuso, **When** vê o horário, **Then** o texto do email indica explicitamente o fuso da clínica ("horário de Brasília") evitando ambiguidade.
5. **Given** o sistema Resend não conseguiu enviar o email, **When** Ana sai da tela de sucesso, **Then** ela já tem os dados visualmente confirmados e pode acessar de volta via URL com token (caso tenha salvado).

---

### Edge Cases

- **Slot desaparece entre seleção e submit**: o paciente seleciona um horário às 09:00, demora 90 segundos preenchendo o form, e outra pessoa pegou o slot nesse intervalo. O sistema rejeita no submit com mensagem clara e oferece voltar à seleção de horários (sem perder os dados preenchidos do paciente).
- **CPF não fornecido**: paciente novo, sem CPF (criança? estrangeiro?). Sistema cria registro com `cpf=NULL`, marca como "identificação parcial" em auditoria para a clínica resolver depois. Não bloqueia o agendamento.
- **CPF match com paciente anonimizado por LGPD**: o paciente foi apagado anteriormente; CPF match é tecnicamente impossível porque o dado foi removido. Sistema cria novo registro normalmente.
- **CPF match com paciente ativo, mas email diferente**: usa o registro existente; atualiza email/telefone como novos contatos (mas **não sobrescreve nome** — conflito de identidade).
- **Médico não tem nenhum bloco de disponibilidade configurado**: a tela de horários mostra "Esta clínica ainda não publicou horários para [Dr. X] — entre em contato direto" + telefone da clínica.
- **Tenant em fuso diferente do paciente**: horários sempre mostrados no fuso da clínica, com indicação explícita "horário de Brasília" no email e na tela de sucesso.
- **Tenant desabilita feature após link já compartilhado**: link retorna página amigável "Esta clínica não aceita agendamentos online no momento — entre em contato direto" (404 não — mensagem informativa porque o slug existiu).
- **Tenant muda o slug**: links antigos retornam 404 (sem redirect automático para evitar squatting).
- **Captcha falha silenciosamente no celular do paciente** (browser bloqueia scripts de terceiros): sistema detecta a falha do captcha e mostra mensagem com fallback ("Não foi possível verificar — entre em contato direto") em vez de loop infinito.
- **Email do paciente inválido (typo)**: o sistema **não valida real-time** (custo de DNS lookup), mas o domínio é validado por regex; emails sintaticamente válidos mas inexistentes resultam em consulta agendada sem confirmação enviada. Solução: a tela de sucesso é suficiente como evidência (não dependemos do email para o appointment existir).
- **Paciente confirma e fecha o browser antes do submit completar**: idempotência por token único client-side (gerado antes do submit). Mesmo se o paciente clicar duas vezes, só 1 appointment é criado.
- **Médico marca um schedule_block "bloqueado" depois que paciente já agendou**: o agendamento existente **não é cancelado automaticamente**. A clínica é notificada via audit_log mas a decisão de cancelar é manual (políticas de cada clínica variam).
- **Procedimento removido da lista pública entre seleção e submit**: o servidor valida no submit e rejeita com mensagem clara.
- **Spam de cancelamentos**: paciente cria agendamento, cancela, cria de novo, cancela, em loop. Rate limit por email + por IP bloqueia padrões abusivos.
- **Link clicado de um app de email que pré-visualiza URLs**: tokens de cancelamento que viram "used" só por preview seria desastroso. O cancelamento exige **POST com confirmação na tela**, não GET — o link no email leva a uma página intermediária com botão "Confirmar cancelamento".
- **Tentativa de SQL injection no slug**: slug aceita apenas `[a-z0-9-]{3,32}` validado no servidor; query usa parâmetros tipados.
- **Captcha resolvido offline** (token reutilizado): Turnstile gera token de uso único com validade curta; servidor verifica com a Cloudflare antes de aceitar o submit.

## Requirements _(mandatory)_

### Functional Requirements

#### Acesso público

- **FR-001**: O sistema MUST expor uma rota pública (sem autenticação) em `/agendar/[slug]` que renderiza o agendamento de uma clínica identificada pelo slug.
- **FR-002**: O sistema MUST resolver `slug → tenant_id` apenas para tenants que tenham o agendamento público explicitamente habilitado. Tenants sem o slug configurado ou com o toggle desativado MUST retornar uma página de "feature indisponível" amigável (não revelar se o tenant existe).
- **FR-003**: O slug MUST seguir um padrão restrito (apenas letras minúsculas, dígitos e hífens, comprimento entre 3 e 32 caracteres) e MUST ser único entre todos os tenants do sistema.
- **FR-004**: O sistema MUST permitir alteração do slug por administradores; alterações invalidam imediatamente links com o slug antigo (retornam erro de "página não encontrada"), sem redirect automático.

#### Configuração admin

- **FR-005**: O sistema MUST expor uma tela administrativa em `/configuracoes/agendamento-publico` acessível apenas para usuários com papel `admin` ou `recepcionista` do tenant.
- **FR-006**: A tela administrativa MUST permitir: (a) ativar/desativar a feature, (b) definir o slug, (c) selecionar quais profissionais aparecem publicamente, (d) acrescentar uma bio opcional para cada profissional, (e) **para cada profissional publicado, definir sua própria lista de procedimentos oferecidos publicamente** (relação 1:N — procedimento pertence ao médico no contexto público), cada um com `display_name` amigável e `duration_minutes` próprio (Dr. A pode oferecer "Consulta clínica 30min", Dra. B pode oferecer "Consulta clínica 45min" e "Nutrição 60min"), (f) configurar antecedência mínima de agendamento (em horas), (g) configurar antecedência máxima (em dias), (h) configurar quantas horas antes do agendamento o cancelamento via link ainda é permitido.
- **FR-007**: Toda alteração na configuração pública MUST gerar entrada de auditoria identificando ator, antes/depois e timestamp.

#### Fluxo do paciente

- **FR-008**: O paciente MUST ver, em ordem: (1) lista de profissionais disponíveis com bio opcional, (2) lista de procedimentos por profissional, (3) calendário com slots disponíveis na janela permitida, (4) formulário de identificação, (5) consentimento LGPD, (6) confirmação visual + email.
- **FR-009**: O sistema MUST exigir os seguintes dados do paciente: nome completo, email, telefone, data de nascimento. CPF é **opcional** (suporte a estrangeiros e menores sem CPF).
- **FR-010**: O sistema MUST exibir um consentimento LGPD obrigatório com checkbox explícito antes do submit. O texto MUST citar a finalidade da coleta e linkar para a política de privacidade da clínica.
- **FR-011**: O sistema MUST tentar identificar pacientes existentes por CPF (quando fornecido). Em caso de match, MUST reaproveitar o registro existente. Em caso de mismatch (CPF não cadastrado ou não fornecido), MUST criar novo registro de paciente.
- **FR-011a**: Quando reaproveitar paciente por CPF match: se email ou telefone fornecidos forem diferentes dos cadastrados, o sistema MUST **atualizar** esses campos no registro existente e MUST gerar entrada de auditoria registrando o ator anônimo, valores anteriores e novos. O sistema MUST NOT sobrescrever o nome do paciente, mesmo se vier diferente — preservar nome cadastrado evita acidentes de identidade quando dois pacientes compartilham CPF (incomum mas possível em casos de identidade roubada).
- **FR-012**: Dados pessoais coletados via formulário público MUST ser tratados com a mesma proteção (criptografia em repouso) que dados coletados internamente.

#### Disponibilidade e slots

- **FR-013**: O sistema MUST calcular slots disponíveis a partir da disponibilidade declarada do profissional (blocos com ação "disponível"), subtraindo bloqueios e consultas já agendadas, discretizando pela duração do procedimento selecionado.
- **FR-014**: Slots fora da janela `[agora + min_hours_advance, agora + max_days_advance]` MUST não aparecer como disponíveis.
- **FR-015**: Profissionais sem blocos de disponibilidade configurados MUST exibir mensagem amigável orientando contato direto, sem mostrar calendário vazio confuso.

#### Segurança e proteção

- **FR-016**: O sistema MUST exigir desafio de captcha verificado server-side antes de processar o submit final. O provedor adotado é **Cloudflare Turnstile** (invisible por padrão, sem cookies, sem fingerprinting, LGPD-friendly) conforme decisão registrada em Clarifications. O requisito abstrato (sem cookies, sem rastreamento entre sites) permanece para futura troca de provedor sem mudança de spec.
- **FR-017**: O sistema MUST aplicar rate limit por hash de IP do solicitante: máximo de 10 visualizações de calendário por minuto e 3 submits válidos por hora, por tenant.
- **FR-018**: O sistema MUST NOT armazenar IP em texto claro em nenhum registro — apenas hash criptográfico (SHA-256 ou equivalente).
- **FR-019**: Rate-limit data MUST ter retenção máxima de 7 dias (LGPD: minimização de dados).
- **FR-020**: O sistema MUST validar **server-side** todos os parâmetros do submit (profissional permitido, procedimento permitido, slot dentro da janela, slot ainda disponível), mesmo se a UI tiver validado antes — qualquer manipulação via console deve falhar.
- **FR-021**: Em colisão de slot (dois bookings simultâneos para o mesmo horário), o sistema MUST garantir que **apenas um** seja persistido, com mensagem clara ao perdedor (não corromper estado).

#### Confirmação e calendário

- **FR-022**: Ao confirmar o agendamento, o sistema MUST exibir tela de sucesso com data/hora formatadas em português, nome do profissional, nome do procedimento, endereço/telefone da clínica quando disponíveis, e link para adicionar ao calendário do paciente (formato compatível com Google e Apple Calendar).
- **FR-023**: O sistema MUST enviar email de confirmação para o endereço fornecido, em até 5 minutos, contendo os mesmos detalhes + arquivo `.ics` anexado + link de cancelamento com token único.
- **FR-024**: O email de confirmação MUST indicar explicitamente o fuso horário da clínica no corpo do texto, evitando ambiguidade quando o paciente abre o email em fuso diferente.
- **FR-024a**: O sistema MUST notificar a clínica de cada agendamento público criado por dois canais: (1) **email** para os usuários com papel `admin` do tenant, em até 5 minutos; (2) **entrada no centro de notificações** (sino do dashboard) do mesmo tenant, visível imediatamente para `admin` e `recepcionista`. O conteúdo MUST identificar paciente, profissional, procedimento, data/hora e origem "público". Extensão futura para canais adicionais (ex.: WhatsApp via integração) fica fora do MVP mas a arquitetura de eventos MUST permitir esse acréscimo sem refactor das notificações existentes.

#### Cancelamento

- **FR-025**: O sistema MUST gerar token único, criptograficamente seguro, com expiração padrão de 30 dias, para cada agendamento público, permitindo cancelamento sem login.
- **FR-026**: O token MUST ser armazenado em formato hash (não texto claro); o token "raw" só existe no link enviado por email.
- **FR-027**: A página de cancelamento MUST exigir **POST com confirmação visual** (botão), **não** GET — evita que pré-visualizadores de email acionem cancelamento acidental.
- **FR-028**: O sistema MUST bloquear cancelamento via link quando faltar menos que o configurado (`cancel_min_hours`) para o agendamento, exibindo telefone/email da clínica como alternativa.
- **FR-029**: Tokens **usados** ou **expirados** MUST recusar uso adicional, exibindo mensagem amigável que não revela detalhes do agendamento.
- **FR-030**: Cancelamento bem-sucedido MUST liberar o slot imediatamente para outros agendamentos públicos.

#### Auditoria e compliance

- **FR-031**: Cada operação pública (visualização de slots, criação de agendamento, cancelamento) MUST gerar entrada de auditoria identificando: tipo de evento, slug, hash de IP, timestamp, identificador do appointment criado/cancelado.
- **FR-032**: Auditoria MUST identificar o ator como "anônimo / agendamento público" — não como usuário do sistema.
- **FR-033**: O sistema MUST manter isolamento estrito entre tenants — em nenhuma circunstância um slug pode acessar dados de outro tenant. Esta propriedade MUST ser provada por teste de contrato automatizado antes do merge.
- **FR-034**: A rota pública MUST poder apenas **inserir** dados em caminhos dedicados (criar paciente novo se necessário, criar appointment, criar token de cancelamento); MUST NOT poder ler quaisquer dados pré-existentes além das informações públicas da clínica (slug, médicos/procedimentos publicados, disponibilidade agregada).
- **FR-035**: O sistema MUST expor uma página em `/agendar/[slug]/privacidade` com a política de tratamento de dados da clínica (texto editável pelo admin) ou modelo padrão LGPD-compliance.

#### Regras invariantes

- **FR-036**: Esta feature MUST NOT alterar nenhum registro financeiro existente. Agendamentos criados publicamente entram com status "agendado" e valor zerado/pendente, conforme política existente.
- **FR-037**: Esta feature MUST NOT alterar configurações de RLS de tabelas existentes. Novas tabelas MAY ter políticas próprias; rotas públicas usam funções server-side com isolamento explícito por tenant.
- **FR-038**: Esta feature MUST reaproveitar a infraestrutura existente de pacientes (criptografia), appointments (constraint anti-colisão) e emails (Resend). Sem nova dependência paga.

### Key Entities

- **Configuração de agendamento público (por tenant)**: ativação, slug único, janelas de antecedência (mínima/máxima), janela de cancelamento.
- **Profissional publicado (por tenant)**: vinculado a um profissional cadastrado da clínica, com bio pública opcional e ordem de exibição.
- **Procedimento publicado por profissional (1:N por profissional publicado)**: cada combinação `(tenant, profissional, procedimento)` tem `display_name` amigável próprio (ex.: "Consulta clínica" em vez do nome técnico TUSS) e `duration_minutes` próprio (varia por profissional). Reusa `procedure_id` da tabela canônica de procedimentos como referência.
- **Token de cancelamento**: chave criptograficamente única, vinculada a um agendamento, com data de criação, data de expiração, indicador de uso (usado / não usado).
- **Registro de rate limit**: hash de IP, tenant, tipo de ação (visualização ou submit), timestamp, com retenção máxima de 7 dias.
- **Entrada de auditoria pública**: tipo de evento (visualização, criação, cancelamento), slug, hash de IP, timestamp, identificador do appointment afetado, ator marcado como "anônimo".
- **Política de privacidade pública**: texto associado ao tenant exibido em `/agendar/[slug]/privacidade`.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: Um paciente novo consegue completar o fluxo (acesso → submit confirmado) em **≤90 segundos** quando familiarizado com o tipo de fluxo (medido por telemetria após primeiro mês).
- **SC-002**: A taxa de conversão `visualização do landing → submit confirmado` é **≥15%** no primeiro mês após o rollout para clínicas que divulgaram o link ativamente.
- **SC-003**: Cada clínica com link público habilitado e divulgação mínima recebe **≥10 agendamentos públicos** no primeiro mês de uso.
- **SC-004**: A taxa de no-show entre agendamentos públicos é **no máximo 5 pontos percentuais maior** do que entre agendamentos internos do mesmo período (compromisso entre acessibilidade e comprometimento).
- **SC-005**: Em **100%** dos tenants com a feature ativa, testes automatizados provam que um slug não consegue acessar dados de outro tenant (isolamento multi-tenant verificado).
- **SC-006**: Em **100%** das tentativas de submit sem captcha válido, slot fora da janela, profissional não publicado ou procedimento não publicado, o sistema rejeita antes de criar qualquer registro.
- **SC-007**: Em testes de carga simulando **2 clientes confirmando simultaneamente o mesmo slot**, apenas 1 agendamento é persistido; o outro recebe mensagem clara em ≤1 segundo.
- **SC-008**: Pacientes recebem email de confirmação em **≤5 minutos** em 99% dos casos.
- **SC-009**: Pacientes conseguem cancelar via link em **≤3 cliques** a partir do email (clicar no link, confirmar na página, ver confirmação).
- **SC-010**: Zero IPs em texto claro são encontrados em logs ou tabelas de auditoria (verificável por inspeção de schema + audit em produção).
- **SC-011**: Após o primeiro trimestre, **≥30% das clínicas pequenas/médias** ativas no Prontool têm a feature habilitada (indicador de adoção).
- **SC-012**: Custo recorrente de infraestrutura para suportar a feature é **R$ 0/mês** adicional ao plano vigente.

## Assumptions

- A **infraestrutura de pacientes encriptados** existente (chave de criptografia, RPCs de busca por CPF, política de anonimização) é reaproveitada integralmente — sem alteração.
- A **infraestrutura de appointments** (constraint anti-colisão, estados, schedule_blocks) é reaproveitada — agendamentos públicos entram com status `agendado` igual aos internos.
- O provedor de **captcha** escolhido (Cloudflare Turnstile) **não exige cookie nem rastreamento entre sites** e é compatível com a legislação brasileira de privacidade. Esta escolha pode ser revisada na fase de plano, mas o requisito (FR-016) é tecnologia-agnóstico.
- O provedor de **email** existente (Resend) atende latência ≤5 minutos em 99% dos casos. Caso métricas pós-rollout indiquem o contrário, considerar fallback ou troca — fora do escopo deste spec.
- **Domínio público** é `prontool.com.br/agendar/[slug]` no MVP. Custom domain por clínica (`agendar.clinicax.com.br`) fica como fase 2.
- **Fluxo de pagamento online** no momento do agendamento fica fora do escopo. O paciente paga presencialmente. Se for pedido depois, é trabalho adicional não trivial (gateway, conciliação, idempotência).
- **Validação de plano de saúde em tempo real** fica fora do escopo. O paciente apenas marca; a conferência de plano é feita pela recepção no atendimento.
- **Reagendamento** via link (cancelar + criar em 1 fluxo) fica fora do escopo. Versão 1 oferece apenas cancelar + agendar novo manualmente.
- **Anamnese pré-consulta** fica fora do escopo — paciente preenche em consultório.
- **Lista de espera** (paciente entra na fila para cancelamentos) fica fora do escopo.
- **iframe embed** para a clínica colar no próprio site fica fora do escopo — link compartilhável basta no MVP.
- **App nativo / PWA** fica fora deste spec — escopo separado.
- **Validação de email real-time** (DNS / SMTP probe) fica fora do escopo. Email sintaticamente válido é aceito; tela de sucesso serve como evidência se o email não chegar.
- **Política de privacidade** padrão (LGPD-compliance) é fornecida pelo Prontool como template; clínica MAY editar.
- A **constituição do produto** (princípios I-V) é aplicada na revisão: migration revisada por mantenedor com conhecimento de domínio antes do merge.
- **Cada user story** pode ser entregue em commits independentes para a master, conforme convenção do projeto. Ordem sugerida: US2 (config admin) → US1 (fluxo do paciente) → US3 (segurança) → US5 (confirmação rica) → US4 (cancelamento via link).
- **Métrica SC-011** (30% de adoção em 1 trimestre) **depende de divulgação** e treinamento que estão fora do escopo deste spec — se desconfirmada por baixa adoção, não é falha técnica.
