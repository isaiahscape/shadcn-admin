import { useState } from 'react'
import { useMikrotik } from './mikrotik-provider'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card'
import { Activity, Wifi, WifiOff } from 'lucide-react'

export function MikrotikQuickConnect() {
  const { isConnected, activeRouterIp, connect, disconnect } = useMikrotik()
  const [ip, setIp] = useState('192.168.254.100')

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Activity className="size-5" />
          Mikrotik Router
        </CardTitle>
        <CardDescription>Manage your active connection directly from the dashboard.</CardDescription>
      </CardHeader>
      <CardContent>
        {isConnected ? (
          <div className="flex items-center justify-between bg-green-500/10 p-4 rounded-lg border border-green-500/20">
            <div className="flex items-center gap-3">
              <Wifi className="size-5 text-green-600 dark:text-green-500" />
              <div>
                <p className="font-medium text-green-800 dark:text-green-400">Connected</p>
                <p className="text-sm text-green-600/80 dark:text-green-400/80">{activeRouterIp}</p>
              </div>
            </div>
            <Button variant="destructive" onClick={disconnect}>
              Disconnect
            </Button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <Input 
              placeholder="Router IP (e.g. 192.168.254.100)" 
              value={ip} 
              onChange={(e) => setIp(e.target.value)} 
              onKeyDown={(e) => {
                if (e.key === 'Enter' && ip) {
                  connect(ip)
                }
              }}
              className="max-w-xs"
            />
            <Button onClick={() => connect(ip)}>
              <WifiOff className="size-4 mr-2" />
              Connect
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}