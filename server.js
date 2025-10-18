// Railway-dedicated server that runs from the Railway subdirectory

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const path = require('path');
const http = require('http');
const fs = require('fs');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const sgMail = require('@sendgrid/mail');
const crypto = require('crypto');

// Base dir = this Railway subdirectory (self-contained deploy)
const baseDir = __dirname;
const dataDir = path.join(baseDir, 'data');

// Optional WhatsApp services (ignored if missing)
try {
  require(path.join(baseDir, 'server', 'whatsappLinkService'));
  require(path.join(baseDir, 'server', 'multiClientManager'));
  console.log('📱 WhatsApp services loaded successfully');
} catch (_) {
  console.log('⚠️ WhatsApp services not available - running in basic mode');
  console.log('📱 WhatsApp features will be disabled');
}

const app = express();
const PORT = process.env.PORT || 3001;
app.locals.isReady = false;

// Email configuration: prefer SendGrid, fallback to Gmail SMTP
let emailService = 'fallback';
let transporter = null;

if (process.env.SENDGRID_API_KEY) {
  sgMail.setApiKey(process.env.SENDGRID_API_KEY);
  emailService = 'sendgrid';
  console.log('📧 SendGrid configurat pentru email-uri reale (Railway)');
} else if (process.env.SMTP_USER && process.env.SMTP_PASS) {
  transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  });
  emailService = 'gmail';
  console.log('📧 Gmail SMTP configurat pentru email-uri reale');
} else {
  console.log('⚠️ Nici SendGrid, nici Gmail SMTP nu sunt configurate - folosesc fallback');
  console.log('📧 Pentru Railway, recomand SendGrid: https://sendgrid.com/free/');
}

// JWT
const JWT_SECRET = process.env.JWT_SECRET || 'mega-trucking-secret-key-2025';

// Reset tokens storage (in-memory)
const resetTokens = new Map();

// Users store
const usersFile = path.join(baseDir, 'data', 'users.json');

function loadUsers() {
  try {
    if (fs.existsSync(usersFile)) {
      return JSON.parse(fs.readFileSync(usersFile, 'utf8'));
    }
  } catch (error) {
    console.error('Eroare la încărcarea utilizatorilor:', error);
  }

  return {
    'ionut.tudor003@gmail.com': {
      email: 'ionut.tudor003@gmail.com',
      password: 'MegaTrucking2025!',
      firstName: 'Ionut',
      lastName: 'Tudor',
      role: 'admin',
      isVerified: true
    }
  };
}

function saveUsers(users) {
  try {
    fs.mkdirSync(path.dirname(usersFile), { recursive: true });
    fs.writeFileSync(usersFile, JSON.stringify(users, null, 2));
    return true;
  } catch (error) {
    console.error('Eroare la salvarea utilizatorilor:', error);
    return false;
  }
}

let users = loadUsers();

// Middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://cdnjs.cloudflare.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com", "https://cdnjs.cloudflare.com", "https:"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'", "ws:", "wss:", "https://cdn.jsdelivr.net"]
    }
  }
}));
app.use(cors());
app.use(compression());
app.use(morgan('combined'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Static from Railway/public
app.use(express.static(path.join(baseDir, 'public')));

// Explicit root route
app.get('/', (req, res) => {
  res.sendFile(path.join(baseDir, 'public', 'index.html'));
});

// ============================
// Data helpers (drivers / racks)
// ============================
function loadJson(filePath, fallback) {
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    }
  } catch (e) {
    console.error(`Eroare la încărcarea ${filePath}:`, e.message);
  }
  return fallback;
}

function saveJson(filePath, data) {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    return true;
  } catch (e) {
    console.error(`Eroare la salvarea ${filePath}:`, e.message);
    return false;
  }
}

const driversFile = path.join(dataDir, 'drivers.json');
const racksFile = path.join(dataDir, 'racks.json');

let drivers = loadJson(driversFile, []);
let racks = loadJson(racksFile, null);
if (!Array.isArray(racks) || racks.length === 0) {
  // Generează 1000 de poziții implicite
  racks = Array.from({ length: 1000 }, (_, i) => ({
    positionNumber: i + 1,
    status: 'liber',
    driver: null
  }));
}

