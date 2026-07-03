# Feature Specification: Configurações da Clínica, Perfil, Equipe e Reorganização da Navegação

**Feature Branch**: `009-configuracoes-clinica-equipe`
**Created**: 2026-05-08
**Status**: Draft
**Input**: User description: "Configurações completas do Prontool: perfil da clínica com logo, perfil do usuário e gerenciamento de equipe, mais reorganização da sidebar (Cadastros vira Configurações, sem abas horizontais)."

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Identidade visual e dados oficiais da clínica (Priority: P1)

A administradora da clínica precisa que os documentos gerados pelo sistema (prontuário, anamnese, relatórios, comprovantes) e a interface tenham a marca da clínica, dados oficiais (CNPJ, endereço, contato) e a assinatura do responsável técnico exigida pelos conselhos profissionais. Hoje os PDFs saem genéricos e a sidebar mostra apenas o nome do tenant em texto, o que é percebido como amador e pode invalidar documentos médicos perante auditoria.

**Why this priority**: É o item de maior visibilidade externa — qualquer documento que a clínica entrega ao paciente, ao convênio ou à fiscalização passa por aqui. Sem ele, a percepção de profissionalismo cai e há risco de não conformidade com exigências de conselhos (CRM, CRO, CREFITO).

**Independent Test**: Pode ser totalmente testada cadastrando uma clínica nova, fazendo upload de logo, preenchendo CNPJ/endereço/responsável técnico e em seguida emitindo um PDF de prontuário — o cabeçalho deve trazer logo + razão social + CNPJ + responsável técnico, e a sidebar deve exibir a logo no topo. Entrega valor mesmo sem as outras stories.

**Acceptance Scenarios**:

1. **Given** uma administradora autenticada com a clínica ainda não configurada, **When** ela acessa a página de configurações da clínica e preenche logo, nome, CNPJ, telefone, e-mail, endereço completo e dados do responsável técnico, **Then** os dados são salvos, a logo aparece imediatamente no topo da sidebar e os próximos PDFs gerados (prontuário, anamnese, relatório financeiro, comprovante de despesa) trazem cabeçalho com logo + dados oficiais.
2. **Given** a administradora preenchendo o endereço, **When** ela digita um CEP válido, **Then** o sistema busca automaticamente logradouro, bairro, cidade e UF e os preenche, deixando apenas número e complemento para digitação manual.
3. **Given** a administradora preenchendo o CNPJ, **When** ela informa um valor com formato inválido ou dígitos verificadores incorretos, **Then** o formulário rejeita o salvamento e exibe mensagem clara de "CNPJ inválido"; quando válido, formata visualmente como `00.000.000/0000-00`.
4. **Given** um arquivo de logo maior que 2 MB ou em formato diferente de JPG/PNG, **When** a administradora tenta enviar, **Then** o upload é rejeitado com mensagem explicando o limite; quando aceito, a logo é exibida em pré-visualização antes de ser confirmada.
5. **Given** uma usuária com função diferente de administradora, **When** ela tenta acessar a página de configurações da clínica, **Then** o acesso é bloqueado com mensagem de "permissão necessária".
6. **Given** uma clínica que ainda não preencheu os dados, **When** qualquer PDF é gerado, **Then** o cabeçalho exibe um aviso visual de "Configure os dados da clínica em Configurações > Clínica" no lugar da logo, sem quebrar o documento.

---

### User Story 2 - Sidebar reorganizada e fim das abas horizontais (Priority: P2)

Toda a equipe (administração, recepção, profissionais de saúde, financeiro) navega o sistema dezenas de vezes ao dia. Hoje a navegação está fragmentada entre uma sidebar e uma barra de abas horizontais ("Cadastros", "Configurações"), o que duplica cliques, ocupa espaço útil da tela e gera dúvidas sobre onde está cada coisa. A reorganização traz todos os itens para a sidebar agrupados por intenção (Operação, Análise, Configurações), elimina a barra de abas e renomeia itens para a linguagem do dia a dia da clínica.

