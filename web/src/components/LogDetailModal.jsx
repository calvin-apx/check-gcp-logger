import { useEffect, useState } from 'react';

/**
 * Modal showing one log entry's full content. Renders the JSON payload as a
 * collapsible tree so deep nested fields (line_data, etc.) aren't a wall of text.
 */
export default function LogDetailModal({ entry, onClose }) {
    useEffect(() => {
        function onKey(e) {
            if (e.key === 'Escape') onClose();
        }
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onClose]);

    function copyAsJson() {
        navigator.clipboard.writeText(JSON.stringify(entry, null, 2));
    }

    return (
        <div
            className="fixed inset-0 z-20 flex items-center justify-center bg-slate-900/40 p-6"
            onClick={onClose}
        >
            <div
                className="flex max-h-full w-full max-w-4xl flex-col rounded-lg bg-white shadow-2xl"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex items-start justify-between border-b border-slate-200 px-5 py-3">
                    <div className="min-w-0 pr-4">
                        <div className="truncate font-mono text-sm font-semibold text-slate-800">
                            {entry.function_name || '—'}
                        </div>
                        <div className="mt-0.5 truncate text-xs text-slate-500">
                            {entry.timestamp} · {entry.severity} · {entry.insert_id}
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <button type="button" onClick={copyAsJson} className="btn">
                            copy json
                        </button>
                        <button type="button" onClick={onClose} className="btn">
                            close
                        </button>
                    </div>
                </div>

                <div className="overflow-auto p-5 font-mono text-xs leading-relaxed">
                    {entry.text_payload && (
                        <section className="mb-4">
                            <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                                textPayload
                            </div>
                            <pre className="whitespace-pre-wrap break-words rounded bg-slate-50 p-3 text-slate-800">
                                {entry.text_payload}
                            </pre>
                        </section>
                    )}

                    {entry.json_payload && (
                        <section className="mb-4">
                            <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                                jsonPayload
                            </div>
                            <JsonTree data={entry.json_payload} />
                        </section>
                    )}

                    <section className="grid grid-cols-2 gap-3">
                        <KeyValueBlock title="resource" data={{ type: entry.resource_type }} />
                        <KeyValueBlock title="labels" data={entry.labels} />
                    </section>
                </div>
            </div>
        </div>
    );
}

function KeyValueBlock({ title, data }) {
    const entries = Object.entries(data || {}).filter(([, v]) => v != null && v !== '');
    if (entries.length === 0) return null;
    return (
        <div>
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                {title}
            </div>
            <dl className="rounded bg-slate-50 p-3 text-slate-800">
                {entries.map(([k, v]) => (
                    <div key={k} className="flex gap-2">
                        <dt className="shrink-0 text-slate-500">{k}:</dt>
                        <dd className="break-all">{String(v)}</dd>
                    </div>
                ))}
            </dl>
        </div>
    );
}

/** Collapsible JSON tree. Renders primitives inline, objects/arrays as toggles. */
function JsonTree({ data, level = 0 }) {
    if (data === null) return <span className="text-slate-400">null</span>;
    if (typeof data !== 'object') {
        return <PrimitiveValue value={data} />;
    }
    const isArray = Array.isArray(data);
    const entries = isArray ? data.map((v, i) => [i, v]) : Object.entries(data);
    if (entries.length === 0) {
        return <span className="text-slate-400">{isArray ? '[]' : '{}'}</span>;
    }
    return (
        <ul className={level === 0 ? '' : 'ml-4 border-l border-slate-200 pl-3'}>
            {entries.map(([k, v]) => (
                <JsonNode key={k} k={k} v={v} level={level} />
            ))}
        </ul>
    );
}

function JsonNode({ k, v, level }) {
    const isObject = v !== null && typeof v === 'object';
    const [open, setOpen] = useState(level < 1);
    if (!isObject) {
        return (
            <li className="flex gap-2 py-0.5">
                <span className="text-slate-500">{String(k)}:</span>
                <PrimitiveValue value={v} />
            </li>
        );
    }
    const isArray = Array.isArray(v);
    const size = isArray ? v.length : Object.keys(v).length;
    return (
        <li className="py-0.5">
            <button
                type="button"
                onClick={() => setOpen(!open)}
                className="text-left text-slate-700 hover:text-orange-600"
            >
                <span className="mr-1 text-slate-400">{open ? '▾' : '▸'}</span>
                <span>{String(k)}</span>
                <span className="ml-1 text-slate-400">
                    {isArray ? `[${size}]` : `{${size}}`}
                </span>
            </button>
            {open && <JsonTree data={v} level={level + 1} />}
        </li>
    );
}

function PrimitiveValue({ value }) {
    if (typeof value === 'string') {
        return <span className="text-emerald-700">"{value}"</span>;
    }
    if (typeof value === 'number') {
        return <span className="text-blue-700">{value}</span>;
    }
    if (typeof value === 'boolean') {
        return <span className="text-purple-700">{String(value)}</span>;
    }
    return <span>{String(value)}</span>;
}