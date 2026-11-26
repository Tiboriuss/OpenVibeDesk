# Speech input

[Documentation index](README.md) · [AI providers](ai-providers.md)

Speech input turns microphone audio into editable text in the Chat composer. Its provider, endpoint, model, credentials and recording mode are configured separately from the chat provider. You can, for example, use ChatGPT sign-in for chat and an API service for transcription.

## Configure speech input

Open **Settings → AI & connection → Voice input**, or click the microphone in Chat before speech input is configured.

1. Enable speech input and select its provider.
2. Choose **Live** or **After recording**, according to the provider's capabilities.
3. Enter the complete transcription endpoint, authentication method and API key. Select a transcription model or Azure deployment where required.
4. Optionally specify the language and microphone, then save.

The system default microphone works without a device selection. Named microphones become available after Chat has obtained microphone permission for the first recording. OVD keeps that discovered device list for the current app session; a previously selected microphone remains selected after restart.

The API key is separate from the chat API key. Leaving its field empty retains the saved key for the same provider, authentication method and endpoint host. Changing one of those clears the old association; enter the appropriate key for the new connection. Keys are stored in OVD's local credential vault and are not returned by the public settings interface or Assistant tools.

ChatGPT sign-in currently does not include access to the transcription API. It therefore does not automatically configure speech input. See the [official Sign in with ChatGPT limitations](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations).

## Providers and modes

| Provider | Live | After recording | Configuration |
| --- | --- | --- | --- |
| OpenAI | Yes | Yes | Defaults supply the transcription endpoint and model; a separate API key is required. |
| OpenAI-compatible | If the service implements Realtime transcription | If the service implements multipart audio transcription | Enter the complete endpoint, model and supported authentication method. A chat-compatible API alone is insufficient. |
| Azure OpenAI / Foundry | With a suitable Realtime deployment | With a suitable audio-transcription deployment | Enter the complete deployment endpoint, including its API version where required; API-key authentication is available. |
| DeepSeek | No | Yes | Uses the dedicated `/v1/tools/asr` endpoint and file upload; it does not use the chat-completions endpoint. |

**Live** starts microphone capture without waiting for the provider connection. Until the WebSocket session is ready, OVD buffers audio in memory and shows **Recording · Connecting…**. When ready, it sends the buffered audio in order and continues streaming. The preview updates as the provider returns partial or completed segments. Realtime protocols differ: use **Standard** for the current GA protocol or **Legacy / Beta** according to your endpoint. Audio is committed at pauses and in bounded intervals, so a provider that only returns completed segments may update less frequently than one that streams partial text.

**After recording** keeps audio in memory while recording and uploads a single WAV file after Stop. There is no partial transcript during recording. This mode is distinct from streaming a response to an already completed audio upload.

Use a complete `wss://` URL for Live and a complete `https://` URL for After recording. Unencrypted `ws://` and `http://` endpoints are accepted only on localhost. Endpoint redirects are not followed; enter the final URL. Embedded URL credentials are not supported.

## Dictate in Chat

- Click the microphone to start. Recording begins as soon as microphone access is available; it does not wait for a transcription provider. Operating-system microphone permission is required where applicable.
- Continue editing the existing message while the transcript appears in a separate preview.
- Click **Stop** to release the microphone immediately, including while Live is still connecting. OVD finishes transcribing the captured audio and inserts the result at the tracked text position. You can edit it before sending.
- Click **Cancel** or press Escape to discard the dictation and keep the typed draft. If the operating system denies microphone access, enable it in system settings, then click the microphone again.

Closing Chat releases the microphone before the window waits for the draft to save. Switching chats or saving new voice settings also cancels the current recording. Only one recording can run at a time. Sending becomes available when dictation finishes or is cancelled.

If transcription fails after audio has been captured, OVD can retain that recording in memory. **Retry transcription** explicitly reconnects and transcribes the retained recording; it does not open the microphone again. OVD never automatically replays audio after a connection failure. Available partial text remains a preview and can be accepted explicitly; an incomplete transcript is not silently treated as a successful final result.

Cancelling or dismissing the failed recording discards its retained audio. Starting another recording, changing saved speech settings, switching chat sessions or closing the Chat window also discards it. Retained recordings do not survive an application restart.

Recordings are limited to two minutes. The Live connection buffer holds at most 20 seconds of audio; a connection that does not become ready fails visibly instead of growing the queue indefinitely. OVD captures mono PCM at 24 kHz and 16 bits, with bounded buffers and transcript length. It retains at most one failed recording per Chat owner. Audio is kept in memory and is not saved as an audio attachment or history file. Once inserted and sent, transcribed text follows the normal Chat persistence rules.

## Assistant control

The Assistant discovers speech configuration through the existing lazy module-tool flow:

- `settings.speech_get` reads the current provider, mode, endpoint, model and key-presence status.
- `settings.speech_save` prepares allowed configuration values in the visible Settings form for review and saving. It cannot read or supply an API key.

For example: “Set up speech input in German using this Azure transcription deployment.” The Assistant can prepare the configuration; microphone recording still starts from the user's microphone control. Configuration changes do not start recording or send a chat message.

## Implementation boundaries

Speech is a host input service, independent of optional business modules and the chat provider transport:

- [`shared/speech.ts`](../shared/speech.ts) defines validated configuration, provider capabilities, session events and limits.
- [`electron/speech.ts`](../electron/speech.ts) owns persisted settings, credentials, recording ownership and lifecycle.
- [`electron/speech-adapters.ts`](../electron/speech-adapters.ts) implements Realtime WebSocket and recorded-audio upload transports.
- [`src/speech-capture.ts`](../src/speech-capture.ts) and its AudioWorklet capture and resample microphone audio without blocking the renderer.
- [`src/SpeechInput.tsx`](../src/SpeechInput.tsx) manages the composer controls, preview and cleanup.

Speech settings are stored in `speech-settings.json` under the existing OVD user profile. An unreadable settings file is preserved and reported instead of being silently overwritten. Raw credentials remain in the shared local vault. Microphone access is restricted to the trusted Chat window with an active user-initiated recording session; optional module views do not receive microphone access through this feature.

Additional provider support belongs behind the speech adapter interface. This implementation does not add a third-party module manifest contribution for replacing capture or registering speech providers.

## Provider references

- [OpenAI Realtime transcription](https://developers.openai.com/api/docs/guides/realtime-transcription)
- [OpenAI speech to text](https://developers.openai.com/api/docs/guides/speech-to-text)
- [Azure OpenAI API reference](https://learn.microsoft.com/en-us/azure/foundry/openai/reference)
- [Azure Realtime WebSocket transcription](https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/realtime-audio-websockets)
- [DeepSeek speech recognition](https://api-docs.deepseek.com/guides/asr/)

Provider availability, models and deployment requirements can change. The mode selector describes the protocol supported by OVD; it does not prove that an arbitrary endpoint or account supports that protocol.
