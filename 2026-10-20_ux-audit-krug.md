---
project: P094-drone-radar
date: 2026-10-20
tags: [ux, audit, krug]
---
[[P094-drone-radar]]

# Wielki Leszy - UX audit (Krug)

Scope: index.html, check.html, party.html, pair.html, sensor.html, radar.html, style.css. Rendered state inferred from markup and scripts; no browser run, no user test. Server files (pin.php, party.php, api.php) and emitter.html were not read, so behaviour that depends on them is marked "unclear".

## 1. Verdict

party.html is the page that makes a first-time phone user think. Every audience member lands on it from the QR, has 10 seconds of patience, and meets five numbered steps (the first one "Opcjonalnie"), three equal green buttons (Ton, Test, Dołącz) and a name field, with the only button that matters, "Dołącz", last - although joining works without Ton or Test. Second worst is index.html as seen by a phone user: the radar tells phones to open the app root, which is the home page with six equal buttons, the first one "Baza" (a laptop page). **Single biggest fix: on party.html put "Twoje imię" and one primary "Dołącz" at the top and move the setup steps below it, collapsed.**

[2 LOW | Krug heuristics from model memory, rendered state inferred from code, no hallway test] If I am wrong about party.html being the bottleneck, the earliest sign is a 5-guest hallway test after fix 1: if time from scan to "Jesteś w grze. Czekam na start..." stays above 30 s, the bottleneck is elsewhere (mic permission prompt or the PIN gate).

## 2. Per page

### 2.1 Home - index.html

Trunk test:
- Site: yes, h1 "WIELKI LESZY". What the site does: only half, "Telefony i mikrofony jako uszy na drony" never says it detects and tracks a drone.
- Page: it is the home, but nothing says "start here". Numbered h2s "1. KALIBRACJA WĘZŁÓW" and "2. DETEKCJA" give order, yet section 1 has three equal buttons.
- Next step: unclear for a phone user (which of six?). For the presenter it is "Baza", but it is not marked as first.
- Where am I / home: no navigation needed on home; no "who is this for" split between laptop and phone.

| Severity | What the user sees | Why it makes them think | Fix |
|---|---|---|---|
| major | Six `button.big` of equal weight: "Baza", "Węzeł (telefon)", "Węzeł z dwóch mikrofonów", "Czujnik", "Radar", "Udawany dron" | Who am I, laptop or phone? A phone user sent here by the radar must read all six cards to find "Czujnik" | Group by device: h2 "NA LAPTOPIE (prowadzący)" with "Baza" and "Radar"; h2 "NA TELEFONIE" with the join and listen buttons; collapse "Węzeł z dwóch mikrofonów" and "Udawany dron" under "Narzędzia testowe" |
| major | "Telefony i mikrofony jako uszy na drony. Dwie części: najpierw węzły ustalają, gdzie są; potem słuchają." | "Węzły" is used before it is defined; the promise (detect a drone) is missing | "Wykrywamy drona po dźwięku wirników. Telefony publiczności są mikrofonami. Krok 1: telefony ustalają, gdzie stoją. Krok 2: słuchają drona." |
| major | "Węzeł (telefon)" and "Czujnik", both described as "Na każdym telefonie" | Two names for the same phone; which one do I press? | Name by what the phone does: "Telefon: dołącz do pomiaru" and "Telefon: słuchaj drona" |
| major | "Czujnik": "Na każdym telefonie: nasłuchuje grzebienia harmonicznych wirnika i melduje do radaru." | "Grzebień harmonicznych" is specialist jargon on the front page | "Na telefonie: słucha dźwięku wirnika i wysyła wynik na radar." |
| minor | "Symulacja" is a small link inside grey text of the "Radar" card | The best solo demo path (no phones needed) is nearly invisible | Add a visible button "Radar - symulacja (bez telefonów)" |
| minor | "Zwykle wchodzi się przez QR z bazy; ten przycisk jest na wypadek, gdyby QR nie zadziałał." | Text explains why you should not use the button instead of just saying what it is | "Telefon bez QR? Dołącz tutaj." |
| minor | `<a><button>` nesting, one tap target drawn twice | Invalid HTML; behaviour of a button inside a link differs by browser (unclear which break) | Style the `<a>` as a button, drop the inner `<button>` |
| minor | Footer "Detektor wzorowany na VolAnti (github.com/agamrossen/VolAnti) i Batear (github.com/batear-io/batear). Tylko wykrywanie." | Credits and an ambiguous "Tylko wykrywanie." at the page bottom are noise for guests | Move to a small "O projekcie" line; "Tylko wykrywanie" -> "Nie zakłócamy dronów, tylko słuchamy." |

