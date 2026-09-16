/**
 * Cloud Functions enumeration.
 *
 * Calls the v2 FunctionService.ListFunctions, which returns both gen1 ("v1" environment)
 * and gen2 ("v2" environment) functions in one response. We surface only the bits the UI
 * needs: name, region, runtime, generation, state, and last-deploy timestamp.
 */

const { FunctionServiceClient } = require('@google-cloud/functions').v2;

let cachedClient = null;
function getClient() {
    if (!cachedClient) {
        cachedClient = new FunctionServiceClient();
    }
    return cachedClient;
}

/**
 * @param {{projectId: string, region: string}} opts
 * @returns {Promise<Array<{name: string, region: string, runtime: string, generation: 'GEN_1'|'GEN_2', state: string, updateTime: string|null}>>}
 */
async function listFunctions({ projectId, region }) {
    const client = getClient();
    const parent = `projects/${projectId}/locations/${region}`;

    // Auto-paginates. PageSize of 100 is the API default and is enough for most projects.
    const [functions] = await client.listFunctions({ parent });

    return functions
        .map(toSummary)
        .sort((a, b) => a.name.localeCompare(b.name));
}

/** Reduce a v2 Function proto down to the fields the UI cares about. */
function toSummary(fn) {
    // fn.name is the full resource path: projects/<p>/locations/<r>/functions/<short>
    const segments = (fn.name || '').split('/');
    const shortName = segments[segments.length - 1] || fn.name;
    const region = segments[3] || null;

    const runtime =
        (fn.buildConfig && fn.buildConfig.runtime) ||
        (fn.serviceConfig && fn.serviceConfig.runtime) ||
        null;

    // v2 API returns environment 'GEN_1' or 'GEN_2'.
    const generation = fn.environment || 'UNKNOWN';

    const state = fn.state || 'UNKNOWN'; // ACTIVE / FAILED / DEPLOYING / DELETING / UNKNOWN

    const updateTime = fn.updateTime
        ? new Date(
              Number(fn.updateTime.seconds || 0) * 1000 +
                  Math.floor(Number(fn.updateTime.nanos || 0) / 1e6)
          ).toISOString()
        : null;

    return {
        name: shortName,
        region,
        runtime,
        generation,
        state,
        update_time: updateTime
    };
}

module.exports = { listFunctions };