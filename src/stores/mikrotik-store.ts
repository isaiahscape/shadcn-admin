import { create } from 'zustand'
import axios from 'axios'

// Your network configurations
const ZEROTIER_IP = "10.144.32.181"
const LOCAL_IP = "192.168.1.2"
const PORT = "3000"

interface MikrotikState {
  apiUrl: string
  connecting: boolean
  connectionStatus: 'checking' | 'connected' | 'disconnected'
  error: string
  
  testConnection: (url: string) => Promise<boolean>
  findWorkingAPI: () => Promise<void>
  setApiUrl: (url: string) => void
}

export const useMikrotikStore = create<MikrotikState>((set, get) => ({
  apiUrl: '',
  connecting: true,
  connectionStatus: 'checking',
  error: '',

  testConnection: async (url: string) => {
    try {
      const response = await axios.get(`${url}/health`, { timeout: 5000 })
      return response.status === 200
    } catch (error) {
      return false
    }
  },

  findWorkingAPI: async () => {
    set({ connecting: true, error: '', connectionStatus: 'checking' })
    
    const apisToTry = [`http://${LOCAL_IP}:${PORT}`, `http://${ZEROTIER_IP}:${PORT}`, `http://127.0.0.1:${PORT}`, `http://localhost:${PORT}`]

    for (const api of apisToTry) {
      const isWorking = await get().testConnection(api)
      if (isWorking) {
        set({ apiUrl: api, connectionStatus: 'connected', connecting: false })
        return
      }
    }

    set({ connectionStatus: 'disconnected', connecting: false, error: "Cannot connect to backend. Please check:\n• PC on same network\n• Backend server is running\n• Firewall allows port 3000" })
  },

  setApiUrl: (url: string) => set({ apiUrl: url })
}))