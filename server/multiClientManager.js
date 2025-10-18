// server/multiClientManager.js
const { Client, LocalAuth } = require('whatsapp-web.js');
const EventEmitter = require('events');
const fs = require('fs-extra');
const nodeFs = require('fs');
const path = require('path');
const qrcode = require('qrcode');

// Optional hardening via environment
const WA_WEB_VERSION = process.env.WA_WEB_VERSION || null; // e.g. "2.2412.54"

// Simple per-id mutex to serialize operations like reinit/regenerate
class SimpleMutex {
  constructor() {
    this.queue = [];
    this.locked = false;
  }
  async lock() {
    return new Promise((resolve) => {
      const grant = () => {
        const unlock = () => {
          const next = this.queue.shift();
          if (next) {
            next();
          } else {
            this.locked = false;
          }
        };
        resolve(unlock);
      };
      if (this.locked) {
        this.queue.push(grant);
      } else {
        this.locked = true;
        grant();
      }
    });
  }
}

class MultiClientManager extends EventEmitter {
  constructor(baseDir) {
    super();
    this.baseDir = baseDir || path.join(__dirname, '../.wwebjs_auth');
    this.clients = {};
    this.activeClientId = null;
    this.dataDir = path.join(__dirname, '../data');
    this.metaPath = path.join(this.dataDir, 'accounts.json');
    this.meta = { accounts: {}, activeClientId: null };
    // Reconnect/backoff state and init watchdogs
    this.reconnectInfo = {}; // { [id]: { attempts: number, timer: NodeJS.Timeout | null } }
    this.initWatchdogs = {}; // { [id]: NodeJS.Timeout }
    // Send queue & rate limiting
    this.sendQueues = {}; // { [id]: Array<job> }
    this.queueProcessing = {}; // { [id]: boolean }
    this.lastSentAt = {}; // { [id]: number }
    this.minGapMs = 1200; // 1.2s între mesaje per cont
    // Operation mutexes per client id
    this.mutexes = {};
  }

  // Normalizează ID-ul la formatul canonic: 'session-' + nume (elimină prefixele repetate)
  normalizeSessionId(id) {
    const raw = String(id || '').trim();
    const name = raw.replace(/^(session-)+/i, '');
    return `session-${name}`;
  }

  getMutex(id) {
    const key = this.normalizeSessionId(id);
    if (!this.mutexes[key]) this.mutexes[key] = new SimpleMutex();
    return this.mutexes[key];
  }

  async withLock(id, fn) {
    const m = this.getMutex(id);
    const unlock = await m.lock();
    try {
      return await fn();
    } finally {
      try { unlock(); } catch (_) {}
    }
  }

  async init() {
    await fs.ensureDir(this.baseDir);
    await fs.ensureDir(this.dataDir);
    await this.loadMeta();
    
    // Optional: Curăță sesiunile invalide DOAR dacă este activat explicit
    if (process.env.WHATSAPP_AUTOCLEAN === 'true') {
      console.log(`🧹 Curățare sesiuni invalide la inițializare (activată prin env)...`);
      await this.cleanupInvalidSessions();
      await this.forceCleanupIfNeeded();
    } else {
      console.log(`🧹 Auto-clean dezactivat la inițializare (păstrez sesiunile existente).`);
    }
    
    // Elimină procesele Chrome rămase (opțional)
    if (process.env.WHATSAPP_KILL_CHROME_ON_START === 'true') {
      console.log(`🔥 Eliminare procese Chrome rămase...`);
      await this.killAllChromeProcesses();
    } else {
      console.log(`🔥 Skip eliminare procese Chrome la start (config).`);
    }
    
    // Încarcă sesiunile valide
    const dirs = await fs.readdir(this.baseDir);
    
    // Filtrează directoarele invalide: permit 0 sau 1 prefix 'session-' la început
    const validDirs = dirs.filter(dir => !/^(session-){2,}/i.test(dir));
    
    console.log(`📱 Found ${validDirs.length} valid WhatsApp sessions (filtered ${dirs.length - validDirs.length} invalid ones)`);
    
    for (const dir of validDirs) {
      try {
        await this.loadClient(dir);
      } catch (error) {
        console.error(`❌ Error loading client ${dir}:`, error.message);
      }
    }

    // Ensure meta contains all discovered sessions so they appear in API
    try {
      for (const dir of validDirs) {
        const id = this.normalizeSessionId(dir);
        if (!this.meta.accounts[id]) {
          this.meta.accounts[id] = { connected: false, lastConnectedAt: null };
        }
      }
      await this.saveMeta?.();
    } catch (_) {}

    // Restore last active client if exists
    if (this.meta.activeClientId && this.clients[this.meta.activeClientId]) {
      this.activeClientId = this.meta.activeClientId;
    }
  }

