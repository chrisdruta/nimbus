/**
 * Minimal ambient types for the Google Cast SDKs — only the surface
 * nimbus touches. Hand-rolled because the official packages
 * (@types/chromecast-caf-sender and @types/chromecast-caf-receiver) both
 * declare the global `cast.framework` namespace and cannot coexist,
 * while the sender (app bundle) and receiver (/cast page) share this
 * compilation unit. The globals only exist after the respective SDK
 * script loads — always reach them through `window` lookups at runtime.
 */

interface Window {
  /** Sender SDK readiness callback; set before injecting cast_sender.js. */
  __onGCastApiAvailable?: (available: boolean) => void;
}

declare namespace chrome.cast {
  const AutoJoinPolicy: {
    ORIGIN_SCOPED: string;
    TAB_AND_ORIGIN_SCOPED: string;
    PAGE_SCOPED: string;
  };
}

declare namespace cast.framework {
  // ------------------------------------------------------------- sender
  const CastContextEventType: {
    CAST_STATE_CHANGED: string;
    SESSION_STATE_CHANGED: string;
  };
  const CastState: {
    NO_DEVICES_AVAILABLE: string;
    NOT_CONNECTED: string;
    CONNECTING: string;
    CONNECTED: string;
  };
  const SessionState: {
    SESSION_STARTED: string;
    SESSION_RESUMED: string;
    SESSION_ENDED: string;
  };
  const RemotePlayerEventType: {
    VOLUME_LEVEL_CHANGED: string;
  };

  interface CastDevice {
    friendlyName: string;
  }

  class CastSession {
    /** Custom-namespace messages arrive JSON-stringified on the sender. */
    addMessageListener(
      namespace: string,
      listener: (namespace: string, message: string) => void,
    ): void;
    removeMessageListener(
      namespace: string,
      listener: (namespace: string, message: string) => void,
    ): void;
    sendMessage(namespace: string, message: unknown): Promise<void>;
    getCastDevice(): CastDevice;
  }

  interface CastStateEventData {
    castState: string;
  }
  interface SessionStateEventData {
    session: CastSession;
    sessionState: string;
  }

  class CastContext {
    static getInstance(): CastContext;
    setOptions(options: {
      receiverApplicationId: string;
      autoJoinPolicy?: string;
    }): void;
    addEventListener(
      type: string,
      handler: (event: CastStateEventData & SessionStateEventData) => void,
    ): void;
    removeEventListener(
      type: string,
      handler: (event: CastStateEventData & SessionStateEventData) => void,
    ): void;
    getCastState(): string;
    getCurrentSession(): CastSession | null;
    requestSession(): Promise<string>;
    endCurrentSession(stopCasting: boolean): void;
  }

  class RemotePlayer {
    volumeLevel: number;
  }
  class RemotePlayerController {
    constructor(player: RemotePlayer);
    addEventListener(type: string, handler: () => void): void;
    setVolumeLevel(): void;
  }

  // ----------------------------------------------------------- receiver
  namespace system {
    const MessageType: {
      JSON: string;
      STRING: string;
    };
  }

  interface CustomMessageEvent {
    senderId: string;
    /** Parsed object for namespaces registered as MessageType.JSON. */
    data: unknown;
  }

  class CastReceiverContext {
    static getInstance(): CastReceiverContext;
    addCustomMessageListener(
      namespace: string,
      listener: (event: CustomMessageEvent) => void,
    ): void;
    /** senderId undefined = broadcast to all connected senders. */
    sendCustomMessage(
      namespace: string,
      senderId: string | undefined,
      message: unknown,
    ): void;
    start(options?: {
      disableIdleTimeout?: boolean;
      customNamespaces?: Record<string, string>;
    }): void;
  }
}
