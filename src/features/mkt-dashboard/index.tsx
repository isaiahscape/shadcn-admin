import { useEffect, useState } from 'react'
import { Link } from '@tanstack/react-router'
import axios from 'axios'
import { 
  Database, FileText, Server, Shield, Clock, Activity, BarChart2, DollarSign, Users, RefreshCw, CreditCard
} from 'lucide-react'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { useMikrotikStore } from '@/stores/mikrotik-store'
import { useMikrotik } from '@/features/mikrotik/mikrotik-provider'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ThemeSwitch } from '@/components/theme-switch'
import { Search } from '@/components/search'

export function MikrotikMainDashboard() {
  const { apiUrl } = useMikrotikStore()
  const { isConnected, activeRouterIp } = useMikrotik()

  // Fallback to localhost:3000 if apiUrl is not set (prevents fetching from frontend Vite server)
  const backendUrl = apiUrl || 'http://localhost:3000'

  const [stats, setStats] = useState({
    totalClients: 0,
    activeClients: 0,
    collected: 0,
    pending: 0,
    overdue: 0,
    queues: 0
  })
  const [recentPayments, setRecentPayments] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (isConnected && activeRouterIp) {
      const fetchStats = async () => {
        setLoading(true)
        try {
          const [clientsRes, invoicesRes, dueRes, queuesRes, paymentsRes] = await Promise.all([
            axios.get(`${backendUrl}/api/clients`, { params: { routerIp: activeRouterIp } }).catch(() => ({ data: [] })),
            axios.get(`${backendUrl}/api/invoices`, { params: { routerIp: activeRouterIp } }).catch(() => ({ data: [] })),
            axios.get(`${backendUrl}/due-entries`, { params: { routerIp: activeRouterIp } }).catch(() => ({ data: [] })),
            axios.get(`${backendUrl}/queues/all`, { params: { routerIp: activeRouterIp } }).catch(() => ({ data: [] })),
            axios.get(`${backendUrl}/api/payments`, { params: { routerIp: activeRouterIp } }).catch(() => ({ data: [] }))
          ])
          
          const clients = Array.isArray(clientsRes.data) ? clientsRes.data : []
          const invoices = Array.isArray(invoicesRes.data) ? invoicesRes.data : []
          const dueEntries = Array.isArray(dueRes.data) ? dueRes.data : []
          const queuesList = Array.isArray(queuesRes.data) ? queuesRes.data : []
          const paymentsList = Array.isArray(paymentsRes.data) ? paymentsRes.data : []
          
          setRecentPayments(paymentsList.slice(0, 5))

          const today = new Date()
          today.setHours(0, 0, 0, 0)
          
          const activeClients = clients.filter((c: any) => {
            if (c.dueDate) {
              const [month, day, year] = c.dueDate.split('-').map(Number)
              const dueDate = new Date(2000 + year, month - 1, day)
              dueDate.setHours(0, 0, 0, 0)
              let isExpired = dueDate < today
              if (c.graceUntil) {
                const graceDate = new Date(c.graceUntil)
                graceDate.setHours(0, 0, 0, 0)
                if (graceDate >= today) isExpired = false
              }
              return !isExpired
            }
            return c.status === 'active'
          }).length

          const collected = invoices.filter((i: any) => i.status === 'paid').reduce((sum: number, i: any) => sum + i.amount, 0)
          const pending = invoices.filter((i: any) => i.status === 'pending').reduce((sum: number, i: any) => sum + i.amount, 0)
          
          const overdue = dueEntries.filter((e: any) => {
            if (!e.dueDate) return false
            const [month, day, year] = e.dueDate.split('-').map(Number)
            const dueDate = new Date(2000 + year, month - 1, day)
            dueDate.setHours(0, 0, 0, 0)
            const isExpired = dueDate < today
            let inGrace = false
            const graceMatch = e.comment?.match(/\(grace:\s*([^)]+)\)/i)
            if (graceMatch) {
              const [gYear, gMonth, gDay] = graceMatch[1].split('-').map(Number)
              const graceDate = new Date(gYear, gMonth - 1, gDay)
              graceDate.setHours(0, 0, 0, 0)
              inGrace = graceDate >= today
            }
            return isExpired && !inGrace && !e.disabled
          }).length

          setStats({
            totalClients: clients.length,
            activeClients,
            collected,
            pending,
            overdue,
            queues: queuesList.length
          })

        } catch (err) {
          console.error("Failed to fetch dashboard stats", err)
        } finally {
          setLoading(false)
        }
      }

      fetchStats()
    } else {
      setLoading(false)
    }
  }, [isConnected, backendUrl, activeRouterIp])

  const collectionEfficiency = stats.activeClients > 0 
    ? ((stats.activeClients - stats.overdue) / stats.activeClients) * 100 
    : 0

  return (
    <>
      <Header fixed>
        <Search />
        <div className='ms-auto flex items-center space-x-4'>
          <ThemeSwitch />
        </div>
      </Header>

      <Main>
        <div className='mb-6 flex flex-wrap items-center justify-between space-y-2'>
          <div>
            <h2 className='text-2xl font-bold tracking-tight flex items-center gap-2'>
              <BarChart2 className="h-8 w-8 text-primary" />
              Billing Dashboard
            </h2>
            <p className="text-muted-foreground">Overview of your MikroTik network and billing metrics.</p>
          </div>
          
          <div className="flex items-center space-x-2 rounded-md border bg-card p-2 shadow-sm">
            <div className={`h-3 w-3 rounded-full ${isConnected ? 'bg-green-500' : 'bg-red-500'}`} />
            <span className="text-sm font-medium">
              {isConnected ? 'Connected' : 'Disconnected'}
            </span>
            <Badge variant="secondary" className="ml-2 font-mono text-xs text-blue-500">
              {apiUrl || 'No API'}
            </Badge>
          </div>
        </div>

        <div className="space-y-6">

          {/* Stats Cards Row 1 */}
          <div className="grid gap-4 md:grid-cols-3">
        <Card className="border-emerald-500/20 bg-emerald-500/5">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Collected Revenue</CardTitle>
            <DollarSign className="h-4 w-4 text-emerald-500" />
          </CardHeader>
          <CardContent>
            {loading ? (
              <RefreshCw className="h-6 w-6 animate-spin text-emerald-500/50" />
            ) : (
              <div className="text-2xl font-bold text-emerald-500">₱{stats.collected.toLocaleString()}</div>
            )}
          </CardContent>
        </Card>
        <Card className="border-amber-500/20 bg-amber-500/5">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Pending Bills</CardTitle>
            <Clock className="h-4 w-4 text-amber-500" />
          </CardHeader>
          <CardContent>
            {loading ? (
              <RefreshCw className="h-6 w-6 animate-spin text-amber-500/50" />
            ) : (
              <div className="text-2xl font-bold text-amber-500">₱{stats.pending.toLocaleString()}</div>
            )}
          </CardContent>
        </Card>
        <Card className="border-red-500/20 bg-red-500/5">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Overdue Clients</CardTitle>
            <Shield className="h-4 w-4 text-red-500" />
          </CardHeader>
          <CardContent>
            {loading ? (
              <RefreshCw className="h-6 w-6 animate-spin text-red-500/50" />
            ) : (
              <div className="text-2xl font-bold text-red-500">{stats.overdue}</div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Stats Cards Row 2 */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Clients</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {loading ? (
              <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground/50" />
            ) : (
              <div className="text-2xl font-bold">{stats.totalClients}</div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Active Clients</CardTitle>
            <Activity className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {loading ? (
              <RefreshCw className="h-6 w-6 animate-spin text-green-500/50" />
            ) : (
              <div className="text-2xl font-bold text-green-500">{stats.activeClients}</div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Active Queues</CardTitle>
            <Activity className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {loading ? (
              <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground/50" />
            ) : (
              <div className="text-2xl font-bold">{stats.queues}</div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Collection Efficiency Progress */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base font-medium">Collection Efficiency</CardTitle>
            {loading ? (
              <RefreshCw className="h-4 w-4 animate-spin text-emerald-500/50" />
            ) : (
              <span className="text-sm font-bold text-emerald-500">{collectionEfficiency.toFixed(1)}%</span>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <div className="h-2 w-full overflow-hidden rounded-full bg-secondary">
            <div
              className={`h-full bg-emerald-500 transition-all duration-500 ease-in-out ${loading ? 'opacity-50' : ''}`}
              style={{ width: `${loading ? 0 : collectionEfficiency}%` }}
            />
          </div>
        </CardContent>
      </Card>

      {/* Navigation Grid */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <Link to="/clients" disabled={!isConnected} className={`block transition-transform hover:scale-[1.02] ${!isConnected ? 'pointer-events-none opacity-50' : ''}`}>
          <Card className="h-full border-blue-500/20 bg-gradient-to-br from-blue-500/10 to-transparent hover:border-blue-500/50">
            <CardHeader className="flex flex-row items-center gap-4 pb-2">
              <div className="rounded-lg bg-blue-500/20 p-3">
                <Database className="h-5 w-5 text-blue-500" />
              </div>
              <div>
                <CardTitle className="text-lg">Client Database</CardTitle>
                <CardDescription>Manage subscriber information</CardDescription>
              </div>
            </CardHeader>
          </Card>
        </Link>

        <Link to="/invoices" disabled={!isConnected} className={`block transition-transform hover:scale-[1.02] ${!isConnected ? 'pointer-events-none opacity-50' : ''}`}>
          <Card className="h-full border-emerald-500/20 bg-gradient-to-br from-emerald-500/10 to-transparent hover:border-emerald-500/50">
            <CardHeader className="flex flex-row items-center gap-4 pb-2">
              <div className="rounded-lg bg-emerald-500/20 p-3">
                <FileText className="h-5 w-5 text-emerald-500" />
              </div>
              <div>
                <CardTitle className="text-lg">Invoices</CardTitle>
                <CardDescription>View and manage billing</CardDescription>
              </div>
            </CardHeader>
          </Card>
        </Link>

        <Link to="/dhcp-leases" disabled={!isConnected} className={`block transition-transform hover:scale-[1.02] ${!isConnected ? 'pointer-events-none opacity-50' : ''}`}>
          <Card className="h-full border-green-500/20 bg-gradient-to-br from-green-500/10 to-transparent hover:border-green-500/50">
            <CardHeader className="flex flex-row items-center gap-4 pb-2">
              <div className="rounded-lg bg-green-500/20 p-3">
                <Server className="h-5 w-5 text-green-500" />
              </div>
              <div>
                <CardTitle className="text-lg">DHCP Leases</CardTitle>
                <CardDescription>Monitor connected devices</CardDescription>
              </div>
            </CardHeader>
          </Card>
        </Link>

        <Link to="/address-list" disabled={!isConnected} className={`block transition-transform hover:scale-[1.02] ${!isConnected ? 'pointer-events-none opacity-50' : ''}`}>
          <Card className="h-full border-red-500/20 bg-gradient-to-br from-red-500/10 to-transparent hover:border-red-500/50">
            <CardHeader className="flex flex-row items-center gap-4 pb-2">
              <div className="rounded-lg bg-red-500/20 p-3">
                <Shield className="h-5 w-5 text-red-500" />
              </div>
              <div>
                <CardTitle className="text-lg">Address List</CardTitle>
                <CardDescription>Internet access control</CardDescription>
              </div>
            </CardHeader>
          </Card>
        </Link>

        <Link to="/automation" disabled={!isConnected} className={`block transition-transform hover:scale-[1.02] ${!isConnected ? 'pointer-events-none opacity-50' : ''}`}>
          <Card className="h-full border-purple-500/20 bg-gradient-to-br from-purple-500/10 to-transparent hover:border-purple-500/50">
            <CardHeader className="flex flex-row items-center gap-4 pb-2">
              <div className="rounded-lg bg-purple-500/20 p-3">
                <Clock className="h-5 w-5 text-purple-500" />
              </div>
              <div>
                <CardTitle className="text-lg">Auto-Disable</CardTitle>
                <CardDescription>Due date management</CardDescription>
              </div>
            </CardHeader>
          </Card>
        </Link>

        <Link to="/queues" disabled={!isConnected} className={`block transition-transform hover:scale-[1.02] ${!isConnected ? 'pointer-events-none opacity-50' : ''}`}>
          <Card className="h-full border-amber-500/20 bg-gradient-to-br from-amber-500/10 to-transparent hover:border-amber-500/50">
            <CardHeader className="flex flex-row items-center gap-4 pb-2">
              <div className="rounded-lg bg-amber-500/20 p-3">
                <Activity className="h-5 w-5 text-amber-500" />
              </div>
              <div>
                <CardTitle className="text-lg">Bandwidth Queues</CardTitle>
                <CardDescription>Speed limits per client</CardDescription>
              </div>
            </CardHeader>
          </Card>
        </Link>
          </div>
                    {/* Recent Payments / Sales Report */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <div className="space-y-1">
                <CardTitle className="text-base font-medium flex items-center gap-2">
                  <CreditCard className="h-5 w-5 text-emerald-500" />
                  Recent Payments (Sales Report)
                </CardTitle>
                <CardDescription>Latest collections from clients</CardDescription>
              </div>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="flex justify-center p-4">
                  <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground/50" />
                </div>
              ) : recentPayments.length === 0 ? (
                <div className="text-center text-sm text-muted-foreground py-4 italic">
                  No recent payments found.
                </div>
              ) : (
                <div className="space-y-4 pt-2">
                  {recentPayments.map((payment, index) => (
                    <div key={payment.id || index} className="flex items-center justify-between border-b border-border/50 pb-3 last:border-0 last:pb-0">
                      <div>
                        <p className="font-medium">{payment.clientName}</p>
                        <p className="text-xs text-muted-foreground">
                          {payment.paymentDate} • {payment.paymentMethod ? payment.paymentMethod.toUpperCase() : 'CASH'} • {payment.reference}
                        </p>
                      </div>
                      <div className="font-bold text-emerald-500">
                        + ₱{Number(payment.amount).toLocaleString()}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </Main>
    </>
  )
}
