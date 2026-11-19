import type { UiLocale } from '../shared/locale';
import { voiceText } from './voice-copy';

const workletUrl = new URL('./speech-capture-worklet.js?no-inline', import.meta.url).href;

export interface SpeechCapture {
  /** Flush the final partial chunk and all pending IPC writes before finishing. */
  stop(): Promise<void>;
  cancel(): void;
}

/** Only called from the microphone button, after the main process grants a lease. */
export async function startSpeechCapture(options: {
  locale: UiLocale;
  microphoneId: string;
  signal: AbortSignal;
  onChunk(pcm: ArrayBuffer): Promise<void>;
  onError(error: unknown): void;
}): Promise<SpeechCapture> {
  const labels = voiceText[options.locale];
  let stream: MediaStream | undefined;
  let context: AudioContext | undefined;
  let source: MediaStreamAudioSourceNode | undefined;
  let processor: AudioWorkletNode | undefined;
  let silent: GainNode | undefined;
  let closed = false;
  let flushing = false;
  let pending = Promise.resolve();
  let pendingBytes = 0;
  let failure: unknown;
  let flushAck: (() => void) | undefined;
  let stopPromise: Promise<void> | undefined;

  function cleanup() {
    if (closed) return;
    closed = true;
    options.signal.removeEventListener('abort', cleanup);
    stream?.getTracks().forEach(track => track.stop());
    source?.disconnect(); processor?.disconnect(); silent?.disconnect();
    processor?.port.close();
    flushAck?.();
    if (context && context.state !== 'closed') void context.close().catch(() => {});
  }
  function fail(reason: unknown) {
    if (closed || failure) return;
    failure = reason;
    cleanup();
    options.onError(reason);
  }
  function checkActive() {
    if (closed || options.signal.aborted) {
      // getUserMedia cannot be cancelled: dispose tracks that arrive afterwards.
      stream?.getTracks().forEach(track => track.stop());
      if (context && context.state !== 'closed') void context.close().catch(() => {});
      throw new DOMException(labels.cancelled, 'AbortError');
    }
  }
  options.signal.addEventListener('abort', cleanup, { once: true });
  try {
    checkActive();
    if (!navigator.mediaDevices?.getUserMedia) throw new Error(labels.windowUnavailable);
    stream = await navigator.mediaDevices.getUserMedia({ audio: {
      ...(options.microphoneId ? { deviceId: { exact: options.microphoneId } } : {}),
      channelCount: { ideal: 1 }, echoCancellation: true, noiseSuppression: true, autoGainControl: true
    }, video: false });
    checkActive();
    for (const track of stream.getAudioTracks()) track.addEventListener('ended', () => { if (!flushing) fail(new Error(labels.disconnected)); }, { once: true });
    context = new AudioContext();
    await context.audioWorklet.addModule(workletUrl);
    checkActive();
    processor = new AudioWorkletNode(context, 'ovd-speech-capture', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
    processor.onprocessorerror = () => fail(new Error(labels.captureInterrupted));
    processor.port.onmessage = (event: MessageEvent<{ type: string; pcm?: ArrayBuffer }>) => {
      if (event.data.type === 'flushed') { flushAck?.(); return; }
      if (closed || event.data.type !== 'pcm' || !(event.data.pcm instanceof ArrayBuffer)) return;
      const pcm = event.data.pcm;
      pendingBytes += pcm.byteLength;
      // At most four seconds may wait for the main process; never grow an
      // unbounded queue if the provider or IPC connection stops accepting audio.
      if (pendingBytes > 24_000 * 2 * 4) { fail(new Error(labels.tooSlow)); return; }
      pending = pending.then(async () => {
        if (closed || failure) return;
        try { await options.onChunk(pcm); }
        catch (reason) { fail(reason); }
        finally { pendingBytes -= pcm.byteLength; }
      });
    };
    source = context.createMediaStreamSource(stream);
    silent = context.createGain(); silent.gain.value = 0;
    source.connect(processor); processor.connect(silent); silent.connect(context.destination);
    await context.resume();
    checkActive();
    return {
      cancel: cleanup,
      stop() {
        return stopPromise ??= (async () => {
          if (closed) { if (failure) throw failure; return; }
          flushing = true;
          try {
            await new Promise<void>((resolve, reject) => {
              const timeout = setTimeout(() => reject(new Error(labels.finishFailed)), 2000);
              flushAck = () => { clearTimeout(timeout); resolve(); };
              processor!.port.postMessage('flush');
            });
            await pending;
            if (failure) throw failure;
          } finally { cleanup(); }
        })();
      }
    };
  } catch (reason) { cleanup(); throw reason; }
}
