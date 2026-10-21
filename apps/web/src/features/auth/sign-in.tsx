import { zodResolver } from "@hookform/resolvers/zod";
import { signInSchema } from "@ledgerline/shared";
import { Button } from "@ledgerline/ui";
import { ArrowRight, LockKeyhole } from "lucide-react";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import type { z } from "zod";
import { api } from "../../lib/api";
import { TwoFactorChallenge } from "./two-factor-challenge";

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
    <main className="sign-in-layout">
      <div className="sign-in-intro">
        <a className="brand" href="/">
          <span className="brand-mark">
            L<span>↗</span>
          </span>
          Ledgerline
        </a>
        <div>
          <p className="eyebrow">A LITTLE CLARITY, EVERY DAY</p>
          <h1>
            Your money.
            <br />
            Your own space.
          </h1>
          <p className="intro-copy">
            A quiet place to keep track of what comes in, what goes out, and
            what comes next.
          </p>
        </div>
        <p className="private-note">
          <LockKeyhole size={16} /> Private by design. Yours to keep.
        </p>
      </div>
      <section className="sign-in-card" aria-labelledby="sign-in-title">
        {needsCode ? (
          <TwoFactorChallenge
            onSuccess={onSuccess}
            onBack={() => setNeedsCode(false)}
          />
        ) : (
          <>
            <div className="small-mark">
              <LockKeyhole size={24} />
            </div>
            <h2 id="sign-in-title">Welcome back</h2>
            <p className="muted">Sign in to your personal ledger.</p>
            <form onSubmit={submit} noValidate>
              <label htmlFor="email">Email address</label>
              <input
                id="email"
                type="email"
                autoComplete="username"
                aria-invalid={!!errors.email}
                aria-describedby={errors.email ? "email-error" : undefined}
                {...register("email")}
              />
              {errors.email && (
                <p className="field-error" id="email-error">
                  Enter a valid email address.
                </p>
              )}
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
              {errors.password && (
                <p className="field-error" id="password-error">
                  Use at least 12 characters.
                </p>
              )}
              {error && (
                <p role="alert" className="field-error">
                  {error}
                </p>
              )}
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? "Signing in…" : "Sign in"}
                <ArrowRight size={18} />
              </Button>
            </form>
          </>
        )}
        <p className="sign-in-footnote">Your ledger is only open to you.</p>
      </section>
    </main>
  );
}
