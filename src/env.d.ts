/// <reference types="astro/client" />

interface ImportMetaEnv {
  readonly ACESTREAM_BASE: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

// Extend the Window interface to include our custom properties
interface Window {
  aceStreamBase: string;
}
