# Feature Specification: Rollout do Design System Prontool

**Feature Branch**: `015-design-system-rollout`
**Created**: 2026-05-18
**Status**: Draft
**Input**: User description: "Aplicar o Design System documentado no relatório UI/UX ao código do Prontool — tokens semânticos, escala tipográfica, badges padronizados, status de agendamento com cor+ícone+label, sidebar com cores exatas, remoção de dark mode não funcional e migração de Inter para next/font/google."

## User Scenarios & Testing _(mandatory)_

### User Story 1 — Identificação inequívoca do status de uma consulta (Priority: P1)

Uma recepcionista abre a agenda do dia e precisa, em menos de três segundos, distinguir quais consultas estão **confirmadas**, quais aguardam confirmação, quais já foram atendidas e quais o paciente faltou. Hoje a distinção depende fortemente de cor; em telas com brilho alto, em monitores de baixa qualidade e para colegas com daltonismo, o sistema é ambíguo. O resultado clínico-operacional é confirmação manual redundante, atrasos e risco de "no-show" não detectado.

**Why this priority**: Este é o uso mais frequente do sistema (acessado dezenas de vezes por dia em cada clínica) e o de maior risco operacional. A pesquisa de mercado mostrou que (a) cor sozinha não atende WCAG, (b) ~300M pessoas têm daltonismo, e (c) "three-second rule" é heurística validada para healthcare UI. Sozinha, esta história já entrega uma melhoria perceptível para todos os usuários.

**Independent Test**: Pode ser testada isoladamente abrindo a agenda em qualquer perfil (médico, recepcionista, gerente), aplicando filtro de simulação de daltonismo (deuteranopia/protanopia) no navegador e verificando que cada estado de consulta continua distinguível por **forma + ícone + texto**, não apenas cor.

**Acceptance Scenarios**:

1. **Given** uma agenda com consultas nos sete estados possíveis (agendada, confirmada, em atendimento, concluída, no-show, cancelada, estornada), **When** o usuário visualiza a agenda em modo daltonismo simulado, **Then** todos os estados continuam distinguíveis sem depender da cor.
2. **Given** uma consulta agendada, **When** a recepcionista olha o card por menos de 3 segundos, **Then** consegue identificar o estado pelo ícone e label, mesmo com tela em alta luminosidade.
3. **Given** uma consulta em atendimento, **When** exibida na lista, **Then** apresenta um indicador visual de "em curso" (pulsação ou marcador) distinto dos demais estados.
4. **Given** uma consulta cancelada e uma no-show, **When** vistas lado a lado, **Then** apresentam **padrões visuais distintos** (não só cor) — uma com borda tracejada/X, outra com hachura/UserX.
5. **Given** o mesmo componente de status, **When** usado em qualquer outra tela (ficha do paciente, relatórios, dashboard), **Then** apresenta exatamente o mesmo vocabulário visual.

---

### User Story 2 — Linguagem visual consistente para todas as etiquetas do sistema (Priority: P2)

Um gerente cadastra um novo médico e percebe que o badge "ativo" do médico tem aparência diferente do badge "ativo" do paciente, que por sua vez difere do badge "agendado" no plano. Cada tela do sistema cria sua própria estilização inline, gerando inconsistência percebida como desleixo profissional pelos próprios clientes da clínica quando veem o sistema. Há ao menos dez variantes informais espalhadas pelo código.

**Why this priority**: Impacto direto na percepção de qualidade do produto, mas o uso individual de cada badge é menor que o de status de agendamento. Pode ir após o P1 sem perda de valor — cada padronização entrega ganho marginal.

**Independent Test**: Pode ser testada percorrendo as principais telas (pacientes, médicos, planos de saúde, formas de pagamento, configurações, relatórios) e confirmando que todos os badges com mesma semântica (ex.: "ativo") têm exatamente a mesma aparência.

**Acceptance Scenarios**:

1. **Given** dois badges "ativo" em telas diferentes, **When** comparados pixel-a-pixel, **Then** apresentam exatamente as mesmas cores de fundo, texto e espaçamentos.
2. **Given** o conjunto de variantes documentado (ativo, agendado, pendente, cancelado, inativo, não-listado, personalizado, comissionado, fixo, liberal), **When** desenvolvedor procura por badges hardcoded no código, **Then** não encontra estilização ad-hoc — todos passam por um único componente.
3. **Given** uma nova tela é criada, **When** ela precisa exibir status, **Then** existe um componente único e óbvio para reaproveitar.

---

### User Story 3 — Base tipográfica e cromática reutilizável (Priority: P2)

Um desenvolvedor implementa uma nova tela de relatório e precisa decidir: que tamanho de fonte usar pro título? Que cor usar pra "consulta atrasada"? Hoje cada um decide individualmente, gerando dispersão. Falta um catálogo de tokens semânticos (`success`, `warning`, `info`, `alert`) e uma escala tipográfica (`display`, `h1`, `h2`, `h3`, `body`, `caption`, `mono`) que permita decisões rápidas e consistentes.

**Why this priority**: Habilitador estrutural — sem ele, P1 e P2 viram hardcode. Mas o usuário final não percebe diretamente; ganho é via consistência nas histórias anteriores e velocidade de desenvolvimento futuro.

**Independent Test**: Pode ser verificada inspecionando o arquivo central de estilos: tokens nomeados existem, foregrounds correspondentes existem, são distintos entre si (em particular `accent` distinto de `secondary`), e cada um produz contraste mínimo WCAG AA contra o foreground previsto.

**Acceptance Scenarios**:

1. **Given** o catálogo de tokens (`success`, `warning`, `info`, `alert` + foregrounds + `accent` corrigido), **When** consultado, **Then** cada par cor/foreground apresenta contraste ≥ 4.5:1.
2. **Given** a escala tipográfica documentada, **When** um desenvolvedor precisa de "texto auxiliar", **Then** encontra `text-caption` como classe utilitária estável.
3. **Given** todo o sistema, **When** auditado, **Then** nenhum texto fica abaixo de 12px (exceção: rótulos de métricas em 11px conforme decisão da escala).
4. **Given** o token `accent`, **When** comparado com `secondary`, **Then** são visualmente distintos e cumprem papéis diferentes (seleção/hover vs. ação secundária).

---

### User Story 4 — Identidade visual da sidebar fiel ao relatório (Priority: P3)

A sidebar é o elemento de navegação mais persistente do produto e ancorará a marca em capturas de tela usadas em marketing/onboarding. Ela já existe em estado funcional, mas há divergências entre as cores aplicadas e as cores documentadas no relatório de Design System (item ativo, separadores, labels de seção, link "Trocar clínica"). Sem alinhamento, screenshots de divulgação ficam inconsistentes com material de apoio.

**Why this priority**: Visual importa, mas a sidebar **já funciona**. O ajuste é de fidelidade estética, não de bloqueio operacional.

**Independent Test**: Pode ser testada inspecionando a sidebar contra a tabela de cores do relatório, com tolerância zero para divergência.

**Acceptance Scenarios**:

1. **Given** a sidebar em qualquer página do dashboard, **When** inspecionada com DevTools, **Then** as sete cores documentadas (fundo, texto, item ativo fundo/texto, "Trocar clínica", separadores, labels de seção) batem exatamente com o relatório.
2. **Given** um item de menu ativo, **When** exibido, **Then** tem fundo `rgba(37,99,235,0.2)` e texto `#93C5FD`.
3. **Given** o link "Trocar clínica" (quando o usuário tem múltiplos tenants), **When** exibido, **Then** tem cor `#38BDF8`.

---

### User Story 5 — Primeiro carregamento sem flash de fonte e sem peças mortas (Priority: P3)

