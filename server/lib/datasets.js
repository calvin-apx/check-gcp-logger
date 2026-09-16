/**
 * Raw BigQuery dataset / table browser.
 *
 * Separate from tables.js on purpose. That file serves *curated* views: a fixed
 * allowlist of tables, each with hand-written display columns, filters and time
 * windows. It cannot describe the GA4 export datasets, whose tables are
 * date-sharded (events_20260907, events_intraday_20260908, …) — the names are
 * not knowable ahead of time, so an allowlist is the wrong shape.
 *
 * This module lists what is actually there and previews any of it.
 *
 * ── Why this never runs a query ────────────────────────────────────────────
 * Rows come from tabledata.list (`table.getRows`), not from SQL. That reads the
 * stored rows directly and is NOT billed, where `SELECT * FROM events_* LIMIT 50`
 * is billed on bytes scanned and a GA4 export table is easily tens of GB. A
 * browse tool where clicking a table can cost money is a bad tool.
 *
 * The trade is real and worth stating: no WHERE, no ORDER BY, no aggregation.
 * Rows arrive in storage order. Use the Tables tab (curated, SQL-backed) when
 * you need to filter, and the copy-as-bq button here when you need real SQL.
 */

const { BigQuery } = require('@google-cloud/bigquery');

const MAX_PREVIEW_ROWS = 200;

let cached = null;

function client(projectId) {
    if (!cached) cached = new BigQuery({ projectId });
    return cached;
}

/**
 * Every dataset in the project, tagged with the family it belongs to so the UI
 * can group them rather than showing one flat list of a dozen opaque numbers.
 *
 *   ga4_export     analytics_123456789      — raw GA4 BigQuery export, per property
 *   client         analytics_client_toast…  — curated per-tenant analytics
 *   motenasu       motenasu_test07          — per-tenant CRM mirror
 *   other          anything else
 */
function classify(id) {
    if (/^analytics_client_/.test(id)) return 'client';
    if (/^analytics_\d+$/.test(id)) return 'ga4_export';
    if (/^motenasu_/.test(id)) return 'motenasu';
    return 'other';
}

/**
 * Families this browser surfaces.
 *
 * The project holds 55 datasets, but only these two are GA4 analytics data:
 * the raw per-property exports and the curated per-tenant sets. The other 44
 * (motenasu_* CRM mirrors, access logs, and assorted one-offs) are noise in a
 * GA4 tool and drowned the nine that matter.
 *
 * Widen this array to show more; nothing else needs to change.
 */
const VISIBLE_KINDS = ['ga4_export', 'client'];

async function listDatasets(projectId) {
    const [datasets] = await client(projectId).getDatasets();

    const all = datasets
        .map((d) => d.id || '')
        .filter(Boolean)
        .map((id) => ({ id, kind: classify(id) }));

    const rows = all
        .filter((d) => VISIBLE_KINDS.includes(d.kind))
        .sort((a, b) => (a.kind === b.kind ? a.id.localeCompare(b.id) : a.kind.localeCompare(b.kind)));

    return {
        project: projectId,
        count: rows.length,
        // Reported so the UI can say what is being withheld rather than making
        // the project look smaller than it is.
        hidden_count: all.length - rows.length,
        visible_kinds: VISIBLE_KINDS,
        datasets: rows
    };
}

/**
 * Tables in one dataset, newest first.
 *
 * GA4 export datasets carry one table per day plus an intraday table, so a
 * dataset with two years of history has ~700 entries and the ones anybody wants
 * are the most recent. Sorting by name descending puts events_20260908 above
 * events_20240101 without a metadata round-trip per table.
 */
async function listDatasetTables({ projectId, datasetId, limit = 500 }) {
    const [tables] = await client(projectId).dataset(datasetId).getTables();

    const rows = tables
        .map((t) => ({
            id: t.id,
            kind: (t.metadata && t.metadata.type) || 'TABLE'
        }))
        .sort((a, b) => b.id.localeCompare(a.id))
        .slice(0, limit);

    return { project: projectId, dataset: datasetId, count: rows.length, tables: rows };
}

