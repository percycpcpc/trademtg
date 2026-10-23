import { Picker } from "./ui";
export const dynamic = "force-dynamic";
export default function Home() {
  return (
    <main className="landing">
      <div className="brand">
        <span>TRADE</span>
        <b>MTG</b>
      </div>
      <h1>Who are you?</h1>
      <p>Choose your name to manage your wants and offer cards to friends.</p>
      <Picker />
    </main>
  );
}
