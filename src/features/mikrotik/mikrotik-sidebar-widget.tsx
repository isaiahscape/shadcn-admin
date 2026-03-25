import { useMikrotik } from './mikrotik-provider'
import { Router } from 'lucide-react'

export function MikrotikSidebarWidget() {
  const { isConnected, activeRouterIp } = useMikrotik()

  return (
    <div className="flex items-center gap-3 px-3 py-2 mt-4 mx-2 rounded-lg bg-muted/50 border">
      <div className="relative">
        <Router className="size-4 text-muted-foreground" />
        <span 
          className={`absolute -bottom-1 -right-1 size-2.5 rounded-full border-2 border-background ${
            isConnected ? 'bg-green-500' : 'bg-destructive'
          }`} 
        />
      </div>
      <div className="flex flex-col">
        <span className="text-xs font-medium leading-none">Mikrotik Status</span>
        <span className="text-[10px] text-muted-foreground mt-0.5">
          {isConnected ? activeRouterIp : 'Disconnected'}
        </span>
      </div>
    </div>
  )
}