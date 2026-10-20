---
project: P094-drone-radar
date: 2026-10-20
tags: [ux, audit, krug, ssot]
---
[[P094-drone-radar]]

# Wielki Leszy - UX audit 2 (Krug), check.html and party.html after the SSOT rebuild

Scope: `app/check.html` (laptop base, guide strip) and `app/party.html` (phone), as rebuilt on `app/ssot/ui.yaml`, `flow.yaml`, `params.yaml`. The other pages are out of scope; items about them in [2026-10-20_ux-audit-krug.md](/Users/mj/code/the-template/deliverables/projects/2026-10-094-drone-radar/2026-10-20_ux-audit-krug.md) stay as they were. Method: the text on screen is quoted from `app/ssot/ui.yaml`; the states were driven by running the real inline script of `check.html` against a mock hub (`tests/guide.test.cjs`, 22 checks). No browser was opened (the rules forbid it), no layout was seen, no person was tested.

[2 LOW | Krug heuristics from model memory; behaviour from code and a mock hub, no hallway test] The verdict below is a reading, not a measurement.

## 1. Verdict

The trap that made MJ furious had a mechanical cause on top of the design one. In the `check.html` I started from, line 154 read `const go = $('#gDetect'); go.hidden = ...; // detection is always one press away; calibration is never a gate go.onclick = () => {...};`. The `//` comment swallowed the `go.onclick` assignment, so the red "Detekcja dronów" button was drawn and did nothing. Step 2 was a dead end because its only exit was inert. That is fixed, and the state machine now lists the exit explicitly for every state, with a test that fails when a state lacks Detekcja dronów or a way back.

**Single biggest remaining problem: on the phone, a lost connection looks like success.** After "Dołącz" the phone shows "Jesteś w grze. Czekam na start..." and keeps showing it when the network or the PIN cookie dies, because `poll()` swallows every failure. The laptop now says "Brak połączenia z serwerem" in the strip; the phone says nothing.

## 2. Earlier audit: what is now closed

Items are from section 2.2 (check.html), 2.3 (party.html) and 3 of the first audit.

| Earlier item | Status | How |
|---|---|---|
| check: QR with a bare "0", no caption, no h1 | closed | h1 "Baza: rozstawianie telefonów"; above the code "Zeskanuj telefonem, żeby dołączyć"; under the number "telefonów dołączyło" (plural-aware) |
| check: QR library fails, empty box | closed | the box shows "Kod QR się nie wczytał. Wpisz ten adres na telefonie:" and the join address |
| check: "Start" names no object, thresholds 2 vs 3 contradict | partly | button is "Start: runda pisków"; one parameter (`phones.min_for_rollcall`) drives both the check and the message "Potrzeba co najmniej 2 telefonów." Still open: it sits in the collapsed "Ręcznie" panel and is not disabled below the minimum |
| check: four calibration paragraphs at .75em, no recommended path | closed | the strip carries the one path; the explanations are in a collapsed "Jak działa kalibracja i metody ręczne"; live feedback lines (pile, walker, tour, summary) stay visible; help text is no longer .75em |
| check: hidden map gestures | closed | caption under the map: "Stuknij telefony, które leżą razem na stosie. Przytrzymaj telefon, żeby oznaczyć go jako idącego." |
| check: "Nowa runda" unclear | closed (name), open (confirm) | read from `party.php`: the command deletes every member, so it is now "Wyczyść listę telefonów" with a tooltip saying so. No two-tap confirm yet |
| check: tape table rebuilt while typing | open | unchanged |
| check: rings unlabelled, "głuchy" only in a tooltip | open | unchanged |
| check: "baza" means three things | partly | latency header "baza" became "wejście"; offline message says "serwera"; "wynik na ekranie bazy" on the phone still means the laptop page |
| check: key text at .75em | closed | |
| party: homework before "Dołącz" | already closed when I started | name and "Dołącz" are first, steps collapsed in "Zanim dołączysz: dźwięk i ułożenie" |
| party: three equal green buttons | closed for Dołącz | "Dołącz" is now a filled button; Ton and Test stay outlined |
| party: "Twój telefon raz piśnie" is false | closed | "Telefon będzie piszczał i słuchał. Dźwięk zostaje w telefonie, do serwera idą tylko liczby." |
| party: negative placement phrasing, typo "rozlec się" | closed | "Połóż telefon ekranem do góry tam, gdzie ma stać, i zostaw go. Głośnik nie może być zasłonięty. Kierunek nie ma znaczenia." / "Usłyszysz krótki gwizd." |
| party: weak test result does not say if you can still join | closed | "Słabo słychać (+N dB): dzwonek włączony? głośność w górę? Możesz też dołączyć." |
| party: name field has no placeholder | closed | "np. Ania" |
| party: empty name falls back to an opaque id | open | `name \|\| id` unchanged |
| party: Ton and Test are two sound checks | open | texts clarified, two buttons remain |
| party: no progress after "Dołącz", raw errors, polling failures swallowed | open | errors now come from the SSOT but still end in the raw browser message |

