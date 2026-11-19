import { serve, type HttpBindings } from "@hono/node-server";
import app from "./app";

// Parse --port argument
function getPort(): number {
  const args = process.argv;
  const portIndex = args.indexOf("--port");
  if (portIndex !== -1 && args[portIndex + 1]) {
    const port = parseInt(args[portIndex + 1], 10);
    if (!isNaN(port)) return port;
  }
  return parseInt(process.env.PORT || "3000", 10);
}

const port = getPort();

// Node's http server has no socket idle timeout by default (server.timeout = 0),
// so long SSE streams survive upstream pauses (e.g. extended thinking) between
// chunks. Client disconnects are already handled via ReadableStream.cancel() in
// agent.ts.
serve(
  {
    port,
    fetch(req, env) {
      const { incoming } = env as HttpBindings;
      // Keep the `server.requestIP()` env contract read by utils/clientIp.ts.
      const server = {
        requestIP(): { address: string } | null {
          const address = incoming.socket.remoteAddress;
          return address ? { address } : null;
        },
      };
      return app.fetch(req, { ...env, server });
    },
  },
  (info) => {
    console.log(`Server listening on http://localhost:${info.port}`);
  },
);
