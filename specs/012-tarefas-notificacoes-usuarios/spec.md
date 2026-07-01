# Feature Specification: Tarefas, Notificações e Cadastro Manual de Usuário

**Feature Branch**: `012-tarefas-notificacoes-usuarios`
**Created**: 2026-05-13
**Status**: Draft
**Input**: User description: "Três funcionalidades em uma fatia coordenada: (1) Cadastro de tarefas em Operação com responsável, prioridade, status e data limite; (2) Notificações persistidas (renomeando 'Alertas') com 4 tipos — atendimentos de hoje, tarefas no prazo/atrasadas, aniversariantes do mês — sininho na topbar com badge e página dedicada; (3) Cadastro manual de usuário em /configuracoes/usuarios (senha inicial definida pelo admin, sem fluxo de convite por email), com vínculo opcional a um profissional existente (tabela doctors)."

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Gerenciar tarefas operacionais por responsável (Priority: P1)

A administradora precisa registrar atividades operacionais (ligar para paciente, confirmar repasse, comprar material) e atribuir a um membro da equipe com data limite e prioridade. Cada usuário precisa enxergar suas próprias tarefas; admin enxerga todas. Tarefas atrasadas precisam estar visivelmente destacadas. Hoje a equipe usa anotações em papel/WhatsApp, perdendo prazo e responsável.

**Why this priority**: É a fundação isolada (sem dependência das demais US). Tem valor próprio entregue desde o dia 1 — equipe organiza demanda operacional sem precisar de nada das outras features. Também é pré-requisito das notificações de tarefa (US2), mas US2 só agrega valor — sem US1, US2 não tem o que notificar.

**Independent Test**: Como admin, em `/operacao/tarefas`, cadastro uma tarefa "Ligar para paciente João" com responsável Ana, data limite amanhã, prioridade alta. Ana faz login, vê a tarefa atribuída a ela. Ana marca como concluída — admin vê o status atualizado. Recepcionista que não é responsável não vê a tarefa.

**Acceptance Scenarios**:

1. **Given** sou admin em `/operacao/tarefas`, **When** cadastro uma tarefa com título, responsável Ana, data limite 2026-05-20, prioridade "alta", **Then** a tarefa aparece na listagem com status "pendente" e os campos preenchidos; Ana recebe a tarefa ao filtrar por responsável "meu".
2. **Given** uma tarefa atribuída a mim com data limite ontem, **When** acesso a listagem, **Then** a linha aparece destacada em vermelho e o filtro de status "atrasadas" também a retorna.
3. **Given** sou responsável por uma tarefa pendente, **When** clico em "Concluir", **Then** o status muda para "concluída", `completed_at` e `completed_by` são gravados, e a tarefa some do filtro padrão "pendentes" mas aparece em "concluídas".
4. **Given** sou recepcionista e não sou responsável por uma tarefa, **When** acesso a listagem, **Then** a tarefa não aparece (RLS oculta).
5. **Given** sou recepcionista, **When** cadastro uma nova tarefa, **Then** o responsável é forçado para mim mesma (sem opção de atribuir a outro).
6. **Given** sou admin, **When** filtro por responsável + período, **Then** apenas tarefas com `due_date` no período e responsável escolhido aparecem.
7. **Given** uma tarefa concluída, **When** clico em "Reabrir", **Then** o status volta a "pendente", `completed_at`/`completed_by` ficam NULL e a tarefa volta para a lista de pendentes.

---

### User Story 2 - Notificações persistidas com sininho na topbar (Priority: P2)

Cada usuário do tenant precisa de uma central de notificações com sinalização clara do que é dele e do que requer atenção. Hoje a sidebar tem "Alertas" mas só lista eventos sistêmicos (DLQ, falha de sync) — sem foco no dia operacional do profissional. A nova central traz informações úteis para o dia-a-dia (atendimentos de hoje, prazos de tarefa, aniversariantes do mês para fortalecer vínculo com pacientes).

