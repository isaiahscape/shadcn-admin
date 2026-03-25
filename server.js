// ============================================================================
// MIKROTIK BILLING & BANDWIDTH API SERVER
// ============================================================================
import express from "express";
import cors from "cors";
import { RouterOSAPI } from "node-routeros";
import { promises as fs } from "fs";
import fsSync from "fs";
import path from "path";
import cron from "node-cron";
import Database from "better-sqlite3";
import { fileURLToPath } from "url";
import { dirname } from "path";
import { exec } from "child_process";
import { createRequire } from "module";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const require = createRequire(import.meta.url);

// ============================================================================
// MONKEY-PATCH NODE-ROUTEROS TO FIX UNCAUGHT EXCEPTIONS
// ============================================================================
try {
  const ChannelModule = require("node-routeros/dist/Channel");
  const Channel = ChannelModule.Channel || ChannelModule.default || ChannelModule;
  if (Channel && Channel.prototype && Channel.prototype.processPacket) {
    const origProcessPacket = Channel.prototype.processPacket;
    Channel.prototype.processPacket = function (packet) {
      if (packet && packet[0] === "!empty") {
        // Ignore !empty packet because a !done will follow.
        // Treating it as !done causes UNREGISTEREDTAG when the real !done arrives.
        return; 
      }
      return origProcessPacket.call(this, packet);
    };
    console.log("✅ Patched node-routeros Channel to ignore !empty replies");
  }

  const ReceiverModule = require("node-routeros/dist/connector/Receiver");
  const Receiver = ReceiverModule.Receiver || ReceiverModule.default || ReceiverModule;
  if (Receiver && Receiver.prototype && Receiver.prototype.sendTagData) {
    const origSendTagData = Receiver.prototype.sendTagData;
    Receiver.prototype.sendTagData = function(tag, data) {
      if (!this.tags || !this.tags.has(tag)) {
        return; // Silently ignore unregistered tags instead of crashing
      }
      return origSendTagData.call(this, tag, data);
    };
    console.log("✅ Patched node-routeros Receiver to handle UNREGISTEREDTAG safely");
  }
} catch (err) {
  console.log("⚠️ Could not patch node-routeros:", err.message);
}

const app = express();

// ============================================================================
// ULTIMATE CORS FIX - ALLOW ALL
// ============================================================================
app.use((req, res, next) => {
  // Allow all origins
  const origin = req.headers.origin;
  
  // List of allowed origins (add your web app URL)
  const allowedOrigins = [
    'http://localhost:19006',
    'http://localhost:19007',
    'http://localhost:8081',
    'http://127.0.0.1:19006',
    'http://127.0.0.1:19007',
    'exp://',
    'http://192.168.1.*',
    'http://126.209.18.178:3000',
    'http://192.168.254.100/24',
    'http://localhost:3000'
  ];
  
  // Allow any origin (for testing)
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  } else {
    res.setHeader('Access-Control-Allow-Origin', '*');
  }
  
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS, HEAD');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Expose-Headers', '*');
  
  // Handle preflight requests (OPTIONS)
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Max-Age', '86400'); // 24 hours
    return res.sendStatus(200);
  }
  
  next();
});

// Then use express.json()
app.use(express.json());

// ============================================================================
// CONFIGURATION
// ============================================================================
const ROUTER_IP = "192.168.254.100";
const USER = "appadmin";
const PASS = "kreiorono06";
const ADDRESS_LIST = "ipoe-allowed";
const PORT = 3000;

// ============================================================================
// DATABASE SETUP - WITH PAYMENT AND GRACE FIELDS
// ============================================================================
const dbPath = path.join(__dirname, 'mikrotik.db');
const db = new Database(dbPath);

console.log("🔄 Checking and adding missing columns...");

const safeAlter = (query) => {
  try {
    db.prepare(query).run();
  } catch (err) {
    if (!err.message.includes('duplicate column name')) {
      console.error(`❌ Error in query "${query}":`, err.message);
    }
  }
};

safeAlter("ALTER TABLE clients ADD COLUMN lastPaymentDate TEXT");
safeAlter("ALTER TABLE clients ADD COLUMN lastPaymentAmount REAL");
safeAlter("ALTER TABLE clients ADD COLUMN graceUntil TEXT");
safeAlter("ALTER TABLE clients ADD COLUMN graceReason TEXT");
safeAlter("ALTER TABLE clients ADD COLUMN graceCount INTEGER DEFAULT 0");

safeAlter("ALTER TABLE invoices ADD COLUMN clientAccountNumber TEXT");
safeAlter("ALTER TABLE invoices ADD COLUMN paymentDate TEXT");
safeAlter("ALTER TABLE invoices ADD COLUMN paymentMethod TEXT");
safeAlter("ALTER TABLE invoices ADD COLUMN reference TEXT");
safeAlter("ALTER TABLE invoices ADD COLUMN notes TEXT");

try {
  db.prepare(`CREATE TABLE IF NOT EXISTS clients (
    id TEXT PRIMARY KEY,
    accountNumber TEXT,
    ip TEXT,
    name TEXT,
    plan TEXT,
    address TEXT,
    landmark TEXT,
    cpNumber TEXT,
    email TEXT,
    birthdate TEXT,
    installDate TEXT,
    dueDate TEXT,
    registeredAt TEXT,
    status TEXT,
    lastPaymentDate TEXT,
    lastPaymentAmount REAL,
    graceUntil TEXT,
    graceReason TEXT,
    graceCount INTEGER DEFAULT 0
  )`).run();
  console.log("✅ Clients table ready");

  db.prepare(`CREATE TABLE IF NOT EXISTS invoices (
    id TEXT PRIMARY KEY,
    clientId TEXT,
    clientName TEXT,
    clientIp TEXT,
    planName TEXT,
    amount REAL,
    dueDate TEXT,
    issueDate TEXT,
    status TEXT DEFAULT 'pending'
  )`).run();
  console.log("✅ Invoices table ready");

  db.prepare(`CREATE TABLE IF NOT EXISTS payments (
    id TEXT PRIMARY KEY,
    clientId TEXT,
    clientName TEXT,
    clientIp TEXT,
    accountNumber TEXT,
    amount REAL,
    paymentDate TEXT,
    dueDate TEXT,
    paymentMethod TEXT,
    reference TEXT,
    notes TEXT,
    status TEXT DEFAULT 'paid',
    recordedBy TEXT,
    createdAt TEXT
  )`).run();
  console.log("✅ Payments table ready");

  db.prepare(`CREATE TABLE IF NOT EXISTS billing_history (
    id TEXT PRIMARY KEY,
    clientId TEXT,
    clientIp TEXT,
    periodStart TEXT,
    periodEnd TEXT,
    amountDue REAL,
    amountPaid REAL,
    balance REAL,
    status TEXT,
    dueDate TEXT,
    paidAt TEXT,
    createdAt TEXT
  )`).run();
  console.log("✅ Billing_history table ready");

  db.prepare(`CREATE TABLE IF NOT EXISTS grace_history (
    id TEXT PRIMARY KEY,
    clientId TEXT,
    clientIp TEXT,
    clientName TEXT,
    graceUntil TEXT,
    graceReason TEXT,
    grantedBy TEXT,
    createdAt TEXT,
    notes TEXT
  )`).run();
  console.log("✅ Grace_history table ready");

  db.prepare(`CREATE TABLE IF NOT EXISTS plans (
    id TEXT PRIMARY KEY,
    name TEXT,
    price REAL,
    speed TEXT,
    burstLimit TEXT,
    description TEXT,
    isActive INTEGER DEFAULT 1
  )`).run();
  console.log("✅ Plans table ready");

  // Insert default plans if table is empty
  const existingPlans = db.prepare('SELECT COUNT(*) as count FROM plans').get();
  if (existingPlans.count === 0) {
    const defaultPlans = [
      { id: '1', name: 'PLAN799', price: 799, speed: '25M/25M', burstLimit: '50M/50M', description: '25Mbps Fiber', isActive: 1 },
      { id: '2', name: 'PLAN999', price: 999, speed: '35M/35M', burstLimit: '70M/70M', description: '35Mbps Fiber', isActive: 1 },
      { id: '3', name: 'PLAN1299', price: 1299, speed: '50M/50M', burstLimit: '100M/100M', description: '50Mbps Fiber', isActive: 1 },
      { id: '4', name: 'PLAN1699', price: 1699, speed: '75M/75M', burstLimit: '150M/150M', description: '75Mbps Fiber', isActive: 1 },
      { id: '5', name: 'PLAN1999', price: 1999, speed: '105M/105M', burstLimit: '200M/200M', description: '105Mbps Fiber', isActive: 1 },
    ];
    const insertPlan = db.prepare(`INSERT INTO plans (id, name, price, speed, burstLimit, description, isActive) VALUES (?, ?, ?, ?, ?, ?, ?)`);
    defaultPlans.forEach(p => insertPlan.run(p.id, p.name, p.price, p.speed, p.burstLimit, p.description, p.isActive));
  }

  console.log("✅ All database tables created/verified");
} catch (err) {
  console.error("❌ Error verifying database tables:", err);
}

// ============================================================================
// STATE MANAGEMENT
// ============================================================================
let autoDisableState = {
  enabled: true,
  interval: '1d',
  time: '00:05:00',
  lastRun: null,
  nextRun: null,
  schedulerTask: null
};

const LOG_FILE = path.join(__dirname, 'auto-disable.log');
let previousComments = new Map();
let lastSuccessfulScan = null;
let scanErrors = 0;
const MAX_CONSECUTIVE_ERRORS = 5;
let offlineClients = new Map();
let clientQueues = new Map();
let monitorTask = null;

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

