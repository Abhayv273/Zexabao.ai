import { useState } from "react";
import "./AuthView.css";
const BACKEND_URL = import.meta.env.VITE_BACKEND_URL;


export default function AuthView({ onAuthSuccess, onClose, initialMode = "login" }) {
  const [isSignup, setIsSignup] = useState(initialMode === "signup");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErrorMsg("");
    setLoading(true);

    const endpoint = isSignup ? "/api/signup" : "/api/login";
    try {
      const res = await fetch(`${BACKEND_URL}${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();

      if (!res.ok) {
        setErrorMsg(data.message || "Authentication failed");
        setLoading(false);
        return;
      }

      if (isSignup) {
        alert("Account created successfully! Please log in.");
        setIsSignup(false);
      } else {
        localStorage.setItem("token", data.token);
        onAuthSuccess(data.token);
      }
    } catch {
      setErrorMsg("Cannot connect to the server. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-overlay" onClick={onClose}>
      <div className="auth-box" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="close-btn" onClick={onClose}>
          ✕
        </button>

        <h2 className="auth-heading">
          {isSignup ? "Create Account To Access " : "Log In"}
          &nbsp;
         
        </h2>

        {errorMsg && <div className="auth-error">{errorMsg}</div>}
        
        <form onSubmit={handleSubmit} className="auth-form">

          <input
            type="email"
            placeholder="Email address"
            className="auth-input"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <input
            type="password"
            placeholder="Password"
            className="auth-input"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <button type="submit" className="auth-submit" disabled={loading}>
            {loading ? "Processing..." : isSignup ? "Sign Up" : "Log In"}
          </button>
        </form>

        <p className="auth-footer-text">
          {isSignup ? "Already have an account?" : "Don't have an account?"}{" "}
      
          <span
            className="auth-link"
            onClick={() => {
              setIsSignup(!isSignup);
              setErrorMsg("");
            }}
          >
            {isSignup ? "Log In" : "Sign Up"}
          </span>
        </p>
      </div>
    </div>
  );
}