/**
 * check-gcp-logger — local server.
 *
 * Reads ADC credentials, exposes a small HTTP API that the web UI calls into:
 *   GET  /api/health      — sanity check
 *   GET  /api/functions   — list Cloud Functions in the configured project/region
 *   POST /api/logs        — query Cloud Logging with a UI-driven filter
 *
 * No persistence; every request is forwarded to GCP and returned raw-ish.
 */

const path = require('path');
const dotenv = require('dotenv');

// Load .env from the project root (one level up from server/).
dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

const express = require('express');
const cors = require('cors');

const { listFunctions } = require('./lib/functions');
const { queryLogs } = require('./lib/logs');
const { listTables, listClients, previewTable } = require('./lib/tables');
const { listJobs, runJob } = require('./lib/scheduler');
const {
    listCollections,
    listDocuments,
    getDocument
} = require('./lib/firestore');
const {
    listDatasets,
    listDatasetTables,
    describeTable,
    previewTable: previewRawTable
} = require('./lib/datasets');
const focusConfig = require('./focusConfig');

const PROJECT_ID = process.env.GCP_PROJECT_ID;
const REGION = process.env.GCP_REGION || 'asia-northeast1';
// The GA4 project does not use the (default) Firestore database — everything
// lives in a named one. Override in .env to browse a different database.
const FIRESTORE_DATABASE_ID = process.env.FIRESTORE_DATABASE_ID || 'ga4-analytics-db-dev';
const PORT = parseInt(process.env.PORT || '4000', 10);
const MAX_LOG_ENTRIES_PER_QUERY = parseInt(process.env.MAX_LOG_ENTRIES_PER_QUERY || '500', 10);
const TRIGGER_SECRET = (process.env.TRIGGER_SECRET || '').trim();

if (!TRIGGER_SECRET) {
    console.warn(
        '[check-gcp-logger] TRIGGER_SECRET not set — /api/scheduler/jobs/:name/run is OPEN. ' +
        'Set TRIGGER_SECRET in .env before exposing the app via ngrok.'
    );
}

if (!PROJECT_ID) {
    console.error('Missing GCP_PROJECT_ID in .env — copy .env.example to .env and set it.');
    process.exit(1);
}

const app = express();
app.use(cors());
app.use(express.json({ limit: '256kb' }));

app.get('/api/health', (req, res) => {
    res.json({
        ok: true,
        project: PROJECT_ID,
        region: REGION,
        firestore_database: FIRESTORE_DATABASE_ID,
        max_log_entries_per_query: MAX_LOG_ENTRIES_PER_QUERY
    });
});

app.get('/api/functions', async (req, res) => {
    try {
        const functions = await listFunctions({ projectId: PROJECT_ID, region: REGION });
        res.json({ project: PROJECT_ID, region: REGION, count: functions.length, functions });
    } catch (err) {
        console.error('GET /api/functions error:', err);
        res.status(500).json({
            error: 'list_functions_failed',
            message: err.message,
            hint: errorHint(err)
        });
    }
});

app.post('/api/logs', async (req, res) => {
    try {
        const {
            functionNames = [],
            minutesAgo = 60,
            severityMin = null,
            freeText = '',
            limit = 200
        } = req.body || {};

        if (!Array.isArray(functionNames) || functionNames.length === 0) {
            return res.status(400).json({
                error: 'bad_request',
                message: 'functionNames must be a non-empty array'
            });
        }

        const clampedLimit = Math.min(
            Math.max(parseInt(limit, 10) || 200, 1),
            MAX_LOG_ENTRIES_PER_QUERY
        );

        const result = await queryLogs({
            projectId: PROJECT_ID,
            functionNames,
            minutesAgo: Math.max(parseInt(minutesAgo, 10) || 60, 1),
            severityMin: severityMin || null,
            freeText: String(freeText || '').trim(),
            limit: clampedLimit
        });

        res.json(result);
    } catch (err) {
        console.error('POST /api/logs error:', err);
        res.status(500).json({
            error: 'query_logs_failed',
            message: err.message,
            hint: errorHint(err)
        });
    }
});

/**
 * Clients that can be inspected — every analytics_client_* dataset in the project.
 * The table views used to be pinned to one hard-coded tenant, so this is what makes
 * the client selector possible.
 */
app.get('/api/clients', async (req, res) => {
    try {
        res.json(await listClients(PROJECT_ID));
    } catch (err) {
        console.error('GET /api/clients error:', err);
        res.status(500).json({
            error: 'list_clients_failed',
            message: err.message,
            hint: errorHint(err)
        });
    }
});

