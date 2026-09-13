require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const path = require('path');
const XLSX = require('xlsx');
const fs = require('fs');

const { initScheduler, delay } = require('./scheduler');
const { sendDailyReportEmail, buildHtmlEmail } = require('./emailService');

const app = express();
app.use(cors());
app.use(express.json());

const BASE_URL = process.env.BDFP_API_BASE_URL || process.env.RAHUL_API_BASE_URL || 'https://bdfp.core.sokrio.com';
let cachedToken = process.env.BDFP_API_TOKEN || process.env.RAHUL_API_TOKEN || '77559|iWTaKrrtG60ZGbLMRRbrvkL1hhPwVCwXV3PEQlZe';
let tokenExpiry = cachedToken ? Date.now() + 1000 * 60 * 60 * 24 * 365 : null;

// ─── Auth / Token Management ───────────────────────────────────────────────
async function getToken() {
  if (cachedToken && tokenExpiry && Date.now() < tokenExpiry) {
    return cachedToken;
  }
  try {
    const res = await axios.post(`${BASE_URL}/api/v1/login`, {
      email: process.env.BDFP_LOGIN_EMAIL || process.env.RAHUL_LOGIN_EMAIL || 'admin@bdfp.com',
      password: process.env.BDFP_LOGIN_PASSWORD || process.env.RAHUL_LOGIN_PASSWORD || 'bdfp@password',
    });
    cachedToken = res.data?.data?.token || res.data?.token;
    tokenExpiry = Date.now() + 55 * 60 * 1000;
    return cachedToken;
  } catch (err) {
    console.error('Login failed:', err.message);
    return process.env.BDFP_API_TOKEN || cachedToken;
  }
}

async function apiGet(url, params = {}, isExcel = false) {
  const token = await getToken();
  try {
    const res = await axios.get(url, {
      params,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: isExcel ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'application/json',
      },
      responseType: isExcel ? 'arraybuffer' : 'json',
      timeout: 180000,
    });
    return res.data;
  } catch (err) {
    if (err.response?.status === 401) {
      tokenExpiry = null;
      cachedToken = null;
      const newToken = await getToken();
      const retry = await axios.get(url, {
        params,
        headers: { 
          Authorization: `Bearer ${newToken}`, 
          Accept: isExcel ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'application/json' 
        },
        responseType: isExcel ? 'arraybuffer' : 'json',
        timeout: 180000,
      });
      return retry.data;
    }
    throw err;
  }
}

// ─── In-Memory Cache ───────────────────────────────────────────────────────
const cache = {};
function fromCache(key, expiryMs = 15 * 60 * 1000) {
  const entry = cache[key];
  if (entry && Date.now() - entry.ts < expiryMs) return entry.data;
  return null;
}
function toCache(key, data) {
  cache[key] = { data, ts: Date.now() };
}

// ─── Disk Snapshot Cache ───────────────────────────────────────────────────
function getSnapshotCachePath(date) {
  return process.env.VERCEL 
    ? path.join('/tmp', `bdfp_snapshot_${date}.json`)
    : path.join(__dirname, `bdfp_snapshot_${date}.json`);
}

function fromSnapshotCache(date) {
  const cachePath = getSnapshotCachePath(date);
  if (fs.existsSync(cachePath)) {
    try {
      const stats = fs.statSync(cachePath);
      // Valid for 60 minutes
      if (Date.now() - stats.mtimeMs < 60 * 60 * 1000) {
        return JSON.parse(fs.readFileSync(cachePath, 'utf8'));
      }
    } catch (e) { console.error('Snapshot cache read error:', e.message); }
  }
  return null;
}

function toSnapshotCache(date, data) {
  try {
    fs.writeFileSync(getSnapshotCachePath(date), JSON.stringify(data));
  } catch (e) { console.error('Snapshot cache write error:', e.message); }
}

// ─── Target Zones Definition (7 NCCP Zones for BDFP) ──────────────────────
const targetOrder = [
  'NCCP(Khulna)',
  'NCCP(Bogura Region)',
  'NCCP(Sylhet)',
  'NCCP (cumilla)',
  'NCCP(CHITTAGANG)',
  'NCCP(Dhaka-2)',
  'NCCP(Dhaka Metro)'
];

