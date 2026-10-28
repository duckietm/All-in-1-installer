/**
 * Where NextAuth's routes live (src/app/cms_api/auth). `/api` belongs to the emulator (Polaris) on this server, so the
 * CMS' own routes are under `/cms_api`. The server side gets it as NextAuth's `basePath`; the browser's `signIn` gets
 * it through `SessionProvider basePath` (next-auth/react would otherwise post to /api/auth).
 */
export const AUTH_BASE_PATH = "/cms_api/auth";
