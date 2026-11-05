# AI providers

[Documentation](README.md) · [Getting started](getting-started.md#connect-an-ai-provider) · [Architecture](architecture.md#llm-and-mcp-pipeline)

Configure the Assistant under **Settings → AI & connection** (**Einstellungen → KI & Verbindung**). OVD keeps one active connection with two model slots: **Intelligent** and **Simple**. Each slot has its own Thinking setting. Provider selection configures the connection; modules and their tools remain part of the same OVD workspace.

This guide describes the current checkout. An older installed release may not yet contain these provider controls.

| Provider selection | Connection | Model fields |
| --- | --- | --- |
| **OpenAI** | API endpoint and API key; Chat Completions or Responses API. | Model IDs available to that API account. |
| **Azure AI Foundry / Azure OpenAI** | Azure resource endpoint and key; v1 supports the selected protocol, subject to the deployed model. | Your actual Azure deployment names. |
| **OpenAI-compatible / local provider** | A compatible gateway or local server, with selectable authentication. | The IDs accepted by that service. |
| **ChatGPT** | Direct browser sign-in and authorized ChatGPT plan usage through the public Responses API. | Models available to the selected ChatGPT account. See [ChatGPT setup](#sign-in-with-chatgpt). |

## OpenAI API

1. Select **OpenAI** under **Verbindung**.
2. Enter `https://api.openai.com/v1` as **Endpunkt-URL** and use **Bearer-Token** authentication.
3. Enter your API key and choose the **Schnittstelle** required by the model: **Chat Completions** or **Responses API**.
4. Save the connection. Under **Modelle**, load the list or enter the intelligent/simple model IDs manually, then save.

The Responses adapter supports streamed text and function calls through the same OVD agent loop. It sends stateless requests with `store: false`; OVD supplies the needed conversation and tool results. Encrypted reasoning continuation is retained only within the active run, not saved in chat/evidence or carried into a separate user request. Selecting a Responses-only model while using Chat Completions will fail; choose the matching interface. An API key connection and a ChatGPT plan connection have different authentication and account access.

The Thinking selection is model-specific. **Aus** omits the optional reasoning setting; it does not promise that the model performs no internal reasoning. Start with **Aus** if the provider rejects an unsupported setting. See the official [Responses API](https://developers.openai.com/api/docs/guides/migrate-to-responses) and [function calling](https://developers.openai.com/api/docs/guides/function-calling) documentation for model/API behavior.

## Azure AI Foundry and Azure OpenAI

### Recommended resource endpoint

1. Select **Azure AI Foundry / Azure OpenAI**.
2. Enter your resource's model endpoint, for example:

   ```text
   https://your-resource.openai.azure.com/openai/v1
   ```

   The corresponding `https://your-resource.services.ai.azure.com/openai/v1` format is also supported. A bare resource URL is normalized to `/openai/v1`. A Foundry project URL or portal URL is not a model endpoint.
3. Use **API-Schlüssel (api-key)**, the Azure preset's default, and enter the resource key.
4. Select **Responses API** or **Chat Completions** according to the deployed model's supported interface. The shared `/openai/v1` base path alone does not make every model support both.
5. Enter your deployment's **name**, rather than assuming the public model catalog ID is correct. The two slots can use the same deployment or two different deployments on this resource.
6. Save. Try an ordinary chat request, then a small Workspace task if the deployment supports tool calling.

For example, if a model was deployed under `workshop-assistant`, enter `workshop-assistant` in the model field even if its underlying model has another name. OVD puts this value in the API's `model` field. A `/models` response may describe catalog models rather than usable deployments; manual deployment entry remains available when discovery is unavailable or unsuitable.

The v1 API normally needs no dated **Azure API-Version**. These endpoint and deployment rules follow Microsoft's [v1 API guidance](https://learn.microsoft.com/en-us/azure/foundry/openai/api-version-lifecycle); the [Chat Completions reference](https://learn.microsoft.com/en-us/rest/api/microsoft-foundry/azureopenai/chat) documents Azure's `api-key` authentication.

### Existing deployment URLs

OVD also accepts a classic endpoint such as:

```text
https://your-resource.openai.azure.com/openai/deployments/workshop-assistant/chat/completions?api-version=2024-10-21
```

Saving extracts the completion route and API version into their connection fields. A full v1 `/responses` URL similarly selects the Responses interface. Classic `/openai/deployments/<name>` paths use Chat Completions and a dated API version; the default is `2024-10-21` if none was supplied. Both model slots must target the deployment named in that path. Use the v1 resource URL for different deployments or Responses.

The optional **Azure API-Version** field appears for a classic deployment URL or an existing version value. If both the URL and the field specify a version, they must agree. OVD does not discover Azure resources through the management API or manage deployments. Microsoft Entra browser sign-in and automatic token refresh are not implemented; the authentication selector controls the supplied credential's request header.

## Compatible gateways and local models

Choose **OpenAI-kompatibel / lokaler Anbieter** and enter the service's documented OpenAI-compatible base URL. For example, a local service might expose `http://localhost:1234/v1`; the address and model IDs depend on that service. OVD accepts HTTP only for loopback addresses. Remote endpoints require HTTPS, and redirects are rejected.

Choose the supported protocol and authentication: **Bearer-Token**, **API-Schlüssel (api-key)** or **Ohne Anmeldung**. The latter sends no credential header. A native provider API with a different request/stream format does not become compatible merely by entering its URL; it needs an OpenAI-compatible gateway or a dedicated adapter.

Save the connection before refreshing the model list. An unavailable list does not prevent manual model entry. Ordinary chat needs streamed text; Workspace tools also need complete function calling with the offered schemas. Turn off **Workspace-Werkzeuge** for a model that supports text but not tools.

## Sign in with ChatGPT

The **ChatGPT** provider connects directly through the official [Sign in with ChatGPT flow for open-source apps](https://developers.openai.com/siwc/token-sharing-open-source). OVD opens your system browser for OAuth authorization and then calls `https://api.openai.com/v1/responses` itself. No separate CLI, agent runtime or API key is needed for this connection.

1. Select **ChatGPT** under **Verbindung**.
2. Choose **Continue with ChatGPT**. The browser opens the OpenAI sign-in page.
3. Choose the intended ChatGPT account/workspace and review the request to let OpenVibeDesk use your ChatGPT plan for eligible AI requests. Finish authorization in the browser.
4. Return to OVD. It shows the connected account and whether ChatGPT plan usage was actually granted. An identity-only sign-in does not enable model requests.
5. On the first plan-enabled connection, dismiss **Du verwendest deinen ChatGPT-Plan** after reviewing how to manage usage.
6. Save the AI settings, load the model list and choose your intelligent/simple models. The list belongs to the selected ChatGPT account; its choices may differ from an API-key account.

While the browser flow is pending, **Anmeldung abbrechen** cancels the attempt. Existing active account credentials remain available if a new sign-in fails or is cancelled. **Konto hinzufügen** creates a separate registration, and an account selector appears when multiple saved connections exist. A saved disconnected account can be selected and reconnected with **Continue with ChatGPT**. Model choices are refreshed deliberately after changing accounts; OVD does not silently substitute another model.

**Nutzung in ChatGPT verwalten** opens ChatGPT's usage settings. The Chat composer identifies when the ChatGPT provider is selected and links to the same usage controls. OpenAI determines account eligibility, available models and usage limits. A connected identity and a grant to use the plan are separate states; model requests require both. When plan usage is unavailable or a usage limit is reached, review the account's usage settings before deliberately trying again. OVD does not switch to a separately billed API connection automatically.

The local host keeps an opaque installation identity and the issued registration IDs across restarts. OAuth uses a fresh state, nonce and PKCE verifier for each attempt; the main process validates the callback and signed ID token before accepting the new account. Access, refresh and ID tokens stay in the local encrypted credential store. They are never returned to the settings renderer, put in chat context, copied from another app or sent to configurable provider endpoints. Refresh uses the same saved registration. **Abmelden** ends the selected renewable session and clears its locally stored credentials; the account's registration remains available for reconnecting.

This flow is an OpenAI preview for eligible open-source/local apps, rather than unrestricted access to every API endpoint or model. It uses streamed, stateless Responses requests with the context supplied in `input`. OVD groups its lazily selected functions according to the flow's supported tool format. The same OVD permissions, configured execution limits, operation journal and tool-free reformulation path apply. See [models and inference](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference), [preview limitations](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations) and [account/session behavior](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions) for the current service contract.

## Credentials and saved settings

API credentials are stored in the local encrypted credential store, separated by endpoint and authentication mode. The renderer receives only whether a credential is present. Leaving a stored key field empty preserves that credential; the remove action clears it for the saved connection. Switching providers preserves the form's model names and custom endpoint while you finish editing. Review the endpoint and authentication before saving the new connection.

The local vault's key lives beside its encrypted file in the user profile, so it avoids normal-use OS password prompts and is weaker than OS-keychain protection. When updating from releases through v0.1.7, reenter API keys or sign in again once; legacy OS entries are not imported or deleted automatically. See [credential storage](getting-started.md#credential-storage) for file locations, backup requirements and failure behavior.

The Assistant can inspect public connection settings and prepare provider, interface, endpoint and model changes through `settings.ai_get` and `settings.ai_save`. With ChatGPT selected, the public status also includes the selected account, saved account labels, sign-in/plan-access state and connection errors, so the Assistant can explain a connection problem. It cannot read tokens, fill saved secrets or authorize your ChatGPT account. You review and save the prepared settings. Workspace access, confirmations, code approval and operation-recovery rules continue to apply across providers.

## Troubleshooting and validation scope

| Symptom | Check |
| --- | --- |
| Azure returns HTTP 401/403 | Resource key, selected authentication mode and resource access. API keys and Entra bearer tokens are different credential types. |
| Azure returns HTTP 404 | Resource inference URL, actual deployment name and selected protocol. Do not use the Foundry portal/project URL. |
| HTTP 400/422 | Model/protocol compatibility, deployment and Thinking setting. Responses-only models cannot use Chat Completions. |
| HTTP 429 | Provider quota or request limits. Wait or adjust the account quota before deliberately trying a new request. |
| Model list is unavailable | Enter the model/deployment name manually. Model discovery does not test a chat request. |
| A classic Azure URL has no model list | Use its exact deployment name or switch to the v1 resource endpoint. |
| ChatGPT browser sign-in was cancelled or failed | Start **Continue with ChatGPT** again. A new attempt uses a fresh state/PKCE verifier; existing active credentials are retained. |
| ChatGPT is connected but plan use is unavailable | Check the selected account/workspace and granted permissions. Reconnect if needed; a successful identity sign-in alone does not grant model access. |
| ChatGPT reports a usage limit | Open **Nutzung in ChatGPT verwalten**, review the plan/app limit and deliberately retry when available. |
| ChatGPT model list changed | Refresh the selected account's list and choose a permitted model. OVD does not reuse another account's catalog automatically. |
| Tools fail but text works | Confirm that the selected model supports the chosen protocol's function calling and that Workspace tools are enabled. |
| Responses reports contradictory output | Enable **Diagnoseprotokoll** on the affected computer before a new reproduction, then export the [diagnostic report](diagnostics.md). It identifies the exact parser conflict without copying text or credentials. Do not infer that every such error has the same cause. |

HTTP transport checks use synthetic local endpoints and non-secret fixtures. They establish route/header handling and the exercised streaming/tool contracts, not compatibility with every Azure account, deployment, gateway or model. A real Azure deployment must be checked with its own resource and access configuration. No provider credentials or real mailbox mutations are required for the synthetic checks.

The direct ChatGPT flow is validated with synthetic authorization, signed identity-token and model fixtures in an isolated local profile. Such checks cannot establish eligibility or a successful request for every real ChatGPT account. A live account still needs to complete its own authorization and use an available model.

The Responses transport waits for a completed response before returning any function calls for execution. If a successful terminal event contains an empty output list, OVD can assemble the response from complete `response.output_item.done` snapshots received in that same stream. Unfinished deltas alone cannot authorize a call; missing, inconsistent or incomplete items remain errors. Failed or incomplete responses do not dispatch their calls. Recovery operates only on an unexecuted reply and never repeats completed task actions. ChatGPT plan requests keep the flow's required streaming contract; authentication or HTTP failures do not automatically restart a task.

From **v0.1.7**, OVD also reconciles optional reasoning metadata between completed item events and the terminal response. Missing or `null` encrypted content does not contradict a later valid value. OVD retains available completed-item continuation data and its known ID, and fills missing encrypted content from the terminal response. This handles the [reported Azure stateless reasoning replay case](https://github.com/earendil-works/pi/issues/4272); the [Azure reference](https://learn.microsoft.com/en-us/rest/api/microsoft-foundry/azureopenai/responses?view=rest-microsoft-foundry-v1) defines encrypted reasoning content as optional and nullable. Reasoning summaries are compared by their declared type and text rather than JSON property order or extra metadata.

The current checkout also accepts different valid encrypted representations of the same completed reasoning item. Ciphertext is opaque; byte inequality does not establish a contradictory answer. A valid nonempty payload from `response.output_item.done` takes precedence, following the [OpenAI streaming contract](https://developers.openai.com/api/reference/resources/responses/streaming-events). The terminal response supplies encrypted content only when the completed item did not provide it. This fixes an observed Azure Foundry `gpt-6.1-sol` stream where the item and terminal snapshots carried different 2,552-character blobs, while their IDs, summaries and final message matched. The diagnosis used lengths and keyed fingerprints, without reading or logging either blob's contents.

Both metadata sources are still validated, and changed text, item identities, tool names or arguments, invalid summaries and explicitly unfinished reasoning remain errors. The selected reasoning item is replayed only within the same active run, including after a tool result; it is not saved in ordinary chat history. Synthetic Azure-configured interface checks reproduce the reported event shape, tool-result replay and a final Markdown answer, alongside the existing empty-terminal-output fallback and rejection of genuinely inconsistent calls. They do not establish live compatibility with every Foundry deployment or Sol model.