const zoneIds = {
  'NCCP(Khulna)': 461,
  'NCCP(Bogura Region)': 460,
  'NCCP(Sylhet)': 459,
  'NCCP (cumilla)': 458,
  'NCCP(CHITTAGANG)': 457,
  'NCCP(Dhaka-2)': 456,
  'NCCP(Dhaka Metro)': 3
};

// ─── Territories Helper ───────────────────────────────────────────────────
let lastKnownTerritories = [];

async function getTerritories() {
  const ONE_DAY = 24 * 60 * 60 * 1000;
  const cached = fromCache('territories', ONE_DAY);
  if (cached && cached.length > 0) {
    lastKnownTerritories = cached;
    return cached;
  }

  const possiblePaths = [
    path.join(__dirname, 'territories_cache.json'),
    path.join(__dirname, '..', 'territories_cache.json'),
    path.join('/tmp', 'territories_cache.json')
  ];

  for (const cachePath of possiblePaths) {
    if (fs.existsSync(cachePath)) {
      try {
        const diskData = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
        if (diskData && diskData.length > 0) {
          lastKnownTerritories = diskData;
          toCache('territories', diskData);
          return diskData;
        }
      } catch (e) {}
    }
  }

  try {
    const data = await apiGet(`${BASE_URL}/api/v1/territories-bulk-download`);
    const rows = Array.isArray(data) ? data : (data?.territories || data?.data || []);

    const territories = rows.map((r) => {
      const h = r.ancestors_and_self || [];
      return {
        id: String(r.id),
        code: String(r.code || ''),
        point_name: r.name || '-',
        ancestors_and_self: h,
        territory: (h.find(a => a.name.toLowerCase().includes('territory')) || h[1] || h[0])?.name || '-',
        region: (h.find(a => a.name.toLowerCase().includes('region')) || h[2])?.name || '-',
        zone: (h.find(a => a.name.toLowerCase().includes('zone')) || h[3])?.name || '-',
        division: (h.find(a => a.name.toLowerCase().includes('division')) || h[4])?.name || '-',
      };
    }).filter(t => t.id && t.id !== 'undefined');

    if (territories.length > 0) {
      toCache('territories', territories);
      lastKnownTerritories = territories;
      try {
        fs.writeFileSync(path.join(__dirname, 'territories_cache.json'), JSON.stringify(territories));
      } catch (e) {}
      return territories;
    }
  } catch (err) {
    console.error('getTerritories API error:', err.message);
  }

  return lastKnownTerritories;
}

// ─── Helpers: Zone Normalization & Date Calculation ─────────────────────────
function resolveZone(t) {
  if (!t) return 'Others';
  const ancestors = t.ancestors_and_self || [];
  for (const a of ancestors) {
    const aName = (a.name || '').trim().toLowerCase();
    for (const target of targetOrder) {
      if (aName === target.toLowerCase().trim()) return target;
    }
  }
  const allStr = (ancestors.map(a => a.name).join(' ') + ' ' + (t.name || '') + ' ' + (t.point_name || '') + ' ' + (t.territory || '') + ' ' + (t.region || '') + ' ' + (t.zone || '') + ' ' + (t.division || '')).toLowerCase();
  if (allStr.includes('khulna')) return 'NCCP(Khulna)';
  if (allStr.includes('bogura') || allStr.includes('bogra')) return 'NCCP(Bogura Region)';
  if (allStr.includes('sylhet')) return 'NCCP(Sylhet)';
  if (allStr.includes('cumilla') || allStr.includes('comilla')) return 'NCCP (cumilla)';
  if (allStr.includes('chittagong') || allStr.includes('chittagang') || allStr.includes('ctg')) return 'NCCP(CHITTAGANG)';
  if (allStr.includes('dhaka-2') || allStr.includes('dhaka 2')) return 'NCCP(Dhaka-2)';
  if (allStr.includes('dhaka metro') || allStr.includes('dhaka-metro')) return 'NCCP(Dhaka Metro)';
  return 'Others';
}

