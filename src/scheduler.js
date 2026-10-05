'use strict';

const cron = require('node-cron');
const { getConfig } = require('./configStore');
const { runAllProjects } = require('./diffRunner');

let currentTask = null;

/**
 * Starts the cron scheduler using the schedule from config.
 * If a task is already running it is destroyed and replaced.
 */
function start() {
  const config = getConfig();
  const schedule = config.schedule || '0 8 * * *';

  if (!cron.validate(schedule)) {
    console.warn(`[Scheduler] Invalid cron expression "${schedule}" — scheduler not started.`);
    return;
  }

  if (currentTask) {
    currentTask.destroy();
  }

  currentTask = cron.schedule(schedule, async () => {
    console.log(`[Scheduler] Cron triggered at ${new Date().toISOString()}`);
    await runAllProjects();
  });

  console.log(`[Scheduler] Started with schedule: "${schedule}"`);
}

/**
 * Replaces the running cron task with a new schedule.
 * Called by the config route when the schedule is updated via the GUI.
 * @param {string} newSchedule
 */
function reschedule(newSchedule) {
  if (!cron.validate(newSchedule)) {
    throw new Error(`Invalid cron expression: "${newSchedule}"`);
  }
  if (currentTask) {
    currentTask.destroy();
  }
  currentTask = cron.schedule(newSchedule, async () => {
    console.log(`[Scheduler] Cron triggered at ${new Date().toISOString()}`);
    await runAllProjects();
  });
  console.log(`[Scheduler] Rescheduled to: "${newSchedule}"`);
}

module.exports = { start, reschedule };
