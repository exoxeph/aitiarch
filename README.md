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
<img src="docs/media/motion-ink.gif" alt="Dragging across a sentence, pressing Think on this, reviewing what will be sent, and a thought typing itself into the margin beside the text" width="100%">
</div>

<br>

<img src="docs/media/editor.png" alt="The editor: AI thoughts float in the margin, tied to the exact sentence they are about" width="100%">

Select a sentence. A thought grows in the margin and stays tied to it, with a filled **AI** tag, so you always know whose words you are reading.
Your note stays **byte-for-byte your Markdown**. The ink lives next to the file, so CRLF, BOM and every trailing newline round-trip untouched.

<br>

## &nbsp;02 &nbsp; See exactly what leaves the machine

<div align="center">
<img src="docs/media/motion-review.gif" alt="Typing a question in the chat, the review card appearing with the note, threads, instructions and budget, and Send pressed only after reading it" width="100%">
</div>

<br>

<img src="docs/media/review-card.png" alt="The review card lists the question, the note, the threads, the instructions and the token budget before anything is sent" width="100%">

Every message gets a review card first: your question, the note, the threads, the instructions, the token budget. *Nothing has gone to Claude yet. It will see exactly this, and nothing else.*

<br>

## &nbsp;03 &nbsp; Bring in your Claude Code and Codex sessions

<div align="center">
<img src="docs/media/motion-sessions.gif" alt="Opening the session picker, ticking a Claude Code session and a Codex session, and opening the redacted preview of exactly what will be sent" width="100%">
</div>

<br>

<img src="docs/media/session-preview.png" alt="The session picker lists Claude Code and Codex sessions for this project, with a redacted preview of exactly what will be sent" width="100%">

Past **Claude Code** and **Codex** sessions for this project show up in one picker. Tick the ones that matter and read the redacted text, key-like tokens already blanked, before a word is sent.
Chats that carry sessions stay in memory only, and *Add to note* is switched off for them.

<br>

## &nbsp;04 &nbsp; Every claim, checked against its source

<div align="center">
<img src="docs/media/motion-cites.gif" alt="An answer arrives with source chips, and clicking each one shows the quoted words and whether they were Found or Quote not found" width="100%">
</div>

<br>

<img src="docs/media/citations.png" alt="Source chips under an answer: the note, a thread and two sessions found; one quote not found" width="100%">

Each claim in an answer becomes a chip: the note, a thread, a session. The app looks for the quoted words in that exact source and says **Found** or **Quote not found**. Words, never colour alone.

<br>

## &nbsp;05 &nbsp; Add to note, as plain Markdown

<div align="center">
<img src="docs/media/motion-addnote.gif" alt="Hovering an answer, pressing Add to note, and the reply landing in the note as an AI-labelled callout with an Undo" width="100%">
</div>

One click puts the answer in the note as an AI-labelled callout. It is ordinary Markdown, one undo away, and your BOM and line endings stay as they were.

<br>

## &nbsp;06 &nbsp; Turn a sentence into a diagram

<div align="center">
<img src="docs/media/motion-diagram.gif" alt="Dragging across a sentence, pressing Visualize, sending, a flow diagram appearing in the margin, and Add to note placing it in the document as an image" width="100%">
</div>

<br>

<img src="docs/media/diagram-blob.png" alt="Select a sentence, press Visualize, and the diagram appears in the margin, with See it larger and Export SVG" width="100%">

<br>

<img src="docs/media/diagram-in-note.png" alt="The same diagram added to the note as an image, under an AI-labelled callout" width="100%">

Select a sentence, press **Visualize**, review, send. The diagram appears in the margin, ready to enlarge or export as SVG. Bring it into the note and it sits under an AI-labelled callout, saved beside the file as an image that follows light and dark.

<br>

## &nbsp;07 &nbsp; See the whole notebook at once

<div align="center">
<img src="docs/media/motion-constellation.gif" alt="Opening the constellation, switching to the whole notebook, and clicking through notes while their links and open threads light up" width="100%">
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
