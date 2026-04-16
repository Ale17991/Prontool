<!--
Sync Impact Report
==================
Version change: (template / unversioned) → 1.0.0
Bump rationale: MAJOR — initial ratification of the project constitution. All five
core principles, domain constraints, and governance rules are established for the
first time.

Modified principles:
- [PRINCIPLE_1_NAME] → I. Integridade Financeira Imutável (NON-NEGOTIABLE)
- [PRINCIPLE_2_NAME] → II. Auditabilidade Total de Preços (NON-NEGOTIABLE)
- [PRINCIPLE_3_NAME] → III. Isolamento Multi-Tenant
- [PRINCIPLE_4_NAME] → IV. Conformidade TUSS/ANS
- [PRINCIPLE_5_NAME] → V. Segurança por Perfil de Acesso (RBAC)

Added sections:
- Restrições de Domínio & Compliance (Section 2)
- Fluxo de Desenvolvimento & Quality Gates (Section 3)
- Governance

Removed sections: none (template placeholders replaced)

Templates requiring updates:
- ✅ .specify/templates/plan-template.md — Constitution Check gate references
  principles by ID; no structural change needed (principles I–V map into the
  existing placeholder "[Gates determined based on constitution file]").
- ✅ .specify/templates/spec-template.md — No structural change required; FRs can
  reference principle IDs (e.g., "FR-X: MUST NOT violate Principle I"). No edit
  needed.
- ✅ .specify/templates/tasks-template.md — No structural change required; audit
  trail, RBAC, and tenant-isolation tasks fit existing Foundational phase.
- ⚠ README.md / docs/quickstart.md — not present in repo; no action.

Follow-up TODOs:
- TODO(PROJECT_NAME_OFFICIAL): Confirm the official product name with stakeholders
  (current working name: "Faturamento Médico Homio"). Replace across docs once
  confirmed.
- TODO(RATIFICATION_DATE_STAKEHOLDER_SIGNOFF): 2026-04-16 reflects the drafting
  date; record formal stakeholder approval date if it differs.
-->

# Faturamento Médico Homio Constitution

## Core Principles

### I. Integridade Financeira Imutável (NON-NEGOTIABLE)

Todo valor financeiro registrado (preço aplicado a um atendimento, fatura emitida,
procedimento cobrado, ajuste, estorno) é **imutável após persistência**. O sistema
**MUST NOT** permitir `UPDATE` ou `DELETE` físico em registros financeiros
históricos. Correções **MUST** ser representadas como novos registros (ex.:
estorno, nota de crédito, fatura substitutiva) que referenciam o registro
original por chave estrangeira. Alterações em tabelas de preços vigentes **MUST**
criar uma nova versão com `valid_from`/`valid_to`; atendimentos passados
continuam vinculados à versão de preço ativa no momento do atendimento.

**Rationale**: Faturamento médico está sujeito a auditorias retroativas de
operadoras, ANS e fisco. Reescrever valores históricos destrói evidência, gera
divergência contábil e expõe a clínica a glosa, multa ou fraude. "Append-only"
é a única postura defensável em auditoria.

### II. Auditabilidade Total de Preços (NON-NEGOTIABLE)

Toda alteração em tabela de preço, procedimento, convênio ou regra de cobrança
**MUST** produzir uma entrada de trilha de auditoria contendo, no mínimo:
`ator` (ID de usuário autenticado), `timestamp UTC`, `tenant_id`, `entidade`,
`campo_alterado`, `valor_anterior`, `valor_novo`, `motivo` (texto obrigatório) e
`origem_da_requisição` (IP + user-agent). A trilha **MUST** ser armazenada em
storage append-only (tabela imutável ou log externo) e **MUST** sobreviver ao
`DELETE` lógico da entidade pai. Relatórios de auditoria **MUST** ser
exportáveis em CSV/JSON sem transformação que descarte dados.

