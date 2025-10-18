// ===========================================
// UTILITY FUNCTIONS
// ===========================================

/**
 * API Base URL
 */
const API_BASE_URL = '/api';

/**
 * Show loading screen
 */
const showLoading = () => {
  const loadingScreen = document.getElementById('loading-screen');
  if (loadingScreen) {
    loadingScreen.classList.remove('hidden');
  }
};

/**
 * Hide loading screen
 */
const hideLoading = () => {
  const loadingScreen = document.getElementById('loading-screen');
  if (loadingScreen) {
    loadingScreen.classList.add('hidden');
  }
};

/**
 * Show toast notification
 */
const showToast = (message, type = 'info', duration = 2000) => {
  const toastContainer = document.getElementById('toast-container');
  if (!toastContainer) return;

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `
    <div style="display: flex; align-items: center; gap: 10px;">
      <i class="fas ${getToastIcon(type)}"></i>
      <span>${message}</span>
    </div>
  `;

  toastContainer.appendChild(toast);

  // Show toast
  setTimeout(() => {
    toast.classList.add('show');
  }, 100);

  // Auto remove
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => {
      if (toast.parentNode) {
        toast.parentNode.removeChild(toast);
      }
    }, 300);
  }, duration);
};

/**
 * Get toast icon based on type
 */
const getToastIcon = (type) => {
  const icons = {
    success: 'fa-check-circle',
    error: 'fa-exclamation-circle',
    warning: 'fa-exclamation-triangle',
    info: 'fa-info-circle'
  };
  return icons[type] || icons.info;
};

/**
 * Format date to Romanian format
 */
const formatDate = (dateString) => {
  if (!dateString) return '';
  try {
    // If it's a local input-like string YYYY-MM-DD or YYYY-MM-DDTHH:MM, format manually to avoid TZ shifts
    const m = String(dateString).match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{2}):(\d{2}))?/);
    if (m) {
      const [_, y, mo, d] = m;
      return `${d}.${mo}.${y}`;
    }
    const date = new Date(dateString);
    return date.toLocaleDateString('ro-RO');
  } catch (_) {
    return String(dateString);
  }
};

/**
 * Format date-time to Romanian locale (DD.MM.YYYY, HH:MM)
 */
const formatDateTime = (dateString) => {
  if (!dateString) return '';
  try {
    // Prefer manual formatting if matches local input format to avoid timezone conversions
    const m = String(dateString).match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{2}):(\d{2}))?/);
    if (m) {
      const [_, y, mo, d, hh = '00', mm = '00'] = m;
      return `${d}.${mo}.${y}, ${hh}:${mm}`;
    }
    const d = new Date(dateString);
    const date = d.toLocaleDateString('ro-RO');
    const time = d.toLocaleTimeString('ro-RO', { hour: '2-digit', minute: '2-digit' });
    return `${date}, ${time}`;
  } catch (_) {
    return formatDate(dateString);
  }
};

/**
 * Format phone number
 */
const formatPhone = (phone) => {
  if (!phone) return '';
  try {
    if (window.autoFormatter && typeof window.autoFormatter.formatPhone === 'function') {
      return window.autoFormatter.formatPhone(String(phone));
    }
    return String(phone);
  } catch (_) {
    return String(phone);
  }
};

/**
 * Format car number
 */
const formatCarNumber = (carNumber) => {
  if (!carNumber) return '';
  
  // Romanian format: MH-02-TDI
  if (/^[A-Z]{2}-\d{2}-[A-Z]{3}$/i.test(carNumber)) {
    return carNumber.toUpperCase();
  }
  
  // Auto-format Romanian numbers
  const cleaned = carNumber.replace(/\s/g, '').toUpperCase();
  if (/^[A-Z]{2}\d{2}[A-Z]{3}$/.test(cleaned)) {
    return cleaned.replace(/([A-Z]{2})(\d{2})([A-Z]{3})/, '$1-$2-$3');
  }
  
  return carNumber.toUpperCase();
};

/**
 * Calculate days until return
 */
const getDaysUntilReturn = (returnDate) => {
  if (!returnDate) return null;
  
  const today = new Date();
  const returnDateObj = new Date(returnDate);
  const diffTime = returnDateObj - today;
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  
  return diffDays;
};

/**
 * Get status color based on days until return
 */
const getStatusColor = (daysUntilReturn) => {
  if (daysUntilReturn === null) return 'liber';
  if (daysUntilReturn < 0) return 'overdue';
  if (daysUntilReturn <= 3) return 'sosire_apropiata';
  return 'ocupat';
};

/**
 * Debounce function
 */
const debounce = (func, wait) => {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
};

/**
 * Throttle function
 */
