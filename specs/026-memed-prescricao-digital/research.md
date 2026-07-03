# Phase 0 — Research & Decisões Técnicas

Feature: Integração Memed — Prescrição Digital (`026-memed-prescricao-digital`)
Data: 2026-05-26

Todas as incógnitas de Technical Context foram resolvidas abaixo.

## D1 — Onde guardar as credenciais Memed por clínica

- **Decisão**: Criar tabela dedicada **`tenant_memed_config`** (1 linha por tenant), com `api_key_enc`/`secret_key_enc` (BYTEA) cifrados via os RPCs genéricos `enc_text_with_key`/`dec_text_with_key` (mesma chave `PATIENT_DATA_ENCRYPTION_KEY` usada pela cápsula de credenciais existente), além de `environment` ('staging'|'production'), estado de conexão e campos de aceite de termo.
- **Rationale**: A Memed é uma integração **síncrona request/response** (registro de prescritor, proxy de token, leitura de catálogos) — não publica nem consome `DomainEvent`. A tabela `tenant_integrations` está acoplada ao **event-bus** (`getEnabledIntegrations` → `dispatch` fan-out para adapters do registry) e à **detecção de standalone**. Inserir um `provider='memed'` ali (a) exige alterar o CHECK de `provider` e (b) arriscaria o dispatcher tentar tratar 'memed' como adapter de eventos. Tabela dedicada mantém o ciclo de vida e RLS limpos, sem tocar no caminho GHL.
- **Alternativas consideradas**:
  - _Reusar `tenant_integrations` (provider='memed')_: ganharia o helper `decryptCredentials` e a UI de config por registry — mas exige `ALTER ... CHECK` e acopla ao fan-out de eventos. Rejeitada pelo risco/acoplamento; a UI de config da Memed precisa ser custom de qualquer forma (igual ao GHL OAuth, que tem página própria).
  - _Credenciais em env/secret de plataforma_: contraria a decisão FR-003 (por clínica) e a constituição (segredos por tenant, não em env versionado).

## D2 — Autenticação e formato da API Memed

- **Decisão**: Cápsula `src/lib/core/integrations/memed/client.ts` com `fetch` nativo: `Accept: application/vnd.api+json`, `api-key`/`secret-key` **na query string**, `AbortSignal.timeout(5000)`. Base URL resolvida por `environment`: homologação `https://integrations.api.memed.com.br/v1`, produção `https://api.memed.com.br/v1`. Erros mapeados para erros de domínio (`ValidationError`/`UpstreamError`) com PII mascarada nos logs.
- **Rationale**: É o contrato documentado pela Memed; chaves na query exigem que toda chamada seja server-side (nunca no browser). `fetch`+timeout evita nova dependência (alinha "sem novas deps").
- **Alternativas**: cliente HTTP dedicado (axios) — rejeitado (dep desnecessária). Pôr chaves em header — não é o que a Memed aceita.

## D3 — `external_id` estável do prescritor

- **Decisão**: usar **`doctors.id` (UUID)** como `external_id` enviado à Memed. A correspondência local fica em `memed_prescribers` (1:1 com doctor por tenant).
- **Rationale**: `doctors.id` é estável e imutável; serve de chave idempotente para `POST/GET /usuarios` (a Memed aceita external_id como identificador). Evita inventar outro identificador.
- **Alternativas**: usar CPF como identificador na Memed — funciona para GET, mas external_id próprio é mais robusto a correções de CPF.

## D4 — Token do prescritor (JWT dinâmico)

- **Decisão**: endpoint **proxy** `GET /api/medicos/[id]/memed-token` que, para o profissional logado (self) ou admin, chama `GET /sinapse-prescricao/usuarios/{external_id}` na Memed e devolve **apenas** `attributes.token`. Nunca cacheamos chaves; o token é buscado a cada abertura da prescrição (a doc diz "recuperar o último token válido a cada uso").
- **Rationale**: cumpre FR-010 e SC-002 (zero segredo no front). Buscar a cada abertura é barato e evita lidar com expiração de cache.
- **Alternativas**: cachear o token em `memed_prescribers` — rejeitado: token expira e cachear aumenta superfície de vazamento sem ganho real.

## D5 — Modelo do registro de prescrição (append-only)

