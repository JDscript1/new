// ===========================================
// CHARTS MANAGER
// Gestionează graficele pentru plecările șoferilor
// ===========================================

class ChartsManager {
  constructor() {
    this.charts = {
      week: null,
      month: null,
      year: null
    };
    this.currentChart = 'week';
    this.drivers = [];
    
    // Period selection state
    this.selectedWeek = 'current';
    this.selectedMonth = 'current';
    this.selectedYear = 'current';
    
    this.init();
  }

  init() {
    console.log('ChartsManager: Inițializare în curs...');
    this.bindEvents();
    // Wait for Chart.js to load and then load data
    this.waitForChartJS();
  }

  waitForChartJS() {
    console.log('ChartsManager: Verific dacă Chart.js este disponibil...');
    console.log('ChartsManager: typeof Chart:', typeof Chart);
    console.log('ChartsManager: window.Chart:', window.Chart);
    
    if (typeof Chart !== 'undefined' && window.Chart) {
      console.log('ChartsManager: Chart.js este încărcat, încep încărcarea datelor...');
      setTimeout(() => {
        this.loadChartData();
      }, 500);
    } else {
      console.log('ChartsManager: Aștept Chart.js să se încarce... (încercare', this.chartJSAttempts || 0, ')');
      this.chartJSAttempts = (this.chartJSAttempts || 0) + 1;
      
      if (this.chartJSAttempts > 50) { // 5 secunde max
        console.error('ChartsManager: Chart.js nu s-a încărcat după 5 secunde!');
        return;
      }
      
      setTimeout(() => {
        this.waitForChartJS();
      }, 100);
    }
  }

  bindEvents() {
    // Chart tab buttons
    document.querySelectorAll('.chart-tab-btn').forEach(btn => {
      btn.addEventListener('click', (e) => this.switchChartTab(e));
    });

    // Refresh charts button
    const refreshBtn = document.getElementById('refresh-charts-btn');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', () => this.refreshCharts());
    }

    // Period selector dropdowns
    const weekSelector = document.getElementById('week-selector');
    const monthSelector = document.getElementById('month-selector');
    const yearSelector = document.getElementById('year-selector');

    if (weekSelector) {
      weekSelector.addEventListener('change', (e) => {
        this.selectedWeek = e.target.value;
        this.updateWeekChart();
      });
    }

    if (monthSelector) {
      monthSelector.addEventListener('change', (e) => {
        this.selectedMonth = e.target.value;
        this.updateMonthChart();
      });
    }

