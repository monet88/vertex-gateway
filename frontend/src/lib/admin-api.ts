export interface AdminApiOptions {
  readonly token: string;
  readonly baseUrl?: string;
}

export async function adminFetch<T>(path: string, options: AdminApiOptions, init: RequestInit = {}): Promise<T> {
  const headers = new Headers({
    'content-type': 'application/json',
    authorization: `Bearer ${options.token}`,
  });
  new Headers(init.headers).forEach((value, key) => headers.set(key, value));

  const response = await fetch(`${options.baseUrl ?? ''}${path}`, {
    ...init,
    headers,
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    const detail = body ? ` ${body}` : '';
    throw new Error(`Admin API failed: ${response.status} ${response.statusText}${detail}`.trimEnd());
  }

  const text = await response.text();
  return (text ? JSON.parse(text) : {}) as T;
}
