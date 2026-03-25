import { useEffect, useState, useCallback } from 'react'
import axios from 'axios'
import { Edit2, Trash2, Search, UserPlus, RefreshCw, AlertTriangle, ShieldAlert, DollarSign, FileText } from 'lucide-react'
import { useMikrotikStore } from '@/stores/mikrotik-store'
import { useMikrotik } from '@/features/mikrotik/mikrotik-provider'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { toast } from 'sonner'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ThemeSwitch } from '@/components/theme-switch'
import { Search as GlobalSearch } from '@/components/search'

export interface MikrotikClient {
  id: string
  ip: string
  name: string
  plan: string
  address: string
  cpNumber: string
  installDate: string
  dueDate: string
  graceUntil?: string
  status: 'active' | 'expired' | 'late'
}

export function ClientsView() {
  const { apiUrl } = useMikrotikStore()
  const { isConnected, activeRouterIp } = useMikrotik()
  
  // Fallback to localhost:3000 if apiUrl is not set (prevents fetching from frontend Vite server)
  const backendUrl = apiUrl || 'http://localhost:3000'

  const [clients, setClients] = useState<MikrotikClient[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  
  // Modal States
  const [addModalOpen, setAddModalOpen] = useState(false)
  const [newClient, setNewClient] = useState<Partial<MikrotikClient>>({
    ip: '',
    name: '',
    plan: '',
    address: '',
    cpNumber: '',
    installDate: ''
  })
  const [editModalOpen, setEditModalOpen] = useState(false)
  const [editingClient, setEditingClient] = useState<Partial<MikrotikClient> | null>(null)
  
  // Payment States
  const [payModalOpen, setPayModalOpen] = useState(false)
  const [payingClient, setPayingClient] = useState<MikrotikClient | null>(null)
  const [paymentAmount, setPaymentAmount] = useState('')
  const [paymentMethod, setPaymentMethod] = useState('cash')
  const [paymentReference, setPaymentReference] = useState('')

  const fetchClients = useCallback(async () => {
    if (!isConnected || !activeRouterIp) return
    setLoading(true)
    try {
      const res = await axios.get(`${backendUrl}/api/clients`, {
        params: { routerIp: activeRouterIp }
      })

      // Log the actual response to the console to see what we received
      console.log("Raw API Response from /api/clients:", res.data);

      // Defensive check: If it's not an array, stop and throw a clear error
      if (!Array.isArray(res.data)) {
        throw new Error("Invalid response format. Expected an array but received: " + typeof res.data);
      }
      
      // Validate and calculate exact status (porting from your app.tsx)
      const today = new Date()
      today.setHours(0, 0, 0, 0)
      
      const validatedClients = res.data.map((client: any) => {
        if (client.dueDate) {
          const [month, day, year] = client.dueDate.split('-').map(Number)
          const dueDate = new Date(2000 + year, month - 1, day)
          dueDate.setHours(0, 0, 0, 0)
          
          let isExpired = dueDate < today
          if (client.graceUntil) {
            const graceDate = new Date(client.graceUntil)
            graceDate.setHours(0, 0, 0, 0)
            if (graceDate >= today) isExpired = false
          }
          
          return { ...client, status: isExpired ? 'expired' : 'active' }
        }
        return client
      })
      
      setClients(validatedClients)
    } catch (error: any) {
      console.error("Fetch clients error:", error);
      setClients([]); // Fallback to an empty list so the table doesn't break
      toast.error('Failed to fetch clients', { description: error.message })
    } finally {
      setLoading(false)
    }
  }, [backendUrl, isConnected, activeRouterIp])

  useEffect(() => {
    if (isConnected) {
      fetchClients()
    }
  }, [isConnected, fetchClients])

  const handleDelete = async (client: MikrotikClient) => {
    if (!confirm(`Are you sure you want to delete ${client.name}?`)) return
    
    try {
      // If you implement delete on the backend:
      // await axios.delete(`${backendUrl}/api/clients/${client.id}`, { data: { routerIp: activeRouterIp } })
      setClients((prev) => prev.filter((c) => c.id !== client.id))
      toast.success(`Client ${client.name} deleted.`)
    } catch (error: any) {
      toast.error('Failed to delete client', { description: error.message })
    }
  }

  const recalculateDueDate = () => {
    if (!editingClient?.installDate) {
      toast.error('Please enter install date first')
      return
    }
    
    const parts = editingClient.installDate.split('-')
    if (parts.length !== 3) {
      toast.error('Invalid date format. Use MM-DD-YY')
      return
    }

    const month = parseInt(parts[0])
    const day = parseInt(parts[1])
    const year = parseInt(parts[2])
    
    if (month < 1 || month > 12 || day < 1 || day > 31 || year < 0 || year > 99) {
      toast.error("Please enter valid date values")
      return
    }
    
    const installDate = new Date(2000 + year, month - 1, day)
    const dueDate = new Date(installDate)
    dueDate.setDate(installDate.getDate() + 35)
    
    const dueMonth = (dueDate.getMonth() + 1).toString().padStart(2, '0')
    const dueDay = dueDate.getDate().toString().padStart(2, '0')
    const dueYear = dueDate.getFullYear().toString().slice(-2)
    const dueDateStr = `${dueMonth}-${dueDay}-${dueYear}`
    
    setEditingClient({ ...editingClient, dueDate: dueDateStr })
    toast.info(`Due date recalculated to: ${dueDateStr}`)
  }

  const handleSaveEdit = async () => {
    if (!editingClient?.id || !editingClient.ip) return
    try {
      let finalDueDate = editingClient.dueDate
      if (!finalDueDate && editingClient.installDate) {
        const parts = editingClient.installDate.split('-')
        if (parts.length === 3) {
          const month = parseInt(parts[0])
          const day = parseInt(parts[1])
          const year = parseInt(parts[2])
          const installDate = new Date(2000 + year, month - 1, day)
          const dueDate = new Date(installDate)
          dueDate.setDate(installDate.getDate() + 35)
          const dueMonth = (dueDate.getMonth() + 1).toString().padStart(2, '0')
          const dueDay = dueDate.getDate().toString().padStart(2, '0')
          const dueYear = dueDate.getFullYear().toString().slice(-2)
          finalDueDate = `${dueMonth}-${dueDay}-${dueYear}`
        }
      }

      const today = new Date()
      today.setHours(0, 0, 0, 0)
      
      let isExpired = false
      let isPastInstall = false
      
      if (finalDueDate) {
        const [dueMonth, dueDay, dueYear] = finalDueDate.split('-').map(Number)
        const dueDateObj = new Date(2000 + dueYear, dueMonth - 1, dueDay)
        dueDateObj.setHours(0, 0, 0, 0)
        isExpired = dueDateObj < today
        
        if (editingClient.graceUntil) {
          const graceDate = new Date(editingClient.graceUntil)
          graceDate.setHours(0, 0, 0, 0)
          if (graceDate >= today) isExpired = false
        }
      }
      
      if (editingClient.installDate) {
        const [installMonth, installDay, installYear] = editingClient.installDate.split('-').map(Number)
        const installDateObj = new Date(2000 + installYear, installMonth - 1, installDay)
        installDateObj.setHours(0, 0, 0, 0)
        isPastInstall = installDateObj < today
      }

      const updatedClient = {
        ...editingClient,
        dueDate: finalDueDate,
        graceReason: editingClient.graceUntil ? 'Edited/Extended via Web UI' : undefined,
        status: isExpired ? 'expired' : (isPastInstall ? 'late' : 'active'),
        routerIp: activeRouterIp
      }

      await axios.put(`${backendUrl}/api/clients/${editingClient.id}`, updatedClient)

      // Enable or disable IP in Mikrotik based on expiration status
      if (isExpired) {
        await axios.post(`${backendUrl}/remove-ip`, { ip: updatedClient.ip, routerIp: activeRouterIp }).catch(() => {})
      } else {
        await axios.post(`${backendUrl}/enable-ip`, { ip: updatedClient.ip, routerIp: activeRouterIp }).catch(() => {})
      }

      setEditModalOpen(false)
      fetchClients()
      
      if (isExpired) {
        toast.warning('Client updated. Internet is DISABLED due to expired due date.')
      } else {
        toast.success('Client updated successfully')
      }
    } catch (error: any) {
      toast.error('Failed to update client', { description: error.message })
    }
  }

  const handleGenerateSOA = async (client: MikrotikClient) => {
    try {
      const res = await axios.get(`${backendUrl}/api/generate-soa/${client.id}`)
      if (res.data && res.data.success && res.data.html) {
        const blob = new Blob([res.data.html], { type: 'text/html' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `SOA-${client.name.replace(/\s+/g, '_')}-${client.id}.html`
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        URL.revokeObjectURL(url)
        toast.success(`SOA generated for ${client.name}`)
      } else {
        toast.error('Failed to generate SOA')
      }
    } catch (error: any) {
      toast.error('Error generating SOA', { description: error.message })
    }
  }

  const handleProcessPayment = async () => {
    if (!payingClient || !paymentAmount) return toast.error('Valid amount is required')
    try {
      const payload = {
        clientId: payingClient.id,
        clientIp: payingClient.ip,
        amount: Number(paymentAmount),
        paymentMethod,
        reference: paymentReference || `REF-${Date.now().toString().slice(-6)}`,
        notes: `Manual payment from web UI`
      }
      await axios.post(`${backendUrl}/api/process-payment`, payload)
      toast.success(`Payment processed for ${payingClient.name}`)
      setPayModalOpen(false)
      fetchClients()
    } catch (error: any) {
      toast.error('Payment failed', { description: error.message })
    }
  }

  const handleAddClient = async () => {
    if (!newClient.name || !newClient.ip || !newClient.installDate || !newClient.plan) {
      toast.error('Please fill all required fields (Name, IP, Plan, Install Date)')
      return
    }

    try {
      const parts = newClient.installDate.split('-')
      if (parts.length !== 3) {
        toast.error('Invalid date format. Use MM-DD-YY')
        return
      }

      const month = parseInt(parts[0])
      const day = parseInt(parts[1])
      const year = parseInt(parts[2])
      
      if (month < 1 || month > 12 || day < 1 || day > 31 || year < 0 || year > 99) {
        toast.error("Please enter valid date values")
        return
      }

      const today = new Date()
      today.setHours(0, 0, 0, 0)
      
      const installDateObj = new Date(2000 + year, month - 1, day)
      installDateObj.setHours(0, 0, 0, 0)
      const isPastDate = installDateObj < today

      const dueDateObj = new Date(installDateObj)
      dueDateObj.setDate(installDateObj.getDate() + 35)
      
      const dueMonth = (dueDateObj.getMonth() + 1).toString().padStart(2, '0')
      const dueDay = dueDateObj.getDate().toString().padStart(2, '0')
      const dueYear = dueDateObj.getFullYear().toString().slice(-2)
      const dueDateStr = `${dueMonth}-${dueDay}-${dueYear}`

      const isExpired = dueDateObj < today

      let addressComment = `${newClient.name.trim()} ${newClient.plan.trim()} due ${dueDateStr}`
      if (isPastDate) {
        addressComment += ` (late-reg: ${newClient.installDate.trim()})`
      }

      const clientData = {
        id: Date.now().toString(),
        ip: newClient.ip.trim(),
        name: newClient.name.trim(),
        plan: newClient.plan.trim(),
        address: newClient.address?.trim() || '',
        cpNumber: newClient.cpNumber?.trim() || '',
        installDate: newClient.installDate.trim(),
        dueDate: dueDateStr,
        registeredAt: new Date().toISOString(),
        status: isExpired ? 'expired' : (isPastDate ? 'late' : 'active')
      }

      // Save to database
      await axios.post(`${backendUrl}/api/clients`, { ...clientData, routerIp: activeRouterIp })
      
      // Add to Mikrotik Address List
      await axios.post(`${backendUrl}/allow-ip`, { ip: clientData.ip, comment: addressComment, routerIp: activeRouterIp })
      if (isExpired || isPastDate) {
        await axios.post(`${backendUrl}/remove-ip`, { ip: clientData.ip, routerIp: activeRouterIp })
        toast.warning('Internet is DISABLED because the due date is in the past.')
      }

      setClients((prev) => [clientData as MikrotikClient, ...prev])
      setAddModalOpen(false)
      setNewClient({ ip: '', name: '', plan: '', address: '', cpNumber: '', installDate: '' })
      toast.success(`Client ${clientData.name} registered successfully.`)
    } catch (error: any) {
      toast.error('Registration failed', { description: error.message })
    }
  }

  const filteredClients = clients.filter(c => 
    c.name?.toLowerCase().includes(search.toLowerCase()) || 
    c.ip?.includes(search)
  )

  if (!isConnected) {
    return (
      <>
        <Header fixed>
          <GlobalSearch />
          <div className='ms-auto flex items-center space-x-4'>
            <ThemeSwitch />
          </div>
        </Header>
        <Main>
          <div className="flex h-[calc(100vh-200px)] items-center justify-center p-6">
            <div className="text-center space-y-4 max-w-md">
              <ShieldAlert className="mx-auto h-12 w-12 text-muted-foreground" />
              <h2 className="text-2xl font-bold">Not Connected</h2>
              <p className="text-muted-foreground">Please connect to a Mikrotik router from the top right widget to view and manage clients.</p>
            </div>
          </div>
        </Main>
      </>
    )
  }

  return (
    <>
      <Header fixed>
        <GlobalSearch />
        <div className='ms-auto flex items-center space-x-4'>
          <ThemeSwitch />
        </div>
      </Header>

      <Main>
        <div className='mb-6 flex flex-wrap items-center justify-between space-y-2'>
          <div>
            <h2 className="text-2xl font-bold tracking-tight">Client Database</h2>
            <p className="text-muted-foreground">Manage your subscriber information and billing dates.</p>
          </div>
          
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <div className="relative flex-1 sm:w-64">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by name or IP..."
                className="pl-8"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <Button variant="outline" size="icon" onClick={fetchClients}>
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            </Button>
            <Button onClick={() => setAddModalOpen(true)}>
              <UserPlus className="mr-2 h-4 w-4" />
              New Client
            </Button>
          </div>
        </div>

        <div className="-mx-4 flex-1 overflow-auto px-4 py-1">
          {/* Data Table */}
          <div className="rounded-md border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Status</TableHead>
              <TableHead>Name / Address</TableHead>
              <TableHead>IP & Plan</TableHead>
              <TableHead>Due Date</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredClients.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">
                  No clients found.
                </TableCell>
              </TableRow>
            ) : (
              filteredClients.map((client) => (
                <TableRow key={client.id}>
                  <TableCell>
                    {client.status === 'active' ? (
                      <Badge variant="default" className="bg-green-500/15 text-green-600 hover:bg-green-500/25">Active</Badge>
                    ) : (
                      <Badge variant="destructive" className="flex items-center gap-1">
                        <AlertTriangle className="h-3 w-3" /> Expired
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="font-medium">{client.name}</div>
                    <div className="text-xs text-muted-foreground mt-1">{client.cpNumber || 'No Phone'} • {client.address || 'No Address'}</div>
                  </TableCell>
                  <TableCell>
                    <div className="font-mono text-sm text-blue-500">{client.ip}</div>
                    <div className="text-xs text-muted-foreground mt-1">{client.plan}</div>
                  </TableCell>
                  <TableCell>
                    <div className="font-medium">{client.dueDate || 'N/A'}</div>
                    <div className="text-xs text-muted-foreground mt-1">Installed: {client.installDate || 'N/A'}</div>
                    {client.graceUntil && (
                      <div className="text-xs text-amber-500 mt-1">Grace: {client.graceUntil}</div>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      <Button variant="ghost" size="icon" onClick={() => {
                        setPayingClient(client)
                        const priceMatch = client.plan.match(/\d+/)
                        setPaymentAmount(priceMatch ? priceMatch[0] : '')
                        setPaymentMethod('cash')
                        setPaymentReference(`REF-${Date.now().toString().slice(-6)}`)
                        setPayModalOpen(true)
                      }} title="Process Payment">
                        <DollarSign className="h-4 w-4 text-emerald-500" />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => handleGenerateSOA(client)} title="Download SOA">
                        <FileText className="h-4 w-4 text-purple-500" />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => {
                        setEditingClient(client)
                        setEditModalOpen(true)
                      }} title="Edit Client">
                        <Edit2 className="h-4 w-4 text-blue-500" />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => handleDelete(client)} title="Delete Client">
                        <Trash2 className="h-4 w-4 text-red-500" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Edit Client Dialog */}
      <Dialog open={editModalOpen} onOpenChange={setEditModalOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Edit Client ({editingClient?.ip})</DialogTitle>
            <DialogDescription>
              Make changes to the client's information and billing dates.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="name">Client Name</Label>
              <Input id="name" value={editingClient?.name || ''} onChange={(e) => setEditingClient({ ...editingClient, name: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="plan">Plan</Label>
                <Input id="plan" value={editingClient?.plan || ''} onChange={(e) => setEditingClient({ ...editingClient, plan: e.target.value })} />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="cpNumber">CP Number</Label>
                <Input id="cpNumber" value={editingClient?.cpNumber || ''} onChange={(e) => setEditingClient({ ...editingClient, cpNumber: e.target.value })} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="installDate">Install Date</Label>
                <div className="flex items-center gap-2">
                  <Input id="installDate" className="flex-1" value={editingClient?.installDate || ''} onChange={(e) => setEditingClient({ ...editingClient, installDate: e.target.value })} />
                  <Button variant="outline" size="icon" type="button" onClick={recalculateDueDate} title="Recalculate Due Date">
                    <RefreshCw className="h-4 w-4 text-amber-500" />
                  </Button>
                </div>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="dueDate">Due Date</Label>
                <Input id="dueDate" value={editingClient?.dueDate || ''} onChange={(e) => setEditingClient({ ...editingClient, dueDate: e.target.value })} />
              </div>
            </div>
            
            <div className="grid gap-2 mt-2">
              <Label htmlFor="graceUntil">Grace Period Until (YYYY-MM-DD)</Label>
              <div className="flex items-center gap-2">
                <Input 
                  id="graceUntil" 
                  className="flex-1" 
                  placeholder="YYYY-MM-DD"
                  value={editingClient?.graceUntil || ''} 
                  onChange={(e) => setEditingClient({ ...editingClient, graceUntil: e.target.value })} 
                />
                <Button variant="outline" size="sm" type="button" onClick={() => {
                  const baseDate = editingClient?.graceUntil ? new Date(editingClient.graceUntil) : new Date();
                  baseDate.setDate(baseDate.getDate() + 3);
                  setEditingClient({ ...editingClient, graceUntil: baseDate.toISOString().split('T')[0] });
                }}>+3 Days</Button>
                <Button variant="outline" size="sm" type="button" onClick={() => {
                  const baseDate = editingClient?.graceUntil ? new Date(editingClient.graceUntil) : new Date();
                  baseDate.setDate(baseDate.getDate() + 7);
                  setEditingClient({ ...editingClient, graceUntil: baseDate.toISOString().split('T')[0] });
                }}>+7 Days</Button>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditModalOpen(false)}>Cancel</Button>
            <Button onClick={handleSaveEdit}>Save changes</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Client Dialog */}
      <Dialog open={addModalOpen} onOpenChange={setAddModalOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>New Client Registration</DialogTitle>
            <DialogDescription>
              Enter the details to register a new client.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="new-name">Client Name *</Label>
                <Input id="new-name" placeholder="e.g. Juan Dela Cruz" value={newClient.name || ''} onChange={(e) => setNewClient({ ...newClient, name: e.target.value })} />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="new-ip">IP Address *</Label>
                <Input id="new-ip" placeholder="e.g. 192.168.1.50" value={newClient.ip || ''} onChange={(e) => setNewClient({ ...newClient, ip: e.target.value })} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="new-plan">Plan *</Label>
                <Input id="new-plan" placeholder="e.g. PLAN1999" value={newClient.plan || ''} onChange={(e) => setNewClient({ ...newClient, plan: e.target.value })} />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="new-cp">CP Number</Label>
                <Input id="new-cp" placeholder="09123456789" value={newClient.cpNumber || ''} onChange={(e) => setNewClient({ ...newClient, cpNumber: e.target.value })} />
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="new-address">Address</Label>
              <Input id="new-address" placeholder="e.g. Blk 12 Lot 34" value={newClient.address || ''} onChange={(e) => setNewClient({ ...newClient, address: e.target.value })} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="new-install">Install Date (MM-DD-YY) *</Label>
              <Input id="new-install" placeholder="MM-DD-YY" value={newClient.installDate || ''} onChange={(e) => setNewClient({ ...newClient, installDate: e.target.value })} />
              <p className="text-xs text-muted-foreground">Due date will be automatically calculated as Install Date + 35 days.</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddModalOpen(false)}>Cancel</Button>
            <Button onClick={handleAddClient}>Register Client</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Pay Client Dialog */}
      <Dialog open={payModalOpen} onOpenChange={setPayModalOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Process Payment</DialogTitle>
            <DialogDescription>
              Record a payment for {payingClient?.name} ({payingClient?.ip}).
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="pay-amount">Amount (₱)</Label>
              <Input 
                id="pay-amount" 
                type="number" 
                value={paymentAmount} 
                onChange={(e) => setPaymentAmount(e.target.value)} 
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="pay-method">Payment Method</Label>
              <select 
                id="pay-method" 
                className="flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value)}
              >
                <option value="cash">Cash</option>
                <option value="gcash">GCash</option>
                <option value="bank">Bank Transfer</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="pay-ref">Reference Number</Label>
              <Input 
                id="pay-ref" 
                value={paymentReference} 
                onChange={(e) => setPaymentReference(e.target.value)} 
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPayModalOpen(false)}>Cancel</Button>
            <Button onClick={handleProcessPayment}>Submit Payment</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
        </div>
      </Main>
    </>
  )
}