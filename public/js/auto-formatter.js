// ===========================================
// AUTO FORMATTER - Formatare automată pentru toate câmpurile
// ===========================================

class AutoFormatter {
  constructor() {
    this.phonePatterns = {
      // România: +40 7XX XXX XXX
      'RO': {
        pattern: /^(\+40|0040|40)?\s?0?([2-9]\d{8})$/,
        format: (match) => `+40 ${match[2].substring(0, 3)} ${match[2].substring(3, 6)} ${match[2].substring(6)}`
      },
      // Germania: +49 XXX XXXXXXX
      'DE': {
        pattern: /^(\+49|0049|49)?\s?0?([1-9]\d{8,9})$/,
        format: (match) => `+49 ${match[2].substring(0, 3)} ${match[2].substring(3)}`
      },
      // Franța: +33 X XX XX XX XX
      'FR': {
        pattern: /^(\+33|0033|33)?\s?0?([1-9]\d{8})$/,
        format: (match) => `+33 ${match[2].substring(0, 1)} ${match[2].substring(1, 3)} ${match[2].substring(3, 5)} ${match[2].substring(5, 7)} ${match[2].substring(7)}`
      },
      // Italia: +39 XXX XXX XXXX
      'IT': {
        pattern: /^(\+39|0039|39)?\s?0?([1-9]\d{8,9})$/,
        format: (match) => `+39 ${match[2].substring(0, 3)} ${match[2].substring(3, 6)} ${match[2].substring(6)}`
      },
      // Ungaria: +36 XX XXX XXXX
      'HU': {
        pattern: /^(\+36|0036|36)?\s?0?([1-9]\d{8})$/,
        format: (match) => `+36 ${match[2].substring(0, 2)} ${match[2].substring(2, 5)} ${match[2].substring(5)}`
      },
      // Bulgaria: +359 XX XXX XXXX
      'BG': {
        pattern: /^(\+359|00359|359)?\s?0?([1-9]\d{8})$/,
        format: (match) => `+359 ${match[2].substring(0, 2)} ${match[2].substring(2, 5)} ${match[2].substring(5)}`
      },
      // Serbia: +381 XX XXX XXXX
      'RS': {
        pattern: /^(\+381|00381|381)?\s?0?([1-9]\d{8})$/,
        format: (match) => `+381 ${match[2].substring(0, 2)} ${match[2].substring(2, 5)} ${match[2].substring(5)}`
      },
      // Ucraina: +380 XX XXX XXXX
      'UA': {
        pattern: /^(\+380|00380|380)?\s?0?([1-9]\d{8})$/,
        format: (match) => `+380 ${match[2].substring(0, 2)} ${match[2].substring(2, 5)} ${match[2].substring(5)}`
      },
      // Polonia: +48 XXX XXX XXX
      'PL': {
        pattern: /^(\+48|0048|48)?\s?0?([1-9]\d{8})$/,
        format: (match) => `+48 ${match[2].substring(0, 3)} ${match[2].substring(3, 6)} ${match[2].substring(6)}`
      },
      // Cehia: +420 XXX XXX XXX
      'CZ': {
        pattern: /^(\+420|00420|420)?\s?0?([1-9]\d{8})$/,
        format: (match) => `+420 ${match[2].substring(0, 3)} ${match[2].substring(3, 6)} ${match[2].substring(6)}`
      }
    };

    this.carNumberPatterns = {
      // România: AB-12-CDE, AB-123-CDE (2-3 cifre după județ)
      'RO': /^([A-Z]{1,2})-?(\d{2,3})-?([A-Z]{2,3})$/,
      // Germania: AB-CD 1234, AB-C 1234
      'DE': /^([A-Z]{1,2})-?([A-Z]{1,2})\s?(\d{1,4})$/,
      // Franța: AB-123-CD
      'FR': /^([A-Z]{2})-?(\d{3})-?([A-Z]{2})$/,
      // Italia: AB 123 CD
      'IT': /^([A-Z]{2})\s?(\d{3})\s?([A-Z]{2})$/,
      // Ungaria: AB-1234
      'HU': /^([A-Z]{2})-?(\d{4})$/,
      // Bulgaria: AB 1234 CD
      'BG': /^([A-Z]{2})\s?(\d{4})\s?([A-Z]{2})$/,
      // Serbia: AB-123-CD
      'RS': /^([A-Z]{2})-?(\d{3})-?([A-Z]{2})$/,
      // Ucraina: AB 1234 CD
      'UA': /^([A-Z]{2})\s?(\d{4})\s?([A-Z]{2})$/,
      // Polonia: AB 1234
      'PL': /^([A-Z]{2})\s?(\d{4})$/,
      // Cehia: AB 1234
      'CZ': /^([A-Z]{2})\s?(\d{4})$/
    };

    this.carNumberFormats = {
      'RO': (match) => `${match[1]}-${match[2]}-${match[3]}`,
      'DE': (match) => `${match[1]}-${match[2]} ${match[3]}`,
      'FR': (match) => `${match[1]}-${match[2]}-${match[3]}`,
      'IT': (match) => `${match[1]} ${match[2]} ${match[3]}`,
      'HU': (match) => `${match[1]}-${match[2]}`,
      'BG': (match) => `${match[1]} ${match[2]} ${match[3]}`,
      'RS': (match) => `${match[1]}-${match[2]}-${match[3]}`,
      'UA': (match) => `${match[1]} ${match[2]} ${match[3]}`,
      'PL': (match) => `${match[1]} ${match[2]}`,
      'CZ': (match) => `${match[1]} ${match[2]}`
    };
  }

