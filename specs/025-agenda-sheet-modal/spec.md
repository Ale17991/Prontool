# Feature Specification: Detalhe do Atendimento como Painel Lateral na Agenda

**Feature Branch**: `025-agenda-sheet-modal`
**Created**: 2026-05-25
**Status**: Draft
**Input**: User description: "Detalhe do atendimento como Sheet lateral (modal) na agenda."

## Clarifications

### Session 2026-05-25

- Q: Quais operações ficam disponíveis dentro do painel — apenas ações de status (confirmar, cancelar, estornar) ou também edição de campos do atendimento? → A: Apenas ações de status já existentes. Edição de campos (observações, procedimentos, horário, profissional) fica exclusivamente na página standalone acessada via URL direta.
- Q: Após uma ação bem-sucedida no painel, o painel fecha automaticamente ou permanece aberto? → A: Permanece aberto e refresca o conteúdo com o novo estado. Agenda subjacente atualiza em paralelo. Usuário fecha manualmente quando quiser.
- Q: Ao clicar em outro atendimento com formulário sujo (ex: motivo de cancelamento digitado), descartar silenciosamente ou pedir confirmação? → A: Pedir confirmação, mesmo guard do ESC. Qualquer ação que descarte dados não-salvos passa pelo mesmo prompt.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Ver detalhe do atendimento sem perder o contexto da agenda (Priority: P1)

A recepcionista está olhando a agenda do dia (visualização em lista ou calendário). Para verificar o paciente do próximo atendimento, ela clica na linha/bloco do agendamento. Em vez de carregar uma nova página e perder o scroll/filtros da agenda, abre um painel lateral à direita com todos os dados do atendimento (paciente, profissional, procedimentos, plano, observações, alergias do paciente, status atual). Quando termina de ver, fecha o painel e continua exatamente de onde estava.

**Why this priority**: É a única razão de existir da feature. Sem isso, qualquer "abrir detalhe" da agenda exige reload da página inteira e perde o estado (scroll, filtro de profissional, filtro de período, view atual). Recepção e médicos fazem essa transição dezenas de vezes por dia.

**Independent Test**: Pode ser testado abrindo /operacao/atendimentos, filtrando por profissional/dia, clicando em um atendimento e verificando que (a) o painel aparece com os dados corretos, (b) ao fechar, os filtros e scroll continuam aplicados.

**Acceptance Scenarios**:

1. **Given** estou na lista de atendimentos com filtro aplicado, **When** clico em um atendimento, **Then** o painel lateral abre com os dados completos do atendimento e a lista permanece visível por baixo com filtros preservados.
2. **Given** o painel lateral está aberto, **When** fecho com X, ESC ou clique fora, **Then** o painel desaparece e o scroll/filtros da agenda permanecem inalterados.
3. **Given** estou no calendário semanal, **When** clico num bloco de atendimento, **Then** o painel lateral abre com os mesmos dados que abriria na lista.
4. **Given** o painel acabou de abrir, **When** os dados ainda não chegaram, **Then** vejo um indicador de carregamento dentro do painel (não em tela cheia).

---

### User Story 2 - Confirmar, cancelar ou estornar do próprio painel (Priority: P1)

Durante a recepção do paciente, a recepcionista quer marcar a presença ou registrar um no-show sem ter que abrir uma página separada. Do mesmo painel onde viu o detalhe, ela executa a ação (confirmar agendamento, confirmar presença, cancelar, estornar) e vê o resultado imediato no próprio painel + a agenda por baixo se atualiza para refletir o novo status.

**Why this priority**: A ação imediata é o que torna a feature valiosa para o dia-a-dia. Apenas "ver" sem agir economiza menos tempo. Confirmar 20 atendimentos numa manhã com 1 clique-painel-ação-fecha (vs. clique-nova-página-ação-voltar) reduz significativamente a fricção.

**Independent Test**: Abrir o painel de um atendimento agendado, clicar "Confirmar agendamento", verificar que o painel mostra o novo status sem fechar/recarregar, e que o atendimento na agenda por baixo aparece com o novo status (cor/badge atualizado).

**Acceptance Scenarios**:

