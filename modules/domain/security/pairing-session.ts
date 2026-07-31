export interface PairingSession {
  pairingCode: string;
  expiresAt: string;
  consumedAt?: string;
  disabled?: boolean;
}

export function isPairingSessionUsable(session: PairingSession, now: Date): boolean {
  if (session.disabled || session.consumedAt) {
    return false;
  }

  return new Date(session.expiresAt).getTime() > now.getTime();
}

export function consumePairingSession(session: PairingSession, consumedAt: Date): PairingSession {
  if (!isPairingSessionUsable(session, consumedAt)) {
    return session;
  }

  return { ...session, consumedAt: consumedAt.toISOString() };
}