function reconcileRacksWithDrivers() {
  // Resetă stările rack-urilor
  for (const r of racks) {
    r.status = 'liber';
    r.driver = null;
  }
  // Marchează ocupate conform șoferilor
  for (const d of drivers) {
    const pos = parseInt(d.rackPosition, 10);
    if (Number.isInteger(pos) && pos >= 1 && pos <= racks.length) {
      const r = racks[pos - 1];
      r.status = 'ocupat';
      r.driver = {
        id: d.id || undefined,
        firstName: d.firstName,
        lastName: d.lastName,
        carNumber: d.carNumber
      };
    }
  }
}

function computeRackStatistics() {
  reconcileRacksWithDrivers();
  const liber = racks.filter(r => r.status === 'liber').length;
  const ocupat = racks.filter(r => r.status === 'ocupat').length;
  return {
    racks: { total: racks.length, liber, ocupat, sosire_apropiata: 0 },
    drivers: { total: drivers.length }
  };
}

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    code: 'HEALTH_OK',
    cid: crypto.randomBytes(8).toString('hex'),
    status: 'OK',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    emailService
  });
});

// ============================
// Auth - refresh token
// ============================
app.post('/api/auth/refresh-token', (req, res) => {
  const { refreshToken } = req.body || {};
  if (!refreshToken) return res.status(400).json({ success: false, message: 'Lipsește refreshToken' });
  // Acceptăm orice string (demo) și generăm token nou
  const demoUser = drivers && drivers[0] ? drivers[0] : { email: 'admin@megatrucking.ro', role: 'admin' };
  const accessToken = jwt.sign({ email: demoUser.email || 'admin@megatrucking.ro', role: demoUser.role || 'admin' }, JWT_SECRET, { expiresIn: '24h' });
  return res.json({ success: true, tokens: { accessToken, refreshToken } });
});

// ============================
// Drivers minimal API
// ============================
app.get('/api/drivers', (req, res) => {
  try { res.setHeader('Cache-Control', 'no-store'); } catch (_) {}
  drivers = loadJson(driversFile, drivers);
  res.json({ drivers });
});

app.post('/api/drivers', (req, res) => {
  try { res.setHeader('Cache-Control', 'no-store'); } catch (_) {}
  const body = req.body || {};
  drivers = loadJson(driversFile, drivers);
  const id = body.id || crypto.randomBytes(6).toString('hex');
  const driver = { id, ...body };
  drivers.push(driver);
  saveJson(driversFile, drivers);
  reconcileRacksWithDrivers();
  res.status(201).json({ success: true, driver, code: 'DRIVER_CREATED' });
});

app.get('/api/drivers/:id', (req, res) => {
  drivers = loadJson(driversFile, drivers);
  const driver = drivers.find(d => String(d.id) === String(req.params.id));
  if (!driver) return res.status(404).json({ success: false, message: 'Driver not found' });
  res.json({ success: true, driver });
});

app.put('/api/drivers/:id', (req, res) => {
  drivers = loadJson(driversFile, drivers);
  const idx = drivers.findIndex(d => String(d.id) === String(req.params.id));
  if (idx === -1) return res.status(404).json({ success: false, message: 'Driver not found' });
  const prev = drivers[idx];
  const updated = { ...prev, ...req.body };
  drivers[idx] = updated;
  saveJson(driversFile, drivers);
  reconcileRacksWithDrivers();
  res.json({ success: true, driver: updated, code: 'DRIVER_UPDATED' });
});

app.delete('/api/drivers/:id', (req, res) => {
  drivers = loadJson(driversFile, drivers);
  const before = drivers.length;
  drivers = drivers.filter(d => String(d.id) !== String(req.params.id));
  if (drivers.length === before) return res.status(404).json({ success: false, message: 'Driver not found' });
  saveJson(driversFile, drivers);
  reconcileRacksWithDrivers();
  res.json({ success: true, code: 'DRIVER_DELETED' });
});

