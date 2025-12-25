/**
 * Streaming grep search client for MRMD
 *
 * Uses Server-Sent Events (SSE) to stream ripgrep results in real-time.
 * Results appear as they are found, providing instant feedback.
 */

/**
 * GrepSearch - streaming content search client
 */
export class GrepSearch {
    constructor() {
        this.abortController = null;
        this.reader = null;
    }

    /**
     * Search file contents with streaming results
     * @param {string} query - Search pattern
     * @param {string} root - Root directory to search
     * @param {Function} onMatch - Called for each match: (match) => void
     * @param {Function} onDone - Called when complete: ({ total, truncated }) => void
     * @param {Function} onError - Called on error: (error) => void
     * @param {Object} options - { maxResults, extensions }
     */
    async search(query, root, onMatch, onDone, onError, options = {}) {
        // Cancel any existing search
        this.abort();

        if (!query || query.length < 2) {
            onDone({ total: 0, truncated: false });
            return;
        }

        this.abortController = new AbortController();

        try {
            const response = await fetch('/api/files/grep/stream', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    query,
                    root,
                    max_results: options.maxResults || 50,
                    extensions: options.extensions,
                    case_sensitive: options.caseSensitive || false,
                }),
                signal: this.abortController.signal,
            });

            if (!response.ok) {
                throw new Error(`Search failed: ${response.status}`);
            }

            this.reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';

            while (true) {
                const { done, value } = await this.reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });

                // Parse SSE events line by line
                const lines = buffer.split('\n');
                buffer = lines.pop(); // Keep incomplete line in buffer

                let eventType = '';
                for (const line of lines) {
                    if (line.startsWith('event: ')) {
                        eventType = line.slice(7).trim();
                    } else if (line.startsWith('data: ')) {
                        try {
                            const data = JSON.parse(line.slice(6));
                            if (eventType === 'match') {
                                onMatch(data);
                            } else if (eventType === 'done') {
                                onDone(data);
                            } else if (eventType === 'error') {
                                onError(new Error(data.message || 'Search error'));
                            }
                        } catch (e) {
                            // Skip malformed JSON
                        }
                    }
                }
            }
        } catch (e) {
            if (e.name === 'AbortError') {
                // Search was aborted, ignore
                return;
            }
            onError(e);
        }
    }

    /**
     * Abort any running search
     */
    abort() {
        if (this.abortController) {
            this.abortController.abort();
            this.abortController = null;
        }
        if (this.reader) {
            try {
                this.reader.cancel();
            } catch (e) {
                // Ignore
            }
            this.reader = null;
        }
    }
}

// Export a singleton instance for convenience
export const grepSearch = new GrepSearch();