### 2.2 Base screen (laptop) - check.html

Trunk test:
- Site / page: tab title "Wielki Leszy - baza"; the page has no h1 and no heading at all, so on screen the user sees a QR code and the number "0".
- What to do next: scan the QR (not stated), then "Start" (what it starts is not stated).
- Where am I: nowhere stated. Home: no link to the home page.

| Severity | What the user sees | Why it makes them think | Fix |
|---|---|---|---|
| major | QR with a bare "0" (2.6em) under it, no caption | Does 0 mean errors, phones, rounds? Why scan? | Above QR: "Zeskanuj telefonem, żeby dołączyć". Under the number: "telefonów dołączyło". Add an h1 "Baza - rozstawianie telefonów" |
| major | If the QR library from cdnjs fails, `try/catch` leaves an empty box; the URL exists only as small text (`.7em`) at the bottom of the sidebar | On venue Wi-Fi the presenter sees nothing and no explanation | Print the join URL in large type under the QR; if QRCode is missing show "QR się nie wczytał - wpisz adres:" |
| major | "Start" next to "Ciągle"; status afterwards "Potrzeba co najmniej 3 telefonów." (shown when n < 2 in code) and elsewhere "Potrzeba co najmniej 2 telefonów, które się usłyszały." | The button names no object; the thresholds contradict (2 vs 3) | "Start: pierwsza runda pisków"; one threshold; before enough phones: disabled button with "Czekam na telefony: jest 0, trzeba 3" |
| major | Sidebar "Kalibracja": four paragraphs at `.75em` ("Zasada: ...", "Stos ręczny: ...", "Albo: przytrzymaj telefon na mapie...", "Obchód dotykowy: ..."), the key button "Stos: kalibruj" in a row at the very bottom ("przycisk niżej") | Three or four alternative methods, no recommended path, instruction text smaller than the controls | One numbered path: "1. Połóż wszystkie telefony na kupce. 2. Stuknij Stos: kalibruj. 3. Rozstaw telefony i nie przeładowuj. 4. Start." Put that button right under it; alternatives in `<details>` "Inne metody" |
| major | Map with no hint; long press 600 ms on a dot = "idący", tap dots = stos, tap empty space = done. Described only in prose in the sidebar | Hidden gestures; nothing looks tappable | Caption under the map: "Stuknij telefony leżące razem. Przytrzymaj telefon, żeby oznaczyć go jako idącego." |
| major | Buttons "Nowa runda", "Stos: kalibruj", "Wyczyść kalibrację" in one paragraph with a link, "Start" lives elsewhere | "Nowa runda" sends `cmd: 'reset'` (what it does server-side is unclear), but reads like "start another round" - same job as "Start". "Wyczyść kalibrację" deletes typed tape values with no confirmation | If it clears the roster: "Wyczyść salę". Two-tap confirm on both destructive buttons ("Na pewno? stuknij jeszcze raz") |
| major | "Odległości" table with `input.tape`; in "Ciągle" mode the table is rebuilt by `innerHTML` whenever results change | Likely (from code, not run) the field tester loses a half-typed tape value or focus mid-entry | Skip the rebuild while an input has focus, or update cells in place |
| minor | Map rings every metre with no labels; the explanation for red "głuchy" exists only in the `title`: "nie słyszy własnego pisku: głośnik nie gra, stuknij ten telefon" | The scale is unknown; tooltips do not exist on touch | Label rings "1 m", "2 m"; show the "głuchy" text as a warn toast naming the phone |

### 2.3 Guest phone - party.html

Trunk test:
- Site: h1 "WIELKI LESZY · NA ŻYWO" (tab title says "dołącz"); "NA ŻYWO" suggests a stream, not a join page.
- Page and next step: intro sentence, then five steps and three buttons; the next step is not obvious.
- Where am I: before joining, a list; after joining, one big status box. Home: no link (acceptable for guests, but then no way out either).