async function connectRouter(retries = 3) {
  let lastError;
  
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const conn = new RouterOSAPI({
        host: ROUTER_IP,
        user: USER,
        password: PASS,
        port: 8728,
        timeout: 30,
        tries: 2
      });
      
      const connectPromise = conn.connect();
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Connection timeout after 30 seconds')), 30000);
      });
      
      await Promise.race([connectPromise, timeoutPromise]);
      
      conn.on('error', (error) => {
        console.log(`⚠️ Connection error: ${error.message}`);
      });
      
      return conn;
      
    } catch (error) {
      lastError = error;
      console.log(`⚠️ Connection attempt ${attempt}/${retries} failed: ${error.message}`);
      
      if (attempt < retries) {
        const waitTime = attempt * 2000;
        console.log(`⏳ Waiting ${waitTime/1000}s before retry...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
    }
  }
  
  throw new Error(`Failed to connect after ${retries} attempts: ${lastError.message}`);
}

const logToFile = async (message, type = 'INFO') => {
  const timestamp = new Date().toISOString();
  const logEntry = `[${timestamp}] [${type}] ${message}\n`;
  
  try {
    await fs.appendFile(LOG_FILE, logEntry);
    console.log(`[${type}] ${message}`);
  } catch (error) {
    console.error('Failed to write to log file:', error);
  }
};

const parseDueDate = (comment) => {
  if (!comment) return null;
  
  const match = comment.match(/due\s+(\d{2})-(\d{2})-(\d{2})/i);
  if (match) {
    const [_, month, day, year] = match;
    const fullYear = `20${year}`;
    return {
      month,
      day,
      year: fullYear,
      dateStr: `${month}-${day}-${year}`,
      timestamp: new Date(`${fullYear}-${month}-${day}`).getTime()
    };
  }
  return null;
};

function extractPlanFromComment(comment) {
  if (!comment) return null;
  
  const planMatch = comment.match(/PLAN=(\d+)/i);
  if (planMatch) return planMatch[1];
  
  const oldPlanMatch = comment.match(/PLAN(\d+)/i);
  if (oldPlanMatch) return oldPlanMatch[1];
  
  const numberMatch = comment.match(/\b(799|999|1299|1500|1699|1999)\b/);
  if (numberMatch) return numberMatch[1];
  
  return null;
}

function extractNameFromComment(comment) {
  if (!comment) return 'Client';
  
  let cleanComment = comment.replace(/\s+due\s+\d{2}-\d{2}-\d{2}/i, '');
  
  const planPos = cleanComment.indexOf('PLAN');
  if (planPos > 0) {
    return cleanComment.substring(0, planPos).trim() || 'Client';
  }
  
  return cleanComment.trim() || 'Client';
}

async function isClientOnline(ip) {
  return new Promise((resolve) => {
    const command = process.platform === 'win32' 
      ? `ping -n 2 -w 2000 ${ip}`
      : `ping -c 2 -W 2 ${ip}`;
    
    exec(command, { timeout: 3000 }, (error, stdout) => {
      if (error) {
        resolve(false);
        return;
      }
      const success = stdout.includes('TTL=') || 
                     stdout.includes('Reply from') ||
                     stdout.includes('bytes from');
      resolve(success);
    });
  });
}

const QUEUE_SPEEDS = {
  "799": { maxLimit: "25M/25M", burstLimit: "53M/53M", burstThreshold: "18M/18M", limitAt: "25M/25M", burstTime: "60s/60s" },
  "999": { maxLimit: "35M/35M", burstLimit: "78M/78M", burstThreshold: "25M/25M", limitAt: "35M/35M", burstTime: "60s/60s" },
  "1299": { maxLimit: "50M/50M", burstLimit: "105M/105M", burstThreshold: "35M/35M", limitAt: "50M/50M", burstTime: "60s/60s" },
  "1500": { maxLimit: "65M/65M", burstLimit: "135M/135M", burstThreshold: "46M/46M", limitAt: "65M/65M", burstTime: "60s/60s" },
  "1699": { maxLimit: "75M/75M", burstLimit: "155M/155M", burstThreshold: "53M/53M", limitAt: "75M/75M", burstTime: "60s/60s" },
  "1999": { maxLimit: "105M/105M", burstLimit: "205M/205M", burstThreshold: "78M/78M", limitAt: "105M/105M", burstTime: "60s/60s" }
};

function getQueueSpeedForPlan(plan) {
  return QUEUE_SPEEDS[plan] || { maxLimit: "5M/5M", burstLimit: "6M/6M", burstThreshold: "4M/4M", limitAt: "5M/5M", burstTime: "15s/15s" };
}

// ============================================================================
// AUTO-DISABLE FUNCTIONS (WITH GRACE PERIOD SUPPORT)
// ============================================================================

const checkAndDisableExpired = async () => {
  try {
    await logToFile('🚀 Running auto-disable script...');
    
    const conn = await connectRouter();
    
    const list = await conn.write(
      "/ip/firewall/address-list/print",
      ["?list=" + ADDRESS_LIST]
    );
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const currentDateStr = `${today.getFullYear()}-${(today.getMonth()+1).toString().padStart(2,'0')}-${today.getDate().toString().padStart(2,'0')}`;
    
    await logToFile(`📅 Today: ${currentDateStr}`);
    
    let disabledCount = 0;
    const disabledEntries = [];
    
    for (const entry of list) {
      if (entry.disabled === "true") continue;
      
      if (entry.comment && entry.comment.toLowerCase().includes('due')) {
        const dueInfo = parseDueDate(entry.comment);
        
        if (dueInfo) {
          const dueDateStr = `${dueInfo.year}-${dueInfo.month}-${dueInfo.day}`;
          const dueDate = new Date(dueDateStr);
          dueDate.setHours(0, 0, 0, 0);
          
          // ===== CHECK GRACE PERIOD FROM COMMENT =====
          let inGrace = false;
          
          const graceMatch = entry.comment.match(/\(grace:\s*([^)]+)\)/i);
          if (graceMatch) {
            const graceDate = new Date(graceMatch[1]);
            graceDate.setHours(0, 0, 0, 0);
            inGrace = graceDate >= today;
          }
          
          // ===== CHECK GRACE PERIOD FROM DATABASE =====
          if (!inGrace) {
            // Hanapin sa database ang client by IP
            let client = null;
            try {
              client = db.prepare('SELECT graceUntil FROM clients WHERE ip = ?').get(entry.address);
            } catch (err) {}
            
            if (client && client.graceUntil) {
              const dbGraceDate = new Date(client.graceUntil);
              dbGraceDate.setHours(0, 0, 0, 0);
              inGrace = dbGraceDate >= today;
              
              // Update comment kung may grace sa DB pero wala sa comment
              if (inGrace && !graceMatch) {
                const newComment = `${entry.comment} (grace: ${client.graceUntil})`;
                try {
                  await conn.write("/ip/firewall/address-list/set", [
                    "=.id=" + entry[".id"],
                    "=comment=" + newComment
                  ]);
                  console.log(`✅ Added grace to comment for ${entry.address}`);
                } catch (e) {}
              }
            }
          }
          
          // ===== DISABLE RULE =====
          if (dueDate < today && !inGrace) {
            try {
              await conn.write("/ip/firewall/address-list/set", [
                "=.id=" + entry[".id"],
                "=disabled=yes",
                "=comment=" + `${entry.comment} (auto-disabled: ${new Date().toLocaleDateString()})`
              ]);
              
              disabledCount++;
              disabledEntries.push({
                address: entry.address,
                dueDate: dueInfo.dateStr,
                comment: entry.comment
              });
              
              await logToFile(`🔴 Disabled: ${entry.address} (Due: ${dueInfo.dateStr})`);
            } catch (error) {
              await logToFile(`❌ Failed to disable ${entry.address}: ${error.message}`, 'ERROR');
            }
          }
        }
      }
    }
    
    await conn.close();
    await logToFile(`✅ Script completed: ${disabledCount} entries disabled`);
    
    return {
      success: true,
      disabled: disabledCount,
      entries: disabledEntries,
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    await logToFile(`❌ Script failed: ${error.message}`, 'ERROR');
    return {
      success: false,
      error: error.message,
      disabled: 0
    };
  }
};

const setupAutoDisableScheduler = (interval, time, enabled) => {
  console.log(`🔧 Setting up auto-disable scheduler: interval=${interval}, time=${time}, enabled=${enabled}`);
  
  if (autoDisableState.schedulerTask) {
    console.log("⏹️ Stopping existing scheduler");
    autoDisableState.schedulerTask.stop();
    autoDisableState.schedulerTask = null;
  }
  
  if (!enabled) {
    console.log("⏸️ Auto-disable scheduler disabled");
    autoDisableState.enabled = false;
    autoDisableState.nextRun = null;
    return;
  }
  
  const [hour, minute] = time.split(':');
  
  let cronExpression = '';
  switch (interval) {
    case '1h':
      cronExpression = `${minute} * * * *`;
      break;
    case '6h':
      cronExpression = `${minute} */6 * * *`;
      break;
    case '12h':
      cronExpression = `${minute} */12 * * *`;
      break;
    case '1d':
    default:
      cronExpression = `${minute} ${hour} * * *`;
      break;
  }
  
  const task = cron.schedule(cronExpression, async () => {
    console.log("⏰ Scheduled auto-disable started at", new Date().toISOString());
    await logToFile('⏰ Scheduled auto-disable started');
    const result = await checkAndDisableExpired();
    autoDisableState.lastRun = new Date().toISOString();
    
    const next = new Date();
    if (interval === '1d') {
      next.setDate(next.getDate() + 1);
      next.setHours(parseInt(hour), parseInt(minute), 0, 0);
    } else if (interval === '1h') {
      next.setHours(next.getHours() + 1);
    } else if (interval === '6h') {
      next.setHours(next.getHours() + 6);
    } else if (interval === '12h') {
      next.setHours(next.getHours() + 12);
    }
    autoDisableState.nextRun = next.toISOString();
    
    console.log(`⏰ Scheduled auto-disable completed: ${result.disabled} entries disabled`);
    await logToFile(`⏰ Scheduled auto-disable completed: ${result.disabled} entries disabled`);
  });
  
  autoDisableState.schedulerTask = task;
  autoDisableState.enabled = true;
  autoDisableState.interval = interval;
  autoDisableState.time = time;
  
  const now = new Date();
  let nextRun = new Date();
  
  if (interval === '1d') {
    nextRun.setHours(parseInt(hour), parseInt(minute), 0, 0);
    if (nextRun <= now) {
      nextRun.setDate(nextRun.getDate() + 1);
    }
  } else if (interval === '1h') {
    nextRun.setHours(now.getHours() + 1, parseInt(minute), 0, 0);
  } else if (interval === '6h') {
    const hoursUntilNext = 6 - (now.getHours() % 6);
    nextRun.setHours(now.getHours() + hoursUntilNext, parseInt(minute), 0, 0);
  } else if (interval === '12h') {
    const hoursUntilNext = 12 - (now.getHours() % 12);
    nextRun.setHours(now.getHours() + hoursUntilNext, parseInt(minute), 0, 0);
  }
  
  autoDisableState.nextRun = nextRun.toISOString();
  
  console.log("✅ Auto-disable scheduler setup complete. Next run:", autoDisableState.nextRun);
  task.start();
};

// ============================================================================
// GRACE PERIOD REMINDER MIDDLEWARE
// ============================================================================

function getDaysOverdue(dueDate) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  const [month, day, year] = dueDate.split('-').map(Number);
  const due = new Date(2000 + year, month - 1, day);
  due.setHours(0, 0, 0, 0);
  
  return Math.ceil((today - due) / (1000 * 60 * 60 * 24));
}

function isInGracePeriod(dueDate, graceUntil) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  if (graceUntil) {
    const graceDate = new Date(graceUntil);
    graceDate.setHours(0, 0, 0, 0);
    return graceDate >= today;
  }
  
  return false;
}

// Redirect middleware - GRACE PERIOD LANG
app.use(async (req, res, next) => {
  const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  
  if (req.path.startsWith('/api/') || 
      req.path.includes('.html') || 
      req.path.includes('.js') || 
      req.path.includes('.css') ||
      req.path === '/favicon.ico') {
    return next();
  }
  
  try {
    const client = db.prepare('SELECT dueDate, graceUntil FROM clients WHERE ip = ?').get(clientIp);
    
    if (client && client.dueDate) {
      const daysOverdue = getDaysOverdue(client.dueDate);
      const inGrace = isInGracePeriod(client.dueDate, client.graceUntil);
      
      if (inGrace) {
        console.log(`⏰ Grace period: ${clientIp} (${daysOverdue} days overdue)`);
        return res.redirect(`/reminder-grace.html?ip=${clientIp}&days=${daysOverdue}&due=${client.dueDate}&graceUntil=${client.graceUntil}`);
      }
    }
  } catch (error) {
    console.error('❌ Reminder error:', error);
  }
  
  next();
});

// ============================================================================
// IPOE / DHCP LEASES ENDPOINTS
// ============================================================================

app.get("/leases", async (req, res) => {
  try {
    const conn = await connectRouter();
    const leases = await conn.write("/ip/dhcp-server/lease/print");
    await conn.close();

    const formatted = leases.map(l => ({
      ".id": l[".id"],
      address: l.address,
      "mac-address": l["mac-address"],
      server: l.server,
      comment: l.comment || "",
      dynamic: l.dynamic === "true",
      status: l.status,
      "host-name": l["host-name"]
    }));

    res.json(formatted);
  } catch (err) {
    console.log("LEASE ERROR:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get("/address-list", async (req, res) => {
  try {
    const conn = await connectRouter();
    const list = await conn.write(
      "/ip/firewall/address-list/print",
      ["?list=" + ADDRESS_LIST]
    );
    await conn.close();

    const formatted = list.map(i => ({
      ".id": i[".id"],
      address: i.address,
      comment: i.comment || "",
      disabled: i.disabled === "true"
    }));

    res.json(formatted);
  } catch (err) {
    console.log("ADDRESS LIST ERROR:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get("/queues/all", async (req, res) => {
  try {
    const conn = await connectRouter();
    const queues = await conn.write("/queue/simple/print");
    await conn.close();

    const allQueues = queues.filter(q => {
      if (!q.target) return false;
      if (q.target === "0.0.0.0/0") return false;
      return true;
      
    }).map(q => {
      const target = q.target.toString();
      let type = 'unknown';
      
      if (target.includes('<pppoe-')) {
        type = 'pppoe';
      } else if (target.includes('/32') || /^\d+\.\d+\.\d+\.\d+$/.test(target)) {
        type = 'static';
      }
      
      let displayName = target;
      if (target.includes('<pppoe-')) {
        displayName = target.replace('<pppoe-', '').replace('>', '');
      } else if (target.includes('/')) {
        displayName = target.split('/')[0];
      }
      
      return {
        ".id": q[".id"],
        target: target,
        displayName: displayName,
        name: q.name || "",
        maxLimit: q["max-limit"] || "0/0",
        comment: q.comment || "",
        disabled: q.disabled === "true",
        type: type
      };
    });

    console.log(`📊 Found ${allQueues.length} total queues`);
    res.json(allQueues);
  } catch (err) {
    console.log("ALL QUEUES ERROR:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post("/update-comment", async (req, res) => {
  try {
    const { id, comment } = req.body;
    const conn = await connectRouter();
    await conn.write("/ip/dhcp-server/lease/set", [
      "=.id=" + id,
      "=comment=" + comment
    ]);
    await conn.close();
    res.json({ success: true });
  } catch (err) {
    console.log("COMMENT ERROR:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post("/update-address-comment", async (req, res) => {
  try {
    const { id, comment } = req.body;
    console.log(`📝 FULL OVERWRITE: Setting address comment for ID: ${id} to: ${comment}`);
    const conn = await connectRouter();

        // Get the IP address first to sync with database
    const list = await conn.write("/ip/firewall/address-list/print", [`?.id=${id}`]);
    const ip = list.length > 0 ? list[0].address : null;


    // Always set the full comment, do not attempt to merge or replace
    await conn.write("/ip/firewall/address-list/set", [
      `=.id=${id}`,
      `=comment=${comment}`
    ]);
    await conn.close();

    // Sync with SQLite database if we found the IP
    if (ip) {
      const dueMatch = comment.match(/due\s+(\d{2}-\d{2}-\d{2})/i);
      const dueDate = dueMatch ? dueMatch[1] : null;
      
      const graceMatch = comment.match(/\(grace:\s*([^)]+)\)/i);
      const graceUntil = graceMatch ? graceMatch[1] : null;
      
      const installMatch = comment.match(/\(installed:\s*([^)]+)\)/i);
      const installDate = installMatch ? installMatch[1] : null;
      
      try {
        const client = db.prepare('SELECT id, graceCount FROM clients WHERE ip = ?').get(ip);
        if (client) {
          const updates = [];
          const params = [];
          
          if (dueDate) {
            updates.push("dueDate = ?"); params.push(dueDate);
            
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const [dueMonth, dueDay, dueYear] = dueDate.split('-').map(Number);
            const dueDateObj = new Date(2000 + dueYear, dueMonth - 1, dueDay);
            dueDateObj.setHours(0, 0, 0, 0);
            
            let inGrace = false;
            let formattedGraceUntil = graceUntil;
            
            if (graceUntil) {
              let graceDate;
              if (graceUntil.length <= 8 && graceUntil.includes('-')) {
                const [gMonth, gDay, gYear] = graceUntil.split('-').map(Number);
                graceDate = new Date(2000 + gYear, gMonth - 1, gDay);
              } else {
                graceDate = new Date(graceUntil);
              }
              
              if (!isNaN(graceDate.getTime())) {
                graceDate.setHours(0, 0, 0, 0);
                inGrace = graceDate >= today;
                formattedGraceUntil = `${graceDate.getFullYear()}-${String(graceDate.getMonth() + 1).padStart(2, '0')}-${String(graceDate.getDate()).padStart(2, '0')}`;
              }
            }
            
            let status = 'active';
            if (dueDateObj < today && !inGrace) {
              status = 'expired';
            }
            
            updates.push("status = ?"); params.push(status);
            
            if (formattedGraceUntil) {
              updates.push("graceUntil = ?"); params.push(formattedGraceUntil);
              updates.push("graceReason = ?"); params.push("Updated via Winbox comment");
            } else if (comment.includes('due') && !comment.includes('grace:')) {
              updates.push("graceUntil = ?"); params.push(null);
            }
          }
          
          if (installDate) { 
            updates.push("installDate = ?"); params.push(installDate); 
          }
          
          if (updates.length > 0) {
            params.push(ip);
            db.prepare(`UPDATE clients SET ${updates.join(", ")} WHERE ip = ?`).run(...params);
            console.log(`✅ Synced comment changes to DB for IP: ${ip}`);
          }
        }
      } catch (err) {
        console.error("❌ Failed to sync comment to DB:", err.message);
      }
    }
    console.log("✅ Address comment fully overwritten");
    res.json({ success: true });
  } catch (err) {
    console.log("❌ UPDATE ADDRESS COMMENT ERROR:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post("/convert-and-allow", async (req, res) => {
  try {
    const { id, ip, comment } = req.body;
    
    console.log("=".repeat(50));
    console.log("🔄 CONVERT AND ALLOW REQUEST RECEIVED");
    console.log("📦 Request body:", req.body);
    console.log("=".repeat(50));
    
    const conn = await connectRouter();
    console.log("✅ Connected to router");
    
    try {
      await conn.write("/ip/dhcp-server/lease/make-static", ["=.id=" + id]);
      console.log(`✅ Converted to static`);
    } catch (convertError) {
      console.log("⚠️ Convert error (might be already static):", convertError.message);
    }
    
    try {
      await conn.write("/ip/dhcp-server/lease/set", [
        "=.id=" + id,
        "=comment=" + comment
      ]);
      console.log(`✅ Updated lease comment`);
    } catch (commentError) {
      console.log("⚠️ Comment update error:", commentError.message);
    }
    
    try {
      await conn.write("/ip/firewall/address-list/add", [
        "=list=" + ADDRESS_LIST,
        "=address=" + ip,
        "=comment=" + comment
      ]);
      console.log(`✅ Added to address list`);
    } catch (addError) {
      console.log("⚠️ Add error, trying to update existing:", addError.message);
      
      try {
        const existing = await conn.write(
          "/ip/firewall/address-list/print",
          ["?list=" + ADDRESS_LIST, "?address=" + ip]
        );
        
        if (existing && existing.length > 0) {
          await conn.write("/ip/firewall/address-list/set", [
            "=.id=" + existing[0][".id"],
            "=comment=" + comment,
            "=disabled=no"
          ]);
          console.log(`✅ Updated existing entry`);
        }
      } catch (findError) {
        console.log("❌ Find error:", findError.message);
      }
    }
    
    await conn.close();
    console.log("🔌 Connection closed");
    console.log("✅ All operations attempted");
    console.log("=".repeat(50));
    
    res.json({ 
      success: true, 
      message: "Lease converted successfully",
      ip: ip 
    });
    
  } catch (err) {
    console.log("❌ CONVERT AND ALLOW ERROR:", err);
    res.json({ 
      success: true, 
      warning: "Operation completed but with some issues",
      message: "Lease converted. Please verify address list.",
      ip: req.body.ip 
    });
  }
});

app.post("/enable-ip", async (req, res) => {
  try {
    const { ip } = req.body;
    
    console.log(`🟢 Enabling internet for IP: ${ip}`);
    
    const conn = await connectRouter();
    
    const existing = await conn.write(
      "/ip/firewall/address-list/print",
      ["?list=" + ADDRESS_LIST, "?address=" + ip]
    );

    if (existing.length > 0) {
      await conn.write("/ip/firewall/address-list/set", [
        "=.id=" + existing[0][".id"],
        "=disabled=no"
      ]);
      console.log(`✅ Enabled IP: ${ip}`);
    } else {
      await conn.write("/ip/firewall/address-list/add", [
        "=list=" + ADDRESS_LIST,
        "=address=" + ip,
        "=comment=Enabled manually"
      ]);
      console.log(`✅ Added and enabled new IP: ${ip}`);
    }

    await conn.close();
    res.json({ success: true });
  } catch (err) {
    console.log("❌ ENABLE ERROR:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post("/disable-ip", async (req, res) => {
  try {
    const { ip } = req.body;
    
    console.log(`🔴 Disabling internet for IP: ${ip}`);
    
    const conn = await connectRouter();
    
    const existing = await conn.write(
      "/ip/firewall/address-list/print",
      ["?list=" + ADDRESS_LIST, "?address=" + ip]
    );

    if (existing.length > 0) {
      await conn.write("/ip/firewall/address-list/set", [
        "=.id=" + existing[0][".id"],
        "=disabled=yes"
      ]);
      console.log(`✅ Disabled IP: ${ip}`);
    }

    await conn.close();
    res.json({ success: true });
  } catch (err) {
    console.log("❌ DISABLE ERROR:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post("/remove-ip", async (req, res) => {
  try {
    const { ip } = req.body;
    
    console.log(`🔴 Disabling internet for IP: ${ip} (via /remove-ip)`);
    
    const conn = await connectRouter();
    
    const existing = await conn.write(
      "/ip/firewall/address-list/print",
      ["?list=" + ADDRESS_LIST, "?address=" + ip]
    );

    if (existing.length > 0) {
      await conn.write("/ip/firewall/address-list/set", [
        "=.id=" + existing[0][".id"],
        "=disabled=yes"
      ]);
      console.log(`✅ Disabled IP: ${ip}`);
    }

    await conn.close();
    res.json({ success: true });
  } catch (err) {
    console.log("❌ DISABLE ERROR:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post("/allow-ip", async (req, res) => {
  try {
    const { ip, comment } = req.body;
    
    console.log(`🟢 Adding new IP to address list: ${ip}`);
    const conn = await connectRouter();
    
    await conn.write("/ip/firewall/address-list/add", [
      "=list=" + ADDRESS_LIST,
      "=address=" + ip,
      "=comment=" + (comment || "Added from API")
    ]);
    
    await conn.close();
    res.json({ success: true });
  } catch (err) {
    console.log("❌ ALLOW IP ERROR:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================================
// IPOE / DHCP DYNAMIC LEASES ENDPOINTS
// ============================================================================

app.get("/leases/dynamic", async (req, res) => {
  try {
    const conn = await connectRouter();
    const leases = await conn.write("/ip/dhcp-server/lease/print");
    await conn.close();

    const dynamicLeases = leases.filter(l => l.dynamic === "true");

    const formatted = dynamicLeases.map(l => ({
      ".id": l[".id"],
      address: l.address,
      "mac-address": l["mac-address"],
      server: l.server,
      comment: l.comment || "",
      dynamic: true,
      status: l.status,
      "host-name": l["host-name"]
    }));

    console.log(`📡 LEASES - Total: ${leases.length}, Dynamic: ${dynamicLeases.length}`);
    
    res.json(formatted);
  } catch (err) {
    console.log("LEASE ERROR:", err.message);
    res.status(500).json({ error: err.message });
  }
});








// POST /api/extend-grace - Manual grace period extension
app.post('/api/extend-grace', (req, res) => {
  const { clientId, extraDays, reason, grantedBy } = req.body;
  
  console.log("=".repeat(50));
  console.log("⏰ MANUAL GRACE EXTENSION");
  console.log("Client ID:", clientId);
  console.log("Extra Days:", extraDays);
  console.log("Reason:", reason);
  console.log("=".repeat(50));
  
  if (!clientId || !extraDays || extraDays <= 0) {
    return res.status(400).json({ error: "Client ID and valid days required" });
  }
  
  try {
    const client = db.prepare('SELECT * FROM clients WHERE id = ? OR ip = ?').get(clientId, clientId);
    if (!client) return res.status(404).json({ error: "Client not found" });
    
    // Calculate new grace date
    let currentGrace = client.graceUntil ? new Date(client.graceUntil) : new Date();
    currentGrace.setDate(currentGrace.getDate() + extraDays);
    
    const newGraceUntil = currentGrace.toISOString().split('T')[0];
    const newGraceCount = (client.graceCount || 0) + 1;
    
    db.prepare(
      `UPDATE clients SET 
        graceUntil = ?,
        graceReason = ?,
        graceCount = ?,
        status = ?
       WHERE id = ?`
    ).run(
        newGraceUntil,
        reason || `Manual extension of ${extraDays} days`,
        newGraceCount,
        'active',
        client.id
    );
        
    // Save to grace history
    db.prepare(`INSERT INTO grace_history (id, clientId, clientIp, clientName, graceUntil, graceReason, grantedBy, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(`GRACE-${Date.now()}`, client.id, client.ip, client.name, newGraceUntil, reason || `Manual extension of ${extraDays} days`, grantedBy || 'Admin', new Date().toISOString());
        
    // Update router comment to reflect new grace period
    const planStr = client.plan || '';
    const routerComment = `${client.name} ${planStr} due ${client.dueDate}${newGraceUntil ? ` (grace: ${newGraceUntil})` : ''}`.replace(/\s+/g, ' ').trim();
    (async () => {
      await updateRouterAddressComment(client.ip, routerComment);
      res.json({
        success: true,
        clientName: client.name,
        newGraceUntil: newGraceUntil,
        graceCount: newGraceCount,
        message: `Grace period extended by ${extraDays} days`
      });
    })();
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});




// POST /api/edit-grace-date - Edit grace period date
app.post('/api/edit-grace-date', (req, res) => {
  const { clientId, graceUntil, reason, grantedBy } = req.body;
  
  // Remove time component - keep only date (YYYY-MM-DD format)
  const graceDateOnly = graceUntil ? graceUntil.split('T')[0] : null;
  
  console.log("=".repeat(50));
  console.log("📅 GRACE PERIOD DATE EDIT");
  console.log("Client ID:", clientId);
  console.log("New Grace Until:", graceDateOnly);
  console.log("Reason:", reason);
  console.log("Granted By:", grantedBy);
  console.log("=".repeat(50));
  
  if (!clientId || !graceDateOnly) {
    return res.status(400).json({ error: "Client ID and grace date required" });
  }
  
  try {
    const client = db.prepare('SELECT * FROM clients WHERE id = ? OR ip = ?').get(clientId, clientId);
    if (!client) {
      console.error("❌ Client not found:", clientId);
      return res.status(404).json({ error: "Client not found" });
    }
    
    // Update clients table with new grace date
    db.prepare('UPDATE clients SET graceUntil = ?, graceReason = ?, graceCount = graceCount + 1 WHERE id = ?')
      .run(graceDateOnly, reason || `Manual grace date edit to ${graceDateOnly}`, client.id);
        
    // Log to grace_history
    const graceDateId = `grace_${Date.now()}`;
    const now = new Date().toISOString();
    
    db.prepare(`INSERT INTO grace_history (id, clientId, clientIp, clientName, graceUntil, graceReason, grantedBy, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(graceDateId, client.id, client.ip, client.name, graceDateOnly, reason || `Manual grace date edit to ${graceDateOnly}`, grantedBy || 'Admin', now);
        
    // Update router comment to reflect new grace period
    const planStr = client.plan || '';
    const routerComment = `${client.name} ${planStr} due ${client.dueDate}${graceDateOnly ? ` (grace: ${graceDateOnly})` : ''}`.replace(/\s+/g, ' ').trim();
    (async () => {
      await updateRouterAddressComment(client.ip, routerComment);
      console.log(`✅ Grace date updated for ${client.name}: ${graceDateOnly}`);
      res.json({
        success: true,
        clientName: client.name,
        newGraceUntil: graceDateOnly,
        graceCount: (client.graceCount || 0) + 1
      });
    })();
  } catch (err) {
    console.error("❌ Database error:", err);
    return res.status(500).json({ error: "Database error" });
  }
});






// ============================================================================
// AUTO-DISABLE API ENDPOINTS
// ============================================================================

app.post('/toggle-auto-disable', async (req, res) => {
  try {
    const { enabled } = req.body;
    
    const config = { enabled, lastUpdated: new Date().toISOString() };
    await fs.writeFile('./auto-disable-config.json', JSON.stringify(config));
    
    setupAutoDisableScheduler(
      autoDisableState.interval, 
      autoDisableState.time, 
      enabled
    );
    
    if (enabled) {
      console.log("🚀 Running immediate auto-disable on enable");
      checkAndDisableExpired();
    }
    
    res.json({ success: true, enabled });
  } catch (error) {
    console.error("❌ Toggle error:", error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/setup-scheduler', async (req, res) => {
  try {
    const { interval, time, enabled } = req.body;
    
    console.log("📝 Setting up scheduler with:", { interval, time, enabled });
    
    autoDisableState.interval = interval;
    autoDisableState.time = time;
    
    const config = { 
      enabled, 
      interval, 
      time, 
      lastUpdated: new Date().toISOString() 
    };
    await fs.writeFile('./auto-disable-config.json', JSON.stringify(config));
    
    setupAutoDisableScheduler(interval, time, enabled);
    
    res.json({ 
      success: true, 
      enabled,
      interval,
      time,
      nextRun: autoDisableState.nextRun 
    });
  } catch (error) {
    console.error("❌ Setup scheduler error:", error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/run-disable-script', async (req, res) => {
  try {
    console.log("🚀 Manual auto-disable run requested");
    const result = await checkAndDisableExpired();
    autoDisableState.lastRun = new Date().toISOString();
    res.json(result);
  } catch (error) {
    console.error("❌ Manual run error:", error);
    res.status(500).json({ error: error.message });
  }
});

app.get("/script-status", (req, res) => {
  res.json({
    enabled: autoDisableState.enabled,
    interval: autoDisableState.interval,
    time: autoDisableState.time,
    lastRun: autoDisableState.lastRun,
    nextRun: autoDisableState.nextRun
  });
});

app.get("/due-entries", async (req, res) => {
  try {
    const conn = await connectRouter();
    const list = await conn.write(
      "/ip/firewall/address-list/print",
      ["?list=" + ADDRESS_LIST]
    );
    await conn.close();
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const dueEntries = list.filter(entry => 
      entry.comment && entry.comment.toLowerCase().includes('due')
    ).map(entry => {
      const dueInfo = parseDueDate(entry.comment);
      let expired = false;
      
      if (dueInfo) {
        const dueDate = new Date(`${dueInfo.year}-${dueInfo.month}-${dueInfo.day}`);
        dueDate.setHours(0, 0, 0, 0);
        expired = dueDate < today;
      }
      
      const graceMatch = entry.comment?.match(/\(grace:\s*([^)]+)\)/i);
      let inGrace = false;
      let graceUntil = null;
      
      if (graceMatch) {
        graceUntil = graceMatch[1];
        const graceDate = new Date(graceUntil);
        graceDate.setHours(0, 0, 0, 0);
        inGrace = graceDate >= today;
      }
      
      return {
        address: entry.address,
        comment: entry.comment,
        disabled: entry.disabled === "true",
        dueDate: dueInfo ? dueInfo.dateStr : null,
        expired: expired && !inGrace,
        inGracePeriod: inGrace,
        graceUntil: graceUntil
      };
    });
    
    res.json(dueEntries);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/auto-disable-logs", async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    
    let logs = [];
    try {
      const data = await fs.readFile(LOG_FILE, 'utf8');
      logs = data.split('\n')
        .filter(line => line.trim())
        .slice(-limit)
        .map(line => {
          const match = line.match(/\[(.*?)\] \[(.*?)\] (.*)/);
          if (match) {
            return {
              id: `log-${Date.now()}-${Math.random()}`,
              timestamp: match[1],
              type: match[2].toLowerCase(),
              message: match[3]
            };
          }
          return { 
            id: `log-${Date.now()}-${Math.random()}`,
            timestamp: new Date().toISOString(),
            type: 'info',
            message: line 
          };
        });
    } catch (error) {}
    
    res.json(logs);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/clear-auto-disable-logs", async (req, res) => {
  try {
    await fs.writeFile(LOG_FILE, `[${new Date().toISOString()}] [INFO] Logs cleared\n`);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// PPPOE ENDPOINTS
// ============================================================================

app.get("/ppp/secret", async (req, res) => {
  try {
    const conn = await connectRouter();
    const secrets = await conn.write("/ppp/secret/print");
    await conn.close();

    const formatted = secrets.map(s => ({
      ".id": s[".id"],
      name: s.name,
      password: s.password || "",
      service: s.service || "pppoe",
      profile: s.profile,
      disabled: s.disabled === "true",
      comment: s.comment || "",
      lastLoggedOut: s["last-logged-out"]
    }));

    res.json(formatted);
  } catch (err) {
    console.log("PPP SECRET ERROR:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get("/ppp/active", async (req, res) => {
  try {
    const conn = await connectRouter();
    const active = await conn.write("/ppp/active/print");
    await conn.close();

    const formatted = active.map(a => ({
      ".id": a[".id"],
      name: a.name,
      address: a.address,
      service: a.service,
      uptime: a.uptime,
      encoding: a["encoding"] || "N/A"
    }));

    res.json(formatted);
  } catch (err) {
    console.log("PPP ACTIVE ERROR:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get("/ppp/profile", async (req, res) => {
  try {
    const conn = await connectRouter();
    const profiles = await conn.write("/ppp/profile/print");
    await conn.close();

    const formatted = profiles.map(p => ({
      ".id": p[".id"],
      name: p.name,
      localAddress: p["local-address"] || "",
      remoteAddress: p["remote-address"] || "",
      rateLimit: p["rate-limit"] || "",
      comment: p.comment || ""
    }));

    res.json(formatted);
  } catch (err) {
    console.log("PPP PROFILE ERROR:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post("/ppp/secret/add", async (req, res) => {
  try {
    const { name, password, profile, comment } = req.body;
    const conn = await connectRouter();
    await conn.write("/ppp/secret/add", [
      `=name=${name}`,
      `=password=${password || ''}`,
      `=profile=${profile || 'default'}`,
      `=service=pppoe`,
      `=comment=${comment || ''}`
    ]);
    await conn.close();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put("/ppp/secret/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { name, password, profile, comment, disabled } = req.body;
    const conn = await connectRouter();
    await conn.write("/ppp/secret/set", [
      `=.id=${id}`,
      `=name=${name}`,
      `=password=${password || ''}`,
      `=profile=${profile || 'default'}`,
      `=comment=${comment || ''}`,
      `=disabled=${disabled ? 'yes' : 'no'}`
    ]);
    await conn.close();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch("/ppp/secret/:id/toggle", async (req, res) => {
  try {
    const { id } = req.params;
    const { disabled } = req.body;
    const conn = await connectRouter();
    if (disabled) {
      await conn.write("/ppp/secret/disable", [`=.id=${id}`]);
    } else {
      await conn.write("/ppp/secret/enable", [`=.id=${id}`]);
    }
    await conn.close();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/ppp/secret/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const conn = await connectRouter();
    await conn.write("/ppp/secret/remove", [`=.id=${id}`]);
    await conn.close();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/ppp/active/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const conn = await connectRouter();
    await conn.write("/ppp/active/remove", [`=.id=${id}`]);
    await conn.close();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================================
// DATABASE API ENDPOINTS - UPDATED WITH AUTO DUE DATE & GRACE PERIOD
// ============================================================================

/* GET /api/clients - Get all clients */
app.get('/api/clients', (req, res) => {
  try {
    const rows = db.prepare('SELECT * FROM clients ORDER BY registeredAt DESC').all();
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* POST /api/clients - Create new client with AUTO 30-DAY DUE DATE + 7-DAY GRACE */
app.post('/api/clients', (req, res) => {
  const client = req.body;
  
  console.log("=".repeat(60));
  console.log("📥 RECEIVED CLIENT DATA:", {
    id: client.id,
    name: client.name,
    plan: client.plan,
    ip: client.ip,
    installDate: client.installDate
  });
  console.log("=".repeat(60));
  
  // ===== AUTO-CALCULATE FIXED DUE DATE (30 DAYS FROM INSTALL) =====
  let dueDate = client.dueDate; // Default kung may pinasa
  
  if (client.installDate) {
    const installDate = new Date(client.installDate);
    
    // Due date = installDate + 30 days
    const dueDateObj = new Date(installDate);
    dueDateObj.setDate(installDate.getDate() + 30);
    
    // Format to MM-DD-YY (para sa router comment)
    const month = (dueDateObj.getMonth() + 1).toString().padStart(2, '0');
    const day = dueDateObj.getDate().toString().padStart(2, '0');
    const year = dueDateObj.getFullYear().toString().slice(-2);
    dueDate = `${month}-${day}-${year}`;
    
    console.log(`📅 Auto-calculated due date: ${dueDate} (30 days from install)`);
  }
  
  // ===== AUTO GRACE PERIOD (7 DAYS AFTER DUE DATE) =====
  let graceUntil = null;
  let routerComment = client.comment || `${client.name} due ${dueDate}`;
  
  if (dueDate) {
    const [month, day, year] = dueDate.split('-').map(Number);
    const dueDateObj = new Date(2000 + year, month - 1, day);
    
    const graceDateObj = new Date(dueDateObj);
    graceDateObj.setDate(dueDateObj.getDate() + 7);
    
    // Format to YYYY-MM-DD (para sa database)
    const graceYear = graceDateObj.getFullYear();
    const graceMonth = (graceDateObj.getMonth() + 1).toString().padStart(2, '0');
    const graceDay = graceDateObj.getDate().toString().padStart(2, '0');
    graceUntil = `${graceYear}-${graceMonth}-${graceDay}`;
    
    // Add grace to router comment
    routerComment = `${client.name} due ${dueDate} (grace: ${graceUntil})`;
    
    console.log(`⏰ Auto grace period until: ${graceUntil} (7 days after due)`);
  }
  
  try {
    const existing = db.prepare('SELECT * FROM clients WHERE ip = ?').get(client.ip);

    if (existing) {
      console.log(`🔄 IP ${client.ip} already exists, updating client ${existing.id}...`);
      
      db.prepare(
        `UPDATE clients SET 
          name = ?, 
          plan = ?, 
          address = ?, 
          landmark = ?, 
          cpNumber = ?, 
          email = ?, 
          birthdate = ?, 
          installDate = ?, 
          dueDate = ?, 
          graceUntil = ?,
          graceReason = ?,
          status = ?
         WHERE ip = ?`,
      ).run(
        client.name,
        client.plan,
        client.address || '',
        client.landmark || '',
        client.cpNumber || '',
        client.email || '',
        client.birthdate || '',
        client.installDate,
        dueDate,
        graceUntil,
        'New client registration - automatic 7-day grace',
        client.status || 'active',
        client.ip
      );

      console.log(`✅ Existing client updated for IP: ${client.ip}`);
      
      // Update router address list comment
      (async () => {
        await updateRouterAddressComment(client.ip, routerComment);
        res.json({ 
          success: true, 
          id: existing.id,
          dueDate: dueDate,
          graceUntil: graceUntil,
          message: 'Client updated with auto due date and 7-day grace period'
        });
      })();
    } else {
      db.prepare(
        `INSERT INTO clients (
          id, accountNumber, ip, name, plan, address, landmark, 
          cpNumber, email, birthdate, installDate, dueDate, registeredAt, status,
          graceUntil, graceReason, graceCount
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        client.id, 
        client.accountNumber || '', 
        client.ip, 
        client.name, 
        client.plan, 
        client.address || '', 
        client.landmark || '', 
        client.cpNumber || '', 
        client.email || '', 
        client.birthdate || '', 
        client.installDate, 
        dueDate,
        client.registeredAt, 
        client.status || 'active',
        graceUntil,
        'New client - automatic 7-day grace',
        0
      );

      console.log(`✅ New client saved: ${client.name} with Account#: ${client.accountNumber}`);
      console.log(`📅 Due date: ${dueDate} (30 days from install)`);
      console.log(`⏰ Grace until: ${graceUntil} (7 days after due)`);
      
      // Update router address list comment
      (async () => {
        await updateRouterAddressComment(client.ip, routerComment);
        res.json({ 
          success: true, 
          id: client.id, 
          dueDate: dueDate,
          graceUntil: graceUntil,
          message: 'New client created with automatic 30-day due and 7-day grace period'
        });
      })();
    }
  } catch (err) {
    console.error("❌ Database error:", err);
    return res.status(500).json({ error: err.message });
  }
});

// Helper function to update router address list comment
async function updateRouterAddressComment(ip, comment) {
  try {
    const conn = await connectRouter(2);
    
    const existing = await conn.write(
      "/ip/firewall/address-list/print",
      ["?list=" + ADDRESS_LIST, "?address=" + ip]
    );
    
    if (existing.length > 0) {
      await conn.write("/ip/firewall/address-list/set", [
        "=.id=" + existing[0][".id"],
        "=comment=" + comment,
        "=disabled=no"
      ]);
      console.log(`✅ Router address list updated for ${ip}: ${comment}`);
    } else {
      await conn.write("/ip/firewall/address-list/add", [
        "=list=" + ADDRESS_LIST,
        "=address=" + ip,
        "=comment=" + comment
      ]);
      console.log(`✅ Router address list created for ${ip}: ${comment}`);
    }
    
    await conn.close();
  } catch (error) {
    console.log(`⚠️ Failed to update router for ${ip}: ${error.message}`);
  }
}

// PUT /api/clients/:id - Update client by ID (WITH AUTO GRACE)
app.put('/api/clients/:id', (req, res) => {
  const { id } = req.params;
  const client = req.body;
  
  console.log("=".repeat(50));
  console.log("📝 PUT /api/clients/:id CALLED");
  console.log("ID:", id);
  console.log("Client Data:", client);
  console.log("=".repeat(50));
  
  if (!id) {
    return res.status(400).json({ error: "Client ID is required" });
  }
  
  // Check muna kung existing ang client
  try {
    const existing = db.prepare('SELECT * FROM clients WHERE id = ?').get(id);

    if (!existing) {
      console.log("⚠️ Client not found with ID:", id);
      return res.status(404).json({ error: "Client not found" });
    }
    
    // ===== AUTO GRACE PERIOD CALCULATION =====
    // If graceUntil is explicitly provided, use it. Otherwise, auto-calculate.
    let graceUntil = client.graceUntil || null;
    let graceReason = client.graceReason || null;
    let graceCount = client.graceCount || 0;
    
    // Check if due date was changed
    const dueDateChanged = existing.dueDate !== client.dueDate;
    
    // Only auto-calculate grace if it wasn't explicitly provided and due date is present
    if (!client.graceUntil && client.dueDate) {
      const [dueMonth, dueDay, dueYear] = client.dueDate.split('-').map(Number);
      const dueDateObj = new Date(2000 + dueYear, dueMonth - 1, dueDay);
      
      // Auto add 7-day grace period when due date is set or changed
      const graceDateObj = new Date(dueDateObj);
      graceDateObj.setDate(dueDateObj.getDate() + 7);
      
      const graceYear = graceDateObj.getFullYear();
      const graceMonth = (graceDateObj.getMonth() + 1).toString().padStart(2, '0');
      const graceDay = graceDateObj.getDate().toString().padStart(2, '0');
      graceUntil = `${graceYear}-${graceMonth}-${graceDay}`;
      
      if (dueDateChanged) {
        graceReason = `Due date changed from ${existing.dueDate} to ${client.dueDate} - auto 7-day grace added`;
        console.log(`📅 Due date changed! New grace until: ${graceUntil}`);
      }
    }
    
    // Calculate status based on due date and grace period
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    let status = client.status || 'active';
    if (client.dueDate) {
      const [dueMonth, dueDay, dueYear] = client.dueDate.split('-').map(Number);
      const dueDateObj = new Date(2000 + dueYear, dueMonth - 1, dueDay);
      dueDateObj.setHours(0, 0, 0, 0);
      
      // Check if in grace period
      let inGrace = false;
      if (graceUntil) {
        const graceDate = new Date(graceUntil);
        graceDate.setHours(0, 0, 0, 0);
        inGrace = graceDate >= today;
      }
      
      if (dueDateObj < today && !inGrace) {
        status = 'expired';
      }
    }
    
    // Proceed with update
    const info = db.prepare(
      `UPDATE clients SET 
        name = ?, 
        plan = ?, 
        address = ?, 
        landmark = ?, 
        cpNumber = ?, 
        email = ?, 
        birthdate = ?, 
        installDate = ?, 
        dueDate = ?, 
        status = ?,
        lastPaymentDate = ?,
        lastPaymentAmount = ?,
        graceUntil = ?,
        graceReason = ?,
        graceCount = ?
       WHERE id = ?`
    ).run(
      client.name,
      client.plan,
      client.address || '',
      client.landmark || '',
      client.cpNumber || '',
      client.email || '',
      client.birthdate || '',
      client.installDate,
      client.dueDate,
      status,
      client.lastPaymentDate || null,
      client.lastPaymentAmount || null,
      graceUntil,
      graceReason || `Auto grace until ${graceUntil}`,
      graceCount,
      id
    );

    console.log(`✅ Client ${id} updated successfully. Rows affected: ${info.changes}`);
    console.log(`📅 Grace until: ${graceUntil}`);
    
    // Log to grace_history if grace changed
    if (graceUntil && graceUntil !== existing.graceUntil) {
      const graceDateId = `grace_${Date.now()}`;
      db.prepare(
        `INSERT INTO grace_history (id, clientId, clientIp, clientName, graceUntil, graceReason, grantedBy, createdAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        graceDateId,
        id,
        client.ip || existing.ip,
        client.name || existing.name,
        graceUntil,
        graceReason || 'Manual edit',
        'Admin',
        new Date().toISOString()
      );
    }

    (async () => {
      // Update router comment kung may ip at dueDate
      if (client.ip && client.dueDate) {
        const planStr = client.plan || existing.plan || '';
        const routerComment = `${client.name} ${planStr} due ${client.dueDate}${graceUntil ? ` (grace: ${graceUntil})` : ''}`.replace(/\s+/g, ' ').trim();
        await updateRouterAddressComment(client.ip, routerComment);
      }
      res.json({ 
        success: true, 
        message: "Client updated successfully",
        graceUntil: graceUntil,
        changes: info.changes
      });
    })();
  } catch (err) {
    console.error("❌ PUT Error:", err.message);
    return res.status(500).json({ error: err.message });
  }
});


// GET /api/grace-history/:clientId - Get grace history for a client
app.get('/api/grace-history/:clientId', (req, res) => {
  const { clientId } = req.params;
  
  try {
    const rows = db.prepare(`SELECT * FROM grace_history WHERE clientId = ? OR clientIp = ? ORDER BY createdAt DESC`).all(clientId, clientId);
    res.json(rows || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================================================
// DELETE PAYMENT
// ==========================================================================
app.delete('/api/payments/:id', (req, res) => {
  const { id } = req.params;
  
  console.log(`🗑️ Deleting payment: ${id}`);
  
  try {
    const payment = db.prepare('SELECT * FROM payments WHERE id = ?').get(id);
    if (!payment) {
      return res.status(404).json({ error: 'Payment not found' });
    }
    
    console.log(`💰 Payment found: ${payment.clientName} - ₱${payment.amount}`);
    
    db.prepare('DELETE FROM payments WHERE id = ?').run(id);
    console.log(`✅ Payment deleted: ${id}`);
    
    // Optional: Update client's last payment info
    if (payment.clientId) {
      const lastPayment = db.prepare('SELECT * FROM payments WHERE clientId = ? OR clientIp = ? ORDER BY paymentDate DESC LIMIT 1').get(payment.clientId, payment.clientIp);
      if (lastPayment) {
        db.prepare(`UPDATE clients SET lastPaymentDate = ?, lastPaymentAmount = ? WHERE id = ?`).run(lastPayment.paymentDate, lastPayment.amount, payment.clientId);
      }
    }
    
    res.json({ success: true, message: 'Payment deleted successfully', payment: payment });
  } catch (err) {
    console.error("❌ Error finding/deleting payment:", err);
    return res.status(500).json({ error: err.message });
  }
});



















// In server35.txt - Make sure this endpoint is correct
app.put('/api/payments/:id', (req, res) => {
  const { id } = req.params;
  const payment = req.body;
  
  console.log(`✏️ Updating payment: ${id}`);
  console.log(`   New paymentDate: ${payment.paymentDate}`);
  console.log(`   New amount: ${payment.amount}`);
  
  try {
    const info = db.prepare(
      `UPDATE payments SET amount = ?, paymentDate = ?, paymentMethod = ?, reference = ?, notes = ? WHERE id = ?`
    ).run(
      payment.amount, payment.paymentDate, payment.paymentMethod, payment.reference, payment.notes || null, id
    );
      
    if (info.changes === 0) {
      return res.status(404).json({ error: 'Payment not found' });
    }
      
    console.log(`✅ Payment updated: ${id} - ${info.changes} row(s) changed`);
    console.log(`   New paymentDate saved: ${payment.paymentDate}`);
    res.json({ success: true, changes: info.changes });
  } catch (err) {
    console.error("❌ Update error:", err);
    return res.status(500).json({ error: err.message });
  }
});











/* DELETE /api/clients/:id - Delete client */
app.delete('/api/clients/:id', (req, res) => {
  const { id } = req.params;
  
  try {
    const client = db.prepare('SELECT ip FROM clients WHERE id = ?').get(id);
    db.prepare('DELETE FROM clients WHERE id=?').run(id);
    console.log(`🗑️ Client deleted: ${id}`);
    // Optional: Disable in router if needed using client.ip
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});



// ============================================================================
// PAYMENT PROCESSING - FIXED REFERENCE
// ============================================================================

app.post('/api/process-payment', (req, res) => {
  try {
    const { clientId, clientIp, amount, paymentMethod, reference, invoiceId, notes } = req.body;
    
    console.log("=".repeat(60));
    console.log("💰 PROCESSING PAYMENT");
    console.log("Client ID:", clientId);
    console.log("Amount:", amount);
    console.log("Payment Method:", paymentMethod);
    console.log("Reference received:", reference);  // Dapat INV-xxx
    console.log("Invoice ID:", invoiceId);
    console.log("=".repeat(60));
    
    const client = db.prepare('SELECT * FROM clients WHERE id = ? OR ip = ?').get(clientId, clientIp);
    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }
      
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];
      
    let newDueDate = null;
    let monthsPaid = 1;
      
    const paymentBaseDate = new Date(today);
    if (client.dueDate) {
      const [dueMonth, dueDay, dueYear] = client.dueDate.split('-').map(Number);
      const dueDateObj = new Date(2000 + dueYear, dueMonth - 1, dueDay);
      dueDateObj.setHours(0, 0, 0, 0);
      if (dueDateObj > today) paymentBaseDate.setTime(dueDateObj.getTime());
    }

    const newDueDateObj = new Date(paymentBaseDate);
    newDueDateObj.setDate(paymentBaseDate.getDate() + 30);

    const newMonth = (newDueDateObj.getMonth() + 1).toString().padStart(2, '0');
    const newDay = newDueDateObj.getDate().toString().padStart(2, '0');
    const newYear = newDueDateObj.getFullYear().toString().slice(-2);
    newDueDate = `${newMonth}-${newDay}-${newYear}`;
      
    let graceUntil = null;
    if (newDueDate) {
      const [dueMonth, dueDay, dueYear] = newDueDate.split('-').map(Number);
      const dueDateObj = new Date(2000 + dueYear, dueMonth - 1, dueDay);
      const graceDateObj = new Date(dueDateObj);
      graceDateObj.setDate(dueDateObj.getDate() + 7);
      const graceYear = graceDateObj.getFullYear();
      const graceMonth = (graceDateObj.getMonth() + 1).toString().padStart(2, '0');
      const graceDay = graceDateObj.getDate().toString().padStart(2, '0');
      graceUntil = `${graceYear}-${graceMonth}-${graceDay}`;
    }
      
    const invoiceReference = reference || invoiceId;
      
    const paymentId = `PAY-${Date.now()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
    const now = new Date().toISOString();
      
    db.prepare(`INSERT INTO payments (id, clientId, clientName, clientIp, accountNumber, amount, paymentDate, dueDate, paymentMethod, reference, notes, invoiceId, status, recordedBy, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(paymentId, client.id, client.name, client.ip, client.accountNumber, amount, todayStr, client.dueDate, paymentMethod || 'cash', invoiceReference, notes || `Payment for invoice ${invoiceReference}`, invoiceId || null, 'paid', 'system', now);
          
    db.prepare(`UPDATE clients SET dueDate = ?, graceUntil = ?, graceReason = ?, lastPaymentDate = ?, lastPaymentAmount = ?, status = ? WHERE id = ?`).run(newDueDate, graceUntil, `Paid ${monthsPaid} month(s) via ${paymentMethod} (Invoice: ${invoiceReference})`, todayStr, amount, 'active', client.id);
              
    if (invoiceId) {
      try {
        db.prepare(`UPDATE invoices SET status = 'paid', paymentDate = ?, paymentMethod = ?, reference = ? WHERE id = ?`).run(todayStr, paymentMethod, invoiceReference, invoiceId);
      } catch (invErr) {
        console.log("⚠️ Failed to update invoice:", invErr);
      }
    }
              
    res.json({ 
      success: true, 
      paymentId: paymentId,
      invoiceReference: invoiceReference,
      newDueDate: newDueDate,
      graceUntil: graceUntil,
      monthsPaid: monthsPaid,
      message: `✅ Payment recorded. Reference: ${invoiceReference}`
    });
  } catch (error) {
    console.error("❌ Payment error:", error);
    res.status(500).json({ error: error.message });
  }
});
// GET /api/payments - Get payments (with optional clientId filter)
app.get('/api/payments', (req, res) => {
  const { clientId } = req.query;
  
  try {
    if (clientId) {
      res.json(db.prepare('SELECT * FROM payments WHERE clientId = ? ORDER BY paymentDate DESC').all(clientId) || []);
    } else {
      res.json(db.prepare('SELECT * FROM payments ORDER BY paymentDate DESC').all() || []);
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* GET /api/payments/:clientId - Get payments by client */
app.get('/api/payments/:clientId', (req, res) => {
  const { clientId } = req.params;
  
  try {
    res.json(db.prepare(`SELECT * FROM payments WHERE clientId = ? OR clientIp = ? ORDER BY paymentDate DESC`).all(clientId, clientId) || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================================
// PLANS ENDPOINTS
// ============================================================================

app.get('/api/plans', (req, res) => {
  try {
    const rows = db.prepare('SELECT * FROM plans ORDER BY price ASC').all();
    const plans = rows.map(r => ({
      ...r,
      isActive: r.isActive === 1
    }));
    res.json(plans || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/plans', (req, res) => {
  const plan = req.body;
  try {
    const existing = db.prepare('SELECT id FROM plans WHERE id = ?').get(plan.id);
    if (existing) {
      db.prepare(`UPDATE plans SET name=?, price=?, speed=?, burstLimit=?, description=?, isActive=? WHERE id=?`).run(
        plan.name, plan.price, plan.speed, plan.burstLimit || null, plan.description || '', plan.isActive ? 1 : 0, plan.id
      );
    } else {
      db.prepare(`INSERT INTO plans (id, name, price, speed, burstLimit, description, isActive) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
        plan.id || Date.now().toString(), plan.name, plan.price, plan.speed, plan.burstLimit || null, plan.description || '', plan.isActive ? 1 : 0
      );
    }
    res.json({ success: true, id: plan.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================================
// INVOICE ENDPOINTS
// ============================================================================

app.get('/api/invoices', (req, res) => {
  try {
    const rows = db.prepare('SELECT * FROM invoices ORDER BY dueDate DESC').all();
    res.json(rows || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/invoices', (req, res) => {
  const invoice = req.body;
  
  try {
    const existing = db.prepare('SELECT id FROM invoices WHERE id = ?').get(invoice.id);
    if (existing) {
      return res.status(409).json({ error: "Invoice already exists", existingId: invoice.id });
    }
    
    db.prepare(`INSERT INTO invoices (id, clientId, clientName, clientIp, clientAccountNumber, planName, amount, dueDate, issueDate, status, paymentDate, paymentMethod, reference, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      invoice.id, invoice.clientId || '', invoice.clientName, invoice.clientIp || '', invoice.clientAccountNumber || '', invoice.planName, invoice.amount, invoice.dueDate, invoice.issueDate, invoice.status || 'pending', invoice.paymentDate || null, invoice.paymentMethod || null, invoice.reference || null, invoice.notes || null
    );
    res.json({ success: true, id: invoice.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/invoices/:id', (req, res) => {
  const { id } = req.params;
  console.log(`🗑️ Deleting invoice: ${id}`);
  
  try {
    const info = db.prepare('DELETE FROM invoices WHERE id = ?').run(id);
    res.json({ success: true, changes: info.changes });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/invoices/search', (req, res) => {
  const { q } = req.query;
  
  if (!q) {
    return res.json([]);
  }
  
  try {
    const searchTerm = `%${q}%`;
    const rows = db.prepare(`SELECT * FROM invoices WHERE clientName LIKE ? OR clientIp LIKE ? OR id LIKE ? ORDER BY issueDate DESC`).all(searchTerm, searchTerm, searchTerm);
    res.json(rows || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/invoices/client/:clientId', (req, res) => {
  const { clientId } = req.params;
  
  try {
    const rows = db.prepare(`SELECT * FROM invoices WHERE clientId = ? OR clientIp = ? ORDER BY issueDate DESC`).all(clientId, clientId);
    res.json(rows || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================================
// BILLING HISTORY ENDPOINTS
// ============================================================================

app.get('/api/billing-history/:clientId', (req, res) => {
  const { clientId } = req.params;
  
  try {
    const rows = db.prepare(`SELECT * FROM billing_history WHERE clientId = ? OR clientIp = ? ORDER BY createdAt DESC`).all(clientId, clientId);
    res.json(rows || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================================
// GRACE HISTORY ENDPOINTS
// ============================================================================

app.post('/api/grace-history', (req, res) => {
  const grace = req.body;
  
  const id = `GRACE-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
  const now = new Date().toISOString();
  
  try {
    db.prepare(`INSERT INTO grace_history (id, clientId, clientIp, clientName, graceUntil, graceReason, grantedBy, createdAt, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      id, grace.clientId, grace.clientIp, grace.clientName, grace.graceUntil, grace.graceReason, grace.grantedBy || 'system', now, grace.notes || ''
    );
    res.json({ success: true, id: id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/grace-history/:clientId', (req, res) => {
  const { clientId } = req.params;
  
  try {
    const rows = db.prepare(`SELECT * FROM grace_history WHERE clientId = ? OR clientIp = ? ORDER BY createdAt DESC`).all(clientId, clientId);
    res.json(rows || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================================
// INVOICE ENDPOINTS
// ============================================================================

const INVOICES_DIR = path.join(__dirname, 'invoices');
if (!fsSync.existsSync(INVOICES_DIR)) {
  fsSync.mkdirSync(INVOICES_DIR, { recursive: true });
  console.log('✅ Invoices directory created');
}

// GET invoice by ID
app.get('/api/invoices/:id', (req, res) => {
  const { id } = req.params;
  try {
    const row = db.prepare('SELECT * FROM invoices WHERE id = ?').get(id);
    if (!row) res.status(404).json({ error: 'Invoice not found' });
    else res.json(row);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT update invoice (for marking as paid)
app.put('/api/invoices/:id', (req, res) => {
  const { id } = req.params;
  const invoice = req.body;
  
  try {
    const info = db.prepare(`UPDATE invoices SET status = ?, paymentDate = ?, paymentMethod = ?, reference = ? WHERE id = ?`).run(
      invoice.status || 'pending', invoice.paymentDate || null, invoice.paymentMethod || null, invoice.reference || null, id
    );
    if (info.changes === 0) res.status(404).json({ error: 'Invoice not found' });
    else res.json({ success: true, changes: info.changes });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/generate-invoice - Generate invoice HTML
app.post('/api/generate-invoice', async (req, res) => {
  try {
    const invoice = req.body;
    
    console.log(`📄 Generating invoice for: ${invoice.clientName}`);
    
    const html = generateInvoiceHTML(invoice);
    
    const safeClient = invoice.clientName.replace(/[^a-zA-Z0-9]/g, '_');
    const fileName = `invoice_${safeClient}_${invoice.id}.html`;
    const filePath = path.join(INVOICES_DIR, fileName);
    
    fsSync.writeFileSync(filePath, html);
    console.log(`✅ Invoice saved: ${filePath}`);
    
    res.json({ 
      success: true, 
      url: `http://localhost:${PORT}/invoices/${fileName}`,
      message: 'Invoice generated successfully'
    });
    
  } catch (error) {
    console.error('❌ Invoice generation error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.use('/invoices', express.static(INVOICES_DIR));

// ============================================================================
// INVOICE HTML GENERATOR - NO BILLING PERIOD SECTION
// ============================================================================

function generateInvoiceHTML(invoice) {
  const isPaid = invoice.status === 'paid';
  const accountNumber = invoice.clientAccountNumber || invoice.clientId || 'N/A';
  const contactNumber = invoice.clientCpNumber || invoice.cpNumber || 'N/A';
  
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>INVOICE ${invoice.id}</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    
    body {
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      background: linear-gradient(135deg, #f5f7fa 0%, #e9ecef 100%);
      padding: 40px 20px;
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
    }
    
    .invoice {
      max-width: 650px;
      width: 100%;
      background: white;
      border-radius: 24px;
      overflow: hidden;
      box-shadow: 0 20px 40px rgba(0,0,0,0.1);
    }
    
    .header {
      background: linear-gradient(135deg, #1a3b5c 0%, #0f2c48 100%);
      color: white;
      padding: 35px 30px;
      text-align: center;
      position: relative;
    }
    
    .header h1 {
      font-size: 38px;
      font-weight: 700;
      letter-spacing: 3px;
      margin-bottom: 8px;
    }
    
    .invoice-id {
      font-size: 12px;
      opacity: 0.7;
      font-family: monospace;
      margin-bottom: 15px;
      word-break: break-all;
    }
    
    .status-badge {
      display: inline-block;
      background: ${isPaid ? '#10b981' : '#f59e0b'};
      color: white;
      padding: 6px 24px;
      border-radius: 30px;
      font-size: 12px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 1px;
    }
    
    .body {
      padding: 30px;
    }
    
    .client-card {
      background: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%);
      border-radius: 16px;
      padding: 20px;
      margin-bottom: 25px;
      border: 1px solid #e2e8f0;
    }
    
    .section-title {
      color: #1e293b;
      font-size: 16px;
      font-weight: 700;
      margin-bottom: 16px;
      padding-bottom: 8px;
      border-bottom: 2px solid #10b981;
      display: inline-block;
    }
    
    .info-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 16px;
      margin-top: 8px;
    }
    
    .info-item {
      display: flex;
      flex-direction: column;
    }
    
    .info-label {
      color: #64748b;
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 5px;
      font-weight: 600;
    }
    
    .info-value {
      color: #0f172a;
      font-size: 15px;
      font-weight: 600;
    }
    
    .info-value.highlight {
      color: #10b981;
      font-size: 18px;
      font-weight: 700;
    }
    
    .billing-table {
      width: 100%;
      border-collapse: collapse;
      margin: 20px 0;
      background: #f8fafc;
      border-radius: 12px;
      overflow: hidden;
    }
    
    .billing-table th {
      background: #e2e8f0;
      color: #475569;
      font-size: 13px;
      font-weight: 600;
      padding: 12px 16px;
      text-align: left;
    }
    
    .billing-table td {
      padding: 12px 16px;
      border-bottom: 1px solid #e2e8f0;
      color: #334155;
      font-size: 14px;
    }
    
    .billing-table tr:last-child td {
      border-bottom: none;
    }
    
    .amount-highlight {
      color: #10b981;
      font-weight: 700;
      font-size: 15px;
    }
    
    .amount-box {
      background: linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%);
      border: 2px solid #10b981;
      border-radius: 16px;
      padding: 20px;
      margin: 20px 0;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    
    .amount-label {
      color: #065f46;
      font-size: 16px;
      font-weight: 600;
    }
    
    .amount-value {
      color: #059669;
      font-size: 32px;
      font-weight: 800;
    }
    
    .payment-info {
      background: #f8fafc;
      border-radius: 16px;
      padding: 20px;
      margin: 20px 0;
      border-left: 4px solid #10b981;
    }
    
    .payment-title {
      font-weight: 700;
      color: #1e293b;
      margin-bottom: 12px;
      font-size: 14px;
    }
    
    .payment-details {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 16px;
    }
    
    .payment-detail {
      display: flex;
      flex-direction: column;
    }
    
    .payment-detail-label {
      font-size: 10px;
      color: #64748b;
      text-transform: uppercase;
      margin-bottom: 4px;
      font-weight: 600;
    }
    
    .payment-detail-value {
      font-size: 14px;
      color: #0f172a;
      font-weight: 600;
    }
    
    .footer {
      background: #f8fafc;
      padding: 20px 30px;
      text-align: center;
      border-top: 1px solid #e2e8f0;
    }
    
    .footer p {
      color: #64748b;
      font-size: 12px;
    }
    
    .thank-you {
      color: #10b981;
      font-size: 14px;
      font-weight: 600;
      margin-top: 8px;
    }
    
    @media (max-width: 600px) {
      .info-grid,
      .payment-details {
        grid-template-columns: 1fr;
      }
      
      .amount-value {
        font-size: 28px;
      }
      
      .header h1 {
        font-size: 32px;
      }
      
      .body {
        padding: 20px;
      }
    }
    
    @media print {
      body {
        background: white;
        padding: 0;
      }
      
      .invoice {
        box-shadow: none;
      }
      
      .status-badge,
      .amount-box {
        print-color-adjust: exact;
      }
    }
  </style>
</head>
<body>
  <div class="invoice">
    <div class="header">
      <h1>INVOICE</h1>
      <div class="invoice-id">${invoice.id}</div>
      <div class="status-badge">${isPaid ? '✓ PAID' : (invoice.status === 'overdue' ? '⚠ OVERDUE' : '⏰ PENDING')}</div>
    </div>
    
    <div class="body">
      
      <!-- CLIENT INFORMATION -->
      <div class="client-card">
        <div class="section-title">CLIENT INFORMATION</div>
        <div class="info-grid">
          <div class="info-item">
            <span class="info-label">Account Number</span>
            <span class="info-value highlight">${accountNumber}</span>
          </div>
          <div class="info-item">
            <span class="info-label">Client Name</span>
            <span class="info-value">${invoice.clientName}</span>
          </div>
          <div class="info-item">
            <span class="info-label">Contact Number</span>
            <span class="info-value">${contactNumber}</span>
          </div>
          <div class="info-item">
            <span class="info-label">Service Plan</span>
            <span class="info-value">${invoice.planName}</span>
          </div>
        </div>
      </div>
      
      <!-- BILLING DETAILS (NO BILLING PERIOD SECTION) -->
      <div class="section-title" style="margin-top: 5px;">BILLING DETAILS</div>
      <table class="billing-table">
        <thead>
          <tr>
            <th>Description</th>
            <th>Amount</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Monthly Subscription - ${invoice.planName}</td>
            <td class="amount-highlight">₱${invoice.amount.toFixed(2)}</td>
          </tr>
        </tbody>
      </table>
      
      <!-- TOTAL AMOUNT -->
      <div class="amount-box">
        <span class="amount-label">TOTAL AMOUNT DUE</span>
        <span class="amount-value">₱${invoice.amount.toLocaleString()}</span>
      </div>
      
      <!-- PAYMENT INFORMATION -->
      <div class="payment-info">
        <div class="payment-title">💰 PAYMENT INFORMATION</div>
        <div class="payment-details">
          <div class="payment-detail">
            <span class="payment-detail-label">Payment Method</span>
            <span class="payment-detail-value">${invoice.paymentMethod?.toUpperCase() || 'CASH'}</span>
          </div>
          <div class="payment-detail">
            <span class="payment-detail-label">Payment Date</span>
            <span class="payment-detail-value">${invoice.paymentDate || invoice.issueDate}</span>
          </div>
          <div class="payment-detail">
            <span class="payment-detail-label">Reference Number</span>
            <span class="payment-detail-value">${invoice.reference || invoice.id}</span>
          </div>
        </div>
      </div>
      
    </div>
    
    <div class="footer">
      <p>This is a computer-generated invoice. No signature required.</p>
      <div class="thank-you">✨ Thank you for your business! ✨</div>
    </div>
  </div>
</body>
</html>`;
}// ============================================================================
// SERVE STATIC INVOICES
// ============================================================================
app.use('/invoices', express.static(INVOICES_DIR));




















// ============================================================================
// SOA GENERATION ENDPOINT - COMPLETE FIXED VERSION
// ============================================================================

app.get('/api/generate-soa/:clientId', async (req, res) => {
  try {
    const { clientId } = req.params;
    
    console.log("=".repeat(60));
    console.log("📄 GENERATING SOA FOR CLIENT:", clientId);
    console.log("=".repeat(60));
    
    // ===== STEP 1: GET FRESH CLIENT DATA FROM DATABASE =====
    const client = db.prepare('SELECT * FROM clients WHERE id = ? OR ip = ?').get(clientId, clientId);
    
    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }
    
    // ===== STEP 2: GET FRESH PAYMENT DATA FROM DATABASE =====
    let payments = [];
    try {
      payments = db.prepare(`SELECT id, clientId, clientName, clientIp, accountNumber, amount, paymentDate, dueDate, paymentMethod, reference, notes, status, recordedBy, createdAt FROM payments WHERE clientId = ? OR clientIp = ? ORDER BY paymentDate DESC, createdAt DESC`).all(client.id, client.ip) || [];
    } catch (err) {
      console.error("❌ Error fetching payments:", err);
    }
    
    // Get plan amount
    const planMatch = client.plan?.match(/\d+/) || ['0'];
    const monthlyFee = parseInt(planMatch[0]) || 0;
    
    // ========== CALCULATE BILLING CYCLE FROM INSTALL DATE ==========
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    let installDate = null;
    let billingStartDate = null;
    let billingEndDate = null;
    let monthsSinceInstall = 0;
    let totalBilled = 0;
    
    // Parse install date
    if (client.installDate) {
      let installYear, installMonth, installDay;
      
      if (client.installDate.includes('-')) {
        const parts = client.installDate.split('-');
        if (parts[0].length === 4) {
          installYear = parseInt(parts[0]);
          installMonth = parseInt(parts[1]) - 1;
          installDay = parseInt(parts[2]);
        } else {
          installYear = 2000 + parseInt(parts[2]);
          installMonth = parseInt(parts[0]) - 1;
          installDay = parseInt(parts[1]);
        }
      } else {
        installYear = 2024;
        installMonth = 0;
        installDay = 1;
      }
      
      installDate = new Date(installYear, installMonth, installDay);
      installDate.setHours(0, 0, 0, 0);
      
      const monthsDiff = (today.getFullYear() - installDate.getFullYear()) * 12 + 
                         (today.getMonth() - installDate.getMonth());
      monthsSinceInstall = monthsDiff + 1;
      
      billingStartDate = new Date(installDate);
      billingStartDate.setMonth(installDate.getMonth());
      billingStartDate.setDate(installDate.getDate());
      billingEndDate = new Date(today);
      totalBilled = monthsSinceInstall * monthlyFee;
      
      console.log(`📊 Months since install: ${monthsSinceInstall}`);
      console.log(`📊 Total billed: ₱${totalBilled}`);
    } else {
      billingStartDate = new Date(today.getFullYear(), today.getMonth(), 1);
      billingEndDate = new Date(today);
      monthsSinceInstall = 1;
      totalBilled = monthlyFee;
    }
    
    // Format dates for display
    const formatDateDisplay = (date) => {
      if (!date) return 'N/A';
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    };
    
    const billingPeriodStart = billingStartDate ? formatDateDisplay(billingStartDate) : 'N/A';
    const billingPeriodEnd = formatDateDisplay(billingEndDate);
    
    // Get due date display
    let dueDateDisplay = 'N/A';
    if (client.dueDate) {
      const [dueMonth, dueDay, dueYear] = client.dueDate.split('-').map(Number);
      const dueDateObj = new Date(2000 + dueYear, dueMonth - 1, dueDay);
      dueDateDisplay = dueDateObj.toLocaleDateString('en-US', { 
        month: 'long', 
        day: 'numeric', 
        year: 'numeric' 
      });
    }
    
    // ===== CALCULATE TOTALS USING FRESH PAYMENT DATA =====
    const totalPaid = payments.reduce((sum, pay) => sum + (pay.amount || 0), 0);
    const balance = totalBilled - totalPaid;
    const isOverpaid = balance < 0;
    const totalAmountDue = Math.max(0, balance);
    
    // Calculate overdue status
    let daysOverdue = 0;
    let monthsOverdue = 0;
    let isExpired = false;
    let isInGrace = false;
    
    if (client.dueDate) {
      const [dueMonth, dueDay, dueYear] = client.dueDate.split('-').map(Number);
      const dueDateObj = new Date(2000 + dueYear, dueMonth - 1, dueDay);
      dueDateObj.setHours(0, 0, 0, 0);
      
      if (client.graceUntil) {
        const graceDate = new Date(client.graceUntil);
        graceDate.setHours(0, 0, 0, 0);
        isInGrace = graceDate >= today;
      }
      
      isExpired = dueDateObj < today && !isInGrace;
      
      if (dueDateObj < today) {
        daysOverdue = Math.ceil((today - dueDateObj) / (1000 * 60 * 60 * 24));
        monthsOverdue = Math.ceil(daysOverdue / 30);
      }
    }
    
    // ===== FORMAT PAYMENT DATES - PRIORITIZE paymentDate OVER createdAt =====
    const formatPaymentDate = (paymentDate, createdAt) => {
      try {
        // Use paymentDate first
        if (paymentDate) {
          // Check YYYY-MM-DD format
          if (paymentDate.match(/^\d{4}-\d{2}-\d{2}$/)) {
            const date = new Date(paymentDate);
            if (!isNaN(date.getTime())) {
              return date.toLocaleDateString('en-US', { 
                month: 'short', 
                day: 'numeric', 
                year: 'numeric'
              });
            }
          }
          // Check MM-DD-YY format
          if (paymentDate.match(/^\d{2}-\d{2}-\d{2}$/)) {
            const [month, day, year] = paymentDate.split('-');
            const date = new Date(2000 + parseInt(year), parseInt(month) - 1, parseInt(day));
            if (!isNaN(date.getTime())) {
              return date.toLocaleDateString('en-US', { 
                month: 'short', 
                day: 'numeric', 
                year: 'numeric'
              });
            }
          }
          return paymentDate;
        }
        // Fallback to createdAt
        if (createdAt) {
          const date = new Date(createdAt);
          return date.toLocaleDateString('en-US', { 
            month: 'short', 
            day: 'numeric', 
            year: 'numeric'
          });
        }
        return 'N/A';
      } catch (e) {
        return paymentDate || 'N/A';
      }
    };
    
    // Format last payment date
    const lastPayment = payments.length > 0 ? payments[0] : null;
    let lastPaymentFormatted = 'No recent payment';
    if (lastPayment && lastPayment.paymentDate) {
      if (lastPayment.paymentDate.match(/^\d{4}-\d{2}-\d{2}$/)) {
        const date = new Date(lastPayment.paymentDate);
        lastPaymentFormatted = date.toLocaleDateString('en-US', { 
          month: 'long', 
          day: 'numeric', 
          year: 'numeric'
        });
      } else if (lastPayment.paymentDate.match(/^\d{2}-\d{2}-\d{2}$/)) {
        const [month, day, year] = lastPayment.paymentDate.split('-');
        const date = new Date(2000 + parseInt(year), parseInt(month) - 1, parseInt(day));
        lastPaymentFormatted = date.toLocaleDateString('en-US', { 
          month: 'long', 
          day: 'numeric', 
          year: 'numeric'
        });
      } else {
        lastPaymentFormatted = lastPayment.paymentDate;
      }
    }
    
    console.log(`💰 Total billed (${monthsSinceInstall} months): ₱${totalBilled}`);
    console.log(`💰 Total paid (from ${payments.length} payments): ₱${totalPaid}`);
    console.log(`💰 Balance: ₱${balance}`);
    
    // Build billing data
    const billingData = {
      client: {
        id: client.id,
        accountNumber: client.accountNumber || 'N/A',
        name: client.name,
        ip: client.ip,
        plan: client.plan,
        address: client.address || '',
        landmark: client.landmark || '',
        cpNumber: client.cpNumber || '',
        email: client.email || '',
        dueDate: client.dueDate,
        dueDateDisplay: dueDateDisplay,
        graceUntil: client.graceUntil,
        isExpired: isExpired,
        isInGrace: isInGrace,
        daysOverdue: daysOverdue,
        monthsOverdue: monthsOverdue,
        installDate: client.installDate,
        monthsSinceInstall: monthsSinceInstall
      },
      summary: {
        previousBalance: totalBilled - totalPaid,
        paymentsReceived: totalPaid,
        currentCharges: monthlyFee,
        totalAmountDue: totalAmountDue,
        overpayment: isOverpaid ? Math.abs(balance) : 0,
        isOverpaid: isOverpaid,
        grossAmount: totalBilled,
        totalPaid: totalPaid,
        daysOverdue: daysOverdue,
        monthsOverdue: monthsOverdue,
        monthsSinceInstall: monthsSinceInstall
      },
      billingPeriod: {
        start: billingPeriodStart,
        end: billingPeriodEnd,
        installDate: client.installDate,
        monthsSinceInstall: monthsSinceInstall
      },
      monthlyServices: [
        { name: `Internet Plan - ${client.plan}`, amount: monthlyFee, months: monthsSinceInstall, total: totalBilled }
      ],
      otherCharges: [],
      lastPayment: {
        amount: lastPayment ? lastPayment.amount : 0,
        date: lastPaymentFormatted,
        method: lastPayment ? lastPayment.paymentMethod : 'N/A',
        reference: lastPayment ? lastPayment.reference : 'N/A'
      },
      paymentHistory: payments.slice(0, 10).map(p => ({
        date: formatPaymentDate(p.paymentDate, p.createdAt),
        amount: p.amount,
        method: p.paymentMethod,
        reference: p.reference
      }))
    };
    
    // Log payment history that will be displayed
    console.log("📊 Payment History for SOA:");
    billingData.paymentHistory.forEach((p, i) => {
      console.log(`   ${i+1}. ${p.date} - ₱${p.amount} (${p.method}) - ${p.reference}`);
    });
    
    const html = generateSOAHTML(billingData);
    
    console.log("✅ SOA generated successfully");
    console.log("=".repeat(60));
    
    res.json({
      success: true,
      html: html,
      data: billingData
    });
    
  } catch (error) {
    console.error("❌ SOA generation error:", error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// SOA HTML GENERATOR - FIXED TO SHOW CORRECT PAYMENT DATES
// ============================================================================

function generateSOAHTML(data) {
  const client = data.client;
  const summary = data.summary;
  const billingPeriod = data.billingPeriod;
  const monthlyServices = data.monthlyServices || [];
  const otherCharges = data.otherCharges || [];
  const lastPayment = data.lastPayment || { amount: 0, date: 'No recent payment' };
  const paymentHistory = data.paymentHistory || [];

  const soaNumber = `SOA-${Date.now()}-${client.accountNumber}`;
  const currentDate = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  
  const paymentRows = paymentHistory.map(p => `
      <tr>
        <td>${p.date}</td>
        <td>${p.method?.toUpperCase() || 'CASH'}</td>
        <td>${p.reference || '—'}</td>
        <td class="amount green-text">₱${p.amount.toFixed(2)}</td>
      </tr>
  `).join('');
  
  // Show multiple months if applicable
  let serviceRows = '';
  if (monthlyServices[0] && monthlyServices[0].months > 1) {
    serviceRows = `
      <tr>
        <td class="item-name">${monthlyServices[0].name} (${monthlyServices[0].months} months: ${billingPeriod.start} to ${billingPeriod.end})</td>
        <td class="item-amount">₱${monthlyServices[0].total.toFixed(2)}</td>
      </tr>
    `;
  } else {
    serviceRows = `
      <tr>
        <td class="item-name">${monthlyServices[0]?.name || 'Internet Plan'}</td>
        <td class="item-amount">₱${monthlyServices[0]?.amount.toFixed(2) || '0.00'}</td>
      </tr>
    `;
  }
  
  const chargeRows = otherCharges.map(c => `
      <tr>
        <td class="item-name">${c.name}</td>
        <td class="item-amount">₱${c.amount.toFixed(2)}</td>
      </tr>
  `).join('');

  const expiredWarningHtml = client.isExpired ? `
    <div class="expired-warning" style="background: #ffebee; margin: 0 30px 20px; padding: 15px 20px; border-radius: 6px; border: 2px solid #ef4444;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
        <span style="color: #b91c1c; font-size: 16px; font-weight: 600;">⚠️ ACCOUNT EXPIRED</span>
        <span style="color: #b91c1c; font-size: 14px;">Due since: ${client.dueDateDisplay}</span>
      </div>
      <div style="background: #fee2e2; padding: 10px; border-radius: 6px; text-align: center;">
        <span style="color: #b91c1c; font-size: 14px; font-weight: 500;">
          ⛔ INTERNET IS DISABLED • ${summary.daysOverdue} days overdue (${summary.monthsOverdue} month${summary.monthsOverdue > 1 ? 's' : ''})
        </span>
      </div>
    </div>
  ` : '';

  const overpaymentMessage = summary.isOverpaid ? `
    <div class="overpayment-message" style="background: #e8f0fe; margin: 0 30px 20px; padding: 12px 20px; border-radius: 6px; border: 1px solid #3b82f6;">
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <span style="color: #1a3b5c; font-size: 14px; font-weight: 600;">✅ ADVANCE PAYMENT</span>
        <span style="color: #059669; font-size: 14px; font-weight: 600;">Overpaid: ₱${summary.overpayment.toFixed(2)}</span>
      </div>
      <div style="margin-top: 5px; color: #1a3b5c; font-size: 12px;">
        Your account has an advance payment of ₱${summary.overpayment.toFixed(2)}. 
        No payment is due until this credit is used.
      </div>
    </div>
  ` : '';

  const totalDueClass = summary.totalAmountDue > 0 ? 'red-text' : 'green-text';
  const amountDueText = summary.totalAmountDue > 0 ? `₱${summary.totalAmountDue.toFixed(2)}` : 
                        (summary.isOverpaid ? `₱0.00 (Overpaid by ₱${summary.overpayment.toFixed(2)})` : '₱0.00');

  const installInfo = client.installDate ? `
    <div class="detail-item">
      <span class="detail-label">Install Date:</span>
      <span class="detail-value">${client.installDate}</span>
    </div>
    <div class="detail-item">
      <span class="detail-label">Months Billed:</span>
      <span class="detail-value">${client.monthsSinceInstall} month(s)</span>
    </div>
  ` : '';

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>SOA - ${client.name}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { 
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; 
      background: #f5f5f5; 
      padding: 30px 20px; 
      display: flex; 
      justify-content: center; 
      align-items: center; 
    }
    .soa { 
      max-width: 750px; 
      width: 100%; 
      background: white; 
      border-radius: 8px; 
      overflow: hidden; 
      box-shadow: 0 2px 10px rgba(0,0,0,0.1); 
    }
    .header { 
      background: #1a3b5c; 
      color: white; 
      padding: 20px 30px; 
    }
    .header h1 { 
      font-size: 28px; 
      font-weight: 600; 
      margin-bottom: 5px; 
    }
    .header .sub { 
      color: #a0c0e0; 
      font-size: 14px; 
    }
    .header .date { 
      color: #a0c0e0; 
      font-size: 12px; 
      margin-top: 5px; 
    }
    .client-info { 
      padding: 25px 30px; 
      border-bottom: 1px solid #e0e0e0; 
    }
    .client-name { 
      font-size: 24px; 
      font-weight: 700; 
      color: #1a3b5c; 
      margin-bottom: 15px; 
      border-bottom: 2px solid #1a3b5c;
      padding-bottom: 8px;
    }
    .client-details { 
      display: grid; 
      grid-template-columns: repeat(2, 1fr); 
      gap: 12px; 
      color: #333; 
      font-size: 14px; 
    }
    .detail-item { 
      display: flex; 
    }
    .detail-label { 
      width: 120px; 
      color: #666; 
      font-weight: 600;
    }
    .detail-value { 
      font-weight: 500; 
      color: #000;
    }
    .summary-box { 
      background: #f8f9fa; 
      margin: 20px 30px; 
      padding: 20px; 
      border-radius: 6px; 
    }
    .summary-row { 
      display: flex; 
      justify-content: space-between; 
      padding: 8px 0; 
      border-bottom: 1px dashed #ddd; 
    }
    .summary-row:last-child { 
      border-bottom: none; 
      font-weight: bold; 
      font-size: 16px; 
    }
    .amount-due-box { 
      background: ${summary.isOverpaid ? '#e8f0fe' : (summary.totalAmountDue > 0 ? '#fee2e2' : '#e8f0fe')};
      margin: 0 30px 20px; 
      padding: 15px 20px; 
      border-radius: 6px; 
      display: flex; 
      justify-content: space-between; 
      align-items: center; 
    }
    .amount-due-label { 
      color: #1a3b5c; 
      font-size: 16px; 
      font-weight: 600; 
    }
    .amount-due-value { 
      color: ${summary.isOverpaid ? '#059669' : (summary.totalAmountDue > 0 ? '#d32f2f' : '#059669')}; 
      font-size: 24px; 
      font-weight: 700; 
    }
    .section-title { 
      padding: 0 30px; 
      margin: 20px 0 10px; 
      font-size: 18px; 
      font-weight: 600; 
      color: #1a3b5c; 
    }
    .charges-table { 
      margin: 0 30px; 
      border-collapse: collapse; 
      width: calc(100% - 60px); 
    }
    .charges-table td { 
      padding: 10px 0; 
      border-bottom: 1px solid #eee; 
    }
    .charges-table .item-name { 
      color: #333; 
    }
    .charges-table .item-amount { 
      text-align: right; 
      font-weight: 500; 
    }
    .charges-table .total-row td { 
      font-weight: bold; 
      border-bottom: 2px solid #333; 
      padding-top: 15px; 
    }
    .payment-info { 
      background: #f8f9fa; 
      margin: 20px 30px; 
      padding: 15px 20px; 
      border-radius: 6px; 
      font-size: 14px; 
    }
    .payment-info-row { 
      display: flex; 
      justify-content: space-between; 
      padding: 5px 0; 
    }
    .payment-history { 
      margin: 20px 30px; 
    }
    .payment-history table { 
      width: 100%; 
      border-collapse: collapse; 
    }
    .payment-history th { 
      text-align: left; 
      padding: 10px 0; 
      color: #1a3b5c; 
      font-size: 13px; 
      border-bottom: 2px solid #1a3b5c; 
    }
    .payment-history td { 
      padding: 8px 0; 
      border-bottom: 1px solid #eee; 
      font-size: 13px; 
    }
    .payment-history .amount { 
      text-align: right; 
      font-weight: 500; 
      color: #10b981; 
    }
    .footer { 
      background: #f0f0f0; 
      padding: 20px 30px; 
      margin-top: 30px; 
      font-size: 13px; 
      color: #666; 
      display: flex; 
      justify-content: space-between; 
      align-items: center; 
    }
    .footer-left p { 
      margin: 3px 0; 
    }
    .footer-right { 
      text-align: right; 
      color: #1a3b5c; 
      font-weight: 500; 
    }
    .online-payment { 
      color: #1a3b5c; 
      font-weight: 500; 
      text-decoration: none; 
    }
    .due-date-highlight { 
      color: #d32f2f; 
      font-weight: 600; 
    }
    .green-text { 
      color: #10b981; 
      font-weight: 600; 
    }
    .red-text { 
      color: #d32f2f; 
      font-weight: 600; 
    }
  </style>
</head>
<body>
  <div class="soa">
    <div class="header">
      <h1>STATEMENT OF ACCOUNT</h1>
      <div class="sub">${soaNumber}</div>
      <div class="date">Generated on: ${currentDate}</div>
    </div>

    ${expiredWarningHtml}
    ${overpaymentMessage}

    <div class="client-info">
      <div class="client-name">${client.name}</div>
      <div class="client-details">
        <div class="detail-item">
          <span class="detail-label">Account Number:</span>
          <span class="detail-value">${client.accountNumber}</span>
        </div>
        ${installInfo}
        <div class="detail-item">
          <span class="detail-label">Billing Period:</span>
          <span class="detail-value">${billingPeriod.start} - ${billingPeriod.end}</span>
        </div>
        <div class="detail-item">
          <span class="detail-label">Due Date:</span>
          <span class="detail-value due-date-highlight">${client.dueDateDisplay}</span>
        </div>
        <div class="detail-item">
          <span class="detail-label">Service Plan:</span>
          <span class="detail-value">${client.plan}</span>
        </div>
        ${client.graceUntil ? `
        <div class="detail-item">
          <span class="detail-label">Grace Until:</span>
          <span class="detail-value">${client.graceUntil}</span>
        </div>
        ` : ''}
        ${client.address ? `
        <div class="detail-item" style="grid-column: span 2;">
          <span class="detail-label">Service Address:</span>
          <span class="detail-value">${client.address}</span>
        </div>
        ` : ''}
        ${client.landmark ? `
        <div class="detail-item" style="grid-column: span 2;">
          <span class="detail-label">Landmark:</span>
          <span class="detail-value">${client.landmark}</span>
        </div>
        ` : ''}
        ${client.cpNumber ? `
        <div class="detail-item">
          <span class="detail-label">Contact #:</span>
          <span class="detail-value">${client.cpNumber}</span>
        </div>
        ` : ''}
        ${client.email ? `
        <div class="detail-item">
          <span class="detail-label">Email:</span>
          <span class="detail-value">${client.email}</span>
        </div>
        ` : ''}
      </div>
    </div>

    <div class="summary-box">
      <div class="summary-row">
        <span>Total Billed (${client.monthsSinceInstall} months)</span>
        <span class="red-text">₱${summary.grossAmount.toFixed(2)}</span>
      </div>
      <div class="summary-row">
        <span>Payments Received</span>
        <span class="green-text">(₱${summary.paymentsReceived.toFixed(2)})</span>
      </div>
      ${summary.isOverpaid ? `
      <div class="summary-row">
        <span>Overpayment / Advance Credit</span>
        <span class="green-text">(₱${summary.overpayment.toFixed(2)})</span>
      </div>
      ` : ''}
      <div class="summary-row">
        <span>Total Amount Due</span>
        <span class="${totalDueClass}">${amountDueText}</span>
      </div>
    </div>

    <div class="amount-due-box">
      <span class="amount-due-label">AMOUNT DUE BY: ${client.dueDateDisplay}</span>
      <span class="amount-due-value">${amountDueText}</span>
    </div>

    <div style="padding: 0 30px; color: #666; font-size: 13px; margin-bottom: 20px;">
      Please pay on or before the due date to avoid service interruption.
      ${summary.isOverpaid ? '<br><span style="color: #059669;">✅ Your account has advance payment. No payment is currently due.</span>' : ''}
      ${client.isExpired ? '<br><span style="color: #ef4444;">⚠️ Payment required to restore internet.</span>' : ''}
      ${client.isInGrace && !summary.isOverpaid ? '<br><span style="color: #856404;">⏰ You are in grace period until ' + client.graceUntil + '</span>' : ''}
    </div>

    <div class="section-title">Summary of Charges</div>

    <table class="charges-table">
      <tr><td colspan="2" style="font-weight: 600; color: #1a3b5c;">Monthly Services</td></tr>
      ${serviceRows}
      
      ${otherCharges.length > 0 ? `
      <tr><td colspan="2" style="padding-top: 15px; font-weight: 600; color: #1a3b5c;">Other Charges</td></tr>
      ${chargeRows}
      ` : ''}
      
      <tr class="total-row">
        <td style="text-align: right; font-weight: 600;">Total Charges (${client.monthsSinceInstall} months):</td>
        <td class="item-amount" style="font-weight: 700; color: #1a3b5c;">₱${summary.grossAmount.toFixed(2)}</td>
      </tr>
    </table>

    ${paymentHistory.length > 0 ? `
    <div class="payment-history">
      <div class="section-title">Payment History</div>
      <table>
        <thead>
          <tr>
            <th>Date</th>
            <th>Method</th>
            <th>Reference</th>
            <th class="amount">Amount</th>
          </tr>
        </thead>
        <tbody>
          ${paymentRows}
        </tbody>
      </table>
    </div>
    ` : ''}

    <div class="payment-info">
      <div class="payment-info-row">
        <span>Last Payment Received:</span>
        <span class="green-text">₱${lastPayment.amount.toFixed(2)}</span>
      </div>
      <div class="payment-info-row">
        <span>Payment Date:</span>
        <span>${lastPayment.date}</span>
      </div>
    </div>

    <div class="footer">
      <div class="footer-left">
        <p>For customer service, call (02) 1234 5678</p>
        <p>Pay online at <span class="online-payment">www.telco-billpay.com</span></p>
      </div>
      <div class="footer-right">
        <p>Thank you for your business!</p>
      </div>
    </div>
  </div>
</body>
</html>`;
}

























// ============================================================================
// AUTO SIMPLE QUEUE SYSTEM
// ============================================================================

let isFirstScan = true;

async function checkAndUpdateQueues() {
  console.log(`\n[${new Date().toLocaleTimeString()}] 🔍 Scanning DHCP leases...`);
  
  let conn = null;
  try {
    conn = await connectRouter(2);
    
    const leases = await conn.write('/ip/dhcp-server/lease/print', ['?status=bound']);
    const queues = await conn.write('/queue/simple/print');
    
    const queueMap = new Map();
    queues.forEach(q => {
      const target = q.target?.toString() || '';
      const ip = target.replace('/32', '');
      if (ip.match(/^\d+\.\d+\.\d+\.\d+$/)) {
        queueMap.set(ip, {
          id: q['.id'],
          name: q.name
        });
      }
    });
    
    let totalWithPlan = 0;
    let created = 0;
    let deleted = 0;
    let unchanged = 0;
    
    const activeIps = new Set();
    const currentState = new Map();
    
    if (isFirstScan) {
      console.log(`   📋 First scan - initializing memory (${leases.length} leases)`);
      
      for (const lease of leases) {
        const ip = lease.address;
        if (!ip) continue;
        
        activeIps.add(ip);
        
        const comment = lease.comment || '';
        const plan = extractPlanFromComment(comment);
        const clientName = extractNameFromComment(comment);
        
        if (!plan) continue;
        
        totalWithPlan++;
        
        previousComments.set(ip, {
          comment: comment,
          plan: plan,
          name: clientName,
          lastSeen: new Date().toISOString()
        });
      }
      
      isFirstScan = false;
      console.log(`   ✅ Memory initialized with ${previousComments.size} clients`);
      console.log(`   📊 Current queues: ${queueMap.size}`);
      return;
    }
    
    for (const lease of leases) {
      const ip = lease.address;
      if (!ip) continue;
      
      activeIps.add(ip);
      
      const comment = lease.comment || '';
      const plan = extractPlanFromComment(comment);
      const clientName = extractNameFromComment(comment);
      
      if (!plan) continue;
      
      totalWithPlan++;
      
      const previousData = previousComments.get(ip);
      const previousComment = previousData?.comment || '';
      const previousPlan = previousData?.plan || '';
      const previousName = previousData?.name || '';
      
      const isOnline = await isClientOnline(ip);
      
      const existingQueue = queueMap.get(ip);
      
      const commentChanged = (previousComment !== comment);
      const planChanged = (previousPlan !== plan);
      const nameChanged = (previousName !== clientName);
      const anythingChanged = commentChanged || planChanged || nameChanged;
      
      if (!previousData) {
        if (isOnline) {
          console.log(`   🆕 New client ${clientName} (${ip}) - ONLINE, creating queue`);
          await createSimpleQueue(conn, ip, clientName, plan);
          created++;
        } else {
          console.log(`   ⏳ New client ${clientName} (${ip}) - OFFLINE, waiting...`);
        }
      }
      else if (anythingChanged) {
        console.log(`   🔄 Client changed for ${clientName} (${ip})`);
        
        if (existingQueue) {
          await deleteSimpleQueue(conn, existingQueue.id, ip);
          deleted++;
        }
        
        if (isOnline) {
          await createSimpleQueue(conn, ip, clientName, plan);
          created++;
        }
      }
      else if (!isOnline && existingQueue) {
        console.log(`   🔴 ${clientName} (${ip}) - WENT OFFLINE, removing queue`);
        await deleteSimpleQueue(conn, existingQueue.id, ip);
        deleted++;
      }
      else if (isOnline && !existingQueue) {
        console.log(`   🟢 ${clientName} (${ip}) - CAME ONLINE, creating queue`);
        await createSimpleQueue(conn, ip, clientName, plan);
        created++;
      }
      else {
        unchanged++;
      }
      
      currentState.set(ip, {
        comment: comment,
        plan: plan,
        name: clientName,
        lastSeen: new Date().toISOString()
      });
    }
    
    for (const [ip, data] of previousComments.entries()) {
      if (!activeIps.has(ip)) {
        const existingQueue = queueMap.get(ip);
        if (existingQueue) {
          console.log(`   👋 Client left: ${data.name || ip} - removing queue`);
          await deleteSimpleQueue(conn, existingQueue.id, ip);
          deleted++;
        }
        previousComments.delete(ip);
      }
    }
    
    for (const [ip, data] of currentState.entries()) {
      previousComments.set(ip, data);
    }
    
    if (created > 0 || deleted > 0) {
      console.log(`   📊 ${totalWithPlan} with PLAN | 🆕 ${created} created | 🗑️ ${deleted} removed | ${unchanged} unchanged`);
    } else {
      console.log(`   ✅ No changes detected (${unchanged} clients stable)`);
    }
    
  } catch (error) {
    console.log(`   ❌ Scan error: ${error.message}`);
  } finally {
    if (conn) {
      try { await conn.close(); } catch (e) {}
    }
  }
}

async function createSimpleQueue(conn, ip, name, plan) {
  try {
    const speed = getQueueSpeedForPlan(plan);
    
    const cleanName = name.replace(/[^a-zA-Z0-9]/g, '');
    
    await conn.write('/queue/simple/add', [
      `=name=${cleanName}`,
      `=target=${ip}/32`,
      `=max-limit=${speed.maxLimit}`,
      `=burst-limit=${speed.burstLimit}`,
      `=burst-threshold=${speed.burstThreshold}`,
      `=burst-time=${speed.burstTime}`,
      `=limit-at=${speed.limitAt}`,
      `=queue=fqcodel-download/fqcodel-upload`
    ]);
    
    console.log(`      ✅ Queue created: ${cleanName}`);
    return true;
  } catch (error) {
    console.log(`      ❌ Failed: ${error.message}`);
    return false;
  }
}

async function deleteSimpleQueue(conn, queueId, ip) {
  try {
    await conn.write('/queue/simple/remove', [`=.id=${queueId}`]);
    console.log(`      🗑️ Queue removed for ${ip}`);
    return true;
  } catch (error) {
    return false;
  }
}

function startSimpleQueueMonitor() {
  if (monitorTask) {
    monitorTask.stop();
    console.log("⏹️ Stopped existing monitor");
  }
  
  console.log("🚀 Auto Simple Queue System started (20s interval)");
  
  setTimeout(async () => {
    console.log("📊 Initializing queue monitor memory...");
    
    let conn = null;
    try {
      conn = await connectRouter(2);
      const leases = await conn.write('/ip/dhcp-server/lease/print', ['?status=bound']);
      
      let count = 0;
      leases.forEach(lease => {
        const ip = lease.address;
        if (!ip) return;
        
        const comment = lease.comment || '';
        const plan = extractPlanFromComment(comment);
        const clientName = extractNameFromComment(comment);
        
        if (plan) {
          previousComments.set(ip, {
            comment: comment,
            plan: plan,
            name: clientName,
            lastSeen: new Date().toISOString()
          });
          count++;
        }
      });
      
      console.log(`   ✅ Monitor initialized with ${count} clients (no actions taken)`);
      isFirstScan = false;
      
    } catch (error) {
      console.log(`   ⚠️ Initialization error: ${error.message}`);
    } finally {
      if (conn) {
        try { await conn.close(); } catch (e) {}
      }
    }
  }, 3000);
  
  monitorTask = cron.schedule('*/20 * * * * *', async () => {
    await checkAndUpdateQueues();
  });
  
  console.log("✅ Auto Simple Queue System scheduled");
}

// ============================================================================
// DHCP PLAN MONITOR ENDPOINTS
// ============================================================================

app.post('/api/scan-plans', async (req, res) => {
  console.log("📋 Manual scan requested");
  try {
    await checkAndUpdateQueues();
    res.json({ success: true, message: "Scan completed" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/plan-changes', (req, res) => {
  const changes = [];
  for (const [ip, data] of previousComments.entries()) {
    changes.push({
      ip,
      plan: data.plan,
      lastSeen: data.lastSeen
    });
  }
  
  res.json({ 
    success: true,
    message: "DHCP Plan Monitor is running",
    interval: "20 seconds",
    lastSuccessfulScan: lastSuccessfulScan,
    totalClientsTracked: previousComments.size,
    recentChanges: changes.slice(-10)
  });
});

app.get('/api/monitor-status', (req, res) => {
  res.json({
    success: true,
    monitorActive: monitorTask !== null,
    lastSuccessfulScan: lastSuccessfulScan,
    scanErrors: scanErrors,
    trackedClients: previousComments.size,
    routerIP: ROUTER_IP,
    nextScan: new Date(Date.now() + 20000).toISOString()
  });
});

// ============================================================================
// QUEUE ENDPOINTS
// ============================================================================

app.post('/api/queues/add', async (req, res) => {
  try {
    const queueData = req.body;
    const conn = await connectRouter();
    
    await conn.write('/queue/simple/add', [
      `=name=${queueData.name}`,
      `=target=${queueData.target}/32`,
      `=max-limit=${queueData["max-limit"]}`,
      `=burst-limit=${queueData["burst-limit"]}`,
      `=burst-threshold=${queueData["burst-threshold"]}`,
      `=burst-time=${queueData["burst-time"]}`,
      `=limit-at=${queueData["limit-at"]}`,
      `=queue=${queueData.queue}`
    ]);
    
    await conn.close();
    res.json({ success: true });
  } catch (error) {
    console.error("❌ Queue add error:", error);
    res.status(500).json({ error: error.message });
  }
});

app.put('/queues/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const queueData = req.body;
    
    const conn = await connectRouter();
    
    await conn.write('/queue/simple/set', [
      `=.id=${id}`,
      `=name=${queueData.name}`,
      `=target=${queueData.target}/32`,
      `=max-limit=${queueData["max-limit"]}`,
      `=burst-limit=${queueData["burst-limit"]}`,
      `=burst-threshold=${queueData["burst-threshold"]}`,
      `=burst-time=${queueData["burst-time"]}`,
      `=limit-at=${queueData["limit-at"]}`,
      `=queue=${queueData.queue}`
    ]);
    
    await conn.close();
    res.json({ success: true });
  } catch (error) {
    console.error("❌ Queue update error:", error);
    res.status(500).json({ error: error.message });
  }
});

app.delete('/queues/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const conn = await connectRouter();
    
    await conn.write('/queue/simple/remove', [`=.id=${id}`]);
    
    await conn.close();
    res.json({ success: true });
  } catch (error) {
    console.error("❌ Queue delete error:", error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// LEASE MANAGEMENT ENDPOINTS
// ============================================================================

app.post('/api/lease/remove', async (req, res) => {
  try {
    const { id } = req.body;
    
    console.log(`🔄 Removing static lease ID: ${id}`);
    
    const conn = await connectRouter();
    
    await conn.write('/ip/dhcp-server/lease/remove', [`=.id=${id}`]);
    
    await conn.close();
    
    res.json({ 
      success: true, 
      message: 'Static lease removed, will become dynamic on next renewal'
    });
  } catch (error) {
    console.error("❌ Lease removal error:", error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/address-list/remove', async (req, res) => {
  try {
    const { id } = req.body;
    
    console.log(`🗑️ Removing address list entry ID: ${id}`);
    
    const conn = await connectRouter();
    
    await conn.write('/ip/firewall/address-list/remove', [`=.id=${id}`]);
    
    await conn.close();
    
    res.json({ 
      success: true, 
      message: 'Address list entry removed completely'
    });
  } catch (error) {
    console.error("❌ Address list removal error:", error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/lease/clear-comment', async (req, res) => {
  try {
    const { id } = req.body;
    
    console.log(`🧹 Clearing comment for lease ID: ${id}`);
    
    const conn = await connectRouter();
    
    await conn.write('/ip/dhcp-server/lease/set', [
      `=.id=${id}`,
      `=comment=`
    ]);
    
    await conn.close();
    
    res.json({ success: true });
  } catch (error) {
    console.error("❌ Clear comment error:", error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/address-list/find', async (req, res) => {
  try {
    const { ip } = req.body;
    
    const conn = await connectRouter();
    
    const entries = await conn.write('/ip/firewall/address-list/print', [
      '?address=' + ip
    ]);
    
    await conn.close();
    
    if (entries.length > 0) {
      res.json({ 
        success: true, 
        id: entries[0]['.id'],
        entry: entries[0]
      });
    } else {
      res.json({ success: false, message: 'No entry found' });
    }
  } catch (error) {
    console.error("❌ Find address list error:", error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/lease/find', async (req, res) => {
  try {
    const { ip } = req.body;
    
    const conn = await connectRouter();
    
    const leases = await conn.write('/ip/dhcp-server/lease/print', [
      '?address=' + ip
    ]);
    
    await conn.close();
    
    if (leases.length > 0) {
      res.json({ 
        success: true, 
        id: leases[0]['.id'],
        lease: leases[0]
      });
    } else {
      res.json({ success: false, message: 'No lease found' });
    }
  } catch (error) {
    console.error("❌ Find lease error:", error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// BASIC ENDPOINTS
// ============================================================================

app.get("/", (req, res) => {
  res.send("MikroTik Admin API is running");
});

app.get("/health", (req, res) => {
  res.status(200).json({ 
    status: "OK", 
    timestamp: new Date().toISOString(),
    router: ROUTER_IP,
    addressList: ADDRESS_LIST,
    autoDisable: {
      enabled: autoDisableState.enabled,
      interval: autoDisableState.interval,
      time: autoDisableState.time,
      lastRun: autoDisableState.lastRun,
      nextRun: autoDisableState.nextRun
    }
  });
});

app.get("/test-connection", async (req, res) => {
  try {
    const start = Date.now();
    const conn = await connectRouter(2);
    const identity = await conn.write("/system/identity/print");
    const resources = await conn.write("/system/resource/print");
    await conn.close();
    const duration = Date.now() - start;
    
    res.json({ 
      success: true, 
      identity: identity[0]?.name || "Unknown",
      uptime: resources[0]?.uptime || "Unknown",
      version: resources[0]?.version || "Unknown",
      responseTime: duration + "ms",
      message: "✅ Connected to MikroTik successfully"
    });
  } catch (err) {
    res.status(500).json({ 
      success: false, 
      error: err.message 
    });
  }
});

// ============================================================================
// START SERVER
// ============================================================================

const initialize = async () => {
  try {
    await fs.access(LOG_FILE).catch(() => 
      fs.writeFile(LOG_FILE, `[${new Date().toISOString()}] [INFO] Auto-disable log created\n`)
    );
    
    try {
      const configData = await fs.readFile('./auto-disable-config.json', 'utf8');
      const savedConfig = JSON.parse(configData);
      autoDisableState.enabled = savedConfig.enabled || true;
      autoDisableState.interval = savedConfig.interval || '1d';
      autoDisableState.time = savedConfig.time || '00:05:00';
      
      console.log("📂 Loaded auto-disable config:", autoDisableState);
      
      if (autoDisableState.enabled) {
        setupAutoDisableScheduler(
          autoDisableState.interval, 
          autoDisableState.time, 
          true
        );
      }
    } catch (e) {
      console.log("📂 No saved config found, using defaults");
    }
    
    console.log("\n" + "=".repeat(60));
    console.log("🔌 TESTING CONNECTION TO MIKROTIK");
    console.log("=".repeat(60));
    
    let connected = false;
    
    for (let i = 1; i <= 3; i++) {
      try {
        console.log(`📡 Attempt ${i}/3: Connecting to ${ROUTER_IP}...`);
        const conn = await connectRouter(1);
        const identity = await conn.write("/system/identity/print");
        await conn.close();
        connected = true;
        console.log(`✅ Connected to MikroTik successfully (${identity[0]?.name || "Unknown"})`);
        break;
      } catch (error) {
        console.log(`⚠️ Attempt ${i}/3 failed: ${error.message}`);
        if (i < 3) {
          const waitTime = i * 3000;
          console.log(`⏳ Waiting ${waitTime/1000}s before retry...`);
          await new Promise(resolve => setTimeout(resolve, waitTime));
        }
      }
    }
    
    console.log("\n" + "=".repeat(60));
    startSimpleQueueMonitor();
    
    app.listen(PORT, "0.0.0.0", () => {
      console.log("\n" + "=".repeat(60));
      console.log("🚀 MIKROTIK BILLING & BANDWIDTH SERVER");
      console.log("=".repeat(60));
      console.log(`📡 PORT: ${PORT}`);
      console.log(`🌐 ROUTER: ${ROUTER_IP}`);
      console.log(`🔄 DHCP PLAN MONITOR: ACTIVE (checks every 20 seconds)`);
      console.log(`🤖 AUTO-DISABLE: ${autoDisableState.enabled ? 'ACTIVE' : 'INACTIVE'}`);
      if (autoDisableState.enabled) {
        console.log(`   Interval: ${autoDisableState.interval}`);
        console.log(`   Time: ${autoDisableState.time}`);
        console.log(`   Next run: ${autoDisableState.nextRun}`);
      }
      console.log(`⏱️  TIMEOUT: 30 seconds`);
      console.log(`📊 STATUS: ${connected ? '✅ Connected' : '⚠️ Connection Issues'}`);
      console.log("=".repeat(60));
      
      console.log("\n📌 NEW FEATURES:");
      console.log("  ✅ AUTO 30-DAY DUE DATE - When creating client");
      console.log("  ✅ AUTO 7-DAY GRACE PERIOD - After due date");
      console.log("  ✅ FIXED DUE DATE - Payment doesn't extend due date");
      console.log("  ✅ GRACE PERIOD IN ROUTER - (grace: YYYY-MM-DD) in comment");
      console.log("  ✅ GRACE REMINDER PAGE - For clients in grace period");
      
      console.log("\n✅ Server is ready!");
    });
    
  } catch (error) {
    console.error("❌ Failed to initialize:", error);
    process.exit(1);
  }
};

process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
});

process.on('unhandledRejection', (error) => {
  console.error('❌ Unhandled Rejection:', error);
});

initialize(); 