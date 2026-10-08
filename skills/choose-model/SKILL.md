---
name: choose-model
description: Use when you create a task, to set its model and effort, and when a teammate's work failed or wasn't good enough, to move it up a model. Keeps cost down by starting with the cheapest model that fits and moving up only when needed.
---

# Choosing the model and effort

Orbit's models, cheapest to most capable: **haiku → sonnet → opus → fable**.
Effort, lightest to heaviest: **low → medium → high → xhigh → max**.
Bigger costs more and takes longer. Start with the smallest that can plausibly do the job well.

| The work | model | effort |
|---|---|---|
| Look something up, rename, reformat, sort, extract, fill in a template, a short summary, a simple check | haiku | low |
| Everyday writing, research summaries, routine code changes, tests, reviewing small changes | sonnet | medium |
| Tricky bugs, design and architecture, long or subtle writing, many-step reasoning, anything high stakes | opus | high |
| Only after opus fell short, or when the owner asks for the very best | fable | high |

Leave `model` out (or "auto") when you're unsure: Orbit then picks one from the work. Leave it out too when the person has a model of their own that fits: the owner may have chosen it on purpose.

## Other engines

When the owner has switched them on (Settings → Connectors), your briefing lists more models under "Models you can give work to". They are part of the owner's plans, like Claude. Use them where they're stronger:

- **ChatGPT** (`gpt:<model>`): hands-on coding and terminal work, or a second opinion from a different point of view.
- **Gemini** (`gemini:<model>`): Flash for quick, light work; Pro for very long documents, images, and anything that leans on Google's knowledge.
- **Grok** (`grok:<model>`): what's happening right now, especially on X.

Moving up works the same way: the next step up is the next stronger model, on any engine.

## Moving up

When work comes back failed, or not good enough after you checked it (check-results):

1. **One step up.** Create a new task for the same person (or someone better suited) with the next model up, and one effort step up if the problem was reasoning. Say what went wrong, what to keep, and where the previous attempt is (its task number; get_task shows it).
2. **If it falls short again,** go up one more step.
3. **Then stop.** Never more than two steps up for the same piece of work, and never past fable. Report to whoever asked: what was tried, what failed, and what you recommend.

Moving up doesn't fix everything. If it failed because of missing access, a missing file, or a question only the owner can answer, fix that cause or ask; a bigger model won't help.

## Don't

- Don't start at opus or fable "to be safe".
- Don't use max effort unless the owner asks for it.
- Don't run the same work on two models at once.
