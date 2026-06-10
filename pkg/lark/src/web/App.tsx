import { useEffect, useState } from "react";
import { ApiError, apiGet } from "./api";

interface Me {
  uid: string;
}

type AuthState = { status: "loading" } | { status: "anon" } | { status: "authed"; me: Me };

export function App() {
  const [auth, setAuth] = useState<AuthState>({ status: "loading" });

  useEffect(() => {
    apiGet<Me>("/api/v1/me")
      .then((me) => setAuth({ status: "authed", me }))
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) setAuth({ status: "anon" });
        else setAuth({ status: "anon" });
      });
  }, []);

  return (
    <main className="app">
      <header className="app__header">
        <h1>lark</h1>
        <p className="app__tagline">Faerrin music — Discord voice library</p>
      </header>

      {auth.status === "loading" && <p>Loading…</p>}

      {auth.status === "anon" && (
        <section className="card">
          <p>Sign in with Discord to manage the library and control playback.</p>
          <a className="btn" href="/auth/login">
            Sign in with Discord
          </a>
        </section>
      )}

      {auth.status === "authed" && (
        <section className="card">
          <p>
            Signed in as <code>{auth.me.uid}</code>.
          </p>
          <p className="muted">Library, ingest, playback, and Stream Deck keys land in the next phases.</p>
          <form method="POST" action="/auth/logout">
            <button className="btn btn--ghost" type="submit">
              Sign out
            </button>
          </form>
        </section>
      )}
    </main>
  );
}
