// Trigger restart
// apmoney/index.js
import http from 'http';
import app from './app.js';
import dotenv from 'dotenv';
import { initSocket } from './realTime/socket.js';
import { initializeSuperAdminWallet } from './services/superAdminWalletService.js';
import { startCrons } from './cron/cronManager.js';
dotenv.config();

const PORT = Number(process.env.PORT || 4001);

const httpServer = http.createServer(app);

(async () => { 
  try {   
    // attach sockets
    await initSocket(httpServer);

    httpServer.listen(PORT, async () => {
      console.log(`Server running on port ${PORT} — env=${process.env.NODE_ENV || 'dev'}`);

      // Initialize super admin wallet
      try {
        await initializeSuperAdminWallet();
        console.log('Super admin wallet initialized');
      } catch (err) {
        console.error('Failed to initialize super admin wallet:', err.message);
      }

      // Start cron jobs
      try {
        startCrons();
      } catch (err) {
        console.error('Failed to start cron jobs:', err.message);
      }
    });
  } catch (err) {
    console.error('server bootstrap error', { err: err.stack || err.message });
    process.exit(1);
  }
})();
