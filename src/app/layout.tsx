import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { Inter } from 'next/font/google'
import './globals.css'

// 016 — Inter via next/font/google (self-hosted, sem FOUT, zero
// requests para fonts.googleapis.com em runtime). Variavel CSS
// --font-sans consumida em globals.css.
const inter = Inter({
  subsets: ['latin'],
  variable: '--font-sans',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'Clinni',
  description: 'Sistema de gestão para clínicas e consultórios',
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR" className={inter.variable}>
      <body>{children}</body>
    </html>
  )
}