  async loadClient(id) {
    if (this.clients[id]) return this.clients[id];

    // Construiește args Puppeteer în funcție de platformă (pe Windows evită --single-process)
    const baseArgs = [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--disable-gpu',
      '--disable-software-rasterizer',
      '--disable-extensions',
      '--disable-background-networking',
      '--disable-background-timer-throttling',
      '--disable-client-side-phishing-detection',
      '--disable-default-apps',
      '--disable-hang-monitor',
      '--disable-popup-blocking',
      '--disable-prompt-on-repost',
      '--disable-sync',
      '--metrics-recording-only',
      '--no-default-browser-check',
      '--no-pings',
      '--disable-domain-reliability',
      '--disable-print-preview',
      '--disable-speech-api',
      '--mute-audio',
      '--hide-scrollbars',
      '--renderer-process-limit=3',
      '--js-flags=--max-old-space-size=256'
    ];
    if (process.platform !== 'win32') {
      baseArgs.push('--single-process');
    }

    const authClientId = String(id).replace(/^(session-)+/i, '');
    // Try to use a system Chrome/Edge on Windows (stabilize QR on some environments)
    let executablePath = undefined;
    try {
      if (process.platform === 'win32') {
        const envCandidates = [];
        try {
          if (process.env.CHROME_PATH) envCandidates.push(process.env.CHROME_PATH);
          if (process.env.PUPPETEER_EXECUTABLE_PATH) envCandidates.push(process.env.PUPPETEER_EXECUTABLE_PATH);
        } catch (_) {}

        const localAppData = process.env.LOCALAPPDATA || '';
        const userProfile = process.env.USERPROFILE || '';

        const candidates = [
          // Program Files (system-wide installs)
          'C:/Program Files/Google/Chrome/Application/chrome.exe',
          'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
          'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
          'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
          // Per-user installs (LOCALAPPDATA)
          `${localAppData}/Google/Chrome/Application/chrome.exe`,
          `${localAppData}/Microsoft/Edge/Application/msedge.exe`,
          // Potential portable/user profile paths
          `${userProfile}/AppData/Local/Google/Chrome/Application/chrome.exe`,
          `${userProfile}/AppData/Local/Microsoft/Edge/Application/msedge.exe`,
          // Env-provided explicit paths
          ...envCandidates
        ].filter(Boolean);

        for (const c of candidates) {
          try {
            if (c && await fs.pathExists(c)) { executablePath = c; break; }
          } catch (_) {}
        }

        try {
          console.log(`🧭 Puppeteer Chrome path ${executablePath ? 'detected' : 'not found'}${executablePath ? ': ' + executablePath : ''}`);
        } catch (_) {}
      }
    } catch (_) {}

    const clientOptions = {
      authStrategy: new LocalAuth({ clientId: authClientId }),
      webVersionCache: { type: 'local' },
      qrMaxRetries: 6,
      takeoverOnConflict: true,
      takeoverTimeoutMs: 5000,
      puppeteer: {
        headless: 'new',
        args: baseArgs,
        executablePath,
        defaultViewport: { width: 900, height: 700 }
      }
    };
    if (WA_WEB_VERSION) {
      clientOptions.webVersion = WA_WEB_VERSION;
    }

    const client = new Client(clientOptions);

    client.status = { connected: false, qr: null, initStartAt: Date.now() };

    client.on('qr', async (qr) => {
      try {
        const qrDataUrl = await qrcode.toDataURL(qr);
        client.status.qr = qrDataUrl;
        client.status.connected = false;
        console.log(`📱 QR ready for ${id}`);
        this.emit('qr', { id, qrDataUrl });
      } catch (e) {
        console.error(`❌ QR DataURL generation error for ${id}:`, e.message);
      }
      this.clearInitWatchdog(id);
    });

    client.on('ready', async () => {
      client.status.connected = true;
      client.status.qr = null;
      console.log(`✅ WhatsApp client ${id} ready`);

      // Persist connection state
      const info = this.meta.accounts[id] || {};
      info.connected = true;
      info.lastConnectedAt = Date.now();
      this.meta.accounts[id] = info;
      await this.saveMeta();

      // Reset reconnect attempts and clear watchdogs
      this.resetReconnect(id);
      this.clearInitWatchdog(id);
      this.emit('ready', { id });
    });

    client.on('disconnected', async () => {
      client.status.connected = false;
      console.log(`⚠️ Client ${id} disconnected`);

      const info = this.meta.accounts[id] || {};
      info.connected = false;
      this.meta.accounts[id] = info;
      await this.saveMeta();

      // Schedule reconnect with backoff
      this.scheduleReconnect(id);
      this.emit('disconnected', { id });
    });

    client.on('auth_failure', (m) => {
      console.warn(`⚠️ Auth failure for ${id}:`, m);
      // Try re-init with backoff; often fixes after re-scan
      this.scheduleReconnect(id);
    });

    // Incoming messages → forward to server via event
    client.on('message', (msg) => {
      try {
        const from = String(msg.from || '').replace(/@c\.us$/, '').replace(/\D+/g, '');
        const body = msg.body || '';
        const notifyName = (msg._data && msg._data.notifyName) || '';
        this.emit('incoming_message', { clientId: id, from, body, at: Date.now(), notifyName });
      } catch (e) {
        console.warn('⚠️ incoming message parse error:', e.message);
      }
    });

    // Typing indicators
    try {
      client.on('typing', (chat) => {
        try {
          const from = String(chat?.id?._serialized || '').replace(/@c\.us$/, '').replace(/\D+/g, '');
          this.emit('typing', { clientId: id, from, typing: true });
        } catch (_) {}
      });
      client.on('typing_stopped', (chat) => {
        try {
          const from = String(chat?.id?._serialized || '').replace(/@c\.us$/, '').replace(/\D+/g, '');
          this.emit('typing', { clientId: id, from, typing: false });
        } catch (_) {}
      });
    } catch (_) {}

    // Delivery/Read acknowledgements
    client.on('message_ack', (message, ack) => {
      try {
        const to = String(message.to || '').replace(/@c\.us$/, '').replace(/\D+/g, '');
        const waId = message.id && message.id.id ? message.id.id : null;
        this.emit('message_ack', { clientId: id, to, waId, ack });
      } catch (e) {
        console.warn('⚠️ message_ack parse error:', e.message);
      }
    });

    // Initialize in background to return immediately
    this.clients[id] = client;
    client.initialize().catch(err => {
      console.error(`❌ initialize() failed for ${id}:`, err.message);
    });

    // Start an init watchdog to avoid indefinite waiting
    this.startInitWatchdog(id, 15000);
    return client;
  }