Um médico abre o sistema em uma conexão 3G no consultório. Hoje o navegador baixa Inter via CDN antes de pintar a interface, gerando "flash of unstyled text" (FOUT) e atrasando o LCP. Além disso, o código declara `darkMode: ['class']` no Tailwind, mas não há nenhuma variável dark implementada — quem leia o config se confunde achando que existe suporte parcial.

**Why this priority**: Performance percebida e higiene de código. Benefício real, mas não bloqueia uso atual.

**Independent Test**: Pode ser testada medindo LCP e CLS antes/depois em conexão emulada 3G; e inspecionando a configuração para confirmar que dark mode foi removido ou explicitamente desabilitado.

**Acceptance Scenarios**:

1. **Given** o primeiro carregamento do dashboard em conexão lenta, **When** a página renderiza, **Then** não há flash visível de fonte default sendo substituída por Inter.
2. **Given** a configuração do design system, **When** inspecionada, **Then** não há mais menção a `darkMode: ['class']` nem blocos `.dark { ... }` órfãos.
3. **Given** auditoria de network, **When** o app carrega, **Then** nenhuma requisição é feita a `fonts.googleapis.com` em runtime.

---

### Edge Cases

- **Componente shadcn herda `--accent` antigo**: ao mudar `--accent` de `slate-100` para azul soft, componentes shadcn que usavam accent como simples "hover cinza" passam a ter hover azul. Aceitável (e desejado: hover passa a sinalizar "ação primária"), mas precisa varredura para confirmar que nenhuma tela tinha lógica que exigia accent neutro.
- **Tokens não usados ainda**: `--alert` é introduzido sem consumidor imediato. Manter como token reservado, documentar uso pretendido (alertas clínicos críticos, distintos de "deletar"), evitar que vire dead-code.
- **Badge hardcoded escondido em página obscura**: scripts/relatórios com estilo inline podem escapar do refactor. Definir critério de aceite por inventário, não por presunção.
- **Texto inferior a 12px em componentes de terceiros**: bibliotecas como charts (ex.: tooltips) podem ter padrões internos abaixo de 12px. Considerar essas exceções documentadas, não falhas.
- **Dark mode chamado em algum componente legado**: classe `dark:` aparecendo em arquivos `.tsx` apesar de o modo não funcionar. Listar e limpar para não confundir manutenção.
- **Migração de fonte quebra `font-feature-settings: 'cv11', 'ss01'`**: a chamada atual via CSS configura features OpenType específicas; a configuração via next/font precisa preservar isso ou aceitar perda visual sutil.
- **Status com cor + listrado** (no-show, cancelado): listras CSS precisam não atrapalhar a leitura do label adjacente; legibilidade do texto sobre fundo listrado precisa ser validada.
- **Compatibilidade com captura de tela / impressão**: padrões visuais (listras, hachuras) podem render diferente em PDF/print. Validar comprovantes (`expense-receipts`) e PDFs que usam `@react-pdf/renderer`.
- **Conflito com personalização futura por tenant**: white-label foi mencionado como possibilidade. Garantir que tokens sejam suficientemente isolados para reaproveitar quando isso vier.

## Requirements _(mandatory)_

### Functional Requirements

#### Tokens e tema

- **FR-001**: O design system MUST expor tokens semânticos nomeados para os quatro estados não-cobertos hoje: `success`, `warning`, `info`, `alert`, cada um com seu `*-foreground` correspondente.
- **FR-002**: O token `accent` MUST ser visualmente distinto de `secondary`, sinalizando "seleção/hover de ação principal" em vez de "cinza neutro".
- **FR-003**: Todo par token/foreground definido MUST satisfazer contraste mínimo WCAG AA (4.5:1 para texto normal, 3:1 para texto grande).
- **FR-004**: O sistema MUST NOT manter declaração de dark mode sem implementação correspondente. Ou se remove a declaração, ou se implementam as variáveis dark — não há terceira opção aceitável.

#### Tipografia

