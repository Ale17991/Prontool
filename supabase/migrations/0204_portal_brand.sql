-- 0204 — A marca da clínica no portal do paciente (058).
--
-- O portal deixou de ser uma tela genérica na 057: cada área virou página
-- própria e toda cor escrita na mão virou token de tema. Isso abriu a
-- possibilidade que esta migração persiste — a clínica escolher a própria
-- paleta sem que ninguém reescreva tela nenhuma.
--
-- DUAS CORES, E SÓ DUAS
--
-- `portal_brand_color` é o destaque (ações, ícones de área, indicadores) e
-- `portal_surface_color` é o fundo. Todo o resto — texto, cartão, borda, texto
-- de apoio, e a cor que vai SOBRE o destaque — é derivado em
-- `src/lib/core/patient-portal/theme.ts` e NÃO tem coluna aqui, de propósito.
-- Guardar a cor do texto abriria a porta para uma clínica gravar branco sobre
-- amarelo e o portal do paciente ficar ilegível sem que ninguém percebesse.
-- Contraste é invariante de leitura, não preferência de quem configura.
--
-- Moram em `tenant_clinic_profile` junto de `patient_portal_enabled`,
-- `public_booking_slug` e `patient_portal_welcome_text` (0202) porque são a
-- mesma natureza: configuração do portal daquela clínica. Tabela própria para
-- duas colunas de texto opcional seria cerimônia sem ganho.
--
-- POR QUE O CHECK É SÓ DE FORMATO
--
-- O banco confere que é `#RRGGBB`, e nada além disso. "Este par de cores é
-- legível?" depende da derivação inteira (qual vira cartão, qual vira texto,
-- quanto a marca precisa ceder para caber um rótulo dentro dela) e essa regra
-- vive na aplicação, coberta por teste. Reimplementá-la em PL/pgSQL criaria
-- duas verdades sobre a mesma pergunta, e a divergência apareceria como um
-- portal que salva na tela e recusa no banco.
--
-- O formato ainda assim é travado aqui porque é barato e porque a coluna vira
-- CSS: a aplicação já nunca deixa passar outra coisa, e o CHECK é a segunda
-- tranca caso alguém escreva direto no banco.
--
-- Nascem NULL e assim ficam para todas as clínicas existentes: personalizar é
-- opt-in e nada muda para quem não escolher (FR-004). NULL em qualquer uma das
-- duas cai na paleta padrão — meia personalização não existe, porque aplicar um
-- destaque sobre o fundo do produto entregaria uma combinação que ninguém
-- escolheu nem revisou.

ALTER TABLE public.tenant_clinic_profile
  ADD COLUMN IF NOT EXISTS portal_brand_color TEXT,
  ADD COLUMN IF NOT EXISTS portal_surface_color TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'tenant_clinic_profile_portal_brand_color_hex'
  ) THEN
    ALTER TABLE public.tenant_clinic_profile
      ADD CONSTRAINT tenant_clinic_profile_portal_brand_color_hex
      CHECK (portal_brand_color IS NULL OR portal_brand_color ~ '^#[0-9A-Fa-f]{6}$');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'tenant_clinic_profile_portal_surface_color_hex'
  ) THEN
    ALTER TABLE public.tenant_clinic_profile
      ADD CONSTRAINT tenant_clinic_profile_portal_surface_color_hex
      CHECK (portal_surface_color IS NULL OR portal_surface_color ~ '^#[0-9A-Fa-f]{6}$');
  END IF;
END $$;

COMMENT ON COLUMN public.tenant_clinic_profile.portal_brand_color IS
  'Feature 058 — cor de destaque da clínica no portal do paciente (#RRGGBB). Aplica-se a ações, ícones de área e indicadores; fundo e texto de leitura seguem a escala neutra derivada. NULL = paleta padrão do produto. Só vale junto de portal_surface_color: uma sozinha cai no padrão.';

COMMENT ON COLUMN public.tenant_clinic_profile.portal_surface_color IS
  'Feature 058 — cor de fundo do portal do paciente (#RRGGBB). É dela que a aplicação deriva cartão, borda, texto e texto de apoio, nos dois sentidos (fundo claro ou escuro). A cor do TEXTO nunca é gravada: é derivada para o contraste de leitura ser invariante, e não preferência de quem configura.';

NOTIFY pgrst, 'reload schema';