**Why this priority**: Depende parcialmente de US1 (tarefas) e de dados existentes (atendimentos, pacientes). Sem US1 já entrega valor (apenas notificações de atendimento + aniversariantes), mas o conjunto completo só faz sentido após US1.

**Independent Test**: Tenho 2 atendimentos agendados para hoje + 1 tarefa minha atrasada + aniversariantes do mês. Ao abrir o sistema, o sininho na topbar mostra badge "4" em vermelho (porque há atrasada). Clico no sininho → vou para `/operacao/notificacoes`. Vejo 4 notificações distintas. Clico na primeira → marca como lida → navega para o atendimento. Marco todas como lidas. Sininho some o badge.

**Acceptance Scenarios**:

1. **Given** tenho 2 atendimentos agendados para hoje, **When** acesso o sistema pela primeira vez no dia, **Then** 2 notificações individuais são geradas (`type='atendimento'`), uma por atendimento, com mensagem "Atendimento às [hora] com [paciente] — [procedimento]".
2. **Given** tenho 1 tarefa minha com `due_date` = hoje e 1 tarefa minha com `due_date` < hoje, **When** acesso o sistema, **Then** 2 notificações são geradas: uma `type='tarefa'` ("Lembrete: '[título]' precisa ser concluída hoje") e uma `type='tarefa_atrasada'` ("Atenção: '[título]' está pendente desde [data]").
3. **Given** existem 5 pacientes com aniversário no mês corrente, **When** é dia 1 do mês (ou primeira visita do mês), **Then** 1 notificação `type='aniversarios_mes'` é gerada com a lista dos 5. Se não há aniversariantes: nenhuma notificação criada.
4. **Given** já recebi notificações neste dia/mês (idempotência), **When** acesso o sistema novamente, **Then** notificações duplicadas NÃO são geradas (chave natural por usuário + tipo + referência cobre cada caso).
5. **Given** tenho notificações não lidas, **When** olho o sininho na topbar, **Then** vejo um badge com o número total. Se há ao menos uma atrasada: badge vermelho. Caso contrário: badge azul. Sem não lidas: sem badge.
6. **Given** estou em `/operacao/notificacoes`, **When** clico em uma notificação não lida com `reference_type='appointment'`, **Then** ela é marcada como lida (`is_read=true`, `read_at=now()`) e sou levado para a página do atendimento referenciado.
7. **Given** clico em "Marcar todas como lidas", **When** confirmo, **Then** todas as minhas notificações não lidas viram lidas em uma operação atômica.
8. **Given** sou admin, **When** acesso `/operacao/notificacoes`, **Then** vejo apenas minhas próprias notificações (não as dos outros usuários do tenant).
9. **Given** a sidebar tinha "Alertas" antes, **When** acesso a sidebar agora, **Then** vejo "Notificações" no lugar; eventos sistêmicos (DLQ, sync) ficam acessíveis via sub-item ou link mantido (decisão de implementação documentada nas Assunções).

---

### User Story 3 - Cadastrar usuário manualmente com senha e vínculo a profissional (Priority: P2)

O admin precisa criar um login para alguém que já trabalha na clínica sem depender de email de confirmação. Em muitos cenários, o admin senta com o profissional e configura a conta no momento — não há tempo para esperar email. Além disso, o profissional de saúde precisa ter o login dele vinculado ao registro de profissional existente (`doctors`), para que o sistema saiba quais atendimentos são dele, qual a comissão, etc.

**Why this priority**: Independente das outras US. Tem valor próprio (acelera onboarding de equipe). O vínculo a profissional resolve um problema histórico: hoje não há ponte entre `auth.users` e `doctors`. Esse mapeamento habilita comissões corretas e relatórios "minhas estatísticas" para o profissional.

**Independent Test**: Como admin em `/configuracoes/usuarios`, clico em "Cadastrar usuário", preencho nome, email, senha temporária, função "profissional_saude" e marco "Vincular a profissional", escolho "Dra. Ana". Salvo. O usuário aparece imediatamente na listagem com a coluna "Profissional vinculado: Dra. Ana". Ana faz login com email+senha sem precisar confirmar email. Eu, como admin, vejo na listagem que a Dra. Ana está vinculada.

