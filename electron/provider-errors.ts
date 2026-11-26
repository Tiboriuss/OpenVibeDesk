import type { UiLocale } from '../shared/locale';

/** Only host-authored protocol errors are localised. Provider payloads stay private. */
export class ProviderDisplayError extends Error {
  constructor(de: string, readonly english: string) { super(de); }
  display(locale: UiLocale): string { return locale === 'en' ? this.english : this.message; }
}

export function providerErrorText(error: unknown, locale: UiLocale, fallback: string): string {
  return error instanceof ProviderDisplayError ? error.display(locale) : error instanceof Error ? error.message : fallback;
}

const messages = {
  rephrasingTools: ["Beim Neuformulieren sind keine Werkzeugaufrufe erlaubt.", "Rephrasing cannot run tool calls."],
  completeText: ["Der Endpunkt hat auch ohne Streaming ein nicht unterstütztes Textformat geliefert.", "The non-streaming response used an unsupported text format."],
  completeMissing: ["Der Endpunkt hat auch ohne Streaming keine Antwort geliefert.", "The endpoint returned no response in non-streaming mode."],
  completeInvalid: ["Der Endpunkt hat auch ohne Streaming keine gültige Antwort geliefert.", "The non-streaming response was invalid."],
  completeAssistant: ["Der Endpunkt hat auch ohne Streaming keine gültige Assistentenantwort geliefert.", "The non-streaming response did not contain a valid assistant message."],
  completeJson: ["Der Endpunkt hat auch ohne Streaming keine gültige JSON-Antwort geliefert.", "The non-streaming response contained invalid JSON."],
  completeUnfinished: ["Der Endpunkt hat auch ohne Streaming keine vollständig abgeschlossene Antwort geliefert.", "The non-streaming response ended before the message was complete."],
  completeTimeout: ["Der Endpunkt hat auch ohne Streaming nicht rechtzeitig geantwortet.", "The non-streaming request timed out."],
  unsupportedText: ["Der Endpunkt hat ein nicht unterstütztes Textformat geliefert.", "The endpoint returned an unsupported text format."],
  unsupportedItem: ["Der Endpunkt hat einen nicht angebotenen Responses-Ausgabetyp geliefert.", "The endpoint returned an unsupported Responses output type."],
  empty: ["Der Endpunkt hat keine Antwort geliefert.", "The endpoint returned an empty response."],
  invalidResponse: ["Der Endpunkt hat keine gültige Responses-Antwort geliefert.", "The endpoint returned an invalid Responses API response."],
  invalidOutput: ["Der Endpunkt hat keine gültige Responses-Ausgabe geliefert.", "The endpoint returned invalid Responses output."],
  noText: ["Der Endpunkt hat keine lesbare Textantwort geliefert.", "The endpoint returned no readable text."],
  unfinishedAssistant: ["Der Endpunkt hat keine vollständig abgeschlossene Assistentenantwort geliefert.", "The assistant message ended before it was complete."],
  unfinishedResponse: ["Der Endpunkt hat keine vollständig abgeschlossene Responses-Antwort geliefert.", "The Responses API did not finish the response."],
  unfinishedOutput: ["Der Endpunkt hat keine vollständig abgeschlossene Responses-Ausgabe geliefert.", "The Responses output was incomplete."],
  unfinishedContinuation: ["Der Endpunkt hat keine vollständig abgeschlossenen Responses-Fortsetzungsdaten geliefert.", "The Responses continuation data was incomplete."],
  timeout: ["Der Endpunkt hat nicht rechtzeitig geantwortet.", "The endpoint timed out."],
  invalidEvent: ["Der Endpunkt hat ungültige Responses-Ereignisse geliefert.", "The endpoint returned invalid Responses events."],
  invalidContinuation: ["Der Endpunkt hat ungültige Responses-Fortsetzungsdaten geliefert.", "The endpoint returned invalid Responses continuation data."],
  invalidStream: ["Der Endpunkt hat ungültige Streaming-Daten geliefert.", "The endpoint returned invalid streaming data."],
  conflictingOutput: ["Der Endpunkt hat widersprüchliche Responses-Ausgabedaten geliefert.", "The endpoint returned inconsistent Responses output."],
  conflictingText: ["Der Endpunkt hat widersprüchliche Streaming-Texte geliefert.", "The streamed text conflicts with the completed response."],
  tooLarge: ["Die Antwort des Endpunkts ist zu groß.", "The endpoint response exceeds the size limit."],
  streamEnded: ["Die Streaming-Antwort wurde vorzeitig beendet.", "The stream ended before the response was complete."],
  connection: ["Die Verbindung zum Endpunkt ist fehlgeschlagen. Bitte URL und Erreichbarkeit prüfen.", "Could not connect to the endpoint. Check the URL and network connection."],
  completeLarge: ["Die vollständige Antwort des Endpunkts ist zu groß.", "The complete response exceeds the size limit."],
  completeConnection: ["Die vollständige Antwort des Endpunkts konnte nicht geladen werden. Bitte Verbindung prüfen.", "Could not load the complete response. Check the network connection."],
  textOnly: ["Der Endpunkt hat keine reine Textantwort geliefert.", "The endpoint did not return a text-only response."],
  chatgptProtocol: ["Der ChatGPT-Zugang unterstützt nur die Responses API.", "This ChatGPT connection requires the Responses API."],
  azureModels: ["Dieser Azure-Deployment-Endpunkt bietet keine Modellliste. Trage den Deployment-Namen manuell ein oder verwende /openai/v1.", "This Azure deployment endpoint does not list models. Enter the deployment name manually or use /openai/v1."],
  azureResponses: ["Die Responses API benötigt bei Azure die Ressourcen-URL mit /openai/v1, keinen Deployment-Pfad.", "For the Responses API, use the Azure resource URL ending in /openai/v1."],
  azureDeployment: ["Der Modellname muss zum Deployment im Azure-Endpunkt passen. Für mehrere Deployments verwende /openai/v1.", "Use the deployment name from the Azure endpoint as the model, or use /openai/v1 for multiple deployments."],
} as const;

export function providerFailure(key: keyof typeof messages): ProviderDisplayError {
  const [de, en] = messages[key];
  return new ProviderDisplayError(de, en);
}
