# Feature Specification: Rollout da Paleta Híbrida do Designer

**Feature Branch**: `016-designer-palette-rollout`
**Created**: 2026-05-18
**Status**: Draft
**Input**: User description: "Aplicar Design System com paleta híbrida do designer ao Prontool — azul institucional do designer na sidebar e elementos de autoridade, verde do designer como accent/success, e Blue 600 mantido nos botões primários (CTA). Inclui tokens semânticos, escala tipográfica, badges de status de agendamento com cor+ícone+label, remoção de dark mode não funcional e migração de Inter para next/font/google."

---

> **Relação com features anteriores**
>
> Esta feature **substitui** o rollout proposto em `015-design-system-rollout`. A diferença essencial é que `015` mantinha a paleta atual (slate + Blue 600) e adicionava apenas tokens semânticos. `016` adota a **paleta híbrida** entregue pelo designer:
>
> - **Azul institucional do designer** (`#0E3C5B`, `#1F628E`, `#569AC6`, `#CBE6F8`) substitui slate em superfícies de **autoridade** (sidebar, navegação, "elementos institucionais").
> - **Verde do designer** (`#05494B`, `#126F72`, `#1CABB0`, `#CBE1E1`) torna-se accent e success do sistema.
> - **Blue 600** (`#2563EB`) é **explicitamente preservado** em botões primários (CTA), foco e links de ação.
>
> Quando esta feature for entregue, `015` é considerado superado.

---

## Clarifications

### Session 2026-05-18

- Q: Confirmar o mapping inferido dos 4 estados restantes do badge de status de consulta (em atendimento, no-show, cancelado, estornado), que usam amber/slate/red fora da paleta do designer? → A: Sim — confirmar como está (Option A). Manter paleta do designer onde ela é forte (estados positivos verde, informativo azul) e usar padrões neutros consolidados (amber/slate/red) nos estados que não têm correspondente natural na paleta.
- Q: Incluir badges genéricos do sistema (10 variantes do spec 015 — ativo/inativo/pendente/comissionado/etc.) nesta feature ou deferir? → A: Deferir (Option B). Manter 016 enxuto; abrir como `017-status-badges-system` em feature separada. Variantes como `personalizado`/`nao-listado` usam roxo fora das três famílias e podem evoluir em ritmo próprio.
- Q: O valor `#93C5FD` (Tailwind blue-300) para o texto do item ativo da sidebar é intencional ou deve vir da paleta do designer? → A: Trocar para `#CBE6F8` (Option B — azul claro do designer). Item ativo da sidebar é navegação institucional, não CTA — deve viver na família azul-petróleo do designer. Contraste sobre `#0E3C5B` é ~11:1, bem acima de WCAG AA. Blue 600 fica reservado para botões no conteúdo principal.
- Q: O indicador pulsante de "Em atendimento" precisa respeitar acessibilidade de movimento? → A: Sim — implementar pulsação com fallback para `prefers-reduced-motion: reduce` (Option A). Usuários com preferência de motion reduzido veem um ponto sólido em vez do pulso, mantendo a diferenciação visual sem violar WCAG 2.3.3.

---

## User Scenarios & Testing _(mandatory)_

### User Story 1 — Identidade visual do designer aplicada ao produto (Priority: P1)

Um gerente de clínica abre o Prontool pela primeira vez após o rollout e vê uma interface que **bate com a apresentação comercial** que viu no onboarding/site. A sidebar agora carrega o azul-petróleo profundo do designer (em vez do slate-900 genérico atual), botões de ação positiva (confirmar consulta, marcar como concluído) usam o verde-petróleo do designer, e os botões de ação primária seguem Blue 600 — o azul confiável que ele já reconhece de bancos e sistemas. A combinação cria uma identidade visual coerente, profissional, distinguível dos concorrentes.

**Why this priority**: Esta é a entrega central da feature — o que justifica todo o trabalho. A paleta híbrida é a decisão de design tomada após a pesquisa de mercado consolidada e o aceite do designer. Sem essa história, a feature inteira perde propósito.

