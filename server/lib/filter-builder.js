/**
 * Build a Cloud Logging filter expression from the UI controls.
 *
 * Cloud Functions gen2 are actually Cloud Run revisions under the hood — their logs
 * carry resource.type="cloud_run_revision" and resource.labels.service_name=<fn>.
 * Gen1 functions carry resource.type="cloud_function" and resource.labels.function_name=<fn>.
 *
 * We always OR both resource shapes so the user picker doesn't need to know the
 * generation — whichever applies will match.
 */

const VALID_SEVERITIES = new Set([
    'DEFAULT',
    'DEBUG',
    'INFO',
    'NOTICE',
    'WARNING',
    'ERROR',
    'CRITICAL',
    'ALERT',
    'EMERGENCY'
]);

/**
 * @param {object} opts
 * @param {string[]} opts.functionNames
 * @param {number} opts.minutesAgo
 * @param {string|null} opts.severityMin  — one of VALID_SEVERITIES or null
 * @param {string} opts.freeText          — substring match against textPayload / jsonPayload.message
 * @returns {string} a Cloud Logging filter expression
 */
function buildFilter({ functionNames, minutesAgo, severityMin, freeText }) {
    const clauses = [];

    // 1. Resource scope: OR across gen1 + gen2 shapes, AND across function names.
    const resourceClauses = functionNames.map((fn) => {
        const escaped = escapeForFilter(fn);
        return (
            '(' +
            `(resource.type="cloud_run_revision" AND resource.labels.service_name="${escaped}")` +
            ' OR ' +
            `(resource.type="cloud_function" AND resource.labels.function_name="${escaped}")` +
            ')'
        );
    });
    if (resourceClauses.length === 1) {
        clauses.push(resourceClauses[0]);
    } else {
        clauses.push('(' + resourceClauses.join(' OR ') + ')');
    }

    // 2. Time range.
    const sinceIso = new Date(Date.now() - minutesAgo * 60 * 1000).toISOString();
    clauses.push(`timestamp >= "${sinceIso}"`);

    // 3. Severity floor.
    if (severityMin && VALID_SEVERITIES.has(severityMin)) {
        clauses.push(`severity >= ${severityMin}`);
    }

    // 4. Free text — match either textPayload or jsonPayload.message.
    if (freeText) {
        const safe = escapeForFilter(freeText);
        clauses.push(
            `(textPayload:"${safe}" OR jsonPayload.message:"${safe}" OR jsonPayload.error_message:"${safe}")`
        );
    }

    return clauses.join('\n');
}

/** Escape double-quotes + backslashes for inclusion inside a "…" filter literal. */
function escapeForFilter(value) {
    return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

module.exports = { buildFilter, VALID_SEVERITIES };