# Feature Specification: Integração Prontool ↔ GoHighLevel Marketplace (OAuth 2.0)

**Feature Branch**: `008-ghl-marketplace-oauth`
**Created**: 2026-05-04
**Status**: Draft
**Input**: User description: "Integração completa do Prontool com o GoHighLevel Marketplace. Migrar de token fixo por tenant para OAuth 2.0 oficial; auto-provisionar tenant ao instalar o app; auto-criar custom fields; registrar webhooks; sync bidirecional de contatos; nota de atendimento; SSO/custom menu; UI de configuração com status, reconectar e log de sincronização."

## User Scenarios & Testing _(mandatory)_

### User Story 1 — Conectar uma sub-account do GHL ao Prontool via OAuth (Priority: P1)

Um administrador de clínica que já usa o Prontool quer conectar a sub-account dele do GoHighLevel sem precisar gerar token manualmente. Ele entra em **Configurações → Integrações → GoHighLevel**, vê o estado "Não conectado" e clica em "Conectar ao GoHighLevel". É redirecionado ao consentimento do GHL, escolhe a sub-account, autoriza, e volta ao Prontool com a integração ativa, mostrando o nome da sub-account, a data da conexão e o status do token.

**Why this priority**: É a porta de entrada de tudo. Sem o fluxo OAuth funcionando ponta-a-ponta (consentimento → callback → tokens criptografados → status "Conectado"), nenhum dos demais cenários roda. Substitui o método atual de token fixo, que é incompatível com o modelo de Marketplace.

**Independent Test**: Com `GHL_CLIENT_ID/SECRET/REDIRECT_URI/SCOPES` configurados no ambiente, um admin de tenant existente clica em "Conectar", completa o consentimento em uma sub-account de teste do GHL, e verifica que (a) volta para a página de integração com badge "Conectado", (b) o registro em `tenant_integrations` foi criado/atualizado com tokens cifrados e (c) `audit_log` registra `integration.connect` com `provider=ghl`. Não depende de auto-provisionamento, de custom fields nem de sync.

**Acceptance Scenarios**:

1. **Given** o admin está autenticado no Prontool e a integração GHL ainda não está conectada para o seu tenant, **When** ele clica em "Conectar ao GoHighLevel", **Then** o navegador é redirecionado para a tela de consentimento do GHL com `client_id`, `redirect_uri`, `response_type=code` e `scope` corretos.
2. **Given** o admin autorizou a sub-account no GHL, **When** o GHL chama de volta o callback com um `code` válido, **Then** o Prontool troca o `code` por `access_token + refresh_token`, persiste o par cifrado em `tenant_integrations`, registra `integration.connect` no audit, e redireciona para a página de integração mostrando "Conectado — <nome da sub-account>".
3. **Given** uma integração conectada cujo `access_token` venceu, **When** o adapter precisa fazer uma chamada à API do GHL, **Then** o sistema usa o `refresh_token` para obter novo par antes da chamada, atualiza o registro cifrado, e a chamada de negócio segue normalmente sem o usuário perceber.
4. **Given** o `refresh_token` foi revogado pelo GHL, **When** o sistema tenta o auto-refresh, **Then** a integração é marcada como **"Token expirado / Reconectar"**, um alerta operacional `integration_sync_failed` é registrado com `detail.provider='ghl'`, e a operação local que disparou o sync **não falha** para o usuário.
5. **Given** um usuário sem papel de admin acessa **Configurações → Integrações → GoHighLevel**, **When** ele clica em "Conectar" ou "Desconectar", **Then** a ação é bloqueada com erro de permissão.
6. **Given** um admin clicou em "Desconectar", **When** confirma, **Then** os tokens cifrados são removidos / a linha é marcada como desconectada, os webhooks registrados na sub-account são removidos via API, e o `audit_log` registra `integration.disconnect`. Os dados de pacientes, atendimentos etc. **permanecem** no Prontool.

---

### User Story 2 — Instalação via Marketplace cria/atualiza o tenant automaticamente (Priority: P1)

