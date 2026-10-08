# Butiksdrift – handbok för HeavyCards

För dig som driver butiken. Allt vardagsarbete görs i adminpanelen på
`https://<er domän>/admin`; du behöver aldrig databasen, Prisma, Vercel
eller källkoden. Tekniska uppgifter (domän, nycklar, uppdateringar) sköts
av utvecklaren enligt [launch-runbook.md](launch-runbook.md).

Knapparnas och sidornas namn nedan är exakt de som står i adminpanelen.

## Konton och roller

- **Ägare (OWNER)** gör allt, även Inställningar och Administratörer.
- **Administratör (ADMIN)** sköter produkter, lager, beställningar,
  recensioner, kategorier och set, men kan inte ändra inställningarna eller
  hantera konton.
- Alla har ett eget konto. Dela aldrig lösenord. Bjud in personal under
  **Administratörer** (länken gäller 72 timmar och kan användas en gång).
  När någon slutar: avaktivera kontot direkt; personen loggas ut på en gång.
- Glömt lösenord: "Glömt lösenordet?" på inloggningssidan (länken gäller en
  timme). Man loggas ut efter 8 timmar.
- Stripe och adminpanelen är skilda system: den som gör återbetalningar
  behöver ett eget Stripe-konto i HeavyCards Stripe-team.

## Varje dag: Översikt

Öppna **Översikt** och gå igenom rutorna uppifrån:

| Ruta                                                | Vad du gör                                                                                                                                           |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Kräver åtgärd**                                   | Se [Kräver åtgärd](#kräver-åtgärd) nedan. Ska vara tom.                                                                                              |
| Nya beställningar                                   | Betalda beställningar som ska packas.                                                                                                                |
| Under behandling                                    | Packas just nu; markera som skickade när de lämnats till PostNord.                                                                                   |
| Recensioner att granska                             | Godkänn eller avvisa under Recensioner.                                                                                                              |
| Lågt lager                                          | Produkter vid eller under gränsen i Inställningar.                                                                                                   |
| Återbetalda, ej avslutade                           | Helt återbetalda innan de skickades: öppna och **Avbryt beställningen**.                                                                             |
| E-post i kö – "Väntar på nästa schemalagda körning" | Mejl som borde ha gått iväg. Försvinner inom 15 minuter. Ligger den kvar längre: kontakta utvecklaren (den schemalagda körningen går troligen inte). |

## Produkter

**Produkter → Ny produkt.** Obligatoriskt: produktnamn, produkttyp,
kategori, artikelnummer (SKU), pris, lagersaldo och status. Skapa därför
kategorierna (och gärna seten) först. URL-slug fylls i från namnet; resten
är valfritt.

- **Status**
  - _Utkast_: syns inte i butiken.
  - _Aktiv_: publicerad och köpbar när det finns lager. Slutsåld visas
    automatiskt när lagret är slut.
  - _Kommer snart_: publicerad men inte köpbar, om den inte är markerad som
    **Förbeställning**.
  - _Arkiverad_: säljs inte längre och försvinner ur listor; sidan finns
    kvar (inte i Google) så gamla länkar och ordrar fungerar.
- **Pris (kr)** inklusive moms; **Jämförpris** visas överstruket och måste
  vara högre.
- **Lagersaldo (st)** är det fysiska antalet. Varor i pågående kassor
  reserveras automatiskt; ändra inte saldot för dem. För en förbeställning
  är fältet förbeställningskvoten.
- **Släppdatum**: ett framtida datum lägger produkten under Kommande.
- **Utvald**: visas under Utvalda produkter på startsidan.
- **Sökmotorer (SEO)**: valfritt. Tomt fält ger ett bra standardvärde, som
  visas i fältet.
- **URL-slug**: ändras den på en publicerad produkt skapas en omdirigering
  automatiskt, så gamla länkar fortsätter fungera.

**Bilder** (på produktens sida, efter att den skapats): **Ladda upp
bilder**, JPEG, PNG eller WebP, högst 4 MB och minst 300 px på kortaste
sidan. Första bilden är huvudbilden; ändra ordningen med **Flytta upp**
och **Flytta ner**. Skriv en kort alt-text (t.ex. "Destined Rivals Booster Box, framsida").
Bildändringar sparas direkt, oberoende av knappen **Spara ändringar**.

**Sluta sälja en produkt**: välj status _Arkiverad_. **Radera produkt**
(under "Historik och radering") går bara för produkter utan ordrar,
reservationer och recensioner, och kan inte ångras.

**Försäljning utanför butiken** (mässa, privat): sänk lagersaldot direkt.

## Kategorier och Pokémon-set

**Kategorier** (t.ex. Booster Boxes) och **Pokémon-set** (t.ex. Destined
Rivals) är egna sidor i butiken och viktiga för Google. Skriv några stycken
svensk text i **Beskrivning (valfri)**: den visas på sidan. En kategori
eller ett set utan köpbara produkter visas men hålls borta från Google tills
de har produkter.

## Inställningar (ägare)

**Inställningar → Spara inställningar.** Butiksnamn, kundtjänstens e-post
(svarsadress i alla kundmejl och i sidfoten), företagsnamn och
organisationsnummer (sidfoten), fraktpris, fri frakt från, fraktbolag,
momssats för nya beställningar, gräns för lågt lager och startsidans texter
för sökmotorer. Ändringar syns i butiken direkt och loggas.

Första gången inställningarna sparas öppnas kassan tekniskt; innan dess går
det inte att betala. Moms och frakt bestäms med er redovisningskonsult.

## Beställningar

Flödet för en vanlig beställning (**Beställningar** → öppna ordern):

1. **Betald · Ny**: betalningen är bekräftad av Stripe, orderbekräftelsen
   har skickats och lagret är draget. Betalning _Väntar på betalning_ betyder
   att Stripe inte har bekräftat än: packa inte.
2. **Markera som behandlas** när du börjar packa.
3. **Markera som skickad** när paketet lämnats: välj fraktbolag och skriv
   spårningsnumret (valfritt). Kunden får då **leveransbeskedet en gång**,
   med spårningsnumret och en länk för att recensera köpet.
4. **Markera som slutförd** när ordern är klar.

**Spara spårningsuppgifter** efter att ordern skickats ändrar bara
uppgifterna i admin; kunden får inget nytt mejl.

**Avbryt beställningen** går bara när betalningen är avgjord. Pengar
återbetalas inte automatiskt: gör det i Stripe Dashboard. Lagret ändras
inte automatiskt.

Varje ändring visas under **Historik** på ordern, med vem som gjorde den.

## Återbetalningar och returer

1. På ordern: **Öppna betalningen i Stripe Dashboard**.
2. I Stripe: Återbetala hela eller delar av beloppet.
3. HeavyCards uppdateras automatiskt inom någon minut: _Delvis återbetald_
   eller _Återbetald_. Inget mejl skickas från HeavyCards.
4. **Lagret ändras aldrig automatiskt.** Har varan kommit tillbaka och kan
   säljas igen: öppna produkten och höj **Lagersaldo (st)** med antalet.
   Öppnad eller skadad vara: låt saldot vara.
5. Helt återbetald innan den skickades: **Avbryt beställningen**.

Ångerrätt, returvillkor och vem som betalar returfrakt står i era
köpvillkor; systemet beslutar inget av det.

## Kräver åtgärd

Systemet stannar och ber om hjälp i stället för att gissa. Varje rad visar
problemet och vad du ska göra. Läs texten på ordern.

- **Betalning** (Stripe och HeavyCards är inte överens): tryck
  **Kontrollera med Stripe igen**. Är ordern betald i Stripe slutförs den;
  har kassan gått ut eller misslyckats släpps lagret; annars händer inget
  och lagret förblir reserverat. Kunde problemet lösas: **Markera som
  hanterat**. Står ordern kvar med reserverat lager och betalningen redan
  är återbetald i Stripe: kontakta utvecklaren (ett särskilt kommando
  släpper lagret, med ditt ägarlösenord).
- **E-post** (ett kundmejl kunde inte levereras automatiskt): kontrollera
  kundens adress på ordern. Har mejlet faktiskt kommit fram (sök i Resend
  med Resend-ID:t på ordern): **Markera som hanterat**. Annars kontakta
  utvecklaren för att skicka det igen, eller mejla kunden från kundtjänsten.
- **Lager** ("Betald, men lagret räckte inte"): lagersaldot sänktes under
  det som var reserverat. Kontrollera hyllan innan du packar; finns varan
  inte, återbetala i Stripe och kontakta kunden.

**Markera som hanterat** tar bara bort raden från listan; det ändrar inget
annat.

## Recensioner

**Recensioner** visar inskickade recensioner (alla är verifierade köp).
**Godkänn** publicerar recensionen och betyget på produktsidan direkt;
**Avvisa** döljer den. Bara godkända recensioner räknas i betyget. Ska en
recension raderas helt (t.ex. på kundens begäran): kontakta utvecklaren.

## När du behöver utvecklaren

- Texter på informationssidorna (köpvillkor, integritetspolicy, retur,
  leverans, kontakt, om oss, cookies) ändras i koden efter er granskning.
- Kommandon för låsta betalningar och om-sändning av mejl (kräver ditt
  ägarlösenord, i en terminal).
- Begäran från kunder om utdrag eller radering av personuppgifter.
- **Stänga kassan i en nödsituation**: utvecklaren (eller den i ert
  Vercel-team som har behörighet) slår på en brandväggsregel som stoppar
  nya köp på några sekunder; allt annat fortsätter fungera. Se
  launch-runbook.md avsnitt 14.
- Domän, e-postavsändare, Stripe-nycklar och andra tekniska inställningar.
