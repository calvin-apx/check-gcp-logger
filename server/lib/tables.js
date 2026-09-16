/**
 * BigQuery table preview for the Motenasu exit-delivery pipeline.
 *
 * Each table has a curated column set + display rules + per-table SQL bits
 * (sort, time window, derived columns, filterable columns). The same config
 * is returned to the web UI so rendering rules (truncation, color, merge)
 * stay in lockstep with what the SQL actually returns.
 */

const { BigQuery } = require('@google-cloud/bigquery');

const STATUS_COLORS = {
    COMPLETED: 'green',
    ACCEPTED: 'green',
    SUCCESS: 'green',
    PENDING: 'amber',
    PROCESSING: 'amber',
    SKIPPED: 'gray',
    FAILED: 'red',
    CANCELLED: 'red'
};

const TRUNC_PREFIX_ANON = { prefix: 'anonymous_', length: 16 };

/**
 * Per-table config.
 *   dataset          — BigQuery dataset name
 *   order_by         — { column, direction } or null
 *   time_window      — { column, default_minutes } or null (no time filter)
 *   derived_columns  — extra SELECT expressions appended as `<sql> AS <name>`
 *   filter_columns   — names of columns the UI exposes as quick filters
 *   display_columns  — ordered list shown in the default table view; each may
 *                      carry a `display` block consumed by the React render:
 *                        { truncate: N }              fixed truncate + tooltip+copy
 *                        { conditional_truncate: {…}} truncate only when prefix matches
 *                        { color_status: {…} }        map cell value → color
 *                        { merge: { columns, sep } }  display N source columns as one
 */
/**
 * Default client when the caller does not name one. Every table used to hard-code
 * `analytics_client_toast_lxc03` / `motenasu_toast_lxc03`, so no other tenant could
 * be inspected at all.
 */
const DEFAULT_CLIENT_ID = process.env.DEFAULT_CLIENT_ID || 'toast_lxc03';

/**
 * Resolve the dataset for a table config against a client id.
 *
 * The two dataset families are named differently, and the motenasu_* side carries
 * a quirk the extractor also applies: `testserver` is abbreviated to `test`, so
 * client `testserver07` lives in `motenasu_test07` but `analytics_client_testserver07`.
 * Getting this wrong silently returns "table not found" for every testserver tenant.
 */
function resolveDataset(config, clientId) {
    const id = String(clientId || DEFAULT_CLIENT_ID)
        .toLowerCase()
        .replace(/[^a-z0-9_]+/g, '_')
        .replace(/^_+|_+$/g, '');

    return config.dataset_kind === 'motenasu'
        ? `motenasu_${id.replace('testserver', 'test')}`
        : `analytics_client_${id}`;
}

