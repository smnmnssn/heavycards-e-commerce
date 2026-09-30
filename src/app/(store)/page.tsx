export default function HomePage() {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col justify-center gap-6 px-6 py-24">
      {/*
        Temporary text-only wordmark. The official logo belongs in
        /public/brand/heavycards-logo.* and is wired in during Milestone 3.
      */}
      <p className="text-sm font-semibold tracking-[0.3em] uppercase">
        HeavyCards
      </p>
      <h1 className="max-w-2xl text-4xl font-bold tracking-tight text-balance sm:text-5xl">
        Förseglade Pokémon TCG-produkter
      </h1>
      <p className="max-w-xl text-lg text-muted-foreground">
        Booster boxes, Elite Trainer Boxes, booster packs och mer. Webbutiken är
        under uppbyggnad.
      </p>
    </main>
  );
}
