/**
 * MRMD AI Client
 *
 * Client for the AI server (dspy-cli) that provides completion, fix, and correction programs.
 * Communicates with the standalone AI server on port 8766.
 *
 * @example
 * ```javascript
 * const ai = new AiClient('http://localhost:8766');
 *
 * // Finish a sentence
 * const result = await ai.finishSentence({
 *     textBeforeCursor: 'The quick brown fox',
 *     localContext: 'The quick brown fox...',
 *     documentContext: 'Full document...'
 * });
 * console.log(result.completion); // "jumps over the lazy dog."
 * ```
 */

/**
 * Truncate base64 encoded data in a string to reduce token usage.
 * Replaces data URLs and inline base64 images with placeholders.
 *
 * @param {string} str - The string to process
 * @returns {string} - String with base64 data truncated
 */
function truncateBase64(str) {
    if (!str || typeof str !== 'string') return str;

    // Pattern 1: Data URLs (data:image/png;base64,... or data:image/jpeg;base64,...)
    // Keep the MIME type info but truncate the actual base64 data
    str = str.replace(
        /data:(image\/[a-zA-Z+]+);base64,[A-Za-z0-9+/=]{100,}/g,
        'data:$1;base64,[base64 data truncated]'
    );

    // Pattern 2: Markdown image syntax with data URLs
    // ![alt](data:image/...;base64,...) -> ![alt]([image data truncated])
    str = str.replace(
        /!\[([^\]]*)\]\(data:image\/[a-zA-Z+]+;base64,[A-Za-z0-9+/=]{100,}\)/g,
        '![$1]([inline image data truncated])'
    );

    // Pattern 3: HTML img tags with data URLs
    // <img src="data:image/...;base64,..." -> <img src="[image data truncated]"
    str = str.replace(
        /<img([^>]*)src=["']data:image\/[a-zA-Z+]+;base64,[A-Za-z0-9+/=]{100,}["']([^>]*)>/gi,
        '<img$1src="[image data truncated]"$2>'
    );

    // Pattern 4: Raw base64 blocks that look like image data (very long base64 strings)
    // This catches cases where base64 appears on its own line or in code blocks
    str = str.replace(
        /^[A-Za-z0-9+/]{200,}[=]{0,2}$/gm,
        '[base64 data truncated]'
    );

    return str;
}

/**
 * Process params object to truncate base64 in context fields.
 *
 * @param {object} params - API call parameters
 * @returns {object} - Parameters with base64 truncated in context fields
 */
function truncateBase64InParams(params) {
    if (!params || typeof params !== 'object') return params;

    const result = { ...params };

    // Truncate in common context field names
    const contextFields = [
        'local_context',
        'document_context',
        'documentContext',
        'localContext',
        'context',
        'document',
        'text',
        'code'
    ];

    for (const field of contextFields) {
        if (result[field] && typeof result[field] === 'string') {
            result[field] = truncateBase64(result[field]);
        }
    }

    return result;
}

export class AiClient {
    constructor(baseUrl = '/api/ai') {
        // Use proxy by default (avoids CORS issues)
        this.baseUrl = baseUrl.replace(/\/$/, '');
        this._programs = null;
        this._juice = 0; // Default juice level
    }

    /**
     * Set the juice level for subsequent calls.
     * @param {number} level - Juice level 0-4
     */
    setJuice(level) {
        this._juice = Math.max(0, Math.min(4, level));
    }

    /**
     * Get current juice level.
     * @returns {number}
     */
    getJuice() {
        return this._juice;
    }

    // ===========================================================================
    // Programs Discovery
    // ===========================================================================

    /**
     * Get list of available AI programs.
     * @returns {Promise<Array<{name: string, model: string, endpoint: string}>>}
     */
    async getPrograms() {
        if (this._programs) return this._programs;

        const response = await fetch(`${this.baseUrl}/programs`);
        if (!response.ok) {
            throw new Error(`Failed to get programs: ${response.statusText}`);
        }
        const data = await response.json();
        this._programs = data.programs || [];
        return this._programs;
    }