app.post('/api/drivers/:id/release', (req, res) => {
  // Eliberează poziția de raft asociată șoferului
  drivers = loadJson(driversFile, drivers);
  const driver = drivers.find(d => String(d.id) === String(req.params.id));
  if (!driver) return res.status(404).json({ success: false, message: 'Driver not found' });
  driver.rackPosition = null;
  saveJson(driversFile, drivers);
  reconcileRacksWithDrivers();
  res.json({ success: true, driver, code: 'DRIVER_RELEASED' });
});

app.post('/api/drivers/:id/send-reminder', (req, res) => {
  // Stub: trimite reminder (log only)
  console.log(`📨 Reminder requested for driver ${req.params.id}`);
  res.json({ success: true, code: 'REMINDER_SENT' });
});

// ============================
// Racks minimal API
// ============================
app.get('/api/racks', (req, res) => {
  try { res.setHeader('Cache-Control', 'no-store'); } catch (_) {}
  // Reload from disk if present
  const fileRacks = loadJson(racksFile, null);
  if (Array.isArray(fileRacks) && fileRacks.length) racks = fileRacks;
  reconcileRacksWithDrivers();
  const { status } = req.query || {};
  let result = racks;
  if (status) result = racks.filter(r => r.status === status);
  res.json({ racks: result, pagination: { page: 1, limit: result.length, total: result.length, pages: 1 } });
});

app.get('/api/racks/statistics', (req, res) => {
  try { res.setHeader('Cache-Control', 'no-store'); } catch (_) {}
  const statistics = computeRackStatistics();
  res.json({ statistics });
});

app.get('/api/racks/available', (req, res) => {
  reconcileRacksWithDrivers();
  const available = racks.filter(r => r.status === 'liber');
  res.json({ racks: available, count: available.length });
});

app.get('/api/racks/position/:positionNumber', (req, res) => {
  const pos = parseInt(req.params.positionNumber, 10);
  if (!Number.isInteger(pos) || pos < 1 || pos > racks.length) return res.status(404).json({ message: 'RACK_NOT_FOUND' });
  reconcileRacksWithDrivers();
  res.json({ rack: racks[pos - 1] });
});

app.post('/api/racks/:positionNumber/release', (req, res) => {
  const pos = parseInt(req.params.positionNumber, 10);
  if (!Number.isInteger(pos) || pos < 1 || pos > racks.length) return res.status(404).json({ success: false, message: 'RACK_NOT_FOUND' });
  // Eliberează și șoferul care ocupă poziția
  drivers = loadJson(driversFile, drivers);
  drivers = drivers.map(d => (parseInt(d.rackPosition, 10) === pos ? { ...d, rackPosition: null } : d));
  saveJson(driversFile, drivers);
  reconcileRacksWithDrivers();
  res.json({ success: true, rack: racks[pos - 1], code: 'RACK_RELEASED' });
});

app.put('/api/racks/:positionNumber/status', (req, res) => {
  const pos = parseInt(req.params.positionNumber, 10);
  const { status } = req.body || {};
  if (!Number.isInteger(pos) || pos < 1 || pos > racks.length) return res.status(404).json({ success: false, message: 'RACK_NOT_FOUND' });
  if (!status) return res.status(400).json({ success: false, message: 'Missing status' });
  racks[pos - 1].status = status;
  // Persist racks file
  saveJson(racksFile, racks);
  res.json({ success: true, rack: racks[pos - 1], code: 'RACK_STATUS_UPDATED' });
});

app.get('/api/racks/:positionNumber/history', (req, res) => {
  const pos = parseInt(req.params.positionNumber, 10);
  if (!Number.isInteger(pos) || pos < 1 || pos > racks.length) return res.status(404).json({ success: false, message: 'RACK_NOT_FOUND' });
  res.json({ success: true, position: pos, history: [] });
});

// ============================
// Metrics API (simplificat pentru dashboard)
// ============================
app.get('/api/metrics', (req, res) => {
  reconcileRacksWithDrivers();
  const occupied = racks.filter(r => r.status === 'ocupat').length;
  const free = racks.length - occupied;
  const active = drivers.filter(d => !!d.rackPosition).length;
  res.json({
    racks: { occupied, released: 0, transfers: 0, free },
    drivers: { active, total: drivers.length },
    timestamp: new Date().toISOString()
  });
});