  /**
   * Detectează țara pentru numărul de telefon
   */
  detectPhoneCountry(input) {
    const cleanInput = input.replace(/[^\d+]/g, '');
    
    // Verifică prefixele
    if (cleanInput.startsWith('+40') || cleanInput.startsWith('0040') || cleanInput.startsWith('40')) {
      return 'RO';
    }
    if (cleanInput.startsWith('+49') || cleanInput.startsWith('0049') || cleanInput.startsWith('49')) {
      return 'DE';
    }
    if (cleanInput.startsWith('+33') || cleanInput.startsWith('0033') || cleanInput.startsWith('33')) {
      return 'FR';
    }
    if (cleanInput.startsWith('+39') || cleanInput.startsWith('0039') || cleanInput.startsWith('39')) {
      return 'IT';
    }
    if (cleanInput.startsWith('+36') || cleanInput.startsWith('0036') || cleanInput.startsWith('36')) {
      return 'HU';
    }
    if (cleanInput.startsWith('+359') || cleanInput.startsWith('00359') || cleanInput.startsWith('359')) {
      return 'BG';
    }
    if (cleanInput.startsWith('+381') || cleanInput.startsWith('00381') || cleanInput.startsWith('381')) {
      return 'RS';
    }
    if (cleanInput.startsWith('+380') || cleanInput.startsWith('00380') || cleanInput.startsWith('380')) {
      return 'UA';
    }
    if (cleanInput.startsWith('+48') || cleanInput.startsWith('0048') || cleanInput.startsWith('48')) {
      return 'PL';
    }
    if (cleanInput.startsWith('+420') || cleanInput.startsWith('00420') || cleanInput.startsWith('420')) {
      return 'CZ';
    }
    
    // Dacă nu are prefix, încearcă să detecteze după lungime și primul număr
    const digitsOnly = cleanInput.replace(/[^\d]/g, '');
    
    // România: 10 cifre, începe cu 7
    if (digitsOnly.length === 10 && digitsOnly.startsWith('7')) {
      return 'RO';
    }
    // Germania: 10-11 cifre, începe cu 1-9
    if ((digitsOnly.length === 10 || digitsOnly.length === 11) && /^[1-9]/.test(digitsOnly)) {
      return 'DE';
    }
    // Franța: 10 cifre, începe cu 1-9
    if (digitsOnly.length === 10 && /^[1-9]/.test(digitsOnly)) {
      return 'FR';
    }
    // Italia: 10-11 cifre, începe cu 1-9
    if ((digitsOnly.length === 10 || digitsOnly.length === 11) && /^[1-9]/.test(digitsOnly)) {
      return 'IT';
    }
    // Ungaria: 9 cifre, începe cu 1-9
    if (digitsOnly.length === 9 && /^[1-9]/.test(digitsOnly)) {
      return 'HU';
    }
    // Bulgaria: 9 cifre, începe cu 1-9
    if (digitsOnly.length === 9 && /^[1-9]/.test(digitsOnly)) {
      return 'BG';
    }
    // Serbia: 9 cifre, începe cu 1-9
    if (digitsOnly.length === 9 && /^[1-9]/.test(digitsOnly)) {
      return 'RS';
    }
    // Ucraina: 9 cifre, începe cu 1-9
    if (digitsOnly.length === 9 && /^[1-9]/.test(digitsOnly)) {
      return 'UA';
    }
    // Polonia: 9 cifre, începe cu 1-9
    if (digitsOnly.length === 9 && /^[1-9]/.test(digitsOnly)) {
      return 'PL';
    }
    // Cehia: 9 cifre, începe cu 1-9
    if (digitsOnly.length === 9 && /^[1-9]/.test(digitsOnly)) {
      return 'CZ';
    }
    
    // Default la România
    return 'RO';
  }