Uma agência ou sub-account encontra o Prontool no Marketplace do GHL e clica em "Instalar". O Prontool recebe o webhook de instalação, e:

- Se ainda não existe um tenant ligado àquela sub-account, **cria** o tenant automaticamente com o nome e timezone da location, e cria o registro em `tenant_integrations` com os tokens cifrados.
- Se já existe um tenant ligado àquela sub-account (mesmo `location_id`), **atualiza** apenas os tokens cifrados e marca como conectado.
- Se a agência depois desinstala, o webhook de uninstall marca a integração como desconectada (não apaga dados).

**Why this priority**: É o requisito mínimo para o app ser publicável no Marketplace e ser instalável por agências sem onboarding manual.

**Independent Test**: Disparar manualmente os webhooks `INSTALL` e `UNINSTALL` do GHL (com payload simulado e assinatura válida) para `/api/webhooks/ghl/install` e `/api/webhooks/ghl/uninstall` e verificar que (a) primeiro install cria tenant + tenant_integrations, (b) segundo install no mesmo `location_id` apenas atualiza tokens, (c) uninstall marca como desconectado e mantém pacientes e atendimentos. Não depende dos cenários de OAuth manual nem de sync.

**Acceptance Scenarios**:

1. **Given** o `location_id` da sub-account ainda não está mapeado a nenhum tenant Prontool, **When** chega `/api/webhooks/ghl/install` com payload válido, **Then** um novo tenant é criado com `name = location.name`, timezone = location.timezone (default `America/Sao_Paulo` se ausente) e uma linha em `tenant_integrations` com `provider='ghl'` e tokens cifrados; `audit_log` registra `integration.connect` com origem `marketplace_install`.
2. **Given** o `location_id` já está mapeado a um tenant existente, **When** chega novo `INSTALL`, **Then** os tokens são atualizados, `connected_at` é renovado, e nenhum tenant duplicado é criado.
3. **Given** uma sub-account com integração ativa, **When** chega `/api/webhooks/ghl/uninstall`, **Then** a linha em `tenant_integrations` é marcada como desconectada, os webhooks registrados anteriormente na sub-account são considerados removidos pelo lado do GHL, e os pacientes/atendimentos do tenant **continuam intactos** e visíveis no Prontool.
4. **Given** um webhook de install/uninstall com assinatura inválida, **When** a rota recebe, **Then** retorna 401 e nenhuma mudança é persistida.
5. **Given** o mesmo webhook de install é entregue duas vezes pelo GHL (retry), **When** processado, **Then** o resultado é idempotente — sem tenants duplicados, sem múltiplos `audit_log` de connect.

---

### User Story 3 — Sincronização de dados clínicos com a sub-account ativa (Priority: P2)

Após conectar, o Prontool prepara automaticamente a sub-account do GHL para receber dados clínicos: cria os custom fields necessários (CPF, Plano de Saúde, Profissional Responsável, Último Atendimento, Diagnósticos Ativos, Alergias) e registra os webhooks de contato. A partir daí, contatos criados/atualizados no GHL viram pacientes no Prontool, pacientes criados/atualizados no Prontool atualizam os contatos no GHL com os custom fields preenchidos, e cada atendimento concluído vira uma nota no contato GHL correspondente.

**Why this priority**: É o que torna a integração útil no dia a dia — sem isso, "conectado" é só estado. Mas depende da User Story 1 (conexão) ou 2 (instalação) ter estabelecido tokens válidos.

**Independent Test**: Com uma integração conectada, (a) verificar que ao conectar pela primeira vez os 6 custom fields aparecem na sub-account GHL (e que ao reconectar não duplica), (b) criar um contato direto no GHL e verificar que dispara webhook → upsert em `patients`, (c) criar paciente no Prontool e verificar que o contato GHL é atualizado com os custom fields, (d) registrar atendimento e verificar que aparece nota no contato GHL com data/procedimento/profissional.

**Acceptance Scenarios**:

1. **Given** uma integração recém-conectada sem custom fields prévios, **When** o setup pós-OAuth roda, **Then** os 6 custom fields são criados na sub-account com os tipos corretos (TEXT, TEXT, TEXT, DATE, TEXT_LONG, TEXT) e seus IDs são salvos em `tenant_integrations.config.custom_field_ids`.
2. **Given** uma sub-account que já possui um custom field com nome igual a um dos 6 (ex.: "CPF" criado manualmente antes), **When** o setup roda, **Then** o ID do field existente é reutilizado e nenhum duplicado é criado.
3. **Given** a integração está conectada e o webhook de contato `ContactCreate` está registrado, **When** um contato é criado no GHL, **Then** um upsert em `patients` é feito mapeando os custom fields pelos IDs salvos.
4. **Given** um paciente é criado no Prontool e o evento `patient.created` é publicado, **When** o adapter GHL processa o evento, **Then** o contato é criado/atualizado na sub-account GHL com os custom fields preenchidos via Bearer `access_token` (auto-refresh se necessário).
5. **Given** um atendimento é confirmado no Prontool, **When** o adapter GHL processa o evento, **Then** uma nota é criada no contato GHL correspondente com o conteúdo "Atendimento realizado em {data} — {procedimento} — Prof. {profissional}".
6. **Given** o GHL retorna 401 porque o token foi revogado, **When** o adapter detecta, **Then** ele tenta um refresh; se falhar, a operação local **conclui com sucesso**, gera alerta `integration_sync_failed` e marca a integração como "Token expirado".

---

### User Story 4 — Página de configuração com status e ações (Priority: P2)

Em **Configurações → Integrações → GoHighLevel**, o admin vê uma página única que reflete o estado real da integração e permite agir sobre ela: conectar, reconectar (quando o refresh falhou), desconectar, e inspecionar o que foi configurado na sub-account (custom fields, webhooks, últimas 10 sincronizações com sucesso/falha).

**Why this priority**: Sem essa visibilidade o admin não sabe se o problema é dele ou do sistema, e operações precisam mexer em DB para diagnosticar. Depende da US1.

**Independent Test**: Com tenants em três estados (não conectado, conectado, "token expirado"), verificar que a página renderiza o conjunto correto de seções e botões em cada estado, e que o log de sincronização lista as últimas 10 operações com timestamp, ação, status e mensagem de erro (se houver).

**Acceptance Scenarios**:

1. **Given** o tenant nunca conectou, **When** abre a página, **Then** vê apenas o botão "Conectar ao GoHighLevel" e uma explicação curta do que será feito.
2. **Given** o tenant está conectado, **When** abre a página, **Then** vê: nome da sub-account, data de conexão, status do token (Conectado), seção de Custom Fields com os 6 nomes e IDs, seção de Webhooks com os 3 eventos registrados, log das últimas 10 operações de sync, botão "Desconectar".
3. **Given** o tenant está conectado mas o refresh falhou, **When** abre a página, **Then** vê o estado "Token expirado — reconecte para continuar sincronizando" com botão destacado "Reconectar"; as seções de Custom Fields e Webhooks continuam visíveis em modo somente leitura.
4. **Given** um usuário não-admin abre a página, **When** carrega, **Then** vê o estado em modo somente leitura, sem botões de ação.
5. **Given** o `refresh_token` ou o `access_token` está armazenado, **When** a página renderiza, **Then** **nenhum** dos tokens em texto claro aparece em HTML, atributos `data-*`, JSON inline ou logs do servidor — apenas o status textual.

---

### User Story 5 — SSO via Custom Menu (Priority: P3)

Para usuários que vivem dentro do GHL, o Prontool aparece como um item de menu da sub-account. Clicar abre o Prontool em um iframe / nova aba já autenticado: o GHL passa um token de contexto, o Prontool valida, e cria sessão correspondente ao usuário do tenant ligado àquela sub-account.

**Why this priority**: Reduz fricção significativamente para agências que querem oferecer o Prontool como extensão natural do GHL, mas não bloqueia o lançamento do app no Marketplace e tem incerteza de viabilidade dependendo do que a API atual do GHL permite registrar programaticamente.

