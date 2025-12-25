import { ChangeSet } from '@codemirror/state';
import type { Text } from '@codemirror/state';

/**
 * A collaborative update - represents changes from one version to another
 */
export interface CollabUpdate {
  /** Client ID that produced this update */
  clientId: string;
  /** Changes to apply */
  changes: ChangeSet;
  /** Starting version this update is based on */
  version: number;
}

/**
 * Serialized form of an update for transmission
 */
export interface SerializedUpdate {
  clientId: string;
  changes: readonly number[];  // ChangeSet serialized
  version: number;
}

/**
 * Remote user cursor information
 */
export interface RemoteCursor {
  /** User session ID */
  sessionId: string;
  /** User display name */
  userName: string;
  /** User color (hex) */
  color: string;
  /** Cursor position (character offset in document) */
  offset: number;
  /** Selection range, if any */
  selection?: {
    anchor: number;
    head: number;
  };
  /** Timestamp of last update */
  lastUpdate: number;
}

/**
 * Presence information for a file
 */
export interface Presence {
  filePath: string;
  users: RemoteUser[];
}

/**
 * A remote user in the collaboration session
 */
export interface RemoteUser {
  sessionId: string;
  userName: string;
  userType: 'human' | 'ai';
  color: string;
}

/**
 * Events emitted by the collaboration system
 */
export interface CollabEvents {
  /** Connection established */
  connect: { sessionId: string; color: string };
  /** Connection lost */
  disconnect: void;
  /** Received remote update */
  update: SerializedUpdate;
  /** Received cursor update */
  cursor: RemoteCursor;
  /** Presence changed */
  presence: Presence;
  /** User joined file */
  userJoined: { user: RemoteUser; filePath: string };
  /** User left file */
  userLeft: { sessionId: string; filePath: string };
  /** File was saved by another user */
  fileSaved: { sessionId: string; userName: string; filePath: string; content?: string };
  /** File changed externally (outside editor) */
  fileChanged: { filePath: string; eventType: 'modified' | 'created' | 'deleted'; mtime: number };
}

/**
 * Interface for collaboration client adapters
 * Abstracts the underlying transport (WebSocket, etc.)
 */
export interface CollabClientAdapter {
  /** Connect to collaboration server */
  connect(projectRoot: string): Promise<void>;

  /** Disconnect from server */
  disconnect(): void;

  /** Check if connected */
  isConnected(): boolean;

  /** Get current session info */
  getSession(): { sessionId: string; color: string; userName: string } | null;

  /** Join a file for editing */
  joinFile(filePath: string): void;

  /** Leave current file */
  leaveFile(): void;

  /** Send document update to server */
  sendUpdate(update: SerializedUpdate): void;

  /** Send cursor position */
  sendCursor(offset: number, selection?: { anchor: number; head: number }): void;

  /** Request presence info for file */
  requestPresence(filePath?: string): void;

  /** Notify that file was saved */
  notifySaved(filePath: string, content: string): void;

  /** Register event listener */
  on<K extends keyof CollabEvents>(event: K, handler: (data: CollabEvents[K]) => void): void;

  /** Remove event listener */
  off<K extends keyof CollabEvents>(event: K, handler: (data: CollabEvents[K]) => void): void;
}

/**
 * Configuration for collaboration
 */
export interface CollabConfig {
  /** The collaboration client adapter */
  adapter: CollabClientAdapter;

  /** Current user ID */
  userId: string;

  /** Current user display name */
  userName?: string;

  /** User color (hex) - will be assigned by server if not provided */
  userColor?: string;

  /** File path being edited */
  filePath: string;

  /** Starting version (for reconnection) */
  startVersion?: number;

  /** Callback when remote updates are received */
  onRemoteUpdate?: (update: SerializedUpdate) => void;

  /** Callback when presence changes */
  onPresenceChange?: (presence: Presence) => void;

  /** Cursor update throttle in ms (default: 50) */
  cursorThrottleMs?: number;
}

/**
 * Utility to serialize a ChangeSet for transmission
 */
export function serializeChanges(changes: ChangeSet): readonly number[] {
  const result: number[] = [];
  changes.iterChanges((fromA, toA, fromB, toB, inserted) => {
    result.push(fromA, toA, fromB, toB);
    // Encode inserted text - length followed by char codes
    const text = inserted.toString();
    result.push(text.length);
    for (let i = 0; i < text.length; i++) {
      result.push(text.charCodeAt(i));
    }
  });
  return result;
}

/**
 * Utility to deserialize a ChangeSet from transmission
 */
export function deserializeChanges(data: readonly number[], docLength: number): ChangeSet {
  const changes: { from: number; to: number; insert: string }[] = [];
  let i = 0;

  while (i < data.length) {
    const fromA = data[i++];
    const toA = data[i++];
    const fromB = data[i++];
    const toB = data[i++];
    const textLen = data[i++];

    let insert = '';
    for (let j = 0; j < textLen; j++) {
      insert += String.fromCharCode(data[i++]);
    }

    changes.push({ from: fromA, to: toA, insert });
  }

  return ChangeSet.of(changes, docLength);
}