    /**
     * Check if AI server is available.
     * @returns {Promise<boolean>}
     */
    async isAvailable() {
        try {
            const response = await fetch(`${this.baseUrl}/programs`, {
                signal: AbortSignal.timeout(2000),
            });
            return response.ok;
        } catch {
            return false;
        }
    }

    // ===========================================================================
    // Finish Programs (Completions)
    // ===========================================================================

    /**
     * Complete the current sentence.
     * @param {string} textBeforeCursor - Text up to cursor position
     * @param {string} localContext - Current paragraph/section
     * @param {string|null} documentContext - Full document for broader context
     * @returns {Promise<{completion: string}>}
     */
    async finishSentence(textBeforeCursor, localContext, documentContext = null) {
        return this._call('FinishSentencePredict', {
            text_before_cursor: textBeforeCursor,
            local_context: localContext,
            document_context: documentContext,
        });
    }

    /**
     * Complete the current paragraph.
     * @param {string} textBeforeCursor - Text up to cursor position
     * @param {string} localContext - Current section
     * @param {string|null} documentContext - Full document for broader context
     * @returns {Promise<{completion: string}>}
     */
    async finishParagraph(textBeforeCursor, localContext, documentContext = null) {
        return this._call('FinishParagraphPredict', {
            text_before_cursor: textBeforeCursor,
            local_context: localContext,
            document_context: documentContext,
        });
    }

    /**
     * Complete the current line of code.
     * @param {string} codeBeforeCursor - Code up to cursor position
     * @param {string} language - Programming language
     * @param {string} localContext - Current code block
     * @param {string|null} documentContext - Full notebook for context
     * @returns {Promise<{completion: string}>}
     */
    async finishCodeLine(codeBeforeCursor, language, localContext, documentContext = null) {
        return this._call('FinishCodeLinePredict', {
            code_before_cursor: codeBeforeCursor,
            language,
            local_context: localContext,
            document_context: documentContext,
        });
    }

    /**
     * Complete the current code section (function, class, block).
     * @param {string} codeBeforeCursor - Code up to cursor position
     * @param {string} language - Programming language
     * @param {string} localContext - Current code block
     * @param {string|null} documentContext - Full notebook for context
     * @returns {Promise<{completion: string}>}
     */
    async finishCodeSection(codeBeforeCursor, language, localContext, documentContext = null) {
        return this._call('FinishCodeSectionPredict', {
            code_before_cursor: codeBeforeCursor,
            language,
            local_context: localContext,
            document_context: documentContext,
        });
    }

    // ===========================================================================
    // Fix Programs (Corrections)
    // ===========================================================================

    /**
     * Fix grammar, spelling, and punctuation.
     * @param {string} textToFix - Text to fix
     * @param {string} localContext - Current paragraph/section for context
     * @param {string|null} documentContext - Full document for terminology
     * @returns {Promise<{fixed_text: string}>}
     */
    async fixGrammar(textToFix, localContext, documentContext = null) {
        return this._call('FixGrammarPredict', {
            text_to_fix: textToFix,
            local_context: localContext,
            document_context: documentContext,
        });
    }

    /**
     * Fix speech-to-text transcription errors.
     * @param {string} textToFix - Transcribed text to fix
     * @param {string} localContext - Current section for context
     * @param {string|null} documentContext - Full document for topic understanding
     * @returns {Promise<{fixed_text: string}>}
     */
    async fixTranscription(textToFix, localContext, documentContext = null) {
        return this._call('FixTranscriptionPredict', {
            text_to_fix: textToFix,
            local_context: localContext,
            document_context: documentContext,
        });
    }

    // ===========================================================================
    // Correct & Finish Programs
    // ===========================================================================