**Acceptance Scenarios**:

1. **Given** sou admin em `/configuracoes/usuarios`, **When** clico em "Cadastrar usuário" e preencho os campos obrigatórios + função "recepcionista" + checkbox de vínculo a profissional desmarcado, **Then** a conta é criada no sistema de autenticação (email já confirmado), o registro de vínculo ao tenant é criado e o novo usuário aparece na listagem com a função.
2. **Given** marquei "Vincular a profissional" e escolhi a Dra. Ana, **When** salvo, **Then** o registro do profissional ganha o vínculo ao login criado, e a listagem mostra "Profissional vinculado: Dra. Ana".
3. **Given** o usuário criado faz login imediatamente após o cadastro com o email e a senha definida pelo admin, **When** envia credenciais corretas, **Then** o login é aceito (sem necessidade de etapa de confirmação por email).
4. **Given** sou admin e o email informado já está em uso por outro usuário do tenant, **When** tento cadastrar, **Then** o sistema rejeita com mensagem clara ("Esse e-mail já está vinculado ao tenant").
5. **Given** estou cadastrando alguém com função "profissional_saude" mas sem marcar o vínculo, **When** salvo, **Then** o usuário é criado e a listagem mostra aviso sutil "Sem profissional vinculado".
6. **Given** um profissional já tem `user_id` vinculado, **When** tento cadastrar outro usuário e selecioná-lo como vínculo, **Then** ele NÃO aparece na lista de profissionais disponíveis para vincular (ou aparece desabilitado com aviso).
7. **Given** sou usuário não-admin, **When** acesso `/configuracoes/usuarios`, **Then** sou redirecionada para o meu perfil — não tenho permissão para criar usuários.

---

### Edge Cases

- **Tarefa sem responsável**: bloqueada na validação. Responsável é obrigatório.
- **Tarefa com data limite no passado já no cadastro**: permitida (legítimo retroativo); aparece já marcada como atrasada se status=pendente.
- **Concluir tarefa de outra pessoa**: admin pode; demais não. RBAC server-side bloqueia.
- **Tarefa deletada**: soft-delete por admin; `deleted_at` set; some das listagens; preserva referência em `completed_by`/audit_log.
- **Notificação de atendimento estornado**: o atendimento original já gerou a notificação; após estornar, a notificação fica como histórico (não é apagada — preservar trilha). Pode ser marcada como lida normalmente.
- **Notificação de tarefa concluída antes do prazo**: a notificação de "tarefa hoje" só é gerada se a tarefa ainda está `status=pendente`. Após conclusão, futuras gerações pulam (idempotência via natural key + status).
- **Sininho com 0 não lidas mas com notificações lidas**: sem badge; ao clicar leva para a página onde as lidas continuam visíveis (sub-fundo branco).
- **Aniversariantes em fevereiro de ano bissexto**: aniversário em 29/02 aparece na lista de fevereiro como o dia "29".
- **Aniversariante sem `birth_date` cadastrado**: ignorado (sem dado, sem notificação).
- **Usuário criado manualmente desativa-se depois**: `user_tenants.status='disabled'` cobre; ele continua existindo em `auth.users`. Reativação via fluxo existente.
- **Senha definida pelo admin é fraca/curta**: validação local mínima (8+ chars); senha tipicamente trocada pelo usuário no primeiro acesso (recomendação UX, não força).
- **Vincular usuário a profissional que já tem outro login**: bloqueado pela unicidade `(tenant_id, user_id)` em doctors; mensagem clara.
- **Desvincular usuário do profissional**: fluxo separado (futuro), não coberto nesta entrega.
- **Tenant sem profissionais cadastrados**: checkbox "Vincular a profissional" desabilitado + tooltip "Cadastre um profissional primeiro".

## Requirements _(mandatory)_

### Functional Requirements

**Tarefas (US1)**

