# Feature Specification: Prontuário Clínico unificado — Timeline + Quick-View

**Feature Branch**: `019-prontuario-timeline-quickview`
**Created**: 2026-05-20
**Status**: Draft
**Input**: User description: "Transformar a área do paciente (`/operacao/pacientes/[id]`) de cards verticais empilhados em uma experiência de prontuário com (a) sidebar sticky de dados clínicos críticos e (b) timeline cronológica unificada misturando todos os eventos clínicos e financeiros. Escopo é UX-only — não muda schema, RLS, RPCs nem políticas de auditoria. Objetivo: equiparar a percepção visual do produto a iClinic/Amplimed/Feegow consumindo os mesmos dados que já existem."

## Clarifications

### Session 2026-05-20

- Q: O bloco "Diagnósticos" da sidebar deve mostrar quais status? → A: `ativo` + `em_acompanhamento` (com badge sutil distinguindo); `resolvido` continua só na timeline.
- Q: Como apresentar o autor de cada evento na timeline? → A: Nome resolvido via `doctors.full_name` → `user_profile.display_name` → fallback para 8 chars do `user_id`. Resolução em batch, não por evento.
- Q: O filtro "Exames" deve agrupar arquivos + sinais vitais ou separar? → A: Separar em "Exames/Anexos" (só arquivos) e "Sinais vitais" (só medições). Registros de texto livre ficam só em "Tudo" por enquanto.
- Q: Estratégia de atualização da sidebar/timeline após salvar em sheet — optimistic update ou server-confirmed? → A: Server-confirmed via `router.refresh()` (RSC re-render), consistente com o padrão atual do app. Optimistic update fica fora do escopo.
- Q: Onde ficam as edições estruturadas (endereço, lembretes, plano, plano terapêutico)? → A: Em aba secundária "Cadastro" na coluna direita (ao lado da aba "Clínico"). URL reflete a aba via `?tab=cadastro`. Sidebar ganha botão "Editar" no bloco Identidade como atalho.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Consulta de retorno com contexto sempre visível (Priority: P1)

Em um atendimento de retorno, o profissional de saúde abre a ficha do paciente e precisa, ao mesmo tempo, (a) consultar dados clínicos críticos para decidir conduta (alergias, diagnósticos ativos, última pressão arterial, plano de saúde) e (b) procurar a evolução clínica anterior para entender onde parou o tratamento. Hoje, esses dados estão espalhados em cards verticais distintos que exigem rolagem; o profissional perde o contexto da alergia/diagnóstico ao rolar até a evolução. Após esta feature, os dados críticos ficam permanentemente visíveis em uma sidebar à esquerda enquanto a timeline de eventos rola à direita, eliminando o "perde-contexto-ao-rolar".

**Why this priority**: É o ganho de UX que justifica a feature inteira. Sem isso, a percepção do produto continua sendo "ficha em cards" — equivalente ao que o profissional já consegue (rolar para ver). Esta história, isoladamente, já entrega o valor central: profissional vê o que precisa sem rolar.

**Independent Test**: Abrir um paciente que tenha pelo menos 1 alergia, 1 diagnóstico ativo, 1 medição de sinais vitais, 1 evolução SOAP antiga e 1 atendimento. Rolar a página até o final da timeline. Verificar que (1) avatar, contato, plano, alergias, CIDs ativos e última medição vital permanecem visíveis durante todo o rolamento; (2) a timeline mostra os eventos clínicos e financeiros em ordem cronológica decrescente.

**Acceptance Scenarios**:

1. **Given** um paciente com 1 alergia "grave" cadastrada, **When** o profissional abre a ficha e rola até o final da lista de eventos, **Then** o chip "Penicilina · Grave" continua visível na sidebar sticky em todo momento.
2. **Given** um paciente com 2 diagnósticos `ativo`, 1 `em_acompanhamento` e 1 `resolvido`, **When** a ficha carrega, **Then** os 2 `ativo` e o 1 `em_acompanhamento` aparecem na sidebar (com badge sutil distinguindo `em_acompanhamento`); o `resolvido` continua acessível apenas na timeline e na seção de edição.
3. **Given** um paciente sem nenhuma alergia, **When** a ficha carrega, **Then** o bloco "Alergias" da sidebar não é renderizado (não aparece como "Nenhuma alergia" — ele simplesmente some, para reduzir ruído visual).
4. **Given** um paciente com 3 medições de sinais vitais (mais recente há 7 dias), **When** a ficha carrega, **Then** a sidebar exibe a medição mais recente com PA, FC, peso e IMC + classificação ("Normal" / "Sobrepeso" / etc.).
5. **Given** um paciente anonimizado por LGPD, **When** a ficha carrega, **Then** a sidebar mostra apenas o aviso de anonimização (sem alergias, CIDs, contato, vitais), e a timeline mostra apenas eventos financeiros — comportamento atual preservado.

