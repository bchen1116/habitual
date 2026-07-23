import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { Button } from "@/components/ui/button";

export default async function LandingPage() {
  const user = await getCurrentUser();
  if (user) redirect("/dashboard");

  return (
    <div className="flex min-h-screen flex-col">
      <main className="flex flex-1 flex-col items-center justify-center gap-6 px-6 text-center">
        <h1 className="text-5xl font-bold tracking-tight">Habitual</h1>
        <p className="text-xl text-muted-foreground">
          Put your money where your habits are.
        </p>
        <p className="max-w-md text-balance text-muted-foreground">
          Commit to a habit with real stakes — solo or with friends. Miss your
          goal and you owe your charity (or your friends). Habitual keeps
          score.
        </p>
        <Button asChild size="lg">
          <Link href="/login">Get started</Link>
        </Button>
      </main>
      <footer className="p-6 text-center text-sm text-muted-foreground">
        © {new Date().getFullYear()} Habitual
      </footer>
    </div>
  );
}
