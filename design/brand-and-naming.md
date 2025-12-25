# Brand & Naming Strategy

> A conversation with Jobs, Ive, Woz, and Bezos about what to call this thing.

---

## The Split

Three layers. One engine. Different audiences.

| | **mrmd** | **Atelier (codes)** | **Atelier (study)** |
|---|----------|---------------------|---------------------|
| **What** | The engine | Developer experience | Writer experience |
| **Domain** | mrmd.dev | atelier.codes | atelier.study |
| **Audience** | Self-hosters | Programmers, power users | Writers, students, scientists |
| **Price** | Free / Open Source | SaaS subscription | SaaS subscription |
| **Tagline** | "Markdown that runs" | "Claude Code with a home" | "Where you and Claude work" |
| **Tone** | Technical, nerdy | Full IDE, powerful | Warm, calm, focused |
| **Mode** | — | Developer mode | Compact/Writer mode |
| **GitHub** | mrmd/mrmd | (uses mrmd internally) | (uses mrmd internally) |

---

## Two Front Doors, One Product

*"The domain IS the mode selector."*

| Domain | Mode | First Impression |
|--------|------|------------------|
| **atelier.study** | Compact/Writer | Clean, calm, notebook-first |
| **atelier.codes** | Developer | Terminal visible, full IDE feel |

Same account. Same data. Same backend. Different defaults on first visit.

### Writer arrives at atelier.study

```
atelier.study/maxime



        The Great Screen Simplifier

        What if home screens were just... quiet?

        |





                                                          Assistant
```

### Developer arrives at atelier.codes

```
atelier.codes/maxime

+--[ notebooks ]-------------+------------------------------+
| screensimplifierplan.md    | # The Great Screen Simplifier|
| ses1.md                    |                              |
| notes.md                   | What if home screens were... |
+----------------------------+                              |
| > terminal                 |                              |
| $ uv sync                  |                              |
| Resolved 42 packages       |                              |
+----------------------------+------------------------------+
```

### They Can Always Switch

```
        Interface

        ●  Writer mode      Clean, focused, notebook-first
        ○  Developer mode   Full IDE, terminal, file tree

        You can always switch. Your work stays the same.
```

A writer discovers they need the terminal → toggle to developer mode.
A developer wants to focus on writing → toggle to compact mode.

### URL Structure

```
atelier.study/maxime  →  writer mode (default)
atelier.codes/maxime  →  developer mode (default)

Both are the same account. Same data. Just different view.
```

---

## Marketing Split

One product, two stories. Different channels, different domains.

| Channel | Domain | Message |
|---------|--------|---------|
| Twitter/Dev | atelier.codes | "Claude Code, but it's your own Linux box" |
| HackerNews | atelier.codes | "Open source notebook with managed hosting" |
| Substack/Writers | atelier.study | "A calm space for thinking and writing" |
| Academic | atelier.study | "Literate programming for research" |
| ProductHunt | atelier.study | "Where you and Claude work" |

*"You're not splitting the product. You're splitting the marketing."*

---

## Why "Atelier"

**Atelier** (noun): A workshop or studio, especially for an artist or designer.

- It's a real word with real meaning
- Works in French, English, most European languages
- Doesn't scream "startup" — whispers "craft"
- Has history, has class
- Describes what it is: a workshop where you and Claude work

### The Name Candidates (from the room)

1. **Mr. MD** — "Your document doctor" / persona-based
2. **Bureau** — "Your AI bureau" / felt too governmental
3. **Room** — "A room of your own" / too generic
4. **Desk** — "Claude's desk" / too small
5. **Workshop** — taken, overused
6. **Atelier** — the winner

### Why Not Just "MRMD"?

*Jobs:* "MRMD. What does that even mean? Does your mother know? Does a writer in Brooklyn know?"

- MRMD is inside baseball — developers get it, everyone else doesn't
- The vision is writers first, then they discover they can code
- The name has to work for writers

MRMD stays as the open source project name. The nerds will find it.

---

## Domains

| Domain | Cost | Use |
|--------|------|-----|
| **atelier.study** | C$3.41/yr | Primary for writers, general audience |
| **atelier.codes** | C$5.48/yr | Primary for developers |
| **mrmd.dev** | (owned) | Open source project & docs |

**Total: under C$9/yr for both Atelier domains.**

### Why two Atelier domains?

