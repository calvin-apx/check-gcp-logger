import { useCallback, useEffect, useRef, useState } from 'react';

import { fetchPhoneStatus, uploadPhoneFrame } from '../lib/api.js';

// Tuned for low-traffic QA verification — viewers check on the phone every
// ~60s, not watching live. 1-broadcaster-2-viewer session runs ~200 req/hour.
const STATUS_POLL_MS = 60000;
const BROADCAST_INTERVAL_MS = 60000;
const FRAME_MAX_WIDTH = 720;
const JPEG_QUALITY = 0.6;
const STALE_AFTER_MS = 150000;  // ~2.5× broadcast interval — one missed upload is OK

/**
 * Phone-mirror broadcast.
 *
 * Anyone with the ngrok URL is a *viewer* by default — they see the latest
 * frame served by GET /api/phone/frame, polled every 1.5s.
 *
 * Anyone can click "Start broadcasting" to become the *broadcaster*: their
 * browser captures a window via getDisplayMedia, snapshots a JPEG every 1s,
 * and POSTs it to /api/phone/frame. Last writer wins.
 *
 * Broadcaster needs the X-Trigger-Token if TRIGGER_SECRET is set on the server
 * (set it via the Scheduler tab's "set trigger token" button — same secret).
 */
export default function PhoneMirrorView({ refreshKey }) {
    // Viewer state.
    const [status, setStatus] = useState(null);
    const [frameKey, setFrameKey] = useState(0); // increments to cache-bust <img>

    // Broadcaster state.
    const [broadcasting, setBroadcasting] = useState(false);
    const [starting, setStarting] = useState(false);
    const [broadcastError, setBroadcastError] = useState(null);
    const [lastUpload, setLastUpload] = useState(null);

    // Refs used during broadcast.
    const videoRef = useRef(null);          // hidden <video> playing the captured stream
    const canvasRef = useRef(null);          // offscreen canvas for JPEG encoding
    const streamRef = useRef(null);          // MediaStream from getDisplayMedia
    const intervalRef = useRef(null);        // upload-loop interval id

    // 1Hz tick to keep "last update" relative time fresh.
    const [, setNow] = useState(Date.now());
    useEffect(() => {
        const id = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(id);
    }, []);

    // Viewer polling — runs always so a broadcaster sees their own latest frame
    // too. Pauses when the tab is hidden so we don't burn ngrok quota on a
    // backgrounded tab.
    useEffect(() => {
        let cancelled = false;
        let intervalId = null;
        async function tick() {
            try {
                const s = await fetchPhoneStatus();
                if (cancelled) return;
                setStatus(s);
                if (s.has_frame && s.uploaded_at !== status?.uploaded_at) {
                    setFrameKey((k) => k + 1);
                }
            } catch (_e) { /* swallow */ }
        }
        function startPolling() {
            if (intervalId !== null) return;
            tick();
            intervalId = setInterval(tick, STATUS_POLL_MS);
        }
        function stopPolling() {
            if (intervalId === null) return;
            clearInterval(intervalId);
            intervalId = null;
        }
        function onVisibility() {
            if (document.hidden) stopPolling();
            else startPolling();
        }
        document.addEventListener('visibilitychange', onVisibility);
        if (!document.hidden) startPolling();
        return () => {
            cancelled = true;
            stopPolling();
            document.removeEventListener('visibilitychange', onVisibility);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const stopBroadcast = useCallback(() => {
        if (intervalRef.current) {
            clearInterval(intervalRef.current);
            intervalRef.current = null;
        }
        if (streamRef.current) {
            for (const t of streamRef.current.getTracks()) t.stop();
            streamRef.current = null;
        }
        if (videoRef.current) videoRef.current.srcObject = null;
        setBroadcasting(false);
    }, []);

    const captureFrame = useCallback(async () => {
        const video = videoRef.current;
        if (!video || video.videoWidth === 0) return;

        if (!canvasRef.current) canvasRef.current = document.createElement('canvas');
        const canvas = canvasRef.current;

        const scale = Math.min(1, FRAME_MAX_WIDTH / video.videoWidth);
        canvas.width = Math.floor(video.videoWidth * scale);
        canvas.height = Math.floor(video.videoHeight * scale);
        canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);

        const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', JPEG_QUALITY));
        if (!blob) return;

        const result = await uploadPhoneFrame(blob);
        setLastUpload({ at: Date.now(), size: result.size_bytes });
        setBroadcastError(null);
    }, []);

    const startBroadcast = useCallback(async () => {
        setBroadcastError(null);
        if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
            setBroadcastError('Screen capture not supported (requires HTTPS / localhost).');
            return;
        }
        setStarting(true);
        try {
            const stream = await navigator.mediaDevices.getDisplayMedia({
                video: { frameRate: { ideal: 5 } },
                audio: false
            });
            // "Stop sharing" button in the browser banner → end our broadcast too.
            stream.getVideoTracks()[0].addEventListener('ended', stopBroadcast);

            streamRef.current = stream;
            if (videoRef.current) {
                videoRef.current.srcObject = stream;
                await videoRef.current.play().catch(() => {});
            }
            setBroadcasting(true);

            // Send one frame immediately so viewers see something within a second.
            await captureFrame().catch((err) => setBroadcastError(err.message));

            intervalRef.current = setInterval(() => {
                captureFrame().catch((err) => {
                    setBroadcastError(err.message);
                    // 401 = bad token; no point hammering.
                    if (err.status === 401) stopBroadcast();
                });
            }, BROADCAST_INTERVAL_MS);
        } catch (err) {
            if (err && err.name !== 'NotAllowedError') {
                setBroadcastError(err.message || String(err));
            }
        } finally {
            setStarting(false);
        }
    }, [captureFrame, stopBroadcast]);

    // Header refresh button: stop broadcasting (so user can re-pick the window).
    useEffect(() => {
        if (refreshKey === 0) return;
        if (broadcasting) stopBroadcast();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [refreshKey]);

    // Release the stream on unmount.
    useEffect(() => () => stopBroadcast(), [stopBroadcast]);

    const ageSec = status?.uploaded_at
        ? Math.max(0, Math.floor((Date.now() - new Date(status.uploaded_at).getTime()) / 1000))
        : null;
    const stale = ageSec !== null && ageSec * 1000 > STALE_AFTER_MS;

    return (
        <div className="flex min-h-0 flex-1 flex-col bg-zinc-900">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-800 bg-zinc-900 px-4 py-2 text-sm">
                <div className="flex items-center gap-3 text-zinc-300">
                    <span>Phone mirror</span>
                    {broadcasting && (
                        <span className="flex items-center gap-1.5 text-xs text-red-400">
                            <span className="h-2 w-2 animate-pulse rounded-full bg-red-500" />
                            broadcasting
                            {lastUpload && (
                                <span className="text-zinc-500">
                                    · last frame {Math.round((Date.now() - lastUpload.at) / 1000)}s ago
                                    {' · '}{Math.round(lastUpload.size / 1024)}KB
                                </span>
                            )}
                        </span>
                    )}
                    {!broadcasting && status?.has_frame && (
                        <span className={'text-xs ' + (stale ? 'text-amber-400' : 'text-zinc-500')}>
                            viewer{stale ? ' · broadcast paused' : ''}
                            {ageSec !== null && ` · ${ageSec}s ago`}
                        </span>
                    )}
                </div>
                <div className="flex items-center gap-2">
                    {!broadcasting ? (
                        <button type="button" onClick={startBroadcast} disabled={starting} className="btn btn-primary">
                            {starting ? 'starting…' : status?.has_frame ? 'take over broadcast' : 'start broadcasting'}
                        </button>
                    ) : (
                        <button type="button" onClick={stopBroadcast} className="btn">
                            stop broadcasting
                        </button>
                    )}
                </div>
            </div>

            {/* Hidden video element used as the capture source while broadcasting. */}
            <video ref={videoRef} className="hidden" muted playsInline />

            <div className="relative flex flex-1 items-center justify-center overflow-hidden">
                {status?.has_frame ? (
                    <img
                        key={frameKey}
                        src={`/api/phone/frame?t=${frameKey}`}
                        alt="Phone mirror"
                        className={'max-h-full max-w-full object-contain ' + (stale ? 'opacity-50' : '')}
                    />
                ) : (
                    <div className="max-w-lg px-6 text-center text-zinc-400">
                        <div className="space-y-3">
                            <div className="text-lg text-zinc-200">No active broadcast</div>
                            <ol className="mx-auto max-w-md list-decimal space-y-1 text-left text-sm">
                                <li>Open <span className="font-mono text-orange-400">LetsView</span> and mirror your iPhone to it.</li>
                                <li>Click <strong>start broadcasting</strong> above.</li>
                                <li>Pick the LetsView window in the browser prompt.</li>
                            </ol>
                            <div className="text-xs text-zinc-500">
                                Everyone visiting this URL will see your phone screen, updated about once per second.
                            </div>
                        </div>
                    </div>
                )}

                {broadcastError && (
                    <div className="absolute bottom-4 left-1/2 max-w-md -translate-x-1/2 rounded bg-red-900/80 px-3 py-2 text-xs text-red-100">
                        {broadcastError}
                    </div>
                )}
            </div>
        </div>
    );
}
