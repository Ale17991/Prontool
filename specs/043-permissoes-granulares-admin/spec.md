# Feature Specification: Permissões granulares por usuário + autonomia de super-admin

**Feature Branch**: `043-permissoes-granulares-admin`
**Created**: 2026-06-26
**Status**: Draft
**Input**: Overrides de permissão por usuário (sobre os 4 papéis fixos) geridos pelo admin da clínica; e ampliação do painel /admin para o super-admin gerenciar usuários, resetar senhas, editar dados da clínica e impersonar — tudo server-side, isolado por tenant e auditado.

## Resumo

Hoje as permissões são uma matriz **fixa** papel→ações (4 papéis). O admin da clínica não consegue ajustar nada por usuário, e o dono da plataforma tem pouca autonomia operacional sobre as clínicas (não gerencia usuários nem dados da clínica pelo /admin).

Esta feature entrega duas frentes:

1. **Permissões granulares (overrides por usuário)** — o admin da clínica mantém os 4 papéis como base e pode **conceder** ou **revogar** ações específicas por usuário. Permissão efetiva = (ações do papel) + (concedidas) − (revogadas). Aplicada **no servidor**.
2. **Autonomia de super-admin** — o painel /admin ganha: gerenciar usuários de qualquer clínica, resetar senha, editar dados cadastrais da clínica e entrar na clínica (impersonar) para suporte — sempre isolado por tenant e auditado.

## Clarifications

### Session 2026-06-26

- Q: Quais ações podem ter override? → A: Todas são overridáveis; as sensíveis (preço, comissão, estorno, auditoria) exibem aviso explícito na UI ao conceder. Risco mitigado por aviso + auditoria.
- Q: Profundidade da impersonação (US5)? → A: Read-only — super-admin vê as telas da clínica como apoio, sem escrever/alterar dados; banner visível + auditoria de início/fim. Escrita fica como evolução futura.
- Q: (refino, fase de plano) As ações financeiras-críticas podem ter override, dado o Princípio V? → A: NÃO. `price.write`, `commission.write`, `appointment.reverse`, `audit.read`, `audit.export` são PROTEGIDAS (não-overridáveis), honrando o Princípio V. As demais permanecem overridáveis (sensíveis com aviso).

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Admin da clínica ajusta permissões por usuário (Priority: P1)

O admin de uma clínica abre a gestão de usuários e, num usuário específico, concede ou revoga capacidades pontuais sobre o papel base (ex.: deixar um recepcionista **ver valores financeiros**, ou impedir um financeiro de **estornar atendimento**). A mudança vale imediatamente e é aplicada no servidor.

**Why this priority**: É o pedido central ("controlar as permissões dos usuários"); destrava casos reais sem precisar criar papéis novos.

**Independent Test**: Conceder uma ação a um usuário sem ela no papel e confirmar que ele passa a poder executá-la (servidor permite); revogar uma ação do papel e confirmar que ele deixa de poder, mesmo chamando a API direto.

**Acceptance Scenarios**:

1. **Given** um recepcionista (papel sem `finance.view_values`), **When** o admin concede `finance.view_values` a esse usuário, **Then** ele passa a ver valores nas telas e o servidor autoriza a ação.
2. **Given** um usuário cujo papel concede `expense.write` (ação overridável), **When** o admin revoga `expense.write` desse usuário, **Then** a tentativa de criar despesa é negada no servidor e registrada na auditoria. (Nota: ações financeiras-críticas como `appointment.reverse` são PROTEGIDAS — não podem ter override.)
3. **Given** um override aplicado, **When** o usuário tenta a ação chamando a API diretamente (sem passar pela UI), **Then** a autorização é avaliada no servidor com o override (UI não é o mecanismo de segurança).
4. **Given** qualquer alteração de override, **When** ela é salva, **Then** uma entrada de auditoria é criada (ator, alvo, ação, concedido/revogado, antes/depois, motivo, origem).
5. **Given** um usuário comum (não-admin), **When** ele tenta alterar permissões (próprias ou de outro), **Then** é negado — só admin do tenant (ou super-admin) altera permissões.

---

### User Story 2 - Super-admin gerencia usuários de qualquer clínica pelo /admin (Priority: P2)

O dono da plataforma, no /admin, abre uma clínica e cria, edita, desativa/reativa usuários e troca papéis daquela clínica, sem precisar entrar nas Configurações dela.

**Why this priority**: Autonomia operacional para dar suporte/onboarding; reaproveita o fluxo de usuários já existente, agora cross-tenant.

**Independent Test**: Pelo /admin, criar um usuário admin numa clínica de teste e confirmar que ele consegue logar nela; trocar o papel de um usuário e ver o efeito.

**Acceptance Scenarios**:

