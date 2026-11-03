import { zodResolver } from "@hookform/resolvers/zod";
import { signInSchema } from "@ledgerline/shared";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import type { z } from "zod";
import { api } from "../../lib/api";
import { TwoFactorChallenge } from "./two-factor-challenge";
import "./auth.css";

/** The mark above each step's heading: the brand's L, or a shield on the code step. */
export function AuthMark({ children }: { children: React.ReactNode }) {
  return (
    <span className="brand-mark au-mark" aria-hidden="true">
      {children}
    </span>
  );
}

/**
 * Sign-in (ADR 0047, the prototype's `R.signin`): one centred card with no marketing half. The mark, the heading,
 * a card with an Email address row and a Password row, and one full-width Sign in. What the subtitle used to say
 * is read aloud only. A password that opens a two-factor account goes on to the code step in the same card.
 */
export function SignIn({ onSuccess }: { onSuccess: () => Promise<void> }) {
  const [error, setError] = useState("");
  const [needsCode, setNeedsCode] = useState(false);
  useEffect(() => {
    document.title = `${needsCode ? "Two-factor code" : "Sign in"} · Ledgerline`;
  }, [needsCode]);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<z.infer<typeof signInSchema>>({
    resolver: zodResolver(signInSchema),
  });
  const submit = handleSubmit(async (values) => {
    setError("");
    try {
      const result = await api<{ twoFactorRedirect?: boolean } | undefined>(
        "/auth/sign-in/email",
        { method: "POST", body: JSON.stringify(values) },
      );
      // Two-factor is on for this account: the password alone does not open a session (ADR 0038).
      if (result?.twoFactorRedirect) return setNeedsCode(true);
      await onSuccess();
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "Unable to sign in.",
      );
    }
  });
  return (
    <main className="au-page" aria-labelledby="sign-in-title">
      <div className="au-box">
        {needsCode ? (
          <TwoFactorChallenge
            onSuccess={onSuccess}
            onBack={() => setNeedsCode(false)}
          />
        ) : (
          <>
            <div className="au-head">
              <AuthMark>
                L<span>↗</span>
              </AuthMark>
              <h1 id="sign-in-title">Welcome back</h1>
            </div>
            <p className="sr-only">Sign in to your personal ledger.</p>
            <form className="au-form" onSubmit={submit} noValidate>
              <div className="au-card">
                <div className="au-block">
                  <div className="au-row">
                    <label htmlFor="email">Email address</label>
                    <input
                      id="email"
                      type="email"
                      autoComplete="username"
                      aria-invalid={!!errors.email}
                      aria-describedby={
                        errors.email ? "email-error" : undefined
                      }
                      {...register("email")}
                    />
                  </div>
                  {errors.email && (
                    <p className="field-error au-err" id="email-error">
                      Enter a valid email address.
                    </p>
                  )}
                </div>
                <div className="au-block">
                  <div className="au-row">
                    <label htmlFor="password">Password</label>
                    <input
                      id="password"
                      type="password"
                      autoComplete="current-password"
                      aria-invalid={!!errors.password}
                      aria-describedby={
                        errors.password ? "password-error" : undefined
                      }
                      {...register("password")}
                    />
                  </div>
                  {errors.password && (
                    <p className="field-error au-err" id="password-error">
                      Use at least 12 characters.
                    </p>
                  )}
                </div>
              </div>
              {error && (
                <p role="alert" className="field-error">
                  {error}
                </p>
              )}
              <button
                type="submit"
                className="ui-btn ui-btn-primary"
                disabled={isSubmitting}
              >
                {isSubmitting ? "Signing in…" : "Sign in"}
              </button>
            </form>
          </>
        )}
      </div>
    </main>
  );
}
