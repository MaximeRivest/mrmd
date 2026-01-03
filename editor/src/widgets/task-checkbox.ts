/**
 * Task Checkbox Widget
 *
 * Renders interactive checkboxes for GFM task lists.
 * - [ ] Unchecked task
 * - [x] Checked task
 *
 * Design: Minimal, accessible checkbox that updates the markdown source on click.
 */

import { WidgetType, EditorView } from '@codemirror/view';

/**
 * Widget for rendering task list checkboxes
 */
export class TaskCheckboxWidget extends WidgetType {
  constructor(
    private readonly checked: boolean,
    private readonly pos: number  // Position of '[' in the document
  ) {
    super();
  }

  eq(other: TaskCheckboxWidget): boolean {
    return this.checked === other.checked && this.pos === other.pos;
  }

  toDOM(view: EditorView): HTMLElement {
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'cm-task-checkbox';
    checkbox.checked = this.checked;
    checkbox.setAttribute('aria-label', this.checked ? 'Completed task' : 'Incomplete task');

    // Handle click to toggle checkbox in source
    checkbox.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();

      const newChar = this.checked ? ' ' : 'x';
      // Replace the character between [ and ]
      // pos points to '[', so pos+1 is the space or x
      view.dispatch({
        changes: {
          from: this.pos + 1,
          to: this.pos + 2,
          insert: newChar,
        },
      });
    });

    // Prevent focus from leaving editor
    checkbox.addEventListener('mousedown', (e) => {
      e.preventDefault();
    });

    return checkbox;
  }

  ignoreEvent(): boolean {
    return false; // Allow events to propagate for interactivity
  }
}
