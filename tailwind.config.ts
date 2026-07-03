import type { Config } from 'tailwindcss'

/**
 * Paleta inspirada no design do Google AI Studio (slate + blue), porém
 * implementada via CSS variables HSL pra compatibilidade total com
 * shadcn/ui (Radix-based) e Tailwind v3. Cores específicas (slate-50…900,
 * blue-600, emerald-500) já vêm do palette padrão do Tailwind.
 */
const config: Config = {
  // 016 — dark mode removido (FR-015). Light mode é definitivo.
  content: ['./src/app/**/*.{ts,tsx}', './src/components/**/*.{ts,tsx}', './src/lib/**/*.{ts,tsx}'],
  theme: {
    container: {
      center: true,
      padding: '2rem',
      screens: { '2xl': '1400px' },
    },
    extend: {
      fontFamily: {
        // 016 — Inter via next/font/google injeta --font-sans em <html>.
        sans: ['var(--font-sans)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        // 016 — semantic tokens (HSL triples consumed via hsl(var(--token)))
        success: {
          DEFAULT: 'hsl(var(--success))',
          foreground: 'hsl(var(--success-foreground))',
          bg: 'hsl(var(--success-bg))',
          text: 'hsl(var(--success-text))',
          strong: 'hsl(var(--success-strong))',
        },
        warning: {
          DEFAULT: 'hsl(var(--warning))',
          foreground: 'hsl(var(--warning-foreground))',
        },
        info: {
          DEFAULT: 'hsl(var(--info))',
          foreground: 'hsl(var(--info-foreground))',
          bg: 'hsl(var(--info-bg))',
          text: 'hsl(var(--info-text))',
        },
        link: {
          DEFAULT: 'hsl(var(--link))',
          hover: 'hsl(var(--info))',
        },
        alert: {
          DEFAULT: 'hsl(var(--alert))',
          foreground: 'hsl(var(--alert-foreground))',
        },
        // 016 — sidebar tokens (hex/rgba direto — alpha intrínseca, ver research.md §6)
        sidebar: {
          DEFAULT: 'var(--sidebar-bg)',
          text: 'var(--sidebar-text)',
          'active-bg': 'var(--sidebar-active-bg)',
          'active-text': 'var(--sidebar-active-text)',
          switch: 'var(--sidebar-switch)',
          hover: 'var(--sidebar-hover)',
          'section-label': 'var(--sidebar-section-label)',
          separator: 'var(--sidebar-separator)',
        },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      keyframes: {
        'accordion-down': {
          from: { height: '0' },
          to: { height: 'var(--radix-accordion-content-height)' },
        },
        'accordion-up': {
          from: { height: 'var(--radix-accordion-content-height)' },
          to: { height: '0' },
        },
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
}

export default config
