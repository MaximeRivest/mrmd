/**
 * Mermaid Diagram Widget
 *
 * Renders Mermaid diagrams from ```mermaid code blocks.
 * Uses dynamic loading to avoid bundling Mermaid.js (~2MB).
 */

import { WidgetType, EditorView } from '@codemirror/view';

// Mermaid types (minimal for our usage)
interface MermaidAPI {
  initialize: (config: Record<string, unknown>) => void;
  render: (id: string, code: string) => Promise<{ svg: string }>;
}

// Global mermaid instance (loaded dynamically)
let mermaidPromise: Promise<MermaidAPI> | null = null;
let mermaidId = 0;

/**
 * Load Mermaid.js dynamically from CDN
 */
async function loadMermaid(): Promise<MermaidAPI> {
  if (mermaidPromise) {
    return mermaidPromise;
  }

  mermaidPromise = new Promise((resolve, reject) => {
    // Check if already loaded
    if ((window as unknown as Record<string, unknown>).mermaid) {
      const mermaid = (window as unknown as Record<string, MermaidAPI>).mermaid;
      mermaid.initialize({ startOnLoad: false, theme: 'neutral' });
      resolve(mermaid);
      return;
    }

    // Load from CDN
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js';
    script.async = true;

    script.onload = () => {
      const mermaid = (window as unknown as Record<string, MermaidAPI>).mermaid;
      mermaid.initialize({ startOnLoad: false, theme: 'neutral' });
      resolve(mermaid);
    };

    script.onerror = () => {
      mermaidPromise = null;
      reject(new Error('Failed to load Mermaid.js'));
    };

    document.head.appendChild(script);
  });

  return mermaidPromise;
}

/**
 * Widget for rendering Mermaid diagrams
 */
export class MermaidWidget extends WidgetType {
  private readonly id: string;

  constructor(private readonly code: string) {
    super();
    this.id = `mermaid-${++mermaidId}`;
  }

  eq(other: MermaidWidget): boolean {
    return this.code === other.code;
  }

  toDOM(view: EditorView): HTMLElement {
    const container = document.createElement('div');
    container.className = 'cm-mermaid-widget';

    // Show loading state
    const loading = document.createElement('div');
    loading.className = 'cm-mermaid-loading';
    loading.textContent = 'Loading diagram...';
    container.appendChild(loading);

    // Render diagram asynchronously
    this.renderDiagram(container, loading);

    return container;
  }

  private async renderDiagram(container: HTMLElement, loading: HTMLElement): Promise<void> {
    try {
      const mermaid = await loadMermaid();

      // Render the diagram
      const { svg } = await mermaid.render(this.id, this.code);

      // Replace loading with SVG
      loading.remove();
      const wrapper = document.createElement('div');
      wrapper.className = 'cm-mermaid-svg';
      wrapper.innerHTML = svg;
      container.appendChild(wrapper);
    } catch (error) {
      // Show error state
      loading.remove();
      const errorEl = document.createElement('div');
      errorEl.className = 'cm-mermaid-error';
      errorEl.textContent = `Diagram error: ${error instanceof Error ? error.message : 'Unknown error'}`;
      container.appendChild(errorEl);
    }
  }
}