  async addClient(id) {
    const cleanId = this.normalizeSessionId(id);
    if (this.clients[cleanId]) return this.clients[cleanId];
    console.log(`🆕 Adding WhatsApp client: ${cleanId}`);
    // Initialize metadata entry
    if (!this.meta.accounts[cleanId]) {
      this.meta.accounts[cleanId] = { connected: false, lastConnectedAt: null };
      await this.saveMeta();
    }
    const c = await this.loadClient(cleanId);
    this.emit('accountsChanged');
    return c;
  }

  async switchClient(id) {
    const cleanId = this.normalizeSessionId(id);
    
    if (!this.clients[cleanId]) await this.loadClient(cleanId);
    this.activeClientId = cleanId;
    console.log(`🔄 Active WhatsApp client switched to: ${cleanId}`);
    this.meta.activeClientId = cleanId;
    await this.saveMeta();
    this.emit('activeChanged', { id: cleanId });
  }

  /**
   * Așteaptă primul QR pentru un client (cu timeout)
   */
  async waitForQR(id, timeoutMs = 5000) {
    const cleanId = this.normalizeSessionId(id);
    if (!this.clients[cleanId]) {
      await this.loadClient(cleanId);
    }
    const client = this.clients[cleanId];
    if (!client) return null;
    if (client.status && client.status.qr) return client.status.qr;

    return await new Promise((resolve) => {
      let resolved = false;
      const onQr = async (qr) => {
        try {
          const dataUrl = await qrcode.toDataURL(qr);
          client.status.qr = dataUrl;
          if (!resolved) { resolved = true; resolve(dataUrl); }
        } catch (_) {
          if (!resolved) { resolved = true; resolve(null); }
        } finally {
          client.removeListener('qr', onQr);
        }
      };
      client.on('qr', onQr);
      setTimeout(() => {
        client.removeListener('qr', onQr);
        if (!resolved) { resolved = true; resolve(client.status.qr || null); }
      }, timeoutMs);
    });
  }

  // 🔫 Eliminare agresivă a proceselor Chrome - SOLUȚIE FINALĂ
  async killChromeProcesses(id) {
    const cleanId = this.normalizeSessionId(id);
    console.log(`🔫 Eliminare procese Chrome pentru client: ${cleanId}`);
    
    try {
      // SOLUȚIA FINALĂ: Folosește metoda nativă
      await this.killProcessesByPattern('chrome');
      await this.killProcessesByPattern('chrome.exe');
      await this.killProcessesByPattern('chromium');
      
      console.log(`✅ Procese Chrome eliminate pentru: ${id}`);
      return true;
    } catch (error) {
      console.warn(`⚠️ Avertisment eliminare procese pentru ${id}:`, error.message);
      return false;
    }
  }

  // 🛑 Oprire controlată pentru un client specific
  async stopClient(id) {
    const cleanId = this.normalizeSessionId(id);
    const client = this.clients[cleanId];
    if (!client) {
      console.warn(`⚠️ Clientul ${cleanId} nu este activ.`);
      return false;
    }

    console.log(`🛑 Oprire client WhatsApp: ${cleanId}`);
    try {
      await client.destroy(); // închide sesiunea WhatsApp Web
      if (client.pupBrowser) {
        await client.pupBrowser.close(); // închide Chrome/puppeteer complet
      }

      // Elimină procesele Chrome asociate
      await this.killChromeProcesses(cleanId);

      delete this.clients[cleanId];
      console.log(`✅ Clientul ${cleanId} a fost oprit complet.`);
      // Remove metadata entry
      delete this.meta.accounts[cleanId];
      if (this.meta.activeClientId === cleanId) {
        this.meta.activeClientId = null;
        this.activeClientId = null;
      }
      await this.saveMeta();
      this.resetReconnect(cleanId);
      this.clearInitWatchdog(cleanId);
      this.emit('accountsChanged');
      return true;
    } catch (err) {
      console.error(`❌ Eroare la oprirea clientului ${cleanId}:`, err);
      return false;
    }
  }

