"use client";

import { useState } from "react";
import { LogOut } from "lucide-react";
import { signOutCurrentBrowser } from "@/lib/client-session";

export default function LogoutButton() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function logout() {
    setBusy(true);
    setError("");
    try {
      await signOutCurrentBrowser();
      // A full navigation discards account data held in React memory.
      window.location.replace("/");
    } catch {
      setError("Could not log out. Check your connection and try again.");
      setBusy(false);
    }
  }

  return <div className="settings-logout">
    <button type="button" className="button button-secondary" disabled={busy} onClick={()=>void logout()}>
      <LogOut size={16}/>{busy ? "Logging out…" : "Log out"}
    </button>
    {error && <p role="alert">{error}</p>}
  </div>;
}
