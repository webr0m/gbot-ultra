// Namecheap cron runs even while Passenger is stopped. Monitoring and backups run after every attempt.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import {triggerSchedule} from './lib/scheduler-http.mjs';
dotenv.config({ path: path.join(path.dirname(fileURLToPath(import.meta.url)), '../.env'), quiet: true });
const url = new URL('/api/internal/schedule', process.env.WEBAPP_URL);
try {
  const result = await triggerSchedule({
    url,secret:process.env.INTERNAL_CRON_SECRET,
    originIp:process.env.SCHEDULER_ORIGIN_IP,
    caFile:process.env.SCHEDULER_ORIGIN_CA_FILE,
  });
  console.log(new Date().toISOString(), result);
} catch (error) {
  console.error(new Date().toISOString(), error.message);
  process.exitCode = 1;
}
try {
  const {monitorHosting}=await import('./monitor-hosting.mjs');
  await monitorHosting();
}catch{
  console.error(new Date().toISOString(),'Hosting monitor could not finish.');
  process.exitCode=1;
}