  // 🛑 Oprire soft: nu șterge meta și nu omoară toate procesele Chrome
  async stopClientSoft(id) {
    const cleanId = this.normalizeSessionId(id);
    const client = this.clients[cleanId];
    if (!client) return false;
    console.log(`🛑(soft) Oprire client WhatsApp: ${cleanId}`);
    try {
      await client.destroy();
      if (client.pupBrowser) {
        try { await client.pupBrowser.close(); } catch (_) {}
      }
      delete this.clients[cleanId];
      // NU șterge meta, NU killAllChromeProcesses
      this.resetReconnect(cleanId);
      this.clearInitWatchdog(cleanId);
      this.emit('accountsChanged');
      return true;
    } catch (err) {
      console.warn(`⚠️ Eroare stopClientSoft pentru ${cleanId}:`, err.message);
      return false;
    }
  }

  // 🚮 Ștergere sigură a sesiunii din sistem
  async removeClient(id) {
    const cleanId = this.normalizeSessionId(id);
    console.log(`🚮 Încep ștergerea clientului ${cleanId}...`);
    
    // Pasul 1: Oprește clientul
    await this.stopClient(cleanId);
    
    // Pasul 2: Elimină toate procesele Chrome
    await this.killChromeProcesses(cleanId);

    const sessionPath = path.join(this.baseDir, cleanId);
    
    // Pasul 3: Încearcă să ștergi folderul cu retry logic
    let retries = 5;
    while (retries > 0) {
      try {
        console.log(`⏳ Aștept ${3} secunde pentru eliberarea fișierelor... (${retries} încercări rămase)`);
        await new Promise(res => setTimeout(res, 3000));

        // Verifică dacă directorul există
        if (await fs.pathExists(sessionPath)) {
          // CORECTARE: Încearcă să ștergi fișierele individual, ignorând chrome_debug.log blocate
          try {
            await this.removeDirectorySafely(sessionPath);
            console.log(`🗑️ Folder sesiune șters complet pentru: ${cleanId}`);
            return { ok: true, message: `Clientul ${cleanId} a fost șters complet.` };
          } catch (removeError) {
            // Dacă nu poate șterge complet, încearcă să șterge ce poate
            console.warn(`⚠️ Nu pot șterge complet ${cleanId}, încerc să șterg ce pot...`);
            await this.removeDirectoryPartially(sessionPath);
            console.log(`🗑️ Folder sesiune șters parțial pentru: ${cleanId}`);
            return { ok: true, message: `Clientul ${cleanId} a fost șters parțial (ignorând fișierele blocate).` };
          }
        } else {
          console.log(`✅ Folderul ${cleanId} nu mai există, ștergerea a fost deja efectuată.`);
          return { ok: true, message: `Clientul ${cleanId} a fost șters complet.` };
        }

      } catch (err) {
        retries--;
        
        if (err.code === "EBUSY" || err.code === "ENOTEMPTY") {
          console.warn(`⚠️ Fișier blocat pentru ${id}, încerc din nou... (${retries} încercări rămase)`);
          
          if (retries === 0) {
            // Ultima încercare: încearcă să ștergi fișierele individual
            try {
              console.log(`🔧 Ultima încercare: șterg fișierele individual...`);
              const files = await fs.readdir(sessionPath);
              for (const file of files) {
                try {
                  await fs.remove(path.join(sessionPath, file));
                } catch (fileErr) {
                  console.warn(`⚠️ Nu pot șterge fișierul ${file}:`, fileErr.message);
                }
              }
              // Încearcă să ștergi directorul gol
              await fs.rmdir(sessionPath);
              console.log(`🗑️ Folder sesiune șters parțial pentru: ${id}`);
              return { ok: true, message: `Clientul ${id} a fost șters parțial.` };
            } catch (finalErr) {
              console.error(`❌ Eroare finală la ștergerea folderului ${id}:`, finalErr.message);
              return { ok: false, error: `Nu s-a putut șterge complet: ${finalErr.message}` };
            }
          }
        } else {
          console.error(`❌ Eroare la ștergerea folderului ${id}:`, err.message);
          return { ok: false, error: err.message };
        }
      }
    }
  }


