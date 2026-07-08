export interface LogoutAdminSessionOptions {
  readonly clearLocalAuth: () => void;
  readonly revokeServerSession: (token: string) => Promise<void>;
}

export async function logoutAdminSession(
  token: string,
  options: LogoutAdminSessionOptions,
): Promise<void> {
  options.clearLocalAuth();
  if (!token) {
    return;
  }
  try {
    await options.revokeServerSession(token);
  } catch {
    // Local logout should still complete if the token was already expired server-side
    // or the network request never reaches the gateway.
  }
}
