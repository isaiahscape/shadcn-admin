import React, { useEffect, useState, useCallback } from "react";
import {
  View,
  Text,
  FlatList,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Modal,
  SafeAreaView,
  Platform,
  Alert,
  ActivityIndicator,
  StatusBar,
  Dimensions,
  Switch,
  ScrollView,
  LogBox,
  RefreshControl
} from "react-native";
import axios from "axios";
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialIcons, Feather } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';

// Ignore SafeAreaView warning temporarily
LogBox.ignoreLogs(['SafeAreaView has been deprecated']);

const { width } = Dimensions.get('window');

// ============================================================================
// CONFIGURATION
// ============================================================================
const ZEROTIER_IP = "10.144.32.181";
const LOCAL_IP = "192.168.1.2";
const PORT = "3000";

// ============================================================================
// TYPES
// ============================================================================
interface Lease {
  ".id": string;
  address: string;
  "mac-address": string;
  server: string;
  comment: string;
  dynamic: boolean;
  status: string;
  "host-name"?: string;
}

interface AddressListItem {
  ".id": string;
  address: string;
  comment: string;
  disabled: boolean;
  dueDate?: string;
  previousDueDates?: string[];
  clientName?: string;
  installDate?: string;
}

interface Queue {
  ".id": string;
  target: string;
  displayName?: string;
  name: string;
  maxLimit: string;
  comment: string;
  disabled: boolean;
  type?: string;
}

interface ScriptLog {
  id: string;
  timestamp: string;
  message: string;
  type: 'info' | 'success' | 'error';
}

interface DueEntry {
  address: string;
  comment: string;
  dueDate: string;
  expired: boolean;
  disabled: boolean;
  previousDueDates?: string[];
  clientName?: string;
  installDate?: string;
  inGracePeriod?: boolean;
  graceUntil?: string;
}

interface Plan {
  id: string;
  name: string;
  price: number;
  speed: string;
  burstLimit?: string;
  description: string;
  isActive: boolean;
}

interface Invoice {
  id: string;
  clientId: string;
  clientName: string;
  clientIp: string;
  planName: string;
  amount: number;
  dueDate: string;
  issueDate: string;
  status: 'paid' | 'pending' | 'overdue' | 'cancelled';
  paymentDate?: string;
  paymentMethod?: string;
  reference?: string;
}

interface Payment {
  id: string;
  invoiceId: string;
  clientId: string;
  clientName: string;
  amount: number;
  paymentDate: string;
  paymentMethod: 'cash' | 'gcash' | 'bank' | 'other';
  reference: string;
  notes?: string;
}

interface Notification {
  id: string;
  clientId: string;
  clientName: string;
  type: 'due' | 'overdue' | 'disconnection' | 'payment' | 'usage';
  title: string;
  message: string;
  date: string;
  isRead: boolean;
}

interface PppoeUser {
  ".id": string;
  name: string;
  password?: string;
  service: string;
  profile: string;
  disabled: boolean;
  comment: string;
  lastLoggedOut?: string;
}

interface PppoeActive {
  ".id": string;
  name: string;
  address: string;
  service: string;
  uptime: string;
  encoding?: string;
}

interface PppProfile {
  ".id": string;
  name: string;
  localAddress: string;
  remoteAddress: string;
  rateLimit?: string;
  comment: string;
}

interface QueueItem {
  ".id": string;
  name: string;
  target: string;
  "max-limit"?: string;
  "burst-limit"?: string;
  "burst-threshold"?: string;
  "burst-time"?: string;
  "limit-at"?: string;
  queue?: string;
  comment?: string;
  disabled?: boolean;
}

// ============================================================================
// ERROR BOUNDARY
// ============================================================================
class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean }> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) {
      return (
        <LinearGradient colors={['#0b1120', '#1a2639']} style={styles.container}>
          <View style={styles.centerContent}>
            <Feather name="alert-triangle" size={60} color="#ef4444" />
            <Text style={[styles.errorText, { fontSize: 18, marginTop: 16 }]}>
              Something went wrong
            </Text>
            <Text style={styles.errorText}>
              Please restart the app
            </Text>
            <TouchableOpacity 
              style={styles.retryBtn}
              onPress={() => this.setState({ hasError: false })}
            >
              <Text style={styles.btnText}>Try Again</Text>
            </TouchableOpacity>
          </View>
        </LinearGradient>
      );
    }
    return this.props.children;
  }
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================
function HomeScreen() {
  // ==========================================================================
  // PAGE STATE
  // ==========================================================================
  const [page, setPage] = useState<"main" | "ipoe" | "pppoe">("main");
  const [ipoePage, setIpoePage] = useState<
    "home" | "leases" | "address" | "auto-disable" | "queues" | "clients" | 
    "billing" | "invoices" | "payments" | "plans" | "reports" | "notifications"
  >("home");
  const [pppoePage, setPppoePage] = useState<"home" | "users" | "active" | "queues" | "profiles">("home");

  // ==========================================================================
  // COMMON STATES
  // ==========================================================================
  const [apiUrl, setApiUrl] = useState("");
  const [connecting, setConnecting] = useState(true);
  const [connectionStatus, setConnectionStatus] = useState<"checking" | "connected" | "disconnected">("checking");
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  
  
  
  // ==========================================================================
// INVOICE MODAL STATES - I-ADD ITO SA TOP LEVEL
// ==========================================================================
const [manualInvoiceModal, setManualInvoiceModal] = useState(false);
const [selectedClientForInvoice, setSelectedClientForInvoice] = useState<any>(null);
const [invoiceAmount, setInvoiceAmount] = useState("");
const [invoiceDueDate, setInvoiceDueDate] = useState("");

  
  
  
  // ==========================================================================
  // BILLING STATES
  // ==========================================================================
  const [plans, setPlans] = useState<Plan[]>([
    { id: '1', name: 'PLAN799', price: 799, speed: '25M/25M', burstLimit: '50M/50M', description: '25Mbps Fiber', isActive: true },
    { id: '2', name: 'PLAN999', price: 999, speed: '35M/35M', burstLimit: '70M/70M', description: '35Mbps Fiber', isActive: true },
    { id: '3', name: 'PLAN1299', price: 1299, speed: '50M/50M', burstLimit: '100M/100M', description: '50Mbps Fiber', isActive: true },
    { id: '4', name: 'PLAN1699', price: 1699, speed: '75M/75M', burstLimit: '150M/150M', description: '75Mbps Fiber', isActive: true },
    { id: '5', name: 'PLAN1999', price: 1999, speed: '105M/105M', burstLimit: '200M/200M', description: '105Mbps Fiber', isActive: true },
  ]);
  
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  
  const [planModal, setPlanModal] = useState(false);
  const [invoiceModal, setInvoiceModal] = useState(false);
  const [paymentModal, setPaymentModal] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState<Plan | null>(null);
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
  
  const [planName, setPlanName] = useState("");
  const [planPrice, setPlanPrice] = useState("");
  const [planSpeed, setPlanSpeed] = useState("");
  const [planDescription, setPlanDescription] = useState("");
  
  const [dateRange, setDateRange] = useState<"day" | "week" | "month" | "year">("month");
  const [reportType, setReportType] = useState<"revenue" | "collection" | "usage">("revenue");

  // ==========================================================================
  // CLIENT DATABASE STATES
  // ==========================================================================
  const [clientDatabase, setClientDatabase] = useState<any[]>([]);
  const [selectedClient, setSelectedClient] = useState<any | null>(null);
  const [clientDetailsModal, setClientDetailsModal] = useState(false);
  const [editClientModal, setEditClientModal] = useState(false);
  const [editingClient, setEditingClient] = useState<any | null>(null);
  const [editClientName, setEditClientName] = useState("");
  const [editClientPlan, setEditClientPlan] = useState("");
  const [editClientAddress, setEditClientAddress] = useState("");
  const [editClientCpNumber, setEditClientCpNumber] = useState("");
  const [editClientInstallDate, setEditClientInstallDate] = useState("");
  const [editClientDueDate, setEditClientDueDate] = useState("");

  // ==========================================================================
  // QUEUE MANAGEMENT STATES
  // ==========================================================================
  const [simpleQueues, setSimpleQueues] = useState<QueueItem[]>([]);
  const [simpleQueueLoading, setSimpleQueueLoading] = useState(false);
  const [simpleQueueSearch, setSimpleQueueSearch] = useState("");

  const PLAN_SPEEDS: Record<string, any> = {
    "799": { maxLimit: "25M/25M", burstLimit: "53M/53M", burstThreshold: "18M/18M", limitAt: "25M/25M", burstTime: "50s/50s" },
    "999": { maxLimit: "35M/35M", burstLimit: "78M/78M", burstThreshold: "25M/25M", limitAt: "35M/35M", burstTime: "50s/50s" },
    "1299": { maxLimit: "50M/50M", burstLimit: "105M/105M", burstThreshold: "35M/35M", limitAt: "50M/50M", burstTime: "50s/50s" },
    "1699": { maxLimit: "75M/75M", burstLimit: "155M/155M", burstThreshold: "53M/53M", limitAt: "75M/75M", burstTime: "50s/50s" },
    "1999": { maxLimit: "105M/105M", burstLimit: "205M/205M", burstThreshold: "78M/78M", limitAt: "105M/105M", burstTime: "50s/50s" }
  };

  const DEFAULT_SPEED = {
    maxLimit: "5M/5M",
    burstLimit: "6M/6M",
    burstThreshold: "4M/4M",
    limitAt: "5M/5M",
    burstTime: "15s/15s"
  };

  // ==========================================================================
  // QUEUE MONITOR STATES
  // ==========================================================================
  const [monitorRunning, setMonitorRunning] = useState(false);
  const [offlineCount, setOfflineCount] = useState(0);

  // ==========================================================================
  // IPOE STATES
  // ==========================================================================
  const [leases, setLeases] = useState<Lease[]>([]);
  const [addressList, setAddressList] = useState<AddressListItem[]>([]);
  const [ipoQueues, setIpoQueues] = useState<Queue[]>([]);
  const [leaseSearch, setLeaseSearch] = useState("");
  const [addressSearch, setAddressSearch] = useState("");
  const [ipoQueueSearch, setIpoQueueSearch] = useState("");
  const [selectedAddress, setSelectedAddress] = useState<AddressListItem | null>(null);
  const [selectedLease, setSelectedLease] = useState<Lease | null>(null);
  const [comment, setComment] = useState("");
  const [leaseModal, setLeaseModal] = useState(false);
  const [addressModal, setAddressModal] = useState(false);
  const [newIP, setNewIP] = useState("");
  const [newComment, setNewComment] = useState("");
  const [addModal, setAddModal] = useState(false);
  const [loading, setLoading] = useState(false);
  const [ipoQueueLoading, setIpoQueueLoading] = useState(false);
  
  // ==========================================================================
  // AUTO-DISABLE STATES
  // ==========================================================================
  const [scriptLogs, setScriptLogs] = useState<ScriptLog[]>([]);
  const [autoDisableEnabled, setAutoDisableEnabled] = useState(false);
  const [schedulerInterval, setSchedulerInterval] = useState("1d");
  const [schedulerTime, setSchedulerTime] = useState("00:05");
  const [scriptRunning, setScriptRunning] = useState(false);
  const [dueEntries, setDueEntries] = useState<DueEntry[]>([]);
  const [statsModal, setStatsModal] = useState(false);
  const [expiredCount, setExpiredCount] = useState(0);

  // ==========================================================================
  // CONVERT MODAL STATES
  // ==========================================================================
  const [showConvertModal, setShowConvertModal] = useState(false);
  const [convertingLease, setConvertingLease] = useState<{ id: string; address: string; currentComment: string } | null>(null);
  const [convertComment, setConvertComment] = useState("");
  const [convertMonth, setConvertMonth] = useState("");
  const [convertDay, setConvertDay] = useState("");
  const [convertYear, setConvertYear] = useState("");
  const [convertDueDays, setConvertDueDays] = useState("30");
  const [convertAddress, setConvertAddress] = useState("");
  const [convertCpNumber, setConvertCpNumber] = useState("");
  const [convertPlan, setConvertPlan] = useState("");

  // ==========================================================================
  // GRACE PERIOD STATES
  // ==========================================================================
  const [graceModalVisible, setGraceModalVisible] = useState(false);
  const [selectedForGrace, setSelectedForGrace] = useState<DueEntry | null>(null);
  const [graceDays, setGraceDays] = useState("3");
  const [graceUnit, setGraceUnit] = useState<"days" | "hours" | "date">("days");
  const [graceEndDate, setGraceEndDate] = useState(new Date());
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [graceReason, setGraceReason] = useState("");

  // ==========================================================================
  // INSTALL DATE MODAL STATES
  // ==========================================================================
  const [installModalVisible, setInstallModalVisible] = useState(false);
  const [selectedForInstall, setSelectedForInstall] = useState<AddressListItem | null>(null);
  const [installDate, setInstallDate] = useState(new Date());
  const [initialDueDays, setInitialDueDays] = useState("30");

  // ==========================================================================
  // EDIT DUE DATE STATES
  // ==========================================================================
  const [editDueModalVisible, setEditDueModalVisible] = useState(false);
  const [editingDueItem, setEditingDueItem] = useState<DueEntry | null>(null);
  const [editDueMonth, setEditDueMonth] = useState("");
  const [editDueDay, setEditDueDay] = useState("");
  const [editDueYear, setEditDueYear] = useState("");
  const [editDueReason, setEditDueReason] = useState("");

  // ==========================================================================
  // PPPOE STATES
  // ==========================================================================
  const [pppUsers, setPppUsers] = useState<PppoeUser[]>([]);
  const [pppActive, setPppActive] = useState<PppoeActive[]>([]);
  const [pppProfiles, setPppProfiles] = useState<PppProfile[]>([]);
  const [pppLoading, setPppLoading] = useState(false);
  const [pppSearch, setPppSearch] = useState("");
  const [selectedPppUser, setSelectedPppUser] = useState<PppoeUser | null>(null);
  const [pppUserModal, setPppUserModal] = useState(false);
  const [pppAddModal, setPppAddModal] = useState(false);
  const [newPppName, setNewPppName] = useState("");
  const [newPppPassword, setNewPppPassword] = useState("");
  const [newPppProfile, setNewPppProfile] = useState("");
  const [newPppComment, setNewPppComment] = useState("");

  // ==========================================================================
  // PPPOE EDIT/DELETE STATES
  // ==========================================================================
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingUser, setEditingUser] = useState<PppoeUser | null>(null);
  const [editName, setEditName] = useState('');
  const [editPassword, setEditPassword] = useState('');
  const [editProfile, setEditProfile] = useState('');
  const [editComment, setEditComment] = useState('');
  const [editDisabled, setEditDisabled] = useState(false);
  const [showProfileDropdown, setShowProfileDropdown] = useState(false);
  const [activeSearch, setActiveSearch] = useState('');

  // ==========================================================================
  // API CONNECTION FUNCTIONS
  // ==========================================================================
  const testConnection = async (url: string) => {
    try {
      console.log(`🔍 Testing connection to: ${url}`);
      const response = await axios.get(`${url}/health`, { timeout: 5000 });
      console.log(`✅ Response from ${url}:`, response.status);
      return response.status === 200;
    } catch (error: any) {
      console.log(`❌ Connection failed to ${url}:`, error.message);
      return false;
    }
  };

  const findWorkingAPI = async () => {
    setConnecting(true);
    setError("");
    
    const apisToTry = [
      `http://${LOCAL_IP}:${PORT}`,
      `http://${ZEROTIER_IP}:${PORT}`,
      `http://10.0.2.2:${PORT}`,
      `http://localhost:${PORT}`,
    ];

    console.log("🔍 Trying APIs:", apisToTry);

    for (const api of apisToTry) {
      const isWorking = await testConnection(api);
      if (isWorking) {
        console.log("✅ Found working API:", api);
        setApiUrl(api);
        setConnectionStatus("connected");
        setConnecting(false);
        await refreshAllData(api);
        return;
      }
    }

    console.log("❌ No working API found");
    setConnectionStatus("disconnected");
    setConnecting(false);
    setError("Cannot connect to backend. Please check:\n• Phone and PC on same network\n• Backend server is running\n• Firewall allows port 3000");
  };

  // ==========================================================================
  // DATA FETCHING FUNCTIONS
  // ==========================================================================
  const fetchLeases = async (api = apiUrl) => {
    try {
      console.log("📡 Fetching leases...");
      const res = await axios.get<Lease[]>(`${api}/leases`, { timeout: 5000 });
      console.log(`✅ Leases loaded: ${res.data.length}`);
      setLeases(res.data);
      return res.data;
    } catch (e: any) {
      console.log("❌ Leases error:", e.message);
      throw e;
    }
  };

  const fetchAddressList = async (api = apiUrl) => {
    setLoading(true);
    try {
      console.log("📡 Fetching address list...");
      const res = await axios.get<AddressListItem[]>(`${api}/address-list`, { timeout: 5000 });
      console.log(`✅ Address list loaded: ${res.data.length}`);
      
      const enhancedData = res.data.map(entry => {
        try {
          const dueMatch = entry.comment?.match(/due\s+(\d{2})-(\d{2})-(\d{2})/i);
          const dueDate = dueMatch ? dueMatch[1] : null;
          
          let clientName = entry.comment
            ?.replace(/due\s+\d{2}-\d{2}-\d{2}\s*/i, '')
            .replace(/\(prev:[^)]+\)/i, '')
            .trim() || '';
          
          const prevMatch = entry.comment?.match(/\(prev:\s*([^)]+)\)/i);
          const previousDueDates = prevMatch 
            ? prevMatch[1].split('→').map((d: string) => d.trim()) 
            : [];
          
          const installMatch = entry.comment?.match(/\(installed:\s*([^)]+)\)/i);
          const installDate = installMatch ? installMatch[1] : undefined;
          
          return {
            ...entry,
            dueDate,
            clientName,
            previousDueDates,
            installDate
          };
        } catch (err) {
          return entry;
        }
      });
      
      setAddressList(enhancedData);
      return enhancedData;
    } catch (e: any) {
      console.log("❌ Address list error:", e.message);
      throw e;
    } finally {
      setLoading(false);
    }
  };

  const fetchQueuesData = async (api = apiUrl) => {
    try {
      console.log("📡 Fetching queues...");
      const res = await axios.get<Queue[]>(`${api}/queues/all`, { timeout: 5000 });
      console.log(`✅ Queues loaded: ${res.data.length}`);
      setIpoQueues(res.data);
      return res.data;
    } catch (e: any) {
      console.log("❌ Queues error:", e.message);
      throw e;
    }
  };

  const fetchScriptStatus = async (api = apiUrl) => {
    try {
      const res = await axios.get(`${api}/script-status`, { timeout: 5000 });
      setAutoDisableEnabled(res.data.enabled || false);
      setSchedulerInterval(res.data.interval || "1d");
      setSchedulerTime(res.data.time?.substring(0,5) || "00:05");
    } catch (e: any) {
      console.log("Script status error:", e.message);
    }
  };

  const fetchDueEntries = async (api = apiUrl) => {
  try {
    const res = await axios.get(`${api}/due-entries`, { timeout: 5000 });
    
    // Get today's date
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const enhancedData = res.data.map((entry: any) => {
      try {
        // Check if expired based on due date
        let isExpired = false;
        if (entry.dueDate) {
          const [month, day, year] = entry.dueDate.split('-').map(Number);
          const dueDate = new Date(2000 + year, month - 1, day);
          dueDate.setHours(0, 0, 0, 0);
          isExpired = dueDate < today;
        }
        
        let clientName = entry.comment
          ?.replace(/due\s+\d{2}-\d{2}-\d{2}\s*/i, '')
          .replace(/\(prev:[^)]+\)/i, '')
          .trim() || 'No name';
        
        const prevMatch = entry.comment?.match(/\(prev:\s*([^)]+)\)/i);
        const previousDueDates = prevMatch 
          ? prevMatch[1].split('→').map((d: string) => d.trim()) 
          : [];
        
        const installMatch = entry.comment?.match(/\(installed:\s*([^)]+)\)/i);
        const installDate = installMatch ? installMatch[1] : undefined;
        
        const graceMatch = entry.comment?.match(/\(grace:\s*([^)]+)\)/i);
        const graceUntil = graceMatch ? graceMatch[1] : null;
        const inGracePeriod = graceMatch ? true : false;
        
        // Check if still in grace period
        let stillInGrace = false;
        if (graceUntil) {
          // Parse grace until date (assuming format YYYY-MM-DD)
          const [gYear, gMonth, gDay] = graceUntil.split('-').map(Number);
          const graceDate = new Date(gYear, gMonth - 1, gDay);
          graceDate.setHours(0, 0, 0, 0);
          stillInGrace = graceDate >= today;
        }
        
        return {
          ...entry,
          clientName,
          previousDueDates,
          installDate,
          graceUntil,
          inGracePeriod: stillInGrace,
          expired: isExpired && !stillInGrace // Expired if past due and not in grace
        };
      } catch (err) {
        return entry;
      }
    });
    
    setDueEntries(enhancedData);
    setExpiredCount(enhancedData.filter((e: DueEntry) => e.expired).length);
    
    // Auto-disable expired entries
    const expiredEntries = enhancedData.filter((e: DueEntry) => e.expired && !e.disabled);
    if (expiredEntries.length > 0) {
      console.log(`⚠️ Found ${expiredEntries.length} expired entries, disabling...`);
      // Call the disable function
      await disableExpiredEntries(expiredEntries);
    }
    
  } catch (e: any) {
    console.log("Due entries error:", e.message);
  }
};

  const fetchLogs = async (api = apiUrl) => {
    try {
      const res = await axios.get(`${api}/auto-disable-logs?limit=20`, { timeout: 5000 });
      setScriptLogs(res.data);
    } catch (e: any) {
      console.log("Logs error:", e.message);
    }
  };

  const fetchPppUsers = async (api = apiUrl) => {
    try {
      console.log("📡 Fetching PPPoE users...");
      const res = await axios.get(`${api}/ppp/secret`);
      console.log(`✅ PPPoE users loaded: ${res.data.length}`);
      setPppUsers(res.data);
      return res.data;
    } catch (error: any) {
      console.log("❌ PPPoE users error:", error.message);
      throw error;
    }
  };

  const fetchPppActive = async (api = apiUrl) => {
    try {
      console.log("📡 Fetching active PPPoE sessions...");
      const res = await axios.get(`${api}/ppp/active`);
      console.log(`✅ Active sessions loaded: ${res.data.length}`);
      setPppActive(res.data);
      return res.data;
    } catch (error: any) {
      console.log("❌ Active sessions error:", error.message);
      throw error;
    }
  };

  const fetchPppProfiles = async (api = apiUrl) => {
    try {
      console.log("📡 Fetching PPPoE profiles...");
      const res = await axios.get(`${api}/ppp/profile`);
      console.log(`✅ Profiles loaded: ${res.data.length}`);
      setPppProfiles(res.data);
      return res.data;
    } catch (error: any) {
      console.log("❌ Profiles error:", error.message);
      throw error;
    }
  };

  const fetchSimpleQueues = async () => {
    setSimpleQueueLoading(true);
    try {
      const response = await axios.get(`${apiUrl}/queues/all`);
      setSimpleQueues(response.data);
      console.log(`✅ Loaded ${response.data.length} simple queues`);
      addLog(`📊 Loaded ${response.data.length} queues`, 'info');
    } catch (error: any) {
      console.log("❌ Failed to fetch queues:", error.message);
      addLog(`❌ Failed to fetch queues: ${error.message}`, 'error');
    } finally {
      setSimpleQueueLoading(false);
    }
  };

  const fetchClients = async (api = apiUrl) => {
    try {
      console.log("📡 Fetching clients from database...");
      const res = await axios.get(`${api}/api/clients`);
      
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      const validatedClients = res.data.map((client: any) => {
        if (client.dueDate) {
          const [month, day, year] = client.dueDate.split('-').map(Number);
          const dueDate = new Date(2000 + year, month - 1, day);
          dueDate.setHours(0, 0, 0, 0);
          
          const isExpired = dueDate < today;
          let isExpired = dueDate < today;
          
          if (client.graceUntil) {
            const graceDate = new Date(client.graceUntil);
            graceDate.setHours(0, 0, 0, 0);
            if (graceDate >= today) {
              isExpired = false;
            }
          }
          
          if (isExpired && client.status !== 'expired') {
            return { ...client, status: 'expired' };
          } else if (!isExpired && client.status === 'expired') {
            return { ...client, status: 'active' };
          }
        }
        return client;
      });
      
      console.log(`✅ Clients loaded: ${validatedClients.length}`);
      setClientDatabase(validatedClients);
      return validatedClients;
    } catch (error: any) {
      console.log("❌ Failed to fetch clients:", error.message);
      return [];
    }
  };

  const fetchInvoices = async (api = apiUrl) => {
    try {
      const res = await axios.get(`${api}/api/invoices`);
      setInvoices(res.data);
      console.log(`✅ Invoices loaded: ${res.data.length}`);
    } catch (error: any) {
      console.log("❌ Failed to fetch invoices:", error.message);
    }
  };

  const fetchPayments = async (api = apiUrl) => {
    try {
      const res = await axios.get(`${api}/api/payments`);
      setPayments(res.data);
      console.log(`✅ Payments loaded: ${res.data.length}`);
    } catch (error: any) {
      console.log("❌ Failed to fetch payments:", error.message);
    }
  };

  // ==========================================================================
  // REFRESH ALL DATA
  // ==========================================================================
  const refreshAllData = async (api = apiUrl) => {
    setRefreshing(true);
    try {
      console.log("🔄 Refreshing all data...");
      
      await Promise.allSettled([
        fetchLeases(api),
        fetchAddressList(api),
        fetchQueuesData(api),
        fetchScriptStatus(api),
        fetchDueEntries(api),
        fetchLogs(api),
        fetchPppUsers(api),
        fetchPppActive(api),
        fetchPppProfiles(api),
        fetchSimpleQueues(),
        fetchClients(api),
        fetchInvoices(api),
        fetchPayments(api)
      ]);
      
      console.log("✅ All data refreshed");
      addLog("🔄 All data refreshed", 'info');
    } catch (error) {
      console.log("⚠️ Some data failed to load");
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    findWorkingAPI();
  }, []);
  
  
  
  
  

  useEffect(() => {
    if (connectionStatus === 'connected') {
      fetchClients();
      fetchInvoices();
      fetchPayments();
      fetchSimpleQueues();
      fetchLeases();
      fetchAddressList();
    }
  }, [connectionStatus]);
  
  
  // Auto-disable scheduler
useEffect(() => {
  if (!autoDisableEnabled || connectionStatus !== 'connected') return;
  
  // Parse interval
  let intervalMs = 24 * 60 * 60 * 1000; // default 1 day
  if (schedulerInterval === '12h') intervalMs = 12 * 60 * 60 * 1000;
  if (schedulerInterval === '6h') intervalMs = 6 * 60 * 60 * 1000;
  if (schedulerInterval === '1h') intervalMs = 60 * 60 * 1000;
  
  // Parse scheduled time
  const [hour, minute] = schedulerTime.split(':').map(Number);
  
  // Calculate next run time
  const now = new Date();
  const nextRun = new Date();
  nextRun.setHours(hour, minute, 0, 0);
  
  if (nextRun <= now) {
    nextRun.setDate(nextRun.getDate() + 1); // Next day
  }
  
  const timeUntilNextRun = nextRun.getTime() - now.getTime();
  
  addLog(`⏰ Auto-disable scheduler: Next run at ${nextRun.toLocaleString()}`, 'info');
  
  // Set timeout for first run
  const timeoutId = setTimeout(() => {
    // Run the script
    runDisableScript();
    
    // Then set interval for subsequent runs
    const intervalId = setInterval(() => {
      runDisableScript();
    }, intervalMs);
    
    // Store interval ID for cleanup
    (window as any).__autoDisableInterval = intervalId;
    
  }, timeUntilNextRun);
  
  // Cleanup
  return () => {
    clearTimeout(timeoutId);
    if ((window as any).__autoDisableInterval) {
      clearInterval((window as any).__autoDisableInterval);
    }
  };
}, [autoDisableEnabled, schedulerInterval, schedulerTime, connectionStatus]);
  
  

  // ==========================================================================
  // ADD LOG FUNCTION
  // ==========================================================================
  const addLog = (message: string, type: 'info' | 'success' | 'error' = 'info') => {
    const newLog: ScriptLog = {
      id: `log-${Date.now()}-${Math.random().toString(36).substring(2, 10)}`,
      timestamp: new Date().toLocaleTimeString(),
      message,
      type
    };
    setScriptLogs(prev => [newLog, ...prev].slice(0, 30));
  };

  // ==========================================================================
  // ADD NOTIFICATION FUNCTION
  // ==========================================================================
  const addNotification = (notification: Omit<Notification, 'id' | 'date' | 'isRead'>) => {
    const newNotification: Notification = {
      ...notification,
      id: `notif-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      date: new Date().toISOString(),
      isRead: false
    };
    setNotifications(prev => [newNotification, ...prev].slice(0, 50));
  };

  const markNotificationAsRead = (id: string) => {
    setNotifications(prev => 
      prev.map(n => n.id === id ? { ...n, isRead: true } : n)
    );
  };

  const clearAllNotifications = () => {
    Alert.alert(
      "Clear Notifications",
      "Are you sure you want to clear all notifications?",
      [
        { text: "Cancel", style: "cancel" },
        { 
          text: "Clear All", 
          style: "destructive",
          onPress: () => setNotifications([])
        }
      ]
    );
  };

  // ==========================================================================
  // UTILITY FUNCTIONS
  // ==========================================================================
  const extractPlanNumber = (planText: string): string => {
    const match = planText?.match(/(\d+)/);
    return match ? match[1] : "0";
  };

  const getSpeedForPlan = (planText: string) => {
    const planNumber = extractPlanNumber(planText);
    return PLAN_SPEEDS[planNumber] || DEFAULT_SPEED;
  };

  const checkIpOnline = async (ip: string): Promise<boolean> => {
    try {
      const response = await axios.get(`${apiUrl}/ping/${ip}`, { timeout: 3000 });
      return response.data.online;
    } catch {
      return false;
    }
  };

  // ==========================================================================
  // QUEUE MANAGEMENT FUNCTIONS
  // ==========================================================================
  const createClientQueue = async (client: {
    ip: string;
    name: string;
    plan: string;
  }) => {
    try {
      const speed = getSpeedForPlan(client.plan);
      const cleanName = client.name.replace(/\s+/g, '').replace(/[^a-zA-Z0-9]/g, '');
      const queueName = `${cleanName}${client.plan}`;
      
      const queueData = {
        name: queueName,
        target: client.ip,
        "max-limit": speed.maxLimit,
        "burst-limit": speed.burstLimit,
        "burst-threshold": speed.burstThreshold,
        "burst-time": speed.burstTime,
        "limit-at": speed.limitAt,
        queue: "fqcodel-download/fqcodel-upload",
        comment: `PLAN=${extractPlanNumber(client.plan)};client=${client.name};IP=${client.ip}`
      };
      
      console.log("📤 Creating queue:", queueData);
      
      await axios.post(`${apiUrl}/api/queues/add`, queueData);
      addLog(`✅ Queue created for ${client.name} (${client.plan} - ${speed.maxLimit})`, 'success');
      
      await createInvoiceForClient(client);
      
      return true;
    } catch (error: any) {
      console.log("❌ Queue creation error:", error.response?.data || error.message);
      addLog(`❌ Failed to create queue: ${error.message}`, 'error');
      return false;
    }
  };

  const updateClientQueue = async (client: {
    ip: string;
    name: string;
    plan: string;
    queueId?: string;
  }) => {
    try {
      const speed = getSpeedForPlan(client.plan);
      const cleanName = client.name.replace(/\s+/g, '').replace(/[^a-zA-Z0-9]/g, '');
      const queueName = `${cleanName}${client.plan}`;
      
      const existingQueue = simpleQueues.find(q => q.target === client.ip);
      
      if (existingQueue) {
        await axios.put(`${apiUrl}/queues/${existingQueue[".id"]}`, {
          name: queueName,
          "max-limit": speed.maxLimit,
          "burst-limit": speed.burstLimit,
          "burst-threshold": speed.burstThreshold,
          "burst-time": speed.burstTime,
          "limit-at": speed.limitAt,
          comment: `PLAN=${extractPlanNumber(client.plan)};client=${client.name};IP=${client.ip}`
        });
        addLog(`🔄 Queue updated for ${client.name}`, 'info');
      } else {
        await createClientQueue(client);
      }
      
      await fetchSimpleQueues();
      return true;
    } catch (error: any) {
      addLog(`❌ Failed to update queue: ${error.message}`, 'error');
      return false;
    }
  };

  const deleteClientQueue = async (ip: string) => {
    try {
      const existingQueue = simpleQueues.find(q => q.target === ip);
      
      if (existingQueue) {
        await axios.delete(`${apiUrl}/queues/${existingQueue[".id"]}`);
        addLog(`🗑️ Queue removed for IP ${ip}`, 'info');
        await fetchSimpleQueues();
        return true;
      }
      return false;
    } catch (error: any) {
      addLog(`❌ Failed to delete queue: ${error.message}`, 'error');
      return false;
    }
  };

  const scanAllQueues = async () => {
    addLog('🔍 Scanning all queues...', 'info');
    
    try {
      await fetchSimpleQueues();
      
      const addresses = addressList.filter(a => a.comment?.includes('due'));
      
      let created = 0;
      let updated = 0;
      let removed = 0;
      
      for (const addr of addresses) {
        const isOnline = await checkIpOnline(addr.address);
        
        if (isOnline) {
          const comment = addr.comment || "";
          const nameMatch = comment.match(/^([^d]+?)(?:\s+due|\s+PLAN|$)/);
          const clientName = nameMatch ? nameMatch[1].trim() : "Client";
          
          const planMatch = comment.match(/(PLAN\d+)/i);
          const plan = planMatch ? planMatch[1] : "PLAN1999";
          
          const existingQueue = simpleQueues.find(q => q.target === addr.address);
          
          if (existingQueue) {
            await updateClientQueue({
              ip: addr.address,
              name: clientName,
              plan,
              queueId: existingQueue[".id"]
            });
            updated++;
          } else {
            await createClientQueue({
              ip: addr.address,
              name: clientName,
              plan
            });
            created++;
          }
        } else {
          const removed_queue = await deleteClientQueue(addr.address);
          if (removed_queue) removed++;
        }
      }
      
      addLog(`✅ Scan complete: ${created} created, ${updated} updated, ${removed} removed`, 'success');
      await fetchSimpleQueues();
      
    } catch (error: any) {
      addLog(`❌ Scan failed: ${error.message}`, 'error');
    }
  };

  const toggleQueueMonitor = async () => {
    try {
      const response = await axios.post(`${apiUrl}/api/queues/monitor/toggle`, {
        enabled: !monitorRunning
      });
      setMonitorRunning(response.data.enabled);
      addLog(`${response.data.enabled ? '▶️' : '⏸️'} Queue monitor ${response.data.enabled ? 'started' : 'stopped'}`, 'info');
    } catch (error) {
      addLog('❌ Failed to toggle queue monitor', 'error');
    }
  };

  const scanQueuesNow = async () => {
    addLog('🔍 Manual queue scan started...', 'info');
    try {
      await axios.post(`${apiUrl}/api/queues/scan`);
      addLog('✅ Queue scan completed', 'success');
    } catch (error) {
      addLog('❌ Queue scan failed', 'error');
    }
  };

  const getOfflineClients = async () => {
    try {
      const response = await axios.get(`${apiUrl}/api/queues/offline`);
      setOfflineCount(response.data.length);
      return response.data;
    } catch (error) {
      return [];
    }
  };

  // ==========================================================================
  // REPORTS FUNCTIONS
  // ==========================================================================
  const getRevenueReport = () => {
    const now = new Date();
    let startDate = new Date();
    
    switch(dateRange) {
      case 'day':
        startDate.setDate(now.getDate() - 1);
        break;
      case 'week':
        startDate.setDate(now.getDate() - 7);
        break;
      case 'month':
        startDate.setMonth(now.getMonth() - 1);
        break;
      case 'year':
        startDate.setFullYear(now.getFullYear() - 1);
        break;
    }
    
    const filteredPayments = payments.filter(p => 
      new Date(p.paymentDate) >= startDate
    );
    
    const totalRevenue = filteredPayments.reduce((sum, p) => sum + p.amount, 0);
    const totalClients = clientDatabase.length;
    const activeClients = clientDatabase.filter(c => c.status === 'active').length;
    const overdueClients = dueEntries.filter(e => e.expired && !e.disabled).length;
    
    return {
      totalRevenue,
      totalClients,
      activeClients,
      overdueClients,
      collectionRate: activeClients ? ((activeClients - overdueClients) / activeClients * 100).toFixed(1) : 0,
      averageRevenue: activeClients ? (totalRevenue / activeClients).toFixed(2) : 0,
      payments: filteredPayments
    };
  };

  // ==========================================================================
  // CREATE INVOICE FUNCTION
  // ==========================================================================
  const createInvoiceForClient = async (client: {
    ip: string;
    name: string;
    plan: string;
  }) => {
    try {
      const planDetails = plans.find(p => p.name === client.plan);
      if (!planDetails) {
        console.log(`⚠️ No plan found for ${client.plan}`);
        return null;
      }
      
      const today = new Date();
      const dueDate = new Date(today);
      dueDate.setDate(today.getDate() + 30);
      
      const dueDateStr = `${dueDate.getFullYear()}-${(dueDate.getMonth()+1).toString().padStart(2,'0')}-${dueDate.getDate().toString().padStart(2,'0')}`;
      const issueDateStr = today.toISOString().split('T')[0];
      
      const newInvoice: Invoice = {
        id: `INV-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        clientId: client.ip,
        clientName: client.name,
        clientIp: client.ip,
        planName: client.plan,
        amount: planDetails.price,
        dueDate: dueDateStr,
        issueDate: issueDateStr,
        status: 'pending'
      };
      
      console.log("📝 Creating invoice:", newInvoice);
      
      try {
        await axios.post(`${apiUrl}/api/invoices`, newInvoice);
        console.log("✅ Invoice saved to backend");
      } catch (error) {
        console.log("⚠️ Failed to save to backend:", error);
      }
      
      setInvoices(prev => [newInvoice, ...prev]);
      
      addLog(`💰 Invoice created for ${client.name}: ₱${planDetails.price}`, 'info');
      
      return newInvoice;
      
    } catch (error: any) {
      console.log("❌ Failed to create invoice:", error.message);
      addLog(`❌ Invoice creation failed: ${error.message}`, 'error');
      return null;
    }
  };

  // ==========================================================================
  // EDIT DUE DATE FUNCTIONS
  // ==========================================================================
  const openEditDueModal = (item: DueEntry) => {
    setEditingDueItem(item);
    
    if (item.dueDate) {
      const [month, day, year] = item.dueDate.split('-');
      setEditDueMonth(month || "");
      setEditDueDay(day || "");
      setEditDueYear(year || "");
    } else {
      const today = new Date();
      setEditDueMonth((today.getMonth() + 1).toString().padStart(2, '0'));
      setEditDueDay(today.getDate().toString().padStart(2, '0'));
      setEditDueYear(today.getFullYear().toString().slice(-2));
    }
    
    setEditDueReason("");
    setEditDueModalVisible(true);
  };

  const applyDueDateEdit = async () => {
    if (!editingDueItem) return;
    
    if (!editDueMonth || !editDueDay || !editDueYear) {
      Alert.alert("Error", "Please enter complete date (MM-DD-YY)");
      return;
    }
    
    const month = parseInt(editDueMonth);
    const day = parseInt(editDueDay);
    const year = parseInt(editDueYear);
    
    if (month < 1 || month > 12 || day < 1 || day > 31 || year < 0 || year > 99) {
      Alert.alert("Error", "Please enter valid date values");
      return;
    }
    
    const newDueDateStr = `${editDueMonth.padStart(2, '0')}-${editDueDay.padStart(2, '0')}-${editDueYear.padStart(2, '0')}`;
    
    try {
      addLog(`✏️ Editing due date for ${editingDueItem.address}...`, 'info');
      
      let cleanComment = editingDueItem.comment
        .replace(/due\s+\d{2}-\d{2}-\d{2}\s*/i, '')
        .replace(/\(prev:[^)]+\)/i, '')
        .replace(/\(grace:[^)]+\)/i, '')
        .replace(/\(grace-hist:[^)]+\)/i, '')
        .replace(/\(reason:[^)]+\)/i, '')
        .replace(/\(installed:[^)]+\)/i, '')
        .trim() || "Client";
      
      const installMatch = editingDueItem.comment?.match(/\(installed:\s*([^)]+)\)/i);
      const installDateStr = installMatch ? ` (installed: ${installMatch[1]})` : '';
      
      let newComment = `due ${newDueDateStr} ${cleanComment}`;
      if (editDueReason) {
        newComment += ` (reason: ${editDueReason})`;
      }
      if (installDateStr) {
        newComment += installDateStr;
      }
      
      if (editingDueItem.dueDate) {
        newComment += ` (prev: ${editingDueItem.dueDate})`;
      }
      
      const addressEntry = addressList.find(a => a.address === editingDueItem.address);
      
      if (addressEntry) {
        await axios.post(`${apiUrl}/update-address-comment`, {
          id: addressEntry[".id"],
          comment: newComment
        });
        
        addLog(`✅ Due date updated for ${editingDueItem.address}`, 'success');
        
        setEditDueModalVisible(false);
        await fetchAddressList();
        await fetchDueEntries();
        
        Alert.alert("✅ Success", `New due date: ${newDueDateStr}`);
      }
    } catch (error: any) {
      addLog(`❌ Failed to update due date: ${error.message}`, 'error');
      Alert.alert("Error", "Failed to update due date");
    }
  };




