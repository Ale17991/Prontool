# Feature Specification: GHL Opcional + Modo Standalone

**Feature Branch**: `002-ghl-optional-standalone`
**Created**: 2026-04-23
**Status**: Draft
**Input**: User description: "Tornar o Prontool completamente independente do GoHighLevel, mantendo integração opcional para quem usa. O sistema deve funcionar 100% standalone e também em conjunto com GHL quando configurado."

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Clínica standalone usa o Prontool sem GHL (Priority: P1)

Uma clínica que não é cliente do GoHighLevel — ou que ainda não decidiu se vai adotar — faz onboarding no Prontool, cadastra seus profissionais, planos de saúde e procedimentos, e passa a operar: cadastra pacientes manualmente, registra atendimentos realizados, acompanha comissões e emite o relatório mensal. Em nenhum momento a clínica vê menções ao GHL, avisos de "integração pendente" ou erros relacionados a webhooks.

**Why this priority**: Este é o valor novo mais alto: sem ele, o Prontool só serve para clínicas que já usam GHL (universo pequeno). Tornar o GHL opcional multiplica o mercado potencial e é pré-requisito para os cenários 2 e 3 — o código precisa aceitar a ausência de configuração GHL antes de qualquer melhoria de integração.

**Independent Test**: Um tenant novo é provisionado sem linha em `tenant_ghl_config`. A clínica cadastra 2 pacientes manualmente, registra 5 atendimentos, gera o relatório mensal e navega por todas as telas do dashboard. Sucesso = zero erros, zero banners de GHL, zero falhas de validação.

**Acceptance Scenarios**:

1. **Given** um tenant sem registro em `tenant_ghl_config`, **When** o admin abre qualquer tela do dashboard, **Then** nenhum banner, alerta ou mensagem relacionada a GHL aparece.
2. **Given** um tenant standalone, **When** a recepção cadastra um paciente manualmente (nome, CPF, telefone, email, data de nascimento, plano de saúde, profissional responsável), **Then** o paciente é salvo no banco com sucesso, sem tentativa de sincronização externa e sem alerta operacional gerado.
3. **Given** um tenant standalone com pacientes cadastrados, **When** o profissional registra um atendimento realizado (paciente, profissional, procedimento, plano, data, valor), **Then** o atendimento aparece em `/operacao/atendimentos`, entra na comissão do profissional e é contabilizado no relatório mensal.
4. **Given** um tenant standalone, **When** algum sistema externo enviar uma requisição para `/api/webhooks/ghl` para esse tenant, **Then** a requisição é rejeitada com erro 401 (sem segredo configurado) e nenhum atendimento é criado — sem efeito colateral para a clínica.

---

### User Story 2 — Admin conecta ou desconecta a integração GHL (Priority: P2)

Um admin de uma clínica que já usa (ou quer passar a usar) o GoHighLevel vai na tela de Configurações do Prontool, encontra a seção "Integração GoHighLevel", preenche o webhook secret e os field mappings, clica em "Conectar" e vê o indicador mudar para "Conectado". Mais tarde, se quiser desligar, clica em "Desconectar" e o indicador volta a "Não configurado".

**Why this priority**: Sem este fluxo, o cliente precisaria de suporte manual (DBA rodando SQL) para ligar/desligar a integração. É o que transforma o "opcional" em algo self-service. Fica abaixo do P1 porque sem o P1 o sistema já não funciona para parte do mercado.

**Independent Test**: Um admin loga no tenant demo, abre `/configuracoes/integracoes`, preenche os campos do GHL, salva e vê "Conectado". Depois clica em "Desconectar" e vê "Não configurado". A linha em `tenant_ghl_config` é criada/removida de acordo.

**Acceptance Scenarios**:

