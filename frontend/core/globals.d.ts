/**
 * Global type declarations for browser APIs and CDN-loaded libraries
 * Used by app.ts for type safety without modifying runtime behavior
 */

export {};

declare global {
  interface Window {
    // Electron API (used in desktop app)
    electronAPI?: {
      openProjectWindow?: (path: string) => Promise<void>;
    };
  }

  // KaTeX (loaded via CDN at index.html:10)
  const katex: {
    render: (tex: string, element: HTMLElement, options?: object) => void;
    renderToString: (tex: string, options?: object) => string;
  };

  // Highlight.js (loaded via CDN at index.html:14)
  const hljs: {
    highlightElement: (element: HTMLElement) => void;
    highlight: (code: string, options: { language: string }) => { value: string };
    getLanguage: (name: string) => object | undefined;
  };

  // xterm.js (loaded via CDN at index.html:17-20)
  const Terminal: new (options?: object) => {
    open: (parent: HTMLElement) => void;
    write: (data: string) => void;
    onData: (callback: (data: string) => void) => void;
    loadAddon: (addon: object) => void;
    dispose: () => void;
  };

  const FitAddon: {
    FitAddon: new () => {
      fit: () => void;
    };
  };

  const WebLinksAddon: {
    WebLinksAddon: new () => object;
  };
}