/**
 * Schema + physical stats for one table, without reading any rows.
 * Cheap: a single metadata call, no scan.
 */
async function describeTable({ projectId, datasetId, tableId }) {
    const [metadata] = await client(projectId).dataset(datasetId).table(tableId).getMetadata();

    const fields = (metadata.schema && metadata.schema.fields) || [];

    return {
        project: projectId,
        dataset: datasetId,
        table: tableId,
        type: metadata.type || 'TABLE',
        num_rows: metadata.numRows != null ? Number(metadata.numRows) : null,
        size_bytes: metadata.numBytes != null ? Number(metadata.numBytes) : null,
        created: metadata.creationTime ? new Date(Number(metadata.creationTime)).toISOString() : null,
        modified: metadata.lastModifiedTime ? new Date(Number(metadata.lastModifiedTime)).toISOString() : null,
        partitioning: metadata.timePartitioning || null,
        clustering: metadata.clustering || null,
        // Flattened to top-level names only. GA4 export rows nest heavily
        // (event_params is an array of structs); the UI renders a cell's full
        // shape on expand rather than trying to spread it across columns.
        fields: fields.map((f) => ({ name: f.name, type: f.type, mode: f.mode || 'NULLABLE' }))
    };
}

/**
 * A page of rows straight from storage. Free, unfiltered, storage-ordered.
 *
 * `startIndex` pages forward. BigQuery accepts it as a string for tables past
 * 2^53 rows, which GA4 exports do not reach, but it is passed through as given
 * rather than coerced to a JS number.
 */
async function previewTable({ projectId, datasetId, tableId, limit = 50, startIndex = 0 }) {
    const maxResults = Math.min(Math.max(parseInt(limit, 10) || 50, 1), MAX_PREVIEW_ROWS);

    const table = client(projectId).dataset(datasetId).table(tableId);

    const [rows] = await table.getRows({
        maxResults,
        startIndex: String(startIndex || 0)
    });

    // Column order comes from the schema, not from Object.keys of the first row:
    // a nullable column absent from row 0 would otherwise never get a column.
    const [metadata] = await table.getMetadata();
    const fields = ((metadata.schema && metadata.schema.fields) || []).map((f) => f.name);

    const nextIndex = rows.length === maxResults ? Number(startIndex || 0) + rows.length : null;

    return {
        project: projectId,
        dataset: datasetId,
        table: tableId,
        count: rows.length,
        fields,
        next_index: nextIndex,
        billed: false,
        // Wrapped, not passed bare: Array.map hands the callback (value, index,
        // array), so `rows.map(normalise)` feeds the row index in as `depth` and
        // every row from index 20 on trips the recursion guard.
        rows: rows.map((r) => normalise(r))
    };
}

/**
 * BigQuery hands back its own wrappers for a few types — BigQueryTimestamp,
 * BigQueryDate, Big (numeric) — which JSON.stringify renders as `{"value": …}`
 * or loses precision on. Unwrap to the string form the API already carries, and
 * leave the nested shape alone so an expanded cell shows the real structure.
 */
function normalise(value, depth = 0) {
    if (value == null) return null;
    // Only ever call this as normalise(v) or normalise(v, depth + 1). Passing it
    // straight to Array.map silently turns the element index into the depth.
    if (!Number.isInteger(depth) || depth < 0) depth = 0;
    if (depth > 20) return '[…depth limit]';

    if (typeof value === 'object' && typeof value.value !== 'undefined' && Object.keys(value).length === 1) {
        return value.value;
    }
    if (Array.isArray(value)) {
        return value.map((v) => normalise(v, depth + 1));
    }
    if (typeof value === 'object') {
        const out = {};
        for (const [k, v] of Object.entries(value)) out[k] = normalise(v, depth + 1);
        return out;
    }
    return value;
}

module.exports = { listDatasets, listDatasetTables, describeTable, previewTable, MAX_PREVIEW_ROWS };