1. **Given** um admin em tenant sem GHL configurado, **When** abre a tela de integrações, **Then** vê a seção "Integração GoHighLevel" com badge "Não configurado" e formulário para conectar.
2. **Given** um admin preenchendo o formulário, **When** envia webhook secret + field mappings válidos e confirma, **Then** a linha em `tenant_ghl_config` é criada, o badge muda para "Conectado" e um evento de auditoria é registrado.
3. **Given** um admin em tenant com GHL conectado, **When** clica em "Desconectar" e confirma, **Then** a linha em `tenant_ghl_config` é removida (ou flag `enabled=false`), o badge muda para "Não configurado" e o audit log registra.
4. **Given** um papel não-admin (recepcionista, financeiro), **When** tenta abrir a tela de integrações, **Then** é redirecionado ou vê mensagem de acesso negado — apenas admin configura integração.

---

### User Story 3 — Integração GHL sincroniza em background quando conectada (Priority: P3)

Uma clínica com GHL conectado tem a integração fluindo invisivelmente: webhooks entram, pacientes criados manualmente são espelhados para o GHL como contatos, e atendimentos registrados geram notas no contato correspondente. O admin não precisa tocar em nada — só vê o resultado: contatos sincronizados do lado do GHL. Se algum push falhar, um alerta operacional entra no painel (padrão atual) e o paciente/atendimento continua salvo no Prontool.

**Why this priority**: Benefício incremental para quem já usa GHL. Fica depois do P2 porque depende do P2 (tenant precisa estar conectado antes de ter sync), e fica depois do P1 porque o fluxo webhook-in (principal valor GHL hoje) já existe.

**Independent Test**: Tenant com `tenant_ghl_config` preenchido. Admin cadastra paciente manual → contato aparece no GHL. Admin registra atendimento → nota aparece no contato GHL. Se GHL estiver offline, alerta `ghl_sync_failed` é aberto mas paciente/atendimento permanecem íntegros.

**Acceptance Scenarios**:

1. **Given** tenant com GHL conectado e credenciais válidas, **When** recepção cadastra um novo paciente, **Then** a aplicação tenta criar o contato no GHL em melhor-esforço e registra o `ghl_contact_id` retornado (quando sucesso).
2. **Given** a sincronização falhar (rede/API GHL indisponível), **When** o paciente é salvo, **Then** o paciente aparece normalmente no Prontool, um alerta do tipo `ghl_sync_failed` é aberto no painel operacional, e o admin pode retomar manualmente depois.
3. **Given** tenant com GHL conectado, **When** um atendimento é registrado manualmente para um paciente com `ghl_contact_id`, **Then** uma nota é postada no contato GHL contendo data, profissional, procedimento e valor.
4. **Given** tenant sem GHL conectado (ou com integração desligada), **When** recepção cadastra paciente ou registra atendimento, **Then** nenhuma chamada a GHL é tentada, nenhum alerta de sync é gerado e o fluxo conclui em tempo normal.

---

### Edge Cases

