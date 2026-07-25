"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { doc, onSnapshot } from "firebase/firestore";
import { getClientDb } from "@/lib/firebase/client";
import { formatAmount, settleEntry, uploadReceipt } from "@/lib/ledger";
import type { LedgerEntry } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

export function LedgerEntryDetail({ id, uid }: { id: string; uid: string }) {
  const [entry, setEntry] = useState<LedgerEntry | null | undefined>(undefined);

  useEffect(() => {
    const unsubscribe = onSnapshot(
      doc(getClientDb(), "ledgerEntries", id),
      (snap) =>
        setEntry(
          snap.exists() ? ({ id: snap.id, ...snap.data() } as LedgerEntry) : null
        ),
      () => setEntry(null)
    );
    return unsubscribe;
  }, [id]);

  if (entry === undefined) {
    return <div className="h-48 animate-pulse rounded-xl bg-muted" />;
  }
  if (entry === null) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Entry not found</CardTitle>
          <CardDescription>
            It may have been removed, or you may not have access.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const iOwe = entry.fromUid === uid;
  const counterparty =
    entry.toType === "charity"
      ? (entry.toCharityName ?? "Charity")
      : iOwe
        ? (entry.toName ?? "Someone")
        : entry.fromName;
  const counterpartyUsername =
    entry.toType === "charity" ? null : iOwe ? entry.toUsername : entry.fromUsername;

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">
            {formatAmount(entry.amount)}{" "}
            <span className="text-base font-normal text-muted-foreground">
              {iOwe ? "to" : "from"} {counterparty}
              {counterpartyUsername && ` (@${counterpartyUsername})`}
            </span>
          </CardTitle>
          <CardDescription>
            From{" "}
            <Link
              href={`/challenges/${entry.challengeId}`}
              className="underline hover:text-foreground"
            >
              {entry.challengeName}
            </Link>
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <span
            className={
              "type-overline w-fit rounded-full px-2.5 py-1 text-[11px] " +
              (entry.status === "unsettled"
                ? "bg-destructive/15 text-destructive"
                : "bg-secondary text-secondary-foreground")
            }
          >
            {entry.status === "unsettled" ? "Unsettled" : "Settled"}
          </span>

          {entry.status === "settled" && entry.settledAt && (
            <p className="text-sm text-muted-foreground">
              Settled {entry.settledAt.toDate().toLocaleDateString()}
            </p>
          )}
          {entry.note && <p className="text-sm">{entry.note}</p>}
          {entry.receiptURL && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={entry.receiptURL}
              alt="Receipt"
              className="max-h-64 w-fit rounded-md border"
            />
          )}

          {iOwe && entry.status === "unsettled" && <SettleDialog entry={entry} />}
        </CardContent>
      </Card>
      <p className="text-center text-xs text-muted-foreground">
        Habitual doesn&apos;t move money — settle up however you normally pay,
        then mark it settled here.
      </p>
    </div>
  );
}

function SettleDialog({ entry }: { entry: LedgerEntry }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const counterparty =
    entry.toType === "charity"
      ? (entry.toCharityName ?? "Charity")
      : (entry.toName ?? "Someone");

  function pickFile(f: File | undefined | null) {
    if (!f) return;
    if (!f.type.startsWith("image/")) {
      setError("Receipts must be images.");
      return;
    }
    if (f.size > 5 * 1024 * 1024) {
      setError("Receipts must be under 5MB.");
      return;
    }
    setError(null);
    setFile(f);
  }

  async function submit() {
    setSubmitting(true);
    setError(null);
    try {
      let receiptURL: string | undefined;
      if (file) {
        setProgress(0);
        const { url } = uploadReceipt(entry.fromUid, entry.id, file, setProgress);
        receiptURL = await url;
      }
      await settleEntry(entry.id, { receiptURL, note });
      setOpen(false);
    } catch (err) {
      console.error("settle failed:", err);
      setError("Couldn't mark this settled. Please try again.");
    } finally {
      setSubmitting(false);
      setProgress(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !submitting && setOpen(o)}>
      <DialogTrigger asChild>
        <Button>Mark as settled</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Mark as settled</DialogTitle>
          <DialogDescription>
            Confirm you&apos;ve paid {formatAmount(entry.amount)} to {counterparty}.
          </DialogDescription>
        </DialogHeader>

        <div
          role="button"
          tabIndex={0}
          aria-label="Add a receipt"
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            pickFile(e.dataTransfer.files?.[0]);
          }}
          onClick={() => fileInputRef.current?.click()}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              fileInputRef.current?.click();
            }
          }}
          className={
            "flex cursor-pointer flex-col items-center justify-center gap-1 rounded-md border border-dashed p-6 text-center text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring " +
            (dragOver ? "border-primary bg-accent" : "border-input")
          }
        >
          {file ? (
            <span className="font-medium">{file.name}</span>
          ) : (
            <>
              <span>Add a receipt (optional)</span>
              <span className="text-xs text-muted-foreground">
                Tap to choose a photo, or drag one here
              </span>
            </>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => pickFile(e.target.files?.[0])}
          />
        </div>

        {progress !== null && (
          <div className="h-1.5 overflow-hidden rounded-full bg-secondary">
            <div
              className="h-full rounded-full bg-foreground transition-all"
              style={{ width: `${Math.round(progress * 100)}%` }}
            />
          </div>
        )}

        <Textarea
          placeholder="Add a note (optional)"
          value={note}
          maxLength={200}
          onChange={(e) => setNote(e.target.value)}
        />
        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="flex justify-end gap-2">
          <Button
            variant="ghost"
            onClick={() => setOpen(false)}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button onClick={submit} disabled={submitting}>
            {submitting ? "Saving…" : "Mark settled"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
