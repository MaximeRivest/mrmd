/**
 * Variable Explorer for mrmd
 *
 * Rich TreeView-based variable explorer that works in all VS Code forks.
 * Uses advanced TreeView techniques for a polished display.
 */

import * as vscode from 'vscode';

interface VariableInfo {
    name: string;
    type: string;
    kind: 'primitive' | 'collection' | 'object' | 'callable' | 'data' | 'class' | 'error';
    preview?: string;
    shape?: string;
    dtype?: string;
    size?: number;
    columns?: string[];
    keys?: string[];
    module?: string;
    expandable?: boolean;
    value?: string;
    members?: string;
    signature?: string;
    doc?: string;
    path?: string;
    length?: number;
    memory_size?: number;
}

interface VariablesResponse {
    session_id: string;
    variables: VariableInfo[];
}

interface InspectResponse {
    path: string;
    info: VariableInfo;
    children: Array<{
        path: string;
        info: VariableInfo;
    }>;
    error?: string;
}

type TreeNode = VariableItem | GroupHeader;

// Unicode characters for better visual formatting
const ARROW = '\u2192';  // →
const BULLET = '\u2022'; // •
const EM_SPACE = '\u2003'; // em space for alignment

export class VariableExplorerProvider implements vscode.TreeDataProvider<TreeNode> {
    private _onDidChangeTreeData = new vscode.EventEmitter<TreeNode | undefined | null | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private variables: VariableInfo[] = [];
    private serverUrl: () => string;
    private getSessionId: () => string;

    constructor(serverUrlGetter: () => string, sessionIdGetter: () => string) {
        this.serverUrl = serverUrlGetter;
        this.getSessionId = sessionIdGetter;
    }

    async refresh(): Promise<void> {
        try {
            const response = await fetch(`${this.serverUrl()}/api/ipython/variables`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ session: this.getSessionId() }),
            });

            if (response.ok) {
                const data = await response.json() as VariablesResponse;
                this.variables = data.variables || [];
            } else {
                this.variables = [];
            }
        } catch {
            this.variables = [];
        }

        this._onDidChangeTreeData.fire();
    }

    clear(): void {
        this.variables = [];
        this._onDidChangeTreeData.fire();
    }

    private async inspectObject(path: string): Promise<InspectResponse | null> {
        try {
            const response = await fetch(`${this.serverUrl()}/api/ipython/inspect_object`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    session: this.getSessionId(),
                    path: path,
                }),
            });

            if (response.ok) {
                return await response.json() as InspectResponse;
            }
        } catch {
            // Ignore
        }
        return null;
    }

    getTreeItem(element: TreeNode): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: TreeNode): Promise<TreeNode[]> {
        if (!element) {
            return this.getRootItems();
        }

        if (element instanceof GroupHeader) {
            // Return the items for this group
            return element.items.map(v => new VariableItem(v, v.path || v.name, 0));
        }

        // Get children of expandable VariableItem
        if (element instanceof VariableItem && element.variable.expandable && element.path) {
            const result = await this.inspectObject(element.path);
            if (result && result.children) {
                return result.children.map(child =>
                    new VariableItem(child.info, child.path, element.depth + 1)
                );
            }
        }

        return [];
    }

    private getRootItems(): TreeNode[] {
        // Group by kind
        const groups: Record<string, { icon: string; label: string; color: string; items: VariableInfo[] }> = {
            data: { icon: 'table', label: 'Data', color: 'charts.blue', items: [] },
            collection: { icon: 'symbol-array', label: 'Collections', color: 'charts.orange', items: [] },
            primitive: { icon: 'symbol-variable', label: 'Values', color: 'charts.green', items: [] },
            object: { icon: 'symbol-class', label: 'Objects', color: 'charts.purple', items: [] },
            callable: { icon: 'symbol-method', label: 'Functions', color: 'charts.yellow', items: [] },
            class: { icon: 'symbol-class', label: 'Classes', color: 'charts.red', items: [] },
        };

        for (const v of this.variables) {
            const kind = v.kind || 'object';
            if (groups[kind]) {
                groups[kind].items.push(v);
            } else {
                groups['object'].items.push(v);
            }
        }

        const items: TreeNode[] = [];
        const order = ['data', 'collection', 'primitive', 'object', 'callable', 'class'];

        for (const kind of order) {
            const group = groups[kind];
            if (group.items.length > 0) {
                items.push(new GroupHeader(group.label, group.icon, group.color, group.items));
            }
        }

        // If no variables, show empty state
        if (items.length === 0) {
            const emptyItem = new vscode.TreeItem('No variables yet');
            emptyItem.description = 'Run some code to see variables';
            emptyItem.iconPath = new vscode.ThemeIcon('info');
            return [emptyItem as TreeNode];
        }

        return items;
    }

    dispose(): void {
        this._onDidChangeTreeData.dispose();
    }
}

