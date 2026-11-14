import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

const modes = [
  { name: "read", authoring: false, conversation: false },
  { name: "authoring", authoring: true, conversation: false },
  { name: "conversation", authoring: false, conversation: true },
  { name: "authoring-and-conversation", authoring: true, conversation: true },
  { name: "presentation", authoring: false, conversation: false, presentation: true },
  { name: "all", authoring: true, conversation: true, presentation: true },
] as const;
const entrypoint = fileURLToPath(new URL("./serveHeadlessMcpReadAdapter.mts", import.meta.url));
const repository = fileURLToPath(new URL("../../../../", import.meta.url));
type Tool = Awaited<ReturnType<Client["listTools"]>>["tools"][number];
type ReferenceTool = Pick<Tool, "name" | "inputSchema">;

export async function collectHeadlessMcpToolReference() {
  const tools = new Map<string, ReferenceTool>();
  const listings = [];
  for (const mode of modes) {
    // The SDK inherits a fixed OS environment allowlist. Pass only discovery
    // switches here, so the child has no connector endpoint, pin or credential.
    const env: Record<string, string> = { TSX_DISABLE_CACHE: "1" };
    if (mode.authoring) env.AISB_HEADLESS_ENABLE_AUTHORING = "1";
    if (mode.conversation) env.AISB_HEADLESS_ENABLE_CONVERSATION = "1";
    if ("presentation" in mode && mode.presentation) env.AISB_HEADLESS_ENABLE_PRESENTATION = "1";
    const transport = new StdioClientTransport({
      command: process.execPath, args: ["--import", "tsx", entrypoint], cwd: repository,
      env, stderr: "ignore", maxBufferSize: 256 * 1024,
    });
    const client = new Client({ name: "ai-system-builder-tool-reference", version: "1.0.0" }, { listMaxPages: 1 });
    try {
      await client.connect(transport, { timeout: 10_000 });
      const listed = await client.listTools(undefined, { timeout: 10_000 });
      if (listed.nextCursor !== undefined || listed.tools.length > 32) {
        throw new Error("The finite MCP catalog exceeded its discovery bound.");
      }
      const names = new Set<string>();
      for (const { name, inputSchema } of listed.tools) {
        if (!/^aisb_[a-z_]{1,64}$/.test(name) || names.has(name) || inputSchema.type !== "object" ||
            inputSchema.additionalProperties !== false) {
          throw new Error("The MCP catalog contains an unexpected tool definition.");
        }
        names.add(name);
        const previous = tools.get(name);
        if (previous && JSON.stringify(previous.inputSchema) !== JSON.stringify(inputSchema)) {
          throw new Error("A shared MCP tool has different schemas across modes.");
        }
        tools.set(name, { name, inputSchema });
      }
      listings.push({ mode: mode.name, tools: [...names].sort() });
    } finally {
      await client.close();
    }
  }
  return {
    schema_version: "headless-mcp-tool-reference-v1",
    modes: listings,
    tools: [...tools.keys()].sort().map(name => tools.get(name)!),
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 2) throw new Error("The MCP reference command accepts no arguments.");
    process.stdout.write(JSON.stringify(await collectHeadlessMcpToolReference(), null, 2) + "\n");
  } catch {
    process.stderr.write("The finite MCP tool reference could not be generated.\n");
    process.exitCode = 1;
  }
}