- **FR-005**: O design system MUST documentar uma escala tipográfica nomeada com no mínimo sete níveis: `display`, `h1`, `h2`, `h3`, `body`, `caption`, `mono`.
- **FR-006**: Cada nível MUST ter tamanho, peso e altura de linha definidos como tokens reutilizáveis (não duplicados por componente).
- **FR-007**: Nenhum texto produzido pelo design system MUST cair abaixo de 12px, com uma única exceção documentada: rótulos de métrica numérica podem usar 11px.
- **FR-008**: A fonte primária (Inter) MUST ser carregada de forma a não bloquear renderização inicial e a não gerar flash visível de troca.
- **FR-009**: As OpenType features atualmente configuradas (`cv11`, `ss01`) MUST ser preservadas após migração da fonte, ou explicitamente descontinuadas com decisão registrada.

#### Status de agendamento

- **FR-010**: Todo badge representando estado de consulta MUST exibir, simultaneamente: cor de fundo semântica, ícone significativo e label textual em português.
- **FR-011**: Pelo menos dois estados visualmente próximos (ex.: "cancelado" e "no-show") MUST se diferenciar por padrão visual além da cor (ex.: borda tracejada vs. listrado).
- **FR-012**: O estado "em atendimento" MUST apresentar indicador de progressão ativa (pulsação ou marcador equivalente).
- **FR-013**: Deve existir exatamente **um** componente reutilizável de status de agendamento, e ele MUST ser usado em todos os contextos onde status de consulta aparece (mínimo: calendário da agenda, lista da agenda, ficha do paciente, relatórios).
- **FR-014**: O componente MUST cobrir os sete estados: agendado, confirmado, em atendimento, concluído, no-show, cancelado, estornado.

#### Badges genéricos

- **FR-015**: Deve existir um componente único de badge genérico cobrindo as dez variantes documentadas no relatório: ativo, agendado, pendente, cancelado, inativo, não-listado, personalizado, comissionado, fixo, liberal.
- **FR-016**: Cada variante MUST usar exatamente as cores de fundo e texto definidas no relatório.
- **FR-017**: O sistema MUST NOT conter badges com estilização ad-hoc (inline ou em arquivo de componente isolado) para semânticas cobertas pelo componente padrão.

#### Sidebar

- **FR-018**: A sidebar MUST usar exatamente as sete cores documentadas para fundo, texto, item ativo (fundo e texto), "Trocar clínica", separadores e labels de seção.
- **FR-019**: Qualquer divergência atual MUST ser corrigida para alinhar ao relatório.

#### Regras transversais

- **FR-020**: Esta feature MUST NOT alterar schema de banco, migrations, RLS ou funções SQL.
- **FR-021**: Esta feature MUST manter retrocompatibilidade visual e funcional com todas as páginas existentes — nenhum texto pode ficar invisível, nenhum botão pode perder seu estilo primário.
- **FR-022**: Componentes shadcn/ui que consomem tokens MUST refletir automaticamente os novos valores (sem fork de componente).
- **FR-023**: O sistema MUST passar typecheck após cada conjunto de mudanças (não há gate de testes funcionais nesta feature, mas typecheck é obrigatório).

### Key Entities _(componentes/conceitos do design system, sem detalhe de implementação)_