---

### User Story 2 - Registrar evolução sem perder a timeline (Priority: P2)

Durante uma consulta, o profissional precisa registrar uma nova evolução SOAP, uma nova medição de sinais vitais ou aplicar uma anamnese, e simultaneamente consultar evoluções anteriores na timeline para comparar conduta. Hoje, ao clicar em "Nova evolução", o formulário expande no meio da página e empurra o conteúdo, fazendo o profissional perder a posição de rolagem na timeline. Após esta feature, todos os formulários de criação abrem em um painel lateral (sheet) sobre a tela, mantendo a timeline visível atrás, e fechá-lo retorna o profissional exatamente onde estava.

**Why this priority**: Diferenciação de UX que não bloqueia o uso da feature, mas eleva substancialmente a sensação de produto profissional. É o que mais aproxima a experiência da de iClinic/Amplimed.

**Independent Test**: Abrir paciente, rolar até a 5ª evolução antiga, clicar em "Nova evolução" na sidebar. Verificar que (1) o sheet abre por cima sem mudar a posição da timeline; (2) os campos S/O/A/P + busca CID-10 + envio funcionam exatamente como hoje; (3) após salvar e fechar, a nova evolução aparece no topo da timeline e a posição de rolagem original é preservada.

**Acceptance Scenarios**:

1. **Given** o profissional está rolando a timeline e clica em "Nova evolução" na sidebar, **When** o sheet abre, **Then** a timeline atrás não muda de posição.
2. **Given** o sheet de nova evolução está aberto, **When** o profissional pressiona `Esc`, **Then** o sheet fecha sem salvar e a posição da timeline é preservada.
3. **Given** o profissional preenche e salva uma nova evolução SOAP, **When** o sheet fecha, **Then** o novo registro aparece como o primeiro item da timeline e a sidebar atualiza eventuais diagnósticos derivados de CIDs vinculados.
4. **Given** o profissional aplica uma anamnese via sheet, **When** salva, **Then** a anamnese aparece na timeline como evento do tipo "Anamnese", expansível inline (mesmo conteúdo de hoje, mesmo `AnamneseView`).
5. **Given** uma alergia "grave" é cadastrada via sheet, **When** o sheet fecha, **Then** a alergia aparece imediatamente como chip na sidebar (sem reload da página).
6. **Given** o RBAC nega o uso de uma ação (ex.: recepcionista tentando registrar sinal vital), **When** a sidebar carrega, **Then** o botão "Registrar vital" não aparece (mesmas regras atuais de `can(role, ...)`).

---

### User Story 3 - Filtrar a timeline por tipo de evento (Priority: P2)

A timeline mistura eventos heterogêneos (anamnese, evolução SOAP, texto livre, arquivo, sinal vital, atendimento, pagamento). Em pacientes com longo histórico (>30 eventos), o profissional precisa filtrar para encontrar rapidamente "só as evoluções" ou "só os exames" sem rolar uma lista densa. Esta feature entrega chips de filtro no topo da timeline.

**Why this priority**: Quality-of-life importante para pacientes crônicos, mas a timeline ainda é útil sem ele em pacientes com poucas entradas.

**Independent Test**: Abrir paciente com pelo menos 1 evento de cada tipo. Clicar em "Evoluções". Verificar que só evoluções SOAP aparecem. Clicar em "Tudo". Verificar que o conjunto completo retorna.

**Acceptance Scenarios**:

1. **Given** a timeline mostra 20 eventos de tipos variados, **When** o profissional clica no chip "Atendimentos", **Then** apenas os eventos de atendimento permanecem visíveis e a contagem total exibida reflete só esse subconjunto.
2. **Given** um filtro está ativo, **When** o profissional clica em "Tudo", **Then** o filtro é limpo e todos os eventos voltam.
3. **Given** o profissional aplica um filtro que resulta em 0 eventos, **When** a timeline renderiza, **Then** mostra mensagem "Nenhum evento neste filtro" com botão "Limpar filtro".

