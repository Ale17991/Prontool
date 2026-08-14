import { describe, expect, it } from 'vitest'
import {
  buildPortalTheme,
  contrastFromLuminance,
  contrastRatio,
  hslToRgb,
  isValidHexColor,
  parseHexColor,
  portalThemeToCss,
  relativeLuminance,
  resolvePortalTheme,
  validatePortalPalette,
  type PortalTheme,
} from '@/lib/core/patient-portal/theme'

/**
 * Feature 058 — a promessa do SC-002 é forte: 100% das combinações de cor
 * escolhíveis mantêm contraste de leitura. Ela só vale se for verificada sobre
 * um CONJUNTO amplo de pares, e não sobre os três que alguém achou bonitos.
 *
 * A grade abaixo varre matiz, saturação e luminosidade dos dois lados —
 * inclusive os casos que quebram implementações ingênuas: fundo branco puro,
 * fundo preto puro, cinza sem matiz, e marca no meio da escala (onde nem texto
 * branco nem texto preto passam sozinhos e a cor precisa ceder).
 */

/** `H S% L%` de volta a RGB, para medir o contraste do que foi emitido. */
function rgbOfVar(theme: PortalTheme, name: string) {
  const raw = theme.vars[name]
  if (!raw) throw new Error(`variável ausente: ${name}`)
  const [h, s, l] = raw.split(' ')
  return hslToRgb({
    h: Number(h),
    s: Number(String(s).replace('%', '')),
    l: Number(String(l).replace('%', '')),
  })
}

function contrastOfVars(theme: PortalTheme, a: string, b: string): number {
  return contrastRatio(rgbOfVar(theme, a), rgbOfVar(theme, b))
}

const HUES = [0, 35, 72, 140, 200, 214, 265, 310, 350]
const SURFACES: string[] = ['#ffffff', '#000000', '#f7f8fa', '#0f172a', '#141d23', '#808080']
const BRANDS: string[] = ['#003883', '#ee4b00', '#ffffff', '#000000', '#808080', '#7c3aed']

for (const h of HUES) {
  for (const l of [8, 22, 50, 78, 96]) {
    SURFACES.push(hexOf(h, 45, l))
    BRANDS.push(hexOf(h, 85, l))
  }
}

function hexOf(h: number, s: number, l: number): string {
  const { r, g, b } = hslToRgb({ h, s, l })
  const two = (v: number) => v.toString(16).padStart(2, '0')
  return `#${two(r)}${two(g)}${two(b)}`
}

describe('cores: conversão e contraste', () => {
  it('só aceita #RRGGBB', () => {
    expect(isValidHexColor('#003883')).toBe(true)
    expect(isValidHexColor('#00388')).toBe(false)
    expect(isValidHexColor('003883')).toBe(false)
    expect(isValidHexColor('rgb(0,56,131)')).toBe(false)
    expect(isValidHexColor('#00388g')).toBe(false)
    expect(isValidHexColor(null)).toBe(false)
    expect(isValidHexColor(undefined)).toBe(false)
  })

  it('mede contraste como a WCAG manda', () => {
    const white = parseHexColor('#ffffff')!
    const black = parseHexColor('#000000')!
    expect(contrastRatio(white, black)).toBeCloseTo(21, 1)
    expect(contrastRatio(white, white)).toBeCloseTo(1, 5)
    expect(relativeLuminance(white)).toBeCloseTo(1, 5)
    expect(relativeLuminance(black)).toBeCloseTo(0, 5)
    // Ordem não importa: é razão entre a mais clara e a mais escura.
    expect(contrastFromLuminance(0.1, 0.8)).toBeCloseTo(contrastFromLuminance(0.8, 0.1), 8)
  })
})

describe('validação do par', () => {
  it('recusa cor fora do formato', () => {
    expect(validatePortalPalette({ brand: 'azul', surface: '#ffffff' })).toBe('invalid_color')
    expect(validatePortalPalette({ brand: '#003883', surface: '#fff' })).toBe('invalid_color')
  })

  it('recusa marca que se confunde com o fundo — não há o que destacar', () => {
    expect(validatePortalPalette({ brand: '#ffffff', surface: '#ffffff' })).toBe(
      'brand_too_close_to_surface',
    )
    expect(validatePortalPalette({ brand: '#f7f8fa', surface: '#ffffff' })).toBe(
      'brand_too_close_to_surface',
    )
  })

  it('aceita o par bem contrastado', () => {
    expect(validatePortalPalette({ brand: '#003883', surface: '#ffffff' })).toBeNull()
    expect(validatePortalPalette({ brand: '#7c3aed', surface: '#0f172a' })).toBeNull()
  })
})

