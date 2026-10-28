// Optional local example; OVD never starts this server automatically.
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { z } = require('zod');
const { randomUUID } = require('node:crypto');

const server = new McpServer({ name: 'ovd-example-framework', version: '0.1.0' });
const tasks = [];
const result = value => ({ content: [{ type: 'text', text: JSON.stringify(value) }], structuredContent: value });
server.registerTool('framework_status', {
  description: 'Zeigt den Zustand dieses lokalen Beispiel-Frameworks.',
  inputSchema: {}, annotations: { readOnlyHint: true }
}, async () => result({ name: 'OVD-Beispiel-Framework', taskCount: tasks.length, persistence: 'memory_only' }));
server.registerTool('tasks_list', {
  description: 'Listet die Aufgaben des Beispiel-Frameworks, optional nach Titel gefiltert.',
  inputSchema: { query: z.string().max(100).optional() }, annotations: { readOnlyHint: true }
}, async ({ query }) => result({ tasks: tasks.filter(task => !query || task.title.toLocaleLowerCase().includes(query.toLocaleLowerCase())) }));
server.registerTool('tasks_create', {
  description: 'Erstellt eine Aufgabe im flüchtigen Speicher des Beispiel-Frameworks. Beim Serverneustart werden die Beispieldaten zurückgesetzt.',
  inputSchema: { title: z.string().trim().min(1).max(200) }, annotations: { readOnlyHint: false, destructiveHint: false }
}, async ({ title }) => {
  if (tasks.length >= 50) return { isError: true, content: [{ type: 'text', text: 'Der Beispielspeicher ist voll.' }] };
  const task = { id: randomUUID(), title }; tasks.push(task);
  return result({ task });
});
server.connect(new StdioServerTransport()).catch(() => { process.stderr.write('MCP-Beispiel konnte nicht gestartet werden.\n'); process.exitCode = 1; });
