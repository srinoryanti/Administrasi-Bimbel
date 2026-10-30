'use strict';
const fs = require('fs');
const t0 = Date.now();
const log = (m) => fs.appendFileSync('probe.log', `${Date.now() - t0}ms ${m}\n`);
try {
  log('start');
  require('dotenv').config({ path: require('path').join(__dirname, '.env') });
  log('dotenv');
  require('./src/db');
  log('db module');
  const mods = ['auth', 'users', 'students', 'tutors', 'catalog', 'classes', 'attendance', 'journals', 'assessments', 'reports', 'archives', 'billing', 'dashboard', 'laporan'];
  for (const m of mods) { require('./src/routes/' + m); log('route ' + m); }
  log('routes done');
  const { initSchema } = require('./src/db');
  initSchema().then(() => { log('schema ok'); process.exit(0); }).catch((e) => { log('schema ERR ' + e); process.exit(1); });
} catch (e) {
  log('THROW ' + e.stack);
  process.exit(1);
}
