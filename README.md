<div align="center">

<img src="docs/media/hero.png" alt="Aitiarch. Your AI writes the code. You own the why." width="100%">

<br>

**A local-first decision notebook for the choices you make while coding with AI.**

`Plain Markdown on disk` &nbsp;·&nbsp; `AI always labelled` &nbsp;·&nbsp; `Nothing sent unseen` &nbsp;·&nbsp; `Windows first`

</div>

<br>

<div align="center">
<img src="docs/media/demo.gif" alt="Opening a thread, flying through the constellation, reviewing what will be sent" width="86%">
</div>

<br>

<div align="center">
<img src="docs/media/wallA.png" alt="Bring in Claude Code and Codex sessions. Every claim checked against its source." width="100%">
<img src="docs/media/wallB.png" alt="Turn a sentence into a diagram. See the whole notebook at once." width="100%">
</div>

<br>

## &nbsp;How a question travels

<div align="center">
<img src="docs/media/pipeline.gif" alt="Claude Code and Codex sessions are redacted, join the note and the AI thoughts in a review card, go to Aitiarch AI, and come back as a cited answer and a new thought that keeps the thread going" width="100%">
</div>

<br>

## &nbsp;01 &nbsp; Ink beside the text, never inside it

<div align="center">
<img src="docs/media/pipe-ink.gif" alt="Select a sentence, press Think on this, and Aitiarch AI puts a thought in the margin. The thought and its anchor live in a file beside yours, and your Markdown stays untouched." width="100%">
</div>

<br>

<img src="docs/media/editor.png" alt="The editor: AI thoughts float in the margin, tied to the exact sentence they are about" width="100%">

Select a sentence. A thought grows in the margin and stays tied to it, with a filled **AI** tag, so you always know whose words you are reading.
Your note stays **byte-for-byte your Markdown**. The ink lives next to the file, so CRLF, BOM and every trailing newline round-trip untouched.

<br>

## &nbsp;02 &nbsp; See exactly what leaves the machine

<div align="center">
<img src="docs/media/pipe-review.gif" alt="Your question, the note, the threads, the instructions and the budget are gathered into a review card. Nothing is sent until you press Send." width="100%">
</div>

<br>

<img src="docs/media/review-card.png" alt="The review card lists the question, the note, the threads, the instructions and the token budget before anything is sent" width="100%">

Every message gets a review card first: your question, the note, the threads, the instructions, the token budget. *Nothing has gone to Claude yet. It will see exactly this, and nothing else.*

<br>

## &nbsp;03 &nbsp; Bring in your Claude Code and Codex sessions

<div align="center">
<img src="docs/media/pipe-sessions.gif" alt="Pick Claude Code and Codex sessions, secrets are redacted, you preview exactly what will be sent, and they join as context chips on the review card" width="100%">
</div>

<br>

<img src="docs/media/session-preview.png" alt="The session picker lists Claude Code and Codex sessions for this project, with a redacted preview of exactly what will be sent" width="100%">

Past **Claude Code** and **Codex** sessions for this project show up in one picker. Tick the ones that matter and read the redacted text, key-like tokens already blanked, before a word is sent.
Chats that carry sessions stay in memory only, and *Add to note* is switched off for them.

<br>

## &nbsp;04 &nbsp; Every claim, checked against its source

<div align="center">
<img src="docs/media/pipe-cites.gif" alt="Each quoted claim in an answer is searched for in its own source and comes back as Found or Quote not found" width="100%">
</div>

<br>

<img src="docs/media/citations.png" alt="Source chips under an answer: the note, a thread and two sessions found; one quote not found" width="100%">

Each claim in an answer becomes a chip: the note, a thread, a session. The app looks for the quoted words in that exact source and says **Found** or **Quote not found**. Words, never colour alone.

<br>

## &nbsp;05 &nbsp; Add to note, as plain Markdown

<div align="center">
<img src="docs/media/pipe-addnote.gif" alt="Add to note inserts the reply as an AI-labelled Markdown callout under the sentence it is about, with one undo and your bytes untouched" width="100%">
</div>

One click puts the answer in the note as an AI-labelled callout. It is ordinary Markdown, one undo away, and your BOM and line endings stay as they were.

<br>

## &nbsp;06 &nbsp; Turn a sentence into a diagram

<div align="center">
<img src="docs/media/pipe-diagram.gif" alt="Select a sentence and press Visualize, review, Aitiarch AI sketches the diagram, it is checked and repaired, appears in the margin, and can be added to the note as an image" width="100%">
</div>

<br>

<img src="docs/media/diagram-blob.png" alt="Select a sentence, press Visualize, and a diagram appears in the margin" width="100%">

Select a sentence, press **Visualize**, review, send. The diagram appears in the margin; bring it into the note and it is saved beside it as an image that follows light and dark.

<br>

## &nbsp;07 &nbsp; See the whole notebook at once

<div align="center">
<img src="docs/media/pipe-constellation.gif" alt="Your notes are read for links and drawn as a constellation: links become lines, open threads glow, broken links are flagged" width="100%">
</div>

<br>

<img src="docs/media/constellation-full.png" alt="Fourteen notes in three folders, linked, with open threads glowing and one broken link flagged" width="100%">

Notes become stars and links become lines. Open threads glow. Notes nothing cites and links that lead nowhere are one glance away. Filter by folder or state, or find a note by name.

<br>

<div align="center">
<img src="docs/media/showcase.png" alt="Write it down. See what leaves the machine. Watch it connect." width="100%">
</div>

<br>

## &nbsp;Rules the app keeps

| | |
|---|---|
| **The why is yours** | AI never writes your takeaway, your reasons, or a failed reason. |
| **Asked, not assumed** | No proactive comments. Edits come only from something you did: typing, a toolbar, a shortcut, a click. |
| **Look, then send** | A review card for every message. A plan card for anything bigger: files, repo, diagrams, a cost cap. Raising it asks again. |
| **Read-only investigations** | *Investigate* reads a throwaway copy of your repo, never the repo itself, with secrets filtered out. |
| **Your files, byte-exact** | Rendering is display only. Decorations never change the document. |
| **Local** | No accounts, no hosted backend, no network fonts. The app never handles your Claude credentials. |

<br>

## &nbsp;Run it

Needs Node 24+.

```powershell
cd ui
npm install
npm run build
node server/main.ts --root <your-project>\.aitiarch
```

The notebook opens in your browser. Details and the practice notebook: [ui/README.md](ui/README.md).

<br>

## &nbsp;Read on

[BRIEF.md](BRIEF.md) the vision and the principles the human keeps &nbsp;·&nbsp; [JOURNEY.md](JOURNEY.md) how it was built, with the measurements &nbsp;·&nbsp; [NOTES.md](NOTES.md) findings and open problems &nbsp;·&nbsp; [docs/build-plan.md](docs/build-plan.md) the plan &nbsp;·&nbsp; [docs/try-it.md](docs/try-it.md) a guided first run &nbsp;·&nbsp; [ARCHIVE.md](ARCHIVE.md) the early experiments

<br>

<div align="center"><sub>Every screenshot and clip is the real app, or built from it, on a synthetic notebook with fake providers and fake sessions.</sub></div>