const TABLE_CONFIGS = {
    BEACON_EVENTS: {
        dataset_kind: 'client',
        order_by: { column: 'event_timestamp', direction: 'DESC' },
        time_window: { column: 'event_timestamp', default_minutes: 120 },
        derived_columns: [
            { name: 'email', sql: "JSON_VALUE(event_params, '$.email')", type: 'STRING' },
            { name: 'phone', sql: "JSON_VALUE(event_params, '$.phone')", type: 'STRING' },
            { name: 'engagement_ms', sql: "JSON_VALUE(event_params, '$.engagement_time_msec')", type: 'STRING' }
        ],
        filter_columns: ['session_id', 'email', 'phone'],
        display_columns: [
            { name: 'event_timestamp', type: 'TIMESTAMP' },
            { name: 'event_name', type: 'STRING' },
            { name: 'session_id', type: 'STRING' },
            { name: 'user_pseudo_id', type: 'STRING', display: { conditional_truncate: TRUNC_PREFIX_ANON } },
            { name: 'page_location', type: 'STRING', display: { truncate: 60 } },
            { name: 'email', type: 'STRING' },
            { name: 'phone', type: 'STRING' },
            { name: 'engagement_ms', type: 'STRING' }
        ]
    },

    EXIT_CANDIDATES: {
        dataset_kind: 'client',
        order_by: { column: 'scheduled_delivery_time', direction: 'ASC' },
        time_window: { column: 'exit_detected_at', default_minutes: 1440 },
        derived_columns: [],
        filter_columns: ['session_id', 'email', 'phone'],
        display_columns: [
            { name: 'candidate_id', type: 'STRING', display: { truncate: 16 } },
            { name: 'delivery_status', type: 'STRING', display: { color_status: STATUS_COLORS } },
            { name: 'rule_id', type: 'INTEGER' },
            { name: 'user_id', type: 'STRING', display: { conditional_truncate: TRUNC_PREFIX_ANON } },
            { name: 'session_id', type: 'STRING' },
            { name: 'email', type: 'STRING' },
            { name: 'phone', type: 'STRING' },
            { name: 'exit_detected_at', type: 'TIMESTAMP' },
            { name: 'scheduled_delivery_time', type: 'TIMESTAMP' },
            { name: 'processed_at', type: 'TIMESTAMP' },
            { name: 'stay_time_seconds', type: 'INTEGER' },
            { name: 'last_page_url', type: 'STRING', display: { truncate: 60 } },
            { name: 'delivery_batch_id', type: 'STRING' },
            { name: 'created_at', type: 'TIMESTAMP' }
        ]
    },

    DELIVERY_FREQUENCY_CONTROL: {
        dataset_kind: 'client',
        order_by: { column: 'last_delivery_at', direction: 'DESC' },
        time_window: null,
        derived_columns: [],
        filter_columns: [],
        display_columns: [
            { name: 'user_id', type: 'STRING', display: { conditional_truncate: TRUNC_PREFIX_ANON } },
            { name: 'rule_id', type: 'INTEGER' },
            { name: 'delivery_count_total', type: 'INTEGER' },
            { name: 'delivery_count_today', type: 'INTEGER' },
            { name: 'delivery_count_this_week', type: 'INTEGER' },
            { name: 'delivery_count_this_month', type: 'INTEGER' },
            { name: 'last_delivery_at', type: 'TIMESTAMP' },
            { name: 'updated_at', type: 'TIMESTAMP' }
        ]
    },

    DELIVERY_HISTORY: {
        dataset_kind: 'client',
        order_by: { column: 'created_at', direction: 'DESC' },
        time_window: { column: 'created_at', default_minutes: 1440 },
        derived_columns: [],
        filter_columns: [],
        display_columns: [
            { name: 'delivery_batch_id', type: 'STRING' },
            { name: 'candidate_id', type: 'STRING', display: { truncate: 16 } },
            { name: 'channel_type', type: 'STRING' },
            { name: 'template_id', type: 'STRING' },
            { name: 'delivery_status', type: 'STRING', display: { color_status: STATUS_COLORS } },
            { name: 'scheduled_at', type: 'TIMESTAMP' },
            { name: 'created_at', type: 'TIMESTAMP' }
        ]
    },

    // The channel/template rows a rule fans out to. exit-candidate-extractor joins
    // this to decide which channels a candidate is delivered on, so a rule that
    // "does nothing" is usually explained here rather than in the rule itself.
    LATEST_EXIT_DELIVERY_CHANNEL_VIEW: {
        dataset_kind: 'motenasu',
        order_by: { column: 'EXIT_DELIVERY_RULE_ID', direction: 'ASC' },
        time_window: null,
        derived_columns: [],
        filter_columns: ['EXIT_DELIVERY_RULE_ID', 'CHANNEL_TYPE'],
        display_columns: [
            { name: 'EXIT_DELIVERY_RULE_ID', type: 'INTEGER' },
            { name: 'CHANNEL_TYPE', type: 'STRING' },
            { name: 'IS_ENABLED', type: 'BOOLEAN' },
            { name: 'TEMPLATE_ID', type: 'INTEGER' },
            { name: 'TEMPLATE_NAME', type: 'STRING', display: { truncate: 40 } },
            { name: 'SORT_ORDER', type: 'INTEGER' },
            { name: 'DELETE_FLAG', type: 'BOOLEAN' },
            { name: 'UPDATED_AT', type: 'DATETIME' }
        ]
    },

    // Per-client configuration: which GA4 property, which plan, and the limits that
    // gate ingestion. First place to look when a client "isn't tracking".
    // analysis_token is deliberately not surfaced — it is a credential.
    SITE_SETTINGS: {
        dataset_kind: 'client',
        order_by: { column: 'updated_at', direction: 'DESC' },
        time_window: null,
        derived_columns: [],
        filter_columns: ['client_id'],
        display_columns: [
            { name: 'client_id', type: 'STRING' },
            { name: 'site_id', type: 'INTEGER' },
            { name: 'active', type: 'BOOLEAN' },
            { name: 'measurement_id', type: 'STRING' },
            { name: 'ga4_dataset_id', type: 'STRING' },
            { name: 'plan_type', type: 'STRING' },
            { name: 'monthly_events_limit', type: 'INTEGER' },
            { name: 'rate_limit', type: 'INTEGER' },
            { name: 'alert_at_percentage', type: 'INTEGER' },
            { name: 'stop_at_percentage', type: 'INTEGER' },
            { name: 'auto_recovery', type: 'BOOLEAN' },
            { name: 'client_email', type: 'STRING' },
            { name: 'updated_at', type: 'TIMESTAMP' }
        ]
    },

    LATEST_EXIT_DELIVERY_RULE_VIEW: {
        dataset_kind: 'motenasu',
        order_by: { column: 'ID', direction: 'ASC' },
        time_window: null,
        derived_columns: [],
        filter_columns: [],
        display_columns: [
            { name: 'ID', type: 'INTEGER' },
            { name: 'RULE_NAME', type: 'STRING' },
            { name: 'IS_ACTIVE', type: 'BOOLEAN' },
            { name: 'SITE_ID', type: 'INTEGER' },
            { name: 'FREQUENCY', type: 'STRING' },
            { name: 'MAX_DELIVERY_COUNT', type: 'INTEGER' },
            {
                name: 'WAIT_TIME',
                type: 'STRING',
                display: { merge: { columns: ['WAIT_TIME_VALUE', 'WAIT_TIME_UNIT'], separator: ' ' } }
            },
            { name: 'MIN_STAY_TIME_SECONDS', type: 'INTEGER' },
            { name: 'CV_EVENT_NAME', type: 'STRING' },
            { name: 'TIME_START_HOUR', type: 'INTEGER' },
            { name: 'TIME_END_HOUR', type: 'INTEGER' }
        ]
    }
};