## 3. The guide, state by state (check.html)

Trunk test per state: where am I, what can I do here, what is the one button, how do I get out. Texts are the ones in `ui.yaml`; the transitions are the ones in `flow.yaml`.

### 3.1 join (KROK 1 z 3)

Sees: "Dołącz telefony" / "Na każdym telefonie: zeskanuj kod niżej i stuknij Dołącz. Na laptopie nic nie naciskasz." / "dołączyło: 1 z 3". Buttons: "Detekcja dronów", "Pomiń czekanie na telefony", "Wróć do strony głównej". No primary button, because the laptop has nothing to press; the step ends by itself at 3 phones.

- Where am I: yes (KROK 1 z 3, title). What to do: yes, and it names who acts (the phones). One button: none, and the text says so. Out: three exits, one of them the home page.
- Weak point: the QR is "niżej" but "Pomiń czekanie na telefony" is easy to read as "skip the whole thing".

### 3.2 touch-calibrate (KROK 2 z 3), idle

Sees: "Weź Tel1 i połóż tuż przy Tel0" / "Krawędź przy krawędzi, oba ekranem do góry; reszta telefonów może leżeć gdziekolwiek. Stuknij Zmierz." / primary "Zmierz Tel1 (2 rundy)" / "zostało: Tel1, Tel2". Secondary: "Detekcja dronów", "Pomiń Tel1", "Pomiń kalibrację wszystkich", "Wróć do dołączania".

- The physical action and the single button are both stated. Four ways out; this is the state that trapped MJ, so it has the most.
- Weak points: four secondary buttons around one primary is a lot at phone width; the instruction says "Stuknij Zmierz" while the button now says "Zmierz Tel1 (2 rundy)"; if a phone has no name the sentence reads "Weź a3k9x2 i połóż tuż przy b8d1q0".

### 3.3 touch-calibrate, running

Sees: "Mierzę: Tel1 przy Tel0" / "Nie ruszaj telefonów. Pomiar trwa około 19 s." / "runda 1 z 2". Buttons: "Detekcja dronów", "Przerwij pomiar". The primary is hidden while it runs. Before this rebuild a running measurement hid Detekcja dronów and could not be cancelled.

- Weak point: after "Przerwij pomiar" the phones still finish the round already announced (up to about 10 s of beeping) and nothing says so.

### 3.4 measure (KROK 3 z 3), idle

Sees: "Rozstaw telefony i zmierz" / "Ustaw telefony w zadanym rozstawie (np. 50 cm między sąsiadami) i nie ruszaj ich. Zmierz taśmą 2-3 pary i wpisz je w tabeli Odległości. Stuknij Mierz odległości: wynik zapisze się w dzienniku." / primary "Mierz odległości (5 rund)". Secondary: "Detekcja dronów", "Wróć do kalibracji telefonów". No "Pomiń" on purpose: skipping a measurement is the same as Detekcja dronów.