| Severity | What the user sees | Why it makes them think | Fix |
|---|---|---|---|
| major | Order: intro, 5 steps (first: "Opcjonalnie: stuknij Udostępnij, potem Do ekranu początkowego. Pełny ekran, nie gaśnie." on iOS), Ton + meter, Test, "Twoje imię", then "Dołącz" at the bottom | 10-second visitor sees homework; "Dołącz" is probably below the fold; joining works without Ton and Test | Top: "Twoje imię" + "Dołącz". Below: `<details open>` "Przygotuj telefon" with steps; delete the install step from the list |
| major | Ton, Test and Dołącz all `button.big` with the same green border | Three equal calls to action; the one that matters has no priority | Dołącz filled (`.on` style); Ton/Test small secondary |
| major | Step 3 "Głośność: stuknij Ton i podgłaśniaj, aż pasek zrobi się zielony." and step 5 "Stuknij Test i zezwól na mikrofon." | Ton already triggers the mic prompt (audio setup calls getUserMedia) before step 5 explains it; two sound checks, two meanings | One button "Sprawdź dźwięk" (gwizd + pasek); line above: "Telefon poprosi o mikrofon: zezwól." |
| major | "Twój telefon raz piśnie, a potem będzie słuchał." | False: Ton plays 4 s, Test whistles, and in "Ciągle" mode the phone beeps every round | "Telefon będzie piszczał i słuchał. Nic nie jest nagrywane ani wysyłane poza kilkoma liczbami." |
| major | Step 4 for this room (ROOM is always set by the QR): "Połóż telefon tam, gdzie ma być, głośnikiem nie do stołu (np. na książce, bokiem). Kierunek nie ma znaczenia." | Negative phrasing; which side is the speaker? "bokiem" contradicts "płasko" | "Połóż telefon ekranem do góry tam, gdzie stoisz, i zostaw go." |
| minor | "Powinien rozlec się krótki gwizd." and result "Słabo słychać (+N dB): dzwonek włączony? głośność w górę?" | Typo; the weak result does not say whether I can still join | "Usłyszysz krótki gwizd." / "Słabo słychać. Włącz dźwięk i podgłośnij; możesz też dołączyć." |
| major | "Twoje imię" has no placeholder; an empty name falls back to a random id (for example "a3k9x2") | The presenter sees an opaque id on the matrix and map | Placeholder "np. Ania"; label "Twoje imię (zobaczysz je na mapie)"; default "Telefon 1" style name |
| major | After "Dołącz" no progress (6 clock round trips, then mic); errors raw: "Nie udało się uruchomić: " + browser message; `poll()` swallows failures (`catch (e) { return; }`), so a dead network or lost PIN cookie leaves "Jesteś w grze. Czekam na start..." forever; "NIE SŁYSZĘ SIEBIE" reuses the red pulse of "JESTEŚ DRONEM" with the remedy "stuknij tutaj, żeby włączyć dźwięk" in a small grey line | Button looks dead; failure looks like success; error looks like a game state | Disable button and show "Łączę..."; plain error "Nie mogę się połączyć. Sprawdź Wi-Fi i odśwież."; after 5 failed polls change the big box to "Brak połączenia"; separate error style from the drone style; make the remedy the big text |

### 2.4 Two-microphone node - pair.html

Trunk test:
- Site: h1 "WIELKI LESZY · WĘZEŁ Z DWÓCH MIKROFONÓW". Page purpose: stated, but after a hardware paragraph.
- Next step: "Start" (clear once found). Where am I: clear. Home: a lowercase link "start" at the very bottom, below the log.