- **FR-001**: O sistema MUST permitir, para qualquer usuário autenticado do tenant, criar tarefas com título (1–200 chars, obrigatório), observações (texto livre, opcional, ≤ 1000 chars), data limite (obrigatória, qualquer data válida), responsável (FK a um usuário ativo do tenant — para não-admin, restrito a si mesmo), prioridade (enum {baixa, normal, alta, urgente}, obrigatória) e status (default "pendente").
- **FR-002**: O sistema MUST permitir listar tarefas com filtros por status (pendente/concluída/atrasada/todas), responsável (admin filtra todos; demais veem apenas as suas) e período de data limite.
- **FR-003**: O sistema MUST destacar visualmente (cor vermelha) tarefas pendentes cuja `due_date` é anterior à data atual.
- **FR-004**: O sistema MUST permitir marcar uma tarefa como concluída — preenche `completed_at` (now) e `completed_by` (ator). MUST permitir reabrir uma tarefa concluída — zera `completed_at`/`completed_by`.
- **FR-005**: O sistema MUST aplicar RLS de modo que: admin do tenant lê todas as tarefas do tenant; demais papéis leem apenas tarefas onde `assigned_to = auth.uid()`. Escrita: admin pode criar/atualizar para qualquer responsável; demais só para si mesmos.
- **FR-006**: O sistema MUST manter trilha de auditoria de cada criação, conclusão e reabertura de tarefa (entity='tasks', ator, timestamps).
- **FR-007**: O sistema MUST permitir soft-delete da tarefa por admin (preserva audit + referências).

**Notificações (US2)**

- **FR-008**: O sistema MUST gerar notificações persistidas individuais para cada atendimento agendado para o dia corrente, uma por usuário cujo login está vinculado ao profissional do atendimento (ou ao admin se aplicável a política da clínica — ver Assunções).
- **FR-009**: O sistema MUST gerar notificações persistidas para cada tarefa pendente cuja `due_date` é igual ou anterior à data atual, distinguindo:
  - `type='tarefa'` quando `due_date = hoje`
  - `type='tarefa_atrasada'` quando `due_date < hoje`
- **FR-010**: O sistema MUST gerar uma única notificação `type='aniversarios_mes'` por usuário a cada mês, listando pacientes com `birth_date` no mês corrente. Quando não há aniversariantes, nenhuma notificação é criada.
- **FR-011**: A geração de notificações MUST ser idempotente — múltiplas execuções no mesmo dia/mês para o mesmo usuário NÃO criam duplicatas (chave natural: `user_id + type + reference_id` com semântica adequada por tipo).
- **FR-012**: Cada notificação MUST conter: id, usuário destinatário, tipo, título, corpo, opcional reference_id + reference_type (entidade ligada), flag `is_read` (default false), `read_at`, `created_at`.
- **FR-013**: O sistema MUST aplicar RLS de modo que cada usuário visualiza apenas as próprias notificações (`user_id = auth.uid()`).
- **FR-014**: A topbar MUST exibir um sininho com badge contendo o NÚMERO de notificações não lidas do usuário. Badge MUST ser vermelho quando há ao menos uma notificação não lida do tipo `tarefa_atrasada`; caso contrário azul. Sem não lidas: sem badge.
- **FR-015**: A página `/operacao/notificacoes` MUST listar as notificações do usuário com indicação visual entre lidas e não lidas (fundo levemente azulado para não lidas, branco para lidas).
- **FR-016**: Clicar em uma notificação MUST marcá-la como lida (set `is_read=true`, `read_at=now`) e, se houver `reference_id`+`reference_type`, MUST navegar para a página da entidade referenciada.
- **FR-017**: O usuário MUST poder marcar todas as notificações como lidas em uma única ação.
- **FR-018**: A sidebar MUST renomear o item "Alertas" para "Notificações", apontando para `/operacao/notificacoes`. Alertas sistêmicos (DLQ, sync) MUST permanecer acessíveis (sub-item "Sistema" dentro de notificações, ou link separado preservado para `/operacao/alertas` e `/operacao/dlq` — decisão de UX documentada em Assunções).

**Cadastro manual de usuário (US3)**

