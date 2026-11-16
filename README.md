# LocalTab

[简体中文](README.zh-CN.md) · [Original examples](examples/README.md) · [Public scores](https://github.com/phageous01/LocalTab-Scores)

LocalTab is an offline-first tablature editor for bass and guitar. Edit MusicXML,
align recordings to the score, and slow down playback while transcribing. Scores,
audio and synchronization points stay on the computer running the server.
No Flat account or cloud service is required.

**Version 0.9.0.** The interface supports Chinese and English. Select **English**
in the top bar to use the control names in this guide. The browser remembers your
language choice; score titles, instrument names and notation text stay as written.

## Features

- Four- and five-string bass, six-string guitar, and custom tuning.
- Rhythmic TAB with stems, beams, dots and rests alongside standard notation.
- Direct fret-number entry and multi-string chords at the same position.
- Durations, ties, slurs, triplets, hammer-ons, pull-offs, slides, bends, dead notes,
  palm mute, dynamics, articulation and text/tone annotations.
- Add/remove measures; edit time signatures and tempo.
- Grace notes and chords; open-ended slides into/out of a note in either direction.
- Multiple MP3 recordings, each with independent synchronization; copy points between recordings.
- Playback from **0.50× to 1.00× in 0.01 steps**, with browser pitch preservation.
- Horizontal scrolling by default; choose a smooth playhead or note-by-note following.
- Multi-instrument scores: show/hide parts, choose the active instrument, and add bass/guitar parts.
- MusicXML/MXL import, MusicXML export, and PDF through browser printing.
- Local autosave, previous-version backups, and access over a home LAN.
- Sort the library by modified time, created time or name, and search by title fragments.
- Publish MusicXML and an automatically generated PDF to a public GitHub score library.

## Language, instruments and playback view

- Use the language selector in the top bar. Labels, toolbar help, dialogs and application errors switch without reloading or discarding pending input. Language is a browser preference.
- In the sidebar, **Active instrument** chooses the part you edit. Check the instruments you want to see, or use **Show all / Only active**. At least one part remains visible. Add an instrument with **+ Add instrument**; it starts with rests and follows the existing meter. Its tuning can then be changed.
- Edits and copy/paste affect the active part. Measure, meter and tempo changes apply to every part; if any part has an unsupported editing structure, the whole change is rejected. Hidden parts stay in MusicXML and are not deleted.
- **Smooth follow / Note by note** sits above the score. Smooth mode moves a vertical line continuously between engraved notes using the recording's synchronization map. Step mode keeps the note selection box. You can switch during playback; the choice is remembered per browser. Smooth mode scrolls continuously with the playhead near the left third of the viewport; step mode keeps measure-based following.
- Printing uses the currently visible instruments. Publishing creates a complete score PDF with all parts. The oscillator preview plays the active instrument; an MP3 still plays its original mix.

## Library sorting and search

In the sidebar, select **Modified**, **Created** or **Name**, then **Asc ↑** or
**Desc ↓**. The default is most recently modified first. Your browser remembers
the sorting preference, and saving a score updates its position in the list.

Type any part of a title in **Search part of a title…** to filter immediately.
Search ignores letter case and full-width/half-width differences; words separated
by spaces must all occur in the title. The result count shows how many scores match.
Use **×** to clear the search. Sorting and searching keep the current score open,
even when it is outside the results.

Created time is when the score was created or imported into the local library;
modified time is its last local save. Older scores use their recorded import time
and filesystem timestamps until they are next saved. These are not the original
creation and modification dates on Flat.

## Installation and startup

The server needs **Python 3.10+**; clients need a modern browser. Chrome and Edge
are the primary targets. Node.js is only needed for tests. Publishing additionally needs GitHub CLI, the optional Python PDF dependency and Chrome/Edge (see below). No npm install, build
step, database or CDN is required: libraries and fonts are included in `vendor/`.

Download and extract **Code → Download ZIP** on GitHub, or:

```sh
git clone https://github.com/phageous01/LocalTab.git
cd LocalTab
```

**Windows:** double-click `Start.cmd`, or run:

```powershell
py -3 server.py --open
```

`Start.cmd` uses an available Codex-bundled Python when present, otherwise the
Windows `py -3` launcher. If your installation only provides `python`, use
`python server.py --open` instead.

**macOS / Linux:**

```sh
python3 server.py --open
```

Open [http://127.0.0.1:8767](http://127.0.0.1:8767). Keep the terminal running;
press **Ctrl+C** there to stop the server. A fresh installation opens the new-score
dialog. Cancel it to import an [original example](examples/README.md) instead.

### LAN access

The default listener is **0.0.0.0:8767, with no login**. Devices that can reach it
can view and edit the library. On another device on the same LAN, open
`http://<server-computer-LAN-IP>:8767`. Startup prints available LAN addresses.
Allow Python / TCP port 8767 through the server's firewall on your private network.
Use the explicit `http://` address. For access from this computer only:

```sh
python server.py --host 127.0.0.1 --port 8767 --open
```

LocalTab is intended for a trusted local network; it has no internet-facing account
or permission system. Files are always saved on the server computer, including
when editing from another device. GitHub hosts the code and downloadable scores;
it does not run this Python service.

## First session: create, synchronize and transcribe

1. Click **＋ New**. Enter title, instrument, tempo, time signature and measure
   count. Tempo is **quarter notes/minute**: for 6/8 at dotted-quarter = 80, enter 120.
   Initial measures: 1–200; tempo: 20–300. Alternatively, **Import score**
   accepts `.musicxml`, `.xml` and compressed `.mxl` files.
2. Click **＋ Add MP3** and select one or several files. Choose the active
   recording in **Audio source**. Recordings switch; they do not mix.
3. Listen for a clear measure boundary and pause. Click **＋ Add sync point**.
   The dialog freezes the current recording timestamp. Enter the matching
   measure, defaulting to its beginning, then **Save sync point**.
   Selecting a different measure in this dialog does not move the timestamp.
4. Add a second point later, then more where the performance drifts. Click
   **Show waveform**, then click a point on the timeline to edit it or drag it to
   fine-tune time. Open **Sync points** to copy points from another recording or
   shift all timestamps by milliseconds. Calibrate each MP3 separately; copied
   points are a starting point.
5. Click a TAB position, select the string with **↑/↓**, and type a fret number.
   Type two digits promptly for frets 10–36. To form a chord, stay at the same
   position, switch strings, and enter more frets. Chord tones share a duration.
   Select durations and techniques in the toolbar.
6. **Space** plays/pauses. Set **Practice speed**, for example 0.75. Pause
   whenever you want to edit. Choose **Smooth follow** for continuous scrolling or
   **Note by note** for measure-based following.
7. Wait for the saved indicator or click **Save**. Changes autosave after a
   short delay. Reopening restores recordings and synchronization. **Export MusicXML**
   exports notation; **Print / PDF** opens the print view for browser Save as PDF.

Use **Sidebar** in the top-left corner to hide or show the library, tuning,
and measure navigation. Hiding it gives the score more room; the browser remembers
your choice. Editing happens directly in TAB and the top toolbar, including
**Split in two** under Notes.

The score uses the full available page width, with compact controls above it.
The waveform starts collapsed; playback and sync-point controls remain available.
Use **Zoom** above the score to choose 75%–200% (default 110%); the browser
remembers your choice. Zoom changes only the editor view, not exported scores or PDFs.

### Select, copy and paste

- Drag across notes, or click the start and use **Shift+Left / Right** to extend or shrink the selection. **Shift+click** also sets its endpoint. Dragging at the score's edge scrolls automatically. Green highlights and a count show the selection; **Esc** clears it.
- Use **Ctrl+C / Ctrl+V** (**Cmd+C / Cmd+V** on Mac), or the **Copy / Paste** buttons above the score. With no range selected, Copy includes the entire current chord.
- Fragments retain chords, rests, durations, dots, triplets, dynamics and note-level techniques. Connections retain only endpoints inside the selection. Separate text directions, time signatures, tempo and recording sync points are not copied.
- Paste starts at the current position or the beginning of the selection and replaces the fragment's duration without shifting later music. Sustained notes crossing bar lines are split and tied. Extra bars are added when needed; existing END sync points follow the new score end. **Ctrl/Cmd+Z** undoes the whole paste; **Ctrl/Cmd+Shift+Z** redoes it.
- Copy between scores preserves string and fret positions, recalculating pitches for the destination tuning. Pasting to an instrument missing a required string is refused without changing the score.
- Keyboard copy/paste works over ordinary LAN HTTP. If the browser blocks system clipboard access from buttons, the two buttons still work within the page; use keyboard shortcuts across windows. The Paste button uses the last fragment copied in this page, while keyboard paste reads the system clipboard.

### Grace notes and open-ended slides

Select a pitched note and its string, then click **Add grace note** under **Notes**
or press **G**. A small note is inserted immediately before it and selected for
fret entry. Repeat to build a group; switch strings to add a grace chord. The
duration buttons change the grace note's displayed value without consuming measure
time. **Grace slash** toggles slashed/unslashed notation. Use **H / P / S** for
hammer-ons, pull-offs or slurs to the following note. Delete removes the selected
grace tone; **R** removes the entire grace chord. Copy/paste and undo/redo retain
grace notes, including grace-only fragments pasted before a destination note.

Under **TAB techniques**, choose **Slide in from below**, **Slide in from above**,
**Slide out down** or **Slide out up**. These apply to the selected string, require
no second fret and toggle off when clicked again. One incoming and one outgoing
slide can coexist. Choosing an open slide replaces a contradictory paired slide
endpoint; the existing **Slide** button still connects two specified notes.

MusicXML stores grace notes with [`<grace>`](https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/grace/)
and no `<duration>`. Open slides use standard `scoop` (in from below), `plop` (in from
above), `falloff` (out down) and `doit` (out up) articulations with straight lines.
They survive save/export and appear in the editor and print/PDF view; other
applications may render these standard articulations differently.

Grace notes do not move later written beats or MP3 synchronization points. The basic
synth preview approximates each grace group by borrowing a short portion of the
following note; slash style does not change that approximation. Open slide marks do
not synthesize a realistic slide. Imported grace notes that add explicit time
(`make-time`), carry ties/tuplets, or trail a measure remain view-only and are
preserved on export.

### Keyboard and toolbar

Click TAB or the toolbar first to focus it. Duration editing offers protected and
replacement modes; protected mode refuses to overwrite following notes.

| Key | Action |
| --- | --- |
| `0`–`9` | Enter fret; consecutive digits form a number |
| `↑` / `↓` | Select string |
| `←` / `→`, `Enter` | Previous / next note position |
| `Shift` + click / arrow | Extend selection |
| `Alt+1` … `Alt+7` | Whole through 64th duration |
| `.` / `Alt+T` | Augmentation dots / triplet group |
| `T` / `S` | Tie / slur |
| `H` / `P` / `/` | Hammer-on / pull-off / slide |
| `G` | Add a grace note before the selected note |
| `X` | Dead note on selected string |
| `Delete` / `Backspace` | Remove selected string's note, preserving other chord tones |
| `R` | Convert the whole position to/from a rest |
| `Alt+Enter` | Insert a measure after the current one |
| `Space` | Play / pause |
| `Ctrl/Cmd+S` | Save |
| `Ctrl/Cmd+Z`, `Ctrl/Cmd+Shift+Z` | Undo / redo |

Use **Measure** for meter and tempo. **Text / Tone** adds printed text such
as “pick” or “clean”; it does not apply an audio effect. Enter tuning from the
thickest/lowest string to the thinnest/highest, e.g. `B0 E1 A1 D2 G2`, and choose
whether to preserve frets or sounding pitches.

## Synchronization algorithm

| Points for the selected recording | Cursor timing |
| --- | --- |
| None | Follows the MusicXML tempo map, starting at audio time zero |
| One | Aligns that position to its timestamp; keeps the score's tempo changes |
| Two or more | Interpolates using nominal score time between anchors, preserving tempo proportions within each segment |

Outside the anchors, the nearest segment's timing ratio is extended. Audio length
does not automatically stretch the score. Playback rate affects how fast media
time advances, not the saved timestamps. A silent intro can be handled with a
first point after 0:00.

The optional beat field is **one-based, in quarter-note units**, even in 6/8; moving
one eighth note adds 0.5. The beginning of the measure after the last measure means
the score's end. Points must increase in both score position and audio time.

## Files, backups and GitHub

```text
LocalTab/
  public/                     Browser UI, editor model and synchronization
  server.py                   Python standard-library HTTP server
  examples/                   Original exercises
  vendor/                     Renderer, fonts and XML test dependency
  library/<project-id>/       Created automatically; ignored by Git
    score.musicxml            Notation
    project.json              Recording references and synchronization
    audio/*.mp3               Imported recordings
  .local/backups/             Previous saved versions; ignored by Git
```

Each recording contains anchors `{ "q": ..., "seconds": ... }`; `q` counts quarter
notes from the beginning. New saves identify timing as `tempo-map-v1`. Audio paths
are relative to the project folder.

Back up **the whole `library/` folder**: XML export does not include recordings or
synchronization. `.local/backups/` contains previous XML/metadata snapshots, not
copies of MP3s. Editing in two windows is not real-time collaboration: conflicting
saves are rejected. Export unsaved work before reloading after a conflict.

This code repository excludes personal libraries, audio, logs and local settings.
Public MusicXML lives separately in [LocalTab-Scores](https://github.com/phageous01/LocalTab-Scores).
Use **Publish** to publish explicitly. Ordinary saving still does **not** push
to GitHub. See [publishing setup and usage](docs/PUBLISHING.md).

## Current limits

- Editing targets one selected single-voice part with 4–6 strings. Multi-part scores are displayed in full or as selected parts; instruments with overlapping voices, complex repeats or unsupported MusicXML remain view-only. All parts remain in the exported XML. Keep the original import as a backup.
- Chord tones share their duration. Independent rhythms on different strings are
  not yet an editing feature.
- MP3s are alternative recordings, not a multitrack mixer. Synthesized preview is
  basic; technique marks do not promise realistic instrument playback.
- MusicXML annotation appearance can vary between applications. PDF uses browser printing.
- Repeat-aware audio navigation, full engraving and collaborative editing are not
  complete. LocalTab does not reproduce all Flat features.

## Development and verification

Run from the repository root with Node.js 22+ and Python 3.10+:

```sh
node --test tests/*.test.mjs
python -m unittest discover -s tests -p "*_test.py"
```

Use `python3` on macOS/Linux or `py -3` on Windows if needed. No package installation
is required. Tests cover notation round trips, chords, techniques, structural edits,
time mapping and HTTP behavior. HTTP tests use an isolated temporary library.
See [verification details](VERIFICATION.md).

The test fixture is synthetic and the examples are original. Regenerate both with
`python scripts/generate_examples.py`.

## License

LocalTab's own code, documentation and original examples: **[MIT](LICENSE)**.
Bundled dependencies retain their licenses; see [third-party notices](THIRD_PARTY_NOTICES.md).
Imported scores and recordings are not automatically licensed under the software's MIT license.