**Independent Test**: Com a integração conectada, (a) verificar que um item de menu foi registrado na sub-account, (b) simular o clique entregando um token de contexto válido a `/api/sso/ghl` e verificar que o Prontool abre logado como usuário do tenant correspondente, (c) repetir com token inválido / expirado e verificar bloqueio.

**Acceptance Scenarios**:

1. **Given** uma integração recém-conectada, **When** o setup roda, **Then** um item de menu é registrado na sub-account apontando para `https://prontool.vercel.app/api/sso/ghl?...`.
2. **Given** o usuário clica no menu dentro do GHL, **When** o GHL chama `/api/sso/ghl` com um token de contexto válido, **Then** o Prontool valida o token, identifica o tenant pela `location_id` embutida, cria/recupera sessão do usuário correspondente e renderiza o app dentro do iframe.
3. **Given** um token de contexto inválido, expirado ou referente a uma sub-account não conectada, **When** chega em `/api/sso/ghl`, **Then** a resposta é 401 com mensagem amigável e nenhuma sessão é criada.

---

### Edge Cases

- **OAuth abandonado**: usuário inicia "Conectar", chega na tela do GHL e fecha a aba. Não há callback. → Página de integração continua mostrando "Não conectado"; nenhum estado intermediário persistido.
- **`code` reutilizado**: GHL retorna o mesmo `code` em redirecionamento duplo (refresh do navegador). → Segunda troca falha; sistema deve tratar idempotentemente, sem criar registros parciais.
- **Refresh enquanto outro request também está fazendo refresh**: corrida de duas chamadas concorrentes pode tentar trocar o mesmo `refresh_token` duas vezes (alguns servidores OAuth invalidam o anterior). → Sistema deve serializar refresh por `tenant_integrations.id` para evitar duplicação.
- **Webhook de install duplicado** (GHL retry): processado duas vezes. → Idempotente: mesma sub-account não cria tenants duplicados.
- **Webhook de install para uma `location_id` já mapeada a outro tenant** (cenário raro, mas possível se admin moveu manualmente): instalação chega para `location_id=L1`, mas L1 já está em `tenant_X.tenant_integrations`. → Atualiza tokens em `tenant_X`; não cria novo tenant.
- **Custom field com nome igual mas tipo diferente** (ex.: já existe "CPF" como NUMBER em vez de TEXT): → Sistema **não** sobrescreve o campo existente; cria um novo com sufixo `" (Prontool)"` (ex.: `"CPF (Prontool)"`) e usa o ID desse novo campo no mapeamento. Registra warning no audit indicando o conflito.
- **Falha parcial no setup pós-conexão**: custom fields criados, webhooks falharam. → Estado deve ficar consistente o suficiente para retry; nada bloqueia a finalização do connect (a integração fica "Conectado, com avisos" e admin pode "Reconfigurar").
- **Tenant desconecta enquanto há eventos em fan-out**: → Eventos pendentes para GHL silenciosamente viram no-op (provider não está mais habilitado), sem alertar.
- **Uninstall recebido mas o tenant está com vários usuários ativos**: → Não bloqueia o GHL; integração some, dados ficam, próximo connect/install reativa.
- **Múltiplas locations em uma instalação agência-level**: GHL pode entregar `INSTALL` para múltiplas locations em sequência. → Cada `location_id` é tratado independentemente (um tenant por location).
- **`patient.created` para paciente sem telefone/e-mail** que normalmente seriam usados como identificador no GHL: → Cria contato no GHL apenas com nome + custom fields; mantém vínculo via `external_id`.

## Requirements _(mandatory)_

### Functional Requirements

#### Conexão e ciclo de vida do token (US1, US2)

