declare module "*.po" {
  import type { AbstractIntlMessages } from "use-intl";
  const messages: AbstractIntlMessages;
  export default messages;
}
