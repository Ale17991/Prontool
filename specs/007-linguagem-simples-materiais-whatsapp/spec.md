# Feature Specification: Materiais opcionais, atalho WhatsApp e linguagem simples

**Feature Branch**: `007-linguagem-simples-materiais-whatsapp`
**Created**: 2026-04-30
**Status**: Draft
**Input**: User description: "Três melhorias: materiais opcionais no procedimento, botão WhatsApp e linguagem simplificada."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Registrar materiais utilizados no atendimento (Priority: P1)

Profissional que acabou de realizar um procedimento precisa documentar os materiais consumidos (gaze, agulha, fio, anestésico etc.) para fins de prontuário, auditoria interna e — no futuro — apresentação em laudos. Hoje o sistema só registra o procedimento (TUSS tabela 22), sem nenhum local para listar insumos. O profissional deve poder, opcionalmente, anexar um ou mais materiais (TUSS tabela 19) ao atendimento que está criando, sem que isso seja obrigatório nem bloqueie o salvamento.

**Why this priority**: É a única das três melhorias que envolve dados clínicos novos e que tem impacto direto em prontuário, PDF e auditoria. As outras duas (WhatsApp e linguagem simples) são puramente cosméticas/UI; esta cria conteúdo registrável.

**Independent Test**: Criar um atendimento manual escolhendo procedimento, adicionar dois materiais via typeahead (ex.: "Gaze 7,5cm" e "Seringa 5ml"), salvar, abrir o atendimento e verificar que ambos aparecem listados com código, descrição e quantidade. Repetir o cenário sem adicionar nenhum material — o atendimento deve salvar normalmente.

**Acceptance Scenarios**:

1. **Given** estou criando um atendimento manual, **When** expando a seção "Materiais utilizados (opcional)", clico em "+ Adicionar material", busco "gaze" e seleciono "GAZE ESTERIL 7,5x7,5cm" com quantidade 3, **Then** o material aparece listado com código TUSS, descrição e quantidade 3, e posso adicionar outro material logo abaixo.
2. **Given** adicionei três materiais por engano, **When** clico no "X" ao lado do segundo item antes de salvar, **Then** o segundo material some da lista local sem afetar os outros dois.
3. **Given** preenchi todos os campos obrigatórios e a seção "Materiais utilizados" está vazia, **When** clico em salvar, **Then** o atendimento é criado com sucesso e a tabela `appointment_materials` permanece sem linhas para esse atendimento.
4. **Given** estou finalizando uma etapa de plano de tratamento (que vai gerar um atendimento), **When** anexo dois materiais antes de confirmar, **Then** os materiais ficam vinculados ao atendimento gerado pela etapa.
5. **Given** abro um atendimento já salvo na timeline do paciente, **When** visualizo o card do atendimento, **Then** vejo a sub-lista "Materiais utilizados" com código + descrição + quantidade para cada item, ou nada caso o atendimento tenha sido salvo sem materiais.
6. **Given** gero o PDF de prontuário do paciente, **When** o atendimento contém materiais, **Then** o PDF inclui uma seção/sub-bloco listando código, descrição e quantidade de cada material por atendimento.

---

### User Story 2 - Linguagem do sistema acessível para profissionais não técnicos (Priority: P2)

Recepcionistas, dentistas e médicos que usam o Pronttu não são desenvolvedores. Termos como "estornar", "reverter", "tenant", "webhook", "DLQ", "soft delete", "schema cache" e mensagens de erro com `digest: 5af3e9...` confundem o usuário e fazem com que ele abra chamado em vez de resolver sozinho. A interface inteira deve ser revisada para que cada texto visível use português claro, alinhado ao vocabulário do consultório.

**Why this priority**: Toca todas as telas, mas não é bloqueante (o sistema funciona). Tem impacto direto em redução de tickets de suporte e curva de aprendizado de novos usuários. Maior que P3 porque afeta toda a base; menor que P1 porque não cria capacidade nova.

**Independent Test**: Abrir qualquer tela do sistema (lista de atendimentos, detalhe de paciente, configurações, página de erro forçada) e procurar por termos da lista de proibidos ("estorno", "reverter", "tenant", "webhook", "DLQ", "soft delete", "append-only", "schema cache", "digest: ...", "RPC", "API" em mensagem de erro). Nenhum deve aparecer. Verificar que substituições obrigatórias estão presentes onde antes havia o termo técnico.

