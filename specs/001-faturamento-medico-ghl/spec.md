# Feature Specification: Faturamento Médico Integrado ao GHL/Homio

**Feature Branch**: `001-faturamento-medico-ghl`
**Created**: 2026-04-16
**Status**: Draft
**Input**: User description: "Construir um sistema de faturamento para clínicas e consultórios médicos integrado ao GoHighLevel via Homio. O sistema deve: (1) armazenar procedimentos usando código TUSS oficial com valores diferenciados por plano de saúde — o mesmo procedimento pode ter valores distintos para Unimed, Bradesco, Amil, particular, etc; (2) registrar médicos com percentual de comissão individual cadastrado previamente; (3) receber atendimentos via webhook do GHL quando um contato move de etapa no pipeline, capturando automaticamente o plano de saúde, procedimento e médico responsável dos custom fields do contato; (4) calcular o valor do atendimento automaticamente consultando a tabela de preços vigente para aquela combinação procedimento + plano; (5) permitir que administradores da clínica alterem valores da tabela de preços a qualquer momento com vigência a partir de uma data definida, sem afetar registros históricos; (6) manter log imutável de todas as alterações de preço com quem alterou, quando, valor anterior e novo; (7) gerar relatório mensal por clínica com receita por plano de saúde, produção por médico e comissão calculada automaticamente, exportável em PDF e Excel."

## Clarifications

### Session 2026-04-16

- Q: Como representar cancelamento/estorno de um atendimento? → A: Híbrido — registro de reversão append-only + view derivada expondo "status efetivo" calculado em tempo de consulta.
- Q: Quais dados do paciente são replicados localmente no faturamento? → A: `contact_id` GHL + nome + CPF + telefone + e-mail + data de nascimento (conjunto completo para autonomia operacional do GHL); persistência sujeita a criptografia em repouso e tratamento LGPD.
- Q: Modelo de processamento do webhook GHL — síncrono ou assíncrono? → A: Híbrido — log de eventos brutos persistido síncrono (responde 200 rápido ao GHL após gravação durável), processamento semântico assíncrono, com dead-letter queue (DLQ) para eventos que falham por regra de negócio.
- Q: Resolução de conflito quando dois admins editam o mesmo preço simultaneamente? → A: Concorrência otimista — formulário carrega token de versão; submissão com token obsoleto é rejeitada com mensagem clara pedindo recarga e revisão antes de retentar.
- Q: Canal de entrega dos alertas operacionais ao admin da clínica? → A: E-mail para todos os admins do tenant + dashboard in-app consolidado. WhatsApp/SMS e canais pluggáveis ficam fora de escopo para v1.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Atendimento faturado automaticamente via webhook GHL (Priority: P1)

A clínica já usa o GoHighLevel para gerenciar contatos em um pipeline. Quando o
contato do paciente avança para a etapa de "atendimento realizado", o GHL dispara
um webhook para o sistema de faturamento. O sistema identifica a clínica,
extrai dos custom fields do contato o plano de saúde, o código TUSS do
procedimento e o médico responsável, consulta a tabela de preços vigente para a
combinação (procedimento + plano) naquela data, persiste o atendimento com o
valor calculado congelado e o percentual de comissão do médico naquele momento.
A recepção e a administração veem o atendimento aparecer automaticamente na
lista de atendimentos do dia, sem nenhuma digitação manual.

**Why this priority**: É o núcleo da proposta de valor — automação ponta-a-ponta
entre o CRM operacional da clínica (GHL) e o faturamento. Sem este fluxo, o
sistema é apenas uma planilha de preços. A primeira release deve demonstrar que
o atendimento entra sozinho, com valor correto, auditável e imutável.

**Independent Test**: Com uma clínica seed contendo um procedimento TUSS
cadastrado, um plano "Unimed" com preço R$ 250,00 vigente, e um médico com
comissão 40%, disparar uma chamada de webhook simulando o evento "contato
movido para a etapa de faturamento" com os custom fields preenchidos. Verificar
que (a) um atendimento é criado vinculado à clínica correta, (b) o valor
persistido é R$ 250,00, (c) o percentual de comissão do médico é capturado como
40% no registro do atendimento, (d) uma tentativa posterior de reprocessar o
mesmo evento não gera atendimento duplicado.

**Acceptance Scenarios**:

1. **Given** clínica A com procedimento TUSS 10101012 e preço Unimed R$ 250,00
   vigente desde 2026-01-01, e médico Dr. Silva com comissão 40%, **When** o GHL
   envia webhook com plano="Unimed", procedimento="10101012", médico="Dr.
   Silva", **Then** o sistema cria um atendimento da clínica A com valor R$
   250,00 e comissão snapshot 40%.
2. **Given** mesmo atendimento já processado (mesmo GHL event ID), **When** o
   GHL reenvia o webhook (retry), **Then** o sistema reconhece o evento duplicado
   e não cria novo atendimento.
3. **Given** webhook chega sem o custom field de plano de saúde preenchido,
   **When** o sistema tenta processar, **Then** o evento é rejeitado, nenhum
   atendimento parcial é persistido, e um alerta operacional é gerado para a
   clínica com detalhes suficientes para o operador corrigir o contato no GHL.
4. **Given** webhook chega com código TUSS inexistente ou obsoleto, **When** o
   sistema valida, **Then** o evento é rejeitado com mensagem explícita
   indicando o código inválido.
5. **Given** webhook chega para uma combinação (procedimento + plano) sem preço
   vigente cadastrado, **When** o sistema busca o preço, **Then** o evento é
   rejeitado e o operador é alertado para cadastrar a combinação antes de
   reenviar.

---

### User Story 2 - Gestão de tabela de preços com vigência futura e histórico imutável (Priority: P2)

O administrador da clínica acessa a tabela de preços, seleciona um procedimento
e um plano de saúde, e define um novo valor com data de vigência futura (por
exemplo, "a partir de 2026-05-01"). O sistema cria uma nova versão do preço,
encerra a versão anterior na véspera da nova vigência, e registra na trilha de
auditoria quem fez a alteração, quando, valor anterior, valor novo e motivo
informado. Atendimentos já registrados continuam com seus valores congelados —
não são reprocessados.

**Why this priority**: Alterar preços é operação rotineira (renegociação anual
de convênios, reajustes). Precisa ser autoatendimento com segurança e
rastreabilidade total, mas não bloqueia a demonstração do MVP do US1 (preços
podem ser carregados via seed inicial).

**Independent Test**: Como admin de uma clínica seed, alterar o preço Unimed de
um procedimento de R$ 250,00 para R$ 280,00 com vigência 2026-05-01. Verificar
que (a) um atendimento registrado em 2026-04-30 mantém seu valor R$ 250,00,
(b) a tabela de preços mostra a versão ativa mudando em 2026-05-01, (c) a
trilha de auditoria contém uma entrada com admin@clinica.com.br, timestamp,
valor anterior R$ 250,00, valor novo R$ 280,00 e motivo informado.

**Acceptance Scenarios**:

1. **Given** preço atual Unimed/TUSS-X = R$ 250,00 vigente desde 2026-01-01,
   **When** admin define novo valor R$ 280,00 com vigência 2026-05-01 e motivo
   "reajuste anual Unimed", **Then** o sistema cria nova versão com valid_from
   2026-05-01, encerra a anterior em 2026-04-30, e registra entrada de
   auditoria com todos os campos obrigatórios.
2. **Given** nova versão de preço criada, **When** consulto atendimentos
   históricos anteriores a 2026-05-01, **Then** seus valores permanecem
   inalterados.
3. **Given** usuário com perfil "recepcionista" tenta alterar a tabela de
   preços, **When** submete a alteração, **Then** a requisição é negada no
   servidor e registrada na trilha de auditoria como tentativa de acesso não
   autorizada.
4. **Given** admin tenta deletar um preço histórico, **When** submete a ação,
   **Then** a operação é bloqueada; apenas "encerrar vigência" é possível.

---

### User Story 3 - Cadastro de médicos e percentual de comissão (Priority: P2)

O administrador da clínica cadastra os médicos que atendem, informando nome,
identificador profissional (CRM), e o percentual de comissão que cada médico
recebe sobre o valor dos procedimentos que realiza. O percentual é individual
— Dr. Silva pode receber 40%, Dra. Souza pode receber 50%. Alterações no
percentual passam a valer para atendimentos futuros; atendimentos já
registrados mantêm o percentual que estava vigente no momento do registro.

**Why this priority**: Necessário para que o US4 (relatório) produza valores
de comissão corretos. Pode ser preparado em paralelo com US1 durante a fase
fundacional.