| Severity | What the user sees | Why it makes them think | Fix |
|---|---|---|---|
| major | First paragraph: "Dwa nadajniki DJI na jednym odbiorniku (RX w trybie Stereo: TX1 = lewy, TX2 = prawy, RX po USB-C do komputera) albo dowolne wejście stereo. Jeden zegar, ..." | Hardware jargon wall before the first control | "Podłącz odbiornik DJI do laptopa (tryb Stereo), wybierz wejście, stuknij Start." Rest into `<details>` "Jak to działa" |
| major | "Wejście" list with "domyślne"; DJI auto-pick runs on device labels | Before mic permission labels are empty (inferred), so the first "Start" opens the default mic, probably not the DJI; the list fills only after Start | After first Start, if a DJI-like input exists and was not selected, restart on it; or show "Wybrano: <nazwa>. To nie odbiornik? Wybierz inne i stuknij Start." |
| major | "Zero: klaśnij na wprost", "Stop", "Zapisz pomiar" all disabled; `#run` (dial, numbers) hidden; "-" next to Stop | Dead-looking page, no preview of what will appear | Show the dial greyed with "Stuknij Start, tu pojawi się kierunek"; label "Zero (po Start): klaśnij na wprost" |
| minor | Stats "kierunek °", "Δt ms", "pewność", "rozrzut (próbki)"; dial letters "L", "P", "przód (albo tył)" | No units for confidence; the sign is not explained (in code + points to P, the right side) | "kierunek ° (+ = w stronę P)", "pewność (powyżej 3 = dobra)"; fold Δt and rozrzut into "szczegóły" |
| minor | "Rozstaw do 30 cm: dźwięk wirnika się powtarza co 1/f0, ..." with the input `max="200"` | Physics lecture at the decision point; the page says 30 cm but accepts 200 | Label "Rozstaw mikrofonów (maks. 30 cm)", clamp `max` to 30 or warn above it |
| minor | Errors "Mikrofon: " + raw message; Stop leaves the old dial and numbers | Raw browser text; stale data looks live | "Brak dostępu do mikrofona. Zezwól w przeglądarce i stuknij Start."; on Stop grey the dial and show "Zatrzymano" |
| minor | Link "start" at the bottom, next to a button also called "Start" | Two things called start | Top link "← Wielki Leszy" |

### 2.5 Phone detector - sensor.html

Trunk test:
- Site / page: "WIELKI LESZY · CZUJNIK"; what it does is explained only in the small text after the button.
- Next: "Zacznij słuchać" (clear). Where am I: clear. Home: link "home" (English) next to Stop, visible only after start.

| Severity | What the user sees | Why it makes them think | Fix |
|---|---|---|---|
| major | Card with "Nazwa" input and "id n3k2f9" before the button; default name "phone-3k2" | Internal id is noise; the name matters (radar places phones by sorted name) but the page does not say so | Hide the id; label "Nazwa telefonu (widać ją na radarze)"; default "Telefon 3k2" |
| major | Checkbox "Autotest: udawany dron zamiast mikrofonu" under the main button for everyone | A guest who ticks it feeds a fake drone to the shared radar (reports are sent from the fake signal) | Show only with `?test`, or under `<details>` "Dla testera" |
| major | "Nie wygaszaj ekranu, telefon leży nieruchomo ekranem do góry. Przez pierwsze 2 s uczy się zwykłego dźwięku sali: cisza." | Two orders and one explanation glued together; "cisza" dangles | "Połóż telefon ekranem do góry i nie ruszaj go. Przez 2 sekundy bądźcie cicho - telefon uczy się dźwięku sali." |
| major | After start: "Jeszcze nie na radarze: przeciągnij ten telefon (phone-3k2) na jego miejsce." | Addressed to the phone owner, but the dragging happens on the laptop radar | "Czekam, aż prowadzący ustawi ten telefon na radarze." |
| major | Stat "baza" showing "-" then "ok" or "brak" | "Baza" means the laptop page elsewhere; here it means the connection | "połączenie: ok / brak" |
| minor | Stats "wirnik Hz" and "poziom dB" next to status "SŁUCHAM" | Numbers a guest cannot act on | Keep status and bar; put the numbers in `<details>` "Szczegóły" |
| minor | Error "Mikrofon zablokowany: " + raw message; the sibling party.html adds the remedy, this page does not. Link "home" in English | Inconsistent help; English label | Same text as party.html: "Zezwól w ustawieniach przeglądarki i odśwież stronę."; "home" -> "Strona główna" |

### 2.6 Laptop radar - radar.html

Trunk test:
- Site / page: h1 "WIELKI LESZY · RADAR" in the sidebar; canvas dominates; purpose is not stated.
- Next step on first load: banner "BRAK TELEFONÓW" and nothing else; the hint for phones is at the bottom of the sidebar.
- Where am I: yes. Home: no link at all.