**Rationale**: Sem rastreabilidade completa, a Principle I (imutabilidade) não é
verificável. Auditores exigem responder "quem mudou, quando, de quanto para
quanto, por quê" sem ambiguidade — qualquer campo ausente reduz o valor
probatório do log.

### III. Isolamento Multi-Tenant

Cada clínica é um `tenant` com isolamento lógico rígido. Toda entidade de
domínio (paciente, atendimento, fatura, preço, usuário) **MUST** carregar
`tenant_id` como coluna obrigatória e **MUST** ser filtrada por `tenant_id` em
100% das consultas. O sistema **MUST** aplicar isolamento em três camadas:
(a) middleware de autenticação que injeta `tenant_id` do token no contexto da
requisição; (b) Row-Level Security (RLS) ou equivalente no banco; (c) testes de
contrato que provam vazamento impossível entre tenants. Chaves primárias
**MUST** usar UUID, não inteiros sequenciais. Exportações, relatórios e
integrações (incluindo webhooks GHL/Homio) **MUST** validar escopo de tenant
antes de entregar qualquer payload.

**Rationale**: Vazamento de dados clínicos/financeiros entre clínicas é
violação de LGPD (dados sensíveis de saúde) e incidente de segurança crítico.
Defesa em camadas existe porque qualquer camada isolada falha eventualmente —
um WHERE esquecido, um JWT mal validado, um RLS desabilitado em migração.

### IV. Conformidade TUSS/ANS

Códigos de procedimento **MUST** seguir a Terminologia Unificada da Saúde
Suplementar (TUSS) publicada pela ANS. O sistema **MUST** manter o catálogo
TUSS versionado e sincronizado com a vigência oficial, rejeitando códigos
obsoletos em novos atendimentos (mantendo-os apenas para registros históricos
conforme Principle I). Tabelas de preço de convênio **MUST** mapear cada
procedimento para seu código TUSS vigente. Integrações com operadoras (TISS,
XML ANS) **MUST** validar schema oficial antes de transmissão. Divergências
entre catálogo local e publicação ANS **MUST** gerar alerta operacional, não
falha silenciosa.

**Rationale**: Cobrança com código TUSS incorreto ou obsoleto resulta em
glosa da operadora (perda direta de receita) e, em casos sistemáticos, em
sanção da ANS. Tratar o catálogo como dado externo autoritativo — não editável
por usuário da clínica — é condição para receber pelo que foi faturado.

### V. Segurança por Perfil de Acesso (RBAC)

Toda ação **MUST** ser autorizada por papel (role) antes da execução. Os
papéis mínimos definidos são: `admin` (configura tabelas de preço, gerencia
usuários, acessa auditoria), `financeiro` (emite/ajusta faturas, não altera
preço), `recepcionista` (consulta preços, agenda, registra atendimento — **MUST
NOT** criar ou modificar preços), `profissional_saude` (acessa prontuário de
pacientes do próprio tenant). Autorização **MUST** ser avaliada no servidor em
cada requisição; controles apenas de UI (ocultar botão) são insuficientes e
**MUST NOT** ser usados como mecanismo de segurança. Tentativas de ação
negadas **MUST** ser logadas na trilha de auditoria (Principle II).
Mudanças de papel **MUST** exigir usuário com papel `admin` do mesmo tenant.

**Rationale**: Separação de responsabilidades é controle interno básico — uma
recepcionista alterando preço no momento do atendimento é vetor clássico de
fraude. RBAC server-side também protege contra exploração direta de API
bypassando o frontend.

## Restrições de Domínio & Compliance

- **Persistência financeira**: append-only. `DELETE` físico em tabelas
  financeiras, de auditoria, ou de versões de preço é proibido. Triggers de
  banco **SHOULD** impedir `UPDATE`/`DELETE` diretos fora dos caminhos
  autorizados pela aplicação.
- **LGPD**: dados pessoais e de saúde **MUST** ser criptografados em repouso
  (CPF, nome, telefone, prontuário). Logs **MUST NOT** conter dados sensíveis
  em texto claro; use redaction/masking.