const ALLOWED_TABLES = Object.keys(TABLE_CONFIGS);

const MAX_LIMIT = 1000;
const DEFAULT_LIMIT = 200;

let cachedClient = null;
function getClient(projectId) {
    if (!cachedClient) {
        cachedClient = new BigQuery({ projectId });
    }
    return cachedClient;
}

/**
 * Every tenant that has an analytics_client_* dataset, newest naming first.
 * Drives the client selector so the table views are no longer pinned to one tenant.
 */
async function listClients(projectId) {
    const [datasets] = await getClient(projectId).getDatasets();

    const clients = datasets
        .map((d) => d.id || '')
        .filter((id) => id.startsWith('analytics_client_'))
        .map((id) => id.replace('analytics_client_', ''))
        .sort();

    return { default_client_id: DEFAULT_CLIENT_ID, clients };
}

/** List the configured tables (no row data). UI uses this for the picker + initial config. */
function listTables(clientId) {
    return {
        client_id: clientId || DEFAULT_CLIENT_ID,
        tables: ALLOWED_TABLES.map((name) => {
            const c = TABLE_CONFIGS[name];
            return {
                name,
                dataset: resolveDataset(c, clientId),
                dataset_kind: c.dataset_kind,
                order_by: c.order_by,
                time_window: c.time_window,
                filter_columns: c.filter_columns,
                display_columns: c.display_columns
            };
        })
    };
}

/**
 * @param {{projectId: string, tableName: string, limit?: number,
 *          windowMinutes?: number|null,
 *          filters?: Array<{column: string, value: string}>|null}} opts
 */
