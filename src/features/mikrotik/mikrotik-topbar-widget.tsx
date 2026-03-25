import { useState, useEffect } from 'react'
import { useMikrotik } from './mikrotik-provider'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Activity, Wifi, WifiOff } from 'lucide-react'

export function MikrotikTopbarWidget() {
  const { isConnected, activeRouterIp, connect, disconnect } = useMikrotik()
  const [ip, setIp] = useState(() => localStorage.getItem('mikrotik-ip') || '192.168.254.100')

  useEffect(() => {
    localStorage.setItem('mikrotik-ip', ip)
  }, [ip])

  useEffect(() => {
    // Auto-connect on initial load if it was connected previously
    const shouldAutoConnect = localStorage.getItem('mikrotik-auto-connect') === 'true'
    if (!isConnected && ip && shouldAutoConnect) {
      connect(ip)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // Run once on mount

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button 
          variant={isConnected ? "default" : "outline"} 
          size="icon" 
          className={`rounded-full ${isConnected ? "bg-green-500 hover:bg-green-600 text-white border-green-600" : "text-muted-foreground"}`}
        >
          {isConnected ? <Wifi className="size-4" /> : <WifiOff className="size-4" />}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80" align="end">
        <div className="flex flex-col gap-4">
          <div className="space-y-1.5">
            <h4 className="font-medium leading-none flex items-center gap-2">
              <Activity className="size-4" />
              Mikrotik Router
            </h4>
            <p className="text-sm text-muted-foreground">
              Manage connection directly from the topbar.
            </p>
          </div>
          {isConnected ? (
            <div className="flex flex-col gap-3 bg-green-500/10 p-3 rounded-lg border border-green-500/20">
              <div className="flex items-center gap-3">
                <Wifi className="size-5 text-green-600 dark:text-green-500" />
                <div className="flex-1">
                  <p className="text-sm font-medium text-green-800 dark:text-green-400">Connected</p>
                  <p className="text-xs text-green-600/80 dark:text-green-400/80">{activeRouterIp}</p>
                </div>
              </div>
              <Button variant="destructive" size="sm" onClick={() => {
                localStorage.removeItem('mikrotik-auto-connect')
                disconnect()
              }} className="w-full">
                Disconnect
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <Input
                placeholder="Router IP"
                value={ip}
                onChange={(e) => setIp(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && ip) {
                    localStorage.setItem('mikrotik-auto-connect', 'true')
                    connect(ip)
                  }
                }}
                className="h-9"
              />
              <Button size="sm" onClick={() => {
                localStorage.setItem('mikrotik-auto-connect', 'true')
                connect(ip)
              }} className="h-9">
                Connect
              </Button>
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}