- **FR-019**: O sistema MUST oferecer ao admin uma opção "Cadastrar usuário" em `/configuracoes/usuarios`, complementar ao convite por email existente.
- **FR-020**: O formulário de cadastro manual MUST aceitar: nome completo (obrigatório), email (obrigatório, formato válido), senha inicial (obrigatória, ≥ 8 chars), telefone (opcional), função (obrigatória, enum dos papéis suportados), e um checkbox "Vincular a profissional" (desmarcado por padrão) que, quando marcado, exibe um select de profissionais ativos do tenant ainda não vinculados a outro login.
- **FR-021**: Ao salvar, o sistema MUST criar a conta no sistema de autenticação com email já confirmado (sem fluxo de confirmação por email), criar o vínculo ao tenant (`user_tenants`) com a função selecionada, e — se aplicável — gravar o `user_id` no registro do profissional.
- **FR-022**: O usuário recém-criado MUST poder autenticar-se imediatamente com email e senha definidos, sem etapas adicionais.
- **FR-023**: O sistema MUST rejeitar o cadastro quando o email já está vinculado ao tenant (mensagem clara) ou quando o profissional escolhido já tem `user_id` setado.
- **FR-024**: A listagem de usuários MUST exibir, em uma coluna nova "Profissional vinculado", o nome do profissional quando há vínculo, ou vazio quando não há.
- **FR-025**: Para usuários com função `profissional_saude` sem vínculo, a listagem MUST exibir um aviso sutil "Sem profissional vinculado" próximo à linha — informativo, não bloqueante.
- **FR-026**: A criação manual de usuário MUST ser restrita a admin do tenant (qualquer outro papel recebe 403).
- **FR-027**: O sistema MUST manter trilha de auditoria do cadastro (ator, timestamps, papel atribuído, vínculo a profissional se houver).

**Multi-tenant + segurança**

- **FR-028**: Todas as escritas e leituras desta feature MUST ser escopadas por `tenant_id` (RLS no banco + filtros explícitos onde aplicável).
- **FR-029**: Tarefas, notificações e novos vínculos usuário-profissional MUST NÃO vazar entre tenants (testes de isolamento obrigatórios).

### Key Entities

- **Tarefa (task)**: id, tenant_id, título, observações, due_date, prioridade {baixa, normal, alta, urgente}, status {pendente, concluida}, assigned_to (FK ao usuário), assigned_by (FK ao usuário), completed_at, completed_by, created_at, deleted_at, deleted_by.
- **Notificação (notification)**: id, tenant_id, user_id (destinatário), type {atendimento, tarefa, tarefa_atrasada, aniversarios_mes}, title, body, reference_id (uuid opcional), reference_type (string opcional), is_read, read_at, created_at.
- **Profissional (doctor, já existente)**: ganha campo opcional `user_id` (FK ao usuário do sistema). Único por tenant — um profissional pode estar vinculado a no máximo um login; um login pode (em princípio) estar vinculado a no máximo um profissional do mesmo tenant.
- **Usuário do tenant (user_tenants, já existente)**: sem alteração de schema. Vínculo a tenant + função + status.
- **auth.users (gerenciado pelo Supabase Auth)**: novo registro criado pelo fluxo de cadastro manual, com email confirmado.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: A criação de uma tarefa (preencher campos + salvar + ver na lista) leva menos de 30 segundos para qualquer usuário do tenant na primeira tentativa.
- **SC-002**: Tarefas atrasadas são reconhecíveis em menos de 2 segundos de visualização da lista (destaque visual claro), sem precisar abrir filtros.
- **SC-003**: 100% das notificações geradas para o mesmo usuário no mesmo dia/mês para a mesma referência são idempotentes (zero duplicatas, verificável por consulta).
- **SC-004**: O usuário consegue identificar pelo sininho da topbar, em até 1 segundo de visualização, (a) se tem não lidas e (b) se há alguma atrasada — o badge vermelho destaca o segundo caso imediatamente.
- **SC-005**: A página de notificações lista até 100 notificações do usuário em até 2 segundos do clique no sininho.
- **SC-006**: O cadastro manual de um usuário (preencher + salvar + login do criado funciona) leva menos de 1 minuto para o admin na primeira tentativa.
- **SC-007**: 100% dos usuários criados manualmente conseguem fazer login imediatamente após cadastro, sem nenhuma etapa extra de confirmação.
- **SC-008**: 100% das operações de criação/conclusão/reabertura/exclusão de tarefa e criação manual de usuário são auditadas (verificável por consulta no log).
- **SC-009**: 100% dos vínculos usuário↔profissional respeitam unicidade — não é possível ter dois logins vinculados ao mesmo profissional, nem dois profissionais ao mesmo login dentro do mesmo tenant (verificável por testes automatizados).
- **SC-010**: Após renomear "Alertas" para "Notificações", 0% dos usuários relatam confusão sobre onde encontrar alertas sistêmicos antigos (manter sub-item/link para o destino legado preserva o acesso).

