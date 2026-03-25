import { useState, useEffect, useCallback } from 'react'
import axios from 'axios'
import { Plus, Edit2, Play, Pause, Activity, Zap, Info, ShieldAlert, RefreshCw } from 'lucide-react'
import { useMikrotik } from '@/features/mikrotik/mikrotik-provider'
import { useMikrotikStore } from '@/stores/mikrotik-store'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
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

export interface Plan {
  id: string
  name: string
  price: number
  speed: string
  burstLimit?: string
  description: string
  isActive: boolean
}

export function PlansView() {
  const { apiUrl } = useMikrotikStore()
  const { isConnected } = useMikrotik()

  // Fallback to localhost:3000 if apiUrl is not set (prevents fetching from frontend Vite server)
  const backendUrl = apiUrl || 'http://localhost:3000'

  const [plans, setPlans] = useState<Plan[]>([])
  const [loading, setLoading] = useState(true)

  const [planModal, setPlanModal] = useState(false)
  const [selectedPlan, setSelectedPlan] = useState<Plan | null>(null)
  
  const [planName, setPlanName] = useState('')
  const [planPrice, setPlanPrice] = useState('')
  const [planSpeed, setPlanSpeed] = useState('')
  const [planDescription, setPlanDescription] = useState('')

  const fetchPlans = useCallback(async () => {
    if (!isConnected) return
    setLoading(true)
    try {
      const res = await axios.get(`${backendUrl}/api/plans`)
      
      // Log the actual response to the console to see what we received
      console.log("Raw API Response from /api/plans:", res.data);

      // Defensive check: If it's not an array, stop and throw a clear error
      if (!Array.isArray(res.data)) {
        throw new Error("Invalid response format. Expected an array but received: " + typeof res.data);
      }
      
      setPlans(res.data)
    } catch (error: any) {
      console.error("Fetch plans error:", error);
      setPlans([]); // Fallback to an empty list so the table doesn't break
      toast.error('Failed to fetch plans', { description: error.message })
    } finally {
      setLoading(false)
    }
  }, [backendUrl, isConnected])

  useEffect(() => {
    if (isConnected) {
      fetchPlans()
    }
  }, [isConnected, fetchPlans])

  const handleSavePlan = async () => {
    if (!planName || !planPrice || !planSpeed) {
      toast.error('Please fill all required fields')
      return
    }

    try {
      const planData = {
        id: selectedPlan?.id || Date.now().toString(),
        name: planName,
        price: parseInt(planPrice),
        speed: planSpeed,
        burstLimit: '',
        description: planDescription,
        isActive: selectedPlan ? selectedPlan.isActive : true
      }

      await axios.post(`${backendUrl}/api/plans`, planData)
      toast.success(selectedPlan ? `Plan ${planName} updated` : `New plan ${planName} created`)
      
      setPlanModal(false)
      resetForm()
      fetchPlans()
    } catch (error: any) {
      toast.error('Failed to save plan', { description: error.message })
    }
  }

  const resetForm = () => {
    setSelectedPlan(null)
    setPlanName('')
    setPlanPrice('')
    setPlanSpeed('')
    setPlanDescription('')
  }

  const togglePlanActive = async (item: Plan) => {
    try {
      const updatedPlan = { ...item, isActive: !item.isActive }
      await axios.post(`${backendUrl}/api/plans`, updatedPlan)
      toast.info(`Plan ${item.name} ${!item.isActive ? 'activated' : 'deactivated'}`)
      fetchPlans()
    } catch (error: any) {
      toast.error('Failed to toggle plan status', { description: error.message })
    }
  }

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
              <p className="text-muted-foreground">Please connect to a Mikrotik router from the top right widget to view and manage plans.</p>
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
              <h2 className="text-2xl font-bold tracking-tight">Plans & Pricing</h2>
              <p className="text-muted-foreground">Manage service plans.</p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="icon" onClick={fetchPlans}>
                <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
              </Button>
              <Button onClick={() => {
                resetForm()
                setPlanModal(true)
              }}>
                <Plus className="mr-2 h-4 w-4" />
                Add New Plan
              </Button>
            </div>
          </div>

          {/* Plans Grid */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {plans.map((item) => (
              <Card key={item.id} className="flex flex-col justify-between">
                <CardHeader className="pb-4">
                  <div className="flex items-start justify-between">
                    <div>
                      <CardTitle className="text-xl text-amber-500">{item.name}</CardTitle>
                      <div className="mt-2 text-2xl font-bold">₱{item.price.toLocaleString()}</div>
                    </div>
                    <Badge variant={item.isActive ? 'default' : 'secondary'} className={item.isActive ? 'bg-green-500/15 text-green-600 hover:bg-green-500/25' : ''}>
                      {item.isActive ? 'ACTIVE' : 'INACTIVE'}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2 text-sm">
                    <div className="flex items-center text-muted-foreground">
                      <Activity className="mr-2 h-4 w-4 text-emerald-500" />
                      Speed: {item.speed}
                    </div>
                    {item.burstLimit && (
                      <div className="flex items-center text-muted-foreground">
                        <Zap className="mr-2 h-4 w-4 text-amber-500" />
                        Burst: {item.burstLimit}
                      </div>
                    )}
                    <div className="flex items-center text-muted-foreground">
                      <Info className="mr-2 h-4 w-4" />
                      {item.description}
                    </div>
                  </div>
                  
                  <div className="flex gap-2 pt-4 border-t">
                    <Button 
                      variant="outline" 
                      size="sm" 
                      className="flex-1"
                      onClick={() => {
                        setSelectedPlan(item)
                        setPlanName(item.name)
                        setPlanPrice(item.price.toString())
                        setPlanSpeed(item.speed)
                        setPlanDescription(item.description)
                        setPlanModal(true)
                      }}
                    >
                      <Edit2 className="mr-2 h-4 w-4" />
                      Edit
                    </Button>
                    <Button 
                      variant={item.isActive ? "destructive" : "default"} 
                      size="sm" 
                      className="flex-1"
                      onClick={() => togglePlanActive(item)}
                    >
                      {item.isActive ? <Pause className="mr-2 h-4 w-4" /> : <Play className="mr-2 h-4 w-4" />}
                      {item.isActive ? 'Deactivate' : 'Activate'}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>

        {/* Add/Edit Plan Dialog */}
        <Dialog open={planModal} onOpenChange={setPlanModal}>
          <DialogContent className="sm:max-w-[425px]">
            <DialogHeader>
              <DialogTitle>{selectedPlan ? 'Edit Plan' : 'Add New Plan'}</DialogTitle>
              <DialogDescription>
                Fill out the details for the subscription plan.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label htmlFor="name">Plan Name</Label>
                <Input 
                  id="name" 
                  value={planName} 
                  onChange={(e) => setPlanName(e.target.value)} 
                  placeholder="e.g., PLAN1999" 
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="price">Price (₱)</Label>
                <Input 
                  id="price" 
                  type="number" 
                  value={planPrice} 
                  onChange={(e) => setPlanPrice(e.target.value)} 
                  placeholder="1999" 
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="speed">Speed (e.g., 105M/105M)</Label>
                <Input 
                  id="speed" 
                  value={planSpeed} 
                  onChange={(e) => setPlanSpeed(e.target.value)} 
                  placeholder="105M/105M" 
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="desc">Description</Label>
                <Input 
                  id="desc" 
                  value={planDescription} 
                  onChange={(e) => setPlanDescription(e.target.value)} 
                  placeholder="105Mbps Fiber" 
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => {
                setPlanModal(false)
                resetForm()
              }}>Cancel</Button>
              <Button onClick={handleSavePlan}>
                {selectedPlan ? 'Update Plan' : 'Create Plan'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </Main>
    </>
  )
}