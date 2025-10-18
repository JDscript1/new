// ===========================================
// MAIN APPLICATION
// ===========================================

class App {
  constructor() {
    this.currentTab = 'dashboard';
    this.drivers = [];
    this.racks = [];
    this.notifications = [];
    this.driversManager = null;
    // WhatsApp Link functionality
    this.whatsappModal = null;
    this.whatsappStatus = 'checking';
    this.selectedDrivers = [];
    this.whatsappStatusInterval = null;
    // Driver filtering
    this.activeDriverFilter = null;
    // WhatsApp messaging
    this.whatsappMessageModal = null;
    this.selectedMessageTemplate = null;
    // Chat fetch control (AbortController + sequence to ignore stale responses)
    this._chatFetchCtrl = null;
    this._chatLoadMoreCtrl = null;
    this._chatReqSeq = 0;
    // Chat scroll memory per phone
    this._chatScrollTop = {};
    // Chat message de-duplication index per phone
    this._chatMsgIndexByPhone = new Map();
    // Prefetch control maps (hover cooldown) și map pentru necitite
    this._hoverPrefetchCooldown = new Map();
    this._unreadDigitsMap = new Map();
    // Cache thread în memorie: phone -> { messages, total, ts }
    this._threadCache = new Map();
    this._threadCacheTtlMs = 60000;
    // Control încărcare media: defer la click
    this._deferMedia = true;
    // Caching ETag și ultimul mesaj (id/at) per thread
    this._etagByPhone = new Map();
    this._lastMsgMetaByPhone = new Map();
    // Composer send state & idempotență
    this._isSending = false;
    this._lastIdemKeyByPhone = new Map();
    this.init();
  }