  async listAccounts() {
    // Build a unified list from: loaded clients, persisted meta, session folders
    const fromClients = Object.keys(this.clients || {});
    let fromDirs = [];
    try {
      const dirs = await fs.readdir(this.baseDir);
      // filter out obviously invalid session ids (double prefix)
      fromDirs = (dirs || []).filter(dir => !/^(session-){2,}/i.test(dir));
    } catch (_) {}
    const fromMeta = Object.keys((this.meta && this.meta.accounts) || {});

    const all = new Set([
      ...fromClients,
      ...fromDirs.map(d => this.normalizeSessionId(d)),
      ...fromMeta.map(m => this.normalizeSessionId(m))
    ]);

    const results = [];
    for (const idRaw of all) {
      const id = this.normalizeSessionId(idRaw);
      const client = this.clients[id];
      const connected = !!(client && client.status && client.status.connected);
      const qrDataUrl = client && client.status ? client.status.qr : null;
      const lastConnectedAt = (this.meta.accounts[id] && this.meta.accounts[id].lastConnectedAt) || null;
      results.push({
        id,
        active: id === (this.activeClientId || this.meta.activeClientId),
        connected,
        qrDataUrl,
        lastConnectedAt
      });
    }
    return results;
  }

  getActiveClient() {
    return this.clients[this.activeClientId] || null;
  }

  getActiveClientId() {
    return this.activeClientId || null;
  }

  // =============================
  // Send queue with rate limiting & retries
  // =============================
  async enqueueMessage(id, chatId, message, options = {}) {
    const cleanId = this.normalizeSessionId(id);
    const job = {
      chatId,
      message,
      attempts: 0,
      maxAttempts: options.maxAttempts || 3,
      promise: null,
      resolve: null,
      reject: null
    };
    job.promise = new Promise((resolve, reject) => {
      job.resolve = resolve;
      job.reject = reject;
    });
    if (!this.sendQueues[cleanId]) this.sendQueues[cleanId] = [];
    this.sendQueues[cleanId].push(job);
    this.processQueue(cleanId).catch(() => {});
    return job.promise;
  }

  async processQueue(id) {
    const cleanId = this.normalizeSessionId(id);
    if (this.queueProcessing[cleanId]) return;
    this.queueProcessing[cleanId] = true;
    try {
      while (this.sendQueues[cleanId] && this.sendQueues[cleanId].length > 0) {
        const job = this.sendQueues[cleanId][0];

        // Rate limiting delay
        const now = Date.now();
        const last = this.lastSentAt[cleanId] || 0;
        const waitMs = Math.max(0, this.minGapMs - (now - last));
        if (waitMs > 0) await new Promise(r => setTimeout(r, waitMs));

        // Ensure client exists
        if (!this.clients[cleanId]) {
          await this.loadClient(cleanId).catch(() => {});
        }
        const client = this.clients[cleanId];

        try {
          if (!client || !client.status?.connected) {
            throw new Error('NOT_CONNECTED');
          }
          const result = await client.sendMessage(job.chatId, job.message);
          this.lastSentAt[cleanId] = Date.now();
          // Success
          this.sendQueues[cleanId].shift();
          job.resolve(result);
        } catch (err) {
          job.attempts += 1;
          if (job.attempts >= job.maxAttempts) {
            // Fail permanently
            this.sendQueues[cleanId].shift();
            job.reject(err);
          } else {
            // Backoff and retry (reinsert at front after delay)
            const delay = this.computeBackoffMs(job.attempts);
            await new Promise(r => setTimeout(r, delay));
            // loop will retry same head job
          }
        }
      }
    } finally {
      this.queueProcessing[cleanId] = false;
    }
  }

  // =============================
  // Persistence helpers
  // =============================
  async loadMeta() {
    try {
      await fs.ensureDir(this.dataDir);
      const bakPath = this.metaPath + '.bak';
      const tryPaths = [this.metaPath, bakPath];

      let loaded = null;
      for (const p of tryPaths) {
        try {
          if (await fs.pathExists(p)) {
            const data = await fs.readJson(p);
            if (data && typeof data === 'object') { loaded = data; break; }
          }
        } catch (_) { /* try next */ }
      }

      if (!loaded) {
        // initialize fresh meta
        loaded = { accounts: {}, activeClientId: null };
        await this.atomicWriteJson(this.metaPath, loaded);
      }

      // Migrate/normalize keys (ensure single 'session-' prefix)
      const normalized = { accounts: {}, activeClientId: loaded.activeClientId || null };
      const accounts = loaded.accounts || {};
      Object.keys(accounts).forEach((key) => {
        const clean = this.normalizeSessionId(key);
        normalized.accounts[clean] = accounts[key] || {};
      });
      if (normalized.activeClientId) {
        normalized.activeClientId = this.normalizeSessionId(normalized.activeClientId);
      }

      this.meta = normalized;
      // Persist normalized structure atomically
      await this.saveMeta();

      // Remove legacy/demo file if exists
      const legacy = path.join(this.dataDir, 'whatsapp-accounts.json');
      if (await fs.pathExists(legacy)) {
        try { await fs.remove(legacy); } catch (_) {}
      }
    } catch (err) {
      console.warn('⚠️ Could not load accounts meta, using defaults:', err.message);
      this.meta = { accounts: {}, activeClientId: null };
      try { await this.atomicWriteJson(this.metaPath, this.meta); } catch (_) {}
    }
  }