---

### User Story 4 - Uso em dispositivo móvel (Priority: P3)

A clínica pode ter um profissional consultando a ficha em tablet/celular durante atendimento domiciliar ou em consultório sem desktop. Em telas estreitas, a sidebar não cabe ao lado da timeline. Esta feature entrega um layout responsivo: em telas <768px, a quick-view colapsa em um cabeçalho compacto colapsável no topo, a timeline ocupa toda a largura, e os botões de ação ficam fixos no rodapé (estilo FAB).

**Why this priority**: Cenário de uso real mas minoritário; profissionais em desktop são a maioria. Pode ser entregue após P1+P2 estarem estáveis.

**Independent Test**: Abrir a mesma ficha em uma viewport de 375x812 (iPhone 13). Verificar que (1) o topo mostra um cabeçalho compacto com avatar+nome+idade e botão "expandir" que abre os detalhes da quick-view; (2) a timeline ocupa toda a largura; (3) os botões de ação (Nova evolução, Anamnese, Vital, Imprimir) ficam fixos no rodapé, sempre acessíveis ao rolar.

**Acceptance Scenarios**:

1. **Given** a ficha é aberta em viewport ≤767px de largura, **When** a página carrega, **Then** a sidebar não aparece como coluna lateral, e sim como cabeçalho colapsável no topo.
2. **Given** o cabeçalho mobile está colapsado, **When** o profissional toca em "Ver detalhes do paciente", **Then** os blocos da quick-view (alergias, CIDs, vital, financeiro) expandem inline.
3. **Given** o profissional está rolando a timeline em mobile, **When** rola para baixo, **Then** a barra inferior com os 4 botões de ação permanece visível.

---

### Edge Cases

- **Paciente recém-criado sem nenhum evento**: timeline mostra mensagem "Sem eventos clínicos ainda" com convite a registrar primeira anamnese/evolução; sidebar mostra apenas avatar+contato+plano (sem blocos de alergia, CID, vital, financeiro).
- **Paciente anonimizado (LGPD)**: sidebar mostra apenas aviso de anonimização; timeline mostra apenas eventos financeiros (consistente com renderização atual).
- **Falha em uma das fontes da timeline** (ex.: tabela `vital_signs` não acessível): a página continua renderizando os outros tipos; admin vê o failures card no topo (mesmo padrão atual de `try/catch` por seção); para não-admin, o erro é silencioso e o tipo ausente simplesmente não aparece na timeline.
- **Mais de 500 eventos**: a primeira renderização carrega os 200 mais recentes; um botão "Carregar mais eventos antigos" no final da timeline busca em batches. (Pode ser entregue depois — o uso atual não passa de 50 atendimentos no `select`, então mantemos o mesmo limite até P3.)
- **Sheet aberto e o usuário navega para outro paciente**: o sheet deve fechar automaticamente para não inserir dados no paciente errado.
- **Botão de ação clicado por usuário sem permissão**: o botão não deve aparecer (RBAC client-side), e o endpoint continua validando server-side (defesa em profundidade — comportamento atual).
- **Mobile: cabeçalho colapsado quando há alergia "grave"**: o cabeçalho compacto deve mostrar um indicador visual (ex.: ícone vermelho) sinalizando que há alergia grave, mesmo sem expandir, para que o profissional não prescreva sem ver.

## Requirements *(mandatory)*

### Functional Requirements

#### Layout e navegação

- **FR-001**: A página `/operacao/pacientes/[id]` MUST ser apresentada em layout de duas colunas em viewports ≥768px: coluna esquerda fixa (sidebar quick-view), coluna direita rolável com duas abas no topo ("Clínico" — timeline + filtros; "Cadastro" — edições estruturadas). Aba padrão é "Clínico".
- **FR-002**: Em viewports <768px, a sidebar MUST colapsar em um cabeçalho compacto no topo, com toggle para expandir os detalhes inline.
- **FR-003**: A sidebar quick-view MUST permanecer visível (sticky) durante toda a rolagem da timeline em desktop.
- **FR-004**: Em mobile, os botões de ação (Nova evolução, Nova anamnese, Registrar vital, Imprimir prontuário) MUST ficar em uma barra fixa no rodapé, sempre visível durante a rolagem.

#### Quick-view (sidebar)