app.get('/api/tables', (req, res) => {
    res.json(listTables(req.query.client));
});

app.get('/api/tables/:name', async (req, res) => {
    try {
        const limit = parseInt(req.query.limit, 10) || 200;
        const windowMinutes = req.query.windowMinutes
            ? parseInt(req.query.windowMinutes, 10)
            : null;

        // Filters come in as `f_<column>=<value>` query params; collect every
        // non-empty one. Server-side validates the column against the per-table
        // allowlist.
        const filters = [];
        for (const [key, raw] of Object.entries(req.query || {})) {
            if (!key.startsWith('f_')) continue;
            const value = Array.isArray(raw) ? raw[0] : raw;
            if (value == null || String(value).trim() === '') continue;
            filters.push({ column: key.slice(2), value: String(value) });
        }

        const result = await previewTable({
            projectId: PROJECT_ID,
            tableName: req.params.name,
            limit,
            windowMinutes,
            filters,
            clientId: req.query.client
        });
        res.json(result);
    } catch (err) {
        if (err.code === 'TABLE_NOT_ALLOWED') {
            return res.status(404).json({ error: 'unknown_table', message: err.message });
        }
        if (err.code === 'COLUMN_NOT_FILTERABLE') {
            return res.status(400).json({ error: 'bad_filter', message: err.message });
        }
        console.error(`GET /api/tables/${req.params.name} error:`, err);
        res.status(500).json({
            error: 'preview_table_failed',
            message: err.message,
            hint: errorHint(err)
        });
    }
});

// ── Firestore ───────────────────────────────────────────────────────────────
// Read-only. Nothing here writes: clients/{id} is provision-client's document
// to own, and an editable browser is a footgun in a tool built for looking.

app.get('/api/firestore/collections', async (req, res) => {
    try {
        res.json(await listCollections({
            projectId: PROJECT_ID,
            databaseId: FIRESTORE_DATABASE_ID
        }));
    } catch (err) {
        console.error('GET /api/firestore/collections error:', err);
        res.status(firestoreStatus(err)).json({
            error: 'list_collections_failed',
            message: err.message,
            hint: firestoreHint(err)
        });
    }
});

app.get('/api/firestore/documents', async (req, res) => {
    const collection = String(req.query.collection || '').trim();
    if (!collection) {
        return res.status(400).json({
            error: 'bad_request',
            message: 'collection is required, e.g. ?collection=clients'
        });
    }
    try {
        const result = await listDocuments({
            projectId: PROJECT_ID,
            databaseId: FIRESTORE_DATABASE_ID,
            collectionPath: collection,
            limit: Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200),
            startAfter: req.query.startAfter ? String(req.query.startAfter) : null,
            orderBy: req.query.orderBy ? String(req.query.orderBy) : null,
            where: req.query.field
                ? { field: String(req.query.field), value: req.query.value }
                : null
        });
        res.json(result);
    } catch (err) {
        console.error('GET /api/firestore/documents error:', err);
        res.status(firestoreStatus(err)).json({
            error: 'list_documents_failed',
            message: err.message,
            hint: firestoreHint(err)
        });
    }
});

app.get('/api/firestore/document', async (req, res) => {
    const docPath = String(req.query.path || '').trim();
    // A document path has an even number of segments; a collection path is odd.
    // Catching it here gives a usable message instead of a Firestore assertion.
    if (!docPath || docPath.split('/').filter(Boolean).length % 2 !== 0) {
        return res.status(400).json({
            error: 'bad_request',
            message: 'path must be a document path with an even number of segments, e.g. clients/toast_lxc03'
        });
    }
    try {
        res.json(await getDocument({
            projectId: PROJECT_ID,
            databaseId: FIRESTORE_DATABASE_ID,
            docPath
        }));
    } catch (err) {
        if (err.code === 'DOCUMENT_NOT_FOUND') {
            return res.status(404).json({ error: 'document_not_found', message: err.message });
        }
        console.error('GET /api/firestore/document error:', err);
        res.status(firestoreStatus(err)).json({
            error: 'get_document_failed',
            message: err.message,
            hint: firestoreHint(err)
        });
    }
});

// ── Raw BigQuery dataset browser ────────────────────────────────────────────
// Distinct from /api/tables, which serves the curated allowlist. These read
// rows via tabledata.list and are NOT billed — see lib/datasets.js.

app.get('/api/datasets', async (req, res) => {
    try {
        res.json(await listDatasets(PROJECT_ID));
    } catch (err) {
        console.error('GET /api/datasets error:', err);
        res.status(500).json({ error: 'list_datasets_failed', message: err.message, hint: errorHint(err) });
    }
});