  /**
   * Detectează țara pentru numărul de mașină
   */
  detectCarCountry(input) {
    const cleanInput = input.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    
    // Verifică pentru România (cel mai comun) - 1-2 litere + 2-3 cifre + 2-3 litere
    if (/^[A-Z]{1,2}\d{2,3}[A-Z]{2,3}$/.test(cleanInput)) {
      return 'RO';
    }
    // Verifică pentru Germania
    if (/^[A-Z]{1,2}[A-Z]{1,2}\d{1,4}$/.test(cleanInput)) {
      return 'DE';
    }
    // Verifică pentru Franța
    if (/^[A-Z]{2}\d{3}[A-Z]{2}$/.test(cleanInput)) {
      return 'FR';
    }
    // Verifică pentru Italia
    if (/^[A-Z]{2}\d{3}[A-Z]{2}$/.test(cleanInput)) {
      return 'IT';
    }
    // Verifică pentru Ungaria
    if (/^[A-Z]{2}\d{4}$/.test(cleanInput)) {
      return 'HU';
    }
    // Verifică pentru Bulgaria
    if (/^[A-Z]{2}\d{4}[A-Z]{2}$/.test(cleanInput)) {
      return 'BG';
    }
    // Verifică pentru Serbia
    if (/^[A-Z]{2}\d{3}[A-Z]{2}$/.test(cleanInput)) {
      return 'RS';
    }
    // Verifică pentru Ucraina
    if (/^[A-Z]{2}\d{4}[A-Z]{2}$/.test(cleanInput)) {
      return 'UA';
    }
    // Verifică pentru Polonia
    if (/^[A-Z]{2}\d{4}$/.test(cleanInput)) {
      return 'PL';
    }
    // Verifică pentru Cehia
    if (/^[A-Z]{2}\d{4}$/.test(cleanInput)) {
      return 'CZ';
    }
    
    // Default la România
    return 'RO';
  }

  /**
   * Formatează numărul de telefon
   */
  formatPhone(input) {
    if (!input) return '';
    
    const cleanInput = input.replace(/[^\d+]/g, '');
    if (cleanInput.length < 7) return input; // Prea scurt pentru formatare
    
    const country = this.detectPhoneCountry(cleanInput);
    const pattern = this.phonePatterns[country];
    
    if (pattern) {
      const match = cleanInput.match(pattern.pattern);
      if (match) {
        return pattern.format(match);
      }
    }
    
    // Dacă nu se potrivește cu niciun pattern, returnează input-ul original
    return input;
  }

