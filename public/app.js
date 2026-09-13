/* ═══════════════════════════════════════════════════════════
   BDFP · CEO DAILY SNAPSHOT & EXECUTIVE ANALYTICS
   Frontend Controller (app.js)
   ═══════════════════════════════════════════════════════════ */

'use strict';

function getYesterdayDateStr() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

let currentDate = getYesterdayDateStr();

const PALETTE = [
  '#2563eb', '#059669', '#d97706', '#7c3aed', 
  '#0891b2', '#db2777', '#ea580c', '#475569',
  '#0d9488', '#4f46e5'
];

const CAT_ICONS = ['🥛', '🧈', '🥛', '🍫', '🥭', '☕', '🍓', '🍦', '🍶', '📦'];

// ── INITIALIZATION ───────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  initDatePicker();
  loadSnapshot(currentDate);
});

function initDatePicker() {
  const dateInput = document.getElementById('reportDatePicker');
  if (dateInput) {
    dateInput.value = currentDate;
    dateInput.max = getYesterdayDateStr();
    dateInput.addEventListener('change', (e) => {
      currentDate = e.target.value;
      refreshDashboard();
    });
  }
}

async function refreshDashboard() {
  const btn = document.getElementById('btnRefresh');
  if (btn) btn.classList.add('spinning');
  
  try {
    await loadSnapshot(currentDate);
  } catch (e) {
    console.error('Refresh failed:', e);
  } finally {
    if (btn) btn.classList.remove('spinning');
  }
}

// ── LOAD & RENDER CEO SNAPSHOT ────────────────────────────────────────
async function loadSnapshot(date) {
  try {
    const res = await fetch(`/api/snapshot?date=${date}`);
    if (!res.ok) throw new Error(`Snapshot error HTTP ${res.status}`);
    const data = await res.json();

    // Update Date & Sync Labels
    const dateLabel = document.getElementById('snapshotDateLabel');
    if (dateLabel) {
      const dObj = new Date(data.date + 'T00:00:00');
      dateLabel.textContent = dObj.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }).toUpperCase();
    }
    const syncLabel = document.getElementById('lastSyncLabel');
    if (syncLabel) {
      const timeStr = new Date(data.generatedAt || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      syncLabel.textContent = `Updated at ${timeStr}`;
    }

    // Render 5 KPI Cards
    renderKpiCards(data.kpis);

    // Render Zone-Wise Performance Table
    renderZoneTable(data.zones || []);

    // Render Category × Zone Matrix (Top 10)
    renderCategoryChart(data.categories || [], data.zone_columns || []);
  } catch (err) {
    console.error('Failed to load CEO Snapshot:', err);
  }
}

function renderKpiCards(kpis) {
  if (!kpis) return;

  // ① Total Outlet
  if (kpis.total_outlet) {
    const el = document.getElementById('kpiOutletVal');
    if (el) el.textContent = kpis.total_outlet.value || '0';
    const sub = document.getElementById('kpiOutletSub');
    if (sub) sub.textContent = `New: ${kpis.total_outlet.new_last_7_days}`;
  }

  // ② Total Sales Representative (Active: Day In Done | Inactive: No Day In)
  if (kpis.total_sales_rep) {
    const el = document.getElementById('kpiSrVal');
    if (el) el.textContent = kpis.total_sales_rep.value || '0';
    const act = document.getElementById('kpiSrActive');
    if (act) act.textContent = `Checked in: ${kpis.total_sales_rep.active}`;
    const inact = document.getElementById('kpiSrInactive');
    if (inact) inact.textContent = `Not Checked in: ${kpis.total_sales_rep.inactive}`;
  }

  // ③ Total Visited Outlet
  if (kpis.total_visit) {
    const el = document.getElementById('kpiVisitVal');
    if (el) el.textContent = kpis.total_visit.value || '0';
    const sub = document.getElementById('kpiVisitSub');
    const uVal = kpis.total_visit.unique_visited || kpis.total_visit.value || '0';
    if (sub) sub.textContent = kpis.total_visit.unique_label || `Unique Out. Visit: ${uVal}`;
  }

  // ④ Order Amount
  if (kpis.order_amount) {
    const el = document.getElementById('kpiOrderVal');
    if (el) el.textContent = kpis.order_amount.value || '৳0';
    const sub = document.getElementById('kpiOrderSub');
    if (sub) sub.textContent = kpis.order_amount.volume_label || `Total number of MEMO: ${kpis.order_amount.volume}`;
  }

  // ⑤ Strike Rate
  if (kpis.eco) {
    const el = document.getElementById('kpiEcoVal');
    if (el) el.textContent = kpis.eco.value || '0.0%';
    const sub = document.getElementById('kpiEcoSub');
    const count = kpis.order_amount?.volume || '0';
    if (sub) sub.textContent = kpis.eco.target_label || `Productive Outlet: ${count}`;
  }
}

