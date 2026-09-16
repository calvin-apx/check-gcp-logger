/**
 * Thin client for the Express backend. Throws on non-2xx so callers can surface
 * the server's error message (and `hint` if present) without parsing twice.
 */

async function request(path, options = {}) {
    const res = await fetch(path, options);
    let body;
    try {
        body = await res.json();
    } catch (_e) {
        body = { error: 'invalid_response', message: 'Server returned non-JSON response.' };
    }
    if (!res.ok) {
        const err = new Error(body.message || `HTTP ${res.status}`);
        err.status = res.status;
        err.body = body;
        throw err;
    }
    return body;
}

export function fetchHealth() {
    return request('/api/health');
}

export function fetchFunctions() {
    return request('/api/functions');
}

export function fetchFocusConfig() {
    return request('/api/focus-config');
}

export function fetchPhoneStatus() {
    return request('/api/phone/status');
}

/**
 * POST a JPEG/PNG Blob as the current phone-mirror frame. Sends the trigger
 * token if one is stored, same as runSchedulerJob.
 */
export async function uploadPhoneFrame(blob) {
    const headers = { 'Content-Type': blob.type || 'image/jpeg' };
    const token = (typeof localStorage !== 'undefined') ? localStorage.getItem('triggerToken') : null;
    if (token) headers['X-Trigger-Token'] = token;
    const res = await fetch('/api/phone/frame', {
        method: 'POST',
        body: blob,
        headers
    });
    let body;
    try { body = await res.json(); } catch (_e) { body = {}; }
    if (!res.ok) {
        const err = new Error(body.message || `HTTP ${res.status}`);
        err.status = res.status;
        err.body = body;
        throw err;
    }
    return body;
}

/**
 * @param {object} params
 * @param {string[]} params.functionNames
 * @param {number} params.minutesAgo
 * @param {string|null} params.severityMin
 * @param {string} params.freeText
 * @param {number} params.limit
 */
export function fetchLogs(params) {
    return request('/api/logs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params)
    });
}

export function fetchTableList(clientId) {
    const params = clientId ? `?client=${encodeURIComponent(clientId)}` : '';
    return request(`/api/tables${params}`);
}

/** Tenants that can be inspected — every analytics_client_* dataset in the project. */
export function fetchClients() {
    return request('/api/clients');
}

export function fetchSchedulerJobs() {
    return request('/api/scheduler/jobs');
}

/**
 * Force-run a scheduler job. If a trigger token is stored in localStorage we
 * include it; the backend gate is only active when TRIGGER_SECRET is set.
 */
export function runSchedulerJob(jobName) {
    const headers = { 'Content-Type': 'application/json' };
    const token = (typeof localStorage !== 'undefined') ? localStorage.getItem('triggerToken') : null;
    if (token) headers['X-Trigger-Token'] = token;
    return request(`/api/scheduler/jobs/${encodeURIComponent(jobName)}/run`, {
        method: 'POST',
        headers
    });
}

/**
 * @param {string} tableName
 * @param {{limit?: number, windowMinutes?: number|null,
 *          filters?: Object<string, string>}} opts
 */
export function fetchTableRows(
    tableName,
    { limit = 200, windowMinutes = null, filters = {}, clientId = null } = {}
) {
    const params = new URLSearchParams({ limit: String(limit) });
    if (clientId) params.set('client', clientId);
    if (windowMinutes) params.set('windowMinutes', String(windowMinutes));
    for (const [col, val] of Object.entries(filters || {})) {
        if (val == null || String(val).trim() === '') continue;
        params.set(`f_${col}`, String(val).trim());
    }
    return request(`/api/tables/${encodeURIComponent(tableName)}?${params}`);
}
// ── Firestore ───────────────────────────────────────────────────────────────

/** Top-level collections in the configured (named) Firestore database. */
export function fetchFirestoreCollections() {
    return request('/api/firestore/collections');
}

/**
 * A page of documents from one collection.
 * @param {string} collection
 * @param {{limit?: number, startAfter?: string|null, orderBy?: string|null,
 *          field?: string|null, value?: string|null}} opts
 */
export function fetchFirestoreDocuments(
    collection,
    { limit = 50, startAfter = null, orderBy = null, field = null, value = null } = {}
) {
    const params = new URLSearchParams({ collection, limit: String(limit) });
    if (startAfter) params.set('startAfter', startAfter);
    if (orderBy) params.set('orderBy', orderBy);
    // Both halves are required for a filter; a field with no value would match
    // the empty string rather than being ignored.
    if (field && value != null && String(value).trim() !== '') {
        params.set('field', field);
        params.set('value', String(value).trim());
    }
    return request(`/api/firestore/documents?${params}`);
}

/** One document by full path, with its subcollections. */
export function fetchFirestoreDocument(path) {
    return request(`/api/firestore/document?path=${encodeURIComponent(path)}`);
}

// ── Raw BigQuery datasets ───────────────────────────────────────────────────
// Separate from fetchTableList/fetchTableRows, which serve the curated views.

export function fetchDatasets() {
    return request('/api/datasets');
}

export function fetchDatasetTables(dataset) {
    return request(`/api/datasets/${encodeURIComponent(dataset)}/tables`);
}

export function fetchTableSchema(dataset, table) {
    return request(`/api/datasets/${encodeURIComponent(dataset)}/tables/${encodeURIComponent(table)}`);
}

/** Rows straight from storage — unbilled, unfiltered, storage-ordered. */
export function fetchDatasetRows(dataset, table, { limit = 50, startIndex = 0 } = {}) {
    const params = new URLSearchParams({ limit: String(limit), startIndex: String(startIndex) });
    return request(
        `/api/datasets/${encodeURIComponent(dataset)}/tables/${encodeURIComponent(table)}/rows?${params}`
    );
}
