import { LoginForm } from "@/components/LoginForm";

export const metadata = { title: "Sign in · ViolationRadar" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;

  return (
    <main className="mx-auto w-full max-w-md px-6 py-20">
      <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">
        Sign in
      </h1>
      <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
        We&apos;ll email you a sign-in link. No password to remember, and no card
        required for your free monthly report.
      </p>
      <div className="mt-6">
        <LoginForm next={next ?? "/"} />
      </div>
    </main>
  );
}
