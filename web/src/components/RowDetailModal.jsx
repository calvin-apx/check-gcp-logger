import { useEffect } from 'react';

/**
 * Modal showing all columns of one BigQuery row — used as a "details expander"
 * for the curated table view. The default view hides most columns, this brings
 * them back.
 */
export default function RowDetailModal({ row, schema, tableName, onClose }) {
    useEffect(() => {
        function onKey(e) {
            if (e.key === 'Escape') onClose();
        }
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onClose]);

    function copyAsJson() {
        navigator.clipboard.writeText(JSON.stringify(row, null, 2));
    }

    return (
        <div
            className="fixed inset-0 z-30 flex items-center justify-center bg-zinc-900/50 p-6"
            onClick={onClose}
        >
            <div
                className="flex max-h-full w-full max-w-4xl flex-col rounded-lg bg-white shadow-2xl"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex items-start justify-between border-b border-zinc-200 px-5 py-3">
                    <div className="min-w-0 pr-4">
                        <div className="font-mono text-sm font-semibold text-zinc-800">
                            {tableName}
                        </div>
                        <div className="mt-0.5 text-xs text-zinc-500">
                            full row · {schema.length} columns
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

                <div className="overflow-auto p-4">
                    <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">
                        {schema.map((f) => {
                            const v = row[f.name];
                            return (
                                <FieldRow key={f.name} field={f} value={v} />
                            );
                        })}
                    </dl>
                </div>
            </div>
        </div>
    );
}

function FieldRow({ field, value }) {
    return (
        <>
            <dt className="pt-1 font-mono text-xs text-zinc-500">
                {field.name}
                <span className="ml-1 text-zinc-400">·{field.type.toLowerCase()}</span>
            </dt>
            <dd className="min-w-0 pt-1">
                <ValueRender value={value} />
            </dd>
        </>
    );
}

function ValueRender({ value }) {
    if (value === null || value === undefined) {
        return <span className="text-zinc-400">null</span>;
    }
    if (typeof value === 'string') {
        // Try to parse JSON strings (event_params) and pretty-print them
        const trimmed = value.trim();
        if ((trimmed.startsWith('{') || trimmed.startsWith('[')) && trimmed.length > 0) {
            try {
                const parsed = JSON.parse(trimmed);
                return (
                    <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded bg-zinc-50 p-2 font-mono text-xs text-zinc-800">
                        {JSON.stringify(parsed, null, 2)}
                    </pre>
                );
            } catch (_e) {
                /* fall through */
            }
        }
        return <span className="break-all font-mono text-xs text-zinc-800">{value}</span>;
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
        return <span className="font-mono text-xs text-zinc-800">{String(value)}</span>;
    }
    return (
        <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded bg-zinc-50 p-2 font-mono text-xs text-zinc-800">
            {JSON.stringify(value, null, 2)}
        </pre>
    );
}