**Independent Test**: Pode ser testada abrindo qualquer página do dashboard e comparando, lado a lado, com a entrega visual do designer (mockups ou paleta de referência), confirmando que: (a) a sidebar usa azul institucional do designer, (b) elementos de "sucesso" usam o verde do designer, (c) botões primários permanecem Blue 600.

**Acceptance Scenarios**:

1. **Given** o dashboard renderizado, **When** o usuário compara a sidebar com `#0E3C5B`, **Then** a cor de fundo bate exatamente.
2. **Given** uma consulta com status "Confirmado" ou "Concluído", **When** o badge é exibido, **Then** o fundo usa um tom do verde do designer (`#CBE1E1` ou variação) e o texto usa o verde escuro (`#05494B`).
3. **Given** um botão "Salvar" ou "Confirmar", **When** exibido, **Then** mantém Blue 600 (`#2563EB`) como cor primária — não foi substituído por verde nem por azul-petróleo.
4. **Given** três cores institucionais coexistindo em uma mesma tela (sidebar azul-petróleo + accent verde + CTA Blue 600), **When** vistas em conjunto, **Then** não há conflito visual percebido — cada uma cumpre função distinta.
5. **Given** uma captura de tela do produto sendo usada em material de divulgação, **When** comparada com a paleta do designer, **Then** as três famílias de cor estão presentes e fiéis aos hex documentados.

---

### User Story 2 — Identificação inequívoca do status de uma consulta (Priority: P1)

Uma recepcionista abre a agenda do dia e precisa, em menos de três segundos, distinguir consultas **agendadas**, **confirmadas**, **em atendimento**, **concluídas**, **no-show**, **canceladas** e **estornadas**. Hoje a distinção depende fortemente de cor; em telas com brilho alto, em monitores de baixa qualidade e para colegas com daltonismo, o sistema é ambíguo. A nova paleta do designer reforça verde para estados positivos (confirmado/concluído) e azul informativo para "agendado", mas isso por si só não basta — cada estado precisa exibir cor + ícone + label.

**Why this priority**: A operação mais frequente do sistema (dezenas de aberturas de agenda por dia em cada clínica) e a de maior risco. Pesquisa de mercado mostrou: cor sozinha não atende WCAG, ~300M pessoas têm daltonismo, "three-second rule" é heurística validada para healthcare UI. Pareada com US1 porque entrega valor independentemente, mas igualmente crítica para o lançamento.

**Independent Test**: Pode ser testada abrindo a agenda em qualquer perfil, aplicando filtro de simulação de daltonismo no navegador (deuteranopia/protanopia) e verificando que cada estado continua distinguível por **forma + ícone + texto**, não apenas cor.

**Acceptance Scenarios**:

1. **Given** uma agenda com consultas nos sete estados, **When** o usuário visualiza em modo daltonismo simulado, **Then** todos os estados continuam distinguíveis.
2. **Given** uma consulta agendada, **When** a recepcionista olha o card por < 3 segundos, **Then** identifica o estado por ícone + label, mesmo com tela em alta luminosidade.
3. **Given** uma consulta em atendimento, **When** exibida, **Then** apresenta indicador de "em curso" (pulsação ou marcador) distinto dos demais.
4. **Given** uma consulta cancelada e uma no-show lado a lado, **When** comparadas, **Then** apresentam padrões visuais distintos (não só cor).
5. **Given** o mesmo componente de status, **When** usado em qualquer outra tela (ficha do paciente, relatórios, dashboard), **Then** apresenta o mesmo vocabulário visual.
6. **Given** o badge de "Confirmado", **When** inspecionado, **Then** seu fundo é uma tonalidade do verde do designer (`#CBE1E1`) e o texto é o verde escuro (`#05494B`).
7. **Given** o badge de "Agendado", **When** inspecionado, **Then** seu fundo é o azul claro do designer (`#CBE6F8`) e o texto é o azul institucional (`#0E3C5B`).

---

### User Story 3 — Catálogo de tokens semânticos do designer disponível para todo o sistema (Priority: P2)

