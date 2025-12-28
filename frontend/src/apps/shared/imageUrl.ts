/**
 * Image URL Resolution
 *
 * Resolves image URLs in markdown to API endpoints that can serve the files.
 * This handles relative paths, absolute paths, and already-resolved URLs.
 */

/**
 * Create an image URL resolver for a given document base path
 */
export function createImageUrlResolver(getBasePath: () => string) {
    return (url: string): string => {
        // Pass through special URLs
        if (!url ||
            url.startsWith('data:') ||
            url.startsWith('/api/') ||
            url.startsWith('http://') ||
            url.startsWith('https://')) {
            return url;
        }

        // Absolute paths get served via asset endpoint
        if (url.startsWith('/')) {
            return `/api/file/asset${url}`;
        }

        // Relative paths need the document base path
        // Encode the path to prevent browser from resolving ../..
        const basePath = getBasePath();
        if (basePath) {
            return `/api/file/relative?path=${encodeURIComponent(url)}&base=${encodeURIComponent(basePath)}`;
        }

        // Fallback for relative URLs without base path
        console.warn('[imageUrl] No base path for relative URL:', url);
        return `/api/file/asset/${url}`;
    };
}
