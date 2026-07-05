export interface AdminApiOptions {
  readonly token: string;
  readonly baseUrl?: string;
}

export async function adminFetch<T>(path: string, options: AdminApiOptions, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${options.baseUrl ?? ''}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${options.token}`,
      ...init.headers,
    },
  });

  if (!response.ok) {
    throw new Error(`Admin API failed: ${response.status}`);
  }

  return response.json() as Promise<T>;
}
