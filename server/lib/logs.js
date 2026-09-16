/**
 * Cloud Logging query layer.
 *
 * Uses @google-cloud/logging's getEntries() with a UI-built filter expression.
 * Returns a uniform shape regardless of whether the underlying entry has
 * textPayload, jsonPayload, or protoPayload.
 */

const { Logging } = require('@google-cloud/logging');

const { buildFilter } = require('./filter-builder');

let cachedLogging = null;
function getLogging(projectId) {
    if (!cachedLogging) {
        cachedLogging = new Logging({ projectId });
    }
    return cachedLogging;
}

/**
 * @param {object} opts
 * @param {string} opts.projectId
 * @param {string[]} opts.functionNames
 * @param {number} opts.minutesAgo
 * @param {string|null} opts.severityMin
 * @param {string} opts.freeText
 * @param {number} opts.limit
 */
async function queryLogs(opts) {
    const filter = buildFilter(opts);
    const logging = getLogging(opts.projectId);

    const [entries] = await logging.getEntries({
        filter,
        orderBy: 'timestamp desc',
        pageSize: opts.limit,
        autoPaginate: false
    });

    return {
        filter,
        count: entries.length,
        entries: entries.map(toEntrySummary)
    };
}

/** Flatten a LogEntry into something the UI can render directly. */
function toEntrySummary(entry) {
    const meta = entry.metadata || {};
    const data = entry.data;

    const isJson = data && typeof data === 'object' && !Buffer.isBuffer(data);
    const textPayload = !isJson && data != null ? String(data) : null;
    const jsonPayload = isJson ? data : null;

    const severity = meta.severity || 'DEFAULT';
    const timestamp = meta.timestamp || null;

    const resourceType =
        (meta.resource && meta.resource.type) || null;
    const resourceLabels =
        (meta.resource && meta.resource.labels) || {};
    // Either gen2 (service_name) or gen1 (function_name).
    const functionName =
        resourceLabels.service_name || resourceLabels.function_name || null;

    return {
        insert_id: meta.insertId || null,
        timestamp: timestamp ? String(timestamp) : null,
        severity,
        function_name: functionName,
        resource_type: resourceType,
        labels: meta.labels || {},
        text_payload: textPayload,
        json_payload: jsonPayload,
        // Short "message" the UI shows in the row. Prefer jsonPayload.message
        // (Node's console.log when logging an object via JSON.stringify with a
        // "message" field), then textPayload, then fall back to severity tag.
        message:
            (jsonPayload &&
                (jsonPayload.message ||
                    jsonPayload.error_message ||
                    summarizeJson(jsonPayload))) ||
            textPayload ||
            `[${severity}]`
    };
}

/** Best-effort 1-line preview of a JSON payload when there's no `message` field. */
function summarizeJson(obj) {
    try {
        const s = JSON.stringify(obj);
        return s.length > 160 ? s.slice(0, 160) + '…' : s;
    } catch (_e) {
        return '[object]';
    }
}

module.exports = { queryLogs };