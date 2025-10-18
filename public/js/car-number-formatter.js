// ===========================================
// CAR NUMBER FORMATTER
// ===========================================

class CarNumberFormatter {
  constructor() {
    this.patterns = {
      // România: AB-12-CDE, AB-123-CDE
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
    
    this.formats = {
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
   * Detectează țara bazată pe formatul numărului
   */
  detectCountry(input) {
    const cleanInput = input.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    
    // Verifică pentru România (cel mai comun)
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
   * Formatează numărul de mașină
   */
  format(input) {
    if (!input) return '';
    
    // Curăță input-ul și convertește la majuscule
    const cleanInput = input.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    
    if (cleanInput.length < 3) return cleanInput;
    
    // Detectează țara
    const country = this.detectCountry(cleanInput);
    
    // Aplică pattern-ul pentru țara detectată
    const pattern = this.patterns[country];
    const match = cleanInput.match(pattern);
    
    if (match) {
      return this.formats[country](match);
    }
    
    // Dacă nu se potrivește cu niciun pattern, aplică formatul românesc
    return this.formatRomanian(cleanInput);
  }

  /**
   * Formatează numărul românesc
   */
  formatRomanian(input) {
    // Pattern pentru România: AB-12-CDE sau AB-123-CDE
    const match = input.match(/^([A-Z]{1,2})(\d{2,3})([A-Z]{2,3})$/);
    
    if (match) {
      return `${match[1]}-${match[2]}-${match[3]}`;
    }
    
    // Dacă nu se potrivește, returnează input-ul curățat
    return input;
  }

  /**
   * Validează numărul de mașină
   */
  validate(input) {
    if (!input) return false;
    
    const cleanInput = input.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    const country = this.detectCountry(cleanInput);
    const pattern = this.patterns[country];
    
    return pattern.test(cleanInput);
  }
}

// Instanță globală
window.carNumberFormatter = new CarNumberFormatter();

// Funcție helper pentru input-uri
window.formatCarNumber = function(input) {
  return window.carNumberFormatter.format(input);
};

// Auto-formatare pentru input-uri cu clasa 'car-number-input'
// NOTA: Formatarea automată a fost mutată în auto-formatter.js
// Acest fișier păstrează doar funcționalitatea de formatare manuală
document.addEventListener('DOMContentLoaded', function() {
  const carNumberInputs = document.querySelectorAll('.car-number-input, input[name="carNumber"], #driver-car-number');
  
  carNumberInputs.forEach(input => {
    // Formatare doar la paste (nu în timpul scrierii)
    input.addEventListener('paste', function(e) {
      setTimeout(() => {
        const formatted = window.carNumberFormatter.format(e.target.value);
        e.target.value = formatted;
      }, 10);
    });
    
    // Formatare la blur (când iese din focus) - doar dacă nu există auto-formatter
    if (!window.autoFormatter) {
      input.addEventListener('blur', function(e) {
        const formatted = window.carNumberFormatter.format(e.target.value);
        e.target.value = formatted;
      });
    }
  });
});
