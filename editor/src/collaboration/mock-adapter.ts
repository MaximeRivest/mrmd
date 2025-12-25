/**
 * Mock collaboration adapter using BroadcastChannel
 * Allows testing collaboration between browser tabs without a backend
 */

import type {
  CollabClientAdapter,
  CollabEvents,
  SerializedUpdate,
  RemoteCursor,
  Presence,
  RemoteUser,
} from './types';

type EventHandler<T> = (data: T) => void;

// Colors for users
const USER_COLORS = [
  '#e91e63', '#9c27b0', '#673ab7', '#3f51b5',
  '#2196f3', '#00bcd4', '#009688', '#4caf50',
  '#ff9800', '#ff5722',
];

/**
 * Mock adapter that uses BroadcastChannel for tab-to-tab communication
 * Perfect for testing collaboration without a backend
 */
export class MockCollabAdapter implements CollabClientAdapter {
  private channel: BroadcastChannel | null = null;
  private eventHandlers: Map<string, Set<EventHandler<unknown>>> = new Map();
  private sessionId: string;
  private userName: string;
  private userColor: string;
  private currentFilePath: string | null = null;
  private connected = false;

  constructor(userName?: string) {
    this.sessionId = `mock-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    this.userName = userName || `User-${this.sessionId.slice(-4)}`;
    this.userColor = USER_COLORS[Math.floor(Math.random() * USER_COLORS.length)];
  }

  async connect(projectRoot: string): Promise<void> {
    // Create BroadcastChannel for this project
    const channelName = `mrmd-collab-${projectRoot.replace(/[^a-z0-9]/gi, '-')}`;
    this.channel = new BroadcastChannel(channelName);

    // Listen for messages from other tabs
    this.channel.onmessage = (event) => {
      this.handleMessage(event.data);
    };

    this.connected = true;

    // Emit connect event
    this.emit('connect', {
      sessionId: this.sessionId,
      color: this.userColor,
    });

    // Announce presence
    this.broadcast({
      type: 'user_joined',
      user: {
        sessionId: this.sessionId,
        userName: this.userName,
        userType: 'human',
        color: this.userColor,
      },
    });

    console.log(`[MockCollab] Connected as ${this.userName} (${this.sessionId})`);
  }

  disconnect(): void {
    if (this.channel) {
      // Announce leaving
      this.broadcast({
        type: 'user_left',
        sessionId: this.sessionId,
      });

      this.channel.close();
      this.channel = null;
    }
    this.connected = false;
    this.emit('disconnect', undefined);
  }

  isConnected(): boolean {
    return this.connected;
  }

  getSession(): { sessionId: string; color: string; userName: string } | null {
    if (!this.connected) return null;
    return {
      sessionId: this.sessionId,
      color: this.userColor,
      userName: this.userName,
    };
  }

  joinFile(filePath: string): void {
    this.currentFilePath = filePath;
    this.broadcast({
      type: 'join_file',
      sessionId: this.sessionId,
      filePath,
      user: {
        sessionId: this.sessionId,
        userName: this.userName,
        userType: 'human',
        color: this.userColor,
      },
    });
    console.log(`[MockCollab] Joined file: ${filePath}`);
  }

  leaveFile(): void {
    if (this.currentFilePath) {
      this.broadcast({
        type: 'leave_file',
        sessionId: this.sessionId,
        filePath: this.currentFilePath,
      });
    }
    this.currentFilePath = null;
  }

  sendUpdate(update: SerializedUpdate): void {
    this.broadcast({
      type: 'update',
      ...update,
      sessionId: this.sessionId,
    });
  }

  sendCursor(offset: number, selection?: { anchor: number; head: number }): void {
    console.log(`[MockCollab] Sending cursor:`, offset, selection);
    this.broadcast({
      type: 'cursor',
      sessionId: this.sessionId,
      userName: this.userName,
      color: this.userColor,
      offset,
      selection,
    });
  }

  requestPresence(filePath?: string): void {
    // In a real implementation, server would respond with presence
    // For mock, we just announce ourselves
    this.broadcast({
      type: 'presence_request',
      sessionId: this.sessionId,
      filePath: filePath || this.currentFilePath,
    });
  }

  notifySaved(filePath: string, content: string): void {
    this.broadcast({
      type: 'file_saved',
      sessionId: this.sessionId,
      userName: this.userName,
      filePath,
      content: content.slice(0, 100), // Don't broadcast full content
    });
  }

  on<K extends keyof CollabEvents>(
    event: K,
    handler: EventHandler<CollabEvents[K]>
  ): void {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, new Set());
    }
    this.eventHandlers.get(event)!.add(handler as EventHandler<unknown>);
    console.log(`[MockCollab] Registered handler for '${event}', total: ${this.eventHandlers.get(event)!.size}`);
  }

  off<K extends keyof CollabEvents>(
    event: K,
    handler: EventHandler<CollabEvents[K]>
  ): void {
    this.eventHandlers.get(event)?.delete(handler as EventHandler<unknown>);
  }

  private emit<K extends keyof CollabEvents>(event: K, data: CollabEvents[K]): void {
    const handlers = this.eventHandlers.get(event);
    const count = handlers?.size ?? 0;
    console.log(`[MockCollab] Emitting '${event}' to ${count} handlers`);
    handlers?.forEach(handler => {
      try {
        handler(data);
      } catch (err) {
        console.error(`[MockCollab] Error in event handler for ${event}:`, err);
      }
    });
  }

  private broadcast(message: Record<string, unknown>): void {
    if (this.channel) {
      this.channel.postMessage(message);
    }
  }

  private handleMessage(data: Record<string, unknown>): void {
    // Ignore our own messages
    if (data.sessionId === this.sessionId) return;

    const type = data.type as string;

    switch (type) {
      case 'update':
        this.emit('update', {
          clientId: data.clientId as string || data.sessionId as string,
          changes: data.changes as number[],
          version: data.version as number,
        });
        break;

      case 'cursor':
        console.log(`[MockCollab] Received cursor from ${data.userName}:`, data.offset);
        this.emit('cursor', {
          sessionId: data.sessionId as string,
          userName: data.userName as string || 'Anonymous',
          color: data.color as string || '#888',
          offset: data.offset as number,
          selection: data.selection as { anchor: number; head: number } | undefined,
          lastUpdate: Date.now(),
        });
        break;

      case 'user_joined':
      case 'join_file':
        this.emit('userJoined', {
          user: data.user as RemoteUser,
          filePath: data.filePath as string || '',
        });
        // Respond with our presence
        if (this.currentFilePath) {
          setTimeout(() => {
            this.broadcast({
              type: 'presence_response',
              sessionId: this.sessionId,
              userName: this.userName,
              color: this.userColor,
              filePath: this.currentFilePath,
            });
          }, 100);
        }
        break;

      case 'user_left':
      case 'leave_file':
        this.emit('userLeft', {
          sessionId: data.sessionId as string,
          filePath: data.filePath as string || '',
        });
        break;

      case 'presence_request':
        // Respond with our presence
        if (this.currentFilePath) {
          this.broadcast({
            type: 'presence_response',
            sessionId: this.sessionId,
            userName: this.userName,
            color: this.userColor,
            filePath: this.currentFilePath,
          });
        }
        break;

      case 'presence_response':
        // Could build presence list, for now just emit userJoined
        this.emit('userJoined', {
          user: {
            sessionId: data.sessionId as string,
            userName: data.userName as string,
            userType: 'human',
            color: data.color as string,
          },
          filePath: data.filePath as string,
        });
        break;

      case 'file_saved':
        this.emit('fileSaved', {
          sessionId: data.sessionId as string,
          userName: data.userName as string,
          filePath: data.filePath as string,
          content: data.content as string | undefined,
        });
        break;
    }
  }
}