**Independent Test**: Admin cadastra Dr. Silva com CRM 12345-SP e comissão
40%. Depois altera para 45%. Verificar que (a) o cadastro é recuperável com os
dados corretos, (b) atendimentos antes da alteração preservam a comissão
snapshot 40%, (c) atendimentos posteriores usam 45%.

**Acceptance Scenarios**:

1. **Given** cadastro vazio, **When** admin cadastra Dr. Silva com CRM e
   comissão 40%, **Then** o médico aparece na lista e pode ser referenciado em
   atendimentos.
2. **Given** Dr. Silva cadastrado com 40%, **When** admin altera para 45%,
   **Then** a alteração é registrada na trilha de auditoria e atendimentos
   antigos mantêm snapshot de 40%.
3. **Given** usuário com perfil "recepcionista", **When** tenta alterar o
   percentual, **Then** a requisição é negada.

---

### User Story 4 - Relatório mensal financeiro exportável em PDF e Excel (Priority: P3)

Ao final de cada mês (ou sob demanda), o administrador da clínica gera um
relatório cobrindo um período selecionado (padrão: mês calendário). O
relatório apresenta, por plano de saúde, a receita total gerada no período;
por médico, a produção total (soma dos valores de atendimentos realizados) e a
comissão calculada automaticamente usando o percentual snapshot gravado em
cada atendimento. O relatório é visualizado na tela e pode ser exportado em
PDF (para impressão/arquivo) e Excel (para manipulação contábil), ambos
contendo exatamente os mesmos totais.

**Why this priority**: Entrega valor visível para sócios/financeiro. Depende
de US1/US2/US3 estarem alimentando dados corretos.

**Independent Test**: Com uma clínica contendo 10 atendimentos distribuídos em
dois planos e dois médicos ao longo de março/2026, gerar o relatório do
período. Verificar que (a) receita por plano soma corretamente, (b) produção
por médico soma corretamente, (c) comissão é calculada usando o percentual
snapshot de cada atendimento, (d) exportações PDF e Excel trazem os mesmos
totais.

**Acceptance Scenarios**:

1. **Given** 5 atendimentos Unimed totalizando R$ 1.250,00 e 5 atendimentos
   Bradesco totalizando R$ 1.400,00 em março/2026, **When** admin gera
   relatório de março/2026, **Then** o relatório mostra Unimed R$ 1.250,00 e
   Bradesco R$ 1.400,00.
2. **Given** Dr. Silva realizou 4 atendimentos somando R$ 1.000,00 com snapshot
   de comissão 40%, **When** o relatório é gerado, **Then** o relatório mostra
   produção R$ 1.000,00 e comissão R$ 400,00 para Dr. Silva.
3. **Given** relatório gerado na tela, **When** admin exporta em PDF e Excel,
   **Then** ambos os arquivos contêm os mesmos totais da tela.
4. **Given** usuário com perfil "recepcionista" tenta acessar o relatório,
   **When** submete a requisição, **Then** o acesso é negado.

---

### Edge Cases

- **Webhook com dados parciais**: evento chega com plano preenchido mas sem
  procedimento → rejeitar inteiro; não persistir atendimento incompleto.
- **TUSS obsoleto**: evento chega referenciando código TUSS que foi
  desativado pela ANS → rejeitar e alertar.
- **Combinação (procedimento + plano) sem preço cadastrado**: rejeitar evento
  e alertar admin para cadastrar antes de reenviar.
- **Alteração de preço retroativa**: tentativa de definir `valid_from` no
  passado → negar ou exigir confirmação explícita do admin com motivo; nunca
  alterar atendimentos já registrados.
- **Reenvio idempotente do webhook**: GHL reenvia o mesmo evento
  (event_id duplicado) → segundo processamento detecta duplicata e não cria
  novo registro.
- **Alteração de percentual de comissão no meio do mês**: atendimentos
  anteriores mantêm snapshot antigo; relatório soma comissões corretamente
  usando o valor snapshot gravado em cada atendimento.
- **Médico desativado**: admin não pode deletar o médico (Principle I —
  append-only); apenas marcar como inativo, preservando atendimentos
  históricos vinculados.
- **Mês sem atendimentos**: relatório exibe totais zerados, não erro.
- **Múltiplas clínicas com mesmos códigos**: isolamento multi-tenant garante
  que atendimento da clínica A nunca apareça no relatório da clínica B.
- **Relatório durante alteração de preço**: como os atendimentos têm valor
  congelado, alterações de preço em curso não afetam relatório.
- **Webhook de clínica não cadastrada**: rejeitar e alertar operador da
  plataforma.