| Severity | What the user sees | Why it makes them think | Fix |
|---|---|---|---|
| blocker | Empty state: banner "BRAK TELEFONÓW". The only join hint: small grey line at the sidebar bottom, "Telefony: otwórz <app root URL> -> Czujnik." | Audience must type a URL (no QR, no PIN shown), land on the home page and find "Czujnik" | When there are no phones, put on the canvas "Dołącz: zeskanuj" + QR of `sensor.html` (with PIN like check.html does) and the URL in large type |
| blocker | Phones not yet placed are skipped when drawing (`if (!n.placed ...) continue`); the table shows "(nierozstawiony)"; sensor.html says to drag the phone | There is nothing to drag until "Rozmieść" is pressed (unless the server places phones itself: unclear, api.php not read) | Draw unplaced phones in a tray at the canvas edge; or auto-place on first report; banner hint "Są nierozstawione telefony: stuknij Rozmieść" |
| major | "Kalibruj" writes "KALIBRACJA: potrzeba 2+ telefonów, które słyszą udawanego drona" or "SKALIBROWANO telefonów: 2" into the banner, which `panel()` rewrites every 250 ms | The result is visible for a fraction of a second; precondition ("połóż wszystkie telefony razem, puść udawanego drona metr dalej") sits in a closed `<details>` | Own message line under the buttons that stays 5 s; one-line precondition under the button |
| major | Buttons "SYM wył.", "Rozmieść", "Kalibruj" | "SYM" is an abbreviation that looks like status; "Rozmieść" has no object; "Kalibruj" differs from calibration on the base page | "Symulacja: wyłączona" (toggle), "Ustaw telefony w rogach i na środku", "Wyrównaj czułość telefonów"; draw "SYMULACJA" on the canvas while sim is on so the audience does not take it for real |
| major | Side panel: "rotor f0", "jakość namiaru", table header "kor." | Jargon; "rotor" vs "wirnik" on the other pages | "częstotliwość wirnika", "dokładność położenia", "poprawka dB" |
| major | Error "BRAK POŁĄCZENIA Z BAZĄ" for every failed fetch, HTTP error or non-JSON answer | "Baza" is the laptop page on the home; a PIN gate page returned to fetch would look identical (unclear without pin.php) | "Radar nie dostaje danych z serwera. Sprawdź Wi-Fi; jeśli działało, wpisz PIN jeszcze raz." |
| minor | "Wyczyść bazę" next to "eksport CSV" in the closed `<details>`; one tap, no confirmation | Wipes phones and readings on stage by accident | Two-tap confirm: "Na pewno? Skasuje telefony i pomiary" |
| minor | "Przeciągnij telefon na radarze, żeby poprawić jego miejsce." only in the closed `<details>` "sala i ustawienia" | Dragging is the main way to fix a placement and is undiscoverable | Caption on the canvas corner: "Przeciągnij telefon, żeby go przesunąć" |

## 3. Cross-page

### 3.1 Same thing, different words

| Thing | What the files say | Fix |
|---|---|---|
| A phone taking part | "Węzeł (telefon)" and "Czujnik" (index.html), "telefon" (check, radar, party), "urządzenie" ("Dołącz tym urządzeniem", check.html), "węzeł" (pair title) | User-facing: "telefon" everywhere; "węzeł" only in pair.html as "Para mikrofonów" |
| "baza" | Home button "Baza" and tab title (laptop page); sensor stat "baza" (connection); radar "BRAK POŁĄCZENIA Z BAZĄ" and "Wyczyść bazę" (server); check "Brak połączenia z bazą"; latency table "wyjście / baza" where "baza = wejście" | Page: "Ekran prowadzącego"; server: "serwer"; latency: "wejście" |
| Calibration | Home "KALIBRACJA WĘZŁÓW" (positions), check "Kalibracja" and "Stos: kalibruj" (audio delay), radar "Kalibruj" (loudness), sensor "Korekta czułości" | Step 1 = "Rozstawianie telefonów"; radar = "Wyrównanie czułości" |
| Rotor sound | "wirnik" (index, sensor) vs "rotor f0" (radar) | "wirnik" |
| Fake drone | "Udawany dron" (index), "udawanego drona" (radar, sensor slider), "Autotest: udawany dron" (sensor), "SYM" and "Symulacja" (radar, index) | "Udawany dron" for the emitter phone, "Symulacja" for the no-phone mode only |
| Sound events | "pisk" (check, party), "gwizd" (party Test), "Ton" (party) | Roll call = "pisk"; sound check = one "Sprawdź dźwięk" |
| Phone identity | party.html stores `dp_id` and `dp_name` (empty name -> random id); sensor.html stores `de_id` and `de_name` (default "phone-xxx") | The presenter sees two different names for one phone on base and radar; share one stored name |
| Way home | sensor.html "home" (English), pair.html "start" (bottom), check.html none, radar.html none, party.html none | One top-left link "← Wielki Leszy" on check, pair, sensor, radar |
| Page headings | h1 "WIELKI LESZY · ..." on party ("NA ŻYWO"), pair, sensor, radar; none on check | Same pattern, with check.html added |

