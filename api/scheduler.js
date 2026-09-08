const cron = require('node-cron');
const { sendDailyReportEmail } = require('./emailService');

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function initScheduler(generateSnapshotFn, getYesterdayDateStrFn) {
  console.log('⏰ Initializing Automated Daily Scheduler (Timezone: Asia/Dhaka)...');

  // 1. Daily Morning Data Generation @ 5:00 AM (Serial Load)
  cron.schedule('0 5 * * *', async () => {
    const yesterday = getYesterdayDateStrFn();
    console.log(`\n======================================================`);
    console.log(`🌅 [5:00 AM BD TIME] Starting Scheduled Serial Snapshot Generation for ${yesterday}...`);
    console.log(`======================================================`);
    try {
      const startTime = Date.now();
      const snapshot = await generateSnapshotFn(yesterday, true); // force serial
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`✅ [5:00 AM BD TIME] Snapshot for ${yesterday} successfully generated & cached in ${elapsed}s.`);
    } catch (err) {
      console.error(`❌ [5:00 AM BD TIME] Failed to generate snapshot for ${yesterday}:`, err.message);
    }
  }, {
    timezone: 'Asia/Dhaka'
  });

  // 2. Daily Email Dispatch @ 10:00 AM
  cron.schedule('0 10 * * *', async () => {
    const yesterday = getYesterdayDateStrFn();
    console.log(`\n======================================================`);
    console.log(`📧 [10:00 AM BD TIME] Starting Automated Email Dispatch for ${yesterday}...`);
    console.log(`======================================================`);
    try {
      // Force fresh generation to avoid stale cache
      const snapshot = await generateSnapshotFn(yesterday, true);
      if (!snapshot) {
        console.error(`❌ [10:00 AM BD TIME] Snapshot data unavailable for ${yesterday}. Email cancelled.`);
        return;
      }

      // Data Validation Gate — don't send if all zones are 0
      const allZeroZones = snapshot.zones && snapshot.zones.every(z => z.total_visit === 0 && z.total_amount === 0);
      const totalAmtNum = snapshot.kpis?.order_amount?.raw_amount || 0;
      const totalVisitNum = parseInt(String(snapshot.kpis?.total_visit?.value || '0').replace(/,/g, ''), 10);

      if (allZeroZones && totalAmtNum === 0 && totalVisitNum === 0) {
        console.error(`❌ [10:00 AM BD TIME] Email BLOCKED — Snapshot for ${yesterday} has all-zero data. Please check Sokrio API.`);
        return;
      }

      const result = await sendDailyReportEmail(snapshot);
      if (result.success) {
        console.log(`✅ [10:00 AM BD TIME] Daily Snapshot Report Email dispatched successfully!`);
      } else {
        console.warn(`⚠️ [10:00 AM BD TIME] Email dispatch skipped/failed: ${result.message}`);
      }
    } catch (err) {
      console.error(`❌ [10:00 AM BD TIME] Error sending daily snapshot email:`, err.message);
    }
  }, {
    timezone: 'Asia/Dhaka'
  });


  // 3. Test Email Dispatch @ 12:45 PM (Today's Test Request)
  cron.schedule('45 12 * * *', async () => {
    const yesterday = getYesterdayDateStrFn();
    console.log(`\n======================================================`);
    console.log(`📧 [12:45 PM BD TIME] Triggering Email Dispatch for ${yesterday}...`);
    console.log(`======================================================`);
    try {
      const snapshot = await generateSnapshotFn(yesterday, false);
      if (!snapshot) {
        console.error(`❌ [12:45 PM] Snapshot data unavailable for ${yesterday}.`);
        return;
      }
      const result = await sendDailyReportEmail(snapshot);
      console.log(`✅ [12:45 PM] Email send result:`, result);
    } catch (err) {
      console.error(`❌ [12:45 PM] Error sending email:`, err.message);
    }
  }, {
    timezone: 'Asia/Dhaka'
  });

  console.log('✅ Scheduler Active:');
  console.log('   - 06:00 AM (Asia/Dhaka): Serial Data Fetch & Snapshot Cache Generation');
  console.log('   - 10:00 AM (Asia/Dhaka): Automated Daily Email Dispatch to Client/CEO');
  console.log('   - 12:45 PM (Asia/Dhaka): Special Scheduled Email Dispatch');
}

module.exports = {
  initScheduler,
  delay
};
