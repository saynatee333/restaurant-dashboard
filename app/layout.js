import './globals.css'
import { AppProviders } from '@/components/AppProviders'

export const metadata = {
  title: 'Restaurant POS',
  description: 'Production-ready restaurant POS (Next.js + Supabase)',
}

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className="min-h-screen">
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  )
}
