// Which sessions one MCP connection owns, and how a tool call picks one (T029).
//
// Kept out of server.ts so the rules (D1/D3 ambiguity, ownership, the per-connection
// cap, the "closed after idle" memory) can be unit-tested without a browser or a
// server. A connection can only ever resolve ids it owns: another connection's id is
// simply "Unknown session" (AC7).

/** Idle-closed ids remembered per connection, so a late call gets a clear message
 * instead of "Unknown session". Bounded: the oldest are forgotten. */
export const MAX_REMEMBERED_IDLE_CLOSES = 20;

export interface Resolution {
  /** The session to act on; absent means the legacy no-session shared page. */
  sessionId?: string;
  /** Set when the call must be refused: the tool should return it as an isError result. */
  error?: string;
}

export class ConnectionSessions {
  private readonly owned = new Set<string>();
  private readonly closedIdle = new Map<string, string>();
  /** Sessions whose browser is still launching; they already hold a cap slot. */
  private starting = 0;

  constructor(private readonly maxSessions: number) {}

  get size(): number {
    return this.owned.size;
  }

  ids(): string[] {
    return [...this.owned];
  }

  /** Decide which session a call acts on, per D1/D3. */
  resolve(sessionId?: string): Resolution {
    if (sessionId !== undefined) {
      if (this.owned.has(sessionId)) return { sessionId };
      const idle = this.closedIdle.get(sessionId);
      if (idle !== undefined) return { error: `Session ${sessionId} was closed after ${idle} idle` };
      return { error: `Unknown session ${sessionId}` };
    }
    if (this.owned.size === 0) return {};
    if (this.owned.size === 1) return { sessionId: this.ids()[0] };
    return {
      error: `Several sessions are open (${this.ids().join(", ")}) — pass session_id to choose one`,
    };
  }

  /** Reserve a slot for a session about to launch. Returns the refusal text at the cap;
   * otherwise undefined, and the caller must then call add() or cancelReservation(). */
  tryReserve(): string | undefined {
    if (this.owned.size + this.starting >= this.maxSessions) {
      return (
        `Session limit reached: this connection already has ${this.maxSessions} open sessions ` +
        `(MAX_SESSIONS_PER_CONNECTION). Call ui_end_session with a session_id to free one.`
      );
    }
    this.starting++;
    return undefined;
  }

  cancelReservation(): void {
    this.starting = Math.max(0, this.starting - 1);
  }

  /** Complete a reservation: the session now exists and is owned. */
  add(sessionId: string): void {
    this.cancelReservation();
    this.owned.add(sessionId);
  }

  remove(sessionId: string): void {
    this.owned.delete(sessionId);
  }

  /** The idle timer closed this session: free its slot and remember why. */
  markIdleClosed(sessionId: string, idleLabel: string): void {
    this.owned.delete(sessionId);
    this.closedIdle.set(sessionId, idleLabel);
    if (this.closedIdle.size > MAX_REMEMBERED_IDLE_CLOSES) {
      const oldest = this.closedIdle.keys().next().value as string;
      this.closedIdle.delete(oldest);
    }
  }

  /** Release every owned id (the connection closed) and return them. */
  drain(): string[] {
    const ids = this.ids();
    this.owned.clear();
    return ids;
  }
}
