const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const fs = require('fs');
const path = require('path');

class WhatsAppLinkService {
  constructor() {
    this.client = null;
    this.isConnected = false;
    this.isInitialized = false;
    this.qrCode = null;
    this.qrDataUrl = null; // Base64 PNG for frontend
    this.connectionAttempts = 0;
    this.maxConnectionAttempts = 3;
    this.statusCache = null;
    this.cacheTimeout = 5000; // 5 seconds
    this.clientInitializing = false;
  }

  /**
   * Initialize WhatsApp Link Service
   */
  async initialize() {
    if (this.isInitialized) {
      return { success: true, message: 'WhatsApp Link Service already initialized' };
    }

    try {
      // Initializing WhatsApp Link Service
      
      // Clean up existing client
      if (this.client) {
        try { 
          await this.client.destroy(); 
        } catch(e) {}
        this.client = null;
        this.isConnected = false;
      }
      
      this.clientInitializing = true;
      const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH || 'chromium';
      this.client = new Client({
        authStrategy: new LocalAuth({
          clientId: 'car-key-manager'
        }),
        puppeteer: {
          headless: true,
          executablePath,
          args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--disable-gpu'
          ]
        }
      });

      this.client.on('qr', async (qr) => {
        this.qrCode = qr;
        // Generate dataURL PNG for frontend
        try {
          const dataUrl = await qrcode.toDataURL(qr, { errorCorrectionLevel: 'H' });
          this.qrDataUrl = dataUrl;
        } catch (e) {
          console.error('❌ QR DataURL generation error:', e);
        }
        this.statusCache = null; // Clear cache when QR changes
      });

      this.client.on('ready', async () => {
        console.log('📱 WhatsApp Link client is ready!');
        
        // Verify connection by checking if we can get client info
        try {
          const clientInfo = await this.client.getState();
          
          if (clientInfo === 'CONNECTED') {
            this.isConnected = true;
            this.qrCode = null;
            this.qrDataUrl = null;
            this.clientInitializing = false;
            this.statusCache = null; // Clear cache when connected
            console.log('✅ WhatsApp Link fully connected and verified');
          } else {
            this.isConnected = false;
          }
        } catch (error) {
          console.error('❌ Error verifying WhatsApp connection:', error);
          this.isConnected = false;
        }
      });

      this.client.on('authenticated', () => {
        // WhatsApp Link authenticated successfully
      });

      this.client.on('auth_failure', (msg) => {
        console.error('❌ WhatsApp Link authentication failed:', msg);
        this.isConnected = false;
        this.qrCode = null;
        this.qrDataUrl = null;
        this.clientInitializing = false;
        this.statusCache = null;
      });

      this.client.on('disconnected', (reason) => {
        this.isConnected = false;
        this.qrCode = null;
        this.qrDataUrl = null;
        this.clientInitializing = false;
        this.statusCache = null;
      });

      await this.client.initialize();
      this.isInitialized = true;
      
      return { success: true, message: 'WhatsApp Link Service initialized successfully' };
    } catch (error) {
      console.error('❌ Error initializing WhatsApp Link Service:', error);
      this.isInitialized = false;
      this.clientInitializing = false;
      return { success: false, message: 'Failed to initialize WhatsApp Link Service: ' + error.message };
    }
  }

  /**
   * Check WhatsApp Link connection status
   */
  async checkConnection() {
    // Return cached status if still valid
    if (this.statusCache && (Date.now() - this.statusCache.timestamp) < this.cacheTimeout) {
      return this.statusCache;
    }

    let status = {
      connected: false,
      message: 'WhatsApp Link nu este conectat',
      qrCode: null,
      qrDataUrl: null,
      initializing: this.clientInitializing,
      timestamp: new Date().toISOString()
    };

    if (this.client && this.isConnected) {
      // Verify real connection status
      try {
        const clientState = await this.client.getState();
        const realConnected = (clientState === 'CONNECTED');
        
        if (realConnected) {
          status = {
            connected: true,
            message: 'WhatsApp Link este conectat și gata de utilizare',
            qrCode: null,
            qrDataUrl: null,
            initializing: false,
            timestamp: new Date().toISOString()
          };
        } else {
          console.log('⚠️ WhatsApp client state mismatch, updating connection status');
          this.isConnected = false;
          status = {
            connected: false,
            message: 'WhatsApp Link nu este complet conectat',
            qrCode: this.qrCode,
            qrDataUrl: this.qrDataUrl,
            initializing: this.clientInitializing,
            timestamp: new Date().toISOString()
          };
        }
      } catch (error) {
        console.error('❌ Error checking WhatsApp client state:', error);
        this.isConnected = false;
        status = {
          connected: false,
          message: 'Eroare la verificarea conexiunii WhatsApp',
          qrCode: this.qrCode,
          qrDataUrl: this.qrDataUrl,
          initializing: this.clientInitializing,
          timestamp: new Date().toISOString()
        };
      }
    } else if (this.qrDataUrl) {
      status = {
        connected: false,
        message: 'Scan QR Code pentru a conecta WhatsApp Link',
        qrCode: this.qrCode,
        qrDataUrl: this.qrDataUrl,
        initializing: this.clientInitializing,
        timestamp: new Date().toISOString()
      };
    } else if (this.clientInitializing) {
      status = {
        connected: false,
        message: 'WhatsApp Link se inițializează...',
        qrCode: null,
        qrDataUrl: null,
        initializing: true,
        timestamp: new Date().toISOString()
      };
    }

    // Cache the status
    this.statusCache = status;
    return status;
  }

  /**
   * Send WhatsApp message
   */
  async sendMessage(phoneNumber, message) {
    if (!this.client || !this.isConnected) {
      throw new Error('WhatsApp Link client is not ready');
    }

    try {
      // Normalize phone number
      const number = phoneNumber.replace(/\D/g, '');
      const chatId = number + '@c.us';
      
      const sent = await this.client.sendMessage(chatId, message);
      return {
        success: true,
        messageId: sent.id?.id || null,
        message: 'Mesaj trimis cu succes'
      };
    } catch (error) {
      console.error('❌ Error sending WhatsApp message:', error);
      throw new Error('Failed to send message: ' + error.message);
    }
  }

  /**
   * Send bulk WhatsApp messages
   */
  async sendBulkMessages(phoneNumbers, message) {
    if (!this.client || !this.isConnected) {
      throw new Error('WhatsApp Link client is not ready');
    }

    const results = [];
    let successful = 0;
    let failed = 0;

    for (const phoneNumber of phoneNumbers) {
      try {
        const result = await this.sendMessage(phoneNumber, message);
        results.push({
          phoneNumber,
          success: true,
          result
        });
        successful++;
      } catch (error) {
        results.push({
          phoneNumber,
          success: false,
          error: error.message
        });
        failed++;
      }
    }

    return {
      results,
      summary: {
        total: phoneNumbers.length,
        successful,
        failed
      }
    };
  }

  /**
   * Reconnect WhatsApp Link (generate new QR)
   */
  async reconnect() {
    try {
      this.connectionAttempts++;
      console.log(`🔄 Attempting to reconnect (${this.connectionAttempts}/${this.maxConnectionAttempts})...`);
      
      // Reset state
      this.isInitialized = false;
      this.isConnected = false;
      this.qrCode = null;
      this.qrDataUrl = null;
      this.statusCache = null;
      
      if (this.client) {
        try {
          await this.client.destroy();
        } catch (e) {
          console.log('⚠️ Error destroying client during reconnect:', e.message);
        }
        this.client = null;
      }
      
      // Re-initialize
      await this.initialize();
      
      return { success: true, message: 'WhatsApp Link reconnect initiated' };
    } catch (error) {
      console.error('❌ Reconnection failed:', error);
      this.isConnected = false;
      this.qrCode = null;
      this.qrDataUrl = null;
      return { success: false, message: 'Reconnection failed: ' + error.message };
    }
  }

  /**
   * Force reconnection if status is inconsistent
   */
  async forceReconnectIfNeeded() {
    if (this.client && this.isConnected) {
      try {
        const clientState = await this.client.getState();
        if (clientState !== 'CONNECTED') {
          console.log('🔄 Forcing reconnection due to inconsistent state:', clientState);
          await this.reconnect();
          return true;
        }
      } catch (error) {
        console.log('🔄 Forcing reconnection due to state check error:', error.message);
        await this.reconnect();
        return true;
      }
    }
    return false;
  }

  /**
   * Get current status
   */
  async getStatus() {
    // Return cached status if available and not expired
    if (this.statusCache && (Date.now() - this.statusCache.timestamp) < this.cacheTimeout) {
      return this.statusCache.data;
    }

    // Verify real connection status
    let realConnected = this.isConnected;
    if (this.client && this.isConnected) {
      try {
        const clientState = await this.client.getState();
        realConnected = (clientState === 'CONNECTED');
        if (!realConnected) {
          console.log('⚠️ WhatsApp client state mismatch, updating connection status');
          this.isConnected = false;
        }
      } catch (error) {
        console.error('❌ Error checking WhatsApp client state:', error);
        realConnected = false;
        this.isConnected = false;
      }
    }

    const status = {
      connected: realConnected,
      qrCode: this.qrCode,
      qrDataUrl: this.qrDataUrl,
      initialized: this.isInitialized,
      connectionAttempts: this.connectionAttempts
    };

    // Cache the status
    this.statusCache = {
      data: status,
      timestamp: Date.now()
    };

    return status;
  }

  /**
   * Get service information
   */
  getInfo() {
    return {
      name: 'WhatsApp Link Service',
      version: '2.0.0',
      initialized: this.isInitialized,
      connected: this.isConnected,
      hasQRCode: !!this.qrCode,
      hasQRDataUrl: !!this.qrDataUrl,
      initializing: this.clientInitializing,
      connectionAttempts: this.connectionAttempts,
      maxConnectionAttempts: this.maxConnectionAttempts
    };
  }

  /**
   * Cleanup and destroy client
   */
  async destroy() {
    try {
      if (this.client) {
        await this.client.destroy();
        this.client = null;
      }
      this.isConnected = false;
      this.isInitialized = false;
      this.qrCode = null;
      this.qrDataUrl = null;
      this.statusCache = null;
      console.log('📱 WhatsApp Link Service destroyed');
    } catch (error) {
      console.error('❌ Error destroying WhatsApp Link Service:', error);
    }
  }
}

module.exports = WhatsAppLinkService;