Um desenvolvedor precisa estilizar uma nova tela de relatório e precisa decidir rapidamente: qual cor para "consulta concluída"? Qual para "atrasada"? Qual para "alerta crítico de paciente"? Sem catálogo nomeado, cada um decide individualmente. A feature introduz tokens semânticos (`success`, `warning`, `info`, `alert` + variantes `*-bg`/`*-text` para fundos suaves) cobrindo as três famílias da paleta híbrida. Componentes shadcn que usam tokens automaticamente refletem o novo design.

**Why this priority**: Habilitador estrutural — sem ele, US1 e US2 viram hardcode. Mas o usuário final não percebe diretamente; o ganho é via consistência nas histórias anteriores e velocidade de desenvolvimento futuro.

**Independent Test**: Pode ser verificada inspecionando o arquivo central de estilos: tokens nomeados existem, foregrounds correspondentes existem, são distintos entre si (em particular `accent` distinto de `secondary`), e cada par produz contraste mínimo WCAG AA.

**Acceptance Scenarios**:

1. **Given** o catálogo de tokens (`success`, `warning`, `info`, `alert` + foregrounds + variantes `*-bg`/`*-text`), **When** consultado, **Then** cada par cor/foreground apresenta contraste ≥ 4.5:1.
2. **Given** o token `accent`, **When** comparado com `secondary`, **Then** são visualmente distintos e cumprem papéis diferentes.
3. **Given** o token `success`, **When** inspecionado, **Then** corresponde ao verde principal do designer (`#1CABB0` em sua forma cromática equivalente).
4. **Given** o token `info`, **When** inspecionado, **Then** corresponde ao azul médio do designer (`#569AC6`).
5. **Given** o token `primary`, **When** inspecionado, **Then** permanece sendo Blue 600 (`#2563EB`) — não foi sobrescrito pela paleta do designer.
6. **Given** componentes shadcn/ui em uso (Button, Badge, Toast, Alert, Card), **When** carregam tokens, **Then** refletem automaticamente os novos valores, sem necessidade de fork ou variante extra.

---

### User Story 4 — Escala tipográfica documentada e reutilizável (Priority: P2)

Um desenvolvedor implementa um novo card e precisa decidir tamanho de fonte do título, do corpo e do rótulo auxiliar. Hoje cada um decide individualmente. A feature introduz uma escala nomeada (`display`, `h1`, `h2`, `h3`, `body`, `caption`, `mono`) disponível como classes utilitárias, com mínimo de 12px garantido em todo o sistema.

**Why this priority**: Mesmo nível estrutural de US3. Sozinha entrega ganho de consistência e velocidade, sem bloquear outras histórias.

**Independent Test**: Pode ser verificada inspecionando arquivo central de estilos e amostrando 10 telas-chave; nenhum texto < 12px (exceção: rótulos de métrica em 11px).

**Acceptance Scenarios**:

1. **Given** a escala documentada, **When** um desenvolvedor precisa de "texto auxiliar", **Then** encontra `text-caption` como classe utilitária estável.
2. **Given** todo o sistema, **When** auditado, **Then** nenhum texto fica abaixo de 12px (exceção: rótulos de métrica em 11px).
3. **Given** um texto monospaced (dose, CPF, valor), **When** estilizado, **Then** usa `text-mono` com a fonte mono configurada.

---

### User Story 5 — Sidebar fiel à paleta do designer (Priority: P3)

A sidebar é o elemento mais persistente do produto. Hoje usa slate-900 (`#0F172A`); deve passar a usar o azul-petróleo do designer (`#0E3C5B`), com hierarquia de opacidade do texto, indicador de item ativo, label de seção e link "Trocar clínica" alinhados aos tokens. Capturas de tela em material de marketing passam a ser consistentes com a entrega visual.

**Why this priority**: Visual importa, mas a sidebar **já funciona**. O ajuste é fidelidade estética. Em parte coberto por US1, mas com critério granular próprio.

**Independent Test**: Inspeção via DevTools comparando as sete cores documentadas da sidebar com os valores do designer, tolerância zero.

**Acceptance Scenarios**:

1. **Given** a sidebar, **When** inspecionada, **Then** o fundo é `#0E3C5B`, texto-base em `rgba(255,255,255,0.75)`, item ativo com fundo `rgba(86,154,198,0.2)` e texto `#CBE6F8`, link "Trocar clínica" em `#569AC6`, separadores em `rgba(255,255,255,0.1)`, labels de seção em `rgba(255,255,255,0.4)`, hover em `rgba(255,255,255,0.05)`.
2. **Given** o usuário com múltiplos tenants, **When** o link "Trocar clínica" aparece, **Then** está em `#569AC6`.
3. **Given** o item de menu da página atual, **When** renderizado, **Then** usa o fundo de "item ativo" definido.

---

### User Story 6 — Primeiro carregamento sem flash de fonte e sem dark mode órfão (Priority: P3)

Um médico abre o sistema em conexão lenta no consultório. Hoje, Inter é baixada via CDN antes de pintar a UI, causando "flash of unstyled text" (FOUT). Adicionalmente, o config declara `darkMode: ['class']` no Tailwind sem variáveis dark correspondentes — código morto que confunde manutenção. A feature migra a fonte para carregamento otimizado e remove a declaração órfã, fixando light mode como padrão definitivo (decisão da pesquisa).

**Why this priority**: Performance percebida e higiene de código. Benefício real, mas não bloqueia operação.

**Independent Test**: Medir LCP antes/depois em conexão 3G emulada; inspecionar config para confirmar ausência de declarações dark órfãs.

**Acceptance Scenarios**:

1. **Given** primeiro carregamento em conexão lenta, **When** a página renderiza, **Then** não há flash visível de fonte default sendo substituída por Inter.
2. **Given** o config consultado, **When** inspecionado, **Then** não há `darkMode: ['class']` nem blocos `.dark { ... }` órfãos.
3. **Given** auditoria de rede, **When** o app carrega, **Then** nenhuma requisição é feita a `fonts.googleapis.com` em runtime.

---

### Edge Cases

- **Conflito visual entre as três famílias**: combinar azul-petróleo do designer + verde-petróleo + Blue 600 numa mesma tela pode parecer "três marcas competindo". Mitigação: papéis estritamente separados (institucional / accent / CTA); validar visualmente em telas densas (agenda, prontuário).
- **Componente shadcn que herdou `--accent` cinza**: ao virar verde suave, hovers ficam verdes. Esperado e desejado (hover deixa de ser neutro), mas precisa varredura.
- **Tokens não usados ainda**: `--alert` introduzido sem consumidor imediato. Documentar uso pretendido para não virar dead-code.
- **Texto < 12px em terceiros (charts/tooltips)**: bibliotecas podem ter padrões internos abaixo do limite. Exceções documentadas, não falhas.
- **Dark mode chamado em algum componente legado**: classe `dark:` em arquivos `.tsx` apesar do modo não funcionar. Listar e limpar.
- **OpenType features atuais (`cv11`, `ss01`)**: configuradas via CSS hoje, precisam ser preservadas no novo carregamento de fonte ou perda visual sutil aceita.
- **Listras em badges sobre fundo verde claro**: padrão "no-show listrado" pode reduzir legibilidade do texto adjacente. Validar contraste mesmo no padrão.
- **Compatibilidade com PDF/print** (`@react-pdf/renderer`): tokens HSL aplicados em CSS não chegam ao PDF — verificar que comprovantes/relatórios não dependem dos novos tokens.
- **Captura para marketing**: contraste de tela e captura por celular pode distorcer azul-petróleo. Aceito como variação esperada.
- **White-label futuro por tenant**: a estrutura por CSS variables HSL precisa continuar permitindo override por tenant, mesmo que o feature não implemente isso agora.
- **Fim de truncamento do input do usuário**: a Feature 6 do input foi entregue parcial (terminou em `text #05494` na linha de "Concluído"). Estados restantes do badge (em atendimento, no-show, cancelado, estornado) foram inferidos por extensão lógica da paleta do designer e do mapping do spec 015 — **inferência confirmada pelo usuário em 2026-05-18 (Clarifications)**, FR-022 fica como está.

## Requirements _(mandatory)_

### Functional Requirements

#### Paleta híbrida (decisão de design)

