"use client";

import { useState } from "react";
import { Cloud, Dumbbell, LogIn } from "lucide-react";
import { supabase } from "@/lib/supabase";

export function LoginScreen() {
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [step, setStep] = useState<"email" | "otp">("email");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  async function sendOtp() {
    if (!supabase || !email.trim()) {
      setMessage("Introduce un email.");
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { shouldCreateUser: true },
    });
    setLoading(false);
    if (error) {
      setMessage(error.message);
      return;
    }
    setMessage("Código enviado. Revisa tu email.");
    setStep("otp");
  }

  async function verifyOtp() {
    if (!supabase || !email.trim() || !otp.trim()) {
      setMessage("Introduce el código.");
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.verifyOtp({
      email: email.trim(),
      token: otp.replace(/\s/g, ""),
      type: "email",
    });
    setLoading(false);
    if (error) setMessage(error.message);
  }

  async function loginWithGoogle() {
    if (!supabase) return;
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin },
    });
    if (error) setMessage(error.message);
  }

  return (
    <main className="app-shell" style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh" }}>
      <div style={{ width: "100%", maxWidth: 400, padding: "0 16px" }}>
        <section className="panel">
          <div className="brand" style={{ marginBottom: 24 }}>
            <div className="brand-mark">
              <Dumbbell size={20} />
            </div>
            <div>
              <div className="brand-title">
                GYM<span>LOG</span>
              </div>
              <div className="brand-subtitle">Accede a tu cuenta</div>
            </div>
          </div>

          {step === "email" ? (
            <div className="form-row">
              <div className="field">
                <label>Email</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="tu@email.com"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void sendOtp();
                  }}
                />
              </div>
              <button className="button primary" onClick={sendOtp} disabled={loading}>
                <Cloud size={16} /> {loading ? "Enviando…" : "Enviar código"}
              </button>
              <button className="button" onClick={loginWithGoogle}>
                Continuar con Google
              </button>
            </div>
          ) : (
            <div className="form-row">
              <p className="panel-copy">
                Código enviado a <strong>{email}</strong>
              </p>
              <div className="field">
                <label>Código</label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={otp}
                  onChange={(e) => setOtp(e.target.value)}
                  placeholder="123456"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void verifyOtp();
                  }}
                />
              </div>
              <button className="button primary" onClick={verifyOtp} disabled={loading}>
                <LogIn size={16} /> {loading ? "Verificando…" : "Entrar"}
              </button>
              <button
                className="button"
                onClick={() => {
                  setStep("email");
                  setMessage("");
                }}
              >
                ← Cambiar email
              </button>
            </div>
          )}

          {message && <p className="panel-copy" style={{ marginTop: 12 }}>{message}</p>}
        </section>
      </div>
    </main>
  );
}