- **Integração GHL/Homio**: chamadas a APIs externas **MUST** incluir o
  `tenant_id` no contrato, ser idempotentes (ID externo de correlação), e ter
  retry com backoff. Tokens e segredos **MUST** ser armazenados em cofre
  (não em variáveis de ambiente versionadas).
- **Relógio**: todos os timestamps **MUST** ser UTC na persistência; conversão
  para fuso local acontece apenas na camada de apresentação.
- **Moeda**: valores **MUST** ser representados como inteiros em centavos
  (BRL), nunca como `float`. Conversões e totais **MUST** usar aritmética
  decimal.
- **Observabilidade**: operações de faturamento, alterações de preço e negações
  de autorização **MUST** emitir eventos estruturados (JSON) com `tenant_id`,
  `user_id`, `trace_id`.

## Fluxo de Desenvolvimento & Quality Gates

- **Revisão**: toda PR que toque código financeiro, RBAC, tenant scoping, ou
  catálogo TUSS **MUST** ter revisão aprovada por pelo menos um mantenedor com
  conhecimento do domínio; revisor **MUST NOT** ser o autor.
- **Testes obrigatórios**: funcionalidades que afetam preços, faturas, ou
  acesso multi-tenant **MUST** incluir (a) teste de contrato verificando
  imutabilidade, (b) teste de isolamento entre tenants (tentar acessar dados
  de outro tenant **MUST** falhar), (c) teste de autorização por papel para
  cada endpoint (cada papel testado contra cada ação).
- **Migrações de banco**: **MUST** ser reversíveis em dev; **MUST NOT** drop
  de tabelas ou colunas financeiras/auditoria em ambiente com dados de
  produção sem plano documentado de retenção.
- **Constitution Check**: cada PR referencia quais princípios toca; violações
  **MUST** ser justificadas no template de "Complexity Tracking" do plano ou
  rejeitadas.
- **Seeds/fixtures**: dados de teste **MUST NOT** reutilizar `tenant_id` ou
  códigos TUSS de produção.

## Governance

Esta constituição **supersede** quaisquer convenções informais, READMEs ou
práticas implícitas em desacordo. Em caso de conflito entre esta constituição e
outro documento do projeto, esta constituição prevalece até que uma emenda
formal seja ratificada.

**Procedimento de emenda**:
1. Proposta aberta como PR modificando `.specify/memory/constitution.md`,
   com descrição do princípio afetado, motivação e impacto.
2. Atualização obrigatória do Sync Impact Report no topo do arquivo.
3. Revisão por no mínimo um mantenedor com papel de governança;
   emendas MAJOR exigem aprovação explícita do patrocinador do produto.
4. Propagação: templates em `.specify/templates/` e documentação dependente
   **MUST** ser atualizados na mesma PR ou em PR de follow-up rastreado.

**Política de versionamento** (SemVer aplicado a governança):
- **MAJOR**: remoção ou redefinição incompatível de princípio; mudança que
  invalida PRs/feature specs existentes.
- **MINOR**: novo princípio, nova seção, ou expansão material de orientação.
- **PATCH**: esclarecimentos, correções de redação, refinamentos não-semânticos.

**Revisão de conformidade**: toda feature sob `/specs/###-*/` **MUST** rodar a
"Constitution Check" do `plan-template.md` antes de Phase 0 e novamente após
Phase 1. Violações sem justificativa no "Complexity Tracking" **MUST** bloquear
merge. Auditoria trimestral **SHOULD** amostrar PRs mergeadas para verificar
aderência a Principles I, II e V (os três com maior risco operacional).

Orientação de desenvolvimento em tempo de execução (agent-specific guidance)
vive fora deste arquivo; esta constituição trata apenas de princípios
invariantes.

**Version**: 1.0.0 | **Ratified**: 2026-04-16 | **Last Amended**: 2026-04-16