    /**
     * Correct errors and complete the current line.
     * @param {string} textToFix - Current line (text or code)
     * @param {string} contentType - 'text', or language like 'python'
     * @param {string} localContext - Surrounding context
     * @param {string|null} documentContext - Full document
     * @returns {Promise<{corrected_completion: string}>}
     */
    async correctAndFinishLine(textToFix, contentType, localContext, documentContext = null) {
        return this._call('CorrectAndFinishLinePredict', {
            text_to_fix: textToFix,
            content_type: contentType,
            local_context: localContext,
            document_context: documentContext,
        });
    }

    /**
     * Correct errors and complete the current section.
     * @param {string} textToFix - Current section (paragraph or code block)
     * @param {string} contentType - 'text', or language like 'python'
     * @param {string} localContext - Surrounding context
     * @param {string|null} documentContext - Full document
     * @returns {Promise<{corrected_completion: string}>}
     */
    async correctAndFinishSection(textToFix, contentType, localContext, documentContext = null) {
        return this._call('CorrectAndFinishSectionPredict', {
            text_to_fix: textToFix,
            content_type: contentType,
            local_context: localContext,
            document_context: documentContext,
        });
    }

    // ===========================================================================
    // Code Transformation Programs
    // ===========================================================================

    /**
     * Add documentation/docstring to code.
     * @param {string} code - Code to document
     * @param {string} language - Programming language
     * @param {string} localContext - Surrounding code
     * @param {string|null} documentContext - Full file
     * @returns {Promise<{documented_code: string}>}
     */
    async documentCode(code, language, localContext, documentContext = null) {
        return this._call('DocumentCodePredict', {
            code,
            language,
            local_context: localContext,
            document_context: documentContext,
        });
    }

    /**
     * Complete a function/class/block.
     * @param {string} code - Incomplete code
     * @param {string} language - Programming language
     * @param {string} localContext - Surrounding code
     * @param {string|null} documentContext - Full file
     * @returns {Promise<{completion: string}>}
     */
    async completeCode(code, language, localContext, documentContext = null) {
        return this._call('CompleteCodePredict', {
            code,
            language,
            local_context: localContext,
            document_context: documentContext,
        });
    }

    /**
     * Add type hints to code.
     * @param {string} code - Code to annotate
     * @param {string} language - Programming language
     * @param {string} localContext - Surrounding code
     * @param {string|null} documentContext - Full file
     * @returns {Promise<{typed_code: string}>}
     */
    async addTypeHints(code, language, localContext, documentContext = null) {
        return this._call('AddTypeHintsPredict', {
            code,
            language,
            local_context: localContext,
            document_context: documentContext,
        });
    }

    /**
     * Improve variable and function names.
     * @param {string} code - Code with names to improve
     * @param {string} language - Programming language
     * @param {string} localContext - Surrounding code
     * @param {string|null} documentContext - Full file
     * @returns {Promise<{improved_code: string}>}
     */
    async improveNames(code, language, localContext, documentContext = null) {
        return this._call('ImproveNamesPredict', {
            code,
            language,
            local_context: localContext,
            document_context: documentContext,
        });
    }

    /**
     * Add explanatory comments to code.
     * @param {string} code - Code to explain
     * @param {string} language - Programming language
     * @param {string} localContext - Surrounding code
     * @param {string|null} documentContext - Full file
     * @returns {Promise<{explained_code: string}>}
     */
    async explainCode(code, language, localContext, documentContext = null) {
        return this._call('ExplainCodePredict', {
            code,
            language,
            local_context: localContext,
            document_context: documentContext,
        });
    }

    /**
     * Refactor and simplify code.
     * @param {string} code - Code to refactor
     * @param {string} language - Programming language
     * @param {string} localContext - Surrounding code
     * @param {string|null} documentContext - Full file
     * @returns {Promise<{refactored_code: string}>}
     */
    async refactorCode(code, language, localContext, documentContext = null) {
        return this._call('RefactorCodePredict', {
            code,
            language,
            local_context: localContext,
            document_context: documentContext,
        });
    }

    /**
     * Format and prettify code.
     * @param {string} code - Code to format
     * @param {string} language - Programming language
     * @param {string} localContext - Surrounding code
     * @param {string|null} documentContext - Full file
     * @returns {Promise<{formatted_code: string}>}
     */
    async formatCode(code, language, localContext, documentContext = null) {
        return this._call('FormatCodePredict', {
            code,
            language,
            local_context: localContext,
            document_context: documentContext,
        });
    }

