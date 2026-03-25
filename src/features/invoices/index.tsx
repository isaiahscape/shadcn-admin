import { useEffect, useState, useCallback } from 'react'
import axios from 'axios'
import { Search, Plus, Eye, Download, CheckCircle, Trash2, FileText, Clock, AlertCircle, RefreshCw, ShieldAlert } from 'lucide-react'
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
import { MikrotikClient } from '../clients'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ThemeSwitch } from '@/components/theme-switch'
import { Search as GlobalSearch } from '@/components/search'

export interface Invoice {
  id: string
  clientId: string
  clientName: string
  clientIp: string
  planName: string
  amount: number
  dueDate: string
  issueDate: string
  status: 'paid' | 'pending' | 'overdue' | 'cancelled'
  paymentDate?: string
  paymentMethod?: string
  reference?: string
}

export function InvoicesView() {
  const { apiUrl } = useMikrotikStore()
  const { isConnected, activeRouterIp } = useMikrotik()
  
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [clients, setClients] = useState<MikrotikClient[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  
  // Modal States
  const [manualInvoiceModal, setManualInvoiceModal] = useState(false)
  const [selectedClientForInvoice, setSelectedClientForInvoice] = useState<MikrotikClient | null>(null)
  const [invoiceAmount, setInvoiceAmount] = useState('')
  const [invoiceDueDate, setInvoiceDueDate] = useState('')

  const fetchData = useCallback(async () => {
    if (!isConnected || !activeRouterIp) return
    setLoading(true)
    try {
      const [invRes, cliRes] = await Promise.all([
        axios.get(`${apiUrl}/api/invoices`, { params: { routerIp: activeRouterIp } }),
        axios.get(`${apiUrl}/api/clients`, { params: { routerIp: activeRouterIp } })
      ])
      setInvoices(Array.isArray(invRes.data) ? invRes.data : [])
      setClients(Array.isArray(cliRes.data) ? cliRes.data : [])
    } catch (error: any) {
      toast.error('Failed to fetch billing data', { description: error.message })
    } finally {
      setLoading(false)
    }
  }, [apiUrl, isConnected, activeRouterIp])

  useEffect(() => {
    if (apiUrl && isConnected) {
      fetchData()
    }
  }, [apiUrl, isConnected, fetchData])

  const handleCreateInvoice = async () => {
    if (!selectedClientForInvoice) return toast.error('Please select a client')
    
    const amount = parseInt(invoiceAmount)
    if (isNaN(amount) || amount <= 0) return toast.error('Please enter a valid amount')

    try {
      const today = new Date()
      const autoDueDate = new Date(today)
      autoDueDate.setDate(today.getDate() + 30)
      
      const dueDateStr = invoiceDueDate || autoDueDate.toISOString().split('T')[0]
      
      const newInvoice = {
        id: `INV-${Date.now()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`,
        clientId: selectedClientForInvoice.ip,
        clientName: selectedClientForInvoice.name,
        clientIp: selectedClientForInvoice.ip,
        planName: selectedClientForInvoice.plan || 'Manual Invoice',
        amount: amount,
        dueDate: dueDateStr,
        issueDate: new Date().toISOString().split('T')[0],
        status: 'pending'
      }

      await axios.post(`${apiUrl}/api/invoices`, { ...newInvoice, routerIp: activeRouterIp })
      setInvoices([newInvoice as Invoice, ...invoices])
      
      setManualInvoiceModal(false)
      setSelectedClientForInvoice(null)
      setInvoiceAmount('')
      setInvoiceDueDate('')
      
      toast.success('Invoice created successfully')
    } catch (error: any) {
      toast.error('Failed to create invoice', { description: error.message })
    }
  }

  const handleMarkAsPaid = async (invoice: Invoice) => {
    if (!confirm(`Process payment for ${invoice.clientName}?`)) return

    try {
      const payment = {
        id: `PAY-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        invoiceId: invoice.id,
        clientId: invoice.clientId,
        clientName: invoice.clientName,
        amount: invoice.amount,
        paymentDate: new Date().toISOString().split('T')[0],
        paymentMethod: 'cash',
        reference: `REF-${Date.now()}`
      }
      
      await axios.post(`${apiUrl}/api/payments`, { ...payment, routerIp: activeRouterIp })
      
      const updatedInvoice = { 
        ...invoice, 
        status: 'paid', 
        paymentDate: payment.paymentDate,
        paymentMethod: payment.paymentMethod,
        reference: payment.reference
      }
      
      await axios.put(`${apiUrl}/api/invoices/${invoice.id}`, { ...updatedInvoice, routerIp: activeRouterIp })
      setInvoices((prev) => prev.map(inv => inv.id === invoice.id ? updatedInvoice as Invoice : inv))
      
      // Try to re-enable internet automatically
      try {
        await axios.post(`${apiUrl}/enable-ip`, { ip: invoice.clientIp, routerIp: activeRouterIp })
        toast.success(`Internet re-enabled for ${invoice.clientIp}`)
      } catch (e) {
        console.log("Failed to enable internet, might already be enabled.")
      }

      toast.success(`Payment processed for ${invoice.clientName}`)
    } catch (error: any) {
      toast.error('Payment Failed', { description: error.message })
    }
  }

  const handleDeleteInvoice = async (invoice: Invoice) => {
    if (invoice.status === 'paid') {
      return toast.error('Paid invoices cannot be deleted.')
    }
    if (!confirm(`Delete invoice for ${invoice.clientName}?`)) return

    try {
      await axios.delete(`${apiUrl}/api/invoices/${invoice.id}`, { data: { routerIp: activeRouterIp } })
      setInvoices((prev) => prev.filter(inv => inv.id !== invoice.id))
      toast.success('Invoice deleted')
    } catch (error: any) {
      toast.error('Failed to delete invoice', { description: error.message })
    }
  }

  const handleDownloadInvoice = (invoice: Invoice) => {
    try {
      const isPaid = invoice.status === 'paid';
      // HTML Template extracted from your React Native code
      const invoiceHTML = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <title>Invoice ${invoice.id}</title>
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; font-family: Arial, sans-serif; }
          body { background: #f0f2f5; padding: 40px; display: flex; justify-content: center; }
          .invoice { max-width: 800px; width: 100%; background: white; border-radius: 10px; box-shadow: 0 5px 15px rgba(0,0,0,0.1); overflow: hidden; }
          .header { background: #1e293b; color: white; padding: 30px; text-align: center; }
          .header h1 { font-size: 28px; margin-bottom: 5px; }
          .content { padding: 30px; }
          .row { display: flex; justify-content: space-between; margin-bottom: 15px; padding-bottom: 15px; border-bottom: 1px solid #e2e8f0; }
          .label { color: #64748b; font-weight: 600; }
          .value { color: #1e293b; font-weight: 500; }
          .client-info { background: #f8fafc; padding: 20px; border-radius: 8px; margin-bottom: 20px; }
          .client-info h3 { color: #1e293b; margin-bottom: 15px; }
          .total { background: #1e293b; color: white; padding: 20px; border-radius: 8px; display: flex; justify-content: space-between; align-items: center; margin: 20px 0; }
          .total .amount { font-size: 24px; font-weight: bold; color: #10b981; }
          .status { display: inline-block; padding: 8px 20px; border-radius: 20px; font-weight: bold; text-transform: uppercase; font-size: 12px; }
          .status-paid { background: #10b981; color: white; }
          .status-pending { background: #f59e0b; color: white; }
          .status-overdue { background: #ef4444; color: white; }
          .footer { text-align: center; padding: 20px; background: #f8fafc; color: #64748b; font-size: 12px; }
        </style>
      </head>
      <body>
        <div class="invoice">
          <div class="header">
            <h1>INVOICE</h1>
            <p>${invoice.id}</p>
          </div>
          <div class="content">
            <div class="row">
              <span class="label">Issue Date:</span>
              <span class="value">${invoice.issueDate}</span>
            </div>
            <div class="row">
              <span class="label">Due Date:</span>
              <span class="value">${invoice.dueDate}</span>
            </div>
            <div class="client-info">
              <h3>Bill To:</h3>
              <div style="margin-bottom: 10px;">
                <span class="label">Client:</span> ${invoice.clientName}<br><br>
                <span class="label">IP Address:</span> ${invoice.clientIp}<br><br>
                <span class="label">Plan:</span> ${invoice.planName}
              </div>
            </div>
            <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
              <tr style="background: #f8fafc;">
                <th style="padding: 10px; text-align: left;">Description</th>
                <th style="padding: 10px; text-align: right;">Amount</th>
              </tr>
              <tr>
                <td style="padding: 10px;">Monthly Subscription - ${invoice.planName}</td>
                <td style="padding: 10px; text-align: right;">₱${Number(invoice.amount || 0).toFixed(2)}</td>
              </tr>
            </table>
            <div class="total">
              <span>Total Amount:</span>
              <span class="amount">₱${Number(invoice.amount || 0).toLocaleString()}</span>
            </div>
            <div style="text-align: center; margin: 20px 0;">
              <span class="status status-${invoice.status}">${invoice.status}</span>
            </div>
            ${invoice.paymentDate ? `
            <div style="background: #f0f9ff; padding: 15px; border-radius: 8px; margin: 20px 0;">
              <p><strong>Payment Details</strong></p>
              <p>Date: ${invoice.paymentDate}</p>
              <p>Method: ${invoice.paymentMethod || 'N/A'}</p>
              <p>Reference: ${invoice.reference || 'N/A'}</p>
            </div>
            ` : ''}
            <div class="footer">
              <p>Thank you for your business!</p>
              <p style="margin-top: 5px;">MikroTik Billing System</p>
            </div>
          </div>
        </div>
      </body>
      </html>
      `
      const blob = new Blob([invoiceHTML], { type: 'text/html' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `invoice-${invoice.id}.html`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      toast.success('Invoice HTML downloaded.')
    } catch (err) {
      toast.error('Failed to generate download.')
    }
  }

  const filteredInvoices = (invoices || []).filter(i => 
    (i?.clientName || '').toLowerCase().includes((search || '').toLowerCase()) || 
    (i?.id || '').toLowerCase().includes((search || '').toLowerCase())
  )

  const pendingInvoices = (invoices || []).filter(i => i?.status === 'pending')
  const paidInvoices = (invoices || []).filter(i => i?.status === 'paid')
  const overdueInvoices = (invoices || []).filter(i => i?.status === 'overdue')
  const totalRevenue = paidInvoices.reduce((sum, i) => sum + (Number(i?.amount) || 0), 0)
  const pendingRevenue = pendingInvoices.reduce((sum, i) => sum + (Number(i?.amount) || 0), 0)

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
              <p className="text-muted-foreground">Please connect to a Mikrotik router from the top right widget to view and manage invoices.</p>
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
          <h2 className="text-2xl font-bold tracking-tight">Billing & Invoices</h2>
          <p className="text-muted-foreground">Manage client billing, process payments, and track revenue.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={fetchData}>
            <RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          <Button onClick={() => setManualInvoiceModal(true)}>
            <Plus className="mr-2 h-4 w-4" />
            New Invoice
          </Button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardContent className="flex items-center justify-between p-6">
            <div className="space-y-1">
              <p className="text-sm font-medium text-muted-foreground">Pending Bills</p>
              <p className="text-2xl font-bold text-amber-500">{pendingInvoices.length}</p>
            </div>
            <div className="rounded-full bg-amber-500/20 p-3">
              <Clock className="h-5 w-5 text-amber-500" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center justify-between p-6">
            <div className="space-y-1">
              <p className="text-sm font-medium text-muted-foreground">Paid Bills</p>
              <p className="text-2xl font-bold text-green-500">{paidInvoices.length}</p>
            </div>
            <div className="rounded-full bg-green-500/20 p-3">
              <CheckCircle className="h-5 w-5 text-green-500" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center justify-between p-6">
            <div className="space-y-1">
              <p className="text-sm font-medium text-muted-foreground">Overdue</p>
              <p className="text-2xl font-bold text-red-500">{overdueInvoices.length}</p>
            </div>
            <div className="rounded-full bg-red-500/20 p-3">
              <AlertCircle className="h-5 w-5 text-red-500" />
            </div>
          </CardContent>
        </Card>
        <Card className="bg-primary text-primary-foreground border-none">
          <CardContent className="flex flex-col justify-center p-6 space-y-2">
            <p className="text-sm font-medium opacity-80">Total Collected</p>
            <p className="text-3xl font-bold">₱{(totalRevenue || 0).toLocaleString()}</p>
            <p className="text-xs opacity-75">₱{(pendingRevenue || 0).toLocaleString()} pending</p>
          </CardContent>
        </Card>
      </div>

      {/* Toolbar & Search */}
      <div className="relative w-full sm:max-w-md">
        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search by client or invoice ID..."
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
              <TableHead>Invoice ID / Client</TableHead>
              <TableHead>Dates</TableHead>
              <TableHead>Plan & Amount</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredInvoices.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">
                  <div className="flex flex-col items-center justify-center">
                    <FileText className="h-8 w-8 text-muted-foreground mb-2 opacity-50" />
                    No invoices found.
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              filteredInvoices.map((inv) => (
                <TableRow key={inv.id}>
                  <TableCell>
                    <div className="font-medium">{inv.clientName}</div>
                    <div className="text-xs font-mono text-muted-foreground mt-1">{inv.id}</div>
                    <div className="text-xs text-muted-foreground mt-1">{inv.clientIp}</div>
                  </TableCell>
                  <TableCell>
                    <div className="text-sm">Issued: {inv.issueDate || 'N/A'}</div>
                    <div className="text-sm font-medium text-orange-500 mt-1">Due: {inv.dueDate || 'N/A'}</div>
                  </TableCell>
                  <TableCell>
                    <div className="text-sm font-medium">{inv.planName || 'N/A'}</div>
                    <div className="text-sm font-bold text-green-600 mt-1">₱{Number(inv.amount || 0).toLocaleString()}</div>
                  </TableCell>
                  <TableCell>
                    <Badge 
                      variant={inv.status === 'paid' ? 'default' : inv.status === 'pending' ? 'secondary' : 'destructive'}
                      className={
                        inv.status === 'paid' ? 'bg-green-500/15 text-green-600 hover:bg-green-500/25' : inv.status === 'pending' ? 'bg-amber-500/15 text-amber-600 hover:bg-amber-500/25' : ''
                      }
                    >
                      {(inv.status || 'UNKNOWN').toUpperCase()}
                    </Badge>
                    {inv.paymentDate && <div className="text-xs text-muted-foreground mt-1">Paid on: {inv.paymentDate}</div>}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      {inv.status === 'pending' && (
                        <Button variant="default" size="sm" className="bg-green-600 hover:bg-green-700" onClick={() => handleMarkAsPaid(inv)}>
                          <CheckCircle className="mr-2 h-4 w-4" />
                          Pay
                        </Button>
                      )}
                      <Button variant="outline" size="icon" onClick={() => handleDownloadInvoice(inv)} title="Download HTML Invoice">
                        <Download className="h-4 w-4" />
                      </Button>
                      {inv.status !== 'paid' && (
                        <Button variant="outline" size="icon" className="text-red-500 hover:text-red-600" onClick={() => handleDeleteInvoice(inv)}>
                          <Trash2 className="h-4 w-4" />
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

      {/* Create Manual Invoice Dialog */}
      <Dialog open={manualInvoiceModal} onOpenChange={setManualInvoiceModal}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Create New Invoice</DialogTitle>
            <DialogDescription>
              Manually create a new invoice for a specific client.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            
            <div className="grid gap-2">
              <Label>Select Client</Label>
              {/* A simple scrollable selection list to mimic the mobile app approach */}
              <div className="max-h-[200px] overflow-y-auto border rounded-md p-2 bg-secondary/20 space-y-1">
                {clients.length === 0 ? (
                  <p className="text-sm text-muted-foreground p-2 text-center">No clients found. Add a client first.</p>
                ) : (
                  clients.map(client => (
                    <div 
                      key={client.id}
                      onClick={() => setSelectedClientForInvoice(client)}
                      className={`cursor-pointer p-2 rounded-md border flex justify-between items-center transition-colors ${
                        selectedClientForInvoice?.id === client.id 
                          ? 'bg-primary text-primary-foreground border-primary' 
                          : 'bg-card hover:bg-accent'
                      }`}
                    >
                      <div>
                        <p className="font-medium text-sm">{client.name}</p>
                        <p className="text-xs opacity-80 font-mono">{client.ip}</p>
                      </div>
                      <Badge variant={selectedClientForInvoice?.id === client.id ? 'secondary' : 'outline'}>{client.plan}</Badge>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="amount">Amount (₱)</Label>
              <Input 
                id="amount" 
                type="number" 
                value={invoiceAmount} 
                onChange={(e) => setInvoiceAmount(e.target.value)} 
                placeholder="e.g. 1500" 
              />
            </div>
            
            <div className="grid gap-2">
              <Label htmlFor="due">Due Date (YYYY-MM-DD)</Label>
              <Input 
                id="due" 
                value={invoiceDueDate} 
                onChange={(e) => setInvoiceDueDate(e.target.value)} 
                placeholder="Leave blank for 30 days from today" 
              />
            </div>
            
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setManualInvoiceModal(false)}>Cancel</Button>
            <Button onClick={handleCreateInvoice}>Create Invoice</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
        </div>
      </Main>
    </>
  )
}