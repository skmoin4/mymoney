// tests/concurrency_reserve_test.js
// Usage: node tests/concurrency_reserve_test.js
import axios from 'axios';

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const USER_TOKEN = process.env.USER_TOKEN || 'MnGnBCDNpqYMxS5IvVVeqkTHCuEI6hE9hpuGGuvB0'; // set env before running
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '<ADMIN_TOKEN>';
const USER_ID = Number(process.env.USER_ID || 5);

async function seedBalance(amount = 1000) {
  console.log('Seeding balance:', amount);
  await axios.post(`${BASE}/api/v1/wallet/credit`, { amount, ref_id: 'seed-concurrency', note: 'seed' }, {
    headers: { Authorization: `Bearer ${ADMIN_TOKEN}`, 'Content-Type': 'application/json' }
  });
}

async function reserve(amount) {
  try {
    const res = await axios.post(`${BASE}/api/v1/wallet/reserve`, { amount, ref_id: `conc-${Math.random().toString(36).slice(2,8)}` }, {
      headers: { Authorization: `Bearer ${USER_TOKEN}`, 'Content-Type': 'application/json' }
    });
    return { ok: true, data: res.data };
  } catch (err) {
    return { ok: false, error: err.response ? err.response.data : err.message };
  }
}

async function getWallet() {
  const res = await axios.get(`${BASE}/api/v1/wallet`, {
    headers: { Authorization: `Bearer ${USER_TOKEN}` }
  });
  return res.data.wallet;
}

async function run() {
  if (!USER_TOKEN || !ADMIN_TOKEN) {
    console.error('Set USER_TOKEN and ADMIN_TOKEN env vars before running.');
    process.exit(1);
  }

  // 1) seed
  await seedBalance(1000);

  // 2) fire N concurrent reserves
  const N = 8;
  const amountEach = 300; // 8*300 = 2400 > 1000 - only few should succeed
  console.log(`Running ${N} concurrent reserves of ${amountEach} each...`);
  const promises = [];
  for (let i = 0; i < N; i++) promises.push(reserve(amountEach));
  const results = await Promise.all(promises);

  console.log('Results:');
  results.forEach((r, idx) => {
    console.log(idx + 1, r.ok ? JSON.stringify(r.data) : JSON.stringify(r.error));
  });

  // 3) final wallet state
  const wallet = await getWallet();
  console.log('Final wallet:', wallet);
}
run().catch(err => { console.error(err); process.exit(1); });
