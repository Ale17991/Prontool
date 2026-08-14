/**
 * Feature 058 — a paleta do portal daquela clínica.
 *
 * A clínica escolhe DUAS cores: o destaque (ações, ícones de área, indicadores)
 * e o fundo. Todo o resto — texto, cartão, borda, texto de apoio, a cor que vai
 * SOBRE o destaque — é derivado aqui, nunca escolhido. É essa assimetria que
 * torna o SC-002 verdadeiro por construção em vez de por revisão: não existe par
 * de cores que produza texto ilegível, porque o texto não é uma das cores que se
 * escolhe.
 *
 * Duas cores dão liberdade real de marca (dá para montar um portal escuro), e
 * por isso a derivação precisa funcionar nos DOIS sentidos: com fundo claro o
 * cartão é mais claro que o fundo e o texto é quase preto; com fundo escuro o
 * cartão continua mais claro que o fundo e o texto vira quase branco. É a mesma
 * regra, não dois temas mantidos em paralelo.
 *
 * A saída é o conjunto de variáveis CSS que o design system já consome
 * (`--background`, `--card`, `--primary`…, em `globals.css`). Foi a 057 que
 * tornou isso possível: enquanto o portal escrevia `bg-slate-50` na mão, nenhuma
 * troca de tema alcançava a tela. Trocar as variáveis num wrapper alcança tudo
 * que fala essa língua — e só o portal, porque o wrapper é do portal (FR-008).
 *
 * O que NÃO é derivado da marca: sucesso, atenção, alerta e informação. São
 * significado, não identidade — um resultado alterado tem que ser vermelho na
 * clínica de marca verde. Ficam na semântica do produto, como pares fechados
 * (fundo + texto próprios), que continuam legíveis sobre qualquer superfície.
 *
 * Módulo PURO e isomórfico: sem `next/*`, sem Supabase. Roda no servidor (que
 * emite o CSS) e no cliente (que desenha a prévia na tela de configuração).
 */

// =========================================================================
// Cor: conversões e contraste (WCAG 2.1)
// =========================================================================

export interface Rgb {
  r: number
  g: number
  b: number
}

export interface Hsl {
  h: number
  s: number
  l: number
}

const HEX_RE = /^#([0-9a-fA-F]{6})$/

/** `#RRGGBB` → RGB. Devolve `null` em qualquer outra grafia (FR-005). */
export function parseHexColor(hex: string | null | undefined): Rgb | null {
  if (typeof hex !== 'string') return null
  const m = HEX_RE.exec(hex.trim())
  if (!m) return null
  const n = Number.parseInt(m[1]!, 16)
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }
}