- **Catálogo de Tokens Semânticos**: O conjunto nomeado de variáveis cromáticas (primary, secondary, accent, success, warning, info, alert, destructive, muted, border, ring) com seus respectivos foregrounds. Fonte única de verdade para cor no produto.
- **Escala Tipográfica**: O conjunto nomeado de tamanhos/pesos/alturas que cobre desde título de página até nota de rodapé. Define limite mínimo de tamanho aceitável (12px regra; 11px exceção).
- **Badge de Status de Atendimento**: Representação visual unificada do ciclo de vida de uma consulta. Combina cor, ícone, label e padrão visual; cobre sete estados.
- **Badge Genérico do Sistema**: Representação visual de status semânticos não específicos de consulta (ativo/inativo de cadastro, tipos de plano, modalidades de pagamento). Dez variantes.
- **Identidade Visual da Sidebar**: A combinação cromática específica do componente de navegação principal — fundo escuro, hierarquia de opacidade do texto, indicador de item ativo, link de troca de tenant.
- **Identidade Tipográfica**: A configuração de fonte primária (Inter) e suas OpenType features ativas, mais o mecanismo de carregamento que não bloqueia render.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: 100% dos badges que representam estado de consulta no produto exibem, simultaneamente, cor + ícone + label.
- **SC-002**: 100% dos estados de consulta continuam distinguíveis sob simulação de daltonismo (deuteranopia + protanopia), validado em pelo menos três telas (agenda calendário, agenda lista, ficha do paciente).
- **SC-003**: Em uma amostra de 20 pares texto/fundo escolhidos aleatoriamente no produto (badges, sidebar, botões), 100% atendem WCAG AA de contraste (≥ 4.5:1 para texto normal, ≥ 3:1 para texto grande/UI).
- **SC-004**: O número de declarações de cor hardcoded em componentes (estilo inline ou classes ad-hoc fora dos componentes-padrão) para os 17 status cobertos pelos badges (7 de consulta + 10 genéricos) é reduzido a zero, conforme inventário final.
- **SC-005**: Nenhum texto da UI principal renderiza abaixo de 12px (auditoria automatizada ou manual em pelo menos 10 telas-chave), com no máximo a exceção documentada de rótulos de métrica em 11px.
- **SC-006**: O LCP da página de login e do dashboard inicial, medido em conexão 3G emulada, melhora em comparação à medição inicial (linha-de-base capturada antes da migração de fonte). Meta: redução ≥ 100ms ou ausência de FOUT visualmente confirmada.
- **SC-007**: Zero requisições de fonte feitas a domínios externos em runtime após a migração.
- **SC-008**: O config de Tailwind não contém declarações de dark mode órfãs (sem variáveis correspondentes); a sidebar não contém valores de cor que divergem do relatório.
- **SC-009**: Um desenvolvedor novo, dado o documento de tokens, consegue identificar em < 1 minuto qual token usar para "consulta concluída", "alerta de paciente com alergia", "texto auxiliar abaixo do título" — validado em entrevista informal com 1–2 devs.
- **SC-010**: Cada feature de UI subsequente referenciando "status de consulta" ou "badge de cadastro" pode ser implementada **sem criar novos estilos** — métrica de longo prazo, validada na próxima feature de UI após este rollout.

## Assumptions

- A paleta primária (azul `blue-600`) e neutros frios (slate) **não serão alterados** — decisão derivada da pesquisa de mercado consolidada no relatório UI/UX.
- shadcn/ui (Radix primitives) continua sendo a base de componentes; tokens são consumidos via CSS variables HSL e Tailwind theme extension — não há substituição de biblioteca.
- Dark mode **fica fora de escopo** desta feature por decisão fundamentada da pesquisa (light mode é o default correto em ambiente clínico iluminado). Pode ser revisto em feature futura.
- Tematização por tenant (white-label) **fica fora de escopo**, mas a estrutura de CSS variables HSL já é compatível com essa evolução futura.
- O relatório UI/UX da conversa anterior é a fonte autoritativa de valores cromáticos e decisões de escala — divergências entre relatório e código atual são resolvidas a favor do relatório.
- Esta feature **não toca em banco de dados**: nenhuma migration, nenhuma RLS, nenhuma função SQL, nenhum bucket.
- Não há gate de testes funcionais novos para esta feature (UI pura); a validação é por inventário, contraste e inspeção visual. Typecheck continua obrigatório.
- Auditoria de cliques em jornadas críticas (recomendação adicional do relatório) **não faz parte** desta feature — é trabalho separado, mais oneroso, a ser planejado depois.
- Cada subconjunto (Feature 1..7 do input do usuário) pode ser entregue em commits independentes para a `master`, conforme regra explícita do usuário, sem quebrar o produto entre commits.
- O ambiente de desenvolvimento local roda em Windows com pnpm; comandos de validação (typecheck) já existem como `pnpm typecheck`.