**Why this priority**: Toca em 100% das jornadas do produto e é prerrequisito visual para que as novas páginas (Clínica, Meu Perfil, Usuários) sejam encontradas pela equipe. Independe das demais stories porque, mesmo sem os novos itens, a reorganização das páginas existentes já entrega valor.

**Independent Test**: Pode ser validada sem nenhuma das outras stories, comparando a sidebar antes/depois — a barra horizontal desaparece, todos os itens antigos de "Cadastros" aparecem agrupados em "Configurações" na sidebar, e qualquer link antigo (ex.: `/cadastros/procedimentos`) continua funcionando via redirecionamento permanente.

**Acceptance Scenarios**:

1. **Given** uma usuária autenticada de qualquer função, **When** ela abre o sistema, **Then** a sidebar exibe três grupos: **Operação** (Agenda, Pacientes, Alertas, Pendências), **Análise** (Relatórios, Comissões, Despesas, Auditoria) e **Configurações** (itens visíveis dependendo da função).
2. **Given** uma administradora, **When** ela olha o grupo Configurações, **Then** vê todos estes itens individuais clicáveis: Clínica, Meu Perfil, Usuários, Procedimentos, Convênios, Profissionais, Modelos de Anamnese, Integrações.
3. **Given** uma usuária não administradora (recepção, profissional de saúde, financeiro), **When** ela olha o grupo Configurações, **Then** vê apenas Meu Perfil e os itens permitidos pela sua função (sem Clínica nem Usuários).
4. **Given** qualquer usuária navegando dentro da seção que antes tinha abas horizontais ("Cadastros" e "Configurações"), **When** a página carrega, **Then** não existe mais nenhuma barra de abas — a página ocupa toda a área de conteúdo abaixo do cabeçalho global.
5. **Given** um link, bookmark ou URL antigo do tipo `/cadastros/procedimentos`, `/cadastros/planos`, `/cadastros/profissionais`, `/cadastros/modelos-anamnese`, **When** alguém o acessa, **Then** o sistema responde com redirecionamento permanente (HTTP 301) para a nova rota equivalente sob `/configuracoes/...`, preservando query string e mantendo SEO/históricos.
6. **Given** o item antigo "Atendimentos" na sidebar, **When** a sidebar é renderizada, **Then** ele aparece como **Agenda** e abre a visualização de calendário por padrão.
7. **Given** o item antigo "Fila de erros" na sidebar, **When** a sidebar é renderizada, **Then** ele aparece como **Pendências**.
8. **Given** o item antigo "Planos" em Cadastros, **When** ele aparece em Configurações, **Then** seu rótulo é **Convênios** e a rota é `/configuracoes/convenios`.

---

### User Story 3 - Perfil pessoal do usuário (Priority: P3)

Cada profissional que usa o Prontool quer se reconhecer no sistema (foto, nome correto), mudar a própria senha sem chamar o admin e ajustar o fuso horário para que horários de agenda e relatórios apareçam consistentes com a localidade onde atua. Hoje esses ajustes não existem ou exigem intervenção do admin.

**Why this priority**: É um ganho de autonomia individual e higiene básica de segurança (rotação de senha pelo próprio usuário). Não bloqueia operação, por isso vem depois das duas anteriores.

**Independent Test**: Pode ser testada em qualquer conta logada — o usuário acessa Meu Perfil, troca foto, nome, senha e fuso, sai e entra novamente, e tudo persiste. Entrega valor isoladamente.

**Acceptance Scenarios**:

1. **Given** uma usuária autenticada de qualquer função, **When** ela acessa Meu Perfil, **Then** vê os campos: foto, nome completo (editável), e-mail (somente leitura), formulário de troca de senha e seletor de fuso horário.
2. **Given** a usuária enviando uma foto JPG ou PNG de até 2 MB, **When** confirma o upload, **Then** a foto substitui o avatar antigo e passa a aparecer ao lado do e-mail na sidebar e nos registros de "criado por" / "alterado por" em telas que mostram autoria.
3. **Given** a usuária trocando a senha, **When** ela informa senha atual correta, nova senha que atende aos requisitos mínimos e a confirmação igual, **Then** a senha é atualizada e a usuária recebe confirmação.
4. **Given** a usuária trocando a senha, **When** a senha atual está errada, ou a nova é fraca demais, ou as duas digitações divergem, **Then** o formulário rejeita e mostra mensagem específica do erro sem expor outros dados.
5. **Given** a usuária alterando o fuso horário preferido, **When** salva, **Then** as próximas telas que mostram data/hora (agenda, relatórios, log de auditoria) usam o fuso escolhido para apresentação, sem alterar o armazenamento.
6. **Given** o e-mail da conta, **When** a usuária tenta editá-lo, **Then** o campo é claramente marcado como somente leitura e o sistema explica que a alteração de e-mail não é feita pelo perfil.

---

### User Story 4 - Gestão da equipe (convidar, mudar função, desativar) (Priority: P4)

A administradora precisa controlar quem tem acesso ao Prontool da clínica, com qual função, e ver quando cada pessoa entrou pela última vez. Quando alguém sai da equipe, ela quer remover o acesso sem apagar o histórico daquele profissional. Hoje isso depende de suporte ou intervenção técnica.

**Why this priority**: Recurso administrativo importante mas de uso pontual; não impacta o trabalho diário da maior parte da equipe. Vem por último entre as stories funcionais.

**Independent Test**: Pode ser testada ponta a ponta convidando uma pessoa de teste, alterando sua função, desativando-a e verificando que ela perde acesso, mas que registros antigos continuam atribuídos ao nome dela. Entrega valor mesmo sem as outras stories.

**Acceptance Scenarios**:

1. **Given** uma administradora, **When** ela acessa Configurações > Usuários, **Then** vê a lista de usuários do tenant com colunas Nome, E-mail, Função, Status (Ativo, Convite pendente, Desativado) e Último acesso.
2. **Given** a administradora convidando alguém novo, **When** informa um e-mail e seleciona uma função (Administrador, Financeiro, Recepcionista ou Profissional de Saúde) e confirma, **Then** o sistema cria a conta de autenticação, vincula a pessoa ao tenant com a função escolhida, dispara um e-mail de convite com link de definição de senha e a linha aparece na lista com status "Convite pendente".
3. **Given** uma pessoa com convite pendente, **When** ela aceita o link e define a senha, **Then** o status passa para "Ativo" e o último acesso é registrado.
4. **Given** uma administradora alterando a função de outro usuário, **When** ela escolhe outra função e confirma, **Then** a função é atualizada imediatamente e a mudança fica registrada em auditoria de forma append-only (quem mudou, quando, função anterior, função nova).
5. **Given** uma administradora desativando outro usuário, **When** ela confirma a ação, **Then** o vínculo do usuário com o tenant é removido (sem apagar a conta de autenticação), o usuário perde acesso ao tenant a partir da próxima requisição, e os registros históricos continuam exibindo o nome dele como autor.
6. **Given** a única administradora ativa do tenant, **When** ela tenta desativar a si mesma ou rebaixar a si mesma para outra função, **Then** o sistema bloqueia a ação com mensagem explicando que ao menos uma administradora deve permanecer.
7. **Given** um e-mail que já pertence a um usuário ativo do tenant, **When** a administradora tenta convidar usando o mesmo e-mail, **Then** o sistema rejeita com mensagem clara, sem criar duplicata.
8. **Given** um usuário desativado, **When** a administradora aciona "Reativar", **Then** o vínculo é restabelecido com a função escolhida e o usuário volta a ter acesso (sem novo e-mail de convite, pois a conta de autenticação já existe).

