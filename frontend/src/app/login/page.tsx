"use client";

import { ArrowLeft, ArrowRight, Check } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";

import { VOLTAURAMark } from "@/components/brand/mark";
import { useAuth, type OtpChallenge } from "@/components/providers/auth";
import { Button, ErrorState } from "@/components/ui/primitives";
import { ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";

/**
 * Sign in.
 *
 * Two steps, one screen. Step one proves who you claim to be; step two proves
 * you can read that inbox. Nothing is issued until the second step passes, so
 * the address itself is the credential and there is no password to leak.
 */
export default function LoginPage() {
  const router = useRouter();
  const { user, loading, requestOtp, verifyOtp } = useAuth();

  const [step, setStep] = React.useState<"email" | "code">("email");
  const [email, setEmail] = React.useState("");
  const [challenge, setChallenge] = React.useState<OtpChallenge | null>(null);
  const [digits, setDigits] = React.useState<string[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);
  const [secondsLeft, setSecondsLeft] = React.useState(0);
  const [resendIn, setResendIn] = React.useState(0);

  const inputsRef = React.useRef<Array<HTMLInputElement | null>>([]);
  const codeLength = challenge?.code_length ?? 6;

  // Already signed in: skip the form entirely.
  React.useEffect(() => {
    if (!loading && user) router.replace("/dashboard");
  }, [loading, user, router]);

  // Expiry and resend countdowns.
  React.useEffect(() => {
    if (step !== "code") return;
    const timer = setInterval(() => {
      setSecondsLeft((s) => (s > 0 ? s - 1 : 0));
      setResendIn((s) => (s > 0 ? s - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, [step]);

  const failure = (err: unknown): string =>
    err instanceof ApiError ? err.message : "Something went wrong. Try again.";

  // ---- step 1: send the code ------------------------------------------
  const sendCode = async (resend = false) => {
    setError(null);
    setPending(true);
    try {
      const next = await requestOtp(email.trim());
      setChallenge(next);
      setDigits(Array(next.code_length).fill(""));
      setSecondsLeft(next.expires_in_seconds);
      setResendIn(next.resend_after_seconds);
      setStep("code");
      if (!resend) setTimeout(() => inputsRef.current[0]?.focus(), 30);
    } catch (err) {
      setError(failure(err));
    } finally {
      setPending(false);
    }
  };

  // ---- step 2: verify --------------------------------------------------
  const submitCode = async (code: string) => {
    setError(null);
    setPending(true);
    try {
      await verifyOtp(email.trim(), code);
      router.replace("/dashboard");
    } catch (err) {
      setError(failure(err));
      setDigits(Array(codeLength).fill(""));
      inputsRef.current[0]?.focus();
    } finally {
      setPending(false);
    }
  };

  const setDigit = (index: number, value: string) => {
    const clean = value.replace(/\D/g, "");
    if (!clean) {
      setDigits((prev) => prev.map((d, i) => (i === index ? "" : d)));
      return;
    }
    // Pasting the whole code into any box fills the row.
    const next = [...digits];
    for (let i = 0; i < clean.length && index + i < codeLength; i += 1) {
      next[index + i] = clean[i];
    }
    setDigits(next);
    const landed = Math.min(index + clean.length, codeLength - 1);
    inputsRef.current[landed]?.focus();
    const joined = next.join("");
    if (joined.length === codeLength && !joined.includes("")) void submitCode(joined);
  };

  const onKeyDown = (index: number, event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Backspace" && !digits[index] && index > 0) {
      inputsRef.current[index - 1]?.focus();
    }
    if (event.key === "ArrowLeft" && index > 0) inputsRef.current[index - 1]?.focus();
    if (event.key === "ArrowRight" && index < codeLength - 1) {
      inputsRef.current[index + 1]?.focus();
    }
  };

  const mmss = (total: number) =>
    `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;

  return (
    <main className="relative flex min-h-screen items-center justify-center px-5 py-12">
      <div className="w-full max-w-[392px]">
        {/* ---- brand ---- */}
        <div className="flex items-center gap-2.5">
          <VOLTAURAMark className="size-[26px]" />
          <div>
            <div className="text-[15px] font-semibold tracking-[-0.01em] text-ink">
              VOLTAURA
            </div>
            <div className="mt-0.5 text-[9px] uppercase tracking-[0.18em] text-ink-faint">
              AI-Powered Digital Twin
            </div>
          </div>
        </div>

        {step === "email" ? (
          <form
            className="mt-9"
            onSubmit={(event) => {
              event.preventDefault();
              void sendCode();
            }}
          >
            <div className="label">Sign in</div>
            <h1 className="mt-2.5 text-[24px] font-semibold leading-tight tracking-[-0.03em] text-ink">
              Verify your email
            </h1>
            <p className="mt-2.5 text-[12.5px] leading-relaxed text-ink-muted">
              We send a {codeLength}-digit code to your registered address. There
              is no password to remember or leak.
            </p>

            <label htmlFor="email" className="label mt-7 block">
              Email address
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              autoFocus
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@ritindia.edu"
              className="mt-2 w-full rounded border border-[rgb(var(--line)/0.16)] bg-canvas px-3 py-2.5 text-[13.5px] text-ink transition-colors placeholder:text-ink-faint focus:border-mint/60 focus:outline-none"
            />

            {error ? (
              <div className="mt-4">
                <ErrorState error={{ message: error }} compact />
              </div>
            ) : null}

            <Button
              type="submit"
              variant="primary"
              size="lg"
              className="mt-5 w-full"
              loading={pending}
              disabled={!email.trim()}
            >
              Send verification code <ArrowRight />
            </Button>
          </form>
        ) : (
          <div className="mt-9">
            <button
              onClick={() => {
                setStep("email");
                setError(null);
              }}
              className="inline-flex items-center gap-1.5 text-[11.5px] text-ink-muted transition-colors hover:text-ink-soft"
            >
              <ArrowLeft className="size-3" /> Change email
            </button>

            <div className="label mt-4">Step 2 of 2</div>
            <h1 className="mt-2.5 text-[24px] font-semibold leading-tight tracking-[-0.03em] text-ink">
              Enter your code
            </h1>
            <p className="mt-2.5 text-[12.5px] leading-relaxed text-ink-muted">
              Sent to{" "}
              <span className="num text-ink-soft">{challenge?.email}</span>. It
              expires in{" "}
              <span className="num text-ink-soft">{mmss(secondsLeft)}</span> and
              can be used once.
            </p>

            {/* ---- code entry ---- */}
            <div className="mt-6 flex gap-2">
              {Array.from({ length: codeLength }).map((_, index) => (
                <input
                  key={index}
                  ref={(el) => {
                    inputsRef.current[index] = el;
                  }}
                  inputMode="numeric"
                  autoComplete={index === 0 ? "one-time-code" : "off"}
                  maxLength={codeLength}
                  value={digits[index] ?? ""}
                  onChange={(event) => setDigit(index, event.target.value)}
                  onKeyDown={(event) => onKeyDown(index, event)}
                  disabled={pending}
                  aria-label={`Digit ${index + 1}`}
                  className={cn(
                    "num h-12 w-full rounded border bg-canvas text-center text-[19px] font-semibold text-ink transition-colors focus:outline-none",
                    error
                      ? "border-critical/50"
                      : "border-[rgb(var(--line)/0.16)] focus:border-mint/60",
                  )}
                />
              ))}
            </div>

            {/* Development affordance: with no SMTP configured there is no
                inbox to open, so the code the server generated is shown here. */}
            {challenge?.debug_code ? (
              <p className="mt-4 border-l-2 border-medium/50 pl-3 text-[11px] leading-relaxed text-ink-muted">
                SMTP is not configured, so no email was sent. The code generated
                by the server is{" "}
                <span className="num font-semibold text-medium">
                  {challenge.debug_code}
                </span>
                . Set the SMTP variables to deliver it by email instead.
              </p>
            ) : null}

            {error ? (
              <div className="mt-4">
                <ErrorState error={{ message: error }} compact />
              </div>
            ) : null}

            <Button
              variant="primary"
              size="lg"
              className="mt-5 w-full"
              loading={pending}
              disabled={digits.join("").length !== codeLength}
              onClick={() => void submitCode(digits.join(""))}
            >
              <Check /> Verify and sign in
            </Button>

            <div className="mt-4 flex items-center justify-between text-[11.5px]">
              <span className="text-ink-faint">Didn&apos;t get it?</span>
              <button
                onClick={() => void sendCode(true)}
                disabled={resendIn > 0 || pending}
                className="text-ink-muted underline-offset-2 transition-colors hover:text-ink-soft hover:underline disabled:cursor-not-allowed disabled:no-underline disabled:opacity-50"
              >
                {resendIn > 0 ? `Resend in ${resendIn}s` : "Send a new code"}
              </button>
            </div>
          </div>
        )}

        <p className="mt-10 border-t border-[rgb(var(--line)/0.08)] pt-5 text-[10px] uppercase leading-[1.6] tracking-[0.13em] text-ink-faint">
          Detect. Understand. Act. Verify.
        </p>
      </div>
    </main>
  );
}