/**
 * Group header with colored icon and count badge
 */
class GroupHeader extends vscode.TreeItem {
    constructor(
        label: string,
        icon: string,
        color: string,
        public readonly items: VariableInfo[]
    ) {
        super(label, vscode.TreeItemCollapsibleState.Expanded);
        this.contextValue = 'group';
        this.iconPath = new vscode.ThemeIcon(icon, new vscode.ThemeColor(color));
        this.description = `${items.length}`;

        // Rich tooltip showing what's in this group
        const md = new vscode.MarkdownString();
        md.appendMarkdown(`**${label}** (${items.length} items)\n\n`);
        if (items.length > 0) {
            const preview = items.slice(0, 5).map(v => `- \`${v.name}\`: ${v.type}`).join('\n');
            md.appendMarkdown(preview);
            if (items.length > 5) {
                md.appendMarkdown(`\n- *...and ${items.length - 5} more*`);
            }
        }
        this.tooltip = md;
    }
}

/**
 * Variable item with rich display
 */
class VariableItem extends vscode.TreeItem {
    constructor(
        public readonly variable: VariableInfo,
        public readonly path: string,
        public readonly depth: number = 0
    ) {
        const collapsible = variable.expandable
            ? vscode.TreeItemCollapsibleState.Collapsed
            : vscode.TreeItemCollapsibleState.None;

        super(variable.name, collapsible);

        // Use resourceUri for potential file decorations
        this.resourceUri = vscode.Uri.parse(`mrmd-var:///${path}`);

        // Build rich description: type → value
        this.description = this.buildDescription();

        // Rich markdown tooltip
        this.tooltip = this.buildTooltip();

        // Colored icon based on type
        this.iconPath = this.getIcon();

        // Context for menu actions
        this.contextValue = variable.kind;

        // Command to copy on click for primitives
        if (!variable.expandable && variable.kind === 'primitive') {
            this.command = {
                command: 'mrmd.showVariableDetail',
                title: 'Show Details',
                arguments: [this.path, this.variable]
            };
        }
    }

    private buildDescription(): string {
        const v = this.variable;
        const parts: string[] = [];

        // Type info with shape/size
        let typeStr = v.type;
        if (v.shape) {
            typeStr += v.shape;
        } else if (v.size !== undefined) {
            typeStr += `[${v.size}]`;
        } else if (v.length !== undefined) {
            typeStr += `[${v.length}]`;
        }
        parts.push(typeStr);

        // Arrow separator
        parts.push(ARROW);

        // Value preview (truncated)
        if (v.preview) {
            const maxLen = 35;
            let preview = v.preview;
            // Clean up multiline
            preview = preview.replace(/\n/g, ' ').replace(/\s+/g, ' ');
            if (preview.length > maxLen) {
                preview = preview.slice(0, maxLen - 1) + '…';
            }
            parts.push(preview);
        } else if (v.columns && v.columns.length > 0) {
            // DataFrame columns preview
            const cols = v.columns.slice(0, 3).join(', ');
            parts.push(`[${cols}${v.columns.length > 3 ? '…' : ''}]`);
        } else if (v.keys && v.keys.length > 0) {
            // Dict keys preview
            const keys = v.keys.slice(0, 3).join(', ');
            parts.push(`{${keys}${v.keys.length > 3 ? '…' : ''}}`);
        } else if (v.members) {
            parts.push(`(${v.members})`);
        } else if (v.signature) {
            parts.push(`${v.name}${v.signature}`);
        } else {
            parts.push(BULLET);
        }

        return parts.join(' ');
    }