---

### Edge Cases

- **Logo corrompida ou ilegível**: se a logo armazenada não puder ser lida (arquivo deletado externamente, falha de storage), os PDFs e a sidebar caem para o fallback textual (nome da clínica) sem quebrar o documento.
- **CEP não encontrado** na consulta externa: campos de endereço continuam editáveis manualmente; a falha não impede salvar.
- **Serviço de busca de CEP indisponível**: a interface mostra aviso "Não foi possível buscar o CEP, preencha manualmente" e libera os campos.
- **CNPJ duplicado entre tenants**: não é validado entre tenants (cada tenant edita o seu, validação é apenas formato + dígitos verificadores).
- **Convite por e-mail não entregue** (caixa cheia, domínio inválido): a linha aparece como "Convite pendente" e o admin pode reenviar o convite.
- **Usuário com sessão ativa quando é desativado**: a sessão atual continua até a próxima requisição autenticada, momento em que é encerrada e ele é redirecionado para o login.
- **Usuário pertence a múltiplos tenants**: desativar em um tenant não afeta o acesso aos demais.
- **Foto/Logo com nome de arquivo malicioso ou MIME diferente do declarado**: o sistema rejeita o upload se o conteúdo binário não corresponde a JPG/PNG válidos, independentemente da extensão.
- **Tenant em modo legado sem clínica configurada**: PDFs continuam sendo gerados com aviso visível "Configure os dados da clínica" em vez de logo, sem bloquear a operação.
- **Acesso a rota antiga `/cadastros/...` por usuário não autenticado**: o redirecionamento 301 ainda ocorre, e o destino aplica a regra de autenticação normal.
- **Mudança de fuso horário do usuário enquanto há agenda aberta em outra aba**: a aba aberta continua com o fuso anterior até ser recarregada; o novo fuso passa a valer nas próximas navegações.

## Requirements _(mandatory)_

### Functional Requirements

#### Configurações da Clínica (Story 1)

- **FR-001**: O sistema DEVE oferecer uma página única de configurações da clínica acessível somente a usuários com função de administrador.
- **FR-002**: O sistema DEVE permitir o upload de uma logotipo da clínica nos formatos JPG ou PNG, com tamanho máximo de 2 MB, validando tanto a extensão quanto o conteúdo binário.
- **FR-003**: O sistema DEVE armazenar a logotipo de forma isolada por tenant, garantindo que apenas usuários autenticados do tenant proprietário possam acessá-la.
- **FR-004**: O sistema DEVE permitir cadastrar e editar os dados oficiais da clínica: razão social/nome fantasia, CNPJ, telefone principal, e-mail de contato e endereço completo (CEP, logradouro, número, complemento, bairro, cidade, UF).
- **FR-005**: O sistema DEVE validar o CNPJ informado quanto ao formato e aos dígitos verificadores antes de permitir o salvamento, exibindo formatação visual `00.000.000/0000-00`.
- **FR-006**: O sistema DEVE aplicar máscara visual ao telefone principal compatível com formatos brasileiros (fixo e móvel).
- **FR-007**: O sistema DEVE oferecer busca automática de endereço a partir do CEP, preenchendo logradouro, bairro, cidade e UF, e mantendo número e complemento como entrada manual.
- **FR-008**: O sistema DEVE permitir cadastrar os dados do responsável técnico: nome completo, tipo de conselho profissional (CRM, CRO, CREFITO, entre outros) e número de registro.
- **FR-009**: O sistema DEVE exibir a logotipo da clínica no topo da sidebar para todos os usuários do tenant logo após salvamento, sem exigir novo login.
- **FR-010**: O sistema DEVE incluir a logotipo e os dados oficiais da clínica (nome, CNPJ, endereço, telefone, e-mail, responsável técnico com conselho e número) no cabeçalho de todos os documentos PDF gerados (prontuário, anamnese, relatórios, comprovantes).
- **FR-011**: Quando os dados da clínica não estiverem preenchidos, o sistema DEVE gerar PDFs com aviso visível "Configure os dados da clínica" no espaço do cabeçalho, sem bloquear a geração.

