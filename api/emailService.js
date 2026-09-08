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
  const zoneRowsHtml = sortedZones.map((z, idx) => {
    const ecoNum = parseFloat(z.eco) || 0;
    const ecoBg   = ecoNum >= 70 ? 'rgba(16,185,129,0.2)' : (ecoNum >= 50 ? 'rgba(245,158,11,0.2)' : 'rgba(244,63,94,0.2)');
    const ecoColor = ecoNum >= 70 ? '#34d399' : (ecoNum >= 50 ? '#fbbf24' : '#fb7185');
    const amt = z.total_amount || 0;
    const rowBg = idx % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.015)';

    return `
      <tr style="border-bottom: 1px solid #1e293b; background: ${rowBg};">
        <td style="padding: 9px 12px; color: #f1f5f9; font-weight: 600; font-size: 12.5px;">${z.zone}</td>
        <td style="padding: 9px 12px; color: #cbd5e1; text-align: right; font-size: 12.5px; font-family: monospace;">${(z.total_visit || 0).toLocaleString()}</td>
        <td style="padding: 9px 12px; color: #60a5fa; text-align: right; font-weight: 700; font-size: 12.5px; font-family: monospace;">${formatTaka(amt)}</td>
        <td style="padding: 9px 12px; text-align: right;">
          <span style="display: inline-block; padding: 2px 7px; border-radius: 4px; font-weight: 700; font-size: 11.5px; background: ${ecoBg}; color: ${ecoColor};">${z.eco}</span>
        </td>
        <td style="padding: 9px 12px; color: #cbd5e1; text-align: right; font-size: 12.5px; font-family: monospace;">${z.avg_lpc || '0.0'}</td>
      </tr>
    `;
  }).join('');

  // Category Matrix header
  const matrixZoneThs = zoneColumns.map(z =>
    `<th style="padding: 8px 7px; color: #38bdf8; text-align: right; font-size: 10.5px; text-transform: uppercase; border-bottom: 2px solid #334155;">${zoneShort(z)}</th>`
  ).join('');

  // Category Matrix rows
  const categoryRowsHtml = categories.map((cat, i) => {
    const zoneCells = zoneColumns.map(z => {
      const val = (cat.zones && cat.zones[z]) || 0;
      const valStr = val > 0 ? formatTaka(val) : '—';
      const color = val > 0 ? '#f1f5f9' : '#64748b';
      return `<td style="padding: 7px 7px; text-align: right; font-size: 11.5px; color: ${color}; font-family: monospace;">${valStr}</td>`;
    }).join('');

    const rowBg = i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.02)';
    return `
      <tr style="border-bottom: 1px solid #1e293b; background: ${rowBg};">
        <td style="padding: 7px 6px; color: #64748b; font-size: 10.5px; text-align: center;">${i + 1}</td>
        <td style="padding: 7px 8px; color: #f8fafc; font-weight: 600; font-size: 11.5px; white-space: nowrap;">${cat.category}</td>
        ${zoneCells}
        <td style="padding: 7px 7px; color: #38bdf8; text-align: right; font-weight: 700; font-size: 11.5px; font-family: monospace;">${formatTaka(cat.amount)}</td>
        <td style="padding: 7px 7px; color: #a78bfa; text-align: right; font-weight: 700; font-size: 11.5px; font-family: monospace;">${cat.percentage || 0}%</td>
      </tr>
    `;
  }).join('');

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>BDFP CEO Snapshot</title>
</head>
<body style="margin: 0; padding: 24px 12px; background-color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #1e293b;">

  <div style="max-width: 960px; margin: 0 auto;">

    <!-- 1. Formal Email Greeting (Top Body Text) -->
    <div style="margin-bottom: 18px; padding: 0 4px;">
      <p style="margin: 0 0 10px 0; font-size: 15px; font-weight: 700; color: #0f172a;">Dear Concern,</p>
      <p style="margin: 0; font-size: 14px; line-height: 1.6; color: #334155;">
        Please find below the <strong>Daily Sales &amp; Field Operations Snapshot</strong> for <strong>${formattedDate}</strong>. This report summarizes national field attendance, outlet visits, total revenue, and category-wise performance across all zones.
      </p>
    </div>

    <!-- 2. Dark Executive Intelligence Report Card -->
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: #0f172a; border-radius: 12px; border: 1px solid #1e293b; overflow: hidden; box-shadow: 0 8px 30px rgba(0,0,0,0.15); margin-bottom: 22px;">

      <!-- Top Header -->
      <tr>
        <td style="padding: 20px 22px; background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%); border-bottom: 1px solid #334155;">
          <table width="100%" cellpadding="0" cellspacing="0" border="0">
            <tr>
              <td>
                <div style="font-size: 10px; font-weight: 800; color: #38bdf8; letter-spacing: 0.1em; text-transform: uppercase;">Executive Intelligence Dashboard</div>
                <h1 style="margin: 4px 0 0 0; font-size: 20px; font-weight: 800; color: #ffffff; letter-spacing: -0.02em;">BDFP — DAILY SNAPSHOT</h1>
              </td>
              <td align="right">
                <div style="background: #1e293b; border: 1px solid #334155; padding: 6px 12px; border-radius: 8px; display: inline-block;">
                  <div style="font-size: 12.5px; font-weight: 700; color: #f8fafc;">${formattedDate}</div>
                  <div style="font-size: 9.5px; color: #94a3b8; margin-top: 2px;">Generated at ${timeStr}</div>
                </div>
              </td>
            </tr>
          </table>
        </td>
      </tr>

      <!-- 5 Horizontal Top KPI Cards (Single-Row, Full-Width Fit) -->
      <tr>
        <td style="padding: 16px 14px 12px 14px;">
          <table width="100%" cellpadding="0" cellspacing="0" border="0" style="table-layout: fixed;">
            <tr>

              <!-- ① TOTAL OUTLET -->
              <td width="20%" style="padding: 0 3px; vertical-align: top;">
                <div style="background: #152033; border: 1px solid #223249; border-top: 3px solid #38bdf8; border-radius: 8px; padding: 12px 3px; text-align: center; height: 86px; min-height: 86px; box-sizing: border-box;">
                  <div style="font-size: 8.5px; font-weight: 700; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.02em; white-space: nowrap; height: 14px; line-height: 14px;">TOTAL OUTLET</div>
                  <div style="font-size: 18px; font-weight: 800; color: #ffffff; margin: 5px 0 5px 0; line-height: 1;">${kpis.total_outlet?.value || '0'}</div>
                  <div style="font-size: 8px; font-weight: 600; color: #34d399; background: rgba(16,185,129,0.15); padding: 2px 5px; border-radius: 4px; display: inline-block; white-space: nowrap;">${kpis.total_outlet?.new_last_7_days || '+0 (Last 7 Days)'}</div>
                </div>
              </td>

              <!-- ② TOTAL SALES REPRESENTATIVE -->
              <td width="20%" style="padding: 0 3px; vertical-align: top;">
                <div style="background: #152033; border: 1px solid #223249; border-top: 3px solid #818cf8; border-radius: 8px; padding: 12px 3px; text-align: center; height: 86px; min-height: 86px; box-sizing: border-box;">
                  <div style="font-size: 7.5px; font-weight: 700; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.01em; white-space: nowrap; height: 14px; line-height: 14px;">TOTAL SALES REPRESENTATIVE</div>
                  <div style="font-size: 18px; font-weight: 800; color: #ffffff; margin: 5px 0 5px 0; line-height: 1;">${kpis.total_sales_rep?.value || '0'}</div>
                  <div style="font-size: 8px; font-weight: 600; color: #94a3b8; white-space: nowrap;">
                    <span style="color: #34d399; background: rgba(16,185,129,0.15); padding: 2px 4px; border-radius: 3px;">Checked in: ${kpis.total_sales_rep?.active || '0'}</span>
                    <span style="color: #fb7185; background: rgba(244,63,94,0.15); padding: 2px 4px; border-radius: 3px;">Not: ${kpis.total_sales_rep?.inactive || '0'}</span>
                  </div>
                </div>
              </td>

              <!-- ③ TOTAL VISITED OUTLET -->
              <td width="20%" style="padding: 0 3px; vertical-align: top;">
                <div style="background: #152033; border: 1px solid #223249; border-top: 3px solid #fbbf24; border-radius: 8px; padding: 12px 3px; text-align: center; height: 86px; min-height: 86px; box-sizing: border-box;">
                  <div style="font-size: 8.5px; font-weight: 700; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.02em; white-space: nowrap; height: 14px; line-height: 14px;">TOTAL VISITED OUTLET</div>
                  <div style="font-size: 18px; font-weight: 800; color: #ffffff; margin: 5px 0 5px 0; line-height: 1;">${kpis.total_visit?.value || '0'}</div>
                  <div style="font-size: 7.5px; font-weight: 600; color: #fbbf24; background: rgba(245,158,11,0.15); padding: 2px 4px; border-radius: 3px; display: inline-block; white-space: nowrap;">Unique Out. Visit: ${kpis.total_visit?.unique_visited || '0'}</div>
                </div>
              </td>

              <!-- ④ ORDER AMOUNT -->
              <td width="20%" style="padding: 0 3px; vertical-align: top;">
                <div style="background: #152033; border: 1px solid #223249; border-top: 3px solid #34d399; border-radius: 8px; padding: 12px 3px; text-align: center; height: 86px; min-height: 86px; box-sizing: border-box;">
                  <div style="font-size: 8.5px; font-weight: 700; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.02em; white-space: nowrap; height: 14px; line-height: 14px;">ORDER AMOUNT</div>
                  <div style="font-size: 18px; font-weight: 800; color: #34d399; margin: 5px 0 5px 0; line-height: 1;">${kpis.order_amount?.value || '৳0'}</div>
                  <div style="font-size: 8px; font-weight: 600; color: #38bdf8; background: rgba(56,189,248,0.15); padding: 2px 5px; border-radius: 4px; display: inline-block; white-space: nowrap;">Total MEMO: ${kpis.order_amount?.volume || '0'}</div>
                </div>
              </td>

              <!-- ⑤ STRIKE RATE -->
              <td width="20%" style="padding: 0 3px; vertical-align: top;">
                <div style="background: #152033; border: 1px solid #223249; border-top: 3px solid #c084fc; border-radius: 8px; padding: 12px 3px; text-align: center; height: 86px; min-height: 86px; box-sizing: border-box;">
                  <div style="font-size: 8.5px; font-weight: 700; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.02em; white-space: nowrap; height: 14px; line-height: 14px;">STRIKE RATE</div>
                  <div style="font-size: 18px; font-weight: 800; color: #c084fc; margin: 5px 0 5px 0; line-height: 1;">${kpis.eco?.value || '0.0%'}</div>
                  <div style="font-size: 7.5px; font-weight: 600; color: #c084fc; background: rgba(168,85,247,0.15); padding: 2px 4px; border-radius: 3px; display: inline-block; white-space: nowrap;">Productive Outlet: ${kpis.order_amount?.volume || '0'}</div>
                </div>
              </td>

            </tr>
          </table>
        </td>
      </tr>

      <!-- Zone-Wise Performance Table -->
      <tr>
        <td style="padding: 8px 14px 16px 14px;">
          <div style="background: #131d31; border: 1px solid #1e293b; border-radius: 8px; padding: 14px;">
            <div style="font-size: 12px; font-weight: 700; color: #ffffff; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 10px;">📊 ZONE-WISE PERFORMANCE</div>
            <table width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse: collapse;">
              <thead>
                <tr style="background: #1e293b; border-bottom: 2px solid #334155;">
                  <th align="left" style="padding: 8px 10px; color: #94a3b8; font-size: 10.5px; text-transform: uppercase;">Zone</th>
                  <th align="right" style="padding: 8px 10px; color: #94a3b8; font-size: 10.5px; text-transform: uppercase;">Total Visit</th>
                  <th align="right" style="padding: 8px 10px; color: #94a3b8; font-size: 10.5px; text-transform: uppercase;">Total Order Amount</th>
                  <th align="right" style="padding: 8px 10px; color: #94a3b8; font-size: 10.5px; text-transform: uppercase;">Strike Rate</th>
                  <th align="right" style="padding: 8px 10px; color: #94a3b8; font-size: 10.5px; text-transform: uppercase;">Avg LPC</th>
                </tr>
              </thead>
              <tbody>
                ${zoneRowsHtml}
              </tbody>
            </table>
          </div>
        </td>
      </tr>

      <!-- Category × Zone Matrix Table (Compact) -->
      <tr>
        <td style="padding: 0 14px 20px 14px;">
          <div style="background: #131d31; border: 1px solid #1e293b; border-radius: 8px; padding: 14px; overflow-x: auto;">
            <div style="font-size: 12px; font-weight: 700; color: #ffffff; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 10px;">🗂️ CATEGORY × ZONE MATRIX</div>
            <table width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse: collapse;">
              <thead>
                <tr style="background: #1e293b; border-bottom: 2px solid #334155;">
                  <th width="24" style="padding: 7px 6px; color: #94a3b8; font-size: 10px;">#</th>
                  <th align="left" style="padding: 7px 8px; color: #94a3b8; font-size: 10.5px; text-transform: uppercase;">Category</th>
                  ${matrixZoneThs}
                  <th align="right" style="padding: 7px 6px; color: #38bdf8; font-size: 10.5px; text-transform: uppercase; border-bottom: 2px solid #334155;">Total</th>
                  <th align="right" style="padding: 7px 6px; color: #a78bfa; font-size: 10.5px; text-transform: uppercase; border-bottom: 2px solid #334155;">Share</th>
                </tr>
              </thead>
              <tbody>
                ${categoryRowsHtml}
              </tbody>
            </table>
          </div>
        </td>
      </tr>

      <!-- Card Sub-Footer -->
      <tr>
        <td style="padding: 12px 14px; background: #0b0f19; border-top: 1px solid #1e293b; text-align: center; font-size: 10.5px; color: #64748b;">
          © 2026 <strong>BDFP</strong> · Automated Executive Intelligence Dispatch · Connected to Sokrio Cloud
        </td>
      </tr>

    </table>

    <!-- 3. Formal Email Sign-off (Bottom Body Text) -->
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

  const mailOptions = {
    from: `"BDFP Intelligence" <${process.env.SMTP_USER}>`,
    to: recipients,
    subject,
    html: htmlContent
  };

  const info = await transporter.sendMail(mailOptions);
  console.log(`✅ Daily Snapshot Email successfully sent to ${recipients}. MessageId: ${info.messageId}`);
  return { success: true, messageId: info.messageId };
}

module.exports = {
  buildHtmlEmail,
  sendDailyReportEmail
};