- **Divergência no catálogo TUSS global**: operador da plataforma atualiza
  catálogo TUSS; o sistema alerta clínicas que têm preços cadastrados para
  códigos descontinuados.
- **Edição concorrente de preço por dois admins**: dois admins abrem a
  mesma linha de preço para edição. O primeiro submete e cria nova
  versão. O segundo, ao submeter, recebe rejeição por token de versão
  obsoleto — precisa recarregar, revisar a versão recém-criada pelo
  colega, e retentar conscientemente.
- **Pico de webhooks simultâneos**: muitos eventos chegando ao mesmo tempo
  são aceitos e gravados no log bruto (responde rápido ao GHL); o
  processamento semântico escala conforme capacidade do worker, sem
  estourar o SLA de resposta ao GHL.
- **DLQ — evento reprocessado após correção**: admin corrige o dado
  faltante (cadastra preço, atualiza médico, corrige TUSS no GHL) e aciona
  o reprocessamento do evento na DLQ. O mesmo `event_id` é reaproveitado,
  mantendo idempotência: um atendimento é criado, sem duplicar.
- **Cancelamento/estorno de atendimento**: atendimento criado por engano
  (paciente faltou, webhook disparado indevidamente, procedimento errado) é
  revertido através de um **registro de reversão append-only** que
  referencia o atendimento original; o original permanece intocado. A view
  de "status efetivo" passa a exibir o atendimento como `estornado`, e
  relatórios somam o valor líquido (original − reversão). Deletar fisicamente
  o atendimento original é proibido.

## Requirements _(mandatory)_

### Functional Requirements

#### Cadastros e tabela de preços

- **FR-001**: O sistema MUST permitir que um admin de clínica cadastre
  procedimentos usando código TUSS oficial, com descrição.
- **FR-002**: O sistema MUST permitir que um admin cadastre planos de saúde
  reconhecidos pela clínica (ex.: Unimed, Bradesco, Amil, Particular).
- **FR-003**: O sistema MUST permitir que um admin defina um valor (R$) para
  cada combinação (procedimento, plano de saúde) com data `valid_from`
  obrigatória.
- **FR-004**: Ao alterar um valor, o sistema MUST criar uma nova versão do
  preço (append-only; jamais sobrescrever nem atualizar linha existente) com
  novo `valid_from`. A vigência da versão anterior é **implicitamente
  encerrada na véspera do novo `valid_from`** por cálculo derivado em tempo
  de consulta (ex.: `valid_to = LEAD(valid_from) OVER (...) - INTERVAL '1
day'`), sem mutação física da linha anterior.
- **FR-005**: O sistema MUST exigir um motivo textual obrigatório em toda
  alteração de preço.
- **FR-005a**: O sistema MUST aplicar **concorrência otimista** em edições
  de preço: a tela de edição carrega um token de versão do registro de
  preço; ao submeter a alteração, se o preço tiver sido alterado por outro
  usuário desde a carga (token obsoleto), a submissão MUST ser rejeitada
  com mensagem clara instruindo o admin a recarregar e revisar antes de
  retentar. Nenhuma versão adicional é criada na rejeição.
- **FR-005b**: A tentativa rejeitada por conflito otimista MUST ser
  registrada na trilha de auditoria como evento informativo (ator,
  timestamp, tenant, preço-alvo, motivo="conflito de concorrência"), sem
  campos de valor_anterior/valor_novo, para distinguir de alterações
  efetivas.
- **FR-006**: O sistema MUST permitir que um admin cadastre médicos com nome,
  identificador profissional (CRM) e percentual de comissão individual.
- **FR-007**: Alterações no percentual de comissão do médico MUST valer
  apenas para atendimentos registrados após a alteração; atendimentos
  anteriores MUST preservar o percentual vigente no momento do registro.

#### Integração GHL/Homio e processamento de atendimento

- **FR-008**: O sistema MUST expor um endpoint de webhook seguro (assinado)
  para receber eventos de mudança de etapa do pipeline vindos do GHL.
- **FR-008a**: O endpoint MUST validar a assinatura da requisição e
  persistir o evento bruto (payload + cabeçalhos + tenant identificado)
  em um **log de eventos brutos durável** antes de responder ao GHL.
  Somente após a confirmação da gravação o endpoint retorna `200 OK`.
  Falha na validação de assinatura ou no acesso ao log durável MUST
  retornar `5xx` para que o GHL execute retry.
