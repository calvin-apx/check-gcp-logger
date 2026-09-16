import { useCallback, useEffect, useMemo, useState } from 'react';

import {
    fetchDatasets,
    fetchDatasetTables,
    fetchDatasetRows,
    fetchTableSchema
} from '../lib/api.js';
import JsonTree from './JsonTree.jsx';

const PAGE_SIZE = 50;

const KIND_LABELS = {
    ga4_export: 'GA4 export',
    client: 'Client analytics'
};

// GA4 export first: those are the datasets the curated Tables tab cannot reach,
// which is the whole reason this view exists. The server only sends these two
// families — the motenasu_* mirrors and assorted one-offs are filtered out
// there, not here, so they never reach the client.
const KIND_ORDER = ['ga4_export', 'client'];

/**
 * Raw dataset / table browser.
 *
 * Complements the Tables tab rather than replacing it. Tables serves curated,
 * SQL-backed views with filters and time windows; this one lists whatever is
 * actually in the project and previews any table for free — rows come from
 * tabledata.list, not from a query, so browsing a 40 GB GA4 export table costs
 * nothing. The price is no filtering and no ordering.
 */
export default function DatasetView({ refreshKey, onFetchingChange }) {
    const [datasets, setDatasets] = useState([]);
    const [hiddenCount, setHiddenCount] = useState(0);
    const [datasetsError, setDatasetsError] = useState(null);
    const [dataset, setDataset] = useState(null);
    const [search, setSearch] = useState('');

    const [tables, setTables] = useState([]);
    const [tablesLoading, setTablesLoading] = useState(false);
    const [table, setTable] = useState(null);

    const [schema, setSchema] = useState(null);
    const [rows, setRows] = useState(null);
    const [startIndex, setStartIndex] = useState(0);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [detail, setDetail] = useState(null);

    useEffect(() => {
        if (onFetchingChange) onFetchingChange(loading || tablesLoading);
    }, [loading, tablesLoading, onFetchingChange]);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const res = await fetchDatasets();
                if (!cancelled) {
                    setDatasets(res.datasets || []);
                    setHiddenCount(res.hidden_count || 0);
                    setDatasetsError(null);
                }
            } catch (err) {
                if (!cancelled) setDatasetsError(err.body?.hint ? `${err.message} (${err.body.hint})` : err.message);
            }
        })();
        return () => { cancelled = true; };
    }, [refreshKey]);

    // Tables for the chosen dataset.
    useEffect(() => {
        if (!dataset) return;
        let cancelled = false;
        setTablesLoading(true);
        setTable(null);
        setRows(null);
        setSchema(null);
        (async () => {
            try {
                const res = await fetchDatasetTables(dataset);
                if (!cancelled) setTables(res.tables || []);
            } catch (err) {
                if (!cancelled) { setTables([]); setError(err.message); }
            } finally {
                if (!cancelled) setTablesLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, [dataset, refreshKey]);

    const load = useCallback(async (index) => {
        if (!dataset || !table) return;
        setLoading(true);
        setError(null);
        try {
            const [r, s] = await Promise.all([
                fetchDatasetRows(dataset, table, { limit: PAGE_SIZE, startIndex: index }),
                schema && schema.table === table ? Promise.resolve(schema) : fetchTableSchema(dataset, table)
            ]);
            setRows(r);
            setSchema(s);
            setStartIndex(index);
        } catch (err) {
            setRows(null);
            setError(err.body?.hint ? `${err.message}\n\n${err.body.hint}` : err.message);
        } finally {
            setLoading(false);
        }
    }, [dataset, table, schema]);

    useEffect(() => {
        if (table) { setDetail(null); load(0); }
        // `load` intentionally omitted: it changes identity with schema, which
        // this effect sets, and including it re-fetches in a loop.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [table]);

    const grouped = useMemo(() => {
        const q = search.trim().toLowerCase();
        const map = new Map();
        for (const d of datasets) {
            if (q && !d.id.toLowerCase().includes(q)) continue;
            if (!map.has(d.kind)) map.set(d.kind, []);
            map.get(d.kind).push(d);
        }
        return KIND_ORDER.filter((k) => map.has(k)).map((k) => [k, map.get(k)]);
    }, [datasets, search]);

    // Schema order, not Object.keys of row 0 — a column that is null in the
    // first row would otherwise never appear.
    const columns = useMemo(() => (rows?.fields || []).slice(0, 10), [rows]);

    return (
        <div className="flex min-h-0 flex-1">
            {/* ── Datasets ────────────────────────────────────────────────── */}
            <aside className="flex w-64 shrink-0 flex-col border-r border-zinc-200 bg-white">
                <div className="border-b border-zinc-200 p-3">
                    <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-zinc-500">
                        Datasets
                    </h2>
                    <input
                        className="input w-full"
                        placeholder="filter…"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                    />
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto p-2">
                    {datasetsError && (
                        <p className="rounded bg-rose-50 p-2 text-xs text-rose-700">{datasetsError}</p>
                    )}
                    {hiddenCount > 0 && (
                        <p className="mb-2 rounded bg-zinc-100 px-2 py-1 text-[10px] leading-snug text-zinc-500">
                            {hiddenCount} non-GA4 dataset{hiddenCount === 1 ? '' : 's'} hidden
                            <span className="block text-zinc-400">motenasu_* and other non-analytics sets</span>
                        </p>
                    )}
                    {grouped.map(([kind, items]) => (
                        <div key={kind} className="mb-3">
                            <p className="px-1 pb-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-400">
                                {KIND_LABELS[kind]} ({items.length})
                            </p>
                            {items.map((d) => (
                                <button
                                    key={d.id}
                                    type="button"
                                    onClick={() => setDataset(d.id)}
                                    className={
                                        'mb-0.5 block w-full truncate rounded px-2 py-1 text-left font-mono text-[11px] transition ' +
                                        (d.id === dataset
                                            ? 'bg-orange-500 text-white'
                                            : 'text-zinc-700 hover:bg-zinc-100')
                                    }
                                >
                                    {d.id}
                                </button>
                            ))}
                        </div>
                    ))}
                </div>
            </aside>

            {/* ── Tables ──────────────────────────────────────────────────── */}
            <aside className="flex w-56 shrink-0 flex-col border-r border-zinc-200 bg-white">
                <div className="border-b border-zinc-200 p-3">
                    <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">
                        Tables
                    </h2>
                    <p className="mt-0.5 text-[11px] text-zinc-400">
                        {dataset ? `${tables.length} in ${dataset}` : 'pick a dataset'}
                    </p>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto p-2">
                    {tablesLoading && <p className="p-2 text-xs text-zinc-400">loading…</p>}
                    {!tablesLoading && dataset && tables.length === 0 && (
                        <p className="p-2 text-xs text-zinc-400">
                            This dataset has no tables.
                        </p>
                    )}
                    {tables.map((t) => (
                        <button
                            key={t.id}
                            type="button"
                            onClick={() => setTable(t.id)}
                            className={
                                'mb-0.5 block w-full truncate rounded px-2 py-1 text-left font-mono text-[11px] transition ' +
                                (t.id === table ? 'bg-orange-500 text-white' : 'text-zinc-700 hover:bg-zinc-100')
                            }
                        >
                            {t.id}
                        </button>
                    ))}
                </div>
            </aside>

            {/* ── Rows ────────────────────────────────────────────────────── */}
            <main className="flex min-w-0 flex-1 flex-col">
                {schema && (
                    <div className="flex flex-wrap items-center gap-3 border-b border-zinc-200 bg-white px-4 py-2 text-xs text-zinc-500">
                        <span className="font-mono text-zinc-800">{schema.dataset}.{schema.table}</span>
                        {schema.num_rows != null && <span>{schema.num_rows.toLocaleString()} rows</span>}
                        {schema.size_bytes != null && <span>{formatBytes(schema.size_bytes)}</span>}
                        <span>{schema.fields.length} cols</span>
                        {schema.partitioning && (
                            <span className="rounded bg-sky-50 px-1.5 py-0.5 text-sky-700">
                                partitioned{schema.partitioning.field ? ` on ${schema.partitioning.field}` : ''}
                            </span>
                        )}
                        <span className="ml-auto rounded bg-emerald-50 px-1.5 py-0.5 text-emerald-700">
                            unbilled read
                        </span>
                    </div>
                )}

                <div className="min-h-0 flex-1 overflow-auto">
                    {error && (
                        <pre className="m-4 whitespace-pre-wrap rounded bg-rose-50 p-3 text-xs text-rose-700">{error}</pre>
                    )}
                    {!dataset && <p className="p-6 text-sm text-zinc-500">Pick a dataset on the left.</p>}
                    {dataset && !table && !error && (
                        <p className="p-6 text-sm text-zinc-500">Pick a table to preview its rows.</p>
                    )}
                    {loading && <p className="p-6 text-sm text-zinc-500">loading…</p>}

                    {!loading && rows && (
                        <table className="w-full border-collapse text-xs">
                            <thead className="sticky top-0 bg-zinc-100">
                                <tr>
                                    <th className="border-b border-zinc-300 px-2 py-2 text-left font-semibold text-zinc-400">#</th>
                                    {columns.map((c) => (
                                        <th key={c} className="border-b border-zinc-300 px-3 py-2 text-left font-semibold text-zinc-600">
                                            {c}
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {rows.rows.map((r, i) => (
                                    <tr
                                        key={i}
                                        onClick={() => setDetail(r)}
                                        className="cursor-pointer border-b border-zinc-100 hover:bg-orange-50"
                                    >
                                        <td className="px-2 py-1.5 font-mono text-zinc-400">{startIndex + i}</td>
                                        {columns.map((c) => (
                                            <td key={c} className="max-w-[14rem] truncate px-3 py-1.5 font-mono text-zinc-700">
                                                {cell(r[c])}
                                            </td>
                                        ))}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                    {!loading && rows && rows.rows.length === 0 && (
                        <p className="p-6 text-sm text-zinc-500">Table is empty.</p>
                    )}
                </div>

                {rows && (
                    <footer className="flex items-center gap-3 border-t border-zinc-200 bg-white px-4 py-1.5 text-xs text-zinc-500">
                        <span>rows {startIndex}–{startIndex + rows.count}</span>
                        {columns.length < (rows.fields?.length || 0) && (
                            <span className="text-zinc-400">
                                · {rows.fields.length - columns.length} more columns — click a row
                            </span>
                        )}
                        <div className="ml-auto flex gap-2">
                            <button
                                type="button"
                                className="btn"
                                disabled={startIndex === 0 || loading}
                                onClick={() => load(Math.max(0, startIndex - PAGE_SIZE))}
                            >
                                ← prev
                            </button>
                            <button
                                type="button"
                                className="btn"
                                disabled={rows.next_index == null || loading}
                                onClick={() => load(rows.next_index)}
                            >
                                next →
                            </button>
                        </div>
                    </footer>
                )}
            </main>

            {/* ── Row detail ──────────────────────────────────────────────── */}
            {detail && (
                <aside className="flex w-[30rem] shrink-0 flex-col border-l border-zinc-700 bg-zinc-900">
                    <div className="flex items-center justify-between border-b border-zinc-700 px-4 py-3">
                        <p className="truncate font-mono text-xs text-orange-300">
                            {dataset}.{table}
                        </p>
                        <div className="flex gap-1">
                            <button
                                type="button"
                                className="rounded border border-zinc-600 px-2 py-0.5 text-[11px] text-zinc-300 hover:bg-zinc-800"
                                onClick={() => navigator.clipboard.writeText(JSON.stringify(detail, null, 2))}
                            >
                                copy
                            </button>
                            <button
                                type="button"
                                className="rounded border border-zinc-600 px-2 py-0.5 text-[11px] text-zinc-300 hover:bg-zinc-800"
                                onClick={() => setDetail(null)}
                            >
                                close
                            </button>
                        </div>
                    </div>
                    <div className="min-h-0 flex-1 overflow-auto p-3">
                        <JsonTree value={detail} />
                    </div>
                </aside>
            )}
        </div>
    );
}

function cell(v) {
    if (v === undefined) return '—';
    if (v === null) return 'null';
    if (Array.isArray(v)) return `[${v.length}]`;
    if (typeof v === 'object') return `{${Object.keys(v).length}}`;
    return String(v);
}

function formatBytes(n) {
    if (n < 1024) return `${n} B`;
    const units = ['KB', 'MB', 'GB', 'TB'];
    let v = n / 1024;
    let i = 0;
    while (v >= 1024 && i < units.length - 1) { v /= 1024; i += 1; }
    return `${v.toFixed(1)} ${units[i]}`;
}