- **FR-005**: A sidebar MUST exibir, na ordem de cima para baixo, os blocos: identidade (avatar + nome + idade + CPF), contato (telefone + WhatsApp + email), plano de saúde, alergias ativas, diagnósticos ativos, última medição vital, resumo financeiro, ações rápidas.
- **FR-006**: Blocos vazios (sem dados) MUST ser ocultos, não renderizados como "—" ou "Nenhum". Exceção: o bloco "Identidade" sempre aparece.
- **FR-007**: O bloco "Alergias" MUST mostrar cada alergia como chip colorido por severidade (leve = warning, moderada = laranja, grave = alert) e MUST mostrar no máximo 5 alergias visíveis, com "+N mais" se houver mais.
- **FR-008**: O bloco "Diagnósticos" MUST mostrar registros com status `ativo` e `em_acompanhamento`, distinguindo-os por badge sutil (ex.: ponto colorido ou variante de chip). Diagnósticos `resolvido` ficam acessíveis apenas via timeline e modal de edição. Ordenação: `ativo` primeiro, depois `em_acompanhamento`.
- **FR-009**: O bloco "Última medição vital" MUST exibir PA (sistólica/diastólica), frequência cardíaca, peso (em kg, derivado dos gramas) e IMC com classificação, com a data da medição.
- **FR-010**: O bloco "Resumo financeiro" MUST mostrar 3 linhas: Recebido, Pendente, Última consulta paga em (ou similar — sem mudar o cálculo, reutilizar `summary` já existente).
- **FR-011**: O bloco "Ações rápidas" MUST renderizar apenas os botões cujas ações o profissional logado tem permissão para executar (via funções RBAC existentes).

#### Timeline (coluna direita)

- **FR-012**: A timeline MUST mesclar eventos das fontes: `clinical_records` (anamnese, evolução, texto, arquivo), `vital_signs`, `appointments_effective`, pagamentos (`patient_payments` ou estrutura equivalente já consumida por `listPaymentsForPatient`).
- **FR-013**: Cada evento na timeline MUST exibir: ícone do tipo, label do tipo, data/hora formatada, **autor resolvido por nome** (preferência: `doctors.full_name` quando o `created_by` corresponde a um `doctors.user_id`; fallback: `user_profile.display_name`; último fallback: 8 primeiros chars do `user_id` para usuários migrados/deletados), e conteúdo expansível inline.
- **FR-013a**: A resolução de nome do autor MUST ser feita em batch no carregamento da página (single SELECT com `IN (...)` ou map construído a partir do `doctorsList` já carregado), nunca uma query por evento.
- **FR-014**: A ordem padrão MUST ser cronológica decrescente (mais recente primeiro), com a data do evento sendo: para `clinical_records`, `created_at`; para `vital_signs`, `measured_at`; para `appointments`, `appointment_at`; para pagamentos, data do pagamento.
- **FR-015**: Cada item de evolução SOAP, anamnese, vital ou atendimento expansível MUST exibir o conteúdo completo usando os componentes atuais (`SoapView`, `AnamneseView`, layout de vitals, layout de appointments).
- **FR-016**: A timeline MUST exibir chips de filtro no topo: "Tudo", "Evoluções", "Anamneses", "Exames/Anexos" (apenas arquivos enviados), "Sinais vitais" (medições de PA/FC/peso/etc.), "Atendimentos", "Pagamentos". Apenas um filtro pode estar ativo por vez. Registros de texto livre (`type='texto'`) entram em "Tudo" e podem aparecer em "Evoluções" se o usuário tipicamente os usa como evolução — alternativa: chip adicional "Notas" só se houver feedback de uso (pode ser deferido para iteração futura).
- **FR-017**: Quando um filtro estiver ativo e resultar em 0 eventos, a timeline MUST exibir mensagem "Nenhum evento neste filtro" com botão "Limpar filtro".
- **FR-018**: A timeline MUST suportar pelo menos 200 eventos sem degradação perceptível de rolagem; eventos além de 200 podem ser carregados sob demanda.

#### Sheets de criação

