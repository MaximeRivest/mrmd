/**
 * Image Output Widget
 *
 * Renders image outputs from code execution (matplotlib, etc.)
 * Follows the same pattern as OutputWidget but for images.
 *
 * Block format:
 * ```image-output:exec-id
 * ![alt](path/to/image.png)
 * ```
 */

import { WidgetType, EditorView } from '@codemirror/view';

/** Configuration for image output widget */
export interface ImageOutputWidgetConfig {
  /** Function to resolve relative image URLs to absolute */
  resolveUrl?: (url: string) => string;
  /** Maximum width for the image (CSS value, default: '100%') */
  maxWidth?: string;
  /** Whether to show loading state */
  showLoading?: boolean;
}

/**
 * Widget for rendering image output blocks
 */
export class ImageOutputWidget extends WidgetType {
  constructor(
    readonly src: string,
    readonly alt: string,
    readonly execId: string,
    readonly config: ImageOutputWidgetConfig = {}
  ) {
    super();
  }

  eq(other: ImageOutputWidget): boolean {
    return (
      other.src === this.src &&
      other.alt === this.alt &&
      other.execId === this.execId
    );
  }

  toDOM(view: EditorView): HTMLElement {
    const container = document.createElement('div');
    container.className = 'cm-image-output-widget';
    container.dataset.execId = this.execId;

    // Resolve URL if resolver provided
    const resolvedSrc = this.config.resolveUrl
      ? this.config.resolveUrl(this.src)
      : this.src;

    // Create wrapper for the image
    const wrapper = document.createElement('div');
    wrapper.className = 'cm-image-output-wrapper';

    // Show loading state initially
    if (this.config.showLoading !== false) {
      wrapper.classList.add('cm-image-output-loading');
      wrapper.textContent = 'Loading image...';
    }

    // Create the image element
    const img = document.createElement('img');
    img.alt = this.alt || 'Execution output';
    img.className = 'cm-image-output-img';

    if (this.config.maxWidth) {
      img.style.maxWidth = this.config.maxWidth;
    }

    // Handle load success
    img.onload = () => {
      wrapper.classList.remove('cm-image-output-loading');
      wrapper.textContent = '';
      wrapper.appendChild(img);
    };

    // Handle load error
    img.onerror = () => {
      wrapper.classList.remove('cm-image-output-loading');
      wrapper.classList.add('cm-image-output-error');
      wrapper.textContent = `Failed to load image: ${this.alt || this.src}`;
    };

    // Start loading
    img.src = resolvedSrc;

    container.appendChild(wrapper);
    return container;
  }

  ignoreEvent(): boolean {
    return true; // Don't capture events - let them bubble
  }
}

/**
 * Parse image markdown syntax to extract src and alt
 * Supports: ![alt](url) and ![](url)
 */
export function parseImageMarkdown(content: string): { src: string; alt: string } | null {
  const match = content.trim().match(/^!\[([^\]]*)\]\(([^)]+)\)$/);
  if (!match) return null;

  return {
    alt: match[1] || '',
    src: match[2],
  };
}

/**
 * Create markdown image syntax from src and alt
 */
export function createImageMarkdown(src: string, alt: string = 'output'): string {
  return `![${alt}](${src})`;
}

/**
 * Create an image output widget for use in decorations
 */
export function createImageOutputWidget(
  src: string,
  alt: string,
  execId: string,
  config?: ImageOutputWidgetConfig
): ImageOutputWidget {
  return new ImageOutputWidget(src, alt, execId, config);
}
