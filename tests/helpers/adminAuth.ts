export const TEST_ADMIN_PASSWORD = 'test-admin-password';
process.env.ADMIN_PASSWORD = TEST_ADMIN_PASSWORD;

export async function adminCookieHeader(): Promise<string> {
  const { adminSessionToken } = await import('@/lib/auth');
  return `admin_session=${adminSessionToken()}`;
}