- **FR-019**: Os formulários de criação (nova evolução SOAP, nova anamnese, novo sinal vital, nova alergia, novo antecedente, novo diagnóstico, novo registro texto livre, upload de arquivo) MUST abrir em painéis laterais (sheets) sobrepostos, sem alterar a posição de rolagem da timeline atrás.
- **FR-020**: Cada sheet MUST poder ser fechado por: clique no botão "X", tecla `Esc`, clique no overlay, ou após salvamento bem-sucedido.
- **FR-021**: Sheets MUST reutilizar a lógica de validação, submissão e geração de payload dos componentes atuais (`NewEvolutionForm`, `NewAnamneseForm`, etc.) — não há reescrita de validação.
- **FR-022**: Após salvar com sucesso em um sheet (HTTP 2xx do endpoint), a timeline MUST refletir o novo evento e a sidebar MUST atualizar blocos derivados (novo diagnóstico em "Diagnósticos", nova alergia em "Alergias", nova medição em "Última medição vital"), via `router.refresh()` do Next.js (RSC re-render do servidor) — sem reload completo de página, mas com confirmação do servidor antes de exibir. Padrão consistente com `clinical-records-section.tsx`, `medical-history-section.tsx`, `vital-signs-section.tsx` atuais. **Optimistic update fica fora desta feature**.

#### Edição inline preservada

- **FR-023**: A coluna direita MUST ter duas abas no topo: **"Clínico"** (padrão, contém a timeline com seus filtros) e **"Cadastro"** (contém as edições estruturadas: endereço via `AddressEditor`, opt-in lembretes via `RemindersOptInToggle`, plano de saúde via `PatientPlanEditor`, plano terapêutico via `TreatmentStepsSection`). A aba "Cadastro" MUST renderizar os componentes existentes empilhados verticalmente, sem reescrita. A aba ativa MUST ser refletida na URL via query param (`?tab=cadastro`) para permitir deep-link e voltar do navegador.
- **FR-023a**: A sidebar não precisa de botão dedicado "Editar dados cadastrais" — as abas no topo da coluna direita já dão acesso visível. Mas a sidebar MUST conter um pequeno botão "Editar" no bloco "Identidade" como atalho para `?tab=cadastro`.
- **FR-024**: O botão "Imprimir prontuário" (atual `PrintChartButton`) MUST continuar acessível pela sidebar e gerar o mesmo PDF de hoje.
- **FR-025**: O botão "Voltar para pacientes" e o failures card de admin MUST permanecer no topo da página em todos os layouts (desktop e mobile).

#### Anonimização e RBAC

- **FR-026**: Para pacientes com `anonymizedAt != null`, a sidebar MUST mostrar apenas o bloco de aviso de anonimização; a timeline MUST mostrar apenas eventos financeiros (consistente com o comportamento atual).
- **FR-027**: As regras de quem pode ler/escrever cada tipo de registro MUST permanecer idênticas às atuais (`can(role, …)`, gates em rotas API). Esta feature NÃO altera RBAC.
- **FR-028**: Botões de ação na sidebar MUST ser renderizados apenas se o profissional logado tem permissão (defesa em profundidade — endpoint continua validando server-side).

#### Performance e acessibilidade

- **FR-029**: A página MUST renderizar dados iniciais via SSR (Server-Side Rendering), mantendo o padrão atual de `getSession` + `getPatient` + `Promise.all` por seção.
- **FR-030**: Sheets MUST atender requisitos básicos de acessibilidade: trap de foco, retorno de foco ao botão que abriu, anúncio de abertura para leitores de tela, e fechamento via `Esc`.
- **FR-031**: A timeline MUST permitir navegação por teclado: `Tab` percorre eventos, `Enter` expande/colapsa, `Esc` colapsa todos.

### Key Entities

Esta feature consome entidades existentes e NÃO cria novas. Para referência:

