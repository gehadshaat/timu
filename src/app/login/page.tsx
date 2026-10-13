import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AUTH_COOKIE, sessionToken } from "@/lib/auth-token";

async function login(form: FormData) {
  "use server";
  const password = process.env.TIMU_PASSWORD;
  if (!password || form.get("password") !== password) redirect("/login?wrong=1");
  (await cookies()).set(AUTH_COOKIE, await sessionToken(password), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 30,
    path: "/",
  });
  redirect("/");
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ wrong?: string }> }) {
  const { wrong } = await searchParams;
  return (
    <form action={login} className="mx-auto mt-32 max-w-sm space-y-4 rounded-3xl bg-white p-8 shadow-sm ring-1 ring-black/5">
      <h1 className="font-display text-2xl font-bold">🐝 Timu</h1>
      <input
        type="password"
        name="password"
        placeholder="Password"
        autoFocus
        className="w-full rounded-xl border-0 bg-zinc-50 px-3 py-2 ring-1 ring-black/10"
      />
      {wrong ? <p className="text-sm text-rose-600">That&apos;s not it.</p> : null}
      <button className="w-full rounded-xl bg-ink py-2 font-bold text-paper">Come in</button>
    </form>
  );
}