1. **Given** o painel mostra um atendimento "agendado", **When** clico em "Confirmar agendamento", **Then** o status no painel muda para "confirmado" e o item correspondente na agenda também reflete a mudança.
2. **Given** o painel mostra um atendimento "ativo" e tenho permissão, **When** executo "Cancelar atendimento" com motivo, **Then** o painel mostra "cancelado/estornado" e a agenda atualiza.
3. **Given** uma ação falha (erro de rede ou validação do servidor), **When** recebo o erro, **Then** vejo a mensagem dentro do painel e o estado anterior é preservado.
4. **Given** acabei uma ação com sucesso, **When** fecho o painel, **Then** a agenda já está com o status correto sem precisar de F5.

---

### User Story 3 - Acesso direto via URL standalone (Priority: P2)

Um membro do time recebe um link `/operacao/atendimentos/<uuid>` por notificação, e-mail ou compartilhamento. Ao abrir no navegador (sem passar pela agenda), vê o detalhe do atendimento numa página dedicada de tela cheia. Refresh nessa URL não quebra. Esse caminho permanece funcional mesmo com a feature do painel implementada.

**Why this priority**: Deep-link já é usado hoje. Quebrar isso seria regressão. A página cheia também serve como fallback acessível e permite imprimir/abrir em outra aba.

**Independent Test**: Colar uma URL `/operacao/atendimentos/<uuid>` direto no navegador (sem passar pela lista) → vê a página cheia tradicional, com botão "Voltar" para a lista.

**Acceptance Scenarios**:

1. **Given** tenho uma URL de atendimento específico, **When** abro direto no navegador, **Then** vejo a página cheia tradicional com todos os dados.
2. **Given** estou na página cheia, **When** faço refresh (F5), **Then** os dados continuam aparecendo (sem erro).

---

### Edge Cases

- **Atendimento removido / inexistente**: ao tentar abrir um painel para um ID que não existe mais (ex: foi cancelado por outro user), o painel mostra uma mensagem clara (ex: "Atendimento não encontrado") em vez de exibir página em branco ou travar.
- **Sem permissão para a ação**: usuário sem permissão para cancelar/estornar vê os botões dessas ações desabilitados ou ocultos; tentar via algum atalho retorna erro tratado no painel.
- **Erro de rede no carregamento dos dados**: painel mostra mensagem de erro com botão "Tentar novamente"; não fica em loading infinito.
- **Ação pendente quando user tenta fechar/trocar**: se uma ação (confirmar, cancelar, estornar) está em andamento, o painel pede confirmação ("Ação em andamento. Cancelar mesmo assim?") antes de fechar ou trocar de atendimento. Mesmo guard se aplica a ESC, X, click-outside e clique em outro atendimento.
- **Atendimento alterado em outra aba/sessão**: ao abrir o painel, os dados refletem o estado atual do servidor (não cache stale do que estava na agenda).
- **Cliques rápidos em diferentes atendimentos**: trocar de um atendimento pra outro descarta o request anterior — o painel sempre mostra o último selecionado. Se houver formulário com dados não-salvos no painel atual, sistema pede confirmação antes de descartar (mesmo guard usado pelo ESC).
- **Viewport mobile**: o painel ocupa a tela inteira (não fica espremido em 500px num celular).
- **Fechar/trocar com formulário preenchido**: se há campos modificados (ex: motivo de cancelamento digitado), confirmar com o usuário antes de descartar. Vale para ESC, clique no X, clique fora do painel, e clique em outro atendimento.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Sistema MUST abrir o detalhe do atendimento como painel lateral sobreposto à agenda quando o usuário clicar em um atendimento na lista ou no calendário.
- **FR-002**: O painel MUST mostrar exatamente os mesmos dados que a página standalone do atendimento (paciente, profissional, procedimentos com valores, plano, observações, alergias do paciente, materiais, status atual, dados financeiros).
- **FR-003**: O painel MUST ocupar a lateral direita em viewports de desktop e tela inteira em viewports mobile, com largura confortável para leitura sem rolagem horizontal.
- **FR-004**: Usuário com permissão MUST poder executar as ações de mudança de status disponíveis para o estado atual (confirmar agendamento, confirmar presença, cancelar atendimento, estornar) sem sair do painel. Edição de campos do atendimento (observações, procedimentos, horário, profissional) está fora do escopo do painel — só acontece na página standalone.
- **FR-005**: Após qualquer ação bem-sucedida, o painel MUST permanecer aberto exibindo o novo estado e a agenda subjacente MUST atualizar para mostrar o status novo (sem requerer reload manual da página, sem fechamento automático do painel). O usuário fecha o painel manualmente quando terminar.
- **FR-006**: Sistema MUST permitir fechar o painel via X, tecla ESC ou clique fora da área do painel; ao fechar, scroll e filtros da agenda MUST permanecer exatamente como estavam antes da abertura.
- **FR-007**: A URL standalone do detalhe `/operacao/atendimentos/<id>` MUST continuar funcionando para acesso direto (refresh, link colado, notificação), exibindo a página cheia tradicional.
- **FR-008**: O painel MUST mostrar indicador de carregamento enquanto os dados são buscados, sem deixar a interface congelada.
- **FR-009**: Em caso de erro de rede ou servidor ao carregar os dados, painel MUST mostrar a mensagem de erro com opção de tentar novamente.
- **FR-010**: Erros de ação (ex: cancelar falhou por validação) MUST ser exibidos dentro do painel sem fechá-lo nem perder o contexto.
- **FR-011**: Ao clicar em atendimento diferente com painel já aberto, sistema MUST trocar o conteúdo para o novo atendimento (descartando carregamento anterior, se ainda pendente).
- **FR-012**: Painel MUST respeitar as permissões existentes (admin, recepcionista, profissional_saude, financeiro) — usuários sem permissão para uma ação não veem nem podem invocar o botão correspondente.
- **FR-013**: A URL exibida no navegador NÃO precisa mudar ao abrir/fechar o painel (sem deep-link sincronizado com estado do painel).