- **.study** is friendlier, less intimidating
- "Study" is something everyone does
- "Codes" is something programmers do
- The domain you arrive from sets your default mode
- Same product, different first impression

### Why not atelier.dev or atelier.ai?

- atelier.dev is C$1,300+ (premium)
- atelier.ai is taken
- *Jobs:* "Thirteen hundred dollars is fine if you're funded. Are you funded? Ship now. Upgrade later if it matters. It won't matter."

---

## Taglines

### For Atelier (SaaS)

```
Atelier
Where you and Claude work.
```

```
Atelier
A studio for thought.
```

```
Atelier
Your AI's workshop.
```

### For mrmd (Open Source)

```
mrmd
Markdown that runs.
```

---

## The Relationship

```
+-------------------------------------------------------------+
|                                                             |
|   atelier.codes                                             |
|   +-----------------------------------------------------+   |
|   |                                                     |   |
|   |   Your notebooks                                    |   |
|   |   Your projects                                     |   |
|   |   Claude integration                                |   |
|   |   Managed hosting                                   |   |
|   |                                                     |   |
|   |   +-----------------------------------------+       |   |
|   |   |                                         |       |   |
|   |   |   mrmd (open source)                    |       |   |
|   |   |   - Markdown renderer                   |       |   |
|   |   |   - Python execution                    |       |   |
|   |   |   - File server                         |       |   |
|   |   |   - Notebook format                     |       |   |
|   |   |                                         |       |   |
|   |   +-----------------------------------------+       |   |
|   |                                                     |   |
|   +-----------------------------------------------------+   |
|                                                             |
+-------------------------------------------------------------+
```

**mrmd** is the engine. **Atelier** is the car.

Most people buy the car. Some people want to build their own.

---

## The Open-Core Model

Like MongoDB, GitLab, Supabase:
- The project is open
- The hosted service is the business

**The flywheel:**
1. Self-hosters become contributors
2. Contributors improve the engine
3. Better engine makes a better car
4. More customers fund development
5. Repeat

---

## Documentation Split

| mrmd.dev | atelier.codes |
|----------|---------------|
| Installation | Getting started |
| Configuration | Your first notebook |
| API reference | Working with Claude |
| Architecture | Projects & collaboration |
| Contributing | Pricing |
| Self-hosting guide | Claude's Home (settings) |

### mrmd.dev Homepage

```
mrmd

Markdown that runs.

pip install mrmd
mrmd serve

---

Docs    GitHub    Discord
```

Technical. Sparse. Like reading a manual for something powerful.

### atelier.codes Homepage

```
Atelier

Where you and Claude work.

[Get started free]
```

Warm. Inviting. Like something you want to use.

---

## Visual Identity

### mrmd

- Monospace typography
- Minimal, no-nonsense
- Code-forward
- The logo: just "mrmd" in mono

### Atelier

- Clean, warm sans-serif
- Generous whitespace
- Content-forward
- The logo: "Atelier" — possibly with a subtle mark

### Shared

Both inherit from the DESIGN_SYSTEM.md:
- Same color palette (dark mode default)
- Same spacing scale
- Same "quiet confidence" principle
- No emojis in UI

---

## Key Quotes from the Room

> "MRMD is inside baseball." — Jobs

> "The name matters less than you think and more than you think. Get it close enough, then make the product so good nobody cares what it's called." — Jobs

> "Names don't matter if the product isn't good. But if the product IS good... the name is how people find it." — Jobs

> "mrmd is the engine. Atelier is the car. Most people buy the car. Some people want to build their own." — Jobs

> "This is the open-core model. The project is open. The hosted service is the business." — Bezos

> "It doesn't scream 'startup.' It whispers 'craft.'" — Bezos

> "Buy them now. Before this conversation leaks and someone else does." — Jobs

---

## Action Items

- [ ] Buy atelier.codes (C$5.48)
- [ ] Buy atelier.study (C$3.41)
- [ ] Set up GitHub org (keep mrmd/mrmd)
- [ ] Design mrmd.dev landing page (technical, sparse)
- [ ] Design atelier.study landing page (warm, writer-first)
- [ ] Design atelier.codes landing page (powerful, dev-first)
- [ ] Implement domain-based mode detection
- [ ] Ensure both domains can access same account/data

---

*Document version: 1.0*
*Created: 2024-12-15*
*Authors: Claude + Maxime (with Jobs, Ive, Woz, Bezos in spirit)*
