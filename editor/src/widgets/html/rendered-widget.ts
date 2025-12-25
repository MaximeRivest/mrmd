import { WidgetType, EditorView } from '@codemirror/view';
import { executeScripts } from './script-manager';
import type { CellOptions } from '../../cells/types';

/**
 * Widget that renders HTML content as live DOM
 *
 * Supports:
 * - Shadow DOM isolation (optional)
 * - Script execution with deduplication
 * - Style scoping (via shadow or class prefix)
 * - Full interactivity
 */
export class RenderedHTMLWidget extends WidgetType {
  constructor(
    readonly html: string,
    readonly execId: string,
    readonly options: CellOptions,
    readonly blockFrom: number = 0,
    readonly view?: EditorView
  ) {
    super();
  }

  eq(other: RenderedHTMLWidget): boolean {
    return (
      this.html === other.html &&
      this.execId === other.execId &&
      this.options.shadow === other.options.shadow &&
      this.options.scope === other.options.scope &&
      this.blockFrom === other.blockFrom
    );
  }

  toDOM(): HTMLElement {
    const wrapper = document.createElement('div');
    wrapper.className = 'cm-html-rendered-wrapper';

    // Toolbar with edit button
    const toolbar = document.createElement('div');
    toolbar.className = 'cm-html-rendered-toolbar';

    const editBtn = document.createElement('button');
    editBtn.className = 'cm-html-edit-btn';
    editBtn.textContent = '</>';
    editBtn.title = 'Edit source';
    editBtn.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (this.view && this.blockFrom > 0) {
        // Move cursor to start of the block to reveal source
        this.view.dispatch({
          selection: { anchor: this.blockFrom + 1 },
          scrollIntoView: true,
        });
        this.view.focus();
      }
    };
    toolbar.appendChild(editBtn);
    wrapper.appendChild(toolbar);

    // Content container
    const container = document.createElement('div');
    container.className = 'cm-html-rendered';
    container.dataset.execId = this.execId;

    if (!this.html) {
      container.textContent = '[Empty HTML content]';
      wrapper.appendChild(container);
      return wrapper;
    }

    if (this.options.shadow) {
      this.renderShadow(container);
    } else if (this.options.scope) {
      this.renderScoped(container);
    } else {
      this.renderDirect(container);
    }

    wrapper.appendChild(container);
    return wrapper;
  }

  /**
   * Render directly into container (styles/scripts affect page)
   */
  private renderDirect(container: HTMLElement): void {
    const { html, scripts } = this.extractScripts(this.html);

    // Use createContextualFragment for proper parsing and script handling
    const range = document.createRange();
    const fragment = range.createContextualFragment(html);
    container.appendChild(fragment);

    // Execute extracted scripts with deduplication
    if (scripts.length > 0) {
      executeScripts(this.execId, scripts, container);
    }
  }

  /**
   * Render into Shadow DOM (full isolation)
   */
  private renderShadow(container: HTMLElement): void {
    const shadow = container.attachShadow({ mode: 'open' });
    const { html, scripts } = this.extractScripts(this.html);

    shadow.innerHTML = html;

    // Execute scripts with shadow root as context
    if (scripts.length > 0) {
      executeScripts(this.execId, scripts, shadow);
    }
  }

  /**
   * Render with scoped styles (adds unique class prefix)
   */
  private renderScoped(container: HTMLElement): void {
    const scopeClass = `cm-scope-${this.execId.replace(/[^a-z0-9]/gi, '')}`;
    container.classList.add(scopeClass);

    const { html, scripts, styles } = this.extractScriptsAndStyles(this.html);

    // Scope styles by prefixing selectors
    const scopedStyles = styles
      .map((style) => this.scopeStyles(style, `.${scopeClass}`))
      .join('\n');

    if (scopedStyles) {
      const styleEl = document.createElement('style');
      styleEl.textContent = scopedStyles;
      container.appendChild(styleEl);
    }

    // Add remaining HTML
    const range = document.createRange();
    const fragment = range.createContextualFragment(html);
    container.appendChild(fragment);

    // Execute scripts
    if (scripts.length > 0) {
      executeScripts(this.execId, scripts, container);
    }
  }

  /**
   * Extract scripts from HTML, returning cleaned HTML and script contents
   */
  private extractScripts(html: string): { html: string; scripts: string[] } {
    const scripts: string[] = [];
    const cleaned = html.replace(
      /<script[^>]*>([\s\S]*?)<\/script>/gi,
      (_, content) => {
        scripts.push(content);
        return '';
      }
    );
    return { html: cleaned, scripts };
  }

  /**
   * Extract both scripts and styles from HTML
   */
  private extractScriptsAndStyles(html: string): {
    html: string;
    scripts: string[];
    styles: string[];
  } {
    const scripts: string[] = [];
    const styles: string[] = [];

    let cleaned = html.replace(
      /<script[^>]*>([\s\S]*?)<\/script>/gi,
      (_, content) => {
        scripts.push(content);
        return '';
      }
    );

    cleaned = cleaned.replace(/<style[^>]*>([\s\S]*?)<\/style>/gi, (_, content) => {
      styles.push(content);
      return '';
    });

    return { html: cleaned, scripts, styles };
  }

  /**
   * Prefix CSS selectors with a scope class
   */
  private scopeStyles(css: string, scopeSelector: string): string {
    // Simple implementation - prefix each rule
    // This handles most cases but not all CSS edge cases
    return css.replace(
      /([^{}]+)\{/g,
      (match, selectors: string) => {
        const scoped = selectors
          .split(',')
          .map((s: string) => {
            const trimmed = s.trim();
            if (
              trimmed.startsWith('@') ||
              trimmed.startsWith('from') ||
              trimmed.startsWith('to') ||
              /^\d+%$/.test(trimmed)
            ) {
              return trimmed;
            }
            return `${scopeSelector} ${trimmed}`;
          })
          .join(', ');
        return `${scoped} {`;
      }
    );
  }

  ignoreEvent(): boolean {
    // Allow all interaction within rendered content
    return true;
  }
}
