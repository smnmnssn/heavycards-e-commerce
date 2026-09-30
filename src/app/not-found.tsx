import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Sidan hittades inte",
  robots: { index: false },
};

export default function NotFound() {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col justify-center gap-4 px-6 py-24">
      <h1 className="text-3xl font-bold tracking-tight">Sidan hittades inte</h1>
      <p className="text-muted-foreground">
        Sidan du letar efter finns inte eller har flyttats.
      </p>
      <p>
        <Link href="/" className="font-medium underline underline-offset-4">
          Till startsidan
        </Link>
      </p>
    </main>
  );
}