### 3.2 `?room=test`

- index.html hardcodes `?room=test` on Baza, Węzeł and pair, nothing on Czujnik and Radar. check.html ignores the query string (`ROOM = 'test'` constant); pair.html defaults to `'test'`; sensor.html and radar.html call `api.php` without any room, party.html calls `party.php` with the room. So there are two separate hubs.
- A non-empty room puts party.html into "locate" mode (no drones, different step 4). Without `?room` the same URL becomes the drone-show page ("JESTEŚ DRONEM", "Obróć telefon o 20° w lewo"). A guest typing `party.html` gets a different product.
- The two-part story on the home page ("najpierw węzły ustalają, gdzie są; potem słuchają") is not wired in the audited files: positions found on check.html live in party.php's room; radar.html gets positions only from "Rozmieść" or dragging. No audited code copies one to the other. Say this on the home page, or connect them.
- "test" is visible in every guest address bar; harmless, but it looks unfinished on a stage QR.

### 3.3 PIN gate

- check.html asks `pin.php?qrinfo=1` and adds `&pin=` to the QR URL; on failure the `catch` is silent and the QR has no PIN, so guests meet the gate with no hint why. The full URL with PIN is printed small at the sidebar bottom.
- Links on index.html and the radar instruction ("otwórz <URL>") carry no PIN. A phone that arrives that way depends on the gate's own prompt (unclear, pin.php not read). The PIN is shown nowhere in the UI for people who must type it.
- After the cookie is lost, JSON `fetch` calls get the gate's answer: party.html swallows it silently (`poll`), check.html says "Brak połączenia z bazą", radar.html says "BRAK POŁĄCZENIA Z BAZĄ", sensor.html shows "brak". Authorization failure looks like a network failure (assuming the gate answers non-JSON; unclear).
- Fix: show "PIN: ____" in large type next to the QR on check.html and in the radar join hint; one distinct message "Brak dostępu: wpisz PIN jeszcze raz" on every page when a response is not JSON or not 200.
- Small type: key instructions are `.muted` at `.85em` or `.75em` in a dim green (check.html sidebar is the worst); on a projector or at arm's length they are not readable. Raise instruction text to full size and keep `.muted` for side notes.

## 4. Top 10 fixes, ranked

1. party.html - "Twoje imię" + one primary "Dołącz" at the top; steps in `<details>` below; Ton/Test merged into "Sprawdź dźwięk".
2. radar.html - empty state shows a large QR and URL for sensor.html with PIN, not a small line at the sidebar bottom.
3. radar.html - draw unplaced phones (tray) or auto-place them, so the sensor's "przeciągnij ten telefon" is possible.
4. radar.html - give "Kalibruj" and "Rozmieść" their own message line; stop `panel()` overwriting the banner within 250 ms.
5. check.html - caption the QR and the count ("telefonów dołączyło"), print URL and PIN large, handle a missing QR library visibly.
6. check.html - replace the four-paragraph calibration wall with one numbered path and the "Stos: kalibruj" button beside it; alternatives in `<details>`.
7. index.html - split by device (laptop vs phone), rename "Węzeł (telefon)" and "Czujnik" by what the phone does, one visible "Radar - symulacja" button.
8. all pages - one vocabulary (telefon, "baza" only for one meaning, wirnik, kalibracja split in two named steps) and a top-left home link on check, pair, sensor, radar.
9. sensor.html - hide id and the Autotest checkbox, rewrite "przeciągnij ten telefon" for the phone owner, rename stat "baza" to "połączenie".
10. pair.html - cut the intro to one line, re-select the DJI input after mic permission, clamp "Rozstaw" to 30 cm.

[2 LOW | inferred from code only] If these fixes are wrong, fixes 2 to 4 cost about an hour of radar.html work and change nothing visible; the earliest sign is a rehearsal with 5 people where the radar shows 5 placed phones within 60 s without the presenter typing a URL or pressing "Rozmieść" by hand.