- **FR-001**: O sistema MUST adotar **três famílias cromáticas coexistentes**, cada uma com função explícita:
  - **Azul institucional do designer** (`#0E3C5B`, `#1F628E`, `#569AC6`, `#CBE6F8`) para sidebar, navegação, badges informativos.
  - **Verde do designer** (`#05494B`, `#126F72`, `#1CABB0`, `#CBE1E1`) para accent, success, hovers de seleção, badges de estado positivo.
  - **Blue 600** (`#2563EB`) preservado para botões primários (CTA), foco e links de ação.
- **FR-002**: Os oito hex da paleta híbrida MUST ser a **fonte única de verdade** cromática para os tokens do design system. Qualquer divergência entre tokens implementados e hex documentados constitui falha.
- **FR-003**: O primário do design system (`--primary`) MUST permanecer Blue 600 (`#2563EB`) — paleta do designer **não substitui** CTA.

#### Tokens semânticos

- **FR-004**: O design system MUST expor tokens semânticos nomeados: `success`, `warning`, `info`, `alert`, cada um com seu `*-foreground` correspondente.
- **FR-005**: Para `success` e `info`, MUST existir também variantes `*-bg` (fundo suave) e `*-text` (texto sobre o fundo suave), permitindo badges de baixa saturação com bom contraste.
- **FR-006**: `success` MUST mapear para o verde principal do designer (`#1CABB0`); `success-bg` para `#CBE1E1`; `success-text` para `#05494B`.
- **FR-007**: `info` MUST mapear para o azul médio do designer (`#569AC6`); `info-bg` para `#CBE6F8`; `info-text` para `#0E3C5B`.
- **FR-008**: `warning` MUST usar amber (`#F59E0B` ou equivalente) com foreground escuro — fora da paleta do designer, conforme decidido pelo input do usuário.
- **FR-009**: `alert` MUST usar vermelho saturado (`#DC2626` ou equivalente), distinto do `destructive` (que continua usado para confirmações de delete).
- **FR-010**: O token `accent` MUST mapear para o verde suave do designer (`#CBE1E1`) e ser visualmente distinto de `secondary`.
- **FR-011**: Todo par token/foreground definido MUST satisfazer contraste mínimo WCAG AA (4.5:1 para texto normal, 3:1 para UI / texto grande).

#### Tokens da sidebar

- **FR-012**: O design system MUST expor tokens dedicados à sidebar (fundo, texto base, item ativo fundo/texto, hover, label de seção, separador, link de troca de clínica) com os valores documentados na paleta híbrida — sidebar é o componente de identidade institucional mais visível.
- **FR-013**: A sidebar do dashboard MUST consumir esses tokens — sem hex hardcoded inline para os sete elementos.
- **FR-014**: A sidebar MUST usar exatamente `#0E3C5B` como fundo, substituindo o slate-900 atual.

#### Dark mode

- **FR-015**: O sistema MUST NOT manter declaração de dark mode sem implementação correspondente. Esta feature **remove** a declaração e fixa light mode como padrão definitivo. Implementação de dark mode fica fora de escopo (decisão da pesquisa).

#### Tipografia

- **FR-016**: O design system MUST documentar escala tipográfica nomeada com sete níveis: `display`, `h1`, `h2`, `h3`, `body`, `caption`, `mono`.
- **FR-017**: Cada nível MUST ter tamanho, peso e altura de linha definidos como tokens reutilizáveis.
- **FR-018**: Nenhum texto produzido pelo design system MUST cair abaixo de 12px, com a única exceção documentada de rótulos de métrica em 11px.
- **FR-019**: A fonte primária (Inter) MUST ser carregada de forma a não bloquear renderização inicial e a não gerar flash visível de troca.
- **FR-020**: As OpenType features atualmente configuradas (`cv11`, `ss01`) MUST ser preservadas após a migração da fonte, ou explicitamente descontinuadas com decisão registrada.

#### Status de agendamento