- **Webhook para tenant sem `tenant_ghl_config`**: O endpoint `/api/webhooks/ghl` rejeita com `INVALID_SIGNATURE` (401) — o secret nem existe para verificar. O payload não é persistido em `raw_events`, não gera alerta (não há para quem notificar no tenant) e retorna rápido. Tenant standalone não é "quebrado" por tráfego GHL acidental.
- **Desconexão enquanto há eventos enfileirados**: Eventos já aceitos pelo webhook e enfileirados na DLQ/QStash continuam rodando até o fim (o secret já foi validado no momento da ingestão). Após desconexão, novos eventos passam a ser rejeitados. Nenhum retroativo.
- **Reconexão com outras credenciais**: Permitido. Histórico de atendimentos importados antes da reconexão fica intocado (eles têm `source='webhook'` e `source_raw_event_id` apontando para o evento original).
- **Paciente sem `ghl_contact_id` num tenant conectado**: Comportamento OK — é um paciente criado manualmente antes da conexão, ou criado depois sem sucesso de push. Registrar atendimento para ele não tenta criar nota no GHL (sem contato de destino). Admin pode forçar retry de sync via UI (fora de escopo deste feature).
- **Dois admins mudando status ao mesmo tempo**: Última escrita vence. Audit log mostra os dois eventos. Sem necessidade de locking.
- **Credenciais inválidas no primeiro teste**: Formulário oferece "Testar conexão" antes de salvar; se falhar, mostra erro e não persiste. (P3 — detalhe de UX, não bloqueia o fluxo principal.)

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Sistema MUST permitir que todo tenant opere sem nenhuma configuração GHL — cadastros, atendimentos, relatórios e comissões devem funcionar integralmente em modo standalone.
- **FR-002**: Sistema MUST determinar se um tenant é "standalone" ou "GHL conectado" apenas pela presença/ausência de linha ativa em `tenant_ghl_config` (não por flag de plataforma, env var ou configuração global).
- **FR-003**: Sistema MUST esconder, em UI, toda menção a GHL (banners, tooltips, mensagens, alertas) quando o tenant não tem GHL configurado.
- **FR-004**: Sistema MUST fornecer um fluxo de cadastro manual de paciente que funcione sem `ghl_contact_id`, aceitando os campos: nome completo, CPF, telefone, email, data de nascimento, plano de saúde (selecionado entre os do tenant) e profissional responsável (opcional).
- **FR-005**: Sistema MUST fornecer um fluxo manual de registro de atendimento realizado, aceitando: paciente (selecionado entre os do tenant), profissional responsável, procedimento, plano de saúde, data/hora do atendimento e valor efetivo (com default pré-preenchido a partir da tabela de preços vigente para aquele plano/procedimento).
- **FR-006**: Atendimentos criados manualmente MUST ter `source='manual'` (ou equivalente) para distinguir dos criados via webhook GHL; comissões e relatórios MUST tratar ambas as origens de forma idêntica.
- **FR-007**: Sistema MUST expor uma página/seção em Configurações chamada "Integração GoHighLevel", visível apenas para role `admin`, contendo: (a) indicador de status (Conectado / Não configurado), (b) formulário para conectar (webhook secret e field mappings), (c) botão de desconectar.
- **FR-008**: A ação de conectar GHL MUST persistir linha em `tenant_ghl_config` com segredo criptografado via `enc_text_with_key` (padrão atual) e gerar entrada de auditoria.
- **FR-009**: A ação de desconectar GHL MUST remover ou desativar a linha em `tenant_ghl_config` e gerar entrada de auditoria. Dados históricos de pacientes e atendimentos vindos de GHL anteriormente NÃO são alterados.
- **FR-010**: Endpoint `/api/webhooks/ghl` MUST permanecer funcional exatamente como hoje quando o tenant está conectado (zero regressão) e MUST rejeitar requisições com `INVALID_SIGNATURE` (401) quando o tenant não está configurado.
- **FR-011**: Quando um paciente é cadastrado manualmente E o tenant está com GHL conectado, o sistema MUST tentar criar o contato correspondente no GHL em melhor-esforço; falha de rede/API MUST abrir alerta `ghl_sync_failed` sem impedir o salvamento local do paciente.
- **FR-012**: Quando um paciente é cadastrado manualmente E o tenant NÃO está conectado, o sistema MUST salvar o paciente sem qualquer chamada ou tentativa de sync com GHL.
- **FR-013**: Quando um atendimento é registrado manualmente E o tenant está com GHL conectado E o paciente tem `ghl_contact_id`, o sistema MUST postar uma nota no contato GHL contendo metadados do atendimento (data, profissional, procedimento, valor); falha abre alerta e não impede o salvamento local.
- **FR-014**: Sistema MUST preservar todas as regras vigentes de RLS, RBAC, auditoria append-only, criptografia de PII e trilha de LGPD — independente do modo (standalone ou conectado).
- **FR-015**: Logs estruturados (pino) MUST continuar registrando eventos de sync GHL apenas para tenants conectados; para tenants standalone não deve haver log de "integração pendente", "sem secret" ou equivalente.
- **FR-016**: Relatório mensal e todas as agregações derivadas MUST incluir atendimentos criados manualmente e via webhook de forma indistinguível para o usuário final.

### Key Entities *(include if feature involves data)*