1. **Given** o detalhe de uma clínica no /admin, **When** o super-admin cria um usuário com papel definido, **Then** o usuário passa a existir e acessar aquela clínica, e a ação é auditada no tenant alvo.
2. **Given** um usuário de uma clínica, **When** o super-admin troca seu papel ou o desativa, **Then** o acesso reflete a mudança e o último admin ativo continua protegido (não pode ser rebaixado/desativado).
3. **Given** uma ação de gestão de usuário pelo /admin, **When** ela ocorre, **Then** é validada como super-admin e auditada com `tenant_id` da clínica alvo.

---

### User Story 3 - Super-admin reseta senha de qualquer usuário (Priority: P2)

No /admin, o super-admin dispara a redefinição de senha de um usuário de qualquer clínica (envio de e-mail de recuperação ou geração de link), para suporte.

**Why this priority**: Operação de suporte muito comum; baixo custo, alto valor.

**Independent Test**: Disparar reset para um usuário e confirmar que o e-mail/link de redefinição é gerado e a ação é auditada.

**Acceptance Scenarios**:

1. **Given** um usuário no /admin, **When** o super-admin dispara o reset de senha, **Then** o e-mail/link de redefinição é enviado/gerado e a ação é auditada (sem expor a senha).
2. **Given** o reset, **When** o usuário usa o link, **Then** consegue definir nova senha (reusa o fluxo de recuperação existente).

---

### User Story 4 - Super-admin edita dados cadastrais da clínica pelo /admin (Priority: P3)

No /admin, o super-admin ajusta dados da clínica (nome, CNPJ, contato) sem entrar na clínica.

**Why this priority**: Conveniência de suporte/correção; menor frequência.

**Acceptance Scenarios**:

1. **Given** o detalhe de uma clínica, **When** o super-admin edita nome/CNPJ/contato e salva, **Then** os dados são atualizados e a alteração é auditada (antes/depois).
2. **Given** um CNPJ inválido, **When** o super-admin tenta salvar, **Then** o sistema rejeita com mensagem clara.

---

### User Story 5 - Super-admin entra na clínica (impersonar) para suporte (Priority: P3)

O super-admin entra na clínica em modo **somente-leitura** para enxergar as telas como a clínica veria e diagnosticar — com indicação visível (banner) de que está impersonando e registro de início/fim. (Não altera dados.)

**Why this priority**: Suporte avançado; é a ação mais sensível, então fica por último e com mais cuidado.

**Acceptance Scenarios**:

1. **Given** uma clínica no /admin, **When** o super-admin inicia a impersonação, **Then** ele passa a ver o ambiente da clínica com um indicador visível de impersonação, e o início é auditado.
2. **Given** uma sessão de impersonação, **When** ela termina (ou expira), **Then** o fim é auditado e o super-admin volta ao contexto de plataforma.

---

### Edge Cases

- **Override conflitante com papel**: revogar uma ação que o papel concede deve PREVALECER (deny vence). Conceder uma ação que o papel já tem é no-op.
- **Auto-escalonamento**: um usuário não pode conceder a si mesmo nem a outros uma permissão que ele próprio não poderia conceder; só admin do tenant (ou super-admin) altera permissões.
- **Ações protegidas (Princípio V)**: `price.write`, `commission.write`, `appointment.reverse`, `audit.read`, `audit.export` são **NÃO-overridáveis** — a UI não as oferece e o servidor rejeita qualquer tentativa de override sobre elas. Honra a separação de funções financeira da constituição.
- **Ações sensíveis (overridáveis)**: as demais ações de escrita/configuração financeira não-críticas exibem **aviso explícito** na UI ao conceder — autonomia preservada, risco mitigado por aviso + auditoria.
- **Último admin**: não pode ser rebaixado/desativado nem perder a capacidade de administrar (proteção `enforce_last_admin` existente continua valendo).
- **Papel trocado depois de overrides**: ao mudar o papel do usuário, os overrides continuam aplicando sobre o novo papel (não são apagados) — deixar claro na UI o efeito combinado.
- **Impersonação**: é uma **visão de suporte READ-ONLY** — o super-admin enxerga as telas da clínica mas NÃO pode escrever/alterar dados. Banner visível de impersonação + auditoria de início/fim, idealmente com tempo limitado. (Escrita "agir como" fica como evolução futura.)
- **Ação cross-tenant do super-admin**: toda ação no /admin grava auditoria com o `tenant_id` da clínica alvo (não da plataforma).
- **Override órfão**: desativar/excluir um usuário não deve deixar overrides ativos reutilizáveis por outro usuário.

## Requirements _(mandatory)_

### Functional Requirements

**Permissões granulares (overrides)**

