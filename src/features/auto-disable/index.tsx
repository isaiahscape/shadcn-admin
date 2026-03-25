import { useEffect, useState, useCallback } from 'react'
import axios from 'axios'
import { 
  Clock, Play, ShieldAlert, CheckCircle, Search, 
  AlertTriangle, Trash2, Power, Edit2, Activity, Save
} from 'lucide-react'
import { useMikrotikStore } from '@/stores/mikrotik-store'
import { useMikrotik } from '@/features/mikrotik/mikrotik-provider'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
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
import { ScrollArea } from '@/components/ui/scroll-area'
import { toast } from 'sonner'
import { AddressListItem } from './address-list'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ThemeSwitch } from '@/components/theme-switch'
import { Search as GlobalSearch } from '@/components/search'

export interface DueEntry {
  address: string
  comment: string
  disabled: boolean
  dueDate?: string
  expired: boolean
  inGracePeriod?: boolean
  graceUntil?: string
  clientName?: string
  installDate?: string
  previousDueDates?: string[]
}

export interface ScriptLog {
  id: string
  timestamp: string
  message: string
  type: 'info' | 'success' | 'error'
}

export function AutoDisableView() {
  const { apiUrl } = useMikrotikStore()
  const { isConnected, activeRouterIp } = useMikrotik()
  
  // Main States
  const [dueEntries, setDueEntries] = useState<DueEntry[]>([])
  const [scriptLogs, setScriptLogs] = useState<ScriptLog[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  
  // Scheduler States
  const [autoDisableEnabled, setAutoDisableEnabled] = useState(false)
  const [schedulerInterval, setSchedulerInterval] = useState('1d')
  const [schedulerTime, setSchedulerTime] = useState('00:05')
  const [scriptRunning, setScriptRunning] = useState(false)
  
  // Address List Reference (needed to update comments)
  const [addressList, setAddressList] = useState<AddressListItem[]>([])

  // Modal States
  const [graceModalOpen, setGraceModalOpen] = useState(false)
  const [selectedForGrace, setSelectedForGrace] = useState<DueEntry | null>(null)
  const [graceDays, setGraceDays] = useState('3')
  const [graceReason, setGraceReason] = useState('')

  const fetchData = useCallback(async () => {
    if (!isConnected || !activeRouterIp) return
    setLoading(true)
    try {
      const [statusRes, dueRes, logsRes, addressRes] = await Promise.all([
        axios.get(`${apiUrl}/script-status`, { params: { routerIp: activeRouterIp } }),
        axios.get(`${apiUrl}/due-entries`, { params: { routerIp: activeRouterIp } }),
        axios.get(`${apiUrl}/auto-disable-logs`, { params: { limit: 50, routerIp: activeRouterIp } }),
        axios.get(`${apiUrl}/address-list`, { params: { routerIp: activeRouterIp } })
      ])
      
      setAutoDisableEnabled(statusRes.data.enabled || false)
      setSchedulerInterval(statusRes.data.interval || '1d')
      setSchedulerTime(statusRes.data.time?.substring(0,5) || '00:05')
      
      // Enrich due entries with accurate client names
      const today = new Date()
      today.setHours(0, 0, 0, 0)
      
      const enhancedDue = dueRes.data.map((entry: any) => {
        const clientName = entry.comment?.replace(/due\s+\d{2}-\d{2}-\d{2}\s*/i, '').replace(/\([^)]+\)/g, '').trim() || 'Unknown'
        return { ...entry, clientName }
      })
      
      setDueEntries(enhancedDue)
      setScriptLogs(logsRes.data)
      setAddressList(addressRes.data)
    } catch (error: any) {
      toast.error('Failed to fetch automation data', { description: error.message })
    } finally {
      setLoading(false)
    }
  }, [apiUrl, isConnected, activeRouterIp])

  useEffect(() => {
    if (apiUrl && isConnected) {
      fetchData()
    }
  }, [apiUrl, isConnected, fetchData])

  // --- Automation Actions ---
  
  const toggleAutoDisable = async (enabled: boolean) => {
    setAutoDisableEnabled(enabled)
    try {
      await axios.post(`${apiUrl}/toggle-auto-disable`, { enabled, routerIp: activeRouterIp })
      toast.success(`Auto-disable ${enabled ? 'enabled' : 'disabled'}`)
      fetchData() // Refresh to fetch new logs
    } catch (error: any) {
      toast.error('Failed to toggle auto-disable', { description: error.message })
      setAutoDisableEnabled(!enabled)
    }
  }

  const saveScheduler = async () => {
    if (!schedulerTime.match(/^\d{2}:\d{2}$/)) return toast.error('Time must be in HH:MM format')
    try {
      await axios.post(`${apiUrl}/setup-scheduler`, {
        interval: schedulerInterval,
        time: schedulerTime + ':00',
        enabled: autoDisableEnabled,
        routerIp: activeRouterIp
      })
      toast.success('Scheduler configured successfully')
      fetchData()
    } catch (error: any) {
      toast.error('Failed to save scheduler', { description: error.message })
    }
  }

  const runDisableScript = async () => {
    setScriptRunning(true)
    try {
      const res = await axios.post(`${apiUrl}/run-disable-script`, { routerIp: activeRouterIp })
      if (res.data.success) {
        toast.success(`Script ran successfully. ${res.data.disabled} client(s) disabled.`)
        fetchData()
      }
    } catch (error: any) {
      toast.error('Script failed', { description: error.message })
    } finally {
      setScriptRunning(false)
    }
  }

  const clearLogs = async () => {
    try {
      await axios.post(`${apiUrl}/clear-auto-disable-logs`, { routerIp: activeRouterIp })
      setScriptLogs([])
      toast.success('Logs cleared')
    } catch (error: any) {
      toast.error('Failed to clear logs')
    }
  }

  // --- Grace Period Actions ---

  const applyGracePeriod = async () => {
    if (!selectedForGrace) return
    try {
      const now = new Date()
      const days = parseInt(graceDays) || 3
      const graceEnd = new Date(now)
      graceEnd.setDate(now.getDate() + days)
      
      const year = graceEnd.getFullYear()
      const month = (graceEnd.getMonth() + 1).toString().padStart(2, '0')
      const day = graceEnd.getDate().toString().padStart(2, '0')
      const graceEndStr = `${year}-${month}-${day}`
      
      let cleanComment = selectedForGrace.comment
        .replace(/due\s+\d{2}-\d{2}-\d{2}\s*/i, '')
        .replace(/\(grace:[^)]+\)/i, '')
        .replace(/\(reason:[^)]+\)/i, '')
        .trim()
      
      let newComment = `due ${selectedForGrace.dueDate} ${cleanComment} (grace: ${graceEndStr})`
      if (graceReason) newComment += ` (reason: ${graceReason})`
      
      const addressEntry = addressList.find(a => a.address === selectedForGrace.address)
      
      if (addressEntry) {
        await axios.post(`${apiUrl}/update-address-comment`, {
          id: addressEntry['.id'],
          comment: newComment,
          routerIp: activeRouterIp
        })
        
        // Re-enable internet if they were disabled
        if (addressEntry.disabled) {
          await axios.post(`${apiUrl}/enable-ip`, { ip: selectedForGrace.address, routerIp: activeRouterIp })
        }
        
        toast.success(`Grace period applied for ${selectedForGrace.address}`)
        setGraceModalOpen(false)
        fetchData()
      }
    } catch (error: any) {
      toast.error('Failed to apply grace period', { description: error.message })
    }
  }

  // Display Calcs
  const activeDue = dueEntries.filter(e => !e.disabled).length
  const expiredDue = dueEntries.filter(e => e.expired && !e.inGracePeriod).length
  const graceDue = dueEntries.filter(e => e.inGracePeriod).length

  const filteredEntries = dueEntries.filter(e => 
    e.address.includes(search) || 
    e.clientName?.toLowerCase().includes(search.toLowerCase())
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
              <p className="text-muted-foreground">Please connect to a Mikrotik router from the top right widget to view and manage automation.</p>
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
        <div className="flex flex-col gap-6 h-[calc(100vh-4rem)]">
          {/* Header */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Automation & Scheduling</h2>
          <p className="text-muted-foreground">Configure the auto-disable script and manage grace periods.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={fetchData}>
            <Activity className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh Status
          </Button>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-3 flex-1 min-h-0">
        
        {/* LEFT COLUMN: Settings & Entries (Takes up 2/3 of space) */}
        <div className="md:col-span-2 flex flex-col gap-6 h-full min-h-0">
          
          {/* Scheduler Settings Card */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-lg flex items-center">
                    <Clock className="mr-2 h-5 w-5 text-blue-500" /> Auto-Disable Scheduler
                  </CardTitle>
                  <CardDescription>Automatically disconnect overdue clients</CardDescription>
                </div>
                <Switch 
                  checked={autoDisableEnabled} 
                  onCheckedChange={toggleAutoDisable} 
                />
              </div>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col sm:flex-row items-end gap-4">
                <div className="grid gap-2 flex-1 w-full">
                  <Label>Run Interval</Label>
                  <Select value={schedulerInterval} onValueChange={setSchedulerInterval} disabled={!autoDisableEnabled}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select interval" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="1d">Every 24 Hours</SelectItem>
                      <SelectItem value="12h">Every 12 Hours</SelectItem>
                      <SelectItem value="6h">Every 6 Hours</SelectItem>
                      <SelectItem value="1h">Every Hour</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2 flex-1 w-full">
                  <Label>Execution Time (HH:MM)</Label>
                  <Input 
                    value={schedulerTime} 
                    onChange={(e) => setSchedulerTime(e.target.value)} 
                    placeholder="00:05" 
                    disabled={!autoDisableEnabled}
                  />
                </div>
                <div className="flex gap-2 w-full sm:w-auto">
                  <Button variant="default" onClick={saveScheduler} disabled={!autoDisableEnabled}>
                    <Save className="mr-2 h-4 w-4" /> Save
                  </Button>
                  <Button variant="secondary" onClick={runDisableScript} disabled={scriptRunning}>
                    <Play className={`mr-2 h-4 w-4 ${scriptRunning ? 'animate-pulse text-blue-500' : ''}`} /> 
                    {scriptRunning ? 'Running...' : 'Run Now'}
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Summary Stats Mini-Row */}
          <div className="grid grid-cols-3 gap-4">
            <Card className="bg-card">
              <CardContent className="p-4 flex flex-col items-center justify-center">
                <span className="text-2xl font-bold">{dueEntries.length}</span>
                <span className="text-xs text-muted-foreground">Tracked Due Dates</span>
              </CardContent>
            </Card>
            <Card className="border-red-500/20 bg-red-500/5">
              <CardContent className="p-4 flex flex-col items-center justify-center">
                <span className="text-2xl font-bold text-red-500">{expiredDue}</span>
                <span className="text-xs text-red-500/80">Pending Disconnect</span>
              </CardContent>
            </Card>
            <Card className="border-amber-500/20 bg-amber-500/5">
              <CardContent className="p-4 flex flex-col items-center justify-center">
                <span className="text-2xl font-bold text-amber-500">{graceDue}</span>
                <span className="text-xs text-amber-500/80">In Grace Period</span>
              </CardContent>
            </Card>
          </div>

          {/* Due Entries Table */}
          <Card className="flex-1 flex flex-col min-h-0">
            <CardHeader className="pb-3 flex flex-row items-center justify-between border-b">
              <CardTitle className="text-base">Client Expiration List</CardTitle>
              <div className="relative w-64">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search clients..."
                  className="pl-8 h-9"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
            </CardHeader>
            <ScrollArea className="flex-1">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Status</TableHead>
                    <TableHead>Client & IP</TableHead>
                    <TableHead>Due Date</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredEntries.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4} className="h-24 text-center text-muted-foreground">
                        No clients found with due dates.
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredEntries.map((item, idx) => (
                      <TableRow key={`due-${item.address}-${idx}`}>
                        <TableCell>
                          {item.disabled ? (
                            <Badge variant="destructive" className="bg-red-500/15 text-red-600 hover:bg-red-500/25">
                              <Power className="mr-1 h-3 w-3" /> Disabled
                            </Badge>
                          ) : item.inGracePeriod ? (
                            <Badge variant="outline" className="bg-amber-500/15 text-amber-600 border-amber-500/30">
                              <Clock className="mr-1 h-3 w-3" /> Grace
                            </Badge>
                          ) : item.expired ? (
                            <Badge variant="destructive" className="bg-red-500 text-white">
                              <AlertTriangle className="mr-1 h-3 w-3" /> Expired
                            </Badge>
                          ) : (
                            <Badge variant="default" className="bg-green-500/15 text-green-600 hover:bg-green-500/25">
                              <CheckCircle className="mr-1 h-3 w-3" /> Active
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="font-medium">{item.clientName}</div>
                          <div className="text-xs font-mono text-muted-foreground">{item.address}</div>
                        </TableCell>
                        <TableCell>
                          <div className={`font-medium ${item.expired && !item.disabled && !item.inGracePeriod ? 'text-red-500' : ''}`}>
                            {item.dueDate || 'N/A'}
                          </div>
                          {item.graceUntil && (
                            <div className="text-xs text-amber-500 mt-0.5">Grace ends: {item.graceUntil}</div>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-2">
                            {!item.inGracePeriod && !item.disabled && (
                              <Button variant="outline" size="sm" className="border-amber-500/30 text-amber-600 hover:bg-amber-500/10" onClick={() => {
                                setSelectedForGrace(item)
                                setGraceModalOpen(true)
                              }}>
                                Set Grace
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </ScrollArea>
          </Card>
          
        </div>

        {/* RIGHT COLUMN: Script Logs Terminal (Takes up 1/3 of space) */}
        <Card className="flex flex-col h-full min-h-0 border-slate-700 bg-slate-950 overflow-hidden">
          <CardHeader className="pb-3 border-b border-slate-800 bg-slate-900/50 flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-base text-slate-200 flex items-center">
                <ShieldAlert className="mr-2 h-4 w-4 text-blue-400" /> Script Terminal
              </CardTitle>
            </div>
            <Button variant="ghost" size="icon" onClick={clearLogs} className="h-8 w-8 text-slate-400 hover:text-red-400 hover:bg-red-400/10">
              <Trash2 className="h-4 w-4" />
            </Button>
          </CardHeader>
          <ScrollArea className="flex-1 p-4 font-mono text-xs text-slate-300">
            {scriptLogs.length === 0 ? (
              <div className="h-full flex items-center justify-center text-slate-600 italic">
                Waiting for script execution...
              </div>
            ) : (
              <div className="space-y-3 pb-4">
                {scriptLogs.map((log) => (
                  <div key={log.id} className="flex flex-col leading-relaxed border-b border-slate-800/50 pb-2">
                    <span className="text-[10px] text-slate-500 mb-0.5">{log.timestamp}</span>
                    <span className={`
                      ${log.type === 'success' ? 'text-emerald-400' : ''}
                      ${log.type === 'error' ? 'text-rose-400' : ''}
                      ${log.type === 'info' ? 'text-blue-300' : ''}
                    `}>
                      {log.type === 'success' && <span className="mr-2">✓</span>}
                      {log.type === 'error' && <span className="mr-2">✗</span>}
                      {log.type === 'info' && <span className="mr-2">ℹ</span>}
                      {log.message}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>
        </Card>

      </div>

      {/* Set Grace Period Dialog */}
      <Dialog open={graceModalOpen} onOpenChange={setGraceModalOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle className="text-amber-500 flex items-center">
              <Clock className="mr-2 h-5 w-5" /> Apply Grace Period
            </DialogTitle>
            <DialogDescription>
              Extend the grace period for this client before internet access is disconnected.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="flex flex-col items-center justify-center p-4 bg-secondary/50 rounded-md border border-border/50 mb-2">
              <span className="font-bold text-lg">{selectedForGrace?.clientName}</span>
              <span className="font-mono text-xs text-muted-foreground">{selectedForGrace?.address}</span>
            </div>
            
            <div className="grid gap-2">
              <Label htmlFor="days">Additional Days</Label>
              <Input 
                id="days" 
                type="number" 
                value={graceDays} 
                onChange={(e) => setGraceDays(e.target.value)} 
                placeholder="e.g. 3" 
              />
              <p className="text-xs text-muted-foreground">Days to extend before internet is auto-disabled.</p>
            </div>
            
            <div className="grid gap-2">
              <Label htmlFor="reason">Reason (Optional)</Label>
              <Input 
                id="reason" 
                value={graceReason} 
                onChange={(e) => setGraceReason(e.target.value)} 
                placeholder="e.g. Promised to pay tomorrow" 
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setGraceModalOpen(false)}>Cancel</Button>
            <Button className="bg-amber-500 hover:bg-amber-600 text-white" onClick={applyGracePeriod}>Apply Grace Period</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
        </div>
      </Main>
    </>
  )
}