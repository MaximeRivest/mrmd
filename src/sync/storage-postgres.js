/**
 * Postgres storage backend for the mrmd sync subsystem.
 *
 * Replaces filesystem persistence with Postgres.
 * Used when running mrmd sync in a cloud service (markco.dev).
 *
 * Usage:
 *   import { createPostgresStorage } from 'mrmd';
 *   const storage = createPostgresStorage({ connectionString: '...' });
 *   createServer({ storage });
 *
 * The `documents` table must exist (see schema.sql in markco-services/sync-relay).
 */

import { createHash } from 'crypto';

/**
 * @typedef {Object} PostgresStorageOptions
 * @property {import('pg').Pool} pool - pg Pool instance
 * @property {string} [userId] - User ID (for multi-user cloud mode)
 * @property {string} [project] - Project name (for multi-user cloud mode)
 */

/**
 * @typedef {Object} StorageBackend
 * @property {function(string): Promise<{content: string|null, yjsState: Uint8Array|null}>} load
 * @property {function(string, string, Uint8Array): Promise<void>} save
 * @property {function(string): Promise<void>} flush - same as save but called on shutdown
 * @property {function(): Promise<void>} close
 * @property {'postgres'} type
 */

/**
 * Create a Postgres storage backend.
 *
 * In multi-user cloud mode, userId and project are provided by the
 * sync-relay service wrapper and used to scope documents.
 *
 * In single-user mode (e.g., desktop with cloud sync), the docName
 * itself carries the full path and userId/project can be extracted.
 *
 * @param {PostgresStorageOptions} opts
 * @returns {StorageBackend}
 */
export function createPostgresStorage(opts) {
  const { pool, userId, project } = opts;

  /**
   * Parse a docName into user/project/path components.
   * Supports two formats:
   *   - Cloud multi-user: docName is just the doc path, userId/project from opts
   *   - Direct: docName is "userId/project/docPath" (all-in-one)
   */
  function parseDocName(docName) {
    if (userId && project) {
      return { userId, project, docPath: docName };
    }
    // Try to parse userId/project/docPath from the docName
    const parts = docName.split('/');
    if (parts.length >= 3) {
      return {
        userId: parts[0],
        project: parts[1],
        docPath: parts.slice(2).join('/'),
      };
    }
    // Fallback: use docName as-is with placeholder user/project
    return { userId: 'local', project: 'default', docPath: docName };
  }

  return {
    type: 'postgres',

    /**
     * Load a document's Yjs state and text content from Postgres.
     */
    async load(docName) {
      const { userId: uid, project: proj, docPath } = parseDocName(docName);

      try {
        const { rows } = await pool.query(
          `SELECT yjs_state, content_text FROM documents
           WHERE user_id = $1 AND project = $2 AND doc_path = $3`,
          [uid, proj, docPath]
        );

        if (rows.length === 0) {
          return { content: null, yjsState: null };
        }

        return {
          content: rows[0].content_text,
          yjsState: rows[0].yjs_state ? new Uint8Array(rows[0].yjs_state) : null,
        };
      } catch (err) {
        console.error(`[storage-postgres] Load error for ${docName}:`, err.message);
        return { content: null, yjsState: null };
      }
    },

    /**
     * Save a document's Yjs state and text content to Postgres.
     */
    async save(docName, content, yjsState) {
      const { userId: uid, project: proj, docPath } = parseDocName(docName);
      const hash = createHash('md5').update(content || '').digest('hex');
      const byteSize = yjsState ? yjsState.byteLength : 0;

      try {
        await pool.query(
          `INSERT INTO documents (user_id, project, doc_path, yjs_state, content_text, content_hash, byte_size, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
           ON CONFLICT (user_id, project, doc_path)
           DO UPDATE SET yjs_state = $4, content_text = $5, content_hash = $6, byte_size = $7, updated_at = NOW()`,
          [uid, proj, docPath, Buffer.from(yjsState), content, hash, byteSize]
        );
      } catch (err) {
        console.error(`[storage-postgres] Save error for ${docName}:`, err.message);
        throw err;
      }
    },

    /**
     * List documents for a user/project.
     */
    async list(filterUserId, filterProject) {
      const uid = filterUserId || userId;
      const proj = filterProject || project;

      let query, params;
      if (uid && proj) {
        query = `SELECT doc_path, content_hash, byte_size, updated_at FROM documents WHERE user_id = $1 AND project = $2 ORDER BY doc_path`;
        params = [uid, proj];
      } else if (uid) {
        query = `SELECT project, doc_path, content_hash, byte_size, updated_at FROM documents WHERE user_id = $1 ORDER BY project, doc_path`;
        params = [uid];
      } else {
        return [];
      }

      const { rows } = await pool.query(query, params);
      return rows;
    },

    async close() {
      // Don't close the pool — it may be shared
    },
  };
}

export default { createPostgresStorage };