- **FR-021**: Todo badge representando estado de consulta MUST exibir, simultaneamente: cor de fundo semântica, ícone significativo e label textual em português.
- **FR-022**: O mapeamento de estados MUST priorizar a paleta do designer onde aplicável:
  - **Agendado** — fundo `#CBE6F8`, texto `#0E3C5B`, ícone Calendar.
  - **Confirmado** — fundo `#CBE1E1`, texto `#05494B`, ícone Check.
  - **Concluído** — fundo `#CBE1E1` com transparência (~60%), texto `#05494B`, ícone CheckCheck.
  - **Em atendimento** — fundo amber (warning-bg), texto amber escuro, ícone Clock, com indicador pulsante.
  - **No-show** — fundo slate suave, texto slate escuro, ícone UserX, com padrão visual listrado.
  - **Cancelado** — fundo slate suave, texto slate escuro, ícone X, com borda tracejada.
  - **Estornado** — fundo `alert-bg` (vermelho suave), texto vermelho escuro, ícone RotateCcw.
- **FR-023**: Pelo menos dois estados visualmente próximos (ex.: "cancelado" e "no-show") MUST se diferenciar por padrão visual além da cor.
- **FR-024**: O estado "em atendimento" MUST apresentar indicador de progressão ativa (pulsação ou marcador equivalente) que, quando o usuário tem `prefers-reduced-motion: reduce` configurado, **degrada para um indicador estático equivalente** (ex.: ponto sólido) preservando a diferenciação visual sem animação contínua. Conformidade com WCAG 2.3.3.
- **FR-025**: Deve existir exatamente **um** componente reutilizável de status de agendamento, usado em todos os contextos onde status de consulta aparece (mínimo: calendário da agenda, lista da agenda, ficha do paciente, relatórios).
- **FR-026**: O componente MUST cobrir os sete estados listados em FR-022.

#### Regras transversais

- **FR-027**: Esta feature MUST NOT alterar schema de banco, migrations, RLS, funções SQL ou buckets.
- **FR-028**: Esta feature MUST manter retrocompatibilidade visual e funcional — nenhum texto pode ficar invisível, nenhum botão pode perder o estilo primário.
- **FR-029**: Componentes shadcn/ui que consomem tokens MUST refletir automaticamente os novos valores, sem fork de componente.
- **FR-030**: O sistema MUST passar typecheck após cada conjunto de mudanças.

### Key Entities _(conceitos do design system)_

- **Paleta Híbrida do Designer**: O conjunto de oito hex codes em três famílias (azul institucional, verde accent, Blue 600 CTA), com papéis distintos. Fonte autoritativa de cor.
- **Catálogo de Tokens Semânticos**: Conjunto de variáveis cromáticas nomeadas com função (success/warning/info/alert + variantes `*-bg`/`*-text`), além de primary/secondary/accent/destructive/muted/border/ring. Cada uma com foreground correspondente.
- **Identidade Cromática da Sidebar**: Tokens dedicados à sidebar (fundo, texto, item ativo, hover, separador, label de seção, link de troca de clínica), expressando a cor institucional do designer.
- **Escala Tipográfica**: Conjunto nomeado de sete níveis (display, h1, h2, h3, body, caption, mono) com tamanho/peso/altura definidos, mínimo de 12px (exceção: 11px para métricas).
- **Identidade Tipográfica**: Inter como fonte primária com features OpenType (`cv11`, `ss01`) e mecanismo de carregamento não bloqueante.
- **Badge de Status de Atendimento**: Representação visual unificada do ciclo de vida de uma consulta — cor + ícone + label + padrão visual — cobrindo os sete estados de FR-022.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: 100% dos oito hex documentados na paleta híbrida do designer estão refletidos fielmente nos tokens correspondentes (verificável por inspeção de cada token contra a tabela de paleta).
- **SC-002**: 100% dos badges que representam estado de consulta exibem simultaneamente cor + ícone + label.
- **SC-003**: 100% dos estados de consulta continuam distinguíveis sob simulação de daltonismo (deuteranopia + protanopia), em pelo menos três telas (calendário, lista, ficha do paciente).
- **SC-004**: Em amostra de 20 pares texto/fundo aleatórios (badges, sidebar, botões), 100% atendem WCAG AA de contraste.
- **SC-005**: A sidebar usa exatamente as sete cores documentadas — zero divergência em inspeção via DevTools.
- **SC-006**: Botões primários ("Salvar", "Confirmar", "Criar", CTAs em geral) continuam usando Blue 600 — zero substituição inadvertida pelas cores do designer.
- **SC-007**: Nenhum texto da UI principal renderiza abaixo de 12px (auditoria em ≥ 10 telas-chave), exceção documentada de rótulos de métrica em 11px.
- **SC-008**: O LCP da página de login e do dashboard inicial, em conexão 3G emulada, melhora ≥ 100ms versus linha-de-base ou ausência de FOUT é confirmada visualmente.
- **SC-009**: Zero requisições de fonte para domínios externos em runtime após a migração.
- **SC-010**: O config de Tailwind não contém declarações de dark mode órfãs; nenhum `.dark { ... }` órfão em `globals.css`.
- **SC-011**: Em revisão visual lado-a-lado de cinco telas-chave (login, dashboard, agenda, ficha paciente, configurações), as três famílias cromáticas coexistem sem conflito visual percebido por revisor humano.
- **SC-012**: Um desenvolvedor novo, dado o documento de tokens, consegue identificar em < 1 minuto qual token usar para "consulta concluída" (success), "atrasada" (warning), "alerta crítico" (alert), "informativo neutro" (info).
- **SC-013**: O badge "Em atendimento" exibe indicador animado por padrão e indicador estático equivalente quando o navegador reporta `prefers-reduced-motion: reduce` — em ambos os modos, o estado continua distinguível dos demais por cor + ícone + label.