**Acceptance Scenarios**:

1. **Given** um atendimento concluído na timeline do paciente, **When** abro o menu de ações, **Then** o item antes rotulado "Reverter atendimento" agora se chama "Cancelar atendimento" e o badge antes rotulado "Estornado" agora exibe "Cancelado".
2. **Given** um atendimento agendado que ainda não foi realizado, **When** abro o menu de ações, **Then** o item antes rotulado "Marcar como realizado" agora se chama "Confirmar atendimento" (ou equivalente acordado).
3. **Given** uma etapa de plano de tratamento em andamento, **When** clico no botão de finalizar, **Then** o rótulo é "Finalizar etapa" em vez de "Concluir etapa".
4. **Given** o paciente cadastrado tem campo de alergias vazio, **When** abro a ficha, **Then** o sistema exibe "Sem alergias conhecidas" como texto principal, com tooltip explicando "NKDA" apenas para profissionais.
5. **Given** o sistema lança um erro inesperado em qualquer tela, **When** a tela de erro renderiza, **Then** ela mostra "Algo deu errado. Tente novamente em alguns segundos." sem expor `digest: ...`, sem `RPC`, sem `API`, sem `webhook`, sem `schema cache`. O `digest` continua presente nos logs do servidor.
6. **Given** sou admin e abro a tela de pendências de integrações, **When** vejo a lista, **Then** o título é "Pendências" (ou "Fila de reprocessamento") em vez de "DLQ" ou "Dead Letter Queue", e em nenhum lugar visível ao usuário aparece "tenant" — a palavra usada é "clínica".
7. **Given** uma página de configurações faz referência à organização do usuário, **When** carrega, **Then** o termo exibido é "clínica" (não "tenant"), incluindo títulos, descrições e mensagens de validação.

---

### User Story 3 - Atalho WhatsApp na ficha do paciente (Priority: P3)

A maior parte da comunicação informal entre clínica e paciente acontece por WhatsApp (confirmação de consulta, envio de orientação pós-procedimento). Hoje o operador precisa copiar o telefone, abrir o WhatsApp Web, colar e iniciar a conversa. Um botão verde direto na ficha do paciente, que abra `wa.me/55<telefone>` em nova aba, reduz esse fluxo a um clique.

**Why this priority**: Pura conveniência, zero backend, zero risco de regressão fora da página de detalhe do paciente. Implementação trivial — pode ir junto sem custo.

**Independent Test**: Abrir `/operacao/pacientes/[id]` de um paciente com telefone `(11) 98765-4321`. Verificar que o botão verde "WhatsApp" está visível ao lado dos dados de contato. Clicar e confirmar que abre nova aba com URL `https://wa.me/5511987654321`. Repetir com paciente sem telefone — o botão deve estar desabilitado e exibir tooltip "Sem telefone cadastrado".

**Acceptance Scenarios**:

1. **Given** estou na ficha de um paciente com telefone `(11) 98765-4321`, **When** clico no botão verde "WhatsApp", **Then** uma nova aba abre em `https://wa.me/5511987654321` (telefone limpo de espaços, parênteses e hifens, prefixado com `55`).
2. **Given** o paciente não possui telefone cadastrado, **When** vejo a ficha, **Then** o botão "WhatsApp" aparece desabilitado/cinza com tooltip "Sem telefone cadastrado", e clicar nele não tem efeito.
3. **Given** o paciente tem telefone cadastrado já com prefixo `+55`, **When** clico no botão, **Then** o sistema abre `https://wa.me/55...` sem duplicar o `55`.

---

### Edge Cases

