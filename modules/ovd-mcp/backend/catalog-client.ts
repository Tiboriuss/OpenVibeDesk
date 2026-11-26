import { isDeepStrictEqual } from 'node:util';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { AnySchema, SchemaOutput } from '@modelcontextprotocol/sdk/server/zod-compat.js';
import type { RequestOptions } from '@modelcontextprotocol/sdk/shared/protocol.js';
import { ListToolsResultSchema, ResultSchema, type ClientRequest, type Tool } from '@modelcontextprotocol/sdk/types.js';

/** Keep SDK validation and tool metadata caching, and detect fields lost during that validation. */
export class CatalogClient extends Client {
  readonly incompleteDefinitions = new WeakSet<Tool>();

  override async request<T extends AnySchema>(request: ClientRequest, schema: T, options?: RequestOptions): Promise<SchemaOutput<T>> {
    if (!Object.is(schema, ListToolsResultSchema)) return super.request(request, schema, options);
    const wire = await super.request(request, ResultSchema, options);
    const inventory = ListToolsResultSchema.parse(wire);
    const rows = wire.tools as Record<string, unknown>[];
    inventory.tools.forEach((tool, index) => {
      // SDK v1 can discard JSON members such as an input property named "__proto__".
      // A partial definition cannot represent the contract that the user would approve.
      for (const field of ['inputSchema', 'outputSchema', 'annotations', 'execution'] as const) {
        if (!isDeepStrictEqual(rows[index][field], tool[field])) {
          this.incompleteDefinitions.add(tool);
          break;
        }
      }
    });
    // This branch runs only for the SDK's exact ListToolsResultSchema singleton.
    return inventory as SchemaOutput<T>;
  }
}
