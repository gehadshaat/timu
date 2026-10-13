"use client";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const notConfigured = error.message.includes("Supabase is not configured") || error.message.includes("fetch failed");
  return (
    <div className="mx-auto max-w-xl space-y-4 px-6 py-20 text-center">
      <div className="text-5xl">🙈</div>
      <h1 className="font-display text-2xl font-bold">{notConfigured ? "Timu can't reach its database" : "Something went wrong"}</h1>
      <p className="text-zinc-600">
        {notConfigured
          ? "Start local Supabase with `npm run db:start`, then copy the API URL and secret key into .env.local (see README)."
          : error.message}
      </p>
      <button onClick={reset} className="rounded-xl bg-ink px-4 py-2 font-bold text-paper">
        Try again
      </button>
    </div>
  );
}
