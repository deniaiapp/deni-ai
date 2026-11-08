import { createContext, use, useState } from "react";

interface ArtifactPreviewContextType {
  isOpen: boolean;
  code: string;
  language: string;
  open: (code: string, language: string) => void;
  close: () => void;
}

const ArtifactPreviewContext = createContext<ArtifactPreviewContextType>({
  isOpen: false,
  code: "",
  language: "",
  open: () => undefined,
  close: () => undefined,
});

export function ArtifactPreviewProvider({ children }: { children: React.ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [code, setCode] = useState("");
  const [language, setLanguage] = useState("");

  const open = (nextCode: string, nextLanguage: string) => {
    setCode(nextCode);
    setLanguage(nextLanguage);
    setIsOpen(true);
  };

  const close = () => setIsOpen(false);

  const value = { isOpen, code, language, open, close };

  return (
    <ArtifactPreviewContext.Provider value={value}>{children}</ArtifactPreviewContext.Provider>
  );
}

export function useArtifactPreview() {
  return use(ArtifactPreviewContext);
}