- **FR-001**: Sistema MUST oferecer um fluxo de autorização OAuth 2.0 onde o admin clica em "Conectar ao GoHighLevel" e é redirecionado ao consentimento do GHL com `response_type=code`, `client_id`, `redirect_uri` e `scope` esperados pelo Marketplace.
- **FR-002**: Sistema MUST trocar o `code` recebido no callback por `access_token + refresh_token` no endpoint de token oficial do GHL e persistir ambos cifrados, junto com o `expires_at` e os escopos efetivamente concedidos.
- **FR-003**: Sistema MUST detectar quando `access_token` está prestes a expirar (ou já expirou) antes de cada chamada à API do GHL e renovar automaticamente usando `refresh_token`, atualizando o registro cifrado.
- **FR-004**: Sistema MUST serializar refreshes concorrentes para o mesmo registro de integração para evitar invalidação cruzada de `refresh_token`.
- **FR-005**: Sistema MUST, ao falhar o refresh por `refresh_token` revogado/expirado, marcar a integração como **"Token expirado"**, registrar `audit_log` (`integration.refresh_failed`), publicar alerta operacional `integration_sync_failed` com `detail.provider='ghl'`, e **não** propagar erro à operação local que disparou o sync.
- **FR-006**: Sistema MUST processar `INSTALL` e `UNINSTALL` recebidos no webhook do Marketplace de forma idempotente, criando o tenant na primeira ocorrência (com `name` e `timezone` da location) e apenas atualizando tokens em ocorrências subsequentes para a mesma `location_id`.
- **FR-007**: Sistema MUST validar a assinatura do webhook do Marketplace antes de qualquer mutação; webhooks sem assinatura válida MUST retornar 401 sem efeitos colaterais.
- **FR-008**: Sistema MUST, ao receber `UNINSTALL`, marcar a integração como desconectada e remover (best-effort) os webhooks que havia registrado na sub-account, **sem apagar** pacientes, atendimentos, comprovantes ou outros dados clínicos do tenant.
- **FR-009**: Sistema MUST permitir ao admin desconectar manualmente a integração com efeito equivalente ao uninstall do lado do GHL: tokens removidos/marcados, webhooks limpos na sub-account, dados clínicos preservados.

#### Setup pós-conexão (US3)

- **FR-010**: Ao conectar pela primeira vez (manual OU via marketplace install), o sistema MUST criar na sub-account os custom fields exigidos: CPF (TEXT), Plano de Saúde (TEXT), Profissional Responsável (TEXT), Último Atendimento (DATE), Diagnósticos Ativos (TEXT_LONG), Alergias (TEXT).
- **FR-011**: Sistema MUST detectar custom fields preexistentes pelo nome e tipo: (a) se nome E tipo coincidem, reutilizar o ID existente; (b) se o nome coincide mas o tipo diverge, criar um novo campo com sufixo `" (Prontool)"` e usar o ID desse novo campo no mapeamento, registrando warning em `audit_log`.
- **FR-012**: Sistema MUST persistir o mapeamento `nome → field_id` em `tenant_integrations.config.custom_field_ids` para uso pelo sync.
- **FR-013**: Sistema MUST registrar via API os webhooks de `ContactCreate`, `ContactUpdate` e `OpportunityStatusUpdate` na sub-account e armazenar os `webhook_id` retornados em `tenant_integrations.config.webhook_ids` para poder removê-los na desconexão.

#### Sincronização (US3)

- **FR-014**: Sistema MUST processar webhooks `ContactCreate` e `ContactUpdate` da sub-account fazendo upsert em `patients`, mapeando custom fields pelos IDs salvos em `config.custom_field_ids`.
- **FR-015**: Sistema MUST, ao publicar `patient.created` ou `patient.updated`, atualizar o contato correspondente na sub-account GHL via `Authorization: Bearer <access_token>` e versão de API do GHL, preenchendo os custom fields com plano, alergias, último atendimento, profissional responsável e diagnósticos ativos quando disponíveis.
- **FR-016**: Sistema MUST, ao concluir um atendimento, publicar uma nota no contato GHL correspondente com o conteúdo "Atendimento realizado em {data} — {procedimento} — Prof. {profissional}".
- **FR-017**: Todas as chamadas externas à API do GHL MUST aplicar o pattern de retry + timeout existente (timeout de 5s por requisição) e, em caso de falha definitiva, MUST registrar alerta `integration_sync_failed` sem propagar erro à operação local.

#### UI e auditoria (US1, US4)