- **Decisão**: tabela **`prescription_records`** (uma linha por prescrição emitida) com campos imutáveis (tenant_id, appointment_id, patient_id, doctor_id, memed_prescription_id, issued_at) e um caminho **guardado** para marcar exclusão (`deleted_at`, `status` 'issued'→'deleted'). Trigger anti-`DELETE` e anti-`UPDATE` exceto a transição de exclusão (padrão dos triggers de imutabilidade já usados no projeto, ex. `appointment_completions`/0092). Emissão e exclusão também geram `log_audit_event`.
- **Rationale**: atende Princípios I (append-only por analogia) e II (auditabilidade). Não copiamos conteúdo clínico (medicamentos) — só metadados de rastreabilidade (FR-019, LGPD/minimização).
- **Alternativas**: tabela de eventos puramente append-only (uma linha por evento issued/deleted) — válida, mas "uma linha por prescrição + flag de exclusão guardada" é mais simples para a UI ("houve prescrição neste atendimento") e ainda imutável.

## D6 — Mapeamento de especialidade

- **Decisão**: guardar `memed_specialty_id` (nullable) em `memed_prescribers`, escolhido no momento de habilitar o prescritor a partir de um seletor que consome o catálogo Memed via proxy `GET /api/integracoes/memed/especialidades`. Sem correspondência ⇒ registra sem especialidade (não bloqueia).
- **Rationale**: especialidade é por-profissional; inline em `memed_prescribers` evita tabela extra. Atende FR-020/FR-021.
- **Alternativas**: tabela de de-para por tenant — overkill para o volume; pode evoluir depois.

## D7 — Carregamento do paciente no `setPaciente` (LGPD)

- **Decisão**: endpoint `GET /api/atendimentos/[id]/memed-paciente` (server-side, `requireRole` + escopo de tenant) que lê o paciente via RPC existente **`get_patient_for_tenant`** (decifra `_enc`) e retorna apenas os campos necessários ao `setPaciente` (nome, cpf, sexo, nascimento, telefone, email, endereço). Mapear `sex` ('feminino'/'masculino'/'intersexo') → formato Memed (M/F) na borda; bloquear com mensagem clara se faltar campo obrigatório (FR-014).
- **Rationale**: PII só decifrada no servidor e entregue ao usuário já autorizado àquele paciente (FR-013, Princípio III/LGPD).
- **Alternativas**: decifrar no cliente — impossível/insegnuro (chave fica no servidor).

## D8 — Frontend: carregamento do script e ciclo do MdHub

- **Decisão**: client component `prescrever-launcher.tsx` no atendimento: injeta o `<script>` da Memed (uma vez) com `data-token` obtido do proxy; aguarda evento `core:moduleInit`; envia `MdHub.command.send('setPaciente', …)`; abre com `MdHub.module.show('plataforma.prescricao')`; assina `prescricaoImpressa` (→ POST registro) e `prescricaoExcluida` (→ PATCH exclusão); chama `MdHub.command.send('logout')` ao desmontar/trocar de prescritor (recepção compartilhada, FR-015).
- **Rationale**: segue o ciclo documentado da Memed e o requisito de máquina compartilhada.
- **Alternativas**: iframe próprio — a Memed fornece o módulo; recriar é fora de escopo.

## D9 — RBAC por endpoint

- **Decisão**: `connect/disconnect` e `habilitar prescritor` = `admin`; `memed-token`, `memed-paciente`, `prescricoes` (registrar) = `profissional_saude` (dono do atendimento) e `admin`. Todos via `requireRole` server-side; negações logadas. Token proxy é self-scoped (um profissional só obtém token do próprio cadastro).
- **Rationale**: Princípio V + separação de responsabilidades.

## D10 — Conformidade e ambientes

- **Decisão**: `environment` por clínica em `tenant_memed_config`, default `staging`. Aceite de termo de responsabilidade (`terms_accepted_at`/`terms_accepted_by`) exigido antes de habilitar emissão em produção (FR-024). Checklist dos 5 requisitos vira critério de "pronto para produção" (US5), validável independentemente em homologação (chaves públicas da doc).
- **Rationale**: permite construir/validar tudo em homologação; produção só destrava após conformidade + aprovação Memed.