  /**
   * Formatează numărul de mașină
   */
  formatCarNumber(input) {
    if (!input) return '';
    
    const cleanInput = input.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    if (cleanInput.length < 3) return cleanInput;
    
    const country = this.detectCarCountry(cleanInput);
    const pattern = this.carNumberPatterns[country];
    const match = cleanInput.match(pattern);
    
    if (match) {
      return this.carNumberFormats[country](match);
    }
    
    // Dacă nu se potrivește cu niciun pattern, aplică formatul românesc
    return this.formatRomanianCar(cleanInput);
  }

  /**
   * Formatează numărul românesc de mașină
   */
  formatRomanianCar(input) {
    // Pattern pentru România: 1-2 litere + 2-3 cifre + 2-3 litere
    const match = input.match(/^([A-Z]{1,2})(\d{2,3})([A-Z]{2,3})$/);
    if (match) {
      return `${match[1]}-${match[2]}-${match[3]}`;
    }
    return input;
  }

  /**
   * Formatează numele (capitalizează prima literă)
   */
  formatName(input) {
    if (!input) return '';
    
    return input
      .toLowerCase()
      .split(' ')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }

  /**
   * Debounce helper pentru a evita formatarea prea frecventă
   */
  debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
      const later = () => {
        clearTimeout(timeout);
        func(...args);
      };
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
    };
  }
}

// Instanță globală
window.autoFormatter = new AutoFormatter();