const throttle = (func, limit) => {
  let inThrottle;
  return function() {
    const args = arguments;
    const context = this;
    if (!inThrottle) {
      func.apply(context, args);
      inThrottle = true;
      setTimeout(() => inThrottle = false, limit);
    }
  };
};

/**
 * Get auth token from localStorage
 */
const getAuthToken = () => {
  return localStorage.getItem('accessToken');
};

/**
 * Set auth token in localStorage
 */
const setAuthToken = (token) => {
  localStorage.setItem('accessToken', token);
};

/**
 * Remove auth token from localStorage
 */
const removeAuthToken = () => {
  localStorage.removeItem('accessToken');
  localStorage.removeItem('refreshToken');
  localStorage.removeItem('user');
};

/**
 * Get user from localStorage
 */
const getUser = () => {
  const userStr = localStorage.getItem('user');
  return userStr ? JSON.parse(userStr) : null;
};

/**
 * Set user in localStorage
 */
const setUser = (user) => {
  localStorage.setItem('user', JSON.stringify(user));
};

/**
 * Make authenticated API request
 */
const apiRequest = async (url, options = {}) => {
  const token = getAuthToken();
  const apiKey = localStorage.getItem('waApiKey');
  
  const defaultOptions = {
    headers: {
      'Content-Type': 'application/json',
      ...(token && { 'Authorization': `Bearer ${token}` }),
      ...(apiKey && { 'x-api-key': apiKey })
    }
  };

  const mergedOptions = {
    ...defaultOptions,
    ...options,
    headers: {
      ...defaultOptions.headers,
      ...options.headers
    }
  };

  try {
    const response = await fetch(`${API_BASE_URL}${url}`, mergedOptions);
    
    if (response.status === 401) {
      // Token expired, try to refresh
      const refreshToken = localStorage.getItem('refreshToken');
      if (refreshToken) {
        const refreshResponse = await fetch(`${API_BASE_URL}/auth/refresh-token`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken })
        });

        if (refreshResponse.ok) {
          const refreshData = await refreshResponse.json();
          setAuthToken(refreshData.tokens.accessToken);
          localStorage.setItem('refreshToken', refreshData.tokens.refreshToken);
          
          // Retry original request
          mergedOptions.headers['Authorization'] = `Bearer ${refreshData.tokens.accessToken}`;
          return await fetch(`${API_BASE_URL}${url}`, mergedOptions);
        }
      }
      
      // Refresh failed, redirect to login
      removeAuthToken();
      window.location.reload();
      return;
    }

    return response;
  } catch (error) {
    console.error('API request error:', error);
    throw error;
  }
};

/**
 * Handle API response
 */
const handleApiResponse = async (response) => {
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `HTTP ${response.status}: ${response.statusText}`);
  }
  
  return await response.json();
};