  async saveMeta() {
    try {
      await fs.ensureDir(this.dataDir);
      await this.atomicWriteJson(this.metaPath, this.meta);
    } catch (err) {
      console.warn('⚠️ Could not save accounts meta atomically:', err.message);
    }
  }

  /**
   * Write JSON atomically with backup/rollback.
   */
  async atomicWriteJson(targetPath, obj) {
    const dir = path.dirname(targetPath);
    const tmpPath = targetPath + '.tmp';
    const bakPath = targetPath + '.bak';
    await fs.ensureDir(dir);

    const json = JSON.stringify(obj, null, 2);
    // Write temp file and fsync
    await fs.writeFile(tmpPath, json, 'utf8');
    try {
      const fd = await nodeFs.promises.open(tmpPath, 'r+');
      try { await fd.sync(); } finally { await fd.close(); }
    } catch (_) { /* best-effort fsync */ }

    // Backup current file (best-effort)
    if (await fs.pathExists(targetPath)) {
      try { await fs.copy(targetPath, bakPath, { overwrite: true }); } catch (_) {}
    }

    // Move temp into place atomically
    await fs.move(tmpPath, targetPath, { overwrite: true });

    // Fsync directory (best-effort)
    try {
      const dfd = await nodeFs.promises.open(dir, 'r');
      try { await dfd.sync(); } finally { await dfd.close(); }
    } catch (_) { /* ignore */ }
  }

  /**
   * Clean up invalid session directories
   */
  async cleanupInvalidSessions() {
    try {
      const dirs = await fs.readdir(this.baseDir);
      const invalidDirs = dirs.filter(dir => {
        const sessionPrefixCount = (dir.match(/^session-/g) || []).length;
        return sessionPrefixCount > 1;
      });

      console.log(`🧹 Found ${invalidDirs.length} invalid session directories to clean up`);

      const cleaned = [];
      const failed = [];

      for (const dir of invalidDirs) {
        try {
          const dirPath = path.join(this.baseDir, dir);
          let retries = 3;
          
          while (retries > 0) {
            try {
              await fs.remove(dirPath);
              console.log(`🗑️ Cleaned up invalid session: ${dir}`);
              cleaned.push(dir);
              break;
            } catch (error) {
              if (error.code === 'EBUSY' && retries > 1) {
                console.log(`⚠️ Files still locked for ${dir}, retrying in 2 seconds... (${retries - 1} retries left)`);
                await new Promise(resolve => setTimeout(resolve, 2000));
                retries--;
              } else {
                throw error;
              }
            }
          }
        } catch (error) {
          console.error(`❌ Error cleaning up session ${dir}:`, error.message);
          failed.push({ dir, error: error.message });
        }
      }

      return { 
        cleaned: cleaned.length, 
        directories: cleaned,
        failed: failed.length,
        failedDirectories: failed
      };
    } catch (error) {
      console.error('❌ Error during cleanup:', error);
      return { cleaned: 0, directories: [], error: error.message };
    }
  }

  /**
   * 🚨 SOLUȚIE FINALĂ - Curățare completă doar dacă există probleme persistente
   */
  async forceCleanupIfNeeded() {
    try {
      const dirs = await fs.readdir(this.baseDir);
      
      // Verifică doar sesiunile cu probleme (multiple "session-" prefixes)
      const problematicDirs = dirs.filter(dir => {
        if (!dir.startsWith('session-')) return false;
        const sessionPrefixCount = (dir.match(/^session-/g) || []).length;
        return sessionPrefixCount > 1;
      });
      
      if (problematicDirs.length > 0) {
        console.log(`🚨 SOLUȚIE FINALĂ: Găsite ${problematicDirs.length} sesiuni problematice, aplic curățare selectivă...`);
        
        // Elimină toate procesele Chrome din nou
        await this.killAllChromeProcesses();
        
        // Așteaptă 2 secunde pentru eliberarea fișierelor
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Șterge DOAR sesiunile problematice
        for (const dir of problematicDirs) {
          try {
            const fullPath = path.join(this.baseDir, dir);
            
            // Încearcă să ștergi fișierele individual dacă folderul este blocat
            const files = await fs.readdir(fullPath);
            for (const file of files) {
              try {
                await fs.remove(path.join(fullPath, file));
              } catch (fileError) {
                console.warn(`⚠️ Nu pot șterge fișierul ${file}:`, fileError.message);
              }
            }
            
            // Încearcă să ștergi folderul
            await fs.remove(fullPath);
            console.log(`🗑️ SOLUȚIE FINALĂ: Șters complet ${dir}`);
          } catch (error) {
            console.error(`❌ SOLUȚIE FINALĂ: Nu s-a putut șterge ${dir}:`, error.message);
            
            // Ultima încercare: șterge folderul cu forță
            try {
              const fullPath = path.join(this.baseDir, dir);
              await fs.rmdir(fullPath, { recursive: true, force: true });
              console.log(`🗑️ SOLUȚIE FINALĂ: Șters cu forță ${dir}`);
            } catch (forceError) {
              console.error(`❌ SOLUȚIE FINALĂ: Eșec total la ștergerea ${dir}:`, forceError.message);
            }
          }
        }
        
        console.log(`✅ SOLUȚIE FINALĂ: Curățare selectivă finalizată - sesiunile problematice eliminate!`);
      }
    } catch (error) {
      console.error('❌ Error during force cleanup:', error);
    }
  }