function getYesterdayDateStr() {
  const d = new Date();
  d.setMinutes(d.getMinutes() + d.getTimezoneOffset() + 360); // UTC+6 BD time
  d.setDate(d.getDate() - 1);
  return d.toISOString().split('T')[0];
}

function getSevenDaysAgoDateStr(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() - 7);
  return d.toISOString().split('T')[0];
}

function findHeaderRow(rows, searchTerms) {
  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    const row = rows[i];
    if (!Array.isArray(row)) continue;
    const found = searchTerms.every(term => 
      row.some(cell => String(cell || '').toLowerCase().includes(term.toLowerCase()))
    );
    if (found) return i;
  }
  return -1;
}

function extractRows(data) {
  if (!data) return [];
  if (Array.isArray(data)) return data;
  if (Array.isArray(data.data)) return data.data;
  if (Array.isArray(data.rows)) return data.rows;
  if (Array.isArray(data.users)) return data.users;
  if (typeof data === 'object' && data.data && Array.isArray(data.data.data)) return data.data.data;
  return [];
}

// ─── OFFICIAL SOKRIO DATA GENERATOR ───────────────────────────────────────
async function generateSnapshot(date, forceFresh = false) {
  if (!forceFresh) {
    const cached = fromSnapshotCache(date);
    if (cached && cached.kpis && cached.zones && cached.zones[0]?.total_amount !== undefined) {
      return cached;
    }
  }

  const sevenDaysAgoDate = getSevenDaysAgoDateStr(date);
  console.log(`\n⏳ [Data Fetcher] Loading official BDFP daily reports & analytics for ${date}...`);

  // Step 1: Territories (Instant from cache)
  const territories = await getTerritories();
  const tMap = {};
  territories.forEach(t => {
    if (t.id) tMap[String(t.id)] = t;
    if (t.code) tMap[String(t.code)] = t;
    if (t.point_name) tMap[t.point_name.toLowerCase()] = t;
    if (t.territory) tMap[t.territory.toLowerCase()] = t;
  });

  // Step 2: Concurrently fetch Official Sokrio endpoints (checkin visits, orders, amount, attendance, order export)
  console.log('   Fetching official Sokrio BDFP analytics endpoints concurrently...');

  const zoneOfficialPromises = targetOrder.map(async name => {
    const pId = zoneIds[name];
    try {
      const [visRes, ordRes, amtRes] = await Promise.allSettled([
        apiGet(`${BASE_URL}/api/v1/daily-reports?range=${date},${date}&territory_id=${pId}&parent_id=${pId}&initial=true&only=outletsVisited&is_report=1`),
        apiGet(`${BASE_URL}/api/v1/daily-reports?range=${date},${date}&territory_id=${pId}&parent_id=${pId}&initial=true&only=orderCreated&is_report=1`),
        apiGet(`${BASE_URL}/api/v1/daily-reports?range=${date},${date}&territory_id=${pId}&parent_id=${pId}&initial=true&only=orderAmount&is_report=1`)
      ]);
      const v = parseInt(visRes.status === 'fulfilled' ? visRes.value?.dailyReports?.outletsVisited?.[0]?.value : 0, 10) || 0;
      const ord = parseInt(ordRes.status === 'fulfilled' ? ordRes.value?.dailyReports?.orderCreated?.[0]?.value : 0, 10) || 0;
      const amt = parseFloat(amtRes.status === 'fulfilled' ? amtRes.value?.dailyReports?.orderAmount?.[0]?.value : 0) || 0;
      return [name, { visit: v, orders: ord, amount: amt }];
    } catch (e) {
      return [name, { visit: 0, orders: 0, amount: 0 }];
    }
  });

  const [
    natCheckinRes,
    natDailyRes,
    zoneOfficialEntries,
    orderRes,
    outlet7dRes,
    deptRes,
    uRes
  ] = await Promise.allSettled([
    apiGet(`${BASE_URL}/api/v1/checkin-report?range=${date},${date}&per_page=1`),
    (async () => {
      try {
        const [visRes, ordRes, amtRes, dsrRes] = await Promise.allSettled([
          apiGet(`${BASE_URL}/api/v1/daily-reports?range=${date},${date}&parent_id=1&initial=true&only=outletsVisited&is_report=1`),
          apiGet(`${BASE_URL}/api/v1/daily-reports?range=${date},${date}&parent_id=1&initial=true&only=orderCreated&is_report=1`),
          apiGet(`${BASE_URL}/api/v1/daily-reports?range=${date},${date}&parent_id=1&initial=true&only=orderAmount&is_report=1`),
          apiGet(`${BASE_URL}/api/v1/daily-reports?range=${date},${date}&parent_id=1&initial=true&only=checkInDsrCount&is_report=1`)
        ]);
        return {
          outletsVisited: visRes.status === 'fulfilled' ? visRes.value?.dailyReports?.outletsVisited : [],
          orderCreated: ordRes.status === 'fulfilled' ? ordRes.value?.dailyReports?.orderCreated : [],
          orderAmount: amtRes.status === 'fulfilled' ? amtRes.value?.dailyReports?.orderAmount : [],
          checkInDsrCount: dsrRes.status === 'fulfilled' ? dsrRes.value?.dailyReports?.checkInDsrCount : []
        };
      } catch (e) {
        return {};
      }
    })(),
    Promise.all(zoneOfficialPromises),
    apiGet(`${BASE_URL}/api/v3/order-summary-export?range=${date},${date}&territory_id=1&download&type=xlsx`, {}, true),
    apiGet(`${BASE_URL}/api/v3/export-outlet-report?range=${sevenDaysAgoDate},${date}&ut=2&download`, {}, true),
    apiGet(`${BASE_URL}/api/v1/departments?page=1&per_page=1&status=active&ut=2`),
    (async () => {
      const cachedUsers = fromCache('users', 24 * 60 * 60 * 1000);
      if (cachedUsers) return cachedUsers;
      try {
        const d = await apiGet(`${BASE_URL}/api/v1/user-bulk-download`);
        const rows = extractRows(d);
        const users = rows.filter(r => r.active === 1 || r.status === 'Active')
          .map(r => {
            const roleName = r.roles?.[0]?.name || r.roles?.[0]?.label || r.designation || '';
            return {
              id: r.employee_id || r.sr_code || r.code || r.id,
              code: r.code || r.sr_code || r.employee_id,
              name: r.name || r.full_name || '',
              designation: roleName,
              territory_id: r.territory?.id || r.territory_id,
              territory_name: r.territory?.name || r.territory_name || '',
              point_id: r.point_id
            };
          })
          .filter(u => {
            const d = String(u.designation || '').toLowerCase();
            return d.includes('sales representative') || d === 'sr' || d.includes('dsr') || d === 'rsm' || d.includes('regional sales manager');
          });
        toCache('users', users);
        return users;
      } catch (e) {
        return [];
      }
    })()
  ]);

  const natCheckinData = natCheckinRes.status === 'fulfilled' ? natCheckinRes.value : {};
  const natDailyData = natDailyRes.status === 'fulfilled' ? natDailyRes.value : {};
  const zoneOfficialMetrics = Object.fromEntries(zoneOfficialEntries.status === 'fulfilled' ? zoneOfficialEntries.value : []);
  const orderBuffer = orderRes.status === 'fulfilled' ? orderRes.value : null;
  const outlet7dBuffer = outlet7dRes.status === 'fulfilled' ? outlet7dRes.value : null;
  const users = uRes.status === 'fulfilled' ? uRes.value : [];
  const deptData = deptRes.status === 'fulfilled' ? deptRes.value : null;

  // Outlets
  let newOutlets7d = 0;
  if (outlet7dBuffer) {
    try {
      const wb = XLSX.read(outlet7dBuffer, { type: 'buffer' });
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 });
      if (rows.length > 1) newOutlets7d = rows.length - 1;
    } catch (e) { console.error('Outlet parse error:', e.message); }
  }
  const totalOutlets = deptData?.total || 115347;

  // National Official Numbers
  const totalSRCount = users.length || 284;
  const activeSRCount = parseInt(natDailyData.checkInDsrCount?.[0]?.value || 0, 10);
  const inactiveSRCount = Math.max(0, totalSRCount - activeSRCount);

  // Official Outlets Visited from daily-reports (or fallback to checkin-report total)
  let totalVisits = parseInt(natDailyData.outletsVisited?.[0]?.value || 0, 10) || natCheckinData?.total || 0;
  let totalRawCheckins = natCheckinData?.total || totalVisits;
  let totalOrderAmount = parseFloat(natDailyData.orderAmount?.[0]?.value || 0);
  let totalOrders = parseInt(natDailyData.orderCreated?.[0]?.value || 0, 10);

  // Parse Order Export for Zone Amounts, Zone Order Counts, Zone SKU Lines (for LPC), and Category Matrix
  const categoryMap = {};
  const zoneOrdersMap = {};
  const zoneAmountsMap = {};
  const zoneLinesMap = {};
  targetOrder.forEach(z => {
    zoneOrdersMap[z] = new Set();
    zoneAmountsMap[z] = 0;
    zoneLinesMap[z] = 0;
  });

  let exportTotalAmount = 0;
  const exportTotalOrders = new Set();

  if (orderBuffer) {
    try {
      const wb = XLSX.read(orderBuffer, { type: 'buffer' });
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 });
      const hIdx = findHeaderRow(rows, ['Employee Code', 'Tracking ID']);
      if (hIdx !== -1) {
        const headers = rows[hIdx];
        let tidCol = 1, catCol = 12, amtCol = 18, tCodeCol = 22, tNameCol = 23, ctnCol = -1;
        headers.forEach((h, i) => {
          const n = String(h || '').trim().toLowerCase().replace(/\s+/g, ' ');
          if (n === 'tracking id' || n.includes('tracking id')) tidCol = i;
          if (n === 'product category' || n === 'category') catCol = i;
          if (n === 'amount') amtCol = i;
          if (n === 'buyer territory code' || n === 'territory code') tCodeCol = i;
          if (n === 'buyer territory name' || n === 'territory name') tNameCol = i;
          if (n === 'ctn') ctnCol = i;
        });

        rows.slice(hIdx + 1).forEach(r => {
          const tid = String(r[tidCol] || '').trim();
          const cat = String(r[catCol] || 'Others').trim() || 'Others';
          const amt = parseFloat(r[amtCol]) || 0;
          const tCode = String(r[tCodeCol] || '').trim().toLowerCase();
          const tName = String(r[tNameCol] || '').trim().toLowerCase();

          const tObj = tMap[tCode] || tMap[tName];
          const zName = resolveZone(tObj);

          if (tid) exportTotalOrders.add(tid);
          exportTotalAmount += amt;

          if (zoneOrdersMap[zName]) {
            if (tid) zoneOrdersMap[zName].add(tid);
            zoneAmountsMap[zName] += amt;
            if (tid) zoneLinesMap[zName]++;
          }

          // Category matrix
          const ctn = ctnCol !== -1 ? (parseFloat(r[ctnCol]) || 0) : 0;
          if (!categoryMap[cat]) {
            categoryMap[cat] = { name: cat, amount: 0, count: 0, total_carton: 0, zones: {} };
            targetOrder.forEach(z => { categoryMap[cat].zones[z] = 0; });
          }
          categoryMap[cat].amount += amt;
          categoryMap[cat].count++;
          categoryMap[cat].total_carton += ctn;
          if (targetOrder.includes(zName)) {
            categoryMap[cat].zones[zName] = (categoryMap[cat].zones[zName] || 0) + amt;
          }
        });

        if (totalOrderAmount === 0 && exportTotalAmount > 0) totalOrderAmount = exportTotalAmount;
        if (totalOrders === 0 && exportTotalOrders.size > 0) totalOrders = exportTotalOrders.size;

        console.log(`   📦 Order export parsed: ${exportTotalOrders.size} unique orders, ৳${Math.round(exportTotalAmount).toLocaleString()} total`);
      }
    } catch (e) { console.error('Order parse error:', e.message); }
  }

  // Adjust category zone amounts proportionally to match official zone totals
  const categoryZoneSums = {};
  targetOrder.forEach(z => { categoryZoneSums[z] = 0; });
  Object.values(categoryMap).forEach(c => {
    targetOrder.forEach(z => {
      categoryZoneSums[z] += (c.zones[z] || 0);
    });
  });

  Object.values(categoryMap).forEach(c => {
    let adjustedTotal = 0;
    targetOrder.forEach(z => {
      const offAmt = zoneOfficialMetrics[z]?.amount || 0;
      const rawZSum = categoryZoneSums[z];
      if (offAmt > 0 && rawZSum > 0) {
        c.zones[z] = (c.zones[z] / rawZSum) * offAmt;
      }
      adjustedTotal += (c.zones[z] || 0);
    });
    c.amount = adjustedTotal;
  });

  // Build Zone List with Official Visits, Orders, Amount, accurate Strike Rate & Live LPC
  const zoneList = targetOrder.map(name => {
    const off = zoneOfficialMetrics[name] || { visit: 0, orders: 0, amount: 0 };
    const v = off.visit || 0;
    const ord = off.orders || (zoneOrdersMap[name] ? zoneOrdersMap[name].size : 0);
    const amt = off.amount > 0 ? off.amount : (zoneAmountsMap[name] || 0);
    const lines = zoneLinesMap[name] || 0;
    const eco = v > 0 ? ((ord / v) * 100).toFixed(1) : '0.0';
    const avgLpc = ord > 0 ? (lines / ord).toFixed(1) : '0.0';

    return {
      zone: name,
      total_visit: v,
      total_order: ord,
      total_amount: amt,
      eco: `${eco}%`,
      avg_lpc: avgLpc
    };
  }).sort((a, b) => b.total_visit - a.total_visit);

  const uniqueVisitedOutlets = totalVisits;
  const overallStrikeRate = totalVisits > 0 ? ((totalOrders / totalVisits) * 100).toFixed(1) : '0.0';

  console.log(`   ✅ National: visits=${totalVisits}, orders=${totalOrders}, strikeRate=${overallStrikeRate}%, amount=৳${Math.round(totalOrderAmount).toLocaleString()}, activeSR=${activeSRCount}/${totalSRCount}`);
  console.log(`   ✅ Zones: ${zoneList.map(z => z.zone + ': visit=' + z.total_visit + ', ord=' + z.total_order + ', sr=' + z.eco).join(' | ')}`);

  // Category Matrix (Excluding 'Free' category)
  const filteredCategories = Object.values(categoryMap).filter(c => String(c.name || '').trim().toLowerCase() !== 'free');
  const totalCatAmt = filteredCategories.reduce((s, c) => s + c.amount, 0) || totalOrderAmount || 1;
  const categoryList = filteredCategories
    .map(c => ({
      category: c.name,
      amount: c.amount,
      total_carton: Math.round(c.total_carton || 0),
      percentage: Math.round((c.amount / totalCatAmt) * 100),
      zones: c.zones || {}
    }))
    .sort((a, b) => b.amount - a.amount);

  let formattedOrderAmount = '৳0';
  if (totalOrderAmount >= 1000000) {
    formattedOrderAmount = `৳${(totalOrderAmount / 1000000).toFixed(2)} M`;
  } else if (totalOrderAmount >= 1000) {
    formattedOrderAmount = `৳${(totalOrderAmount / 1000).toFixed(1)} K`;
  } else {
    formattedOrderAmount = `৳${totalOrderAmount.toLocaleString()}`;
  }

  const snapshotResult = {
    date,
    generatedAt: new Date().toISOString(),
    kpis: {
      total_outlet: {
        value: totalOutlets.toLocaleString(),
        new_last_7_days: `+${newOutlets7d} (Last 7 Days)`
      },
      total_sales_rep: {
        value: totalSRCount.toLocaleString(),
        active: activeSRCount.toLocaleString(),
        inactive: inactiveSRCount.toLocaleString(),
        active_label: `Checked in: ${activeSRCount}`,
        inactive_label: `Not Checked in: ${inactiveSRCount}`
      },
      total_visit: {
        value: totalVisits.toLocaleString(),
        unique_visited: uniqueVisitedOutlets.toLocaleString(),
        unique_label: `Gross Check-ins: ${totalRawCheckins.toLocaleString()}`
      },
      order_amount: {
        value: formattedOrderAmount,
        raw_amount: totalOrderAmount,
        volume: totalOrders.toLocaleString(),
        volume_label: `Total number of MEMO: ${totalOrders.toLocaleString()}`
      },
      eco: {
        value: `${overallStrikeRate}%`,
        target_label: `Productive Outlet: ${totalOrders.toLocaleString()}`
      }
    },
    zones: zoneList,
    zone_columns: targetOrder,
    categories: categoryList
  };

  toCache(`snapshot_${date}`, snapshotResult);
  toSnapshotCache(date, snapshotResult);

  return snapshotResult;
}