- **Materiais — typeahead sem resultado**: usuário digita um termo que não existe na TUSS tabela 19. O componente exibe "Nenhum material encontrado" e não permite criar item livre.
- **Materiais — quantidade inválida**: usuário tenta digitar 0, número negativo ou caractere não numérico. O sistema impede o salvamento, mostrando "Quantidade deve ser um número inteiro maior que zero".
- **Materiais — duplicado**: usuário adiciona o mesmo código TUSS duas vezes na mesma lista. Default: aceitar duas linhas separadas (caso de uso real: dois lotes diferentes do mesmo material). Consolidação somando quantidades NÃO ocorre — preserva a intenção do usuário.
- **Materiais — atendimento já salvo**: materiais são append-only no banco. Pela UI, **não é possível adicionar nem remover materiais após o atendimento estar salvo** (escopo desta feature). Edição pós-salvamento fica fora do escopo.
- **Materiais em etapa de plano**: a etapa só vira `appointment_id` quando finalizada. Os materiais escolhidos durante a finalização da etapa devem ser persistidos atomicamente com o atendimento gerado — se o atendimento falhar ao ser criado, nenhum material persiste.
- **WhatsApp — telefone fixo**: paciente cadastrou um número fixo (sem 9). O sistema **não tenta validar se o número é móvel**; abre `wa.me/55<número>` e deixa o WhatsApp lidar com o resultado.
- **WhatsApp — número internacional**: paciente cadastrou número com DDI diferente de `+55`. Como o sistema é primariamente Brasil, o comportamento padrão é prefixar `55`. **Suposição**: se o número já começar com `+`, o sistema usa o número como veio (sem adicionar `55`).
- **Linguagem — pluralização e gênero**: substituição de "Estornado" → "Cancelado" deve respeitar gênero/plural do contexto ("Atendimento cancelado", "Etapa cancelada", "Atendimentos cancelados"). Cada ocorrência deve ser revisada individualmente, não com substituição cega.
- **Linguagem — termos em logs/audit**: apesar de a UI usar "cancelado", o `event_type` do `audit_log` continua `appointment.reversed` e a tabela continua `appointment_reversals`. Apenas strings visíveis ao usuário mudam.
- **Linguagem — mensagens de erro contextuais**: alguns erros precisam de mensagem específica (ex.: "Procedimento não encontrado"). A regra "Algo deu errado. Tente novamente em alguns segundos." vale para erros genéricos não classificados — não para erros de validação que já têm texto próprio.
- **Linguagem — termos em emails/PDFs**: a regra também se aplica a textos de PDFs gerados (prontuário, comprovante) e emails enviados ao usuário, não apenas à UI web.

## Requirements *(mandatory)*

### Functional Requirements

#### Materiais utilizados (Feature 1)

- **FR-001**: O formulário de criação de atendimento manual e o formulário de finalização de etapa de plano de tratamento DEVEM apresentar uma seção "Materiais utilizados (opcional)" colapsada por padrão, posicionada abaixo da seleção de procedimento.
- **FR-002**: Ao expandir a seção, o usuário DEVE poder clicar em "+ Adicionar material" para abrir um campo de busca tipo typeahead que consulta apenas a TUSS tabela 19 (Materiais).
- **FR-003**: Cada material adicionado DEVE conter três informações visíveis: código TUSS, descrição oficial, e quantidade (campo numérico inteiro com default 1).
- **FR-004**: O usuário DEVE poder adicionar múltiplos materiais à lista local antes de salvar, e DEVE poder remover qualquer item da lista clicando em um botão "X" ao lado da linha.
- **FR-005**: O sistema DEVE permitir salvar o atendimento sem nenhum material — a seção é completamente opcional.
- **FR-006**: O sistema DEVE rejeitar salvamento se algum material da lista tiver quantidade ≤ 0, não inteira ou não numérica, exibindo "Quantidade deve ser um número inteiro maior que zero" próximo ao campo problemático.
- **FR-007**: O sistema DEVE persistir cada material em uma nova tabela `appointment_materials` contendo: `id` (PK), `tenant_id` (FK), `appointment_id` (FK), `tuss_code`, `tuss_description`, `quantity` (default 1), `created_by` (FK), `created_at`. A inserção deve ser atômica com o salvamento do atendimento (transação única).
- **FR-008**: A tabela `appointment_materials` DEVE ter RLS por `tenant_id` (isolamento entre clínicas) e ser append-only — não permitir UPDATE nem DELETE via API regular.
- **FR-009**: Toda inserção em `appointment_materials` DEVE gerar entrada no `audit_log` com tipo de evento apropriado.
- **FR-010**: A visualização do atendimento (timeline do paciente, modal de detalhe, painel da agenda) DEVE listar os materiais quando existirem, com código + descrição + quantidade. Quando não houver materiais, a sub-seção não DEVE ser renderizada (sem rótulo vazio).
- **FR-011**: O PDF de prontuário do paciente DEVE incluir os materiais utilizados em cada atendimento (se houver), com código + descrição + quantidade.
- **FR-012**: O sistema DEVE expor endpoints `POST /api/atendimentos/[id]/materiais` (anexar materiais a um atendimento existente em fluxos especiais — ex.: aceitar payload original) e `GET /api/atendimentos/[id]/materiais` (listar materiais de um atendimento).
- **FR-013**: O endpoint `POST /api/atendimentos/manual` DEVE aceitar um campo opcional `materiais` (array) no payload e persistir os itens junto ao atendimento na mesma transação.
- **FR-014**: A entrada de materiais DEVE estar disponível tanto para usuários com papel de profissional quanto admin; recepcionistas seguem a mesma permissão que já têm para criar atendimentos manuais.