// ============================
// SSE endpoints (app + whatsapp)
// ============================
const appSseClients = new Set();
app.get('/api/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders && res.flushHeaders();
  appSseClients.add(res);
  res.write(`event: ready\n`);
  res.write(`data: {"ok":true}\n\n`);
  const keep = setInterval(() => {
    if (res.writableEnded) return clearInterval(keep);
    res.write(`event: ping\n`);
    res.write(`data: {"ts":"${new Date().toISOString()}"}\n\n`);
  }, 25000);
  req.on('close', () => { clearInterval(keep); appSseClients.delete(res); });
});

// WhatsApp: integrează serviciile reale dacă modulele sunt disponibile
let waLinkService = null;
let waMultiManager = null;
try {
  waLinkService = require(path.join(baseDir, 'server', 'whatsappLinkService.js'));
  const MultiManager = require(path.join(baseDir, 'server', 'multiClientManager.js'));
  waMultiManager = MultiManager;
  // Initializează managerul
  try { waMultiManager.init?.(); } catch(_) {}
} catch (_) {
  console.log('⚠️ WhatsApp real services not available in Railway build - falling back to stubs');
}

const waSseClients = new Set();
app.get('/api/whatsapp/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders && res.flushHeaders();
  waSseClients.add(res);
  res.write(`event: ready\n`);
  res.write(`data: {"connected":false}\n\n`);
  const keep = setInterval(() => {
    if (res.writableEnded) return clearInterval(keep);
    res.write(`event: ping\n`);
    res.write(`data: {"ts":"${new Date().toISOString()}"}\n\n`);
  }, 25000);
  req.on('close', () => { clearInterval(keep); waSseClients.delete(res); });
});

// ============================
// WhatsApp endpoints (real if available, otherwise graceful responses)
// ============================
app.get('/api/whatsapp/status', async (req, res) => {
  try {
    if (waLinkService) {
      const svc = new waLinkService();
      await svc.initialize().catch(()=>{});
      const st = await svc.checkConnection();
      return res.json({
        isReady: st.connected,
        isConnected: st.connected,
        message: st.message,
        qrCode: st.qrCode,
        qrDataUrl: st.qrDataUrl,
        initializing: st.initializing
      });
    }
  } catch (_) {}
  return res.json({ isReady: false, isConnected: false, message: 'Disabled', qrCode: null, qrDataUrl: null, initializing: false });
});

app.get('/api/whatsapp/health', async (req, res) => {
  try {
    if (waMultiManager) {
      const accounts = await waMultiManager.listAccounts();
      const active = waMultiManager.getActiveClientId();
      const activeClient = waMultiManager.getActiveClient();
      const isConnected = !!(activeClient && activeClient.status && activeClient.status.connected);
      const hasQR = !!(activeClient && activeClient.status && activeClient.status.qr);
      return res.json({ activeClientId: active, connected: isConnected, hasQR, accounts });
    }
  } catch (_) {}
  return res.json({ activeClientId: null, connected: false, hasQR: false, accounts: [] });
});

app.get('/api/whatsapp/accounts', async (req, res) => {
  try { return res.json({ accounts: waMultiManager ? await waMultiManager.listAccounts() : [] }); } catch (_) { return res.json({ accounts: [] }); }
});

app.post('/api/whatsapp/add', async (req, res) => {
  const { id } = req.body || {};
  if (!waMultiManager) return res.json({ success: false, code: 'WA_DISABLED' });
  await waMultiManager.addClient(id || 'default');
  res.json({ success: true });
});

app.delete('/api/whatsapp/remove', async (req, res) => {
  const { id } = req.body || {};
  if (!waMultiManager) return res.json({ success: false, code: 'WA_DISABLED' });
  const result = await waMultiManager.removeClient(id || 'default');
  res.json({ success: !!result });
});