// ── RENDER ZONE-WISE PERFORMANCE TABLE ───────────────────────────────
function renderZoneTable(zones) {
  const tbody = document.getElementById('zoneTableBody');
  const tfoot = document.getElementById('zoneTableFoot');
  if (!tbody) return;

  if (!zones || zones.length === 0) {
    tbody.innerHTML = '<tr class="table-placeholder"><td colspan="5">No zone records found.</td></tr>';
    if (tfoot) tfoot.innerHTML = '';
    return;
  }

  const sorted = [...zones].sort((a, b) => (b.total_visit || 0) - (a.total_visit || 0));

  function fmtTk(v) {
    if (!v || v === 0) return '৳0';
    if (v >= 1000000) return `৳${(v / 1000000).toFixed(2)}M`;
    if (v >= 1000)    return `৳${(v / 1000).toFixed(0)}K`;
    return `৳${Math.round(v).toLocaleString()}`;
  }

  tbody.innerHTML = sorted.map(z => {
    const ecoNum = parseFloat(z.eco) || 0;
    const ecoClass = ecoNum >= 70 ? 'eco-good' : (ecoNum >= 50 ? 'eco-mid' : 'eco-low');
    const amt = z.total_amount || 0;

    return `
      <tr>
        <td>
          <div class="zone-tag">
            <span class="zone-dot"></span>
            <span>${escapeHtml(z.zone)}</span>
          </div>
        </td>
        <td class="td-num">${(z.total_visit || 0).toLocaleString()}</td>
        <td class="td-num" style="font-weight:700;" title="৳${Math.round(amt).toLocaleString()}">${fmtTk(amt)}</td>
        <td class="td-num">
          <span class="eco-pill ${ecoClass}">${z.eco}</span>
        </td>
        <td class="td-num">${z.avg_lpc || '0.0'}</td>
      </tr>
    `;
  }).join('');

  // Calculate & Render Totals Row at the bottom
  if (tfoot) {
    let totVisits = 0;
    let totOrders = 0;
    let totAmt = 0;
    let weightedLpcSum = 0;

    sorted.forEach(z => {
      const v = z.total_visit || 0;
      const ord = z.total_order || 0;
      const amt = z.total_amount || 0;
      const lpc = parseFloat(z.avg_lpc) || 0;

      totVisits += v;
      totOrders += ord;
      totAmt += amt;
      weightedLpcSum += (lpc * ord);
    });

    const totEco = totVisits > 0 ? ((totOrders / totVisits) * 100).toFixed(1) + '%' : '0.0%';
    const totAvgLpc = totOrders > 0 ? (weightedLpcSum / totOrders).toFixed(1) : '0.0';

    tfoot.innerHTML = `
      <tr class="zone-total-row">
        <td>
          <div class="zone-tag" style="font-weight:800; color:var(--brand-dark);">
            <span class="zone-dot" style="background:var(--brand-dark);"></span>
            <span>TOTAL</span>
          </div>
        </td>
        <td class="td-num" style="font-weight:800;">${totVisits.toLocaleString()}</td>
        <td class="td-num" style="font-weight:800; color:var(--brand-dark);" title="৳${Math.round(totAmt).toLocaleString()}">${fmtTk(totAmt)}</td>
        <td class="td-num">
          <span class="eco-pill eco-good" style="font-weight:800;">${totEco}</span>
        </td>
        <td class="td-num" style="font-weight:800;">${totAvgLpc}</td>
      </tr>
    `;
  }
}