    if (yearSelector) {
      yearSelector.addEventListener('change', (e) => {
        this.selectedYear = e.target.value;
        this.updateYearChart();
      });
    }
  }

  switchChartTab(e) {
    e.preventDefault();
    const chartType = e.currentTarget.dataset.chart;
    console.log(`ChartsManager: Schimb la tab-ul ${chartType}`);
    
    // Update active tab button
    document.querySelectorAll('.chart-tab-btn').forEach(btn => {
      btn.classList.remove('active');
    });
    e.currentTarget.classList.add('active');

    // Update active chart panel
    document.querySelectorAll('.chart-panel').forEach(panel => {
      panel.classList.remove('active');
    });
    document.getElementById(`${chartType}-chart`).classList.add('active');

    this.currentChart = chartType;
    
    // Wait a bit for the tab to become visible, then render the chart
    setTimeout(() => {
      console.log(`ChartsManager: Renderez graficul ${chartType} după schimbarea tab-ului`);
      this.updateChart(chartType);
    }, 200); // Increased delay to ensure tab is fully visible
  }

  async loadChartData() {
    try {
      console.log('ChartsManager: Încărcare date pentru grafice...');
      const response = await fetch('/api/drivers');
      if (response.ok) {
        const data = await response.json();
        this.drivers = data.drivers || [];
        console.log('ChartsManager: Șoferi încărcați:', this.drivers.length);
        console.log('ChartsManager: Primul șofer:', this.drivers[0]);
        
        // Update current period displays and populate dropdowns
        this.updateCurrentPeriods();
        this.populateDropdowns();
        
        this.updateAllCharts();
      } else {
        console.error('ChartsManager: Eroare la încărcarea datelor:', response.status);
      }
    } catch (error) {
      console.error('Eroare la încărcarea datelor pentru grafice:', error);
    }
  }

  updateAllCharts() {
    console.log('ChartsManager: Actualizez toate graficele...');
    // Only render the currently active chart to avoid issues with hidden canvases
    this.updateChart(this.currentChart);
  }

  updateChart(chartType) {
    console.log(`ChartsManager: Actualizare grafic ${chartType}...`);
    const data = this.getChartData(chartType);
    console.log(`ChartsManager: Date pentru ${chartType}:`, data);
    this.renderChart(chartType, data);
    this.updateChartStats(chartType, data);
  }

  getChartData(chartType) {
    const now = new Date();
    let startDate, endDate, labels, data;

    switch (chartType) {
      case 'week':
        // Săptămâna selectată din dropdown
        const weekPeriod = this.getSelectedWeekPeriod();
        startDate = weekPeriod.start;
        endDate = weekPeriod.end;

        labels = ['Luni', 'Marți', 'Miercuri', 'Joi', 'Vineri', 'Sâmbătă', 'Duminică'];
        data = this.getDeparturesByPeriod(startDate, endDate, 'day');
        break;

      case 'month':
        // Luna selectată din dropdown
        const monthPeriod = this.getSelectedMonthPeriod();
        startDate = monthPeriod.start;
        endDate = monthPeriod.end;

        labels = this.generateMonthLabels(startDate, endDate);
        data = this.getDeparturesByPeriod(startDate, endDate, 'day');
        break;

      case 'year':
        // Anul selectat din dropdown
        const yearPeriod = this.getSelectedYearPeriod();
        startDate = yearPeriod.start;
        endDate = yearPeriod.end;

        labels = ['Ian', 'Feb', 'Mar', 'Apr', 'Mai', 'Iun', 'Iul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        data = this.getDeparturesByPeriod(startDate, endDate, 'month');
        break;
    }

    return { labels, data };
  }

  getDeparturesByPeriod(startDate, endDate, period) {
    console.log(`ChartsManager: Filtrare plecări pentru perioada ${period}:`);
    console.log('Start date:', startDate.toISOString());
    console.log('End date:', endDate.toISOString());
    
    const departures = this.drivers.filter(driver => {
      const departureDate = new Date(driver.departureDate);
      const isInRange = departureDate >= startDate && departureDate <= endDate;
      console.log(`Șofer ${driver.firstName} ${driver.lastName}:`, {
        departureDate: departureDate.toISOString(),
        isInRange: isInRange
      });
      return isInRange;
    });

    console.log(`Plecări găsite pentru ${period}:`, departures.length);

    if (period === 'day') {
      return this.groupByDay(departures, startDate, endDate);
    } else if (period === 'month') {
      return this.groupByMonth(departures, startDate, endDate);
    }
  }

  groupByDay(departures, startDate, endDate) {
    const data = [];
    const current = new Date(startDate);
    
    while (current <= endDate) {
      const dayDepartures = departures.filter(driver => {
        const departureDate = new Date(driver.departureDate);
        return departureDate.toDateString() === current.toDateString();
      });
      data.push(dayDepartures.length);
      current.setDate(current.getDate() + 1);
    }
    
    return data;
  }

  groupByMonth(departures, startDate, endDate) {
    const data = [];
    const current = new Date(startDate);
    
    for (let month = 0; month < 12; month++) {
      const monthDepartures = departures.filter(driver => {
        const departureDate = new Date(driver.departureDate);
        return departureDate.getMonth() === month;
      });
      data.push(monthDepartures.length);
    }
    
    return data;
  }

  generateMonthLabels(startDate, endDate) {
    const labels = [];
    const current = new Date(startDate);
    
    while (current <= endDate) {
      labels.push(current.getDate().toString());
      current.setDate(current.getDate() + 1);
    }
    
    return labels;
  }

  renderChart(chartType, chartData) {
    console.log(`ChartsManager: Încerc să randez graficul ${chartType}...`);
    
    const canvas = document.getElementById(`${chartType}Chart`);
    console.log(`ChartsManager: Canvas găsit pentru ${chartType}:`, canvas);
    
    if (!canvas) {
      console.error(`ChartsManager: Canvas cu ID ${chartType}Chart nu a fost găsit!`);
      return;
    }

    // Check if the charts tab is active
    const chartsTab = document.getElementById('charts-tab');
    const chartPanel = document.getElementById(`${chartType}-chart`);
    
    if (!chartsTab || !chartsTab.classList.contains('active')) {
      console.log(`ChartsManager: Tab-ul Grafic nu este activ, nu pot randa graficul ${chartType}`);
      return;
    }
    
    if (!chartPanel || !chartPanel.classList.contains('active')) {
      console.log(`ChartsManager: Panel-ul ${chartType} nu este activ, nu pot randa graficul`);
      return;
    }

    // Check if canvas is visible and has proper dimensions
    const rect = canvas.getBoundingClientRect();
    console.log(`ChartsManager: Canvas dimensions for ${chartType}:`, {
      width: rect.width,
      height: rect.height,
      offsetWidth: canvas.offsetWidth,
      offsetHeight: canvas.offsetHeight
    });

    if (rect.width === 0 || rect.height === 0) {
      console.warn(`ChartsManager: Canvas ${chartType} has zero dimensions, retrying in 500ms...`);
      // Limit retries to prevent infinite loop
      if (!this.retryCount) this.retryCount = {};
      this.retryCount[chartType] = (this.retryCount[chartType] || 0) + 1;
      
      if (this.retryCount[chartType] > 10) {
        console.error(`ChartsManager: Prea multe încercări pentru ${chartType}, opresc retry-ul`);
        return;
      }
      
      setTimeout(() => {
        this.renderChart(chartType, chartData);
      }, 500);
      return;
    }
    
    // Reset retry count on successful render
    if (this.retryCount) {
      this.retryCount[chartType] = 0;
    }

    // Check if Chart.js is loaded
    if (typeof Chart === 'undefined') {
      console.error('ChartsManager: Chart.js nu este încărcat! Încerc să creez un grafic simplu...');
      this.renderSimpleChart(canvas, chartData, chartType);
      return;
    }

    console.log('ChartsManager: Chart.js este disponibil, încep randarea...');

    // Destroy existing chart
    if (this.charts[chartType]) {
      console.log(`ChartsManager: Distrug graficul existent pentru ${chartType}`);
      this.charts[chartType].destroy();
    }

    const ctx = canvas.getContext('2d');
    console.log(`ChartsManager: Context canvas obținut pentru ${chartType}:`, ctx);
    
    try {
      this.charts[chartType] = new Chart(ctx, {
      type: 'line',
      data: {
        labels: chartData.labels,
        datasets: [{
          label: 'Plecări',
          data: chartData.data,
          borderColor: '#64FFDA',
          backgroundColor: 'rgba(100, 255, 218, 0.1)',
          borderWidth: 3,
          fill: true,
          tension: 0.4,
          pointBackgroundColor: '#64FFDA',
          pointBorderColor: '#0A192F',
          pointBorderWidth: 2,
          pointRadius: 6,
          pointHoverRadius: 8,
          pointHoverBackgroundColor: '#64FFDA',
          pointHoverBorderColor: '#0A192F',
          pointHoverBorderWidth: 3
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            display: false
          },
          tooltip: {
            backgroundColor: '#112240',
            titleColor: '#E6F1FF',
            bodyColor: '#E6F1FF',
            borderColor: '#64FFDA',
            borderWidth: 1,
            cornerRadius: 8,
            displayColors: false,
            callbacks: {
              title: function(context) {
                return context[0].label;
              },
              label: function(context) {
                return `Plecări: ${context.parsed.y}`;
              }
            }
          }
        },
        scales: {
          x: {
            grid: {
              color: 'rgba(230, 241, 255, 0.1)',
              drawBorder: false
            },
            ticks: {
              color: '#E6F1FF',
              font: {
                size: 12
              }
            }
          },
          y: {
            beginAtZero: true,
            grid: {
              color: 'rgba(230, 241, 255, 0.1)',
              drawBorder: false
            },
            ticks: {
              color: '#E6F1FF',
              font: {
                size: 12
              },
              stepSize: 1
            }
          }
        },
        interaction: {
          intersect: false,
          mode: 'index'
        },
        animation: {
          duration: 1000,
          easing: 'easeInOutQuart'
        }
      }
    });
    
    console.log(`ChartsManager: Graficul ${chartType} a fost creat cu succes:`, this.charts[chartType]);
    } catch (error) {
      console.error(`ChartsManager: Eroare la crearea graficului ${chartType}:`, error);
    }
  }

  renderSimpleChart(canvas, chartData, chartType) {
    console.log(`ChartsManager: Renderez grafic simplu pentru ${chartType}...`);
    
    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;
    
    // Clear canvas
    ctx.clearRect(0, 0, width, height);
    
    // Set background
    ctx.fillStyle = '#112240';
    ctx.fillRect(0, 0, width, height);
    
    // Set text style
    ctx.fillStyle = '#E6F1FF';
    ctx.font = '14px Arial';
    ctx.textAlign = 'center';
    
    // Draw title
    ctx.fillText(`Grafic ${chartType === 'week' ? 'Săptămânal' : chartType === 'month' ? 'Lunar' : 'Anual'}`, width / 2, 30);
    
    // Draw data
    const data = chartData.data;
    const labels = chartData.labels;
    const maxValue = Math.max(...data, 1);
    
    // Draw bars
    const barWidth = width / (labels.length + 1);
    const barSpacing = barWidth * 0.1;
    const actualBarWidth = barWidth - barSpacing;
    
    data.forEach((value, index) => {
      const barHeight = (value / maxValue) * (height - 100);
      const x = (index + 0.5) * barWidth;
      const y = height - 50 - barHeight;
      
      // Draw bar
      ctx.fillStyle = '#64FFDA';
      ctx.fillRect(x - actualBarWidth / 2, y, actualBarWidth, barHeight);
      
      // Draw value
      ctx.fillStyle = '#E6F1FF';
      ctx.font = '12px Arial';
      ctx.fillText(value.toString(), x, y - 5);
      
      // Draw label
      ctx.fillText(labels[index], x, height - 30);
    });
    
    // Draw axes
    ctx.strokeStyle = '#64FFDA';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(50, height - 50);
    ctx.lineTo(width - 50, height - 50);
    ctx.moveTo(50, 60);
    ctx.lineTo(50, height - 50);
    ctx.stroke();
    
    console.log(`ChartsManager: Grafic simplu ${chartType} completat!`);
  }

  updateChartStats(chartType, chartData) {
    const total = chartData.data.reduce((sum, value) => sum + value, 0);
    const average = chartData.data.length > 0 ? (total / chartData.data.length).toFixed(1) : 0;

    // Update total
    const totalElement = document.getElementById(`${chartType}-total`);
    if (totalElement) {
      totalElement.textContent = total;
    }

    // Update average
    const averageElement = document.getElementById(`${chartType}-average`);
    if (averageElement) {
      averageElement.textContent = average;
    }
  }

  async refreshCharts() {
    await this.loadChartData();
    utils.showToast('Graficele au fost actualizate!', 'success');
  }

  // Public method to refresh charts when drivers data changes
  refreshOnDataChange() {
    this.loadChartData();
  }

  // Update current period displays
  updateCurrentPeriods() {
    this.updateWeekTitle();
    this.updateMonthTitle();
    this.updateYearTitle();
  }

  updateWeekTitle() {
    const weekPeriod = this.getSelectedWeekPeriod();
    const weekNumber = this.getWeekNumber(weekPeriod.start);
    const weekNumberElement = document.getElementById('current-week-number');
    if (weekNumberElement) {
      weekNumberElement.textContent = weekNumber;
    }
  }

  updateMonthTitle() {
    const monthPeriod = this.getSelectedMonthPeriod();
    const monthNames = [
      'Ianuarie', 'Februarie', 'Martie', 'Aprilie', 'Mai', 'Iunie',
      'Iulie', 'August', 'Septembrie', 'Octombrie', 'Noiembrie', 'Decembrie'
    ];
    
    const monthNameElement = document.getElementById('current-month-name');
    const monthYearElement = document.getElementById('current-month-year');
    
    if (monthNameElement) {
      monthNameElement.textContent = monthNames[monthPeriod.start.getMonth()];
    }
    if (monthYearElement) {
      monthYearElement.textContent = monthPeriod.start.getFullYear();
    }
  }

  updateYearTitle() {
    const yearPeriod = this.getSelectedYearPeriod();
    const yearElement = document.getElementById('current-year');
    
    if (yearElement) {
      yearElement.textContent = yearPeriod.start.getFullYear();
    }
  }

  // Get week number of the year
  getWeekNumber(date) {
    const firstDayOfYear = new Date(date.getFullYear(), 0, 1);
    const pastDaysOfYear = (date - firstDayOfYear) / 86400000;
    return Math.ceil((pastDaysOfYear + firstDayOfYear.getDay() + 1) / 7);
  }

  // Populate dropdown options
  populateDropdowns() {
    this.populateWeekDropdown();
    this.populateMonthDropdown();
    this.populateYearDropdown();
  }

  populateWeekDropdown() {
    const weekSelector = document.getElementById('week-selector');
    if (!weekSelector) return;

    const now = new Date();
    const currentWeek = this.getWeekNumber(now);
    
    // Clear existing options except the first one
    weekSelector.innerHTML = '<option value="current">Săptămâna curentă</option>';
    
    // Add previous weeks (up to 12 weeks back)
    for (let i = 1; i <= 12; i++) {
      const weekDate = new Date(now.getTime() - (i * 7 * 24 * 60 * 60 * 1000));
      const weekNum = this.getWeekNumber(weekDate);
      const option = document.createElement('option');
      option.value = `week-${i}`;
      option.textContent = `Săptămâna ${weekNum} (${weekDate.toLocaleDateString('ro-RO', { month: 'short', day: 'numeric' })})`;
      weekSelector.appendChild(option);
    }
  }

  populateMonthDropdown() {
    const monthSelector = document.getElementById('month-selector');
    if (!monthSelector) return;

    const now = new Date();
    const monthNames = [
      'Ianuarie', 'Februarie', 'Martie', 'Aprilie', 'Mai', 'Iunie',
      'Iulie', 'August', 'Septembrie', 'Octombrie', 'Noiembrie', 'Decembrie'
    ];
    
    // Clear existing options except the first one
    monthSelector.innerHTML = '<option value="current">Luna curentă</option>';
    
    // Add previous months (up to 12 months back)
    for (let i = 1; i <= 12; i++) {
      const monthDate = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const option = document.createElement('option');
      option.value = `month-${i}`;
      option.textContent = `${monthNames[monthDate.getMonth()]} ${monthDate.getFullYear()}`;
      monthSelector.appendChild(option);
    }
  }

  populateYearDropdown() {
    const yearSelector = document.getElementById('year-selector');
    if (!yearSelector) return;

    const now = new Date();
    const currentYear = now.getFullYear();
    
    // Clear existing options except the first one
    yearSelector.innerHTML = '<option value="current">Anul curent</option>';
    
    // Add previous years (up to 5 years back)
    for (let i = 1; i <= 5; i++) {
      const year = currentYear - i;
      const option = document.createElement('option');
      option.value = `year-${i}`;
      option.textContent = year.toString();
      yearSelector.appendChild(option);
    }
  }

  // Get selected period based on dropdown selection
  getSelectedWeekPeriod() {
    const now = new Date();
    
    if (this.selectedWeek === 'current') {
      // Săptămâna curentă (luni-duminică)
      const startOfWeek = new Date(now);
      startOfWeek.setDate(now.getDate() - now.getDay() + 1); // Luni
      startOfWeek.setHours(0, 0, 0, 0);
      
      const endOfWeek = new Date(startOfWeek);
      endOfWeek.setDate(startOfWeek.getDate() + 6); // Duminică
      endOfWeek.setHours(23, 59, 59, 999);
      
      return { start: startOfWeek, end: endOfWeek };
    } else {
      // Săptămâni anterioare
      const weekOffset = parseInt(this.selectedWeek.split('-')[1]);
      const startOfWeek = new Date(now);
      startOfWeek.setDate(now.getDate() - now.getDay() + 1 - (weekOffset * 7)); // Luni
      startOfWeek.setHours(0, 0, 0, 0);
      
      const endOfWeek = new Date(startOfWeek);
      endOfWeek.setDate(startOfWeek.getDate() + 6); // Duminică
      endOfWeek.setHours(23, 59, 59, 999);
      
      return { start: startOfWeek, end: endOfWeek };
    }
  }

  getSelectedMonthPeriod() {
    const now = new Date();
    
    if (this.selectedMonth === 'current') {
      // Luna curentă
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      endOfMonth.setHours(23, 59, 59, 999);
      
      return { start: startOfMonth, end: endOfMonth };
    } else {
      // Luni anterioare
      const monthOffset = parseInt(this.selectedMonth.split('-')[1]);
      const targetDate = new Date(now.getFullYear(), now.getMonth() - monthOffset, 1);
      const startOfMonth = new Date(targetDate.getFullYear(), targetDate.getMonth(), 1);
      const endOfMonth = new Date(targetDate.getFullYear(), targetDate.getMonth() + 1, 0);
      endOfMonth.setHours(23, 59, 59, 999);
      
      return { start: startOfMonth, end: endOfMonth };
    }
  }

  getSelectedYearPeriod() {
    const now = new Date();
    
    if (this.selectedYear === 'current') {
      // Anul curent
      const startOfYear = new Date(now.getFullYear(), 0, 1);
      const endOfYear = new Date(now.getFullYear(), 11, 31);
      endOfYear.setHours(23, 59, 59, 999);
      
      return { start: startOfYear, end: endOfYear };
    } else {
      // Ani anteriori
      const yearOffset = parseInt(this.selectedYear.split('-')[1]);
      const targetYear = now.getFullYear() - yearOffset;
      const startOfYear = new Date(targetYear, 0, 1);
      const endOfYear = new Date(targetYear, 11, 31);
      endOfYear.setHours(23, 59, 59, 999);
      
      return { start: startOfYear, end: endOfYear };
    }
  }

  // Update individual charts based on selection
  updateWeekChart() {
    this.updateWeekTitle();
    if (this.charts.week) {
      this.updateChart('week');
    }
  }

  updateMonthChart() {
    this.updateMonthTitle();
    if (this.charts.month) {
      this.updateChart('month');
    }
  }

  updateYearChart() {
    this.updateYearTitle();
    if (this.charts.year) {
      this.updateChart('year');
    }
  }
}

// Initialize charts manager when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  console.log('ChartsManager: DOM încărcat, încep inițializarea...');
  // Wait a bit more to ensure all scripts are loaded
  setTimeout(() => {
    window.chartsManager = new ChartsManager();
    console.log('ChartsManager: Inițializat cu succes!');
    try {
      const es = new EventSource('/api/whatsapp/events');
      es.addEventListener('ready', () => window.chartsManager.refreshOnDataChange());
      es.addEventListener('disconnected', () => window.chartsManager.refreshOnDataChange());
      es.addEventListener('accountsChanged', () => window.chartsManager.refreshOnDataChange());
      es.addEventListener('activeChanged', () => window.chartsManager.refreshOnDataChange());
      // optional: keep reference
      window.chartsSSE = es;
    } catch (e) {
      console.warn('Charts SSE init failed, falling back to periodic refresh');
      setInterval(() => window.chartsManager.refreshOnDataChange(), 15000);
    }
  }, 1000); // Increased delay to ensure all resources are loaded
});

// Export for use in other modules
window.ChartsManager = ChartsManager;
