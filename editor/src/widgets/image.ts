import { WidgetType } from '@codemirror/view';

/**
 * Widget for collapsed image syntax placeholder
 * Shows "📷 alt-text" when cursor is not on the image line
 */
export class ImageSyntaxPlaceholder extends WidgetType {
  constructor(
    readonly alt: string,
    readonly url: string
  ) {
    super();
  }

  eq(other: ImageSyntaxPlaceholder): boolean {
    return other.alt === this.alt && other.url === this.url;
  }

  toDOM(): HTMLElement {
    const span = document.createElement('span');
    span.className = 'cm-image-syntax-placeholder';

    // Determine icon based on URL type
    let icon = '🖼';
    if (this.url.startsWith('data:image/svg') || this.url.endsWith('.svg')) {
      icon = '◇'; // SVG indicator
    } else if (this.url.startsWith('data:')) {
      icon = '📷'; // Embedded image
    }

    // Show icon + truncated alt text
    const displayText = this.alt || 'image';
    const truncated = displayText.length > 30
      ? displayText.slice(0, 30) + '…'
      : displayText;

    span.textContent = `${icon} ${truncated}`;
    span.title = `Image: ${this.alt}\nClick to edit`;

    return span;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

/**
 * Widget for rendering images inline
 */
export class ImageWidget extends WidgetType {
  constructor(
    readonly url: string,
    readonly alt: string
  ) {
    super();
  }

  eq(other: ImageWidget): boolean {
    return other.url === this.url && other.alt === this.alt;
  }

  toDOM(): HTMLElement {
    const container = document.createElement('div');
    container.className = 'cm-image-widget cm-image-loading';
    container.textContent = 'Loading image...';

    const img = document.createElement('img');
    img.alt = this.alt;

    img.onload = () => {
      container.className = 'cm-image-widget';
      container.textContent = '';
      container.appendChild(img);
    };

    img.onerror = () => {
      container.className = 'cm-image-widget cm-image-error';
      container.textContent = `Failed to load: ${this.alt || 'image'}`;
    };

    img.src = this.url;
    return container;
  }

  ignoreEvent(): boolean {
    return false;
  }
}
