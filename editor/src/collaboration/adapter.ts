import type {
  CollabClientAdapter,
  CollabEvents,
  SerializedUpdate,
  RemoteCursor,
  Presence,
  RemoteUser,
} from './types';

type EventHandler<T> = (data: T) => void;

/**
 * Adapter that wraps the existing collab-client.js
 * Converts between the old JS API and new TypeScript interface
 */
export class CollabClientJSAdapter implements CollabClientAdapter {
  private client: LegacyCollabClient;
  private eventHandlers: Map<string, Set<EventHandler<unknown>>> = new Map();
  private currentFilePath: string | null = null;

  constructor(legacyClient: LegacyCollabClient) {
    this.client = legacyClient;
    this.setupLegacyHandlers();
  }

  /**
   * Create adapter from existing collab-client instance
   */
  static fromLegacy(client: LegacyCollabClient): CollabClientJSAdapter {
    return new CollabClientJSAdapter(client);
  }

  private setupLegacyHandlers(): void {
    // Map legacy callbacks to our event system
    // Note: The legacy client uses callback props, so we need to wrap them

    // We'll set up listeners when needed - the legacy client
    // may already have handlers set, so we emit through our system
  }

  async connect(projectRoot: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const originalOnConnect = this.client.onConnect;

      this.client.onConnect = (data: { sessionId: string; color: string }) => {
        this.emit('connect', data);
        originalOnConnect?.(data);
        resolve();
      };

      try {
        this.client.connect(projectRoot);
      } catch (err) {
        reject(err);
      }

      // Timeout after 10s
      setTimeout(() => reject(new Error('Connection timeout')), 10000);
    });
  }

  disconnect(): void {
    this.client.disconnect();
    this.emit('disconnect', undefined);
  }

  isConnected(): boolean {
    return this.client.isConnected();
  }

  getSession(): { sessionId: string; color: string; userName: string } | null {
    const session = this.client.getSession();
    if (!session?.sessionId) return null;

    return {
      sessionId: session.sessionId,
      color: session.color || '#888',
      userName: session.userName || 'Anonymous',
    };
  }

  joinFile(filePath: string): void {
    this.currentFilePath = filePath;
    this.client.joinFile(filePath);
  }

  leaveFile(): void {
    this.currentFilePath = null;
    this.client.leaveFile();
  }

  sendUpdate(update: SerializedUpdate): void {
    if (!this.currentFilePath) return;

    // Send as operation through legacy client
    this.client.sendOperation(
      this.currentFilePath,
      'cm6_update',  // Operation type
      {
        clientId: update.clientId,
        changes: Array.from(update.changes),
        version: update.version,
      },
      String(update.version)
    );
  }

  sendCursor(offset: number, selection?: { anchor: number; head: number }): void {
    this.client.sendCursor(offset, selection ? {
      mdStart: selection.anchor,
      mdEnd: selection.head,
    } : null);
  }

  requestPresence(filePath?: string): void {
    this.client.getPresence(filePath || this.currentFilePath || undefined);
  }

  notifySaved(filePath: string, content: string): void {
    this.client.notifyFileSaved(filePath, Date.now().toString(), content);
  }

  on<K extends keyof CollabEvents>(
    event: K,
    handler: EventHandler<CollabEvents[K]>
  ): void {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, new Set());
      this.setupLegacyHandler(event);
    }
    this.eventHandlers.get(event)!.add(handler as EventHandler<unknown>);
  }

  off<K extends keyof CollabEvents>(
    event: K,
    handler: EventHandler<CollabEvents[K]>
  ): void {
    this.eventHandlers.get(event)?.delete(handler as EventHandler<unknown>);
  }

  private emit<K extends keyof CollabEvents>(event: K, data: CollabEvents[K]): void {
    this.eventHandlers.get(event)?.forEach(handler => {
      try {
        handler(data);
      } catch (err) {
        console.error(`Error in collab event handler for ${event}:`, err);
      }
    });
  }

  /**
   * Set up legacy client handler for specific event type
   */
  private setupLegacyHandler(event: keyof CollabEvents): void {
    switch (event) {
      case 'connect':
        // Already handled in connect()
        break;

      case 'disconnect':
        this.client.onDisconnect = () => {
          this.emit('disconnect', undefined);
        };
        break;

      case 'update':
        this.client.onOperation = (data: LegacyOperation) => {
          if (data.opType === 'cm6_update' && data.data) {
            this.emit('update', {
              clientId: data.data.clientId || data.sessionId,
              changes: data.data.changes,
              version: data.data.version,
            } as SerializedUpdate);
          }
        };
        break;

      case 'cursor':
        this.client.onCursor = (data: LegacyCursor) => {
          this.emit('cursor', {
            sessionId: data.sessionId,
            userName: data.userName || 'Anonymous',
            color: data.color || '#888',
            offset: data.mdOffset,
            selection: data.selection ? {
              anchor: data.selection.mdStart,
              head: data.selection.mdEnd,
            } : undefined,
            lastUpdate: Date.now(),
          } as RemoteCursor);
        };
        break;

      case 'presence':
        this.client.onPresence = (data: LegacyPresence) => {
          this.emit('presence', {
            filePath: data.filePath,
            users: data.users.map((u: LegacyUser) => ({
              sessionId: u.sessionId || u.session_id,
              userName: u.userName || u.user_name || 'Anonymous',
              userType: (u.userType || u.user_type || 'human') as 'human' | 'ai',
              color: u.color || '#888',
            })),
          } as Presence);
        };
        break;

      case 'userJoined':
        this.client.onUserJoined = (data: { user: LegacyUser; filePath: string }) => {
          this.emit('userJoined', {
            user: {
              sessionId: data.user.sessionId || data.user.session_id || 'unknown',
              userName: data.user.userName || data.user.user_name || 'Anonymous',
              userType: (data.user.userType || data.user.user_type || 'human') as 'human' | 'ai',
              color: data.user.color || '#888',
            },
            filePath: data.filePath,
          });
        };
        break;

      case 'userLeft':
        this.client.onUserLeft = (data: { sessionId: string; filePath: string }) => {
          this.emit('userLeft', data);
        };
        break;

      case 'fileSaved':
        this.client.onFileSaved = (data: LegacyFileSaved) => {
          this.emit('fileSaved', {
            sessionId: data.sessionId,
            userName: data.userName || 'Anonymous',
            filePath: data.filePath,
            content: data.content,
          });
        };
        break;

      case 'fileChanged':
        this.client.onFileChanged = (data: LegacyFileChanged) => {
          this.emit('fileChanged', {
            filePath: data.filePath,
            eventType: data.eventType as 'modified' | 'created' | 'deleted',
            mtime: data.mtime,
          });
        };
        break;
    }
  }
}