#### Reorganização da navegação (Story 2)

- **FR-012**: O sistema DEVE substituir a navegação por abas horizontais (atual barra de Cadastros e Configurações) por itens individuais clicáveis na sidebar.
- **FR-013**: A sidebar DEVE agrupar os itens em três seções nomeadas: **Operação**, **Análise** e **Configurações**.
- **FR-014**: A seção **Operação** DEVE conter, nesta ordem: Agenda, Pacientes, Alertas, Pendências.
- **FR-015**: A seção **Análise** DEVE conter, nesta ordem: Relatórios, Comissões, Despesas, Auditoria.
- **FR-016**: A seção **Configurações** DEVE conter, nesta ordem: Clínica, Meu Perfil, Usuários, Procedimentos, Convênios, Profissionais, Modelos de Anamnese, Integrações.
- **FR-017**: O item de sidebar antes chamado "Atendimentos" DEVE ser renomeado para **Agenda** e abrir a visualização de calendário por padrão.
- **FR-018**: O item de sidebar antes chamado "Fila de erros" DEVE ser renomeado para **Pendências**.
- **FR-019**: O item antes chamado "Planos" DEVE ser renomeado para **Convênios** quando exibido no menu reorganizado.
- **FR-020**: As páginas hoje sob o caminho `/cadastros/...` DEVEM ser servidas a partir do caminho `/configuracoes/...` correspondente, com mapeamento explícito: procedimentos, convênios (de `planos`), profissionais e modelos de anamnese.
- **FR-021**: O sistema DEVE responder com redirecionamento permanente (HTTP 301) das URLs antigas `/cadastros/...` para as novas `/configuracoes/...`, preservando query string e fragmento.
- **FR-022**: O sistema DEVE remover completamente qualquer barra de abas horizontal acima do conteúdo das páginas de Configurações e Cadastros, liberando o espaço para o conteúdo principal.
- **FR-023**: A visibilidade de cada item da sidebar DEVE respeitar a função do usuário; itens administrativos (Clínica, Usuários) e itens administrativos de catálogo (Procedimentos, Convênios, Profissionais, Modelos de Anamnese, Integrações) seguem a mesma regra de visibilidade que possuem hoje, agora dentro de Configurações.

#### Perfil pessoal do usuário (Story 3)

- **FR-024**: O sistema DEVE oferecer uma página de perfil pessoal acessível por qualquer usuário autenticado, independentemente da função.
- **FR-025**: O sistema DEVE permitir o upload de uma foto de perfil em JPG ou PNG, com tamanho máximo de 2 MB, validando extensão e conteúdo binário.
- **FR-026**: O sistema DEVE armazenar a foto de perfil de forma isolada por usuário, com leitura restrita ao próprio usuário e aos contextos de exibição autorizados (sidebar, listas de autoria) dentro do mesmo tenant.
- **FR-027**: O sistema DEVE exibir a foto de perfil ao lado do e-mail na sidebar e nos rótulos "criado por" / "alterado por" das listagens que mostram autoria.
- **FR-028**: O sistema DEVE permitir a edição do nome completo do usuário.
- **FR-029**: O sistema DEVE exibir o e-mail da conta como somente leitura na página de perfil, deixando explícito que sua alteração não é feita ali.
- **FR-030**: O sistema DEVE oferecer um formulário de troca de senha que exige a senha atual, a nova senha e a confirmação da nova senha, e que rejeita o envio se: a senha atual estiver incorreta, a nova senha não atender aos requisitos mínimos de segurança, ou as duas digitações da nova senha divergirem.
- **FR-031**: O sistema DEVE permitir ao usuário escolher seu fuso horário preferido entre os fusos suportados, e DEVE usá-lo na apresentação de datas e horários nas próximas navegações.

