export interface Session {
  userId: string;
  roles: string[];
}

export function loadSession(token: string): Session {
  if (!verifyJwt(token)) {
    throw new Error("invalid token");
  }

  return {
    userId: "user_123",
    roles: ["support"],
  };
}

function verifyJwt(token: string): boolean {
  return token.startsWith("valid.");
}