export function isValidHexColor(hex: string | null | undefined): boolean {
  return parseHexColor(hex) !== null
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

function channelToLinear(c: number): number {
  const s = c / 255
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
}

/** Luminância relativa WCAG (0 = preto, 1 = branco). */
export function relativeLuminance(rgb: Rgb): number {
  return (
    0.2126 * channelToLinear(rgb.r) +
    0.7152 * channelToLinear(rgb.g) +
    0.0722 * channelToLinear(rgb.b)
  )
}

/** Razão de contraste WCAG entre duas luminâncias (1 a 21). */
export function contrastFromLuminance(a: number, b: number): number {
  const hi = Math.max(a, b)
  const lo = Math.min(a, b)
  return (hi + 0.05) / (lo + 0.05)
}

export function contrastRatio(a: Rgb, b: Rgb): number {
  return contrastFromLuminance(relativeLuminance(a), relativeLuminance(b))
}

export function rgbToHsl({ r, g, b }: Rgb): Hsl {
  const rn = r / 255
  const gn = g / 255
  const bn = b / 255
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const l = (max + min) / 2
  const d = max - min
  if (d === 0) return { h: 0, s: 0, l: l * 100 }
  const s = d / (1 - Math.abs(2 * l - 1))
  let h: number
  if (max === rn) h = ((gn - bn) / d) % 6
  else if (max === gn) h = (bn - rn) / d + 2
  else h = (rn - gn) / d + 4
  h *= 60
  if (h < 0) h += 360
  return { h, s: s * 100, l: l * 100 }
}

export function hslToRgb({ h, s, l }: Hsl): Rgb {
  const sn = clamp(s, 0, 100) / 100
  const ln = clamp(l, 0, 100) / 100
  const c = (1 - Math.abs(2 * ln - 1)) * sn
  const hp = (((h % 360) + 360) % 360) / 60
  const x = c * (1 - Math.abs((hp % 2) - 1))
  let rgb: [number, number, number]
  if (hp < 1) rgb = [c, x, 0]
  else if (hp < 2) rgb = [x, c, 0]
  else if (hp < 3) rgb = [0, c, x]
  else if (hp < 4) rgb = [0, x, c]
  else if (hp < 5) rgb = [x, 0, c]
  else rgb = [c, 0, x]
  const m = ln - c / 2
  return {
    r: Math.round((rgb[0] + m) * 255),
    g: Math.round((rgb[1] + m) * 255),
    b: Math.round((rgb[2] + m) * 255),
  }
}

const round = (v: number, d: number) => {
  const p = 10 ** d
  return Math.round(v * p) / p
}

/**
 * A cor exatamente como ela vai sair no CSS.
 *
 * Toda medição de contraste passa por aqui antes de virar luminância, e isso
 * não é preciosismo: a derivação afina cores no fio do mínimo, e uma diferença
 * na terceira casa do matiz muda um canal RGB em uma unidade depois do
 * arredondamento — o bastante para uma cor medida em 4,50:1 chegar ao navegador
 * valendo 4,45:1. Medir o valor de trabalho e emitir outro é garantir o que não
 * se entrega.
 */
function quantizeHsl({ h, s, l }: Hsl): Hsl {
  return {
    h: round(((h % 360) + 360) % 360, 2),
    s: round(clamp(s, 0, 100), 3),
    l: round(clamp(l, 0, 100), 3),
  }
}

function luminanceOfHsl(hsl: Hsl): number {
  return relativeLuminance(hslToRgb(quantizeHsl(hsl)))
}

/**
 * `H S% L%` — o formato que `hsl(var(--token))` espera em `globals.css`.
 *
 * Três casas na luminosidade, e não uma, porque é ela que carrega o contraste:
 * uma cor afinada em exatamente 4,5:1 e depois arredondada para o décimo mais
 * próximo desce para 4,49 — o suficiente para deixar de cumprir o mínimo que a
 * derivação acabou de garantir. O CSS é lido por máquina; as casas não custam
 * nada e fecham a diferença entre o que se calcula e o que se emite.
 */
function formatHsl(hsl: Hsl): string {
  const { h, s, l } = quantizeHsl(hsl)
  return `${h} ${s}% ${l}%`
}

export function hslToHex(hsl: Hsl): string {
  const { r, g, b } = hslToRgb(quantizeHsl(hsl))
  const hex = (v: number) => v.toString(16).padStart(2, '0')
  return `#${hex(r)}${hex(g)}${hex(b)}`
}

/**
 * Mistura `a` em direção a `b` (0 = só `a`, 1 = só `b`), em HSL.
 *
 * O matiz caminha pelo arco CURTO. Interpolar 350° e 10° pela via longa passaria
 * por todo o verde — a mistura de um vermelho com um vermelho sairia verde.
 */
function mixToward(a: Hsl, b: Hsl, amount: number): Hsl {
  const t = clamp(amount, 0, 1)
  let dh = ((b.h - a.h) % 360 + 540) % 360 - 180
  // Cor sem matiz (cinza puro) não tem direção: herda a do outro lado.
  if (a.s === 0) dh = 0
  return {
    h: a.s === 0 ? b.h : a.h + dh * t,
    s: a.s + (b.s - a.s) * t,
    l: a.l + (b.l - a.l) * t,
  }
}

/**
 * Caminha a luminosidade de `color` até bater o contraste alvo contra um fundo.
 *
 * Tenta os DOIS sentidos e fica com o que chega ao alvo com a menor mudança —
 * ou seja, com a cor mais parecida com a que a clínica escolheu. Antes o
 * sentido era adivinhado por um limiar de luminância do fundo, e o palpite
 * errava justamente onde o problema é difícil: fundo de tom intermediário, em
 * que clarear e escurecer são ambos plausíveis e só um dos dois chega. O
 * sintoma era a cor da clínica sumindo dentro do cartão.
 *
 * Passo de 1% é grosseiro de propósito: a alternativa (busca binária) devolve
 * cores com casas decimais que ninguém confere a olho, e a diferença visual
 * entre 4,52:1 e 4,50:1 é nenhuma.
 */
function pushUntilContrast(color: Hsl, againstLum: number, target: number): Hsl {
  const ratioAt = (l: number) =>
    contrastFromLuminance(luminanceOfHsl({ ...color, l }), againstLum)
  if (ratioAt(color.l) >= target) return color

  let best = color.l
  let bestRatio = ratioAt(color.l)
  let winner: number | null = null
  let winnerDistance = Infinity

  for (const step of [-1, 1]) {
    let l = color.l
    for (let i = 0; i < 100; i++) {
      const next = clamp(l + step, 0, 100)
      if (next === l) break
      l = next
      const ratio = ratioAt(l)
      if (ratio > bestRatio) {
        bestRatio = ratio
        best = l
      }
      if (ratio >= target) {
        const distance = Math.abs(l - color.l)
        if (distance < winnerDistance) {
          winnerDistance = distance
          winner = l
        }
        break
      }
    }
  }
  return { ...color, l: winner ?? best }
}

// =========================================================================
// A paleta do portal
// =========================================================================

export interface PortalPalette {
  /** Cor de destaque da clínica (`#RRGGBB`). */
  brand: string
  /** Cor de fundo do portal (`#RRGGBB`). */
  surface: string
}

export interface PortalChartColors {
  /** Eixos e rótulos do gráfico. */
  axis: string
  /** Linhas de grade. */
  grid: string
  /** Série/fatia em destaque — a cor da clínica. */
  accent: string
  /** Série/fatia de apoio — neutra, derivada da superfície. */
  neutral: string
  /** Texto sobre o gráfico. */
  text: string
}

export interface PortalTheme {
  /** Variáveis CSS (`--token` → `H S% L%`) para o wrapper do portal. */
  vars: Record<string, string>
  /**
   * Cores resolvidas em hex. SVG resolve `var()` em atributo de apresentação de
   * forma inconsistente entre navegadores, e o recharts escreve `stroke`/`fill`
   * como atributo — então gráfico recebe VALOR, não variável.
   */
  chart: PortalChartColors
  /** O fundo escolhido é escuro? Decide o sentido de toda a derivação. */
  dark: boolean
}

/** Contraste mínimo para texto normal (WCAG AA). */
const AA_TEXT = 4.5
/** Contraste mínimo para elemento de interface não-textual (WCAG 1.4.11). */
const AA_UI = 3
/**
 * O que se exige do CARTÃO, que é onde mora praticamente todo o texto do
 * portal. Bem acima do mínimo de propósito: 4,5:1 é o piso do que se consegue
 * ler, não o conforto de quem vai passar minutos numa tela de acompanhamento —
 * e a paleta padrão do produto entrega ~11:1.
 */
const CARD_TEXT = 7

/**
 * Empurra a superfície de leitura para longe do meio da escala até que ela
 * consiga carregar texto.
 *
 * Cor de tom médio — um vinho, um verde-musgo, um rosa forte — não sustenta
 * texto em nenhuma das duas pontas: preto e branco dão os dois na casa dos 4:1.
 * Uma clínica pode legitimamente escolher uma dessas como fundo, e o fundo
 * escolhido é preservado exatamente como veio; o que cede é o CARTÃO, que é
 * peça derivada e existe para ser lida.
 *
 * O sentido é o mesmo que o tema já tomou: fundo escuro aprofunda o cartão,
 * fundo claro o clareia. Sai daí a página vívida com cartões sóbrios em cima —
 * que é como esse tipo de marca é desenhado de qualquer jeito.
 */
function readableSurface(candidate: Hsl, dark: boolean, inks: readonly Hsl[]): Hsl {
  // Mede contra as tintas REAIS do tema, não contra preto e branco puros. As
  // duas são levemente tingidas pelo matiz do fundo (cinza puro sobre fundo
  // colorido parece sujo), e essa diferença já custa alguns décimos de razão —
  // o bastante para o cartão parar de ceder cedo demais e ficar em 6,7:1.
  const inkLums = inks.map(luminanceOfHsl)
  const best = (hsl: Hsl) => {
    const lum = luminanceOfHsl(hsl)
    return Math.max(...inkLums.map((ink) => contrastFromLuminance(ink, lum)))
  }
  let current = candidate
  const step = dark ? -1 : 1
  for (let i = 0; i < 100 && best(current) < CARD_TEXT; i++) {
    const next = clamp(current.l + step, 0, 100)
    if (next === current.l) break
    current = { ...current, l: next }
  }
  return current
}

/**
 * Motivos de um par ser recusado. São só DOIS, e os dois são casos em que a
 * derivação não tem o que salvar sem trocar uma cor que a clínica escolheu:
 * a marca indistinguível do fundo (não há o que destacar) e o fundo de tom
 * médio (nenhuma tinta lê bem em cima). Todo o resto — texto, borda, apoio,
 * rótulo dentro do botão — é resolvido derivando, nunca recusando.
 */
export type PortalPaletteError =
  | 'invalid_color'
  | 'brand_too_close_to_surface'
  | 'surface_cannot_carry_text'

/** As duas tintas possíveis do tema, tingidas pelo matiz do próprio fundo. */
function inkCandidates(surface: Hsl): [Hsl, Hsl] {
  return [
    { h: surface.h, s: clamp(surface.s, 0, 22), l: 11 },
    { h: surface.h, s: clamp(surface.s, 0, 14), l: 97 },
  ]
}

export function validatePortalPalette(palette: PortalPalette): PortalPaletteError | null {
  const brand = parseHexColor(palette.brand)
  const surface = parseHexColor(palette.surface)
  if (!brand || !surface) return 'invalid_color'
  if (contrastRatio(brand, surface) < 1.6) return 'brand_too_close_to_surface'

  // O fundo é a única cor que a derivação NÃO pode ajustar: é a que a clínica
  // vê no seletor e a que ela reconhece como sua. Como não pode ceder, tem que
  // servir — e há uma faixa estreita, bem no meio da escala, que não serve para
  // nada: um magenta vivo, um vinho, um cinza médio dão por volta de 4:1 tanto
  // com tinta clara quanto com escura. Não é que fique feio; é que nenhuma cor
  // de texto no mundo lê bem em cima.
  //
  // Recusar é mais honesto do que aceitar e depois clarear a cor por baixo do
  // pano: a clínica escolheria um tom e veria outro, sem entender por quê.
  const surfaceHsl = rgbToHsl(surface)
  const surfaceLum = relativeLuminance(surface)
  const readable = inkCandidates(surfaceHsl).some(
    (ink) => contrastFromLuminance(luminanceOfHsl(ink), surfaceLum) >= AA_TEXT,
  )
  if (!readable) return 'surface_cannot_carry_text'
  return null
}

export const PORTAL_PALETTE_ERROR_MESSAGE: Record<PortalPaletteError, string> = {
  invalid_color: 'Use cores no formato #RRGGBB.',
  brand_too_close_to_surface:
    'A cor de destaque está próxima demais da cor de fundo — ela não apareceria na tela. Escolha um destaque mais claro ou mais escuro.',
  surface_cannot_carry_text:
    'Esta cor de fundo fica no meio do caminho entre claro e escuro, e nenhum tom de texto se lê bem sobre ela. Escolha um fundo mais claro ou mais escuro — a cor de destaque pode continuar sendo esta.',
}

/**
 * Deriva o tema completo do portal a partir das duas cores da clínica.
 *
 * Devolve `null` quando o par não serve (inválido ou indistinguível), e o
 * chamador cai na paleta padrão do produto (FR-004/FR-005). Cor guardada torta
 * no banco não pode derrubar a página do paciente.
 */
export function buildPortalTheme(palette: PortalPalette): PortalTheme | null {
  if (validatePortalPalette(palette) !== null) return null
  const surfaceRgb = parseHexColor(palette.surface)!
  const brandRgb = parseHexColor(palette.brand)!

  const surface = rgbToHsl(surfaceRgb)
  const brand = rgbToHsl(brandRgb)

  // As duas tintas possíveis do tema, levemente tingidas pelo matiz do fundo:
  // cinza puro sobre fundo colorido parece sujo. Ficam definidas ANTES de tudo
  // porque é contra elas que o fundo já foi aprovado na validação, e é uma
  // delas que vai ser o texto.
  const [nearBlack, nearWhite] = inkCandidates(surface)
  const surfaceLum = relativeLuminance(surfaceRgb)

  /**
   * "Tema escuro" NÃO é "o fundo é escuro por algum limiar", e a diferença
   * importa. A pergunta que o tema precisa responder é qual TINTA o fundo
   * carrega — e ela é decidida medindo as duas, não comparando a luminância com
   * um número redondo.
   *
   * Com o limiar, um fundo de luminância 0,23 caía como "escuro", o cartão era
   * aprofundado, o texto virava claro… e esse texto claro tinha 3,5:1 contra o
   * fundo que a clínica escolheu, enquanto o texto escuro — descartado pelo
   * limiar — tinha 4,6:1. O tema escolhia a pior das duas tintas por causa de
   * uma constante.
   */
  const dark =
    contrastFromLuminance(luminanceOfHsl(nearWhite), surfaceLum) >
    contrastFromLuminance(luminanceOfHsl(nearBlack), surfaceLum)

  // ---------------------------------------------------------------------
  // Superfícies. O cartão nasce um degrau mais claro que o fundo — em tema claro
  // isso reproduz o que o produto já faz (fundo levemente acinzentado, cartão
  // branco), e em tema escuro é o que separa o cartão do vazio atrás dele.
  //
  // Depois ele passa por `readableSurface`, que é quem manda: se aquele degrau
  // não sustentar texto, o cartão se afasta do meio da escala até sustentar. Com
  // fundo comum nada acontece; com fundo de cor forte o cartão pode acabar mais
  // FUNDO que a página, e é o resultado certo — página vívida, cartões sóbrios.
  //
  // Quando o fundo já é branco, cartão e fundo se encontram no topo da escala e
  // quem separa é a borda, que todo `Card` do design system desenha.
  // ---------------------------------------------------------------------
  const background = surface
  const card = readableSurface({ ...surface, l: clamp(surface.l + 6, 0, 100) }, dark, [
    nearBlack,
    nearWhite,
  ])
  const cardLum = luminanceOfHsl(card)

  // ---------------------------------------------------------------------
  // Texto. Vence a tinta de maior contraste com o CARTÃO, que é onde o texto de
  // fato mora.
  // ---------------------------------------------------------------------
  const foreground =
    contrastFromLuminance(luminanceOfHsl(nearBlack), cardLum) >=
    contrastFromLuminance(luminanceOfHsl(nearWhite), cardLum)
      ? nearBlack
      : nearWhite

  // Texto de apoio: caminha do texto principal em direção ao cartão e PARA no
  // limite legível. É o oposto de escolher um cinza bonito e torcer.
  const mutedForeground = (() => {
    let best = foreground
    for (let t = 0.1; t <= 0.75; t += 0.05) {
      const candidate = mixToward(foreground, card, t)
      if (contrastFromLuminance(luminanceOfHsl(candidate), cardLum) < AA_TEXT) break
      best = candidate
    }
    return best
  })()

  const border = mixToward(card, foreground, dark ? 0.2 : 0.13)
  const mutedSurface = mixToward(card, foreground, 0.07)

  // ---------------------------------------------------------------------
  // A marca. Primeiro garante que ela APAREÇA sobre o cartão (elemento de
  // interface: 3:1). Depois garante que o rótulo dentro dela seja legível
  // (texto: 4,5:1) — e, se não for, é a MARCA que cede, nunca o rótulo.
  // ---------------------------------------------------------------------
  const primaryBase = pushUntilContrast(brand, cardLum, AA_UI)
  // O ajuste do rótulo só pode andar para LONGE do cartão. Livre, ele podia
  // voltar em direção ao cartão para caber um rótulo e desfazer os 3:1 que a
  // linha acima acabou de garantir — a marca sumia dentro do próprio cartão
  // para que o texto dentro dela ficasse legível. Afastando, as duas garantias
  // andam juntas: quanto mais a cor se aproxima de uma ponta da escala, mais
  // fácil é achar um rótulo que caiba nela.
  const awayFromCard = luminanceOfHsl(primaryBase) >= cardLum ? 1 : -1
  const { fill: primary, label: primaryForeground } = ensureLabelFits(primaryBase, awayFromCard)

  // A marca como TEXTO (link, valor em destaque) pede 4,5:1 contra o cartão —
  // muito mais que os 3:1 do preenchimento. São duas variantes da mesma cor
  // porque são dois usos com exigências diferentes, não por estética.
  const brandText = pushUntilContrast(brand, cardLum, AA_TEXT)
  // Tinta suave para fundo de selo e hover. Fica perto do cartão de propósito:
  // é fundo, e o texto vai em cima dela.
  const brandBg = mixToward(card, primary, dark ? 0.22 : 0.14)
  const brandBgLum = luminanceOfHsl(brandBg)
  // O texto do selo é calibrado contra o SELO, não contra o cartão. Parece
  // detalhe e não é: o selo é uma tinta da marca sobre o cartão, então é sempre
  // um pouco mais escuro (ou mais claro) que ele — e uma cor afinada em 4,5:1
  // contra o cartão cai abaixo do mínimo assim que muda de fundo. Foi
  // exatamente o que a varredura do SC-002 encontrou, em toda marca de tom
  // médio-claro.
  //
  // E quando nem assim dá — o matiz da marca é escuro demais ou claro demais
  // para render 4,5:1 naquele selo em QUALQUER luminosidade —, o que cede é a
  // marca, não a leitura: o rótulo cai na tinta do tema. Perder a cor num selo
  // é um detalhe; texto ilegível num portal de saúde não é.
  const brandOnBrandBg = (() => {
    const tinted = pushUntilContrast(brand, brandBgLum, AA_TEXT)
    if (contrastFromLuminance(luminanceOfHsl(tinted), brandBgLum) >= AA_TEXT) return tinted
    return contrastFromLuminance(luminanceOfHsl(nearWhite), brandBgLum) >=
      contrastFromLuminance(luminanceOfHsl(nearBlack), brandBgLum)
      ? nearWhite
      : nearBlack
  })()

  const vars: Record<string, string> = {
    '--background': formatHsl(background),
    '--foreground': formatHsl(foreground),
    '--card': formatHsl(card),
    '--card-foreground': formatHsl(foreground),
    '--popover': formatHsl(card),
    '--popover-foreground': formatHsl(foreground),
    '--primary': formatHsl(primary),
    '--primary-foreground': formatHsl(primaryForeground),
    '--secondary': formatHsl(mutedSurface),
    '--secondary-foreground': formatHsl(foreground),
    '--muted': formatHsl(mutedSurface),
    '--muted-foreground': formatHsl(mutedForeground),
    '--accent': formatHsl(brandBg),
    '--accent-foreground': formatHsl(brandOnBrandBg),
    '--border': formatHsl(border),
    '--input': formatHsl(border),
    '--ring': formatHsl(primary),
    // O laranja do produto vira a cor da clínica dentro do portal: `brand` é o
    // token de AÇÃO em `globals.css`, e é exatamente o papel que a cor escolhida
    // cumpre aqui.
    '--brand': formatHsl(primary),
    '--brand-strong': formatHsl(primary),
    '--brand-foreground': formatHsl(primaryForeground),
    '--brand-bg': formatHsl(brandBg),
    '--brand-text': formatHsl(brandText),
    '--steel': formatHsl(mutedForeground),
    // Link é ação, e ação é a marca.
    '--link': formatHsl(brandText),
  }

  return {
    vars,
    dark,
    chart: {
      axis: hslToHex(mutedForeground),
      grid: hslToHex(border),
      accent: hslToHex(primary),
      // A fatia/série de apoio é NEUTRA de propósito: com duas cores fortes o
      // olho não sabe qual é a informação. A marca marca o que importa.
      neutral: hslToHex(mixToward(card, foreground, dark ? 0.32 : 0.24)),
      text: hslToHex(foreground),
    },
  }

  /**
   * Escolhe o rótulo (claro ou escuro) e, se nenhum servir, cede na cor de
   * preenchimento — sempre no sentido `step`, que aponta para longe do cartão.
   */
  function ensureLabelFits(fill: Hsl, step: number): { fill: Hsl; label: Hsl } {
    const light: Hsl = { h: fill.h, s: clamp(fill.s, 0, 12), l: 99 }
    const dark2: Hsl = { h: fill.h, s: clamp(fill.s, 0, 25), l: 9 }
    let current = fill
    for (let i = 0; i < 200; i++) {
      const lum = luminanceOfHsl(current)
      const cLight = contrastFromLuminance(luminanceOfHsl(light), lum)
      const cDark = contrastFromLuminance(luminanceOfHsl(dark2), lum)
      const label = cLight >= cDark ? light : dark2
      if (Math.max(cLight, cDark) >= AA_TEXT) return { fill: current, label }
      const next = clamp(current.l + step, 0, 100)
      if (next === current.l) return { fill: current, label }
      current = { ...current, l: next }
    }
    return { fill: current, label: dark2 }
  }
}

/**
 * Serializa o tema como bloco CSS. Só sai daqui número formatado por
 * `formatHsl` — nada do que a clínica digitou chega cru ao CSS, então não há
 * superfície para injeção mesmo que a coluna do banco seja adulterada.
 */
export function portalThemeToCss(theme: PortalTheme, selector = ':root'): string {
  const body = Object.entries(theme.vars)
    .map(([k, v]) => `${k}:${v};`)
    .join('')
  return `${selector}{${body}}`
}

/**
 * Tema da clínica a partir do que está gravado, ou `null` para a paleta padrão.
 *
 * Personalização é opt-in e PARCIAL não existe: só uma das duas cores gravada
 * cai no padrão. Aplicar um destaque sobre o fundo do produto (ou o contrário)
 * entregaria uma combinação que ninguém escolheu nem revisou.
 */
export function resolvePortalTheme(
  brand: string | null | undefined,
  surface: string | null | undefined,
): PortalTheme | null {
  if (!brand || !surface) return null
  return buildPortalTheme({ brand, surface })
}