- **FR-008b**: O **processamento semântico** do evento (extração de custom
  fields, validação TUSS, busca de preço, criação do atendimento) acontece
  **assincronamente** a partir do log de eventos brutos. O tempo de
  resposta ao GHL MUST NOT depender do processamento semântico.
- **FR-008c**: Eventos que falham durante o processamento semântico por
  regra de negócio (TUSS inválido, plano ausente, combinação sem preço,
  médico não cadastrado) MUST ser enviados para uma **dead-letter queue
  (DLQ)** do tenant e gerar alerta operacional direcionado à clínica,
  contendo dados suficientes para diagnóstico. Reprocessamento manual
  (após correção do dado no GHL ou cadastro faltante) MUST ser possível a
  partir da DLQ pelo papel `admin`.
- **FR-008d**: Eventos que falham por erro técnico transitório (indisponibilidade
  momentânea de dependência interna) MUST ser retentados automaticamente
  com backoff; apenas após esgotar as tentativas o evento vai para a DLQ.

#### Alertas operacionais

- **FR-033**: O sistema MUST entregar alertas operacionais por dois canais
  complementares para cada tenant:
  (a) **e-mail** para todos os usuários com papel `admin` do tenant;
  (b) **dashboard in-app de alertas** consolidando as ocorrências abertas
  com filtros por tipo, status e período.
- **FR-034**: Alertas MUST cobrir no mínimo: (i) evento na DLQ aguardando
  correção/reprocessamento; (ii) webhook rejeitado por dados ausentes/
  inválidos; (iii) código TUSS descontinuado ainda cadastrado em tabela de
  preços; (iv) falha de assinatura do webhook (possível problema de
  credencial ou tentativa de acesso não autorizado); (v) tentativa de
  acesso negada pelo RBAC em ação sensível (alteração de preço, acesso à
  auditoria).
- **FR-035**: Cada alerta MUST conter informação suficiente para o admin
  agir: tenant, timestamp, tipo, detalhe do dado faltante/inválido,
  identificador do evento/entidade relacionada, e link direto para a tela
  de resolução no dashboard (DLQ, edição do preço, cadastro do médico,
  etc.).
- **FR-036**: Alertas MUST ter ciclo de vida `aberto` → `resolvido`
  (marcado manualmente pelo admin ou automaticamente quando o problema
  de origem é corrigido, conforme o tipo). Alertas resolvidos permanecem
  consultáveis no histórico; não são excluídos.
- **FR-037**: E-mails de alerta MUST NOT conter dados pessoais de paciente
  em texto claro; referências a atendimento devem usar identificadores
  internos que exigem autenticação para detalhamento via dashboard.
- **FR-038**: Envio de alertas por canais adicionais (WhatsApp, SMS,
  Slack, webhooks de saída) está **fora de escopo de v1**.
- **FR-009**: O sistema MUST identificar a clínica (tenant) do evento por
  meio de credencial/assinatura única por clínica.
- **FR-010**: Ao receber um webhook, o sistema MUST extrair dos custom fields
  do contato GHL: plano de saúde, código TUSS do procedimento, identificador
  do médico responsável, identificador do paciente, e timestamp do
  atendimento.
- **FR-010a**: O sistema MUST replicar localmente os seguintes campos do
  contato GHL vinculado ao atendimento: `contact_id`, nome completo, CPF,
  telefone, e-mail e data de nascimento. Esses campos MUST ser
  criptografados em repouso, MUST NOT aparecer em logs em texto claro, e
  MUST ser acessíveis apenas a usuários autenticados do mesmo tenant com
  papel autorizado a ver dados de paciente.
- **FR-010b**: Se o contato GHL for atualizado (mudança de telefone, e-mail,
  etc.), o sistema MUST aceitar atualização do registro de **Paciente**
  local sem afetar atendimentos históricos (os atendimentos já referenciam
  o mesmo `contact_id`, não os valores replicados).
- **FR-010c**: O sistema MUST aplicar política de retenção LGPD ao registro
  de Paciente: remoção/anonimização é executada apenas por processo
  controlado (operador da plataforma), nunca por usuário comum; atendimentos
  históricos permanecem íntegros referenciando um registro de Paciente
  anonimizado quando aplicável.
- **FR-011**: O sistema MUST calcular o valor do atendimento buscando a
  versão de preço da combinação (tenant, procedimento, plano) ativa na data
  do atendimento.
