import assert from 'assert';
import axios from 'axios';
import { getPool } from '../config/db.js';

describe('Reconciliation dry-run', function() {
  this.timeout(20000);

  it('uploads sample settlement and processes it', async () => {
    // 1. create test transactions (use DB)
    const pool = getPool();
    await pool.execute(`INSERT INTO transactions (txn_ref, user_id, mobile, operator_code, amount, service_charge, status, provider_txn_id, created_at, updated_at)
      VALUES ('day17-order-001', 3, '9000000001', 'OP01', 102.00, 0, 'success', 'prov-1001', NOW(), NOW())`);
    await pool.execute(`INSERT INTO transactions (txn_ref, user_id, mobile, operator_code, amount, service_charge, status, provider_txn_id, created_at, updated_at)
      VALUES ('day17-order-002', 5, '9000000002', 'OP01', 50.00, 0, 'pending', 'prov-1002', NOW(), NOW())`);

    // 2. upload file (you may use supertest; here demonstration with axios multipart)
    const FormData = (await import('form-data')).default;
    const fs = (await import('fs')).promises;
    const form = new FormData();
    form.append('provider_id', 'mock');
    form.append('file', await fs.readFile('./sample_settlement.csv'), 'sample_settlement.csv');

    const res = await axios.post('http://localhost:4001/api/admin/reconciliation/upload', form, {
      headers: { ...form.getHeaders(), Authorization: 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VyX2lkIjo2LCJyb2xlIjoiYWRtaW4iLCJwaG9uZSI6Iis5MTk5OTk5OTk5OTkiLCJqdGkiOiIxNzU5OTA1NjE4OTgzOng4eWQ3YiIsImlhdCI6MTc1OTkwNTYxOCwiZXhwIjoxNzU5OTQ4ODE4fQ._8WpFNCuoiQVWymlpmWVZ4KK3Jm9AxteCiBen51lvyo' },
      maxContentLength: Infinity
    });
    assert(res.data.ok, 'upload ok');

    // Option: poll provider_settlement_files and reconciliation_reports to confirm processing
    // wait and poll loop...
  });
});