app.post('/api/whatsapp/switch', async (req, res) => {
  const { id } = req.body || {};
  if (!waMultiManager) return res.json({ success: false, code: 'WA_DISABLED' });
  await waMultiManager.switchClient(id || 'default');
  res.json({ success: true });
});

app.post('/api/whatsapp/regenerate', async (req, res) => {
  const { id } = req.body || {};
  if (!waMultiManager) return res.json({ success: false, code: 'WA_DISABLED' });
  const qr = await waMultiManager.regenerateQR(id || 'default', {});
  res.json({ success: !!qr, qr });
});

app.post('/api/whatsapp/cleanup-invalid', async (req, res) => {
  if (!waMultiManager) return res.json({ success: false, code: 'WA_DISABLED' });
  const result = await waMultiManager.cleanupInvalidSessions();
  res.json({ success: true, result });
});

app.post('/api/whatsapp/cleanup-all', async (req, res) => {
  if (!waMultiManager) return res.json({ success: false, code: 'WA_DISABLED' });
  const result = await waMultiManager.removeAllSessions();
  res.json({ success: !!(result && result.ok), result });
});

app.post('/api/whatsapp/force-cleanup', async (req, res) => {
  if (!waMultiManager) return res.json({ success: false, code: 'WA_DISABLED' });
  await waMultiManager.killAllChromeProcesses();
  res.json({ success: true });
});

app.get('/api/whatsapp/contacts', async (req, res) => {
  if (!waMultiManager) return res.json({ contacts: [] });
  const active = waMultiManager.getActiveClient();
  if (!active || !active.status.connected) return res.json({ contacts: [] });
  try { const contacts = await active.getContacts(); return res.json({ contacts }); } catch { return res.json({ contacts: [] }); }
});


// Login
app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  const user = users[email];
  if (user && user.password === password) {
    const token = jwt.sign({ email: user.email, role: user.role }, JWT_SECRET, { expiresIn: '24h' });
    return res.json({
      success: true,
      message: 'Autentificare reușită',
      user: { id: 1, email: user.email, firstName: user.firstName, lastName: user.lastName, role: user.role },
      tokens: { accessToken: token, refreshToken: 'demo_refresh_token' },
      code: 'LOGIN_SUCCESS'
    });
  }
  return res.status(401).json({ success: false, message: 'Email sau parolă incorectă' });
});

// Forgot password
app.post('/api/auth/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ success: false, message: 'Adresa de email este obligatorie' });
    if (!users[email]) return res.status(404).json({ success: false, message: 'Adresa de email nu este înregistrată în sistem' });

    const resetToken = crypto.randomBytes(32).toString('hex');
    const tokenExpiry = new Date(Date.now() + 3600000);
    resetTokens.set(resetToken, { email, expires: tokenExpiry, used: false });

    const resetLink = `${req.protocol}://${req.get('host')}/reset-password.html?token=${resetToken}`;
    console.log(`📧 Reset password requested for: ${email}`);
    console.log(`🔗 Reset link: ${resetLink}`);
    console.log(`📧 Email service: ${emailService}`);

    if (emailService === 'sendgrid') {
      const msg = {
        to: email,
        from: { email: process.env.SENDER_EMAIL || 'noreply@megatrucking.ro', name: 'MEGA TRUCKING TIMIȘOARA' },
        subject: 'Resetare Parolă - MEGA TRUCKING TIMIȘOARA',
        html: `<p>Salut ${users[email].firstName},</p><p>Apasă pe link pentru resetare parolă:</p><p><a href="${resetLink}">${resetLink}</a></p>`
      };
      await sgMail.send(msg);
      return res.json({ success: true, message: 'Link de resetare parolă trimis cu succes! Verifică-ți inbox-ul.', code: 'RESET_EMAIL_SENT' });
    }

    if (emailService === 'gmail' && transporter) {
      await transporter.sendMail({
        from: { name: 'MEGA TRUCKING TIMIȘOARA', address: process.env.SMTP_USER },
        to: email,
        subject: 'Resetare Parolă - MEGA TRUCKING TIMIȘOARA',
        html: `<p>Salut ${users[email].firstName},</p><p>Apasă pe link pentru resetare parolă:</p><p><a href="${resetLink}">${resetLink}</a></p>`
      });
      return res.json({ success: true, message: 'Link de resetare parolă trimis cu succes! Verifică-ți inbox-ul.', code: 'RESET_EMAIL_SENT' });
    }

    const isProduction = (process.env.NODE_ENV || '').toLowerCase() === 'production';
    if (isProduction) {
      console.error('❌ Email service nu este configurat în producție. Setează SMTP_USER/SMTP_PASS (App Password) sau SENDGRID_API_KEY.');
      return res.status(500).json({ success: false, message: 'Serviciul de email nu este configurat. Te rugăm să încerci mai târziu sau să contactezi administratorul.', code: 'EMAIL_SERVICE_NOT_CONFIGURED' });
    }

    // Dev fallback: show link
    return res.json({ success: true, message: 'Link de resetare generat (dezvoltare)', resetLink, code: 'RESET_LINK_GENERATED' });
  } catch (error) {
    console.error('❌ Eroare la resetarea parolei:', error);
    return res.status(500).json({ success: false, message: 'A apărut o eroare la procesarea cererii.', code: 'INTERNAL_ERROR' });
  }
});

