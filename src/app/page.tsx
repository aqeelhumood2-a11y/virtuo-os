import { Card } from "@/shared/ui";

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-8">
      <Card className="max-w-md text-center">
        <h1 className="text-2xl font-semibold text-neutral-900">Virtuo OS</h1>
        <p className="mt-2 text-sm text-neutral-600">
          Foundation phase (1A) — Tailwind, the shared UI kit, and project
          tooling are wired up. No business functionality has been built yet.
        </p>
      </Card>
    </main>
  );
}
