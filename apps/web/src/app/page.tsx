export default function HomePage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 px-6 py-16 text-slate-100">
      <section className="w-full max-w-2xl rounded-2xl border border-slate-800 bg-slate-900 p-8 sm:p-12">
        <p className="text-sm font-medium uppercase tracking-widest text-emerald-400">
          Frontend foundation
        </p>
        <h1 className="mt-4 text-4xl font-semibold tracking-tight sm:text-5xl">
          Saga Order System
        </h1>
        <p className="mt-6 text-lg leading-8 text-slate-300">
          The Next.js workspace is ready. Order creation, progress tracking, and
          service monitoring will be added in the next implementation steps.
        </p>
        <p className="mt-8 border-t border-slate-800 pt-6 text-sm text-slate-400">
          Next.js App Router · TypeScript · Tailwind CSS · Zustand
        </p>
      </section>
    </main>
  );
}
