import { jobCriScheduler, jobDispatchScheduler, jobWatcherScheduler } from "./queues/queues.js";
import { jobCriWorker, jobDispatchWorker, jobWatcherWorker } from "./queues/worker.js";

async function init() {
    await Promise.all([
        jobDispatchScheduler.upsertJobScheduler("job-dispatc  h-scheduler", {
            every: 2 * 1000, // 2 seconds
        }),
        jobCriScheduler.upsertJobScheduler("job-cri-scheduler", {
            every: 5 * 1000, // 5 seconds
        }),
        jobWatcherScheduler.upsertJobScheduler("job-watch-scheduler", {
            every: 10 * 1000, // 10 seconds
        })
    ]);
}

init().catch(console.error);
