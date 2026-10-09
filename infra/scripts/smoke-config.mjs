// Settings for production-smoke.mjs come from the environment, never from the repository.
export function readSmokeConfig(env) {
  const baseURL = env.SMOKE_BASE_URL?.trim().replace(/\/+$/, "");
  if (!baseURL || !/^https?:\/\/[^\s/]+/.test(baseURL))
    throw new Error(
      "Set SMOKE_BASE_URL to the site address, for example https://ledgerline.example.com",
    );
  const email = env.SMOKE_OWNER_EMAIL?.trim();
  const password = env.SMOKE_OWNER_PASSWORD;
  if (email && password)
    return { baseURL, credentials: { kind: "direct", email, password } };
  const target = env.SMOKE_SSH_TARGET?.trim();
  if (!target)
    throw new Error(
      "Set SMOKE_OWNER_EMAIL and SMOKE_OWNER_PASSWORD, or SMOKE_SSH_TARGET to read them from the server",
    );
  return {
    baseURL,
    credentials: {
      kind: "ssh",
      target,
      user: env.SMOKE_DEPLOY_USER?.trim() || "ledgerline",
      envFile: env.SMOKE_ENV_FILE?.trim() || "/opt/ledgerline/.env",
    },
  };
}
