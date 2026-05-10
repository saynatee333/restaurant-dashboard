'use client'

import { BranchProvider } from '@/context/BranchContext'
import { ConnectivityBanner } from '@/components/ConnectivityBanner'

export function AppProviders({ children }) {
  return (
    <BranchProvider>
      <ConnectivityBanner />
      {children}
    </BranchProvider>
  )
}
