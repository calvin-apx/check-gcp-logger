import { useState } from 'react';

/**
 * Collapsible JSON renderer shared by the Firestore and Dataset views.
 *
 * Both show documents/rows whose interesting parts are nested — a Firestore
 * `security` map, a GA4 `event_params` array of structs — and a flat
 * JSON.stringify dump makes those unreadable. Objects and arrays start
 * collapsed below the top level so a row opens to an outline, not a wall.
 */
export default function JsonTree({ value, name = null, depth = 0, defaultOpen = null }) {
    // Top two levels open by default; deeper stays folded until asked for.
    const [open, setOpen] = useState(defaultOpen == null ? depth < 2 : defaultOpen);

    const isArray = Array.isArray(value);
    const isObject = value !== null && typeof value === 'object' && !isArray;

    // Server-side type wrappers (see lib/firestore.js) render as one line
    // rather than as a two-key object the reader has to decode.
    if (isObject && typeof value.__type === 'string') {
        return <Leaf name={name} rendered={renderTyped(value)} className="text-violet-300" />;
    }

    if (!isArray && !isObject) {
        return <Leaf name={name} rendered={renderScalar(value)} className={scalarClass(value)} />;
    }

    const entries = isArray
        ? value.map((v, i) => [String(i), v])
        : Object.entries(value);

    if (entries.length === 0) {
        return <Leaf name={name} rendered={isArray ? '[]' : '{}'} className="text-zinc-500" />;
    }

    return (
        <div className={depth === 0 ? '' : 'ml-3 border-l border-zinc-700 pl-3'}>
            <button
                type="button"
                onClick={() => setOpen((o) => !o)}
                className="flex items-baseline gap-1.5 text-left hover:bg-zinc-800/60"
            >
                <span className="w-3 shrink-0 font-mono text-[10px] text-zinc-500">
                    {open ? '▾' : '▸'}
                </span>
                {name != null && <span className="font-mono text-xs text-sky-300">{name}</span>}
                <span className="font-mono text-[11px] text-zinc-500">
                    {isArray ? `[${entries.length}]` : `{${entries.length}}`}
                </span>
            </button>

            {open && (
                <div className="mt-0.5">
                    {entries.map(([k, v]) => (
                        <JsonTree key={k} name={k} value={v} depth={depth + 1} />
                    ))}
                </div>
            )}
        </div>
    );
}

function Leaf({ name, rendered, className }) {
    return (
        <div className="flex items-baseline gap-1.5 py-px">
            <span className="w-3 shrink-0" />
            {name != null && <span className="font-mono text-xs text-sky-300">{name}</span>}
            <span className={`break-all font-mono text-xs ${className}`}>{rendered}</span>
        </div>
    );
}

function renderTyped(v) {
    if (v.__type === 'timestamp') return v.value;
    if (v.__type === 'reference') return `→ ${v.path}`;
    if (v.__type === 'geopoint') return `${v.latitude}, ${v.longitude}`;
    if (v.__type === 'bytes') return `<${v.size} bytes>`;
    return JSON.stringify(v);
}

function renderScalar(v) {
    if (v === null) return 'null';
    if (typeof v === 'string') return v === '' ? '""' : v;
    return String(v);
}

function scalarClass(v) {
    if (v === null) return 'text-zinc-500 italic';
    if (typeof v === 'boolean') return v ? 'text-emerald-400' : 'text-rose-400';
    if (typeof v === 'number') return 'text-amber-300';
    return 'text-zinc-200';
}
