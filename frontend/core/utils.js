/**
 * mrmd Utilities
 *
 * Common utility functions used across the frontend.
 */

/**
 * Escape HTML special characters (safe for use in attributes too).
 */
export function escapeHtml(text) {
    return (text || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/**
 * Escape HTML and wrap whitespace characters in visible spans.
 * Used when "show whitespace" mode is enabled.
 * - Spaces become visible dots (·)
 * - Tabs become visible arrows (→)
 */
export function escapeHtmlShowWhitespace(text) {
    if (!text) return '';

    let result = '';
    for (const char of text) {
        if (char === ' ') {
            result += '<span class="ws-space">·</span>';
        } else if (char === '\t') {
            result += '<span class="ws-tab">→</span>';
        } else if (char === '&') {
            result += '&amp;';
        } else if (char === '<') {
            result += '&lt;';
        } else if (char === '>') {
            result += '&gt;';
        } else if (char === '"') {
            result += '&quot;';
        } else if (char === "'") {
            result += '&#39;';
        } else {
            result += char;
        }
    }
    return result;
}

/**
 * Escape HTML with optional whitespace visualization.
 * Single entry point for all text escaping - use this instead of escapeHtml directly.
 * @param {string} text - Text to escape
 * @param {boolean} showWhitespace - Whether to show whitespace markers
 */
export function escapeText(text, showWhitespace = false) {
    return showWhitespace ? escapeHtmlShowWhitespace(text) : escapeHtml(text);
}

/**
 * Apply whitespace markers to already-rendered HTML.
 * Used for syntax-highlighted code where we can't escape at source.
 * Carefully skips HTML tags and attribute values.
 *
 * @param {string} html - HTML string to process
 * @returns {string} HTML with whitespace markers added to text content
 */
export function applyWhitespaceMarkersToHtml(html) {
    if (!html) return '';

    let result = '';
    let inTag = false;
    let inAttribute = false;
    let attrQuote = null;

    for (let i = 0; i < html.length; i++) {
        const char = html[i];

        if (!inTag && char === '<') {
            inTag = true;
            result += char;
        } else if (inTag && !inAttribute && char === '>') {
            inTag = false;
            result += char;
        } else if (inTag && !inAttribute && (char === '"' || char === "'")) {
            inAttribute = true;
            attrQuote = char;
            result += char;
        } else if (inAttribute && char === attrQuote) {
            inAttribute = false;
            attrQuote = null;
            result += char;
        } else if (inTag) {
            // Inside tag or attribute value - pass through unchanged
            result += char;
        } else if (char === ' ') {
            result += '<span class="ws-space">·</span>';
        } else if (char === '\t') {
            result += '<span class="ws-tab">→</span>';
        } else if (char === '\n') {
            // Add pilcrow marker before newline
            result += '<span class="ws-eol">¶</span>\n';
        } else {
            result += char;
        }
    }

    return result;
}
 
/**
 * Strip ANSI escape codes from text.
 * Handles both real ESC codes and literal [XXm notation.
 * Also handles all CSI, OSC, and other escape sequences.
 */
export function stripAnsi(text) {
    if (!text) return '';

    // Comprehensive ANSI stripping pattern
    // Handles:
    // - CSI sequences: ESC [ ... (letter)
    // - OSC sequences: ESC ] ... (BEL or ESC \)
    // - Other escape sequences: ESC (char)
    // - 8-bit C1 codes
    // - Literal [XXm notation
    return text
        // CSI sequences
        .replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '')
        // OSC sequences (ESC ] ... BEL or ESC ] ... ESC \)
        .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, '')
        // DCS, SOS, PM, APC (ESC P/X/^/_ ... ESC \)
        .replace(/\x1b[PX^_].*?\x1b\\/g, '')
        // Two-character escape sequences
        .replace(/\x1b[()#][A-Za-z0-9]/g, '')
        .replace(/\x1b[A-Za-z]/g, '')
        // 8-bit C1 codes
        .replace(/[\x80-\x9f]/g, '')
        // Literal [XXm notation (legacy)
        .replace(/\[(?:[0-9;]+)m/g, '');
}

/**
 * Convert ANSI escape codes to HTML spans.
 * Handles both real ESC codes and literal [XXm notation.
 * Supports standard colors, bright colors, bold, italic, underline, etc.
 */
export function ansiToHtml(text) {
    if (!text) return '';

    const ansiColors = {
        '30': 'ansi-black', '31': 'ansi-red', '32': 'ansi-green', '33': 'ansi-yellow',
        '34': 'ansi-blue', '35': 'ansi-magenta', '36': 'ansi-cyan', '37': 'ansi-white',
        '90': 'ansi-bright-black', '91': 'ansi-bright-red', '92': 'ansi-bright-green',
        '93': 'ansi-bright-yellow', '94': 'ansi-bright-blue', '95': 'ansi-bright-magenta',
        '96': 'ansi-bright-cyan', '97': 'ansi-bright-white'
    };

    const bgColors = {
        '40': 'ansi-bg-black', '41': 'ansi-bg-red', '42': 'ansi-bg-green', '43': 'ansi-bg-yellow',
        '44': 'ansi-bg-blue', '45': 'ansi-bg-magenta', '46': 'ansi-bg-cyan', '47': 'ansi-bg-white',
        '100': 'ansi-bg-bright-black', '101': 'ansi-bg-bright-red', '102': 'ansi-bg-bright-green',
        '103': 'ansi-bg-bright-yellow', '104': 'ansi-bg-bright-blue', '105': 'ansi-bg-bright-magenta',
        '106': 'ansi-bg-bright-cyan', '107': 'ansi-bg-bright-white'
    };

    // First, normalize literal [XXm to real ESC codes for uniform processing
    text = text.replace(/\[([0-9;]+)m/g, '\x1b[$1m');

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

            // Reset code
            if (codes === '0' || codes === '39' || codes === '') {
                continue;
            }

            const codeList = codes.split(';');
            let classes = [];
            let j = 0;
            while (j < codeList.length) {
                const code = codeList[j];

                // Text attributes
                if (code === '1') classes.push('ansi-bold');
                else if (code === '2') classes.push('ansi-dim');
                else if (code === '3') classes.push('ansi-italic');
                else if (code === '4') classes.push('ansi-underline');
                else if (code === '5' || code === '6') classes.push('ansi-blink');
                else if (code === '7') classes.push('ansi-reverse');
                else if (code === '8') classes.push('ansi-hidden');
                else if (code === '9') classes.push('ansi-strikethrough');

                // Foreground colors
                else if (ansiColors[code]) classes.push(ansiColors[code]);

                // Background colors
                else if (bgColors[code]) classes.push(bgColors[code]);

                // 256-color foreground (38;5;n)
                else if (code === '38' && codeList[j + 1] === '5') {
                    const colorIdx = parseInt(codeList[j + 2], 10);
                    if (!isNaN(colorIdx)) {
                        classes.push(`ansi-fg-${colorIdx}`);
                    }
                    j += 2;
                }

                // 256-color background (48;5;n)
                else if (code === '48' && codeList[j + 1] === '5') {
                    const colorIdx = parseInt(codeList[j + 2], 10);
                    if (!isNaN(colorIdx)) {
                        classes.push(`ansi-bg-${colorIdx}`);
                    }
                    j += 2;
                }

                // 24-bit foreground (38;2;r;g;b)
                else if (code === '38' && codeList[j + 1] === '2') {
                    const r = codeList[j + 2], g = codeList[j + 3], b = codeList[j + 4];
                    if (r && g && b) {
                        classes.push(`ansi-fg-rgb`);
                        // Note: Would need inline style for exact RGB, using class as fallback
                    }
                    j += 4;
                }

                // 24-bit background (48;2;r;g;b)
                else if (code === '48' && codeList[j + 1] === '2') {
                    const r = codeList[j + 2], g = codeList[j + 3], b = codeList[j + 4];
                    if (r && g && b) {
                        classes.push(`ansi-bg-rgb`);
                    }
                    j += 4;
                }

                j++;
            }

            if (classes.length > 0) {
                html += `<span class="${classes.join(' ')}">`;
                inSpan = true;
            }
            continue;
        }

        // Skip other escape sequences
        if (text.charCodeAt(i) === 27) {
            // Skip until we find a letter or reach end
            i++;
            while (i < text.length && !/[a-zA-Z]/.test(text[i])) {
                i++;
            }
            if (i < text.length) i++; // Skip the final letter
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

// Language aliases for highlight.js (maps common aliases to hljs language names)
const LANG_ALIASES = {
    py: 'python',
    js: 'javascript',
    ts: 'typescript',
    jsx: 'javascript',
    tsx: 'typescript',
    sh: 'bash',
    zsh: 'bash',
    shell: 'bash',
    h: 'c',
    hpp: 'cpp',
    cc: 'cpp',
    cxx: 'cpp',
    rs: 'rust',
    yml: 'yaml',
    htm: 'html'
};

/**
 * Highlight code syntax using highlight.js (190+ languages supported).
 * Falls back to escaped HTML if highlight.js is not available or language is unknown.
 */
export function highlightCode(code, lang) {
    // Check if highlight.js is available
    if (typeof hljs === 'undefined') {
        return escapeHtml(code);
    }

    if (!lang) {
        return escapeHtml(code);
    }

    // Use custom markdown highlighter for better control
    if (lang === 'markdown' || lang === 'md') {
        return highlightMarkdownSource(code);
    }

    // Resolve language aliases
    const normalizedLang = lang.toLowerCase();
    const resolvedLang = LANG_ALIASES[normalizedLang] || normalizedLang;

    try {
        // Check if language is supported by highlight.js
        if (hljs.getLanguage(resolvedLang)) {
            return hljs.highlight(code, { language: resolvedLang }).value;
        }
        // Try auto-detection as fallback
        return hljs.highlightAuto(code).value;
    } catch (e) {
        // Fallback to escaped HTML on any error
        return escapeHtml(code);
    }
}

/**
 * Custom markdown source highlighter for source view mode.
 * Shows ALL characters - just adds color via spans, never hides anything.
 */
export function highlightMarkdownSource(line) {
    let html = escapeHtml(line);

    // Code fence lines (``` or ~~~) - highlight the entire line
    if (/^(`{3,}|~{3,})/.test(line)) {
        return `<span class="md-src-fence">${html}</span>`;
    }

    // Headers (# ## ### etc.) - highlight the whole line
    if (/^#{1,6}\s/.test(line)) {
        const level = line.match(/^(#{1,6})/)[1].length;
        return `<span class="md-src-header md-src-h${level}">${html}</span>`;
    }

    // Blockquote lines (>)
    if (/^>\s?/.test(line)) {
        return `<span class="md-src-quote">${html}</span>`;
    }

    // List items (- * + or 1.) - just highlight the bullet
    html = html.replace(/^(\s*)([-*+]|\d+\.)(\s)/, '$1<span class="md-src-bullet">$2</span>$3');

    // Horizontal rules (---, ***, ___)
    if (/^([-*_])\1{2,}\s*$/.test(line)) {
        return `<span class="md-src-hr">${html}</span>`;
    }

    // Inline code `code` - wrap the whole thing including backticks
    html = html.replace(/(`[^`]+`)/g, '<span class="md-src-code">$1</span>');

    // Bold **text** or __text__ - wrap the whole thing including markers
    html = html.replace(/(\*\*[^*]+\*\*|__[^_]+__)/g, '<span class="md-src-bold">$1</span>');

    // Italic *text* or _text_ - wrap the whole thing including markers
    // (but not ** or __ which are bold)
    html = html.replace(/(?<!\*)(\*[^*]+\*)(?!\*)/g, '<span class="md-src-italic">$1</span>');
    html = html.replace(/(?<!_)(_[^_]+_)(?!_)/g, '<span class="md-src-italic">$1</span>');

    // Links [text](url) - wrap the whole thing
    html = html.replace(/(\[[^\]]+\]\([^)]+\))/g, '<span class="md-src-link">$1</span>');

    // Images ![alt](url) - wrap the whole thing
    html = html.replace(/(!\[[^\]]*\]\([^)]+\))/g, '<span class="md-src-image">$1</span>');

    return html;
}

/**
 * Detect language from file extension or filename.
 * Maps file extensions to highlight.js language identifiers.
 * Returns null ONLY for markdown files (which should render as markdown).
 * Returns 'plaintext' for unknown extensions (renders as code without highlighting).
 */
export function detectLanguage(filename) {
    if (!filename) return null;

    // Get just the filename without path
    const basename = filename.split('/').pop() || filename;

    // Special filenames (no extension) - these are code/config files
    const specialFiles = {
        'Makefile': 'makefile',
        'makefile': 'makefile',
        'GNUmakefile': 'makefile',
        'Dockerfile': 'dockerfile',
        'dockerfile': 'dockerfile',
        'Containerfile': 'dockerfile',
        'Gemfile': 'ruby',
        'Rakefile': 'ruby',
        'Guardfile': 'ruby',
        'Vagrantfile': 'ruby',
        'Brewfile': 'ruby',
        'Podfile': 'ruby',
        'Fastfile': 'ruby',
        'Appfile': 'ruby',
        'Berksfile': 'ruby',
        'Capfile': 'ruby',
        'Thorfile': 'ruby',
        'Puppetfile': 'ruby',
        'Buildfile': 'ruby',
        '.gitignore': 'plaintext',
        '.gitattributes': 'plaintext',
        '.gitmodules': 'ini',
        '.editorconfig': 'ini',
        '.env': 'bash',
        '.env.local': 'bash',
        '.env.development': 'bash',
        '.env.production': 'bash',
        '.bashrc': 'bash',
        '.bash_profile': 'bash',
        '.bash_aliases': 'bash',
        '.zshrc': 'bash',
        '.zprofile': 'bash',
        '.profile': 'bash',
        '.vimrc': 'vim',
        '.npmrc': 'ini',
        '.yarnrc': 'yaml',
        '.prettierrc': 'json',
        '.eslintrc': 'json',
        '.babelrc': 'json',
        'tsconfig.json': 'json',
        'jsconfig.json': 'json',
        'package.json': 'json',
        'composer.json': 'json',
        'Cargo.toml': 'toml',
        'pyproject.toml': 'toml',
        'poetry.lock': 'toml',
        'Pipfile': 'toml',
        'requirements.txt': 'plaintext',
        'constraints.txt': 'plaintext',
        'go.mod': 'go',
        'go.sum': 'plaintext',
        'CMakeLists.txt': 'cmake',
        'meson.build': 'plaintext',
        'BUILD': 'python',
        'BUILD.bazel': 'python',
        'WORKSPACE': 'python',
        'WORKSPACE.bazel': 'python',
        '.htaccess': 'apache',
        'nginx.conf': 'nginx',
        'httpd.conf': 'apache',
        'Procfile': 'yaml',
        'Caddyfile': 'plaintext',
        '.dockerignore': 'plaintext',
        '.slugignore': 'plaintext',
        '.cfignore': 'plaintext',
        '.gcloudignore': 'plaintext',
        'CODEOWNERS': 'plaintext',
        'AUTHORS': 'plaintext',
        'CONTRIBUTORS': 'plaintext',
        'LICENSE': 'plaintext',
        'COPYING': 'plaintext',
        'CHANGELOG': 'markdown',
        'HISTORY': 'markdown',
        'NEWS': 'plaintext',
        'TODO': 'plaintext',
        'INSTALL': 'plaintext'
    };

    if (specialFiles[basename] !== undefined) {
        return specialFiles[basename];
    }

    // Get extension
    const ext = basename.includes('.') ? basename.split('.').pop()?.toLowerCase() : null;
    if (!ext) {
        // No extension and not a special file - treat as plaintext code file
        return 'plaintext';
    }

    // Comprehensive mapping of file extensions to highlight.js language names
    const extToLang = {
        // Python
        py: 'python',
        pyw: 'python',
        pyi: 'python',
        pyx: 'python',
        pxd: 'python',
        rpy: 'python',
        gyp: 'python',
        gypi: 'python',
        bzl: 'python',
        lark: 'plaintext',

        // JavaScript / TypeScript
        js: 'javascript',
        mjs: 'javascript',
        cjs: 'javascript',
        jsx: 'javascript',
        es6: 'javascript',
        ts: 'typescript',
        tsx: 'typescript',
        mts: 'typescript',
        cts: 'typescript',
        d_ts: 'typescript',
        coffee: 'coffeescript',
        litcoffee: 'coffeescript',

        // Web
        html: 'html',
        htm: 'html',
        xhtml: 'html',
        vue: 'html',
        svelte: 'html',
        astro: 'html',
        ejs: 'html',
        hbs: 'handlebars',
        handlebars: 'handlebars',
        mustache: 'handlebars',
        njk: 'twig',
        jinja: 'twig',
        jinja2: 'twig',
        twig: 'twig',
        liquid: 'plaintext',
        pug: 'pug',
        jade: 'pug',
        haml: 'haml',
        slim: 'plaintext',
        css: 'css',
        scss: 'scss',
        sass: 'scss',
        less: 'less',
        stylus: 'stylus',
        styl: 'stylus',
        pcss: 'css',
        postcss: 'css',

        // Data formats
        json: 'json',
        json5: 'json',
        jsonc: 'json',
        jsonl: 'json',
        ndjson: 'json',
        geojson: 'json',
        topojson: 'json',
        har: 'json',
        webmanifest: 'json',
        yaml: 'yaml',
        yml: 'yaml',
        toml: 'toml',
        tml: 'toml',
        ini: 'ini',
        conf: 'ini',
        cfg: 'ini',
        properties: 'properties',
        env: 'bash',
        dotenv: 'bash',
        xml: 'xml',
        svg: 'xml',
        xsl: 'xml',
        xslt: 'xml',
        xsd: 'xml',
        dtd: 'xml',
        rss: 'xml',
        atom: 'xml',
        plist: 'xml',
        csproj: 'xml',
        fsproj: 'xml',
        vbproj: 'xml',
        vcxproj: 'xml',
        sln: 'plaintext',
        resx: 'xml',
        xaml: 'xml',
        axaml: 'xml',
        nuspec: 'xml',
        props: 'xml',
        targets: 'xml',

        // Shell / Scripts
        sh: 'bash',
        bash: 'bash',
        zsh: 'bash',
        fish: 'fish',
        ksh: 'bash',
        csh: 'bash',
        tcsh: 'bash',
        ps1: 'powershell',
        psm1: 'powershell',
        psd1: 'powershell',
        bat: 'dos',
        cmd: 'dos',
        btm: 'dos',
        awk: 'awk',
        sed: 'bash',

        // C / C++
        c: 'c',
        h: 'c',
        i: 'c',
        cpp: 'cpp',
        cc: 'cpp',
        cxx: 'cpp',
        c__: 'cpp',
        hpp: 'cpp',
        hxx: 'cpp',
        hh: 'cpp',
        h__: 'cpp',
        inc: 'cpp',
        inl: 'cpp',
        ipp: 'cpp',
        tcc: 'cpp',
        tpp: 'cpp',
        ino: 'cpp',
        pde: 'cpp',

        // Other systems languages
        go: 'go',
        rs: 'rust',
        zig: 'zig',
        nim: 'nim',
        nimble: 'nim',
        d: 'd',
        di: 'd',
        v: 'v',
        vv: 'v',
        odin: 'plaintext',
        jai: 'plaintext',
        carbon: 'plaintext',

        // JVM
        java: 'java',
        jar: 'plaintext',
        class: 'plaintext',
        kt: 'kotlin',
        kts: 'kotlin',
        ktm: 'kotlin',
        scala: 'scala',
        sc: 'scala',
        sbt: 'scala',
        groovy: 'groovy',
        gvy: 'groovy',
        gy: 'groovy',
        gsh: 'groovy',
        gradle: 'groovy',
        clj: 'clojure',
        cljs: 'clojure',
        cljc: 'clojure',
        cljx: 'clojure',
        edn: 'clojure',

        // .NET
        cs: 'csharp',
        csx: 'csharp',
        cake: 'csharp',
        fs: 'fsharp',
        fsx: 'fsharp',
        fsi: 'fsharp',
        vb: 'vbnet',
        vbs: 'vbscript',

        // Ruby
        rb: 'ruby',
        rbw: 'ruby',
        erb: 'erb',
        rhtml: 'erb',
        rake: 'ruby',
        gemspec: 'ruby',
        ru: 'ruby',
        thor: 'ruby',
        rabl: 'ruby',
        jbuilder: 'ruby',
        builder: 'ruby',
        podspec: 'ruby',

        // PHP
        php: 'php',
        php3: 'php',
        php4: 'php',
        php5: 'php',
        php7: 'php',
        php8: 'php',
        phtml: 'php',
        phps: 'php',
        blade_php: 'php',

        // Perl
        pl: 'perl',
        pm: 'perl',
        pod: 'perl',
        t: 'perl',
        psgi: 'perl',

        // Lua
        lua: 'lua',
        luau: 'lua',
        rockspec: 'lua',
        nse: 'lua',

        // Swift / Objective-C
        swift: 'swift',
        swiftinterface: 'swift',
        m: 'objectivec',
        mm: 'objectivec',
        metal: 'cpp',

        // R / Julia / Data Science
        r: 'r',
        R: 'r',
        rmd: 'r',
        Rmd: 'r',
        rmarkdown: 'r',
        jl: 'julia',
        ipynb: 'json',
        mat: 'matlab',
        matlab: 'matlab',
        octave: 'matlab',
        sas: 'sas',
        stata: 'stata',
        do: 'stata',
        ado: 'stata',

        // Haskell / Functional
        hs: 'haskell',
        lhs: 'haskell',
        hsc: 'haskell',
        cabal: 'plaintext',
        elm: 'elm',
        purs: 'haskell',
        ml: 'ocaml',
        mli: 'ocaml',
        mll: 'ocaml',
        mly: 'ocaml',
        re: 'reasonml',
        rei: 'reasonml',
        res: 'reasonml',
        resi: 'reasonml',
        ex: 'elixir',
        exs: 'elixir',
        eex: 'elixir',
        heex: 'elixir',
        leex: 'elixir',
        erl: 'erlang',
        hrl: 'erlang',
        app_src: 'erlang',
        gleam: 'plaintext',
        roc: 'plaintext',
        idr: 'plaintext',
        agda: 'plaintext',
        flix: 'plaintext',

        // SQL / Databases
        sql: 'sql',
        pgsql: 'pgsql',
        plsql: 'sql',
        mysql: 'sql',
        sqlite: 'sql',
        sqlite3: 'sql',
        ddl: 'sql',
        dml: 'sql',
        hql: 'sql',
        cql: 'sql',
        prisma: 'plaintext',
        graphql: 'graphql',
        gql: 'graphql',

        // DevOps / Config / Infrastructure
        dockerfile: 'dockerfile',
        tf: 'hcl',
        tfvars: 'hcl',
        tfstate: 'json',
        hcl: 'hcl',
        nomad: 'hcl',
        sentinel: 'hcl',
        nix: 'nix',
        dhall: 'plaintext',
        cmake: 'cmake',
        make: 'makefile',
        mk: 'makefile',
        mak: 'makefile',
        am: 'makefile',
        ac: 'plaintext',
        m4: 'plaintext',
        service: 'ini',
        socket: 'ini',
        timer: 'ini',
        target: 'ini',
        mount: 'ini',
        path: 'ini',
        network: 'ini',
        netdev: 'ini',
        link: 'ini',
        automount: 'ini',
        slice: 'ini',
        swap: 'ini',
        ansible: 'yaml',
        k8s: 'yaml',
        helm: 'yaml',
        kustomization: 'yaml',

        // Lisp family
        lisp: 'lisp',
        lsp: 'lisp',
        cl: 'lisp',
        el: 'lisp',
        elisp: 'lisp',
        scm: 'scheme',
        ss: 'scheme',
        rkt: 'scheme',
        hy: 'lisp',
        fnl: 'lisp',
        janet: 'lisp',
        shen: 'lisp',

        // Assembly
        asm: 'x86asm',
        s: 'x86asm',
        S: 'x86asm',
        nasm: 'x86asm',
        yasm: 'x86asm',
        masm: 'x86asm',
        gas: 'x86asm',
        arm: 'armasm',
        aarch64: 'armasm',

        // Markup / Documentation
        tex: 'latex',
        latex: 'latex',
        sty: 'latex',
        cls: 'latex',
        bib: 'bibtex',
        rst: 'plaintext',
        rest: 'plaintext',
        adoc: 'asciidoc',
        asciidoc: 'asciidoc',
        asc: 'asciidoc',
        org: 'plaintext',
        pod: 'perl',
        rdoc: 'plaintext',
        textile: 'plaintext',
        creole: 'plaintext',
        mediawiki: 'plaintext',
        wiki: 'plaintext',
        man: 'plaintext',
        mdx: 'markdown',
        lrepl: null,

        // Hardware / FPGA
        vhd: 'vhdl',
        vhdl: 'vhdl',
        verilog: 'verilog',
        sv: 'verilog',
        svh: 'verilog',
        vh: 'verilog',
        sdc: 'tcl',
        xdc: 'tcl',
        tcl: 'tcl',
        ucf: 'plaintext',
        pcf: 'plaintext',
        lpf: 'plaintext',
        bsv: 'plaintext',

        // Game Dev / Shaders
        glsl: 'glsl',
        vert: 'glsl',
        frag: 'glsl',
        geom: 'glsl',
        tesc: 'glsl',
        tese: 'glsl',
        comp: 'glsl',
        hlsl: 'hlsl',
        fx: 'hlsl',
        fxh: 'hlsl',
        cg: 'hlsl',
        shader: 'glsl',
        compute: 'glsl',
        gdshader: 'plaintext',
        wgsl: 'wgsl',
        spv: 'plaintext',
        spirv: 'plaintext',
        gd: 'gdscript',
        gdscript: 'gdscript',
        unity: 'yaml',
        prefab: 'yaml',
        asset: 'yaml',
        mat: 'yaml',
        meta: 'yaml',
        anim: 'yaml',
        controller: 'yaml',
        tres: 'plaintext',
        tscn: 'plaintext',

        // Smart Contracts / Crypto
        sol: 'solidity',
        vy: 'python',
        cairo: 'plaintext',
        move: 'plaintext',
        anchor: 'rust',
        fe: 'plaintext',

        // Misc Programming
        wasm: 'wasm',
        wat: 'wasm',
        proto: 'protobuf',
        pb: 'protobuf',
        thrift: 'thrift',
        avsc: 'json',
        avdl: 'plaintext',
        fbs: 'plaintext',
        capnp: 'plaintext',
        p4: 'plaintext',
        yang: 'plaintext',
        abnf: 'abnf',
        ebnf: 'ebnf',
        peg: 'plaintext',
        xquery: 'xquery',
        xpath: 'xpath',
        xslt: 'xml',
        xlf: 'xml',
        xliff: 'xml',
        po: 'plaintext',
        pot: 'plaintext',
        arb: 'json',
        strings: 'plaintext',
        stringsdict: 'xml',
        resx: 'xml',
        xlf: 'xml',

        // Misc data/config
        csv: 'plaintext',
        tsv: 'plaintext',
        psv: 'plaintext',
        ics: 'plaintext',
        vcf: 'plaintext',
        vcard: 'plaintext',
        desktop: 'ini',
        reg: 'plaintext',
        inf: 'ini',
        editorconfig: 'ini',
        npmrc: 'ini',
        yarnrc: 'yaml',
        bowerrc: 'json',
        browserslistrc: 'plaintext',
        nvmrc: 'plaintext',
        rvmrc: 'bash',
        ruby_version: 'plaintext',
        python_version: 'plaintext',
        node_version: 'plaintext',
        tool_versions: 'plaintext',
        lock: 'plaintext',

        // Diffs
        diff: 'diff',
        patch: 'diff',

        // Markdown (renders as markdown, not code)
        md: null,
        markdown: null,

        // Plain text (renders as markdown)
        txt: null,
        text: null,
        log: null
    };

    // Check extension mapping
    if (extToLang[ext] !== undefined) {
        return extToLang[ext];
    }

    // For unknown extensions, treat as plaintext code file
    // (better UX than trying to render as markdown)
    return 'plaintext';
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
 * Smart DOM diffing for editor content.
 * Updates the container's children to match newHtml while preserving unchanged elements.
 *
 * Key features:
 * - Preserves elements with matching data-line/data-block attributes
 * - Only updates innerHTML when content actually changed
 * - Maintains scroll position and focus
 *
 * IMPORTANT: This is a generic DOM utility. All business logic (which elements
 * to preserve, which to skip updates for) should be passed via options, NOT
 * hardcoded in this function.
 *
 * @param {HTMLElement} container - Container element to update
 * @param {string} newHtml - New HTML content
 * @param {Object} options - Configuration options
 * @param {Set<string>} [options.preserveSelectors] - CSS selectors for elements whose
 *        content should never be replaced (e.g., live iframes, terminals). These elements
 *        and their children are completely preserved.
 * @param {function(HTMLElement): string|null} [options.getElementKey] - Custom function to
 *        generate identity keys for elements. Return null for elements that shouldn't be
 *        tracked. Default uses data-line, data-block, data-offset attributes.
 * @param {function(HTMLElement): boolean} [options.shouldPreserveContent] - Custom function
 *        to check if an element's content should be preserved. Called in addition to
 *        preserveSelectors check. Useful for dynamic preservation logic.
 */
export function smartDomUpdate(container, newHtml, options = {}) {
    // Default: no selectors to preserve (caller must explicitly specify)
    const preserveSelectors = options.preserveSelectors || new Set();

    // Allow custom key generation, with sensible default
    const getKey = options.getElementKey || ((el) => {
        if (el.nodeType !== 1) return null;
        if (el.classList?.contains('virtual-spacer')) {
            const isTop = !el.previousElementSibling || el.previousElementSibling.classList?.contains('virtual-spacer');
            return isTop ? 'spacer-top' : 'spacer-bottom';
        }
        const line = el.dataset?.line;
        const block = el.dataset?.block;
        const offset = el.dataset?.offset;
        if (line !== undefined) return `line-${line}-${offset}`;
        if (block !== undefined) return `block-${block}-${offset}`;
        return null;
    });

    // Allow custom preservation logic
    const customShouldPreserve = options.shouldPreserveContent || (() => false);

    // Create a temporary container to parse new HTML
    const temp = document.createElement('div');
    temp.innerHTML = newHtml;

    // Check if element has preservable content (via selectors or custom logic)
    const hasPreservableContent = (el) => {
        if (!el || el.nodeType !== 1) return false;

        // Check custom preservation logic first
        if (customShouldPreserve(el)) return true;

        // Check selector-based preservation
        for (const selector of preserveSelectors) {
            if (el.matches?.(selector) || el.querySelector?.(selector)) {
                return true;
            }
        }
        return false;
    };

    const oldChildren = Array.from(container.children);
    const newChildren = Array.from(temp.children);

    // Build key maps
    const oldMap = new Map();
    oldChildren.forEach((el, i) => {
        const key = getKey(el);
        if (key) oldMap.set(key, { el, index: i, used: false });
    });

    // Process each new child
    for (let i = 0; i < newChildren.length; i++) {
        const newEl = newChildren[i];
        const newKey = getKey(newEl);
        const currentAtPos = container.children[i];

        // Try to find matching old element
        const oldEntry = newKey ? oldMap.get(newKey) : null;

        if (oldEntry && !oldEntry.used) {
            oldEntry.used = true;
            const oldEl = oldEntry.el;

            // Move to correct position if needed
            if (currentAtPos !== oldEl) {
                container.insertBefore(oldEl, currentAtPos);
            }

            // Update the element if it doesn't have preservable content
            if (!hasPreservableContent(oldEl)) {
                // Virtual spacers - just update height
                if (oldEl.classList?.contains('virtual-spacer')) {
                    if (oldEl.style.height !== newEl.style.height) {
                        oldEl.style.height = newEl.style.height;
                    }
                } else {
                    // Update class if changed
                    if (oldEl.className !== newEl.className) {
                        oldEl.className = newEl.className;
                    }
                    // Update data attributes
                    for (const attr of newEl.attributes) {
                        if (attr.name.startsWith('data-') && oldEl.getAttribute(attr.name) !== attr.value) {
                            oldEl.setAttribute(attr.name, attr.value);
                        }
                    }
                    // Update innerHTML if different
                    if (oldEl.innerHTML !== newEl.innerHTML) {
                        oldEl.innerHTML = newEl.innerHTML;
                    }
                }
            }
        } else {
            // No matching old element - insert the new one
            const clone = newEl.cloneNode(true);
            if (currentAtPos) {
                container.insertBefore(clone, currentAtPos);
            } else {
                container.appendChild(clone);
            }
        }
    }

    // Remove unused old elements (in reverse to preserve indices)
    for (let i = container.children.length - 1; i >= newChildren.length; i--) {
        const child = container.children[i];
        if (!hasPreservableContent(child)) {
            container.removeChild(child);
        }
    }
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
