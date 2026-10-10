import app from "./app";

// Parse --port argument
function getPort(): number {
  const args = Bun.argv;
  const portIndex = args.indexOf("--port");
  if (portIndex !== -1 && args[portIndex + 1]) {
    const port = parseInt(args[portIndex + 1], 10);
    if (!isNaN(port)) return port;
  }
  return parseInt(process.env.PORT || "3000", 10);
}

const port = getPort();

export default {
  port,
  // Bun's default 10s idle timeout kills SSE connections when an upstream model
  // goes quiet (e.g. extended-thinking pauses) longer than that between chunks.
  // Client disconnects are already handled via ReadableStream.cancel() in agent.ts.
  fetch(req: Request, server: Bun.Server<undefined>) {
    server.timeout(req, 0);
    return app.fetch(req, { server });
  },
};
