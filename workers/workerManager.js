// src/workers/workerManager.js
import { createRechargeWorker } from './rechargeWorker.js';
import { createNotificationWorker } from './notificationWorker.js';
let instances = [];

export function startWorkers(){
  const recharge = createRechargeWorker();
  const notif = createNotificationWorker();
  instances.push(recharge, notif);
  return instances;
}

export async function stopWorkers() {
  // Graceful stop
  for (const inst of instances) {
    try {
      if (inst.worker) await inst.worker.close(); // stops processing new jobs
      if (inst.scheduler) await inst.scheduler.close();
    } catch (e) {
      console.error('Error stopping worker', e);
    }
  }
  instances = [];
}