// Legacy type definitions (matching collab-client.js)
interface LegacyCollabClient {
  connect(projectRoot: string): void;
  disconnect(): void;
  isConnected(): boolean;
  getSession(): { sessionId: string; color: string; userName: string; userType: string } | null;
  joinFile(filePath: string): void;
  leaveFile(): void;
  sendCursor(mdOffset: number, selection: { mdStart: number; mdEnd: number } | null): void;
  sendOperation(filePath: string, opType: string, data: unknown, versionId?: string): void;
  notifyFileSaved(filePath: string, versionId: string, content?: string): void;
  getPresence(filePath?: string): void;

  // Callback handlers (set by adapter)
  onConnect?: (data: { sessionId: string; color: string }) => void;
  onDisconnect?: () => void;
  onOperation?: (data: LegacyOperation) => void;
  onCursor?: (data: LegacyCursor) => void;
  onPresence?: (data: LegacyPresence) => void;
  onUserJoined?: (data: { user: LegacyUser; filePath: string }) => void;
  onUserLeft?: (data: { sessionId: string; filePath: string }) => void;
  onFileSaved?: (data: LegacyFileSaved) => void;
  onFileChanged?: (data: LegacyFileChanged) => void;
}

interface LegacyOperation {
  sessionId: string;
  userName?: string;
  filePath: string;
  opType: string;
  data: {
    clientId?: string;
    changes: number[];
    version: number;
  };
  versionId?: string;
  timestamp?: number;
}

interface LegacyCursor {
  sessionId: string;
  userName?: string;
  color?: string;
  mdOffset: number;
  selection?: { mdStart: number; mdEnd: number };
}

interface LegacyPresence {
  filePath: string;
  project?: string;
  users: LegacyUser[];
}

interface LegacyUser {
  sessionId?: string;
  session_id?: string;
  userName?: string;
  user_name?: string;
  userType?: string;
  user_type?: string;
  color?: string;
}

interface LegacyFileSaved {
  sessionId: string;
  userName?: string;
  filePath: string;
  versionId?: string;
  content?: string;
  timestamp?: number;
}

interface LegacyFileChanged {
  filePath: string;
  eventType: string;
  mtime: number;
}

// Export the legacy client type for users who need to create one
export type { LegacyCollabClient };
