/**
 * mrmd Utilities
 *
 * Common utility functions used across the frontend.
 */

/**
 * Escape HTML special characters.
 */
export function escapeHtml(text) {
    return (text || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

/**
 * Convert ANSI escape codes to HTML spans.
 */
export function ansiToHtml(text) {
    if (!text) return '';

    const ansiColors = {
        '31': 'ansi-red', '32': 'ansi-green', '33': 'ansi-yellow',
        '34': 'ansi-blue', '35': 'ansi-magenta', '36': 'ansi-cyan',
        '91': 'ansi-red', '92': 'ansi-green', '93': 'ansi-yellow',
        '94': 'ansi-blue', '95': 'ansi-magenta', '96': 'ansi-cyan'
    };

    let html = '';
    let inSpan = false;
    let i = 0;

    while (i < text.length) {
        if (text.charCodeAt(i) === 27 && text[i + 1] === '[') {
            i += 2;
            let codes = '';
            while (i < text.length && /[0-9;]/.test(text[i])) {
                codes += text[i++];
            }
            if (text[i] === 'm') i++;

            if (inSpan) { html += '</span>'; inSpan = false; }

            const codeList = codes.split(';');
            let classes = [];
            for (const code of codeList) {
                if (code === '1') classes.push('ansi-bold');
                else if (ansiColors[code]) classes.push(ansiColors[code]);
            }
            if (classes.length > 0) {
                html += `<span class="${classes.join(' ')}">`;
                inSpan = true;
            }
            continue;
        }

        const ch = text[i];
        if (ch === '<') html += '&lt;';
        else if (ch === '>') html += '&gt;';
        else if (ch === '&') html += '&amp;';
        else html += ch;
        i++;
    }

    if (inSpan) html += '</span>';
    return html;
}

/**
 * Highlight code syntax.
 */
export function highlightCode(code, lang) {
    if (!['python', 'julia', 'ruby', 'js', 'javascript'].includes(lang)) {
        return escapeHtml(code);
    }

    // Extract strings first to avoid conflicts with keyword highlighting
    const strings = [];
    let processed = code.replace(/(["'`])(?:(?!\1)[^\\]|\\.)*\1/g, (match) => {
        strings.push(match);
        return `\x00STR${strings.length - 1}\x00`;
    });

    // Extract comments
    const comments = [];
    processed = processed.replace(/(#.*$)/gm, (match) => {
        comments.push(match);
        return `\x00COM${comments.length - 1}\x00`;
    });

    // Now escape HTML on the remaining code
    let html = escapeHtml(processed);

    // Keywords
    html = html.replace(
        /\b(def|class|if|else|elif|for|while|return|import|from|as|try|except|finally|with|lambda|yield|async|await|function|const|let|var|end|do|begin|module|export|using|true|false|True|False|None|nil)\b/g,
        '<span class="hl-keyword">$1</span>'
    );

    // Numbers
    html = html.replace(/\b(\d+\.?\d*)\b/g, '<span class="hl-number">$1</span>');

    // Function calls
    html = html.replace(/\b([a-zA-Z_]\w*)\s*\(/g, '<span class="hl-function">$1</span>(');

    // Restore comments with highlighting
    for (let i = 0; i < comments.length; i++) {
        html = html.replace(`\x00COM${i}\x00`, `<span class="hl-comment">${escapeHtml(comments[i])}</span>`);
    }

    // Restore strings with highlighting
    for (let i = 0; i < strings.length; i++) {
        html = html.replace(`\x00STR${i}\x00`, `<span class="hl-string">${escapeHtml(strings[i])}</span>`);
    }

    return html;
}

/**
 * Debounce a function.
 */
export function debounce(fn, delay) {
    let timeout;
    return function(...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => fn.apply(this, args), delay);
    };
}

/**
 * Throttle a function.
 */
export function throttle(fn, limit) {
    let inThrottle;
    return function(...args) {
        if (!inThrottle) {
            fn.apply(this, args);
            inThrottle = true;
            setTimeout(() => inThrottle = false, limit);
        }
    };
}
