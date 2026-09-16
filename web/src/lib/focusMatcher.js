/**
 * Focused-mode matcher.
 *
 * Compiles a per-function config (from /api/focus-config) into a matcher
 * function and runs entries through it. ERROR / WARNING (and higher) always
 * pass so real failures are never silently hidden.
 */

const FAIL_SEVERITIES = new Set([
    'WARNING',
    'ERROR',
    'CRITICAL',
    'ALERT',
    'EMERGENCY'
]);

export function isFailSeverity(entry) {
    return FAIL_SEVERITIES.has(String(entry?.severity || '').toUpperCase());
}

/**
 * Build a per-function matcher map: { [functionName]: (entry) => bool }.
 * Functions not in the config get an undefined entry — caller falls back to "show all".
 */
export function compileFocusConfig(focusConfig) {
    const out = {};
    if (!focusConfig) return out;
    for (const [fnName, cfg] of Object.entries(focusConfig)) {
        out[fnName] = buildMatcher(cfg.match || []);
    }
    return out;
}

function buildMatcher(matchList) {
    const lowerStrings = [];
    const regexes = [];
    for (const m of matchList) {
        if (typeof m === 'string') {
            lowerStrings.push(m.toLowerCase());
        } else if (m && typeof m === 'object' && m.regex) {
            try {
                regexes.push(new RegExp(m.regex, m.flags || 'i'));
            } catch (_e) {
                // bad regex in config — skip it
            }
        }
    }
    return function matches(entry) {
        const candidates = [];
        if (entry.json_payload && entry.json_payload.event_name) {
            candidates.push(String(entry.json_payload.event_name));
        }
        if (entry.json_payload && entry.json_payload.message) {
            candidates.push(String(entry.json_payload.message));
        }
        if (entry.text_payload) candidates.push(String(entry.text_payload));
        if (candidates.length === 0) return false;

        const lower = candidates.map((c) => c.toLowerCase());
        for (const s of lowerStrings) {
            for (const c of lower) {
                if (c.includes(s)) return true;
            }
        }
        for (const re of regexes) {
            for (const c of candidates) {
                if (re.test(c)) return true;
            }
        }
        return false;
    };
}

/**
 * Filter entries for Focused mode. Returns { visible, hiddenCount, hiddenFails }
 * — hiddenFails is the count of ERROR/WARNING entries that were filtered out,
 * which should be 0 with the safety rule below but is exposed as a tripwire
 * for the "N hidden errors/warnings" banner.
 */
export function applyFocus(entries, matchersByFunction) {
    const visible = [];
    let hiddenCount = 0;
    let hiddenFails = 0;
    for (const e of entries) {
        const fn = e.function_name;
        const matcher = matchersByFunction[fn];
        if (!matcher) {
            // Unconfigured function — fall back to "show all".
            visible.push(e);
            continue;
        }
        if (isFailSeverity(e) || matcher(e)) {
            visible.push(e);
        } else {
            hiddenCount++;
            if (isFailSeverity(e)) hiddenFails++;
        }
    }
    return { visible, hiddenCount, hiddenFails };
}
