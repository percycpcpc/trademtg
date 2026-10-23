"use client";
import Link from "next/link";
export default function ListError({ reset }: { reset: () => void }) {
  return (
    <main className="landing">
      <h1>Couldn’t load this wantlist.</h1>
      <p>Please try again.</p>
      <button onClick={reset}>Retry</button>
      <Link href="/">Back to member picker</Link>
    </main>
  );
}