// ==========================================================================
// DISABLE EXPIRED ENTRIES FUNCTION
// ==========================================================================
const disableExpiredEntries = async (expiredEntries: DueEntry[]) => {
  try {
    let disabled = 0;
    
    for (const entry of expiredEntries) {
      // Find in address list
      const addressEntry = addressList.find(a => a.address === entry.address);
      
      if (addressEntry && !addressEntry.disabled) {
        console.log(`🔴 Disabling ${entry.address} (expired)`);
        
        // Call API to remove/disable IP
        await axios.post(`${apiUrl}/remove-ip`, { ip: entry.address });
        
        // Update comment to show it was auto-disabled
        const newComment = `${entry.comment} (auto-disabled: ${new Date().toLocaleDateString()})`;
        await axios.post(`${apiUrl}/update-address-comment`, {
          id: addressEntry[".id"],
          comment: newComment
        });
        
        disabled++;
        
        // Add notification
        addNotification({
          clientId: entry.address,
          clientName: entry.clientName || 'Unknown',
          type: 'disconnection',
          title: 'Auto-Disconnected',
          message: `${entry.clientName || entry.address} was automatically disconnected due to non-payment.`
        });
      }
    }
    
    if (disabled > 0) {
      addLog(`🔴 Auto-disabled ${disabled} expired client(s)`, 'error');
      // Refresh data
      await fetchAddressList();
      await fetchDueEntries();
    }
    
  } catch (error: any) {
    console.log("❌ Failed to disable expired entries:", error.message);
    addLog(`❌ Auto-disable failed: ${error.message}`, 'error');
  }
};





  // ==========================================================================
  // GRACE PERIOD FUNCTIONS
  // ==========================================================================
  const openGraceModal = (item: DueEntry) => {
    setSelectedForGrace(item);
    
    const graceMatch = item.comment?.match(/\(grace:\s*([^)]+)\)/i);
    if (graceMatch) {
      const existingGrace = graceMatch[1];
      if (existingGrace.includes('-') && existingGrace.length <= 10) {
        setGraceUnit("date");
        const [year, month, day] = existingGrace.split('-').map(Number);
        setGraceEndDate(new Date(year, month-1, day));
      } else if (existingGrace.includes(' ')) {
        setGraceUnit("date");
        const [datePart] = existingGrace.split(' ');
        const [year, month, day] = datePart.split('-').map(Number);
        setGraceEndDate(new Date(year, month-1, day));
      } else if (existingGrace.includes('h')) {
        setGraceUnit("hours");
        setGraceDays(existingGrace.replace('h', ''));
      } else {
        setGraceUnit("days");
        setGraceDays(existingGrace);
      }
    } else {
      setGraceDays("3");
      setGraceUnit("days");
      setGraceEndDate(new Date());
    }
    
    setGraceReason("");
    setGraceModalVisible(true);
  };

  const applyGracePeriod = async () => {
    if (!selectedForGrace) return;
    
    try {
      addLog(`⏳ Applying grace period for ${selectedForGrace.address}...`, 'info');
      
      const now = new Date();
      let graceEndStr: string;
      let finalDueStr: string;
      
      if (graceUnit === 'days') {
        const days = parseInt(graceDays) || 3;
        const graceEnd = new Date(now);
        graceEnd.setDate(now.getDate() + days);
        
        const year = graceEnd.getFullYear();
        const month = (graceEnd.getMonth() + 1).toString().padStart(2, '0');
        const day = graceEnd.getDate().toString().padStart(2, '0');
        graceEndStr = `${year}-${month}-${day}`;
      } else {
        const year = graceEndDate.getFullYear();
        const month = (graceEndDate.getMonth() + 1).toString().padStart(2, '0');
        const day = graceEndDate.getDate().toString().padStart(2, '0');
        graceEndStr = `${year}-${month}-${day}`;
      }
      
      const finalDue = new Date(now);
      finalDue.setDate(now.getDate() + 30);
      const fYear = finalDue.getFullYear();
      const fMonth = (finalDue.getMonth() + 1).toString().padStart(2, '0');
      const fDay = finalDue.getDate().toString().padStart(2, '0');
      finalDueStr = `${fYear}-${fMonth}-${fDay}`;
      finalDueStr = selectedForGrace.dueDate || "";
      
      let clientName = selectedForGrace.comment
        .replace(/due\s+\d{2}-\d{2}-\d{2}\s*/i, '')
        .replace(/\(prev:[^)]+\)/i, '')
        .replace(/\(grace:[^)]+\)/i, '')
        .replace(/\(grace-hist:[^)]+\)/i, '')
        .replace(/\(reason:[^)]+\)/i, '')
        .replace(/\(installed:[^)]+\)/i, '')
        .trim() || "Client";
      
      let newComment = `due ${finalDueStr} ${clientName}`;
      newComment += ` (grace: ${graceEndStr})`;
      if (graceReason) newComment += ` (reason: ${graceReason})`;
      
      const installMatch = selectedForGrace.comment?.match(/\(installed:\s*([^)]+)\)/i);
      if (installMatch) {
        newComment += ` (installed: ${installMatch[1]})`;
      }
      
      const prevMatch = selectedForGrace.comment?.match(/\(prev:\s*([^)]+)\)/i);
      if (prevMatch) {
        newComment += ` (prev: ${prevMatch[1]})`;
      } else if (selectedForGrace.dueDate) {
        newComment += ` (prev: ${selectedForGrace.dueDate})`;
      }
      
      const addressEntry = addressList.find(a => a.address === selectedForGrace.address);
      
      if (addressEntry) {
        await axios.post(`${apiUrl}/update-address-comment`, {
          id: addressEntry[".id"],
          comment: newComment
        });
        
        if (addressEntry.disabled) {
          await axios.post(`${apiUrl}/enable-ip`, { ip: selectedForGrace.address });
        }
        
        addLog(`✅ Grace period applied for ${selectedForGrace.address}`, 'success');
        
        setGraceModalVisible(false);
        await refreshAllData();
        
        Alert.alert(
          "✅ Grace Period Applied", 
          `${clientName}\nIP: ${selectedForGrace.address}\nGrace until: ${graceEndStr}\nNew due date: ${finalDueStr}`
        );
      }
    } catch (error: any) {
      addLog(`❌ Grace period failed: ${error.message}`, 'error');
      Alert.alert("Error", "Failed to apply grace period");
    }
  };

  // ==========================================================================
  // OPEN INSTALL MODAL
  // ==========================================================================
  const openInstallModal = (item: AddressListItem) => {
    console.log("=".repeat(50));
    console.log("📌 INSTALL BUTTON CLICKED!");
    console.log("📍 Address:", item.address);
    console.log("📍 Comment:", item.comment);
    console.log("📍 Current installModalVisible:", installModalVisible);
    console.log("=".repeat(50));
    
    setSelectedForInstall(item);
    console.log("✅ selectedForInstall set to:", item.address);
    
    const today = new Date();
    setInstallDate(today);
    console.log("✅ installDate set to:", today.toLocaleDateString());
    
    setInitialDueDays("30");
    console.log("✅ initialDueDays set to: 30");
    
    setInstallModalVisible(true);
    console.log("✅ installModalVisible set to: true");
    
    setTimeout(() => {
      console.log("⏱️ After 100ms - installModalVisible is now:", installModalVisible);
    }, 100);
  };

  const applyInstallDate = async () => {
    if (!selectedForInstall) return;
    
    try {
      addLog(`📅 Setting install date for ${selectedForInstall.address}...`, 'info');
      
      const installYear = installDate.getFullYear();
      const installMonth = (installDate.getMonth() + 1).toString().padStart(2, '0');
      const installDay = installDate.getDate().toString().padStart(2, '0');
      const installDateStr = `${installMonth}-${installDay}-${installYear.toString().slice(-2)}`;
      
      const dueDays = parseInt(initialDueDays) || 30;
      const dueDate = new Date(installDate);
      dueDate.setDate(installDate.getDate() + dueDays);
      
      const dueMonth = (dueDate.getMonth() + 1).toString().padStart(2, '0');
      const dueDay = dueDate.getDate().toString().padStart(2, '0');
      const dueYear = dueDate.getFullYear().toString().slice(-2);
      const dueDateStr = `${dueMonth}-${dueDay}-${dueYear}`;
      
      let clientName = selectedForInstall.comment?.trim() || "Client";
      
      const newComment = `due ${dueDateStr} ${clientName} (installed: ${installDateStr})`;
      
      await axios.post(`${apiUrl}/update-address-comment`, {
        id: selectedForInstall[".id"],
        comment: newComment
      });
      
      addLog(`✅ Install date set for ${selectedForInstall.address}`, 'success');
      addLog(`📅 Due date: ${dueDateStr} (${dueDays} days from install)`, 'info');
      
      setInstallModalVisible(false);
      fetchAddressList();
      fetchDueEntries();
      
      Alert.alert(
        "✅ Install Date Set",
        `IP: ${selectedForInstall.address}\nInstalled: ${installDateStr}\nDue: ${dueDateStr}`
      );
      
    } catch (error: any) {
      addLog(`❌ Failed to set install date: ${error.message}`, 'error');
      Alert.alert("Error", "Failed to set install date");
    }
  };
  
  // ==========================================================================
  // RECALCULATE DUE DATE
  // ==========================================================================
  const recalculateDueDate = () => {
    if (!editClientInstallDate) {
      Alert.alert("Error", "Please enter install date first");
      return;
    }
    
    const [installMonth, installDay, installYear] = editClientInstallDate.split('-').map(Number);
    
    if (!installMonth || !installDay || !installYear) {
      Alert.alert("Error", "Invalid install date format. Use MM-DD-YY");
      return;
    }
    
    if (installMonth < 1 || installMonth > 12 || installDay < 1 || installDay > 31 || installYear < 0 || installYear > 99) {
      Alert.alert("Error", "Please enter valid date values");
      return;
    }
    
    const installDate = new Date(2000 + installYear, installMonth - 1, installDay);
    const dueDate = new Date(installDate);
    dueDate.setDate(installDate.getDate() + 35);
    
    const dueMonth = (dueDate.getMonth() + 1).toString().padStart(2, '0');
    const dueDay = dueDate.getDate().toString().padStart(2, '0');
    const dueYear = dueDate.getFullYear().toString().slice(-2);
    const dueDateStr = `${dueMonth}-${dueDay}-${dueYear}`;
    
    setEditClientDueDate(dueDateStr);
    addLog(`📅 Due date recalculated: ${dueDateStr}`, 'info');
  };
  
  // ==========================================================================
  // PAYMENT FUNCTIONS
  // ==========================================================================
  const handlePaid = (item: DueEntry) => {
    Alert.alert(
      "Mark as Paid",
      `Process payment for ${item.clientName || item.address}?`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Process Payment", onPress: () => processPayment(item) }
      ]
    );
  };

  const processPayment = async (item: DueEntry) => {
    try {
      addLog(`💰 Processing payment for ${item.address}...`, 'info');
      
      const today = new Date();
      const newDueDate = new Date(today);
      newDueDate.setDate(today.getDate() + 30);
      
      const newMonth = (newDueDate.getMonth() + 1).toString().padStart(2, '0');
      const newDay = newDueDate.getDate().toString().padStart(2, '0');
      const newYear = newDueDate.getFullYear().toString().slice(-2);
      const newDueDateStr = `${newMonth}-${newDay}-${newYear}`;
      
      let cleanComment = item.comment
        .replace(/due\s+\d{2}-\d{2}-\d{2}\s*/i, '')
        .replace(/\(prev:[^)]+\)/i, '')
        .replace(/\(grace:[^)]+\)/i, '')
        .replace(/\(grace-hist:[^)]+\)/i, '')
        .replace(/\(reason:[^)]+\)/i, '')
        .trim() || "Client";
      
      const MAX_HISTORY = 5;
      const oldDueDate = item.dueDate;
      let prevHistory = [];
      
      if (item.previousDueDates && item.previousDueDates.length > 0) {
        prevHistory = [oldDueDate, ...item.previousDueDates].slice(0, MAX_HISTORY);
      } else {
        prevHistory = [oldDueDate];
      }
      
      const historyStr = prevHistory.join(' → ');
      let newComment = `due ${newDueDateStr} ${cleanComment} (prev: ${historyStr})`;
      
      const installMatch = item.comment?.match(/\(installed:\s*([^)]+)\)/i);
      if (installMatch) {
        newComment += ` (installed: ${installMatch[1]})`;
      }
      
      const addressEntry = addressList.find(a => a.address === item.address);
      
      if (addressEntry) {
        await axios.post(`${apiUrl}/update-address-comment`, {
          id: addressEntry[".id"],
          comment: newComment
        });
        
        if (addressEntry.disabled) {
          await axios.post(`${apiUrl}/enable-ip`, { ip: item.address });
        }
        
        const clientInvoice = invoices.find(inv => 
          inv.clientIp === item.address && inv.status === 'pending'
        );
        
        if (clientInvoice) {
          const payment: Payment = {
            id: `PAY-${Date.now()}`,
            invoiceId: clientInvoice.id,
            clientId: clientInvoice.clientId,
            clientName: clientInvoice.clientName,
            amount: clientInvoice.amount,
            paymentDate: new Date().toISOString().split('T')[0],
            paymentMethod: 'cash',
            reference: `REF-${Date.now()}`
          };
          
          setPayments(prev => [payment, ...prev]);
          
          setInvoices(prev => prev.map(inv => 
            inv.id === clientInvoice.id 
              ? { ...inv, status: 'paid', paymentDate: payment.paymentDate } 
              : inv
          ));
          
          addNotification({
            clientId: clientInvoice.clientId,
            clientName: clientInvoice.clientName,
            type: 'payment',
            title: 'Payment Received',
            message: `Payment of ₱${clientInvoice.amount} received. Thank you!`
          });
        }
        
        addLog(`✅ Payment processed for ${item.address}`, 'success');
        Alert.alert("✅ Success", `New due date: ${newDueDateStr}`);
      }
      
      await refreshAllData();
      
    } catch (error: any) {
      addLog(`❌ Payment failed: ${error.message}`, 'error');
      Alert.alert("Error", "Failed to process payment");
    }
  };

  // ==========================================================================
  // CLIENT DATABASE FUNCTIONS
  // ==========================================================================
  const openEditClientModal = (client: any) => {
    console.log("📝 Opening edit modal for client:", client);
    console.log("📅 Original Install Date:", client.installDate);
    console.log("📅 Original Due Date:", client.dueDate);
    
    setEditingClient(client);
    setEditClientName(client.name || "");
    setEditClientPlan(client.plan || "");
    setEditClientAddress(client.address || "");
    setEditClientCpNumber(client.cpNumber || "");
    setEditClientInstallDate(client.installDate || "");
    setEditClientDueDate(client.dueDate || "");
    
    console.log("✅ Set editClientInstallDate to:", client.installDate);
    console.log("✅ Set editClientDueDate to:", client.dueDate);
    
    setEditClientModal(true);
  };

  const saveClientEdit = async () => {
    console.log("🔴🔴🔴 SAVE CLIENT EDIT FUNCTION CALLED 🔴🔴🔴");
    
    if (!editingClient) {
      console.log("❌ No editingClient found!");
      return;
    }

    console.log("✅ editingClient exists:", editingClient.id);
    console.log("📅 editClientInstallDate:", editClientInstallDate);
    console.log("📅 editClientDueDate:", editClientDueDate);

    // ===== AUTO-RECALCULATE DUE DATE IF MISSING =====
    if (!editClientDueDate && editClientInstallDate) {
      console.log("📅 No due date provided - auto-recalculating from install date");
      try {
        const [installMonth, installDay, installYear] = editClientInstallDate.split('-').map(Number);
        if (installMonth && installDay && installYear) {
          const installDate = new Date(2000 + installYear, installMonth - 1, installDay);
          const dueDate = new Date(installDate);
          dueDate.setDate(installDate.getDate() + 35);
          
          const dueMonth = (dueDate.getMonth() + 1).toString().padStart(2, '0');
          const dueDay = dueDate.getDate().toString().padStart(2, '0');
          const dueYear = dueDate.getFullYear().toString().slice(-2);
          setEditClientDueDate(`${dueMonth}-${dueDay}-${dueYear}`);
          console.log(`✅ Auto-calculated due date: ${dueMonth}-${dueDay}-${dueYear}`);
        }
      } catch (dateError) {
        console.log("❌ Failed to auto-calculate due date:", dateError);
      }
    }

    try {
      console.log("=".repeat(50));
      console.log("📝 SAVING CLIENT EDIT");
      console.log("Client ID:", editingClient.id);
      console.log("Client IP:", editingClient.ip);
      console.log("API URL:", apiUrl);
      console.log("📅 New Install Date:", editClientInstallDate);
      console.log("📅 New Due Date:", editClientDueDate);
      console.log("=".repeat(50));
      
      addLog(`📝 Updating client ${editingClient.name}...`, 'info');
      
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      let isExpired = false;
      let isPastInstall = false;
      
      if (editClientDueDate) {
        const [dueMonth, dueDay, dueYear] = editClientDueDate.split('-').map(Number);
        const dueDate = new Date(2000 + dueYear, dueMonth - 1, dueDay);
        dueDate.setHours(0, 0, 0, 0);
        isExpired = dueDate < today;
      }
      
      if (editClientInstallDate) {
        const [installMonth, installDay, installYear] = editClientInstallDate.split('-').map(Number);
        const installDate = new Date(2000 + installYear, installMonth - 1, installDay);
        installDate.setHours(0, 0, 0, 0);
        isPastInstall = installDate < today;
      }
      
      const updatedClient = {
        id: editingClient.id,
        ip: editingClient.ip,
        name: editClientName,
        plan: editClientPlan,
        address: editClientAddress,
        cpNumber: editClientCpNumber,
        installDate: editClientInstallDate,
        dueDate: editClientDueDate,
        registeredAt: editingClient.registeredAt,
        status: isExpired ? 'expired' : (isPastInstall ? 'late' : 'active')
      };

      console.log("📦 Updated Client Data:", updatedClient);

      try {
        const response = await axios.put(`${apiUrl}/api/clients/${editingClient.id}`, updatedClient);
        console.log("✅ Database save successful:", response.data);
        addLog(`✅ Client ${editClientName} saved to database`, 'success');
        
        setClientDatabase(prev => 
          prev.map(c => c.id === editingClient.id ? updatedClient : c)
        );
      } catch (dbError: any) {
        console.log("❌ Database save failed:", dbError.message);
        Alert.alert("Database Error", dbError.message);
        return;
      }

      const leaseEntry = leases.find(l => l.address === editingClient.ip);
      
      if (leaseEntry) {
        const newLeaseComment = `${editClientName} ${editClientPlan}`;
        console.log("📝 Updating DHCP lease comment:", newLeaseComment);
        
        try {
          await axios.post(`${apiUrl}/update-comment`, {
            id: leaseEntry[".id"],
            comment: newLeaseComment
          });
          addLog(`📝 Updated DHCP lease for ${editingClient.ip}`, 'info');
        } catch (leaseError: any) {
          console.log("❌ DHCP lease update failed:", leaseError.message);
        }
      }

      const addressEntry = addressList.find(a => a.address === editingClient.ip);
      
      if (addressEntry) {
        const newAddressComment = `${editClientName} ${editClientPlan} due ${editClientDueDate}`;
        console.log("📝 Updating address list comment:", newAddressComment);
        
        try {
          await axios.post(`${apiUrl}/update-address-comment`, {
            id: addressEntry[".id"],
            comment: newAddressComment
          });
          addLog(`📝 Updated address list for ${editingClient.ip}`, 'info');
        } catch (addressError: any) {
          console.log("❌ Address list update failed:", addressError.message);
        }
        
        if (isExpired) {
          addLog(`⚠️ Client ${editClientName} has expired due date - disabling internet...`, 'warning');
          
          try {
            await axios.post(`${apiUrl}/remove-ip`, { ip: editingClient.ip });
            addLog(`🔴 Internet disabled for ${editClientName} (expired)`, 'error');
          } catch (disableError: any) {
            console.log("❌ Failed to disable IP:", disableError.message);
          }
        } else if (addressEntry.disabled) {
          addLog(`🟢 Client ${editClientName} is now paid - enabling internet...`, 'info');
          
          try {
            await axios.post(`${apiUrl}/enable-ip`, { ip: editingClient.ip });
            addLog(`✅ Internet enabled for ${editClientName}`, 'success');
          } catch (enableError: any) {
            console.log("❌ Failed to enable IP:", enableError.message);
          }
        }
      }

      if (editingClient.plan !== editClientPlan) {
        addLog(`🔄 Plan changed from ${editingClient.plan} to ${editClientPlan} - updating queue...`, 'info');
        
        await updateClientQueue({
          ip: editingClient.ip,
          name: editClientName,
          plan: editClientPlan
        });
      }

      setEditClientModal(false);
      await refreshAllData();
      
      addLog(`✅ Client ${editClientName} updated successfully`, 'success');
      
      if (isExpired) {
        Alert.alert(
          "⚠️ Client Updated (Disabled)",
          `Client: ${editClientName}\nIP: ${editingClient.ip}\nNew Due Date: ${editClientDueDate}\n\nInternet is DISABLED.`
        );
      } else {
        Alert.alert("✅ Success", `Client ${editClientName} updated successfully`);
      }

    } catch (error: any) {
      console.log("❌ Unexpected error:", error);
      addLog(`❌ Failed to update client: ${error.message}`, 'error');
      Alert.alert("Error", "Failed to update client");
    }
  };

  const confirmDeleteClient = (client: any) => {
    Alert.alert(
      "Confirm Delete",
      `Are you sure you want to delete ${client.name} from database?`,
      [
        { text: "Cancel", style: "cancel" },
        { 
          text: "Delete", 
          style: "destructive",
          onPress: () => deleteClient(client)
        }
      ]
    );
  };

  const deleteClient = async (client: any) => {
    try {
      setClientDatabase(prev => prev.filter(c => c.id !== client.id));
      await refreshAllData();
      addLog(`🗑️ Client ${client.name} deleted from database`, 'info');
      Alert.alert("Success", "Client removed from database");
    } catch (error: any) {
      addLog(`❌ Failed to delete client: ${error.message}`, 'error');
      Alert.alert("Error", "Failed to delete client");
    }
  };

  // ==========================================================================
  // CLIENT REGISTRATION FUNCTION
  // ==========================================================================
  const processConvertWithClientDetails = async () => {
    if (!convertingLease) return;
    
    const { id, address } = convertingLease;
    
    if (!convertComment.trim()) {
      Alert.alert("Error", "Client name is required");
      return;
    }
    
    if (!convertMonth || !convertDay || !convertYear) {
      Alert.alert("Error", "Please enter complete install date (MM-DD-YY)");
      return;
    }
    
    const month = parseInt(convertMonth);
    const day = parseInt(convertDay);
    const year = parseInt(convertYear);
    
    if (month < 1 || month > 12 || day < 1 || day > 31 || year < 0 || year > 99) {
      Alert.alert("Error", "Please enter valid date values");
      return;
    }
    
    try {
      addLog(`📝 Registering new client ${convertComment}...`, 'info');
      
      const installDateStr = `${convertMonth.padStart(2, '0')}-${convertDay.padStart(2, '0')}-${convertYear.padStart(2, '0')}`;
      
      const today = new Date();
      const installDate = new Date(2000 + year, month - 1, day);
      
      today.setHours(0, 0, 0, 0);
      installDate.setHours(0, 0, 0, 0);
      
      const isPastDate = installDate < today;
      
      if (isPastDate) {
        addLog(`⚠️ Install date ${installDateStr} is in the past - client will be DISABLED`, 'warning');
      }
      
      const dueDate = new Date(installDate);
      dueDate.setDate(installDate.getDate() + 35);
      
      const dueMonth = (dueDate.getMonth() + 1).toString().padStart(2, '0');
      const dueDay = dueDate.getDate().toString().padStart(2, '0');
      const dueYear = dueDate.getFullYear().toString().slice(-2);
      const dueDateStr = `${dueMonth}-${dueDay}-${dueYear}`;
      
      const dueDateTime = new Date(2000 + parseInt(dueYear), parseInt(dueMonth) - 1, parseInt(dueDay));
      dueDateTime.setHours(0, 0, 0, 0);
      const isExpired = dueDateTime < today;
      
      let planText = convertPlan.trim() || "PLAN1999";
      let clientNameText = convertComment.trim();
      
      let addressComment = `${clientNameText} ${planText} due ${dueDateStr}`;
      if (isPastDate) {
        addressComment += ` (late-reg: ${installDateStr})`;
      }
      
      const clientData = {
        id: Date.now().toString(),
        ip: address,
        name: clientNameText,
        plan: planText,
        address: convertAddress.trim(),
        cpNumber: convertCpNumber.trim(),
        installDate: installDateStr,
        dueDate: dueDateStr,
        registeredAt: new Date().toISOString(),
        status: isExpired ? 'expired' : (isPastDate ? 'late' : 'active')
      };
      
      console.log("📝 Saving client to database:", clientData);
      
      try {
        await axios.post(`${apiUrl}/api/clients`, clientData);
        setClientDatabase(prev => [clientData, ...prev]);
        addLog(`✅ Client ${convertComment} saved to database`, 'success');
      } catch (dbError: any) {
        console.log("❌ Database save failed:", dbError.response?.data || dbError.message);
      }
      
      await axios.post(`${apiUrl}/convert-and-allow`, {
        id,
        ip: address,
        comment: addressComment
      });
      
      addLog(`✅ Client ${convertComment} added to address list`, 'success');
      
      if (isExpired || isPastDate) {
        addLog(`⚠️ Client ${convertComment} has past due date - disabling internet...`, 'warning');
        
        try {
          await axios.post(`${apiUrl}/remove-ip`, { ip: address });
          addLog(`🔴 Internet disabled for ${convertComment} (past due date)`, 'error');
        } catch (disableError: any) {
          console.log("❌ Failed to disable IP:", disableError.message);
        }
      } else {
        await createClientQueue({
          ip: address,
          name: clientNameText,
          plan: planText
        });
      }
      
      setShowConvertModal(false);
      setConvertingLease(null);
      setConvertComment("");
      setConvertAddress("");
      setConvertCpNumber("");
      setConvertPlan("");
      setConvertMonth("");
      setConvertDay("");
      setConvertYear("");
      
      await refreshAllData();
      
      if (isExpired || isPastDate) {
        Alert.alert(
          "⚠️ Client Registered (Disabled)",
          `Client: ${planText} ${clientNameText}\nIP: ${address}\nDue Date: ${dueDateStr}\n\nInternet is DISABLED because due date is in the past.`
        );
      } else {
        Alert.alert(
          "✅ Registration Complete",
          `Client: ${planText} ${clientNameText}\nIP: ${address}\nDue Date: ${dueDateStr}`
        );
      }
      
    } catch (error: any) {
      console.log("❌ Registration failed:", error.response?.data || error.message);
      addLog(`❌ Registration failed: ${error.message}`, 'error');
      Alert.alert("Error", "Failed to register client");
    }
  };

  // ==========================================================================
  // IPOE FUNCTIONS
  // ==========================================================================
  const makeStatic = (id: string, address: string, currentComment: string) => {
    setConvertingLease({ id, address, currentComment });
    setConvertComment("");
    setConvertPlan("");
    setShowConvertModal(true);
  };

  const toggleInternet = async (item: AddressListItem) => {
    try {
      if (item.disabled) {
        await axios.post(`${apiUrl}/enable-ip`, { ip: item.address });
        addLog(`✅ Enabled internet for ${item.address}`, 'success');
        
        const client = clientDatabase.find(c => c.ip === item.address);
        if (client) {
          addNotification({
            clientId: item.address,
            clientName: client.name,
            type: 'payment',
            title: 'Internet Reconnected',
            message: `${client.name}'s internet has been reconnected.`
          });
        }
      } else {
        await axios.post(`${apiUrl}/remove-ip`, { ip: item.address });
        addLog(`⛔ Disabled internet for ${item.address}`, 'error');
      }
      fetchAddressList();
      fetchDueEntries();
    } catch (e: any) {
      Alert.alert("Error", "Failed to toggle internet");
    }
  };

  const updateAddressComment = async () => {
    if (!selectedAddress) return;
    try {
      await axios.post(`${apiUrl}/update-address-comment`, {
        id: selectedAddress[".id"],
        comment: comment
      });
      
      setAddressModal(false);
      Alert.alert("Success", "Address comment updated");
      addLog(`📝 Updated comment for ${selectedAddress.address}`, 'info');
      fetchAddressList();
      fetchDueEntries();
    } catch (e: any) {
      Alert.alert("Error", "Failed to update comment: " + e.message);
    }
  };

  const addIP = async () => {
    if (!newIP.trim()) {
      Alert.alert("Error", "IP Address is required");
      return;
    }
    
    const ipRegex = /^(\d{1,3}\.){3}\d{1,3}$/;
    if (!ipRegex.test(newIP.trim())) {
      Alert.alert("Error", "Please enter a valid IP address");
      return;
    }
    
    try {
      await axios.post(`${apiUrl}/allow-ip`, {
        ip: newIP.trim(),
        comment: newComment.trim()
      });
      
      setAddModal(false);
      setNewIP("");
      setNewComment("");
      
      Alert.alert("✅ Success", "IP added to address list");
      addLog(`📝 Added IP: ${newIP}`, 'info');
      
      fetchAddressList();
      fetchDueEntries();
      
    } catch (e: any) {
      Alert.alert("Error", "Failed to add IP");
    }
  };

  // ==========================================================================
  // SCAN ALL FOR DUE DATES
  // ==========================================================================
  const scanAllForDueDates = async () => {
    addLog('🔍 Scanning all address list entries for due dates...', 'info');
    
    try {
      await fetchAddressList();
      
      const withDueDates = addressList.filter(entry => 
        entry.comment?.toLowerCase().includes('due')
      );
      
      const withoutDueDates = addressList.filter(entry => 
        !entry.comment?.toLowerCase().includes('due')
      );
      
      addLog(`✅ Found ${withDueDates.length} entries with due dates`, 'success');
      
      if (withoutDueDates.length > 0) {
        Alert.alert(
          "📋 Missing Due Dates",
          `${withoutDueDates.length} entries have no due date. Would you like to set them now?`,
          [
            { text: "Later", style: "cancel" },
            { 
              text: "Set All", 
              onPress: () => {
                setSelectedForInstall(withoutDueDates[0]);
                setInstallDate(new Date());
                setInitialDueDays("30");
                setInstallModalVisible(true);
              }
            }
          ]
        );
      }
      
      return { withDueDates, withoutDueDates };
    } catch (error: any) {
      addLog(`❌ Scan failed: ${error.message}`, 'error');
    }
  };

  // ==========================================================================
  // VIEW HISTORY FUNCTION
  // ==========================================================================
  const showPaymentHistory = (item: AddressListItem | DueEntry) => {
    const isAddressItem = 'clientName' in item;
    const clientName = isAddressItem ? item.clientName : (item as DueEntry).clientName;
    const address = item.address;
    const dueDate = item.dueDate;
    const previousDates = item.previousDueDates || [];
    
    const installMatch = item.comment?.match(/\(installed:\s*([^)]+)\)/i);
    const installDate = installMatch ? installMatch[1] : null;
    
    const graceMatch = item.comment?.match(/\(grace:\s*([^)]+)\)/i);
    const gracePeriod = graceMatch ? graceMatch[1] : null;
    
    const clientInvoices = invoices.filter(inv => inv.clientIp === address);
    const clientPayments = payments.filter(p => p.clientId === address);
    
    let historyMessage = `📜 Complete History\n\n`;
    historyMessage += `IP: ${address}\n`;
    if (clientName) historyMessage += `Client: ${clientName}\n`;
    if (installDate) historyMessage += `📅 Installed: ${installDate}\n`;
    historyMessage += `Current Due: ${dueDate || 'No due date'}\n`;
    if (gracePeriod) historyMessage += `⏳ Grace Period: ${gracePeriod}\n\n`;
    
    if (clientInvoices.length > 0) {
      historyMessage += `📋 Invoices:\n`;
      clientInvoices.slice(0, 5).forEach(inv => {
        historyMessage += `  • ${inv.issueDate}: ₱${inv.amount} - ${inv.status}\n`;
      });
    }
    
    if (clientPayments.length > 0) {
      historyMessage += `\n💰 Payments:\n`;
      clientPayments.slice(0, 5).forEach(pay => {
        historyMessage += `  • ${pay.paymentDate}: ₱${pay.amount} (${pay.paymentMethod})\n`;
      });
    }
    
    if (previousDates.length > 0) {
      historyMessage += `\nPrevious Due Dates:\n`;
      previousDates.forEach((date, index) => {
        historyMessage += `  ${index + 1}. ${date}\n`;
      });
    }
    
    Alert.alert("📜 Complete History", historyMessage);
  };

  // ==========================================================================
  // AUTO-DISABLE FUNCTIONS
  // ==========================================================================
  const runDisableScript = async () => {
  setScriptRunning(true);
  addLog('🚀 Running manual auto-disable...', 'info');
  
  try {
    const response = await axios.post(`${apiUrl}/run-disable-script`);
    
    if (response.data.success) {
      if (response.data.disabled > 0) {
        addLog(`✅ Disabled ${response.data.disabled} expired client(s)`, 'success');
        Alert.alert('✅ Success', `${response.data.disabled} client(s) disabled`);
      } else {
        addLog('ℹ️ No expired clients found', 'info');
      }
      
      // Refresh data
      await fetchAddressList();
      await fetchDueEntries();
    }
  } catch (error: any) {
    addLog(`❌ Failed: ${error.message}`, 'error');
  } finally {
    setScriptRunning(false);
  }
};
  const setupScheduler = async () => {
    if (!schedulerTime.match(/^\d{2}:\d{2}$/)) {
      Alert.alert("Error", "Please enter time in HH:MM format");
      return;
    }
    
    try {
      const response = await axios.post(`${apiUrl}/setup-scheduler`, {
        interval: schedulerInterval,
        time: schedulerTime + ":00",
        enabled: autoDisableEnabled
      });
      
      if (response.data.success) {
        Alert.alert("✅ Success", "Scheduler configured successfully");
        addLog(`⏰ Scheduler ${autoDisableEnabled ? 'enabled' : 'disabled'}`, 'success');
        fetchScriptStatus();
      }
    } catch (error: any) {
      Alert.alert("Error", error.message);
    }
  };

  const toggleAutoDisable = async (value: boolean) => {
  setAutoDisableEnabled(value);
  
  try {
    await axios.post(`${apiUrl}/toggle-auto-disable`, { enabled: value });
    addLog(`${value ? '▶️' : '⏸️'} Auto-disable ${value ? 'enabled' : 'disabled'}`, 'info');
    
    if (value) {
      // Run immediately on enable
      setTimeout(() => {
        runDisableScript();
      }, 5000); // Run after 5 seconds
    }
  } catch (error: any) {
    Alert.alert('Error', 'Failed to toggle auto-disable');
  }
};

  const clearLogs = async () => {
    try {
      await axios.post(`${apiUrl}/clear-auto-disable-logs`);
      setScriptLogs([]);
      addLog('🧹 Logs cleared', 'info');
    } catch (error) {
      Alert.alert('Error', 'Failed to clear logs');
    }
  };










  // ==========================================================================
  // PPPOE FUNCTIONS
  // ==========================================================================
  const togglePppUser = async (item: PppoeUser) => {
    try {
      await axios.patch(`${apiUrl}/ppp/secret/${item[".id"]}/toggle`, {
        disabled: !item.disabled
      });
      
      Alert.alert("Success", `User ${item.disabled ? 'enabled' : 'disabled'}`);
      fetchPppUsers();
    } catch (error) {
      Alert.alert("Error", "Failed to toggle user");
    }
  };

  const addPppUser = async () => {
    if (!newPppName || !newPppPassword || !newPppProfile) {
      Alert.alert("Error", "Please fill all required fields and select a profile");
      return;
    }
    
    try {
      await axios.post(`${apiUrl}/ppp/secret/add`, {
        name: newPppName,
        password: newPppPassword,
        profile: newPppProfile,
        comment: newPppComment
      });
      
      setPppAddModal(false);
      setNewPppName("");
      setNewPppPassword("");
      setNewPppProfile(pppProfiles[0]?.name || "default");
      setNewPppComment("");
      
      Alert.alert("Success", "PPPoE user added");
      fetchPppUsers();
    } catch (error) {
      Alert.alert("Error", "Failed to add user");
    }
  };

  const disconnectPppSession = async (id: string) => {
    Alert.alert(
      "Confirm Disconnect",
      "Disconnect this PPPoE session?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Disconnect",
          onPress: async () => {
            try {
              await axios.delete(`${apiUrl}/ppp/active/${id}`);
              Alert.alert("Success", "Session disconnected");
              fetchPppActive();
            } catch (error) {
              Alert.alert("Error", "Failed to disconnect");
            }
          }
        }
      ]
    );
  };

  const openEditModal = (user: PppoeUser) => {
    setEditingUser(user);
    setEditName(user.name);
    setEditPassword(user.password || '');
    setEditProfile(user.profile);
    setEditComment(user.comment || '');
    setEditDisabled(user.disabled);
    setShowEditModal(true);
  };

  const updatePppUser = async () => {
    if (!editingUser) return;
    if (!editName.trim()) {
      Alert.alert("Error", "Username is required");
      return;
    }

    try {
      await axios.put(`${apiUrl}/ppp/secret/${editingUser[".id"]}`, {
        name: editName,
        password: editPassword,
        profile: editProfile,
        comment: editComment,
        disabled: editDisabled
      });

      setShowEditModal(false);
      Alert.alert("Success", "User updated successfully");
      fetchPppUsers();
    } catch (error) {
      Alert.alert("Error", "Failed to update user");
    }
  };

  const deletePppUser = (user: PppoeUser) => {
    Alert.alert(
      "Confirm Delete",
      `Are you sure you want to delete user "${user.name}"?\n\nThis action cannot be undone.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            try {
              await axios.delete(`${apiUrl}/ppp/secret/${user[".id"]}`);
              Alert.alert("Success", "User deleted successfully");
              fetchPppUsers();
            } catch (error) {
              Alert.alert("Error", "Failed to delete user");
            }
          }
        }
      ]
    );
  };

  // ==========================================================================
  // LOADING SCREEN
  // ==========================================================================
  if (connecting) {
    return (
      <LinearGradient colors={['#0b1120', '#1a2639']} style={styles.container}>
        <View style={styles.centerContent}>
          <ActivityIndicator size="large" color="#38bdf8" />
          <Text style={styles.loadingText}>Connecting to backend...</Text>
          <Text style={styles.apiText}>Trying: {LOCAL_IP} and {ZEROTIER_IP}</Text>
          {error ? (
            <View style={{ marginTop: 20, paddingHorizontal: 20 }}>
              <Text style={[styles.errorText, { textAlign: 'center' }]}>{error}</Text>
              <TouchableOpacity onPress={findWorkingAPI} style={[styles.retryBtn, { marginTop: 10 }]}>
                <Text style={styles.btnText}>Retry Connection</Text>
              </TouchableOpacity>
            </View>
          ) : null}
        </View>
      </LinearGradient>
    );
  }

  // ==========================================================================
  // MAIN MENU
  // ==========================================================================
  if (page === "main") {
    return (
      <LinearGradient colors={['#0b1120', '#1a2639']} style={styles.container}>
        <StatusBar barStyle="light-content" />
        <SafeAreaView style={styles.safeArea}>
          <ScrollView 
            contentContainerStyle={styles.scrollContent} 
            showsVerticalScrollIndicator={false}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={() => refreshAllData()} />
            }
          >
            <View style={styles.mainContent}>
              <Text style={styles.header}>
                <Feather name="wifi" size={28} color="#38bdf8" /> MikroTik Admin
              </Text>

              <View style={styles.connectionContainer}>
                <View style={styles.apiIndicator}>
                  <Text style={styles.apiText}>API: {apiUrl}</Text>
                </View>
                <View style={styles.statusRow}>
                  <View style={[styles.statusDot, { 
                    backgroundColor: connectionStatus === 'connected' ? '#22c55e' : '#dc2626' 
                  }]} />
                  <Text style={styles.statusText}>
                    {connectionStatus === 'connected' ? 'Connected' : 'Disconnected'}
                  </Text>
                  {connectionStatus === 'disconnected' && (
                    <TouchableOpacity onPress={findWorkingAPI} style={styles.retrySmallBtn}>
                      <Feather name="refresh-cw" size={12} color="#38bdf8" />
                      <Text style={styles.retrySmallText}>Retry</Text>
                    </TouchableOpacity>
                  )}
                </View>
              </View>

              <Text style={styles.sectionTitle}>Select System</Text>

              <TouchableOpacity 
                activeOpacity={0.8} 
                onPress={() => setPage("ipoe")}
                disabled={connectionStatus !== 'connected'}
                style={{ marginBottom: 16 }}
              >
                <LinearGradient 
                  colors={connectionStatus === 'connected' ? ['#3b82f6', '#2563eb'] : ['#4b5563', '#374151']} 
                  style={styles.mainMenuButton}
                >
                  <View style={styles.menuIconContainer}>
                    <Feather name="wifi" size={32} color="#fff" />
                  </View>
                  <View style={styles.mainMenuTextContainer}>
                    <Text style={styles.mainMenuTitle}>IPOE / DHCP</Text>
                    <Text style={styles.mainMenuSub}>
                      Manage IPOE clients, DHCP leases, address lists
                    </Text>
                  </View>
                  <MaterialIcons name="arrow-forward-ios" size={20} color="#fff" />
                </LinearGradient>
              </TouchableOpacity>

              <TouchableOpacity 
                activeOpacity={0.8} 
                onPress={() => setPage("pppoe")}
                disabled={connectionStatus !== 'connected'}
              >
                <LinearGradient 
                  colors={connectionStatus === 'connected' ? ['#f97316', '#ea580c'] : ['#4b5563', '#374151']} 
                  style={styles.mainMenuButton}
                >
                  <View style={styles.menuIconContainer}>
                    <Feather name="users" size={32} color="#fff" />
                  </View>
                  <View style={styles.mainMenuTextContainer}>
                    <Text style={styles.mainMenuTitle}>PPPoE</Text>
                    <Text style={styles.mainMenuSub}>
                      Manage PPPoE users, active connections, bandwidth
                    </Text>
                  </View>
                  <MaterialIcons name="arrow-forward-ios" size={20} color="#fff" />
                </LinearGradient>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </SafeAreaView>
      </LinearGradient>
    );
  }

  // ==========================================================================
  // IPOE HOME PAGE (BILLING DASHBOARD)
  // ==========================================================================
  if (page === "ipoe" && ipoePage === "home") {
    console.log("=".repeat(50));
    console.log("📊 DASHBOARD DATA CHECK");
    console.log("clientDatabase length:", clientDatabase.length);
    console.log("dueEntries length:", dueEntries.length);
    console.log("invoices length:", invoices.length);
    console.log("simpleQueues length:", simpleQueues.length);
    console.log("notifications length:", notifications.length);
    console.log("=".repeat(50));
      
    const totalClients = clientDatabase.length;
    const activeClients = clientDatabase.filter(c => c.status === 'active').length;
    const overdueCount = dueEntries.filter(e => e.expired && !e.disabled).length;
    const unreadNotifications = notifications.filter(n => !n.isRead).length;
    
    const monthlyRevenue = invoices
      .filter(inv => inv.status === 'paid')
      .reduce((sum, inv) => sum + inv.amount, 0);
    
    const pendingRevenue = invoices
      .filter(inv => inv.status === 'pending')
      .reduce((sum, inv) => sum + inv.amount, 0);

    return (
      <LinearGradient colors={['#0b1120', '#1a2639']} style={styles.container}>
        <StatusBar barStyle="light-content" />
        <SafeAreaView style={styles.safeArea}>
          <ScrollView 
            contentContainerStyle={styles.scrollContent} 
            showsVerticalScrollIndicator={false}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={() => refreshAllData()} />
            }
          >
            <View style={styles.mainContent}>
              <View style={styles.headerWithBack}>
                <TouchableOpacity onPress={() => setPage("main")} style={styles.backButtonSmall}>
                  <MaterialIcons name="arrow-back" size={20} color="#38bdf8" />
                </TouchableOpacity>
                <Text style={styles.headerSmall}>
                  <Feather name="bar-chart-2" size={22} color="#38bdf8" /> Billing Dashboard
                </Text>
                <TouchableOpacity onPress={() => setIpoePage("notifications")} style={[styles.backButtonSmall, { position: 'relative' }]}>
                  <Feather name="bell" size={20} color="#38bdf8" />
                  {unreadNotifications > 0 && (
                    <View style={{ position: 'absolute', top: 0, right: 0, backgroundColor: '#ef4444', borderRadius: 10, width: 16, height: 16, justifyContent: 'center', alignItems: 'center' }}>
                      <Text style={{ color: '#fff', fontSize: 10 }}>{unreadNotifications}</Text>
                    </View>
                  )}
                </TouchableOpacity>
              </View>

              <View style={styles.connectionContainer}>
                <View style={styles.apiIndicator}>
                  <Text style={styles.apiText}>API: {apiUrl}</Text>
                </View>
                <View style={styles.statusRow}>
                  <View style={[styles.statusDot, { backgroundColor: '#22c55e' }]} />
                  <Text style={styles.statusText}>Billing Mode</Text>
                </View>
              </View>

              <View style={styles.statsRow}>
                <LinearGradient colors={['#1e293b', '#0f172a']} style={styles.statCard}>
                  <Text style={[styles.statNumber, { color: '#10b981' }]}>₱{monthlyRevenue.toLocaleString()}</Text>
                  <Text style={styles.statLabel}>Collected</Text>
                </LinearGradient>

                <LinearGradient colors={['#1e293b', '#0f172a']} style={styles.statCard}>
                  <Text style={[styles.statNumber, { color: '#f59e0b' }]}>₱{pendingRevenue.toLocaleString()}</Text>
                  <Text style={styles.statLabel}>Pending</Text>
                </LinearGradient>

                <LinearGradient colors={['#1e293b', '#0f172a']} style={styles.statCard}>
                  <Text style={[styles.statNumber, { color: '#ef4444' }]}>{overdueCount}</Text>
                  <Text style={styles.statLabel}>Overdue</Text>
                </LinearGradient>
              </View>

              <View style={styles.statsRow}>
                <LinearGradient colors={['#1e293b', '#0f172a']} style={styles.statCard}>
                  <Text style={styles.statNumber}>{totalClients}</Text>
                  <Text style={styles.statLabel}>Total Clients</Text>
                </LinearGradient>

                <LinearGradient colors={['#1e293b', '#0f172a']} style={styles.statCard}>
                  <Text style={styles.statNumber}>{activeClients}</Text>
                  <Text style={styles.statLabel}>Active</Text>
                </LinearGradient>

                <LinearGradient colors={['#1e293b', '#0f172a']} style={styles.statCard}>
                  <Text style={styles.statNumber}>{simpleQueues.length}</Text>
                  <Text style={styles.statLabel}>Queues</Text>
                </LinearGradient>
              </View>

              <LinearGradient colors={['#1e293b', '#0f172a']} style={styles.card}>
                <Text style={styles.cardTitle}>📊 Collection Efficiency</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 8 }}>
                  <View style={{ flex: 1, height: 8, backgroundColor: '#334155', borderRadius: 4 }}>
                    <View style={{ 
                      width: `${activeClients ? ((activeClients - overdueCount) / activeClients * 100) : 0}%`, 
                      height: 8, 
                      backgroundColor: '#10b981', 
                      borderRadius: 4 
                    }} />
                  </View>
                  <Text style={{ color: '#fff', marginLeft: 8, fontWeight: 'bold' }}>
                    {activeClients ? ((activeClients - overdueCount) / activeClients * 100).toFixed(1) : 0}%
                  </Text>
                </View>
              </LinearGradient>

              <TouchableOpacity 
                activeOpacity={0.8} 
                onPress={() => setIpoePage("billing")}
              >
                <LinearGradient colors={['#10b981', '#059669']} style={styles.menuButton}>
                  <Feather name="dollar-sign" size={20} color="#fff" />
                  <View style={styles.menuTextContainer}>
                    <Text style={styles.menuTitle}>Billing Overview</Text>
                    <Text style={styles.menuSub}>Invoices, payments, reports</Text>
                  </View>
                  <MaterialIcons name="arrow-forward-ios" size={14} color="#fff" />
                </LinearGradient>
              </TouchableOpacity>

              <TouchableOpacity 
                activeOpacity={0.8} 
                onPress={() => setIpoePage("clients")}
              >
                <LinearGradient colors={['#8b5cf6', '#7c3aed']} style={styles.menuButton}>
                  <Feather name="database" size={20} color="#fff" />
                  <View style={styles.menuTextContainer}>
                    <Text style={styles.menuTitle}>Client Database</Text>
                    <Text style={styles.menuSub}>Manage client information</Text>
                  </View>
                  <MaterialIcons name="arrow-forward-ios" size={14} color="#fff" />
                </LinearGradient>
              </TouchableOpacity>

              <TouchableOpacity 
                activeOpacity={0.8} 
                onPress={() => {
                  setIpoePage("queues");
                  fetchSimpleQueues();
                }}
              >
                <LinearGradient colors={['#f59e0b', '#d97706']} style={styles.menuButton}>
                  <Feather name="activity" size={20} color="#fff" />
                  <View style={styles.menuTextContainer}>
                    <Text style={styles.menuTitle}>Bandwidth Queues</Text>
                    <Text style={styles.menuSub}>Speed limits per client</Text>
                  </View>
                  <MaterialIcons name="arrow-forward-ios" size={14} color="#fff" />
                </LinearGradient>
              </TouchableOpacity>

              <TouchableOpacity 
                activeOpacity={0.8} 
                onPress={() => setIpoePage("plans")}
              >
                <LinearGradient colors={['#3b82f6', '#2563eb']} style={styles.menuButton}>
                  <Feather name="package" size={20} color="#fff" />
                  <View style={styles.menuTextContainer}>
                    <Text style={styles.menuTitle}>Plans & Pricing</Text>
                    <Text style={styles.menuSub}>Manage service plans</Text>
                  </View>
                  <MaterialIcons name="arrow-forward-ios" size={14} color="#fff" />
                </LinearGradient>
              </TouchableOpacity>

              <TouchableOpacity 
                activeOpacity={0.8} 
                onPress={() => setIpoePage("invoices")}
              >
                <LinearGradient colors={['#ef4444', '#dc2626']} style={styles.menuButton}>
                  <Feather name="file-text" size={20} color="#fff" />
                  <View style={styles.menuTextContainer}>
                    <Text style={styles.menuTitle}>Invoices</Text>
                    <Text style={styles.menuSub}>View all invoices</Text>
                  </View>
                  <MaterialIcons name="arrow-forward-ios" size={14} color="#fff" />
                </LinearGradient>
              </TouchableOpacity>

              <TouchableOpacity 
                activeOpacity={0.8} 
                onPress={() => setIpoePage("reports")}
              >
                <LinearGradient colors={['#14b8a6', '#0d9488']} style={styles.menuButton}>
                  <Feather name="pie-chart" size={20} color="#fff" />
                  <View style={styles.menuTextContainer}>
                    <Text style={styles.menuTitle}>Reports</Text>
                    <Text style={styles.menuSub}>Revenue, collection, usage</Text>
                  </View>
                  <MaterialIcons name="arrow-forward-ios" size={14} color="#fff" />
                </LinearGradient>
              </TouchableOpacity>

              <TouchableOpacity 
                activeOpacity={0.8} 
                onPress={() => {
                  setIpoePage("leases");
                }}
              >
                <LinearGradient colors={['#16a34a', '#15803d']} style={styles.menuButton}>
                  <Feather name="server" size={20} color="#fff" />
                  <View style={styles.menuTextContainer}>
                    <Text style={styles.menuTitle}>DHCP Leases</Text>
                    <Text style={styles.menuSub}>View client leases</Text>
                  </View>
                  <MaterialIcons name="arrow-forward-ios" size={14} color="#fff" />
                </LinearGradient>
              </TouchableOpacity>

              <TouchableOpacity 
                activeOpacity={0.8} 
                onPress={() => {
                  setIpoePage("auto-disable");
                  fetchDueEntries();
                  fetchLogs();
                  fetchScriptStatus();
                }}
              >
                <LinearGradient colors={['#8b5cf6', '#7c3aed']} style={styles.menuButton}>
                  <Feather name="clock" size={20} color="#fff" />
                  <View style={styles.menuTextContainer}>
                    <Text style={styles.menuTitle}>Auto-Disable</Text>
                    <Text style={styles.menuSub}>Due date management</Text>
                  </View>
                  {expiredCount > 0 && (
                    <View style={styles.badge}>
                      <Text style={styles.badgeText}>{expiredCount}</Text>
                    </View>
                  )}
                  <MaterialIcons name="arrow-forward-ios" size={14} color="#fff" />
                </LinearGradient>
              </TouchableOpacity>

              <TouchableOpacity 
                activeOpacity={0.8} 
                onPress={() => setIpoePage("address")}
              >
                <LinearGradient colors={['#dc2626', '#b91c1c']} style={styles.menuButton}>
                  <Feather name="shield" size={20} color="#fff" />
                  <View style={styles.menuTextContainer}>
                    <Text style={styles.menuTitle}>Address List</Text>
                    <Text style={styles.menuSub}>Internet access control</Text>
                  </View>
                  <MaterialIcons name="arrow-forward-ios" size={14} color="#fff" />
                </LinearGradient>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </SafeAreaView>
      </LinearGradient>
    );
  }

  // ==========================================================================
  // DHCP LEASES PAGE
  // ==========================================================================
  if (page === "ipoe" && ipoePage === "leases") {
    const totalLeases = leases.length;
    const staticLeases = leases.filter(l => !l.dynamic).length;
    const dynamicLeases = leases.filter(l => l.dynamic).length;

    const filteredLeases = leases.filter(l =>
      l.address?.includes(leaseSearch) ||
      l["mac-address"]?.includes(leaseSearch) ||
      l.comment?.toLowerCase().includes(leaseSearch.toLowerCase())
    );

    return (
      <LinearGradient colors={['#0b1120', '#1a2639']} style={styles.container}>
        <StatusBar barStyle="light-content" />
        <SafeAreaView style={styles.safeArea}>
          <View style={styles.pageHeader}>
            <TouchableOpacity onPress={() => setIpoePage("home")} style={styles.backButton}>
              <MaterialIcons name="arrow-back" size={20} color="#38bdf8" />
            </TouchableOpacity>
            <Text style={styles.pageTitle}>DHCP Leases</Text>
            <TouchableOpacity onPress={() => fetchLeases()} style={styles.refreshButton}>
              <Feather name="refresh-cw" size={18} color="#38bdf8" />
            </TouchableOpacity>
          </View>

          <View style={styles.smallStatusBar}>
            <View style={[styles.smallStatusDot, { backgroundColor: '#22c55e' }]} />
            <Text style={styles.smallStatusText}>{apiUrl}</Text>
          </View>

          <LinearGradient colors={['#1e3a5f', '#0f2b4f']} style={styles.statsCardInline}>
            <View style={styles.statsRowInline}>
              <View style={styles.statItemInline}>
                <Text style={styles.statNumberInline}>{totalLeases}</Text>
                <Text style={styles.statLabelInline}>Total</Text>
              </View>
              <View style={styles.statDivider} />
              <View style={styles.statItemInline}>
                <Text style={styles.statNumberInline}>{staticLeases}</Text>
                <Text style={styles.statLabelInline}>Static</Text>
              </View>
              <View style={styles.statDivider} />
              <View style={styles.statItemInline}>
                <Text style={styles.statNumberInline}>{dynamicLeases}</Text>
                <Text style={styles.statLabelInline}>Dynamic</Text>
              </View>
            </View>
          </LinearGradient>

          <View style={styles.searchContainer}>
            <Feather name="search" size={16} color="#64748b" style={styles.searchIcon} />
            <TextInput
              placeholder="Search IP, MAC, or comment..."
              placeholderTextColor="#64748b"
              style={styles.searchInput}
              value={leaseSearch}
              onChangeText={setLeaseSearch}
            />
          </View>

          {loading ? (
            <View style={styles.centerContent}>
              <ActivityIndicator size="large" color="#38bdf8" />
              <Text style={styles.loadingText}>Loading leases...</Text>
            </View>
          ) : (
            <FlatList
              data={filteredLeases}
              keyExtractor={(item) => item[".id"]}
              showsVerticalScrollIndicator={false}
              refreshControl={
                <RefreshControl 
                  refreshing={refreshing} 
                  onRefresh={() => fetchLeases()} 
                />
              }
              ListFooterComponent={<View style={{ height: 80 }} />}
              ListEmptyComponent={
                <View style={styles.emptyContainer}>
                  <Feather name="inbox" size={40} color="#4b5563" />
                  <Text style={styles.emptyText}>No leases found</Text>
                  <TouchableOpacity 
                    style={{ marginTop: 16 }}
                    onPress={() => fetchLeases()}
                  >
                    <LinearGradient colors={['#3b82f6', '#2563eb']} style={styles.addButton}>
                      <Feather name="refresh-cw" size={16} color="#fff" />
                      <Text style={styles.addButtonText}>Refresh</Text>
                    </LinearGradient>
                  </TouchableOpacity>
                </View>
              }
              renderItem={({ item }) => (
                <TouchableOpacity 
                  activeOpacity={0.7}
                  onPress={() => {
                    if (!item.dynamic) {
                      setSelectedLease(item);
                      setComment(item.comment || "");
                      setLeaseModal(true);
                    }
                  }}
                >
                  <LinearGradient colors={['#1e293b', '#0f172a']} style={styles.leaseCard}>
                    <View style={styles.leaseCardHeader}>
                      <View style={styles.ipContainer}>
                        <Feather name="cpu" size={14} color="#38bdf8" />
                        <Text style={styles.leaseIp}>{item.address}</Text>
                      </View>
                      <LinearGradient 
                        colors={item.dynamic ? ['#f59e0b', '#d97706'] : ['#22c55e', '#16a34a']} 
                        style={styles.leaseBadge}
                      >
                        <Text style={styles.leaseBadgeText}>
                          {item.dynamic ? "DHCP" : "STATIC"}
                        </Text>
                      </LinearGradient>
                    </View>

                    <View style={styles.leaseDetails}>
                      <View style={styles.detailRow}>
                        <Feather name="hard-drive" size={12} color="#64748b" />
                        <Text style={styles.detailText}>MAC: {item["mac-address"] || "N/A"}</Text>
                      </View>
                      {item["host-name"] ? (
                        <View style={styles.detailRow}>
                          <Feather name="monitor" size={12} color="#64748b" />
                          <Text style={styles.detailText}>Host: {item["host-name"]}</Text>
                        </View>
                      ) : null}
                    </View>

                    <TouchableOpacity 
                      style={styles.commentContainer}
                      onPress={() => {
                        if (!item.dynamic) {
                          setSelectedLease(item);
                          setComment(item.comment || "");
                          setLeaseModal(true);
                        }
                      }}
                    >
                      <Feather name="message-circle" size={12} color="#94a3b8" />
                      {item.comment ? (
                        <Text style={styles.leaseComment} numberOfLines={2}>
                          {item.comment}
                        </Text>
                      ) : (
                        <Text style={styles.noComment}>
                          {item.dynamic ? "Dynamic lease" : "Tap to add comment"}
                        </Text>
                      )}
                    </TouchableOpacity>

                    {item.dynamic ? (
                      <TouchableOpacity 
                        style={styles.staticButton}
                        onPress={() => makeStatic(item[".id"], item.address, item.comment || "")}
                      >
                        <LinearGradient colors={['#2563eb', '#1d4ed8']} style={styles.staticButtonGradient}>
                          <Feather name="lock" size={14} color="#fff" />
                          <Text style={styles.staticButtonText}>Convert & Add</Text>
                        </LinearGradient>
                      </TouchableOpacity>
                    ) : null}
                  </LinearGradient>
                </TouchableOpacity>
              )}
            />
          )}

          {/* Lease Comment Modal */}
          <Modal visible={leaseModal} transparent animationType="fade">
            <View style={styles.modalOverlay}>
              <LinearGradient colors={['#1e293b', '#0f172a']} style={styles.modalContent}>
                <Text style={[styles.modalTitle, { color: '#60a5fa' }]}>Edit Lease Comment</Text>
                
                <View style={{ 
                  backgroundColor: '#2d3a4f', 
                  borderRadius: 30, 
                  paddingHorizontal: 16, 
                  paddingVertical: 8, 
                  alignSelf: 'center', 
                  marginBottom: 16,
                  borderWidth: 1,
                  borderColor: '#60a5fa'
                }}>
                  {selectedLease?.address ? (
                    <Text style={{ color: '#93c5fd', fontSize: 14, fontWeight: '600' }}>
                      {selectedLease.address}
                    </Text>
                  ) : null}
                </View>
                
                <Text style={[styles.modalLabel, { color: '#fff', marginBottom: 8 }]}>Comment:</Text>
                
                <TextInput
                  style={styles.modalInput}
                  value={comment}
                  onChangeText={setComment}
                  placeholder="Enter comment"
                  placeholderTextColor="#9ca3af"
                  multiline
                />
                
                <View style={styles.modalActions}>
                  <TouchableOpacity 
                    style={[styles.modalButton, styles.cancelButton]} 
                    onPress={() => setLeaseModal(false)}
                  >
                    <Text style={styles.modalButtonText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity 
                    style={[styles.modalButton, styles.saveButton]} 
                    onPress={async () => {
                      if (!selectedLease) return;
                      try {
                        await axios.post(`${apiUrl}/update-comment`, {
                          id: selectedLease[".id"],
                          comment
                        });
                        setLeaseModal(false);
                        Alert.alert("Success", "Lease comment updated");
                        addLog(`📝 Updated lease comment for ${selectedLease.address}`, 'info');
                        fetchLeases();
                      } catch (e: any) {
                        Alert.alert("Error", "Failed to update comment");
                      }
                    }}
                  >
                    <Text style={styles.modalButtonText}>Save</Text>
                  </TouchableOpacity>
                </View>
              </LinearGradient>
            </View>
          </Modal>

          {/* Convert Modal */}
          <Modal visible={showConvertModal} transparent animationType="fade">
            <View style={styles.modalOverlay}>
              <LinearGradient colors={['#1e293b', '#0f172a']} style={[styles.modalContent, { maxHeight: 650 }]}>
                
                <View style={{ alignItems: 'center', marginBottom: 16 }}>
                  <View style={{ backgroundColor: '#10b981', padding: 16, borderRadius: 50, marginBottom: 12 }}>
                    <Feather name="user-plus" size={28} color="#fff" />
                  </View>
                  <Text style={[styles.modalTitle, { color: '#10b981' }]}>New Client Registration</Text>
                  <Text style={{ color: '#94a3b8', fontSize: 12 }}>IP: {convertingLease?.address}</Text>
                </View>
                
                <ScrollView showsVerticalScrollIndicator={false}>
                  
                  <View style={{ marginBottom: 12 }}>
                    <Text style={[styles.modalLabel, { color: '#e2e8f0' }]}>📶 Plan</Text>
                    <View style={styles.modalInputContainer}>
                      <Feather name="wifi" size={16} color="#10b981" style={styles.modalInputIcon} />
                      <TextInput
                        style={styles.modalInputWithIcon}
                        value={convertPlan}
                        onChangeText={setConvertPlan}
                        placeholder="e.g., PLAN1999"
                        placeholderTextColor="#94a3b8"
                      />
                    </View>
                  </View>
                  
                  <View style={{ marginBottom: 16 }}>
                    <Text style={[styles.modalLabel, { color: '#e2e8f0' }]}>👤 Client Name *</Text>
                    <View style={styles.modalInputContainer}>
                      <Feather name="user" size={16} color="#64748b" style={styles.modalInputIcon} />
                      <TextInput
                        style={styles.modalInputWithIcon}
                        value={convertComment}
                        onChangeText={setConvertComment}
                        placeholder="e.g., Juan Dela Cruz"
                        placeholderTextColor="#94a3b8"
                      />
                    </View>
                  </View>
                  
                  <View style={{ marginBottom: 12 }}>
                    <Text style={[styles.modalLabel, { color: '#e2e8f0' }]}>🏠 Address</Text>
                    <View style={styles.modalInputContainer}>
                      <Feather name="map-pin" size={16} color="#64748b" style={styles.modalInputIcon} />
                      <TextInput
                        style={styles.modalInputWithIcon}
                        value={convertAddress}
                        onChangeText={setConvertAddress}
                        placeholder="e.g., Blk 12 Lot 34"
                        placeholderTextColor="#64748b"
                      />
                    </View>
                  </View>
                  
                  <View style={{ marginBottom: 12 }}>
                    <Text style={[styles.modalLabel, { color: '#e2e8f0' }]}>📱 CP Number</Text>
                    <View style={styles.modalInputContainer}>
                      <Feather name="phone" size={16} color="#64748b" style={styles.modalInputIcon} />
                      <TextInput
                        style={styles.modalInputWithIcon}
                        value={convertCpNumber}
                        onChangeText={setConvertCpNumber}
                        placeholder="e.g., 09123456789"
                        placeholderTextColor="#64748b"
                        keyboardType="phone-pad"
                      />
                    </View>
                  </View>
                  
                  <View style={{ marginBottom: 16 }}>
                    <Text style={[styles.modalLabel, { color: '#e2e8f0' }]}>📅 Install Date (MM-DD-YY)</Text>
                    <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                      <TextInput
                        style={{
                          flex: 1,
                          backgroundColor: '#0f172a',
                          color: '#ffffff',
                          fontSize: 16,
                          textAlign: 'center',
                          paddingVertical: 12,
                          borderRadius: 8,
                          borderWidth: 1,
                          borderColor: '#10b981'
                        }}
                        value={convertMonth}
                        onChangeText={setConvertMonth}
                        placeholder="MM"
                        placeholderTextColor="#64748b"
                        maxLength={2}
                        keyboardType="numeric"
                      />
                      <Text style={{ color: '#94a3b8', fontSize: 20 }}>-</Text>
                      <TextInput
                        style={{
                          flex: 1,
                          backgroundColor: '#0f172a',
                          color: '#ffffff',
                          fontSize: 16,
                          textAlign: 'center',
                          paddingVertical: 12,
                          borderRadius: 8,
                          borderWidth: 1,
                          borderColor: '#10b981'
                        }}
                        value={convertDay}
                        onChangeText={setConvertDay}
                        placeholder="DD"
                        placeholderTextColor="#64748b"
                        maxLength={2}
                        keyboardType="numeric"
                      />
                      <Text style={{ color: '#94a3b8', fontSize: 20 }}>-</Text>
                      <TextInput
                        style={{
                          flex: 1,
                          backgroundColor: '#0f172a',
                          color: '#ffffff',
                          fontSize: 16,
                          textAlign: 'center',
                          paddingVertical: 12,
                          borderRadius: 8,
                          borderWidth: 1,
                          borderColor: '#10b981'
                        }}
                        value={convertYear}
                        onChangeText={setConvertYear}
                        placeholder="YY"
                        placeholderTextColor="#64748b"
                        maxLength={2}
                        keyboardType="numeric"
                      />
                    </View>
                  </View>
                  
                  {convertMonth && convertDay && convertYear && (
                    <View style={{ 
                      backgroundColor: '#1e3a5f', 
                      padding: 12, 
                      borderRadius: 8, 
                      marginBottom: 16,
                      borderWidth: 1,
                      borderColor: '#3b82f6'
                    }}>
                      <Text style={{ color: '#93c5fd', fontSize: 12, marginBottom: 4 }}>📅 Due Date Preview:</Text>
                      <Text style={{ color: '#fff', fontSize: 16, fontWeight: 'bold' }}>
                        {(() => {
                          const month = parseInt(convertMonth) - 1;
                          const day = parseInt(convertDay);
                          const year = 2000 + parseInt(convertYear);
                          const install = new Date(year, month, day);
                          const due = new Date(install);
                          due.setDate(install.getDate() + 35);
                          const dueMonth = (due.getMonth() + 1).toString().padStart(2, '0');
                          const dueDay = due.getDate().toString().padStart(2, '0');
                          const dueYear = due.getFullYear().toString().slice(-2);
                          return `${dueMonth}-${dueDay}-${dueYear}`;
                        })()}
                      </Text>
                    </View>
                  )}
                  
                  <View style={styles.modalActions}>
                    <TouchableOpacity 
                      style={[styles.modalButton, styles.cancelButton]} 
                      onPress={() => {
                        setShowConvertModal(false);
                        setConvertingLease(null);
                        setConvertComment("");
                        setConvertAddress("");
                        setConvertCpNumber("");
                        setConvertPlan("");
                        setConvertMonth("");
                        setConvertDay("");
                        setConvertYear("");
                      }}
                    >
                      <Text style={styles.modalButtonText}>Cancel</Text>
                    </TouchableOpacity>
                    
                    <TouchableOpacity 
                      style={[styles.modalButton, { backgroundColor: '#10b981' }]} 
                      onPress={processConvertWithClientDetails}
                    >
                      <Text style={styles.modalButtonText}>Register Client</Text>
                    </TouchableOpacity>
                  </View>
                </ScrollView>
              </LinearGradient>
            </View>
          </Modal>
        </SafeAreaView>
      </LinearGradient>
    );
  }

  // ==========================================================================
// ADDRESS LIST PAGE - COMPLETELY FIXED
// ==========================================================================
if (page === "ipoe" && ipoePage === "address") {
  const totalAddress = addressList.length;
  const enabledAddress = addressList.filter(a => !a.disabled).length;
  const disabledAddress = addressList.filter(a => a.disabled).length;

  const filteredAddress = addressList.filter(a =>
    a.address?.includes(addressSearch) ||
    a.comment?.toLowerCase().includes(addressSearch.toLowerCase())
  );

  return (
    <LinearGradient colors={['#0b1120', '#1a2639']} style={styles.container}>
      <StatusBar barStyle="light-content" />
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.pageHeader}>
          <TouchableOpacity onPress={() => setIpoePage("home")} style={styles.backButton}>
            <MaterialIcons name="arrow-back" size={20} color="#38bdf8" />
          </TouchableOpacity>
          <Text style={styles.pageTitle}>Address List</Text>
          <TouchableOpacity onPress={() => {
            fetchAddressList();
            fetchDueEntries();
          }} style={styles.refreshButton}>
            <Feather name="refresh-cw" size={18} color="#38bdf8" />
          </TouchableOpacity>
        </View>

        <View style={styles.smallStatusBar}>
          <View style={[styles.smallStatusDot, { backgroundColor: '#22c55e' }]} />
          <Text style={styles.smallStatusText}>{apiUrl}</Text>
        </View>

        <LinearGradient colors={['#1e3a5f', '#0f2b4f']} style={styles.statsCardInline}>
          <View style={styles.statsRowInline}>
            <View style={styles.statItemInline}>
              <Text style={styles.statNumberInline}>{totalAddress}</Text>
              <Text style={styles.statLabelInline}>Total</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statItemInline}>
              <Text style={styles.statNumberInline}>{enabledAddress}</Text>
              <Text style={styles.statLabelInline}>Enabled</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statItemInline}>
              <Text style={styles.statNumberInline}>{disabledAddress}</Text>
              <Text style={styles.statLabelInline}>Disabled</Text>
            </View>
          </View>
        </LinearGradient>

        <View style={styles.searchContainer}>
          <Feather name="search" size={16} color="#64748b" style={styles.searchIcon} />
          <TextInput
            placeholder="Search IP or comment..."
            placeholderTextColor="#64748b"
            style={styles.searchInput}
            value={addressSearch}
            onChangeText={setAddressSearch}
          />
        </View>

        <TouchableOpacity activeOpacity={0.8} onPress={() => setAddModal(true)}>
          <LinearGradient colors={['#2563eb', '#1d4ed8']} style={styles.addButton}>
            <Feather name="plus-circle" size={16} color="#fff" />
            <Text style={styles.addButtonText}>Add New IP</Text>
          </LinearGradient>
        </TouchableOpacity>

        <FlatList
          data={filteredAddress}
          keyExtractor={(item) => item[".id"]}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => fetchAddressList()} />
          }
          ListFooterComponent={<View style={{ height: 80 }} />}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Feather name="inbox" size={40} color="#4b5563" />
              <Text style={styles.emptyText}>No addresses found</Text>
            </View>
          }
          renderItem={({ item }) => {
            const hasHistory = item.previousDueDates && item.previousDueDates.length > 0;
            const installDate = item.installDate;
            
            return (
              <LinearGradient colors={['#1e293b', '#0f172a']} style={styles.addressCard}>
                <View style={styles.addressCardHeader}>
                  <View style={styles.addressIpContainer}>
                    <Feather name="wifi" size={14} color="#38bdf8" />
                    <Text style={styles.addressIp}>{item.address}</Text>
                    <Text style={styles.addressCommentInline} numberOfLines={1}>
                      {item.comment || "No comment"}
                    </Text>
                  </View>
                  <LinearGradient 
                    colors={item.disabled ? ['#64748b', '#475569'] : ['#22c55e', '#16a34a']} 
                    style={styles.addressStatus}
                  >
                    <Text style={styles.addressStatusText}>
                      {item.disabled ? "OFF" : "ON"}
                    </Text>
                  </LinearGradient>
                </View>
                
                {item.dueDate && (
                  <View style={styles.dueDateBadge}>
                    <Feather name="clock" size={10} color="#f59e0b" />
                    <Text style={styles.dueDateText}>Due: {item.dueDate}</Text>
                  </View>
                )}
                
                {installDate && (
                  <View style={[styles.dueDateBadge, { backgroundColor: '#8b5cf6' }]}>
                    <Feather name="calendar" size={10} color="#fff" />
                    <Text style={styles.dueDateText}>Installed: {installDate}</Text>
                  </View>
                )}
                
                {hasHistory && (
                  <TouchableOpacity 
                    style={styles.historyButton}
                    onPress={() => showPaymentHistory(item)}
                  >
                    <LinearGradient colors={['#4b5563', '#374151']} style={styles.historyButtonGradient}>
                      <Feather name="clock" size={10} color="#94a3b8" />
                      <Text style={styles.historyButtonText}>
                        {item.previousDueDates?.length} prev
                      </Text>
                    </LinearGradient>
                  </TouchableOpacity>
                )}
                
                <View style={styles.actionsRow}>
                  <TouchableOpacity
                    activeOpacity={0.8}
                    style={styles.actionButton}
                    onPress={() => toggleInternet(item)}
                  >
                    <LinearGradient 
                      colors={item.disabled ? ['#16a34a', '#15803d'] : ['#dc2626', '#b91c1c']} 
                      style={styles.actionButtonGradient}
                    >
                      <Feather name={item.disabled ? "play" : "pause"} size={12} color="#fff" />
                      <Text style={styles.actionButtonText}>
                        {item.disabled ? "Enable" : "Disable"}
                      </Text>
                    </LinearGradient>
                  </TouchableOpacity>
                  
                  <TouchableOpacity
                    activeOpacity={0.8}
                    style={styles.actionButton}
                    onPress={() => {
                      console.log("Edit button pressed for:", item.address);
                      setSelectedAddress(item);
                      setComment(item.comment || "");
                      setAddressModal(true);
                    }}
                  >
                    <LinearGradient colors={['#8b5cf6', '#7c3aed']} style={styles.actionButtonGradient}>
                      <Feather name="edit-2" size={12} color="#fff" />
                      <Text style={styles.actionButtonText}>Edit</Text>
                    </LinearGradient>
                  </TouchableOpacity>
                  
                  <TouchableOpacity
                    activeOpacity={0.8}
                    style={styles.actionButton}
                    onPress={() => openInstallModal(item)}
                  >
                    <LinearGradient colors={['#8b5cf6', '#7c3aed']} style={styles.actionButtonGradient}>
                      <Feather name="calendar" size={12} color="#fff" />
                      <Text style={styles.actionButtonText}>Install</Text>
                    </LinearGradient>
                  </TouchableOpacity>
                </View>
              </LinearGradient>
            );
          }}
        />

        {/* Add IP Modal */}
        <Modal visible={addModal} transparent animationType="fade">
          <View style={styles.modalOverlay}>
            <LinearGradient colors={['#1e293b', '#0f172a']} style={styles.modalContent}>
              <Text style={styles.modalTitle}>Add IP to Address List</Text>
              
              <View style={styles.modalInputContainer}>
                <Feather name="wifi" size={16} color="#64748b" style={styles.modalInputIcon} />
                <TextInput
                  placeholder="IP Address"
                  placeholderTextColor="#64748b"
                  style={styles.modalInputWithIcon}
                  value={newIP}
                  onChangeText={setNewIP}
                />
              </View>
              
              <View style={styles.modalInputContainer}>
                <Feather name="message-circle" size={16} color="#64748b" style={styles.modalInputIcon} />
                <TextInput
                  placeholder="Comment"
                  placeholderTextColor="#64748b"
                  style={styles.modalInputWithIcon}
                  value={newComment}
                  onChangeText={setNewComment}
                />
              </View>
              
              <View style={styles.modalActions}>
                <TouchableOpacity 
                  style={[styles.modalButton, styles.cancelButton]} 
                  onPress={() => setAddModal(false)}
                >
                  <Text style={styles.modalButtonText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity 
                  style={[styles.modalButton, styles.addModalButton]} 
                  onPress={addIP}
                >
                  <Text style={styles.modalButtonText}>Add IP</Text>
                </TouchableOpacity>
              </View>
            </LinearGradient>
          </View>
        </Modal>

        {/* Address Comment Modal - ULTRA SIMPLE */}
        <Modal visible={addressModal} transparent animationType="fade">
          <View style={{
            flex: 1,
            backgroundColor: 'rgba(0,0,0,0.95)',
            justifyContent: 'center',
            alignItems: 'center',
            padding: 16,
          }}>
            <LinearGradient colors={['#1e293b', '#0f172a']} style={{
              width: '90%',
              maxWidth: 400,
              padding: 24,
              borderRadius: 16,
            }}>
              
              <Text style={{ color: '#c4b5fd', fontSize: 20, fontWeight: 'bold', textAlign: 'center', marginBottom: 20 }}>
                Edit Address Comment
              </Text>
              
              <View style={{ 
                backgroundColor: '#2d3a4f', 
                paddingHorizontal: 16, 
                paddingVertical: 8, 
                borderRadius: 20, 
                alignSelf: 'center', 
                marginBottom: 20 
              }}>
                <Text style={{ color: '#c4b5fd', fontSize: 15 }}>
                  {selectedAddress?.address}
                </Text>
              </View>
              
              <Text style={{ color: '#94a3b8', fontSize: 13, marginBottom: 8 }}>Comment:</Text>
              
              <TextInput
                style={{
                  backgroundColor: '#0f172a',
                  color: '#fff',
                  padding: 12,
                  borderRadius: 8,
                  borderWidth: 1,
                  borderColor: '#334155',
                  fontSize: 14,
                  minHeight: 100,
                  textAlignVertical: 'top',
                  marginBottom: 20
                }}
                value={comment}
                onChangeText={setComment}
                placeholder="Enter comment"
                placeholderTextColor="#64748b"
                multiline
              />
              
              <View style={{ flexDirection: 'row', gap: 12 }}>
                <TouchableOpacity 
                  style={{ 
                    flex: 1, 
                    backgroundColor: '#4b5563', 
                    padding: 14, 
                    borderRadius: 8, 
                    alignItems: 'center' 
                  }} 
                  onPress={() => {
                    console.log("Cancel clicked");
                    setAddressModal(false);
                  }}
                >
                  <Text style={{ color: '#fff', fontWeight: 'bold' }}>Cancel</Text>
                </TouchableOpacity>
                
                <TouchableOpacity 
                  style={{ 
                    flex: 1, 
                    backgroundColor: '#2563eb', 
                    padding: 14, 
                    borderRadius: 8, 
                    alignItems: 'center' 
                  }} 
                  onPress={() => {
                    console.log("Save clicked");
                    updateAddressComment();
                  }}
                >
                  <Text style={{ color: '#fff', fontWeight: 'bold' }}>Save</Text>
                </TouchableOpacity>
              </View>
              
            </LinearGradient>
          </View>
        </Modal>

        {/* Install Date Modal */}
        <Modal visible={installModalVisible} transparent animationType="fade">
          <View style={styles.modalOverlay}>
            <LinearGradient colors={['#1e293b', '#0f172a']} style={[styles.modalContent, { maxHeight: 500 }]}>
              <Text style={[styles.modalTitle, { color: '#8b5cf6' }]}>📅 Set Install Date</Text>
              
              <View style={{ alignItems: 'center', marginBottom: 16 }}>
                <View style={{ backgroundColor: '#8b5cf6', padding: 12, borderRadius: 40, marginBottom: 8 }}>
                  <Feather name="calendar" size={24} color="#fff" />
                </View>
                <Text style={{ color: '#fff', fontSize: 16, fontWeight: 'bold' }}>
                  {selectedForInstall?.address || 'Select IP'}
                </Text>
              </View>
              
              <Text style={[styles.modalLabel, { color: '#e2e8f0' }]}>Installation Date (MM-DD-YY):</Text>
              <View style={{ flexDirection: 'row', gap: 8, marginBottom: 16 }}>
                <TextInput
                  style={[styles.modalInputWithIcon, { flex: 1, textAlign: 'center' }]}
                  value={(installDate.getMonth() + 1).toString().padStart(2, '0')}
                  onChangeText={(text) => {
                    const newDate = new Date(installDate);
                    newDate.setMonth((parseInt(text) || 1) - 1);
                    setInstallDate(newDate);
                  }}
                  placeholder="MM"
                  placeholderTextColor="#64748b"
                  maxLength={2}
                  keyboardType="numeric"
                />
                <Text style={{ color: '#fff', lineHeight: 40 }}>-</Text>
                <TextInput
                  style={[styles.modalInputWithIcon, { flex: 1, textAlign: 'center' }]}
                  value={installDate.getDate().toString().padStart(2, '0')}
                  onChangeText={(text) => {
                    const newDate = new Date(installDate);
                    newDate.setDate(parseInt(text) || 1);
                    setInstallDate(newDate);
                  }}
                  placeholder="DD"
                  placeholderTextColor="#64748b"
                  maxLength={2}
                  keyboardType="numeric"
                />
                <Text style={{ color: '#fff', lineHeight: 40 }}>-</Text>
                <TextInput
                  style={[styles.modalInputWithIcon, { flex: 1, textAlign: 'center' }]}
                  value={installDate.getFullYear().toString().slice(-2)}
                  onChangeText={(text) => {
                    const newDate = new Date(installDate);
                    const fullYear = 2000 + (parseInt(text) || 24);
                    newDate.setFullYear(fullYear);
                    setInstallDate(newDate);
                  }}
                  placeholder="YY"
                  placeholderTextColor="#64748b"
                  maxLength={2}
                  keyboardType="numeric"
                />
              </View>
              
              <Text style={[styles.modalLabel, { color: '#e2e8f0' }]}>Initial Due (days from install):</Text>
              <TextInput
                style={[styles.modalInputWithIcon, { marginBottom: 16 }]}
                value={initialDueDays}
                onChangeText={setInitialDueDays}
                placeholder="30"
                placeholderTextColor="#64748b"
                keyboardType="numeric"
              />
              
              <View style={styles.modalActions}>
                <TouchableOpacity 
                  style={[styles.modalButton, styles.cancelButton]} 
                  onPress={() => setInstallModalVisible(false)}
                >
                  <Text style={styles.modalButtonText}>Cancel</Text>
                </TouchableOpacity>
                
                <TouchableOpacity 
                  style={[styles.modalButton, { backgroundColor: '#8b5cf6' }]} 
                  onPress={applyInstallDate}
                >
                  <Text style={styles.modalButtonText}>Set Install Date</Text>
                </TouchableOpacity>
              </View>
            </LinearGradient>
          </View>
        </Modal>
        
      </SafeAreaView>
    </LinearGradient>
  );
}

  // ==========================================================================
  // AUTO-DISABLE PAGE
  // ==========================================================================
  if (page === "ipoe" && ipoePage === "auto-disable") {
    const activeDue = dueEntries.filter(e => !e.disabled).length;
    const expiredDue = dueEntries.filter(e => e.expired).length;

    return (
      <LinearGradient colors={['#0b1120', '#1a2639']} style={styles.container}>
        <StatusBar barStyle="light-content" />
        <SafeAreaView style={styles.safeArea}>
          <View style={styles.pageHeader}>
            <TouchableOpacity onPress={() => setIpoePage("home")} style={styles.backButton}>
              <MaterialIcons name="arrow-back" size={20} color="#38bdf8" />
            </TouchableOpacity>
            <Text style={styles.pageTitle}>Auto-Disable</Text>
            <TouchableOpacity onPress={clearLogs} style={styles.refreshButton}>
              <Feather name="trash-2" size={18} color="#ef4444" />
            </TouchableOpacity>
          </View>

          <View style={styles.smallStatusBar}>
            <View style={[styles.smallStatusDot, { backgroundColor: '#22c55e' }]} />
            <Text style={styles.smallStatusText}>{apiUrl}</Text>
          </View>

          <ScrollView style={styles.content}>
            <LinearGradient colors={['#1e293b', '#0f172a']} style={styles.card}>
              <Text style={styles.cardTitle}>📊 Status</Text>
              
              <View style={styles.statusGrid}>
                <View style={styles.statusItem}>
                  <Text style={styles.statusValue}>{dueEntries.length}</Text>
                  <Text style={styles.statusLabel}>With Due</Text>
                </View>
                <View style={styles.statusDivider} />
                <View style={styles.statusItem}>
                  <Text style={[styles.statusValue, { color: '#22c55e' }]}>{activeDue}</Text>
                  <Text style={styles.statusLabel}>Active</Text>
                </View>
                <View style={styles.statusDivider} />
                <View style={styles.statusItem}>
                  <Text style={[styles.statusValue, { color: '#f59e0b' }]}>{expiredDue}</Text>
                  <Text style={styles.statusLabel}>Expired</Text>
                </View>
              </View>
            </LinearGradient>

            <LinearGradient colors={['#1e293b', '#0f172a']} style={styles.card}>
              <Text style={styles.cardTitle}>🔍 Scan Address List</Text>
              <Text style={styles.cardSubtitle}>Check all entries for due dates</Text>
              
              <TouchableOpacity
                style={styles.runScriptBtn}
                onPress={scanAllForDueDates}
              >
                <LinearGradient colors={['#8b5cf6', '#7c3aed']} style={styles.runScriptGradient}>
                  <Feather name="search" size={14} color="#fff" />
                  <Text style={styles.runScriptText}>Scan Now</Text>
                </LinearGradient>
              </TouchableOpacity>
            </LinearGradient>

            <LinearGradient colors={['#1e293b', '#0f172a']} style={styles.card}>
              <View style={styles.toggleContainer}>
                <View>
                  <Text style={styles.cardTitle}>🤖 Scheduler</Text>
                  <Text style={styles.cardSubtitle}>Auto-disable expired</Text>
                </View>
                <Switch
                  value={autoDisableEnabled}
                  onValueChange={toggleAutoDisable}
                  trackColor={{ false: '#4b5563', true: '#8b5cf6' }}
                  thumbColor={autoDisableEnabled ? '#fff' : '#9ca3af'}
                />
              </View>

              <View style={styles.schedulerControls}>
                <View style={styles.schedulerRow}>
                  <Text style={styles.schedulerLabel}>Interval:</Text>
                  <View style={styles.schedulerButtons}>
                    {['1d', '12h', '6h', '1h'].map((interval) => (
                      <TouchableOpacity
                        key={`interval-${interval}`}
                        style={[
                          styles.intervalButton,
                          schedulerInterval === interval && styles.intervalButtonActive
                        ]}
                        onPress={() => setSchedulerInterval(interval)}
                      >
                        <Text style={[
                          styles.intervalButtonText,
                          schedulerInterval === interval && styles.intervalButtonTextActive
                        ]}>
                          {interval}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>

                <View style={styles.schedulerRow}>
                  <Text style={styles.schedulerLabel}>Time:</Text>
                  <TextInput
                    style={styles.timeInput}
                    value={schedulerTime}
                    onChangeText={setSchedulerTime}
                    placeholder="00:05"
                    placeholderTextColor="#64748b"
                  />
                </View>

                <TouchableOpacity
                  style={styles.saveSchedulerBtn}
                  onPress={setupScheduler}
                >
                  <LinearGradient colors={['#8b5cf6', '#7c3aed']} style={styles.saveSchedulerGradient}>
                    <Feather name="save" size={14} color="#fff" />
                    <Text style={styles.saveSchedulerText}>Save</Text>
                  </LinearGradient>
                </TouchableOpacity>
              </View>
            </LinearGradient>

            <LinearGradient colors={['#1e293b', '#0f172a']} style={styles.card}>
              <Text style={styles.cardTitle}>⚡ Manual Run</Text>
              
              <TouchableOpacity
                style={styles.runScriptBtn}
                onPress={runDisableScript}
                disabled={scriptRunning}
              >
                <LinearGradient 
                  colors={scriptRunning ? ['#4b5563', '#374151'] : ['#8b5cf6', '#7c3aed']} 
                  style={styles.runScriptGradient}
                >
                  {scriptRunning ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <>
                      <Feather name="play" size={14} color="#fff" />
                      <Text style={styles.runScriptText}>Run Now</Text>
                    </>
                  )}
                </LinearGradient>
              </TouchableOpacity>
            </LinearGradient>

            {expiredDue > 0 && (
              <LinearGradient colors={['#451a1a', '#2d1a1a']} style={styles.card}>
                <Text style={[styles.cardTitle, { color: '#f87171' }]}>
                  ⚠️ Expired ({expiredDue})
                </Text>
                
                {dueEntries.filter(e => e.expired && !e.disabled).map((item, index) => (
                  <View key={`expired-${item.address}-${index}`} style={styles.expiredItem}>
                    <Feather name="alert-circle" size={12} color="#f87171" />
                    <View style={styles.expiredItemContent}>
                      <Text style={styles.expiredAddress}>{item.address}</Text>
                      {item.clientName && item.clientName !== 'No name' && (
                        <Text style={styles.expiredName}>{item.clientName}</Text>
                      )}
                    </View>
                    <Text style={styles.expiredDue}>Due: {item.dueDate}</Text>
                  </View>
                ))}
              </LinearGradient>
            )}

            {dueEntries.length > 0 && (
              <LinearGradient colors={['#1e293b', '#0f172a']} style={styles.card}>
                <View style={styles.dueHeader}>
                  <Text style={styles.cardTitle}>📅 With Due Dates</Text>
                  <TouchableOpacity onPress={() => setStatsModal(true)}>
                    <Feather name="bar-chart-2" size={16} color="#38bdf8" />
                  </TouchableOpacity>
                </View>
                
				
				
				
				
				{dueEntries.map((item, index) => {
  const currentDue = item.dueDate;
  const hasHistory = item.previousDueDates && item.previousDueDates.length > 0;
  const installDate = item.installDate;
  const inGrace = item.inGracePeriod;
  const graceUntil = item.graceUntil;
  
  return (
    <View key={`due-${item.address}-${index}`} style={styles.dueItemContainer}>
      <View style={styles.dueItem}>
        <View style={styles.dueItemLeft}>
          <Feather 
            name={item.disabled ? "slash" : (inGrace ? "clock" : "check-circle")} 
            size={12} 
            color={item.disabled ? '#ef4444' : (inGrace ? '#f59e0b' : '#22c55e')} 
          />
          <View>
            <Text style={styles.dueAddress}>{item.address}</Text>
            {item.clientName && item.clientName !== 'No name' && (
              <Text style={styles.dueName}>{item.clientName}</Text>
            )}
            {installDate && (
              <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 2 }}>
                <Feather name="calendar" size={8} color="#8b5cf6" />
                <Text style={{ color: '#8b5cf6', fontSize: 8, marginLeft: 2 }}>
                  Installed: {installDate}
                </Text>
              </View>
            )}
            {inGrace && graceUntil && (
              <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 2 }}>
                <Feather name="clock" size={8} color="#f59e0b" />
                <Text style={{ color: '#f59e0b', fontSize: 8, marginLeft: 2 }}>
                  Grace until: {graceUntil}
                </Text>
              </View>
            )}
          </View>
        </View>
        
        <View style={styles.dueRightSection}>
          <Text style={[styles.dueDate, item.expired && !item.disabled && !inGrace && styles.dueDateExpired]}>
            {currentDue}
          </Text>
          
          <View style={{ flexDirection: 'row', gap: 4, flexWrap: 'wrap', justifyContent: 'flex-end', marginTop: 4 }}>
            <TouchableOpacity
              style={{ minWidth: 40 }}
              onPress={() => openEditDueModal(item)}
            >
              <LinearGradient colors={['#3b82f6', '#2563eb']} style={styles.paidButtonGradient}>
                <Feather name="edit-2" size={10} color="#fff" />
                <Text style={styles.paidButtonText}>EDIT</Text>
              </LinearGradient>
            </TouchableOpacity>
            
            {!inGrace && (
              <TouchableOpacity
                style={{ minWidth: 40 }}
                onPress={() => openGraceModal(item)}
              >
                <LinearGradient colors={['#f59e0b', '#d97706']} style={styles.paidButtonGradient}>
                  <Feather name="clock" size={10} color="#fff" />
                  <Text style={styles.paidButtonText}>GRACE</Text>
                </LinearGradient>
              </TouchableOpacity>
            )}
            
            <TouchableOpacity
              style={{ minWidth: 40 }}
              onPress={() => handlePaid(item)}
            >
              <LinearGradient colors={['#16a34a', '#15803d']} style={styles.paidButtonGradient}>
                <Feather name="check-circle" size={10} color="#fff" />
                <Text style={styles.paidButtonText}>PAID</Text>
              </LinearGradient>
            </TouchableOpacity>
          </View>
        </View>
      </View>
      
      {hasHistory && (
        <TouchableOpacity 
          style={styles.compactHistoryButton}
          onPress={() => showPaymentHistory(item)}
        >
          <Feather name="clock" size={10} color="#64748b" />
          <Text style={styles.compactHistoryText}>
            {item.previousDueDates?.length} prev
          </Text>
        </TouchableOpacity>
      )}
    </View>
  );
})}
				
				
                
              </LinearGradient>
            )}

            <LinearGradient colors={['#1e293b', '#0f172a']} style={styles.card}>
              <View style={styles.logsHeader}>
                <Text style={styles.cardTitle}>📋 Logs</Text>
                <TouchableOpacity onPress={clearLogs}>
                  <Feather name="trash-2" size={16} color="#ef4444" />
                </TouchableOpacity>
              </View>
              
              {scriptLogs.length === 0 ? (
                <Text style={styles.noLogs}>No logs yet</Text>
              ) : (
                scriptLogs.map((log, index) => (
                  <View key={`log-${index}`} style={styles.logEntry}>
                    <Text style={styles.logTime}>{log.timestamp}</Text>
                    <Text style={[
                      styles.logMessage,
                      log.type === 'success' && styles.logSuccess,
                      log.type === 'error' && styles.logError,
                    ]}>
                      {log.message}
                    </Text>
                  </View>
                ))
              )}
            </LinearGradient>
          </ScrollView>

          <Modal visible={statsModal} transparent animationType="fade">
            <View style={styles.modalOverlay}>
              <LinearGradient colors={['#1e293b', '#0f172a']} style={[styles.modalContent, styles.statsModal]}>
                <Text style={styles.modalTitle}>Statistics</Text>
                
                <View style={styles.statsChart}>
                  <View style={styles.statBar}>
                    <Text style={styles.statBarLabel}>Total</Text>
                    <View style={styles.statBarValue}>
                      <View style={[styles.statBarFill, { width: '100%' }]} />
                      <Text style={styles.statBarText}>{dueEntries.length}</Text>
                    </View>
                  </View>
                  
                  <View style={styles.statBar}>
                    <Text style={styles.statBarLabel}>Expired</Text>
                    <View style={styles.statBarValue}>
                      <View style={[styles.statBarFill, { 
                        width: `${(expiredDue / Math.max(dueEntries.length, 1)) * 100}%`,
                        backgroundColor: '#f59e0b'
                      }]} />
                      <Text style={styles.statBarText}>{expiredDue}</Text>
                    </View>
                  </View>
                  
                  <View style={styles.statBar}>
                    <Text style={styles.statBarLabel}>Active</Text>
                    <View style={styles.statBarValue}>
                      <View style={[styles.statBarFill, { 
                        width: `${(activeDue / Math.max(dueEntries.length, 1)) * 100}%`,
                        backgroundColor: '#22c55e'
                      }]} />
                      <Text style={styles.statBarText}>{activeDue}</Text>
                    </View>
                  </View>
                </View>
                
                <TouchableOpacity
                  style={[styles.modalButton, styles.saveButton]}
                  onPress={() => setStatsModal(false)}
                >
                  <Text style={styles.modalButtonText}>Close</Text>
                </TouchableOpacity>
              </LinearGradient>
            </View>
          </Modal>

          <Modal visible={graceModalVisible} transparent animationType="fade">
            <View style={styles.modalOverlay}>
              <LinearGradient colors={['#1e293b', '#0f172a']} style={[styles.modalContent, { maxHeight: 550 }]}>
                <Text style={[styles.modalTitle, { color: '#f59e0b' }]}>
                  {selectedForGrace?.inGracePeriod ? '✏️ Edit Grace Period' : '⏳ Apply Grace Period'}
                </Text>
                
                <View style={{ alignItems: 'center', marginBottom: 16 }}>
                  <View style={{ backgroundColor: '#f59e0b', padding: 12, borderRadius: 40, marginBottom: 8 }}>
                    <Feather name="clock" size={24} color="#fff" />
                  </View>
                  {selectedForGrace?.address ? (
                    <Text style={{ color: '#fff', fontSize: 16, fontWeight: 'bold' }}>
                      {selectedForGrace.address}
                    </Text>
                  ) : null}
                  {selectedForGrace?.clientName ? (
                    <Text style={{ color: '#94a3b8', marginTop: 4 }}>
                      {selectedForGrace.clientName}
                    </Text>
                  ) : null}
                </View>
                
                <Text style={[styles.modalLabel, { color: '#e2e8f0', fontWeight: '600' }]}>Grace Duration:</Text>
                
                <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
                  {['days', 'hours', 'date'].map((unit) => (
                    <TouchableOpacity
                      key={unit}
                      style={[
                        styles.intervalButton,
                        { flex: 1 },
                        graceUnit === unit && styles.intervalButtonActive
                      ]}
                      onPress={() => setGraceUnit(unit as any)}
                    >
                      <Text style={[
                        styles.intervalButtonText,
                        graceUnit === unit && styles.intervalButtonTextActive
                      ]}>
                        {unit === 'date' ? 'Date' : unit}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
                
                {graceUnit !== 'date' ? (
                  <View style={{ flexDirection: 'row', gap: 8, marginBottom: 16 }}>
                    <View style={{ flex: 3 }}>
                      <TextInput
                        style={{
                          backgroundColor: '#334155',
                          color: '#ffffff',
                          fontSize: 16,
                          padding: 14,
                          borderRadius: 8,
                          borderWidth: 1,
                          borderColor: '#4b5563'
                        }}
                        value={graceDays}
                        onChangeText={setGraceDays}
                        placeholder="3"
                        placeholderTextColor="#9ca3af"
                        keyboardType="numeric"
                      />
                    </View>
                    <View style={{ flex: 1, justifyContent: 'center' }}>
                      <Text style={{ color: '#94a3b8', textAlign: 'center', fontSize: 16 }}>
                        {graceUnit}
                      </Text>
                    </View>
                  </View>
                ) : (
                  <TouchableOpacity 
                    style={{
                      backgroundColor: '#334155',
                      padding: 14,
                      borderRadius: 8,
                      borderWidth: 1,
                      borderColor: '#4b5563',
                      marginBottom: 16,
                      flexDirection: 'row',
                      justifyContent: 'space-between',
                      alignItems: 'center'
                    }}
                    onPress={() => setShowDatePicker(!showDatePicker)}
                  >
                    <Text style={{ color: '#ffffff', fontSize: 16 }}>
                      {graceEndDate.toLocaleDateString()}
                    </Text>
                    <Feather name="calendar" size={20} color="#94a3b8" />
                  </TouchableOpacity>
                )}
                
                {showDatePicker && graceUnit === 'date' && (
                  <View style={{ marginBottom: 16 }}>
                    <View style={{ flexDirection: 'row', gap: 8 }}>
                      <TextInput
                        style={{
                          flex: 1,
                          backgroundColor: '#334155',
                          color: '#ffffff',
                          fontSize: 16,
                          padding: 12,
                          borderRadius: 8,
                          borderWidth: 1,
                          borderColor: '#4b5563',
                          textAlign: 'center'
                        }}
                        value={graceEndDate.getFullYear().toString()}
                        onChangeText={(text) => {
                          const newDate = new Date(graceEndDate);
                          newDate.setFullYear(parseInt(text) || 2024);
                          setGraceEndDate(newDate);
                        }}
                        placeholder="Year"
                        placeholderTextColor="#9ca3af"
                        keyboardType="numeric"
                      />
                      <TextInput
                        style={{
                          flex: 1,
                          backgroundColor: '#334155',
                          color: '#ffffff',
                          fontSize: 16,
                          padding: 12,
                          borderRadius: 8,
                          borderWidth: 1,
                          borderColor: '#4b5563',
                          textAlign: 'center'
                        }}
                        value={(graceEndDate.getMonth() + 1).toString()}
                        onChangeText={(text) => {
                          const newDate = new Date(graceEndDate);
                          newDate.setMonth((parseInt(text) || 1) - 1);
                          setGraceEndDate(newDate);
                        }}
                        placeholder="Month"
                        placeholderTextColor="#9ca3af"
                        keyboardType="numeric"
                      />
                      <TextInput
                        style={{
                          flex: 1,
                          backgroundColor: '#334155',
                          color: '#ffffff',
                          fontSize: 16,
                          padding: 12,
                          borderRadius: 8,
                          borderWidth: 1,
                          borderColor: '#4b5563',
                          textAlign: 'center'
                        }}
                        value={graceEndDate.getDate().toString()}
                        onChangeText={(text) => {
                          const newDate = new Date(graceEndDate);
                          newDate.setDate(parseInt(text) || 1);
                          setGraceEndDate(newDate);
                        }}
                        placeholder="Day"
                        placeholderTextColor="#9ca3af"
                        keyboardType="numeric"
                      />
                    </View>
                  </View>
                )}
                
                <Text style={[styles.modalLabel, { color: '#e2e8f0', fontWeight: '600' }]}>Reason (optional):</Text>
                <TextInput
                  style={{
                    backgroundColor: '#334155',
                    color: '#ffffff',
                    fontSize: 16,
                    padding: 14,
                    borderRadius: 8,
                    borderWidth: 1,
                    borderColor: '#4b5563',
                    marginBottom: 16
                  }}
                  value={graceReason}
                  onChangeText={setGraceReason}
                  placeholder="e.g., Client request"
                  placeholderTextColor="#9ca3af"
                />
                
                <Text style={{ color: '#94a3b8', fontSize: 12, marginBottom: 20, fontStyle: 'italic' }}>
                  Final due date will be 30 days from today.
                </Text>
                
                <View style={styles.modalActions}>
                  <TouchableOpacity 
                    style={[styles.modalButton, styles.cancelButton]} 
                    onPress={() => setGraceModalVisible(false)}
                  >
                    <Text style={styles.modalButtonText}>Cancel</Text>
                  </TouchableOpacity>
                  
                  <TouchableOpacity 
                    style={[styles.modalButton, { backgroundColor: '#f59e0b' }]} 
                    onPress={applyGracePeriod}
                  >
                    <Text style={styles.modalButtonText}>
                      {selectedForGrace?.inGracePeriod ? 'Update' : 'Apply'}
                    </Text>
                  </TouchableOpacity>
                </View>
              </LinearGradient>
            </View>
          </Modal>

          <Modal visible={installModalVisible} transparent animationType="fade">
            <View style={styles.modalOverlay}>
              <LinearGradient colors={['#1e293b', '#0f172a']} style={[styles.modalContent, { maxHeight: 500 }]}>
                <Text style={[styles.modalTitle, { color: '#8b5cf6' }]}>📅 Set Install Date</Text>
                
                <View style={{ alignItems: 'center', marginBottom: 16 }}>
                  <View style={{ backgroundColor: '#8b5cf6', padding: 12, borderRadius: 40, marginBottom: 8 }}>
                    <Feather name="calendar" size={24} color="#fff" />
                  </View>
                  {selectedForInstall?.address ? (
                    <Text style={{ color: '#fff', fontSize: 16, fontWeight: 'bold' }}>
                      {selectedForInstall.address}
                    </Text>
                  ) : null}
                </View>
                
                <Text style={[styles.modalLabel, { color: '#e2e8f0' }]}>Installation Date (MM-DD-YY):</Text>
                <View style={{ flexDirection: 'row', gap: 8, marginBottom: 16 }}>
                  <TextInput
                    style={[styles.modalInputWithIcon, { flex: 1, textAlign: 'center' }]}
                    value={(installDate.getMonth() + 1).toString().padStart(2, '0')}
                    onChangeText={(text) => {
                      const newDate = new Date(installDate);
                      newDate.setMonth((parseInt(text) || 1) - 1);
                      setInstallDate(newDate);
                    }}
                    placeholder="MM"
                    placeholderTextColor="#64748b"
                    maxLength={2}
                    keyboardType="numeric"
                  />
                  <Text style={{ color: '#fff', lineHeight: 40 }}>-</Text>
                  <TextInput
                    style={[styles.modalInputWithIcon, { flex: 1, textAlign: 'center' }]}
                    value={installDate.getDate().toString().padStart(2, '0')}
                    onChangeText={(text) => {
                      const newDate = new Date(installDate);
                      newDate.setDate(parseInt(text) || 1);
                      setInstallDate(newDate);
                    }}
                    placeholder="DD"
                    placeholderTextColor="#64748b"
                    maxLength={2}
                    keyboardType="numeric"
                  />
                  <Text style={{ color: '#fff', lineHeight: 40 }}>-</Text>
                  <TextInput
                    style={[styles.modalInputWithIcon, { flex: 1, textAlign: 'center' }]}
                    value={installDate.getFullYear().toString().slice(-2)}
                    onChangeText={(text) => {
                      const newDate = new Date(installDate);
                      const fullYear = 2000 + (parseInt(text) || 24);
                      newDate.setFullYear(fullYear);
                      setInstallDate(newDate);
                    }}
                    placeholder="YY"
                    placeholderTextColor="#64748b"
                    maxLength={2}
                    keyboardType="numeric"
                  />
                </View>
                
                <Text style={[styles.modalLabel, { color: '#e2e8f0' }]}>Initial Due (days from install):</Text>
                <TextInput
                  style={[styles.modalInputWithIcon, { marginBottom: 16 }]}
                  value={initialDueDays}
                  onChangeText={setInitialDueDays}
                  placeholder="30"
                  placeholderTextColor="#64748b"
                  keyboardType="numeric"
                />
                
                <View style={styles.modalActions}>
                  <TouchableOpacity 
                    style={[styles.modalButton, styles.cancelButton]} 
                    onPress={() => setInstallModalVisible(false)}
                  >
                    <Text style={styles.modalButtonText}>Cancel</Text>
                  </TouchableOpacity>
                  
                  <TouchableOpacity 
                    style={[styles.modalButton, { backgroundColor: '#8b5cf6' }]} 
                    onPress={applyInstallDate}
                  >
                    <Text style={styles.modalButtonText}>Set Install Date</Text>
                  </TouchableOpacity>
                </View>
              </LinearGradient>
            </View>
          </Modal>

          
		  {/* Edit Due Date Modal - RESPONSIVE PARA SA CP */}
<Modal visible={editDueModalVisible} transparent animationType="fade">
  <View style={{
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.9)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: width * 0.04, // 4% ng screen width
  }}>
    <LinearGradient colors={['#1e293b', '#0f172a']} style={{
      width: '100%',
      maxWidth: 400,
      borderRadius: 12,
      padding: width * 0.05, // 5% ng screen width
      borderWidth: 1,
      borderColor: '#334155',
    }}>
      
      {/* Title - Adjust font size based on screen */}
      <Text style={{ 
        color: '#60a5fa', 
        fontSize: width < 360 ? 18 : 20, 
        fontWeight: 'bold', 
        textAlign: 'center', 
        marginBottom: width * 0.04 
      }}>
        ✏️ Edit Due Date
      </Text>
      
      {/* IP Address */}
      <View style={{ 
        backgroundColor: '#0f172a', 
        padding: width * 0.03, 
        borderRadius: 8, 
        marginBottom: width * 0.04 
      }}>
        <Text style={{ color: '#94a3b8', fontSize: width < 360 ? 11 : 12 }}>IP Address:</Text>
        <Text style={{ 
          color: '#fff', 
          fontSize: width < 360 ? 14 : 16, 
          fontWeight: 'bold' 
        }}>
          {editingDueItem?.address}
        </Text>
      </View>
      
      {/* Current Due */}
      <View style={{ marginBottom: width * 0.04 }}>
        <Text style={{ color: '#94a3b8', fontSize: width < 360 ? 11 : 12, marginBottom: 4 }}>
          Current Due Date:
        </Text>
        <Text style={{ color: '#f59e0b', fontSize: width < 360 ? 14 : 16 }}>
          {editingDueItem?.dueDate || 'N/A'}
        </Text>
      </View>
      
      {/* New Due Date Label */}
      <Text style={{ 
        color: '#fff', 
        fontSize: width < 360 ? 13 : 14, 
        marginBottom: width * 0.02 
      }}>
        New Due Date (MM-DD-YY):
      </Text>
      
      {/* Date Input - Responsive spacing */}
      <View style={{ 
        flexDirection: 'row', 
        gap: width * 0.02, 
        marginBottom: width * 0.05 
      }}>
        <TextInput
          style={{
            flex: 1,
            backgroundColor: '#0f172a',
            color: '#fff',
            fontSize: width < 360 ? 14 : 16,
            textAlign: 'center',
            paddingVertical: width < 360 ? 10 : 12,
            borderRadius: 6,
            borderWidth: 1,
            borderColor: '#4b5563'
          }}
          value={editDueMonth}
          onChangeText={setEditDueMonth}
          placeholder="MM"
          placeholderTextColor="#4b5563"
          maxLength={2}
          keyboardType="numeric"
        />
        <Text style={{ 
          color: '#94a3b8', 
          fontSize: width < 360 ? 16 : 20, 
          lineHeight: width < 360 ? 35 : 40 
        }}>-</Text>
        <TextInput
          style={{
            flex: 1,
            backgroundColor: '#0f172a',
            color: '#fff',
            fontSize: width < 360 ? 14 : 16,
            textAlign: 'center',
            paddingVertical: width < 360 ? 10 : 12,
            borderRadius: 6,
            borderWidth: 1,
            borderColor: '#4b5563'
          }}
          value={editDueDay}
          onChangeText={setEditDueDay}
          placeholder="DD"
          placeholderTextColor="#4b5563"
          maxLength={2}
          keyboardType="numeric"
        />
        <Text style={{ 
          color: '#94a3b8', 
          fontSize: width < 360 ? 16 : 20, 
          lineHeight: width < 360 ? 35 : 40 
        }}>-</Text>
        <TextInput
          style={{
            flex: 1,
            backgroundColor: '#0f172a',
            color: '#fff',
            fontSize: width < 360 ? 14 : 16,
            textAlign: 'center',
            paddingVertical: width < 360 ? 10 : 12,
            borderRadius: 6,
            borderWidth: 1,
            borderColor: '#4b5563'
          }}
          value={editDueYear}
          onChangeText={setEditDueYear}
          placeholder="YY"
          placeholderTextColor="#4b5563"
          maxLength={2}
          keyboardType="numeric"
        />
      </View>
      
      {/* Preview */}
      {editDueMonth && editDueDay && editDueYear && (
        <View style={{ 
          backgroundColor: '#1e3a5f', 
          padding: width * 0.03, 
          borderRadius: 6, 
          marginBottom: width * 0.04 
        }}>
          <Text style={{ color: '#93c5fd', fontSize: width < 360 ? 11 : 12 }}>
            New due date will be:
          </Text>
          <Text style={{ 
            color: '#fff', 
            fontSize: width < 360 ? 14 : 16, 
            fontWeight: 'bold' 
          }}>
            {editDueMonth.padStart(2,'0')}-{editDueDay.padStart(2,'0')}-{editDueYear.padStart(2,'0')}
          </Text>
        </View>
      )}
      
      {/* Reason */}
      <Text style={{ 
        color: '#fff', 
        fontSize: width < 360 ? 13 : 14, 
        marginBottom: width * 0.02 
      }}>
        Reason (optional):
      </Text>
      <TextInput
        style={{
          backgroundColor: '#0f172a',
          color: '#fff',
          fontSize: width < 360 ? 13 : 14,
          padding: width * 0.03,
          borderRadius: 6,
          borderWidth: 1,
          borderColor: '#4b5563',
          marginBottom: width * 0.05,
          minHeight: width < 360 ? 50 : 60,
          textAlignVertical: 'top'
        }}
        value={editDueReason}
        onChangeText={setEditDueReason}
        placeholder="e.g., Client request"
        placeholderTextColor="#4b5563"
        multiline
      />
      
      {/* Buttons */}
      <View style={{ flexDirection: 'row', gap: width * 0.02 }}>
        <TouchableOpacity 
          style={{ 
            flex: 1, 
            backgroundColor: '#4b5563', 
            padding: width * 0.03, 
            borderRadius: 6, 
            alignItems: 'center' 
          }}
          onPress={() => {
            setEditDueModalVisible(false);
            setEditDueMonth("");
            setEditDueDay("");
            setEditDueYear("");
            setEditDueReason("");
          }}
        >
          <Text style={{ 
            color: '#fff', 
            fontWeight: 'bold',
            fontSize: width < 360 ? 13 : 14 
          }}>Cancel</Text>
        </TouchableOpacity>
        
        <TouchableOpacity 
          style={{ 
            flex: 1, 
            backgroundColor: '#2563eb', 
            padding: width * 0.03, 
            borderRadius: 6, 
            alignItems: 'center' 
          }}
          onPress={applyDueDateEdit}
        >
          <Text style={{ 
            color: '#fff', 
            fontWeight: 'bold',
            fontSize: width < 360 ? 13 : 14 
          }}>Update</Text>
        </TouchableOpacity>
      </View>
      
    </LinearGradient>
  </View>
</Modal>
		  
		  
        </SafeAreaView>
      </LinearGradient>
    );
  }

  // ==========================================================================
  // QUEUES PAGE (SIMPLE QUEUES)
  // ==========================================================================
  if (page === "ipoe" && ipoePage === "queues") {
    const filteredQueues = simpleQueues.filter(q => 
      q.name?.toLowerCase().includes(simpleQueueSearch.toLowerCase()) ||
      q.target?.toLowerCase().includes(simpleQueueSearch.toLowerCase()) ||
      q.comment?.toLowerCase().includes(simpleQueueSearch.toLowerCase())
    );

    return (
      <LinearGradient colors={['#0b1120', '#1a2639']} style={styles.container}>
        <StatusBar barStyle="light-content" />
        <SafeAreaView style={styles.safeArea}>
          <View style={styles.pageHeader}>
            <TouchableOpacity onPress={() => setIpoePage("home")} style={styles.backButton}>
              <MaterialIcons name="arrow-back" size={20} color="#38bdf8" />
            </TouchableOpacity>
            <Text style={styles.pageTitle}>Simple Queues</Text>
            <TouchableOpacity onPress={fetchSimpleQueues} style={styles.refreshButton}>
              <Feather name="refresh-cw" size={18} color="#38bdf8" />
            </TouchableOpacity>
          </View>

          <View style={styles.smallStatusBar}>
            <View style={[styles.smallStatusDot, { backgroundColor: '#22c55e' }]} />
            <Text style={styles.smallStatusText}>{apiUrl}</Text>
          </View>

          <TouchableOpacity 
            activeOpacity={0.8} 
            onPress={scanAllQueues}
            style={{ marginHorizontal: 12, marginBottom: 12 }}
          >
            <LinearGradient colors={['#8b5cf6', '#7c3aed']} style={styles.addButton}>
              <Feather name="search" size={16} color="#fff" />
              <Text style={styles.addButtonText}>Sync All Queues</Text>
            </LinearGradient>
          </TouchableOpacity>

          <View style={styles.searchContainer}>
            <Feather name="search" size={16} color="#64748b" style={styles.searchIcon} />
            <TextInput
              placeholder="Search queues..."
              placeholderTextColor="#64748b"
              style={styles.searchInput}
              value={simpleQueueSearch}
              onChangeText={setSimpleQueueSearch}
            />
          </View>

          {simpleQueueLoading ? (
            <View style={styles.centerContent}>
              <ActivityIndicator size="large" color="#38bdf8" />
              <Text style={styles.loadingText}>Loading queues...</Text>
            </View>
          ) : (
            <FlatList
              data={filteredQueues}
              keyExtractor={(item) => item[".id"]}
              showsVerticalScrollIndicator={false}
              ListFooterComponent={<View style={{ height: 80 }} />}
              ListEmptyComponent={
                <View style={styles.emptyContainer}>
                  <Feather name="bar-chart-2" size={40} color="#4b5563" />
                  <Text style={styles.emptyText}>No queues found</Text>
                </View>
              }
              renderItem={({ item }) => {
                const planMatch = item.comment?.match(/PLAN=(\d+)/);
                const planNumber = planMatch ? planMatch[1] : "?";
                
                return (
                  <LinearGradient colors={['#1e293b', '#0f172a']} style={styles.addressCard}>
                    <View style={styles.addressCardHeader}>
                      <View style={styles.addressIpContainer}>
                        <Feather name="activity" size={14} color="#f59e0b" />
                        <Text style={styles.addressIp} numberOfLines={1}>
                          {item.name || "Unnamed"}
                        </Text>
                      </View>
                      <LinearGradient 
                        colors={['#f59e0b', '#d97706']} 
                        style={styles.addressStatus}
                      >
                        <Text style={styles.addressStatusText}>PLAN {planNumber}</Text>
                      </LinearGradient>
                    </View>

                    <View style={{ marginTop: 8 }}>
                      <View style={styles.detailRow}>
                        <Feather name="wifi" size={12} color="#38bdf8" />
                        <Text style={styles.detailText}>IP: {item.target}</Text>
                      </View>

                      {item["max-limit"] && (
                        <View style={styles.detailRow}>
                          <Feather name="arrow-up" size={12} color="#10b981" />
                          <Text style={styles.detailText}>Speed: {item["max-limit"]}</Text>
                        </View>
                      )}

                      {item.comment && (
                        <View style={[styles.detailRow, { marginTop: 4 }]}>
                          <Feather name="message-circle" size={12} color="#64748b" />
                          <Text style={styles.detailText} numberOfLines={1}>
                            {item.comment}
                          </Text>
                        </View>
                      )}
                    </View>
                  </LinearGradient>
                );
              }}
            />
          )}
        </SafeAreaView>
      </LinearGradient>
    );
  }

  // ==========================================================================
  // CLIENT DATABASE PAGE
  // ==========================================================================
  if (page === "ipoe" && ipoePage === "clients") {
    return (
      <LinearGradient colors={['#0b1120', '#1a2639']} style={styles.container}>
        <StatusBar barStyle="light-content" />
        <SafeAreaView style={styles.safeArea}>
          <View style={styles.pageHeader}>
            <TouchableOpacity onPress={() => setIpoePage("home")} style={styles.backButton}>
              <MaterialIcons name="arrow-back" size={20} color="#38bdf8" />
            </TouchableOpacity>
            <Text style={styles.pageTitle}>Client Database</Text>
            <TouchableOpacity onPress={() => refreshAllData()} style={styles.refreshButton}>
              <Feather name="refresh-cw" size={18} color="#38bdf8" />
            </TouchableOpacity>
          </View>

          <View style={styles.smallStatusBar}>
            <View style={[styles.smallStatusDot, { backgroundColor: '#22c55e' }]} />
            <Text style={styles.smallStatusText}>{apiUrl}</Text>
          </View>

          <FlatList
            data={clientDatabase}
            keyExtractor={(item) => item.id}
            showsVerticalScrollIndicator={false}
            ListFooterComponent={<View style={{ height: 80 }} />}
            ListEmptyComponent={
              <View style={styles.emptyContainer}>
                <Feather name="database" size={40} color="#4b5563" />
                <Text style={styles.emptyText}>No clients registered yet</Text>
                <Text style={{ color: '#64748b', fontSize: 12, marginTop: 8 }}>
                  Convert a DHCP lease to add your first client
                </Text>
              </View>
            }
            renderItem={({ item }) => (
              <View>
                <TouchableOpacity
                  activeOpacity={0.7}
                  onPress={() => {
                    setSelectedClient(item);
                    setClientDetailsModal(true);
                  }}
                >
                  <LinearGradient colors={['#1e293b', '#0f172a']} style={styles.addressCard}>
                    <View style={styles.addressCardHeader}>
                      <View style={styles.addressIpContainer}>
                        <Feather name="user" size={14} color="#8b5cf6" />
                        <Text style={styles.addressIp}>{item.name}</Text>
                      </View>
                      <LinearGradient colors={['#8b5cf6', '#7c3aed']} style={styles.addressStatus}>
                        <Text style={styles.addressStatusText}>{item.plan}</Text>
                      </LinearGradient>
                    </View>
                    
                    <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4 }}>
                      <Feather name="wifi" size={10} color="#38bdf8" />
                      <Text style={{ color: '#94a3b8', fontSize: 10, marginLeft: 4 }}>{item.ip}</Text>
                    </View>
                    
                    <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 2 }}>
                      <Feather name="calendar" size={10} color="#f59e0b" />
                      <Text style={{ color: '#94a3b8', fontSize: 10, marginLeft: 4 }}>
                        Due: {item.dueDate}
                      </Text>
                    </View>

                    <View style={styles.actionsRow}>
                      <TouchableOpacity
                        activeOpacity={0.8}
                        style={styles.actionButton}
                        onPress={() => openEditClientModal(item)}
                      >
                        <LinearGradient colors={['#3b82f6', '#2563eb']} style={styles.actionButtonGradient}>
                          <Feather name="edit-2" size={12} color="#fff" />
                          <Text style={styles.actionButtonText}>Edit</Text>
                        </LinearGradient>
                      </TouchableOpacity>

                      <TouchableOpacity
                        activeOpacity={0.8}
                        style={styles.actionButton}
                        onPress={() => confirmDeleteClient(item)}
                      >
                        <LinearGradient colors={['#ef4444', '#dc2626']} style={styles.actionButtonGradient}>
                          <Feather name="trash-2" size={12} color="#fff" />
                          <Text style={styles.actionButtonText}>Delete</Text>
                        </LinearGradient>
                      </TouchableOpacity>
                    </View>
                  </LinearGradient>
                </TouchableOpacity>
              </View>
            )}
          />

          {/* Client Details Modal */}
          <Modal visible={clientDetailsModal} transparent animationType="fade">
            <View style={styles.modalOverlay}>
              <LinearGradient colors={['#1e293b', '#0f172a']} style={[styles.modalContent, { maxHeight: 600 }]}>
                
                <View style={{ alignItems: 'center', marginBottom: 16 }}>
                  <View style={{ backgroundColor: '#8b5cf6', padding: 16, borderRadius: 50, marginBottom: 12 }}>
                    <Feather name="user" size={28} color="#fff" />
                  </View>
                  <Text style={[styles.modalTitle, { color: '#8b5cf6' }]}>Client Information</Text>
                  <Text style={{ color: '#94a3b8', fontSize: 12 }}>{selectedClient?.ip}</Text>
                </View>
                
                <ScrollView showsVerticalScrollIndicator={false}>
                  
                  <View style={{ marginBottom: 16, backgroundColor: '#0f172a', padding: 12, borderRadius: 8 }}>
                    <Text style={{ color: '#8b5cf6', fontSize: 14, fontWeight: 'bold', marginBottom: 8 }}>👤 Personal Information</Text>
                    
                    <View style={{ flexDirection: 'row', marginBottom: 6 }}>
                      <Text style={{ color: '#94a3b8', width: 80 }}>Name:</Text>
                      <Text style={{ color: '#fff', flex: 1 }}>{selectedClient?.name}</Text>
                    </View>
                    
                    <View style={{ flexDirection: 'row', marginBottom: 6 }}>
                      <Text style={{ color: '#94a3b8', width: 80 }}>Plan:</Text>
                      <Text style={{ color: '#fff', flex: 1 }}>{selectedClient?.plan}</Text>
                    </View>
                    
                    {selectedClient?.address ? (
                      <View style={{ flexDirection: 'row', marginBottom: 6 }}>
                        <Text style={{ color: '#94a3b8', width: 80 }}>Address:</Text>
                        <Text style={{ color: '#fff', flex: 1 }}>{selectedClient?.address}</Text>
                      </View>
                    ) : null}
                    
                    {selectedClient?.cpNumber ? (
                      <View style={{ flexDirection: 'row', marginBottom: 6 }}>
                        <Text style={{ color: '#94a3b8', width: 80 }}>CP #:</Text>
                        <Text style={{ color: '#fff', flex: 1 }}>{selectedClient?.cpNumber}</Text>
                      </View>
                    ) : null}
                  </View>
                  
                  <View style={{ marginBottom: 16, backgroundColor: '#0f172a', padding: 12, borderRadius: 8 }}>
                    <Text style={{ color: '#f59e0b', fontSize: 14, fontWeight: 'bold', marginBottom: 8 }}>📅 Dates</Text>
                    
                    <View style={{ flexDirection: 'row', marginBottom: 6 }}>
                      <Text style={{ color: '#94a3b8', width: 80 }}>Installed:</Text>
                      <Text style={{ color: '#fff' }}>{selectedClient?.installDate}</Text>
                    </View>
                    
                    <View style={{ flexDirection: 'row', marginBottom: 6 }}>
                      <Text style={{ color: '#94a3b8', width: 80 }}>Due Date:</Text>
                      <Text style={{ color: '#fff', fontWeight: 'bold' }}>{selectedClient?.dueDate}</Text>
                    </View>
                    
                    <View style={{ flexDirection: 'row', marginTop: 8 }}>
                      <View style={[styles.statusDot, { backgroundColor: '#22c55e', marginRight: 8 }]} />
                      <Text style={{ color: '#fff' }}>Status: Active</Text>
                    </View>
                  </View>
                  
                  <View style={styles.modalActions}>
                    <TouchableOpacity 
                      style={[styles.modalButton, styles.cancelButton]} 
                      onPress={() => setClientDetailsModal(false)}
                    >
                      <Text style={styles.modalButtonText}>Close</Text>
                    </TouchableOpacity>
                  </View>
                  
                </ScrollView>
              </LinearGradient>
            </View>
          </Modal>

          {/* Edit Client Modal */}
          <Modal visible={editClientModal} transparent animationType="fade">
            <View style={styles.modalOverlay}>
              <LinearGradient colors={['#1e293b', '#0f172a']} style={[styles.modalContent, { maxHeight: 600 }]}>
                
                <View style={{ alignItems: 'center', marginBottom: 16 }}>
                  <View style={{ backgroundColor: '#3b82f6', padding: 16, borderRadius: 50, marginBottom: 12 }}>
                    <Feather name="edit-2" size={28} color="#fff" />
                  </View>
                  <Text style={[styles.modalTitle, { color: '#3b82f6' }]}>Edit Client</Text>
                  <Text style={{ color: '#94a3b8', fontSize: 12 }}>{editingClient?.ip}</Text>
                </View>
                
                <ScrollView showsVerticalScrollIndicator={false}>
                  
                  <View style={{ marginBottom: 12 }}>
                    <Text style={[styles.modalLabel, { color: '#e2e8f0' }]}>👤 Client Name</Text>
                    <View style={styles.modalInputContainer}>
                      <Feather name="user" size={16} color="#64748b" style={styles.modalInputIcon} />
                      <TextInput
                        style={styles.modalInputWithIcon}
                        value={editClientName}
                        onChangeText={setEditClientName}
                        placeholder="Client name"
                        placeholderTextColor="#64748b"
                      />
                    </View>
                  </View>
                  
                  <View style={{ marginBottom: 12 }}>
                    <Text style={[styles.modalLabel, { color: '#e2e8f0' }]}>📶 Plan</Text>
                    <View style={styles.modalInputContainer}>
                      <Feather name="wifi" size={16} color="#64748b" style={styles.modalInputIcon} />
                      <TextInput
                        style={styles.modalInputWithIcon}
                        value={editClientPlan}
                        onChangeText={setEditClientPlan}
                        placeholder="Plan"
                        placeholderTextColor="#64748b"
                      />
                    </View>
                  </View>
                  
                  <View style={{ marginBottom: 12 }}>
                    <Text style={[styles.modalLabel, { color: '#e2e8f0' }]}>🏠 Address</Text>
                    <View style={styles.modalInputContainer}>
                      <Feather name="map-pin" size={16} color="#64748b" style={styles.modalInputIcon} />
                      <TextInput
                        style={styles.modalInputWithIcon}
                        value={editClientAddress}
                        onChangeText={setEditClientAddress}
                        placeholder="Address"
                        placeholderTextColor="#64748b"
                      />
                    </View>
                  </View>
                  
                  <View style={{ marginBottom: 12 }}>
                    <Text style={[styles.modalLabel, { color: '#e2e8f0' }]}>📱 CP Number</Text>
                    <View style={styles.modalInputContainer}>
                      <Feather name="phone" size={16} color="#64748b" style={styles.modalInputIcon} />
                      <TextInput
                        style={styles.modalInputWithIcon}
                        value={editClientCpNumber}
                        onChangeText={setEditClientCpNumber}
                        placeholder="CP Number"
                        placeholderTextColor="#64748b"
                        keyboardType="phone-pad"
                      />
                    </View>
                  </View>
                  
                  {/* Install Date with Recalculate Button */}
                  <View style={{ marginBottom: 16 }}>
                    <Text style={[styles.modalLabel, { color: '#e2e8f0' }]}>📅 Install Date (MM-DD-YY)</Text>
                    <View style={{ flexDirection: 'row', gap: 8 }}>
                      <View style={[styles.modalInputContainer, { flex: 3 }]}>
                        <Feather name="calendar" size={16} color="#64748b" style={styles.modalInputIcon} />
                        <TextInput
                          style={styles.modalInputWithIcon}
                          value={editClientInstallDate}
                          onChangeText={setEditClientInstallDate}
                          placeholder="MM-DD-YY"
                          placeholderTextColor="#64748b"
                        />
                      </View>
                      <TouchableOpacity 
                        style={{ flex: 1, backgroundColor: '#f59e0b', borderRadius: 8, justifyContent: 'center', alignItems: 'center' }}
                        onPress={recalculateDueDate}
                      >
                        <Text style={{ color: '#fff', fontWeight: 'bold', fontSize: 12 }}>⟳ Due</Text>
                      </TouchableOpacity>
                    </View>
                  </View>

                  {/* Due Date */}
                  <View style={{ marginBottom: 16 }}>
                    <Text style={[styles.modalLabel, { color: '#e2e8f0' }]}>📅 Due Date (auto-computed)</Text>
                    <View style={[styles.modalInputContainer, { backgroundColor: '#1e293b' }]}>
                      <Feather name="calendar" size={16} color="#f59e0b" style={styles.modalInputIcon} />
                      <TextInput
                        style={[styles.modalInputWithIcon, { color: '#f59e0b' }]}
                        value={editClientDueDate}
                        onChangeText={setEditClientDueDate}
                        placeholder="MM-DD-YY"
                        placeholderTextColor="#64748b"
                        editable={true}
                      />
                    </View>
                    <Text style={{ color: '#94a3b8', fontSize: 10, marginTop: 4 }}>
                      Due date = Install date + 35 days
                    </Text>
                  </View>
                  
                  <View style={styles.modalActions}>
                    <TouchableOpacity 
                      style={[styles.modalButton, styles.cancelButton]} 
                      onPress={() => setEditClientModal(false)}
                    >
                      <Text style={styles.modalButtonText}>Cancel</Text>
                    </TouchableOpacity>
                    
                    <TouchableOpacity 
                      style={[styles.modalButton, { backgroundColor: '#3b82f6' }]} 
                      onPress={() => {
                        console.log("👆 Save Changes button pressed");
                        saveClientEdit();
                      }}
                    >
                      <Text style={styles.modalButtonText}>Save Changes</Text>
                    </TouchableOpacity>
                  </View>
                  
                </ScrollView>
              </LinearGradient>
            </View>
          </Modal>
        </SafeAreaView>
      </LinearGradient>
    );
  }

  // ==========================================================================
  // BILLING OVERVIEW PAGE
  // ==========================================================================
  if (page === "ipoe" && ipoePage === "billing") {
    const reportData = getRevenueReport();

    return (
      <LinearGradient colors={['#0b1120', '#1a2639']} style={styles.container}>
        <StatusBar barStyle="light-content" />
        <SafeAreaView style={styles.safeArea}>
          <View style={styles.pageHeader}>
            <TouchableOpacity onPress={() => setIpoePage("home")} style={styles.backButton}>
              <MaterialIcons name="arrow-back" size={20} color="#38bdf8" />
            </TouchableOpacity>
            <Text style={styles.pageTitle}>Billing Overview</Text>
            <TouchableOpacity onPress={() => refreshAllData()} style={styles.refreshButton}>
              <Feather name="refresh-cw" size={18} color="#38bdf8" />
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.content}>
            <LinearGradient colors={['#1e293b', '#0f172a']} style={styles.card}>
              <Text style={styles.cardTitle}>💰 Revenue Summary</Text>
              <Text style={{ fontSize: 36, fontWeight: 'bold', color: '#10b981', marginTop: 8 }}>
                ₱{reportData.totalRevenue.toLocaleString()}
              </Text>
              <Text style={{ color: '#94a3b8', marginTop: 4 }}>
                Total Revenue
              </Text>
            </LinearGradient>

            <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
              <LinearGradient colors={['#1e293b', '#0f172a']} style={[styles.card, { flex: 1 }]}>
                <Text style={styles.cardTitle}>📊 Collection Rate</Text>
                <Text style={{ fontSize: 24, fontWeight: 'bold', color: '#38bdf8' }}>
                  {reportData.collectionRate}%
                </Text>
              </LinearGradient>

              <LinearGradient colors={['#1e293b', '#0f172a']} style={[styles.card, { flex: 1 }]}>
                <Text style={styles.cardTitle}>💰 Avg/Client</Text>
                <Text style={{ fontSize: 24, fontWeight: 'bold', color: '#f59e0b' }}>
                  ₱{reportData.averageRevenue}
                </Text>
              </LinearGradient>
            </View>

            <LinearGradient colors={['#1e293b', '#0f172a']} style={styles.card}>
              <Text style={styles.cardTitle}>📊 Collection Efficiency</Text>
              <View style={{ marginTop: 16 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
                  <Text style={{ color: '#94a3b8' }}>Collection Rate</Text>
                  <Text style={{ color: '#fff', fontWeight: 'bold' }}>{reportData.collectionRate}%</Text>
                </View>
                <View style={{ height: 8, backgroundColor: '#334155', borderRadius: 4 }}>
                  <View style={{ width: `${reportData.collectionRate}%`, height: 8, backgroundColor: '#10b981', borderRadius: 4 }} />
                </View>
              </View>

              <View style={{ marginTop: 16 }}>
                <View style={styles.detailRow}>
                  <Text style={{ color: '#94a3b8' }}>Total Clients:</Text>
                  <Text style={{ color: '#fff' }}>{reportData.totalClients}</Text>
                </View>
                <View style={styles.detailRow}>
                  <Text style={{ color: '#94a3b8' }}>Active Clients:</Text>
                  <Text style={{ color: '#22c55e' }}>{reportData.activeClients}</Text>
                </View>
                <View style={styles.detailRow}>
                  <Text style={{ color: '#94a3b8' }}>Overdue Clients:</Text>
                  <Text style={{ color: '#ef4444' }}>{reportData.overdueClients}</Text>
                </View>
              </View>
            </LinearGradient>

            <LinearGradient colors={['#1e293b', '#0f172a']} style={styles.card}>
              <Text style={styles.cardTitle}>💳 Recent Payments</Text>
              {reportData.payments.length === 0 ? (
                <Text style={styles.noLogs}>No payments in this period</Text>
              ) : (
                reportData.payments.slice(0, 5).map((payment, index) => (
                  <View key={index} style={styles.dueItemContainer}>
                    <View style={styles.dueItem}>
                      <View>
                        <Text style={styles.dueAddress}>{payment.clientName}</Text>
                        <Text style={{ color: '#94a3b8', fontSize: 10 }}>{payment.paymentDate}</Text>
                      </View>
                      <Text style={{ color: '#10b981', fontWeight: 'bold' }}>₱{payment.amount}</Text>
                    </View>
                  </View>
                ))
              )}
            </LinearGradient>
          </ScrollView>
        </SafeAreaView>
      </LinearGradient>
    );
  }

  // ==========================================================================
// INVOICE PAGE - FIXED ACTIONS
// ==========================================================================
if (page === "ipoe" && ipoePage === "invoices") {
  
  const pendingInvoices = invoices.filter(i => i.status === 'pending');
  const paidInvoices = invoices.filter(i => i.status === 'paid');
  const overdueInvoices = invoices.filter(i => i.status === 'overdue');
  
  
  
  
  
  // ==========================================================================
  // CREATE MANUAL INVOICE - I-ADD DITO
  // ==========================================================================
  const handleCreateInvoice = async () => {
    if (!selectedClientForInvoice) {
      Alert.alert("Error", "Please select a client");
      return;
    }

    const amount = parseInt(invoiceAmount);
    if (isNaN(amount) || amount <= 0) {
      Alert.alert("Error", "Please enter a valid amount");
      return;
    }

    try {
      const today = new Date();
      const dueDate = invoiceDueDate || new Date(today.setDate(today.getDate() + 30)).toISOString().split('T')[0];
      
      const newInvoice = {
        id: `INV-${Date.now()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`,
        clientId: selectedClientForInvoice.ip,
        clientName: selectedClientForInvoice.name,
        clientIp: selectedClientForInvoice.ip,
        planName: selectedClientForInvoice.plan || "Manual Invoice",
        amount: amount,
        dueDate: dueDate,
        issueDate: new Date().toISOString().split('T')[0],
        status: 'pending'
      };

      console.log("📝 Creating invoice:", newInvoice);

      // Save to backend
      await axios.post(`${apiUrl}/api/invoices`, newInvoice);
      
      // Update local state
      setInvoices(prev => [newInvoice, ...prev]);
      
      // Reset form
      setManualInvoiceModal(false);
      setSelectedClientForInvoice(null);
      setInvoiceAmount("");
      setInvoiceDueDate("");
      
      Alert.alert("✅ Success", "Invoice created successfully");
      addLog(`💰 Invoice created for ${selectedClientForInvoice.name}: ₱${amount}`, 'success');

    } catch (error: any) {
      console.log("❌ Failed to create invoice:", error.message);
      Alert.alert("Error", "Failed to create invoice");
    }
  };
  
  
  
  
  

  // ==========================================================================
  // DOWNLOAD INVOICE (HTML format)
  // ==========================================================================
  const handleDownloadInvoice = (invoice: Invoice) => {
    try {
      console.log("📥 Downloading invoice:", invoice.id);
      
      const invoiceHTML = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Invoice ${invoice.id}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; font-family: Arial, sans-serif; }
    body { background: #f0f2f5; padding: 20px; }
    .invoice { max-width: 800px; margin: 0 auto; background: white; border-radius: 10px; box-shadow: 0 5px 15px rgba(0,0,0,0.2); overflow: hidden; }
    .header { background: #1a2639; color: white; padding: 30px; text-align: center; }
    .header h1 { font-size: 28px; margin-bottom: 5px; }
    .content { padding: 30px; }
    .row { display: flex; justify-content: space-between; margin-bottom: 15px; padding-bottom: 15px; border-bottom: 1px solid #e2e8f0; }
    .label { color: #64748b; font-weight: 600; }
    .value { color: #1e293b; font-weight: 500; }
    .client-info { background: #f8fafc; padding: 20px; border-radius: 8px; margin-bottom: 20px; }
    .client-info h3 { color: #1e293b; margin-bottom: 15px; }
    .total { background: #1a2639; color: white; padding: 20px; border-radius: 8px; display: flex; justify-content: space-between; align-items: center; margin: 20px 0; }
    .total .amount { font-size: 24px; font-weight: bold; color: #48bb78; }
    .status { display: inline-block; padding: 8px 20px; border-radius: 20px; font-weight: bold; text-transform: uppercase; font-size: 12px; }
    .status-paid { background: #48bb78; color: white; }
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
          <span class="label">Client:</span> ${invoice.clientName}<br>
          <span class="label">IP Address:</span> ${invoice.clientIp}<br>
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
          <td style="padding: 10px; text-align: right;">₱${invoice.amount.toFixed(2)}</td>
        </tr>
      </table>

      <div class="total">
        <span>Total Amount:</span>
        <span class="amount">₱${invoice.amount.toLocaleString()}</span>
      </div>

      <div style="text-align: center; margin: 20px 0;">
        <span class="status status-${invoice.status}">${invoice.status.toUpperCase()}</span>
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
      `;

      const blob = new Blob([invoiceHTML], { type: 'text/html' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `invoice-${invoice.id}.html`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      
      Alert.alert("✅ Success", "Invoice downloaded successfully");
      addLog(`📄 Downloaded invoice ${invoice.id}`, 'info');
    } catch (error) {
      console.error("Download error:", error);
      Alert.alert("Error", "Failed to download invoice");
    }
  };

  // ==========================================================================
// MARK AS PAID - SIMPLIFIED VERSION
// ==========================================================================
const handleMarkAsPaid = (invoice: Invoice) => {
  console.log("💰 PAID BUTTON CLICKED");
  console.log("Invoice:", invoice);
  console.log("API URL:", apiUrl);

  // Simple confirmation
  if (window.confirm(`Process payment for ${invoice.clientName}?`)) {
    processPayment(invoice);
  }
};

// Separate function for actual payment processing
const processPayment = async (invoice: Invoice) => {
  try {
    console.log("📤 Processing payment...");
    
    const payment = {
      id: `PAY-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      invoiceId: invoice.id,
      clientId: invoice.clientId,
      clientName: invoice.clientName,
      amount: invoice.amount,
      paymentDate: new Date().toISOString().split('T')[0],
      paymentMethod: 'cash',
      reference: `REF-${Date.now()}`
    };
    
    console.log("Payment data:", payment);
    
    // Save payment to backend
    console.log("📡 POST to:", `${apiUrl}/api/payments`);
    const paymentRes = await axios.post(`${apiUrl}/api/payments`, payment);
    console.log("✅ Payment saved:", paymentRes.data);
    
    // Update invoice status
    const updatedInvoice = { 
      ...invoice, 
      status: 'paid', 
      paymentDate: payment.paymentDate,
      paymentMethod: payment.paymentMethod,
      reference: payment.reference
    };
    
    console.log("📡 PUT to:", `${apiUrl}/api/invoices/${invoice.id}`);
    const invoiceRes = await axios.put(`${apiUrl}/api/invoices/${invoice.id}`, updatedInvoice);
    console.log("✅ Invoice updated:", invoiceRes.data);
    
    // Update local state
    setPayments(prev => [payment, ...prev]);
    setInvoices(prev => prev.map(inv => inv.id === invoice.id ? updatedInvoice : inv));
    
    // Enable internet if disabled
    try {
      console.log("📡 Enabling internet for:", invoice.clientIp);
      await axios.post(`${apiUrl}/enable-ip`, { ip: invoice.clientIp });
      console.log("✅ Internet enabled");
    } catch (e) {
      console.log("⚠️ Failed to enable internet:", e);
    }
    
    alert("✅ Payment processed successfully");
    addLog(`💰 Payment recorded: ₱${invoice.amount} from ${invoice.clientName}`, 'success');
    
  } catch (error: any) {
    console.error("❌ ERROR:", error);
    console.error("Response:", error.response?.data);
    console.error("Status:", error.response?.status);
    alert("Error: " + (error.response?.data?.error || error.message));
  }
};

  // ==========================================================================
// DELETE INVOICE - SIMPLIFIED VERSION
// ==========================================================================
const handleDeleteInvoice = (invoice: Invoice) => {
  console.log("🗑️ DELETE BUTTON CLICKED");
  console.log("Invoice:", invoice);
  
  if (invoice.status === 'paid') {
    alert("Paid invoices cannot be deleted");
    return;
  }

  if (window.confirm(`Delete invoice for ${invoice.clientName}?`)) {
    deleteInvoice(invoice);
  }
};

const deleteInvoice = async (invoice: Invoice) => {
  try {
    console.log("📤 Sending DELETE request to:", `${apiUrl}/api/invoices/${invoice.id}`);
    
    const response = await axios.delete(`${apiUrl}/api/invoices/${invoice.id}`);
    console.log("✅ Server response:", response.data);
    
    setInvoices(prev => prev.filter(inv => inv.id !== invoice.id));
    
    alert("✅ Invoice deleted successfully");
    addLog(`🗑️ Invoice ${invoice.id} deleted`, 'info');
    
  } catch (error: any) {
    console.error("❌ DELETE ERROR:", error);
    console.error("Response:", error.response?.data);
    console.error("Status:", error.response?.status);
    alert("Error: " + (error.response?.data?.error || error.message));
  }
};

  // ==========================================================================
  // VIEW INVOICE DETAILS
  // ==========================================================================
  const handleViewInvoice = (invoice: Invoice) => {
    console.log("👀 Viewing invoice:", invoice.id);
    setSelectedInvoice(invoice);
    setInvoiceModal(true);
  };

  return (
    <LinearGradient colors={['#0b1120', '#1a2639']} style={styles.container}>
      <StatusBar barStyle="light-content" />
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.pageHeader}>
          <TouchableOpacity onPress={() => setIpoePage("home")} style={styles.backButton}>
            <Feather name="arrow-left" size={20} color="#38bdf8" />
          </TouchableOpacity>
          <Text style={styles.pageTitle}>💰 Invoices</Text>
          <TouchableOpacity 
            onPress={() => {
              if (clientDatabase.length === 0) {
                Alert.alert("No Clients", "Please add a client first");
                return;
              }
              setManualInvoiceModal(true);
            }} 
            style={styles.refreshButton}
          >
            <Feather name="plus" size={18} color="#38bdf8" />
          </TouchableOpacity>
        </View>

        <View style={styles.smallStatusBar}>
          <View style={[styles.smallStatusDot, { backgroundColor: '#22c55e' }]} />
          <Text style={styles.smallStatusText}>{apiUrl}</Text>
        </View>

        {/* Stats Cards */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.statsScroll}>
          <LinearGradient colors={['#1e293b', '#0f172a']} style={styles.statCardLarge}>
            <Feather name="clock" size={24} color="#f59e0b" />
            <Text style={styles.statNumberLarge}>{pendingInvoices.length}</Text>
            <Text style={styles.statLabel}>Pending</Text>
          </LinearGradient>

          <LinearGradient colors={['#1e293b', '#0f172a']} style={styles.statCardLarge}>
            <Feather name="check-circle" size={24} color="#10b981" />
            <Text style={styles.statNumberLarge}>{paidInvoices.length}</Text>
            <Text style={styles.statLabel}>Paid</Text>
          </LinearGradient>

          <LinearGradient colors={['#1e293b', '#0f172a']} style={styles.statCardLarge}>
            <Feather name="alert-circle" size={24} color="#ef4444" />
            <Text style={styles.statNumberLarge}>{overdueInvoices.length}</Text>
            <Text style={styles.statLabel}>Overdue</Text>
          </LinearGradient>
        </ScrollView>

        {/* Summary Card */}
        <LinearGradient colors={['#1e293b', '#0f172a']} style={styles.summaryCard}>
          <View style={styles.summaryRow}>
            <View>
              <Text style={styles.summaryLabel}>Total Revenue</Text>
              <Text style={styles.summaryValue}>
                ₱{invoices.filter(i => i.status === 'paid').reduce((sum, i) => sum + i.amount, 0).toLocaleString()}
              </Text>
            </View>
            <View>
              <Text style={styles.summaryLabel}>Pending</Text>
              <Text style={[styles.summaryValue, { color: '#f59e0b' }]}>
                ₱{pendingInvoices.reduce((sum, i) => sum + i.amount, 0).toLocaleString()}
              </Text>
            </View>
          </View>
        </LinearGradient>

        {/* Invoices List */}
        <FlatList
          data={invoices}
          keyExtractor={(item) => item.id}
          showsVerticalScrollIndicator={false}
          ListFooterComponent={<View style={{ height: 80 }} />}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Feather name="file-text" size={50} color="#4b5563" />
              <Text style={styles.emptyText}>No invoices found</Text>
              <Text style={{ color: '#64748b', fontSize: 13, marginTop: 8, textAlign: 'center' }}>
                Click the + button to create a new invoice
              </Text>
            </View>
          }
          renderItem={({ item }) => (
            <LinearGradient colors={['#1e293b', '#0f172a']} style={styles.invoiceCard}>
              
              {/* Header */}
              <View style={styles.invoiceHeader}>
                <View>
                  <Text style={styles.invoiceId}>{item.id}</Text>
                  <Text style={styles.invoiceClient}>{item.clientName}</Text>
                  <Text style={styles.invoiceIp}>{item.clientIp}</Text>
                </View>
                <LinearGradient 
                  colors={
                    item.status === 'paid' ? ['#10b981', '#059669'] :
                    item.status === 'pending' ? ['#f59e0b', '#d97706'] :
                    ['#ef4444', '#dc2626']
                  } 
                  style={styles.invoiceStatusBadge}
                >
                  <Text style={styles.invoiceStatusText}>
                    {item.status.toUpperCase()}
                  </Text>
                </LinearGradient>
              </View>

              {/* Details */}
              <View style={styles.invoiceDetails}>
                <View style={styles.invoiceRow}>
                  <Feather name="calendar" size={14} color="#94a3b8" />
                  <Text style={styles.invoiceLabel}>Issue Date:</Text>
                  <Text style={styles.invoiceValue}>{item.issueDate}</Text>
                </View>
                
                <View style={styles.invoiceRow}>
                  <Feather name="clock" size={14} color="#f59e0b" />
                  <Text style={styles.invoiceLabel}>Due Date:</Text>
                  <Text style={[styles.invoiceValue, { color: '#f59e0b' }]}>{item.dueDate}</Text>
                </View>
                
                <View style={styles.invoiceRow}>
                  <Feather name="package" size={14} color="#8b5cf6" />
                  <Text style={styles.invoiceLabel}>Plan:</Text>
                  <Text style={styles.invoiceValue}>{item.planName}</Text>
                </View>
                
                <View style={styles.invoiceRow}>
                  <Feather name="dollar-sign" size={14} color="#10b981" />
                  <Text style={styles.invoiceLabel}>Amount:</Text>
                  <Text style={[styles.invoiceValue, { color: '#10b981', fontWeight: 'bold' }]}>
                    ₱{item.amount.toLocaleString()}
                  </Text>
                </View>

                {item.paymentDate && (
                  <View style={styles.invoiceRow}>
                    <Feather name="check-circle" size={14} color="#10b981" />
                    <Text style={styles.invoiceLabel}>Paid on:</Text>
                    <Text style={styles.invoiceValue}>{item.paymentDate}</Text>
                  </View>
                )}
              </View>

              {/* Actions */}
              <View style={styles.invoiceActions}>
                <TouchableOpacity 
                  style={[styles.invoiceActionBtn, { backgroundColor: '#3b82f6' }]}
                  onPress={() => handleViewInvoice(item)}
                >
                  <Feather name="eye" size={14} color="#fff" />
                  <Text style={styles.invoiceActionText}>View</Text>
                </TouchableOpacity>

                <TouchableOpacity 
                  style={[styles.invoiceActionBtn, { backgroundColor: '#8b5cf6' }]}
                  onPress={() => handleDownloadInvoice(item)}
                >
                  <Feather name="download" size={14} color="#fff" />
                  <Text style={styles.invoiceActionText}>PDF</Text>
                </TouchableOpacity>

                {item.status === 'pending' && (
                  <>
                    <TouchableOpacity 
                      style={[styles.invoiceActionBtn, { backgroundColor: '#10b981' }]}
                      onPress={() => handleMarkAsPaid(item)}
                    >
                      <Feather name="check-circle" size={14} color="#fff" />
                      <Text style={styles.invoiceActionText}>Pay</Text>
                    </TouchableOpacity>

                    <TouchableOpacity 
                      style={[styles.invoiceActionBtn, { backgroundColor: '#ef4444' }]}
                      onPress={() => handleDeleteInvoice(item)}
                    >
                      <Feather name="trash-2" size={14} color="#fff" />
                      <Text style={styles.invoiceActionText}>Delete</Text>
                    </TouchableOpacity>
                  </>
                )}
              </View>
            </LinearGradient>
          )}
        />

        {/* View Invoice Modal */}
        <Modal visible={invoiceModal} transparent animationType="fade">
          <View style={styles.modalOverlay}>
            <LinearGradient colors={['#1e293b', '#0f172a']} style={styles.modalContentLarge}>
              
              <View style={styles.modalHeader}>
                <TouchableOpacity onPress={() => setInvoiceModal(false)}>
                  <Feather name="x" size={24} color="#94a3b8" />
                </TouchableOpacity>
                <Text style={styles.modalTitle}>📋 Invoice Details</Text>
                <TouchableOpacity onPress={() => selectedInvoice && handleDownloadInvoice(selectedInvoice)}>
                  <Feather name="download" size={20} color="#38bdf8" />
                </TouchableOpacity>
              </View>

              {selectedInvoice && (
                <ScrollView showsVerticalScrollIndicator={false}>
                  
                  <View style={styles.invoicePreview}>
                    <Text style={styles.previewTitle}>MIKROTIK BILLING SYSTEM</Text>
                    <Text style={styles.previewSubtitle}>Network Management Solutions</Text>
                    
                    <View style={styles.previewDivider} />
                    
                    <View style={styles.previewRow}>
                      <Text style={styles.previewLabel}>Invoice #:</Text>
                      <Text style={styles.previewValue}>{selectedInvoice.id}</Text>
                    </View>
                    
                    <View style={styles.previewRow}>
                      <Text style={styles.previewLabel}>Issue Date:</Text>
                      <Text style={styles.previewValue}>{selectedInvoice.issueDate}</Text>
                    </View>
                    
                    <View style={styles.previewRow}>
                      <Text style={styles.previewLabel}>Due Date:</Text>
                      <Text style={[styles.previewValue, { color: '#f59e0b' }]}>{selectedInvoice.dueDate}</Text>
                    </View>
                    
                    <View style={styles.previewDivider} />
                    
                    <Text style={styles.previewSectionTitle}>Bill To:</Text>
                    <Text style={styles.previewClientName}>{selectedInvoice.clientName}</Text>
                    <Text style={styles.previewClientIp}>IP: {selectedInvoice.clientIp}</Text>
                    <Text style={styles.previewClientPlan}>Plan: {selectedInvoice.planName}</Text>
                    
                    <View style={styles.previewDivider} />
                    
                    <View style={styles.previewTable}>
                      <View style={styles.previewTableHeader}>
                        <Text style={styles.previewTableHeaderText}>Description</Text>
                        <Text style={styles.previewTableHeaderText}>Amount</Text>
                      </View>
                      <View style={styles.previewTableRow}>
                        <Text style={styles.previewTableDesc}>Monthly Subscription</Text>
                        <Text style={styles.previewTableAmount}>₱{selectedInvoice.amount.toFixed(2)}</Text>
                      </View>
                    </View>
                    
                    <View style={styles.previewDivider} />
                    
                    <View style={styles.previewTotal}>
                      <Text style={styles.previewTotalLabel}>TOTAL DUE:</Text>
                      <Text style={styles.previewTotalAmount}>₱{selectedInvoice.amount.toFixed(2)}</Text>
                    </View>
                    
                    <View style={[styles.previewStatus, { 
                      backgroundColor: selectedInvoice.status === 'paid' ? '#059669' : 
                                     selectedInvoice.status === 'pending' ? '#b45309' : '#b91c1c'
                    }]}>
                      <Text style={styles.previewStatusText}>
                        {selectedInvoice.status.toUpperCase()}
                      </Text>
                    </View>
                    
                    <Text style={styles.previewFooter}>
                      Thank you for your business!
                    </Text>
                  </View>
                </ScrollView>
              )}
            </LinearGradient>
          </View>
        </Modal>

        {/* Create Invoice Modal */}
        <Modal visible={manualInvoiceModal} transparent animationType="slide">
          <View style={styles.modalOverlay}>
            <LinearGradient colors={['#1e293b', '#0f172a']} style={styles.modalContentLarge}>
              
              <View style={styles.modalHeader}>
                <TouchableOpacity onPress={() => setManualInvoiceModal(false)}>
                  <Feather name="x" size={24} color="#94a3b8" />
                </TouchableOpacity>
                <Text style={styles.modalTitle}>📄 Create New Invoice</Text>
                <View style={{ width: 24 }} />
              </View>

              <ScrollView showsVerticalScrollIndicator={false}>
                
                <Text style={styles.modalLabel}>Select Client:</Text>
                <View style={styles.clientList}>
                  {clientDatabase.map((client) => (
                    <TouchableOpacity
                      key={client.id}
                      style={[
                        styles.clientItem,
                        selectedClientForInvoice?.id === client.id && styles.clientItemActive
                      ]}
                      onPress={() => setSelectedClientForInvoice(client)}
                    >
                      <View style={styles.clientItemLeft}>
                        <Feather 
                          name="user" 
                          size={16} 
                          color={selectedClientForInvoice?.id === client.id ? '#fff' : '#94a3b8'} 
                        />
                        <View>
                          <Text style={[
                            styles.clientItemName,
                            selectedClientForInvoice?.id === client.id && { color: '#fff' }
                          ]}>
                            {client.name}
                          </Text>
                          <Text style={styles.clientItemIp}>{client.ip}</Text>
                        </View>
                      </View>
                      <Text style={styles.clientItemPlan}>{client.plan}</Text>
                    </TouchableOpacity>
                  ))}
                </View>

                <Text style={styles.modalLabel}>Amount (₱):</Text>
                <TextInput
                  style={styles.modalInput}
                  value={invoiceAmount}
                  onChangeText={setInvoiceAmount}
                  placeholder="Enter amount"
                  placeholderTextColor="#64748b"
                  keyboardType="numeric"
                />

                <Text style={styles.modalLabel}>Due Date (YYYY-MM-DD):</Text>
                <TextInput
                  style={styles.modalInput}
                  value={invoiceDueDate}
                  onChangeText={setInvoiceDueDate}
                  placeholder="Leave blank for 30 days"
                  placeholderTextColor="#64748b"
                />

                <Text style={styles.modalNote}>
                  Note: If due date is blank, it will be set to 30 days from today.
                </Text>

                <View style={styles.modalActions}>
                  <TouchableOpacity 
                    style={[styles.modalButton, styles.cancelButton]}
                    onPress={() => {
                      setManualInvoiceModal(false);
                      setSelectedClientForInvoice(null);
                      setInvoiceAmount("");
                      setInvoiceDueDate("");
                    }}
                  >
                    <Text style={styles.modalButtonText}>Cancel</Text>
                  </TouchableOpacity>

                  <TouchableOpacity 
                    style={[styles.modalButton, { backgroundColor: '#10b981' }]}
                    onPress={handleCreateInvoice}
                  >
                    <Text style={styles.modalButtonText}>Create Invoice</Text>
                  </TouchableOpacity>
                </View>
              </ScrollView>
            </LinearGradient>
          </View>
        </Modal>
      </SafeAreaView>
    </LinearGradient>
  );
}

  // ==========================================================================
  // PLANS PAGE
  // ==========================================================================
  if (page === "ipoe" && ipoePage === "plans") {
    return (
      <LinearGradient colors={['#0b1120', '#1a2639']} style={styles.container}>
        <StatusBar barStyle="light-content" />
        <SafeAreaView style={styles.safeArea}>
          <View style={styles.pageHeader}>
            <TouchableOpacity onPress={() => setIpoePage("home")} style={styles.backButton}>
              <MaterialIcons name="arrow-back" size={20} color="#38bdf8" />
            </TouchableOpacity>
            <Text style={styles.pageTitle}>Plans & Pricing</Text>
            <TouchableOpacity onPress={() => setPlanModal(true)} style={styles.refreshButton}>
              <Feather name="plus" size={18} color="#38bdf8" />
            </TouchableOpacity>
          </View>

          <View style={styles.smallStatusBar}>
            <View style={[styles.smallStatusDot, { backgroundColor: '#22c55e' }]} />
            <Text style={styles.smallStatusText}>{apiUrl}</Text>
          </View>

          <FlatList
            data={plans}
            keyExtractor={(item) => item.id}
            showsVerticalScrollIndicator={false}
            ListFooterComponent={<View style={{ height: 80 }} />}
            renderItem={({ item }) => (
              <LinearGradient colors={['#1e293b', '#0f172a']} style={styles.addressCard}>
                <View style={styles.addressCardHeader}>
                  <View>
                    <Text style={[styles.addressIp, { color: '#f59e0b' }]}>{item.name}</Text>
                    <Text style={{ color: '#fff', fontSize: 20, fontWeight: 'bold', marginTop: 4 }}>
                      ₱{item.price.toLocaleString()}
                    </Text>
                  </View>
                  <LinearGradient 
                    colors={item.isActive ? ['#22c55e', '#16a34a'] : ['#64748b', '#475569']} 
                    style={styles.addressStatus}
                  >
                    <Text style={styles.addressStatusText}>
                      {item.isActive ? 'ACTIVE' : 'INACTIVE'}
                    </Text>
                  </LinearGradient>
                </View>

                <View style={{ marginTop: 8 }}>
                  <View style={styles.detailRow}>
                    <Feather name="activity" size={12} color="#10b981" />
                    <Text style={styles.detailText}>Speed: {item.speed}</Text>
                  </View>
                  {item.burstLimit && (
                    <View style={styles.detailRow}>
                      <Feather name="zap" size={12} color="#f59e0b" />
                      <Text style={styles.detailText}>Burst: {item.burstLimit}</Text>
                    </View>
                  )}
                  <View style={styles.detailRow}>
                    <Feather name="info" size={12} color="#64748b" />
                    <Text style={styles.detailText}>{item.description}</Text>
                  </View>
                </View>

                <View style={styles.actionsRow}>
                  <TouchableOpacity
                    style={styles.actionButton}
                    onPress={() => {
                      setSelectedPlan(item);
                      setPlanName(item.name);
                      setPlanPrice(item.price.toString());
                      setPlanSpeed(item.speed);
                      setPlanDescription(item.description);
                      setPlanModal(true);
                    }}
                  >
                    <LinearGradient colors={['#3b82f6', '#2563eb']} style={styles.actionButtonGradient}>
                      <Feather name="edit-2" size={12} color="#fff" />
                      <Text style={styles.actionButtonText}>Edit</Text>
                    </LinearGradient>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.actionButton}
                    onPress={() => {
                      setPlans(prev => prev.map(p =>
                        p.id === item.id ? { ...p, isActive: !p.isActive } : p
                      ));
                      addLog(`🔄 Plan ${item.name} ${!item.isActive ? 'activated' : 'deactivated'}`, 'info');
                    }}
                  >
                    <LinearGradient colors={['#f59e0b', '#d97706']} style={styles.actionButtonGradient}>
                      <Feather name={item.isActive ? "pause" : "play"} size={12} color="#fff" />
                      <Text style={styles.actionButtonText}>
                        {item.isActive ? 'Deactivate' : 'Activate'}
                      </Text>
                    </LinearGradient>
                  </TouchableOpacity>
                </View>
              </LinearGradient>
            )}
          />

          {/* Add/Edit Plan Modal */}
          <Modal visible={planModal} transparent animationType="fade">
            <View style={styles.modalOverlay}>
              <LinearGradient colors={['#1e293b', '#0f172a']} style={styles.modalContent}>
                <Text style={[styles.modalTitle, { color: '#f59e0b' }]}>
                  {selectedPlan ? 'Edit Plan' : 'Add New Plan'}
                </Text>

                <Text style={styles.modalLabel}>Plan Name</Text>
                <TextInput
                  style={styles.modalInput}
                  value={planName}
                  onChangeText={setPlanName}
                  placeholder="e.g., PLAN1999"
                  placeholderTextColor="#64748b"
                />

                <Text style={styles.modalLabel}>Price (₱)</Text>
                <TextInput
                  style={styles.modalInput}
                  value={planPrice}
                  onChangeText={setPlanPrice}
                  placeholder="1999"
                  placeholderTextColor="#64748b"
                  keyboardType="numeric"
                />

                <Text style={styles.modalLabel}>Speed (e.g., 105M/105M)</Text>
                <TextInput
                  style={styles.modalInput}
                  value={planSpeed}
                  onChangeText={setPlanSpeed}
                  placeholder="105M/105M"
                  placeholderTextColor="#64748b"
                />

                <Text style={styles.modalLabel}>Description</Text>
                <TextInput
                  style={styles.modalInput}
                  value={planDescription}
                  onChangeText={setPlanDescription}
                  placeholder="105Mbps Fiber"
                  placeholderTextColor="#64748b"
                />

                <View style={styles.modalActions}>
                  <TouchableOpacity
                    style={[styles.modalButton, styles.cancelButton]}
                    onPress={() => {
                      setPlanModal(false);
                      setSelectedPlan(null);
                      setPlanName("");
                      setPlanPrice("");
                      setPlanSpeed("");
                      setPlanDescription("");
                    }}
                  >
                    <Text style={styles.modalButtonText}>Cancel</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[styles.modalButton, { backgroundColor: '#f59e0b' }]}
                    onPress={() => {
                      if (!planName || !planPrice || !planSpeed) {
                        Alert.alert("Error", "Please fill all fields");
                        return;
                      }

                      if (selectedPlan) {
                        setPlans(prev => prev.map(p =>
                          p.id === selectedPlan.id
                            ? { ...p, name: planName, price: parseInt(planPrice), speed: planSpeed, description: planDescription }
                            : p
                        ));
                        addLog(`✅ Plan ${planName} updated`, 'success');
                      } else {
                        const newPlan: Plan = {
                          id: Date.now().toString(),
                          name: planName,
                          price: parseInt(planPrice),
                          speed: planSpeed,
                          description: planDescription,
                          isActive: true
                        };
                        setPlans(prev => [...prev, newPlan]);
                        addLog(`✅ New plan ${planName} created`, 'success');
                      }

                      setPlanModal(false);
                      setSelectedPlan(null);
                      setPlanName("");
                      setPlanPrice("");
                      setPlanSpeed("");
                      setPlanDescription("");
                    }}
                  >
                    <Text style={styles.modalButtonText}>
                      {selectedPlan ? 'Update' : 'Create'}
                    </Text>
                  </TouchableOpacity>
                </View>
              </LinearGradient>
            </View>
          </Modal>
        </SafeAreaView>
      </LinearGradient>
    );
  }

  // ==========================================================================
  // NOTIFICATIONS PAGE
  // ==========================================================================
  if (page === "ipoe" && ipoePage === "notifications") {
    const unreadNotifs = notifications.filter(n => !n.isRead);

    return (
      <LinearGradient colors={['#0b1120', '#1a2639']} style={styles.container}>
        <StatusBar barStyle="light-content" />
        <SafeAreaView style={styles.safeArea}>
          <View style={styles.pageHeader}>
            <TouchableOpacity onPress={() => setIpoePage("home")} style={styles.backButton}>
              <MaterialIcons name="arrow-back" size={20} color="#38bdf8" />
            </TouchableOpacity>
            <Text style={styles.pageTitle}>Notifications</Text>
            <TouchableOpacity onPress={clearAllNotifications} style={styles.refreshButton}>
              <Feather name="trash-2" size={18} color="#ef4444" />
            </TouchableOpacity>
          </View>

          <View style={styles.smallStatusBar}>
            <View style={[styles.smallStatusDot, { backgroundColor: '#22c55e' }]} />
            <Text style={styles.smallStatusText}>{apiUrl}</Text>
          </View>

          {unreadNotifs.length > 0 && (
            <TouchableOpacity
              style={{ marginHorizontal: 12, marginBottom: 12 }}
              onPress={() => {
                setNotifications(prev => prev.map(n => ({ ...n, isRead: true })));
                addLog('📫 All notifications marked as read', 'info');
              }}
            >
              <LinearGradient colors={['#3b82f6', '#2563eb']} style={styles.addButton}>
                <Feather name="check-circle" size={16} color="#fff" />
                <Text style={styles.addButtonText}>Mark All as Read</Text>
              </LinearGradient>
            </TouchableOpacity>
          )}

          <FlatList
            data={notifications}
            keyExtractor={(item) => item.id}
            showsVerticalScrollIndicator={false}
            ListFooterComponent={<View style={{ height: 80 }} />}
            ListEmptyComponent={
              <View style={styles.emptyContainer}>
                <Feather name="bell" size={40} color="#4b5563" />
                <Text style={styles.emptyText}>No notifications</Text>
              </View>
            }
            renderItem={({ item }) => {
              const getIcon = () => {
                switch(item.type) {
                  case 'due': return 'clock';
                  case 'overdue': return 'alert-triangle';
                  case 'disconnection': return 'power';
                  case 'payment': return 'check-circle';
                  case 'usage': return 'activity';
                  default: return 'bell';
                }
              };

              const getColor = () => {
                switch(item.type) {
                  case 'due': return '#f59e0b';
                  case 'overdue': return '#ef4444';
                  case 'disconnection': return '#ef4444';
                  case 'payment': return '#10b981';
                  case 'usage': return '#3b82f6';
                  default: return '#64748b';
                }
              };

              return (
                <TouchableOpacity
                  onPress={() => markNotificationAsRead(item.id)}
                  style={{ opacity: item.isRead ? 0.6 : 1 }}
                >
                  <LinearGradient colors={['#1e293b', '#0f172a']} style={styles.addressCard}>
                    <View style={styles.addressCardHeader}>
                      <View style={styles.addressIpContainer}>
                        <Feather name={getIcon()} size={16} color={getColor()} />
                        <View style={{ marginLeft: 8, flex: 1 }}>
                          <Text style={[styles.addressIp, !item.isRead && { fontWeight: 'bold' }]}>
                            {item.title}
                          </Text>
                          <Text style={{ color: '#94a3b8', fontSize: 11, marginTop: 2 }}>
                            {item.clientName}
                          </Text>
                        </View>
                      </View>
                      <Text style={{ color: '#64748b', fontSize: 10 }}>
                        {new Date(item.date).toLocaleDateString()}
                      </Text>
                    </View>

                    <Text style={{ color: '#fff', marginTop: 8, fontSize: 13 }}>
                      {item.message}
                    </Text>

                    {!item.isRead && (
                      <View style={{ position: 'absolute', top: 12, right: 12, width: 8, height: 8, borderRadius: 4, backgroundColor: '#3b82f6' }} />
                    )}
                  </LinearGradient>
                </TouchableOpacity>
              );
            }}
          />
        </SafeAreaView>
      </LinearGradient>
    );
  }

  // ==========================================================================
  // REPORTS PAGE
  // ==========================================================================
  if (page === "ipoe" && ipoePage === "reports") {
    const reportData = getRevenueReport();

    return (
      <LinearGradient colors={['#0b1120', '#1a2639']} style={styles.container}>
        <StatusBar barStyle="light-content" />
        <SafeAreaView style={styles.safeArea}>
          <View style={styles.pageHeader}>
            <TouchableOpacity onPress={() => setIpoePage("home")} style={styles.backButton}>
              <MaterialIcons name="arrow-back" size={20} color="#38bdf8" />
            </TouchableOpacity>
            <Text style={styles.pageTitle}>Reports</Text>
            <TouchableOpacity onPress={() => refreshAllData()} style={styles.refreshButton}>
              <Feather name="refresh-cw" size={18} color="#38bdf8" />
            </TouchableOpacity>
          </View>

          <View style={styles.smallStatusBar}>
            <View style={[styles.smallStatusDot, { backgroundColor: '#22c55e' }]} />
            <Text style={styles.smallStatusText}>{apiUrl}</Text>
          </View>

          <ScrollView style={styles.content}>
            <LinearGradient colors={['#1e293b', '#0f172a']} style={styles.card}>
              <Text style={styles.cardTitle}>📅 Date Range</Text>
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
                {['day', 'week', 'month', 'year'].map((range) => (
                  <TouchableOpacity
                    key={range}
                    style={[
                      styles.intervalButton,
                      { flex: 1 },
                      dateRange === range && styles.intervalButtonActive
                    ]}
                    onPress={() => setDateRange(range as any)}
                  >
                    <Text style={[
                      styles.intervalButtonText,
                      dateRange === range && styles.intervalButtonTextActive
                    ]}>
                      {range === 'day' ? 'Day' : range === 'week' ? 'Week' : range === 'month' ? 'Month' : 'Year'}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </LinearGradient>

            <LinearGradient colors={['#1e293b', '#0f172a']} style={styles.card}>
              <Text style={styles.cardTitle}>📊 Report Type</Text>
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
                {['revenue', 'collection', 'usage'].map((type) => (
                  <TouchableOpacity
                    key={type}
                    style={[
                      styles.intervalButton,
                      { flex: 1 },
                      reportType === type && styles.intervalButtonActive
                    ]}
                    onPress={() => setReportType(type as any)}
                  >
                    <Text style={[
                      styles.intervalButtonText,
                      reportType === type && styles.intervalButtonTextActive
                    ]}>
                      {type === 'revenue' ? 'Revenue' : type === 'collection' ? 'Collection' : 'Usage'}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </LinearGradient>

            {reportType === 'revenue' && (
              <>
                <LinearGradient colors={['#1e293b', '#0f172a']} style={styles.card}>
                  <Text style={styles.cardTitle}>💰 Revenue Summary</Text>
                  <Text style={{ fontSize: 36, fontWeight: 'bold', color: '#10b981', marginTop: 8 }}>
                    ₱{reportData.totalRevenue.toLocaleString()}
                  </Text>
                  <Text style={{ color: '#94a3b8', marginTop: 4 }}>
                    Total Revenue ({dateRange})
                  </Text>
                </LinearGradient>

                <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
                  <LinearGradient colors={['#1e293b', '#0f172a']} style={[styles.card, { flex: 1 }]}>
                    <Text style={styles.cardTitle}>📊 Collection Rate</Text>
                    <Text style={{ fontSize: 24, fontWeight: 'bold', color: '#38bdf8' }}>
                      {reportData.collectionRate}%
                    </Text>
                  </LinearGradient>

                  <LinearGradient colors={['#1e293b', '#0f172a']} style={[styles.card, { flex: 1 }]}>
                    <Text style={styles.cardTitle}>💰 Avg/Client</Text>
                    <Text style={{ fontSize: 24, fontWeight: 'bold', color: '#f59e0b' }}>
                      ₱{reportData.averageRevenue}
                    </Text>
                  </LinearGradient>
                </View>
              </>
            )}

            {reportType === 'collection' && (
              <>
                <LinearGradient colors={['#1e293b', '#0f172a']} style={styles.card}>
                  <Text style={styles.cardTitle}>📊 Collection Efficiency</Text>
                  <View style={{ marginTop: 16 }}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
                      <Text style={{ color: '#94a3b8' }}>Collection Rate</Text>
                      <Text style={{ color: '#fff', fontWeight: 'bold' }}>{reportData.collectionRate}%</Text>
                    </View>
                    <View style={{ height: 8, backgroundColor: '#334155', borderRadius: 4 }}>
                      <View style={{ width: `${reportData.collectionRate}%`, height: 8, backgroundColor: '#10b981', borderRadius: 4 }} />
                    </View>
                  </View>

                  <View style={{ marginTop: 16 }}>
                    <View style={styles.detailRow}>
                      <Text style={{ color: '#94a3b8' }}>Total Clients:</Text>
                      <Text style={{ color: '#fff' }}>{reportData.totalClients}</Text>
                    </View>
                    <View style={styles.detailRow}>
                      <Text style={{ color: '#94a3b8' }}>Active Clients:</Text>
                      <Text style={{ color: '#22c55e' }}>{reportData.activeClients}</Text>
                    </View>
                    <View style={styles.detailRow}>
                      <Text style={{ color: '#94a3b8' }}>Overdue Clients:</Text>
                      <Text style={{ color: '#ef4444' }}>{reportData.overdueClients}</Text>
                    </View>
                  </View>
                </LinearGradient>
              </>
            )}

            <LinearGradient colors={['#1e293b', '#0f172a']} style={styles.card}>
              <Text style={styles.cardTitle}>💳 Recent Payments</Text>
              {reportData.payments.length === 0 ? (
                <Text style={styles.noLogs}>No payments in this period</Text>
              ) : (
                reportData.payments.slice(0, 5).map((payment, index) => (
                  <View key={index} style={styles.dueItemContainer}>
                    <View style={styles.dueItem}>
                      <View>
                        <Text style={styles.dueAddress}>{payment.clientName}</Text>
                        <Text style={{ color: '#94a3b8', fontSize: 10 }}>{payment.paymentDate}</Text>
                      </View>
                      <Text style={{ color: '#10b981', fontWeight: 'bold' }}>₱{payment.amount}</Text>
                    </View>
                  </View>
                ))
              )}
            </LinearGradient>
          </ScrollView>
        </SafeAreaView>
      </LinearGradient>
    );
  }

  // ==========================================================================
  // PPPOE HOME PAGE
  // ==========================================================================
  if (page === "pppoe" && pppoePage === "home") {
    const totalUsers = pppUsers.length;
    const activeUsers = pppActive.length;
    const disabledUsers = pppUsers.filter(u => u.disabled).length;

    return (
      <LinearGradient colors={['#0b1120', '#1a2639']} style={styles.container}>
        <StatusBar barStyle="light-content" />
        <SafeAreaView style={styles.safeArea}>
          <ScrollView 
            contentContainerStyle={styles.scrollContent} 
            showsVerticalScrollIndicator={false}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={() => refreshAllData()} />
            }
          >
            <View style={styles.mainContent}>
              <View style={styles.headerWithBack}>
                <TouchableOpacity onPress={() => setPage("main")} style={styles.backButtonSmall}>
                  <MaterialIcons name="arrow-back" size={20} color="#38bdf8" />
                </TouchableOpacity>
                <Text style={styles.headerSmall}>
                  <Feather name="users" size={22} color="#f59e0b" /> PPPoE Manager
                </Text>
                <View style={{ width: 40 }} />
              </View>

              <View style={styles.connectionContainer}>
                <View style={styles.apiIndicator}>
                  <Text style={styles.apiText}>API: {apiUrl}</Text>
                </View>
                <View style={styles.statusRow}>
                  <View style={[styles.statusDot, { backgroundColor: '#22c55e' }]} />
                  <Text style={styles.statusText}>PPPoE Mode</Text>
                </View>
              </View>

              <View style={styles.statsRow}>
                <LinearGradient colors={['#1e293b', '#0f172a']} style={styles.statCard}>
                  <Text style={styles.statNumber}>{totalUsers}</Text>
                  <Text style={styles.statLabel}>Total Users</Text>
                </LinearGradient>

                <LinearGradient colors={['#1e293b', '#0f172a']} style={styles.statCard}>
                  <Text style={styles.statNumber}>{activeUsers}</Text>
                  <Text style={styles.statLabel}>Active</Text>
                </LinearGradient>

                <LinearGradient colors={['#1e293b', '#0f172a']} style={styles.statCard}>
                  <Text style={styles.statNumber}>{disabledUsers}</Text>
                  <Text style={styles.statLabel}>Disabled</Text>
                </LinearGradient>
              </View>

              <TouchableOpacity 
                activeOpacity={0.8} 
                onPress={() => {
                  setPppoePage("users");
                  fetchPppUsers();
                  fetchPppProfiles();
                }}
              >
                <LinearGradient colors={['#3b82f6', '#2563eb']} style={styles.menuButton}>
                  <Feather name="users" size={20} color="#fff" />
                  <View style={styles.menuTextContainer}>
                    <Text style={styles.menuTitle}>PPPoE Users</Text>
                    <Text style={styles.menuSub}>Manage user accounts</Text>
                  </View>
                  <MaterialIcons name="arrow-forward-ios" size={14} color="#fff" />
                </LinearGradient>
              </TouchableOpacity>

              <TouchableOpacity 
                activeOpacity={0.8} 
                onPress={() => {
                  setPppoePage("active");
                  fetchPppActive();
                }}
              >
                <LinearGradient colors={['#10b981', '#059669']} style={styles.menuButton}>
                  <Feather name="activity" size={20} color="#fff" />
                  <View style={styles.menuTextContainer}>
                    <Text style={styles.menuTitle}>Active Sessions</Text>
                    <Text style={styles.menuSub}>Currently connected users</Text>
                  </View>
                  <MaterialIcons name="arrow-forward-ios" size={14} color="#fff" />
                </LinearGradient>
              </TouchableOpacity>

              <TouchableOpacity 
                activeOpacity={0.8} 
                onPress={() => {
                  setPppoePage("queues");
                  fetchQueuesData();
                }}
              >
                <LinearGradient colors={['#f59e0b', '#d97706']} style={styles.menuButton}>
                  <Feather name="bar-chart-2" size={20} color="#fff" />
                  <View style={styles.menuTextContainer}>
                    <Text style={styles.menuTitle}>PPPoE Queues</Text>
                    <Text style={styles.menuSub}>Bandwidth limits</Text>
                  </View>
                  <MaterialIcons name="arrow-forward-ios" size={14} color="#fff" />
                </LinearGradient>
              </TouchableOpacity>

              <TouchableOpacity 
                activeOpacity={0.8} 
                onPress={() => {
                  setPppoePage("profiles");
                  fetchPppProfiles();
                }}
              >
                <LinearGradient colors={['#8b5cf6', '#7c3aed']} style={styles.menuButton}>
                  <Feather name="settings" size={20} color="#fff" />
                  <View style={styles.menuTextContainer}>
                    <Text style={styles.menuTitle}>Profiles</Text>
                    <Text style={styles.menuSub}>Connection profiles</Text>
                  </View>
                  <MaterialIcons name="arrow-forward-ios" size={14} color="#fff" />
                </LinearGradient>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </SafeAreaView>
      </LinearGradient>
    );
  }

  // ==========================================================================
  // PPPOE USERS PAGE
  // ==========================================================================
  if (page === "pppoe" && pppoePage === "users") {
    const filteredUsers = pppUsers.filter(u => u.name.toLowerCase().includes(pppSearch.toLowerCase()));

    return (
      <LinearGradient colors={['#0b1120', '#1a2639']} style={styles.container}>
        <StatusBar barStyle="light-content" />
        <SafeAreaView style={styles.safeArea}>
          <View style={styles.pageHeader}>
            <TouchableOpacity onPress={() => setPppoePage("home")} style={styles.backButton}>
              <MaterialIcons name="arrow-back" size={20} color="#38bdf8" />
            </TouchableOpacity>
            <Text style={styles.pageTitle}>PPPoE Users</Text>
            <TouchableOpacity onPress={() => fetchPppUsers()} style={styles.refreshButton}>
              <Feather name="refresh-cw" size={18} color="#38bdf8" />
            </TouchableOpacity>
          </View>

          <View style={styles.smallStatusBar}>
            <View style={[styles.smallStatusDot, { backgroundColor: '#22c55e' }]} />
            <Text style={styles.smallStatusText}>{apiUrl}</Text>
          </View>

          <View style={styles.searchContainer}>
            <Feather name="search" size={16} color="#64748b" style={styles.searchIcon} />
            <TextInput
              placeholder="Search username..."
              placeholderTextColor="#64748b"
              style={styles.searchInput}
              value={pppSearch}
              onChangeText={setPppSearch}
            />
          </View>

          <TouchableOpacity 
            activeOpacity={0.8} 
            onPress={() => {
              fetchPppProfiles();
              setNewPppName("");
              setNewPppPassword("");
              setNewPppProfile(pppProfiles[0]?.name || "default");
              setNewPppComment("");
              setPppAddModal(true);
            }}
          >
            <LinearGradient colors={['#2563eb', '#1d4ed8']} style={styles.addButton}>
              <Feather name="plus-circle" size={16} color="#fff" />
              <Text style={styles.addButtonText}>Add New User</Text>
            </LinearGradient>
          </TouchableOpacity>

          <FlatList
            data={filteredUsers}
            keyExtractor={(item) => item[".id"]}
            showsVerticalScrollIndicator={false}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={() => fetchPppUsers()} />
            }
            ListFooterComponent={<View style={{ height: 80 }} />}
            ListEmptyComponent={
              <View style={styles.emptyContainer}>
                <Feather name="users" size={40} color="#4b5563" />
                <Text style={styles.emptyText}>No users found</Text>
              </View>
            }
            renderItem={({ item }) => (
              <LinearGradient colors={['#1e293b', '#0f172a']} style={styles.pppUserCard}>
                <View style={styles.pppUserHeader}>
                  <View style={styles.pppUserInfo}>
                    <Text style={styles.pppUserName}>{item.name}</Text>
                    <Text style={styles.pppUserProfile}>Profile: {item.profile}</Text>
                  </View>
                  <LinearGradient 
                    colors={item.disabled ? ['#64748b', '#475569'] : ['#22c55e', '#16a34a']} 
                    style={styles.pppUserStatus}
                  >
                    <Text style={styles.pppUserStatusText}>
                      {item.disabled ? "OFF" : "ON"}
                    </Text>
                  </LinearGradient>
                </View>

                {item.comment ? (
                  <Text style={styles.pppUserComment}>{item.comment}</Text>
                ) : null}

                <View style={styles.actionsRow}>
                  <TouchableOpacity
                    activeOpacity={0.8}
                    style={styles.actionButton}
                    onPress={() => togglePppUser(item)}
                  >
                    <LinearGradient 
                      colors={item.disabled ? ['#22c55e', '#16a34a'] : ['#64748b', '#475569']} 
                      style={styles.actionButtonGradient}
                    >
                      <Feather name={item.disabled ? "play" : "pause"} size={12} color="#fff" />
                      <Text style={styles.actionButtonText}>
                        {item.disabled ? "Enable" : "Disable"}
                      </Text>
                    </LinearGradient>
                  </TouchableOpacity>

                  <TouchableOpacity
                    activeOpacity={0.8}
                    style={styles.actionButton}
                    onPress={() => openEditModal(item)}
                  >
                    <LinearGradient colors={['#8b5cf6', '#7c3aed']} style={styles.actionButtonGradient}>
                      <Feather name="edit-2" size={12} color="#fff" />
                      <Text style={styles.actionButtonText}>Edit</Text>
                    </LinearGradient>
                  </TouchableOpacity>

                  <TouchableOpacity
                    activeOpacity={0.8}
                    style={styles.actionButton}
                    onPress={() => deletePppUser(item)}
                  >
                    <LinearGradient colors={['#ef4444', '#dc2626']} style={styles.actionButtonGradient}>
                      <Feather name="trash-2" size={12} color="#fff" />
                      <Text style={styles.actionButtonText}>Delete</Text>
                    </LinearGradient>
                  </TouchableOpacity>
                </View>
              </LinearGradient>
            )}
          />

          {/* Add PPPoE User Modal */}
          <Modal visible={pppAddModal} transparent animationType="fade">
            <View style={styles.modalOverlay}>
              <LinearGradient colors={['#1e293b', '#0f172a']} style={styles.modalContent}>
                <Text style={styles.modalTitle}>Add PPPoE User</Text>
                
                <View style={styles.modalInputContainer}>
                  <Feather name="user" size={16} color="#64748b" style={styles.modalInputIcon} />
                  <TextInput
                    placeholder="Username"
                    placeholderTextColor="#64748b"
                    style={styles.modalInputWithIcon}
                    value={newPppName}
                    onChangeText={setNewPppName}
                  />
                </View>
                
                <View style={styles.modalInputContainer}>
                  <Feather name="lock" size={16} color="#64748b" style={styles.modalInputIcon} />
                  <TextInput
                    placeholder="Password"
                    placeholderTextColor="#64748b"
                    style={styles.modalInputWithIcon}
                    value={newPppPassword}
                    onChangeText={setNewPppPassword}
                    secureTextEntry
                  />
                </View>
                
                <Text style={styles.modalLabel}>Profile:</Text>
                <TouchableOpacity 
                  style={styles.profileDropdownButton}
                  onPress={() => setShowProfileDropdown(!showProfileDropdown)}
                >
                  <Text style={styles.profileDropdownButtonText}>
                    {newPppProfile || "Select Profile"}
                  </Text>
                  <Feather 
                    name={showProfileDropdown ? "chevron-up" : "chevron-down"} 
                    size={18} 
                    color="#94a3b8" 
                  />
                </TouchableOpacity>

                {showProfileDropdown && (
                  <View style={styles.profileDropdownList}>
                    <ScrollView style={{ maxHeight: 200 }}>
                      {pppProfiles.map((profile) => (
                        <TouchableOpacity
                          key={profile[".id"]}
                          style={[
                            styles.profileDropdownItem,
                            newPppProfile === profile.name && styles.profileDropdownItemActive
                          ]}
                          onPress={() => {
                            setNewPppProfile(profile.name);
                            setShowProfileDropdown(false);
                          }}
                        >
                          <View style={styles.profileDropdownItemContent}>
                            <Text style={[
                              styles.profileDropdownItemText,
                              newPppProfile === profile.name && styles.profileDropdownItemTextActive
                            ]}>
                              {profile.name}
                            </Text>
                            {profile.rateLimit && (
                              <Text style={styles.profileDropdownItemRate}>
                                {profile.rateLimit}
                              </Text>
                            )}
                          </View>
                          {newPppProfile === profile.name && (
                            <Feather name="check" size={16} color="#8b5cf6" />
                          )}
                        </TouchableOpacity>
                      ))}
                    </ScrollView>
                  </View>
                )}
                
                <View style={styles.modalInputContainer}>
                  <Feather name="message-circle" size={16} color="#64748b" style={styles.modalInputIcon} />
                  <TextInput
                    placeholder="Comment (optional)"
                    placeholderTextColor="#64748b"
                    style={styles.modalInputWithIcon}
                    value={newPppComment}
                    onChangeText={setNewPppComment}
                  />
                </View>
                
                <View style={styles.modalActions}>
                  <TouchableOpacity 
                    style={[styles.modalButton, styles.cancelButton]} 
                    onPress={() => {
                      setPppAddModal(false);
                      setShowProfileDropdown(false);
                    }}
                  >
                    <Text style={styles.modalButtonText}>Cancel</Text>
                  </TouchableOpacity>
                  
                  <TouchableOpacity 
                    style={[styles.modalButton, styles.addModalButton]} 
                    onPress={addPppUser}
                  >
                    <Text style={styles.modalButtonText}>Add User</Text>
                  </TouchableOpacity>
                </View>
              </LinearGradient>
            </View>
          </Modal>

          {/* Edit PPPoE User Modal */}
          <Modal visible={showEditModal} transparent animationType="fade">
            <View style={styles.modalOverlay}>
              <LinearGradient colors={['#1e293b', '#0f172a']} style={styles.modalContent}>
                <Text style={[styles.modalTitle, { color: '#8b5cf6', fontSize: 20 }]}>Edit PPPoE User</Text>
                
                <TouchableOpacity 
                  style={styles.copyAllButton}
                  onPress={async () => {
                    const credentials = `Username: ${editName}\nPassword: ${editPassword}`;
                    await Clipboard.setStringAsync(credentials);
                    Alert.alert("✅ Copied!", "Username and password copied to clipboard");
                  }}
                >
                  <Feather name="copy" size={18} color="#fff" />
                  <Text style={styles.copyAllButtonText}>Copy Username & Password</Text>
                </TouchableOpacity>
                
                <View style={styles.modalFieldContainer}>
                  <Text style={styles.modalFieldLabel}>Username</Text>
                  <TextInput
                    style={styles.modalFieldInput}
                    value={editName}
                    onChangeText={setEditName}
                    placeholder="Username"
                    placeholderTextColor="#64748b"
                  />
                </View>
                
                <View style={styles.modalFieldContainer}>
                  <Text style={styles.modalFieldLabel}>Password</Text>
                  <TextInput
                    style={styles.modalFieldInput}
                    value={editPassword}
                    onChangeText={setEditPassword}
                    placeholder="Password"
                    placeholderTextColor="#64748b"
                    secureTextEntry={false}
                  />
                </View>
                
                <View style={styles.modalFieldContainer}>
                  <Text style={styles.modalFieldLabel}>Profile</Text>
                  <TouchableOpacity 
                    style={styles.profileDropdownButton}
                    onPress={() => setShowProfileDropdown(!showProfileDropdown)}
                  >
                    <Text style={styles.profileDropdownButtonText}>
                      {editProfile || "Select Profile"}
                    </Text>
                    <Feather 
                      name={showProfileDropdown ? "chevron-up" : "chevron-down"} 
                      size={18} 
                      color="#94a3b8" 
                    />
                  </TouchableOpacity>

                  {showProfileDropdown && (
                    <View style={styles.profileDropdownList}>
                      <ScrollView style={{ maxHeight: 200 }}>
                        {pppProfiles.map((profile) => (
                          <TouchableOpacity
                            key={profile[".id"]}
                            style={[
                              styles.profileDropdownItem,
                              editProfile === profile.name && styles.profileDropdownItemActive
                            ]}
                            onPress={() => {
                              setEditProfile(profile.name);
                              setShowProfileDropdown(false);
                            }}
                          >
                            <View style={styles.profileDropdownItemContent}>
                              <Text style={[
                                styles.profileDropdownItemText,
                                editProfile === profile.name && styles.profileDropdownItemTextActive
                              ]}>
                                {profile.name}
                              </Text>
                              {profile.rateLimit && (
                                <Text style={styles.profileDropdownItemRate}>
                                  {profile.rateLimit}
                                </Text>
                              )}
                            </View>
                            {editProfile === profile.name && (
                              <Feather name="check" size={16} color="#8b5cf6" />
                            )}
                          </TouchableOpacity>
                        ))}
                      </ScrollView>
                    </View>
                  )}
                </View>
                
                <View style={styles.modalFieldContainer}>
                  <Text style={styles.modalFieldLabel}>Comment</Text>
                  <TextInput
                    style={styles.modalFieldInput}
                    value={editComment}
                    onChangeText={setEditComment}
                    placeholder="Comment"
                    placeholderTextColor="#64748b"
                  />
                </View>

                <View style={styles.toggleContainer}>
                  <Text style={{ color: '#fff', fontSize: 15, fontWeight: '500' }}>Disabled</Text>
                  <Switch
                    value={editDisabled}
                    onValueChange={setEditDisabled}
                    trackColor={{ false: '#4b5563', true: '#ef4444' }}
                    thumbColor={editDisabled ? '#fff' : '#9ca3af'}
                  />
                </View>
                
                <View style={styles.modalActions}>
                  <TouchableOpacity 
                    style={[styles.modalButton, styles.cancelButton]} 
                    onPress={() => {
                      setShowEditModal(false);
                      setShowProfileDropdown(false);
                    }}
                  >
                    <Text style={styles.modalButtonText}>Cancel</Text>
                  </TouchableOpacity>
                  
                  <TouchableOpacity 
                    style={[styles.modalButton, styles.saveButton]} 
                    onPress={updatePppUser}
                  >
                    <Text style={styles.modalButtonText}>Save Changes</Text>
                  </TouchableOpacity>
                </View>
              </LinearGradient>
            </View>
          </Modal>
        </SafeAreaView>
      </LinearGradient>
    );
  }

  // ==========================================================================
  // PPPOE ACTIVE SESSIONS PAGE
  // ==========================================================================
  if (page === "pppoe" && pppoePage === "active") {
    const filteredActive = pppActive.filter(session => 
      session.name.toLowerCase().includes(activeSearch.toLowerCase()) ||
      session.address.toLowerCase().includes(activeSearch.toLowerCase())
    );

    return (
      <LinearGradient colors={['#0b1120', '#1a2639']} style={styles.container}>
        <StatusBar barStyle="light-content" />
        <SafeAreaView style={styles.safeArea}>
          <View style={styles.pageHeader}>
            <TouchableOpacity onPress={() => setPppoePage("home")} style={styles.backButton}>
              <MaterialIcons name="arrow-back" size={20} color="#38bdf8" />
            </TouchableOpacity>
            <Text style={styles.pageTitle}>Active Sessions</Text>
            <TouchableOpacity onPress={() => fetchPppActive()} style={styles.refreshButton}>
              <Feather name="refresh-cw" size={18} color="#38bdf8" />
            </TouchableOpacity>
          </View>

          <View style={styles.smallStatusBar}>
            <View style={[styles.smallStatusDot, { backgroundColor: '#22c55e' }]} />
            <Text style={styles.smallStatusText}>{apiUrl}</Text>
          </View>

          <View style={styles.statsRow}>
            <LinearGradient colors={['#1e293b', '#0f172a']} style={styles.statCard}>
              <Text style={styles.statNumber}>{pppActive.length}</Text>
              <Text style={styles.statLabel}>Total Active</Text>
            </LinearGradient>
            
            <LinearGradient colors={['#1e293b', '#0f172a']} style={styles.statCard}>
              <Text style={styles.statNumber}>{filteredActive.length}</Text>
              <Text style={styles.statLabel}>Filtered</Text>
            </LinearGradient>
          </View>

          <View style={styles.searchContainer}>
            <Feather name="search" size={16} color="#64748b" style={styles.searchIcon} />
            <TextInput
              placeholder="Search by username or IP..."
              placeholderTextColor="#64748b"
              style={styles.searchInput}
              value={activeSearch}
              onChangeText={setActiveSearch}
            />
            {activeSearch.length > 0 && (
              <TouchableOpacity onPress={() => setActiveSearch('')} style={{ paddingRight: 10 }}>
                <Feather name="x" size={16} color="#64748b" />
              </TouchableOpacity>
            )}
          </View>

          {pppLoading ? (
            <View style={styles.centerContent}>
              <ActivityIndicator size="large" color="#38bdf8" />
              <Text style={styles.loadingText}>Loading active sessions...</Text>
            </View>
          ) : (
            <FlatList
              data={filteredActive}
              keyExtractor={(item) => item[".id"]}
              showsVerticalScrollIndicator={false}
              refreshControl={
                <RefreshControl refreshing={refreshing} onRefresh={() => fetchPppActive()} />
              }
              ListFooterComponent={<View style={{ height: 80 }} />}
              ListEmptyComponent={
                <View style={styles.emptyContainer}>
                  <Feather name="activity" size={40} color="#4b5563" />
                  <Text style={styles.emptyText}>
                    {activeSearch ? 'No matching sessions found' : 'No active sessions'}
                  </Text>
                  {activeSearch && (
                    <TouchableOpacity onPress={() => setActiveSearch('')}>
                      <Text style={styles.clearSearchText}>Clear search</Text>
                    </TouchableOpacity>
                  )}
                </View>
              }
              renderItem={({ item }) => (
                <LinearGradient colors={['#1e293b', '#0f172a']} style={styles.pppActiveCard}>
                  <View style={styles.pppActiveHeader}>
                    <View>
                      <Text style={styles.pppActiveName}>{item.name}</Text>
                      <Text style={styles.pppActiveAddress}>{item.address}</Text>
                    </View>
                    <TouchableOpacity
                      onPress={() => disconnectPppSession(item[".id"])}
                    >
                      <LinearGradient colors={['#ef4444', '#dc2626']} style={styles.disconnectButton}>
                        <Feather name="power" size={14} color="#fff" />
                      </LinearGradient>
                    </TouchableOpacity>
                  </View>
                  
                  <View style={styles.pppActiveDetails}>
                    <View style={styles.detailRow}>
                      <Feather name="clock" size={12} color="#64748b" />
                      <Text style={styles.detailText}>Uptime: {item.uptime}</Text>
                    </View>
                    <View style={styles.detailRow}>
                      <Feather name="activity" size={12} color="#64748b" />
                      <Text style={styles.detailText}>Service: {item.service}</Text>
                    </View>
                  </View>
                </LinearGradient>
              )}
            />
          )}
        </SafeAreaView>
      </LinearGradient>
    );
  }

  // ==========================================================================
  // PPPOE QUEUES PAGE
  // ==========================================================================
  if (page === "pppoe" && pppoePage === "queues") {
    if (simpleQueueLoading) {
      return (
        <LinearGradient colors={['#0b1120', '#1a2639']} style={styles.container}>
          <StatusBar barStyle="light-content" />
          <SafeAreaView style={styles.safeArea}>
            <View style={styles.pageHeader}>
              <TouchableOpacity onPress={() => setPppoePage("home")} style={styles.backButton}>
                <MaterialIcons name="arrow-back" size={20} color="#38bdf8" />
              </TouchableOpacity>
              <Text style={styles.pageTitle}>PPPoE Queues</Text>
              <View style={{ width: 40 }} />
            </View>
            <View style={styles.centerContent}>
              <ActivityIndicator size="large" color="#38bdf8" />
              <Text style={styles.loadingText}>Loading queues...</Text>
            </View>
          </SafeAreaView>
        </LinearGradient>
      );
    }

    const pppoeQueues = ipoQueues.filter(q => q.type === 'pppoe');
    const filteredQueues = pppoeQueues.filter(q => {
      const searchLower = ipoQueueSearch.toLowerCase();
      return (q.displayName?.toLowerCase().includes(searchLower) ||
              q.target?.toLowerCase().includes(searchLower));
    });

    return (
      <LinearGradient colors={['#0b1120', '#1a2639']} style={styles.container}>
        <StatusBar barStyle="light-content" />
        <SafeAreaView style={styles.safeArea}>
          <View style={styles.pageHeader}>
            <TouchableOpacity onPress={() => setPppoePage("home")} style={styles.backButton}>
              <MaterialIcons name="arrow-back" size={20} color="#38bdf8" />
            </TouchableOpacity>
            <Text style={styles.pageTitle}>PPPoE Queues</Text>
            <TouchableOpacity onPress={() => fetchQueuesData()} style={styles.refreshButton}>
              <Feather name="refresh-cw" size={18} color="#38bdf8" />
            </TouchableOpacity>
          </View>

          <View style={styles.smallStatusBar}>
            <View style={[styles.smallStatusDot, { backgroundColor: '#22c55e' }]} />
            <Text style={styles.smallStatusText}>{apiUrl}</Text>
          </View>

          <View style={styles.statsRow}>
            <LinearGradient colors={['#1e293b', '#0f172a']} style={styles.statCard}>
              <Text style={styles.statNumber}>{pppoeQueues.length}</Text>
              <Text style={styles.statLabel}>PPPoE Queues</Text>
            </LinearGradient>

            <LinearGradient colors={['#1e293b', '#0f172a']} style={styles.statCard}>
              <Text style={styles.statNumber}>{pppoeQueues.filter(q => !q.disabled).length}</Text>
              <Text style={styles.statLabel}>Active</Text>
            </LinearGradient>

            <LinearGradient colors={['#1e293b', '#0f172a']} style={styles.statCard}>
              <Text style={styles.statNumber}>{pppoeQueues.filter(q => q.disabled).length}</Text>
              <Text style={styles.statLabel}>Inactive</Text>
            </LinearGradient>
          </View>

          <View style={styles.searchContainer}>
            <Feather name="search" size={16} color="#64748b" style={styles.searchIcon} />
            <TextInput
              placeholder="Search by username..."
              placeholderTextColor="#64748b"
              style={styles.searchInput}
              value={ipoQueueSearch}
              onChangeText={setIpoQueueSearch}
            />
          </View>

          {filteredQueues.length === 0 ? (
            <View style={styles.centerContent}>
              <Feather name="inbox" size={40} color="#4b5563" />
              <Text style={styles.emptyText}>No PPPoE queues found</Text>
            </View>
          ) : (
            <FlatList
              data={filteredQueues}
              keyExtractor={(item) => item[".id"]}
              showsVerticalScrollIndicator={false}
              refreshControl={
                <RefreshControl refreshing={refreshing} onRefresh={() => fetchQueuesData()} />
              }
              renderItem={({ item }) => (
                <LinearGradient colors={['#1e293b', '#0f172a']} style={styles.queueCard}>
                  <View style={styles.queueCardHeader}>
                    <View style={styles.queueIpContainer}>
                      <Feather name="activity" size={14} color="#f59e0b" />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.queueName} numberOfLines={1}>
                          {item.displayName}
                        </Text>
                      </View>
                    </View>
                    <LinearGradient 
                      colors={item.disabled ? ['#64748b', '#475569'] : ['#f59e0b', '#d97706']} 
                      style={styles.addressStatus}
                    >
                      <Text style={styles.addressStatusText}>
                        {item.disabled ? "OFF" : "ON"}
                      </Text>
                    </LinearGradient>
                  </View>

                  <View style={styles.queueDetails}>
                    <View style={styles.detailRow}>
                      <Feather name="activity" size={12} color="#64748b" />
                      <Text style={styles.detailText}>Limit: {item.maxLimit}</Text>
                    </View>
                  </View>
                </LinearGradient>
              )}
            />
          )}
        </SafeAreaView>
      </LinearGradient>
    );
  }

  // ==========================================================================
  // PPPOE PROFILES PAGE
  // ==========================================================================
  if (page === "pppoe" && pppoePage === "profiles") {
    return (
      <LinearGradient colors={['#0b1120', '#1a2639']} style={styles.container}>
        <StatusBar barStyle="light-content" />
        <SafeAreaView style={styles.safeArea}>
          <View style={styles.pageHeader}>
            <TouchableOpacity onPress={() => setPppoePage("home")} style={styles.backButton}>
              <MaterialIcons name="arrow-back" size={20} color="#38bdf8" />
            </TouchableOpacity>
            <Text style={styles.pageTitle}>PPPoE Profiles</Text>
            <TouchableOpacity onPress={() => fetchPppProfiles()} style={styles.refreshButton}>
              <Feather name="refresh-cw" size={18} color="#38bdf8" />
            </TouchableOpacity>
          </View>

          <View style={styles.smallStatusBar}>
            <View style={[styles.smallStatusDot, { backgroundColor: '#22c55e' }]} />
            <Text style={styles.smallStatusText}>{apiUrl}</Text>
          </View>

          <FlatList
            data={pppProfiles}
            keyExtractor={(item) => item[".id"]}
            showsVerticalScrollIndicator={false}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={() => fetchPppProfiles()} />
            }
            ListFooterComponent={<View style={{ height: 80 }} />}
            ListEmptyComponent={
              <View style={styles.emptyContainer}>
                <Feather name="settings" size={40} color="#4b5563" />
                <Text style={styles.emptyText}>No profiles found</Text>
              </View>
            }
            renderItem={({ item }) => (
              <LinearGradient colors={['#1e293b', '#0f172a']} style={styles.profileCard}>
                <Text style={styles.profileName}>{item.name}</Text>
                
                <View style={styles.profileDetails}>
                  {item.rateLimit && (
                    <View style={styles.detailRow}>
                      <Feather name="activity" size={12} color="#64748b" />
                      <Text style={styles.detailText}>Rate: {item.rateLimit}</Text>
                    </View>
                  )}
                  <View style={styles.detailRow}>
                    <Feather name="wifi" size={12} color="#64748b" />
                    <Text style={styles.detailText}>Local: {item.localAddress || 'N/A'}</Text>
                  </View>
                  <View style={styles.detailRow}>
                    <Feather name="globe" size={12} color="#64748b" />
                    <Text style={styles.detailText}>Remote: {item.remoteAddress || 'N/A'}</Text>
                  </View>
                  {item.comment && (
                    <View style={styles.detailRow}>
                      <Feather name="message-circle" size={12} color="#64748b" />
                      <Text style={styles.detailText}>{item.comment}</Text>
                    </View>
                  )}
                </View>
              </LinearGradient>
            )}
          />
        </SafeAreaView>
      </LinearGradient>
    );
  }

  return null;
}

// ============================================================================
// STYLES
// ============================================================================
const styles = StyleSheet.create({
  container: {
    flex: 1
  },
  safeArea: {
    flex: 1,
    paddingTop: Platform.OS === "android" ? StatusBar.currentHeight : 0
  },
  scrollContent: {
    flexGrow: 1,
  },
  mainContent: {
    padding: 16,
  },
  header: {
    color: "#fff",
    fontSize: 24,
    fontWeight: "bold",
    marginBottom: 16,
    textAlign: "center",
    letterSpacing: 0.5
  },
  headerWithBack: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  headerSmall: {
    color: "#fff",
    fontSize: 20,
    fontWeight: "bold",
    textAlign: "center",
  },
  backButtonSmall: {
    padding: 8,
    borderRadius: 8,
    backgroundColor: "#1e293b",
    width: 40,
    alignItems: 'center',
  },
  sectionTitle: {
    color: '#94a3b8',
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 12,
    marginTop: 8,
  },
  connectionContainer: {
    marginBottom: 16,
  },
  apiIndicator: {
    backgroundColor: "#1e293b",
    padding: 6,
    borderRadius: 6,
    marginBottom: 6,
    alignSelf: "center"
  },
  apiText: {
    color: "#38bdf8",
    fontSize: 11,
    fontFamily: "monospace"
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  statusText: {
    color: '#94a3b8',
    fontSize: 11,
  },
  retrySmallBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1e293b',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 10,
    gap: 2,
  },
  retrySmallText: {
    color: '#38bdf8',
    fontSize: 9,
  },
  statsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 16,
    gap: 8,
  },
  statCard: {
    flex: 1,
    padding: 10,
    borderRadius: 10,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#334155",
    elevation: 2,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
    minHeight: 70,
  },
  statNumber: {
    color: "#38bdf8",
    fontSize: 20,
    fontWeight: "bold",
    marginBottom: 2,
  },
  statLabel: {
    color: "#94a3b8",
    fontSize: 10,
    textAlign: "center",
  },
  mainMenuButton: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#334155',
  },
  menuIconContainer: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(255,255,255,0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  mainMenuTextContainer: {
    flex: 1,
  },
  mainMenuTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  mainMenuSub: {
    color: '#e2e8f0',
    fontSize: 12,
    marginBottom: 8,
  },
  menuButton: {
    flexDirection: "row",
    alignItems: "center",
    padding: 14,
    borderRadius: 10,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: "#334155",
    elevation: 2,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
  },
  menuTextContainer: {
    flex: 1,
    marginLeft: 10,
  },
  menuTitle: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "600",
    marginBottom: 2,
  },
  menuSub: {
    color: "#e2e8f0",
    fontSize: 10,
    opacity: 0.8,
  },
  badge: {
    backgroundColor: '#ef4444',
    borderRadius: 10,
    paddingHorizontal: 5,
    paddingVertical: 2,
    marginRight: 6,
  },
  badgeText: {
    color: '#fff',
    fontSize: 9,
    fontWeight: 'bold',
  },
  pageHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 12,
    paddingTop: 6,
  },
  backButton: {
    padding: 6,
    borderRadius: 6,
    backgroundColor: "#1e293b"
  },
  refreshButton: {
    padding: 6,
    borderRadius: 6,
    backgroundColor: "#1e293b"
  },
  pageTitle: {
    color: "#38bdf8",
    fontSize: 16,
    fontWeight: "bold"
  },
  smallStatusBar: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 12,
    marginBottom: 8,
    gap: 4,
  },
  smallStatusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  smallStatusText: {
    color: '#64748b',
    fontSize: 9,
  },
  content: {
    flex: 1,
    paddingHorizontal: 12,
  },
  card: {
    borderRadius: 10,
    padding: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#334155',
  },
  cardTitle: {
    color: '#fff',
    fontSize: 14,
    fontWeight: 'bold',
    marginBottom: 6,
  },
  cardSubtitle: {
    color: '#94a3b8',
    fontSize: 11,
    marginBottom: 8,
  },
  statusGrid: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    marginTop: 4,
  },
  statusItem: {
    alignItems: 'center',
    flex: 1,
  },
  statusValue: {
    color: '#38bdf8',
    fontSize: 20,
    fontWeight: 'bold',
  },
  statusLabel: {
    color: '#94a3b8',
    fontSize: 10,
  },
  statusDivider: {
    width: 1,
    height: 24,
    backgroundColor: '#334155',
  },
  toggleContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  schedulerControls: {
    marginTop: 4,
  },
  schedulerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  schedulerLabel: {
    color: '#94a3b8',
    fontSize: 12,
    width: 60,
  },
  schedulerButtons: {
    flexDirection: 'row',
    gap: 4,
    flex: 1,
  },
  intervalButton: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    backgroundColor: '#334155',
    flex: 1,
    alignItems: 'center',
  },
  intervalButtonActive: {
    backgroundColor: '#8b5cf6',
  },
  intervalButtonText: {
    color: '#94a3b8',
    fontSize: 10,
  },
  intervalButtonTextActive: {
    color: '#fff',
    fontWeight: 'bold',
  },
  timeInput: {
    backgroundColor: '#334155',
    color: '#fff',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    fontSize: 12,
    flex: 1,
  },
  saveSchedulerBtn: {
    marginTop: 4,
  },
  saveSchedulerGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    padding: 8,
    borderRadius: 6,
  },
  saveSchedulerText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 12,
  },
  runScriptBtn: {
    marginTop: 4,
  },
  runScriptGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    padding: 10,
    borderRadius: 6,
  },
  runScriptText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 13,
  },
  dueHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  dueItemContainer: {
    marginBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#334155',
    paddingBottom: 6,
  },
  dueItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  dueItemLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flex: 2,
  },
  dueAddress: {
    color: '#fff',
    fontSize: 13,
    fontWeight: 'bold',
  },
  dueName: {
    color: '#94a3b8',
    fontSize: 10,
    marginTop: 1,
  },
  dueRightSection: {
    alignItems: 'flex-end',
    gap: 2,
    flex: 1,
  },
  dueDate: {
    color: '#94a3b8',
    fontSize: 11,
  },
  dueDateExpired: {
    color: '#ef4444',
    fontWeight: 'bold',
  },
  paidButton: {
    minWidth: 50,
  },
  paidButtonGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    paddingVertical: 3,
    paddingHorizontal: 6,
    borderRadius: 12,
  },
  paidButtonText: {
    color: '#fff',
    fontSize: 9,
    fontWeight: 'bold',
  },
  expiredItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 5,
    borderBottomWidth: 1,
    borderBottomColor: '#334155',
  },
  expiredItemContent: {
    flex: 1,
  },
  expiredAddress: {
    color: '#fff',
    fontSize: 13,
    fontWeight: 'bold',
  },
  expiredName: {
    color: '#f87171',
    fontSize: 10,
    marginTop: 1,
  },
  expiredDue: {
    color: '#f87171',
    fontSize: 11,
    fontWeight: 'bold',
  },
  logsHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  noLogs: {
    color: '#64748b',
    fontStyle: 'italic',
    textAlign: 'center',
    padding: 16,
    fontSize: 12,
  },
  logEntry: {
    paddingVertical: 4,
    borderBottomWidth: 1,
    borderBottomColor: '#334155',
  },
  logTime: {
    color: '#64748b',
    fontSize: 9,
    marginBottom: 1,
  },
  logMessage: {
    color: '#94a3b8',
    fontSize: 11,
  },
  logSuccess: {
    color: '#22c55e',
  },
  logError: {
    color: '#ef4444',
  },
  searchContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#1e293b",
    marginHorizontal: 12,
    marginBottom: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#334155"
  },
  searchIcon: {
    marginLeft: 10
  },
  searchInput: {
    flex: 1,
    color: "#fff",
    padding: 10,
    fontSize: 13
  },
  centerContent: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 20
  },
  loadingText: {
    color: "#94a3b8",
    marginTop: 8,
    fontSize: 13
  },
  errorText: {
    color: "#dc2626",
    textAlign: "center",
    marginVertical: 8,
    fontSize: 13
  },
  retryBtn: {
    backgroundColor: "#2563eb",
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 6,
    marginTop: 8
  },
  btnText: {
    color: "#fff",
    fontWeight: "bold",
    fontSize: 13
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 30,
  },
  emptyText: {
    color: '#4b5563',
    fontSize: 13,
    marginTop: 8,
    textAlign: 'center',
  },
  leaseCard: {
    marginHorizontal: 12,
    marginBottom: 8,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#334155",
    elevation: 1,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 1
  },
  leaseCardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8
  },
  ipContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6
  },
  leaseIp: {
    color: "#38bdf8",
    fontWeight: "bold",
    fontSize: 13
  },
  leaseBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 12
  },
  leaseBadgeText: {
    color: "#fff",
    fontSize: 8,
    fontWeight: "bold"
  },
  leaseDetails: {
    marginBottom: 8,
    gap: 4
  },
  detailRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6
  },
  detailText: {
    color: "#e2e8f0",
    fontSize: 11
  },
  commentContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 8,
    backgroundColor: '#0f172a',
    padding: 6,
    borderRadius: 6,
  },
  leaseComment: {
    color: "#fff",
    fontSize: 12,
    flex: 1,
    fontWeight: '500',
  },
  noComment: {
    color: "#9ca3af",
    fontStyle: "italic",
    fontSize: 12,
    flex: 1
  },
  staticButton: {
    marginTop: 4
  },
  staticButtonGradient: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    padding: 8,
    borderRadius: 6
  },
  staticButtonText: {
    color: "#fff",
    fontWeight: "bold",
    fontSize: 11
  },
  addButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    marginHorizontal: 12,
    marginBottom: 12,
    padding: 10,
    borderRadius: 8
  },
  addButtonText: {
    color: "#fff",
    fontWeight: "bold",
    fontSize: 13
  },
  addressCard: {
    marginHorizontal: 12,
    marginBottom: 8,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#334155"
  },
  addressCardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8
  },
  addressIpContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    flex: 1,
  },
  addressIp: {
    color: "#38bdf8",
    fontWeight: "bold",
    fontSize: 13,
  },
  addressCommentInline: {
    color: "#fff",
    fontSize: 12,
    flex: 1,
    marginLeft: 2,
    fontWeight: '500',
  },
  addressStatus: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 12,
    marginLeft: 4,
  },
  addressStatusText: {
    color: "#fff",
    fontSize: 8,
    fontWeight: "bold"
  },
  dueDateBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#854d0e',
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 10,
    marginBottom: 6,
    alignSelf: 'flex-start',
  },
  dueDateText: {
    color: '#fbbf24',
    fontSize: 9,
  },
  historyButton: {
    marginBottom: 8,
  },
  historyButtonGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 3,
    paddingHorizontal: 6,
    borderRadius: 12,
    alignSelf: 'flex-start',
  },
  historyButtonText: {
    color: '#94a3b8',
    fontSize: 9,
  },
  actionsRow: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 2,
  },
  actionButton: {
    flex: 1,
  },
  actionButtonGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderRadius: 6,
  },
  actionButtonText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 11,
  },
  compactHistoryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 2,
    marginLeft: 18,
    paddingVertical: 1,
  },
  compactHistoryText: {
    color: '#64748b',
    fontSize: 9,
    fontStyle: 'italic',
  },
  queueCard: {
    marginHorizontal: 12,
    marginBottom: 8,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#334155"
  },
  queueCardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8
  },
  queueIpContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    flex: 1,
  },
  queueName: {
    color: "#f59e0b",
    fontWeight: "bold",
    fontSize: 13,
  },
  queueDetails: {
    marginBottom: 4,
    gap: 4
  },
  pppUserCard: {
    marginHorizontal: 12,
    marginBottom: 8,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#334155"
  },
  pppUserHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  pppUserInfo: {
    flex: 1,
  },
  pppUserName: {
    color: '#f59e0b',
    fontSize: 14,
    fontWeight: 'bold',
    marginBottom: 2,
  },
  pppUserProfile: {
    color: '#94a3b8',
    fontSize: 11,
  },
  pppUserStatus: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 12,
  },
  pppUserStatusText: {
    color: '#fff',
    fontSize: 9,
    fontWeight: 'bold',
  },
  pppUserComment: {
    color: '#94a3b8',
    fontSize: 11,
    marginBottom: 8,
    fontStyle: 'italic',
  },
  pppActiveCard: {
    marginHorizontal: 12,
    marginBottom: 8,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#334155"
  },
  pppActiveHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  pppActiveName: {
    color: '#10b981',
    fontSize: 14,
    fontWeight: 'bold',
  },
  pppActiveAddress: {
    color: '#94a3b8',
    fontSize: 12,
    marginTop: 2,
  },
  disconnectButton: {
    padding: 6,
    borderRadius: 6,
    width: 28,
    height: 28,
    justifyContent: 'center',
    alignItems: 'center',
  },
  pppActiveDetails: {
    gap: 4,
  },
  profileCard: {
    marginHorizontal: 12,
    marginBottom: 8,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#334155"
  },
  profileName: {
    color: '#8b5cf6',
    fontSize: 14,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  profileDetails: {
    gap: 4,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.95)",
    justifyContent: "center",
    alignItems: "center",
    padding: 16,
  },
  modalContent: {
    width: "90%",
    maxWidth: 400,
    padding: 24,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#4b5563"
  },
  statsModal: {
    maxHeight: 350,
  },
  modalTitle: {
    color: "#60a5fa",
    fontSize: 20,
    fontWeight: "bold",
    marginBottom: 12,
    textAlign: "center"
  },
  modalIp: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
    marginBottom: 20,
    textAlign: "center",
    backgroundColor: "#2d3a4f",
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 20,
    alignSelf: 'center',
  },
  modalLabel: {
    color: '#94a3b8',
    fontSize: 12,
    marginBottom: 6,
  },
  modalHint: {
    color: '#64748b',
    fontSize: 11,
    fontStyle: 'italic',
    marginBottom: 12,
  },
  modalInputContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#0f172a",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#334155",
    marginBottom: 10
  },
  modalInputIcon: {
    marginLeft: 10
  },
  modalInputWithIcon: {
    flex: 1,
    color: "#fff",
    padding: 10,
    fontSize: 13
  },
  modalInput: {
    backgroundColor: "#1e293b",
    color: "#fff",
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#4b5563",
    fontSize: 15,
    marginBottom: 20,
    minHeight: 100,
    textAlignVertical: "top",
    fontWeight: '500',
  },
  modalActions: {
  flexDirection: "row",
  justifyContent: "space-between",
  marginTop: 12,
  gap: 12,
  width: '100%',  // ← I-add ito
},
  modalButton: {
  flex: 1,
  padding: 14,
  borderRadius: 10,
  alignItems: "center",
  minWidth: 120,  // ← I-add ito para may minimum width
},
  cancelButton: {
    backgroundColor: "#4b5563",
  },
  saveButton: {
    backgroundColor: "#2563eb",
  },
  addModalButton: {
    backgroundColor: "#16a34a"
  },
  modalButtonText: {
    color: "#fff",
    fontWeight: "bold",
    fontSize: 16
  },
  statsCardInline: {
    marginHorizontal: 12,
    marginBottom: 12,
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#334155',
  },
  statsRowInline: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
  },
  statItemInline: {
    alignItems: 'center',
    flex: 1,
  },
  statNumberInline: {
    color: '#38bdf8',
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 2,
  },
  statLabelInline: {
    color: '#94a3b8',
    fontSize: 10,
  },
  statDivider: {
    width: 1,
    height: 24,
    backgroundColor: '#334155',
  },
  statsChart: {
    marginVertical: 16,
  },
  statBar: {
    marginBottom: 10,
  },
  statBarLabel: {
    color: '#94a3b8',
    fontSize: 11,
    marginBottom: 2,
  },
  statBarValue: {
    height: 20,
    backgroundColor: '#334155',
    borderRadius: 10,
    overflow: 'hidden',
    position: 'relative',
  },
  statBarFill: {
    height: '100%',
    backgroundColor: '#38bdf8',
    borderRadius: 10,
  },
  statBarText: {
    position: 'absolute',
    right: 8,
    top: 2,
    color: '#fff',
    fontSize: 11,
    fontWeight: 'bold',
  },
  profileDropdownButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#0f172a',
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 8,
    padding: 12,
    marginBottom: 10,
  },
  profileDropdownButtonText: {
    color: '#fff',
    fontSize: 14,
  },
  profileDropdownList: {
    backgroundColor: '#1e293b',
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 8,
    marginBottom: 10,
    maxHeight: 200,
  },
  profileDropdownItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#334155',
  },
  profileDropdownItemActive: {
    backgroundColor: '#2d3a4f',
  },
  profileDropdownItemContent: {
    flex: 1,
  },
  profileDropdownItemText: {
    color: '#94a3b8',
    fontSize: 14,
  },
  profileDropdownItemTextActive: {
    color: '#8b5cf6',
    fontWeight: 'bold',
  },
  profileDropdownItemRate: {
    color: '#64748b',
    fontSize: 11,
    marginTop: 2,
  },
  clearSearchText: {
    color: '#38bdf8',
    fontSize: 14,
    marginTop: 8,
    textDecorationLine: 'underline',
  },
  modalFieldContainer: {
    marginBottom: 16,
  },
  modalFieldLabel: {
    color: '#94a3b8',
    fontSize: 13,
    marginBottom: 6,
    marginLeft: 4,
    fontWeight: '500',
  },
  modalFieldInput: {
    backgroundColor: '#0f172a',
    color: '#fff',
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#334155',
    fontSize: 14,
  },
  copyAllButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#3b82f6',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 10,
    marginBottom: 20,
    gap: 8,
  },
  copyAllButtonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
  // Add these to your styles object
statsScroll: {
  marginBottom: 16,
  paddingHorizontal: 12,
},
statCardLarge: {
  width: 120,
  padding: 16,
  borderRadius: 12,
  marginRight: 12,
  alignItems: 'center',
  borderWidth: 1,
  borderColor: '#334155',
},
statNumberLarge: {
  color: '#fff',
  fontSize: 28,
  fontWeight: 'bold',
  marginVertical: 8,
},
summaryCard: {
  marginHorizontal: 12,
  marginBottom: 16,
  padding: 16,
  borderRadius: 12,
  borderWidth: 1,
  borderColor: '#334155',
},
summaryRow: {
  flexDirection: 'row',
  justifyContent: 'space-around',
},
summaryLabel: {
  color: '#94a3b8',
  fontSize: 12,
  marginBottom: 4,
},
summaryValue: {
  color: '#fff',
  fontSize: 18,
  fontWeight: 'bold',
},
invoiceCard: {
  marginHorizontal: 12,
  marginBottom: 12,
  padding: 16,
  borderRadius: 12,
  borderWidth: 1,
  borderColor: '#334155',
},
invoiceHeader: {
  flexDirection: 'row',
  justifyContent: 'space-between',
  alignItems: 'flex-start',
  marginBottom: 12,
},
invoiceId: {
  color: '#94a3b8',
  fontSize: 11,
  marginBottom: 4,
},
invoiceClient: {
  color: '#fff',
  fontSize: 16,
  fontWeight: 'bold',
  marginBottom: 2,
},
invoiceIp: {
  color: '#64748b',
  fontSize: 11,
},
invoiceStatusBadge: {
  paddingHorizontal: 10,
  paddingVertical: 4,
  borderRadius: 12,
},
invoiceStatusText: {
  color: '#fff',
  fontSize: 10,
  fontWeight: 'bold',
},
invoiceDetails: {
  marginBottom: 12,
  paddingVertical: 8,
  borderTopWidth: 1,
  borderBottomWidth: 1,
  borderColor: '#334155',
},
invoiceRow: {
  flexDirection: 'row',
  alignItems: 'center',
  marginVertical: 4,
  gap: 8,
},
invoiceLabel: {
  color: '#94a3b8',
  fontSize: 12,
  width: 80,
},
invoiceValue: {
  color: '#fff',
  fontSize: 12,
  flex: 1,
},
invoiceActions: {
  flexDirection: 'row',
  flexWrap: 'wrap',
  gap: 8,
},
invoiceActionBtn: {
  flexDirection: 'row',
  alignItems: 'center',
  gap: 4,
  paddingHorizontal: 12,
  paddingVertical: 6,
  borderRadius: 6,
  minWidth: 70,
  justifyContent: 'center',
},
invoiceActionText: {
  color: '#fff',
  fontSize: 11,
  fontWeight: 'bold',
},
modalContentLarge: {
  width: '90%',
  maxWidth: 500,
  maxHeight: '80%',
  padding: 20,
  borderRadius: 16,
  borderWidth: 1,
  borderColor: '#4b5563',
},
modalHeader: {
  flexDirection: 'row',
  justifyContent: 'space-between',
  alignItems: 'center',
  marginBottom: 20,
},
clientList: {
  maxHeight: 200,
  marginBottom: 16,
},
clientItem: {
  flexDirection: 'row',
  justifyContent: 'space-between',
  alignItems: 'center',
  padding: 12,
  backgroundColor: '#0f172a',
  borderRadius: 8,
  marginBottom: 8,
  borderWidth: 1,
  borderColor: '#334155',
},
clientItemActive: {
  backgroundColor: '#2563eb',
  borderColor: '#3b82f6',
},
clientItemLeft: {
  flexDirection: 'row',
  alignItems: 'center',
  gap: 10,
},
clientItemName: {
  color: '#fff',
  fontSize: 13,
  fontWeight: '500',
},
clientItemIp: {
  color: '#94a3b8',
  fontSize: 11,
},
clientItemPlan: {
  color: '#38bdf8',
  fontSize: 12,
  fontWeight: '500',
},
modalNote: {
  color: '#64748b',
  fontSize: 11,
  fontStyle: 'italic',
  marginBottom: 20,
},
invoicePreview: {
  padding: 20,
  backgroundColor: '#fff',
  borderRadius: 8,
},
previewTitle: {
  color: '#000',
  fontSize: 18,
  fontWeight: 'bold',
  textAlign: 'center',
  marginBottom: 4,
},
previewSubtitle: {
  color: '#4b5563',
  fontSize: 12,
  textAlign: 'center',
  marginBottom: 16,
},
previewDivider: {
  height: 1,
  backgroundColor: '#e2e8f0',
  marginVertical: 12,
},
previewRow: {
  flexDirection: 'row',
  justifyContent: 'space-between',
  marginVertical: 4,
},
previewLabel: {
  color: '#4b5563',
  fontSize: 12,
},
previewValue: {
  color: '#000',
  fontSize: 12,
  fontWeight: '500',
},
previewSectionTitle: {
  color: '#000',
  fontSize: 14,
  fontWeight: 'bold',
  marginBottom: 8,
},
previewClientName: {
  color: '#000',
  fontSize: 16,
  fontWeight: 'bold',
  marginBottom: 4,
},
previewClientIp: {
  color: '#4b5563',
  fontSize: 12,
  marginBottom: 2,
},
previewClientPlan: {
  color: '#2563eb',
  fontSize: 12,
  marginBottom: 8,
},
previewTable: {
  marginVertical: 8,
},
previewTableHeader: {
  flexDirection: 'row',
  justifyContent: 'space-between',
  paddingVertical: 8,
  borderBottomWidth: 1,
  borderBottomColor: '#e2e8f0',
},
previewTableHeaderText: {
  color: '#4b5563',
  fontSize: 12,
  fontWeight: 'bold',
},
previewTableRow: {
  flexDirection: 'row',
  justifyContent: 'space-between',
  paddingVertical: 8,
},
previewTableDesc: {
  color: '#000',
  fontSize: 12,
},
previewTableAmount: {
  color: '#000',
  fontSize: 12,
  fontWeight: '500',
},
previewTotal: {
  flexDirection: 'row',
  justifyContent: 'space-between',
  alignItems: 'center',
  marginTop: 8,
},
previewTotalLabel: {
  color: '#000',
  fontSize: 16,
  fontWeight: 'bold',
},
previewTotalAmount: {
  color: '#059669',
  fontSize: 20,
  fontWeight: 'bold',
},
previewStatus: {
  alignSelf: 'flex-start',
  paddingHorizontal: 12,
  paddingVertical: 4,
  borderRadius: 16,
  marginTop: 12,
},
previewStatusText: {
  color: '#fff',
  fontSize: 11,
  fontWeight: 'bold',
},
previewFooter: {
  color: '#4b5563',
  fontSize: 11,
  textAlign: 'center',
  marginTop: 16,
  fontStyle: 'italic',
},
});

// ============================================================================
// EXPORT APP WITH ERROR BOUNDARY
// ============================================================================
export default function App() {
  return (
    <ErrorBoundary>
      <HomeScreen />
    </ErrorBoundary>
  );
}