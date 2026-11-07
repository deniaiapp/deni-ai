/// <reference types="vite/client" />

declare module "virtual:workspace-chunk" {
  /** The client chunk that holds the workspace, such as "/assets/workspace-abc123.js"; empty in dev. */
  const file: string;
  export default file;
}