// ── RENDER CATEGORY × ZONE MATRIX ────────────────────────────────────────
function renderCategoryChart(categories, zoneColumns) {
  const tbody = document.getElementById('categoryTableBody');
  const headerRow = document.getElementById('matrixHeaderRow');
  if (!tbody) return;

  const zones = zoneColumns && zoneColumns.length > 0
    ? zoneColumns
    : [
        'NCCP(Khulna)', 'NCCP(Bogura Region)', 'NCCP(Sylhet)',
        'NCCP (cumilla)', 'NCCP(CHITTAGANG)', 'NCCP(Dhaka-2)', 'NCCP(Dhaka Metro)'
      ];

  if (!categories || categories.length === 0) {
    tbody.innerHTML = `<tr class="table-placeholder"><td colspan="${4 + zones.length}">No category data recorded.</td></tr>`;
    return;
  }

  const zoneShort = z => z.replace('NCCP', '').replace('(', '').replace(')', '').replace(' Region', '').trim();

  if (headerRow) {
    const existingZoneThs = headerRow.querySelectorAll('.th-mat-zone, .th-mat-num');
    existingZoneThs.forEach(th => th.remove());
    // Zone columns first
    zones.forEach(z => {
      const th = document.createElement('th');
      th.className = 'th-mat-zone';
      th.title = z;
      th.textContent = zoneShort(z);
      headerRow.appendChild(th);
    });
    // Then Total Carton, Total & Share at the end
    [{label: 'Total Carton', cls: 'th-mat-num th-mat-ctn'}, {label: 'Total', cls: 'th-mat-num'}, {label: 'Share', cls: 'th-mat-num'}].forEach(({label, cls}) => {
      const th = document.createElement('th');
      th.className = cls;
      th.textContent = label;
      headerRow.appendChild(th);
    });
  }

  function fmtAmt(v) {
    if (!v || v === 0) return '—';
    if (v >= 1000000) return `৳${(v / 1000000).toFixed(2)}M`;
    if (v >= 1000)    return `৳${(v / 1000).toFixed(0)}K`;
    return `৳${Math.round(v).toLocaleString()}`;
  }

  const sorted = [...categories]
    .filter(c => String(c.category || '').trim().toLowerCase() !== 'free')
    .sort((a, b) => (b.amount || 0) - (a.amount || 0))
    .slice(0, 10); // Show top 10 categories

  // Find max zone amount per zone for heatmap intensity
  const zoneMaxes = {};
  zones.forEach(z => {
    zoneMaxes[z] = Math.max(...sorted.map(c => (c.zones && c.zones[z]) || 0), 1);
  });

  tbody.innerHTML = sorted.map((cat, i) => {
    const color = PALETTE[i % PALETTE.length];
    const pct = cat.percentage || 0;
    const zoneCells = zones.map(z => {
      const val = (cat.zones && cat.zones[z]) || 0;
      const intensity = val > 0 ? Math.max(0.07, (val / zoneMaxes[z]) * 0.38) : 0;
      const bg = val > 0 ? `rgba(${hexToRgb(color)}, ${intensity.toFixed(2)})` : 'transparent';
      return `<td class="td-mat-zone" style="background:${bg}" title="${z}: ${fmtAmt(val)}">${fmtAmt(val)}</td>`;
    }).join('');

    const ctnVal = cat.total_carton != null ? Math.round(cat.total_carton).toLocaleString() : '—';
    return `
      <tr>
        <td class="td-mat-rank">${i + 1}</td>
        <td class="td-mat-name">
          <span class="cat-dot" style="background:${color}"></span>
          ${escapeHtml(cat.category)}
        </td>
        ${zoneCells}
        <td class="td-mat-ctn">${ctnVal}</td>
        <td class="td-mat-total">${fmtAmt(cat.amount)}</td>
        <td class="td-mat-pct"><span style="color:${color};font-weight:800">${pct}%</span></td>
      </tr>
    `;
  }).join('');

  // Matrix Total Row
  const tfoot = document.getElementById('categoryTableFoot');
  if (tfoot) {
    let grandTotal = 0;
    let grandCarton = 0;
    const zoneTotals = {};
    zones.forEach(z => { zoneTotals[z] = 0; });

    sorted.forEach(cat => {
      grandTotal += (cat.amount || 0);
      grandCarton += (cat.total_carton || 0);
      zones.forEach(z => {
        zoneTotals[z] += ((cat.zones && cat.zones[z]) || 0);
      });
    });

    const zoneTotalCells = zones.map(z => {
      return `<td class="td-mat-zone" style="font-weight:800; color:var(--text-primary);" title="${z} Total">${fmtAmt(zoneTotals[z])}</td>`;
    }).join('');

    tfoot.innerHTML = `
      <tr class="zone-total-row">
        <td class="td-mat-rank" style="font-weight:800;">∑</td>
        <td class="td-mat-name" style="font-weight:800; color:var(--brand-dark);">TOTAL</td>
        ${zoneTotalCells}
        <td class="td-mat-ctn" style="font-weight:800; color:var(--brand-dark);">${Math.round(grandCarton).toLocaleString()}</td>
        <td class="td-mat-total" style="color:var(--brand-dark); font-weight:800;">${fmtAmt(grandTotal)}</td>
        <td class="td-mat-pct"><span style="color:var(--brand-dark); font-weight:800;">100%</span></td>
      </tr>
    `;
  }
}

function hexToRgb(hex) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `${r}, ${g}, ${b}`;
}



function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