    private buildTooltip(): vscode.MarkdownString {
        const v = this.variable;
        const md = new vscode.MarkdownString();
        md.isTrusted = true;
        md.supportHtml = true;

        // Header with name
        md.appendMarkdown(`## \`${v.name}\`\n\n`);

        // Info table
        md.appendMarkdown(`| | |\n|:--|:--|\n`);

        if (v.module) {
            md.appendMarkdown(`| **Type** | \`${v.module}.${v.type}\` |\n`);
        } else {
            md.appendMarkdown(`| **Type** | \`${v.type}\` |\n`);
        }

        if (v.shape) {
            md.appendMarkdown(`| **Shape** | \`${v.shape}\` |\n`);
        }
        if (v.dtype) {
            md.appendMarkdown(`| **Dtype** | \`${v.dtype}\` |\n`);
        }
        if (v.size !== undefined) {
            md.appendMarkdown(`| **Length** | ${v.size} |\n`);
        }
        if (v.memory_size !== undefined) {
            md.appendMarkdown(`| **Memory** | ${this.formatBytes(v.memory_size)} |\n`);
        }

        // Columns for DataFrames
        if (v.columns && v.columns.length > 0) {
            md.appendMarkdown(`\n**Columns** (${v.columns.length}):\n`);
            md.appendCodeblock(v.columns.slice(0, 20).join(', ') + (v.columns.length > 20 ? ', ...' : ''), 'text');
        }

        // Keys for dicts
        if (v.keys && v.keys.length > 0) {
            md.appendMarkdown(`\n**Keys** (${v.keys.length}):\n`);
            md.appendCodeblock(v.keys.slice(0, 10).join(', ') + (v.keys.length > 10 ? ', ...' : ''), 'text');
        }

        // Signature for callables
        if (v.signature) {
            md.appendMarkdown(`\n**Signature:**\n`);
            md.appendCodeblock(`${v.name}${v.signature}`, 'python');
        }

        // Docstring
        if (v.doc) {
            md.appendMarkdown(`\n*${v.doc.slice(0, 200)}${v.doc.length > 200 ? '...' : ''}*\n`);
        }

        // Value preview
        if (v.preview) {
            md.appendMarkdown(`\n**Value:**\n`);
            md.appendCodeblock(v.preview.slice(0, 500), 'python');
        }

        return md;
    }

    private formatBytes(bytes: number): string {
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
        if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
        return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
    }

    private getIcon(): vscode.ThemeIcon {
        const v = this.variable;

        // Color mapping for different kinds
        const kindColors: Record<string, string> = {
            'data': 'charts.blue',
            'collection': 'charts.orange',
            'primitive': 'charts.green',
            'object': 'charts.purple',
            'callable': 'charts.yellow',
            'class': 'charts.red',
            'error': 'errorForeground',
        };

        const color = new vscode.ThemeColor(kindColors[v.kind] || 'foreground');

        switch (v.kind) {
            case 'data':
                if (v.type === 'DataFrame') {
                    return new vscode.ThemeIcon('table', color);
                } else if (v.type === 'Series') {
                    return new vscode.ThemeIcon('graph-line', color);
                } else if (v.type === 'ndarray') {
                    return new vscode.ThemeIcon('symbol-array', color);
                }
                return new vscode.ThemeIcon('database', color);

            case 'collection':
                if (v.type === 'dict') {
                    return new vscode.ThemeIcon('json', color);
                } else if (v.type === 'list') {
                    return new vscode.ThemeIcon('list-ordered', color);
                } else if (v.type === 'tuple') {
                    return new vscode.ThemeIcon('symbol-array', color);
                } else if (v.type.includes('set')) {
                    return new vscode.ThemeIcon('symbol-enum', color);
                }
                return new vscode.ThemeIcon('symbol-array', color);

            case 'primitive':
                if (v.type === 'str') {
                    return new vscode.ThemeIcon('symbol-string', color);
                } else if (v.type === 'int' || v.type === 'float' || v.type === 'complex') {
                    return new vscode.ThemeIcon('symbol-number', color);
                } else if (v.type === 'bool') {
                    return new vscode.ThemeIcon('symbol-boolean', color);
                } else if (v.type === 'NoneType') {
                    return new vscode.ThemeIcon('circle-slash', color);
                }
                return new vscode.ThemeIcon('symbol-variable', color);

            case 'callable':
                if (v.type === 'builtin_function_or_method') {
                    return new vscode.ThemeIcon('symbol-method', color);
                }
                return new vscode.ThemeIcon('symbol-function', color);

            case 'class':
                return new vscode.ThemeIcon('symbol-class', color);

            case 'object':
                const typeLower = v.type.toLowerCase();
                if (typeLower.includes('model')) {
                    return new vscode.ThemeIcon('circuit-board', color);
                } else if (typeLower.includes('config') || typeLower.includes('options')) {
                    return new vscode.ThemeIcon('settings-gear', color);
                } else if (typeLower.includes('client') || typeLower.includes('connection')) {
                    return new vscode.ThemeIcon('plug', color);
                } else if (typeLower.includes('path')) {
                    return new vscode.ThemeIcon('file', color);
                } else if (typeLower.includes('date') || typeLower.includes('time')) {
                    return new vscode.ThemeIcon('calendar', color);
                } else if (typeLower.includes('plot') || typeLower.includes('figure')) {
                    return new vscode.ThemeIcon('graph', color);
                }
                return new vscode.ThemeIcon('symbol-class', color);

            case 'error':
                return new vscode.ThemeIcon('error', color);

            default:
                return new vscode.ThemeIcon('symbol-variable', color);
        }
    }
}