- **Tenant (existente)**: A clínica/consultório. Não muda de estrutura, mas ganha o conceito implícito de "modo de operação" = standalone ou GHL-conectado, derivado de `tenant_ghl_config`.
- **Tenant GHL Config (existente, `tenant_ghl_config`)**: Fonte única da verdade sobre conexão GHL. Presença = conectado. Ausência = standalone. Já contém webhook secret criptografado, trigger stage e field mappings.
- **Patient (existente)**: Passa a ter `ghl_contact_id` como nullable (nunca exigido). Origem do cadastro (webhook vs manual) não muda comportamento dos fluxos downstream.
- **Appointment (existente)**: Coluna `source` passa a aceitar o valor `'manual'` além de `'webhook'`. Processamento de comissão, relatório e estorno independe da origem.
- **Audit log (existente)**: Recebe eventos `ghl.connect` e `ghl.disconnect` da tela de configuração.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Uma clínica recém-provisionada, sem nenhuma configuração GHL, cadastra seu primeiro paciente e registra seu primeiro atendimento em menos de 5 minutos a partir do primeiro login.
- **SC-002**: 100% das páginas do dashboard renderizam sem nenhum elemento de UI mencionando GHL quando `tenant_ghl_config` está ausente (auditável via grep em testes E2E).
- **SC-003**: A suíte de integração existente (cenários com GHL conectado) passa em 100% dos casos antes/depois desta mudança — zero regressão nos fluxos GHL.
- **SC-004**: Admin completa o fluxo conectar → testar → desconectar em menos de 2 minutos, medido em teste E2E.
- **SC-005**: Paciente cadastrado manualmente em tenant conectado aparece nos contatos do GHL em até 30 segundos do clique em "Salvar" em 95% dos casos (com GHL saudável).
- **SC-006**: Paciente cadastrado manualmente em tenant standalone salva em menos de 2 segundos (sem tentativa de sync que seria o dobro do tempo).
- **SC-007**: Zero alertas operacionais do tipo `ghl_*` são gerados para tenants standalone em 1 mês de operação normal.
- **SC-008**: Transição de modo (standalone → conectado → standalone) preserva 100% dos pacientes e atendimentos existentes — nenhum dado perdido, nenhum histórico alterado.

## Assumptions

- **Modo determinado por dados, não flag**: A presença de linha em `tenant_ghl_config` é o único sinal para o app saber se o tenant está conectado ao GHL. Não há flag `ghl_enabled` a nível de env var ou constituição — o estado vive no banco, por tenant.
- **"Agendamento" = registro de atendimento realizado**: O termo "agendamento manual" no brief do usuário é interpretado como "criar um registro de atendimento via UI, incluindo data/hora, sem depender do webhook". Não está em escopo um calendário de slots futuros, lembretes, confirmação de comparecimento etc. — isso seria um feature distinto.
- **Campo `source` em appointments**: Já existe e aceita novos valores sem migração estrutural — apenas o código passa a escrever `'manual'` no fluxo novo.
- **GHL conectado = contato via API, não webhook out**: Sincronização outbound (Prontool → GHL) continua usando a integração via proxy existente (`src/lib/integrations/ghl/create-contact.ts`). Não há subscription de webhook-out nova.
- **Notas vs Oportunidades**: Registro de atendimento no GHL será feito como **nota no contato** (simples, robusto, reaproveita API atual). Criação de "oportunidade" fica como feature futuro se houver demanda — envolve pipeline/stage configuráveis.
- **Tela de integração é admin-only**: Role `admin` é a única com permissão `integration.write`. Outros papéis (financeiro, recepcionista, profissional_saude) nem vêem a seção.
- **LGPD não muda**: Criptografia de PII, retenção, anonimização e trilha de auditoria seguem as regras atuais. Passar de conectado → standalone não dispara nenhuma ação retroativa sobre dados de pacientes.
- **Webhook endpoint público**: `/api/webhooks/ghl` segue público (autentica pela assinatura), independente do tenant ter config ou não. Sem config = resposta rápida 401, sem side-effects.
- **Dependência de integração externa**: Requer que a API do GHL (via proxy `homio-operations`) permaneça disponível para o cenário com GHL conectado. Quedas do GHL são tratadas como degradação com alerta, não como bug do Prontool.
- **Não há migração de dados**: Tenants existentes com `tenant_ghl_config` continuam conectados. Tenants existentes sem a linha já estão em modo standalone por default — a única mudança real é remover UI/logs que hoje assumem GHL implicitamente.