#### Gestão da equipe (Story 4)

- **FR-032**: O sistema DEVE oferecer uma página de gerenciamento de usuários acessível somente a administradores, listando todos os usuários vinculados ao tenant com Nome, E-mail, Função, Status (Ativo, Convite pendente, Desativado) e Último acesso.
- **FR-033**: O sistema DEVE permitir convidar um novo usuário informando e-mail e função (Administrador, Financeiro, Recepcionista, Profissional de Saúde), criando a conta de autenticação se ainda não existir, vinculando-a ao tenant com a função escolhida, e disparando um e-mail de convite com instruções de definição de senha.
- **FR-034**: O sistema DEVE rejeitar convites para e-mails que já estejam vinculados como usuários ativos do mesmo tenant, com mensagem específica.
- **FR-035**: O sistema DEVE permitir alterar a função de um usuário existente do tenant, sem necessidade de recriar a conta.
- **FR-036**: O sistema DEVE permitir desativar um usuário do tenant, removendo apenas o vínculo com o tenant e sem apagar a conta de autenticação nem os registros históricos atribuídos a ele.
- **FR-037**: O sistema DEVE permitir reativar um usuário previamente desativado, reaproveitando a conta de autenticação existente, sem disparar novo e-mail de convite.
- **FR-038**: O sistema DEVE impedir que uma administradora desative ou rebaixe a si mesma quando ela for a única administradora ativa do tenant.
- **FR-039**: O sistema DEVE encerrar a sessão de um usuário desativado na próxima requisição autenticada, redirecionando-o para a tela de login.

#### Auditoria e segurança (transversal)

- **FR-040**: O sistema DEVE registrar em auditoria, de forma append-only, qualquer alteração em dados sensíveis: dados oficiais da clínica, responsável técnico, mudança de função de usuário, convite, desativação e reativação de usuário, e troca de senha.
- **FR-041**: O sistema DEVE garantir que a logo da clínica e a foto de perfil só sejam acessíveis por usuários autorizados (mesmo tenant para a logo; o próprio usuário e contextos de exibição autorizados para a foto), bloqueando acesso anônimo direto ao arquivo.

### Key Entities _(include if feature involves data)_

