import { WidgetType } from '@codemirror/view';

// KaTeX types (optional peer dependency)
declare const katex: {
  render(latex: string, element: HTMLElement, options?: object): void;
} | undefined;

/**
 * Widget for rendering LaTeX math with KaTeX
 */
export class MathWidget extends WidgetType {
  constructor(readonly latex: string) {
    super();
  }

  eq(other: MathWidget): boolean {
    return other.latex === this.latex;
  }

  toDOM(): HTMLElement {
    const container = document.createElement('div');
    container.className = 'cm-math-widget';

    try {
      if (typeof katex !== 'undefined') {
        katex.render(this.latex, container, {
          displayMode: true,
          throwOnError: false,
        });
      } else {
        // Fallback if KaTeX not loaded
        container.textContent = this.latex;
        container.className = 'cm-math-widget cm-math-fallback';
      }
    } catch (e) {
      container.className = 'cm-math-widget cm-math-error';
      container.textContent = `Math error: ${e instanceof Error ? e.message : 'Unknown error'}`;
    }

    return container;
  }

  ignoreEvent(): boolean {
    return false;
  }
}