async function previewTable({ projectId, tableName, limit, windowMinutes, filters, clientId }) {
    const config = TABLE_CONFIGS[tableName];
    if (!config) {
        const err = new Error(`Table "${tableName}" is not in the allowlist.`);
        err.code = 'TABLE_NOT_ALLOWED';
        throw err;
    }

    const safeLimit = Math.max(1, Math.min(MAX_LIMIT, Math.floor(Number(limit) || DEFAULT_LIMIT)));

    const client = getClient(projectId);
    const dataset = resolveDataset(config, clientId);
    const table = client.dataset(dataset).table(tableName);

    const [metadata] = await table.getMetadata();
    const schemaFields = (metadata.schema && metadata.schema.fields) || [];

    // Time window goes in the inner SELECT (so partition pruning still applies
    // for partitioned tables). Filters go in the outer SELECT so they can
    // reference derived column aliases like `email` and `phone`.
    const derivedExprs = (config.derived_columns || [])
        .map((d) => `${d.sql} AS \`${d.name}\``)
        .join(', ');
    const innerSelect = derivedExprs ? `*, ${derivedExprs}` : '*';

    const innerWhere = [];
    if (config.time_window && windowMinutes && windowMinutes > 0) {
        const m = Math.max(1, Math.min(60 * 24 * 30, Math.floor(Number(windowMinutes))));
        innerWhere.push(
            `\`${config.time_window.column}\` >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL ${m} MINUTE)`
        );
    }

    const outerWhere = [];
    const params = {};
    const types = {};
    const appliedFilters = [];

    if (Array.isArray(filters)) {
        let idx = 0;
        for (const f of filters) {
            if (!f || !f.column || f.value == null || String(f.value).trim() === '') continue;
            if (!config.filter_columns.includes(f.column)) {
                const err = new Error(`Column "${f.column}" is not filterable on ${tableName}.`);
                err.code = 'COLUMN_NOT_FILTERABLE';
                throw err;
            }
            const paramName = `f_${idx++}`;
            outerWhere.push(`\`${f.column}\` = @${paramName}`);
            params[paramName] = String(f.value).trim();
            types[paramName] = 'STRING';
            appliedFilters.push({ column: f.column, value: String(f.value).trim() });
        }
    }

    const innerSql =
        `SELECT ${innerSelect} FROM \`${projectId}.${dataset}.${tableName}\`` +
        (innerWhere.length ? ` WHERE ${innerWhere.join(' AND ')}` : '');

    let sql = `SELECT * FROM (${innerSql}) AS t`;
    if (outerWhere.length) sql += ` WHERE ${outerWhere.join(' AND ')}`;
    if (config.order_by) {
        sql += ` ORDER BY \`${config.order_by.column}\` ${config.order_by.direction}`;
    }
    sql += ` LIMIT ${safeLimit}`;

    const [rows] = await client.query({ query: sql, params, types });

    const fullSchema = [
        ...schemaFields.map((f) => ({ name: f.name, type: f.type, mode: f.mode || 'NULLABLE' })),
        ...(config.derived_columns || []).map((d) => ({ name: d.name, type: d.type || 'STRING', mode: 'NULLABLE' }))
    ];

    return {
        dataset,
        client_id: clientId || DEFAULT_CLIENT_ID,
        table: tableName,
        total_rows: Number(metadata.numRows || 0),
        order_by: config.order_by,
        time_window: config.time_window,
        window_minutes: config.time_window ? (windowMinutes || config.time_window.default_minutes) : null,
        filters: appliedFilters,
        limit: safeLimit,
        display_columns: config.display_columns,
        filter_columns: config.filter_columns,
        schema: fullSchema,
        rows: rows.map((r) => normalizeRow(r, fullSchema))
    };
}

function normalizeRow(row, schemaFields) {
    const out = {};
    for (const field of schemaFields) {
        out[field.name] = normalizeValue(row[field.name]);
    }
    return out;
}

function normalizeValue(v) {
    if (v === null || v === undefined) return null;
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return v;
    if (typeof v === 'bigint') return v.toString();
    if (typeof v === 'object' && 'value' in v && typeof v.value !== 'object') return v.value;
    if (Array.isArray(v)) return v.map(normalizeValue);
    if (typeof v === 'object') {
        const out = {};
        for (const k of Object.keys(v)) out[k] = normalizeValue(v[k]);
        return out;
    }
    return String(v);
}

module.exports = { listTables, listClients, previewTable, resolveDataset, ALLOWED_TABLES, MAX_LIMIT, DEFAULT_CLIENT_ID };
