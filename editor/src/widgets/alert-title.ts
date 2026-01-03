/**
 * Alert Title Widget
 *
 * Renders GitHub-style alert titles with icons.
 * Replaces [!NOTE], [!TIP], [!IMPORTANT], [!WARNING], [!CAUTION] markers.
 */

import { WidgetType, EditorView } from '@codemirror/view';

// Alert type icons (using simple unicode/emoji)
const ALERT_ICONS: Record<string, string> = {
  note: 'ℹ️',
  tip: '💡',
  important: '❗',
  warning: '⚠️',
  caution: '🔴',
};

const ALERT_TITLES: Record<string, string> = {
  note: 'Note',
  tip: 'Tip',
  important: 'Important',
  warning: 'Warning',
  caution: 'Caution',
};

/**
 * Widget for rendering alert type titles
 */
export class AlertTitleWidget extends WidgetType {
  constructor(private readonly alertType: string) {
    super();
  }

  eq(other: AlertTitleWidget): boolean {
    return this.alertType === other.alertType;
  }

  toDOM(view: EditorView): HTMLElement {
    const span = document.createElement('span');
    span.className = `cm-alert-title cm-alert-title-${this.alertType}`;

    const icon = document.createElement('span');
    icon.className = 'cm-alert-icon';
    icon.textContent = ALERT_ICONS[this.alertType] || 'ℹ️';

    const text = document.createElement('span');
    text.className = 'cm-alert-text';
    text.textContent = ALERT_TITLES[this.alertType] || this.alertType;

    span.appendChild(icon);
    span.appendChild(text);

    return span;
  }
}
