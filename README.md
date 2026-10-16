# CantoBridge

### Speak Cantonese. Meet Hong Kong.

**A conversation can be the beginning of belonging.**

CantoBridge connects Cantonese learners with Cantonese speakers through one-to-one voice conversations. Shared interests, multilingual topic cards and pronunciation support help people find a partner, find their words and build connections through everyday conversation.

**[Try CantoBridge](https://cantobridge.onrender.com)** · [Frontend](frontend/README.md) · [Backend](backend/README.md) · [API reference](frontend/docs/10-api-v1.md)

## Why CantoBridge?

Knowing a few words and feeling ready to speak with someone are different experiences. Newcomers and students need opportunities to practise, a reason to start talking and support when the conversation pauses. Cantonese speakers also bring their own interests and language-learning goals to the exchange.

Hong Kong's **2021 Population Census** reports that **88.2% of people aged five and above used Cantonese as their usual spoken language**. This establishes the language's place in everyday life and motivates our focus on practical communication. [Source: Census and Statistics Department, Main Results, Table 3.12](https://www.censtatd.gov.hk/en/data/stat_report/product/B1120109/att/B11201092021XXXXB0100.pdf)

CantoBridge brings partner discovery, speaking practice and conversation support into one journey. Its focus is the moment someone wants to join a conversation: finding a willing partner, starting with something in common and having a useful prompt within reach.

## Who is it for?

- **Cantonese Learners:** newcomers, exchange students and anyone building confidence in everyday Cantonese and Hong Kong life.
- **Cantonese Buddies:** Cantonese speakers who enjoy sharing local culture, meeting people and practising Mandarin or English in return.

One device-based account supports both roles, with separate profiles and role-specific progress. The interface is available in **English, Simplified Chinese and Traditional Chinese**, with responsive layouts for phones and computers.

## Meet, practise and stay connected

| Feature | What you can do |
| --- | --- |
| **Interest-based discovery** | Browse waiting learners or recommended buddies. Shared interests and language-exchange preferences help order recommendations; profiles also support custom interest tags. |
| **One-to-one voice rooms** | Speak through audio-only calls, with microphone and playback controls, reconnection and a built-in connection check. |
| **Shared multilingual cards** | Follow the same Cantonese, Mandarin and English prompt together, read Jyutping, use supporting expressions and swipe to a new topic. |
| **AI tutor interaction preview** | Explore everyday Hong Kong topics or rehearse before meeting a real partner, with simulated listening, thinking and responding states. |
| **Saved expressions** | Collect useful phrases from conversation cards and revisit them in your personal space. |
| **Partner connections** | Exchange partner requests and reconnect beyond a single conversation. |
| **Progress and recognition** | Review conversation history, practice time, points, achievements and buddy contribution levels. |
| **Role-specific rankings** | Explore weekly and monthly Learner and Buddy leaderboards based on each role's conversation activity. |
| **Personalisation** | Redeem earned points for avatars, frames and five colour themes, including night and eye-comfort themes. |
| **Visibility choices** | Control profile visibility, anonymous mode and participation in public rankings. |

The library contains **472 curated conversation cards across 20 topics and four difficulty levels**. Interest overlap and learner level guide selection, while shared card events keep both partners on the same topic.

## AI support built around human connection

The implemented AI tutor page offers two practice goals:

- **Everyday Hong Kong:** explore food, travel and shopping topics relevant to daily communication.
- **Before meeting a real partner:** use personal interests to rehearse an opening and keep a conversation going, then continue to the matching lobby.

The page is explicitly labelled a **simulated voice experience**. It demonstrates listening, thinking, responding and interruption using example utterances and replies, without microphone capture, recording or audio playback. Users can pause the simulation, change topics, open hints and sample captions, and review expressions before choosing to meet a real partner.

### GenAI-ready interfaces

| Endpoint | Input | Structured output |
| --- | --- | --- |
| `POST /api/genai/topic-cards` | Both participants' interests, learner level and card count | Multilingual cards with Jyutping, expressions and normalised interest context |
| `POST /api/genai/tutor/reply` | Learner text and the current topic card | A multilingual example reply and expression suggestions |

Both authenticated endpoints currently use the local **sample provider**, returning `mode: "mock"`, `provider: "sample"` and `model: null`. Cards come from the curated library; tutor suggestions use the card's practice expressions. This makes the demonstration reproducible and requires no external model account or paid GenAI calls.

A provider adapter separates model integration from authentication and input/output validation. The server validates card fields, lengths, counts and unique IDs, and supports idempotency keys for repeated requests. [Interface documentation and examples](backend/docs/genai.md)

This design gives generative support a concrete learning context: shared interests, learner level and the current topic. Reusable prompts and expressions sit inside a wider human exchange, with AI supporting preparation and users choosing when to connect with people.

## Start your first conversation

1. **Open CantoBridge** and choose your interface language. Your preference is remembered on the device.
2. **Create an account** and choose Learner or Cantonese Buddy.
3. **Introduce yourself** with your language background, interests and visibility preferences.
4. **Choose a practice path.** Learners see paired cards for meeting a real partner and exploring the AI tutor preview; desktop uses a side-by-side layout and mobile stacks the cards.
5. **Meet a partner** through recommendations or matching. Allow microphone access for the live voice room and use shared topic cards as prompts.
6. **Keep the connection going** by saving expressions, reviewing the session and exchanging partner requests.

After **seven seconds** of waiting without a live match request, the app offers a clearly labelled demonstration partner. Enter immediately, keep waiting for a real person or enter automatically after the further **ten-second countdown**. Learners meet a demo Buddy; Buddies meet a demo Learner. Room controls, cards, phrase collection and simulated settlement run in isolated memory, separate from formal account progress.

### A short hands-on walkthrough

Use two devices or separate browser profiles, register one Learner and one Buddy, and connect through matching. Speak to each other, change a shared card and save an expression. End the call to see progress, feedback and partner requests.

With one device, explore the demonstration room and both tutor practice goals. Together, these paths show the implemented journey from onboarding and discovery to a conversation, a recap and another opportunity to connect.

## Learning, inclusion and community

CantoBridge's purpose aligns with three UN Sustainable Development Goals:

| Goal | How the implemented experience supports it |
| --- | --- |
| [**SDG 4 — Quality Education**](https://sdgs.un.org/goals/goal4) | Four-level material, multilingual prompts, Jyutping and reusable expressions support practical, self-directed language practice. |
| [**SDG 10 — Reduced Inequalities**](https://sdgs.un.org/goals/goal10) | Three interface languages, visibility choices and reciprocal exchange help people with different language backgrounds participate. |
| [**SDG 11 — Sustainable Cities and Communities**](https://sdgs.un.org/goals/goal11) | Hong Kong life topics and continued partner connections link language practice with local community participation. |

The application makes participation visible through completed conversations, practice minutes, people helped, partner feedback and role-specific achievements. Weekly and monthly rankings recognise recent participation: a role qualifies after **30 seconds of conversation** in that period, with ranking based on conversation XP earned in that role.

Reciprocity is built into the experience. Buddies can express an interest in practising Mandarin or English, matching recognises language complementarity, and both roles receive recognition for their contribution. Users control their pace, choose their partners and decide which expressions and connections to keep.

## Privacy and responsible participation

- **Audio-only interaction:** live rooms capture microphone audio; camera capture is excluded from the call flow and disabled by the cloud deployment permissions policy.
- **User-controlled visibility:** anonymous mode and profile-field settings shape partner-facing information; leaderboard visibility is also configurable.
- **Explicit microphone permission:** live calls request browser permission. The tutor preview runs without microphone access or recording.
- **Protected resources:** authenticated sessions and room-participant checks protect room access; cloud deployment checks WebSocket origins and applies request limits.
- **Transparent examples:** simulated partners and tutor replies are clearly labelled, with demo activity isolated from formal points and conversation history.
- **Separated credentials:** backend secrets use deployment environment variables, and the public server serves frontend files through a restricted asset boundary.

## How it is built

| Layer | Implementation |
| --- | --- |
| **Interface** | JavaScript ES modules, HTML and CSS; shared components, hash routing, three-language UI and responsive layouts; no frontend build step |
| **API** | Node.js 22+, built-in HTTP, JSON response envelopes, field validation, device-based accounts and idempotent writes |
| **Real-time communication** | WebRTC audio, WebSocket matching and room signalling, shared-card events and configurable STUN/TURN connectivity |
| **Storage** | Local JSON snapshots for development; Supabase-backed, revision-checked snapshot persistence for cloud deployment |
| **GenAI integration** | Provider-independent card and tutor interfaces, validated response formats and a deterministic sample provider |
| **Deployment** | One Render service serving frontend assets and proxying API and WebSocket traffic under a single HTTPS origin |

The operating footprint stays small: the frontend ships without a bundler, REST uses Node's built-in HTTP stack, and curated cards and sample responses run locally. Shared components, a common card format and the provider adapter make the implementation reusable. Reciprocal exchange, contribution recognition and earned-point personalisation create a repeatable participation loop.

## Run locally

Use **Node.js 22 or later**. From the repository root:

```bash
npm ci
npm ci --prefix backend
npm --prefix backend start
```

In a second terminal:

```bash
npm --prefix frontend run serve
```

Open **[https://localhost:4173/](https://localhost:4173/)**. The frontend server supplies local HTTPS and proxies `/api` and `/ws` to the backend on port `8787`.

For a frontend-only demonstration, use **[https://localhost:4173/?api=mock](https://localhost:4173/?api=mock)**, which includes the local tutor examples.

Cloud setup uses the checked-in [Render configuration](render.yaml), [environment template](.env.example) and [deployment guide](deploy/README.md). The root `npm start` command launches the configured cloud service.

## Verification and documentation

```bash
npm test
npm run check
```

Automated suites exercise accounts, matching, room permissions, signalling, shared cards, saved expressions, settlement, partner relationships, rankings, persistence and the GenAI interfaces. Tutor tests cover both goals, interruption, retry and navigation cleanup; layout checks cover paired desktop cards and mobile arrangement. Contract checks keep routes, API fields, components and documentation aligned.

The repository includes a [real-time signalling rehearsal](backend/tools/rehearse-rtc.mjs), a [real-backend frontend walkthrough](frontend/tools/e2e-real.mjs) and [deployment acceptance steps](deploy/README.md#4-验收).

| Guide | Contents |
| --- | --- |
| [Frontend](frontend/README.md) | Local preview, interface structure and interaction checks |
| [Backend](backend/README.md) | Server setup, storage and real-time services |
| [API reference](frontend/docs/10-api-v1.md) | Authentication, fields and endpoint contracts |
| [GenAI interfaces](backend/docs/genai.md) | Example requests, sample responses and provider integration |
| [Deployment](deploy/README.md) | Cloud storage, voice connectivity and environment configuration |

**Meet someone. Find your words. Build a connection.**