// Minimal IndexedDB helper for chat thread caching
const idb = (() => {
  let dbp = null;
  function open() {
    if (dbp) return dbp;
    dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open('mt_chat_cache', 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('threads')) db.createObjectStore('threads', { keyPath: 'phone' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbp;
  }
  async function putThread(phone, messages, total, meta = {}) {
    try {
      const db = await open();
      const tx = db.transaction('threads', 'readwrite');
      tx.objectStore('threads').put({ phone, messages, total, ts: Date.now(), ...meta });
      return await new Promise((resolve) => { tx.oncomplete = resolve; tx.onabort = resolve; });
    } catch(_) {}
  }
  async function getThread(phone) {
    try {
      const db = await open();
      const tx = db.transaction('threads', 'readonly');
      return await new Promise((resolve) => {
        const req = tx.objectStore('threads').get(phone);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => resolve(null);
      });
    } catch(_) { return null; }
  }
  return { putThread, getThread };
})();

/**
 * Validate email
 */
const isValidEmail = (email) => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

/**
 * Validate phone number (Romanian format)
 */
const isValidPhone = (phone) => {
  if (!phone) return false;
  
  // Remove all spaces and special characters except + and digits
  const cleanPhone = phone.replace(/[^\d+]/g, '');
  
  // Romanian mobile format: 07xxxxxxxx (10 digits starting with 07)
  const romanianMobileRegex = /^07[0-9]{8}$/;
  
  // International format: +407xxxxxxxx (12 digits starting with +407)
  const internationalRegex = /^\+407[0-9]{8}$/;
  
  return romanianMobileRegex.test(cleanPhone) || internationalRegex.test(cleanPhone);
};

/**
 * Validate car number
 */
const isValidCarNumber = (carNumber) => {
  if (!carNumber) return false;
  
  const cleanCarNumber = carNumber.toUpperCase();
  
  // Romanian format: X-XX-XXX (București) sau XX-XX-XXX (alte județe)
  // Acceptă 1-2 litere pentru județ, 2-3 cifre, 2-3 litere
  const romanianRegex = /^[A-Z]{1,2}-\d{2,3}-[A-Z]{2,3}$/;
  
  return romanianRegex.test(cleanCarNumber);
};

/**
 * Generate random ID
 */
const generateId = () => {
  return Math.random().toString(36).substr(2, 9);
};

/**
 * Copy text to clipboard
 */
const copyToClipboard = async (text) => {
  try {
    await navigator.clipboard.writeText(text);
    showToast('Text copiat în clipboard', 'success');
  } catch (error) {
    console.error('Failed to copy to clipboard:', error);
    showToast('Eroare la copierea textului', 'error');
  }
};

/**
 * Download file
 */
const downloadFile = (data, filename, type = 'text/plain') => {
  const blob = new Blob([data], { type });
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.URL.revokeObjectURL(url);
};

/**
 * Format file size
 */
const formatFileSize = (bytes) => {
  if (bytes === 0) return '0 Bytes';
  
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

/**
 * Get time ago string
 */
const getTimeAgo = (dateString) => {
  if (!dateString) return '';
  
  const date = new Date(dateString);
  const now = new Date();
  const diffInSeconds = Math.floor((now - date) / 1000);
  
  if (diffInSeconds < 60) return 'acum';
  if (diffInSeconds < 3600) return `${Math.floor(diffInSeconds / 60)} min`;
  if (diffInSeconds < 86400) return `${Math.floor(diffInSeconds / 3600)} ore`;
  if (diffInSeconds < 2592000) return `${Math.floor(diffInSeconds / 86400)} zile`;
  
  return formatDate(dateString);
};

/**
 * Check if expiry is within next N days
 */
const isExpirySoon = (dateStr, days = 30) => {
  if (!dateStr) return false;
  try {
    const now = new Date();
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return false;
    const diffDays = (d.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
    // Consideră și expirate (<0) ca fiind "în fereastră" pentru a păstra avertizarea până la actualizare
    return diffDays <= days;
  } catch (_) {
    return false;
  }
};

/**
 * Escape HTML
 */
const escapeHtml = (text) => {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
};

/**
 * Parse query parameters
 */
const parseQueryParams = () => {
  const params = new URLSearchParams(window.location.search);
  const result = {};
  for (const [key, value] of params) {
    result[key] = value;
  }
  return result;
};

/**
 * Update query parameters
 */
const updateQueryParams = (params) => {
  const url = new URL(window.location);
  Object.keys(params).forEach(key => {
    if (params[key] !== null && params[key] !== undefined) {
      url.searchParams.set(key, params[key]);
    } else {
      url.searchParams.delete(key);
    }
  });
  window.history.replaceState({}, '', url);
};

/**
 * Check if element is in viewport
 */
const isInViewport = (element) => {
  const rect = element.getBoundingClientRect();
  return (
    rect.top >= 0 &&
    rect.left >= 0 &&
    rect.bottom <= (window.innerHeight || document.documentElement.clientHeight) &&
    rect.right <= (window.innerWidth || document.documentElement.clientWidth)
  );
};

/**
 * Smooth scroll to element
 */
const scrollToElement = (element, offset = 0) => {
  const elementPosition = element.getBoundingClientRect().top;
  const offsetPosition = elementPosition + window.pageYOffset - offset;

  window.scrollTo({
    top: offsetPosition,
    behavior: 'smooth'
  });
};

/**
 * Get device type
 */
const getDeviceType = () => {
  const width = window.innerWidth;
  if (width < 768) return 'mobile';
  if (width < 1024) return 'tablet';
  return 'desktop';
};

/**
 * Check if device is mobile
 */
const isMobile = () => {
  return getDeviceType() === 'mobile';
};

/**
 * Check if device is tablet
 */
const isTablet = () => {
  return getDeviceType() === 'tablet';
};

/**
 * Check if device is desktop
 */
const isDesktop = () => {
  return getDeviceType() === 'desktop';
};

// Export functions for use in other modules
window.utils = {
  showLoading,
  hideLoading,
  showToast,
  getToastIcon,
  formatDate,
  formatPhone,
  formatCarNumber,
  formatDateTime,
  getDaysUntilReturn,
  getStatusColor,
  debounce,
  throttle,
  getAuthToken,
  setAuthToken,
  removeAuthToken,
  getUser,
  setUser,
  apiRequest,
  handleApiResponse,
  isValidEmail,
  isValidPhone,
  isValidCarNumber,
  generateId,
  copyToClipboard,
  downloadFile,
  formatFileSize,
  getTimeAgo,
  escapeHtml,
  parseQueryParams,
  updateQueryParams,
  isInViewport,
  scrollToElement,
  getDeviceType,
  isMobile,
  isTablet,
  isDesktop,
  isExpirySoon,
  idb
};

// Create global utils variable for backward compatibility
const utils = window.utils;
