const nodemailer = require('nodemailer');

function createEmailTransporter() {
  const host = process.env.SMTP_HOST || 'smtp.gmail.com';
  const port = parseInt(process.env.SMTP_PORT || '587', 10);
  const secure = process.env.SMTP_SECURE === 'true' || port === 465;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!user || !pass) {
    console.warn('⚠️ SMTP_USER or SMTP_PASS not set in .env. Email sending will be skipped or simulated.');
    return null;
  }

  return nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
    tls: { rejectUnauthorized: false }
  });
}

function formatTaka(v) {
  if (!v || v === 0) return '৳0';
  if (v >= 1000000) return `৳${(v / 1000000).toFixed(2)}M`;
  if (v >= 1000)    return `৳${(v / 1000).toFixed(0)}K`;
  return `৳${Math.round(v).toLocaleString()}`;
}

function buildHtmlEmail(snapshot) {
  const kpis = snapshot.kpis || {};
  const zones = snapshot.zones || [];
  const categories = (snapshot.categories || []).filter(c => String(c.category || '').trim().toLowerCase() !== 'free');
  const zoneColumns = snapshot.zone_columns || [
    'NCCP(Khulna)', 'NCCP(Bogura Region)', 'NCCP(Sylhet)',
    'NCCP (cumilla)', 'NCCP(CHITTAGANG)', 'NCCP(Dhaka-2)', 'NCCP(Dhaka Metro)'
  ];

  const zoneShort = z => z.replace('NCCP', '').replace('(', '').replace(')', '').replace(' Region', '').trim();

  const dObj = new Date((snapshot.date || '') + 'T00:00:00');
  const formattedDate = dObj.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }).toUpperCase();
  const timeStr = new Date(snapshot.generatedAt || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  // Zone rows — sorted by total_visit descending
  const sortedZones = [...zones].sort((a, b) => (b.total_visit || 0) - (a.total_visit || 0));
  
  let totZoneVisits = 0;
  let totZoneAmt = 0;
  let totZoneOrders = 0;
  let totZoneWeightedLpc = 0;

  const zoneRowsHtml = sortedZones.map((z, idx) => {
    const ecoNum = parseFloat(z.eco) || 0;
    const ecoBg = ecoNum >= 70 ? '#e8f8f0' : (ecoNum >= 50 ? '#fef3e2' : '#feecef');
    const ecoColor = ecoNum >= 70 ? '#059669' : (ecoNum >= 50 ? '#d97706' : '#e11d48');
    const amt = z.total_amount || 0;
    const v = z.total_visit || 0;
    const o = z.total_order || 0;
    const lpc = parseFloat(z.avg_lpc) || 0;

    totZoneVisits += v;
    totZoneAmt += amt;
    totZoneOrders += o;
    totZoneWeightedLpc += (lpc * o);

    const rowBg = idx % 2 === 0 ? '#ffffff' : '#f8fbff';

    return `
      <tr style="border-bottom: 1px solid #e2e8f0; background: ${rowBg};">
        <td style="padding: 10px 12px; color: #1e293b; font-weight: 600; font-size: 13px;">
          <span style="display:inline-block; width:7px; height:7px; border-radius:50%; background:#00AEEF; margin-right:6px;"></span>
          ${z.zone}
        </td>
        <td style="padding: 10px 12px; color: #334155; text-align: right; font-size: 13px; font-family: monospace;">${(v || 0).toLocaleString()}</td>
        <td style="padding: 10px 12px; color: #0284c7; text-align: right; font-weight: 700; font-size: 13px; font-family: monospace;">${formatTaka(amt)}</td>
        <td style="padding: 10px 12px; text-align: right;">
          <span style="display: inline-block; padding: 2px 8px; border-radius: 4px; font-weight: 700; font-size: 12px; background: ${ecoBg}; color: ${ecoColor};">${z.eco}</span>
        </td>
        <td style="padding: 10px 12px; color: #334155; text-align: right; font-size: 13px; font-family: monospace;">${z.avg_lpc || '0.0'}</td>
      </tr>
    `;
  }).join('');

  const totZoneEco = totZoneVisits > 0 ? ((totZoneOrders / totZoneVisits) * 100).toFixed(1) + '%' : (kpis.eco?.value || '0.0%');
  const totZoneAvgLpc = totZoneOrders > 0 ? (totZoneWeightedLpc / totZoneOrders).toFixed(1) : '0.0';

  const zoneFootHtml = `
    <tfoot>
      <tr style="border-top: 2px solid #00AEEF; background: #e0f4fc;">
        <td style="padding: 11px 12px; color: #0369a1; font-weight: 800; font-size: 13px;">
          <span style="display:inline-block; width:8px; height:8px; border-radius:50%; background:#0284c7; margin-right:6px;"></span>
          TOTAL
        </td>
        <td style="padding: 11px 12px; color: #0f172a; text-align: right; font-weight: 800; font-size: 13px; font-family: monospace;">${totZoneVisits.toLocaleString()}</td>
        <td style="padding: 11px 12px; color: #0284c7; text-align: right; font-weight: 800; font-size: 13px; font-family: monospace;">${formatTaka(totZoneAmt)}</td>
        <td style="padding: 11px 12px; text-align: right;">
          <span style="display: inline-block; padding: 3px 8px; border-radius: 4px; font-weight: 800; font-size: 12px; background: #dcfce7; color: #15803d;">${totZoneEco}</span>
        </td>
        <td style="padding: 11px 12px; color: #0f172a; text-align: right; font-weight: 800; font-size: 13px; font-family: monospace;">${totZoneAvgLpc}</td>
      </tr>
    </tfoot>
  `;

  // Category Matrix header
  const matrixZoneThs = zoneColumns.map(z =>
    `<th style="padding: 9px 8px; color: #0284c7; text-align: right; font-size: 11px; font-weight: 800; text-transform: uppercase; border-bottom: 2px solid #cbd5e1; background: #f1f5f9;">${zoneShort(z)}</th>`
  ).join('');
  const matrixCtnTh = `<th style="padding: 9px 8px; color: #7c3aed; text-align: right; font-size: 11px; font-weight: 800; text-transform: uppercase; border-bottom: 2px solid #cbd5e1; background: #f5f3ff;">Total CTN</th>`;

  // Category Matrix rows & totals calculation
  let catGrandTotal = 0;
  let catGrandCarton = 0;
  const catZoneTotals = {};
  zoneColumns.forEach(z => { catZoneTotals[z] = 0; });

  const categoryRowsHtml = categories.map((cat, i) => {
    catGrandTotal += (cat.amount || 0);
    catGrandCarton += (cat.total_carton || 0);
    const zoneCells = zoneColumns.map(z => {
      const val = (cat.zones && cat.zones[z]) || 0;
      catZoneTotals[z] += val;
      const valStr = val > 0 ? formatTaka(val) : '—';
      const color = val > 0 ? '#0f172a' : '#94a3b8';
      const cellBg = val > 0 ? '#f8fafc' : 'transparent';
      return `<td style="padding: 8px 8px; text-align: right; font-size: 12px; font-weight: ${val > 0 ? '600' : 'normal'}; color: ${color}; font-family: monospace; background: ${cellBg};">${valStr}</td>`;
    }).join('');

    const ctnDisplay = cat.total_carton != null ? Math.round(cat.total_carton).toLocaleString() : '—';
    const rowBg = i % 2 === 0 ? '#ffffff' : '#f8fbff';
    return `
      <tr style="border-bottom: 1px solid #e2e8f0; background: ${rowBg};">
        <td style="padding: 8px 6px; color: #64748b; font-size: 11px; text-align: center;">${i + 1}</td>
        <td style="padding: 8px 10px; color: #0f172a; font-weight: 700; font-size: 12.5px; white-space: nowrap;">
          <span style="display:inline-block; width:6px; height:6px; border-radius:50%; background:#0284c7; margin-right:6px;"></span>
          ${cat.category}
        </td>
        ${zoneCells}
        <td style="padding: 8px 8px; color: #7c3aed; text-align: right; font-weight: 800; font-size: 12.5px; font-family: monospace; background: #f5f3ff;">${ctnDisplay}</td>
        <td style="padding: 8px 8px; color: #0284c7; text-align: right; font-weight: 800; font-size: 12.5px; font-family: monospace; background: #f0f9ff;">${formatTaka(cat.amount)}</td>
        <td style="padding: 8px 8px; color: #7c3aed; text-align: right; font-weight: 800; font-size: 12px; font-family: monospace;">${cat.percentage || 0}%</td>
      </tr>
    `;
  }).join('');

  const catZoneFootCells = zoneColumns.map(z => {
    const val = catZoneTotals[z] || 0;
    return `<td style="padding: 10px 8px; text-align: right; font-size: 12px; font-weight: 800; color: #0f172a; font-family: monospace;">${val > 0 ? formatTaka(val) : '—'}</td>`;
  }).join('');

  const categoryFootHtml = `
    <tfoot>
      <tr style="border-top: 2px solid #00AEEF; background: #e0f4fc;">
        <td style="padding: 10px 6px; color: #0369a1; font-size: 12px; text-align: center; font-weight: 800;">∑</td>
        <td style="padding: 10px 10px; color: #0369a1; font-weight: 800; font-size: 13px;">TOTAL</td>
        ${catZoneFootCells}
        <td style="padding: 10px 8px; color: #7c3aed; text-align: right; font-weight: 800; font-size: 13px; font-family: monospace; background: #ede9fe;">${Math.round(catGrandCarton).toLocaleString()}</td>
        <td style="padding: 10px 8px; color: #0284c7; text-align: right; font-weight: 800; font-size: 13px; font-family: monospace; background: #bae6fd;">${formatTaka(catGrandTotal)}</td>
        <td style="padding: 10px 8px; color: #6d28d9; text-align: right; font-weight: 800; font-size: 12px; font-family: monospace;">100%</td>
      </tr>
    </tfoot>
  `;

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>BDFP — Daily Snapshot</title>
</head>
<body style="margin: 0; padding: 24px 12px; background-color: #f0f6ff; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #0f172a;">

  <div style="max-width: 980px; margin: 0 auto;">

    <!-- 1. Formal Email Greeting -->
    <div style="margin-bottom: 16px; padding: 0 4px;">
      <p style="margin: 0 0 8px 0; font-size: 15px; font-weight: 700; color: #0f172a;">Dear Concern,</p>
      <p style="margin: 0; font-size: 13.5px; line-height: 1.5; color: #475569;">
        Please find below the <strong>BDFP Daily Sales &amp; Field Operations Snapshot</strong> for <strong>${formattedDate}</strong>.
      </p>
    </div>

    <!-- 2. Clean Executive Report Container (Light Modern Theme matching Dashboard) -->
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: #ffffff; border-radius: 16px; border: 1px solid #dbeafe; box-shadow: 0 10px 30px rgba(0, 174, 239, 0.08); overflow: hidden; margin-bottom: 22px;">

      <!-- Header -->
      <tr>
        <td style="padding: 20px 24px; background: #ffffff; border-bottom: 1px solid #e2e8f0;">
          <table width="100%" cellpadding="0" cellspacing="0" border="0">
            <tr>
              <td>
                <div style="font-size: 10.5px; font-weight: 800; color: #00AEEF; letter-spacing: 0.08em; text-transform: uppercase;">Executive Dashboard</div>
                <h1 style="margin: 4px 0 0 0; font-size: 22px; font-weight: 800; color: #0f172a; letter-spacing: -0.02em;">BDFP — DAILY SNAPSHOT</h1>
              </td>
              <td align="right">
                <div style="background: #f0f9ff; border: 1px solid #bae6fd; padding: 6px 14px; border-radius: 10px; display: inline-block;">
                  <div style="font-size: 12.5px; font-weight: 800; color: #0284c7;">${formattedDate}</div>
                  <div style="font-size: 10px; color: #64748b; margin-top: 2px;">Updated at ${timeStr}</div>
                </div>
              </td>
            </tr>
          </table>
        </td>
      </tr>

      <!-- 5 Horizontal Top KPI Cards -->
      <tr>
        <td style="padding: 18px 16px 12px 16px; background: #f8fbff;">
          <table width="100%" cellpadding="0" cellspacing="0" border="0" style="table-layout: fixed;">
            <tr>

              <!-- ① TOTAL OUTLET -->
              <td width="20%" style="padding: 0 4px; vertical-align: top;">
                <div style="background: #ffffff; border: 1px solid #e2e8f0; border-left: 4px solid #00AEEF; border-radius: 10px; padding: 12px 8px; height: 90px; box-sizing: border-box; box-shadow: 0 2px 6px rgba(0,0,0,0.03);">
                  <div style="font-size: 9px; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: 0.02em; white-space: nowrap;">TOTAL OUTLET</div>
                  <div style="font-size: 20px; font-weight: 800; color: #0f172a; margin: 6px 0 4px 0; line-height: 1;">${kpis.total_outlet?.value || '0'}</div>
                  <div style="font-size: 8.5px; font-weight: 600; color: #059669; background: #ecfdf5; padding: 2px 6px; border-radius: 4px; display: inline-block; white-space: nowrap;">${kpis.total_outlet?.new_last_7_days || '+0 (Last 7 Days)'}</div>
                </div>
              </td>

              <!-- ② TOTAL SALES REPRESENTATIVE -->
              <td width="20%" style="padding: 0 4px; vertical-align: top;">
                <div style="background: #ffffff; border: 1px solid #e2e8f0; border-left: 4px solid #3b82f6; border-radius: 10px; padding: 12px 8px; height: 90px; box-sizing: border-box; box-shadow: 0 2px 6px rgba(0,0,0,0.03);">
                  <div style="font-size: 8.5px; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: 0.01em; white-space: nowrap;">TOTAL SALES REPRESENTATIVE</div>
                  <div style="font-size: 20px; font-weight: 800; color: #0f172a; margin: 6px 0 4px 0; line-height: 1;">${kpis.total_sales_rep?.value || '0'}</div>
                  <div style="font-size: 8.5px; font-weight: 600; color: #475569; white-space: nowrap;">
                    <span style="color: #059669; background: #ecfdf5; padding: 2px 4px; border-radius: 3px;">Checked in: ${kpis.total_sales_rep?.active || '0'}</span>
                    <span style="color: #e11d48; background: #ffe4e6; padding: 2px 4px; border-radius: 3px;">Not: ${kpis.total_sales_rep?.inactive || '0'}</span>
                  </div>
                </div>
              </td>

              <!-- ③ TOTAL VISITED OUTLET -->
              <td width="20%" style="padding: 0 4px; vertical-align: top;">
                <div style="background: #ffffff; border: 1px solid #e2e8f0; border-left: 4px solid #f59e0b; border-radius: 10px; padding: 12px 8px; height: 90px; box-sizing: border-box; box-shadow: 0 2px 6px rgba(0,0,0,0.03);">
                  <div style="font-size: 9px; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: 0.02em; white-space: nowrap;">TOTAL VISITED OUTLET</div>
                  <div style="font-size: 20px; font-weight: 800; color: #0f172a; margin: 6px 0 4px 0; line-height: 1;">${kpis.total_visit?.value || '0'}</div>
                  <div style="font-size: 8.5px; font-weight: 600; color: #d97706; background: #fef3c7; padding: 2px 5px; border-radius: 4px; display: inline-block; white-space: nowrap;">Gross: ${kpis.total_visit?.unique_visited || '0'}</div>
                </div>
              </td>

              <!-- ④ ORDER AMOUNT -->
              <td width="20%" style="padding: 0 4px; vertical-align: top;">
                <div style="background: #ffffff; border: 1px solid #e2e8f0; border-left: 4px solid #10b981; border-radius: 10px; padding: 12px 8px; height: 90px; box-sizing: border-box; box-shadow: 0 2px 6px rgba(0,0,0,0.03);">
                  <div style="font-size: 9px; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: 0.02em; white-space: nowrap;">ORDER AMOUNT</div>
                  <div style="font-size: 20px; font-weight: 800; color: #059669; margin: 6px 0 4px 0; line-height: 1;">${kpis.order_amount?.value || '৳0'}</div>
                  <div style="font-size: 8.5px; font-weight: 600; color: #0284c7; background: #e0f2fe; padding: 2px 6px; border-radius: 4px; display: inline-block; white-space: nowrap;">Total MEMO: ${kpis.order_amount?.volume || '0'}</div>
                </div>
              </td>

              <!-- ⑤ STRIKE RATE -->
              <td width="20%" style="padding: 0 4px; vertical-align: top;">
                <div style="background: #ffffff; border: 1px solid #e2e8f0; border-left: 4px solid #8b5cf6; border-radius: 10px; padding: 12px 8px; height: 90px; box-sizing: border-box; box-shadow: 0 2px 6px rgba(0,0,0,0.03);">
                  <div style="font-size: 9px; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: 0.02em; white-space: nowrap;">STRIKE RATE</div>
                  <div style="font-size: 20px; font-weight: 800; color: #7c3aed; margin: 6px 0 4px 0; line-height: 1;">${kpis.eco?.value || '0.0%'}</div>
                  <div style="font-size: 8.5px; font-weight: 600; color: #7c3aed; background: #f3e8ff; padding: 2px 5px; border-radius: 4px; display: inline-block; white-space: nowrap;">Productive Outlet: ${kpis.order_amount?.volume || '0'}</div>
                </div>
              </td>

            </tr>
          </table>
        </td>
      </tr>

      <!-- Region-Wise Performance Table -->
      <tr>
        <td style="padding: 12px 18px 16px 18px;">
          <div style="background: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 16px; box-shadow: 0 2px 8px rgba(0,0,0,0.02);">
            <div style="font-size: 13px; font-weight: 800; color: #0f172a; text-transform: uppercase; letter-spacing: 0.04em; margin-bottom: 12px;">
              🗺️ REGION-WISE PERFORMANCE
              <span style="font-size: 11px; font-weight: 500; color: #64748b; text-transform: none; margin-left: 8px;">Regional Rollup &amp; Effectiveness</span>
            </div>
            <table width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse: collapse;">
              <thead>
                <tr style="background: #f1f5f9; border-bottom: 2px solid #cbd5e1;">
                  <th align="left" style="padding: 9px 12px; color: #475569; font-size: 11px; font-weight: 800; text-transform: uppercase;">Region</th>
                  <th align="right" style="padding: 9px 12px; color: #475569; font-size: 11px; font-weight: 800; text-transform: uppercase;">Total Visit</th>
                  <th align="right" style="padding: 9px 12px; color: #475569; font-size: 11px; font-weight: 800; text-transform: uppercase;">Total Order Amount</th>
                  <th align="right" style="padding: 9px 12px; color: #475569; font-size: 11px; font-weight: 800; text-transform: uppercase;">Strike Rate</th>
                  <th align="right" style="padding: 9px 12px; color: #475569; font-size: 11px; font-weight: 800; text-transform: uppercase;">Avg LPC</th>
                </tr>
              </thead>
              <tbody>
                ${zoneRowsHtml}
              </tbody>
              ${zoneFootHtml}
            </table>
          </div>
        </td>
      </tr>

      <!-- Category × Region Matrix Table -->
      <tr>
        <td style="padding: 0 18px 22px 18px;">
          <div style="background: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 16px; overflow-x: auto; box-shadow: 0 2px 8px rgba(0,0,0,0.02);">
            <div style="font-size: 13px; font-weight: 800; color: #0f172a; text-transform: uppercase; letter-spacing: 0.04em; margin-bottom: 12px;">
              📊 CATEGORY × REGION MATRIX
              <span style="font-size: 11px; font-weight: 500; color: #64748b; text-transform: none; margin-left: 8px;">Order Amount by Category &amp; Region</span>
            </div>
            <table width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse: collapse;">
              <thead>
                <tr style="background: #f1f5f9; border-bottom: 2px solid #cbd5e1;">
                  <th width="26" style="padding: 9px 6px; color: #64748b; font-size: 10.5px; font-weight: 800;">#</th>
                  <th align="left" style="padding: 9px 10px; color: #475569; font-size: 11px; font-weight: 800; text-transform: uppercase;">Category</th>
                  ${matrixZoneThs}
                  ${matrixCtnTh}
                  <th align="right" style="padding: 9px 8px; color: #0284c7; font-size: 11px; font-weight: 800; text-transform: uppercase; border-bottom: 2px solid #cbd5e1; background: #e0f2fe;">Total</th>
                  <th align="right" style="padding: 9px 8px; color: #7c3aed; font-size: 11px; font-weight: 800; text-transform: uppercase; border-bottom: 2px solid #cbd5e1;">Share</th>
                </tr>
              </thead>
              <tbody>
                ${categoryRowsHtml}
              </tbody>
              ${categoryFootHtml}
            </table>
          </div>
        </td>
      </tr>

      <!-- Sub-Footer -->
      <tr>
        <td style="padding: 14px 18px; background: #f8fafc; border-top: 1px solid #e2e8f0; text-align: center; font-size: 11px; color: #64748b;">
          © 2026 <strong>BDFP · Aarong Dairy</strong> · Automated Executive Intelligence Dispatch · Connected to Sokrio Enterprise Cloud
        </td>
      </tr>

    </table>

    <!-- 3. Formal Email Sign-off -->
    <div style="padding: 0 4px; margin-top: 14px;">
      <p style="margin: 0 0 4px 0; font-size: 13.5px; color: #475569;">Best regards,</p>
      <p style="margin: 0; font-size: 14px; font-weight: 700; color: #0f172a;">Sokrio Business Intelligence Team</p>
    </div>

  </div>

</body>
</html>
  `;
}

async function sendDailyReportEmail(snapshot, recipientEmails) {
  const recipients = recipientEmails || process.env.REPORT_TO_EMAILS;
  if (!recipients) {
    console.warn('⚠️ No recipients specified for daily email report. Set REPORT_TO_EMAILS in .env');
    return { success: false, message: 'No recipients configured' };
  }

  const transporter = createEmailTransporter();
  if (!transporter) {
    return { success: false, message: 'SMTP not configured in .env' };
  }

  const dObj = new Date((snapshot.date || '') + 'T00:00:00');
  const dateFormatted = dObj.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  const subject = `📊 BDFP — CEO Daily Snapshot Report (${dateFormatted})`;
  const htmlContent = buildHtmlEmail(snapshot);

  const senderAddress = `"BDFP Intelligence" <${process.env.SMTP_USER}>`;
  const mailOptions = {
    from: senderAddress,
    to: senderAddress,
    bcc: recipients,
    subject,
    html: htmlContent
  };

  const info = await transporter.sendMail(mailOptions);
  console.log(`✅ Daily Snapshot Email successfully sent via BCC to [${recipients}]. MessageId: ${info.messageId}`);
  return { success: true, messageId: info.messageId };
}

module.exports = {
  buildHtmlEmail,
  sendDailyReportEmail
};
