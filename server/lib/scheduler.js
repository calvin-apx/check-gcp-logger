/**
 * Cloud Scheduler — list jobs and trigger them on demand.
 *
 * Uses Application Default Credentials, same as the BigQuery and Cloud
 * Functions clients elsewhere in this project.
 */

const { CloudSchedulerClient } = require('@google-cloud/scheduler');

let cachedClient = null;
function getClient() {
    if (!cachedClient) {
        cachedClient = new CloudSchedulerClient();
    }
    return cachedClient;
}

/**
 * @param {{projectId: string, region: string}} opts
 */
async function listJobs({ projectId, region }) {
    const client = getClient();
    const parent = `projects/${projectId}/locations/${region}`;
    const [jobs] = await client.listJobs({ parent });
    return jobs.map(toSummary).sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * @param {{projectId: string, region: string, jobName: string}} opts
 */
async function runJob({ projectId, region, jobName }) {
    const client = getClient();
    const name = `projects/${projectId}/locations/${region}/jobs/${jobName}`;
    const [job] = await client.runJob({ name });
    return toSummary(job);
}

/** Reduce a Job proto to the bits the UI cares about. */
function toSummary(job) {
    // job.name = projects/<p>/locations/<r>/jobs/<short>
    const segments = (job.name || '').split('/');
    const shortName = segments[segments.length - 1] || job.name;

    let targetType = 'unknown';
    let targetUrl = null;
    if (job.httpTarget) {
        targetType = 'HTTP';
        targetUrl = job.httpTarget.uri || null;
    } else if (job.pubsubTarget) {
        targetType = 'Pub/Sub';
        targetUrl = job.pubsubTarget.topicName || null;
    } else if (job.appEngineHttpTarget) {
        targetType = 'AppEngine';
        const t = job.appEngineHttpTarget;
        targetUrl = (t.relativeUri || '/') + (t.appEngineRouting && t.appEngineRouting.service ? ` (service=${t.appEngineRouting.service})` : '');
    }

    return {
        name: shortName,
        schedule: job.schedule || null,
        time_zone: job.timeZone || null,
        state: job.state || 'STATE_UNSPECIFIED',
        description: job.description || null,
        last_attempt_time: protoTimestampToIso(job.lastAttemptTime),
        user_update_time: protoTimestampToIso(job.userUpdateTime),
        target_type: targetType,
        target_url: targetUrl
    };
}

function protoTimestampToIso(ts) {
    if (!ts) return null;
    const seconds = Number(ts.seconds || 0);
    const nanos = Number(ts.nanos || 0);
    if (!seconds && !nanos) return null;
    return new Date(seconds * 1000 + Math.floor(nanos / 1e6)).toISOString();
}

module.exports = { listJobs, runJob };