- **FR-001**: O sistema MUST permitir, por usuário de um tenant, CONCEDER ou REVOGAR ações individuais sobre o papel base, sem criar papéis novos.
- **FR-002**: A permissão efetiva MUST ser calculada como (ações do papel) ∪ (concedidas) ∖ (revogadas); **revogação prevalece** sobre concessão e sobre o papel.
- **FR-003**: A autorização MUST ser avaliada **no servidor** em cada requisição/endpoint, considerando papel + overrides; a UI apenas reflete o resultado e NÃO é mecanismo de segurança.
- **FR-004**: Apenas admin do mesmo tenant (ou super-admin) MAY alterar overrides; um usuário NÃO pode alterar as próprias permissões nem escalar privilégio.
- **FR-005**: O admin da clínica MUST conseguir ver e editar os overrides de cada usuário em `/configuracoes/usuarios`, com indicação clara do efeito combinado (papel + overrides).
- **FR-005a**: As ações financeiras-críticas (`price.write`, `commission.write`, `appointment.reverse`, `audit.read`, `audit.export`) MUST ser NÃO-overridáveis (Princípio V): a UI não as oferece e o servidor rejeita override sobre elas. As demais ações sensíveis permanecem overridáveis, mas a UI MUST exibir aviso explícito antes de confirmar a concessão.

**Autonomia de super-admin (/admin)**

- **FR-006**: O super-admin MUST conseguir criar, editar, desativar/reativar e trocar o papel de usuários de QUALQUER clínica pelo /admin.
- **FR-007**: O super-admin MUST conseguir disparar a redefinição de senha de qualquer usuário (e-mail/link), sem que a senha seja exposta.
- **FR-008**: O super-admin MUST conseguir editar dados cadastrais da clínica (nome, CNPJ, contato) pelo /admin, com validação (ex.: CNPJ).
- **FR-009**: O super-admin MUST conseguir entrar na clínica (impersonar) para suporte em modo **somente-leitura** (não pode escrever/alterar dados da clínica), com indicador visível (banner) e registro de início/fim.

**Segurança / auditoria (transversal — constituição)**

- **FR-010**: Toda alteração de override, troca de papel, criação/edição/desativação de usuário, reset de senha e impersonação MUST gerar entrada em `audit_log` com ator, timestamp, `tenant_id` (da clínica alvo), entidade/alvo, valor anterior/novo, motivo e origem (IP/user-agent).
- **FR-011**: Ações negadas por autorização MUST ser registradas (tentativa negada), conforme o princípio de auditoria.
- **FR-012**: O isolamento multi-tenant MUST ser preservado: overrides e ações são escopados por `tenant_id`; ações cross-tenant do super-admin validam o escopo antes de qualquer efeito.
- **FR-013**: A proteção de "último admin ativo" MUST continuar válida em todas as frentes (não rebaixar/desativar o último admin).

### Key Entities _(include if feature involves data)_

- **Override de permissão**: vínculo por (tenant, usuário, ação) com efeito CONCEDER/REVOGAR; representa o ajuste fino sobre o papel.
- **Usuário do tenant**: já existe (papel + status); ganha o conceito de "permissão efetiva" = papel + overrides.
- **Trilha de auditoria**: já existe (`audit_log`); passa a registrar overrides, ações de gestão de usuário cross-tenant, resets e impersonação.
- **Sessão de impersonação**: estado temporário do super-admin atuando dentro de uma clínica (início/fim auditados).

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: Um admin de clínica consegue conceder/revogar uma permissão a um usuário e o efeito (servidor permitindo/negando) é observável em menos de 1 minuto, sem suporte técnico.
- **SC-002**: 100% das ações sensíveis cobertas (override, troca de papel, CRUD de usuário, reset de senha, impersonação) geram entrada de auditoria com ator, alvo e antes/depois.
- **SC-003**: Uma permissão revogada por override impede a ação mesmo via chamada direta à API (não só na UI) — verificável por teste de autorização.
- **SC-004**: O super-admin consegue criar um usuário e resetar senha em qualquer clínica pelo /admin sem entrar nas Configurações da clínica.
- **SC-005**: Nenhuma ação cross-tenant do super-admin afeta tenant diferente do alvo (isolamento verificável por teste).
- **SC-006**: Em nenhum cenário o último admin ativo de uma clínica é rebaixado/desativado.

## Assumptions

- O conjunto de **Actions** existente (rbac.ts) permanece o vocabulário de permissões; a feature adiciona overrides sobre ele, sem inventar ações novas.
- A checagem `can` evolui para considerar o usuário (papel + overrides) mantendo compatibilidade com os call sites atuais; os overrides do usuário são carregados no contexto da sessão do servidor.
- O fluxo de recuperação de senha já existente é reutilizado para o reset disparado pelo super-admin.
- A edição de dados da clínica reusa o perfil já existente (`tenant_clinic_profile`).
- A impersonação expande o "entrar na clínica" já existente; detalhes de profundidade serão fechados na clarificação.
- Não há criação de papéis personalizados nesta fase (decisão explícita); e o sistema de módulos/entitlements (feature 042) não é tocado.
