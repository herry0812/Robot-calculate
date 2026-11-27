/* ==========================================================================
   Reliability Workbench — UI orchestration
   ========================================================================== */
(function () {
  'use strict';

  var RC = window.ReliabilityCalc;
  var STORAGE_KEY = 'relia-workbench-state-v1';
  var THEME_KEY = 'relia-workbench-theme';
  var SCHEMA = 'reliability-workbench';
  var VERSION = 1;

  var charts = { rbd: null, dist: null, alloc: null };
  var timers = {};
  var saveTimer = null;
  var saveStatusTimer = null;
  var toastTimer = null;
  var lastSaveText = '';

  function $(id) {
    return document.getElementById(id);
  }

  function $$(selector, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(selector));
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function parseNumberInput(input) {
    if (!input) return null;
    var raw = String(input.value).trim().replace(/,/g, '');
    if (raw === '') return null;
    var value = Number(raw);
    return Number.isFinite(value) ? value : null;
  }

  function isReliability(value) {
    return typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= 1;
  }

  function isPositive(value) {
    return typeof value === 'number' && Number.isFinite(value) && value > 0;
  }

  function isNonNegative(value) {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0;
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function formatR(value, digits) {
    if (!Number.isFinite(value)) return '—';
    return value.toFixed(digits == null ? 4 : digits);
  }

  function formatPct(value) {
    if (!Number.isFinite(value)) return '—';
    return (value * 100).toFixed(Math.abs(value) < 0.01 ? 4 : 2) + '%';
  }

  function formatHour(value) {
    if (!Number.isFinite(value)) return '∞ h';
    if (Math.abs(value) >= 1e9) return formatSci(value, 3) + ' h';
    var digits = Math.abs(value) >= 100 ? 0 : Math.abs(value) >= 10 ? 1 : 2;
    return value.toLocaleString('en-US', {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits
    }) + ' h';
  }

  function formatHourNumber(value) {
    if (!Number.isFinite(value)) return '∞';
    if (Math.abs(value) >= 1e9) return formatSci(value, 3);
    var digits = Math.abs(value) >= 100 ? 0 : Math.abs(value) >= 10 ? 1 : 2;
    return value.toLocaleString('en-US', {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits
    });
  }

  function formatSci(value, digits) {
    if (!Number.isFinite(value)) return '∞';
    if (value === 0) return '0';
    var text = value.toExponential(digits == null ? 3 : digits);
    return text.replace('e-', 'e−').replace('e+', 'e');
  }

  function formatCompact(value) {
    if (!Number.isFinite(value)) return '∞';
    if (Math.abs(value) >= 1e6) return formatSci(value, 2);
    if (Math.abs(value) >= 1000) {
      return (value / 1000).toFixed(value % 1000 === 0 ? 0 : 1) + 'k';
    }
    return String(Math.round(value * 10) / 10);
  }

  function formatInputNumber(value, significant) {
    if (!Number.isFinite(value)) return '';
    var text = value.toPrecision(significant || 8);
    if (text.indexOf('e') !== -1) return text;
    return String(parseFloat(text));
  }

  function formatNines(nines) {
    if (!Number.isFinite(nines)) return '∞ 个 9';
    if (nines >= 10) return '> 10 个 9';
    var rounded = Math.round(nines * 10) / 10;
    var text = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
    return text + ' 个 9';
  }

  function formatDateTime(date) {
    return new Intl.DateTimeFormat('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    }).format(date);
  }

  function fileStamp() {
    var d = new Date();
    function pad(n) { return String(n).padStart(2, '0'); }
    return d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '-' +
      pad(d.getHours()) + pad(d.getMinutes());
  }

  function uid(prefix) {
    return prefix + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
  }

  function cssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  function hexToRgba(hex, alpha) {
    var clean = hex.replace('#', '');
    if (clean.length === 3) {
      clean = clean.split('').map(function (c) { return c + c; }).join('');
    }
    var num = parseInt(clean, 16);
    if (!Number.isFinite(num)) return 'rgba(77,107,254,' + alpha + ')';
    return 'rgba(' + ((num >> 16) & 255) + ',' + ((num >> 8) & 255) + ',' + (num & 255) + ',' + alpha + ')';
  }

  function setText(id, text) {
    var el = $(id);
    if (el) el.textContent = text;
  }

  function setHtml(id, html) {
    var el = $(id);
    if (el) el.innerHTML = html;
  }

  function flashValue(id) {
    var el = $(id);
    if (!el) return;
    el.classList.remove('flash');
    void el.offsetWidth;
    el.classList.add('flash');
  }

  function schedule(key, fn, delay) {
    if (timers[key]) clearTimeout(timers[key]);
    timers[key] = setTimeout(function () {
      timers[key] = null;
      fn();
    }, delay == null ? 300 : delay);
  }

  /* -------------------------------------------------------------------------
     Default configuration (editable in the UI)
     ------------------------------------------------------------------------- */

  var DEFAULT_CATEGORIES = [
    { id: 'resistor', name: '电阻器', base: 0.0100 },
    { id: 'capacitor', name: '电容器', base: 0.0200 },
    { id: 'ic', name: '集成电路', base: 0.0800 },
    { id: 'diode', name: '二极管', base: 0.0200 },
    { id: 'transistor', name: '晶体管', base: 0.0300 },
    { id: 'connector', name: '连接器', base: 0.2000 },
    { id: 'relay', name: '继电器', base: 0.5000 },
    { id: 'pcb', name: '印制板', base: 0.1000 },
    { id: 'crystal', name: '晶振', base: 0.1000 },
    { id: 'transformer', name: '变压器', base: 0.0500 },
    { id: 'fan', name: '风扇', base: 2.0000 },
    { id: 'other', name: '其他', base: 0.0500 }
  ];

  var DEFAULT_QUALITY = [
    { id: 'A', name: '优选 A', factor: 0.5 },
    { id: 'B', name: '合格 B', factor: 1.0 },
    { id: 'C', name: '商用 C', factor: 2.0 },
    { id: 'D', name: '待验证 D', factor: 4.0 }
  ];

  var DEFAULT_ENVIRONMENT = [
    { id: 'GB', name: '地面良好 GB', factor: 1.0 },
    { id: 'GF', name: '地面固定 GF', factor: 2.5 },
    { id: 'GM', name: '地面移动 GM', factor: 5.0 },
    { id: 'GMS', name: '严酷 / 弹载 GMS', factor: 10.0 }
  ];

  function makeUnit(name, r) {
    return { id: uid('u'), name: name, r: r };
  }

  function makeAllocationUnit(index) {
    return {
      name: '单元 ' + (index + 1),
      complexity: 5,
      technology: 5,
      environment: 5,
      importance: 0.9,
      modules: 3
    };
  }

  function createDefaultState() {
    return {
      version: VERSION,
      updatedAt: new Date().toISOString(),
      rbd: {
        structure: 'series',
        t0: 1000,
        series: [makeUnit('单元 1', 0.9), makeUnit('单元 2', 0.9), makeUnit('单元 3', 0.9)],
        parallel: [makeUnit('单元 1', 0.9), makeUnit('单元 2', 0.9)],
        kn: { n: 3, k: 2, r: 0.9 },
        bridge: {
          mode: 'classic',
          rs: [0.9, 0.9, 0.9, 0.9, 0.9],
          mixed: {
            expr: '(A+B)|(C+D)',
            values: { A: 0.9, B: 0.9, C: 0.9, D: 0.9 }
          }
        }
      },
      conversion: {
        distribution: 'exp',
        exp: { mtbf: 1000, lambda: 0.001, t: 1000, r: Math.exp(-1) },
        weibull: { beta: 2, eta: 1200, t: 1000 }
      },
      prediction: {
        method: 'parts',
        categories: DEFAULT_CATEGORIES.map(function (item) { return Object.assign({}, item); }),
        quality: DEFAULT_QUALITY.map(function (item) { return Object.assign({}, item); }),
        environment: DEFAULT_ENVIRONMENT.map(function (item) { return Object.assign({}, item); }),
        parts: [
          { id: uid('p'), type: 'ic', qty: 2, quality: 'B', environment: 'GF' },
          { id: uid('p'), type: 'resistor', qty: 12, quality: 'B', environment: 'GF' },
          { id: uid('p'), type: 'capacitor', qty: 8, quality: 'B', environment: 'GF' },
          { id: uid('p'), type: 'connector', qty: 2, quality: 'B', environment: 'GF' }
        ],
        similar: { mtbf: 5000, complexity: 1.2, environment: 2.0 }
      },
      allocation: {
        targetMode: 'r',
        targetR: 0.9,
        targetMtbf: 5000,
        missionTime: 1000,
        n: 3,
        method: 'equal',
        units: [makeAllocationUnit(0), makeAllocationUnit(1), makeAllocationUnit(2)]
      }
    };
  }

  function deepMerge(base, extra) {
    if (Array.isArray(base)) return Array.isArray(extra) ? extra : base;
    if (base && typeof base === 'object') {
      var result = {};
      Object.keys(base).forEach(function (key) {
        result[key] = base[key];
      });
      if (extra && typeof extra === 'object' && !Array.isArray(extra)) {
        Object.keys(extra).forEach(function (key) {
          if (key === '__proto__' || key === 'constructor' || key === 'prototype') return;
          result[key] = key in base ? deepMerge(base[key], extra[key]) : extra[key];
        });
      }
      return result;
    }
    return extra == null ? base : extra;
  }

  function normalizeState(raw) {
    var defaults = createDefaultState();
    var merged = deepMerge(defaults, raw || {});

    merged.version = VERSION;
    if (!['series', 'parallel', 'kn', 'bridge'].includes(merged.rbd.structure)) {
      merged.rbd.structure = 'series';
    }
    if (!Array.isArray(merged.rbd.series) || !merged.rbd.series.length) {
      merged.rbd.series = defaults.rbd.series;
    }
    if (!Array.isArray(merged.rbd.parallel) || !merged.rbd.parallel.length) {
      merged.rbd.parallel = defaults.rbd.parallel;
    }
    merged.rbd.series = merged.rbd.series.slice(0, RC.MAX_UNITS);
    merged.rbd.parallel = merged.rbd.parallel.slice(0, RC.MAX_UNITS);
    if (merged.rbd.series.length > 1 && merged.rbd.series.length > 1) {
      /* keep IDs stable for rendering */
      merged.rbd.series.forEach(function (unit, index) {
        unit.id = unit.id || uid('u');
        unit.name = unit.name || '单元 ' + (index + 1);
      });
    }
    merged.rbd.parallel.forEach(function (unit, index) {
      unit.id = unit.id || uid('u');
      unit.name = unit.name || '单元 ' + (index + 1);
    });
    if (!merged.rbd.bridge || typeof merged.rbd.bridge !== 'object') {
      merged.rbd.bridge = defaults.rbd.bridge;
    }
    if (!Array.isArray(merged.rbd.bridge.rs) || merged.rbd.bridge.rs.length !== 5) {
      merged.rbd.bridge.rs = defaults.rbd.bridge.rs;
    }
    if (!merged.rbd.bridge.mixed || typeof merged.rbd.bridge.mixed.expr !== 'string') {
      merged.rbd.bridge.mixed = defaults.rbd.bridge.mixed;
    }
    if (!merged.rbd.bridge.mixed.values || typeof merged.rbd.bridge.mixed.values !== 'object') {
      merged.rbd.bridge.mixed.values = defaults.rbd.bridge.mixed.values;
    }
    if (!['classic', 'mixed'].includes(merged.rbd.bridge.mode)) {
      merged.rbd.bridge.mode = 'classic';
    }

    if (!['exp', 'weibull'].includes(merged.conversion.distribution)) {
      merged.conversion.distribution = 'exp';
    }

    if (!['parts', 'similar'].includes(merged.prediction.method)) {
      merged.prediction.method = 'parts';
    }
    if (!Array.isArray(merged.prediction.parts)) merged.prediction.parts = defaults.prediction.parts;
    merged.prediction.parts = merged.prediction.parts.slice(0, 50);
    if (!Array.isArray(merged.prediction.categories) || !merged.prediction.categories.length) {
      merged.prediction.categories = defaults.prediction.categories;
    }
    if (!Array.isArray(merged.prediction.quality) || !merged.prediction.quality.length) {
      merged.prediction.quality = defaults.prediction.quality;
    }
    if (!Array.isArray(merged.prediction.environment) || !merged.prediction.environment.length) {
      merged.prediction.environment = defaults.prediction.environment;
    }

    if (!['r', 'mtbf'].includes(merged.allocation.targetMode)) {
      merged.allocation.targetMode = 'r';
    }
    if (!['equal', 'scoring', 'agree'].includes(merged.allocation.method)) {
      merged.allocation.method = 'equal';
    }
    merged.allocation.n = clamp(Math.round(Number(merged.allocation.n) || 3), 1, 20);
    if (!Array.isArray(merged.allocation.units)) merged.allocation.units = [];
    syncAllocationUnits(merged.allocation);
    return merged;
  }

  function syncAllocationUnits(allocation) {
    var target = clamp(Math.round(Number(allocation.n) || 1), 1, 20);
    allocation.n = target;
    while (allocation.units.length < target) {
      allocation.units.push(makeAllocationUnit(allocation.units.length));
    }
    if (allocation.units.length > target) allocation.units = allocation.units.slice(0, target);
    allocation.units.forEach(function (unit, index) {
      unit.name = unit.name || '单元 ' + (index + 1);
      if (!Number.isFinite(Number(unit.complexity))) unit.complexity = 5;
      if (!Number.isFinite(Number(unit.technology))) unit.technology = 5;
      if (!Number.isFinite(Number(unit.environment))) unit.environment = 5;
      if (!Number.isFinite(Number(unit.importance))) unit.importance = 0.9;
      if (!Number.isFinite(Number(unit.modules))) unit.modules = 3;
    });
  }

  function loadState() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return createDefaultState();
      var parsed = JSON.parse(raw);
      return normalizeState(parsed);
    } catch (error) {
      return createDefaultState();
    }
  }

  var state = loadState();

  function persistState() {
    state.updatedAt = new Date().toISOString();
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      var time = new Date().toLocaleTimeString('zh-CN', { hour12: false });
      lastSaveText = '已自动保存 · ' + time;
      setText('saveStatusText', lastSaveText);
    } catch (error) {
      setText('saveStatusText', '本地存储不可用');
    }
  }

  function scheduleSave() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(persistState, 260);
  }

  /* -------------------------------------------------------------------------
     Toast
     ------------------------------------------------------------------------- */

  function showToast(message, isError) {
    var toast = $('toast');
    if (!toast) return;
    setText('toastText', message);
    toast.classList.toggle('error', !!isError);
    toast.classList.add('show');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      toast.classList.remove('show');
    }, 2800);
  }

  /* -------------------------------------------------------------------------
     Chart helpers
     ------------------------------------------------------------------------- */

  function hasChartLibrary() {
    return typeof window.Chart !== 'undefined';
  }

  function chartPalette() {
    var dark = document.documentElement.getAttribute('data-theme') === 'dark';
    return {
      brand: cssVar('--brand') || '#4d6bfe',
      text: cssVar('--text-3') || '#8d96a8',
      grid: dark ? 'rgba(255,255,255,0.065)' : 'rgba(95,112,145,0.10)',
      tooltipBg: dark ? 'rgba(10,15,25,0.94)' : 'rgba(20,27,43,0.92)',
      tooltipText: '#ffffff',
      surface: cssVar('--surface') || '#ffffff'
    };
  }

  function showChartFallback(canvasId, fallbackId) {
    var canvas = $(canvasId);
    var fallback = $(fallbackId);
    if (canvas) canvas.style.display = 'none';
    if (fallback) fallback.classList.add('show');
  }

  function hideChartFallback(canvasId, fallbackId) {
    var canvas = $(canvasId);
    var fallback = $(fallbackId);
    if (canvas) canvas.style.display = '';
    if (fallback) fallback.classList.remove('show');
  }

  function lineChartOptions(xMax, yMax) {
    var p = chartPalette();
    return {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 180, easing: 'easeOutQuart' },
      interaction: { intersect: false, mode: 'nearest' },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: p.tooltipBg,
          titleColor: p.tooltipText,
          bodyColor: p.tooltipText,
          padding: 10,
          cornerRadius: 9,
          displayColors: false,
          titleFont: { family: cssVar('--sans'), size: 10, weight: '600' },
          bodyFont: { family: cssVar('--mono'), size: 10 },
          callbacks: {
            title: function (items) {
              return items.length ? 't = ' + formatHourNumber(items[0].parsed.x) + ' h' : '';
            },
            label: function (context) {
              return 'R = ' + Number(context.parsed.y).toFixed(4);
            }
          }
        }
      },
      scales: {
        x: {
          type: 'linear',
          min: 0,
          max: xMax,
          grid: { color: p.grid, drawTicks: false },
          border: { display: false },
          ticks: {
            color: p.text,
            font: { family: cssVar('--mono'), size: 9 },
            maxTicksLimit: 5,
            padding: 7,
            callback: function (value) {
              return formatCompact(value) + 'h';
            }
          }
        },
        y: {
          min: 0,
          max: yMax == null ? 1 : yMax,
          grid: { color: p.grid, drawTicks: false },
          border: { display: false },
          ticks: {
            color: p.text,
            font: { family: cssVar('--mono'), size: 9 },
            maxTicksLimit: 5,
            padding: 7,
            callback: function (value) { return Number(value).toFixed(1); }
          }
        }
      }
    };
  }

  function renderLineChart(key, canvasId, fallbackId, curve, markers, xMax) {
    if (!hasChartLibrary()) {
      showChartFallback(canvasId, fallbackId);
      return;
    }
    hideChartFallback(canvasId, fallbackId);
    var canvas = $(canvasId);
    if (!canvas) return;
    var p = chartPalette();
    var gradientFill = function (context) {
      var chart = context.chart;
      var area = chart.chartArea;
      if (!area) return hexToRgba(p.brand, 0.10);
      var gradient = chart.ctx.createLinearGradient(0, area.top, 0, area.bottom);
      gradient.addColorStop(0, hexToRgba(p.brand, 0.20));
      gradient.addColorStop(1, hexToRgba(p.brand, 0.015));
      return gradient;
    };

    var data = {
      datasets: [
        {
          label: '系统可靠度',
          data: curve,
          parsing: false,
          borderColor: p.brand,
          backgroundColor: gradientFill,
          borderWidth: 2.2,
          fill: true,
          tension: 0.28,
          pointRadius: 0,
          pointHitRadius: 12
        },
        {
          label: '关键时点',
          data: markers,
          parsing: false,
          showLine: false,
          borderColor: p.brand,
          backgroundColor: p.surface,
          borderWidth: 2,
          pointRadius: 4,
          pointHoverRadius: 5,
          pointBackgroundColor: p.surface,
          pointBorderColor: p.brand,
          pointBorderWidth: 2
        }
      ]
    };

    var config = { type: 'line', data: data, options: lineChartOptions(xMax, 1) };

    if (charts[key]) {
      charts[key].data = config.data;
      charts[key].options = config.options;
      charts[key].update('none');
    } else {
      charts[key] = new window.Chart(canvas.getContext('2d'), config);
    }
  }

  function clearLineChart(key, canvasId, fallbackId) {
    if (!hasChartLibrary()) {
      showChartFallback(canvasId, fallbackId);
      return;
    }
    hideChartFallback(canvasId, fallbackId);
    if (charts[key]) {
      charts[key].data.datasets[0].data = [];
      charts[key].data.datasets[1].data = [];
      charts[key].update('none');
    }
  }

  function renderAllocationChart(items) {
    if (!hasChartLibrary()) {
      showChartFallback('allocChart', 'allocChartFallback');
      return;
    }
    hideChartFallback('allocChart', 'allocChartFallback');
    var canvas = $('allocChart');
    if (!canvas) return;
    var p = chartPalette();
    var labels = items.map(function (item) { return item.name; });
    var values = items.map(function (item) { return item.lambda * 1e6; });
    var colors = items.map(function (item) {
      return item.over ? hexToRgba('#d79233', 0.82) : hexToRgba(p.brand, 0.78);
    });
    var data = {
      labels: labels,
      datasets: [{
        data: values,
        backgroundColor: colors,
        borderRadius: 8,
        borderSkipped: false,
        barThickness: 16
      }]
    };
    var options = {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 200, easing: 'easeOutQuart' },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: p.tooltipBg,
          titleColor: p.tooltipText,
          bodyColor: p.tooltipText,
          padding: 10,
          cornerRadius: 9,
          displayColors: false,
          titleFont: { family: cssVar('--sans'), size: 10, weight: '600' },
          bodyFont: { family: cssVar('--mono'), size: 9.5 },
          callbacks: {
            label: function (context) {
              var item = items[context.dataIndex];
              return [
                'λ = ' + formatSci(item.lambda, 3) + ' /h',
                'MTBF = ' + formatHour(item.mtbf),
                'R = ' + formatR(item.reliability, 4)
              ];
            }
          }
        }
      },
      scales: {
        x: {
          beginAtZero: true,
          grid: { color: p.grid, drawTicks: false },
          border: { display: false },
          ticks: {
            color: p.text,
            font: { family: cssVar('--mono'), size: 8.5 },
            maxTicksLimit: 5,
            callback: function (value) { return formatCompact(value); }
          }
        },
        y: {
          grid: { display: false },
          border: { display: false },
          ticks: {
            color: p.text,
            font: { family: cssVar('--sans'), size: 9.5 },
            padding: 6
          }
        }
      }
    };
    var config = { type: 'bar', data: data, options: options };
    if (charts.alloc) {
      charts.alloc.data = data;
      charts.alloc.options = options;
      charts.alloc.update('none');
    } else {
      charts.alloc = new window.Chart(canvas.getContext('2d'), config);
    }
  }

  /* =========================================================================
     Module 01 — RBD
     ========================================================================= */

  var STRUCTURE_META = {
    series: { name: '串联', badge: '串联' },
    parallel: { name: '并联', badge: '并联' },
    kn: { name: 'k/n 表决', badge: '表决' },
    bridge: { name: '桥接 / 混联', badge: '桥接' }
  };

  function bridgeDiagramHtml() {
    return '' +
      '<div class="bridge-diagram" aria-hidden="true">' +
      '<svg viewBox="0 0 240 118">' +
      '<line class="wire" x1="20" y1="59" x2="82" y2="22"></line>' +
      '<line class="wire" x1="82" y1="22" x2="218" y2="59"></line>' +
      '<line class="wire" x1="20" y1="59" x2="82" y2="96"></line>' +
      '<line class="wire" x1="82" y1="96" x2="218" y2="59"></line>' +
      '<line class="wire" x1="82" y1="22" x2="82" y2="96"></line>' +
      '<circle class="component" cx="51" cy="40.5" r="3.4"></circle>' +
      '<circle class="component" cx="150" cy="40.5" r="3.4"></circle>' +
      '<circle class="component" cx="51" cy="77.5" r="3.4"></circle>' +
      '<circle class="component" cx="150" cy="77.5" r="3.4"></circle>' +
      '<circle class="component" cx="82" cy="59" r="3.4"></circle>' +
      '<text x="39" y="32">R1</text><text x="137" y="32">R2</text>' +
      '<text x="39" y="94">R3</text><text x="137" y="94">R4</text>' +
      '<text x="88" y="59">R5</text>' +
      '<text x="8" y="62">S</text><text x="222" y="62">T</text>' +
      '</svg></div>';
  }

  function reliabilityInputHtml(attributes, value, label, hint, extraClass) {
    return '' +
      '<div class="field ' + (extraClass || '') + '">' +
      '<label class="field-label">' + label + ' <span class="hint">0 &lt; R ≤ 1</span></label>' +
      '<div class="input-shell">' +
      '<input type="number" min="0.000000000001" max="1" step="0.001" inputmode="decimal" ' +
      attributes + ' value="' + escapeHtml(value == null ? '' : formatInputNumber(value, 8)) + '">' +
      '</div>' +
      '<div class="field-hint">' + hint + '</div>' +
      '<div class="field-error"></div>' +
      '</div>';
  }

  function unitRowsHtml(units, kind) {
    return units.map(function (unit, index) {
      return '' +
        '<div class="unit-row">' +
        '<span class="unit-badge">' + String(index + 1).padStart(2, '0') + '</span>' +
        '<div class="field">' +
        '<div class="input-shell">' +
        '<input type="number" min="0.000000000001" max="1" step="0.001" inputmode="decimal" ' +
        'data-rbd-unit="' + index + '" data-rbd-kind="' + kind + '" aria-label="单元 ' + (index + 1) + ' 可靠度" ' +
        'value="' + escapeHtml(unit.r == null ? '' : formatInputNumber(unit.r, 8)) + '">' +
        '</div>' +
        '<div class="field-error"></div>' +
        '</div>' +
        '<button class="icon-btn" type="button" data-remove-unit="' + index + '" data-rbd-kind="' + kind + '" ' +
        'title="删除单元" aria-label="删除单元 ' + (index + 1) + '"' + (units.length <= 1 ? ' disabled' : '') + '>' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v5M14 11v5"></path></svg>' +
        '</button>' +
        '</div>';
    }).join('');
  }

  function renderRBDStructure() {
    var rbd = state.rbd;
    var panel = $('rbdStructurePanel');
    if (!panel) return;
    var html = '';

    if (rbd.structure === 'series' || rbd.structure === 'parallel') {
      var units = rbd.structure === 'series' ? rbd.series : rbd.parallel;
      html += '<div class="section-label" style="margin-top: 0;">' +
        (rbd.structure === 'series' ? '串联单元' : '并联单元') +
        '<span class="pill" style="text-transform: none; letter-spacing: 0;">' + units.length + ' / 20</span></div>';
      html += '<div class="unit-list">' + unitRowsHtml(units, rbd.structure) + '</div>';
      html += '<div class="inline-actions">' +
        '<button class="btn btn-quiet btn-small" id="rbdAddUnit" type="button">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14M5 12h14"></path></svg>' +
        '添加单元</button>' +
        '<span class="pill">最多 20 个</span></div>';
      html += '<div class="formula-note">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"></circle><path d="M12 11v5M12 8h.01"></path></svg>' +
        '<span>' + (rbd.structure === 'series'
          ? '串联：<code>R_sys = ∏ Rᵢ</code>，任一单元失效即系统失效。'
          : '并联：<code>R_sys = 1 − ∏(1 − Rᵢ)</code>，至少一个单元工作即系统成功。') +
        '</span></div>';
    } else if (rbd.structure === 'kn') {
      html += '<div class="section-label" style="margin-top: 0;">表决参数</div>';
      html += '<div class="field-grid">' +
        '<div class="field">' +
        '<label class="field-label" for="knN">单元总数 n <span class="hint">1–20</span></label>' +
        '<div class="input-shell"><input id="knN" data-kn="n" type="number" min="1" max="20" step="1" inputmode="numeric" value="' + escapeHtml(rbd.kn.n) + '"></div>' +
        '<div class="field-hint">参与表决的单元总数</div><div class="field-error"></div></div>' +
        '<div class="field">' +
        '<label class="field-label" for="knK">成功门槛 k <span class="hint">1 ≤ k ≤ n</span></label>' +
        '<div class="input-shell"><input id="knK" data-kn="k" type="number" min="1" max="20" step="1" inputmode="numeric" value="' + escapeHtml(rbd.kn.k) + '"></div>' +
        '<div class="field-hint">至少 k 个单元正常即成功</div><div class="field-error"></div></div>' +
        '</div>';
      html += reliabilityInputHtml('data-kn="r" id="knR"', rbd.kn.r, '单元可靠度 R', '所有单元假设同分布');
      html += '<div class="formula-note">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"></circle><path d="M12 11v5M12 8h.01"></path></svg>' +
        '<span><code>R_sys = Σ(i=k..n) C(n,i) Rⁱ(1−R)ⁿ⁻ⁱ</code>，按二项分布精确计算。</span></div>';
    } else {
      html += '<div class="segmented" id="bridgeModeTabs" role="tablist" aria-label="桥接模式" style="margin-bottom: 12px;">' +
        '<button type="button" data-bridge-mode="classic" class="' + (rbd.bridge.mode === 'classic' ? 'active' : '') + '">经典桥式 5 单元</button>' +
        '<button type="button" data-bridge-mode="mixed" class="' + (rbd.bridge.mode === 'mixed' ? 'active' : '') + '">混联表达式</button>' +
        '</div>';

      if (rbd.bridge.mode === 'classic') {
        html += bridgeDiagramHtml();
        html += '<div class="bridge-input-grid">';
        rbd.bridge.rs.forEach(function (value, index) {
          html += reliabilityInputHtml('data-bridge-unit="' + index + '"', value, 'R' + (index + 1), '桥臂 ' + (index + 1));
        });
        html += '</div>';
        html += '<div class="formula-note">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"></circle><path d="M12 11v5M12 8h.01"></path></svg>' +
          '<span>桥式网络按 32 种成功/失效状态精确枚举，自动分解串并联路径。</span></div>';
      } else {
        html += '<div class="field" id="mixedExprField">' +
          '<label class="field-label" for="mixedExpr">结构表达式 <span class="hint">+ 串联 · | 并联</span></label>' +
          '<div class="input-shell mixed-expr-input"><input id="mixedExpr" type="text" spellcheck="false" value="' + escapeHtml(rbd.bridge.mixed.expr) + '"></div>' +
          '<div class="field-hint">用 A、B、C… 表示单元，括号分组。例：(A+B)|(C+D) 表示两个串联支路再并联。</div>' +
          '<div class="field-error" id="mixedExprError"></div>' +
          '</div>';
        html += '<div class="expression-help">' +
          '<button class="help-chip" type="button" data-expr="(A+B)|(C+D)">(A+B)|(C+D)</button>' +
          '<button class="help-chip" type="button" data-expr="A|B|C">A|B|C</button>' +
          '<button class="help-chip" type="button" data-expr="(A+B+C)|D">(A+B+C)|D</button>' +
          '</div>';
        html += '<div class="mixed-values" id="mixedValueList"></div>';
        html += '<div class="formula-note">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"></circle><path d="M12 11v5M12 8h.01"></path></svg>' +
          '<span>按运算符优先级与括号逐层分解，适合桥式之外的串并联混合结构。</span></div>';
      }
    }

    panel.innerHTML = html;
    if (rbd.structure === 'bridge' && rbd.bridge.mode === 'mixed') {
      renderMixedValueFields();
    }
    syncThemeIcon();
  }

  function renderMixedValueFields() {
    var container = $('mixedValueList');
    if (!container) return;
    var mixed = state.rbd.bridge.mixed;
    var ids = [];
    try {
      ids = RC.extractIdentifiers(mixed.expr);
    } catch (error) {
      var field = $('mixedExprField');
      if (field) {
        field.classList.add('is-invalid');
        var errorNode = $('mixedExprError');
        if (errorNode) errorNode.textContent = error.message;
      }
      container.innerHTML = '';
      return;
    }

    var field = $('mixedExprField');
    if (field) field.classList.remove('is-invalid');
    var errorNode = $('mixedExprError');
    if (errorNode) errorNode.textContent = '';

    var changed = false;
    ids.forEach(function (id) {
      if (!isReliability(mixed.values[id])) {
        mixed.values[id] = 0.9;
        changed = true;
      }
    });
    if (changed) scheduleSave();

    container.innerHTML = ids.map(function (id) {
      return '' +
        '<div class="mixed-value-item">' +
        '<span class="mixed-value-tag">' + escapeHtml(id) + '</span>' +
        '<div class="field">' +
        '<div class="input-shell"><input type="number" min="0.000000000001" max="1" step="0.001" inputmode="decimal" ' +
        'data-mixed-key="' + escapeHtml(id) + '" aria-label="单元 ' + escapeHtml(id) + ' 可靠度" value="' +
        escapeHtml(formatInputNumber(mixed.values[id], 8)) + '"></div>' +
        '<div class="field-error"></div>' +
        '</div></div>';
    }).join('');
  }

  function getRBDModel() {
    var rbd = state.rbd;
    if (rbd.structure === 'series') {
      return { type: 'series', rs: rbd.series.map(function (unit) { return unit.r; }) };
    }
    if (rbd.structure === 'parallel') {
      return { type: 'parallel', rs: rbd.parallel.map(function (unit) { return unit.r; }) };
    }
    if (rbd.structure === 'kn') {
      return { type: 'kn', n: rbd.kn.n, k: rbd.kn.k, r: rbd.kn.r };
    }
    if (rbd.bridge.mode === 'classic') {
      return { type: 'bridge', rs: rbd.bridge.rs.slice(0, 5) };
    }
    var identifiers = RC.extractIdentifiers(rbd.bridge.mixed.expr);
    var values = {};
    identifiers.forEach(function (id) {
      values[id] = rbd.bridge.mixed.values[id];
    });
    return { type: 'mixed', expr: rbd.bridge.mixed.expr, values: values };
  }

  function computeRBD() {
    var t0 = Number(state.rbd.t0);
    if (!isPositive(t0)) {
      return { error: '参考时间 t₀ 需大于 0。' };
    }
    var model;
    try {
      model = getRBDModel();
    } catch (error) {
      return { error: error.message };
    }

    var variables = RC.getModelVariables(model);
    if (!variables.length) return { error: '请至少添加一个单元。' };
    if (variables.length > RC.MAX_UNITS) {
      return { error: '单元数量不能超过 ' + RC.MAX_UNITS + ' 个。' };
    }

    if (model.type === 'kn') {
      if (!Number.isInteger(model.n) || model.n < 1 || model.n > RC.MAX_UNITS) {
        return { error: '单元总数 n 需为 1–20 的整数。' };
      }
      if (!Number.isInteger(model.k) || model.k < 1 || model.k > model.n) {
        return { error: '成功门槛 k 需为 1–n 的整数。' };
      }
    }

    var invalid = variables.some(function (variable) {
      return !isReliability(variable.value);
    });
    if (invalid) return { error: '可靠度需满足 0 < R ≤ 1，请检查高亮字段。' };

    var systemR;
    try {
      systemR = RC.evaluateRBD(model, t0, t0);
    } catch (error) {
      return { error: error.message };
    }
    if (!Number.isFinite(systemR)) return { error: '当前结构无法计算，请检查输入。' };

    var keyTimes = [100, 500, 1000];
    var timeValues = keyTimes.map(function (t) {
      return { time: t, reliability: RC.evaluateRBD(model, t, t0) };
    });

    var importance = variables.map(function (variable, index) {
      var value = RC.birnbaumImportance(model, t0, index);
      return {
        label: variable.label,
        value: variable.value,
        importance: Number.isFinite(value) ? value : 0
      };
    }).sort(function (a, b) {
      return b.importance - a.importance;
    });

    var unitCount = model.type === 'kn' ? model.n : variables.length;
    return {
      model: model,
      t0: t0,
      systemR: systemR,
      unitCount: unitCount,
      timeValues: timeValues,
      importance: importance
    };
  }

  function renderRBDInvalid(message) {
    setText('rbdResult', '—');
    setText('rbdResultSub', message || '请修正输入后重新计算。');
    setText('rbdUnitCount', '—');
    setText('rbdRefTime', isPositive(Number(state.rbd.t0)) ? formatHour(Number(state.rbd.t0)) : '—');
    setText('rbdMissionR', '—');
    var strip = $('rbdTimeStrip');
    if (strip) {
      strip.innerHTML = [100, 500, 1000].map(function (t) {
        return '<div class="time-chip"><span>R(' + t + 'h)</span><strong>—</strong></div>';
      }).join('');
    }
    var importanceList = $('rbdImportanceList');
    if (importanceList) {
      importanceList.innerHTML = '<div class="importance-empty">有效输入后显示重要度。</div>';
    }
    clearLineChart('rbd', 'rbdChart', 'rbdChartFallback');
  }

  function renderRBDResult() {
    var result = computeRBD();
    if (result.error) {
      renderRBDInvalid(result.error);
      return;
    }

    var rbd = state.rbd;
    var structureName = STRUCTURE_META[rbd.structure].name;
    var badge = STRUCTURE_META[rbd.structure].badge;
    if (rbd.structure === 'kn') {
      badge = state.rbd.kn.k + '/' + state.rbd.kn.n + ' 表决';
    }
    if (rbd.structure === 'bridge' && rbd.bridge.mode === 'mixed') {
      badge = '混联';
    }
    setText('rbdStructureBadge', badge);
    setText('rbdResult', formatR(result.systemR));
    flashValue('rbdResult');

    var sub = '';
    if (rbd.structure === 'series') {
      sub = result.unitCount + ' 个单元串联 · 当前任务点 R_sys = ∏Rᵢ';
    } else if (rbd.structure === 'parallel') {
      sub = result.unitCount + ' 个单元并联 · 至少一个单元可用';
    } else if (rbd.structure === 'kn') {
      sub = state.rbd.kn.k + '/' + state.rbd.kn.n + ' 表决 · 单元 R = ' + formatR(state.rbd.kn.r);
    } else if (rbd.bridge.mode === 'classic') {
      sub = '5 单元桥式网络 · 精确状态枚举';
    } else {
      sub = '混联结构 · ' + result.unitCount + ' 个单元 · ' + structureName;
    }
    setText('rbdResultSub', sub);
    setText('rbdUnitCount', String(result.unitCount));
    setText('rbdRefTime', formatHour(result.t0));
    var mission = result.timeValues[2] ? result.timeValues[2].reliability : NaN;
    setText('rbdMissionR', formatR(mission));
    setText('heroRbd', formatR(result.systemR));

    var strip = $('rbdTimeStrip');
    if (strip) {
      strip.innerHTML = result.timeValues.map(function (item) {
        return '<div class="time-chip"><span>R(' + item.time + 'h)</span><strong>' +
          formatR(item.reliability) + '</strong></div>';
      }).join('');
    }

    var curve = [];
    var tMax = Math.max(1200, result.t0 * 1.05);
    for (var i = 0; i <= 64; i += 1) {
      var t = (tMax * i) / 64;
      curve.push({ x: t, y: RC.evaluateRBD(result.model, t, result.t0) });
    }
    var markers = result.timeValues.map(function (item) {
      return { x: item.time, y: item.reliability };
    });
    renderLineChart('rbd', 'rbdChart', 'rbdChartFallback', curve, markers, tMax);

    var list = $('rbdImportanceList');
    if (list) {
      var shown = result.importance.slice(0, 5);
      var maxImportance = shown.reduce(function (max, item) {
        return Math.max(max, Math.abs(item.importance));
      }, 0);
      list.innerHTML = shown.map(function (item) {
        var width = maxImportance > 0 ? Math.abs(item.importance) / maxImportance * 100 : 0;
        return '<div class="importance-row">' +
          '<span>' + escapeHtml(item.label) + '</span>' +
          '<span class="importance-track"><i class="importance-fill" style="width:' + width.toFixed(1) + '%"></i></span>' +
          '<span class="importance-value">' + item.importance.toFixed(3) + '</span>' +
          '</div>';
      }).join('');
      if (result.importance.length > shown.length) {
        list.insertAdjacentHTML('beforeend',
          '<div class="importance-empty">另有 ' + (result.importance.length - shown.length) + ' 个单元未显示</div>');
      }
    }
  }

  function setRBDStructure(structure) {
    state.rbd.structure = structure;
    $$('#rbdStructureChoices .choice-card').forEach(function (button) {
      var active = button.getAttribute('data-structure') === structure;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    renderRBDStructure();
    renderRBDResult();
    scheduleSave();
  }

  function rbdUnitArray(kind) {
    if (kind === 'series') return state.rbd.series;
    if (kind === 'parallel') return state.rbd.parallel;
    return null;
  }

  function setFieldState(input, message) {
    if (!input) return;
    var field = input.closest('.field');
    if (!field) return;
    field.classList.toggle('is-invalid', !!message);
    var error = field.querySelector('.field-error');
    if (error) error.textContent = message || '';
  }

  function validateReliabilityInput(input) {
    var value = parseNumberInput(input);
    if (value == null) {
      setFieldState(input, '请输入可靠度。');
      return false;
    }
    if (!isReliability(value)) {
      setFieldState(input, '可靠度需满足 0 < R ≤ 1。');
      return false;
    }
    setFieldState(input, '');
    return true;
  }

  /* =========================================================================
     Module 02 — MTBF / λ / R conversion
     ========================================================================= */

  function syncDistributionForms() {
    var distribution = state.conversion.distribution;
    var expForm = $('expForm');
    var weibullForm = $('weibullForm');
    if (expForm) expForm.hidden = distribution !== 'exp';
    if (weibullForm) weibullForm.hidden = distribution !== 'weibull';
    $$('#distributionTabs button').forEach(function (button) {
      var active = button.getAttribute('data-distribution') === distribution;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    setText('distributionBadge', distribution === 'exp' ? '指数分布' : 'Weibull');
  }

  function setInputDisplay(id, value, activeId, placeholder) {
    var input = $(id);
    if (!input) return;
    if (placeholder != null) input.placeholder = placeholder;
    if (document.activeElement === input || id === activeId) return;
    input.value = value;
  }

  function syncExpFields(activeId) {
    var exp = state.conversion.exp;
    setInputDisplay('expMtbf', Number.isFinite(exp.mtbf) ? formatInputNumber(exp.mtbf, 9) : '', activeId, '∞');
    setInputDisplay('expLambda', formatInputNumber(exp.lambda, 9), activeId);
    setInputDisplay('expTime', formatInputNumber(exp.t, 9), activeId);
    setInputDisplay('expR', formatInputNumber(exp.r, 9), activeId);
  }

  function setExpFieldError(fieldId, message) {
    var field = $(fieldId);
    if (!field) return;
    field.classList.toggle('is-invalid', !!message);
    var error = field.querySelector('.field-error');
    if (error) error.textContent = message || '';
  }

  function updateNines(reliability) {
    var nines = RC.ninesFromAvailability(reliability);
    var label = formatNines(nines);
    setText('ninesValue', label);
    var filled = reliability >= 1 ? 5 : clamp(Math.floor(nines), 0, 5);
    $$('#ninesTrack .nines-segment').forEach(function (segment, index) {
      segment.classList.toggle('filled', index < filled);
    });
    var sub = '';
    if (reliability >= 1) {
      sub = 'R = 1，无失效假设；N 个 9 趋于无穷。';
    } else {
      sub = 'R = ' + formatR(reliability, 4) + ' · 1 − R = ' + formatSci(1 - reliability, 2) +
        ' · 仅作可用度视角估算。';
    }
    setText('ninesSub', sub);
  }

  function renderDistributionInvalid(message) {
    setText('distR', '—');
    setText('distRSub', message || '请修正输入后重新计算。');
    setText('distMtbf', '—');
    setText('distLambda', '—');
    setText('distHazard', '—');
    setText('distTime', '—');
    setText('ninesValue', '—');
    $$('#ninesTrack .nines-segment').forEach(function (segment) {
      segment.classList.remove('filled');
    });
    setText('ninesSub', '有效输入后显示可用度视角。');
    clearLineChart('dist', 'distChart', 'distChartFallback');
  }

  function renderExponentialResults() {
    var exp = state.conversion.exp;
    var lambda = Number(exp.lambda);
    var t = Number(exp.t);
    var r = Number(exp.r);
    if (!isNonNegative(lambda) || !isNonNegative(t) || !isReliability(r)) {
      renderDistributionInvalid('指数分布参数无效，请检查 λ、t 与 R(t)。');
      return;
    }
    var mtbf = RC.mtbfFromLambda(lambda);
    setText('distR', formatR(r));
    flashValue('distR');
    setText('distRSub', 'MTBF ' + formatHour(mtbf) + ' · t = ' + formatHour(t));
    setText('distMtbf', formatHour(mtbf));
    setText('distLambda', formatSci(lambda, 4) + ' /h');
    setText('distHazard', formatSci(lambda, 4) + ' /h');
    setText('distTime', formatHour(t));
    setText('heroMtbf', formatHour(mtbf));
    setHtml('distFormulaCard', '<code>R(t) = e^(−λt)</code> · <code>MTBF = 1/λ</code>。指数分布适用于成熟期、失效率近似恒定的产品。');
    updateNines(r);

    var xMax = Math.max(1200, t * 1.15);
    if (Number.isFinite(mtbf)) xMax = Math.max(xMax, Math.min(mtbf * 3, Math.max(t * 6, 1200)));
    var curve = [];
    for (var i = 0; i <= 64; i += 1) {
      var x = (xMax * i) / 64;
      curve.push({ x: x, y: RC.exponentialReliability(lambda, x) });
    }
    var markers = [100, 500, 1000].map(function (markerTime) {
      return { x: markerTime, y: RC.exponentialReliability(lambda, markerTime) };
    });
    renderLineChart('dist', 'distChart', 'distChartFallback', curve, markers, xMax);
  }

  function renderWeibullResults() {
    var weibull = state.conversion.weibull;
    var beta = Number(weibull.beta);
    var eta = Number(weibull.eta);
    var t = Number(weibull.t);
    if (!isPositive(beta) || !isPositive(eta) || !isNonNegative(t)) {
      renderDistributionInvalid('Weibull 参数无效，请检查 β、η 与 t。');
      return;
    }
    var r = RC.weibullReliability(t, beta, eta);
    var mtbf = RC.weibullMTBF(beta, eta);
    var hazard = RC.weibullHazard(t, beta, eta);
    var averageLambda = mtbf > 0 ? 1 / mtbf : Infinity;
    setText('distR', formatR(r));
    flashValue('distR');
    setText('distRSub', 'β = ' + beta + ' · η = ' + formatHour(eta) + ' · t = ' + formatHour(t));
    setText('distMtbf', formatHour(mtbf));
    setText('distLambda', formatSci(averageLambda, 4) + ' /h');
    setText('distHazard', formatSci(hazard, 4) + ' /h');
    setText('distTime', formatHour(t));
    setText('heroMtbf', formatHour(mtbf));
    setHtml('distFormulaCard', '<code>R(t) = exp[−(t/η)^β]</code> · <code>MTBF = ηΓ(1 + 1/β)</code>。当前 λ 字段显示平均失效率 1/MTBF，λ(t) 为瞬时失效率。');
    updateNines(r);

    var xMax = Math.max(1200, t * 1.4, eta * 2.4);
    var curve = [];
    for (var i = 0; i <= 64; i += 1) {
      var x = (xMax * i) / 64;
      curve.push({ x: x, y: RC.weibullReliability(x, beta, eta) });
    }
    var markers = [100, 500, 1000].map(function (markerTime) {
      return { x: markerTime, y: RC.weibullReliability(markerTime, beta, eta) };
    });
    renderLineChart('dist', 'distChart', 'distChartFallback', curve, markers, xMax);
  }

  function recalcConversion() {
    syncDistributionForms();
    if (state.conversion.distribution === 'exp') {
      renderExponentialResults();
    } else {
      renderWeibullResults();
    }
  }

  function setDistribution(distribution) {
    state.conversion.distribution = distribution;
    syncDistributionForms();
    renderDistributionInvalid('');
    recalcConversion();
    scheduleSave();
  }

  function handleExpInput(field) {
    var value = parseNumberInput($(field));
    var exp = state.conversion.exp;
    var fieldMap = {
      mtbf: 'expMtbfField',
      lambda: 'expLambdaField',
      time: 'expTimeField',
      r: 'expRField'
    };
    var fieldId = fieldMap[field];
    if (value == null) {
      setExpFieldError(fieldId, '请输入数值。');
      return;
    }

    if (field === 'mtbf') {
      if (!isPositive(value)) {
        setExpFieldError(fieldId, 'MTBF 需大于 0 小时。');
        return;
      }
      exp.mtbf = value;
      exp.lambda = 1 / value;
      var currentT = Number(exp.t);
      exp.r = isNonNegative(currentT) ? Math.exp(-exp.lambda * currentT) : 1;
      setExpFieldError(fieldId, '');
    } else if (field === 'lambda') {
      if (!isNonNegative(value)) {
        setExpFieldError(fieldId, '失效率 λ 需大于或等于 0。');
        return;
      }
      exp.lambda = value;
      exp.mtbf = RC.mtbfFromLambda(value);
      var tForLambda = Number(exp.t);
      exp.r = isNonNegative(tForLambda) ? Math.exp(-value * tForLambda) : 1;
      setExpFieldError(fieldId, '');
    } else if (field === 'time') {
      if (!isNonNegative(value)) {
        setExpFieldError(fieldId, '任务时间需大于或等于 0。');
        return;
      }
      exp.t = value;
      exp.r = Math.exp(-Number(exp.lambda) * value);
      setExpFieldError(fieldId, '');
    } else if (field === 'r') {
      if (!isReliability(value)) {
        setExpFieldError(fieldId, '可靠度需满足 0 < R ≤ 1。');
        return;
      }
      if (!isPositive(Number(exp.t))) {
        setExpFieldError(fieldId, '反算 λ 时任务时间需大于 0。');
        setExpFieldError('expTimeField', '当前 R 反算需要 t > 0。');
        return;
      }
      exp.r = value;
      exp.lambda = -Math.log(value) / Number(exp.t);
      exp.mtbf = RC.mtbfFromLambda(exp.lambda);
      setExpFieldError('expTimeField', '');
      setExpFieldError(fieldId, '');
    }

    syncExpFields(field === 'mtbf' ? 'expMtbf' : field === 'lambda' ? 'expLambda' : field === 'time' ? 'expTime' : 'expR');
    scheduleSave();
    schedule('conversion', recalcConversion, 300);
  }

  function handleWeibullInput(field) {
    var value = parseNumberInput($(field));
    var fieldMap = {
      beta: 'weibullBetaField',
      eta: 'weibullEtaField',
      time: 'weibullTimeField'
    };
    var fieldId = fieldMap[field];
    if (value == null) {
      setExpFieldError(fieldId, '请输入数值。');
      return;
    }
    if (field === 'beta' && !isPositive(value)) {
      setExpFieldError(fieldId, '形状参数 β 需大于 0。');
      return;
    }
    if (field === 'eta' && !isPositive(value)) {
      setExpFieldError(fieldId, '尺度参数 η 需大于 0。');
      return;
    }
    if (field === 'time' && !isNonNegative(value)) {
      setExpFieldError(fieldId, '任务时间需大于或等于 0。');
      return;
    }
    setExpFieldError(fieldId, '');
    if (field === 'beta') state.conversion.weibull.beta = value;
    if (field === 'eta') state.conversion.weibull.eta = value;
    if (field === 'time') state.conversion.weibull.t = value;
    scheduleSave();
    schedule('conversion', recalcConversion, 300);
  }

  /* =========================================================================
     Module 03 — Reliability prediction
     ========================================================================= */

  function getCategory(categoryId) {
    return state.prediction.categories.find(function (item) { return item.id === categoryId; }) ||
      state.prediction.categories[0];
  }

  function getQuality(qualityId) {
    return state.prediction.quality.find(function (item) { return item.id === qualityId; }) ||
      state.prediction.quality[0];
  }

  function getEnvironment(environmentId) {
    return state.prediction.environment.find(function (item) { return item.id === environmentId; }) ||
      state.prediction.environment[0];
  }

  function factorMaps() {
    var baseRates = {};
    var qualityFactors = {};
    var environmentFactors = {};
    state.prediction.categories.forEach(function (item) {
      baseRates[item.id] = Number(item.base);
    });
    state.prediction.quality.forEach(function (item) {
      qualityFactors[item.id] = Number(item.factor);
    });
    state.prediction.environment.forEach(function (item) {
      environmentFactors[item.id] = Number(item.factor);
    });
    return {
      baseRates: baseRates,
      qualityFactors: qualityFactors,
      environmentFactors: environmentFactors
    };
  }

  function renderPredictionMethod() {
    var method = state.prediction.method;
    var partsPanel = $('partsPanel');
    var similarPanel = $('similarPanel');
    if (partsPanel) partsPanel.hidden = method !== 'parts';
    if (similarPanel) similarPanel.hidden = method !== 'similar';
    $$('#predictionMethod button').forEach(function (button) {
      var active = button.getAttribute('data-method') === method;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    setText('predictionBadge', method === 'parts' ? '元器件计数法' : '相似产品法');
    syncSimilarFields();
  }

  function syncSimilarFields() {
    var similar = state.prediction.similar;
    setInputDisplay('similarMtbf', formatInputNumber(similar.mtbf, 9), null);
    setInputDisplay('similarComplexity', formatInputNumber(similar.complexity, 8), null);
    setInputDisplay('similarEnv', formatInputNumber(similar.environment, 8), null);
  }

  function selectOptions(items, selected, labelKey) {
    return items.map(function (item) {
      return '<option value="' + escapeHtml(item.id) + '"' + (item.id === selected ? ' selected' : '') + '>' +
        escapeHtml(item[labelKey || 'name']) + '</option>';
    }).join('');
  }

  function partRowHtml(part, index) {
    var category = getCategory(part.type);
    var quality = getQuality(part.quality);
    var environment = getEnvironment(part.environment);
    var maps = factorMaps();
    var contribution = RC.partContribution(part, maps.baseRates, maps.qualityFactors, maps.environmentFactors);
    return '' +
      '<div class="part-row" data-part-index="' + index + '">' +
      '<div class="part-type-cell">' +
      '<div class="input-shell"><select data-part-field="type" aria-label="第 ' + (index + 1) + ' 行元器件类型">' +
      selectOptions(state.prediction.categories, part.type) + '</select></div>' +
      '<div class="part-type-meta">λb ' + Number(category.base).toFixed(4) + ' × πQ ' +
      Number(quality.factor).toFixed(2) + ' × πE ' + Number(environment.factor).toFixed(2) + '</div>' +
      '</div>' +
      '<div class="part-qty-cell">' +
      '<div class="input-shell"><input type="number" min="1" max="10000" step="1" inputmode="numeric" ' +
      'data-part-field="qty" title="数量范围 1–10,000" aria-label="第 ' + (index + 1) + ' 行数量" value="' + escapeHtml(part.qty) + '"></div>' +
      '<div class="part-error" data-part-error></div>' +
      '</div>' +
      '<div class="part-quality-cell"><div class="input-shell"><select data-part-field="quality" aria-label="第 ' +
      (index + 1) + ' 行质量等级">' + selectOptions(state.prediction.quality, part.quality, 'name') + '</select></div></div>' +
      '<div class="part-env-cell"><div class="input-shell"><select data-part-field="environment" aria-label="第 ' +
      (index + 1) + ' 行环境类别">' + selectOptions(state.prediction.environment, part.environment, 'name') + '</select></div></div>' +
      '<div class="part-contribution"><strong data-contribution>' + contribution.toFixed(3) + '</strong><span>FIT</span></div>' +
      '<button class="icon-btn" type="button" data-remove-part="' + index + '" title="删除该行" aria-label="删除第 ' +
      (index + 1) + ' 行元器件">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v5M14 11v5"></path></svg>' +
      '</button>' +
      '</div>';
  }

  function renderPartRows() {
    var container = $('partRows');
    if (!container) return;
    if (!state.prediction.parts.length) {
      container.innerHTML = '<div class="empty-state">尚未添加元器件。点击“添加元器件”开始自下而上预计。</div>';
      return;
    }
    container.innerHTML = state.prediction.parts.map(partRowHtml).join('');
  }

  function renderPredictionFactors() {
    var container = $('predictionFactors');
    if (!container) return;
    var categories = state.prediction.categories.map(function (item) {
      return '<div class="factor-row"><span>' + escapeHtml(item.name) + '</span>' +
        '<div class="factor-input-wrap"><input type="number" min="0" step="0.0001" data-factor-kind="category" data-factor-key="' +
        escapeHtml(item.id) + '" value="' + escapeHtml(item.base) + '" aria-label="' + escapeHtml(item.name) + ' 基础失效率">' +
        '<span class="factor-error"></span></div></div>';
    }).join('');
    var quality = state.prediction.quality.map(function (item) {
      return '<div class="factor-row"><span>πQ ' + escapeHtml(item.name) + '</span>' +
        '<div class="factor-input-wrap"><input type="number" min="0.000001" step="0.1" data-factor-kind="quality" data-factor-key="' +
        escapeHtml(item.id) + '" value="' + escapeHtml(item.factor) + '" aria-label="' + escapeHtml(item.name) + ' 质量因子">' +
        '<span class="factor-error"></span></div></div>';
    }).join('');
    var environment = state.prediction.environment.map(function (item) {
      return '<div class="factor-row"><span>πE ' + escapeHtml(item.name) + '</span>' +
        '<div class="factor-input-wrap"><input type="number" min="0.000001" step="0.1" data-factor-kind="environment" data-factor-key="' +
        escapeHtml(item.id) + '" value="' + escapeHtml(item.factor) + '" aria-label="' + escapeHtml(item.name) + ' 环境因子">' +
        '<span class="factor-error"></span></div></div>';
    }).join('');
    container.innerHTML =
      '<div class="factor-table"><div class="factor-table-title">基础失效率 λb · FIT（≥ 0）</div>' + categories + '</div>' +
      '<div>' +
      '<div class="factor-table" style="margin-bottom:10px;"><div class="factor-table-title">质量修正因子 πQ（> 0）</div>' + quality + '</div>' +
      '<div class="factor-table"><div class="factor-table-title">环境修正因子 πE（> 0）</div>' + environment + '</div>' +
      '</div>';
  }

  function updatePartRowVisual(index) {
    var row = document.querySelector('.part-row[data-part-index="' + index + '"]');
    var part = state.prediction.parts[index];
    if (!row || !part) return;
    var category = getCategory(part.type);
    var quality = getQuality(part.quality);
    var environment = getEnvironment(part.environment);
    var maps = factorMaps();
    var contribution = RC.partContribution(part, maps.baseRates, maps.qualityFactors, maps.environmentFactors);
    var meta = row.querySelector('.part-type-meta');
    var contributionNode = row.querySelector('[data-contribution]');
    if (meta) {
      meta.textContent = 'λb ' + Number(category.base).toFixed(4) + ' × πQ ' +
        Number(quality.factor).toFixed(2) + ' × πE ' + Number(environment.factor).toFixed(2);
    }
    if (contributionNode) contributionNode.textContent = contribution.toFixed(3);
  }

  function getPrediction() {
    var method = state.prediction.method;
    if (method === 'similar') {
      var similar = state.prediction.similar;
      if (!isPositive(Number(similar.mtbf)) || !isPositive(Number(similar.complexity)) ||
        !isPositive(Number(similar.environment))) {
        return { error: '相似产品法参数无效，请检查 MTBF 与修正因子。' };
      }
      var result = RC.similarProductPrediction(
        Number(similar.mtbf),
        Number(similar.complexity),
        Number(similar.environment)
      );
      return {
        method: 'similar',
        label: '相似产品法',
        mtbf: result.mtbf,
        lambda: result.lambda,
        totalFIT: result.lambda * 1e6,
        itemCount: null,
        multiplier: result.multiplier,
        source: '工程经验值'
      };
    }

    var parts = state.prediction.parts;
    if (!parts.length) return null;

    var categoryIds = state.prediction.categories.map(function (item) { return item.id; });
    var qualityIds = state.prediction.quality.map(function (item) { return item.id; });
    var environmentIds = state.prediction.environment.map(function (item) { return item.id; });
    for (var i = 0; i < parts.length; i += 1) {
      var part = parts[i];
      if (categoryIds.indexOf(part.type) === -1 || qualityIds.indexOf(part.quality) === -1 ||
        environmentIds.indexOf(part.environment) === -1) {
        return { error: '元器件清单中存在无效的类型、质量等级或环境类别。' };
      }
      if (!Number.isInteger(Number(part.qty)) || Number(part.qty) < 1 || Number(part.qty) > 10000) {
        return { error: '元器件数量需为 1–10,000 的整数。' };
      }
    }

    var configInvalid = state.prediction.categories.some(function (item) {
      return !isNonNegative(Number(item.base));
    }) || state.prediction.quality.some(function (item) {
      return !isPositive(Number(item.factor));
    }) || state.prediction.environment.some(function (item) {
      return !isPositive(Number(item.factor));
    });
    if (configInvalid) return { error: '高级系数存在无效值，请检查基础失效率与修正因子。' };

    var maps = factorMaps();
    var summary = RC.partsCountPrediction(
      parts,
      maps.baseRates,
      maps.qualityFactors,
      maps.environmentFactors
    );
    var rows = parts.map(function (part) {
      var category = getCategory(part.type);
      return {
        type: category.name,
        categoryId: category.id,
        qty: Number(part.qty),
        quality: getQuality(part.quality).name,
        environment: getEnvironment(part.environment).name,
        fit: RC.partContribution(part, maps.baseRates, maps.qualityFactors, maps.environmentFactors)
      };
    });

    var grouped = {};
    rows.forEach(function (row) {
      if (!grouped[row.categoryId]) {
        grouped[row.categoryId] = { label: row.type, value: 0 };
      }
      grouped[row.categoryId].value += row.fit;
    });
    var ranking = Object.keys(grouped).map(function (key) {
      return grouped[key];
    }).sort(function (a, b) { return b.value - a.value; });

    return {
      method: 'parts',
      label: '元器件计数法',
      mtbf: summary.mtbf,
      lambda: summary.lambda,
      totalFIT: summary.totalFIT,
      itemCount: summary.itemCount,
      rows: rows,
      ranking: ranking,
      source: '可编辑系数表'
    };
  }

  function renderPredictionResult() {
    var prediction = getPrediction();
    var rankingPanel = $('predictionRankingPanel');
    var ranking = $('predictionRanking');
    if (rankingPanel) rankingPanel.hidden = state.prediction.method !== 'parts';

    if (!prediction) {
      setText('predictionMtbf', '—');
      setText('predictionMtbfSub', '添加元器件后开始预计');
      setText('predictionLambda', '—');
      setText('predictionFit', '—');
      setText('predictionCount', '—');
      setText('predictionSource', '—');
      if (ranking) ranking.innerHTML = '<div class="importance-empty">尚未添加元器件。</div>';
      setHtml('predictionFormula', '计数法：<code>λ_sys = Σ nᵢ λ_bᵢ π_Qᵢ π_Eᵢ</code>，结果来自可编辑系数表。');
      return;
    }
    if (prediction.error) {
      setText('predictionMtbf', '—');
      setText('predictionMtbfSub', prediction.error);
      setText('predictionLambda', '—');
      setText('predictionFit', '—');
      setText('predictionCount', '—');
      setText('predictionSource', '—');
      if (ranking) ranking.innerHTML = '<div class="importance-empty">参数有效后显示来源排序。</div>';
      return;
    }

    setText('predictionMtbf', formatHour(prediction.mtbf));
    flashValue('predictionMtbf');
    if (prediction.method === 'parts') {
      setText('predictionMtbfSub', 'Σ FIT ' + prediction.totalFIT.toFixed(3) + ' · ' +
        prediction.itemCount + ' 个元器件 · 恒定失效率假设');
      setText('predictionCount', String(prediction.itemCount));
      setText('predictionSource', 'GJB/Z 思路');
      setHtml('predictionFormula', '计数法：<code>λ_sys = Σ nᵢ λ_bᵢ π_Qᵢ π_Eᵢ</code>；系数在“高级参数”中可覆盖。');
    } else {
      setText('predictionMtbfSub', '参考 MTBF ' + formatHour(state.prediction.similar.mtbf) +
        ' · 综合修正 ×' + prediction.multiplier.toFixed(2));
      setText('predictionCount', '—');
      setText('predictionSource', '工程估计');
      setHtml('predictionFormula', '相似产品法：<code>MTBF_new = MTBF_ref / (C_c × C_e)</code>，修正因子需按新产品的复杂度与环境复核。');
    }
    setText('predictionLambda', formatSci(prediction.lambda, 4) + ' /h');
    setText('predictionFit', prediction.totalFIT < 1000
      ? prediction.totalFIT.toFixed(2) + ' FIT'
      : formatSci(prediction.totalFIT, 3) + ' FIT');

    if (ranking && prediction.method === 'parts') {
      var top = (prediction.ranking || []).slice(0, 5);
      var max = top.reduce(function (value, item) { return Math.max(value, item.value); }, 0);
      ranking.innerHTML = top.length ? top.map(function (item) {
        var width = max > 0 ? item.value / max * 100 : 0;
        return '<div class="importance-row">' +
          '<span>' + escapeHtml(item.label) + '</span>' +
          '<span class="importance-track"><i class="importance-fill" style="width:' + width.toFixed(1) + '%"></i></span>' +
          '<span class="importance-value">' + item.value.toFixed(2) + '</span>' +
          '</div>';
      }).join('') : '<div class="importance-empty">失效率合计为 0，无来源排序。</div>';
    }

    schedule('allocation', renderAllocationResult, 0);
  }

  function setPartFieldError(input, message) {
    var row = input.closest('.part-row');
    if (!row) return;
    var error = row.querySelector('[data-part-error]');
    if (error) {
      error.textContent = message || '';
      error.style.display = message ? 'block' : 'none';
    }
    input.classList.toggle('invalid', !!message);
    if (message) {
      input.style.borderColor = 'var(--danger)';
      input.style.background = 'var(--danger-soft)';
    } else {
      input.style.borderColor = '';
      input.style.background = '';
    }
  }

  function handlePartInput(input) {
    var row = input.closest('.part-row');
    if (!row) return;
    var index = Number(row.getAttribute('data-part-index'));
    var part = state.prediction.parts[index];
    if (!part) return;
    var field = input.getAttribute('data-part-field');
    if (field === 'qty') {
      var value = parseNumberInput(input);
      if (value == null) {
        setPartFieldError(input, '请输入数量');
        return;
      }
      if (!Number.isInteger(value) || value < 1 || value > 10000) {
        setPartFieldError(input, '1–10,000');
        return;
      }
      setPartFieldError(input, '');
      part.qty = value;
    } else {
      part[field] = input.value;
    }
    updatePartRowVisual(index);
    scheduleSave();
    schedule('prediction', recalcPrediction, 300);
  }

  function handleFactorInput(input) {
    var kind = input.getAttribute('data-factor-kind');
    var key = input.getAttribute('data-factor-key');
    var value = parseNumberInput(input);
    var valid = value != null;
    if (valid && kind === 'category') valid = isNonNegative(value);
    if (valid && kind !== 'category') valid = isPositive(value);
    input.classList.toggle('invalid', !valid);
    var wrap = input.closest('.factor-input-wrap');
    if (wrap) {
      wrap.classList.toggle('invalid', !valid);
      var error = wrap.querySelector('.factor-error');
      if (error) error.textContent = !valid ? (value == null ? '必填' : kind === 'category' ? '需 ≥ 0' : '需 > 0') : '';
    }
    if (!valid) return;
    if (kind === 'category') {
      var category = state.prediction.categories.find(function (item) { return item.id === key; });
      if (category) category.base = value;
    } else if (kind === 'quality') {
      var quality = state.prediction.quality.find(function (item) { return item.id === key; });
      if (quality) quality.factor = value;
    } else {
      var environment = state.prediction.environment.find(function (item) { return item.id === key; });
      if (environment) environment.factor = value;
    }
    state.prediction.parts.forEach(function (part, index) { updatePartRowVisual(index); });
    scheduleSave();
    schedule('prediction', recalcPrediction, 300);
  }

  function handleSimilarInput(field) {
    var input = $(field);
    var value = parseNumberInput(input);
    var fieldMap = {
      similarMtbf: 'similarMtbfField',
      similarComplexity: 'similarComplexityField',
      similarEnv: 'similarEnvField'
    };
    var fieldId = fieldMap[field];
    if (value == null) {
      setFieldState(input, '请输入数值。');
      return;
    }
    if (!isPositive(value)) {
      setFieldState(input, field === 'similarMtbf' ? 'MTBF 需大于 0。' : '修正因子需大于 0。');
      return;
    }
    setFieldState(input, '');
    if (field === 'similarMtbf') state.prediction.similar.mtbf = value;
    if (field === 'similarComplexity') state.prediction.similar.complexity = value;
    if (field === 'similarEnv') state.prediction.similar.environment = value;
    scheduleSave();
    schedule('prediction', recalcPrediction, 300);
  }

  function recalcPrediction() {
    renderPredictionResult();
  }

  function setPredictionMethod(method) {
    state.prediction.method = method;
    renderPredictionMethod();
    renderPredictionResult();
    scheduleSave();
  }

  /* =========================================================================
     Module 04 — Reliability allocation
     ========================================================================= */

  function syncTargetMode() {
    var mode = state.allocation.targetMode;
    var targetRField = $('targetRField');
    var targetMtbfField = $('targetMtbfField');
    if (targetRField) targetRField.hidden = mode !== 'r';
    if (targetMtbfField) targetMtbfField.hidden = mode !== 'mtbf';
    $$('#targetModeTabs button').forEach(function (button) {
      var active = button.getAttribute('data-target-mode') === mode;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', active ? 'true' : 'false');
    });
  }

  function renderAllocationMethodTabs() {
    var method = state.allocation.method;
    $$('#allocationMethodTabs button').forEach(function (button) {
      var active = button.getAttribute('data-method') === method;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    setText('allocationMethodBadge',
      method === 'equal' ? '等分配' : method === 'scoring' ? '评分分配' : 'AGREE 分配');
  }

  function miniFieldHtml(field, index, value, min, max, step, label) {
    return '<div class="mini-field" data-mini-field="' + field + '">' +
      '<div class="input-shell"><input type="number" min="' + min + '" max="' + max + '" step="' + step +
      '" inputmode="decimal" data-alloc-field="' + field + '" data-alloc-index="' + index +
      '" aria-label="' + escapeHtml(label) + '" value="' + escapeHtml(value) + '"></div>' +
      '<span class="mini-error"></span></div>';
  }

  function renderAllocationUnitPanel() {
    var container = $('allocationUnitPanel');
    if (!container) return;
    var method = state.allocation.method;
    var units = state.allocation.units;
    if (method === 'equal') {
      container.innerHTML = '<div class="empty-state" style="min-height: 74px;">' +
        '等分配将 <code style="font-family:var(--mono);">λ_sys</code> 平均分摊到 ' + units.length +
        ' 个单元；每个单元获得相同权重，适合结构、复杂度与环境相近的单元。</div>';
      setText('allocationMethodNote', '等分配：Rᵢ = R_sys^(1/n)，λᵢ = λ_sys / n。');
      return;
    }

    if (method === 'scoring') {
      var scoringHtml = '<div class="alloc-head scoring"><span>单元</span><span>复杂度</span><span>技术水平</span><span>环境严酷</span></div>' +
        '<div class="alloc-unit-list">';
      units.forEach(function (unit, index) {
        scoringHtml += '<div class="alloc-unit-row">' +
          '<span class="alloc-unit-name">' + escapeHtml(unit.name) + '</span>' +
          miniFieldHtml('complexity', index, unit.complexity, 1, 10, 1, unit.name + ' 复杂度评分') +
          miniFieldHtml('technology', index, unit.technology, 1, 10, 1, unit.name + ' 技术水平评分') +
          miniFieldHtml('environment', index, unit.environment, 1, 10, 1, unit.name + ' 环境严酷度评分') +
          '</div>';
      });
      scoringHtml += '</div>';
      container.innerHTML = scoringHtml;
      setText('allocationMethodNote', '评分：wᵢ = 复杂度 × 环境严酷度 ÷ 技术水平，λᵢ = λ_sys × wᵢ / Σw。评分 1–10，高分代表更复杂、更严酷或更成熟。');
      return;
    }

    var agreeHtml = '<div class="alloc-head agree"><span>单元</span><span>重要度 I</span><span>模块数 m</span></div>' +
      '<div class="alloc-unit-list">';
    units.forEach(function (unit, index) {
      agreeHtml += '<div class="alloc-unit-row agree">' +
        '<span class="alloc-unit-name">' + escapeHtml(unit.name) + '</span>' +
        miniFieldHtml('importance', index, unit.importance, 0.1, 1, 0.05, unit.name + ' 重要度') +
        miniFieldHtml('modules', index, unit.modules, 0.1, 1000, 1, unit.name + ' 模块数') +
        '</div>';
    });
    agreeHtml += '</div>';
    container.innerHTML = agreeHtml;
    setText('allocationMethodNote', 'AGREE 工程化变体：wᵢ = 模块数 ÷ 重要度，λᵢ = λ_sys × wᵢ / Σw；重要度 0.1–1，模块数 > 0，重要度越高分配要求越严。');
    renderAllocationMethodTabs();
  }

  function setAllocationMethod(method) {
    state.allocation.method = method;
    renderAllocationMethodTabs();
    renderAllocationUnitPanel();
    renderAllocationResult();
    scheduleSave();
  }

  function setTargetMode(mode) {
    state.allocation.targetMode = mode;
    syncTargetMode();
    renderAllocationResult();
    scheduleSave();
  }

  function computeAllocation() {
    var allocation = state.allocation;
    var missionTime = Number(allocation.missionTime);
    if (!isPositive(missionTime)) {
      return { error: '任务时间需大于 0 小时。' };
    }

    var lambdaTotal;
    if (allocation.targetMode === 'r') {
      var targetR = Number(allocation.targetR);
      if (!isReliability(targetR)) return { error: '目标可靠度需满足 0 < R ≤ 1。' };
      lambdaTotal = RC.targetFailureRate('r', targetR, null, missionTime);
    } else {
      var targetMtbf = Number(allocation.targetMtbf);
      if (!isPositive(targetMtbf)) return { error: '目标 MTBF 需大于 0 小时。' };
      lambdaTotal = RC.targetFailureRate('mtbf', null, targetMtbf, missionTime);
    }

    if (!Number.isInteger(Number(allocation.n)) || Number(allocation.n) < 1 || Number(allocation.n) > 20) {
      return { error: '单元数量需为 1–20 的整数。' };
    }
    if (allocation.units.length !== Number(allocation.n)) {
      syncAllocationUnits(allocation);
    }
    for (var i = 0; i < allocation.units.length; i += 1) {
      var unit = allocation.units[i];
      if (allocation.method === 'scoring') {
        if (![unit.complexity, unit.technology, unit.environment].every(function (value) {
          return Number.isFinite(Number(value)) && Number(value) >= 1 && Number(value) <= 10;
        })) {
          return { error: '评分分配的单元评分需在 1–10 之间。' };
        }
      }
      if (allocation.method === 'agree') {
        if (!(Number(unit.importance) >= 0.1 && Number(unit.importance) <= 1)) {
          return { error: 'AGREE 重要度需在 0.1–1 之间。' };
        }
        if (!(Number(unit.modules) > 0)) {
          return { error: 'AGREE 模块数需大于 0。' };
        }
      }
    }

    var result = RC.allocateReliability({
      units: allocation.units,
      lambdaTotal: lambdaTotal,
      method: allocation.method,
      missionTime: missionTime
    });

    var prediction = getPrediction();
    if (prediction && prediction.error) prediction = null;
    var comparison = null;
    if (prediction && Number.isFinite(prediction.lambda) && prediction.lambda > 0) {
      comparison = {
        wholeSystemMtbf: prediction.mtbf,
        perUnitLambda: prediction.lambda / allocation.units.length,
        perUnitMtbf: prediction.mtbf * allocation.units.length
      };
      result.items.forEach(function (item) {
        item.over = item.lambda < comparison.perUnitLambda * 0.98;
      });
    } else {
      result.items.forEach(function (item) { item.over = false; });
    }

    return {
      result: result,
      prediction: prediction,
      comparison: comparison,
      missionTime: missionTime,
      targetR: Math.exp(-lambdaTotal * missionTime),
      targetMtbf: lambdaTotal > 0 ? 1 / lambdaTotal : Infinity,
      lambdaTotal: lambdaTotal
    };
  }

  function renderAllocationInvalid(message) {
    setText('allocationMtbf', '—');
    setText('allocationSub', message || '请修正输入后重新计算。');
    setText('allocationTargetR', '—');
    setText('allocationLambda', '—');
    setText('allocationCount', '—');
    setText('allocationPredicted', '—');
    setText('allocationThresholdNote', '参数有效后显示能力对照');
    var list = $('allocationThresholdList');
    if (list) list.innerHTML = '<div class="importance-empty">等待有效输入。</div>';
    if (charts.alloc) {
      charts.alloc.data.labels = [];
      charts.alloc.data.datasets[0].data = [];
      charts.alloc.update('none');
    }
  }

  function renderAllocationThreshold(data) {
    var list = $('allocationThresholdList');
    if (!list) return;
    var comparison = data.comparison;
    var items = data.result.items;
    var maxLambda = items.reduce(function (max, item) { return Math.max(max, item.lambda); }, 0);
    setText('allocationThresholdNote', comparison
      ? '对照：模块 03 MTBF ' + formatHour(comparison.wholeSystemMtbf) + ' ÷ ' + items.length + ' 单元'
      : '未填写模块 03 预计值');
    list.innerHTML = items.map(function (item) {
      var width = maxLambda > 0 ? item.lambda / maxLambda * 100 : 0;
      var badge = '';
      if (comparison) {
        badge = item.over
          ? '<span class="threshold-badge over" title="要求高于当前预计能力">高于当前预计能力</span>'
          : '<span class="threshold-badge">在预计能力内</span>';
      } else {
        badge = '<span class="threshold-value">待对照</span>';
      }
      return '<div class="threshold-row">' +
        '<span class="threshold-name">' + escapeHtml(item.name) + '</span>' +
        '<span class="threshold-bar"><i class="threshold-fill' + (item.over ? ' over' : '') +
        '" style="width:' + width.toFixed(1) + '%"></i></span>' +
        '<span class="threshold-value">MTBF ' + formatHourNumber(item.mtbf) + ' h</span>' +
        badge +
        '</div>';
    }).join('');
  }

  function renderAllocationResult() {
    var computed = computeAllocation();
    if (computed.error) {
      renderAllocationInvalid(computed.error);
      return;
    }
    var result = computed.result;
    setText('allocationMtbf', formatHour(computed.targetMtbf));
    flashValue('allocationMtbf');
    setText('allocationSub', '系统 λ = ' + formatSci(computed.lambdaTotal, 4) + ' /h · 任务时间 ' +
      formatHour(computed.missionTime));
    setText('allocationTargetR', formatR(computed.targetR));
    setText('allocationLambda', formatSci(computed.lambdaTotal, 4) + ' /h');
    setText('allocationCount', String(result.items.length));
    setText('allocationPredicted', computed.prediction ? formatHour(computed.prediction.mtbf) : '—');

    renderAllocationChart(result.items);
    renderAllocationThreshold(computed);
  }

  function validateAllocationNumber(input, field, value) {
    var mini = input.closest('.mini-field');
    var message = '';
    if (value == null) {
      message = '请输入数值';
    } else if (field === 'importance') {
      if (!(value >= 0.1 && value <= 1)) message = '0.1–1';
    } else if (field === 'modules') {
      if (!(value > 0)) message = '> 0';
    } else if (!(value >= 1 && value <= 10)) {
      message = '1–10';
    }
    if (mini) {
      mini.classList.toggle('invalid', !!message);
      mini.querySelector('.input-shell').classList.toggle('is-invalid', !!message);
      var error = mini.querySelector('.mini-error');
      if (error) error.textContent = message;
    }
    return message;
  }

  function handleAllocationUnitInput(input) {
    var index = Number(input.getAttribute('data-alloc-index'));
    var field = input.getAttribute('data-alloc-field');
    var unit = state.allocation.units[index];
    if (!unit) return;
    var value = parseNumberInput(input);
    var message = validateAllocationNumber(input, field, value);
    if (message) return;
    unit[field] = value;
    scheduleSave();
    schedule('allocation', renderAllocationResult, 300);
  }

  function handleAllocationInput(input) {
    var id = input.id;
    var value = parseNumberInput(input);
    var fieldMap = {
      targetR: 'targetRField',
      targetMtbf: 'targetMtbfField',
      missionTime: 'missionTimeField',
      allocUnitCount: 'allocUnitCountField'
    };
    var fieldId = fieldMap[id];
    if (value == null) {
      setFieldState(input, '请输入数值。');
      return;
    }

    if (id === 'targetR') {
      if (!isReliability(value)) {
        setFieldState(input, '目标可靠度需满足 0 < R ≤ 1。');
        return;
      }
      state.allocation.targetR = value;
      setFieldState(input, '');
    } else if (id === 'targetMtbf') {
      if (!isPositive(value)) {
        setFieldState(input, '目标 MTBF 需大于 0。');
        return;
      }
      state.allocation.targetMtbf = value;
      setFieldState(input, '');
    } else if (id === 'missionTime') {
      if (!isPositive(value)) {
        setFieldState(input, '任务时间需大于 0。');
        return;
      }
      state.allocation.missionTime = value;
      setFieldState(input, '');
    } else if (id === 'allocUnitCount') {
      if (!Number.isInteger(value) || value < 1 || value > 20) {
        setFieldState(input, '单元数量需为 1–20 的整数。');
        return;
      }
      state.allocation.n = value;
      syncAllocationUnits(state.allocation);
      renderAllocationUnitPanel();
      setFieldState(input, '');
      setText('allocationCount', String(value));
    }
    scheduleSave();
    schedule('allocation', renderAllocationResult, 300);
  }

  function recalcAllocation() {
    renderAllocationResult();
  }

  function setInputValueReadonly(id, value, formatter) {
    var input = $(id);
    if (!input) return;
    input.value = formatter ? formatter(value) : value;
  }

  /* =========================================================================
     Module 05 — Report, JSON import / export
     ========================================================================= */

  function chartImage(key) {
    if (!charts[key] || !hasChartLibrary()) return '';
    try {
      return charts[key].toBase64Image('image/png', 1);
    } catch (error) {
      return '';
    }
  }

  function reportKpi(label, value, brand) {
    return '<div class="report-kpi"><span>' + escapeHtml(label) + '</span><strong' +
      (brand ? ' class="brand"' : '') + '>' + escapeHtml(value) + '</strong></div>';
  }

  function reportSection(number, title, body) {
    return '<section class="report-section"><h3><span>' + number + '</span>' + escapeHtml(title) + '</h3>' +
      body + '</section>';
  }

  function reportTable(headers, rows) {
    return '<table class="report-table"><thead><tr>' +
      headers.map(function (header, index) {
        return '<th' + (index > 0 ? ' style="text-align:right;"' : '') + '>' + escapeHtml(header) + '</th>';
      }).join('') +
      '</tr></thead><tbody>' +
      rows.map(function (row) {
        return '<tr>' + row.map(function (cell, index) {
          return '<td' + (index > 0 ? ' class="num"' : '') + '>' + escapeHtml(cell) + '</td>';
        }).join('') + '</tr>';
      }).join('') +
      '</tbody></table>';
  }

  function buildReportHtml() {
    var rbd = computeRBD();
    var prediction = getPrediction();
    var allocation = computeAllocation();
    var now = new Date();
    var rbdImage = chartImage('rbd');
    var distImage = chartImage('dist');

    var rbdKpi = rbd.error ? '—' : formatR(rbd.systemR);
    var predictionMtbf = prediction && !prediction.error ? formatHour(prediction.mtbf) : '—';
    var allocationMtbf = allocation.error ? '—' : formatHour(allocation.targetMtbf);

    var html = '' +
      '<header class="report-header">' +
      '<div><div class="report-kicker">Reliability engineering summary</div>' +
      '<h2>可靠性工程初算摘要</h2>' +
      '<p>基于当前 RBD、MTBF 换算、可靠性预计与分配输入自动生成。</p></div>' +
      '<div class="report-meta"><strong>REPORT</strong>' +
      escapeHtml(formatDateTime(now)) + '<br>RELIABILITY WORKBENCH<br>SCHEMA V' + VERSION + '</div>' +
      '</header>' +
      '<div class="report-section"><div class="report-kpis">' +
      reportKpi('系统 R_sys', rbdKpi, true) +
      reportKpi('参考 MTBF', (function () {
        if (state.conversion.distribution === 'exp') {
          return formatHour(RC.mtbfFromLambda(Number(state.conversion.exp.lambda)));
        }
        return formatHour(RC.weibullMTBF(Number(state.conversion.weibull.beta), Number(state.conversion.weibull.eta)));
      })()) +
      reportKpi('预计 MTBF', predictionMtbf) +
      reportKpi('分配目标 MTBF', allocationMtbf) +
      '</div></div>';

    /* RBD */
    var rbdBody = '';
    if (rbd.error) {
      rbdBody = '<div class="report-callout">' + escapeHtml(rbd.error) + '</div>';
    } else {
      var structureLabel = STRUCTURE_META[state.rbd.structure].name;
      if (state.rbd.structure === 'bridge' && state.rbd.bridge.mode === 'mixed') {
        structureLabel = '混联表达式';
      }
      rbdBody += '<div class="report-kpis">' +
        reportKpi('结构', structureLabel) +
        reportKpi('单元数', String(rbd.unitCount)) +
        reportKpi('参考时间', formatHour(rbd.t0)) +
        reportKpi('R(1000h)', formatR(rbd.timeValues[2].reliability)) +
        '</div>';
      var rbdRows = [];
      if (state.rbd.structure === 'series' || state.rbd.structure === 'parallel') {
        var units = state.rbd.structure === 'series' ? state.rbd.series : state.rbd.parallel;
        units.forEach(function (unit, index) {
          rbdRows.push(['单元 ' + (index + 1), formatR(Number(unit.r))]);
        });
      } else if (state.rbd.structure === 'kn') {
        rbdRows.push(['单元可靠度 R', formatR(Number(state.rbd.kn.r))]);
        rbdRows.push(['表决阈值 k / n', state.rbd.kn.k + ' / ' + state.rbd.kn.n]);
      } else if (state.rbd.bridge.mode === 'classic') {
        state.rbd.bridge.rs.forEach(function (value, index) {
          rbdRows.push(['桥臂 R' + (index + 1), formatR(Number(value))]);
        });
      } else {
        RC.extractIdentifiers(state.rbd.bridge.mixed.expr).forEach(function (id) {
          rbdRows.push(['单元 ' + id, formatR(Number(state.rbd.bridge.mixed.values[id]))]);
        });
      }
      if (rbdRows.length) {
        rbdBody += '<div style="margin-top:10px;">' + reportTable(['输入项', '可靠度'], rbdRows) + '</div>';
      }
      rbdBody += '<div class="report-callout">R(100h) = ' + formatR(rbd.timeValues[0].reliability) +
        ' · R(500h) = ' + formatR(rbd.timeValues[1].reliability) +
        ' · R(1000h) = ' + formatR(rbd.timeValues[2].reliability) +
        '；时间换算采用指数等效 R(t) = R₀^(t/t₀)。</div>';
    }
    if (rbdImage || distImage) {
      rbdBody += '<div class="report-charts">' +
        (rbdImage ? '<div class="report-chart"><img src="' + rbdImage + '" alt="RBD 可靠度曲线"><span>RBD · R(t)</span></div>' : '') +
        (distImage ? '<div class="report-chart"><img src="' + distImage + '" alt="MTBF 可靠度曲线"><span>分布 · R(t)</span></div>' : '') +
        '</div>';
    }
    html += reportSection('01', '可靠性框图 RBD', rbdBody);

    /* Distribution */
    var distBody = '';
    if (state.conversion.distribution === 'exp') {
      var exp = state.conversion.exp;
      distBody = '<div class="report-kpis">' +
        reportKpi('分布', '指数分布') +
        reportKpi('R(t)', formatR(Number(exp.r))) +
        reportKpi('MTBF', formatHour(RC.mtbfFromLambda(Number(exp.lambda)))) +
        reportKpi('λ', formatSci(Number(exp.lambda), 4) + ' /h') +
        '</div>' +
        '<div class="report-callout">任务时间 t = ' + formatHour(Number(exp.t)) +
        '；R(t) = e^(−λt)，MTBF = 1/λ。N 个 9：' +
        formatNines(RC.ninesFromAvailability(Number(exp.r))) + '。</div>';
    } else {
      var weibull = state.conversion.weibull;
      var wR = RC.weibullReliability(Number(weibull.t), Number(weibull.beta), Number(weibull.eta));
      distBody = '<div class="report-kpis">' +
        reportKpi('分布', 'Weibull') +
        reportKpi('R(t)', formatR(wR)) +
        reportKpi('MTBF', formatHour(RC.weibullMTBF(Number(weibull.beta), Number(weibull.eta)))) +
        reportKpi('β / η', Number(weibull.beta) + ' / ' + formatHour(Number(weibull.eta))) +
        '</div>' +
        '<div class="report-callout">R(t) = exp[−(t/η)^β]，MTBF = ηΓ(1 + 1/β)；t = ' + formatHour(Number(weibull.t)) +
        '，N 个 9：' + formatNines(RC.ninesFromAvailability(wR)) + '。</div>';
    }
    html += reportSection('02', 'MTBF / 失效率 / 可靠度换算', distBody);

    /* Prediction */
    var predictionBody = '';
    if (!prediction) {
      predictionBody = '<div class="report-callout">尚未添加元器件，未生成预计结果。</div>';
    } else if (prediction.error) {
      predictionBody = '<div class="report-callout">' + escapeHtml(prediction.error) + '</div>';
    } else {
      predictionBody = '<div class="report-kpis">' +
        reportKpi('方法', prediction.label) +
        reportKpi('预计 MTBF', formatHour(prediction.mtbf), true) +
        reportKpi('失效率 λ', formatSci(prediction.lambda, 4) + ' /h') +
        reportKpi('合计 FIT', prediction.totalFIT.toFixed(3)) +
        '</div>';
      if (prediction.method === 'parts') {
        predictionBody += '<div style="margin-top:10px;">' + reportTable(
          ['类型', '数量', '质量等级', '环境类别', 'FIT'],
          prediction.rows.map(function (row) {
            return [row.type, String(row.qty), row.quality, row.environment, row.fit.toFixed(3)];
          })
        ) + '</div>';
        predictionBody += '<div class="report-callout">λ_sys = Σ nᵢλ_bᵢπ_Qᵢπ_Eᵢ。基础失效率与修正因子来自工具内可编辑工程经验表，需以正式标准或厂家数据复核。</div>';
      } else {
        predictionBody += '<div class="report-callout">参考产品 MTBF = ' + formatHour(state.prediction.similar.mtbf) +
          '；复杂度因子 = ' + state.prediction.similar.complexity + '；环境因子 = ' + state.prediction.similar.environment +
          '；MTBF_new = MTBF_ref / (C_c × C_e)。</div>';
      }
    }
    html += reportSection('03', '可靠性预计', predictionBody);

    /* Allocation */
    var allocationBody = '';
    if (allocation.error) {
      allocationBody = '<div class="report-callout">' + escapeHtml(allocation.error) + '</div>';
    } else {
      var methodLabel = state.allocation.method === 'equal' ? '等分配' :
        state.allocation.method === 'scoring' ? '评分分配' : 'AGREE 分配';
      allocationBody = '<div class="report-kpis">' +
        reportKpi('方法', methodLabel) +
        reportKpi('目标 R(t)', formatR(allocation.targetR), true) +
        reportKpi('目标 MTBF', formatHour(allocation.targetMtbf)) +
        reportKpi('系统 λ', formatSci(allocation.lambdaTotal, 4) + ' /h') +
        '</div>';
      allocationBody += '<div style="margin-top:10px;">' + reportTable(
        ['单元', 'λᵢ (/h)', 'Rᵢ', 'MTBFᵢ (h)', '能力对照'],
        allocation.result.items.map(function (item) {
          return [
            item.name,
            formatSci(item.lambda, 3),
            formatR(item.reliability),
            formatHourNumber(item.mtbf),
            allocation.comparison ? (item.over ? '高于当前预计能力' : '在预计能力内') : '未设置预计值'
          ];
        })
      ) + '</div>';
      if (allocation.comparison) {
        allocationBody += '<div class="report-callout">能力对照基准：模块 03 系统 MTBF ' +
          formatHour(allocation.comparison.wholeSystemMtbf) + ' 均分至 ' + allocation.result.items.length +
          ' 个单元；该对照为工程近似，不替代单元级预计。</div>';
      }
    }
    html += reportSection('04', '可靠性分配', allocationBody);

    html += '' +
      '<footer class="report-footer">' +
      '<div class="report-footer-row">' +
      '<strong>声明：本工具结果为工程初算，关键设计决策需由可靠性工程师复核。</strong>' +
      '<span>Reliability Workbench · ' + escapeHtml(formatDateTime(now)) + '</span>' +
      '</div>' +
      '<span class="print-page-note">报告中的系数与修正因子需按适用标准、产品环境与厂家数据复核。' +
      '本工具不替代正式可靠性设计评审。</span>' +
      '</footer>';

    return html;
  }

  function openReport() {
    var modal = $('reportOverlay');
    var content = $('reportContent');
    if (!modal || !content) return;
    content.innerHTML = buildReportHtml();
    modal.hidden = false;
    document.body.classList.add('modal-open');
    var closeButton = $('closeReportBtn');
    if (closeButton) closeButton.focus();
  }

  function closeReport() {
    var modal = $('reportOverlay');
    if (!modal) return;
    modal.hidden = true;
    document.body.classList.remove('modal-open');
  }

  function exportJSON() {
    var payload = {
      schema: SCHEMA,
      version: VERSION,
      exportedAt: new Date().toISOString(),
      data: state
    };
    var blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var link = document.createElement('a');
    link.href = url;
    link.download = 'reliability-workbench-' + fileStamp() + '.json';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1200);
    showToast('方案 JSON 已导出。');
  }

  function importJSONFile(file) {
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var parsed = JSON.parse(String(reader.result));
        var data = parsed && parsed.data ? parsed.data : parsed;
        if (!data || typeof data !== 'object' || !data.rbd || !data.conversion) {
          throw new Error('文件缺少必要的方案字段。');
        }
        state = normalizeState(data);
        persistState();
        resetAllInputsFromState();
        recalcAll(true);
        showToast('方案已导入并恢复。');
      } catch (error) {
        showToast('导入失败：' + error.message, true);
      }
      var input = $('importFile');
      if (input) input.value = '';
    };
    reader.onerror = function () {
      showToast('读取文件失败，请重试。', true);
    };
    reader.readAsText(file);
  }

  /* =========================================================================
     Theme
     ========================================================================= */

  function syncThemeIcon() {
    var dark = document.documentElement.getAttribute('data-theme') === 'dark';
    var sidebarLabel = document.querySelector('#themeToggleSidebar span');
    if (sidebarLabel) sidebarLabel.textContent = dark ? '浅色模式' : '深色模式';
    var topButton = $('themeToggleTop');
    if (topButton) {
      topButton.title = dark ? '切换到浅色模式' : '切换到深色模式';
      topButton.setAttribute('aria-label', topButton.title);
    }
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch (error) { /* ignore */ }
    syncThemeIcon();
    renderRBDResult();
    recalcConversion();
    recalcAllocation();
  }

  function toggleTheme() {
    var current = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
    applyTheme(current === 'dark' ? 'light' : 'dark');
  }

  /* =========================================================================
     State → controls, recalculation & events
     ========================================================================= */

  function resetAllInputsFromState() {
    var t0 = $('rbdT0');
    if (t0) t0.value = formatInputNumber(Number(state.rbd.t0), 10);
    $$('#rbdStructureChoices .choice-card').forEach(function (button) {
      var active = button.getAttribute('data-structure') === state.rbd.structure;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', active ? 'true' : 'false');
    });

    syncExpFields();
    var weibull = state.conversion.weibull;
    setInputValueReadonly('weibullBeta', formatInputNumber(weibull.beta, 9));
    setInputValueReadonly('weibullEta', formatInputNumber(weibull.eta, 9));
    setInputValueReadonly('weibullTime', formatInputNumber(weibull.t, 9));
    syncDistributionForms();

    renderPredictionMethod();
    renderPartRows();
    renderPredictionFactors();
    syncSimilarFields();

    var allocation = state.allocation;
    setInputValueReadonly('targetR', formatInputNumber(allocation.targetR, 9));
    setInputValueReadonly('targetMtbf', formatInputNumber(allocation.targetMtbf, 9));
    setInputValueReadonly('missionTime', formatInputNumber(allocation.missionTime, 9));
    setInputValueReadonly('allocUnitCount', allocation.n);
    syncTargetMode();
    renderAllocationMethodTabs();
    renderAllocationUnitPanel();

    renderRBDStructure();
    $$('.field.is-invalid').forEach(function (field) {
      field.classList.remove('is-invalid');
      var error = field.querySelector('.field-error');
      if (error) error.textContent = '';
    });
    $$('.factor-row input.invalid').forEach(function (input) {
      input.classList.remove('invalid');
    });
    $$('.part-row input.invalid').forEach(function (input) {
      input.classList.remove('invalid');
      input.style.borderColor = '';
      input.style.background = '';
    });
  }

  function recalcAll() {
    renderRBDResult();
    recalcConversion();
    renderPredictionResult();
    renderAllocationResult();
    syncThemeIcon();
  }

  function updateRBDInput(input) {
    var unitIndex = input.getAttribute('data-rbd-unit');
    if (unitIndex != null) {
      var kind = input.getAttribute('data-rbd-kind');
      var units = rbdUnitArray(kind);
      if (units && units[Number(unitIndex)]) {
        units[Number(unitIndex)].r = parseNumberInput(input);
      }
      validateReliabilityInput(input);
      scheduleSave();
      schedule('rbd', renderRBDResult, 300);
      return;
    }

    var bridgeIndex = input.getAttribute('data-bridge-unit');
    if (bridgeIndex != null) {
      state.rbd.bridge.rs[Number(bridgeIndex)] = parseNumberInput(input);
      validateReliabilityInput(input);
      scheduleSave();
      schedule('rbd', renderRBDResult, 300);
      return;
    }

    var knField = input.getAttribute('data-kn');
    if (knField) {
      var knValue = parseNumberInput(input);
      state.rbd.kn[knField] = knValue;
      if (knField === 'r') {
        validateReliabilityInput(input);
      } else if (knValue == null) {
        setFieldState(input, '请输入整数。');
      } else if (!Number.isInteger(knValue) || knValue < 1 || knValue > RC.MAX_UNITS) {
        setFieldState(input, '需为 1–20 的整数。');
      } else if (knField === 'k' && Number.isInteger(Number(state.rbd.kn.n)) &&
        knValue > Number(state.rbd.kn.n)) {
        setFieldState(input, 'k 不能大于 n。');
      } else {
        setFieldState(input, '');
      }
      scheduleSave();
      schedule('rbd', renderRBDResult, 300);
      return;
    }

    var mixedKey = input.getAttribute('data-mixed-key');
    if (mixedKey) {
      state.rbd.bridge.mixed.values[mixedKey] = parseNumberInput(input);
      validateReliabilityInput(input);
      scheduleSave();
      schedule('rbd', renderRBDResult, 300);
    }
  }

  function handleRBDStructureInput(event) {
    var input = event.target;
    if (!(input instanceof HTMLInputElement)) return;

    if (input.id === 'mixedExpr') {
      state.rbd.bridge.mixed.expr = input.value;
      var field = $('mixedExprField');
      var errorNode = $('mixedExprError');
      try {
        RC.extractIdentifiers(input.value);
        if (field) field.classList.remove('is-invalid');
        if (errorNode) errorNode.textContent = '';
        renderMixedValueFields();
        scheduleSave();
        schedule('rbd', renderRBDResult, 300);
      } catch (error) {
        if (field) field.classList.add('is-invalid');
        if (errorNode) errorNode.textContent = error.message;
        schedule('rbd', renderRBDResult, 300);
      }
      return;
    }
    updateRBDInput(input);
  }

  function handleRBDStructureClick(event) {
    var target = event.target.closest('button');
    if (!target) return;

    if (target.id === 'rbdAddUnit') {
      var units = state.rbd.structure === 'series' ? state.rbd.series : state.rbd.parallel;
      if (units.length >= RC.MAX_UNITS) {
        showToast('单元数量上限为 ' + RC.MAX_UNITS + ' 个。', true);
        return;
      }
      units.push(makeUnit('单元 ' + (units.length + 1), 0.9));
      renderRBDStructure();
      renderRBDResult();
      scheduleSave();
      return;
    }

    var removeIndex = target.getAttribute('data-remove-unit');
    if (removeIndex != null) {
      var kind = target.getAttribute('data-rbd-kind');
      var list = rbdUnitArray(kind);
      if (list && list.length > 1) {
        list.splice(Number(removeIndex), 1);
        renderRBDStructure();
        renderRBDResult();
        scheduleSave();
      }
      return;
    }

    var bridgeMode = target.getAttribute('data-bridge-mode');
    if (bridgeMode) {
      state.rbd.bridge.mode = bridgeMode;
      renderRBDStructure();
      renderRBDResult();
      scheduleSave();
      return;
    }

    var expression = target.getAttribute('data-expr');
    if (expression) {
      state.rbd.bridge.mixed.expr = expression;
      var expressionInput = $('mixedExpr');
      if (expressionInput) expressionInput.value = expression;
      renderMixedValueFields();
      renderRBDResult();
      scheduleSave();
    }
  }

  function handleRBDT0Input() {
    var input = $('rbdT0');
    var value = parseNumberInput(input);
    if (value == null) {
      setFieldState(input, '请输入参考时间。');
      return;
    }
    if (!isPositive(value)) {
      setFieldState(input, '参考时间需大于 0。');
      return;
    }
    setFieldState(input, '');
    state.rbd.t0 = value;
    scheduleSave();
    schedule('rbd', renderRBDResult, 300);
  }

  function bindRBD() {
    $$('#rbdStructureChoices .choice-card').forEach(function (button) {
      button.addEventListener('click', function () {
        setRBDStructure(button.getAttribute('data-structure'));
      });
    });
    var panel = $('rbdStructurePanel');
    if (panel) {
      panel.addEventListener('input', handleRBDStructureInput);
      panel.addEventListener('click', handleRBDStructureClick);
    }
    var t0 = $('rbdT0');
    if (t0) t0.addEventListener('input', handleRBDT0Input);
  }

  function bindConversion() {
    $$('#distributionTabs button').forEach(function (button) {
      button.addEventListener('click', function () {
        setDistribution(button.getAttribute('data-distribution'));
      });
    });
    var expFields = {
      expMtbf: 'mtbf',
      expLambda: 'lambda',
      expTime: 'time',
      expR: 'r'
    };
    Object.keys(expFields).forEach(function (id) {
      var input = $(id);
      if (input) {
        input.addEventListener('input', function () {
          handleExpInput(expFields[id]);
        });
      }
    });
    var weibullFields = {
      weibullBeta: 'beta',
      weibullEta: 'eta',
      weibullTime: 'time'
    };
    Object.keys(weibullFields).forEach(function (id) {
      var input = $(id);
      if (input) {
        input.addEventListener('input', function () {
          handleWeibullInput(weibullFields[id]);
        });
      }
    });
  }

  function bindPrediction() {
    $$('#predictionMethod button').forEach(function (button) {
      button.addEventListener('click', function () {
        setPredictionMethod(button.getAttribute('data-method'));
      });
    });

    var addPart = $('addPartBtn');
    if (addPart) {
      addPart.addEventListener('click', function () {
        var first = state.prediction.categories[0];
        state.prediction.parts.push({
          id: uid('p'),
          type: first ? first.id : 'other',
          qty: 1,
          quality: state.prediction.quality[0].id,
          environment: state.prediction.environment[0].id
        });
        renderPartRows();
        renderPredictionResult();
        scheduleSave();
      });
    }

    var partRows = $('partRows');
    if (partRows) {
      partRows.addEventListener('input', function (event) {
        var field = event.target.getAttribute('data-part-field');
        if (field) handlePartInput(event.target);
      });
      partRows.addEventListener('change', function (event) {
        if (event.target.tagName === 'SELECT') handlePartInput(event.target);
      });
      partRows.addEventListener('click', function (event) {
        var remove = event.target.closest('[data-remove-part]');
        if (!remove) return;
        var index = Number(remove.getAttribute('data-remove-part'));
        state.prediction.parts.splice(index, 1);
        renderPartRows();
        renderPredictionResult();
        scheduleSave();
      });
    }

    var factors = $('predictionFactors');
    if (factors) {
      factors.addEventListener('input', function (event) {
        if (event.target.getAttribute('data-factor-kind')) handleFactorInput(event.target);
      });
    }

    ['similarMtbf', 'similarComplexity', 'similarEnv'].forEach(function (id) {
      var input = $(id);
      if (input) {
        input.addEventListener('input', function () { handleSimilarInput(id); });
      }
    });
  }

  function bindAllocation() {
    $$('#targetModeTabs button').forEach(function (button) {
      button.addEventListener('click', function () {
        setTargetMode(button.getAttribute('data-target-mode'));
      });
    });
    $$('#allocationMethodTabs button').forEach(function (button) {
      button.addEventListener('click', function () {
        setAllocationMethod(button.getAttribute('data-method'));
      });
    });
    ['targetR', 'targetMtbf', 'missionTime', 'allocUnitCount'].forEach(function (id) {
      var input = $(id);
      if (input) {
        input.addEventListener('input', function () { handleAllocationInput(input); });
      }
    });
    var panel = $('allocationUnitPanel');
    if (panel) {
      panel.addEventListener('input', function (event) {
        if (event.target.getAttribute('data-alloc-field')) handleAllocationUnitInput(event.target);
      });
    }
  }

  function bindReportAndChrome() {
    var themeButtons = [$('themeToggleSidebar'), $('themeToggleTop')];
    themeButtons.forEach(function (button) {
      if (button) button.addEventListener('click', toggleTheme);
    });

    var reportButtons = [$('topReportBtn'), $('generateReportBtn')];
    reportButtons.forEach(function (button) {
      if (button) button.addEventListener('click', openReport);
    });

    var printCard = $('reportCardPrint');
    if (printCard) {
      printCard.addEventListener('click', function () {
        openReport();
        setTimeout(function () { window.print(); }, 120);
      });
    }

    var printButton = $('printReportBtn');
    if (printButton) printButton.addEventListener('click', function () { window.print(); });

    var closeButton = $('closeReportBtn');
    if (closeButton) closeButton.addEventListener('click', closeReport);

    var overlay = $('reportOverlay');
    if (overlay) {
      overlay.addEventListener('click', function (event) {
        if (event.target === overlay) closeReport();
      });
    }

    var exportButtons = [$('topExportBtn'), $('exportJsonBtn'), $('reportCardExport')];
    exportButtons.forEach(function (button) {
      if (button) button.addEventListener('click', exportJSON);
    });

    var importButtons = [$('importJsonBtn'), $('reportCardImport')];
    importButtons.forEach(function (button) {
      if (button) {
        button.addEventListener('click', function () {
          var fileInput = $('importFile');
          if (fileInput) fileInput.click();
        });
      }
    });

    var fileInput = $('importFile');
    if (fileInput) {
      fileInput.addEventListener('change', function () {
        if (fileInput.files && fileInput.files[0]) importJSONFile(fileInput.files[0]);
      });
    }

    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') closeReport();
    });

    window.addEventListener('beforeprint', function () {
      if ($('reportOverlay').hidden) openReport();
    });

    var sections = $$('.module-card');
    var navItems = $$('#moduleNav .nav-item');
    var scrollScheduled = false;
    function updateActiveNav() {
      scrollScheduled = false;
      var marker = window.scrollY + 150;
      var current = sections.length ? sections[0].id : '';
      sections.forEach(function (section) {
        if (section.offsetTop <= marker) current = section.id;
      });
      navItems.forEach(function (item) {
        item.classList.toggle('active', item.getAttribute('data-target') === current);
      });
    }
    window.addEventListener('scroll', function () {
      if (!scrollScheduled) {
        scrollScheduled = true;
        window.requestAnimationFrame(updateActiveNav);
      }
    }, { passive: true });
    navItems.forEach(function (item) {
      item.addEventListener('click', function () {
        navItems.forEach(function (other) { other.classList.remove('active'); });
        item.classList.add('active');
      });
    });
    updateActiveNav();

    window.addEventListener('beforeunload', persistState);

    var saved = state.updatedAt ? new Date(state.updatedAt) : null;
    if (saved && Number.isFinite(saved.getTime())) {
      setText('saveStatusText', '已恢复本地方案');
    }
  }

  function init() {
    if (!RC) return;
    if (hasChartLibrary()) {
      window.Chart.defaults.font.family = cssVar('--sans');
      window.Chart.defaults.color = cssVar('--text-3');
    }
    bindRBD();
    bindConversion();
    bindPrediction();
    bindAllocation();
    bindReportAndChrome();
    resetAllInputsFromState();
    recalcAll();
    syncThemeIcon();
    setTimeout(function () {
      persistState();
    }, 500);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