    // ===========================================================================
    // Text Operations
    // ===========================================================================

    /**
     * Get synonyms for a single word.
     * @param {string} text - Word to find synonyms for
     * @param {string} localContext - Surrounding text for context
     * @param {string|null} documentContext - Full document
     * @returns {Promise<{synonyms: string[], original: string}>}
     */
    async getSynonyms(text, localContext, documentContext = null) {
        return this._call('GetSynonymsPredict', {
            text,
            local_context: localContext,
            document_context: documentContext,
        });
    }

    /**
     * Get alternative phrases for a multi-word expression.
     * @param {string} phrase - Multi-word phrase to find alternatives for
     * @param {string} localContext - Surrounding text for context
     * @param {string|null} documentContext - Full document
     * @returns {Promise<{alternatives: string[], original: string}>}
     */
    async getPhraseSynonyms(phrase, localContext, documentContext = null) {
        return this._call('GetPhraseSynonymsPredict', {
            phrase,
            local_context: localContext,
            document_context: documentContext,
        });
    }

    /**
     * Reformat and clean up markdown text.
     * @param {string} text - Markdown text to reformat
     * @param {string} localContext - Surrounding text
     * @param {string|null} documentContext - Full document
     * @returns {Promise<{reformatted_text: string}>}
     */
    async reformatMarkdown(text, localContext, documentContext = null) {
        return this._call('ReformatMarkdownPredict', {
            text,
            local_context: localContext,
            document_context: documentContext,
        });
    }

    /**
     * Identify the exact phrase to replace when applying a synonym.
     * @param {string} originalWord - The word that was identified
     * @param {string} chosenSynonym - The synonym the user chose
     * @param {string} context - Text surrounding the original word
     * @returns {Promise<{text_to_replace: string, replacement: string}>}
     */
    async identifyReplacement(originalWord, chosenSynonym, context) {
        return this._call('IdentifyReplacementPredict', {
            original_word: originalWord,
            chosen_synonym: chosenSynonym,
            context: context,
        });
    }

    // ===========================================================================
    // Document-Level Operations
    // ===========================================================================

    /**
     * Generate a response to the document (document as prompt).
     * @param {string} document - The full document content
     * @returns {Promise<{response: string}>}
     */
    async documentResponse(document) {
        return this._call('DocumentResponsePredict', {
            document,
        });
    }

    /**
     * Summarize a document.
     * @param {string} document - The document to summarize
     * @returns {Promise<{summary: string}>}
     */
    async documentSummary(document) {
        return this._call('DocumentSummaryPredict', {
            document,
        });
    }

    /**
     * Analyze a document.
     * @param {string} document - The document to analyze
     * @param {string} analysisType - Type: 'structure', 'clarity', 'completeness', 'technical', or 'general'
     * @returns {Promise<{analysis: string}>}
     */
    async documentAnalysis(document, analysisType = 'general') {
        return this._call('DocumentAnalysisPredict', {
            document,
            analysis_type: analysisType,
        });
    }

    // ===========================================================================
    // Notebook Operations
    // ===========================================================================

    /**
     * Generate a descriptive name for a notebook based on its content.
     * @param {string} document - The notebook content to analyze
     * @param {string} currentName - The current filename (may be 'Untitled')
     * @returns {Promise<{name: string}>}
     */
    async suggestNotebookName(document, currentName = 'Untitled') {
        return this._call('NotebookNamePredict', {
            document,
            current_name: currentName,
        });
    }

    // ===========================================================================
    // Generic Program Call
    // ===========================================================================

    /**
     * Call any AI program by name.
     * @param {string} programName - Name of the program (e.g., 'FinishSentencePredict')
     * @param {object} params - Parameters to pass to the program
     * @returns {Promise<object>}
     */
    async callProgram(programName, params) {
        return this._call(programName, params);
    }