describe('SC-002 — nenhum par escolhível produz tela ilegível', () => {
  const pairs = SURFACES.flatMap((surface) => BRANDS.map((brand) => ({ brand, surface }))).filter(
    (p) => validatePortalPalette(p) === null,
  )

  it('a grade de teste é ampla e sobreviveu à validação', () => {
    // Guarda-corpo do próprio teste: se um dia a validação passar a recusar
    // quase tudo, a varredura abaixo continuaria "verde" sem verificar nada.
    expect(pairs.length).toBeGreaterThan(400)
  })

  it.each(pairs)('texto legível sobre o cartão — $brand em $surface', ({ brand, surface }) => {
    const theme = buildPortalTheme({ brand, surface })!
    expect(theme).not.toBeNull()
    // Texto principal: bem acima do mínimo, porque é onde o paciente lê tudo.
    expect(contrastOfVars(theme, '--foreground', '--card')).toBeGreaterThanOrEqual(7)
    // Texto de apoio: AA para texto normal.
    expect(contrastOfVars(theme, '--muted-foreground', '--card')).toBeGreaterThanOrEqual(4.5)
    // O rótulo DENTRO do botão da marca.
    expect(contrastOfVars(theme, '--primary-foreground', '--primary')).toBeGreaterThanOrEqual(4.5)
    // A marca como texto (link, valor em destaque) sobre o cartão.
    expect(contrastOfVars(theme, '--brand-text', '--card')).toBeGreaterThanOrEqual(4.5)
    // O botão da marca precisa aparecer sobre o cartão (elemento de interface).
    expect(contrastOfVars(theme, '--primary', '--card')).toBeGreaterThanOrEqual(3)
    // Texto sobre o fundo suave de selo/hover.
    expect(contrastOfVars(theme, '--accent-foreground', '--accent')).toBeGreaterThanOrEqual(4.5)
    // Texto principal também sobre o FUNDO — o rodapé e os títulos que ficam
    // fora de cartão. Aqui o piso é AA e não os 7:1 do cartão: o fundo é a cor
    // que a clínica escolheu e é preservada como veio, então ela não pode ser
    // empurrada para acomodar texto. Quem cede é o cartão, que é derivado.
    expect(contrastOfVars(theme, '--foreground', '--background')).toBeGreaterThanOrEqual(4.5)
  })
})

describe('derivação', () => {
  it('reconhece fundo escuro e claro, e o cartão é sempre mais claro que o fundo', () => {
    const claro = buildPortalTheme({ brand: '#003883', surface: '#f7f8fa' })!
    const escuro = buildPortalTheme({ brand: '#7c3aed', surface: '#0f172a' })!
    expect(claro.dark).toBe(false)
    expect(escuro.dark).toBe(true)
    expect(relativeLuminance(rgbOfVar(escuro, '--card'))).toBeGreaterThan(
      relativeLuminance(rgbOfVar(escuro, '--background')),
    )
  })

  it('inverte o texto conforme o fundo, sem manter dois temas em paralelo', () => {
    const claro = buildPortalTheme({ brand: '#003883', surface: '#ffffff' })!
    const escuro = buildPortalTheme({ brand: '#7c3aed', surface: '#0f172a' })!
    expect(relativeLuminance(rgbOfVar(claro, '--foreground'))).toBeLessThan(0.2)
    expect(relativeLuminance(rgbOfVar(escuro, '--foreground'))).toBeGreaterThan(0.7)
  })

  it('a marca cede quando nenhum rótulo cabe nela', () => {
    // Um amarelo médio: branco em cima dá ~2:1, preto dá ~2,5:1. Nem um nem
    // outro serve, então o preenchimento tem que se mover.
    const theme = buildPortalTheme({ brand: '#c8a415', surface: '#ffffff' })!
    expect(contrastOfVars(theme, '--primary-foreground', '--primary')).toBeGreaterThanOrEqual(4.5)
  })

  it('devolve cores de gráfico em hex, porque SVG não resolve variável CSS', () => {
    const theme = buildPortalTheme({ brand: '#003883', surface: '#ffffff' })!
    for (const v of Object.values(theme.chart)) {
      expect(v).toMatch(/^#[0-9a-f]{6}$/)
    }
    // A fatia de apoio é neutra e a de destaque é a marca: com duas cores
    // fortes o olho não sabe qual é a informação.
    expect(theme.chart.accent).not.toBe(theme.chart.neutral)
  })

  it('cinza puro não ganha matiz inventado na mistura', () => {
    const theme = buildPortalTheme({ brand: '#003883', surface: '#f2f2f2' })!
    // A borda nasce do cartão (cinza) misturado ao texto (cinza): continua
    // cinza. Uma interpolação de matiz malfeita pintaria a borda de vermelho.
    const border = rgbOfVar(theme, '--border')
    expect(Math.abs(border.r - border.g)).toBeLessThanOrEqual(2)
    expect(Math.abs(border.g - border.b)).toBeLessThanOrEqual(2)
  })
})

describe('queda para a paleta padrão (FR-004/FR-005)', () => {
  it('sem as duas cores, não há tema', () => {
    expect(resolvePortalTheme(null, null)).toBeNull()
    expect(resolvePortalTheme('#003883', null)).toBeNull()
    expect(resolvePortalTheme(null, '#ffffff')).toBeNull()
    expect(resolvePortalTheme('', '')).toBeNull()
  })

  it('cor corrompida no banco não derruba a página — cai no padrão', () => {
    expect(resolvePortalTheme('não-é-cor', '#ffffff')).toBeNull()
    expect(resolvePortalTheme('#003883', 'javascript:alert(1)')).toBeNull()
    expect(buildPortalTheme({ brand: '#zzzzzz', surface: '#ffffff' })).toBeNull()
  })
})

describe('CSS emitido', () => {
  const theme = buildPortalTheme({ brand: '#003883', surface: '#ffffff' })!

  it('só emite número formatado — nada do que a clínica digitou chega cru', () => {
    const css = portalThemeToCss(theme)
    expect(css.startsWith(':root{')).toBe(true)
    const body = css.slice(':root{'.length, -1)
    for (const decl of body.split(';').filter(Boolean)) {
      expect(decl).toMatch(/^--[a-z-]+:\d+(\.\d+)? \d+(\.\d+)?% \d+(\.\d+)?%$/)
    }
    // Nenhum caractere capaz de fechar a regra ou abrir outra.
    expect(css.slice(6, -1)).not.toMatch(/[<>{}"'\\]/)
  })

  it('aceita seletor próprio', () => {
    expect(portalThemeToCss(theme, '.portal').startsWith('.portal{')).toBe(true)
  })
})
