// Adaptação do verificador AraRead (MIT); sem herdar claims específicos do produto.
import {createRemoteJWKSet, jwtVerify} from 'jose';
import {z} from 'zod';
import {config} from './config.ts';
import {AppError, ensure} from './errors.ts';
import type {Identity} from './contracts.ts';
const jwks = createRemoteJWKSet(new URL(`${config.authUrl}/.well-known/jwks.json`));
export async function authenticate(header: string | undefined, mcp = false): Promise<Identity> {
  ensure(header?.startsWith('Bearer '), 'UNAUTHENTICATED', 'Entre na conta.', 401);
  const token = header!.slice(7);
  ensure(token.length < 12000, 'UNAUTHENTICATED', 'Token inválido.', 401);
  try {
    const {payload} = await jwtVerify(token, jwks, {issuer: config.issuer, audience: 'authenticated', algorithms: ['ES256', 'RS256']});
    ensure(z.uuid().safeParse(payload.sub).success && z.uuid().safeParse(payload.session_id).success && payload.role === 'authenticated', 'UNAUTHENTICATED', 'Sessão inválida.', 401);
    if (mcp) ensure(z.uuid().safeParse(payload.client_id).success, 'FORBIDDEN', 'Autorize um cliente OAuth para o Um.', 403);
    return {id: payload.sub!, sessionId: String(payload.session_id), clientId: payload.client_id ? String(payload.client_id) : undefined, permission: 'write'};
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError('UNAUTHENTICATED', 'Sessão inválida ou expirada.', 401);
  }
}
