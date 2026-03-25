import { useEffect, useState, useCallback } from 'react'
import axios from 'axios'
import { Search, RefreshCw, Server, Edit2, Lock, ShieldAlert } from 'lucide-react'
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

export interface Lease {
  '.id': string
  address: string
  'mac-address': string
  server: string
  comment: string
  dynamic: boolean
  status: string
  'host-name'?: string
}

export function DhcpLeasesView() {
  const { apiUrl } = useMikrotikStore()
  const { isConnected, activeRouterIp } = useMikrotik()
  
  // Fallback to localhost:3000 if apiUrl is not set (prevents fetching from frontend Vite server)
  const backendUrl = apiUrl || 'http://localhost:3000'

  const [leases, setLeases] = useState<Lease[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  
  // Modal States
  const [editModalOpen, setEditModalOpen] = useState(false)
  const [selectedLease, setSelectedLease] = useState<Lease | null>(null)
  const [comment, setComment] = useState('')

  const fetchLeases = useCallback(async () => {
    if (!isConnected || !activeRouterIp) return
    setLoading(true)
    try {
      const res = await axios.get(`${backendUrl}/leases`, { 
        params: { routerIp: activeRouterIp } 
      })

      // Log the actual response to the console to see what we received
      console.log("Raw API Response from /leases:", res.data);

      // Defensive check: If it's not an array, stop and throw a clear error
      if (!Array.isArray(res.data)) {
        throw new Error("Invalid response format. Expected an array but received: " + typeof res.data);
      }

      // Format data as done in your React Native app
      const formatted = res.data.map((l: any) => ({
        '.id': l['.id'],
        address: l.address,
        'mac-address': l['mac-address'],
        server: l.server,
        comment: l.comment || '',
        dynamic: l.dynamic === 'true' || l.dynamic === true,
        status: l.status,
        'host-name': l['host-name']
      }))
      setLeases(formatted)
    } catch (error: any) {
      console.error("Fetch leases error:", error);
      setLeases([]); // Fallback to an empty list so the table doesn't break
      toast.error('Failed to fetch leases', { description: error.message })
    } finally {
      setLoading(false)
    }
  }, [backendUrl, isConnected, activeRouterIp])

  useEffect(() => {
    if (isConnected) {
      fetchLeases()
    }
  }, [isConnected, fetchLeases])

  const handleUpdateComment = async () => {
    if (!selectedLease) return
    try {
      await axios.post(`${backendUrl}/update-comment`, {
        id: selectedLease['.id'],
        comment: comment,
        routerIp: activeRouterIp
      })
      setEditModalOpen(false)
      toast.success('Lease comment updated successfully')
      fetchLeases() // Refresh to show changes
    } catch (error: any) {
      toast.error('Failed to update comment', { description: error.message })
    }
  }

  const handleMakeStatic = (lease: Lease) => {
    // Placeholder for the full "Convert to Static & Register Client" feature
    // For now, we will prompt the user and alert them (can be expanded later)
    if (confirm(`Convert ${lease.address} to a static lease?`)) {
       toast.info('Conversion initiated. To fully register, please use the Client Database.')
       // Implement full axios.post(`${apiUrl}/convert-and-allow`, {...}) later
    }
  }

  const filteredLeases = leases.filter(l => 
    l.address?.includes(search) || 
    l['mac-address']?.toLowerCase().includes(search.toLowerCase()) ||
    l.comment?.toLowerCase().includes(search.toLowerCase())
  )

  // Statistics
  const totalLeases = leases.length
  const staticLeases = leases.filter(l => !l.dynamic).length
  const dynamicLeases = leases.filter(l => l.dynamic).length

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
              <p className="text-muted-foreground">Please connect to a Mikrotik router from the top right widget to view and manage DHCP leases.</p>
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
          <h2 className="text-2xl font-bold tracking-tight">DHCP Leases</h2>
          <p className="text-muted-foreground">Monitor and manage connected devices on your network.</p>
        </div>
        <Button variant="outline" onClick={fetchLeases}>
          <RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {/* Summary Stats Cards */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardContent className="flex items-center justify-between p-6">
            <div className="space-y-1">
              <p className="text-sm font-medium text-muted-foreground">Total Leases</p>
              <p className="text-2xl font-bold">{totalLeases}</p>
            </div>
            <div className="rounded-full bg-blue-500/20 p-3">
              <Server className="h-5 w-5 text-blue-500" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center justify-between p-6">
            <div className="space-y-1">
              <p className="text-sm font-medium text-muted-foreground">Static Leases</p>
              <p className="text-2xl font-bold text-green-500">{staticLeases}</p>
            </div>
            <div className="rounded-full bg-green-500/20 p-3">
              <Lock className="h-5 w-5 text-green-500" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center justify-between p-6">
            <div className="space-y-1">
              <p className="text-sm font-medium text-muted-foreground">Dynamic Leases</p>
              <p className="text-2xl font-bold text-amber-500">{dynamicLeases}</p>
            </div>
            <div className="rounded-full bg-amber-500/20 p-3">
              <RefreshCw className="h-5 w-5 text-amber-500" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Toolbar & Search */}
      <div className="relative w-full sm:max-w-md">
        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search IP, MAC, or comment..."
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
              <TableHead>IP / MAC Address</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Hostname</TableHead>
              <TableHead>Comment</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredLeases.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">
                  No leases found.
                </TableCell>
              </TableRow>
            ) : (
              filteredLeases.map((lease) => (
                <TableRow key={lease['.id']}>
                  <TableCell>
                    <div className="font-mono text-sm font-medium text-blue-500">{lease.address}</div>
                    <div className="text-xs text-muted-foreground mt-1">{lease['mac-address'] || 'N/A'}</div>
                  </TableCell>
                  <TableCell>
                    <Badge variant={lease.dynamic ? "secondary" : "default"} className={lease.dynamic ? 'bg-amber-500/15 text-amber-600' : 'bg-green-500/15 text-green-600'}>
                      {lease.dynamic ? 'Dynamic' : 'Static'}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm">{lease['host-name'] || 'Unknown'}</TableCell>
                  <TableCell className="text-sm max-w-[200px] truncate" title={lease.comment}>
                    {lease.comment ? lease.comment : <span className="text-muted-foreground italic">No comment</span>}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      {!lease.dynamic ? (
                        <Button variant="ghost" size="sm" onClick={() => {
                          setSelectedLease(lease)
                          setComment(lease.comment || '')
                          setEditModalOpen(true)
                        }}>
                          <Edit2 className="mr-2 h-4 w-4" />
                          Edit
                        </Button>
                      ) : (
                        <Button variant="outline" size="sm" onClick={() => handleMakeStatic(lease)}>
                          <Lock className="mr-2 h-4 w-4 text-blue-500" />
                          Make Static
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Edit Comment Dialog */}
      <Dialog open={editModalOpen} onOpenChange={setEditModalOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Edit Lease Comment</DialogTitle>
            <DialogDescription>
              Update the description or comment for this DHCP lease.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="flex items-center justify-center p-3 bg-secondary rounded-md">
              <span className="font-mono text-sm font-medium">{selectedLease?.address}</span>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="comment">Comment</Label>
              <Input 
                id="comment" 
                value={comment} 
                onChange={(e) => setComment(e.target.value)} 
                placeholder="Enter client name or description..."
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditModalOpen(false)}>Cancel</Button>
            <Button onClick={handleUpdateComment}>Save changes</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
        </div>
      </Main>
    </>
  )
}