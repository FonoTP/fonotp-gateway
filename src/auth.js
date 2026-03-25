export class AuthError extends Error {
  constructor(message, statusCode = 401) {
    super(message);
    this.name = "AuthError";
    this.statusCode = statusCode;
  }
}

export function extractBearerToken(request, bearerPrefix) {
  const authorization = request.headers.authorization;
  if (!authorization) {
    throw new AuthError("Missing Authorization header");
  }

  const [scheme, token] = authorization.split(" ");
  if (scheme !== bearerPrefix || !token) {
    throw new AuthError("Invalid Authorization header");
  }

  return token.trim();
}

export async function requireAuthorizedServiceSession(request, db, config) {
  const token = extractBearerToken(request, config.authBearerPrefix);
  const sessions = await db.getAuthorizedSession(token);

  if (sessions.length === 0) {
    throw new AuthError("Session not found or not authorized");
  }

  return sessions;
}