- **TimelineEvent** *(tipo virtual, não persistido)*: união discriminada com `kind ∈ { 'anamnese', 'evolucao', 'texto', 'arquivo', 'vital', 'appointment', 'payment' }`, `occurredAt: string`, `source: ClinicalRecordRow | VitalSignsDTO | AppointmentRow | PaymentRecordDTO`. Construído em runtime pelo nova lib `core/patient-timeline/`.
- **QuickViewSnapshot** *(tipo virtual, não persistido)*: agrega os dados que a sidebar precisa em uma única estrutura (alergias ativas, diagnósticos ativos, última medição vital, resumo financeiro), montada a partir das fontes existentes sem nova query.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Em uma consulta de retorno, o profissional consegue ver simultaneamente as alergias do paciente e a última evolução SOAP sem precisar rolar a tela, em qualquer viewport ≥1024px. Hoje isso requer ao menos 2 rolagens.
- **SC-002**: O tempo para registrar uma nova evolução SOAP, medido do clique em "Nova evolução" até confirmação de salvamento, MUST ser ≤30 segundos para um caso simples (texto curto S+A, sem CID), preservando o mesmo throughput de hoje.
- **SC-003**: 100% das ações que o profissional consegue executar hoje na ficha (criar evolução, anamnese, vital, alergia, antecedente, diagnóstico, registro texto, upload, editar endereço, editar opt-in, editar plano, editar plano terapêutico, imprimir, anonimizar) MUST continuar acessíveis após o redesign.
- **SC-004**: Em uma pesquisa qualitativa com ≥3 profissionais de saúde reais (médicos da carteira), pelo menos 80% MUST descrever a nova interface como "mais profissional" ou "mais parecida com [iClinic/Amplimed]" do que a anterior.
- **SC-005**: O tempo entre carregar a página e ter dados visíveis na sidebar e nos primeiros 5 eventos da timeline MUST ser ≤2 segundos em conexão 3G boa (300kbps). Não há regressão em relação à página atual.
- **SC-006**: Zero migration nova, zero alteração em libs `lib/core/*` exceto a adição de `lib/core/patient-timeline/` que apenas mescla dados. Pode ser auditado por `git diff` no final do PR.
- **SC-007**: Para pacientes com >50 eventos, a rolagem da timeline MUST ser fluida (≥50fps) em hardware mediano (notebook intermediário).
- **SC-008**: A bateria de regressão (acceptance scenarios das US1, US2, US3, US4 + edge cases) MUST passar 100% antes do merge.

## Assumptions

- **A-001**: Os profissionais da clínica usam predominantemente desktop ou notebook (viewport ≥1024px) durante atendimento; mobile é caso secundário (justificando P3 para responsividade).
- **A-002**: O volume típico de eventos por paciente é <50; o limite atual de 50 atendimentos no `select` já reflete o uso real e é mantido.
- **A-003**: Os componentes existentes (`SoapView`, `AnamneseView`, `VitalSignsSection`, formulários) são suficientemente isolados para serem reembalados em sheets sem refactor de lógica — apenas o invólucro muda.
- **A-004**: O design system atual (016 — shadcn/ui + paleta designer) já tem `Sheet`, `Dialog`, `Tabs` e os tokens semânticos necessários (`success-bg`, `info-bg`, `warning-foreground`, `alert`). Não é necessário adicionar dependências.
- **A-005**: A nomenclatura "quick-view" e "timeline" é interna; o produto pode usar termos em português ("painel do paciente", "linha do tempo") na UI sem perda funcional.
- **A-006**: Pacientes anonimizados continuam sendo um caso minoritário, e a renderização restrita atual já é considerada correta — esta feature não tenta melhorá-la.
- **A-007**: O failures card de admin (try/catch por seção) é considerado parte fundamental do contrato de robustez; esta feature deve preservá-lo, não substituí-lo.
- **A-008**: A feature é puramente client+SSR — nenhuma rota `/api` nova, nenhuma RPC nova, nenhuma migration. Auditoria de eventos clínicos continua via `audit_log` nos endpoints existentes.
- **A-009**: Está dentro do escopo desta feature consolidar o `summary` financeiro do paciente em uma estrutura única para a sidebar (`QuickViewSnapshot`), mas apenas como agregação client-side — sem mudar `listPaymentsForPatient`.

## Out of Scope (não-objetivos explícitos)

- **OS-001**: Prescrição digital (Memed/Nexodata) — feature separada futura.
- **OS-002**: Telemedicina (videochamada nativa) — feature separada futura.
- **OS-003**: IA copiloto na evolução (transcrição/sugestão de CID) — feature separada futura.
- **OS-004**: Atestados / declarações / solicitação de exames com assinatura ICP-Brasil — feature separada futura.
- **OS-005**: Mudança no formato do PDF de prontuário (`prontuario-pdf.tsx`) — mantém-se idêntico.
- **OS-006**: Mudança nas regras de RBAC (`can(role, …)`) — preserva-se.
- **OS-007**: Mudança em schema, RLS, RPCs, triggers ou políticas de auditoria — zero migration.
- **OS-008**: Mudança no fluxo de anonimização LGPD — preserva-se.
- **OS-009**: Mudança nas APIs `/api/pacientes/[id]/*` existentes — todas continuam sendo consumidas como estão.
- **OS-010**: Internacionalização da UI — permanece em pt-BR.
