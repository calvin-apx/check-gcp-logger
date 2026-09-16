/**
 * Firestore browsing for the named analytics database.
 *
 * The GA4 project does not use the (default) database — everything lives in
 * ga4-analytics-db-dev, so every client here is constructed with an explicit
 * databaseId. Point FIRESTORE_DATABASE_ID at a different one in .env to browse
 * another database without touching this file.
 *
 * Read-only on purpose. Nothing in here writes, and no route is wired to a
 * write: clients/{id} is provision-client's document to own, and a browser that
 * can edit it is a footgun in a tool whose whole job is looking.
 */

const { Firestore } = require('@google-cloud/firestore');

let cached = null;

function db({ projectId, databaseId }) {
    // One client per process. The constructor is cheap but the underlying gRPC
    // channel is not, and re-creating it per request leaks connections.
    if (!cached) {
        cached = new Firestore({ projectId, databaseId });
    }
    return cached;
}

/**
 * Firestore hands back its own wrapper types (Timestamp, GeoPoint,
 * DocumentReference, Buffer). JSON.stringify turns most of them into `{}` or
 * something lossy, so flatten to plain values the UI can render and a human can
 * read. Shape is preserved; only leaves change.
 */
function toPlain(value, depth = 0) {
    if (value == null) return null;

    // Guard against a reference cycle or a pathologically nested document
    // rather than blowing the stack on a request.
    if (depth > 20) return '[…depth limit]';

    if (typeof value.toDate === 'function') {
        // Firestore Timestamp — ISO is sortable and unambiguous.
        return { __type: 'timestamp', value: value.toDate().toISOString() };
    }
    if (typeof value.latitude === 'number' && typeof value.longitude === 'number') {
        return { __type: 'geopoint', latitude: value.latitude, longitude: value.longitude };
    }
    if (value && typeof value.path === 'string' && typeof value.id === 'string' && value.firestore) {
        return { __type: 'reference', path: value.path };
    }
    if (Buffer.isBuffer(value)) {
        return { __type: 'bytes', size: value.length };
    }
    if (Array.isArray(value)) {
        return value.map((v) => toPlain(v, depth + 1));
    }
    if (typeof value === 'object') {
        const out = {};
        for (const [k, v] of Object.entries(value)) out[k] = toPlain(v, depth + 1);
        return out;
    }
    return value;
}

/** Top-level collections in the database. */
async function listCollections({ projectId, databaseId }) {
    const collections = await db({ projectId, databaseId }).listCollections();
    return {
        database: databaseId,
        project: projectId,
        collections: collections.map((c) => c.id).sort()
    };
}

/**
 * A page of documents from one collection.
 *
 * `where` is a single equality clause because that is what a browser needs and
 * anything richer needs a composite index the caller cannot create from here.
 * A missing index surfaces as a FAILED_PRECONDITION whose message carries the
 * console URL, so it is passed through rather than swallowed.
 */
async function listDocuments({
    projectId,
    databaseId,
    collectionPath,
    limit = 50,
    startAfter = null,
    orderBy = null,
    where = null
}) {
    let query = db({ projectId, databaseId }).collection(collectionPath);

    if (where && where.field && where.value !== undefined && where.value !== '') {
        query = query.where(where.field, '==', coerce(where.value));
    }
    if (orderBy) {
        query = query.orderBy(orderBy);
    } else {
        // __name__ is always indexed, so paging works on any collection without
        // the caller having to know which fields are ordered.
        query = query.orderBy('__name__');
    }
    if (startAfter) {
        query = query.startAfter(startAfter);
    }

    const snap = await query.limit(limit).get();

    const documents = snap.docs.map((d) => ({
        id: d.id,
        path: d.ref.path,
        data: toPlain(d.data()),
        update_time: d.updateTime ? d.updateTime.toDate().toISOString() : null,
        create_time: d.createTime ? d.createTime.toDate().toISOString() : null
    }));

    // Cursor is the last document id, which pairs with the __name__ ordering
    // above. Only meaningful when the page came back full.
    const last = snap.docs[snap.docs.length - 1];
    const nextCursor = snap.docs.length === limit && last ? last.id : null;

    // Union of top-level field names across the page — the UI builds its columns
    // from this, because Firestore has no schema to ask.
    const fields = new Set();
    for (const doc of documents) {
        for (const key of Object.keys(doc.data || {})) fields.add(key);
    }

    return {
        database: databaseId,
        collection: collectionPath,
        count: documents.length,
        fields: Array.from(fields).sort(),
        next_cursor: nextCursor,
        documents
    };
}

/** One document by full path, plus the subcollections hanging off it. */
async function getDocument({ projectId, databaseId, docPath }) {
    const ref = db({ projectId, databaseId }).doc(docPath);
    const [snap, subs] = await Promise.all([ref.get(), ref.listCollections()]);

    if (!snap.exists) {
        const err = new Error(`No document at ${docPath}`);
        err.code = 'DOCUMENT_NOT_FOUND';
        throw err;
    }

    return {
        database: databaseId,
        id: snap.id,
        path: ref.path,
        data: toPlain(snap.data()),
        update_time: snap.updateTime ? snap.updateTime.toDate().toISOString() : null,
        create_time: snap.createTime ? snap.createTime.toDate().toISOString() : null,
        subcollections: subs.map((c) => c.id).sort()
    };
}

/**
 * Query values arrive as strings from the URL. "true" and "42" almost always
 * mean the boolean and the number in this data — active is a boolean and
 * site_id is a number — so a string-only comparison would silently match
 * nothing. Anything else is left alone.
 */
function coerce(raw) {
    const s = String(raw).trim();
    if (s === 'true') return true;
    if (s === 'false') return false;
    if (s !== '' && !Number.isNaN(Number(s)) && String(Number(s)) === s) return Number(s);
    return s;
}

module.exports = { listCollections, listDocuments, getDocument };
