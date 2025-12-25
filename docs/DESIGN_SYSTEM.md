# MRMD Design System

> A comprehensive visual identity and design language for the MRMD literate programming environment.

---

## Table of Contents

1. [Design Principles](#design-principles)
2. [Logo & Branding](#logo--branding)
3. [Color System](#color-system)
4. [Typography](#typography)
5. [Iconography](#iconography)
6. [Spacing & Layout](#spacing--layout)
7. [Components](#components)
8. [Theming](#theming)
9. [Motion & Animation](#motion--animation)
10. [Accessibility](#accessibility)

---

## Design Principles

### Core Values

1. **Clarity over decoration**
   - Every visual element must serve a purpose
   - No ornamental graphics, shadows, or gradients unless functional
   - Text and content take precedence over chrome

2. **Quiet confidence**
   - The interface should recede when not needed
   - Subtle visual cues over attention-grabbing elements
   - Professional restraint in color and motion

3. **Typographic hierarchy**
   - Information architecture expressed through type
   - Size, weight, and spacing communicate structure
   - Monospace for code, proportional for prose

4. **Functional minimalism**
   - Remove until it breaks, then add back one thing
   - White space is a feature, not wasted space
   - Density is acceptable when purposeful (status bars, panels)

5. **Respect for content**
   - User's writing and code are the primary visual element
   - UI elements should complement, never compete
   - The document is the hero

### What We Avoid

- Emojis in UI (user content may contain them)
- Rounded "friendly" aesthetics
- Bright, saturated accent colors
- Gratuitous animations
- Skeuomorphic elements
- Marketing language in UI copy

---

## Logo & Branding

### Primary Logo

**Current**: Blue rounded square with white "M"

**Proposed Evolution**: A more distinctive mark that represents:
- **M** for Markdown/MRMD
- Document/notebook concept
- Code execution (the "runs" part)

### Logo Concepts

```
Option A: Typographic (Current Direction)
┌─────────────┐
│             │
│     M       │   Simple "M" in a rounded square
│             │   Current approach - functional, recognizable
└─────────────┘

Option B: Document + Code
┌─────────────┐
│  ┌───────┐  │
│  │ # M   │  │   Document with markdown heading
│  │ ```   │  │   + code fence indicator
│  └───────┘  │
└─────────────┘

Option C: Lambda Mark
┌─────────────┐
│             │
│     λ       │   Lambda symbol - represents
│      M      │   executable documents
└─────────────┘

Option D: Cursor + Document
┌─────────────┐
│  ═══════    │
│  ═══════    │   Text lines with cursor
│  ═══█══     │   Represents live editing
│  ═══════    │
└─────────────┘
```

### Logo Specifications

| Variant | Use Case | Minimum Size |
|---------|----------|--------------|
| Full color | App icon, marketing | 32px |
| Monochrome | Favicons, small UI | 16px |
| Wordmark | Documentation, headers | 24px height |

### Brand Colors (Logo)

```
Primary Blue:    #4a9eff (current accent)
Dark variant:    #0066cc
White:           #ffffff
Black:           #1a1a1a
```

### Wordmark

```
MRMD

Font: SF Mono or similar monospace
Weight: Medium (500)
Tracking: +0.05em
```

Alternative renderings:
```
mrmd        (lowercase, casual)
MRMD        (uppercase, formal)
mr.md       (playful, domain-style)
```

---

## Color System

### Design Philosophy

- **Low saturation** - Professional, easy on eyes
- **High contrast** - Accessible, readable
- **Semantic meaning** - Colors indicate state, not decoration
- **Theme-aware** - All colors must work in light and dark

### Core Palette

#### Neutral Scale

```css
/* Light Mode */
--gray-50:  #fafafa;   /* Background */
--gray-100: #f5f5f5;   /* Subtle background */
--gray-200: #e5e5e5;   /* Borders, dividers */
--gray-300: #d4d4d4;   /* Disabled borders */
--gray-400: #a3a3a3;   /* Placeholder text */
--gray-500: #737373;   /* Muted text */
--gray-600: #525252;   /* Secondary text */
--gray-700: #404040;   /* Primary text */
--gray-800: #262626;   /* Headings */
--gray-900: #171717;   /* High contrast text */

/* Dark Mode */
--gray-50:  #171717;
--gray-100: #1f1f1f;
--gray-200: #262626;
--gray-300: #333333;
--gray-400: #525252;
--gray-500: #737373;
--gray-600: #a3a3a3;
--gray-700: #d4d4d4;
--gray-800: #e5e5e5;
--gray-900: #fafafa;
```

#### Semantic Colors

```css
/* Primary - Actions, links, focus */
--primary:        #0066cc;  /* Light mode */
--primary-dark:   #4a9eff;  /* Dark mode */
--primary-subtle: #e6f0fa;  /* Light mode backgrounds */
--primary-subtle-dark: #1a2938; /* Dark mode backgrounds */

/* Success - Completed, connected, valid */
--success:        #16a34a;
--success-dark:   #22c55e;
--success-subtle: #dcfce7;

/* Warning - Queued, pending, caution */
--warning:        #ca8a04;
--warning-dark:   #facc15;
--warning-subtle: #fef9c3;

/* Error - Failed, disconnected, invalid */
--error:          #dc2626;
--error-dark:     #f87171;
--error-subtle:   #fee2e2;

/* Info - Informational, neutral state */
--info:           #0891b2;
--info-dark:      #22d3ee;
--info-subtle:    #cffafe;
```

### Application Mapping

```css
:root {
  /* Backgrounds */
  --bg:             var(--gray-50);
  --bg-subtle:      var(--gray-100);
  --bg-elevated:    #ffffff;

  /* Text */
  --text:           var(--gray-800);
  --text-secondary: var(--gray-600);
  --text-muted:     var(--gray-500);
  --text-disabled:  var(--gray-400);

  /* Borders */
  --border:         var(--gray-200);
  --border-strong:  var(--gray-300);
  --border-focus:   var(--primary);

  /* Interactive */
  --accent:         var(--primary);
  --accent-hover:   #0052a3;
  --accent-active:  #004080;

  /* Code */
  --code-bg:        var(--gray-100);
  --code-border:    var(--gray-200);
}

@media (prefers-color-scheme: dark) {
  :root {
    --bg:             var(--gray-50);  /* Inverted */
    --bg-subtle:      var(--gray-100);
    --bg-elevated:    var(--gray-200);

    --text:           var(--gray-800);
    --text-secondary: var(--gray-600);
    --text-muted:     var(--gray-500);

    --border:         var(--gray-300);
    --border-strong:  var(--gray-400);

    --accent:         var(--primary-dark);
    --accent-hover:   #6bb3ff;
    --accent-active:  #8ac4ff;

    --code-bg:        var(--gray-200);
    --code-border:    var(--gray-300);
  }
}
```

### Status Indicator Colors

Used for kernel, server, execution states:

| State | Light Mode | Dark Mode | Usage |
|-------|------------|-----------|-------|
| Ready/Connected | `#16a34a` | `#22c55e` | Kernel ready, server connected |
| Busy/Running | `#ca8a04` | `#facc15` | Code executing, processing |
| Error/Disconnected | `#dc2626` | `#f87171` | Kernel error, connection lost |
| Offline/Inactive | `#737373` | `#737373` | Not started, disabled |
| Streaming | `#0891b2` | `#22d3ee` | Output streaming |

### Syntax Highlighting Palette

```css
/* Code - Light Mode (GitHub-inspired) */
--syntax-keyword:    #d73a49;  /* if, for, return */
--syntax-string:     #22863a;  /* "strings" */
--syntax-number:     #005cc5;  /* 42, 3.14 */
--syntax-function:   #6f42c1;  /* function names */
--syntax-class:      #e36209;  /* class names */
--syntax-comment:    #6a737d;  /* # comments */
--syntax-operator:   #d73a49;  /* +, -, = */
--syntax-builtin:    #005cc5;  /* print, len */
--syntax-variable:   #24292e;  /* variables */
--syntax-constant:   #005cc5;  /* TRUE, None */

/* Code - Dark Mode */
--syntax-keyword:    #ff7b72;
--syntax-string:     #a5d6ff;
--syntax-number:     #79c0ff;
--syntax-function:   #d2a8ff;
--syntax-class:      #ffa657;
--syntax-comment:    #8b949e;
--syntax-operator:   #ff7b72;
--syntax-builtin:    #79c0ff;
--syntax-variable:   #c9d1d9;
--syntax-constant:   #79c0ff;
```

### Variable Inspector Colors

Left border colors for different value types:

| Type | Light | Dark | Examples |
|------|-------|------|----------|
| Primitive | `#6b7280` | `#9ca3af` | int, str, bool |
| Collection | `#8b5cf6` | `#a78bfa` | list, dict, set |
| Object | `#f59e0b` | `#fbbf24` | instances |
| Callable | `#10b981` | `#34d399` | functions |
| Class | `#ec4899` | `#f472b6` | class definitions |
| Data | `#3b82f6` | `#60a5fa` | DataFrame, array |

---

## Typography

### Font Stack

```css
/* UI Text - System fonts for fast rendering */
--font-sans: -apple-system, BlinkMacSystemFont, 'Segoe UI',
             'Noto Sans', Helvetica, Arial, sans-serif;

/* Code - Monospace for alignment */
--font-mono: 'SF Mono', 'Monaco', 'Inconsolata',
             'Fira Code', 'Consolas', monospace;

/* Editor prose - Optional premium feel */
--font-prose: 'Inter', 'SF Pro Text', var(--font-sans);
```

### Type Scale

```css
/* Based on 14px base, 1.25 ratio */
--text-xs:   10px;   /* Labels, badges */
--text-sm:   11px;   /* Secondary UI */
--text-base: 12px;   /* Primary UI */
--text-md:   14px;   /* Editor body */
--text-lg:   16px;   /* Subheadings */
--text-xl:   20px;   /* Headings */
--text-2xl:  24px;   /* Page titles */
--text-3xl:  30px;   /* Hero text */
```

### Font Weights

```css
--font-normal:   400;
--font-medium:   500;
--font-semibold: 600;
--font-bold:     700;
```

### Line Heights

```css
--leading-none:   1.0;   /* Headings, single line */
--leading-tight:  1.25;  /* Compact UI */
--leading-snug:   1.375; /* Default UI */
--leading-normal: 1.5;   /* Body text */
--leading-relaxed: 1.7;  /* Editor/reading */
```

### Usage Guidelines

| Context | Font | Size | Weight | Line Height |
|---------|------|------|--------|-------------|
| **Status bar** | Sans | 11px | Normal | Tight |
| **Buttons** | Sans | 12px | Medium | Snug |
| **Panel headers** | Sans | 11px | Semibold | Tight |
| **File names** | Sans | 12px | Normal | Snug |
| **Editor prose** | Mono | 14px | Normal | Relaxed |
| **Code blocks** | Mono | 13px | Normal | Normal |
| **Headings (H1)** | Sans/Mono | 24px | Semibold | None |
| **Headings (H2)** | Sans/Mono | 20px | Semibold | None |
| **Headings (H3)** | Sans/Mono | 16px | Semibold | Tight |

### Monospace Alignment

Critical for overlay editor and code blocks:

```css
.editor-monospace {
  font-family: var(--font-mono);
  font-size: 14px;
  line-height: 1.7;
  font-variant-ligatures: none;  /* Disable ligatures */
  font-feature-settings: "liga" 0, "calt" 0;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}
```

---

## Iconography

### Design Philosophy

- **Simple strokes** - 1.5px stroke weight
- **Geometric** - Based on simple shapes
- **Monochrome** - Single color, no fills
- **Consistent size** - 16px, 20px, 24px variants
- **No emojis** - Pure SVG/Unicode symbols

### Icon Grid

```
24x24 canvas
2px padding (20px live area)
1.5px stroke
Round caps and joins
```

### Core Icon Set

All icons as inline SVG or CSS-rendered Unicode:

#### Navigation & Actions

| Icon | Name | Unicode | SVG Path |
|------|------|---------|----------|
| X | Close | `×` (U+00D7) | `M6 6L18 18M6 18L18 6` |
| < | Back | `‹` (U+2039) | `M15 6L9 12L15 18` |
| > | Forward | `›` (U+203A) | `M9 6L15 12L9 18` |
| + | Add | `+` | `M12 5V19M5 12H19` |
| - | Remove | `−` (U+2212) | `M5 12H19` |
| = | Menu | `≡` (U+2261) | Three horizontal lines |
| ... | More | `···` (U+22EF) | Three dots horizontal |

#### File Types

| Icon | Name | Unicode | Usage |
|------|------|---------|-------|
| # | Markdown | `#` | .md files |
| { } | JSON | `{}` | .json files |
| λ | Python | `λ` (U+03BB) | .py files |
| < > | HTML | `<>` | .html files |
| $ | Shell | `$` | .sh files |
| / | JavaScript | `//` | .js files |
| :: | TypeScript | `::` | .ts files |

#### Status Indicators

| Icon | Name | Unicode | Meaning |
|------|------|---------|---------|
| ● | Filled dot | `●` (U+25CF) | Active, connected |
| ○ | Empty dot | `○` (U+25CB) | Inactive, ready |
| ◐ | Half dot | `◐` (U+25D0) | Busy, processing |
| ◌ | Dashed dot | `◌` (U+25CC) | Connecting |

#### Tool Rail Icons

| Icon | ID | Representation | Notes |
|------|-----|----------------|-------|
| **A** | format-text | Letter "A" | Font/text options |
| **B** | format-bold | Letter "B" | Bold + basic formatting |
| **I** | format-italic | Letter "I" | Italic (if separate) |
| **#** | format-heading | Hash symbol | Headings |
| **=** | format-list | Three lines | Lists |
| **"** | format-quote | Quotation mark | Blockquote |
| **|** | format-code | Pipe or backtick | Code |
| --- | --- | --- | --- |
| **>** | terminal | Greater-than | Terminal/console |
| **λ** | variables | Lambda | Python environment |
| **?** | ai-commands | Question mark or sparkle | AI assistance |
| **...** | more-menu | Ellipsis | Additional options |

### Icon Implementation

**Option A: Unicode Characters (Recommended)**

```css
.icon-close::before { content: '×'; }
.icon-menu::before { content: '≡'; }
.icon-terminal::before { content: '>'; }
.icon-lambda::before { content: 'λ'; }
```

Pros: Zero dependencies, perfect scaling, font-consistent
Cons: Limited to available glyphs

**Option B: Inline SVG**

```html
<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
  <path d="M6 6L18 18M6 18L18 6"/>
</svg>
```

Pros: Unlimited shapes, animatable
Cons: More DOM elements, larger bundle

**Option C: CSS Shapes**

```css
.icon-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: currentColor;
}
```

Pros: Extremely lightweight
Cons: Limited to simple shapes

### Recommended Approach

1. **Unicode first** for simple icons (close, arrows, dots)
2. **SVG** for complex or unique icons (logo, specialized actions)
3. **CSS shapes** for status indicators (dots, bars)

### Icon Sizes

```css
--icon-xs:  12px;  /* Inline badges */
--icon-sm:  16px;  /* Buttons, tabs */
--icon-md:  20px;  /* Tool rail */
--icon-lg:  24px;  /* Headers, empty states */
--icon-xl:  32px;  /* Feature cards */
```

---

## Spacing & Layout

### Spacing Scale

Based on 4px grid:

```css
--space-0:   0;
--space-px:  1px;
--space-0.5: 2px;
--space-1:   4px;
--space-1.5: 6px;
--space-2:   8px;
--space-2.5: 10px;
--space-3:   12px;
--space-4:   16px;
--space-5:   20px;
--space-6:   24px;
--space-8:   32px;
--space-10:  40px;
--space-12:  48px;
--space-16:  64px;
```

### Layout Dimensions

```css
/* Document */
--content-max-width: 800px;    /* Optimal reading width */
--content-padding:   40px 20px; /* Editor padding */

/* Panels */
--panel-narrow:  280px;  /* Variables, files */
--panel-medium:  320px;  /* AI commands */
--panel-wide:    480px;  /* Terminal */

/* Bars */
--header-height: 44px;
--status-height: 28px;
--tab-height:    36px;

/* Tool rail */
--rail-width:    48px;
--rail-icon:     44px;  /* Button height */

/* Mobile */
--bottom-nav-height: 56px;
--sheet-handle:      4px;
```

### Z-Index Scale

```css
--z-base:      0;
--z-dropdown:  50;
--z-sticky:    100;
--z-overlay:   150;
--z-modal:     200;
--z-popover:   250;
--z-toast:     300;
--z-tooltip:   350;
--z-max:       9999;
```

### Border Radius

```css
--radius-none: 0;
--radius-sm:   2px;   /* Subtle rounding */
--radius-md:   4px;   /* Default */
--radius-lg:   6px;   /* Cards */
--radius-xl:   8px;   /* Modals */
--radius-full: 9999px; /* Pills, dots */
```

---

## Components

### Buttons

```css
/* Base button */
.btn {
  font-family: var(--font-sans);
  font-size: var(--text-base);
  font-weight: var(--font-medium);
  padding: var(--space-1.5) var(--space-3);
  border-radius: var(--radius-md);
  border: 1px solid var(--border);
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  transition: all 0.1s ease;
}

.btn:hover {
  color: var(--text);
  border-color: var(--border-strong);
}

.btn:active {
  background: var(--bg-subtle);
}

/* Primary button */
.btn-primary {
  background: var(--accent);
  border-color: var(--accent);
  color: white;
}

.btn-primary:hover {
  background: var(--accent-hover);
  border-color: var(--accent-hover);
}

/* Ghost button (icon only) */
.btn-ghost {
  border: none;
  padding: var(--space-2);
  color: var(--text-muted);
}

.btn-ghost:hover {
  background: var(--bg-subtle);
  color: var(--text);
}
```

### Input Fields

```css
.input {
  font-family: var(--font-sans);
  font-size: var(--text-base);
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--bg);
  color: var(--text);
}

.input:focus {
  outline: none;
  border-color: var(--accent);
  box-shadow: 0 0 0 2px var(--primary-subtle);
}

.input::placeholder {
  color: var(--text-disabled);
}
```

### Dropdown Menus

```css
.dropdown {
  position: absolute;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
  padding: var(--space-1) 0;
  min-width: 160px;
}

.dropdown-item {
  padding: var(--space-2) var(--space-3);
  font-size: var(--text-base);
  color: var(--text);
  cursor: pointer;
}

.dropdown-item:hover {
  background: var(--bg-subtle);
}

.dropdown-divider {
  height: 1px;
  background: var(--border);
  margin: var(--space-1) 0;
}
```

### Panels

```css
.panel {
  background: var(--bg);
  border-left: 1px solid var(--border);
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-3) var(--space-4);
  border-bottom: 1px solid var(--border);
}

.panel-title {
  font-size: var(--text-sm);
  font-weight: var(--font-semibold);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-secondary);
}

.panel-content {
  padding: var(--space-4);
  overflow-y: auto;
}
```

### Status Dots

```css
.status-dot {
  width: 8px;
  height: 8px;
  border-radius: var(--radius-full);
  background: var(--text-muted);
}

.status-dot.ready { background: var(--success); }
.status-dot.busy { background: var(--warning); }
.status-dot.error { background: var(--error); }
.status-dot.offline { background: var(--text-disabled); }

/* Animated busy state */
.status-dot.busy {
  animation: pulse 1.5s ease-in-out infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}
```

---

## Theming

### Theme Architecture

MRMD supports three document themes that affect content rendering:

1. **Default** - MRMD native style
2. **GitHub** - GitHub-flavored markdown appearance
3. **Docs** - Google Docs-inspired clean style

### Theme Implementation

```css
/* Theme container class */
.rich-editor.theme-default { /* Native styles */ }
.rich-editor.theme-github { /* GitHub styles */ }
.rich-editor.theme-docs { /* Docs styles */ }
```

### System Preference Detection

```css
/* Automatic light/dark based on OS */
@media (prefers-color-scheme: dark) {
  :root {
    /* Dark mode variables */
  }
}

/* Manual override via class */
.theme-light { /* Force light */ }
.theme-dark { /* Force dark */ }
```

### Theme Variables Structure

Each theme can override:

```css
.theme-{name} {
  /* Typography */
  --theme-font-prose: ...;
  --theme-font-code: ...;

  /* Colors */
  --theme-heading-color: ...;
  --theme-link-color: ...;
  --theme-code-bg: ...;

  /* Spacing */
  --theme-heading-margin: ...;
  --theme-paragraph-spacing: ...;

  /* Borders */
  --theme-code-border: ...;
  --theme-quote-border: ...;
}
```

### User-Configurable Options

```javascript
const THEME_OPTIONS = {
  mode: 'system' | 'light' | 'dark',
  documentTheme: 'default' | 'github' | 'docs',
  fontSize: 12 | 14 | 16 | 18,  // Base editor size
  fontFamily: 'mono' | 'sans',  // Prose font
  lineHeight: 'compact' | 'normal' | 'relaxed'
};
```

---

## Motion & Animation

### Principles

1. **Purposeful** - Motion indicates state change or guides attention
2. **Quick** - Most interactions under 200ms
3. **Subtle** - Avoid jarring or distracting movement
4. **Respectful** - Honor `prefers-reduced-motion`

### Timing Functions

```css
--ease-in:      cubic-bezier(0.4, 0, 1, 1);
--ease-out:     cubic-bezier(0, 0, 0.2, 1);
--ease-in-out:  cubic-bezier(0.4, 0, 0.2, 1);
--ease-bounce:  cubic-bezier(0.68, -0.55, 0.265, 1.55);
```

### Duration Scale

```css
--duration-instant: 50ms;   /* Hover states */
--duration-fast:    100ms;  /* Button feedback */
--duration-normal:  200ms;  /* Panel slides */
--duration-slow:    300ms;  /* Modal appearance */
--duration-slower:  500ms;  /* Page transitions */
```

### Standard Animations

```css
/* Panel slide in */
.panel {
  transform: translateX(100%);
  transition: transform var(--duration-normal) var(--ease-out);
}
.panel.open {
  transform: translateX(0);
}

/* Fade in */
.fade-enter {
  opacity: 0;
}
.fade-enter-active {
  opacity: 1;
  transition: opacity var(--duration-normal) var(--ease-out);
}

/* Status pulse */
@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

/* Spinner */
@keyframes spin {
  to { transform: rotate(360deg); }
}

.spinner {
  animation: spin 1s linear infinite;
}
```

### Reduced Motion

```css
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```

---

## Accessibility

### Color Contrast

All text must meet WCAG 2.1 AA standards:

| Combination | Ratio | Status |
|-------------|-------|--------|
| `--text` on `--bg` | 12.6:1 | AAA |
| `--text-secondary` on `--bg` | 7.2:1 | AAA |
| `--text-muted` on `--bg` | 4.6:1 | AA |
| `--accent` on `--bg` | 4.5:1 | AA |

### Focus States

```css
/* Visible focus for keyboard navigation */
:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

/* Remove outline for mouse users */
:focus:not(:focus-visible) {
  outline: none;
}
```

### Keyboard Navigation

All interactive elements must be:
- Focusable via Tab key
- Activatable via Enter/Space
- Dismissible via Escape (modals, dropdowns)

### Screen Reader Support

```html
<!-- Labels for icon buttons -->
<button aria-label="Close panel">
  <span aria-hidden="true">×</span>
</button>

<!-- Live regions for status -->
<div role="status" aria-live="polite">
  Kernel ready
</div>

<!-- Landmark regions -->
<main role="main">...</main>
<nav role="navigation">...</nav>
<aside role="complementary">...</aside>
```

### Touch Targets

Minimum 44x44px for all interactive elements on touch devices.

```css
@media (pointer: coarse) {
  .btn, .dropdown-item, .tab {
    min-height: 44px;
    min-width: 44px;
  }
}
```

---

*Document version: 1.0*
*Last updated: 2024-12-14*
*Author: Claude + Maxime*
