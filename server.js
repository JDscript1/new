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

// Base dir = project root (one level above this file)
const baseDir = path.resolve(__dirname, '..');

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

// Static from project root public
app.use(express.static(path.join(baseDir, 'public')));

// Explicit root route
app.get('/', (req, res) => {
  res.sendFile(path.join(baseDir, 'public', 'index.html'));
});

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


