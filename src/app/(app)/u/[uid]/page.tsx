import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { getUserProfile } from "@/lib/server/profile";
import { UserProfileView } from "@/components/user-profile-view";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default async function UserProfilePage({
  params,
}: {
  params: Promise<{ uid: string }>;
}) {
  const { uid } = await params;
  const viewer = await getCurrentUser();
  if (!viewer) redirect(`/login?next=/u/${uid}`);

  const profile = await getUserProfile(viewer.uid, uid);

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-5 p-5 lg:p-9">
      {profile ? (
        <UserProfileView profile={profile} />
      ) : (
        // Deliberately the same answer for "no such person" and "not someone
        // you've shared a habit with" — see getUserProfile. Distinguishing
        // them would confirm whether a uid is real.
        <Card>
          <CardHeader>
            <CardTitle>Profile not available</CardTitle>
            <CardDescription>
              You can see someone&apos;s profile once you&apos;ve shared a habit
              with them.
            </CardDescription>
          </CardHeader>
        </Card>
      )}
      <Link
        href="/challenges"
        className="text-center text-sm text-muted-foreground hover:text-foreground"
      >
        Back to habits
      </Link>
    </div>
  );
}
