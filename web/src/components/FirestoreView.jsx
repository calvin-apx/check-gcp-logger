import { useCallback, useEffect, useMemo, useState } from 'react';

import {
    fetchFirestoreCollections,
    fetchFirestoreDocuments,
    fetchFirestoreDocument
} from '../lib/api.js';
import JsonTree from './JsonTree.jsx';

const PAGE_SIZE = 50;

/**
 * Firestore browser for the named analytics database.
 *
 * Firestore has no schema, so the column set is whatever the current page of
 * documents happens to carry — the server returns that union as `fields`. A
 * document missing a column shows an em dash rather than an empty cell, so
 * "absent" is visually distinct from "empty string", which matters here: the
 * cap work turns on fields being absent versus set.
 */
export default function FirestoreView({ refreshKey, onFetchingChange }) {
    const [collections, setCollections] = useState([]);
    const [database, setDatabase] = useState(null);
    const [collection, setCollection] = useState(null);
    const [collectionsError, setCollectionsError] = useState(null);

    const [page, setPage] = useState(null);
    const [cursors, setCursors] = useState([]);   // startAfter for each page back
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);

    const [filter, setFilter] = useState({ field: '', value: '' });
    const [applied, setApplied] = useState({ field: '', value: '' });

    const [detail, setDetail] = useState(null);
    const [detailLoading, setDetailLoading] = useState(false);

    useEffect(() => {
        if (onFetchingChange) onFetchingChange(loading);
    }, [loading, onFetchingChange]);

    // Collection list on mount and on header refresh.
    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const res = await fetchFirestoreCollections();
                if (cancelled) return;
                setCollections(res.collections || []);
                setDatabase(res.database || null);
                setCollectionsError(null);
                // Land on `clients` when it exists — it is the document every
                // other view in this app ends up cross-referencing.
                setCollection((cur) => cur || (res.collections || []).find((c) => c === 'clients') || (res.collections || [])[0] || null);
            } catch (err) {
                if (!cancelled) {
                    setCollectionsError(err.body?.hint ? `${err.message} (${err.body.hint})` : err.message);
                }
            }
        })();
        return () => { cancelled = true; };
    }, [refreshKey]);

    const load = useCallback(async (startAfter = null, where = applied) => {
        if (!collection) return;
        setLoading(true);
        setError(null);
        try {
            const res = await fetchFirestoreDocuments(collection, {
                limit: PAGE_SIZE,
                startAfter,
                field: where.field || null,
                value: where.value || null
            });
            setPage(res);
        } catch (err) {
            setPage(null);
            setError(err.body?.hint ? `${err.message}\n\n${err.body.hint}` : err.message);
        } finally {
            setLoading(false);
        }
    }, [collection, applied]);

    // Reset paging whenever the collection or the applied filter changes.
    useEffect(() => {
        setCursors([]);
        setDetail(null);
        load(null, applied);
    }, [collection, applied, refreshKey, load]);

    const fields = useMemo(() => (page?.fields || []).slice(0, 8), [page]);

    async function openDoc(path) {
        setDetailLoading(true);
        try {
            setDetail(await fetchFirestoreDocument(path));
        } catch (err) {
            setDetail({ error: err.message, path });
        } finally {
            setDetailLoading(false);
        }
    }

    return (
        <div className="flex min-h-0 flex-1">
            {/* ── Collections sidebar ─────────────────────────────────────── */}
            <aside className="flex w-64 shrink-0 flex-col border-r border-zinc-200 bg-white">
                <div className="border-b border-zinc-200 p-3">
                    <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">
                        Collections
                    </h2>
                    <p className="mt-1 break-all font-mono text-[11px] text-zinc-400">
                        {database || '—'}
                    </p>
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto p-2">
                    {collectionsError && (
                        <p className="rounded bg-rose-50 p-2 text-xs text-rose-700">{collectionsError}</p>
                    )}
                    {collections.map((c) => (
                        <button
                            key={c}
                            type="button"
                            onClick={() => setCollection(c)}
                            className={
                                'mb-1 block w-full truncate rounded px-2 py-1.5 text-left font-mono text-xs transition ' +
                                (c === collection
                                    ? 'bg-orange-500 text-white'
                                    : 'text-zinc-700 hover:bg-zinc-100')
                            }
                        >
                            {c}
                        </button>
                    ))}
                    {!collectionsError && collections.length === 0 && (
                        <p className="p-2 text-xs text-zinc-400">No collections.</p>
                    )}
                </div>
            </aside>

            {/* ── Documents ───────────────────────────────────────────────── */}
            <main className="flex min-w-0 flex-1 flex-col">
                <div className="flex flex-wrap items-end gap-2 border-b border-zinc-200 bg-white px-4 py-2">
                    <label className="block">
                        <span className="mb-0.5 block text-[11px] font-medium uppercase tracking-wide text-zinc-400">
                            Field
                        </span>
                        <input
                            className="input w-44"
                            placeholder="active"
                            value={filter.field}
                            onChange={(e) => setFilter((f) => ({ ...f, field: e.target.value }))}
                        />
                    </label>
                    <label className="block">
                        <span className="mb-0.5 block text-[11px] font-medium uppercase tracking-wide text-zinc-400">
                            Equals
                        </span>
                        <input
                            className="input w-44"
                            placeholder="true"
                            value={filter.value}
                            onChange={(e) => setFilter((f) => ({ ...f, value: e.target.value }))}
                            onKeyDown={(e) => { if (e.key === 'Enter') setApplied({ ...filter }); }}
                        />
                    </label>
                    <button type="button" className="btn btn-primary" onClick={() => setApplied({ ...filter })}>
                        apply
                    </button>
                    {(applied.field || applied.value) && (
                        <button
                            type="button"
                            className="btn"
                            onClick={() => { setFilter({ field: '', value: '' }); setApplied({ field: '', value: '' }); }}
                        >
                            clear
                        </button>
                    )}
                    <span className="ml-auto text-xs text-zinc-400">
                        equality only · <code className="font-mono">true</code>/<code className="font-mono">42</code> are coerced
                    </span>
                </div>

                <div className="min-h-0 flex-1 overflow-auto">
                    {error && (
                        <pre className="m-4 whitespace-pre-wrap rounded bg-rose-50 p-3 text-xs text-rose-700">{error}</pre>
                    )}

                    {!error && page && (
                        <table className="w-full border-collapse text-xs">
                            <thead className="sticky top-0 bg-zinc-100">
                                <tr>
                                    <th className="border-b border-zinc-300 px-3 py-2 text-left font-semibold text-zinc-600">
                                        id
                                    </th>
                                    {fields.map((f) => (
                                        <th key={f} className="border-b border-zinc-300 px-3 py-2 text-left font-semibold text-zinc-600">
                                            {f}
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {page.documents.map((d) => (
                                    <tr
                                        key={d.path}
                                        onClick={() => openDoc(d.path)}
                                        className="cursor-pointer border-b border-zinc-100 hover:bg-orange-50"
                                    >
                                        <td className="px-3 py-1.5 font-mono text-zinc-900">{d.id}</td>
                                        {fields.map((f) => (
                                            <td key={f} className="max-w-[16rem] truncate px-3 py-1.5 font-mono text-zinc-600">
                                                {cell(d.data[f])}
                                            </td>
                                        ))}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}

                    {!error && page && page.documents.length === 0 && (
                        <p className="p-6 text-sm text-zinc-500">
                            No documents{applied.field ? ' matched that filter' : ''}.
                        </p>
                    )}
                    {loading && <p className="p-6 text-sm text-zinc-500">loading…</p>}
                </div>

                <footer className="flex items-center gap-3 border-t border-zinc-200 bg-white px-4 py-1.5 text-xs text-zinc-500">
                    <span>
                        {page ? page.count : 0} doc{page && page.count === 1 ? '' : 's'}
                        {page?.collection ? ` · ${page.collection}` : ''}
                    </span>
                    <div className="ml-auto flex gap-2">
                        <button
                            type="button"
                            className="btn"
                            disabled={cursors.length === 0 || loading}
                            onClick={() => {
                                const next = cursors.slice(0, -1);
                                setCursors(next);
                                load(next.length ? next[next.length - 1] : null);
                            }}
                        >
                            ← prev
                        </button>
                        <button
                            type="button"
                            className="btn"
                            disabled={!page?.next_cursor || loading}
                            onClick={() => {
                                setCursors((c) => [...c, page.next_cursor]);
                                load(page.next_cursor);
                            }}
                        >
                            next →
                        </button>
                    </div>
                </footer>
            </main>

            {/* ── Document detail ─────────────────────────────────────────── */}
            {(detail || detailLoading) && (
                <aside className="flex w-[30rem] shrink-0 flex-col border-l border-zinc-700 bg-zinc-900">
                    <div className="flex items-start justify-between gap-2 border-b border-zinc-700 px-4 py-3">
                        <div className="min-w-0">
                            <p className="truncate font-mono text-xs text-orange-300">
                                {detail?.path || '…'}
                            </p>
                            {detail?.update_time && (
                                <p className="mt-0.5 font-mono text-[11px] text-zinc-500">
                                    updated {detail.update_time}
                                </p>
                            )}
                        </div>
                        <div className="flex shrink-0 gap-1">
                            {detail?.data && (
                                <button
                                    type="button"
                                    className="rounded border border-zinc-600 px-2 py-0.5 text-[11px] text-zinc-300 hover:bg-zinc-800"
                                    onClick={() => navigator.clipboard.writeText(JSON.stringify(detail.data, null, 2))}
                                >
                                    copy
                                </button>
                            )}
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
                        {detailLoading && <p className="text-xs text-zinc-400">loading…</p>}
                        {detail?.error && <p className="text-xs text-rose-400">{detail.error}</p>}

                        {detail?.subcollections?.length > 0 && (
                            <div className="mb-3 rounded border border-zinc-700 bg-zinc-800/50 p-2">
                                <p className="mb-1 text-[11px] uppercase tracking-wide text-zinc-500">
                                    Subcollections
                                </p>
                                {detail.subcollections.map((s) => (
                                    <button
                                        key={s}
                                        type="button"
                                        onClick={() => setCollection(`${detail.path}/${s}`)}
                                        className="mr-1 rounded bg-zinc-700 px-1.5 py-0.5 font-mono text-[11px] text-sky-300 hover:bg-zinc-600"
                                    >
                                        {s}
                                    </button>
                                ))}
                            </div>
                        )}

                        {detail?.data && <JsonTree value={detail.data} />}
                    </div>
                </aside>
            )}
        </div>
    );
}

/**
 * One cell of the document table. An absent field is an em dash, not blank —
 * "field missing" and "field set to empty" are different states here.
 */
function cell(v) {
    if (v === undefined) return '—';
    if (v === null) return 'null';
    if (typeof v === 'object') {
        if (v.__type === 'timestamp') return v.value;
        if (v.__type === 'reference') return v.path;
        if (Array.isArray(v)) return `[${v.length}]`;
        return `{${Object.keys(v).length}}`;
    }
    return String(v);
}
