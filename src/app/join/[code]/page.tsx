import { cache } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { getCurrentUser } from "@/lib/session";
import { getChallengePreview } from "@/lib/server/challenge-admin";
import { daysBetweenInclusive, formatYmd } from "@/lib/dates";
import { formatAmount } from "@/lib/ledger";
import { JoinPanel } from "@/components/join-panel";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

// One lookup shared between generateMetadata and the page render.
const getPreview = cache(getChallengePreview);

export async function generateMetadata({
  params,
}: {
  params: Promise<{ code: string }>;
}): Promise<Metadata> {
  const { code } = await params;
  const preview = await getPreview(code).catch(() => null);
  if (!preview) {
    return { title: "Join a challenge — Habitual" };
  }
  const days = daysBetweenInclusive(preview.startDate, preview.endDate);
  return {
    title: `Join "${preview.name}" on Habitual`,
    description: `${days} days · ${formatAmount(preview.stakeAmount)} stake · hosted by ${preview.creatorName}`,
    openGraph: {
      title: `Join "${preview.name}" on Habitual`,
      description: `${days} days · ${formatAmount(preview.stakeAmount)} stake · hosted by ${preview.creatorName}`,
    },
  };
}

export default async function JoinPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  const [preview, user] = await Promise.all([
    getPreview(code).catch(() => null),
    getCurrentUser(),
  ]);

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-lg flex-col gap-6 p-6">
      <header className="text-center">
        <h1 className="text-2xl font-bold tracking-tight">Habitual</h1>
        <p className="text-sm text-muted-foreground">
          Put your money where your habits are.
        </p>
      </header>

      <main className="flex flex-1 flex-col items-center gap-6">
        {!preview ? (
          <Card className="w-full">
            <CardHeader>
              <CardTitle>Challenge not found</CardTitle>
              <CardDescription>
                That invite link doesn&apos;t match any open challenge. Codes
                are reusable, so this one may have ended.
              </CardDescription>
            </CardHeader>
          </Card>
        ) : (
          <>
            <Card className="w-full">
              <CardHeader>
                <CardTitle>{preview.name}</CardTitle>
                <CardDescription>
                  Hosted by {preview.creatorName}
                  {preview.description ? ` · ${preview.description}` : ""}
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-1 text-sm">
                <p>
                  {preview.frequencyType === "daily"
                    ? "Every day"
                    : `${preview.target}× a week`}{" "}
                  · {formatYmd(preview.startDate)} – {formatYmd(preview.endDate)}
                </p>
                <p>
                  {formatAmount(preview.stakeAmount)} stake · {preview.skipDays}{" "}
                  skip{preview.skipDays === 1 ? "" : "s"} allowed
                </p>
                <p className="text-muted-foreground">
                  {preview.memberCount} member
                  {preview.memberCount === 1 ? "" : "s"}
                  {preview.maxMembers ? ` of ${preview.maxMembers}` : ""} so far
                </p>
              </CardContent>
            </Card>

            {user && preview.isMember(user.uid) ? (
              <Button asChild size="lg">
                <Link href={`/challenges/${preview.id}`}>
                  You&apos;re in — view challenge
                </Link>
              </Button>
            ) : preview.started ? (
              <p className="text-sm text-muted-foreground">
                This challenge has already started — joining is closed.
              </p>
            ) : user ? (
              <JoinPanel joinCode={code} stakeAmount={preview.stakeAmount} />
            ) : (
              <Button asChild size="lg">
                <Link href={`/login?next=/join/${encodeURIComponent(code)}`}>
                  Sign in to join
                </Link>
              </Button>
            )}
          </>
        )}
      </main>

      <footer className="p-2 text-center text-xs text-muted-foreground">
        Habitual keeps score — it never moves money.
      </footer>
    </div>
  );
}