// Auto-formatare pentru toate câmpurile
document.addEventListener('DOMContentLoaded', function() {
  const formatter = window.autoFormatter;
  
  // Formatare pentru numerele de telefon
    const phoneInputs = document.querySelectorAll('input[name="phone"], #driver-phone, .phone-input');
  phoneInputs.forEach(input => {
      const debouncedFormat = formatter.debounce((e) => {
        const formatted = formatter.formatPhone(e.target.value);
        if (formatted !== e.target.value) {
          e.target.value = formatted;
        }
      }, 400);

      // Formatează și la input, dar cu debounce rapid
      input.addEventListener('input', debouncedFormat);
      input.addEventListener('blur', (e) => {
        const formatted = formatter.formatPhone(e.target.value);
        if (formatted !== e.target.value) e.target.value = formatted;
      });
  });

  // Formatare pentru numerele de mașină
  const carNumberInputs = document.querySelectorAll('input[name="carNumber"], #driver-car-number, .car-number-input');
  carNumberInputs.forEach(input => {
    const debouncedFormat = formatter.debounce((e) => {
      const formatted = formatter.formatCarNumber(e.target.value);
      if (formatted !== e.target.value) {
        e.target.value = formatted;
      }
    }, 1000); // Formatare după 1 secundă de inactivitate
    
    input.addEventListener('blur', debouncedFormat);
    input.addEventListener('input', (e) => {
      // Nu formata în timpul scrierii, doar la blur
    });
  });

  // Formatare pentru numele și prenumele
  const nameInputs = document.querySelectorAll('input[name="firstName"], input[name="lastName"], #driver-first-name, #driver-last-name, .name-input');
  nameInputs.forEach(input => {
    const debouncedFormat = formatter.debounce((e) => {
      const formatted = formatter.formatName(e.target.value);
      if (formatted !== e.target.value) {
        e.target.value = formatted;
      }
    }, 1000); // Formatare după 1 secundă de inactivitate
    
    input.addEventListener('blur', debouncedFormat);
    input.addEventListener('input', (e) => {
      // Nu formata în timpul scrierii, doar la blur
    });
  });

  // Funcționalitate dropdown țară
  const countryBtn = document.getElementById('country-selector-btn');
  const countryCode = document.getElementById('country-code');
  const countryDropdown = document.getElementById('country-dropdown');
  const countrySearch = document.getElementById('country-search');
  const countryList = document.getElementById('country-list');
  
  if (countryBtn && countryCode && countryDropdown && countrySearch && countryList) {
    let currentCountry = 'RO';
    let filteredCountries = [];
    let selectedIndex = -1;
    
    const countries = [
      // Țări din Europa de Est și Centrală
      { code: 'RO', name: 'România', prefix: '+40', digits: 9, flag: '🇷🇴' },
      { code: 'BG', name: 'Bulgaria', prefix: '+359', digits: 8, flag: '🇧🇬' },
      { code: 'HU', name: 'Ungaria', prefix: '+36', digits: 8, flag: '🇭🇺' },
      { code: 'PL', name: 'Polonia', prefix: '+48', digits: 9, flag: '🇵🇱' },
      { code: 'CZ', name: 'Cehia', prefix: '+420', digits: 9, flag: '🇨🇿' },
      { code: 'SK', name: 'Slovacia', prefix: '+421', digits: 9, flag: '🇸🇰' },
      { code: 'SI', name: 'Slovenia', prefix: '+386', digits: 8, flag: '🇸🇮' },
      { code: 'HR', name: 'Croația', prefix: '+385', digits: 8, flag: '🇭🇷' },
      { code: 'RS', name: 'Serbia', prefix: '+381', digits: 8, flag: '🇷🇸' },
      { code: 'BA', name: 'Bosnia și Herțegovina', prefix: '+387', digits: 8, flag: '🇧🇦' },
      { code: 'ME', name: 'Muntenegru', prefix: '+382', digits: 8, flag: '🇲🇪' },
      { code: 'MK', name: 'Macedonia de Nord', prefix: '+389', digits: 8, flag: '🇲🇰' },
      { code: 'AL', name: 'Albania', prefix: '+355', digits: 8, flag: '🇦🇱' },
      { code: 'XK', name: 'Kosovo', prefix: '+383', digits: 8, flag: '🇽🇰' },
      { code: 'MD', name: 'Moldova', prefix: '+373', digits: 8, flag: '🇲🇩' },
      { code: 'UA', name: 'Ucraina', prefix: '+380', digits: 9, flag: '🇺🇦' },
      { code: 'BY', name: 'Belarus', prefix: '+375', digits: 9, flag: '🇧🇾' },
      { code: 'LT', name: 'Lituania', prefix: '+370', digits: 8, flag: '🇱🇹' },
      { code: 'LV', name: 'Letonia', prefix: '+371', digits: 8, flag: '🇱🇻' },
      { code: 'EE', name: 'Estonia', prefix: '+372', digits: 8, flag: '🇪🇪' },
      
      // Țări din Europa de Vest
      { code: 'DE', name: 'Germania', prefix: '+49', digits: 10, flag: '🇩🇪' },
      { code: 'FR', name: 'Franța', prefix: '+33', digits: 9, flag: '🇫🇷' },
      { code: 'IT', name: 'Italia', prefix: '+39', digits: 9, flag: '🇮🇹' },
      { code: 'ES', name: 'Spania', prefix: '+34', digits: 9, flag: '🇪🇸' },
      { code: 'PT', name: 'Portugalia', prefix: '+351', digits: 9, flag: '🇵🇹' },
      { code: 'GB', name: 'Marea Britanie', prefix: '+44', digits: 10, flag: '🇬🇧' },
      { code: 'IE', name: 'Irlanda', prefix: '+353', digits: 9, flag: '🇮🇪' },
      { code: 'NL', name: 'Olanda', prefix: '+31', digits: 9, flag: '🇳🇱' },
      { code: 'BE', name: 'Belgia', prefix: '+32', digits: 8, flag: '🇧🇪' },
      { code: 'LU', name: 'Luxemburg', prefix: '+352', digits: 9, flag: '🇱🇺' },
      { code: 'AT', name: 'Austria', prefix: '+43', digits: 10, flag: '🇦🇹' },
      { code: 'CH', name: 'Elveția', prefix: '+41', digits: 9, flag: '🇨🇭' },
      { code: 'LI', name: 'Liechtenstein', prefix: '+423', digits: 7, flag: '🇱🇮' },
      { code: 'MC', name: 'Monaco', prefix: '+377', digits: 8, flag: '🇲🇨' },
      { code: 'AD', name: 'Andorra', prefix: '+376', digits: 6, flag: '🇦🇩' },
      { code: 'SM', name: 'San Marino', prefix: '+378', digits: 10, flag: '🇸🇲' },
      { code: 'VA', name: 'Vatican', prefix: '+379', digits: 10, flag: '🇻🇦' },
      
      // Țări din Europa de Nord
      { code: 'SE', name: 'Suedia', prefix: '+46', digits: 9, flag: '🇸🇪' },
      { code: 'NO', name: 'Norvegia', prefix: '+47', digits: 8, flag: '🇳🇴' },
      { code: 'DK', name: 'Danemarca', prefix: '+45', digits: 8, flag: '🇩🇰' },
      { code: 'FI', name: 'Finlanda', prefix: '+358', digits: 9, flag: '🇫🇮' },
      { code: 'IS', name: 'Islanda', prefix: '+354', digits: 7, flag: '🇮🇸' },
      
      // Țări din Europa de Sud-Est
      { code: 'GR', name: 'Grecia', prefix: '+30', digits: 10, flag: '🇬🇷' },
      { code: 'CY', name: 'Cipru', prefix: '+357', digits: 8, flag: '🇨🇾' },
      { code: 'TR', name: 'Turcia', prefix: '+90', digits: 10, flag: '🇹🇷' },
      
      // Țări din Caucaz (parte din Europa)
      { code: 'GE', name: 'Georgia', prefix: '+995', digits: 9, flag: '🇬🇪' },
      { code: 'AM', name: 'Armenia', prefix: '+374', digits: 8, flag: '🇦🇲' },
      { code: 'AZ', name: 'Azerbaidjan', prefix: '+994', digits: 9, flag: '🇦🇿' }
    ];

    // Initialize filtered countries
    filteredCountries = [...countries];

    // Render country list
    function renderCountryList() {
      countryList.innerHTML = '';
      filteredCountries.forEach((country, index) => {
        const item = document.createElement('div');
        item.className = `country-item ${country.code === currentCountry ? 'selected' : ''}`;
        item.innerHTML = `
          <span class="country-flag">${country.flag}</span>
          <span class="country-name">${country.name}</span>
          <span class="country-code">${country.code}</span>
        `;
        
        item.addEventListener('click', () => selectCountry(country));
        countryList.appendChild(item);
      });
    }

    // Select country
    function selectCountry(country) {
      currentCountry = country.code;
      countryCode.textContent = country.code;
      countryBtn.title = `Țara: ${country.name}`;
      countryBtn.classList.remove('active');
      countryDropdown.classList.remove('active');
      countrySearch.value = '';
      filteredCountries = [...countries];
      selectedIndex = -1;
      
      // Re-format existing phone number if exists
      const phoneInput = document.getElementById('driver-phone');
      if (phoneInput && phoneInput.value) {
        let value = phoneInput.value.trim();
        
        // Remove any existing prefix first
        value = value.replace(/^\+\d{1,4}\s?/, '');
        
        // If number starts with 0, replace with new country prefix
        if (value.startsWith('0')) {
          // Remove the leading 0 and add new country prefix
          value = value.substring(1);
          value = `${country.prefix} ${value}`;
        } else {
          // Just add new country prefix
          value = `${country.prefix} ${value}`;
        }
        
        phoneInput.value = value;
      }
      
      renderCountryList();
    }

    // Toggle dropdown
    countryBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isActive = countryDropdown.classList.contains('active');
      
      if (isActive) {
        countryBtn.classList.remove('active');
        countryDropdown.classList.remove('active');
        countrySearch.value = '';
        filteredCountries = [...countries];
        selectedIndex = -1;
        renderCountryList();
      } else {
        countryBtn.classList.add('active');
        countryDropdown.classList.add('active');
        countrySearch.focus();
        renderCountryList();
      }
    });

    // Search functionality
    countrySearch.addEventListener('input', (e) => {
      const query = e.target.value.toLowerCase();
      filteredCountries = countries.filter(country => 
        country.name.toLowerCase().includes(query) || 
        country.code.toLowerCase().includes(query)
      );
      selectedIndex = -1;
      renderCountryList();
    });

    // Keyboard navigation
    countrySearch.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        selectedIndex = Math.min(selectedIndex + 1, filteredCountries.length - 1);
        updateSelection();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        selectedIndex = Math.max(selectedIndex - 1, -1);
        updateSelection();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (selectedIndex >= 0 && filteredCountries[selectedIndex]) {
          selectCountry(filteredCountries[selectedIndex]);
        }
      } else if (e.key === 'Escape') {
        countryBtn.classList.remove('active');
        countryDropdown.classList.remove('active');
        countrySearch.value = '';
        filteredCountries = [...countries];
        selectedIndex = -1;
        renderCountryList();
      }
    });

    // Update selection highlight
    function updateSelection() {
      const items = countryList.querySelectorAll('.country-item');
      items.forEach((item, index) => {
        item.classList.toggle('selected', index === selectedIndex);
      });
    }

    // Close dropdown when clicking outside
    document.addEventListener('click', (e) => {
      if (!countryBtn.contains(e.target) && !countryDropdown.contains(e.target)) {
        countryBtn.classList.remove('active');
        countryDropdown.classList.remove('active');
        countrySearch.value = '';
        filteredCountries = [...countries];
        selectedIndex = -1;
        renderCountryList();
      }
    });

    // Limit input based on selected country and validate letters
    const phoneInput = document.getElementById('driver-phone');
    if (phoneInput) {
      phoneInput.addEventListener('input', (e) => {
        const country = countries.find(c => c.code === currentCountry);
        const maxDigits = country ? country.digits : 9;
        
        // Check for letters in phone number
        const hasLetters = /[a-zA-Z]/.test(e.target.value);
        if (hasLetters) {
          // Show warning toast
          if (window.utils && window.utils.showToast) {
            window.utils.showToast(`Numerele de telefon pentru ${country.name} nu pot conține litere!`, 'warning');
          }
          // Remove letters
          e.target.value = e.target.value.replace(/[a-zA-Z]/g, '');
          return;
        }
        
        let value = e.target.value;
        
        // If number starts with country prefix, count only the digits after prefix
        if (value.startsWith(country.prefix)) {
          const digitsAfterPrefix = value.replace(country.prefix, '').replace(/\D/g, '');
          if (digitsAfterPrefix.length > maxDigits) {
            const truncatedDigits = digitsAfterPrefix.substring(0, maxDigits);
            value = `${country.prefix} ${truncatedDigits}`;
          }
        } else {
          // If number starts with 0, count all digits except the leading 0
          if (value.startsWith('0')) {
            const digitsWithoutZero = value.substring(1).replace(/\D/g, '');
            if (digitsWithoutZero.length > maxDigits) {
              value = '0' + digitsWithoutZero.substring(0, maxDigits);
            }
          } else {
            // For other cases, just limit digits
            const digits = value.replace(/\D/g, '');
            if (digits.length > maxDigits) {
              value = digits.substring(0, maxDigits);
            }
          }
        }
        
        e.target.value = value;
      });
    }

    // Auto-format on blur: folosește formatter.formatPhone și nu adaugă prefix dacă numărul e incomplet
    if (phoneInput) {
      phoneInput.addEventListener('blur', (e) => {
        const formatted = formatter.formatPhone(e.target.value || '');
        if (formatted && formatted !== e.target.value) {
          e.target.value = formatted;
        }
      });
    }

    // Initialize
    renderCountryList();
  }
});

// Funcții helper pentru utilizare externă
window.formatPhone = function(input) {
  return window.autoFormatter.formatPhone(input);
};

window.formatCarNumber = function(input) {
  return window.autoFormatter.formatCarNumber(input);
};

window.formatName = function(input) {
  return window.autoFormatter.formatName(input);
};
