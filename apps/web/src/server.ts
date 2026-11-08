import {
  createServerEntry,
  createStartHandler,
  defaultStreamHandler,
} from "@tanstack/react-start/server";
import { register } from "@/instrumentation";

await register();

export default createServerEntry({
  fetch: createStartHandler(defaultStreamHandler),
});