- **FR-018**: A página `/configuracoes/integracoes/ghl` MUST refletir três estados distintos — não conectado, conectado, token expirado — com os botões correspondentes (Conectar / Desconectar / Reconectar).
- **FR-019**: A página MUST mostrar, quando conectada: nome da sub-account, data de conexão, lista de custom fields (nome + ID), lista de webhooks registrados (evento + ID) e log das últimas 10 operações de sync (timestamp, tipo, status sucesso/falha, mensagem de erro resumida).
- **FR-020**: A UI MUST nunca expor `access_token`, `refresh_token` ou `client_secret` em HTML, atributos, JSON inline, response bodies ou logs do servidor — apenas o status textual e metadados não-sensíveis.
- **FR-021**: Sistema MUST registrar entradas em `audit_log` para cada operação relevante: `integration.connect`, `integration.reconfigure`, `integration.disconnect`, `integration.refresh_success`, `integration.refresh_failed`, e cada sync com `entity` adequado.
- **FR-022**: Apenas usuários com papel `admin` MUST poder iniciar Conectar, Desconectar ou Reconectar; demais papéis veem a página em modo somente leitura.

#### SSO / Custom Menu (US5)

- **FR-023**: Ao conectar, o sistema MUST tentar registrar um item de Custom Menu na sub-account apontando para o endpoint de SSO do Prontool. Se a API do GHL retornar erro indicando indisponibilidade do recurso (404, 403 de escopo, ou equivalente), o sistema MUST marcar essa parte como **"Custom Menu não-disponível — configurar manualmente"** na seção de configuração da UI (com instrução textual de como criar manualmente), sem bloquear nem reverter o restante da conexão (tokens, custom fields, webhooks de contato continuam ativos). O `menu_id` retornado quando o registro for bem-sucedido MUST ser persistido em `tenant_integrations.config.menu_id` para remoção em desconexão.
- **FR-024**: O endpoint `/api/sso/ghl` MUST validar o token de contexto entregue pelo GHL, identificar o tenant pela `location_id` embutida, criar/recuperar sessão do usuário correspondente, e renderizar o Prontool dentro de iframe (cabeçalhos `X-Frame-Options` / `Content-Security-Policy` configurados para permitir o domínio do GHL).
- **FR-025**: Tokens de contexto inválidos, expirados ou referentes a sub-accounts não conectadas MUST resultar em 401 com mensagem amigável e nenhuma sessão criada.

#### Multi-tenant e segurança (transversal)

- **FR-026**: Cada `location_id` do GHL MUST mapear para no máximo um tenant Prontool ativo.
- **FR-027**: Tokens OAuth (`access_token` e `refresh_token`) MUST ser cifrados em repouso usando o mesmo mecanismo já utilizado em `credentials_enc`.
- **FR-028**: Falha em qualquer operação contra o GHL MUST nunca bloquear a operação local que a disparou (paciente é criado, atendimento é confirmado, etc.) — o sync acontece de forma resiliente e os erros vão para alertas.

### Key Entities

