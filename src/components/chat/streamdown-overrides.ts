import {
  StreamdownCode,
  StreamdownInlineCode,
  StreamdownParagraph,
} from "@/components/chat/streamdown-components";
import { StreamdownImage, StreamdownPictureSource } from "@/components/chat/streamdown-image";

export const streamdownOverrideComponents = {
  code: StreamdownCode,
  img: StreamdownImage,
  inlineCode: StreamdownInlineCode,
  p: StreamdownParagraph,
  source: StreamdownPictureSource,
};