- **Perfil da Clínica (Tenant)**: representa a identidade oficial do tenant. Atributos: logotipo, razão social/nome fantasia, CNPJ, telefone, e-mail, endereço completo (CEP, logradouro, número, complemento, bairro, cidade, UF), responsável técnico (nome, conselho, número de registro). Há exatamente um perfil por tenant.
- **Perfil do Usuário**: representa as preferências individuais. Atributos: foto, nome completo, fuso horário preferido. Relaciona-se 1-para-1 com a conta de autenticação.
- **Vínculo Usuário-Tenant**: representa a participação de um usuário num tenant com uma função. Atributos: tenant, usuário, função (Administrador, Financeiro, Recepcionista, Profissional de Saúde), status (Ativo, Convite pendente, Desativado), data do último acesso. Um mesmo usuário pode ter vínculos com múltiplos tenants.
- **Convite**: estado intermediário do vínculo enquanto o convidado ainda não definiu senha. Atributos: tenant, e-mail, função, data de envio, data de aceite (quando concluído).
- **Registro de Auditoria** (uso, sem schema novo): entrada append-only descrevendo quem fez, quando, qual entidade afetada, valores anterior e novo (mascarando dados sensíveis quando aplicável).

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: Ao cadastrar logotipo + dados completos da clínica, 100% dos PDFs gerados em seguida (prontuário, anamnese, relatório financeiro, comprovante de despesa) trazem cabeçalho com logotipo + razão social + CNPJ + responsável técnico.
- **SC-002**: 95% das administradoras conseguem completar a configuração inicial da clínica (logo + dados + endereço por CEP + responsável técnico) em menos de 5 minutos no primeiro uso, sem precisar de suporte.
- **SC-003**: Após a reorganização, qualquer item de Cadastros/Configurações é alcançável em no máximo 1 clique a partir de qualquer página do sistema (sem etapa intermediária de aba horizontal).
- **SC-004**: 100% das URLs antigas no formato `/cadastros/...` continuam funcionando via redirecionamento permanente para as novas, mantendo bookmarks dos usuários e referências externas válidas durante pelo menos 12 meses.
- **SC-005**: A área útil de conteúdo das páginas que perderam a barra de abas horizontais cresce em pelo menos a altura da antiga barra (≈48 px), o que se traduz em pelo menos uma linha extra visível em listagens longas sem rolagem.
- **SC-006**: 90% dos usuários conseguem trocar a própria senha pela página de Meu Perfil sem abrir chamado de suporte.
- **SC-007**: O tempo médio para uma administradora convidar um novo membro da equipe (do clique em "Convidar" até o envio do e-mail) cai para menos de 30 segundos.
- **SC-008**: Zero incidentes em que um usuário desativado retém acesso ao tenant por mais de uma requisição autenticada após a desativação.
- **SC-009**: 100% dos eventos críticos (mudança de função, desativação, reativação, alteração de dados oficiais da clínica, troca de senha) aparecem na auditoria com autor, data/hora e valores anterior/novo, sem possibilidade de edição posterior.
- **SC-010**: 100% dos uploads de logo e foto de perfil são rejeitados quando o conteúdo binário não corresponde a JPG/PNG válidos, mesmo que a extensão pareça correta.

## Assumptions

- A entrega do e-mail de convite usa o canal nativo da plataforma de autenticação já adotada pelo Prontool, com link de definição de senha; nenhum serviço externo de e-mail novo é introduzido nesta feature.
- A consulta de endereço por CEP usa o serviço público ViaCEP; em caso de indisponibilidade, o formulário libera digitação manual sem bloquear o salvamento.
- A foto de perfil substitui qualquer avatar derivado de iniciais nas listagens de autoria, mas a fonte original (iniciais) continua sendo o fallback quando não houver foto.
- O fuso horário escolhido pelo usuário afeta apenas a apresentação (formatação de datas/horas exibidas); o armazenamento permanece em UTC ou no fuso canônico já adotado.
- Os requisitos mínimos de senha seguem a política existente da plataforma de autenticação (comprimento mínimo, complexidade); esta feature não redefine essa política.
- "Último acesso" do usuário é o momento da última autenticação bem-sucedida no tenant; não inclui ações offline ou tokens de API.
- Quando um profissional é desativado, atendimentos futuros já agendados para ele permanecem na agenda atribuídos ao seu nome; a redistribuição manual fica a cargo da administradora e não faz parte do escopo desta feature.
- A logotipo da clínica e a foto de perfil são imagens estáticas; recursos como recorte interativo, filtros ou redimensionamento avançado não fazem parte do escopo.
- O CNPJ é único por tenant na visão da clínica, mas o sistema não impõe unicidade global de CNPJ entre tenants.
- A reorganização da sidebar não introduz novas permissões; cada item continua sujeito às mesmas regras de função que já tinha em sua localização anterior.
- Os redirecionamentos 301 das rotas `/cadastros/...` permanecem ativos por tempo indefinido como salvaguarda; remoção futura é decisão de manutenção, não desta feature.
- O escopo desta feature não cobre:
  - Configuração de e-mails transacionais customizados (templates de convite, assinaturas).
  - Two-factor authentication (2FA) ou políticas avançadas de senha.
  - Histórico de logos (apenas a logo atual é mantida; substituição apaga a anterior).
  - Múltiplos responsáveis técnicos por clínica (apenas um por tenant).
  - Importação em massa de usuários por CSV.