// Verify token
app.get('/api/auth/verify-reset-token/:token', (req, res) => {
  const { token } = req.params;
  const tokenData = resetTokens.get(token);
  if (!tokenData) return res.status(404).json({ success: false, message: 'Token-ul nu este valid sau a expirat' });
  if (tokenData.used) return res.status(400).json({ success: false, message: 'Token-ul a fost deja folosit' });
  if (new Date() > tokenData.expires) { resetTokens.delete(token); return res.status(400).json({ success: false, message: 'Token-ul a expirat' }); }
  return res.json({ success: true, email: tokenData.email });
});

// Reset password
app.post('/api/auth/reset-password', (req, res) => {
  try {
    const { token, newPassword } = req.body;
    if (!token || !newPassword) return res.status(400).json({ success: false, message: 'Token-ul și parola nouă sunt obligatorii' });
    if (newPassword.length < 6) return res.status(400).json({ success: false, message: 'Parola trebuie să aibă cel puțin 6 caractere' });
    const tokenData = resetTokens.get(token);
    if (!tokenData) return res.status(404).json({ success: false, message: 'Token-ul nu este valid sau a expirat' });
    if (tokenData.used) return res.status(400).json({ success: false, message: 'Token-ul a fost deja folosit' });
    if (new Date() > tokenData.expires) { resetTokens.delete(token); return res.status(400).json({ success: false, message: 'Token-ul a expirat' }); }
    tokenData.used = true; resetTokens.set(token, tokenData);
    users[tokenData.email].password = newPassword;
    const saved = saveUsers(users);
    if (!saved) return res.status(500).json({ success: false, message: 'A apărut o eroare la salvarea parolei.' });
    return res.json({ success: true, message: 'Parola a fost resetată cu succes! Poți să te loghezi cu noua parolă.' });
  } catch (error) {
    console.error('❌ Eroare la resetarea parolei:', error);
    return res.status(500).json({ success: false, message: 'A apărut o eroare la procesarea cererii.' });
  }
});

// Start server
const server = http.createServer(app);
server.listen(PORT, () => {
  console.log('🚛 ===========================================');
  console.log('🚛 MEGA TRUCKING TIMIȘOARA - PRODUCTION SERVER');
  console.log('🚛 ===========================================');
  console.log(`🌐 Server running on port ${PORT}`);
  console.log(`🔗 URL: http://localhost:${PORT}`);
  console.log(`📊 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`⏰ Started at: ${new Date().toLocaleString('ro-RO')}`);
  console.log('🚛 ===========================================');
  console.log('📝 Utilizatori disponibili:');
  console.log('   - ionut.tudor003@gmail.com');
  console.log('🚛 ===========================================');
  console.log(`📧 Email service: ${emailService}`);
  console.log('🚛 ===========================================');
  console.log('📱 WhatsApp Link Service: Ready');
  console.log('🚛 ===========================================');
  app.locals.isReady = true;
});

module.exports = app;