## Assumptions

- **Geração de notificações de atendimento**: o destinatário natural é o **profissional do atendimento** (via `doctors.user_id` quando vinculado) e, paralelamente, qualquer admin do tenant. Se a clínica preferir que recepcionistas também recebam, isto é configurável em iteração posterior (não no MVP).
- **Geração lazy vs cron**: a geração roda **on-demand** (lazy) no momento em que o usuário acessa o sistema ou abre a página de notificações, usando UPSERT com chave natural para garantir idempotência. Sem necessidade inicial de cron job. Caso o produto demande pré-geração (push notifications, email), uma evolução com cron pode ser adicionada.
- **Renomeação "Alertas" → "Notificações"**: o item de sidebar muda de nome e rota. A página `/operacao/alertas` permanece acessível como link/sub-item "Alertas do sistema" dentro de Notificações (ou via "Pendências" no caso de DLQ). Nenhum link externo conhecido aponta para `/operacao/alertas` — risco baixo.
- **Senha definida pelo admin é temporária por convenção**: o sistema NÃO força mudança no primeiro acesso (manter simples no MVP). UX recomenda que o admin comunique ao usuário para trocar via `/configuracoes/perfil`.
- **Vínculo `doctors.user_id` é nullable + único por tenant**: permite a maioria dos profissionais existirem sem login (ex.: profissionais terceirizados que não usam o sistema) e bloqueia duplicação acidental.
- **Auditoria reusa estrutura existente**: nenhuma tabela nova de log; usa `audit_log` + `log_audit_event` do projeto.
- **Notificações de aniversariantes**: usa `birth_date` cifrado dos pacientes — geração descriptografa apenas mês/dia (sem expor ano de nascimento) usando a chave já em uso pelo projeto. Quando não há aniversariantes no mês, nenhuma notificação é criada.
- **RBAC dos novos endpoints**: admin tem acesso total às 3 features; financeiro/recepcionista/profissional_saude têm acesso de leitura/gestão apenas às tarefas onde são responsáveis e às próprias notificações. Apenas admin cadastra usuários manualmente.
- **Locale pt-BR**: títulos, mensagens, prioridades, badges em pt-BR. Datas formatadas com vírgula e formato brasileiro.
- **Soft-delete de tarefas**: mantém histórico para auditoria; deleção física é proibida (padrão do projeto).
- **Performance da página de notificações**: lista paginada se necessário, mas o limite inicial de 100 itens cobre o caso real (tenant pequeno). Otimizações ficam para iteração futura.

## Dependencies

- `auth.users` gerenciada pelo Supabase Auth — o sistema precisa de acesso administrativo para criar contas com email confirmado.
- `user_tenants` (existente) — relação usuário↔tenant com função e status.
- `doctors` (existente) — ganha coluna `user_id` opcional.
- `patients` (existente) — leitura de `birth_date` cifrado para gerar aniversariantes do mês.
- `appointments` (existente) — leitura para gerar notificações de atendimentos de hoje.
- `audit_log` (existente) — receberá entradas das novas operações.
- Item "Alertas" na sidebar (existente) — será renomeado.
