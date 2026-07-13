# DRIFTDREAM — Suno Music Prompt Pack (2026-07-13)

_Offline pipeline: Tibba generates in Suno (v4.5+), curates, drops files into `audio/music/`.
No runtime API — cost, latency, offline and key-security all say no. The game ships static
loopable tracks; a playlist player (SQ2, Claude) picks per biome/screen with crossfade._

---

## 1. Global sonic identity (paste-able DNA — start every style prompt with this)

> **DNA:** `instrumental synthwave, analog warmth, dreamy retro-futurism, glowing sunset mood,
> steady driving pulse, hypnotic, polished mix, no vocals`

Rules for every generation:
- **Lyrics field:** `[Instrumental]` — nothing else. Vocals break HUD focus and loop seams.
- **Exclude styles (paste into "Exclude"):** `vocals, singing, rap, lo-fi hiss, dubstep, brostep,
  metal, orchestral trailer, epic drums, EDM drop, comedy`
- **Length:** generate, then **Extend** to ≥ 2:30. Target 2:30–3:30 per race track, 1:30–2:00
  for menu/garage, 0:45–1:20 for the results sting.
- **Loopability:** prefer takes that hold one energy plateau — no big intro build, no outro fade.
  When trimming (see §5) you want bar-aligned start/end at similar intensity.
- Generate **3–4 takes per prompt**, keep the one that (a) loops, (b) doesn't fight engine audio
  in the 80–300 Hz band (thin bass beats fat bass here — the engine IS the bass), (c) you'd
  happily hear 20× in a session.

---

## 2. Race tracks — one prompt per biome × weather flavor

Biomes ship two takes each (A/B) so long sessions don't wear one loop out. Weather variants are
optional polish — start with the base biome prompt; add the variant line only if you want
distinct rain/dust/mist takes later.

### DUNE (tier 1 — warm desert dusk, amber haze)
**Title:** `Dune Drive A` / `Dune Drive B`
**Style:**
> instrumental synthwave, analog warmth, dreamy retro-futurism, glowing sunset mood, steady
> driving pulse, hypnotic, no vocals — desert highway at golden hour, warm analog synth leads,
> motorik krautrock groove, shimmering heat-haze pads, soft tom fills, 108 BPM, endless horizon
> feeling, Kavinsky meets Tycho

**Dust-storm variant (optional):** append `, grittier texture, filtered radio static accents,
tense undertone, visibility fading`

### NEON (tiers 2 + 5 — rain-slick city night, magenta/purple)
**Title:** `Neon Rain A` / `Neon Rain B`
**Style:**
> instrumental darksynth retrowave, analog warmth, dreamy retro-futurism, no vocals — neon city
> in the rain at night, wet asphalt reflections, pulsing sidechained bass, fast hypnotic
> arpeggios, gated reverb snare, 121 BPM, chrome and magenta glow, The Midnight meets Perturbator
> at their calmest, sleek and propulsive not aggressive

**Misty variant (optional):** append `, hazier, slower attack pads, distant city hum, mysterious`

### CANYON (tier 3 — red rock dusk, western tinge)
**Title:** `Canyon Dusk A` / `Canyon Dusk B`
**Style:**
> instrumental synthwave with desert western tinge, analog warmth, no vocals — canyon run at
> dusk, twangy baritone guitar over warm synth bed, steady four-on-the-floor drive, wide open
> reverb, red rock silhouettes, 112 BPM, El Paso desert noir meets College, confident and
> cinematic, one sustained energy plateau

### FROZEN (tier 4 — snow, aurora, icy calm)
**Title:** `Frozen Aurora A` / `Frozen Aurora B`
**Style:**
> instrumental ambient synthwave, analog warmth, dreamy, no vocals — night drive through snowfall
> under aurora, crystalline bell arpeggios, icy shimmering pads, deep slow bass pulse, brushed
> percussion, 104 BPM, serene but still moving forward, Com Truise meets Hammock, cold air and
> starlight

---

## 3. Screen tracks

### MAIN MENU — "the dream begins"
**Title:** `Driftdream Theme`
**Style:**
> instrumental chillwave synthwave, analog warmth, dreamy retro-futurism, no vocals — floating
> nostalgic opening theme, slow heartbeat pulse, cassette warble, glowing pad swells, gentle
> melodic hook that repeats like a memory, 88 BPM, weightless anticipation, the calm before the
> race, Boards of Canada meets The Midnight

### GARAGE — "tinkering groove"
**Title:** `Garage Groove`
**Style:**
> instrumental synth funk, analog warmth, laid back head-nod groove, no vocals — midnight garage
> workshop, warm slap-adjacent synth bass, dusty drum machine, playful lead noodles, neon
> worklight glow, 96 BPM, relaxed tinkering mood, Jasper Byrne Hotline Miami calm tracks meets
> FM-84 instrumental

### RESULTS / FINISH — short sting-loop
**Title:** `Finish Line`
**Style:**
> instrumental synthwave victory outro, analog warmth, no vocals — triumphant but relaxed
> afterglow, soaring short lead motif, warm pad resolution, soft steady kick, 100 BPM, medal
> ceremony under neon, satisfying resolution that can loop quietly, 60 to 90 seconds

---

## 4. Shipping set (start here, expand later)

| File | Prompt | Priority |
|---|---|---|
| `audio/music/menu.ogg` | Driftdream Theme | 1 |
| `audio/music/dune_a.ogg` | Dune Drive | 1 |
| `audio/music/neon_a.ogg` | Neon Rain | 1 |
| `audio/music/canyon_a.ogg` | Canyon Dusk | 1 |
| `audio/music/frozen_a.ogg` | Frozen Aurora | 1 |
| `audio/music/finish.ogg` | Finish Line | 2 |
| `audio/music/garage.ogg` | Garage Groove | 2 |
| `audio/music/{biome}_b.ogg` | B-takes ×4 | 3 |

Priority 1 = playable milestone (5 files, ~12–15 MB). Full set ≈ 11 files ≈ 25–30 MB APK growth
(approved). PWA/browser unaffected — music loads lazily, never precached.

## 5. Export + trim workflow

1. Download from Suno as WAV (or highest MP3 if WAV unavailable).
2. Trim to a clean bar-aligned loop: cut the intro until the groove is fully in; cut before any
   outro thinning. Crossfade the seam 50–100 ms if it clicks (Audacity: Effect → Crossfade Clips).
3. Loudness: normalize all tracks to roughly the same perceived level (−16 LUFS integrated is a
   good target; Audacity: Effect → Loudness Normalization). Consistency matters more than the
   absolute number — the in-game `music` slider does the rest.
4. Export **OGG Vorbis, quality 4 (~128 kbps), 44.1 kHz stereo**, filenames exactly as the table.
5. Drop into `audio/music/`, tell Claude — player integration (SQ2) reads that folder layout.

## 6. Licensing note

Commercial use of Suno output requires the paid plan on the account that generates. Keep the
generating account consistent (yours), keep the Suno generation links/IDs in a text file next to
the audio for provenance.
