export function deploymentConfig(env = process.env) {
  const required = name => {
    const value = String(env[name] ?? '').trim();
    if (!value) throw new Error(name + ' is required');
    return value;
  };
  const publicUrl = env.PUBLIC_ORIGIN || env.RENDER_EXTERNAL_URL || required('PUBLIC_ORIGIN');
  const parsed = new URL(publicUrl);
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== '/') {
    throw new Error('PUBLIC_ORIGIN must be an HTTPS origin without a path');
  }
  const inviteCode = required('CANTOBRIDGE_INVITE_CODE');
  if (inviteCode.length < 16) throw new Error('CANTOBRIDGE_INVITE_CODE must contain at least 16 characters');
  const port = Number(env.PORT ?? 10000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT');
  const maxAccounts = Number(env.CANTOBRIDGE_MAX_ACCOUNTS ?? 50);
  if (!Number.isInteger(maxAccounts) || maxAccounts < 2 || maxAccounts > 500) throw new Error('Invalid account limit');
  return {
    port, origin: parsed.origin, inviteCode, maxAccounts,
    supabaseUrl: required('SUPABASE_URL'), supabaseKey: required('SUPABASE_SECRET_KEY'),
    turnKeyId: required('CLOUDFLARE_TURN_KEY_ID'), turnApiToken: required('CLOUDFLARE_TURN_API_TOKEN'),
    trustProxy: env.RENDER === 'true',
  };
}