  /**
   * Get all session directories (including invalid ones)
   */
  async getAllSessions() {
    try {
      const dirs = await fs.readdir(this.baseDir);
      return dirs.map(dir => ({
        name: dir,
        isValid: (dir.match(/^session-/g) || []).length <= 1,
        path: path.join(this.baseDir, dir)
      }));
    } catch (error) {
      console.error('❌ Error listing sessions:', error);
      return [];
    }
  }

  /**
   * 🧨 Șterge TOATE sesiunile (Stop + remove) - folosit de "Șterge Tot"
   */
  async removeAllSessions() {
    try {
      const ids = Object.keys(this.clients);
      for (const id of ids) {
        try { await this.stopClient(id); } catch {}
      }
      await this.killAllChromeProcesses();
      const dirs = await fs.readdir(this.baseDir);
      for (const dir of dirs) {
        const fullPath = path.join(this.baseDir, dir);
        try { await fs.remove(fullPath); } catch (e) { console.warn('⚠️ Remove failed for', dir, e.message); }
      }
      this.clients = {};
      this.activeClientId = null;
      this.meta = { accounts: {}, activeClientId: null };
      await this.saveMeta();
      this.emit('accountsChanged');
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  // =============================
  // Reconnect/backoff helpers
  // =============================
  computeBackoffMs(attempt) {
    const base = 1000; // 1s
    const cap = 30000; // 30s
    const exp = Math.min(cap, base * Math.pow(2, Math.max(0, attempt - 1)));
    const jitter = Math.floor(exp * (0.2 * Math.random())); // +/-20%
    return Math.max(1000, exp - jitter);
  }

  resetReconnect(id) {
    const key = this.normalizeSessionId(id);
    const info = this.reconnectInfo[key];
    if (info && info.timer) clearTimeout(info.timer);
    this.reconnectInfo[key] = { attempts: 0, timer: null };
  }

  scheduleReconnect(id) {
    const key = this.normalizeSessionId(id);
    if (!this.reconnectInfo[key]) this.reconnectInfo[key] = { attempts: 0, timer: null };
    const info = this.reconnectInfo[key];
    if (info.timer) return; // already scheduled
    info.attempts += 1;
    const delay = this.computeBackoffMs(info.attempts);
    console.log(`🔁 Reconnect ${key} in ${Math.round(delay/1000)}s (attempt ${info.attempts})`);
    info.timer = setTimeout(async () => {
      info.timer = null;
      try {
        await this.reinitClient(key);
      } catch (e) {
        console.warn(`⚠️ Reinit failed for ${key}:`, e.message);
        this.scheduleReconnect(key);
      }
    }, delay);
  }

  async reinitClient(id) {
    const key = this.normalizeSessionId(id);
    try {
      // Hard re-init: stop + kill procs + load
      if (this.clients[key]) {
        try { await this.stopClient(key); } catch {}
      }
      await this.killChromeProcesses(key);
      await this.loadClient(key);
      // Watchdog will restart if still stuck
    } catch (e) {
      throw e;
    }
  }

  // ♻️ Reinit Light -> QR, apoi fallback Hard
  async regenerateQR(id, options = {}) {
    const key = this.normalizeSessionId(id);
    const lightWaitMs = options.lightWaitMs || 5000;
    const hardWaitMs = options.hardWaitMs || 10000;
    return await this.withLock(key, async () => {
      // Light reinit: stop soft + reload fără killAll
      try { await this.stopClientSoft(key); } catch (_) {}
      try { await this.loadClient(key); } catch (_) {}
      try {
        const qrLight = await this.waitForQR(key, lightWaitMs);
        if (qrLight) return qrLight;
      } catch (_) {}

      // Fallback Hard: omoară procese Chrome și relansează
      try { await this.killChromeProcesses(key); } catch (_) {}
      try { await this.loadClient(key); } catch (_) {}
      try {
        const qrHard = await this.waitForQR(key, hardWaitMs);
        return qrHard || null;
      } catch (_) {
        return null;
      }
    });
  }

  // =============================
  // Init watchdogs
  // =============================
  startInitWatchdog(id, timeoutMs) {
    const key = this.normalizeSessionId(id);
    this.clearInitWatchdog(key);
    this.initWatchdogs[key] = setTimeout(async () => {
      try {
        const client = this.clients[key];
        if (!client) return;
        const hasProgress = client.status?.connected || !!client.status?.qr;
        if (hasProgress) return; // QR or ready already
        console.warn(`⏰ Init watchdog triggered for ${key}, reinitializing...`);
        await this.reinitClient(key);
      } catch (e) {
        console.warn(`⚠️ Watchdog reinit failed for ${key}:`, e.message);
        this.scheduleReconnect(key);
      }
    }, timeoutMs);
  }

  clearInitWatchdog(id) {
    const key = this.normalizeSessionId(id);
    if (this.initWatchdogs[key]) {
      clearTimeout(this.initWatchdogs[key]);
      delete this.initWatchdogs[key];
    }
  }

  /**
   * 🔥 Eliminare agresivă a TUTUROR proceselor Chrome - SOLUȚIE FINALĂ
   */
  async killAllChromeProcesses() {
    const { exec, spawn } = require('child_process');
    const util = require('util');
    const execAsync = util.promisify(exec);

    console.log(`🔥 Eliminare AGRESIVĂ a tuturor proceselor Chrome...`);
    
    try {
      // SOLUȚIA FINALĂ: Folosește comenzi native Node.js
      const commands = [
        // Metoda 1: Node.js direct cu spawn (cross-platform)
        () => this.killProcessesByPattern('chrome'),
        // Metoda 2: Node.js direct cu spawn pentru chrome.exe
        () => this.killProcessesByPattern('chrome.exe'),
        // Metoda 3: Node.js direct cu spawn pentru chromium
        () => this.killProcessesByPattern('chromium'),
        // Metoda 4: Fallback la comenzi sistem (dacă sunt disponibile)
        () => execAsync('taskkill /F /IM chrome.exe /T').catch(() => {}),
        () => execAsync('pkill -f chrome').catch(() => {}),
        () => execAsync('killall chrome').catch(() => {})
      ];

      let success = false;
      for (const command of commands) {
        try {
          await command();
          console.log(`✅ Procese Chrome eliminate cu metoda nativă`);
          success = true;
          break;
        } catch (cmdError) {
          console.log(`⚠️ Metodă eliminare procese a eșuat:`, cmdError.message);
          continue;
        }
      }
      
      if (success) {
        console.log(`✅ TOATE procesele Chrome au fost eliminate!`);
        return true;
      } else {
        console.warn(`⚠️ Nu s-au putut elimina procesele Chrome cu nicio metodă`);
        return false;
      }
    } catch (error) {
      console.warn(`⚠️ Avertisment eliminare procese Chrome:`, error.message);
      return false;
    }
  }

  /**
   * 🗑️ Ștergere sigură a unui director
   */
  async removeDirectorySafely(dirPath) {
    await fs.remove(dirPath);
  }

  /**
   * 🗑️ Ștergere parțială a unui director (ignorând fișierele blocate)
   */
  async removeDirectoryPartially(dirPath) {
    try {
      const items = await fs.readdir(dirPath);
      
      for (const item of items) {
        const itemPath = path.join(dirPath, item);
        const stat = await fs.stat(itemPath);
        
        if (stat.isDirectory()) {
          // Recursiv pentru subdirectoare
          await this.removeDirectoryPartially(itemPath);
        } else {
          // Încearcă să ștergi fișierul
          try {
            await fs.unlink(itemPath);
          } catch (error) {
            // Ignoră fișierele blocate (chrome_debug.log, etc.)
            if (error.code === 'EBUSY' || error.code === 'EPERM') {
              console.warn(`⚠️ Ignorând fișierul blocat: ${item}`);
            } else {
              throw error;
            }
          }
        }
      }
      
      // Încearcă să ștergi directorul gol
      try {
        await fs.rmdir(dirPath);
      } catch (error) {
        if (error.code === 'ENOTEMPTY') {
          console.warn(`⚠️ Directorul ${dirPath} nu este gol, dar am șters ce am putut`);
        } else {
          throw error;
        }
      }
    } catch (error) {
      console.warn(`⚠️ Eroare la ștergerea parțială a ${dirPath}:`, error.message);
    }
  }

  /**
   * 🔫 Eliminare procese prin pattern - SOLUȚIE NATIVĂ
   */
  async killProcessesByPattern(pattern) {
    return new Promise((resolve, reject) => {
      const { spawn } = require('child_process');
      
      // Detectează sistemul de operare
      const isWindows = process.platform === 'win32';
      
      let command, args;
      if (isWindows) {
        // Windows: folosește wmic pentru a găsi și elimina procese
        command = 'wmic';
        args = ['process', 'where', `name like '%${pattern}%'`, 'delete'];
      } else {
        // Linux/Mac: folosește pkill
        command = 'pkill';
        args = ['-f', pattern];
      }
      
      // CORECTARE: Folosește nume diferit pentru a evita conflictul cu process global
      const childProcess = spawn(command, args, { 
        stdio: 'pipe',
        shell: true 
      });
      
      childProcess.on('close', (code) => {
        if (code === 0 || code === 1) { // 0 = success, 1 = no processes found
          resolve();
        } else {
          reject(new Error(`Process kill failed with code ${code}`));
        }
      });
      
      childProcess.on('error', (error) => {
        reject(error);
      });
      
      // Timeout de 5 secunde
      setTimeout(() => {
        childProcess.kill();
        resolve(); // Consideră că a reușit dacă nu s-a terminat în 5 secunde
      }, 5000);
    });
  }
}

module.exports = new MultiClientManager();