    // ===========================================================================
    // Internal
    // ===========================================================================

    async _call(endpoint, params, options = {}) {
        // Send juice level as header (backend can use it to select model)
        const juice = options.juice ?? this._juice;

        // Truncate base64 data in context fields to reduce token usage
        const cleanedParams = truncateBase64InParams(params);

        const response = await fetch(`${this.baseUrl}/${endpoint}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Juice-Level': juice.toString(),
            },
            body: JSON.stringify(cleanedParams),
        });

        if (!response.ok) {
            const error = await response.text();
            throw new Error(`AI call failed: ${response.status} - ${error}`);
        }

        return response.json();
    }

    /**
     * Call an endpoint with SSE streaming for progress updates.
     * @param {string} endpoint - The program name
     * @param {object} params - Parameters for the program
     * @param {object} options - Options including callbacks
     * @param {function} options.onStatus - Called with status updates { step, model, ... }
     * @param {function} options.onModelStart - Called when a model starts (ultimate mode)
     * @param {function} options.onModelComplete - Called when a model completes (ultimate mode)
     * @param {function} options.onError - Called on error
     * @returns {Promise<object>} The final result
     */
    async _callStream(endpoint, params, options = {}) {
        const juice = options.juice ?? this._juice;
        const onStatus = options.onStatus || (() => {});
        const onModelStart = options.onModelStart || (() => {});
        const onModelComplete = options.onModelComplete || (() => {});
        const onError = options.onError || (() => {});

        // Truncate base64 data in context fields to reduce token usage
        const cleanedParams = truncateBase64InParams(params);

        const response = await fetch(`${this.baseUrl}/${endpoint}/stream`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Juice-Level': juice.toString(),
            },
            body: JSON.stringify(cleanedParams),
        });

        if (!response.ok) {
            const error = await response.text();
            throw new Error(`AI stream failed: ${response.status} - ${error}`);
        }

        // Parse SSE stream
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let result = null;

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });

            // Parse complete SSE events from buffer
            const lines = buffer.split('\n');
            buffer = lines.pop(); // Keep incomplete line in buffer

            let currentEvent = null;
            let currentData = '';

            for (const line of lines) {
                if (line.startsWith('event: ')) {
                    currentEvent = line.slice(7).trim();
                } else if (line.startsWith('data: ')) {
                    currentData = line.slice(6);
                } else if (line === '' && currentEvent && currentData) {
                    // End of event - process it
                    try {
                        const data = JSON.parse(currentData);

                        switch (currentEvent) {
                            case 'status':
                                onStatus(data);
                                break;
                            case 'model_start':
                                onModelStart(data);
                                break;
                            case 'model_complete':
                                onModelComplete(data);
                                break;
                            case 'result':
                                result = data;
                                break;
                            case 'error':
                                onError(new Error(data.message || 'Unknown error'));
                                throw new Error(data.message || 'AI stream error');
                        }
                    } catch (e) {
                        if (e.message.includes('AI stream error')) throw e;
                        console.warn('Failed to parse SSE data:', currentData, e);
                    }

                    currentEvent = null;
                    currentData = '';
                }
            }
        }

        if (!result) {
            throw new Error('Stream ended without result');
        }

        return result;
    }

    /**
     * Call a program with optional streaming.
     * @param {string} endpoint - The program name
     * @param {object} params - Parameters for the program
     * @param {object} options - Options
     * @param {boolean} options.stream - Whether to use streaming (default: false)
     * @param {function} options.onStatus - Status callback (streaming only)
     * @param {function} options.onModelStart - Model start callback (streaming only)
     * @param {function} options.onModelComplete - Model complete callback (streaming only)
     * @returns {Promise<object>} The result
     */
    async callWithOptions(endpoint, params, options = {}) {
        if (options.stream) {
            return this._callStream(endpoint, params, options);
        }
        return this._call(endpoint, params, options);
    }
}

// Default client instance (AI server on port 8766)
export const aiClient = new AiClient();

export default AiClient;