  /**
   * Auto-revive last active WhatsApp client on startup
   */
  async autoReviveActiveClient() {
    try {
      const res = await fetch('/api/whatsapp/accounts');
      const data = await res.json();
      if (!data.success) return;
      const accounts = data.accounts || [];
      if (accounts.length === 0) return;

      const active = accounts.find(a => a.active);
      if (active) return; // deja există activ

      let desiredId = null;
      try { desiredId = localStorage.getItem('waLastActiveId'); } catch(_) {}
      if (!desiredId || !accounts.find(a => a.id === desiredId)) {
        const connected = accounts.find(a => a.connected) || accounts[0];
        desiredId = connected?.id;
      }
      if (!desiredId) return;

      await fetch('/api/whatsapp/switch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: desiredId })
      });
      try { localStorage.setItem('waLastActiveId', desiredId); } catch(_) {}
      await this.loadWhatsAppAccounts();
    } catch (_) {
      // ignore
    }
  }

  /**
   * Initialize application
   */
  async init() {
    this.bindEvents();
    
    // Check authentication first
    const token = localStorage.getItem('accessToken');
    const user = localStorage.getItem('user');
    
    if (token && user) {
      // User is authenticated, show main app and load data
      await this.showMainApp();
      await this.loadInitialData();
      this.loadSettingsData();
      this.handleProfilePictureUpload();
      this.bindMinimalWhatsAppControls();
      this.initializeWhatsAppLink();
      this.loadChartsScript();
    } else {
      // No authentication, show login screen
      await this.showLoginScreen();
    }
  }

  /**
   * Calculate driver status based on dates and current status
   */
  calculateDriverStatus(driver) {
    const today = new Date();
    const departureDate = new Date(driver.departureDate);
    const returnDate = driver.estimatedReturnDate ? new Date(driver.estimatedReturnDate) : null;
    const homeStart = driver.homeStartDate ? new Date(driver.homeStartDate) : null;
    const homeEnd = driver.homeEndDate ? new Date(driver.homeEndDate) : null;
    // Dacă există perioadă "acasă", o respectăm prioritar
    if (homeStart && homeEnd) {
      if (today >= homeStart && today < homeEnd) return 'acasa';
      if (today >= homeEnd) return 'catre_sediu';
    }
    
    // Calculate driver status based on return date
    
    // If driver has a manual status that's not 'activ', keep it
    // EXCEPTION: If driver is "vine_acasa" and return date hasn't passed, keep them as "activ" for display
    if (driver.status && !['activ', 'plecat'].includes(driver.status)) {
      if (driver.status === 'vine_acasa' && returnDate && returnDate > today) {
        // Driver is vine_acasa but return date hasn't passed, showing as activ
        return 'activ'; // Keep them active until return date passes
      }
      // Driver has manual status
      return driver.status;
    }
    
    // If no return date, keep current status
    if (!returnDate) {
      // Driver has no return date, keeping current status
      return driver.status || 'activ';
    }
    
    // Calculate days until return
    const daysUntilReturn = Math.ceil((returnDate - today) / (1000 * 60 * 60 * 24));
    
    // If return date has passed by more than 1 day, driver should be "acasa"
    if (daysUntilReturn < -1) {
      // Driver should be acasa (overdue)
      return 'acasa';
    }
    
    // If return date has passed by 1 day, driver should be "catre_casa"
    if (daysUntilReturn === -1) {
      // Driver should be catre_casa (1 day overdue)
      return 'catre_casa';
    }
    
    // If return date is in 1-7 days, driver should be "vine_acasa" (orange)
    if (daysUntilReturn >= 1 && daysUntilReturn <= 7) {
      // Driver should be vine_acasa (returning soon)
      return 'vine_acasa';
    }
    
    // If return date is today or more than 7 days in the future, driver is "activ"
    // Driver should be activ (normal status)
    return 'activ';
  }

  /**
   * Get status information for display
   */
  getStatusInfo(status) {
    const statusMap = {
      'activ': { text: 'Activ', class: 'status-activ' },
      'vine_acasa': { text: 'Vine Acasă', class: 'status-vine_acasa' },
      'acasa': { text: 'Acasă', class: 'status-acasa' },
      'vine_la_munca': { text: 'Vine la Muncă', class: 'status-vine_la_munca' },
      'catre_sediu': { text: 'Catre Sediu', class: 'status-catre_sediu' },
      'catre_casa': { text: 'Catre Casa', class: 'status-catre_casa' },
      'plecat': { text: 'Plecat', class: 'status-plecat' }
    };

    return statusMap[status] || { text: 'Necunoscut', class: 'status-plecat' };
  }

  /**
   * Show main app (user is authenticated)
   */
  async showMainApp() {
    try {
      document.getElementById('loading-screen').classList.add('hidden');
      document.getElementById('login-screen').classList.add('hidden');
      document.getElementById('main-app').classList.remove('hidden');
      console.log('User authenticated, showing main app');
    } catch (error) {
      console.error('Error showing main app:', error);
    }
  }

  /**
   * Show login screen (user not authenticated)
   */
  async showLoginScreen() {
    try {
      document.getElementById('loading-screen').classList.add('hidden');
      document.getElementById('login-screen').classList.remove('hidden');
      document.getElementById('main-app').classList.add('hidden');
      console.log('No authentication found, showing login screen');
    } catch (error) {
      console.error('Error showing login screen:', error);
    }
  }

  /**
   * Bind application events
   */
  bindEvents() {
    // Login form
    const loginForm = document.getElementById('login-form');
    if (loginForm) {
      loginForm.addEventListener('submit', (e) => this.handleLogin(e));
    }

    // Forgot password form
    const forgotPasswordForm = document.getElementById('forgot-password-form');
    if (forgotPasswordForm) {
      forgotPasswordForm.addEventListener('submit', (e) => this.handleForgotPassword(e));
    }

    // Navigation tabs
    const navButtons = document.querySelectorAll('.nav-btn');
    navButtons.forEach(btn => {
      btn.addEventListener('click', (e) => this.switchTab(e));
    });
    
    console.log('Navigation buttons bound:', navButtons.length);

    // Add driver buttons
    const addDriverBtns = document.querySelectorAll('#add-driver-btn, #add-driver-btn-2');
    addDriverBtns.forEach(btn => {
      btn.addEventListener('click', (e) => this.openAddDriverModal(e));
    });

    // WhatsApp settings removed
    this.handleLogout();
    
    // Password toggle functionality
    this.bindPasswordToggle();
    
    // WhatsApp event listeners removed

    // Refresh buttons
    const refreshBtns = document.querySelectorAll('#refresh-data-btn, #refresh-charts-btn');
    refreshBtns.forEach(btn => {
      btn.addEventListener('click', (e) => this.refreshData(e));
    });

    // Driver search (debounced for performance)
    const driverSearch = document.getElementById('driver-search');
    if (driverSearch) {
      driverSearch.addEventListener('input', utils.debounce((e) => this.searchDrivers(e), 200));
    }

    // Rack status filter
    const rackStatusFilter = document.getElementById('rack-status-filter');
    if (rackStatusFilter) {
      rackStatusFilter.addEventListener('change', (e) => this.filterRacks(e));
    }

    // WhatsApp message buttons
    this.bindWhatsAppMessageEvents();

    // App-level SSE events (drivers/racks)
    this.initAppEvents();

    // Chat tab: încărcare liste când se activează tabul

    // Dashboard card clicks for filtering drivers
    const clickableCards = document.querySelectorAll('.clickable-card');
    clickableCards.forEach((card) => {
      card.addEventListener('click', (e) => {
        this.filterDriversByStatus(e);
      });
    });

    // WhatsApp modal events removed

    // Mark all notifications as read
    const markAllReadBtn = document.getElementById('mark-all-read-btn');
    if (markAllReadBtn) {
      markAllReadBtn.addEventListener('click', (e) => this.markAllNotificationsRead(e));
    }

    // Modal events
    this.bindModalEvents();

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => this.handleKeyboardShortcuts(e));
    // Dezactivează tab-ul Chat: ascunde și ignoră evenimentele
    try {
      const chatBtn = document.querySelector('[data-tab="chat"]');
      if (chatBtn) chatBtn.remove();
      const chatTab = document.getElementById('chat-tab');
      if (chatTab) chatTab.remove();
    } catch(_) {}
  }

  // Chat logic
  async loadChats() {
    try {
      // Forțăm modul „contacts" – renunțăm la sub-tab „Conversații"
      const mode = 'contacts';
      let list = [];
      // highlight butoane subtabs
      const convBtn = document.getElementById('chat-tab-conv');
      const contactsBtn = document.getElementById('chat-tab-contacts');
      if (convBtn) { convBtn.style.display = 'none'; }
      if (contactsBtn) contactsBtn.classList.toggle('active', true);

      if (mode === 'contacts') {
        // Contacts mode: WA contacts + Drivers from DB (separate sections)
        // Cache simplu 60s pentru contacte WA
        const now = Date.now();
        if (!this._waContactsCache || !this._waContactsCache.ts || (now - this._waContactsCache.ts) > 60000) {
          try {
            const waRes = await utils.apiRequest('/whatsapp/contacts');
            const waDataFresh = await utils.handleApiResponse(waRes);
            this._waContactsCache = { ts: now, data: waDataFresh };
          } catch (_) {
            // Fallback: dacă WA nu e conectat sau 400, folosim listă goală
            this._waContactsCache = { ts: now, data: { contacts: [] } };
          }
        }
        const [drvRes, chatsRes] = await Promise.all([
          utils.apiRequest('/drivers'),
          utils.apiRequest('/whatsapp/chats')
        ]);
        const drvData = await utils.handleApiResponse(drvRes);
        let chatsData = { chats: [] };
        try { chatsData = await utils.handleApiResponse(chatsRes); } catch (_) { chatsData = { chats: [] }; }
        const toDigits = (p) => String(p || '').replace(/\D+/g, '');
        const unreadByDigits = new Map();
        (chatsData.chats || []).forEach(c => {
          const num = toDigits(c.phone);
          if (num) unreadByDigits.set(num, c.unread || 0);
        });
        // Expune map-ul de necitite pentru folosire la deschiderea thread-ului
        this._unreadDigitsMap = unreadByDigits;
        const drivers = (drvData.drivers || [])
          .map(d => {
            const num = toDigits(d.phone);
            const unread = unreadByDigits.get(num) || 0;
            return ({ group:'drivers', type:'contact', title: `${d.firstName} ${d.lastName}`.trim(), subtitle: utils.formatPhone(d.phone), phone: d.phone, unread });
          });
        const waContacts = (this._waContactsCache.data.contacts || [])
          .filter(x => x.isWA && !x.isMe)
          .map(c => {
            const num = `+${c.number}`;
            // dacă există în drivers, folosim numele din drivers
            const drv = (drvData.drivers || []).find(d => String(d.phone||'').replace(/\D+/g,'') === c.number);
            const waName = (c.notifyName || c.waName || '').trim();
            const title = drv ? `${drv.firstName} ${drv.lastName}`.trim() : waName;
            const unread = unreadByDigits.get(c.number) || 0;
            return ({ group:'wa', type:'contact', title, subtitle: `+${c.number}`, phone: num, unread });
          })
          // nu afișăm contacte WA care nu au nume (rămân vizibile în secțiunea Șoferi dacă sunt în DB)
          .filter(c => !!c.title);
        // Keep both lists; we will render with section headers
        list = [{ group:'wa', title:'Contacte WhatsApp', items: waContacts }, { group:'drivers', title:'Șoferi (Baza de date)', items: drivers }];
      }
      const listEl = document.getElementById('chat-list');
      if (!listEl) return;
      // search filter
      const qEl = document.getElementById('chat-search');
      const q = (qEl && qEl.value || '').trim().toLowerCase();
      if (mode === 'conversations') {
        const filtered = list.filter(i => i.title.toLowerCase().includes(q) || (i.subtitle||'').toLowerCase().includes(q));
        listEl.innerHTML = filtered.map(c => `
          <div class="chat-item" data-phone="${c.phone}" data-name="${(c.title||'').replace(/"/g,'&quot;')}">
            <div class="chat-row">
              <div class="chat-avatar">${(c.title||'?').substring(0,1).toUpperCase()}</div>
              <div class="chat-meta">
                <div class="chat-title">
                  <span class="chat-name">${c.title}</span>
                  <span class="chat-number">${c.phone}</span>
                  <i class="fab fa-whatsapp wa-icon"></i>
                </div>
                <div class="chat-subtitle">${c.subtitle || ''}</div>
              </div>
              <div style="display:flex; gap:6px; align-items:center;">
                ${c.pinned ? `<i class='fas fa-thumbtack' title='Pinned' style='color:var(--text-gray);'></i>` : ''}
                ${c.muted ? `<i class='fas fa-bell-slash' title='Muted' style='color:var(--text-gray);'></i>` : ''}
                ${c.unread ? `<span class="badge">${c.unread}</span>` : ''}
              </div>
            </div>
          </div>
        `).join('');
      } else { // fallback – nu ar trebui să ajungă aici
        // Contacts mode with sections (fallback)
        const sections = list; // [{group,title,items}]
        const renderItems = (items) => items
          .filter(i => i.title.toLowerCase().includes(q) || (i.subtitle||'').toLowerCase().includes(q))
          .map(c => `
            <div class="chat-item" data-phone="${c.phone}" data-name="${(c.title||'').replace(/"/g,'&quot;')}" data-unread="${c.unread>0 ? '1':'0'}">
              <div class="chat-row">
                <div class="chat-avatar">${(c.title||'?').substring(0,1).toUpperCase()}</div>
                <div class="chat-meta">
                  <div class="chat-title">${c.title} <i class="fab fa-whatsapp wa-icon"></i></div>
                  <div class="chat-subtitle">${c.subtitle || ''}</div>
                </div>
                <div style="display:flex; gap:6px; align-items:center; margin-left:auto;">
                  ${c.unread ? `<button class="jump-unread" title="Deschide ultimul mesaj" data-phone="${c.phone}" data-name="${(c.title||'').replace(/"/g,'&quot;')}" style="border:none;background:transparent;color:var(--text-gray);cursor:pointer;"><i class="fas fa-arrow-down"></i></button>` : ''}
                </div>
              </div>
            </div>
          `).join('');
        listEl.innerHTML = sections.map(s => `
          <div class="chat-section">
            <div class="chat-section-title">${s.title}</div>
            <div class="chat-section-divider"></div>
            ${renderItems(s.items)}
          </div>
        `).join('');
        // Bind jump buttons (deschide direct conversația cu mesaje necitite)
        listEl.querySelectorAll('.jump-unread').forEach(btn => {
          if (!btn._bound) {
            btn._bound = true;
            btn.addEventListener('click', (e) => {
              e.stopPropagation();
              const phone = btn.getAttribute('data-phone');
              const name = btn.getAttribute('data-name') || '';
              // deschide thread și derulează la ultimul mesaj
              this.openChatThread(phone, name).then(() => {
                const messagesEl = document.getElementById('chat-thread-messages');
                if (messagesEl) messagesEl.scrollTop = messagesEl.scrollHeight;
              });
            });
          }
        });
      }
      listEl.querySelectorAll('.chat-item').forEach(item => {
        item.addEventListener('click', () => {
          // highlight activ în listă
          listEl.querySelectorAll('.chat-item.active').forEach(el => el.classList.remove('active'));
          item.classList.add('active');
          const phone = item.getAttribute('data-phone');
          const name = item.getAttribute('data-name') || '';
          // setează imediat conversația activă și header-ul
          this._activeChatPhone = phone;
          const ttl = document.getElementById('chat-header-title');
          const sub = document.getElementById('chat-header-sub');
          const av = document.getElementById('chat-header-avatar');
          if (ttl) ttl.innerHTML = `${name ? `<span class="chat-name">${name}</span> ` : ''}<span class="chat-number">${phone}</span>`;
          if (sub) sub.textContent = 'Conversație activă';
          if (av) {
            const base = (name || phone || '?').trim();
            av.textContent = (base.substring(0,1) || '?').toUpperCase();
          }
          // Nu curățăm mesajele dacă avem cache local; lăsăm openChatThread să afișeze instant din cache
          this.updateChatSendState();
          this.openChatThread(phone, name);
        });
        // Prefetch la hover (debounce per contact ~15s)
        if (!item._hoverBound) {
          item._hoverBound = true;
          item.addEventListener('mouseenter', () => {
            const p = item.getAttribute('data-phone');
            if (!p) return;
            const last = this._hoverPrefetchCooldown.get(p) || 0;
            if (Date.now() - last < 15000) return;
            this._hoverPrefetchCooldown.set(p, Date.now());
            // Trigger backend fast hydrate; ignor răspunsul
            utils.apiRequest(`/whatsapp/messages?phone=${encodeURIComponent(p)}&offset=0&limit=50&fast=1`).catch(()=>{});
          }, { passive: true });
        }
      });

      // Preîncărcare în fundal pentru conversații relevante (pinned, necitite, recente)
      try {
        const hotCandidates = [];
        // Din secțiuni, extrage contacte cu necitite mai întâi
        const sections = list; // [{group,title,items}]
        sections.forEach(s => {
          (s.items || []).forEach(c => {
            hotCandidates.push({ phone: c.phone, unread: c.unread || 0, group: s.group, title: c.title || '' });
          });
        });
        // Sortează: necitite desc, apoi WA înaintea drivers (mesajele lor tind să fie mai recente)
        hotCandidates.sort((a,b) => (b.unread||0) - (a.unread||0) || (a.group === 'wa' ? -1 : 1));
        const unique = new Map();
        for (const c of hotCandidates) { if (!unique.has(c.phone)) unique.set(c.phone, c); }
        const phones = Array.from(unique.values()).slice(0, 6).map(x => x.phone); // limitează agresiv pentru viteză
        let i = 0;
        const pump = async () => {
          if (i >= phones.length) return;
          const p = phones[i++];
          // sari peste conversația deja activă
          if (p === this._activeChatPhone) return pump();
          try {
            const r = await utils.apiRequest(`/whatsapp/messages?phone=${encodeURIComponent(p)}&offset=0&limit=30&fast=1`);
            const d = await utils.handleApiResponse(r);
            const msgs = Array.isArray(d.messages) ? d.messages : [];
            const tot = d.total || msgs.length;
            if (msgs.length) {
              this._threadCache.set(p, { messages: msgs, total: tot, ts: Date.now() });
              utils.idb.putThread(p, msgs, tot);
            }
          } catch (_) {}
          // throttling ușor între prefetch-uri
          setTimeout(pump, 300);
        };
        // rulează după un mic delay ca să nu blocheze interacțiunile imediate
        setTimeout(pump, 400);
      } catch (_) {}
      // Pin/Mute actions
      listEl.querySelectorAll('button[data-action="pin"]').forEach(btn => {
        if (!btn._bound) {
          btn._bound = true;
          btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const p = btn.getAttribute('data-phone');
            const isPinned = btn.closest('.chat-item').querySelector('.fa-thumbtack') !== null;
            utils.apiRequest('/whatsapp/chat/pin', { method:'POST', body: JSON.stringify({ phone: p, pinned: !isPinned }) })
              .then(() => this.loadChats())
              .catch(()=>{});
          });
        }
      });
      listEl.querySelectorAll('button[data-action="mute"]').forEach(btn => {
        if (!btn._bound) {
          btn._bound = true;
          btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const p = btn.getAttribute('data-phone');
            const isMuted = btn.closest('.chat-item').querySelector('.fa-bell-slash') !== null;
            utils.apiRequest('/whatsapp/chat/mute', { method:'POST', body: JSON.stringify({ phone: p, muted: !isMuted }) })
              .then(() => this.loadChats())
              .catch(()=>{});
          });
        }
      });
      // Middle-click pe tab-ul Chat deschide într-o filă nouă
      const chatNavBtn = document.querySelector('[data-tab="chat"]');
      if (chatNavBtn && !chatNavBtn._openNewBound) {
        chatNavBtn._openNewBound = true;
        chatNavBtn.addEventListener('auxclick', (e) => {
          if (e.button === 1) window.open(window.location.origin + '/#chat', '_blank');
        });
      }
      // Tab toggles (folosește referințele deja inițializate mai sus)
      // Dezactivăm toggle-ul pentru „Conversații"
      if (contactsBtn && !contactsBtn._bound) {
        contactsBtn._bound = true;
        contactsBtn.addEventListener('click', () => { this._chatMode = 'contacts'; this.loadChats(); });
      }
      if (qEl && !qEl._bound) {
        qEl._bound = true;
        qEl.addEventListener('input', utils.debounce(() => this.loadChats(), 200));
      }
    } catch (e) {
      console.warn('loadChats failed', e);
    }
  }

  async openChatThread(phone, hintedName = '') {
    try {
      // Abort orice cereri anterioare pentru thread
      if (this._chatFetchCtrl) {
        try { this._chatFetchCtrl.abort(); } catch(_) {}
      }
      const ctrl = new AbortController();
      this._chatFetchCtrl = ctrl;
      const reqSeq = ++this._chatReqSeq;
      // reset pagination
      this._chatOffset = 0;
      this._chatLimit = 50;
      // setează conversația activă înainte de bind
      this._activeChatPhone = phone;
      // Afișează skeleton DOAR dacă nu avem cache local pentru acest thread
      const threadEl = document.getElementById('chat-thread-messages');
      const container = document.getElementById('chat-thread');
      const cached = this._threadCache.get(phone);
      const hasCached = cached && Array.isArray(cached.messages) && cached.messages.length > 0;
      if (threadEl && !hasCached) {
        const skeleton = Array.from({ length: 6 }).map(() => `
          <div class="msg shimmer">
            <div class="bubble"><div class="shimmer-bar" style="width:${40 + Math.random()*50}%"></div></div>
            <div class="meta shimmer-bar" style="width:60px"></div>
          </div>`).join('');
        threadEl.innerHTML = skeleton;
      }
      // Înainte de rețea: încearcă IndexedDB pentru randare instant
      if (!hasCached && threadEl) {
        try {
          const persisted = await utils.idb.getThread(phone);
          if (persisted && Array.isArray(persisted.messages) && persisted.messages.length) {
            this._threadCache.set(phone, { messages: persisted.messages, total: persisted.total || persisted.messages.length, ts: persisted.ts || Date.now() });
            this.renderChatMessages(persisted.messages, { replace: true });
          }
        } catch(_) {}
      }
      // Dacă avem cache, randăm imediat și apoi cerem refresh în fundal
      let data = { messages: [], total: 0 };
      if (hasCached && threadEl) {
        const { messages: cm, total: ct, ts } = cached;
        // Expiră cache după TTL
        if (!ts || (Date.now() - ts) < this._threadCacheTtlMs) {
          this.renderChatMessages(cm, { replace: true });
          this._chatTotal = ct || cm.length;
          this._chatOffset = cm.length;
        }
      }
      // Construiește antete condiționale (ETag) și parametri incrementali (sinceId/sinceAt)
      const hdrs = {};
      const et = this._etagByPhone.get(phone);
      if (et) hdrs['If-None-Match'] = et;
      const lastMeta = this._lastMsgMetaByPhone.get(phone);
      const qs = [];
      qs.push(`phone=${encodeURIComponent(phone)}`);
      qs.push(`offset=${this._chatOffset}`);
      qs.push(`limit=${this._chatLimit}`);
      qs.push(`fast=1`);
      if (lastMeta && lastMeta.id) qs.push(`sinceId=${encodeURIComponent(lastMeta.id)}`);
      else if (lastMeta && lastMeta.at) qs.push(`sinceAt=${encodeURIComponent(lastMeta.at)}`);
      const res = await utils.apiRequest(`/whatsapp/messages?${qs.join('&')}`, { signal: ctrl.signal, headers: hdrs });
      if (res.status === 304 && hasCached) {
        data = { messages: cached.messages, total: cached.total };
      } else {
        data = await utils.handleApiResponse(res);
        try { const etNew = res.headers.get('ETag'); if (etNew) this._etagByPhone.set(phone, etNew); } catch(_) {}
      }
      // Ignoră dacă între timp s-a schimbat contactul
      if (reqSeq !== this._chatReqSeq) return;
      
      if (!threadEl) return;
      // Header populate (prioritate: DB soferi > contacte WA > chats)
      const ttl = document.getElementById('chat-header-title');
      const sub = document.getElementById('chat-header-sub');
      const av = document.getElementById('chat-header-avatar');
      // Determină un nume de afișat din contacte WA sau baza de date șoferi
      let displayName = (hintedName || '').trim();
      if (!displayName && Array.isArray(this.drivers)) {
        const digits = (phone || '').replace(/\D+/g, '');
        const d = this.drivers.find(dr => {
          const dNorm = dr.phoneNormalized ? String(dr.phoneNormalized) : String(dr.phone || '').replace(/\D+/g,'');
          return dNorm.endsWith(digits) || dNorm === digits;
        });
        if (d) displayName = `${d.firstName || ''} ${d.lastName || ''}`.trim();
      }
      try {
        const [contactsRes] = await Promise.all([
          utils.apiRequest('/whatsapp/contacts')
        ]);
        const contactsData = await utils.handleApiResponse(contactsRes);
        const digits = (phone || '').replace(/\D+/g, '');
        const match = (contactsData.contacts || []).find(c => String(c.number || '').replace(/\D+/g,'') === digits);
        if (match && !displayName) displayName = (match.name && match.name.trim()) || (match.notifyName && match.notifyName.trim()) || (match.waName && match.waName.trim()) || '';
      } catch (_) {}
      // fallback: nume din lista de conversații (chatStore-based)
      if (!displayName) {
        try {
          const listRes = await utils.apiRequest('/whatsapp/chats');
          const listData = await utils.handleApiResponse(listRes);
          const item = (listData.chats || []).find(c => (c.phone || '') === phone);
          if (item && item.name) displayName = item.name;
        } catch (_) {}
      }
      if (!displayName && Array.isArray(this.drivers)) {
        const digits = (phone || '').replace(/\D+/g, '');
        const d = this.drivers.find(dr => {
          const dNorm = dr.phoneNormalized ? String(dr.phoneNormalized) : String(dr.phone || '').replace(/\D+/g,'');
          return dNorm.endsWith(digits) || dNorm === digits;
        });
        if (d) displayName = `${d.firstName || ''} ${d.lastName || ''}`.trim();
      }
      if (ttl) {
        if (displayName) {
          ttl.classList.add('fade');
          ttl.innerHTML = `<span class="chat-name">${displayName}</span> <span class="chat-number">${phone}</span>`;
          setTimeout(() => ttl && ttl.classList.remove('fade'), 150);
        } else {
          ttl.textContent = phone;
        }
      }
      if (sub) { sub.classList.add('fade'); sub.textContent = 'Conversație activă'; setTimeout(() => sub && sub.classList.remove('fade'), 150); }
      if (av) {
        av.classList.add('fade');
        const base = (displayName || phone || '?').trim();
        av.textContent = (base.substring(0,1) || '?').toUpperCase();
        setTimeout(() => av && av.classList.remove('fade'), 150);
      }
      // render initial page cu fallback fără fast dacă nu avem mesaje
      let initialMessages = data.messages || [];
      let initialTotal = data.total || initialMessages.length;
      if (initialMessages.length === 0) {
        try {
          const res2 = await utils.apiRequest(`/whatsapp/messages?phone=${encodeURIComponent(phone)}&offset=0&limit=${this._chatLimit}&fast=1`, { signal: ctrl.signal });
          const data2 = await utils.handleApiResponse(res2);
          initialMessages = data2.messages || [];
          initialTotal = data2.total || initialMessages.length;
        } catch (_) {}
      }
      // Ignoră dacă între timp s-a schimbat contactul
      if (reqSeq !== this._chatReqSeq) return;
      // Initializează index de deduplicare pentru acest telefon
      const idx = new Set();
      const keyOf = (m) => (m && (m.id || `${m.from}|${m.to}|${m.at}|${m.text||''}`)) || Math.random().toString(36);
      for (const m of initialMessages) { idx.add(keyOf(m)); }
      this._chatMsgIndexByPhone.set(phone, idx);
      this.renderChatMessages(initialMessages, { replace: true });
      // Stochează meta pentru incremental
      try {
        const last = initialMessages[initialMessages.length - 1];
        if (last) this._lastMsgMetaByPhone.set(phone, { id: last.id || null, at: last.at || null });
      } catch(_) {}
      // Cache nou
      try {
        const scrollTop = threadEl ? threadEl.scrollTop : 0;
        this._threadCache.set(phone, { messages: initialMessages, total: initialTotal, ts: Date.now(), scrollTop });
        utils.idb.putThread(phone, initialMessages, initialTotal, { scrollTop });
      } catch(_) {}
      // restore previous scroll dacă există; altfel dacă sunt necitite, sari la primul necitit; altfel jos
      if (threadEl) {
        const prevMem = this._chatScrollTop[phone];
        const persisted = this._threadCache.get(phone);
        const prev = (typeof prevMem === 'number') ? prevMem : (persisted && typeof persisted.scrollTop === 'number' ? persisted.scrollTop : null);
        if (typeof prev === 'number' && prev > 0) {
          threadEl.scrollTop = prev;
        } else {
          // calculează dacă există necitite pentru acest număr și poziția primului necitit
          const digits = (phone || '').replace(/\D+/g, '');
          const unreadCount = (this._unreadDigitsMap && this._unreadDigitsMap.get(digits)) || 0;
          if (unreadCount > 0) {
            // presupunem că necititele sunt la finalul listei; derulăm la începutul ultimei ferestre de necitite
            // strategie: găsim indexul de la care încep ultimele N mesaje (unreadCount) și ancorăm acolo vizual
            try {
              const totalNow = (initialMessages || []).length;
              const startUnreadIdx = Math.max(0, totalNow - unreadCount);
              // aproximăm înălțimea per mesaj ~72px (bubble + meta); folosim măsurătoare după render dacă există noduri
              const nodes = Array.from(threadEl.children);
              if (nodes.length === totalNow && nodes[startUnreadIdx]) {
                const anchorNode = nodes[startUnreadIdx];
                threadEl.scrollTop = anchorNode.offsetTop - 20;
              } else {
                threadEl.scrollTop = Math.max(0, threadEl.scrollHeight - (unreadCount * 72));
              }
            } catch (_) {
              threadEl.scrollTop = threadEl.scrollHeight;
            }
          } else {
            threadEl.scrollTop = threadEl.scrollHeight;
          }
        }
      }
      this._chatTotal = initialTotal;
      this._chatOffset = initialMessages.length;
      this.setupLoadMore(phone);
      // Watchdog: dacă nu vin mesaje în 8s, oprește skeletonul și afișează mesaj informativ
      try {
        const wdKey = `wd-${reqSeq}-${phone}`;
        clearTimeout(this._chatWdTimer);
        this._chatWdKey = wdKey;
        this._chatWdTimer = setTimeout(() => {
          if (this._chatWdKey !== wdKey) return;
          const el = document.getElementById('chat-thread-messages');
          if (el && /shimmer/.test(el.innerHTML)) {
            el.innerHTML = `<div class="msg"><div class="bubble"><em>Conversația se încarcă din WhatsApp... Încercați din nou mai târziu.</em></div><div class="meta">&nbsp;</div></div>`;
          }
        }, 8000);
      } catch(_) {}
      // Memorize scroll position changes
      if (threadEl && !threadEl._scrollMemBound) {
        threadEl._scrollMemBound = true;
        threadEl.addEventListener('scroll', () => {
          this._chatScrollTop[phone] = threadEl.scrollTop;
          try { const cached = this._threadCache.get(phone); if (cached) { cached.scrollTop = threadEl.scrollTop; utils.idb.putThread(phone, cached.messages, cached.total, { scrollTop: threadEl.scrollTop }); } } catch(_) {}
        }, { passive: true });
      }
      // Mark as read și refreshez lista conversațiilor imediat
      utils.apiRequest('/whatsapp/chat/read', { method: 'POST', body: JSON.stringify({ phone }) })
        .then(() => { if (this.currentTab === 'chat') this.loadChats(); })
        .catch(()=>{});
      // Header pin/mute actions
      const pinBtn = document.getElementById('chat-header-pin');
      const muteBtn = document.getElementById('chat-header-mute');
      const delBtn = document.getElementById('chat-header-delete');
      if (pinBtn && !pinBtn._bound) {
        pinBtn._bound = true;
        pinBtn.addEventListener('click', () => {
          utils.apiRequest('/whatsapp/chat/pin', { method:'POST', body: JSON.stringify({ phone, pinned: true }) }).then(()=>this.loadChats());
        });
      }
      if (muteBtn && !muteBtn._bound) {
        muteBtn._bound = true;
        muteBtn.addEventListener('click', () => {
          utils.apiRequest('/whatsapp/chat/mute', { method:'POST', body: JSON.stringify({ phone, muted: true }) }).then(()=>this.loadChats());
        });
      }
      if (delBtn && !delBtn._bound) {
        delBtn._bound = true;
        delBtn.addEventListener('click', async () => {
          if (!confirm('Ștergi această conversație?')) return;
          try {
            const norm = this.normalizePhoneNumber(phone);
            // Try POST first, then fallback to DELETE
            let res = await utils.apiRequest('/whatsapp/chat/delete', { method: 'POST', body: JSON.stringify({ phone: `+${norm}` }) });
            if (!res.ok) {
              res = await utils.apiRequest(`/whatsapp/chat?phone=%2B${norm}`, { method: 'DELETE' });
            }
            await utils.handleApiResponse(res);
            // curăță thread-ul și reîncarcă lista
            const threadEl = document.getElementById('chat-thread-messages');
            if (threadEl) threadEl.innerHTML = '';
            this._activeChatPhone = null;
            await this.loadChats();
            utils.showToast('Conversație ștearsă', 'success');
          } catch (e) {
            utils.showToast('Eroare la ștergere conversație', 'error');
          }
        });
      }
      // Rebind clean handlers to always use conversația activă
      const input = document.getElementById('chat-input');
      const sendBtn = document.getElementById('chat-send-btn');
      const emojiBtn = document.getElementById('chat-emoji-btn');
      const attachBtn = document.getElementById('chat-attach-btn');
      const fileInput = document.getElementById('chat-file');
      const preview = document.getElementById('chat-upload-preview');
      if (sendBtn) {
        const btnClone = sendBtn.cloneNode(true);
        sendBtn.parentNode.replaceChild(btnClone, sendBtn);
        btnClone.onclick = () => this.sendChatMessage(this._activeChatPhone);
      }
      if (input) {
        const inClone = input.cloneNode(true);
        input.parentNode.replaceChild(inClone, input);
        inClone.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            this.sendChatMessage(this._activeChatPhone);
          }
        });
        inClone.addEventListener('input', () => this.updateChatSendState());
      }
      if (emojiBtn) {
        const emClone = emojiBtn.cloneNode(true);
        emojiBtn.parentNode.replaceChild(emClone, emojiBtn);
        emClone.onclick = () => inClone && inClone.focus();
      }
      if (attachBtn) {
        const atClone = attachBtn.cloneNode(true);
        attachBtn.parentNode.replaceChild(atClone, attachBtn);
        atClone.onclick = () => fileInput && fileInput.click();
      }
      if (fileInput) {
        const fClone = fileInput.cloneNode(true);
        fileInput.parentNode.replaceChild(fClone, fileInput);
        fClone.onchange = async () => {
          if (!fClone.files || !fClone.files[0]) return;
          const f = fClone.files[0];
          if (!/^image\//.test(f.type) && !/^video\//.test(f.type) && !/^audio\//.test(f.type)) {
            utils.showToast('Format neacceptat', 'warning');
            return;
          }
          const dataUrl = await new Promise((resolve) => {
            const r = new FileReader();
            r.onload = () => resolve(r.result);
            r.readAsDataURL(f);
          });
          if (preview) {
            preview.style.display = 'flex';
            preview.innerHTML = `<span class="status-badge">${utils.escapeHtml(f.name)}</span>`;
          }
          try {
            const res = await utils.apiRequest('/whatsapp/chat/send-media', { method: 'POST', body: JSON.stringify({ phone: this._activeChatPhone, dataUrl, filename: f.name }) });
            await utils.handleApiResponse(res);
            if (preview) { preview.style.display = 'none'; preview.innerHTML = ''; }
            // reîncarcă thread-ul
            if (this._activeChatPhone) await this.openChatThread(this._activeChatPhone);
          } catch (_) {
            utils.showToast('Eroare upload', 'error');
          } finally {
            fClone.value = '';
          }
        };
      }
      // Modal composer wiring (if modal is used)
      const modalInput = document.getElementById('chat-modal-input');
      const modalSend = document.getElementById('chat-modal-send-btn');
      const modalEmoji = document.getElementById('chat-modal-emoji-btn');
      const modalAttach = document.getElementById('chat-modal-attach-btn');
      const modalFile = document.getElementById('chat-modal-file');
      const modalPreview = document.getElementById('chat-modal-upload-preview');
      if (modalSend) {
        const mBtnClone = modalSend.cloneNode(true);
        modalSend.parentNode.replaceChild(mBtnClone, modalSend);
        mBtnClone.onclick = () => this.sendChatMessage(this._activeChatPhone, { fromModal: true });
      }
      if (modalInput) {
        const mInClone = modalInput.cloneNode(true);
        modalInput.parentNode.replaceChild(mInClone, modalInput);
        mInClone.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            this.sendChatMessage(this._activeChatPhone, { fromModal: true });
          }
        });
        mInClone.addEventListener('input', () => this.updateChatSendState());
      }
      if (modalEmoji) {
        const meClone = modalEmoji.cloneNode(true);
        modalEmoji.parentNode.replaceChild(meClone, modalEmoji);
        meClone.onclick = () => {
          const el = document.getElementById('chat-modal-input');
          if (el) el.focus();
        };
      }
      if (modalAttach) {
        const maClone = modalAttach.cloneNode(true);
        modalAttach.parentNode.replaceChild(maClone, modalAttach);
        maClone.onclick = () => modalFile && modalFile.click();
      }
      if (modalFile) {
        const mfClone = modalFile.cloneNode(true);
        modalFile.parentNode.replaceChild(mfClone, modalFile);
        mfClone.onchange = async () => {
          if (!mfClone.files || !mfClone.files[0]) return;
          const f = mfClone.files[0];
          if (!/^image\//.test(f.type) && !/^video\//.test(f.type) && !/^audio\//.test(f.type)) {
            utils.showToast('Format neacceptat', 'warning');
            return;
          }
          const dataUrl = await new Promise((resolve) => {
            const r = new FileReader();
            r.onload = () => resolve(r.result);
            r.readAsDataURL(f);
          });
          if (modalPreview) {
            modalPreview.style.display = 'flex';
            modalPreview.innerHTML = `<span class=\"status-badge\">${utils.escapeHtml(f.name)}</span>`;
          }
          try {
            const res = await utils.apiRequest('/whatsapp/chat/send-media', { method: 'POST', body: JSON.stringify({ phone: this._activeChatPhone, dataUrl, filename: f.name }) });
            await utils.handleApiResponse(res);
            if (modalPreview) { modalPreview.style.display = 'none'; modalPreview.innerHTML = ''; }
            if (this._activeChatPhone) await this.openChatThread(this._activeChatPhone);
          } catch (_) {
            utils.showToast('Eroare upload', 'error');
          } finally {
            mfClone.value = '';
          }
        };
      }
    } catch (e) {
      console.warn('openChatThread failed', e);
    }
  }

  setupLoadMore(phone) {
    const threadContainer = document.getElementById('chat-thread');
    const messagesEl = document.getElementById('chat-thread-messages');
    if (!threadContainer || !messagesEl) return;
    let btn = document.getElementById('chat-load-more');
    if (!btn) {
      btn = document.createElement('button');
      btn.id = 'chat-load-more';
      btn.className = 'dropdown-btn';
      btn.textContent = 'Încarcă mesaje mai vechi';
      btn.style.marginBottom = '6px';
      messagesEl.parentNode.insertBefore(btn, messagesEl);
    }
    const updateVisibility = () => {
      const hasMore = (this._chatTotal || 0) > (this._chatOffset || 0);
      btn.style.display = hasMore ? 'inline-flex' : 'none';
    };
    updateVisibility();
    if (!btn._bound) {
      btn._bound = true;
      btn.addEventListener('click', async () => {
        try {
          btn.disabled = true;
          const before = messagesEl.scrollHeight;
          if (this._chatLoadMoreCtrl) { try { this._chatLoadMoreCtrl.abort(); } catch(_) {} }
          const lmCtrl = new AbortController();
          this._chatLoadMoreCtrl = lmCtrl;
          const res = await utils.apiRequest(`/whatsapp/messages?phone=${encodeURIComponent(phone)}&offset=${this._chatOffset}&limit=${this._chatLimit||50}&fast=1`, { signal: lmCtrl.signal });
          const data = await utils.handleApiResponse(res);
          const page = data.messages || [];
          this.renderChatMessages(page, { prepend: true });
          this._chatOffset += page.length;
          this._chatTotal = data.total || this._chatTotal || this._chatOffset;
          // keep scroll anchored
          const after = messagesEl.scrollHeight;
          messagesEl.scrollTop = after - before;
        } catch (_) {}
        finally {
          btn.disabled = false;
          updateVisibility();
        }
      });
    }

    // Auto-load la scroll sus (throttle cu rAF)
    if (!messagesEl._autoLoadBound) {
      messagesEl._autoLoadBound = true;
      let scheduled = false;
      const onScroll = async () => {
        const hasMore = (this._chatTotal || 0) > (this._chatOffset || 0);
        if (!hasMore || this._chatLoadingMore) return;
        if (messagesEl.scrollTop <= 10) {
          try {
            this._chatLoadingMore = true;
            const before = messagesEl.scrollHeight;
            if (this._chatLoadMoreCtrl) { try { this._chatLoadMoreCtrl.abort(); } catch(_) {} }
            const lmCtrl = new AbortController();
            this._chatLoadMoreCtrl = lmCtrl;
            const res = await utils.apiRequest(`/whatsapp/messages?phone=${encodeURIComponent(phone)}&offset=${this._chatOffset}&limit=${this._chatLimit||50}&fast=1`, { signal: lmCtrl.signal });
            const data = await utils.handleApiResponse(res);
            const page = data.messages || [];
            if (page.length) {
              this.renderChatMessages(page, { prepend: true });
              this._chatOffset += page.length;
              this._chatTotal = data.total || this._chatTotal || this._chatOffset;
              const after = messagesEl.scrollHeight;
              messagesEl.scrollTop = after - before;
            }
          } catch (_) {}
          finally {
            this._chatLoadingMore = false;
            updateVisibility();
          }
        }
      };
      messagesEl.addEventListener('scroll', () => {
        if (!scheduled) {
          scheduled = true;
          requestAnimationFrame(() => { scheduled = false; onScroll(); });
        }
      }, { passive: true });
    }
  }

  renderChatMessages(messages, { replace = false, prepend = false } = {}) {
    const threadEl = document.getElementById('chat-thread-messages');
    if (!threadEl) return;
    if (!this._chatMaxDom) this._chatMaxDom = 180; // fereastră DOM mai mică pentru scroll fluid
    const phone = this._activeChatPhone;
    const idx = this._chatMsgIndexByPhone.get(phone) || new Set();
    const keyOf = (m) => (m && (m.id || `${m.from}|${m.to}|${m.at}|${m.text||''}`)) || Math.random().toString(36);
    let list = Array.isArray(messages) ? messages : [];
    // Dacă nu e replace, filtrează duplicatele
    if (!replace) {
      list = list.filter(m => {
        const k = keyOf(m);
        if (idx.has(k)) return false;
        idx.add(k);
        return true;
      });
      this._chatMsgIndexByPhone.set(phone, idx);
    } else {
      // replace: elimină dublurile din listă și reconstruiește index din listă
      const seen = new Set();
      const deduped = [];
      for (const m of list) {
        const k = keyOf(m);
        if (seen.has(k)) continue;
        seen.add(k);
        deduped.push(m);
      }
      list = deduped;
      const newIdx = new Set();
      for (const m of list) newIdx.add(keyOf(m));
      this._chatMsgIndexByPhone.set(phone, newIdx);
    }
    const html = list.map(m => {
      const hasMedia = !!m.media && !!m.mimetype;
      const hasMediaFlag = !!m.hasMedia;
      let mediaHtml = '';
      if (hasMedia) {
        const mime = String(m.mimetype || '').toLowerCase();
        if (mime.startsWith('image/')) {
          mediaHtml = `<div class="media"><img loading="lazy" src="${m.media}" alt="img"/></div>`;
        } else if (mime.startsWith('video/')) {
          mediaHtml = `<div class="media"><video preload="none" src="${m.media}" controls></video></div>`;
        } else if (mime.startsWith('audio/')) {
          mediaHtml = `<div class="media"><audio preload="none" src="${m.media}" controls></audio></div>`;
        } else {
          const fn = utils.escapeHtml(m.filename || 'fișier');
          mediaHtml = `<div class="media"><a href="${m.media}" download="${fn}">Descarcă ${fn}</a></div>`;
        }
      } else if (hasMediaFlag) {
        // Placeholder: preview faded + buton de descărcare la cerere
        const safeId = utils.escapeHtml(m.id || '');
        mediaHtml = `
          <div class="media placeholder faded">
            <div class="preview-faded">Media disponibilă</div>
            <button class="btn btn-outline btn-sm fetch-media" data-mid="${safeId}">Descarcă media</button>
          </div>`;
      }
      const textHtml = m.text ? `<div class="text">${utils.escapeHtml(m.text)}</div>` : '';
      const mid = utils.escapeHtml(m.id || '');
      return `
      <div class="msg ${m.from === 'me' ? 'from-me' : 'from-them'}" data-mid="${mid}">
        <div class="bubble">${mediaHtml}${textHtml}</div>
        <div class="meta">${new Date(m.at).toLocaleTimeString('ro-RO')} ${m.from==='me' && m.status ? (' · ' + m.status) : ''}</div>
      </div>`;
    }).join('');
    if (replace) {
      threadEl.innerHTML = html;
      threadEl.scrollTop = threadEl.scrollHeight;
      this.pruneChatMessages(threadEl);
      // Bind fetch-media buttons (înlocuiește doar mesajul vizat, fără reîncărcarea întregului thread)
      threadEl.querySelectorAll('.fetch-media').forEach(btn => {
        if (!btn._bound) {
          btn._bound = true;
          btn.addEventListener('click', async () => {
            const mid = btn.getAttribute('data-mid');
            try {
              btn.disabled = true;
              const res = await utils.apiRequest(`/whatsapp/message/media?phone=${encodeURIComponent(this._activeChatPhone)}&id=${encodeURIComponent(mid)}`);
              const data = await utils.handleApiResponse(res);
              const container = threadEl.querySelector(`.msg[data-mid="${CSS.escape(mid)}"] .bubble`);
              if (container && data && data.url && data.mimetype) {
                const mime = String(data.mimetype || '').toLowerCase();
                let replacement = '';
                if (mime.startsWith('image/')) {
                  replacement = `<div class="media"><img loading="lazy" src="${data.url}" alt="img"/></div>`;
                } else if (mime.startsWith('video/')) {
                  replacement = `<div class="media"><video preload="none" src="${data.url}" controls></video></div>`;
                } else if (mime.startsWith('audio/')) {
                  replacement = `<div class="media"><audio preload="none" src="${data.url}" controls></audio></div>`;
                } else {
                  const fn = utils.escapeHtml(data.filename || 'fișier');
                  replacement = `<div class="media"><a href="${data.url}" download="${fn}">Descarcă ${fn}</a></div>`;
                }
                // înlocuiește placeholderul din acest mesaj
                const ph = container.querySelector('.media.placeholder');
                if (ph) ph.outerHTML = replacement;
              }
            } catch(_) {}
            finally { btn.disabled = false; }
          });
        }
      });
      return;
    }
    if (prepend) {
      const temp = document.createElement('div');
      temp.innerHTML = html;
      const frag = document.createDocumentFragment();
      Array.from(temp.children).forEach(child => frag.appendChild(child));
      threadEl.insertBefore(frag, threadEl.firstChild);
      this.pruneChatMessages(threadEl);
      return;
    }
    threadEl.insertAdjacentHTML('beforeend', html);
    threadEl.scrollTop = threadEl.scrollHeight;
    this.pruneChatMessages(threadEl);
  }

  pruneChatMessages(container) {
    try {
      const max = this._chatMaxDom || 300;
      if (!container || container.childElementCount <= max) return;
      // prune doar când utilizatorul e aproape de bottom, ca să nu sară view-ul
      const nearBottom = (container.scrollHeight - container.scrollTop - container.clientHeight) < 80;
      if (!nearBottom) return;
      const toRemove = container.childElementCount - max;
      for (let i = 0; i < toRemove; i++) {
        const first = container.firstElementChild;
        if (first) container.removeChild(first);
      }
    } catch (_) {}
  }

  async sendChatMessage(phone, opts = {}) {
    const activePhone = this._activeChatPhone || phone;
    if (!activePhone) return;
    const input = opts.fromModal ? document.getElementById('chat-modal-input') : document.getElementById('chat-input');
    const text = (input && input.value || '').trim();
    if (!text) return;
    if (this._isSending) return;
    try {
      this._isSending = true;
      this.updateChatSendState();
      const entropy = Math.random().toString(36).slice(2);
      const idempotencyKey = `${Date.now().toString(36)}-${entropy}`;
      this._lastIdemKeyByPhone.set(activePhone, idempotencyKey);
      const res = await utils.apiRequest('/whatsapp/chat/send', { method: 'POST', body: JSON.stringify({ phone: activePhone, text, idempotencyKey }) });
      await utils.handleApiResponse(res);
      input.value = '';
      // Re-append thread
      await this.openChatThread(activePhone);
      await this.loadChats();
    } catch (e) {
      utils.showToast('Eroare la trimiterea mesajului', 'error');
    }
    finally {
      this._isSending = false;
      this.updateChatSendState();
    }
  }

  updateChatSendState() {
    const hasActive = !!this._activeChatPhone;
    const input = document.getElementById('chat-input');
    const send = document.getElementById('chat-send-btn');
    const modalInput = document.getElementById('chat-modal-input');
    const modalSend = document.getElementById('chat-modal-send-btn');
    const canSend = hasActive && input && input.value.trim().length > 0 && !this._isSending;
    const canSendModal = hasActive && modalInput && modalInput.value.trim().length > 0 && !this._isSending;
    if (send) send.disabled = !canSend;
    if (modalSend) modalSend.disabled = !canSendModal;
  }

  initAppEvents() {
    try {
      if (this._appEs) return;
      const es = new EventSource('/api/events');
      this._appEs = es;
      const safeRefresh = utils.debounce(() => {
        // Refresh lightweight: reload drivers and racks, then rerender active tab sections
        Promise.resolve()
          .then(() => this.loadDrivers())
          .then(() => this.loadRacks())
          .then(() => {
            if (this.currentTab === 'drivers') this.updateDriversTable();
            if (this.currentTab === 'docs') this.renderDocsTab();
            if (this.currentTab === 'dashboard') this.loadDashboardData();
          })
          .then(() => { if (window.chartsManager) window.chartsManager.refreshOnDataChange(); })
          .catch(() => {});
      }, 400);

      es.addEventListener('driver_created', safeRefresh);
      es.addEventListener('driver_updated', safeRefresh);
      es.addEventListener('driver_deleted', safeRefresh);
      es.addEventListener('driver_released', safeRefresh);
      es.addEventListener('rack_changed', safeRefresh);
      // Chat events
      const appendIncomingMessage = (msg) => {
        const messagesEl = document.getElementById('chat-thread-messages');
        if (!messagesEl) return;
        const isMe = msg.from === 'me';
        const hasMedia = !!msg.media && !!msg.mimetype;
        let mediaHtml = '';
        if (hasMedia) {
          const mime = String(msg.mimetype || '').toLowerCase();
          if (mime.startsWith('image/')) mediaHtml = `<div class="media"><img src="${msg.media}" alt="img"/></div>`;
          else if (mime.startsWith('video/')) mediaHtml = `<div class="media"><video src="${msg.media}" controls></video></div>`;
          else if (mime.startsWith('audio/')) mediaHtml = `<div class="media"><audio src="${msg.media}" controls></audio></div>`;
          else {
            const fn = utils.escapeHtml(msg.filename || 'fișier');
            mediaHtml = `<div class=\"media\"><a href=\"${msg.media}\" download=\"${fn}\">Descarcă ${fn}</a></div>`;
          }
        }
        const textHtml = msg.text ? `<div class="text">${utils.escapeHtml(msg.text)}</div>` : '';
        const html = `
          <div class=\"msg ${isMe ? 'from-me' : 'from-them'}\">\n            <div class=\"bubble\">${mediaHtml}${textHtml}</div>\n            <div class=\"meta\">${new Date(msg.at).toLocaleTimeString('ro-RO')} ${isMe && msg.status ? (' · ' + msg.status) : ''}</div>\n          </div>`;
        messagesEl.insertAdjacentHTML('beforeend', html);
        messagesEl.scrollTop = messagesEl.scrollHeight;
      };
      const updateLastSentStatus = (status) => {
        const messagesEl = document.getElementById('chat-thread-messages');
        if (!messagesEl) return;
        const items = Array.from(messagesEl.querySelectorAll('.msg.from-me .meta'));
        if (!items.length) return;
        const last = items[items.length - 1];
        const timeStr = last.textContent.split(' · ')[0] || last.textContent;
        last.textContent = `${timeStr} · ${status}`;
      };

      es.addEventListener('chat_sent', (ev) => {
        try {
          const data = JSON.parse(ev.data || '{}');
          if (this._activeChatPhone && data && data.phone === this._activeChatPhone) {
            // De-dupe: verifică indexul înainte de append
            const phone = this._activeChatPhone;
            const idx = this._chatMsgIndexByPhone.get(phone) || new Set();
            const at = data.at || new Date().toISOString();
            const id = data.id || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
            const msg = { id, from: 'me', to: 'them', text: data.text || '', at, status: 'sent' };
            const key = (msg.id || `${msg.from}|${msg.to}|${msg.at}|${msg.text||''}`);
            if (!idx.has(key)) {
              idx.add(key);
              this._chatMsgIndexByPhone.set(phone, idx);
              appendIncomingMessage(msg);
            }
          }
          if (this.currentTab === 'chat') this.loadChats();
        } catch (_) {}
      });
      es.addEventListener('chat_received', (ev) => {
        try {
          const data = JSON.parse(ev.data || '{}');
          if (this._activeChatPhone && data && data.phone === this._activeChatPhone) {
            const phone = this._activeChatPhone;
            const idx = this._chatMsgIndexByPhone.get(phone) || new Set();
            const at = data.at || new Date().toISOString();
            const id = data.id || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
            const msg = { id, from: 'them', to: 'me', text: data.text || '', at, status: 'received' };
            const key = (msg.id || `${msg.from}|${msg.to}|${msg.at}|${msg.text||''}`);
            if (!idx.has(key)) {
              idx.add(key);
              this._chatMsgIndexByPhone.set(phone, idx);
              appendIncomingMessage(msg);
            }
          }
          if (this.currentTab === 'chat') this.loadChats();
        } catch (_) {}
      });
      es.addEventListener('chat_status', (ev) => {
        try {
          const data = JSON.parse(ev.data || '{}');
          if (this._activeChatPhone && data && data.phone === this._activeChatPhone && data.status) {
            updateLastSentStatus(data.status);
          }
        } catch (_) {}
      });

      es.addEventListener('chat_read', () => {
        if (this.currentTab === 'chat') this.loadChats();
      });

      es.addEventListener('chat_hydrated', async (ev) => {
        try {
          const data = JSON.parse(ev.data || '{}');
          if (this._activeChatPhone && data && data.phone === this._activeChatPhone) {
            // Refresh ușor: fetch mesaje și rerender fără skeleton, păstrând scroll
            const threadEl = document.getElementById('chat-thread-messages');
            const prevScroll = threadEl ? threadEl.scrollTop : null;
            const res = await utils.apiRequest(`/whatsapp/messages?phone=${encodeURIComponent(this._activeChatPhone)}&offset=0&limit=${this._chatLimit||50}&fast=1`);
            const d = await utils.handleApiResponse(res);
            const msgs = Array.isArray(d.messages) ? d.messages : [];
            this.renderChatMessages(msgs, { replace: true });
            if (threadEl && prevScroll !== null) threadEl.scrollTop = prevScroll;
            try { this._threadCache.set(this._activeChatPhone, { messages: msgs, total: d.total || msgs.length, ts: Date.now() }); } catch(_) {}
          }
        } catch (_) {}
      });
      es.addEventListener('chat_typing', (evt) => {
        try {
          const data = JSON.parse(evt.data || '{}');
          const typingEl = document.getElementById('chat-typing');
        if (!typingEl) return;
          if (this._activeChatPhone && data.phone === this._activeChatPhone) {
            typingEl.style.display = data.typing ? 'block' : 'none';
          }
        } catch (_) {}
      });
    } catch (e) {
      console.warn('SSE app events not available:', e.message);
    }
  }

  /**
   * Bind modal events
   */
  bindModalEvents() {
    // Driver modal
    const driverModal = document.getElementById('driver-modal');
    const driverModalClose = document.getElementById('driver-modal-close');
    const driverModalCancel = document.getElementById('driver-modal-cancel');
    const driverForm = document.getElementById('driver-form');

    if (driverModalClose) {
      driverModalClose.addEventListener('click', () => this.closeModal('driver-modal'));
    }

    if (driverModalCancel) {
      driverModalCancel.addEventListener('click', () => this.closeModal('driver-modal'));
    }

    if (driverForm) {
      driverForm.addEventListener('submit', (e) => this.handleDriverFormSubmit(e));
    }

    // Position modal
    const positionModal = document.getElementById('position-modal');
    const positionModalClose = document.getElementById('position-modal-close');

    if (positionModalClose) {
      positionModalClose.addEventListener('click', () => this.closeModal('position-modal'));
    }

    // Event delegation for position modal buttons and drivers table buttons
    document.addEventListener('click', (e) => {
      // Find the closest element with data-action attribute (handles clicks on child elements)
      const actionElement = e.target.closest('[data-action]');
      if (!actionElement) return;
      
      const action = actionElement.dataset.action;
      const driverId = parseInt(actionElement.dataset.driverId);
      
      
      switch (action) {
        case 'close-modal':
          const modalId = actionElement.dataset.modal;
          this.closeModal(modalId);
          break;
        case 'edit-driver':
          this.editDriver(driverId);
          break;
        case 'release-driver':
          this.releaseDriver(driverId);
          break;
        case 'edit':
          this.editDriver(driverId);
          break;
        case 'delete':
          this.deleteDriver(driverId);
          break;
      }
    });

    // Close modals when clicking outside
    document.addEventListener('click', (e) => {
      if (e.target.classList.contains('modal')) {
        this.closeModal(e.target.id);
      }
    });

    // Close modals with Escape key
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        this.closeAllModals();
      }
    });
  }

  /**
   * Load initial data
   */
  async loadInitialData() {
    const startTime = Date.now();
    const minLoadingTime = 2000; // Minimum 2 seconds loading screen
    
    try {
      console.log('🔄 Starting to load initial data...');
      
      await Promise.all([
        this.loadDashboardData(),
        this.loadDrivers(),
        this.loadRacks(),
        this.loadNotifications()
      ]);
      
      console.log('✅ Initial data loaded successfully');
      
      // Initialize charts if charts manager exists
      if (window.chartsManager) {
        window.chartsManager.refreshOnDataChange();
      }
      
      // Calculate remaining time to show loading screen
      const elapsedTime = Date.now() - startTime;
      const remainingTime = Math.max(0, minLoadingTime - elapsedTime);
      
      console.log(`🎉 All data loaded, showing loading screen for ${remainingTime}ms more...`);
      
      // Wait for minimum loading time
      if (remainingTime > 0) {
        await new Promise(resolve => setTimeout(resolve, remainingTime));
      }
      
      console.log('🎉 Hiding loading screen...');
      
      // Hide loading screen
      const loadingScreen = document.getElementById('loading-screen');
      const mainApp = document.getElementById('main-app');
      
      if (loadingScreen) {
        loadingScreen.classList.add('hidden');
        console.log('✅ Loading screen hidden');
      }
      
      if (mainApp) {
        mainApp.classList.remove('hidden');
        console.log('✅ Main app shown');
      }
      
    } catch (error) {
      console.error('❌ Error loading initial data:', error);
      utils.showToast('Eroare la încărcarea datelor', 'error');
      
      // Calculate remaining time to show loading screen even on error
      const elapsedTime = Date.now() - startTime;
      const remainingTime = Math.max(0, minLoadingTime - elapsedTime);
      
      if (remainingTime > 0) {
        await new Promise(resolve => setTimeout(resolve, remainingTime));
      }
      
      // Hide loading screen even on error
      const loadingScreen = document.getElementById('loading-screen');
      const mainApp = document.getElementById('main-app');
      
      if (loadingScreen) {
        loadingScreen.classList.add('hidden');
      }
      
      if (mainApp) {
        mainApp.classList.remove('hidden');
      }
    }
  }

  /**
   * Switch between tabs
   */
  switchTab(e) {
    e.preventDefault();
    
    const tabName = e.currentTarget.dataset.tab;
    if (!tabName || tabName === this.currentTab) return;
    // Cleanup for special tabs (no status tab for user UI)
 
    // Update active nav button
    document.querySelectorAll('.nav-btn').forEach(btn => {
      btn.classList.remove('active');
    });
    e.currentTarget.classList.add('active');

    // Update active tab content
    document.querySelectorAll('.tab-content').forEach(tab => {
      tab.classList.remove('active');
    });
    
    const targetTab = document.getElementById(`${tabName}-tab`);
    if (targetTab) {
      targetTab.classList.add('active');
    }

    this.currentTab = tabName;

    // Drivers tab must always show baza de date completă
    if (tabName === 'drivers') {
      this.activeDriverFilter = null;
    }

    // Load tab-specific data
    this.loadTabData(tabName);

    // Control page scrolling for Chat tab
    if (tabName === 'chat') {
      document.body.classList.add('no-page-scroll');
    } else {
      document.body.classList.remove('no-page-scroll');
    }
  }

  /**
   * Load data for specific tab
   */
  async loadTabData(tabName) {
    try {
      switch (tabName) {
        case 'dashboard':
          await this.loadDashboardData();
          break;
        case 'drivers':
          await this.loadDrivers();
          break;
        case 'racks':
          await this.loadRacks();
          break;
        case 'charts':
          await this.loadChartsData();
          break;
        case 'notifications':
          await this.loadNotifications();
          break;
        case 'docs':
          await this.renderDocsTab();
          break;
        case 'chat':
          // setează implicit Contacts prima dată când intrăm în Chat
          if (!this._chatMode) this._chatMode = 'contacts';
          await this.loadChats();
          break;
        case 'status':
          await this.loadStatusMetrics();
          break;
      }
    } catch (error) {
      console.error(`Error loading ${tabName} data:`, error);
      utils.showToast(`Eroare la încărcarea datelor pentru ${tabName}`, 'error');
    }
  }

  /**
   * Load and render status metrics
   */
  async loadStatusMetrics() {
    try {
      await this.fetchAndRenderMetrics();
      // Poll every 3s while on status tab
      if (this._statusInterval) clearInterval(this._statusInterval);
      this._statusInterval = setInterval(() => {
        if (this.currentTab !== 'status') {
          clearInterval(this._statusInterval);
          this._statusInterval = null;
          return;
        }
        this.fetchAndRenderMetrics();
      }, 3000);

      // Bind refresh button
      const refreshBtn = document.getElementById('refresh-status-btn');
      if (refreshBtn && !refreshBtn._bound) {
        refreshBtn.addEventListener('click', () => this.fetchAndRenderMetrics());
        refreshBtn._bound = true;
      }
    } catch (err) {
      console.error('Error loading metrics:', err);
      utils.showToast('Eroare la încărcarea metricilor', 'error');
    }
  }

  /**
   * Render Valabilitate Acte tab
   */
  async renderDocsTab() {
    const container = document.getElementById('docs-list');
    if (!container) return;
    const drivers = this.drivers || [];
    // Bind search & filter once
    const searchEl = document.getElementById('docs-search');
    const filterEl = document.getElementById('docs-expiry-filter');
    const globalPresetEl = document.getElementById('docs-global-preset');
    const globalSaveBtn = document.getElementById('docs-global-save');
    if (searchEl && !searchEl._bound) {
      searchEl._bound = true;
      searchEl.addEventListener('input', utils.debounce(() => this.renderDocsTab(), 200));
    }
    if (filterEl && !filterEl._bound) {
      filterEl._bound = true;
      filterEl.addEventListener('change', () => this.renderDocsTab());
    }
    if (globalPresetEl && !globalPresetEl._bound) {
      globalPresetEl._bound = true;
      // Load current default 'docs' on focus once
      globalPresetEl.addEventListener('focus', async () => {
        try {
          const res = await utils.apiRequest('/whatsapp/default-messages');
          const data = await utils.handleApiResponse(res);
          const txt = data.messages && data.messages.docs || '';
          if (txt && !globalPresetEl.value) globalPresetEl.value = txt;
        } catch(_) {}
      }, { once: true });
    }
    if (globalSaveBtn && !globalSaveBtn._bound) {
      globalSaveBtn._bound = true;
      globalSaveBtn.addEventListener('click', async () => {
        const txt = (globalPresetEl && globalPresetEl.value || '').trim();
        try {
          await utils.apiRequest('/whatsapp/default-messages', { method: 'POST', body: JSON.stringify({ key: 'docs', text: txt }) });
          utils.showToast('Mesaj automat salvat pentru Acte', 'success');
        } catch (e) {
          utils.showToast('Eroare la salvare mesaj automat', 'error');
        }
      });
    }
    // Restore persisted filters
    if (searchEl && !searchEl.value && localStorage.getItem('docsSearch')) searchEl.value = localStorage.getItem('docsSearch');
    if (filterEl && !filterEl.value && localStorage.getItem('docsExpiry')) filterEl.value = localStorage.getItem('docsExpiry');
    const q = (searchEl && searchEl.value || '').trim().toLowerCase();
    const daysFilter = parseInt(filterEl && filterEl.value || '0', 10);
    // Persist filters
    if (searchEl) localStorage.setItem('docsSearch', q);
    if (filterEl) localStorage.setItem('docsExpiry', String(isNaN(daysFilter) ? 'all' : daysFilter));
    const matchesQuery = (d) => !q || (`${d.firstName} ${d.lastName}`.toLowerCase().includes(q));
    const anyExpiringWithin = (d, days) => {
      if (!days || isNaN(days)) return true;
      const fields = [d.idExpiryDate, d.passportExpiryDate, d.licenseExpiryDate, d.tachoExpiryDate, d.atestatExpiryDate, d.adrExpiryDate];
      return fields.some(x => utils.isExpirySoon(x, days));
    };
    // Dacă există un filtru de zile, ia direct din server filtrat (evităm procesare în browser)
    let sourceDrivers = drivers;
    if (!isNaN(daysFilter) && daysFilter > 0) {
      try {
        const res = await utils.apiRequest(`/drivers?expiryDays=${daysFilter}`);
        const data = await utils.handleApiResponse(res);
        sourceDrivers = data.drivers || drivers;
      } catch (_) { /* fallback: folosim lista locală */ }
    }
    const filtered = sourceDrivers.filter(d => matchesQuery(d) && anyExpiringWithin(d, isNaN(daysFilter) || daysFilter === 0 ? null : daysFilter));
    const exp = (d) => utils.formatDate(d) || '-';
    const soon = (d) => utils.isExpirySoon(d, 90);
    const makeItem = (label, date) => {
      const cls = soon(date) ? 'driver-doc-item doc-expiring' : 'driver-doc-item';
      return `<div class="${cls}"><span class="label">${label}</span><span class="date">${exp(date)}</span></div>`;
    };
    const banner = (!isNaN(daysFilter) && daysFilter > 0)
      ? `<div class="status-badge" style="margin-bottom:6px; background: rgba(100,255,218,0.08); border:1px solid rgba(100,255,218,0.3);">Filtru activ: expiră în ≤ ${daysFilter} zile</div>`
      : '';
    container.innerHTML = banner + filtered.map(d => {
      return `
        <div class="driver-doc-card">
          <div class="driver-doc-header">
            <div class="driver-doc-name">${d.firstName} ${d.lastName}</div>
            <div class="driver-doc-phone">${utils.formatPhone(d.phone)}</div>
          </div>
          <div class="driver-doc-items">
            ${makeItem('CI', d.idExpiryDate)}
            ${makeItem('Pașaport', d.passportExpiryDate)}
            ${makeItem('Permis', d.licenseExpiryDate)}
            ${makeItem('Card Tahograf', d.tachoExpiryDate)}
            ${makeItem('Atestat', d.atestatExpiryDate)}
            ${makeItem('Atestat ADR', d.adrExpiryDate)}
          </div>
          <div class="driver-doc-actions" style="margin-top:6px; display:flex; justify-content:flex-end; gap:8px;">
            <button class="dropdown-btn doc-edit-btn" data-id="${d.id}" aria-label="Editează valabilitate acte pentru ${d.firstName} ${d.lastName}">Editează valabilitate</button>
          </div>
        </div>
      `;
    }).join('');

    // Bind edit buttons
    container.querySelectorAll('.doc-edit-btn').forEach(btn => {
      if (!btn._bound) {
        btn._bound = true;
        btn.addEventListener('click', () => {
          const id = btn.getAttribute('data-id');
          if (id) this.editDriver(id);
        });
      }
    });
    // Removed send preset UI in Docs tab
  }

  async fetchAndRenderMetrics() {
    const container = document.getElementById('status-metrics');
    if (!container) return;
    try {
      if (this._metricsLoading) return; // prevent parallel fetches
      this._metricsLoading = true;
      const res = await fetch('/api/metrics');
      const data = await res.json();
      this.renderMetrics(container, data);
      const tsEl = document.getElementById('status-last-updated');
      if (tsEl) tsEl.textContent = `Ultima actualizare: ${new Date().toLocaleTimeString('ro-RO')}`;
    } catch (e) {
      // Keep previous data; just show a small transient warning
      utils.showToast('Nu pot încărca metricile acum', 'warning', 1500);
    }
    finally {
      this._metricsLoading = false;
    }
  }

  renderMetrics(container, m) {
    const card = (title, value) => `
      <div class="stat-card">
        <div class="stat-icon"><i class="fas fa-info-circle"></i></div>
        <div class="stat-content">
          <h3>${value}</h3>
          <p>${title}</p>
        </div>
      </div>`;

    const httpByStatus = Object.entries(m.httpRequests?.byStatus || {}).map(([k,v])=>`${k}: ${v}`).join(', ');
    const httpByMethod = Object.entries(m.httpRequests?.byMethod || {}).map(([k,v])=>`${k}: ${v}`).join(', ');

    container.innerHTML = `
      ${card('Uptime (s)', Math.floor(m.uptime || 0))}
      ${card('HTTP Total', m.httpRequests?.total || 0)}
      ${card('HTTP pe metode', httpByMethod || '-')}
      ${card('HTTP pe status', httpByStatus || '-')}
      ${card('WA Conectări', m.whatsapp?.connected || 0)}
      ${card('WA Deconectări', m.whatsapp?.disconnected || 0)}
      ${card('WA Mesaje trimise', m.whatsapp?.messagesSent || 0)}
      ${card('WA Mesaje eșuate', m.whatsapp?.messagesFailed || 0)}
      ${card('Șoferi adăugați', m.drivers?.added || 0)}
      ${card('Șoferi actualizați', m.drivers?.updated || 0)}
      ${card('Șoferi șterși', m.drivers?.deleted || 0)}
      ${card('Rafturi ocupate', m.racks?.occupied || 0)}
      ${card('Rafturi eliberate', m.racks?.released || 0)}
      ${card('Transferuri raft', m.racks?.transfers || 0)}
    `;
  }

  /**
   * Load charts data
   */
  async loadChartsData() {
    try {
      console.log('App: Loading charts data...');
      // Wait a bit for the tab to become visible, then trigger chart rendering
      setTimeout(() => {
        if (window.chartsManager) {
          console.log('App: Triggering chart refresh...');
          window.chartsManager.refreshCharts();
        } else {
          console.log('App: ChartsManager not available yet');
        }
      }, 300);
    } catch (error) {
      console.error('Error loading charts data:', error);
    }
  }

  async loadSettingsData() {
    try {
      console.log('App: Loading settings data...');
      
      // WhatsApp status check removed
      
      // Load profile picture if exists
      const savedPicture = localStorage.getItem('profile-picture');
      if (savedPicture) {
        const preview = document.getElementById('profile-picture-preview');
        const uploadBtn = document.getElementById('upload-profile-picture-btn');
        const removeBtn = document.getElementById('remove-profile-picture-btn');
        const dropdownPreview = document.getElementById('dropdown-profile-picture');
        const dropdownUploadBtn = document.getElementById('dropdown-upload-profile-picture-btn');
        const dropdownRemoveBtn = document.getElementById('dropdown-remove-profile-picture-btn');
        const headerAvatar = document.getElementById('header-profile-picture');
        
        // Update settings tab (if exists)
        if (preview && uploadBtn && removeBtn) {
          preview.src = savedPicture;
          uploadBtn.style.display = 'none';
          removeBtn.style.display = 'inline-flex';
        }
        
        // Update dropdown
        if (dropdownPreview && dropdownUploadBtn && dropdownRemoveBtn) {
          dropdownPreview.src = savedPicture;
          dropdownUploadBtn.style.display = 'none';
          dropdownRemoveBtn.style.display = 'inline-flex';
        }
        
        if (headerAvatar) {
          headerAvatar.src = savedPicture;
        }
      }
      
      console.log('App: Settings data loaded successfully');
    } catch (error) {
      console.error('Error loading settings data:', error);
    }
  }

  /**
   * Load dashboard data
   */
  async loadDashboardData() {
    try {
      const [driversResponse, racksResponse] = await Promise.all([
        utils.apiRequest('/drivers'),
        utils.apiRequest('/racks/statistics')
      ]);

      const driversData = await utils.handleApiResponse(driversResponse);
      const racksData = await utils.handleApiResponse(racksResponse);

      this.drivers = driversData.drivers || [];
      this.updateDashboardStats(racksData.statistics);
      this.updateRackGrid();
    } catch (error) {
      console.error('Error loading dashboard data:', error);
      throw error;
    }
  }

  /**
   * Load drivers data
   */
  async loadDrivers() {
    try {
      const response = await utils.apiRequest('/drivers');
      const data = await utils.handleApiResponse(response);
      
      this.drivers = data.drivers || [];

      // Tabul "Șoferi" este baza – afișăm mereu toți șoferii
      this.updateDriversTable();
    } catch (error) {
      console.error('Error loading drivers:', error);
      throw error;
    }
  }

  /**
   * Load racks data
   */
  async loadRacks() {
    try {
      const response = await utils.apiRequest('/racks');
      const data = await utils.handleApiResponse(response);
      
      this.racks = data.racks || [];
      this.updateRacksGrid();
      // Load settings for lock code and update header
      try {
        const s = await utils.apiRequest('/settings');
        const sd = await utils.handleApiResponse(s);
        const lc = sd && sd.settings && sd.settings.lockCode ? String(sd.settings.lockCode) : '';
        const inp = document.getElementById('lock-code-input');
        if (inp && !inp.value) inp.value = lc || '';
        const btn = document.getElementById('lock-code-save');
        if (btn && inp) {
          btn.onclick = async () => {
            try {
              const nv = String(inp.value || '').trim();
              const r = await utils.apiRequest('/settings', { method: 'POST', body: JSON.stringify({ lockCode: nv }) });
              const sd2 = await utils.handleApiResponse(r);
              const lc2 = sd2 && sd2.settings && sd2.settings.lockCode ? String(sd2.settings.lockCode) : '';
              
              // Actualizează instant câmpul "Cod Dulap" în modalul deschis (dacă există)
              const lockerInput = document.getElementById('driver-locker-code');
              if (lockerInput && lc2) {
                lockerInput.value = lc2;
              }
              
              utils.showToast('Cod Lacăt actualizat', 'success');
            } catch (e) {
              utils.showToast('Eroare la salvarea Codului Lacăt', 'error');
            }
          };
        }
      } catch (_) {}
    } catch (error) {
      console.error('Error loading racks:', error);
      throw error;
    }
  }

  /**
   * Load notifications data
   */
  async loadNotifications() {
    try {
      const response = await utils.apiRequest('/notifications');
      const data = await utils.handleApiResponse(response);
      
      this.notifications = data.notifications || [];
      this.updateNotificationsList();
    } catch (error) {
      console.error('Error loading notifications:', error);
      throw error;
    }
  }


  /**
   * Update dashboard statistics
   */
  updateDashboardStats(stats) {
    const elements = {
      'active-drivers-count': stats.drivers?.active || 0,
      'occupied-racks-count': stats.racks?.ocupat || 0,
      'free-racks-count': stats.racks?.liber || 0,
      'returning-soon-count': stats.drivers?.vineAcasa || 0,
      'home-drivers-count': stats.drivers?.acasa || 0,
      'coming-to-work-count': stats.drivers?.catreSediu || 0
    };

    Object.entries(elements).forEach(([id, value]) => {
      const element = document.getElementById(id);
      if (element) {
        element.textContent = value;
      }
    });
  }

  /**
   * Update rack grid
   */
  updateRackGrid() {
    const rackGrid = document.getElementById('rack-grid');
    if (!rackGrid) return;
    // Render toate cele 1000 poziții (aspect profesional + scroll)
    const fragment = document.createDocumentFragment();
    for (let i = 1; i <= 1000; i++) {
      const position = document.createElement('div');
      position.className = 'rack-position';
      position.dataset.position = i;
      position.textContent = i;

      const driver = this.drivers.find(d => d.rackPosition === i);
      if (driver) {
        const calculatedStatus = this.calculateDriverStatus(driver);
        if (calculatedStatus === 'activ' || calculatedStatus === 'vine_acasa' || calculatedStatus === 'catre_casa') {
          const daysUntilReturn = utils.getDaysUntilReturn(driver.estimatedReturnDate);
          const status = utils.getStatusColor(daysUntilReturn);
          position.classList.add(status);
          // Glow portocaliu dacă diferența este 1..7 zile (Vine Acasă)
          if (daysUntilReturn >= 1 && daysUntilReturn <= 7) {
            position.classList.add('sosire_apropiata');
          }
          position.title = `${driver.firstName} ${driver.lastName} - ${driver.carNumber} (${calculatedStatus})`;
        } else {
          position.classList.add('liber');
        }
      } else {
        position.classList.add('liber');
      }
      position.addEventListener('click', (e) => this.handleRackPositionClick(e));
      fragment.appendChild(position);
    }
    rackGrid.innerHTML = '';
    rackGrid.appendChild(fragment);
  }

  /**
   * Update drivers table
   */
  updateDriversTable(driversToShow = null) {
    const tbody = document.getElementById('drivers-table-body');
    if (!tbody) return;

    // Fără paginare: afișează toți șoferii, containerul devine scrollabil
    const driversToDisplay = driversToShow || this.drivers;

    tbody.innerHTML = '';
    driversToDisplay.forEach(driver => {
      const calculatedStatus = this.calculateDriverStatus(driver);
      const statusInfo = this.getStatusInfo(calculatedStatus);
      const row = document.createElement('tr');
      row.innerHTML = `
        <td>${driver.firstName} ${driver.lastName}</td>
        <td>${utils.formatPhone(driver.phone)}</td>
        <td>${utils.formatCarNumber(driver.carNumber)}</td>
        <td>${driver.rackPosition || '-'}</td>
        <td>${utils.formatDate(driver.departureDate)}</td>
        <td>${utils.formatDate(driver.estimatedReturnDate)}</td>
        <td>
          <span class="status-badge ${statusInfo.class}">${statusInfo.text}</span>
        </td>
        <td>
          <div class="action-buttons">
            <button class="action-btn edit" data-action="edit" data-driver-id="${driver.id}" title="Editează"><i class="fas fa-edit"></i></button>
            <button class="action-btn delete" data-action="delete" data-driver-id="${driver.id}" title="Șterge"><i class="fas fa-trash"></i></button>
          </div>
        </td>`;
      tbody.appendChild(row);
    });
    // Elimină pager-ul dacă există
    const pager = document.getElementById('drivers-pager');
    if (pager && pager.parentNode) pager.parentNode.removeChild(pager);
  }

  /**
   * Update racks grid
   */
  updateRacksGrid() {
    const racksGrid = document.getElementById('rack-grid');
    if (!racksGrid) return;

    racksGrid.innerHTML = '';

    this.racks.forEach(rack => {
      const position = document.createElement('div');
      position.className = `rack-position ${rack.status}`;
      position.dataset.position = rack.positionNumber;
      position.textContent = rack.positionNumber;

      if (rack.driver) {
        position.title = `${rack.driver.firstName} ${rack.driver.lastName} - ${rack.driver.carNumber}`;
      }

      position.addEventListener('click', (e) => this.handleRackPositionClick(e));
      racksGrid.appendChild(position);
    });
  }

  /**
   * Update notifications list
   */
  updateNotificationsList() {
    const notificationsList = document.getElementById('notifications-list');
    if (!notificationsList) return;

    notificationsList.innerHTML = '';

    if (this.notifications.length === 0) {
      notificationsList.innerHTML = '<p style="text-align: center; color: var(--text-gray); padding: 2rem;">Nu există notificări</p>';
      return;
    }

    this.notifications.forEach(notification => {
      const item = document.createElement('div');
      item.className = `notification-item ${notification.isRead ? 'read' : 'unread'}`;
      item.innerHTML = `
        <div class="notification-content">
          <h4>${notification.title}</h4>
          <p>${notification.message}</p>
          <span class="notification-time">${utils.getTimeAgo(notification.createdAt)}</span>
        </div>
        ${!notification.isRead ? '<div class="notification-dot"></div>' : ''}
      `;
      // Mark as read locally on click
      item.addEventListener('click', async () => {
        try {
          // optional server call, dacă există endpoint; altfel doar local
          notification.isRead = true;
          item.classList.remove('unread');
          item.classList.add('read');
          const dot = item.querySelector('.notification-dot');
          if (dot) dot.remove();
        } catch (_) {}
      });
      notificationsList.appendChild(item);
    });
  }

  /**
   * Handle rack position click
   */
  handleRackPositionClick(e) {
    const positionNumber = parseInt(e.currentTarget.dataset.position);
    // Look for any driver at this position (regardless of status)
    const driver = this.drivers.find(d => d.rackPosition === positionNumber);

    if (driver) {
      this.showPositionDetails(positionNumber, driver);
    } else {
      this.openAddDriverModal(null, positionNumber);
    }
  }

  /**
   * Show position details modal
   */
  showPositionDetails(positionNumber, driver) {
    const modal = document.getElementById('position-modal');
    const title = document.getElementById('position-modal-title');
    const body = document.getElementById('position-modal-body');
    const footer = document.getElementById('position-modal-footer');

    if (!modal || !title || !body || !footer) return;

    title.textContent = `Detalii Poziție ${positionNumber}`;
    
    body.innerHTML = `
      <div class="position-details scrollable-details">
        <h3>${driver.firstName} ${driver.lastName}</h3>
        <div class="detail-row">
          <span class="detail-label">Telefon:</span>
          <span class="detail-value">${utils.formatPhone(driver.phone)}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Număr Mașină:</span>
          <span class="detail-value">${utils.formatCarNumber(driver.carNumber)}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Poziție Raft:</span>
          <span class="detail-value">${driver.rackPosition}</span>
        </div>
        ${driver.lockerCode ? `
        <div class="detail-row">
          <span class="detail-label">Cod Dulap:</span>
          <span class="detail-value">${driver.lockerCode}</span>
        </div>
        ` : ''}
        <div class="detail-row">
          <span class="detail-label">Data Plecării:</span>
          <span class="detail-value">${utils.formatDateTime(driver.departureDate)}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Data Sosirii:</span>
          <span class="detail-value">${utils.formatDateTime(driver.estimatedReturnDate)}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Status:</span>
          <span class="status-badge ${driver.status}">${driver.status}</span>
        </div>
        <hr style="border-color: rgba(255,255,255,0.1); margin: 8px 0;" />
        <div class="detail-row"><span class="detail-label">Acte:</span><span class="detail-value">&nbsp;</span></div>
        ${(() => {
          const exp = (d) => d ? utils.formatDate(d) : '-';
          const soon = (d) => utils.isExpirySoon ? utils.isExpirySoon(d, 90) : false;
          const badge = (label, date) => `<div class=\"doc-item ${soon(date) ? 'doc-expiring' : ''}\"><span class=\"doc-label\">${label}</span><span class=\"doc-date\">${exp(date)}</span></div>`;
          return `
            <div class=\"docs-grid\">
              ${badge('CI', driver.idExpiryDate)}
              ${badge('Pașaport', driver.passportExpiryDate)}
              ${badge('Permis', driver.licenseExpiryDate)}
              ${badge('Card Tahograf', driver.tachoExpiryDate)}
              ${badge('Atestat', driver.atestatExpiryDate)}
              ${badge('Atestat ADR', driver.adrExpiryDate)}
            </div>
          `;
        })()}
      </div>
    `;

    footer.innerHTML = `
      <button class="btn btn-secondary" data-action="close-modal" data-modal="position-modal">Închide</button>
      <button class="btn btn-primary" data-action="edit-driver" data-driver-id="${driver.id}">Editează Șofer</button>
      <button class="btn btn-secondary" data-action="release-driver" data-driver-id="${driver.id}">Eliberează Poziția</button>
    `;

    this.openModal('position-modal');
  }

  /**
   * Open add driver modal
   */
  openAddDriverModal(e, positionNumber = null) {
    if (e) e.preventDefault();

    const modal = document.getElementById('driver-modal');
    const title = document.getElementById('driver-modal-title');
    const form = document.getElementById('driver-form');
    const saveBtn = document.getElementById('driver-modal-save');

    if (!modal || !title || !form || !saveBtn) return;

    title.textContent = 'Șofer Nou';
    form.reset();
    form.dataset.mode = 'add';
    saveBtn.textContent = 'Salvează';

    // Show fleet number field for new drivers
    const fleetNumberGroup = document.getElementById('fleet-number-group');
    if (fleetNumberGroup) {
      fleetNumberGroup.style.display = 'block';
    }

    // Set default dates and times and add validation
    const departureDateTimeInput = document.getElementById('driver-departure-datetime');
    const returnDateTimeInput = document.getElementById('driver-return-datetime');
    
    if (departureDateTimeInput && returnDateTimeInput) {
      // Set current local date/time for departure (+1 minut)
      const now = new Date();
      const addMinutes = (d, m) => { const x = new Date(d); x.setMinutes(x.getMinutes() + m); return x; };
      const pad = (n) => String(n).padStart(2, '0');
      const toLocalInput = (d) => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

      const dep = addMinutes(now, 1);
      departureDateTimeInput.value = toLocalInput(dep);
      departureDateTimeInput.removeAttribute('min');

      // Return date = +49 zile
      const ret = new Date(dep); ret.setDate(ret.getDate() + 49);
      returnDateTimeInput.value = toLocalInput(ret);
      returnDateTimeInput.min = toLocalInput(dep);

      departureDateTimeInput.onchange = () => { this.autoUpdateReturnDateTime(); this.validateDateTime(); };
      returnDateTimeInput.onchange = () => this.validateDateTime();
      const firstNameInput = document.getElementById('driver-first-name');
      if (firstNameInput) firstNameInput.focus();
    }

    // Auto-complete din BD (lista curentă de șoferi încărcată) – NU din browser
    const firstNameEl = document.getElementById('driver-first-name');
    const lastNameEl = document.getElementById('driver-last-name');
    const phoneEl = document.getElementById('driver-phone');
    const carEl = document.getElementById('driver-car-number');
    const lockerEl = document.getElementById('driver-locker-code');
    const fleetEl = document.getElementById('driver-fleet-number');

    // Elemente pentru acte
    const idExpiryEl = document.getElementById('id-expiry-date');
    const passportExpiryEl = document.getElementById('passport-expiry-date');
    const licIssueEl = document.getElementById('license-issue-date');
    const licExpiryEl = document.getElementById('license-expiry-date');
    const tachoIssueEl = document.getElementById('tacho-issue-date');
    const tachoExpiryEl = document.getElementById('tacho-expiry-date');
    const atestatIssueEl = document.getElementById('atestat-issue-date');
    const atestatExpiryEl = document.getElementById('atestat-expiry-date');
    const adrIssueEl = document.getElementById('adr-issue-date');
    const adrExpiryEl = document.getElementById('adr-expiry-date');

    // Blochează autofill-ul browserului pe telefon: readonly scurt + autocomplete non-standard
    if (phoneEl) {
      try { phoneEl.setAttribute('autocomplete', 'new-password'); } catch(_) {}
      try { phoneEl.setAttribute('readonly', 'readonly'); } catch(_) {}
      // Elimină readonly la primul focus sau după o mică întârziere
      const unlock = () => { try { phoneEl.removeAttribute('readonly'); } catch(_) {} };
      phoneEl.addEventListener('focus', unlock, { once: true });
      setTimeout(unlock, 400);
    }

      const tryPrefill = async () => {
      const fn = String(firstNameEl?.value || '').trim().toLowerCase();
      const ln = String(lastNameEl?.value || '').trim().toLowerCase();
      if (!fn || !ln) return;
      // caută driver existent după nume/prenume
      const existing = (this.drivers || []).find(d => {
        const dfn = String(d.firstName || '').trim().toLowerCase();
        const dln = String(d.lastName || '').trim().toLowerCase();
        return dfn === fn && dln === ln;
      });
      if (!existing) return;
      // completează doar câmpurile goale
      if (phoneEl && !phoneEl.value) {
        // Forțează precompletarea cu numărul din BD, ignorând autofillul browserului
        if (existing.phoneNormalized) {
          const prettified = window.autoFormatter.formatPhone('+' + String(existing.phoneNormalized));
          phoneEl.value = prettified || window.formatPhone(existing.phone || '');
        } else {
          phoneEl.value = window.formatPhone(existing.phone || '');
        }
      }
        if (carEl && !carEl.value) carEl.value = existing.carNumber || '';
      if (lockerEl) {
        // Folosește lockCode global dacă există; altfel locker-ul din BD
        try {
          const s = await utils.apiRequest('/settings');
          const sd = await utils.handleApiResponse(s);
          const lc = sd && sd.settings && sd.settings.lockCode ? String(sd.settings.lockCode) : '';
          // Autocompletează întotdeauna cu codul lacăt global, chiar dacă există valoare
          if (lc) {
            lockerEl.value = lc;
          } else if (existing && existing.lockerCode) {
            lockerEl.value = existing.lockerCode;
          }
        } catch (_) {
          if (existing && existing.lockerCode) {
            lockerEl.value = existing.lockerCode;
          }
        }
      }
      // Fleet number nu se precompletează - este doar pentru tracking temporar

      // Precompletare acte: doar expirări (UI simplificat)
      if (idExpiryEl && !idExpiryEl.value) idExpiryEl.value = existing.idExpiryDate || '';
      if (licExpiryEl && !licExpiryEl.value) licExpiryEl.value = existing.licenseExpiryDate || '';
      if (passportExpiryEl && !passportExpiryEl.value) passportExpiryEl.value = existing.passportExpiryDate || '';
      if (tachoExpiryEl && !tachoExpiryEl.value) tachoExpiryEl.value = existing.tachoExpiryDate || '';
      if (atestatExpiryEl && !atestatExpiryEl.value) atestatExpiryEl.value = existing.atestatExpiryDate || '';
      if (adrExpiryEl && !adrExpiryEl.value) adrExpiryEl.value = existing.adrExpiryDate || '';

      // comută în mod edit pentru a evita eroarea "Telefon deja existent"
      const formEl = document.getElementById('driver-form');
      if (formEl) {
        formEl.dataset.mode = 'edit';
        formEl.dataset.driverId = String(existing.id);
        // Păstrează eticheta ca "Salvează" pentru fluxul de re-alocare la muncă
        if (saveBtn) saveBtn.textContent = 'Salvează';
      }
    };

    if (firstNameEl) firstNameEl.addEventListener('blur', tryPrefill);
    if (lastNameEl) lastNameEl.addEventListener('blur', tryPrefill);

    // fallback: încearcă prefill și la deschidere dacă deja există valori
    tryPrefill();

    // Corectează prenumele și numele dacă utilizatorul a introdus inițial incomplet, pe baza telefonului sau numărului mașinii
    const normalizeDigits = (p) => String(p || '').replace(/\D+/g, '');
    const normalizeCar = (c) => String(c || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    const capitalize = (s) => window.formatName ? window.formatName(s) : s;

    const correctNamesFromExisting = () => {
      const phoneDigits = normalizeDigits(phoneEl?.value);
      const carNorm = normalizeCar(carEl?.value);
      let existing = null;
      if (phoneDigits) {
        existing = (this.drivers || []).find(d => {
          const dNorm = d.phoneNormalized ? String(d.phoneNormalized) : normalizeDigits(d.phone);
          return dNorm === phoneDigits;
        }) || null;
      }
      if (!existing && carNorm) existing = (this.drivers || []).find(d => normalizeCar(d.carNumber) === carNorm) || null;
      if (!existing) return;
      const typedFirst = String(firstNameEl?.value || '').trim();
      const typedLast = String(lastNameEl?.value || '').trim();
      if (typedFirst.toLowerCase() !== String(existing.firstName || '').trim().toLowerCase()) {
        if (firstNameEl) firstNameEl.value = capitalize(existing.firstName || '');
      }
      if (typedLast.toLowerCase() !== String(existing.lastName || '').trim().toLowerCase()) {
        if (lastNameEl) lastNameEl.value = capitalize(existing.lastName || '');
      }
      // Comută pe edit ca să actualizăm baza la salvare
      form.dataset.mode = 'edit';
      form.dataset.driverId = String(existing.id);
      if (saveBtn) saveBtn.textContent = 'Salvează';
    };

    if (phoneEl) phoneEl.addEventListener('blur', correctNamesFromExisting);
    if (carEl) carEl.addEventListener('blur', correctNamesFromExisting);

    // Populate rack position options first
    this.populateRackPositionOptions();
    
    // Pre-select position if provided (AFTER populating options)
    if (positionNumber) {
      const positionSelect = document.getElementById('driver-rack-position');
      if (positionSelect) {
        positionSelect.value = positionNumber.toString(); // Ensure string value
        console.log('Setting position select value to:', positionNumber);
        console.log('Position select value after setting:', positionSelect.value);
      }
    }
    
    this.openModal('driver-modal');
  }

  /**
   * Validate date/time in driver form
   */
  validateDateTime() {
    const departureDateTimeInput = document.getElementById('driver-departure-datetime');
    const returnDateTimeInput = document.getElementById('driver-return-datetime');
    
    if (!departureDateTimeInput || !returnDateTimeInput) return;
    
    const departureDateTime = new Date(departureDateTimeInput.value);
    const returnDateTime = new Date(returnDateTimeInput.value);
    
    // Clear previous errors
    departureDateTimeInput.setCustomValidity('');
    returnDateTimeInput.setCustomValidity('');
    
    // Allow dates from the past for testing purposes
    // Skip departure date validation to allow historical data entry
    
    // For drivers with status "acasa", "vine_acasa" or "catre_sediu", skip return date validation
    if (returnDateTimeInput.disabled || returnDateTimeInput.value === '') {
      return true;
    }
    
    // Validate return date/time only if it's not disabled
    if (returnDateTime <= departureDateTime) {
      returnDateTimeInput.setCustomValidity('Data și ora sosirii trebuie să fie după data și ora plecării');
      return false;
    }
    
    return true;
  }

  /**
   * Auto-update return date/time when departure changes
   */
  autoUpdateReturnDateTime() {
    const departureDateTimeInput = document.getElementById('driver-departure-datetime');
    const returnDateTimeInput = document.getElementById('driver-return-datetime');
    
    if (!departureDateTimeInput || !returnDateTimeInput) return;
    
    if (departureDateTimeInput.value) {
      const departureDateTime = new Date(departureDateTimeInput.value);
      const autoReturnDateTime = new Date(departureDateTime);
      autoReturnDateTime.setDate(autoReturnDateTime.getDate() + 49); // 7 weeks = 49 days
      returnDateTimeInput.value = autoReturnDateTime.toISOString().slice(0, 16);
      returnDateTimeInput.min = departureDateTime.toISOString().slice(0, 16);
    }
  }

  /**
   * Edit driver
   */
  async editDriver(driverId) {
    try {
      // Close position modal if it's open
      this.closeModal('position-modal');
      
      const response = await utils.apiRequest(`/drivers/${driverId}`);
      const data = await utils.handleApiResponse(response);
      const driver = data.driver;

      const modal = document.getElementById('driver-modal');
      const title = document.getElementById('driver-modal-title');
      const form = document.getElementById('driver-form');
      const saveBtn = document.getElementById('driver-modal-save');

      if (!modal || !title || !form || !saveBtn) return;

      title.textContent = 'Editează Șofer';
      form.dataset.mode = 'edit';
      form.dataset.driverId = driverId;
      saveBtn.textContent = 'Actualizează';

      // Populate form with driver data
      document.getElementById('driver-first-name').value = driver.firstName;
      document.getElementById('driver-last-name').value = driver.lastName;
      document.getElementById('driver-phone').value = driver.phone;
      document.getElementById('driver-car-number').value = driver.carNumber;
      document.getElementById('driver-rack-position').value = driver.rackPosition;
      document.getElementById('driver-locker-code').value = driver.lockerCode || '';
      // Home stay fields (optional)
      const homeStartEl = document.getElementById('driver-home-start');
      const homeEndEl = document.getElementById('driver-home-end');
      const toDateInput = (iso) => {
        if (!iso) return '';
        const d = new Date(iso);
        if (isNaN(d.getTime())) return '';
        const y = d.getFullYear();
        const m = String(d.getMonth()+1).padStart(2,'0');
        const dd = String(d.getDate()).padStart(2,'0');
        return `${y}-${m}-${dd}`;
      };
      if (homeStartEl) homeStartEl.value = toDateInput(driver.homeStartDate);
      if (homeEndEl) homeEndEl.value = toDateInput(driver.homeEndDate);
      // Use driver's actual dates for editing (allow past dates for testing)
      const departureDateTime = driver.departureDate ? new Date(driver.departureDate) : new Date();
      
      console.log('📅 Edit Driver - Date formatting:', {
        originalDepartureDate: driver.departureDate,
        departureDateTime: departureDateTime,
        departureDateTimeISO: departureDateTime.toISOString(),
        departureDateTimeLocal: departureDateTime.toLocaleString()
      });
      
      // Format date for datetime-local input (preserve local timezone)
      const formatDateTimeForInput = (date) => {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        const hours = String(date.getHours()).padStart(2, '0');
        const minutes = String(date.getMinutes()).padStart(2, '0');
        return `${year}-${month}-${day}T${hours}:${minutes}`;
      };
      
      const formattedDepartureDate = formatDateTimeForInput(departureDateTime);
      console.log('📅 Formatted departure date for input:', formattedDepartureDate);
      
      document.getElementById('driver-departure-datetime').value = formattedDepartureDate;

      // For 'acasa', show and edit homeStart/homeEnd via departure/return inputs
      if (driver.status === 'acasa') {
        const hs = driver.homeStartDate ? new Date(driver.homeStartDate) : null;
        const he = driver.homeEndDate ? new Date(driver.homeEndDate) : null;
        const hsFormatted = hs ? formatDateTimeForInput(hs) : '';
        const heFormatted = he ? formatDateTimeForInput(he) : '';
        document.getElementById('driver-departure-datetime').value = hsFormatted;
        document.getElementById('driver-return-datetime').value = heFormatted;
        document.getElementById('driver-return-datetime').disabled = false;
        document.getElementById('driver-return-datetime').placeholder = '';
      } else if (driver.status === 'vine_acasa' || driver.status === 'catre_sediu') {
        // For drivers with status "vine_acasa" or "catre_sediu", don't set return date
        document.getElementById('driver-return-datetime').value = '';
        document.getElementById('driver-return-datetime').disabled = true;
        document.getElementById('driver-return-datetime').placeholder = (driver.status === 'vine_acasa')
          ? 'Nu se aplică pentru șoferii care vin acasă'
          : 'Nu se aplică pentru șoferii către sediu';
      } else {
      const returnDateTime = driver.estimatedReturnDate ? new Date(driver.estimatedReturnDate) : new Date();
        
        console.log('📅 Edit Driver - Return date formatting:', {
          originalReturnDate: driver.estimatedReturnDate,
          returnDateTime: returnDateTime,
          returnDateTimeISO: returnDateTime.toISOString(),
          returnDateTimeLocal: returnDateTime.toLocaleString()
        });
        
        const formattedReturnDate = formatDateTimeForInput(returnDateTime);
        console.log('📅 Formatted return date for input:', formattedReturnDate);
        
        document.getElementById('driver-return-datetime').value = formattedReturnDate;
        document.getElementById('driver-return-datetime').disabled = false;
        document.getElementById('driver-return-datetime').placeholder = '';
      }
      
      // Remove min attribute to allow past dates
      document.getElementById('driver-departure-datetime').removeAttribute('min');
      
      // Add date/time validation for edit mode
      const departureDateTimeInput = document.getElementById('driver-departure-datetime');
      const returnDateTimeInput = document.getElementById('driver-return-datetime');
      
      if (departureDateTimeInput && returnDateTimeInput) {
        // În modul edit nu impunem min relative la "acum"; păstrăm doar regula return > departure
        departureDateTimeInput.removeAttribute('min');
        returnDateTimeInput.removeAttribute('min');
        departureDateTimeInput.setCustomValidity('');
        returnDateTimeInput.setCustomValidity('');

        // Add event listeners for date/time validation
        departureDateTimeInput.addEventListener('change', () => {
          this.autoUpdateReturnDateTime();
          this.validateDateTime();
        });
        returnDateTimeInput.addEventListener('change', () => this.validateDateTime());
      }

      // Prefill document expiry dates (keep existing values to avoid wiping on save)
      const valueForDateInput = (v) => {
        if (!v) return '';
        try {
          // Accept both 'YYYY-MM-DD' and ISO strings
          if (/^\d{4}-\d{2}-\d{2}$/.test(String(v))) return String(v);
          const d = new Date(v);
          if (isNaN(d.getTime())) return '';
          const y = d.getFullYear();
          const m = String(d.getMonth() + 1).padStart(2, '0');
          const day = String(d.getDate()).padStart(2, '0');
          return `${y}-${m}-${day}`;
        } catch (_) { return ''; }
      };
      const idExpiryEl = document.getElementById('id-expiry-date');
      const passportExpiryEl = document.getElementById('passport-expiry-date');
      const licenseExpiryEl = document.getElementById('license-expiry-date');
      const tachoExpiryEl = document.getElementById('tacho-expiry-date');
      const atestatExpiryEl = document.getElementById('atestat-expiry-date');
      const adrExpiryEl = document.getElementById('adr-expiry-date');
      // Disable browser autocomplete on doc fields to avoid stale autofill
      ;[idExpiryEl, passportExpiryEl, licenseExpiryEl, tachoExpiryEl, atestatExpiryEl, adrExpiryEl].forEach(el => {
        if (el) {
          el.setAttribute('autocomplete','off');
          el.setAttribute('autocorrect','off');
          el.setAttribute('autocapitalize','off');
          el.setAttribute('spellcheck','false');
        }
      });
      if (idExpiryEl) idExpiryEl.value = valueForDateInput(driver.idExpiryDate);
      if (passportExpiryEl) passportExpiryEl.value = valueForDateInput(driver.passportExpiryDate);
      if (licenseExpiryEl) licenseExpiryEl.value = valueForDateInput(driver.licenseExpiryDate);
      if (tachoExpiryEl) tachoExpiryEl.value = valueForDateInput(driver.tachoExpiryDate);
      if (atestatExpiryEl) atestatExpiryEl.value = valueForDateInput(driver.atestatExpiryDate);
      if (adrExpiryEl) adrExpiryEl.value = valueForDateInput(driver.adrExpiryDate);

      this.populateRackPositionOptions();
      this.openModal('driver-modal');

    } catch (error) {
      console.error('Error loading driver for edit:', error);
      utils.showToast('Eroare la încărcarea datelor șoferului', 'error');
    }
  }

  /**
   * Handle driver form submission
   */
  async handleDriverFormSubmit(e) {
    e.preventDefault();

    const form = e.target;
    const formData = new FormData(form);
    let mode = form.dataset.mode;
    let driverId = form.dataset.driverId;

    const estimatedReturnDate = formData.get('estimatedReturnDateTime');
    
    const driverData = {
      firstName: formData.get('firstName'),
      lastName: formData.get('lastName'),
      phone: (function(){
        const raw = formData.get('phone') || '';
        // Folosește formatter-ul global pentru a produce formatul cu spații
        if (window.autoFormatter && typeof window.autoFormatter.formatPhone === 'function') {
          const formatted = window.autoFormatter.formatPhone(raw);
          return formatted || raw;
        }
        return raw;
      })(),
      carNumber: formData.get('carNumber'),
      rackPosition: parseInt(formData.get('rackPosition'), 10), // Ensure base 10 parsing
      lockerCode: formData.get('lockerCode'),
      fleetNumber: formData.get('fleetNumber'), // Temporary tracking field
      // If 'acasa', map inputs into home dates
      homeStartDate: (function(){
        const existing = (form.dataset.mode === 'edit') ? (this.drivers.find(d => d.id === Number(form.dataset.driverId)) || {}) : {};
        if (existing.status === 'acasa') return formData.get('departureDateTime') || existing.homeStartDate || null;
        return formData.get('homeStartDate') || null;
      }).call(this),
      homeEndDate: (function(){
        const existing = (form.dataset.mode === 'edit') ? (this.drivers.find(d => d.id === Number(form.dataset.driverId)) || {}) : {};
        if (existing.status === 'acasa') return formData.get('estimatedReturnDateTime') || existing.homeEndDate || null;
        return formData.get('homeEndDate') || null;
      }).call(this),
      // If 'acasa', interpret departure/return inputs as homeStart/homeEnd and keep work dates unchanged
      departureDate: (function(){
        const existing = (form.dataset.mode === 'edit') ? (this.drivers.find(d => d.id === Number(form.dataset.driverId)) || {}) : {};
        if (existing.status === 'acasa') return existing.departureDate || null;
        return formData.get('departureDateTime');
      }).call(this),
      estimatedReturnDate: (function(){
        const existing = (form.dataset.mode === 'edit') ? (this.drivers.find(d => d.id === Number(form.dataset.driverId)) || {}) : {};
        if (existing.status === 'acasa') return existing.estimatedReturnDate || null;
        return estimatedReturnDate || null;
      }).call(this), // Set to null if empty
      // Documente: doar expirări
      idExpiryDate: formData.get('idExpiryDate') || null,
      passportExpiryDate: formData.get('passportExpiryDate') || null,
      licenseExpiryDate: formData.get('licenseExpiryDate') || null,
      tachoExpiryDate: formData.get('tachoExpiryDate') || null,
      atestatExpiryDate: formData.get('atestatExpiryDate') || null,
      adrExpiryDate: formData.get('adrExpiryDate') || null
    };
    

    // Validate date/time first
    if (!this.validateDateTime()) {
      return;
    }
    
    // Validate form
    if (!this.validateDriverForm(driverData)) {
      return;
    }

    try {
      utils.showLoading();

      let response;
      if (mode === 'edit') {
        // Trimite DOAR câmpurile modificate (extins pentru toate câmpurile)
        const existing = this.drivers.find(d => d.id === Number(driverId)) || {};
        const payload = {};
        const keys = Object.keys(driverData);
        const docKeys = ['idExpiryDate','passportExpiryDate','licenseExpiryDate','tachoExpiryDate','atestatExpiryDate','adrExpiryDate'];
        for (const k of keys) {
          const newVal = driverData[k];
          const oldVal = existing[k];
          if (k === 'rackPosition') {
            if (Number(oldVal) !== Number(newVal)) payload[k] = newVal;
          } else if (k === 'estimatedReturnDate' || k === 'departureDate') {
            // Compare date strings by value
            if ((oldVal || '') !== (newVal || '')) payload[k] = newVal;
          } else {
            // Pentru câmpurile de acte: nu trimite valori goale (evităm ștergerea accidentală)
            if (docKeys.includes(k)) {
              if (newVal) {
                if ((oldVal || '') !== (newVal || '')) payload[k] = newVal;
              }
            } else if ((oldVal || '') !== (newVal || '')) {
              payload[k] = newVal;
            }
          }
        }
        if (Object.keys(payload).length === 0) {
          utils.showToast('Nicio modificare de salvat', 'info');
          this.closeModal('driver-modal');
          return;
        }
        response = await utils.apiRequest(`/drivers/${driverId}`, {
          method: 'PUT',
          body: JSON.stringify(payload)
        });
      } else {
        // La creare: nu include câmpurile de acte necompletate pentru a evita ștergerea accidentală
        const createPayload = { ...driverData };
        ['idExpiryDate','passportExpiryDate','licenseExpiryDate','tachoExpiryDate','atestatExpiryDate','adrExpiryDate'].forEach(k => {
          if (!createPayload[k]) delete createPayload[k];
        });
        response = await utils.apiRequest('/drivers', {
          method: 'POST',
          body: JSON.stringify(createPayload)
        });
      }
      if (!response.ok) {
        // În caz de telefon duplicat, comută pe update pentru șoferul existent
        try {
          const err = await response.clone().json().catch(() => ({}));
          const msg = (err && (err.error || err.message)) || '';
          const code = err && err.code;
          const fields = err && err.data && err.data.fields ? err.data.fields : null;
          const normalize = (p) => String(p || '').replace(/\D+/g, '');
          const newDigits = normalize(driverData.phone);
          const existing = (this.drivers || []).find(d => {
            const dNorm = d.phoneNormalized ? String(d.phoneNormalized) : normalize(d.phone);
            return dNorm === newDigits;
          });
          if (code === 'PHONE_EXISTS' || /telefon\s+deja\s+existent/i.test(msg)) {
            if (existing) {
              // Construiește payload doar cu diferențele critice + rackPosition pentru ocupare
              const payload = {};
              const keys = Object.keys(driverData);
              const old = existing;
              for (const k of keys) {
                const newVal = driverData[k];
                const oldVal = old[k];
                if (k === 'rackPosition') {
                  if (Number(oldVal) !== Number(newVal)) payload[k] = newVal;
                } else if (k === 'estimatedReturnDate' || k === 'departureDate') {
                  if ((oldVal || '') !== (newVal || '')) payload[k] = newVal;
                } else {
                  if ((oldVal || '') !== (newVal || '')) payload[k] = newVal;
                }
              }
              if (Object.keys(payload).length === 0) {
                payload.rackPosition = driverData.rackPosition; // asigură ocuparea
              }
              mode = 'edit';
              driverId = String(existing.id);
              response = await utils.apiRequest(`/drivers/${driverId}`, {
                method: 'PUT',
                body: JSON.stringify(payload)
              });
            }
          }
          // RACK OCCUPIED UI
          if (code === 'RACK_OCCUPIED' || /raftul\s+\d+\s+este\s+ocupat/i.test(msg)) {
            this.setFieldError('driver-rack-position', msg || 'Poziția este ocupată');
            utils.hideLoading();
            return; // oprește fluxul, afișăm eroarea pe câmp
          }
          // Schema field errors
          if (code === 'INVALID_DRIVER' && fields) {
            Object.entries(fields).forEach(([k,v]) => {
              const map = {
                firstName:'driver-first-name', lastName:'driver-last-name', phone:'driver-phone', carNumber:'driver-car-number', rackPosition:'driver-rack-position', departureDate:'driver-departure-datetime', estimatedReturnDate:'driver-return-datetime',
                idExpiryDate:'id-expiry-date', passportExpiryDate:'passport-expiry-date', licenseExpiryDate:'license-expiry-date', tachoExpiryDate:'tacho-expiry-date', atestatExpiryDate:'atestat-expiry-date', adrExpiryDate:'adr-expiry-date'
              };
              const id = map[k];
              if (id) this.setFieldError(id, String(v));
            });
            utils.hideLoading();
            return;
          }
        } catch (_) { /* ignore, will fall through to handleApiResponse */ }
      }

      const data = await utils.handleApiResponse(response);

      utils.showToast('Salvat', 'success');

      this.closeModal('driver-modal');
      await this.loadInitialData();
      // Re-randare Docs dacă este tabul activ
      if (this.currentTab === 'docs') {
        await this.renderDocsTab();
      }
      
      // Refresh charts
      if (window.chartsManager) {
        window.chartsManager.refreshOnDataChange();
      }

    } catch (error) {
      console.error('Error saving driver:', error);
      utils.showToast(error.message || 'Eroare la salvarea șoferului', 'error');
    } finally {
      utils.hideLoading();
    }
  }

  /**
   * Delete driver
   */
  async deleteDriver(driverId) {
    const driver = (this.drivers || []).find(d => String(d.id) === String(driverId));
    const isAcasa = driver && driver.status === 'acasa';
    const confirmText = isAcasa
      ? 'Ștergerea unui șofer "Acasă" îl va elimina definitiv. Continui?'
      : 'Ștergere definitivă: va fi mutat în "Acasă" și șters în aceeași acțiune. Continui?';
    if (!confirm(confirmText)) return;

    try {
      utils.showLoading();
      if (!isAcasa) {
        // Pas 1: eliberează la Acasă
        const r1 = await utils.apiRequest(`/drivers/${driverId}/release`, { method: 'POST' });
        await utils.handleApiResponse(r1);
        // Pas 2: șterge definitiv (cu un mic retry dacă statusul nu e încă propagat)
        const tryDelete = async () => {
          const r2 = await utils.apiRequest(`/drivers/${driverId}`, { method: 'DELETE' });
          const ok = r2 && r2.ok;
          if (!ok) {
            // încearcă să citești răspunsul pentru cod
            try { const e = await r2.clone().json(); if (e && e.code === 'DELETE_ONLY_AT_HOME') throw new Error('RETRY'); } catch(_) {}
          }
          return r2;
        };
        let resp;
        try {
          resp = await tryDelete();
          if (!resp.ok) throw new Error('RETRY');
        } catch (_) {
          // așteaptă propagarea și mai încearcă o dată
          await new Promise(r => setTimeout(r, 600));
          resp = await tryDelete();
        }
        await utils.handleApiResponse(resp);
        utils.showToast('Șofer șters cu succes!', 'success');
      } else {
        const response = await utils.apiRequest(`/drivers/${driverId}`, { method: 'DELETE' });
        await utils.handleApiResponse(response);
        utils.showToast('Șofer șters cu succes!', 'success');
      }
      await this.loadInitialData();
      if (window.chartsManager) window.chartsManager.refreshOnDataChange();
    } catch (error) {
      console.error('Error deleting/releasing driver:', error);
      utils.showToast(error.message || 'Eroare la operație', 'error');
    } finally {
      utils.hideLoading();
    }
  }

  /**
   * Release driver position
   */
  async releaseDriver(driverId) {
    if (!confirm('Ești sigur că vrei să eliberezi această poziție?')) {
      return;
    }

    try {
      utils.showLoading();

      const response = await utils.apiRequest(`/drivers/${driverId}/release`, {
        method: 'POST'
      });

      const data = await utils.handleApiResponse(response);

      utils.showToast(data.message || 'Poziția a fost eliberată!', 'success');
      
      this.closeModal('position-modal');
      await this.loadInitialData();
      
      // Refresh charts
      if (window.chartsManager) {
        window.chartsManager.refreshOnDataChange();
      }

    } catch (error) {
      console.error('Error releasing driver:', error);
      utils.showToast(error.message || 'Eroare la eliberarea poziției', 'error');
    } finally {
      utils.hideLoading();
    }
  }

  /**
   * Search drivers
   */
  searchDrivers(e) {
    const query = e.target.value.toLowerCase().trim();
    
    if (query === '') {
      // If search is empty, show all drivers
      this.updateDriversTable();
      return;
    }
    
    // Filter drivers based on search query (show all drivers, not just active ones)
    const filteredDrivers = this.drivers.filter(driver => 
      driver.firstName.toLowerCase().includes(query) ||
      driver.lastName.toLowerCase().includes(query) ||
      driver.phone.includes(query) ||
      driver.carNumber.toLowerCase().includes(query) ||
      (driver.rackPosition && driver.rackPosition.toString().includes(query)) ||
      (driver.lockerCode && driver.lockerCode.includes(query))
    );
    
    // Update table with filtered results
    this.updateDriversTable(filteredDrivers);
  }

  /**
   * Filter drivers by status (WhatsApp functionality removed)
   */
  filterDriversByStatus(e) {
    e.preventDefault();
    const status = e.currentTarget.dataset.filter;
    
    if (!status) {
      return;
    }
    
    // Remove active class from all clickable cards
    document.querySelectorAll('.clickable-card').forEach(card => {
      card.classList.remove('active');
    });
    
    // Add active class to clicked card
    e.currentTarget.classList.add('active');
    
    // Save the active filter
    this.activeDriverFilter = status;
    
    // Filter drivers by status
    const filteredDrivers = this.drivers.filter(driver => {
      const calculatedStatus = this.calculateDriverStatus(driver);
      if (status === 'vine_acasa') {
        // include only active/vine_acasa drivers with return in 1..7 days
        if (!driver.estimatedReturnDate) return false;
        const today = new Date();
        const returnDate = new Date(driver.estimatedReturnDate);
        const daysUntilReturn = Math.ceil((returnDate - today) / (1000 * 60 * 60 * 24));
        return daysUntilReturn >= 1 && daysUntilReturn <= 7 && (calculatedStatus === 'activ' || calculatedStatus === 'vine_acasa');
      }
      return calculatedStatus === status;
    });
    
    // Update table with filtered results (only if we're on drivers tab)
    if (this.currentTab === 'drivers') {
      this.updateDriversTable(filteredDrivers);
      // Când utilizatorul schimbă către tabul "Șoferi", revenim la lista completă
      const driversNavBtn = document.querySelector('[data-tab="drivers"]');
      if (driversNavBtn && !driversNavBtn._resetBound) {
        driversNavBtn._resetBound = true;
        driversNavBtn.addEventListener('click', () => {
          this.activeDriverFilter = null;
          this.updateDriversTable();
        });
      }
    } else {
      // If we're on dashboard, show filtered results in a modal or update stats
      this.showFilteredResults(filteredDrivers, status);
    }
  }

  /**
   * Show filtered results in dashboard
   */
  showFilteredResults(filteredDrivers, status) {
    const statusNames = {
      'activ': 'Șoferi Activi',
      'vine_acasa': 'Vin Acasă',
      'acasa': 'Acasă',
      'catre_sediu': 'Catre Sediu'
    };
    
    const statusName = statusNames[status] || status;
    
    // Create or update a results modal
    let resultsModal = document.getElementById('filter-results-modal');
    if (!resultsModal) {
      resultsModal = document.createElement('div');
      resultsModal.id = 'filter-results-modal';
      resultsModal.className = 'modal';
      resultsModal.innerHTML = `
        <div class="modal-content">
          <div class="modal-header">
            <h3>${statusName} - ${filteredDrivers.length} șoferi</h3>
            <button class="modal-close" id="modal-close-btn" title="Închide">&times;</button>
          </div>
          <div class="modal-body">
            <div class="selection-controls" style="margin-bottom: 1rem; display: flex; align-items: center; gap: 1rem;">
              <button class="btn btn-sm btn-outline" id="select-all-drivers-btn">
                <i class="fas fa-check-square"></i>
                Selectează Tot
              </button>
              <button class="btn btn-sm btn-outline" id="deselect-all-drivers-btn">
                <i class="fas fa-square"></i>
                Deselectează Tot
              </button>
              <span class="selected-count" id="selected-drivers-count" style="margin-left: 1rem; color: var(--text-light);">
                0 șoferi selectați
              </span>
            </div>
            <div class="filtered-drivers-list" id="filtered-drivers-list">
              <!-- Drivers will be populated here -->
            </div>
          </div>
          <div class="modal-footer">
            <button class="btn btn-danger" id="delete-selected-drivers-btn" title="Șterge șoferii selectați" disabled>
              <i class="fas fa-trash"></i>
              Șterge Selectați
            </button>
            <button class="btn btn-primary" id="modal-view-table-btn" title="Vezi șoferii în tabel">
              <i class="fas fa-table"></i>
              Vezi în Tabel
            </button>
            <button class="btn btn-secondary" id="modal-close-footer-btn" title="Închide modal">
              <i class="fas fa-times"></i>
              Închide
            </button>
          </div>
        </div>
      `;
      document.body.appendChild(resultsModal);
    }
    
    // Update modal title (hidden per request)
    const modalTitle = resultsModal.querySelector('h3');
    if (modalTitle) {
      modalTitle.textContent = '';
      try { modalTitle.style.display = 'none'; } catch(_) {}
    }
    
    // Inject search + weeks controls (once)
    const header = resultsModal.querySelector('.modal-header');
    if (header && !header._filtersInjected) {
      header._filtersInjected = true;
      const wrap = document.createElement('div');
      wrap.style.display = 'flex';
      wrap.style.gap = '8px';
      wrap.style.alignItems = 'center';
      wrap.innerHTML = `
        <div class="search-box" style="margin-left:auto; max-width: 300px;">
          <input type="text" id="filter-modal-search" placeholder="Caută șoferi...">
          <i class="fas fa-search"></i>
        </div>
        <div>
          <select id="filter-modal-weeks" class="period-dropdown" title="Săptămâni minime">
            ${Array.from({length:31}, (_,i)=>`<option value=\"${i}\">≥ ${i} săptămâni</option>`).join('')}
          </select>
        </div>
      `;
      header.appendChild(wrap);
    }

    const searchCtrl = resultsModal.querySelector('#filter-modal-search');
    const weeksCtrl = resultsModal.querySelector('#filter-modal-weeks');
    const computeWeeks = (d) => {
      try {
        const now = new Date();
        if (status === 'acasa') {
          const hs = d.homeStartDate ? new Date(d.homeStartDate) : null;
          if (!hs) return 0;
          return Math.max(0, Math.floor((now - hs) / (1000*60*60*24*7)));
        }
        const dep = d.departureDate ? new Date(d.departureDate) : null;
        if (!dep) return 0;
        return Math.max(0, Math.floor((now - dep) / (1000*60*60*24*7)));
      } catch (_) { return 0; }
    };
    const recompute = () => {
      const q = (searchCtrl && searchCtrl.value || '').trim().toLowerCase();
      const minWeeks = parseInt(weeksCtrl && weeksCtrl.value || '0', 10) || 0;
      const base = (this.drivers || []).filter(d => this.calculateDriverStatus(d) === status);
      return base.filter(d => (`${d.firstName} ${d.lastName}`.toLowerCase().includes(q)) && computeWeeks(d) >= minWeeks);
    };

    // Populate drivers list
    const driversList = resultsModal.querySelector('#filtered-drivers-list');
    const renderList = (list) => {
      driversList.innerHTML = '';
      if (list.length === 0) {
        driversList.innerHTML = '<p class="no-results">Nu există șoferi cu acest status.</p>';
        return;
      }
      list.forEach(driver => {
        const driverItem = document.createElement('div');
        // Highlight: last week of HOME stay (for 'acasa') or last week before RETURN (for 'activ')
        const isAcasa = (status === 'acasa');
        const isActiv = (status === 'activ');
        const he = driver.homeEndDate ? new Date(driver.homeEndDate) : null;
        const ret = driver.estimatedReturnDate ? new Date(driver.estimatedReturnDate) : null;
        const daysLeftHome = he ? Math.ceil((he.getTime() - Date.now()) / (1000*60*60*24)) : null;
        const daysToReturn = ret ? Math.ceil((ret.getTime() - Date.now()) / (1000*60*60*24)) : null;
        const lastWeekHome = isAcasa && daysLeftHome !== null && daysLeftHome >= 0 && daysLeftHome <= 7;
        const lastWeekActiv = isActiv && daysToReturn !== null && daysToReturn >= 0 && daysToReturn <= 7;
        driverItem.className = 'driver-item' + (lastWeekHome ? ' home-last-week' : (lastWeekActiv ? ' active-last-week' : ''));
        const showEditHome = (status === 'acasa');
        const showEditWork = (status === 'activ');
        const hs = driver.homeStartDate ? new Date(driver.homeStartDate) : null;
        const fmt = (d) => d ? utils.formatDate(d) : '-';
        driverItem.innerHTML = `
          <div class="driver-checkbox">
            <input type="checkbox" id="driver-${driver.id}" value="${driver.id}" class="driver-select-checkbox">
            <label for="driver-${driver.id}" class="driver-info">
              <div class="driver-header">
                <h4>${driver.firstName} ${driver.lastName}</h4>
                <span class="driver-position">#${driver.rackPosition || 'N/A'}</span>
              </div>
              <div class="driver-details-horizontal">
                <span class="driver-phone"><i class="fas fa-phone"></i> ${utils.formatPhone(driver.phone)}</span>
                <span class="driver-car"><i class="fas fa-car"></i> ${utils.formatCarNumber(driver.carNumber)}</span>
                ${status !== 'acasa' ? `<span class=\"driver-departure\"><i class=\"fas fa-calendar\"></i> ${utils.formatDate(driver.departureDate)}</span>` : ''}
                ${status !== 'acasa' ? `<span class=\"driver-return\"><i class=\"fas fa-calendar-check\"></i> ${utils.formatDate(driver.estimatedReturnDate)}</span>` : ''}
                ${showEditHome ? `<span class=\"driver-home\"><i class=\"fas fa-house\"></i> Acasă: ${fmt(hs)} → ${fmt(he)}</span>` : ''}
              </div>
            </label>
          </div>
          ${(showEditHome || showEditWork) ? `<div class=\"driver-actions\">${showEditHome ? `<button class=\"btn btn-sm btn-outline edit-home-btn\" data-driver-id=\"${driver.id}\"><i class=\"fas fa-edit\"></i> Editează perioada</button>` : ''}${showEditWork ? `<button class=\"btn btn-sm btn-outline edit-work-btn\" data-driver-id=\"${driver.id}\" style=\"margin-left:6px;\"><i class=\"fas fa-edit\"></i> Editează perioada</button>` : ''}</div>` : ''}
        `;
        driversList.appendChild(driverItem);
      });

      // Bind checkboxes
      driversList.querySelectorAll('.driver-select-checkbox').forEach(cb => {
        cb.removeEventListener('change', this.handleCheckboxChange);
        this.handleCheckboxChange = (e) => this.updateFilterSelectedDriversCount();
        cb.addEventListener('change', this.handleCheckboxChange);
      });

      // Bind edit buttons
      driversList.querySelectorAll('.edit-home-btn, .edit-work-btn').forEach(btn => {
        btn.addEventListener('click', (ev) => {
          ev.preventDefault(); ev.stopPropagation();
          const id = btn.getAttribute('data-driver-id');
          if (id) {
            try { resultsModal.classList.remove('active'); } catch(_) {}
            setTimeout(() => this.editDriver(id), 50);
          }
        });
      });
    };

    renderList(recompute());

    // Recompute bindings
    const rerender = () => renderList(recompute());
    if (searchCtrl && !searchCtrl._bound) { searchCtrl._bound = true; searchCtrl.addEventListener('input', utils.debounce(rerender, 200)); }
    if (weeksCtrl && !weeksCtrl._bound) { weeksCtrl._bound = true; weeksCtrl.addEventListener('change', rerender); }
    
    // Add event listeners for buttons
    const closeBtn = resultsModal.querySelector('#modal-close-btn');
    // Bind edit-home buttons (if present)
    resultsModal.querySelectorAll('.edit-home-btn').forEach(btn => {
      btn.addEventListener('click', (ev) => {
        ev.preventDefault(); ev.stopPropagation();
        const id = btn.getAttribute('data-driver-id');
        if (id) {
          try { resultsModal.classList.remove('active'); } catch(_) {}
          setTimeout(() => this.editDriver(id), 50);
        }
      });
    });
    const closeFooterBtn = resultsModal.querySelector('#modal-close-footer-btn');
    const viewTableBtn = resultsModal.querySelector('#modal-view-table-btn');
    
    if (closeBtn) {
      closeBtn.addEventListener('click', () => {
        resultsModal.classList.remove('active');
      });
    }
    
    if (closeFooterBtn) {
      closeFooterBtn.addEventListener('click', () => {
        resultsModal.classList.remove('active');
      });
    }
    
    if (viewTableBtn) {
      viewTableBtn.addEventListener('click', () => {
        resultsModal.classList.remove('active');
        setTimeout(() => this.switchToTab('drivers'), 100);
      });
    }
    
    // Add event listeners for selection controls
    const selectAllBtn = resultsModal.querySelector('#select-all-drivers-btn');
    const deselectAllBtn = resultsModal.querySelector('#deselect-all-drivers-btn');
    const deleteSelectedBtn = resultsModal.querySelector('#delete-selected-drivers-btn');
    
    if (selectAllBtn) {
      // Remove existing event listeners to prevent duplicates
      selectAllBtn.removeEventListener('click', this.handleSelectAllClick);
      
      // Create bound function for proper removal
      this.handleSelectAllClick = () => {
        console.log('🖱️ Select all button clicked');
        const checkboxes = resultsModal.querySelectorAll('.driver-select-checkbox');
        console.log('🔘 Selecting all checkboxes:', checkboxes.length);
        checkboxes.forEach(checkbox => {
          checkbox.checked = true;
        });
        this.updateFilterSelectedDriversCount();
      };
      
      selectAllBtn.addEventListener('click', this.handleSelectAllClick);
    }
    
    if (deselectAllBtn) {
      // Remove existing event listeners to prevent duplicates
      deselectAllBtn.removeEventListener('click', this.handleDeselectAllClick);
      
      // Create bound function for proper removal
      this.handleDeselectAllClick = () => {
        console.log('🖱️ Deselect all button clicked');
        const checkboxes = resultsModal.querySelectorAll('.driver-select-checkbox');
        console.log('🔘 Deselecting all checkboxes:', checkboxes.length);
        checkboxes.forEach(checkbox => {
          checkbox.checked = false;
        });
        this.updateFilterSelectedDriversCount();
      };
      
      deselectAllBtn.addEventListener('click', this.handleDeselectAllClick);
    }
    
    if (deleteSelectedBtn) {
      // Remove existing event listeners to prevent duplicates
      deleteSelectedBtn.removeEventListener('click', this.handleDeleteClick);
      
      // Create bound function for proper removal
      this.handleDeleteClick = (e) => {
        console.log('🖱️ Delete button clicked!');
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        this.deleteFilterSelectedDrivers();
      };
      
      deleteSelectedBtn.addEventListener('click', this.handleDeleteClick);
    }
    
    // Add click outside to close functionality (only once)
    if (!resultsModal.hasAttribute('data-click-listener')) {
      resultsModal.addEventListener('click', (e) => {
        if (e.target === resultsModal) {
          resultsModal.classList.remove('active');
        }
      });
      resultsModal.setAttribute('data-click-listener', 'true');
    }
    
    // Show modal
    resultsModal.classList.add('active');
  }

  /**
   * Update selected drivers count in filter results modal
   */
  updateFilterSelectedDriversCount() {
    console.log('🔢 updateFilterSelectedDriversCount called');
    const resultsModal = document.getElementById('filter-results-modal');
    if (!resultsModal) {
      console.log('❌ Results modal not found');
      return;
    }
    console.log('✅ Results modal found in updateFilterSelectedDriversCount');

    const checkboxes = resultsModal.querySelectorAll('.driver-select-checkbox');
    const selectedCount = Array.from(checkboxes).filter(cb => cb.checked).length;
    
    console.log('🔘 Update selected drivers count:', {
      totalCheckboxes: checkboxes.length,
      selectedCount: selectedCount,
      checkedBoxes: Array.from(checkboxes).filter(cb => cb.checked).map(cb => cb.value)
    });
    
    const countElement = resultsModal.querySelector('#selected-drivers-count');
    const deleteBtn = resultsModal.querySelector('#delete-selected-drivers-btn');
    
    if (countElement) {
      countElement.textContent = `${selectedCount} șoferi selectați`;
      console.log('✅ Updated count element:', countElement.textContent);
    } else {
      console.log('❌ Count element not found');
    }
    
    if (deleteBtn) {
      deleteBtn.disabled = selectedCount === 0;
      console.log('✅ Updated delete button disabled state:', deleteBtn.disabled);
      console.log('🔍 Delete button details:', {
        disabled: deleteBtn.disabled,
        visible: deleteBtn.offsetParent !== null,
        clickable: !deleteBtn.disabled && deleteBtn.offsetParent !== null
      });
    } else {
      console.log('❌ Delete button not found');
    }
  }

  /**
   * Delete selected drivers from filter results modal
   */
  async deleteFilterSelectedDrivers() {
    console.log('🗑️ Delete selected drivers called');
    
    // Prevent multiple executions
    if (this.isDeletingDrivers) {
      console.log('⚠️ Delete operation already in progress, ignoring duplicate call');
      return;
    }
    
    this.isDeletingDrivers = true;
    
    const resultsModal = document.getElementById('filter-results-modal');
    if (!resultsModal) {
      console.log('❌ Results modal not found in deleteFilterSelectedDrivers');
      this.isDeletingDrivers = false;
      return;
    }

    const checkboxes = resultsModal.querySelectorAll('.driver-select-checkbox:checked');
    const selectedDriverIds = Array.from(checkboxes).map(cb => parseInt(cb.value));
    
    console.log('🗑️ Selected driver IDs:', selectedDriverIds);
    
    if (selectedDriverIds.length === 0) {
      console.log('⚠️ No drivers selected');
      utils.showToast('Nu ai selectat niciun șofer de șters', 'warning');
      this.isDeletingDrivers = false;
      return;
    }

    const confirmMessage = `Ești sigur că vrei să ștergi ${selectedDriverIds.length} șoferi selectați?`;
    if (!confirm(confirmMessage)) {
      this.isDeletingDrivers = false;
      return;
    }

    try {
      // Delete each selected driver
      for (const driverId of selectedDriverIds) {
        await this.deleteDriver(driverId);
      }
      
      // Show success message
      utils.showToast(`${selectedDriverIds.length} șoferi au fost șterși cu succes!`, 'success');
      
      // Close modal
      resultsModal.classList.remove('active');
      
      // Refresh data
      await this.loadDrivers();
      await this.loadRacks();
      await this.loadDashboardData();
      
    } catch (error) {
      console.error('Error deleting selected drivers:', error);
      utils.showToast('Eroare la ștergerea șoferilor selectați', 'error');
    } finally {
      // Always reset the flag
      this.isDeletingDrivers = false;
    }
  }

  /**
   * Clear driver filter and show all drivers
   */
  clearDriverFilter() {
    this.activeDriverFilter = null;
    
    // Remove active class from all clickable cards
    document.querySelectorAll('.clickable-card').forEach(card => {
      card.classList.remove('active');
    });
    
    // Hide results modal if open
    const resultsModal = document.getElementById('filter-results-modal');
    if (resultsModal) {
      resultsModal.classList.remove('active');
    }
    
    // Update table with all drivers
    if (this.currentTab === 'drivers') {
      this.updateDriversTable();
    }
    
  }

  /**
   * Switch to a specific tab
   */
  switchToTab(tabName) {
    // Update current tab
    this.currentTab = tabName;
    
    // Remove active class from all tabs
    document.querySelectorAll('.tab-content').forEach(tab => {
      tab.classList.remove('active');
    });
    
    document.querySelectorAll('.nav-btn').forEach(btn => {
      btn.classList.remove('active');
    });
    
    // Add active class to target tab
    const targetTab = document.getElementById(`${tabName}-tab`);
    const targetBtn = document.querySelector(`[data-tab="${tabName}"]`);
    
    if (targetTab) targetTab.classList.add('active');
    if (targetBtn) targetBtn.classList.add('active');
    
    // Load tab data
    this.loadTabData(tabName);
    
    console.log(`Switched to tab: ${tabName}`);
  }

  /**
   * Filter racks by status
   */
  filterRacks(e) {
    const status = e.target.value;
    const positions = document.querySelectorAll('#racks-grid .rack-position');

    positions.forEach(position => {
      if (!status || position.classList.contains(status)) {
        position.style.display = '';
      } else {
        position.style.display = 'none';
      }
    });
  }

  /**
   * Mark all notifications as read
   */
  async markAllNotificationsRead(e) {
    e.preventDefault();

    try {
      utils.showLoading();

      const response = await utils.apiRequest('/notifications/mark-all-read', {
        method: 'POST'
      });

      await utils.handleApiResponse(response);

      utils.showToast('Toate notificările au fost marcate ca citite', 'success');
      await this.loadNotifications();

    } catch (error) {
      console.error('Error marking notifications as read:', error);
      utils.showToast('Eroare la marcarea notificărilor', 'error');
    } finally {
      utils.hideLoading();
    }
  }

  /**
   * Refresh data
   */
  async refreshData(e) {
    e.preventDefault();

    try {
      utils.showLoading();
      await this.loadInitialData();
      
      // Refresh charts if charts manager exists
      if (window.chartsManager) {
        window.chartsManager.refreshOnDataChange();
      }
      
      utils.showToast('Datele au fost actualizate', 'success');
    } catch (error) {
      console.error('Error refreshing data:', error);
      utils.showToast('Eroare la actualizarea datelor', 'error');
    } finally {
      utils.hideLoading();
    }
  }

  /**
   * Populate rack position options
   */
  populateRackPositionOptions() {
    const select = document.getElementById('driver-rack-position');
    if (!select) return;

    // Păstrează selecția curentă (important în modul edit)
    const previousValue = select.value;

    select.innerHTML = '';

    // Determină driverul curent în modul edit ca să permită poziția lui existentă
    const form = document.getElementById('driver-form');
    let currentDriverId = null;
    let currentDriverRack = null;
    if (form && form.dataset.mode === 'edit' && form.dataset.driverId) {
      currentDriverId = parseInt(form.dataset.driverId, 10);
      const cur = this.drivers.find(d => d.id === currentDriverId);
      currentDriverRack = cur ? cur.rackPosition : null;
    }

    // Poziții ocupate (doar pentru șoferi activi), excluzând poziția curentă a șoferului editat
    const occupiedPositions = this.drivers
      .filter(d => d.status === 'activ')
      .map(d => d.rackPosition)
      .filter(pos => pos !== currentDriverRack);

    for (let i = 1; i <= 1000; i++) {
      const option = document.createElement('option');
      option.value = i.toString(); // Ensure string value
      option.textContent = i.toString();
      
      if (occupiedPositions.includes(i)) {
        option.disabled = true;
        option.textContent += ' (ocupat)';
      }
      
      select.appendChild(option);

      // Log first few and last few options
      if (i <= 5 || i >= 995) {
        console.log(`Option ${i}: value="${option.value}", text="${option.textContent}", disabled=${option.disabled}`);
      }
    }

    // Restaurează selecția anterioară dacă există
    if (previousValue) {
      select.value = previousValue;
    }
  }

  /**
   * Get current driver status from form or existing driver
   */
  getCurrentDriverStatus() {
    const form = document.getElementById('driver-form');
    const mode = form.dataset.mode;
    const driverId = form.dataset.driverId;
    
    if (mode === 'edit' && driverId) {
      // For edit mode, get status from existing driver
      const driver = this.drivers.find(d => d.id === parseInt(driverId));
      return driver ? driver.status : 'activ';
    }
    
    // For add mode, default to 'activ'
    return 'activ';
  }

  /**
   * Validate driver form
   */
  validateDriverForm(data) {
    const form = document.getElementById('driver-form');
    if (form) this.clearFieldErrors(form);

    let valid = true;

    // Required fields
    const requiredFields = [
      { id: 'driver-first-name', key: 'firstName', label: 'Prenume' },
      { id: 'driver-last-name', key: 'lastName', label: 'Nume' },
      { id: 'driver-phone', key: 'phone', label: 'Telefon' },
      { id: 'driver-car-number', key: 'carNumber', label: 'Număr Mașină' },
      { id: 'driver-rack-position', key: 'rackPosition', label: 'Poziție Raft' },
      { id: 'driver-departure-datetime', key: 'departureDate', label: 'Data Plecării' }
    ];

    requiredFields.forEach(f => {
      if (data[f.key] === undefined || data[f.key] === null || data[f.key] === '' || Number.isNaN(data[f.key])) {
        this.setFieldError(f.id, `${f.label} este obligatoriu`);
        valid = false;
      }
    });

    // Return date requirement based on status
    const statusesWithoutReturnDate = ['acasa', 'vine_acasa', 'catre_sediu'];
    const currentStatus = this.getCurrentDriverStatus();
    if (!statusesWithoutReturnDate.includes(currentStatus) && !data.estimatedReturnDate) {
      this.setFieldError('driver-return-datetime', 'Data de sosire este obligatorie pentru acest status');
      valid = false;
    }

    if (data.firstName && data.firstName.length < 2) {
      this.setFieldError('driver-first-name', 'Prenumele trebuie să aibă minim 2 caractere');
      valid = false;
    }
    if (data.lastName && data.lastName.length < 2) {
      this.setFieldError('driver-last-name', 'Numele trebuie să aibă minim 2 caractere');
      valid = false;
    }

    if (data.phone && !utils.isValidPhone(data.phone)) {
      this.setFieldError('driver-phone', 'Număr invalid. Acceptat: 07xxxxxxxx sau +407xxxxxxxx');
      valid = false;
    }

    if (data.carNumber && !utils.isValidCarNumber(data.carNumber)) {
      this.setFieldError('driver-car-number', 'Număr mașină invalid (ex: X-XX-XXX)');
      valid = false;
    }

    if (data.rackPosition && (data.rackPosition < 1 || data.rackPosition > 1000)) {
      this.setFieldError('driver-rack-position', 'Poziția trebuie să fie între 1 și 1000');
      valid = false;
    }

    if (data.departureDate) {
      const departureDate = new Date(data.departureDate);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      // Permitem trecutul pentru istorice, dar dacă dorim, marcăm informativ
      if (false && departureDate < today) {
        this.setFieldError('driver-departure-datetime', 'Data plecării nu poate fi în trecut');
        valid = false;
      }
    }

    if (data.departureDate && data.estimatedReturnDate) {
      const departureDate = new Date(data.departureDate);
      const returnDate = new Date(data.estimatedReturnDate);
      if (returnDate <= departureDate) {
        this.setFieldError('driver-return-datetime', 'Sosirea trebuie să fie după plecare');
        valid = false;
      }
    }

    if (!valid) {
      utils.showToast('Te rog corectează erorile marcate în formular', 'error');
    }
    return valid;
  }

  /**
   * Open modal
   */
  openModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
      // remember previously focused element
      this._previouslyFocused = document.activeElement;
      modal.classList.add('active');
      document.body.style.overflow = 'hidden';
      this._activeModalId = modalId;
      // Focus first focusable element inside modal
      const content = modal.querySelector('.modal-content');
      const focusables = this.getFocusableElements(modal);
      if (content) content.setAttribute('tabindex', '-1');
      (focusables[0] || content || modal).focus();
      // Setup focus trap
      this._focusHandlers = this._focusHandlers || {};
      const handler = (e) => {
        if (e.key !== 'Tab') return;
        const items = this.getFocusableElements(modal);
        if (items.length === 0) return;
        const first = items[0];
        const last = items[items.length - 1];
        if (e.shiftKey) {
          if (document.activeElement === first) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }
      };
      modal.addEventListener('keydown', handler);
      this._focusHandlers[modalId] = handler;
    }
  }

  /**
   * Close modal
   */
  closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
      modal.classList.remove('active');
      document.body.style.overflow = '';
      // Remove focus trap
      if (this._focusHandlers && this._focusHandlers[modalId]) {
        modal.removeEventListener('keydown', this._focusHandlers[modalId]);
        delete this._focusHandlers[modalId];
      }
      if (this._activeModalId === modalId) {
        this._activeModalId = null;
      }
      // restore focus back to the element that opened the modal
      if (this._previouslyFocused && typeof this._previouslyFocused.focus === 'function') {
        this._previouslyFocused.focus();
        this._previouslyFocused = null;
      }
    }
  }

  /**
   * Close all modals
   */
  closeAllModals() {
    document.querySelectorAll('.modal').forEach(modal => {
      modal.classList.remove('active');
    });
    document.body.style.overflow = '';
  }

  /**
   * Handle keyboard shortcuts
   */
  handleKeyboardShortcuts(e) {
    // Ctrl/Cmd + K - Focus search
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
      e.preventDefault();
      const searchInput = document.getElementById('driver-search');
      if (searchInput) {
        searchInput.focus();
      }
    }

    // Escape - Close modals
    if (e.key === 'Escape') {
      this.closeAllModals();
    }
  }

  /**
   * Get focusable elements inside a modal
   */
  getFocusableElements(modal) {
    return Array.from(
      modal.querySelectorAll('a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])')
    ).filter(el => el.offsetParent !== null);
  }

  /**
   * Inline field errors helpers
   */
  setFieldError(inputId, message) {
    const input = document.getElementById(inputId);
    if (!input) return;
    input.classList.add('input-error');
    let container = input.closest('.form-group') || input.parentElement;
    if (!container) container = input;
    let err = container.querySelector('.field-error');
    if (!err) {
      err = document.createElement('span');
      err.className = 'field-error';
      container.appendChild(err);
    }
    err.textContent = message;
  }

  clearFieldError(inputId) {
    const input = document.getElementById(inputId);
    if (!input) return;
    input.classList.remove('input-error');
    const container = input.closest('.form-group') || input.parentElement;
    const err = container && container.querySelector ? container.querySelector('.field-error') : null;
    if (err) err.remove();
  }

  clearFieldErrors(formEl) {
    formEl.querySelectorAll('.input-error').forEach(el => el.classList.remove('input-error'));
    formEl.querySelectorAll('.field-error').forEach(el => el.remove());
  }

  /**
   * Handle profile picture upload
   */
  handleProfilePictureUpload() {
    // Settings tab upload
    const uploadBtn = document.getElementById('upload-profile-picture-btn');
    const removeBtn = document.getElementById('remove-profile-picture-btn');
    const fileInput = document.getElementById('profile-picture-input');

    if (uploadBtn && fileInput) {
      uploadBtn.addEventListener('click', () => fileInput.click());
    }

    if (fileInput) {
      fileInput.addEventListener('change', (e) => this.handleProfilePictureChange(e));
    }

    if (removeBtn) {
      removeBtn.addEventListener('click', () => this.removeProfilePicture());
    }

    // Dropdown upload
    const dropdownUploadBtn = document.getElementById('dropdown-upload-profile-picture-btn');
    const dropdownRemoveBtn = document.getElementById('dropdown-remove-profile-picture-btn');
    const dropdownFileInput = document.getElementById('dropdown-profile-picture-input');

    if (dropdownUploadBtn && dropdownFileInput) {
      dropdownUploadBtn.addEventListener('click', () => dropdownFileInput.click());
    }

    if (dropdownFileInput) {
      dropdownFileInput.addEventListener('change', (e) => this.handleProfilePictureChange(e));
    }

    if (dropdownRemoveBtn) {
      dropdownRemoveBtn.addEventListener('click', () => this.removeProfilePicture());
    }
  }

  /**
   * Handle profile picture change
   */
  handleProfilePictureChange(e) {
    const file = e.target.files[0];
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith('image/')) {
      utils.showToast('Te rog selectează o imagine validă', 'error');
      return;
    }

    // Validate file size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      utils.showToast('Imaginea este prea mare. Maxim 5MB', 'error');
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const imageData = e.target.result;
      this.setProfilePicture(imageData);
    };
    reader.readAsDataURL(file);
  }

  /**
   * Set profile picture
   */
  setProfilePicture(imageData) {
    // Save to localStorage
    localStorage.setItem('profile-picture', imageData);

    // Update all preview elements
    const previews = document.querySelectorAll('#profile-picture-preview, #dropdown-profile-picture, #header-profile-picture');
    previews.forEach(preview => {
      if (preview) preview.src = imageData;
    });

    // Update button states
    const uploadBtns = document.querySelectorAll('#upload-profile-picture-btn, #dropdown-upload-profile-picture-btn');
    const removeBtns = document.querySelectorAll('#remove-profile-picture-btn, #dropdown-remove-profile-picture-btn');

    uploadBtns.forEach(btn => {
      if (btn) btn.style.display = 'none';
    });

    removeBtns.forEach(btn => {
      if (btn) btn.style.display = 'inline-flex';
    });

    utils.showToast('Poza de profil a fost actualizată!', 'success');
  }

  /**
   * Remove profile picture
   */
  removeProfilePicture() {
    // Remove from localStorage
    localStorage.removeItem('profile-picture');

    // Reset all preview elements
    const previews = document.querySelectorAll('#profile-picture-preview, #dropdown-profile-picture, #header-profile-picture');
    previews.forEach(preview => {
      if (preview) preview.src = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAiIGhlaWdodD0iNDAiIHZpZXdCb3g9IjAgMCA0MCA0MCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPGNpcmNsZSBjeD0iMjAiIGN5PSIyMCIgcj0iMjAiIGZpbGw9IiNGM0Y0RjYiLz4KPHBhdGggZD0iTTIwIDI0QzIyLjIwOTEgMjQgMjQgMjIuMjA5MSAyNCAyMEMyNCAxNy43OTA5IDIyLjIwOTEgMTYgMjAgMTZDMTcuNzkwOSAxNiAxNiAxNy43OTA5IDE2IDIwQzE2IDIyLjIwOTEgMTcuNzkwOSAyNCAyMCAyNFoiIGZpbGw9IiM5Q0EzQUYiLz4KPHBhdGggZD0iTTIwIDI4QzE2LjY4NjMgMjggMTQgMjUuMzEzNyAxNCAyMkMxNCAxOC42ODYzIDE2LjY4NjMgMTYgMjAgMTZDMjMuMzEzNyAxNiAyNiAxOC42ODYzIDI2IDIyQzI2IDI1LjMxMzcgMjMuMzEzNyAyOCAyMCAyOFoiIGZpbGw9IiM5Q0EzQUYiLz4KPC9zdmc+';
    });

    // Update button states
    const uploadBtns = document.querySelectorAll('#upload-profile-picture-btn, #dropdown-upload-profile-picture-btn');
    const removeBtns = document.querySelectorAll('#remove-profile-picture-btn, #dropdown-remove-profile-picture-btn');

    uploadBtns.forEach(btn => {
      if (btn) btn.style.display = 'inline-flex';
    });

    removeBtns.forEach(btn => {
      if (btn) btn.style.display = 'none';
    });

    utils.showToast('Poza de profil a fost ștearsă!', 'success');
  }

  /**
   * Handle logout
   */
  handleLogout() {
    const logoutBtn = document.getElementById('dropdown-logout-btn');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        if (confirm('Ești sigur că vrei să te deconectezi?')) {
          // Clear localStorage
          localStorage.removeItem('accessToken');
          localStorage.removeItem('user');
          
          // Show login screen
          await this.showLoginScreen();
          
          utils.showToast('Te-ai deconectat cu succes', 'success');
        }
      });
    }
  }

  /**
   * Bind password toggle functionality
   */
  bindPasswordToggle() {
    const passwordToggle = document.getElementById('password-toggle');
    const passwordInput = document.getElementById('password');
    
    if (passwordToggle && passwordInput) {
      passwordToggle.addEventListener('click', () => {
        const type = passwordInput.getAttribute('type') === 'password' ? 'text' : 'password';
        passwordInput.setAttribute('type', type);
        
        // Toggle eye icon
        const icon = passwordToggle.querySelector('i');
        if (type === 'text') {
          icon.classList.remove('fa-eye');
          icon.classList.add('fa-eye-slash');
        } else {
          icon.classList.remove('fa-eye-slash');
          icon.classList.add('fa-eye');
        }
      });
    }
  }

  /**
   * Handle login form submission
   */
  async handleLogin(e) {
    e.preventDefault();
    
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;
    const submitBtn = e.target.querySelector('button[type="submit"]');
    const originalBtnText = submitBtn.innerHTML;
    
    // Show loading state
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<div class="loading"></div> <span>Se conectează...</span>';
    
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ email, password })
      });
      
      const data = await response.json();
      
      if (response.ok) {
        // Save authentication data
        localStorage.setItem('accessToken', data.tokens.accessToken);
        localStorage.setItem('user', JSON.stringify(data.user));
        
        // Show main app
        await this.showMainApp();
        
        // Load initial data and initialize WhatsApp
        await this.loadInitialData();
        this.loadSettingsData();
        this.handleProfilePictureUpload();
        this.bindMinimalWhatsAppControls();
        this.initializeWhatsAppLink();
        this.loadChartsScript();
        
        utils.showToast('Autentificare reușită!', 'success');
      } else {
        utils.showToast(data.message || 'Eroare la autentificare', 'error');
      }
    } catch (error) {
      console.error('Login error:', error);
      utils.showToast('Eroare de conexiune la server', 'error');
    } finally {
      // Restore button state
      submitBtn.disabled = false;
      submitBtn.innerHTML = originalBtnText;
    }
  }

  /**
   * Handle forgot password form submission
   */
  async handleForgotPassword(e) {
    e.preventDefault();
    
    const email = document.getElementById('forgot-email').value;
    const submitBtn = e.target.querySelector('button[type="submit"]');
    const originalBtnText = submitBtn.innerHTML;
    
    // Show loading state
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<div class="loading"></div> <span>Se trimite...</span>';
    
    try {
      const response = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ email })
      });
      
      const data = await response.json();
      
      if (response.ok) {
        utils.showToast(data.message || 'Link de resetare trimis pe email', 'success');
        // Optionally hide the form or show success message
      } else {
        utils.showToast(data.message || 'Eroare la trimiterea link-ului', 'error');
      }
    } catch (error) {
      console.error('Forgot password error:', error);
      utils.showToast('Eroare de conexiune la server', 'error');
    } finally {
      // Restore button state
      submitBtn.disabled = false;
      submitBtn.innerHTML = originalBtnText;
    }
  }

  /**
   * Load charts script dynamically
   */
  loadChartsScript() {
    // Check if charts script is already loaded
    if (document.querySelector('script[src*="charts.js"]')) {
      return;
    }

    const script = document.createElement('script');
    script.src = '/js/charts.js?v=20251010-5';
    script.onload = () => {
      console.log('Charts script loaded successfully');
    };
    script.onerror = () => {
      console.error('Failed to load charts script');
    };
    document.head.appendChild(script);
  }

  /**
   * Initialize WhatsApp Link functionality
   */
  initializeWhatsAppLink() {
    console.log('📱 Initializing WhatsApp Link functionality...');
    this.whatsappMessageModal = document.getElementById('whatsapp-message-modal');
    this.startWhatsAppLinkStatusPolling();
    this.initializeMultiClientManager();
    // Auto-revive last active client at startup
    setTimeout(() => this.autoReviveActiveClient(), 300);
  }

  /**
   * Bind WhatsApp message events
   */
  bindWhatsAppMessageEvents() {
    // WhatsApp message buttons in dashboard cards
    const whatsappBtns = document.querySelectorAll('.whatsapp-btn');
    whatsappBtns.forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation(); // Prevent card click
        const status = btn.getAttribute('data-status');
        this.openWhatsAppMessageModal(status);
      });
    });

    // WhatsApp message modal events
    const modal = document.getElementById('whatsapp-message-modal');
    if (modal) {
      this.whatsappMessageModal = modal;
      
      // Close modal events
      const closeBtn = document.getElementById('whatsapp-modal-close');
      const cancelBtn = document.getElementById('whatsapp-modal-cancel');
      
      if (closeBtn) {
        closeBtn.addEventListener('click', () => this.closeWhatsAppMessageModal());
      }
      
      if (cancelBtn) {
        cancelBtn.addEventListener('click', () => this.closeWhatsAppMessageModal());
      }

      // Selection controls
      const selectAllBtn = document.getElementById('select-all-btn');
      const deselectAllBtn = document.getElementById('deselect-all-btn');
      
      if (selectAllBtn) {
        selectAllBtn.addEventListener('click', () => {
          this.selectAllDrivers();
          try {
            selectAllBtn.classList.add('active');
            if (deselectAllBtn) deselectAllBtn.classList.remove('active');
          } catch (_) {}
        });
      }
      
      if (deselectAllBtn) {
        deselectAllBtn.addEventListener('click', () => {
          this.deselectAllDrivers();
          try {
            if (selectAllBtn) selectAllBtn.classList.remove('active');
            deselectAllBtn.classList.remove('active');
          } catch (_) {}
        });
      }

      // Send message button
      const sendBtn = document.getElementById('whatsapp-send-btn');
      if (sendBtn) {
        sendBtn.addEventListener('click', () => this.sendWhatsAppMessages());
      }

      // Template & test UI eliminat

      // Custom message text input
      const customMessageInput = document.getElementById('custom-message-text');
      if (customMessageInput) {
        console.log('📝 Adding event listener to custom message input');
        customMessageInput.addEventListener('input', () => {
          console.log('📝 Custom message input changed, updating button state');
          this.updateSendButtonState();
        });
      } else {
        console.error('❌ Custom message input not found!');
      }

      // Private message text input
      const privateMessageInput = document.getElementById('private-message-text');
      if (privateMessageInput) {
        console.log('📝 Adding event listener to private message input');
        privateMessageInput.addEventListener('input', () => {
          console.log('📝 Private message input changed, updating button state');
          this.updateSendButtonState();
        });
      } else {
        console.error('❌ Private message input not found!');
      }

      // Close modal when clicking outside
      modal.addEventListener('click', (e) => {
        if (e.target === modal) {
          this.closeWhatsAppMessageModal();
        }
      });
    }
  }

  /**
   * Apply predefined template to the custom message box
   */
  // applyTemplate eliminat

  /**
   * Send a test WhatsApp message
   */
  // sendTestMessage eliminat

  /**
   * Bind WhatsApp Link event listeners
   */
  bindMinimalWhatsAppControls() {
    const waNew = document.getElementById('waNewBtn');
    const waReconnect = document.getElementById('waReconnectBtn');
    const waDelete = document.getElementById('waDeleteBtn');
    const waQR = document.getElementById('waQR');
    const waStatus = document.getElementById('waStatus');
    const waSelect = document.getElementById('waAccountSelect');
    const waDot = document.getElementById('waAccountStatusDot');

    const renderQR = (dataUrl) => {
      if (!waQR) return;
      waQR.innerHTML = dataUrl ? `<img src="${dataUrl}" alt="QR" style="max-width:200px;height:auto;"/>` : '';
    };

    const showQRLoading = () => {
      if (!waQR) return;
      waQR.innerHTML = '<div class="qr-code-display"><div class="spinner" aria-label="Se generează QR..."></div></div>';
    };

    const refreshWaAccountsUI = async () => {
      try {
        const r = await fetch(`/api/whatsapp/accounts?t=${Date.now()}`);
        const data = await r.json();
        if (data.success && Array.isArray(data.accounts)) {
          this.accounts = data.accounts;
          if (waSelect) {
            waSelect.innerHTML = '';
            data.accounts.forEach(a => {
              const opt = document.createElement('option');
              opt.value = a.id;
              opt.textContent = `${String(a.id).replace(/^(session-)+/i, '')}`;
              waSelect.appendChild(opt);
            });
            const active = data.accounts.find(a => a.active) || data.accounts[0];
            if (active) { try { waSelect.value = active.id; } catch(_) {} }
            if (waDot && active) {
              waDot.classList.toggle('connected', !!active.connected);
              waDot.classList.toggle('disconnected', !active.connected);
            }
            if (waStatus && active) {
              waStatus.textContent = active.connected ? 'Conectat' : (active.qrDataUrl ? 'QR pregătit' : 'Deconectat');
            }
          }
        }
      } catch (_) {}
    };

    const pollAccounts = async (targetId, onConnected) => {
      let attempts = 0;
      const max = 90;
      const key = String(targetId || '').replace(/^(session-)+/i, '');
      const iv = setInterval(async () => {
        attempts++;
        try {
          const r = await fetch(`/api/whatsapp/accounts?t=${Date.now()}`);
          const data = await r.json();
          if (data.success && Array.isArray(data.accounts)) {
            // populate/select dropdown
            if (waSelect) {
              waSelect.innerHTML = '';
              data.accounts.forEach(a => {
                const opt = document.createElement('option');
                opt.value = a.id;
                opt.textContent = `${String(a.id).replace(/^(session-)+/i, '')} ${a.connected ? '(conectat)' : (a.qrDataUrl ? '(qr)' : '(off)')}`;
                waSelect.appendChild(opt);
              });
              const found = data.accounts.find(a => a.active) || data.accounts[0];
              if (found) { try { waSelect.value = found.id; } catch(_) {} }
              // update status dot based on selected option
              try {
                const sel = data.accounts.find(a => a.id === waSelect.value);
                if (waDot) {
                  waDot.classList.toggle('connected', !!sel && !!sel.connected);
                  waDot.classList.toggle('disconnected', !(sel && sel.connected));
                }
              } catch(_) {}
            }
            const acc = data.accounts.find(a => {
              const id = String(a.id||'');
              const clean = id.replace(/^(session-)+/i, '');
              return id === `session-${key}` || clean === key;
            });
            if (acc) {
              waStatus && (waStatus.textContent = acc.connected ? 'Conectat' : (acc.qrDataUrl ? 'QR pregătit' : 'Deconectat'));
              if (acc.qrDataUrl) renderQR(acc.qrDataUrl);
              if (acc.connected) {
                clearInterval(iv);
                renderQR('');
                onConnected && onConnected();
              }
            }
          }
        } catch(_) {}
        if (attempts >= max) clearInterval(iv);
      }, 1000);
      return iv;
    };

    // On account change: set active + auto reconnect in background until connected
    if (waSelect && !waSelect._bound) {
      waSelect._bound = true;
      waSelect.addEventListener('change', async () => {
        const id = waSelect.value;
        if (!id) return;
        try {
          await fetch('/api/whatsapp/switch', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) });
          waStatus && (waStatus.textContent = 'Reconectare în fundal...');
          // Update dot immediately based on cached accounts
          try {
            if (this.accounts && Array.isArray(this.accounts)) {
              const sel = this.accounts.find(a => a.id === id);
              if (waDot) {
                waDot.classList.toggle('connected', !!sel && !!sel.connected);
                waDot.classList.toggle('disconnected', !(sel && sel.connected));
              }
            }
          } catch(_) {}
          const cleanId = String(id).replace(/^(session-)+/i, '');
          // Kick a regenerate attempt but we will also keep polling until connected
          try { await fetch('/api/whatsapp/regenerate', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ id: cleanId }) }); } catch(_) {}
          pollAccounts(cleanId, async () => {
            waStatus && (waStatus.textContent = 'Conectat');
            await this.loadWhatsAppAccounts?.();
          });
        } catch (_) {}
      });
    }

    if (waNew && !waNew._bound) {
      waNew._bound = true;
      waNew.addEventListener('click', async (e) => {
        e.preventDefault();
        const name = prompt('Numele contului WhatsApp (ex: Personal, Business)');
        if (!name) return;
        this._qrTargetId = String(name).replace(/^(session-)+/i, '');
        showQRLoading();
        waStatus && (waStatus.textContent = 'Se creează contul...');
        try {
          const resp = await fetch('/api/whatsapp/add', { method:'POST', headers:{'Content-Type':'application/json', 'x-api-key': 'JbeoAVBn2Q1wpXEyFvz7g5iCImDl8Gjd'}, body: JSON.stringify({ id: name }) });
          const data = await resp.json().catch(()=>({}));
          if (data && data.qrDataUrl) renderQR(data.qrDataUrl);
          pollAccounts(name, async () => {
            waStatus && (waStatus.textContent = 'Conectat');
            await this.loadWhatsAppAccounts?.();
          });
        } catch (err) {
          waStatus && (waStatus.textContent = 'Eroare la creare cont');
        }
      });
    }

    if (waReconnect && !waReconnect._bound) {
      waReconnect._bound = true;
      waReconnect.addEventListener('click', async (e) => {
        e.preventDefault();
        showQRLoading();
        waStatus && (waStatus.textContent = 'Regenerare QR...');
        try {
          // Alege ținta: întâi un cont deconectat, apoi activ, altfel cere nume
          let target = null;
          try {
            const res = await fetch('/api/whatsapp/accounts');
            const data = await res.json();
            if (data.success && Array.isArray(data.accounts)) {
              target = data.accounts.find(a => a && a.connected === false) || data.accounts.find(a => a && a.active);
            }
          } catch(_) {}
          if (!target) {
            const manual = prompt('ID cont pentru reconectare (numele introdus la creare)');
            if (!manual) return;
            target = { id: `session-${manual}` };
          }
          const cleanId = String(target.id||'').replace(/^(session-)+/i, '');
          this._qrTargetId = cleanId;
          const r = await fetch('/api/whatsapp/regenerate', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ id: cleanId }) });
          const data = await r.json().catch(()=>({}));
          if (data && data.qrDataUrl) renderQR(data.qrDataUrl);
          pollAccounts(cleanId, async () => {
            waStatus && (waStatus.textContent = 'Conectat');
            await this.loadWhatsAppAccounts?.();
          });
        } catch (err) {
          waStatus && (waStatus.textContent = 'Eroare la regenerare');
        }
      });
    }

    if (waDelete && !waDelete._bound) {
      waDelete._bound = true;
      waDelete.addEventListener('click', async (e) => {
        e.preventDefault();
        const id = prompt('Introdu ID-ul contului pentru ștergere (numele dat la creare)');
        if (!id) return;
        try {
          const resp = await fetch('/api/whatsapp/remove', { method:'DELETE', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ id: `session-${id}` }) });
          const data = await resp.json();
          if (data.success) {
            waStatus && (waStatus.textContent = 'Cont șters');
            renderQR('');
            await this.loadWhatsAppAccounts?.();
          } else {
            waStatus && (waStatus.textContent = 'Eroare la ștergere');
          }
        } catch(_) {
          waStatus && (waStatus.textContent = 'Eroare la ștergere');
        }
      });
    }

    // Initial populate + periodic refresh
    refreshWaAccountsUI();
    this._waUiInterval && clearInterval(this._waUiInterval);
    this._waUiInterval = setInterval(refreshWaAccountsUI, 10000);

    // Theme switcher (păstrat)
    const themeButtons = document.querySelectorAll('.theme-option');
    const setActiveThemeBtn = (theme) => {
      themeButtons.forEach(b => b.classList.remove('active'));
      const activeBtn = Array.from(themeButtons).find(b => b.getAttribute('data-theme') === theme);
      if (activeBtn) activeBtn.classList.add('active');
    };
    themeButtons.forEach(btn => {
      if (!btn._bound) {
        btn._bound = true;
        btn.addEventListener('click', () => {
          const theme = btn.getAttribute('data-theme') || 'default';
          document.documentElement.classList.remove('theme-default','theme-midnight','theme-ocean','theme-sunset','theme-forest');
          document.documentElement.classList.add(`theme-${theme}`);
          setActiveThemeBtn(theme);
          try { localStorage.setItem('ui-theme', theme); } catch(_) {}
        });
      }
    });
    // Apply saved theme on load and highlight button
    try {
      const saved = localStorage.getItem('ui-theme') || 'default';
      document.documentElement.classList.add(`theme-${saved}`);
      setActiveThemeBtn(saved);
    } catch(_) { document.documentElement.classList.add('theme-default'); setActiveThemeBtn('default'); }
  }


  /**
   * Open WhatsApp modal
   */
  openWhatsAppModal() {
    console.log('📱 Opening WhatsApp Link modal...');
    if (this.whatsappMessageModal) {
      this.whatsappMessageModal.classList.add('active');
      this.populateDriversList();
      this.updateWhatsAppStatusUI();
      this.updateSendButtonState();
    }
  }

  /**
   * Close WhatsApp modal
   */
  closeWhatsAppModal() {
    if (this.whatsappMessageModal) {
      this.whatsappMessageModal.classList.remove('active');
    }
  }

  /**
   * Populate drivers list in modal
   */
  populateDriversList() {
    const driversList = document.getElementById('whatsapp-drivers-list');
    if (!driversList) return;

    driversList.innerHTML = '';

    this.drivers.forEach(driver => {
      const driverItem = document.createElement('div');
      driverItem.className = 'driver-checkbox';
      driverItem.innerHTML = `
        <input type="checkbox" id="driver-${driver.id}" value="${driver.id}">
        <label for="driver-${driver.id}">
          ${driver.firstName} ${driver.lastName} - ${driver.phone}
        </label>
      `;
      
      const checkbox = driverItem.querySelector('input[type="checkbox"]');
      checkbox.addEventListener('change', () => this.updateSelectedDrivers());
      
      driversList.appendChild(driverItem);
    });

    this.updateSelectedDrivers();
  }

  /**
   * Update selected drivers list
   */
  updateSelectedDrivers() {
    const checkboxes = document.querySelectorAll('#whatsapp-drivers-list input[type="checkbox"]:checked');
    this.selectedDrivers = Array.from(checkboxes).map(cb => {
      const driverId = parseInt(cb.value);
      return this.drivers.find(d => d.id === driverId);
    }).filter(driver => driver);

    this.updateSelectedDriversCount();
    this.updateSendButtonState();
  }

  /**
   * Update selected drivers count
   */
  updateSelectedDriversCount() {
    const countElement = document.getElementById('message-status-count');
    if (countElement) {
      const count = this.selectedDrivers.length;
      countElement.textContent = `${count} șofer${count === 1 ? '' : 'i'} selectați`;
    }
  }

  /**
   * Update send button state
   */
  updateSendButtonState() {
    console.log('🔘 updateSendButtonState called');
    const sendBtn = document.getElementById('whatsapp-send-btn');
    if (sendBtn) {
      const hasSelectedDrivers = this.selectedDrivers.length > 0;
      const customMessageElement = document.getElementById('custom-message-text');
      const privateMessageElement = document.getElementById('private-message-text');
      const customText = customMessageElement?.value.trim();
      const privateText = privateMessageElement?.value.trim();
      // Preferă statusul real din multi-client (cont activ conectat), apoi fallback la vechiul status
      const accounts = Array.isArray(this.accounts) ? this.accounts : [];
      const activeConnected = accounts.some(a => a.active && a.connected);
      const anyConnected = accounts.some(a => a.connected);
      const isConnected = activeConnected || anyConnected || (this.whatsappStatus === 'connected');

      // Logică buton:
      // - Dacă NU există privateText: butonul devine "Salvează" (permitem gol → șterge presetul)
      // - Dacă există privateText: "Trimite Mesaj" și necesită șoferi selectați + conexiune
      const saveMode = !privateText;
      if (saveMode) {
        sendBtn.innerHTML = '<i class="fas fa-save"></i> Salvează';
        sendBtn.disabled = false; // permite salvarea chiar și cu mesaj gol (ștergere preset)
      } else {
        sendBtn.innerHTML = '<i class="fab fa-whatsapp"></i> Trimite Mesaj';
        const canSend = !!privateText && hasSelectedDrivers && isConnected;
        sendBtn.disabled = !canSend;
      }
    } else {
      console.error('❌ Send button not found!');
    }
  }

  /**
   * Select all drivers
   */
  selectAllDrivers() {
    const checkboxes = document.querySelectorAll('#whatsapp-drivers-list input[type="checkbox"]');
    checkboxes.forEach(cb => cb.checked = true);
    this.updateSelectedDrivers();
  }

  /**
   * Deselect all drivers
   */
  deselectAllDrivers() {
    const checkboxes = document.querySelectorAll('#whatsapp-drivers-list input[type="checkbox"]');
    checkboxes.forEach(cb => cb.checked = false);
    this.updateSelectedDrivers();
  }


  /**
   * Update WhatsApp status display
   */
  updateWhatsAppStatus(status, text, qrCode = null, qrDataUrl = null) {
    // Update dropdown status
    const dropdownStatusDot = document.getElementById('dropdown-whatsapp-status-dot');
    const dropdownStatusText = document.getElementById('dropdown-whatsapp-status-text');
    
    if (dropdownStatusDot && dropdownStatusText) {
      dropdownStatusDot.className = `fas fa-circle status-dot ${status}`;
      dropdownStatusText.textContent = text;
    }

    // Update modal status
    const modalStatusDot = document.getElementById('whatsapp-status-dot');
    const modalStatusText = document.getElementById('whatsapp-status-text');
    const modalInfo = document.getElementById('whatsapp-info');
    
    if (modalStatusDot && modalStatusText) {
      modalStatusDot.className = `fas fa-circle status-dot ${status}`;
      modalStatusText.textContent = text;
    }

    if (modalInfo) {
      let infoHTML = `<p>${text}</p>`;
      
      // Add QR Code if available (prefer qrDataUrl over qrCode)
      if (qrDataUrl && status === 'disconnected') {
        infoHTML += `
          <div class="qr-code-container">
            <p>Scanează acest QR Code cu telefonul tău pentru a conecta WhatsApp:</p>
            <div id="qr-code-display">
              <img id="qr-code-img" src="${qrDataUrl}" alt="WhatsApp QR Code" style="max-width: 200px; height: auto;" />
            </div>
          </div>
        `;
      } else if (qrCode && status === 'disconnected') {
        infoHTML += `
          <div class="qr-code-container">
            <p>Scanează acest QR Code cu telefonul tău pentru a conecta WhatsApp:</p>
            <div id="qr-code-display">
              <pre id="qr-code-text">${qrCode}</pre>
            </div>
          </div>
        `;
      }
      
      modalInfo.innerHTML = infoHTML;
      
      // Generate QR Code if available (fallback for text QR)
      if (qrCode && !qrDataUrl && status === 'disconnected') {
        this.generateQRCode(qrCode);
      }
    }

    this.updateSendButtonState();
  }

  /**
   * Start WhatsApp Link status polling
   */
  startWhatsAppLinkStatusPolling() {
    // Check status immediately
    this.updateWhatsAppStatusUI();
    
    // Then check every 30 seconds
    this.whatsappStatusInterval = setInterval(() => {
      this.updateWhatsAppStatusUI();
    }, 30000);
  }

  /**
   * Stop WhatsApp Link status polling
   */
  stopWhatsAppLinkStatusPolling() {
    if (this.whatsappStatusInterval) {
      clearInterval(this.whatsappStatusInterval);
      this.whatsappStatusInterval = null;
    }
  }

  /**
   * Initialize Multi-Client WhatsApp Manager
   */
  initializeMultiClientManager() {
    console.log('🧭 Initializing WhatsApp Multi-Client Manager...');
    // Track QR pollers per cont și monitoare de conexiune
    this.qrPollIntervals = this.qrPollIntervals || {};
    this.connectionMonitors = this.connectionMonitors || {};
    this.loadWhatsAppAccounts();
    this.bindMultiClientEvents();
    this.startMultiClientPolling();
    // Start SSE live updates (fallback remains polling)
    this.startSSE();
    
    // Clean up polling intervals when page unloads
    window.addEventListener('beforeunload', () => {
      if (this.pollingInterval) {
        clearInterval(this.pollingInterval);
      }
      if (this.aggressivePollingInterval) {
        clearInterval(this.aggressivePollingInterval);
      }
      // Curăță eventualele pollere pentru QR și monitoare rămase
      try { Object.values(this.qrPollIntervals || {}).forEach(id => clearInterval(id)); } catch(e) {}
      try { Object.values(this.connectionMonitors || {}).forEach(id => clearInterval(id)); } catch(e) {}
      this.qrPollIntervals = {};
      this.connectionMonitors = {};
      if (this.sse) {
        try { this.sse.close(); } catch(e) {}
        this.sse = null;
      }
    });
  }

  // Curăță toate pollerele/monitoarele pentru un cont și oprește polling-ul agresiv
  clearQRFlows(accountName) {
    const key = String(accountName || '').replace(/^(session-)+/i, '');
    const kSession = `session-${key}`;
    if (this.qrPollIntervals && this.qrPollIntervals[key]) {
      clearInterval(this.qrPollIntervals[key]);
      delete this.qrPollIntervals[key];
    }
    if (this.qrPollIntervals && this.qrPollIntervals[kSession]) {
      clearInterval(this.qrPollIntervals[kSession]);
      delete this.qrPollIntervals[kSession];
    }
    if (this.connectionMonitors && this.connectionMonitors[key]) {
      clearInterval(this.connectionMonitors[key]);
      delete this.connectionMonitors[key];
    }
    if (this.connectionMonitors && this.connectionMonitors[kSession]) {
      clearInterval(this.connectionMonitors[kSession]);
      delete this.connectionMonitors[kSession];
    }
    if (this.aggressivePollingInterval) {
      clearInterval(this.aggressivePollingInterval);
      this.aggressivePollingInterval = null;
    }
  }

  /**
   * Start Server-Sent Events for live QR/status/active/account updates
   */
  startSSE() {
    try {
      if (this.sse) { try { this.sse.close(); } catch(e) {} }
      const es = new EventSource('/api/whatsapp/events');
      this.sse = es;

      // Heartbeat + backoff reconectare
      let hbTimer = null;
      const scheduleHb = () => {
        try { clearTimeout(hbTimer); } catch(_) {}
        hbTimer = setTimeout(() => {
          try { es.close(); } catch(_) {}
          this.sse = null;
          this._sseRetry = (this._sseRetry || 0) + 1;
          const delay = Math.min(30000, 2000 * Math.pow(2, this._sseRetry));
          setTimeout(() => this.startSSE(), delay);
        }, 30000);
      };
      scheduleHb();
      es.addEventListener('message', () => scheduleHb());
      es.addEventListener('open', () => { this._sseRetry = 0; scheduleHb(); });

      es.addEventListener('qr', (evt) => {
        try {
          const data = JSON.parse(evt.data || '{}');
          const id = String(data.id || '');
          const qrDataUrl = data.qrDataUrl;
          if (!qrDataUrl) return;
          const qrSection = document.querySelector('.qr-code-section');
          if (!qrSection) return;
          const confirmBtn = qrSection.querySelector('#confirm-connection-btn');
          const accountName = confirmBtn ? confirmBtn.getAttribute('data-account') : null;
          if (!accountName) return;
          const cleanId = id.replace(/^(session-)+/i, '');
          if (cleanId !== accountName) return; // event for different account
          const qrDisplay = qrSection.querySelector('.qr-code-display');
          if (qrDisplay) {
            qrDisplay.innerHTML = `<img src="${qrDataUrl}" alt="QR Code" style="max-width: 100%; height: auto;">`;
          }
        } catch (e) { console.warn('SSE qr handler error:', e); }
      });

      es.addEventListener('ready', (evt) => {
        try {
          const data = JSON.parse(evt.data || '{}');
          const id = String(data.id || '');
          // Remove QR modal if it's for this account
          const qrSection = document.querySelector('.qr-code-section');
          if (qrSection) {
            const confirmBtn = qrSection.querySelector('#confirm-connection-btn');
            const accountName = confirmBtn ? confirmBtn.getAttribute('data-account') : null;
            const cleanId = id.replace(/^(session-)+/i, '');
            if (accountName && cleanId === accountName) {
              qrSection.remove();
              utils.showToast(`✅ Contul ${accountName} s-a conectat.`, 'success');
            }
          }
          this.updateWhatsAppStatusUI();
          this.loadWhatsAppAccounts();
          // Invalidează cache-ul de contacte WA și reîncarcă lista de chat imediat
          try { this._waContactsCache = null; } catch(_) {}
          if (this.currentTab === 'chat') {
            this.loadChats();
          }
        } catch (e) { console.warn('SSE ready handler error:', e); }
      });

      es.addEventListener('disconnected', () => {
        this.updateWhatsAppStatusUI();
        this.loadWhatsAppAccounts();
      });

      es.addEventListener('activeChanged', () => {
        this.updateWhatsAppStatusUI();
        this.loadWhatsAppAccounts();
      });

      es.addEventListener('accountsChanged', () => {
        this.loadWhatsAppAccounts();
      });

      es.onerror = () => {
        // SSE fell back - keep polling running; attempt to reconnect later
        if (this.sse) { try { this.sse.close(); } catch(e) {} }
        this.sse = null;
        this._sseRetry = (this._sseRetry || 0) + 1;
        const delay = Math.min(30000, 2000 * Math.pow(2, this._sseRetry));
        setTimeout(() => this.startSSE(), delay);
      };
    } catch (error) {
      console.warn('SSE init failed, keep polling fallback:', error);
    }
  }

  /**
   * Start polling for multi-client updates
   */
  startMultiClientPolling() {
    // Poll every 10 seconds for account updates
    this.pollingInterval = setInterval(() => {
      this.loadWhatsAppAccounts();
    }, 10000);
  }

  /**
   * Start aggressive polling after account creation
   */
  startAggressivePolling() {
    console.log('🚀 Starting aggressive polling for new account...');
    
    // Clear existing polling
    if (this.aggressivePollingInterval) {
      clearInterval(this.aggressivePollingInterval);
    }
    
    // Poll every 1 second pentru 30 secunde (30 încercări)
    let attempts = 0;
    const maxAttempts = 30;
    
    this.aggressivePollingInterval = setInterval(async () => {
      attempts++;
      console.log(`🔄 Aggressive polling attempt ${attempts}/${maxAttempts}`);
      
      await this.loadWhatsAppAccounts();
      
      // Check if we have accounts now
      const accountSelect = document.getElementById('accountSelect');
      if (accountSelect && accountSelect.options.length > 1) {
        console.log('✅ Account found in list, stopping aggressive polling');
        clearInterval(this.aggressivePollingInterval);
        this.aggressivePollingInterval = null;
        return;
      }
      
      // Stop after max attempts
      if (attempts >= maxAttempts) {
        console.log('⏰ Aggressive polling timeout, returning to normal polling');
        clearInterval(this.aggressivePollingInterval);
        this.aggressivePollingInterval = null;
      }
    }, 1000);
  }

  /**
   * Bind events for multi-client manager
   */
  bindMultiClientEvents() {
    // Connect button
    const connectBtn = document.getElementById('connectBtn');
    const setActiveBtn = document.getElementById('setActiveBtn');
    if (connectBtn) {
      connectBtn.addEventListener('click', async () => {
        const id = document.getElementById('accountSelect').value;
        if (!id) {
          utils.showToast('Selectează un cont pentru a te conecta', 'error');
          return;
        }
        await this.connectWhatsAppClient(id);
      });
    }

    // Set Active button
    if (setActiveBtn) {
      setActiveBtn.addEventListener('click', async () => {
        const id = document.getElementById('accountSelect').value;
        if (!id) {
          utils.showToast('Selectează un cont pentru a-l seta activ', 'warning');
          return;
        }
        try {
          const resp = await fetch('/api/whatsapp/switch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id })
          });
          const data = await resp.json();
          if (data.success) {
            utils.showToast(`Setat activ: ${id}`, 'success');
            try { localStorage.setItem('waLastActiveId', id); } catch(_) {}
            await this.loadWhatsAppAccounts();
          } else {
            utils.showToast('Nu s-a putut seta activ', 'error');
          }
        } catch (e) {
          utils.showToast('Eroare la setarea contului activ', 'error');
        }
      });
    }

    // Generate QR button
    const generateQRBtn = document.getElementById('generateQRBtn');
    if (generateQRBtn) {
      generateQRBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const name = prompt('Numele contului WhatsApp (ex: Personal, Business)');
        if (!name) return;
        try {
          const r = await fetch('/api/whatsapp/add', { method:'POST', headers:{'Content-Type':'application/json', 'x-api-key': 'JbeoAVBn2Q1wpXEyFvz7g5iCImDl8Gjd'}, body: JSON.stringify({ id: name }) });
          const data = await r.json().catch(()=>({}));
          // Afișează imediat QR dacă a venit în răspuns
          this.showQRInDropdown(name, data && data.qrDataUrl);
        } catch(_) {}
        // Continuă polling pentru actualizări/conectare
      });
    }

    const regenBtn = document.getElementById('regenQRBtn');
    if (regenBtn) {
      regenBtn.addEventListener('click', async (e) => {
        e.preventDefault(); e.stopPropagation();
        const accounts = Array.isArray(this.accounts) ? this.accounts : [];
        const firstDisconnected = accounts.find(a => a && a.connected === false);
        const active = accounts.find(a => a && a.active);
        const target = firstDisconnected || active || null;
        if (!target) { utils.showToast('Nu există cont pentru regenerare', 'warning'); return; }
        const cleanId = String(target.id || '').replace(/^session-/i, '');
        try {
          const r = await fetch('/api/whatsapp/regenerate', { method: 'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ id: cleanId }) });
          const data = await r.json().catch(()=>({}));
          if (data && data.qrDataUrl) {
            this.showQRInDropdown(cleanId, data.qrDataUrl);
          } else {
            // fallback: cleanup invalid sessions and start polling
            try { await fetch('/api/whatsapp/cleanup-invalid', { method: 'POST' }); } catch(_) {}
            this.showQRInDropdown(cleanId);
          }
        } catch(_) {
          try { await fetch('/api/whatsapp/cleanup-invalid', { method: 'POST' }); } catch(_) {}
          this.showQRInDropdown(cleanId);
        }
      });
    }

    // Cleanup All button - Șterge TOATE sesiunile de pe disk
    const cleanupAllBtn = document.getElementById('cleanupAllBtn');
    if (cleanupAllBtn) {
      cleanupAllBtn.addEventListener('click', async () => {
        await this.cleanupAllSessions();
      });
    }

  }

  /**
   * Load WhatsApp accounts
   */
  async loadWhatsAppAccounts() {
    try {
      const response = await fetch(`/api/whatsapp/accounts?t=${Date.now()}`);
      const data = await response.json();
      
      if (data.success) {
        // Reține ultima stare a conturilor pentru logica de buton Send
        this.accounts = data.accounts || [];
        this.updateWhatsAppAccountsUI(data.accounts);
        // Dacă modalul de mesaje e deschis, actualizează imediat starea butonului Send
        try { this.updateSendButtonState(); } catch(_) {}
      } else {
        console.error('Error loading WhatsApp accounts:', data.error);
        utils.showToast('Eroare la încărcarea conturilor', 'error');
      }
    } catch (error) {
      console.error('Error loading WhatsApp accounts:', error);
      utils.showToast('Eroare la încărcarea conturilor', 'error');
    }

    // Auto-activare la schimbarea contului din dropdown
    const accountSelect = document.getElementById('accountSelect');
    if (accountSelect) {
      accountSelect.addEventListener('change', async (e) => {
        const id = accountSelect.value;
        if (!id) return;
        // Blochează temporar butoanele până la răspuns
        connectBtn && (connectBtn.disabled = true);
        generateQRBtn && (generateQRBtn.disabled = true);
        try {
          const response = await fetch('/api/whatsapp/switch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id })
          });
          const data = await response.json();
          if (data.success) {
            utils.showToast(`Client activ: ${id}`, 'success');
            try { localStorage.setItem('waLastActiveId', id); } catch(_) {}
            await this.loadWhatsAppAccounts();
          } else {
            utils.showToast('Eroare la activarea contului selectat', 'error');
          }
        } catch (err) {
          utils.showToast('Eroare la activarea contului', 'error');
        } finally {
          connectBtn && (connectBtn.disabled = false);
          generateQRBtn && (generateQRBtn.disabled = false);
        }
      });
    }
  }

  /**
   * Update WhatsApp accounts UI
   */
  updateWhatsAppAccountsUI(accounts) {
    const select = document.getElementById('accountSelect');
    const qrDiv = document.getElementById('qrContainer');
    const statusDiv = document.getElementById('statusContainer');

    if (!select || !qrDiv || !statusDiv) return;

    // Avoid re-render if nothing changed (simple stringify compare on ids/flags)
    const prevSig = this._lastAccountsSig || '';
    const nextSig = JSON.stringify(
      (accounts || []).map(a => ({ id: a.id, active: !!a.active, connected: !!a.connected, hasQr: !!a.qrDataUrl }))
    );
    if (prevSig === nextSig) {
      return; // no UI changes needed
    }
    this._lastAccountsSig = nextSig;

    // Clear existing content
    select.innerHTML = '';
    qrDiv.innerHTML = '';
    statusDiv.innerHTML = '';

    if (accounts.length === 0) {
      select.innerHTML = '<option value="">Niciun cont disponibil</option>';
      statusDiv.innerHTML = '<span style="color: #fbbf24;">⚠️ Niciun cont WhatsApp configurat</span>';
      return;
    }

    // Populate select with accounts
    accounts.forEach(acc => {
      const displayName = String(acc.id).replace(/^(session-)+/i, '');
      const opt = document.createElement('option');
      opt.value = acc.id;
      opt.textContent = `${displayName}${acc.active ? ' ✅' : ''} ${acc.connected ? '(conectat)' : (acc.qrDataUrl ? '(qr pregătit)' : '(deconectat)')}`;
      select.appendChild(opt);

      // Show QR code for account if available (active or inactive)
      if (acc.qrDataUrl) {
        const img = document.createElement('img');
        img.src = acc.qrDataUrl;
        img.alt = 'QR pentru scanare';
        img.title = `QR Code pentru ${displayName}`;
        qrDiv.appendChild(img);
        
        // Add buttons below QR code
        const buttonContainer = document.createElement('div');
        buttonContainer.style.cssText = 'margin-top: 12px; display: flex; gap: 8px; justify-content: center; flex-wrap: wrap;';
        
        // Generate QR button (will ask for account name if new)
        const generateBtn = document.createElement('button');
        generateBtn.innerHTML = '<i class="fas fa-user-plus"></i> Cont Nou';
        generateBtn.className = 'dropdown-btn dropdown-btn-primary';
        generateBtn.style.cssText = 'font-size: 0.75rem; padding: 6px 12px;';
        generateBtn.onclick = (e) => {
          e.preventDefault();
          e.stopPropagation();
          this.generateQRCode();
        };
        
        // Instructions button
        const instructionsBtn = document.createElement('button');
        instructionsBtn.innerHTML = '<i class="fas fa-info-circle"></i> Instrucțiuni';
        instructionsBtn.className = 'dropdown-btn';
        instructionsBtn.style.cssText = 'font-size: 0.75rem; padding: 6px 12px;';
        instructionsBtn.onclick = (e) => {
          e.preventDefault();
          e.stopPropagation();
          alert('📱 INSTRUCȚIUNI SCANARE QR:\n\n1. Deschide WhatsApp pe telefon\n2. Apasă pe meniul cu 3 puncte (⋮)\n3. Selectează "Dispozitive conectate"\n4. Apasă "Conectează un dispozitiv"\n5. Scanează acest QR code\n\n⚠️ Asigură-te că telefonul și computerul sunt pe aceeași rețea WiFi!');
        };
        
        buttonContainer.appendChild(generateBtn);
        buttonContainer.appendChild(instructionsBtn);
        qrDiv.appendChild(buttonContainer);
      }

      // Status va fi setat după selectarea contului activ (mai jos)
    });

    // Auto-select active account in dropdown
    const activeAcc = accounts.find(a => a.active);
    if (activeAcc) {
      try { select.value = activeAcc.id; } catch(_) {}
      const activeName = String(activeAcc.id).replace(/^(session-)+/i, '');
      const state = activeAcc.connected ? 'Conectat' : (activeAcc.qrDataUrl ? 'QR pregătit' : 'Deconectat');
      const color = activeAcc.connected ? '#10b981' : (activeAcc.qrDataUrl ? '#f59e0b' : '#ef4444');
      statusDiv.innerHTML = `<span style="color: ${color};">🔘 Active: ${activeName} — ${state}</span>`;
    } else {
      statusDiv.innerHTML = '<span style="color: #fbbf24;">⚠️ Niciun cont activ</span>';
    }
  }


  /**
   * Show QR code for active account
   */
  showQRCodeForActiveAccount() {
    const qrDiv = document.getElementById('qrContainer');
    if (qrDiv && qrDiv.children.length > 0) {
      qrDiv.scrollIntoView({ 
        behavior: 'smooth', 
        block: 'center' 
      });
    }
  }


  /**
   * Connect WhatsApp client - opens WhatsApp Web connection
   */
  async connectWhatsAppClient(id) {
    try {
      // First switch to the client if not active
      const response = await fetch('/api/whatsapp/switch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id })
      });
      
      const data = await response.json();
      
      if (data.success) {
        utils.showToast(`Conectare la ${id}...`, 'info');
        
        // Show connection instructions
        setTimeout(() => {
          alert(`📱 CONECTARE LA ${id.toUpperCase()}:\n\n1. Deschide WhatsApp pe telefon\n2. Apasă pe Meniu → Dispozitive conectate\n3. Scanează QR code-ul sau conectează-te manual\n4. Revino aici pentru a verifica statusul\n\n✅ Conectarea se va actualiza automat!`);
        }, 1000);
        
        // Refresh accounts to show updated status
        await this.loadWhatsAppAccounts();
      } else {
        console.error('Error connecting to client:', data.error);
        utils.showToast('Eroare la conectarea la cont', 'error');
      }
    } catch (error) {
      console.error('Error connecting to client:', error);
      utils.showToast('Eroare la conectarea la cont', 'error');
    }
  }

  /**
   * Generate QR code for specific client
   */
  async generateQRForClient(id) {
    try {
      // First switch to the client if not active
      const response = await fetch('/api/whatsapp/switch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id })
      });
      
      const data = await response.json();
      
      if (data.success) {
        utils.showToast(`Se generează QR pentru ${id}...`, 'info');
        // Deschide modalul și pornește polling-ul QR
        this.showQRCodeInModal(id);
        // Actualizează lista de conturi în fundal
        this.loadWhatsAppAccounts();
      } else {
        console.error('Error generating QR for client:', data.error);
        utils.showToast('Eroare la generarea QR code', 'error');
      }
    } catch (error) {
      console.error('Error generating QR for client:', error);
      utils.showToast('Eroare la generarea QR code', 'error');
    }
  }





  /**
   * 🗑️ Șterge TOATE sesiunile de pe disk - SOLUȚIE FINALĂ
   */
  async cleanupAllSessions() {
    try {
      const confirmed = confirm('⚠️ ATENȚIE! Această acțiune va șterge TOATE conturile WhatsApp de pe disk!\n\nConturile vor fi eliminate complet și nu vor mai reapărea la restart.\n\nEști sigur că vrei să continui?');
      
      if (!confirmed) {
        return;
      }

      utils.showToast('Se șterg TOATE sesiunile de pe disk...', 'info');
      
      const response = await fetch('/api/whatsapp/cleanup-all', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      
      const data = await response.json();
      
      if (data.success) {
        let message = `✅ Curățare completă finalizată: ${data.deleted} sesiuni șterse`;
        if (data.failed && data.failed > 0) {
          message += ` (${data.failed} eșuate)`;
        }
        utils.showToast(message, data.failed > 0 ? 'warning' : 'success');
        
        // Reîncarcă lista de conturi (ar trebui să fie goală)
        await this.loadWhatsAppAccounts();
        
        // Restart server pentru a aplica modificările
        setTimeout(() => {
          utils.showToast('🔄 Restart server pentru a aplica modificările...', 'info');
          window.location.reload();
        }, 2000);
        
      } else {
        console.error('Error cleaning up all sessions:', data.error);
        utils.showToast('Eroare la curățarea completă a sesiunilor', 'error');
      }
    } catch (error) {
      console.error('Error cleaning up all sessions:', error);
      utils.showToast('Eroare la curățarea completă a sesiunilor', 'error');
    }
  }

  /**
   * 🚨 SOLUȚIE FINALĂ - Curățare completă a tuturor sesiunilor problematice
   */
  async forceCleanupAllSessions() {
    try {
      utils.showToast('🚨 SOLUȚIE FINALĂ: Se aplică curățarea completă...', 'info');
      
      const response = await fetch('/api/whatsapp/force-cleanup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      
      const data = await response.json();
      
      if (data.success) {
        utils.showToast('✅ SOLUȚIE FINALĂ: Curățare completă finalizată cu succes!', 'success');
        await this.loadWhatsAppAccounts();
        
        // Afișează informații despre conturile rămase
        if (data.accounts && data.accounts.length > 0) {
          utils.showToast(`📱 Rămase ${data.accounts.length} conturi WhatsApp valide`, 'info');
        } else {
          utils.showToast('📱 Toate conturile problematice au fost eliminate', 'success');
        }
      } else {
        console.error('Error during force cleanup:', data.error);
        utils.showToast(`❌ SOLUȚIE FINALĂ: ${data.message || 'Eroare necunoscută'}`, 'error');
      }
    } catch (error) {
      console.error('Error during force cleanup:', error);
      utils.showToast('❌ SOLUȚIE FINALĂ: Eroare la curățarea completă', 'error');
    }
  }

  /**
   * Send WhatsApp messages
   */
  async sendWhatsAppMessages() {
    // Get message first (allow saving preset without drivers)
    const customMessage = document.getElementById('custom-message-text');
    const privateMessage = document.getElementById('private-message-text');
    const customText = customMessage?.value.trim();
    const privateText = privateMessage?.value.trim();

    // Save preset per status if no privateText (allow empty to clear)
    if (!privateText) {
      try {
        utils.showLoading();
        const key = this.currentWhatsAppStatus || 'activ';
        await utils.apiRequest('/whatsapp/default-messages', { method: 'POST', body: JSON.stringify({ key, text: customText || '' }) });
        utils.showToast(customText ? 'Mesaj automat salvat' : 'Mesaj automat șters', 'success');
        this.closeWhatsAppMessageModal();
        return;
      } catch (e) {
        utils.showToast('Eroare la salvarea mesajului automat', 'error');
        return;
      } finally {
        utils.hideLoading();
      }
    }

    // From here, private sending needs selected drivers
    const selectedCheckboxes = document.querySelectorAll('.whatsapp-driver-checkbox:checked');
    if (selectedCheckboxes.length === 0) {
      utils.showToast('Te rog selectează cel puțin un șofer', 'warning');
      return;
    }

    // Get selected driver IDs
    const selectedDriverIds = Array.from(selectedCheckboxes).map(cb => parseInt(cb.value));
    const selectedDrivers = this.drivers.filter(driver => selectedDriverIds.includes(driver.id));

    try {
      utils.showLoading();

      // If we have private message -> send that to selected drivers
      if (privateText) {
        const response = await utils.apiRequest('/whatsapp/send-bulk', {
          method: 'POST',
          body: JSON.stringify({
            drivers: selectedDrivers,
            message: privateText
          })
        });
        const data = await utils.handleApiResponse(response);
        utils.showToast(
          `Mesaje trimise: ${data.result.summary.successful} cu succes, ${data.result.summary.failed} eșuate`,
          data.result.summary.failed === 0 ? 'success' : 'warning'
        );
        this.closeWhatsAppMessageModal();
        return;
      }

      // Fallback (shouldn't reach here)
      utils.showToast('Niciun mesaj de trimis', 'warning');

    } catch (error) {
      console.error('Error sending WhatsApp messages:', error);
      utils.showToast('Eroare la trimiterea mesajelor: ' + error.message, 'error');
    } finally {
      utils.hideLoading();
    }
  }

  /**
   * Normalize Romanian phone numbers to E.164 (default country +40)
   */
  normalizePhoneNumber(raw) {
    if (!raw) return '';
    let n = String(raw).replace(/\D+/g, '');
    if (n.startsWith('00')) n = n.slice(2);
    if (n.startsWith('0')) n = '40' + n.slice(1);
    if (!n.startsWith('40')) n = '40' + n;
    return n;
  }

  /**
   * Save message template
   */
  // saveMessageTemplate eliminat


  /**
   * Generate QR Code for new WhatsApp account
   */
  async generateQRCode() {
    return; // deprecated, use admin dropdown flow
  }

  /**
   * Show account name input prompt
   */
  showAccountNamePrompt() {
    // Create prompt overlay
    const promptOverlay = document.createElement('div');
    promptOverlay.className = 'qr-code-section';
    promptOverlay.innerHTML = `
      <div class="qr-code-container" style="max-width: 400px;">
        <h3>📱 Numele contului WhatsApp</h3>
        <div class="account-input-section">
          <input 
            type="text" 
            id="accountNameInput" 
            placeholder="ex: Personal, Business, Tudor, etc."
            maxlength="50"
            autocomplete="off"
          />
          <div class="input-hint">Introdu un nume pentru noul cont WhatsApp</div>
        </div>
        <div class="qr-actions">
          <button class="btn btn-primary" id="saveAccountBtn">
            💾 Salvează
          </button>
          <button class="btn btn-secondary" id="cancelAccountBtn">
            ❌ Anulează
          </button>
        </div>
      </div>
    `;
    
    document.body.appendChild(promptOverlay);
    
    // Focus on input
    const input = document.getElementById('accountNameInput');
    input.focus();
    
    // Add event listeners
    document.getElementById('saveAccountBtn').onclick = () => {
      const accountName = input.value.trim();
      if (accountName) {
        promptOverlay.remove();
        this.createWhatsAppAccount(accountName);
      } else {
        utils.showToast('Introdu un nume pentru cont!', 'error');
        input.focus();
      }
    };
    
    document.getElementById('cancelAccountBtn').onclick = () => {
      // Închide promptul și orice QR modal deschis accidental
      try {
        const existing = document.querySelectorAll('.qr-code-section');
        existing.forEach(el => { try { el.remove(); } catch(_) {} });
      } catch(_) {}
      promptOverlay.remove();
    };
    
    // Enter key to save
    input.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        document.getElementById('saveAccountBtn').click();
      }
    });
  }

  /**
   * Create WhatsApp account and show QR code
   */
  async createWhatsAppAccount(accountName) {
    try {
      console.log('🔄 Creating WhatsApp account:', accountName);

      // Afișează imediat UI-ul cu spinner ca să nu aștepți răspunsul serverului
      this.showQRCodeInModal(accountName);
      // Pornește polling agresiv imediat pentru a detecta rapid apariția contului/QR
      this.startAggressivePolling();

      utils.showToast(`Creez contul "${accountName}"...`, 'info');

      // Creează clientul nou în background
      const response = await fetch('/api/whatsapp/add', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': 'JbeoAVBn2Q1wpXEyFvz7g5iCImDl8Gjd'
        },
        body: JSON.stringify({ id: accountName })
      });
      
      const data = await response.json();
      
      if (data.success) {
        utils.showToast(`Contul "${accountName}" a fost creat!`, 'success');
        console.log('✅ WhatsApp account created:', accountName);
        // Dacă serverul a returnat deja QR, afișează-l imediat
        if (data.qrDataUrl) {
          const qrSection = document.querySelector('.qr-code-section');
          if (qrSection) {
            const qrDisplay = qrSection.querySelector('.qr-code-display');
            if (qrDisplay) {
              qrDisplay.innerHTML = `<img src="${data.qrDataUrl}" alt="QR Code" style="max-width: 100%; height: auto;">`;
            }
          }
        }
        // UI-ul și polling-ul sunt deja pornite; QR-ul se va afișa imediat ce e disponibil prin SSE/polling
      } else {
        console.error('Error creating WhatsApp account:', data.error);
        utils.showToast(`Eroare la crearea contului: ${data.error}`, 'error');
      }
      
    } catch (error) {
      console.error('❌ Error creating WhatsApp account:', error);
      utils.showToast('Eroare la crearea contului!', 'error');
    }
  }

  /**
   * Show QR Code in modal
   */
  showQRCodeInModal(accountName) {
    this.showQRInDropdown(accountName);
  }

  showQRInDropdown(accountName, initialDataUrl) {
    const container = document.getElementById('qrContainer');
    if (!container) return;
    container.innerHTML = `<div class="qr-code-display"></div>`;
    const display = container.querySelector('.qr-code-display');
    // dacă avem deja un QR din răspunsul /add, arată-l instant
    if (initialDataUrl && display) {
      display.innerHTML = `<img src="${initialDataUrl}" alt="QR" style="max-width:200px;height:auto;display:block;margin:0 auto;"/>`;
    }
    const tryInstant = async () => {
      try {
        const res = await fetch(`/api/whatsapp/accounts?t=${Date.now()}`);
        const data = await res.json();
        if (data && data.success && Array.isArray(data.accounts)) {
          const account = data.accounts.find(acc => {
            const id = String(acc.id || '');
            const clean = id.replace(/^(session-)+/i, '');
            return id === `session-${accountName}` || clean === accountName;
          });
          if (account && account.qrDataUrl && display) {
            display.innerHTML = `<img src="${account.qrDataUrl}" alt="QR" style="max-width:200px;height:auto;display:block;margin:0 auto;"/>`;
          }
        }
      } catch(_) {}
      this.pollForQRCode(accountName, container);
    };
    tryInstant();
  }

  /**
   * Confirm WhatsApp connection after QR scan
   */
  async confirmWhatsAppConnection(accountName) {
    try {
      this.clearQRFlows(accountName);
      // Setează contul ca activ (acceptă nume curat sau cu prefix)
      await fetch('/api/whatsapp/switch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: accountName })
      });

      // Închide modalul și confirmă salvarea
      const qrSection = document.querySelector('.qr-code-section');
      if (qrSection) {
        qrSection.remove();
      }
      utils.showToast('✅ Salvat', 'success');

      // Actualizează UI
      this.updateWhatsAppStatusUI();
      this.loadWhatsAppAccounts();

    } catch (error) {
      console.error('❌ Eroare la salvarea contului WhatsApp:', error);
      utils.showToast('❌ Eroare la salvare!', 'error');
    }
  }

  /**
   * Poll for QR code data
   */
  async pollForQRCode(accountName, qrSection) {
    const maxAttempts = 90;
    let attempts = 0;
    const key = String(accountName || '').replace(/^(session-)+/i, '');
    const pollInterval = setInterval(async () => {
      attempts++;
      try {
        const response = await fetch(`/api/whatsapp/accounts?t=${Date.now()}`);
        const data = await response.json();
        if (data.success && data.accounts) {
          const account = data.accounts.find(acc => {
            const id = String(acc.id || '');
            const clean = id.replace(/^(session-)+/i, '');
            return id === `session-${accountName}` || clean === accountName;
          });
          if (account && account.qrDataUrl) {
            const display = qrSection.querySelector('.qr-code-display');
            if (display) display.innerHTML = `<img src="${account.qrDataUrl}" alt="QR Code" style="max-width:200px;height:auto;"/>`;
          }
          if (account && account.connected) {
            clearInterval(pollInterval);
            const display = qrSection.querySelector('.qr-code-display');
            if (display) display.innerHTML = '';
            qrSection.innerHTML = '';
            utils.showToast('WhatsApp conectat', 'success');
            await this.loadWhatsAppAccounts();
          }
        }
      } catch (_) {}
      if (attempts >= maxAttempts) {
        clearInterval(pollInterval);
        utils.showToast('QR timeout. Reîncearcă regenerarea.', 'warning');
      }
    }, 1000);
  }

  /**
   * Monitor connection status after QR is displayed
   */
  async monitorConnectionStatus(accountName, qrSection) {
    const maxAttempts = 60; // 60 seconds to connect (1s interval)
    let attempts = 0;
    const key = String(accountName || '').replace(/^(session-)+/i, '');
    const monitorInterval = setInterval(async () => {
      attempts++;
      
      try {
        const response = await fetch(`/api/whatsapp/accounts?t=${Date.now()}`);
        const data = await response.json();
        
        if (data.success && data.accounts) {
          const account = data.accounts.find(acc => {
            const id = String(acc.id || '');
            const clean = id.replace(/^(session-)+/i, '');
            return id === `session-${accountName}` || clean === accountName;
          });
          
          if (account && account.connected === true) {
            // Account is connected, hide QR
            utils.showToast(`✅ Contul ${accountName} a fost conectat cu succes!`, 'success');
            qrSection.remove();
            clearInterval(monitorInterval);
            if (this.connectionMonitors) delete this.connectionMonitors[key];
            return;
          }
        }
        
        if (attempts >= maxAttempts) {
          clearInterval(monitorInterval);
          if (this.connectionMonitors) delete this.connectionMonitors[key];
          console.log('⏰ Timeout waiting for connection');
        }
        
      } catch (error) {
        console.error('Error monitoring connection:', error);
        if (attempts >= maxAttempts) {
          clearInterval(monitorInterval);
        }
      }
    }, 1000);
    // Reține monitorul pentru a-l putea opri la „Anulează"
    this.connectionMonitors[key] = monitorInterval;
  }

  /**
   * Update WhatsApp Link status UI
   */
  async updateWhatsAppStatusUI() {
    try {
      const response = await fetch('/api/whatsapp/status');
      const data = await response.json();
      
      this.whatsappStatus = data.isConnected ? 'connected' : 'disconnected';
      this.updateWhatsAppStatus(this.whatsappStatus, data.message, data.qrCode, data.qrDataUrl);
      
      console.log('📱 WhatsApp status updated:', {
        connected: data.isConnected,
        hasQR: !!data.qrDataUrl,
        message: data.message
      });

      // Dacă e deconectat, afișează imediat modalul de QR pentru reconectare
      if (!data.isConnected) {
        try {
          const modal = document.getElementById('whatsapp-modal');
          if (modal) modal.classList.add('active');
        } catch(_) {}
      }
      
    } catch (error) {
      console.error('❌ Error updating WhatsApp status UI:', error);
      this.updateWhatsAppStatus('disconnected', 'Eroare la verificarea statusului');
    }
  }

  /**
   * Open WhatsApp message modal for specific driver status
   */
  openWhatsAppMessageModal(status) {
    console.log('📱 openWhatsAppMessageModal called with status:', status);
    if (!this.whatsappMessageModal) {
      console.error('❌ WhatsApp message modal not found!');
      return;
    }
    // Remember current status for later preset saves
    this.currentWhatsAppStatus = status;

    // Get drivers with the specified status
    const filteredDrivers = this.drivers.filter(driver => driver.status === status);
    console.log('📱 Filtered drivers:', filteredDrivers);
    
    // Permite deschiderea chiar și fără șoferi, pentru a seta mesajul automat

    console.log('📱 Updating modal content...');
    // Update modal content
    this.updateWhatsAppModalContent(status, filteredDrivers);
    
    console.log('📱 Showing modal...');
    // Show modal
    this.whatsappMessageModal.classList.add('active');
    
    // Load private message from localStorage
    this.loadPrivateMessage();

    // Prefill default message per card/status
    (async () => {
      try {
        const res = await utils.apiRequest('/whatsapp/default-messages');
        const data = await utils.handleApiResponse(res);
        const msgs = (data && data.messages) || {};
        const key = status || this.currentWhatsAppStatus || 'activ';
        const customEl = document.getElementById('custom-message-text');
        if (customEl) customEl.value = msgs[key] || '';
        this.updateSendButtonState();
      } catch (_) {}
    })();
  }

  /**
   * Update WhatsApp modal content
   */
  updateWhatsAppModalContent(status, drivers) {
    // Update status info
    const statusText = document.getElementById('message-status-text');
    const statusCount = document.getElementById('message-status-count');
    const statusBadge = document.getElementById('message-status-badge');
    
    if (statusText) statusText.textContent = this.getStatusDisplayName(status);
    if (statusCount) statusCount.textContent = `${drivers.length} șoferi`;
    if (statusBadge) {
      const icon = statusBadge.querySelector('i');
      if (icon) icon.className = this.getStatusIcon(status);
    }

    // Populate drivers list
    this.populateWhatsAppDriversList(drivers);
    
    // Setează placeholder și titlu pentru Mesaj Automat Prestabilit
    const customMessage = document.getElementById('custom-message-text');
    if (customMessage) {
      customMessage.placeholder = 'Mesaj Automat Prestabilit...';
    }
    
    // Reset selection
    this.selectedMessageTemplate = null;
    
    // Update send button state
    this.updateSendButtonState();
  }

  /**
   * Get display name for driver status
   */
  getStatusDisplayName(status) {
    const statusNames = {
      'activ': 'Șoferi Activi',
      'vine_acasa': 'Vin Acasă',
      'acasa': 'Acasă',
      'catre_sediu': 'Catre Sediu'
    };
    return statusNames[status] || status;
  }

  /**
   * Get icon for driver status
   */
  getStatusIcon(status) {
    const statusIcons = {
      'activ': 'fas fa-users',
      'vine_acasa': 'fas fa-home',
      'acasa': 'fas fa-bed',
      'catre_sediu': 'fas fa-building'
    };
    return statusIcons[status] || 'fas fa-user';
  }

  /**
   * Populate drivers list in WhatsApp modal
   */
  populateWhatsAppDriversList(drivers) {
    const driversList = document.getElementById('whatsapp-drivers-list');
    if (!driversList) return;

    driversList.innerHTML = '';
    
    drivers.forEach(driver => {
      const driverItem = document.createElement('div');
      driverItem.className = 'whatsapp-driver-item';
      // Format dates for display (compact format)
      const formatDate = (dateString) => {
        if (!dateString) return 'N/A';
        const date = new Date(dateString);
        return date.toLocaleDateString('ro-RO', { 
          day: '2-digit', 
          month: '2-digit',
          hour: '2-digit',
          minute: '2-digit'
        });
      };

      driverItem.innerHTML = `
        <input type="checkbox" class="whatsapp-driver-checkbox" value="${driver.id}">
        <div class="driver-info">
          <div class="driver-name">${driver.firstName} ${driver.lastName}</div>
          <div class="driver-details">📞 ${driver.phone} • 🚀 Plecare: ${formatDate(driver.departureDate)} • 🏠 Sosire: ${formatDate(driver.estimatedReturnDate)}</div>
        </div>
      `;
      
      // Add event listener for checkbox
      const checkbox = driverItem.querySelector('input[type="checkbox"]');
      if (checkbox) {
        checkbox.addEventListener('change', () => this.updateSelectedDrivers());
      }
      
      driversList.appendChild(driverItem);
    });
    
    // Update selected drivers after populating
    this.updateSelectedDrivers();
  }

  /**
   * Populate message templates
   */
  // populateMessageTemplates eliminat

  /**
   * Get message templates for specific status
   */
  // getMessageTemplates eliminat

  /**
   * Select message template
   */
  // selectMessageTemplate eliminat

  /**
   * Select all drivers
   */
  selectAllDrivers() {
    const checkboxes = document.querySelectorAll('.whatsapp-driver-checkbox');
    checkboxes.forEach(checkbox => {
      checkbox.checked = true;
    });
  }

  /**
   * Deselect all drivers
   */
  deselectAllDrivers() {
    const checkboxes = document.querySelectorAll('.whatsapp-driver-checkbox');
    checkboxes.forEach(checkbox => {
      checkbox.checked = false;
    });
  }

  /**
   * Close WhatsApp message modal
   */
  closeWhatsAppMessageModal() {
    if (this.whatsappMessageModal) {
      this.whatsappMessageModal.classList.remove('active');
    }
    
    // Save private message to localStorage
    this.savePrivateMessage();
  }

  /**
   * Save private message to localStorage
   */
  savePrivateMessage() {
    const privateMessageInput = document.getElementById('private-message-text');
    if (privateMessageInput) {
      const privateText = privateMessageInput.value.trim();
      if (privateText) {
        localStorage.setItem('whatsapp-private-message', privateText);
      }
    }
  }

  /**
   * Load private message from localStorage
   */
  loadPrivateMessage() {
    const privateMessageInput = document.getElementById('private-message-text');
    if (privateMessageInput) {
      const savedMessage = localStorage.getItem('whatsapp-private-message');
      if (savedMessage) {
        privateMessageInput.value = savedMessage;
      }
    }
  }
}

// Initialize app when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  window.app = new App();
});