- Weak points: the instruction is the longest on the strip (three sentences) and the tape looks mandatory although the result line "brak par z taśmą: wpisz taśmę i zmierz jeszcze raz" shows it is optional; "Wróć do kalibracji telefonów" re-opens the whole queue and says nothing about overwriting.

### 3.5 measure, running

Sees: "Mierzę" / "Nie ruszaj telefonów. Pomiar trwa około 48 s." / "runda 2 z 5". Buttons: "Detekcja dronów", "Przerwij pomiar". Same cancel weakness as 3.3.

### 3.6 detect (TRYB: DETEKCJA)

Sees: "Detekcja: nasłuch" / "Telefony leżą na swoich miejscach i słuchają. Nic nie naciskasz. Czerwony pierścień na mapie = telefon słyszy wirnik; pozycja pojawia się, gdy słyszą 3 telefony z mapy." / "słucha: 3 z 3". One button, "Wróć do kalibracji". When a rotor is heard the title turns red "DRON" and the text becomes "DRON · słyszy: Tel0, Tel2 · 430 Hz".

- Where am I: yes (TRYB: DETEKCJA). Out: "Wróć do kalibracji" (and the choice is remembered across reloads, as before).
- Weak point: a user who skipped calibration has no map, so "pozycja pojawia się, gdy słyszą 3 telefony z mapy" never comes true and the strip does not say why.

### 3.7 Page level (check.html)

- Site/page: tab "Wielki Leszy - baza", h1 "Baza: rozstawianie telefonów". Sections: guide, QR, settings (collapsed), map, tables. Connection loss: now shown in the strip ("Brak połączenia z serwerem"), not inside the collapsed settings.
- Home link: only in state 1.

## 4. Phone (party.html), by state

| State | What the user sees | Trunk test |
|---|---|---|
| before joining | h1 "Wielki Leszy - dołącz", "Twoje imię" (placeholder "np. Ania"), filled "Dołącz", privacy line, collapsed "Zanim dołączysz: dźwięk i ułożenie", Ton card | one obvious primary; sound checks are optional and below it |
| joined, waiting | "Jesteś w grze. Czekam na start..." | says what happens next; says nothing about the connection (see finding 1) |
| round | "Piszczymy: jesteś 2 z 5" / "nie ruszaj telefonu, cisza"; then "Usłyszano 4 z 5 pisków." / "wynik na ekranie bazy" | clear |
| own speaker silent | "NIE SŁYSZĘ SIEBIE" / "stuknij tutaj, żeby włączyć dźwięk" | the remedy is in the small line, the problem in the big one, styled like the drone alarm |
| listening | "nasłuch: cisza" / "słyszę wirnik: 430 Hz, -40 dB" and the live graph | detection is on from the moment of joining; no step needed |

## 5. Findings

Severity: blocker = the user cannot proceed; major = most users stop and think; minor = some do.

