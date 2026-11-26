import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Check, LoaderCircle, Mic, RefreshCw, Square, X } from 'lucide-react';
import type { SpeechPublicSettings, SpeechSessionEvent } from '../shared/speech';
import { startSpeechCapture, type SpeechCapture } from './speech-capture';
import { useUiLocale } from './locale';
import { speechProblemText, voiceText } from './voice-copy';
import { speechText } from './speech-copy';
import './speech-input.css';

export interface SpeechPreviewState {
  status: 'idle' | 'connecting' | 'recording' | 'transcribing' | 'failed';
  mode: 'live' | 'after';
  text: string;
  elapsed: number;
  connectionPending?: boolean;
  canRetry?: boolean;
  error?: string;
  errorKey?: keyof typeof voiceText.en;
}
const idle: SpeechPreviewState = { status: 'idle', mode: 'live', text: '', elapsed: 0 };
interface Recording {
  scope: string;
  controller: AbortController;
  id?: string;
  capture?: SpeechCapture;
  timer?: ReturnType<typeof setInterval>;
  stopDeviceUpdates?: () => void;
  stopping: boolean;
  autoFinalizing?: boolean;
  providerReady: boolean;
  canRetry?: boolean;
}

function speechFailure(reason: unknown): Pick<SpeechPreviewState, 'error' | 'errorKey'> {
  if (reason instanceof DOMException) {
    if (reason.name === 'NotAllowedError' || reason.name === 'SecurityError') return { errorKey: 'permissionDenied' };
    if (reason.name === 'NotFoundError' || reason.name === 'OverconstrainedError') return { errorKey: 'deviceMissing' };
    if (reason.name === 'NotReadableError') return { errorKey: 'deviceBusy' };
  }
  const message = (reason instanceof Error ? reason.message : String(reason)).replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '').replace(/[\r\n]+/g, ' ').trim();
  return message ? { error: message.slice(0, 300) } : { errorKey: 'failed' };
}

export function SpeechPreview({ value }: { value: SpeechPreviewState }) {
  const locale = useUiLocale();
  const labels = voiceText[locale];
  const transcript = useRef<HTMLParagraphElement>(null);
  const follow = useRef(true);
  useLayoutEffect(() => {
    if (value.status === 'connecting') follow.current = true;
    if (follow.current && transcript.current) transcript.current.scrollTop = transcript.current.scrollHeight;
  }, [value.text, value.status]);
  if (value.status === 'idle') return null;
  const recordingLabel = value.connectionPending ? labels.recordConnecting : value.mode === 'live' ? 'Live' : labels.recording;
  const label = value.status === 'connecting' ? labels.starting : value.status === 'transcribing' ? value.connectionPending ? labels.waiting : labels.transcribing : value.status === 'failed' ? value.canRetry ? labels.retained : labels.interrupted : `${recordingLabel} · ${Math.floor(value.elapsed / 60)}:${String(value.elapsed % 60).padStart(2, '0')}`;
  return <div className={`speech-preview ${value.status}`} aria-label={labels.speechRecognition}>
    <div className="speech-preview-heading" role="status">{value.status === 'recording' ? <span className="speech-recording-dot" aria-hidden="true"/> : value.status !== 'failed' ? <LoaderCircle size={12} className="speech-spinner" aria-hidden="true"/> : null}<span aria-hidden="true">{label}</span><span className="sr-only">{value.status === 'recording' ? value.connectionPending ? labels.liveConnecting : labels.liveRecording : label}</span></div>
    {value.text && <p ref={transcript} className="speech-preview-text" tabIndex={0} aria-label={labels.transcript} onScroll={event => { const element = event.currentTarget; follow.current = element.scrollHeight - element.scrollTop - element.clientHeight < 16; }}>{value.text}</p>}
    {(value.errorKey || value.error) && <p className="speech-input-error" role="alert">{value.errorKey ? labels[value.errorKey] : speechProblemText(value.error!, locale)}</p>}
  </div>;
}

