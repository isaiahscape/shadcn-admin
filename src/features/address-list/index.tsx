import { useEffect, useState, useCallback } from 'react'
import axios from 'axios'
import { Search, RefreshCw, Plus, Edit2, Calendar, Power, PowerOff, ShieldAlert, ShieldCheck, History } from 'lucide-react'
import { useMikrotikStore } from '@/stores/mikrotik-store'
import { useMikrotik } from '@/features/mikrotik/mikrotik-provider'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
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

export interface AddressListItem {
  '.id': string
  address: string
  comment: string
  disabled: boolean
  dueDate?: string
  previousDueDates?: string[]
  clientName?: string
  installDate?: string
}

export function AddressListView() {
  const { apiUrl } = useMikrotikStore()
  const { isConnected, activeRouterIp } = useMikrotik()
  
  // Fallback to localhost:3000 if apiUrl is not set (prevents fetching from frontend Vite server)
  const backendUrl = apiUrl || 'http://localhost:3000'

  const [addressList, setAddressList] = useState<AddressListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  
  // Add IP Modal
  const [addModalOpen, setAddModalOpen] = useState(false)
  const [newIP, setNewIP] = useState('')
  const [newComment, setNewComment] = useState('')

  // Edit Comment Modal
  const [editModalOpen, setEditModalOpen] = useState(false)
  const [selectedAddress, setSelectedAddress] = useState<AddressListItem | null>(null)
  const [comment, setComment] = useState('')

  // Install Date Modal
  const [installModalOpen, setInstallModalOpen] = useState(false)
  const [installMonth, setInstallMonth] = useState('')
  const [installDay, setInstallDay] = useState('')
  const [installYear, setInstallYear] = useState('')
  const [initialDueDays, setInitialDueDays] = useState('30')

  const fetchAddressList = useCallback(async () => {
    if (!isConnected || !activeRouterIp) return
    setLoading(true)
    try {
      const res = await axios.get(`${backendUrl}/address-list`, {
        params: { routerIp: activeRouterIp }
      })
      
      // Log the actual response to the console to see what we received
      console.log("Raw API Response from /address-list:", res.data);

      // Defensive check: If it's not an array, stop and throw a clear error
      if (!Array.isArray(res.data)) {
        throw new Error("Invalid response format. Expected an array but received: " + typeof res.data);
      }

      // Parsing logic adapted from your app.tsx
      const enhancedData = res.data.map((entry: any) => {
        try {
          const dueMatch = entry.comment?.match(/due\s+(\d{2})-(\d{2})-(\d{2})/i)
          const dueDate = dueMatch ? `${dueMatch[1]}-${dueMatch[2]}-${dueMatch[3]}` : null
          
          let clientName = entry.comment
            ?.replace(/due\s+\d{2}-\d{2}-\d{2}\s*/i, '')
            .replace(/\(prev:[^)]+\)/i, '')
            .replace(/\(installed:[^)]+\)/i, '')
            .trim() || ''
          
          const prevMatch = entry.comment?.match(/\(prev:\s*([^)]+)\)/i)
          const previousDueDates = prevMatch 
            ? prevMatch[1].split('→').map((d: string) => d.trim()) 
            : []
          
          const installMatch = entry.comment?.match(/\(installed:\s*([^)]+)\)/i)
          const installDate = installMatch ? installMatch[1] : undefined
          
          return {
            ...entry,
            dueDate,
            clientName,
            previousDueDates,
            installDate
          }
        } catch (err) {
          return entry
        }
      })
      
      setAddressList(enhancedData)
    } catch (error: any) {
      console.error("Fetch address list error:", error);
      setAddressList([]); // Fallback to an empty list so the table doesn't break
      toast.error('Failed to fetch address list', { description: error.message })
    } finally {
      setLoading(false)
    }
  }, [backendUrl, isConnected, activeRouterIp])

  useEffect(() => {
    if (isConnected) {
      fetchAddressList()
    }
  }, [isConnected, fetchAddressList])

  const toggleInternet = async (item: AddressListItem) => {
    try {
      if (item.disabled) {
        await axios.post(`${backendUrl}/enable-ip`, { ip: item.address, routerIp: activeRouterIp })
        toast.success(`Internet enabled for ${item.address}`)
      } else {
        await axios.post(`${backendUrl}/remove-ip`, { ip: item.address, routerIp: activeRouterIp })
        toast.error(`Internet disabled for ${item.address}`)
      }
      fetchAddressList()
    } catch (error: any) {
      toast.error('Failed to toggle internet', { description: error.message })
    }
  }

  const handleAddIP = async () => {
    if (!newIP.trim()) return toast.error('IP Address is required')
    
    try {
      await axios.post(`${backendUrl}/allow-ip`, {
        ip: newIP.trim(),
        comment: newComment.trim() || 'Added from Web API',
        routerIp: activeRouterIp
      })
      toast.success(`IP ${newIP} added successfully`)
      setAddModalOpen(false)
      setNewIP('')
      setNewComment('')
      fetchAddressList()
    } catch (error: any) {
      toast.error('Failed to add IP', { description: error.message })
    }
  }

  const handleUpdateComment = async () => {
    if (!selectedAddress) return
    try {
      await axios.post(`${backendUrl}/update-address-comment`, {
        id: selectedAddress['.id'],
        comment: comment,
        routerIp: activeRouterIp
      })
      toast.success('Address comment updated')
      setEditModalOpen(false)
      fetchAddressList()
    } catch (error: any) {
      toast.error('Failed to update comment', { description: error.message })
    }
  }

  const openInstallModal = (item: AddressListItem) => {
    setSelectedAddress(item)
    const today = new Date()
    setInstallMonth((today.getMonth() + 1).toString().padStart(2, '0'))
    setInstallDay(today.getDate().toString().padStart(2, '0'))
    setInstallYear(today.getFullYear().toString().slice(-2))
    setInitialDueDays('30')
    setInstallModalOpen(true)
  }

  const applyInstallDate = async () => {
    if (!selectedAddress) return
    
    try {
      const installDateStr = `${installMonth}-${installDay}-${installYear}`
      
      const installDateObj = new Date(2000 + parseInt(installYear), parseInt(installMonth) - 1, parseInt(installDay))
      const dueDays = parseInt(initialDueDays) || 30
      const dueDateObj = new Date(installDateObj)
      dueDateObj.setDate(installDateObj.getDate() + dueDays)
      
      const dueMonth = (dueDateObj.getMonth() + 1).toString().padStart(2, '0')
      const dueDay = dueDateObj.getDate().toString().padStart(2, '0')
      const dueYear = dueDateObj.getFullYear().toString().slice(-2)
      const dueDateStr = `${dueMonth}-${dueDay}-${dueYear}`
      
      let clientName = selectedAddress.comment?.trim() || "Client"
      // Strip old due and installed tags if present to prevent duplicate tags
      clientName = clientName.replace(/due\s+\d{2}-\d{2}-\d{2}\s*/i, '').replace(/\(installed:\s*[^)]+\)/i, '').trim()
      
      const newFullComment = `due ${dueDateStr} ${clientName} (installed: ${installDateStr})`
      
      await axios.post(`${backendUrl}/update-address-comment`, {
        id: selectedAddress['.id'],
        comment: newFullComment,
        routerIp: activeRouterIp
      })
      
      toast.success(`Install date set. Due date auto-calculated to ${dueDateStr}`)
      setInstallModalOpen(false)
      fetchAddressList()
    } catch (error: any) {
      toast.error('Failed to set install date', { description: error.message })
    }
  }

  const filteredList = addressList.filter(a => 
    a.address?.includes(search) || 
    a.comment?.toLowerCase().includes(search.toLowerCase())
  )

  const totalAddress = addressList.length
  const enabledAddress = addressList.filter(a => !a.disabled).length
  const disabledAddress = addressList.filter(a => a.disabled).length

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
              <p className="text-muted-foreground">Please connect to a Mikrotik router from the top right widget to view and manage the address list.</p>
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
        <div className="flex flex-col gap-6">
          {/* Header */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Address List</h2>
          <p className="text-muted-foreground">Control internet access and billing dates.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={fetchAddressList}>
            <RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          <Button onClick={() => setAddModalOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Add New IP
          </Button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardContent className="flex items-center justify-between p-6">
            <div className="space-y-1">
              <p className="text-sm font-medium text-muted-foreground">Total IPs</p>
              <p className="text-2xl font-bold">{totalAddress}</p>
            </div>
            <div className="rounded-full bg-blue-500/20 p-3">
              <ShieldCheck className="h-5 w-5 text-blue-500" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center justify-between p-6">
            <div className="space-y-1">
              <p className="text-sm font-medium text-muted-foreground">Internet Enabled</p>
              <p className="text-2xl font-bold text-green-500">{enabledAddress}</p>
            </div>
            <div className="rounded-full bg-green-500/20 p-3">
              <Power className="h-5 w-5 text-green-500" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center justify-between p-6">
            <div className="space-y-1">
              <p className="text-sm font-medium text-muted-foreground">Internet Disabled</p>
              <p className="text-2xl font-bold text-red-500">{disabledAddress}</p>
            </div>
            <div className="rounded-full bg-red-500/20 p-3">
              <PowerOff className="h-5 w-5 text-red-500" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Toolbar & Search */}
      <div className="relative w-full sm:max-w-md">
        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search IP or comment..."
          className="pl-8"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {/* Data Table */}
      <div className="rounded-md border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Internet Status</TableHead>
              <TableHead>IP Address</TableHead>
              <TableHead>Client Details</TableHead>
              <TableHead>Dates</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredList.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">
                  No addresses found.
                </TableCell>
              </TableRow>
            ) : (
              filteredList.map((item) => (
                <TableRow key={item['.id']}>
                  <TableCell>
                    <Badge 
                      variant={item.disabled ? "destructive" : "default"} 
                      className={item.disabled ? '' : 'bg-green-500 hover:bg-green-600'}
                    >
                      {item.disabled ? 'Disabled' : 'Enabled'}
                    </Badge>
                  </TableCell>
                  <TableCell className="font-mono text-sm font-medium text-blue-500">
                    {item.address}
                  </TableCell>
                  <TableCell>
                    <div className="font-medium">{item.clientName || 'Unknown'}</div>
                    <div className="text-xs text-muted-foreground mt-1 max-w-[200px] truncate" title={item.comment}>
                      {item.comment}
                    </div>
                  </TableCell>
                  <TableCell>
                    {item.dueDate && <div className="text-sm font-medium text-orange-500">Due: {item.dueDate}</div>}
                    {item.installDate && <div className="text-xs text-muted-foreground mt-1">Installed: {item.installDate}</div>}
                    {item.previousDueDates && item.previousDueDates.length > 0 && (
                      <div className="text-xs text-muted-foreground mt-1 flex items-center">
                        <History className="mr-1 h-3 w-3" /> {item.previousDueDates.length} prev
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      <Button variant={item.disabled ? "default" : "destructive"} size="sm" onClick={() => toggleInternet(item)}>
                        {item.disabled ? <Power className="mr-2 h-4 w-4" /> : <PowerOff className="mr-2 h-4 w-4" />}
                        {item.disabled ? 'Enable' : 'Disable'}
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => {
                        setSelectedAddress(item)
                        setComment(item.comment || '')
                        setEditModalOpen(true)
                      }}>
                        <Edit2 className="h-4 w-4" />
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => openInstallModal(item)}>
                        <Calendar className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Add IP Dialog */}
      <Dialog open={addModalOpen} onOpenChange={setAddModalOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Add New IP to Address List</DialogTitle>
            <DialogDescription>
              Enter the new IP address and an optional comment to track the client.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="ip">IP Address</Label>
              <Input id="ip" value={newIP} onChange={(e) => setNewIP(e.target.value)} placeholder="192.168.1.100" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="newComment">Comment</Label>
              <Input id="newComment" value={newComment} onChange={(e) => setNewComment(e.target.value)} placeholder="Client Name or Description" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddModalOpen(false)}>Cancel</Button>
            <Button onClick={handleAddIP}>Add IP</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Comment Dialog */}
      <Dialog open={editModalOpen} onOpenChange={setEditModalOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Edit Address Comment ({selectedAddress?.address})</DialogTitle>
            <DialogDescription>
              Update the raw comment string on the MikroTik router.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="comment">Full Raw Comment</Label>
              <Input id="comment" value={comment} onChange={(e) => setComment(e.target.value)} />
              <p className="text-xs text-muted-foreground">Warning: This overrides the raw MikroTik comment string.</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditModalOpen(false)}>Cancel</Button>
            <Button onClick={handleUpdateComment}>Save changes</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Install Date Dialog */}
      <Dialog open={installModalOpen} onOpenChange={setInstallModalOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Set Install Date ({selectedAddress?.address})</DialogTitle>
            <DialogDescription>
              Set the installation date to auto-calculate the billing due date.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <Label>Installation Date (MM-DD-YY)</Label>
            <div className="flex gap-2">
              <Input value={installMonth} onChange={(e) => setInstallMonth(e.target.value)} placeholder="MM" maxLength={2} className="text-center" />
              <span className="flex items-center text-muted-foreground">-</span>
              <Input value={installDay} onChange={(e) => setInstallDay(e.target.value)} placeholder="DD" maxLength={2} className="text-center" />
              <span className="flex items-center text-muted-foreground">-</span>
              <Input value={installYear} onChange={(e) => setInstallYear(e.target.value)} placeholder="YY" maxLength={2} className="text-center" />
            </div>
            <div className="grid gap-2 mt-4">
              <Label>Initial Due (days from install)</Label>
              <Input value={initialDueDays} onChange={(e) => setInitialDueDays(e.target.value)} type="number" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setInstallModalOpen(false)}>Cancel</Button>
            <Button onClick={applyInstallDate}>Calculate & Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
        </div>
      </Main>
    </>
  )
}