- **FR-012**: O sistema MUST persistir o atendimento com o valor calculado
  **congelado** e o percentual de comissão do médico **snapshotado** no
  momento da criação.
- **FR-013**: Alterações posteriores na tabela de preços ou no percentual de
  comissão MUST NOT alterar atendimentos já persistidos.
- **FR-014**: O sistema MUST tratar eventos de webhook como idempotentes: a
  entrega repetida do mesmo evento (mesmo ID de evento GHL) MUST NOT gerar
  atendimentos duplicados.
- **FR-015**: Se qualquer campo obrigatório estiver ausente, inválido, ou a
  combinação (procedimento + plano) não tiver preço vigente, o sistema MUST
  rejeitar o evento sem persistir atendimento parcial, e MUST registrar a
  falha com detalhamento suficiente para o operador corrigir.
- **FR-016**: O sistema MUST validar códigos TUSS contra o catálogo TUSS
  oficial vigente e rejeitar novos atendimentos com códigos obsoletos ou
  inexistentes.

#### Auditoria e integridade

- **FR-017**: Toda alteração em tabela de preço, cadastro de médico
  (percentual), cadastro de procedimento, ou tentativa de acesso negada MUST
  produzir uma entrada imutável na trilha de auditoria contendo: ator
  (usuário autenticado), timestamp UTC, tenant, entidade, campo alterado,
  valor anterior, valor novo, motivo, origem da requisição (IP + user-agent).
- **FR-018**: Registros financeiros (atendimentos, versões de preço,
  entradas de auditoria) MUST NOT ser excluíveis fisicamente por nenhum
  usuário da aplicação.
- **FR-019**: O sistema MUST permitir ao admin exportar a trilha de
  auditoria (CSV/JSON) sem transformação que descarte campos.

#### Cancelamento / estorno de atendimento

- **FR-027**: O sistema MUST permitir ao admin registrar a reversão de um
  atendimento através de um **registro de reversão append-only** que
  referencia o atendimento original por chave estrangeira, contém valor
  igual e sinal oposto, e exige motivo textual obrigatório.
- **FR-028**: O sistema MUST NOT alterar nem excluir o atendimento original
  em função do registro de reversão; ambos coexistem na base.
- **FR-029**: O sistema MUST expor uma **view derivada de "status efetivo"**
  de cada atendimento, calculada em tempo de consulta a partir da
  existência (ou não) de um registro de reversão correspondente. Valores
  possíveis: `ativo`, `estornado`.
- **FR-030**: Relatórios, totais de produção por médico e receita por plano
  MUST somar o valor **líquido** (atendimento original + todos os registros
  de reversão associados), refletindo o efeito contábil correto do estorno.
- **FR-031**: Registros de reversão MUST gerar entrada na trilha de
  auditoria contendo ator, timestamp, motivo, atendimento referenciado e
  valor revertido.
- **FR-032**: A ação de reverter atendimento MUST ser restrita aos papéis
  `admin` e `financeiro`; `recepcionista` e `profissional_saude` MUST NOT
  poder criar reversões.

#### Controle de acesso e isolamento

- **FR-020**: O sistema MUST aplicar controle de acesso por papel (RBAC) no
  servidor em toda ação: `admin` pode alterar cadastros e preços;
  `financeiro` emite/ajusta faturas e vê relatórios, mas não altera preços;
  `recepcionista` apenas consulta preços e atendimentos; `profissional_saude`
  acessa seus próprios atendimentos.
- **FR-021**: O sistema MUST aplicar isolamento multi-tenant em 100% das
  consultas — nenhum usuário ou integração de um tenant MUST ter acesso a
  dados de outro tenant.
- **FR-022**: Tentativas de acesso negadas pelo RBAC MUST ser registradas na
  trilha de auditoria.

#### Relatórios e exportação

- **FR-023**: O sistema MUST gerar, por tenant, um relatório cobrindo um
  período (padrão: mês calendário) com: (a) receita total por plano de
  saúde, (b) produção total por médico, (c) comissão calculada usando o
  percentual snapshot de cada atendimento.
- **FR-024**: O sistema MUST permitir exportar o relatório em PDF e Excel,
  contendo exatamente os mesmos totais exibidos na tela.
- **FR-025**: O acesso ao relatório MUST ser restrito aos papéis `admin` e
  `financeiro`.
- **FR-026**: O sistema MUST suportar múltiplas gerações do mesmo relatório
  sem efeitos colaterais sobre os dados (operação somente-leitura).

