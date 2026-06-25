import { Inter, Cormorant_Garamond } from 'next/font/google'
import NextTopLoader from 'nextjs-toploader'
import Providers from './providers'
import './globals.css'

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
})

const cormorant = Cormorant_Garamond({
  subsets: ['latin'],
  weight: ['600', '700'],
  variable: '--font-cormorant',
  display: 'swap',
})

export const metadata = {
  title: 'Finance Management',
  description: 'ACH and clinic expenditure tracker',
  icons: { icon: '/tusk-logo.png' },
}

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={`${inter.variable} ${cormorant.variable}`}>
      <body>
        <NextTopLoader
          color="#818cf8"
          secondaryColor="#a78bfa"
          height={3}
          showSpinner={false}
          easing="ease"
          speed={200}
          shadow="0 0 10px #818cf8, 0 0 5px #a78bfa"
        />
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