#### Atalho WhatsApp (Feature 2)

- **FR-015**: A página `/operacao/pacientes/[id]` DEVE exibir um botão verde rotulado "WhatsApp" ao lado dos dados de contato do paciente.
- **FR-016**: Ao clicar no botão (paciente com telefone), o sistema DEVE abrir uma nova aba com URL `https://wa.me/55<telefone_limpo>`, onde `telefone_limpo` é o telefone do paciente com espaços, parênteses, hifens e ponto removidos.
- **FR-017**: Se o telefone do paciente já começar com `+`, o sistema DEVE usar o número como veio (apenas removendo símbolos não numéricos), sem adicionar prefixo `55`.
- **FR-018**: Se o paciente não possuir telefone cadastrado, o botão DEVE aparecer desabilitado, com tooltip "Sem telefone cadastrado", e o clique não DEVE ter efeito.
- **FR-019**: A funcionalidade de WhatsApp DEVE ser puramente UI — sem chamadas de backend, sem persistência, sem audit log.

#### Linguagem simplificada (Feature 3)

- **FR-020**: Toda string visível ao usuário (rótulos de botões, badges, títulos de página, mensagens de toast, mensagens de erro, tooltips, placeholders, labels de formulário, textos em PDFs e emails) DEVE estar em português claro, sem termos técnicos da lista de proibidos abaixo.
- **FR-021**: As substituições obrigatórias são:
  - "Reverter atendimento" → "Cancelar atendimento"
  - "Estornar" / "Estornado" / "Estorno" → "Cancelar" / "Cancelado" / "Cancelamento" (respeitando gênero e plural)
  - "Reversão" → "Cancelamento"
  - "Revertido" → "Cancelado"
  - "Marcar como realizado" → "Confirmar atendimento" (ou "Atendimento realizado", a decidir caso a caso)
  - "Concluir etapa" → "Finalizar etapa"
  - "NKDA" → "Sem alergias conhecidas" (mantendo "NKDA" apenas como tooltip/legenda secundária)
  - "DLQ" / "Dead Letter Queue" → "Pendências" (ou "Fila de reprocessamento" para títulos de tela mais formais)
  - "Fila de erros" → "Pendências"
  - "Erro inesperado" → "Algo deu errado. Tente novamente em alguns segundos."
- **FR-022**: Os seguintes termos NUNCA DEVEM aparecer em qualquer texto visível ao usuário final: "Soft delete", "Append-only", "Tenant", "Webhook", "RPC", "API" (em mensagens de erro), "Schema cache", "digest: <hash>".
- **FR-023**: Onde antes era usado "Tenant", o termo visível DEVE ser "Clínica".
- **FR-024**: Mensagens de erro genéricas exibidas ao usuário NÃO DEVEM incluir o `digest` técnico. O `digest` permanece nos logs de servidor (Pino) e em `audit_log` para diagnóstico.
- **FR-025**: Esquemas de banco, nomes de tabela (ex.: `appointment_reversals`), `event_type` do audit_log, código fonte e documentação técnica NÃO DEVEM ser alterados — a regra de linguagem aplica-se exclusivamente à camada de apresentação ao usuário.
- **FR-026**: Logs de servidor, telemetria interna e mensagens enviadas para Sentry/Pino PODEM continuar usando termos técnicos (são consumidos por desenvolvedores).
- **FR-027**: A revisão DEVE cobrir todos os domínios da aplicação, incluindo: páginas dashboard, página de erro global (`error.tsx` / `not-found.tsx`), páginas de configurações, telas de integrações, modais, toasts, validações Zod com mensagens visíveis, alertas em sidebar, badges de status.

### Key Entities *(include if feature involves data)*

