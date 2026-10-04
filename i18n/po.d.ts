declare module "*.po" {
  import type { Messages } from "next-intl";
  const messages: Messages;
  export default messages;
}