| # | Sev | What the user sees | Why it makes them think | Fix |
|---|---|---|---|---|
| 1 | major | phone: "Jesteś w grze. Czekam na start..." after the network or PIN cookie died | failure looks like success; nobody knows to refresh | proposed: after 5 failed polls change the big box to "Brak połączenia. Sprawdź Wi-Fi i odśwież." and use the error style |
| 2 | blocker (was) | step 2 "Detekcja dronów" | the button did nothing; the `//` comment swallowed the handler | applied, with a test |
| 3 | blocker (was) | step 2 "Pomiń kalibrację" | skipped phones had no `lvl`, so `poll()` threw on every tick and the tables and map stopped updating | applied: skipped phones are ignored in the level profile; tested |
| 4 | major (was) | "Pomiń ten telefon" | the phone returned after the queue ran out, so skip only postponed | applied: a skipped phone stays skipped until it rejoins |
| 5 | major (was) | "Mierzę" | a running measurement hid Detekcja dronów and had no cancel; a network error during it left it "busy" forever | applied: run token, "Przerwij pomiar", error resets the state; tested |
| 6 | major (was) | strip after a phone reloaded | the rejoin was noticed only when some other value changed, so the strip kept "KROK 3 z 3" over a stale calibration | applied: join times are part of the redraw key |
| 7 | major | "Przerwij pomiar" | the announced round still beeps for up to about 10 s and the phones' detection stays paused; nothing says so | proposed: status line "Kończę bieżącą rundę..." until the hub round ends |
| 8 | major | "Wyczyść listę telefonów", "Wyczyść kalibrację" one tap, side by side with "Zapisz pomiar" | a mis-tap on stage deletes the roster or the calibration | proposed: two-tap confirm ("Na pewno? stuknij jeszcze raz") |
| 9 | major | "Weź a3k9x2 i połóż tuż przy b8d1q0" when names are blank | the central sentence of step 2 names phones by random id | proposed: default name "Telefon 1", "Telefon 2" assigned by the hub in join order |
| 10 | major | measure: "Zmierz taśmą 2-3 pary i wpisz je w tabeli Odległości" | reads as required; the result line shows it is optional | proposed: "Taśma jest opcjonalna: bez niej dostaniesz tylko zgodność mapy." in `ui.yaml` |
| 11 | minor | home link only in state 1 ("Wróć do strony głównej") | in states 2 to 6 the page has no way to the home page | proposed: one top-left link "Strona główna" |
| 12 | minor | "Start: runda pisków" inside the collapsed "Ręcznie: Start, Ciągle, ustawienia" | two ways to start a round (strip and Start) with different bookkeeping | proposed: move Start and Ciągle under the strip as "Ręczna runda" only when the guide is in measure |
| 13 | minor | detect: "pozycja pojawia się, gdy słyszą 3 telefony z mapy" after skipping calibration | there is no map, so it never happens | proposed: when the map has fewer than 3 placed phones show "Brak mapy: pominięto kalibrację. Telefony słyszą, pozycji nie będzie." |
| 14 | minor | ref selector "Telefon odniesienia" | before this rebuild it was visible for one tick and then hidden (a control nobody could use) | applied: visible before the first measurement of the queue; changing it restarts the queue |
| 15 | minor | "Zmierz Tel1 (2 rundy)" vs "Mierz odległości (5 rund)" | two near-identical verbs for two different jobs | applied: the first names the phone, the second the object |
| 16 | minor | detection line "nasłuch: cisza (3 tel.)" under the calibration strip | made the page look like it was in two modes | applied: shown only as an alarm during calibration; in detect mode the strip carries it |
| 17 | minor | tape inputs in "Odległości" in Ciągle mode | table rebuilt on each result (unchanged from audit 1) | proposed: update cells in place |
| 18 | minor | phone: "Ton" and "Test" | two sound checks, one inside a collapsed panel | proposed: one "Sprawdź dźwięk" |
| 19 | minor | phone names in the reference list | were injected as HTML | applied: options are built as DOM nodes |

## 6. Top 10, ranked (open items first)

1. Phone: show a lost connection as a lost connection (finding 1).
2. Two-tap confirm on "Wyczyść listę telefonów" and "Wyczyść kalibrację" (8).
3. Default phone names "Telefon N" so the strip never shows a random id (9).
4. "Przerwij pomiar" tells the truth about the round still running (7).
5. Say the tape is optional (10).
6. Detect after a skipped calibration says there will be no position and why (13).
7. A constant way home from every state (11).
8. One "Sprawdź dźwięk" on the phone instead of Ton and Test (18).
9. Start and Ciągle out of the collapsed panel, or removed from the strip's competition (12).
10. Tape inputs keep focus in Ciągle mode (17).

[2 LOW | inferred from code and a mock hub] If this ranking is wrong, the earliest sign is a rehearsal with the strip in front of a first-time operator: if they press "Detekcja dronów" or "Pomiń" within 10 s of being stuck in step 2 and reach the detect screen without help, items 2 to 6 are polish; if they hesitate between the four secondary buttons for longer than 10 s, the strip needs fewer buttons, not better labels.
