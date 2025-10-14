import { query } from '../config/db.js';

async function createTestTransactions() {
  try {
    await query(`
      INSERT INTO transactions (txn_ref, user_id, mobile, operator_code, amount, service_charge, status, provider_txn_id, created_at, updated_at)
      VALUES
      ('day17-order-001', 3, '9000000001', 'OP01', 102.00, 0.00, 'success', 'prov-1001', NOW(), NOW()),
      ('day17-order-002', 5, '9000000002', 'OP01', 50.00, 0.00, 'pending', 'prov-1002', NOW(), NOW())
      ON DUPLICATE KEY UPDATE txn_ref = txn_ref;
    `);
    console.log('Test transactions created or already exist.');
  } catch (err) {
    console.error('Error creating test transactions:', err);
  }
}

createTestTransactions();