### Key Entities

- **Tenant (Clínica)**: unidade de isolamento. Possui nome, identificador
  único, credencial de webhook, e configurações (nomes dos custom fields
  GHL, etapa-gatilho do pipeline).
- **Procedimento**: código TUSS, descrição, estado (ativo/obsoleto),
  vinculado ao catálogo TUSS global.
- **Plano de Saúde**: nome (Unimed, Bradesco, Amil, Particular, etc.),
  escopo por tenant (cada clínica cadastra os planos que aceita).
- **Versão de Preço**: tenant, procedimento, plano, valor (centavos BRL),
  `valid_from`, `valid_to`, criado_por, criado_em, motivo.
- **Médico**: tenant, nome, CRM, percentual de comissão atual, estado
  (ativo/inativo), data de cadastro.
- **Histórico de Comissão do Médico**: versões anteriores do percentual com
  `valid_from`/`valid_to`, para fins de snapshot em atendimentos.
- **Atendimento**: tenant, paciente (ver entidade Paciente abaixo), médico,
  procedimento, plano, valor congelado, percentual de comissão snapshot,
  timestamp do atendimento, ID de evento GHL, origem (GHL). Registros de
  atendimento são append-only; nunca sofrem mutação após a persistência.
- **Paciente**: tenant, `contact_id` GHL (identificador externo), nome
  completo, CPF, telefone, e-mail, data de nascimento. Campos pessoais
  sensíveis (nome, CPF, telefone, e-mail, data de nascimento) são tratados
  como dados pessoais sob LGPD: criptografados em repouso, mascarados em
  logs, e expostos apenas a usuários autorizados do próprio tenant.
  Atualizações a partir do GHL são permitidas; exclusão é controlada por
  política de retenção LGPD, não por usuário comum da aplicação.
- **Registro de Reversão de Atendimento**: tenant, referência ao
  atendimento original (chave estrangeira obrigatória), valor com sinal
  oposto ao original, motivo textual obrigatório, ator que registrou a
  reversão, timestamp UTC. Também append-only; não pode ser excluído.
- **View "Status Efetivo" do Atendimento** (derivada, não persistida):
  para cada atendimento calcula em tempo de consulta o status (`ativo` ou
  `estornado`) e o valor líquido (original + reversões), a partir da
  existência de registros de reversão vinculados. Usada por telas
  operacionais e relatórios; nunca é armazenada como campo mutável no
  próprio atendimento.
- **Trilha de Auditoria**: ator, timestamp UTC, tenant, entidade, campo,
  valor anterior, valor novo, motivo, IP, user-agent, resultado
  (sucesso/negado).
- **Catálogo TUSS (global)**: códigos TUSS oficiais, descrições, vigências;
  atualizado por operador da plataforma, compartilhado entre todos os
  tenants.
- **Evento Bruto de Webhook**: tenant, `event_id` GHL, payload completo,
  cabeçalhos (incluindo assinatura), timestamp de recebimento, estado de
  processamento. Os rótulos em português (`recebido`, `processando`,
  `atendimento_criado`, `dlq`, `reprocessado`) são apresentação de UI; os
  códigos canônicos persistidos no banco são em inglês
  (`pending`, `processing`, `done`, `dlq`, `reprocessed`). Append-only; nunca
  é removido após aceitação.
- **Dead-Letter Queue (DLQ) de Eventos**: eventos que falharam no
  processamento semântico com motivo da falha (TUSS inválido, plano
  ausente, preço não cadastrado, médico não encontrado, etc.), timestamp
  da última tentativa, contador de tentativas, visibilidade por tenant.
  Admin do tenant pode acionar reprocessamento após corrigir o dado de
  origem; operadores da plataforma podem inspecionar para suporte.
- **Alerta Operacional**: tenant, tipo (ver FR-034), timestamp de criação,
  dados de contexto (evento/entidade referenciada), status
  (`aberto`/`resolvido`), timestamp e ator da resolução (quando aplicável),
  referência aos envios de e-mail já realizados para fins de
  deduplicação. Persistido append-only; transições de status são registradas
  como eventos associados, sem sobrescrever histórico.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001a**: 99% dos webhooks GHL recebem resposta `2xx` do endpoint em
  menos de 1 segundo (ack após persistir evento bruto), medido no p99.
- **SC-001b**: 95% dos eventos válidos têm seu atendimento persistido
  (processamento semântico completo) em menos de 10 segundos a partir do
  recebimento.
