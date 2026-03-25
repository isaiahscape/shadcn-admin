import React, { createContext, useContext, useState } from 'react'

// Define the shape of your Mikrotik state
interface MikrotikState {
  isConnected: boolean
  activeRouterIp: string | null
  // Add other relevant state properties here
}

interface MikrotikContextType extends MikrotikState {
  connect: (ip: string) => void
  disconnect: () => void
}

const MikrotikContext = createContext<MikrotikContextType | undefined>(undefined)

export function MikrotikProvider({ children }: { children: React.ReactNode }) {
  const [isConnected, setIsConnected] = useState(false)
  const [activeRouterIp, setActiveRouterIp] = useState<string | null>(null)

  const connect = (ip: string) => {
    setActiveRouterIp(ip)
    setIsConnected(true)
  }

  const disconnect = () => {
    setActiveRouterIp(null)
    setIsConnected(false)
  }

  return (
    <MikrotikContext.Provider
      value={{ isConnected, activeRouterIp, connect, disconnect }}
    >
      {children}
    </MikrotikContext.Provider>
  )
}

// Custom hook to use the Mikrotik Context
export function useMikrotik() {
  const context = useContext(MikrotikContext)
  if (context === undefined) {
    throw new Error('useMikrotik must be used within a MikrotikProvider')
  }
  return context
}