- **AppointmentMaterial**: representa um insumo/material utilizado em um atendimento clínico. Atributos: identificador único, vínculo com clínica (`tenant_id`), vínculo com atendimento (`appointment_id`), código TUSS (tabela 19), descrição congelada no momento da inserção (para preservar histórico mesmo se o catálogo TUSS mudar), quantidade inteira positiva, autor da inserção (`created_by`), momento da inserção. Relação 1:N com `appointments`. Imutável após criação.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Em 100% das criações de atendimento que incluem materiais, todos os itens são persistidos atomicamente com o atendimento — não há cenário em que o atendimento seja salvo e os materiais se percam (ou vice-versa).
- **SC-002**: Em 100% das visualizações de atendimentos sem materiais, a sub-seção "Materiais utilizados" não aparece — usuários não veem rótulos vazios ou listas vazias.
- **SC-003**: Em uma busca em todo o código de UI por strings literais ("estorno", "reverter", "tenant", "webhook", "DLQ", "soft delete", "append-only", "schema cache", "digest:", "RPC"), nenhuma ocorrência aparece em arquivos que renderizam para o usuário final (componentes React, mensagens Zod com `message`, error pages, PDFs, templates de email).
- **SC-004**: 100% dos pacientes com telefone cadastrado têm o botão WhatsApp funcional na ficha; 100% dos pacientes sem telefone veem o botão desabilitado com tooltip explicativo.
- **SC-005**: O tempo necessário para iniciar uma conversa com paciente no WhatsApp cai de "copiar telefone + abrir WhatsApp Web + colar" (estimado em 15-20 segundos) para um único clique (≤ 2 segundos).
- **SC-006**: Tickets de suporte que mencionem termos técnicos confusos ("o que é estornar?", "o que é tenant?", "apareceu um digest na tela") caem para zero nos 30 dias seguintes ao deploy.
- **SC-007**: O PDF de prontuário, quando o paciente teve atendimentos com materiais registrados, lista esses materiais em uma seção dedicada por atendimento — verificável visualmente.
- **SC-008**: A tabela `appointment_materials` respeita RLS — um usuário da clínica A não consegue, por nenhum endpoint, obter materiais de atendimentos da clínica B.

## Assumptions

- O catálogo TUSS tabela 19 (Materiais) já está disponível em `tuss_codes` (a feature 004 introduziu o catálogo e a versão; tabela 19 já consta no catálogo importado, ou será importada como pré-requisito desta feature — a confirmar no `/speckit.plan`).
- Materiais são append-only por design (sem edição/exclusão pela UI mesmo para admin nesta feature). Edição pós-salvamento, se necessária no futuro, será uma feature separada.
- Materiais duplicados na mesma lista (mesmo código TUSS adicionado duas vezes) são aceitos como duas linhas distintas, preservando intenção do usuário (ex.: lotes diferentes).
- Pacientes com telefone começando em `+` (DDI internacional explícito) usam o número como está; só pacientes sem `+` recebem prefixo `55`.
- O botão WhatsApp não tenta validar se o número é móvel ou fixo — delega ao WhatsApp lidar com erros do destino.
- A revisão de linguagem aplica-se à camada de apresentação ao usuário (componentes React renderizados para o usuário, mensagens de erro exibidas, PDFs gerados, emails enviados), mas NÃO altera nomes de tabelas (`appointment_reversals` permanece), `event_type` de audit_log (`appointment.reversed` permanece), código fonte, comentários internos, ou documentação técnica em `/specs` e CLAUDE.md.
- "API" e "RPC" continuam permitidos em contextos onde o público-alvo é desenvolvedor (página de documentação de integrações para admin técnico, exemplos de payload, etc.) — proibidos apenas em mensagens de erro mostradas ao usuário não técnico.
- O sistema mantém o termo "atendimento" (não "consulta", não "sessão") como entidade principal — alinhado ao vocabulário já estabelecido no projeto.
- A feature 006 (comprovantes particular) já introduziu o conceito de "Particular" como badge — esta feature não muda esse padrão.
- A funcionalidade WhatsApp não envia mensagem pré-preenchida (nem `?text=...` na URL) nesta versão — apenas abre a conversa.
- A revisão de linguagem é executada em conjunto com a entrega das outras duas features no mesmo PR, pois o impacto cruza múltiplos arquivos e gera ruído de revisão se feita isolada.
