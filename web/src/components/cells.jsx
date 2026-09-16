import { useState } from 'react';

const STATUS_CLASSES = {
    green: 'bg-emerald-100 text-emerald-800',
    amber: 'bg-amber-100 text-amber-800',
    gray: 'bg-zinc-200 text-zinc-700',
    red: 'bg-red-100 text-red-700'
};

export function StatusBadge({ value, colorMap }) {
    const display = value == null || value === '' ? '—' : String(value);
    const color = colorMap && value != null ? colorMap[value] : null;
    const cls = color ? STATUS_CLASSES[color] : 'bg-zinc-100 text-zinc-600';
    return (
        <span className={`badge ${cls}`}>{display}</span>
    );
}

/**
 * Truncates a long string; click copies the full value to clipboard.
 * Hover shows the full value as a native tooltip.
 */
export function TruncatedCell({ value, length }) {
    const [copied, setCopied] = useState(false);
    if (value == null) return <span className="text-zinc-400">—</span>;
    const str = String(value);
    const shown = str.length > length ? str.slice(0, length) + '…' : str;

    function copy(e) {
        e.stopPropagation();
        navigator.clipboard.writeText(str).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 900);
        });
    }

    return (
        <button
            type="button"
            onClick={copy}
            title={`${str}\n\n(click to copy)`}
            className={
                'inline-flex max-w-full items-center rounded px-1 font-mono text-left hover:bg-orange-100 ' +
                (copied ? 'bg-emerald-100 text-emerald-800' : '')
            }
        >
            <span className="truncate">{copied ? 'copied!' : shown}</span>
        </button>
    );
}

/** Format any leaf value to a short text representation for display in a cell. */
export function formatLeaf(v) {
    if (v === null || v === undefined) return '';
    if (typeof v === 'string') return v;
    if (typeof v === 'number' || typeof v === 'boolean') return String(v);
    try {
        return JSON.stringify(v);
    } catch (_e) {
        return String(v);
    }
}

/**
 * Render one cell for `row[col.name]` using `col.display` rules:
 *   - merge: join multiple source columns
 *   - color_status: StatusBadge with color map
 *   - truncate: TruncatedCell at fixed length
 *   - conditional_truncate: TruncatedCell only if value starts with prefix
 */
export function renderCell(row, col) {
    const display = col.display || {};

    if (display.merge) {
        const parts = display.merge.columns
            .map((c) => row[c])
            .filter((v) => v !== null && v !== undefined && v !== '');
        if (parts.length === 0) return <span className="text-zinc-400">—</span>;
        return <span>{parts.join(display.merge.separator || ' ')}</span>;
    }

    const value = row[col.name];

    if (display.color_status) {
        return <StatusBadge value={value} colorMap={display.color_status} />;
    }

    if (display.truncate && typeof value === 'string' && value.length > display.truncate) {
        return <TruncatedCell value={value} length={display.truncate} />;
    }

    if (display.conditional_truncate) {
        const { prefix, length } = display.conditional_truncate;
        if (typeof value === 'string' && value.startsWith(prefix) && value.length > length) {
            return <TruncatedCell value={value} length={length} />;
        }
    }

    if (value === null || value === undefined) {
        return <span className="text-zinc-400">—</span>;
    }

    return <span className="font-mono text-xs">{formatLeaf(value)}</span>;
}