### Key Entities

- **Atendimento (existente)**: registro de consulta/procedimento já agendado/realizado. Sem mudanças no modelo — feature só consome e age sobre dados existentes.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Em 95% dos cliques, o painel aparece visível com indicador de carregamento em menos de 300ms a partir do clique.
- **SC-002**: 95% dos atendimentos completam o carregamento dos dados no painel em menos de 2 segundos.
- **SC-003**: Após confirmar/cancelar/estornar pelo painel, o status correspondente na agenda subjacente fica atualizado em menos de 2 segundos sem ação manual do usuário.
- **SC-004**: Usuário consegue processar 10 atendimentos consecutivos (abrir, executar ação, fechar, abrir o próximo) sem precisar recarregar a página manualmente.
- **SC-005**: Recepcionista relata redução perceptível no tempo total para conferir e marcar presença de uma manhã típica (medido em entrevista qualitativa após 2 semanas de uso).
- **SC-006**: Zero novas ocorrências de "Application error" no painel após o rollout (medido nos logs de runtime).
- **SC-007**: Zero quebras nas rotas literais irmãs da agenda (`/novo`, `/bloquear`, `/calendar`) por interferência do painel.

## Assumptions

- Comportamento descrito vale para AMBAS as visualizações da agenda (lista e calendário) — clique em qualquer uma delas abre o mesmo painel.
- Painel apresenta o MESMO conteúdo da página standalone, sem variantes simplificadas — usuário não perde informação alguma escolhendo o painel.
- Permissões de visualização e ação reusam o sistema atual de roles (admin, recepcionista, profissional_saude, financeiro); nenhuma nova role é introduzida.
- Mobile = viewport menor que 768px (breakpoint padrão `md` do design system).
- Reload completo da agenda subjacente após uma ação no painel é aceitável para a v1 (otimizações de atualização parcial podem vir depois).
- Não há nova tabela, coluna ou função SQL necessária — toda a feature é UI/orquestração consumindo APIs existentes.
- A página standalone `/operacao/atendimentos/<id>` mantém o mesmo carregamento server-side atual (sem refactor de data-loading).
- A feature NÃO usará intercepting routes / parallel routes do Next.js — restrição derivada de incidente em produção (commit revertido `f1c08c4`) onde a abordagem `@modal/(.)[id]` interceptava rotas literais irmãs e o componente compartilhado bundled em chunk era rejeitado pelo guard de service-role. O painel será controlado puramente por estado React na agenda.
- A feature NÃO chamará `createSupabaseServiceClient()` fora de page.tsx ou route.ts — restrição derivada do mesmo incidente. Dados são obtidos via GET `/api/atendimentos/<id>` (e endpoints relacionados) consumidos do client.
- Antes do deploy, a feature MUST ser validada localmente via `pnpm dev` simulando os fluxos críticos (abrir painel, executar ação, navegar para /novo e /bloquear) para evitar reintrodução dos bugs históricos.