- **Tenant Integration (GHL)**: representa o vínculo de um tenant com uma sub-account GHL específica. Atributos relevantes (não exaustivos): `tenant_id`, `provider='ghl'`, `location_id`, `connected_at`, `status` (conectado/desconectado/token_expired), `credentials_enc` (com `access_token`, `refresh_token`, `expires_at`, `scopes`), `config` (com `custom_field_ids`, `webhook_ids`, eventual `menu_id` do SSO).
- **Custom Field Mapping**: par `nome do campo clínico → field_id na sub-account GHL`, materializado em `config.custom_field_ids` da integração.
- **Registered Webhook**: par `evento GHL → webhook_id` retornado ao registrar, materializado em `config.webhook_ids`, usado tanto no upsert quanto na remoção em desconexão.
- **Operational Alert (integration_sync_failed)**: alerta visível à operação para falhas que o usuário-final não percebe (refresh falhou, sync falhou após retry), com `detail.provider='ghl'`.
- **Audit Entry**: trilha imutável em `audit_log` de connect/disconnect/refresh/sync por tenant.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: Um administrador novo consegue ir de "nunca conectei" até "integração conectada com custom fields e webhooks registrados" em **menos de 2 minutos**, sem precisar copiar nenhum token manualmente.
- **SC-002**: Em **0%** das verificações de auditoria (manual e automatizada) `access_token`, `refresh_token` ou `client_secret` aparecem em response bodies, HTML, atributos `data-*`, JSON inline ou logs.
- **SC-003**: Quando o `access_token` expira, **100%** das chamadas subsequentes ao GHL completam com sucesso após auto-refresh, sem que o usuário precise reconectar — exceto quando o `refresh_token` foi revogado.
- **SC-004**: Quando o GHL está indisponível ou o token foi revogado, **100%** das operações locais (criar paciente, confirmar atendimento) **continuam concluindo com sucesso**; somente alertas operacionais e o status da integração são afetados.
- **SC-005**: Webhooks `INSTALL` entregues múltiplas vezes (retry do GHL) MUST resultar em **um único** tenant criado e **nenhum** custom field ou webhook duplicado na sub-account.
- **SC-006**: Após "Desconectar" ou `UNINSTALL`, **100%** dos pacientes, atendimentos, comprovantes e demais dados clínicos do tenant permanecem acessíveis no Prontool.
- **SC-007**: O log de sincronização na página de configuração mostra as **últimas 10** operações em tempo real (latência ≤ 5 s) com status sucesso/falha visualmente diferenciado.
- **SC-008**: Tentativas de Conectar/Desconectar/Reconectar por usuários não-admin são bloqueadas em **100%** dos casos.

## Assumptions

- A clínica usa um par único `(tenant Prontool ↔ sub-account GHL)` — não há cenário de uma sub-account servir dois tenants ao mesmo tempo.
- O Marketplace expõe webhooks de `INSTALL` e `UNINSTALL` com payload contendo `location_id`, nome da location, timezone e os tokens iniciais (cenário Marketplace App padrão do GHL).
- Os 6 custom fields propostos são suficientes para v1; novos campos serão decididos em iterações posteriores.
- O Prontool já dispõe da infraestrutura de cifra simétrica (`enc_text_with_key`) e dos modelos `tenant_integrations`, `audit_log`, `alerts` com schema descrito em `CLAUDE.md`. Esta feature **estende** esses modelos (nova flag de status, novos tipos de evento de audit, novas chaves em `config`) sem reescrevê-los.
- O event bus (`patient.created`, `appointment.created`, `appointment.completed`) já existente continua sendo a única origem de side-effects para o GHL — não há leitura periódica.
- Os escopos OAuth solicitados serão exatamente: `contacts.readonly`, `contacts.write`, `custom-fields.readonly`, `custom-fields.write`, `locations.readonly`, `opportunities.write`, `webhooks.readonly`, `webhooks.write`. Mudança de escopo posterior força reconexão.
- Variáveis `GHL_CLIENT_ID`, `GHL_CLIENT_SECRET`, `GHL_REDIRECT_URI`, `GHL_SCOPES` ficam disponíveis no ambiente Vercel; não são lidas dentro do adapter (continuam acessadas só pela camada OAuth, em conformidade com `lint:auth`).
- Registro do app no Marketplace e revisão pelo time GHL são **fora de escopo**; a feature entrega apenas o código backend/UI necessário.

## Resolved Decisions

> Decisões originalmente marcadas como NEEDS CLARIFICATION e resolvidas em 2026-05-04.

- **Escopo SSO (US5)**: US5 mantida nesta feature como **P3 com fallback gracioso**. Sistema tenta registrar Custom Menu via API; se a API não suportar, a UI mostra a parte de "Custom Menu" como manual, **sem bloquear nem reverter** o restante da conexão. Endpoint `/api/sso/ghl` é entregue independentemente do registro programático funcionar. Codificado em FR-023, FR-024, FR-025.
- **Custom Field com nome coincidente mas tipo divergente**: sistema **não** sobrescreve nem reutiliza um campo de tipo divergente; cria um novo com sufixo `" (Prontool)"` (ex.: `"CPF (Prontool)"`) e usa o ID desse novo campo no mapeamento, com warning em `audit_log`. Codificado em FR-011 e na seção Edge Cases.