## Assumptions

- A **paleta híbrida** descrita é a decisão final acordada com o designer; valores hex listados são autoritativos. Quaisquer divergências entre o relatório UI/UX anterior e este input são resolvidas a favor deste input.
- **Blue 600 é mantido em CTA** mesmo que pareça "fora da paleta do designer". É uma decisão deliberada de usabilidade — preserva familiaridade que usuário já tem do mercado.
- **shadcn/ui (Radix primitives)** continua como base de componentes. Tokens são consumidos via mecanismo já existente (CSS variables); não há substituição de biblioteca.
- **Dark mode fica fora de escopo definitivamente nesta feature** (decisão fundamentada na pesquisa de mercado — light mode é o default correto em ambiente clínico iluminado).
- **Tematização por tenant (white-label)** fica fora de escopo, mas a estrutura por CSS variables permanece compatível com essa evolução futura.
- **Esta feature não toca em banco**: nenhuma migration, RLS, função SQL ou bucket.
- **Sem testes funcionais novos**: feature de UI pura; validação por inventário, contraste e inspeção visual. Typecheck continua obrigatório.
- **Auditoria de cliques em jornadas críticas** (recomendação adicional do relatório) **não faz parte** desta feature.
- **Truncamento do input do usuário**: a Feature 6 do input foi entregue parcialmente — interrompida em "Concluído: bg #CBE1E1 60%, text #05494" sem fechar o hex e sem listar os estados restantes. O texto "#05494" foi interpretado como `#05494B` (verde escuro do designer já presente em outros badges). Os quatro estados restantes (em atendimento, no-show, cancelado, estornado) foram inferidos a partir do mapping do spec 015 + paleta híbrida e documentados em FR-022. **Inferência confirmada pelo usuário em 2026-05-18 (vide Clarifications)** — FR-022 permanece como está.
- **Ausência de "Features 7+"**: o input do spec 015 tinha sete features (incluindo "Sidebar cores documentadas" e "Badges padronizados" do sistema com 10 variantes). Aqui só estão presentes Features 1–6 (truncada). Sidebar com fidelidade exata permanece implícito via tokens (FR-012/013) e via consumo pelos componentes existentes. **Badges genéricos do sistema (10 variantes) foram explicitamente diferidos pelo usuário em 2026-05-18 (vide Clarifications) — serão tratados como feature separada `017-status-badges-system`**, não fazem parte desta entrega.
- **Conversões hex → HSL** (mencionadas no input) são detalhe de implementação resolvido no `/speckit-plan`. O spec referencia hex como source-of-truth e exige fidelidade — formato CSS (HSL vs. hex direto) é decisão técnica.
- **Cada uma das seis user stories pode ser entregue em commit independente para a `master`**, conforme regra explícita do usuário, sem quebrar o produto entre commits.
- **Ambiente local em Windows com pnpm**; `pnpm typecheck` continua sendo o gate.