app.get('/api/datasets/:dataset/tables', async (req, res) => {
    try {
        res.json(await listDatasetTables({
            projectId: PROJECT_ID,
            datasetId: req.params.dataset
        }));
    } catch (err) {
        console.error(`GET /api/datasets/${req.params.dataset}/tables error:`, err);
        res.status(bqStatus(err)).json({
            error: 'list_dataset_tables_failed',
            message: err.message,
            hint: errorHint(err)
        });
    }
});

app.get('/api/datasets/:dataset/tables/:table', async (req, res) => {
    try {
        res.json(await describeTable({
            projectId: PROJECT_ID,
            datasetId: req.params.dataset,
            tableId: req.params.table
        }));
    } catch (err) {
        console.error(`GET /api/datasets/${req.params.dataset}/tables/${req.params.table} error:`, err);
        res.status(bqStatus(err)).json({
            error: 'describe_table_failed',
            message: err.message,
            hint: errorHint(err)
        });
    }
});

app.get('/api/datasets/:dataset/tables/:table/rows', async (req, res) => {
    try {
        res.json(await previewRawTable({
            projectId: PROJECT_ID,
            datasetId: req.params.dataset,
            tableId: req.params.table,
            limit: req.query.limit,
            startIndex: req.query.startIndex || 0
        }));
    } catch (err) {
        console.error(`GET /api/datasets/${req.params.dataset}/tables/${req.params.table}/rows error:`, err);
        res.status(bqStatus(err)).json({
            error: 'preview_rows_failed',
            message: err.message,
            hint: errorHint(err)
        });
    }
});

app.get('/api/focus-config', (req, res) => {
    res.json({ functions: focusConfig });
});

// ── Phone-mirror broadcast ──────────────────────────────────────────────────
// One in-memory frame, last writer wins. Broadcasters POST JPEGs every ~1s,
// viewers GET the latest. Frame is dropped on server restart.
let phoneFrame = null;
let phoneFrameUploadedAt = null;
let phoneFrameSourceIp = null;

app.post(
    '/api/phone/frame',
    express.raw({ type: ['image/jpeg', 'image/png'], limit: '4mb' }),
    (req, res) => {
        if (TRIGGER_SECRET) {
            const provided = (req.get('X-Trigger-Token') || '').trim();
            if (provided !== TRIGGER_SECRET) {
                return res.status(401).json({
                    error: 'unauthorized',
                    message: 'Missing or invalid X-Trigger-Token header.'
                });
            }
        }
        if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
            return res.status(400).json({ error: 'no_data', message: 'Expected raw image bytes in request body.' });
        }
        phoneFrame = req.body;
        phoneFrameUploadedAt = new Date().toISOString();
        phoneFrameSourceIp = req.ip || null;
        res.json({
            ok: true,
            size_bytes: req.body.length,
            uploaded_at: phoneFrameUploadedAt
        });
    }
);

app.get('/api/phone/frame', (req, res) => {
    if (!phoneFrame) return res.status(404).json({ error: 'no_frame' });
    res.set('Cache-Control', 'no-store');
    res.type('image/jpeg').send(phoneFrame);
});

app.get('/api/phone/status', (req, res) => {
    res.json({
        has_frame: Boolean(phoneFrame),
        uploaded_at: phoneFrameUploadedAt,
        size_bytes: phoneFrame ? phoneFrame.length : 0,
        source_ip: phoneFrameSourceIp
    });
});

app.get('/api/scheduler/jobs', async (req, res) => {
    try {
        const jobs = await listJobs({ projectId: PROJECT_ID, region: REGION });
        res.json({ project: PROJECT_ID, region: REGION, count: jobs.length, jobs });
    } catch (err) {
        console.error('GET /api/scheduler/jobs error:', err);
        const status = schedulerErrorStatus(err);
        res.status(status).json({
            error: status === 403 ? 'permission_denied' : 'list_jobs_failed',
            message: err.message,
            hint: status === 403
                ? 'The account needs cloudscheduler.jobs.list — grant roles/cloudscheduler.viewer or roles/cloudscheduler.admin.'
                : errorHint(err)
        });
    }
});