// ─── API: Snapshot Endpoint ────────────────────────────────────────────────
app.get('/api/snapshot', async (req, res) => {
  try {
    const date = req.query.date || getYesterdayDateStr();
    const force = req.query.force === 'true';
    const snapshot = await generateSnapshot(date, force);
    res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=86400');
    res.json(snapshot);
  } catch (err) {
    console.error('snapshot error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── API: Force Trigger / Manual Sync ───────────────────────────────────────
app.get('/api/trigger-snapshot', async (req, res) => {
  try {
    const date = req.query.date || getYesterdayDateStr();
    console.log(`\n🔄 [Manual Trigger] Generating BDFP snapshot for ${date}...`);
    const snapshot = await generateSnapshot(date, true);
    res.json({ message: 'Snapshot generated successfully', snapshot });
  } catch (err) {
    console.error('trigger-snapshot error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── API: Email Dispatch Test / On-demand ──────────────────────────────────
app.get('/api/test-email', async (req, res) => {
  try {
    const date = req.query.date || getYesterdayDateStr();
    const toEmail = req.query.to || process.env.REPORT_TO_EMAILS;
    const snapshot = await generateSnapshot(date, true);

    // ── Data Validation Gate ──────────────────────────────────────────────
    const allZeroZones = snapshot.zones && snapshot.zones.every(z => z.total_visit === 0 && z.total_amount === 0);
    const totalVisitNum = parseInt(String(snapshot.kpis?.total_visit?.value || '0').replace(/,/g, ''), 10);
    const totalAmtNum = snapshot.kpis?.order_amount?.raw_amount || 0;

    if (allZeroZones && totalAmtNum === 0 && totalVisitNum === 0) {
      console.error(`❌ [Email Blocked] Snapshot for ${date} has invalid data (all zeros). Email NOT sent.`);
      return res.status(422).json({
        message: 'Email NOT sent — snapshot data appears invalid (all zones 0, total visit 0). Please verify Sokrio API connectivity.',
        snapshot_summary: { total_visit: totalVisitNum, total_amount: totalAmtNum, all_zones_zero: allZeroZones }
      });
    }

    const result = await sendDailyReportEmail(snapshot, toEmail);
    console.log(`✅ Email dispatched to: ${toEmail}`);
    res.json({ message: 'Email send attempted', result });
  } catch (err) {
    console.error('test-email error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── Static Web Files (Public) ─────────────────────────────────────────────
app.use(express.static(path.join(__dirname, '..', 'public')));

// Fallback to index.html for SPA routing
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// ─── Start Server & Auto Scheduler (if not serverless) ──────────────────────
const PORT = process.env.PORT || 3001;
if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`✅ BDFP Live Report Dashboard running at http://localhost:${PORT}`);
    initScheduler(generateSnapshot, getYesterdayDateStr);
  });
}

module.exports = app;
