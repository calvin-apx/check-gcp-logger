/**
 * Focused-mode allowlist for the log viewer.
 *
 * Edit this file to tune what shows up when "Focused mode" is on. Each entry
 * in `match` is either a plain string (case-insensitive substring match) or
 * an object { regex, flags } (compiled to RegExp on the client).
 *
 * Matcher tries, in order:
 *   1. jsonPayload.event_name (exact, case-insensitive)
 *   2. jsonPayload.message    (substring or regex)
 *   3. textPayload            (substring or regex)
 *
 * SEVERITY >= WARNING always passes regardless of allowlist. This is enforced
 * client-side too — see web/src/lib/focusMatcher.js.
 *
 * Functions not listed here fall through to "show all" in Focused mode.
 *
 * Verified against live logs on 2026-05-20:
 *   - exit-session-scanner: matches via jsonPayload.message (verbatim)
 *   - exit-candidate-extractor: matches via textPayload substring (verbatim)
 *   - crm-beacon-events: spec allowlist does NOT appear in live logs as of probe;
 *                        Focused mode will hide most lines until the allowlist
 *                        is tuned to what the function actually emits.
 *   - beacon-processor: same situation as crm-beacon-events.
 *   - exit-delivery-callback: spec uses "callback_received" (underscore); live
 *                             logs say "callback received" (space). Substring
 *                             matcher will not hit; revise to "callback received"
 *                             once verified.
 *   - provision-client: spec allowlist not observed in last week of logs.
 *   - process-alerts: no logs in last week, can't validate.
 */

module.exports = {
    'crm-beacon-events': {
        label: 'Beacon API — events from client',
        match: [
            'event_received',
            'validation_passed',
            'validation_failed',
            'forwarded_to_processor'
        ]
    },

    'beacon-processor': {
        label: 'Beacon DB writer',
        match: [
            'batch_processed',
            'insert_failed',
            'streaming_buffer_collision',
            'streaming buffer'
        ]
    },

    'exit-session-scanner': {
        label: 'Exit detection — finds abandoned sessions',
        match: [
            'run_started',
            'run_completed',
            'client_abandoned_sessions_found',
            'rules_matched_for_session',
            'candidate_row_inserted',
            'candidate_duplicate_ignored',
            'candidate_insert_failed',
            'drip_window_already_full',
            'no_rules_matched_session'
        ]
    },

    'exit-candidate-extractor': {
        label: 'Delivery — picks pending & sends to AWS',
        match: [
            'Starting candidate extraction',
            'No pending candidates',
            { regex: 'Found \\d+ pending', flags: 'i' },
            { regex: 'Processing \\d+ candidate.*for client', flags: 'i' },
            '[skip_returned_visitors]',
            '[skip_converted_users]',
            '[duplicate_channels_filtered]',
            'Extraction complete'
        ]
    },

    'exit-delivery-callback': {
        label: 'AWS → GCP callback — finalize delivery',
        match: [
            'callback_received',
            'batch_finalized',
            'candidate_status_updated',
            'frequency_decremented'
        ]
    },

    'provision-client': {
        label: 'New client onboarding — GA4 integration',
        match: [
            'new_client_detected',
            'provision_started',
            'provision_completed',
            'provision_failed'
        ]
    },

    'process-alerts': {
        label: 'Email alerts — dispatch notifications',
        match: [
            'alert_received',
            'alert_dispatched',
            'email_sent',
            'email_failed'
        ]
    }
};