app.post('/api/scheduler/jobs/:name/run', async (req, res) => {
    if (TRIGGER_SECRET) {
        const provided = (req.get('X-Trigger-Token') || '').trim();
        if (provided !== TRIGGER_SECRET) {
            return res.status(401).json({
                error: 'unauthorized',
                message: 'Missing or invalid X-Trigger-Token header.'
            });
        }
    }
    try {
        const job = await runJob({
            projectId: PROJECT_ID,
            region: REGION,
            jobName: req.params.name
        });
        res.json({ ok: true, job });
    } catch (err) {
        console.error(`POST /api/scheduler/jobs/${req.params.name}/run error:`, err);
        const status = schedulerErrorStatus(err);
        res.status(status).json({
            error: status === 403 ? 'permission_denied' : status === 404 ? 'job_not_found' : 'run_job_failed',
            message: err.message,
            hint: status === 403
                ? 'The account needs cloudscheduler.jobs.run — grant roles/cloudscheduler.admin or a custom role that allows it.'
                : errorHint(err)
        });
    }
});

// In production (Docker image), the web/ Vite build output is copied next to the
// server. Serve it as static assets and fall back to index.html for client-side
// routing so the SPA works regardless of which path the user hits.
if (process.env.NODE_ENV === 'production') {
    const fs = require('fs');
    const webDist = path.resolve(__dirname, '..', 'web', 'dist');
    if (fs.existsSync(webDist)) {
        app.use(express.static(webDist));
        // Catch-all (must come AFTER all /api/* routes above so it doesn't shadow them).
        app.get('*', (req, res, next) => {
            if (req.path.startsWith('/api/')) return next();
            res.sendFile(path.join(webDist, 'index.html'));
        });
        console.log(`[check-gcp-logger] serving static SPA from ${webDist}`);
    } else {
        console.warn(
            `[check-gcp-logger] NODE_ENV=production but ${webDist} does not exist — ` +
            `did the web bundle get built? (the Dockerfile handles this automatically; ` +
            `if you're running outside Docker, run "npm --prefix web run build" first.)`
        );
    }
}

app.listen(PORT, '0.0.0.0', () => {
    console.log(
        `[check-gcp-logger] server up on http://localhost:${PORT} ` +
        `(project=${PROJECT_ID}, region=${REGION})`
    );
});

/** Map a Cloud-Scheduler / gRPC error to a sane HTTP status. */
function schedulerErrorStatus(err) {
    const msg = String(err && err.message || '');
    const code = err && err.code;
    // grpc.status: PERMISSION_DENIED=7, NOT_FOUND=5
    if (code === 7 || msg.includes('PERMISSION_DENIED') || msg.includes('permission denied')) return 403;
    if (code === 5 || msg.includes('NOT_FOUND') || msg.includes('not found')) return 404;
    return 500;
}

/** Map a Firestore error to an HTTP status. */
function firestoreStatus(err) {
    const msg = String(err && err.message || '');
    const code = err && err.code;
    if (code === 7 || msg.includes('PERMISSION_DENIED')) return 403;
    if (code === 5 || msg.includes('NOT_FOUND')) return 404;
    // FAILED_PRECONDITION (9) is the missing-index error. It is a client
    // mistake, not a server fault, and its message carries the console URL that
    // creates the index — so surface it as 400 with the text intact.
    if (code === 9 || msg.includes('FAILED_PRECONDITION')) return 400;
    return 500;
}

function firestoreHint(err) {
    const msg = String(err && err.message || '');
    if (msg.includes('FAILED_PRECONDITION') && msg.includes('index')) {
        return 'This filter needs a composite index. The error message contains a console link that creates it.';
    }
    if (msg.includes('PERMISSION_DENIED')) {
        return 'The account needs roles/datastore.viewer on the project.';
    }
    if (msg.includes('NOT_FOUND') && msg.includes('database')) {
        return `Database "${FIRESTORE_DATABASE_ID}" was not found. Set FIRESTORE_DATABASE_ID in .env.`;
    }
    return errorHint(err);
}

/** Map a BigQuery REST error to an HTTP status. */
function bqStatus(err) {
    const code = err && (err.code || err.status);
    if (code === 404 || /not found/i.test(String(err && err.message))) return 404;
    if (code === 403) return 403;
    return 500;
}

/** Map common API errors to actionable hints. */
function errorHint(err) {
    const msg = String(err && err.message || '');
    if (msg.includes('Could not load the default credentials')) {
        return 'Run `gcloud auth application-default login` once per machine.';
    }
    if (msg.includes('PERMISSION_DENIED') || msg.includes('permission denied')) {
        return 'Your account needs roles/cloudfunctions.viewer, roles/logging.viewer, and roles/bigquery.dataViewer on the project.';
    }
    if (msg.includes('not enabled') || msg.includes('SERVICE_DISABLED')) {
        return 'Enable the Cloud Functions API and Cloud Logging API on the project.';
    }
    return null;
}