/** Dictation stays a preview until completion, so streaming never overwrites edits. */
export function SpeechInput({ scope, disabled, onStart, onTranscript, onBusyChange, onPreview }: {
  scope: string;
  disabled: boolean;
  onStart(): void;
  onTranscript(text: string): void;
  onBusyChange(busy: boolean): void;
  onPreview(value: SpeechPreviewState): void;
}) {
  const locale = useUiLocale();
  const currentLocale = useRef(locale);
  currentLocale.current = locale;
  const copy = speechText[locale];
  const [settings, setSettings] = useState<SpeechPublicSettings>();
  const [view, setView] = useState(idle);
  const [loadingSettings, setLoadingSettings] = useState(true);
  const active = useRef<Recording | undefined>(undefined);
  // Main-process events may arrive before the matching invoke result. Retain
  // only the latest event per ID during that short, local start/retry phase.
  const pendingEvents = useRef(new Map<string, SpeechSessionEvent>());
  const viewRef = useRef(view);
  const scopeRef = useRef(scope); scopeRef.current = scope;
  const callbacks = useRef({ onStart, onTranscript, onBusyChange, onPreview });
  callbacks.current = { onStart, onTranscript, onBusyChange, onPreview };
  const mounted = useRef(true);

  function update(value: SpeechPreviewState) {
    viewRef.current = value;
    if (!mounted.current) return;
    setView(value); callbacks.current.onPreview(value);
  }
  function closeMicrophone(recording: Recording) {
    if (recording.timer) clearInterval(recording.timer);
    recording.stopDeviceUpdates?.();
    recording.controller.abort(); recording.capture?.cancel();
  }
  function release(recording: Recording, cancelServer: boolean) {
    if (active.current === recording) active.current = undefined;
    pendingEvents.current.clear();
    closeMicrophone(recording);
    if (cancelServer) void window.workspace.cancelSpeech(recording.id).catch(() => {});
    if (mounted.current) callbacks.current.onBusyChange(false);
  }
  function cancel() {
    const recording = active.current;
    if (recording) release(recording, true);
    update(idle);
  }
  function fail(recording: Recording, reason: unknown) {
    if (active.current !== recording || recording.canRetry) return;
    release(recording, true);
    update({ ...viewRef.current, status: 'failed', canRetry: false, ...speechFailure(reason) });
  }
  function receive(event: SpeechSessionEvent) {
    const recording = active.current;
    if (!recording) return;
    if (!recording.id) {
      pendingEvents.current.set(event.id, event);
      if (pendingEvents.current.size > 8) pendingEvents.current.delete(pendingEvents.current.keys().next().value!);
      return;
    }
    if (recording.id !== event.id) return;
    if (recording.scope !== scopeRef.current) { cancel(); return; }
    if (event.status === 'completed') {
      release(recording, false);
      const text = event.text.trim();
      update(text ? idle : { ...idle, status: 'failed', errorKey: 'noSpeech' });
      if (text) callbacks.current.onTranscript(text);
    } else if (event.status === 'failed') {
      update({ ...viewRef.current, text: event.text || viewRef.current.text });
      if (event.canRetry) {
        // The host freezes its accepted PCM on connection failure. Never cancel
        // that retained recording here, or silently start another microphone.
        recording.canRetry = true; recording.stopping = true;
        closeMicrophone(recording);
        callbacks.current.onBusyChange(false);
        update({ ...viewRef.current, status: 'failed', canRetry: true, ...(event.error ? speechFailure(event.error) : { errorKey: 'connectionLost' }) });
      } else fail(recording, event.error || new Error(voiceText[currentLocale.current].connectionLost));
    } else if (event.status === 'cancelled') {
      release(recording, false); update(idle);
    } else {
      if (event.status === 'recording') recording.providerReady = true;
      if (event.status === 'transcribing' && !recording.stopping) {
        // The host can reach its duration/size limit first. Its accepted audio
        // is already finalizing; discard only the unsent tail and stop the mic.
        recording.stopping = true; recording.autoFinalizing = true;
        closeMicrophone(recording);
      }
      update({ ...viewRef.current, text: event.text, connectionPending: event.status === 'transcribing' ? false : !recording.providerReady, status: recording.stopping || event.status === 'transcribing' ? 'transcribing' : recording.capture ? 'recording' : 'connecting' });
    }
  }

  useLayoutEffect(() => {
    mounted.current = true;
    let settingsChanged = false;
    const offSettings = window.workspace.onSpeechSettings(value => {
      settingsChanged = true;
      if (active.current) cancel();
      if (mounted.current) { setSettings(value); setLoadingSettings(false); }
    });
    const offEvents = window.workspace.onSpeechEvent(receive);
    window.addEventListener('pagehide', cancel);
    void window.workspace.getSpeechSettings().then(value => {
      if (mounted.current && !settingsChanged) setSettings(value);
    }, reason => { if (mounted.current) update({ ...idle, status: 'failed', ...speechFailure(reason) }); }).finally(() => { if (mounted.current) setLoadingSettings(false); });
    return () => {
      window.removeEventListener('pagehide', cancel);
      if (active.current) release(active.current, true);
      callbacks.current.onPreview(idle);
      mounted.current = false; offSettings(); offEvents();
    };
  }, []);
  useEffect(() => { if (active.current?.scope !== scope) cancel(); }, [scope]);
  useEffect(() => { if (disabled && active.current) cancel(); }, [disabled]);

  async function openSettings() {
    try { await window.workspace.openSpeechSettings(); }
    catch (reason) { update({ ...idle, status: 'failed', ...speechFailure(reason) }); }
  }
  async function start() {
    if (disabled || loadingSettings || active.current && !active.current.canRetry) return;
    if (active.current) cancel();
    if (!settings?.enabled || !settings.configured) { await openSettings(); return; }
    const recording: Recording = { scope, controller: new AbortController(), stopping: false, providerReady: false };
    active.current = recording;
    pendingEvents.current.clear();
    callbacks.current.onStart(); callbacks.current.onBusyChange(true);
    update({ ...idle, mode: settings.mode, status: 'connecting' });
    try {
      const session = await window.workspace.startSpeech();
      recording.id = session.id;
      if (active.current !== recording || recording.scope !== scopeRef.current) { void window.workspace.cancelSpeech(session.id).catch(() => {}); return; }
      recording.providerReady = session.status === 'recording';
      const pending = pendingEvents.current.get(session.id);
      pendingEvents.current.clear();
      if (pending) receive(pending);
      else if (session.status === 'transcribing') receive({ id: session.id, status: 'transcribing', text: '' });
      if (active.current !== recording || recording.canRetry || recording.stopping) return;
      recording.capture = await startSpeechCapture({
        locale, microphoneId: settings.microphoneId, signal: recording.controller.signal,
        onChunk: async pcm => {
          if (recording.autoFinalizing || recording.canRetry) return;
          try { await window.workspace.appendSpeech(session.id, pcm); }
          catch (reason) { if (!recording.autoFinalizing && !recording.canRetry) throw reason; }
        },
        onError: reason => { if (!recording.autoFinalizing && !recording.canRetry) fail(recording, reason); }
      });
      if (active.current !== recording || recording.stopping) { recording.capture.cancel(); return; }
      const devices = navigator.mediaDevices;
      const reportMicrophones = () => {
        void devices.enumerateDevices().then(items => {
          if (active.current !== recording || recording.stopping) return;
          const microphones = items.filter(item => item.kind === 'audioinput' && item.deviceId && item.deviceId !== 'default')
            .slice(0, 32).map(item => ({ id: item.deviceId.slice(0, 512), label: item.label.slice(0, 200) }));
          return window.workspace.reportSpeechMicrophones(microphones);
        }).catch(() => {});
      };
      // Device labels are available only during an explicitly granted recording.
      // Share metadata with Settings without granting it microphone access.
      devices.addEventListener('devicechange', reportMicrophones);
      recording.stopDeviceUpdates = () => devices.removeEventListener('devicechange', reportMicrophones);
      reportMicrophones();
      update({ ...viewRef.current, mode: session.mode, status: 'recording', connectionPending: !recording.providerReady });
      const began = performance.now();
      recording.timer = setInterval(() => {
        if (active.current !== recording || recording.stopping) return;
        const elapsed = Math.floor((performance.now() - began) / 1000);
        update({ ...viewRef.current, elapsed });
        if (elapsed >= session.maxRecordingSeconds) void stop();
      }, 250);
    } catch (reason) { if (!recording.autoFinalizing && !recording.canRetry) fail(recording, reason); }
  }
  async function retry() {
    const previous = active.current;
    if (!previous?.id || !previous.canRetry || disabled) return;
    const recording: Recording = { scope, controller: new AbortController(), stopping: true, providerReady: false };
    active.current = recording; pendingEvents.current.clear();
    callbacks.current.onBusyChange(true);
    update({ ...viewRef.current, status: 'transcribing', connectionPending: true, canRetry: false, text: '', error: undefined, errorKey: undefined });
    try {
      const session = await window.workspace.retrySpeech(previous.id);
      recording.id = session.id;
      if (active.current !== recording || recording.scope !== scopeRef.current) { void window.workspace.cancelSpeech(session.id).catch(() => {}); return; }
      const pending = pendingEvents.current.get(session.id);
      pendingEvents.current.clear();
      if (pending) receive(pending);
      // The host reconnects and finishes the retained audio. A retry never
      // acquires a microphone or creates a second recording in the renderer.
    } catch (reason) { fail(recording, reason); }
  }
  async function stop() {
    const recording = active.current;
    if (!recording?.id || !recording.capture || recording.stopping) return;
    recording.stopping = true;
    if (recording.timer) clearInterval(recording.timer);
    recording.stopDeviceUpdates?.();
    update({ ...viewRef.current, status: 'transcribing' });
    try {
      await recording.capture.stop();
      if (active.current === recording) await window.workspace.stopSpeech(recording.id);
    } catch (reason) { fail(recording, reason); }
  }
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && active.current && !event.isComposing) { event.preventDefault(); cancel(); }
    };
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, []);

  const busy = ['connecting', 'recording', 'transcribing'].includes(view.status);
  const configured = settings?.enabled && settings.configured;
  return <span className="speech-input-controls">
    {busy ? <>{view.status === 'recording' && <button type="button" className="chat-icon-button speech-stop" aria-label={copy.stop} title={copy.finish} onClick={() => void stop()}><Square size={13} fill="currentColor"/></button>}<button type="button" className="chat-icon-button" aria-label={copy.cancel} title={`${copy.cancel} (Esc)`} onClick={cancel}><X size={17}/></button></> : <>
      {view.status === 'failed' && <>{view.canRetry && <button type="button" className="chat-icon-button" aria-label={copy.retryRecording} title={copy.retryRecording} disabled={disabled} onClick={() => void retry()}><RefreshCw size={16}/></button>}{view.text && <button type="button" className="chat-icon-button" aria-label={copy.acceptText} title={copy.acceptText} onClick={() => { const text = view.text; cancel(); callbacks.current.onTranscript(text); }}><Check size={17}/></button>}<button type="button" className="chat-icon-button" aria-label={copy.dismiss} title={copy.dismiss} onClick={cancel}><X size={15}/></button></>}
      <button type="button" className="chat-icon-button" aria-label={configured ? copy.start : copy.setup} title={configured ? `${copy.input} · ${settings.mode === 'live' ? 'Live' : copy.after}` : copy.setup} disabled={disabled || loadingSettings} onClick={() => void start()}><Mic size={17}/></button>
    </>}
  </span>;
}