- **SC-001c**: 100% dos eventos que falham por regra de negócio aparecem
  na DLQ do tenant com detalhamento diagnóstico em menos de 30 segundos
  após o recebimento do webhook.
- **SC-002**: 100% das alterações de preço são visíveis na trilha de
  auditoria com todos os campos obrigatórios preenchidos (ator, timestamp,
  tenant, valor anterior, valor novo, motivo).
- **SC-003**: Zero vazamento de dados entre tenants em testes automatizados
  que tentam acessar dados de outra clínica por todas as superfícies
  (API, webhook, relatório, exportação).
- **SC-004**: Relatório mensal de uma clínica com até 5.000 atendimentos é
  gerado em menos de 30 segundos.
- **SC-005**: Para 100% das alterações de preço com `valid_from` futura,
  nenhum atendimento registrado anteriormente à nova vigência tem seu valor
  alterado (verificação automatizada).
- **SC-006**: Arquivos exportados (PDF e Excel) apresentam os mesmos totais
  da tela em 100% dos relatórios gerados.
- **SC-007**: Eventos de webhook duplicados (mesmo GHL event ID) resultam em
  zero atendimentos duplicados em 100% dos testes de reenvio.
- **SC-008**: Usuários com papel `recepcionista` têm 0% de sucesso em
  tentativas de alterar preço ou cadastro de médico (verificado em testes
  por papel para cada endpoint).
- **SC-009**: 100% dos webhooks com dados obrigatórios ausentes ou inválidos
  geram alerta operacional rastreável, sem persistir atendimento parcial.
- **SC-011**: 100% dos campos pessoais de paciente (nome, CPF, telefone,
  e-mail, data de nascimento) persistidos localmente estão criptografados
  em repouso e ausentes em logs de aplicação em texto claro (verificado em
  testes automatizados de vazamento).
- **SC-012**: 95% dos alertas operacionais gerados são entregues por e-mail
  aos admins do tenant em menos de 2 minutos após o evento de origem, e
  100% estão visíveis no dashboard in-app imediatamente após a criação.
- **SC-013**: 0% dos e-mails de alerta contêm dados pessoais de paciente
  em texto claro (verificado em inspeção automatizada do conteúdo
  gerado).

## Assumptions

- A clínica é um `tenant` isolado; cada clínica utiliza sua própria conta
  GHL e uma credencial/assinatura de webhook única identifica o tenant no
  recebimento.
- Os nomes dos custom fields GHL que contêm plano, procedimento e médico são
  **configuráveis por tenant** no onboarding (clínicas usam nomenclaturas
  diferentes em seus pipelines). Um mapeamento padrão é sugerido.
- A etapa de pipeline que dispara faturamento é **configurável por tenant**
  (exemplo comum: "Atendimento Realizado"). Apenas eventos dessa etapa
  iniciam o processamento; demais mudanças de etapa são ignoradas.
- A lista de planos de saúde é **gerenciada por tenant** — cada clínica
  cadastra os planos que aceita; não há catálogo global de planos.
- O catálogo TUSS é **global à plataforma** e atualizado por operadores da
  plataforma (não editável por usuários de clínicas).
- Cada atendimento referencia **um** procedimento e **um** médico. Pacotes/
  combinações de procedimentos estão fora de escopo para v1.
- Comissão é **percentual simples** sobre o valor do procedimento; regras
  escalonadas ou condicionadas estão fora de escopo para v1.
- Pré-autorização de convênio e tratamento de glosa (negação da operadora)
  estão fora de escopo para v1.
- Dados ausentes no webhook são tratados com **fail-closed**: evento
  rejeitado, nada é persistido, alerta operacional gerado. Não há "rascunho
  de atendimento para completar manualmente" em v1.
- Moeda é BRL; valores armazenados como inteiros em centavos.
- O relatório por padrão cobre um mês calendário; o admin pode selecionar um
  intervalo customizado.
- Exportações PDF/Excel são geradas sob demanda e baixadas; envio automático
  por e-mail está fora de escopo para v1.
- A plataforma opera em modo greenfield; migração de dados históricos de
  sistemas legados das clínicas está fora de escopo para v1.
- Todos os timestamps são persistidos em UTC; apresentação usa o fuso local
  da clínica (padrão: America/Sao_Paulo).
- Autenticação de usuários da clínica é provida pelo sistema Homio
  existente; o faturamento consome identidade e papéis já estabelecidos.
