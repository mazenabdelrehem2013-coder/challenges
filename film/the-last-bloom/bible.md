# The Last Bloom — story bible

**Format:** short film, 30 seconds, cinematic live action (AI-generated), 16:9, music only (no dialogue).

## Logline

A small, rusting gardening robot, the last caretaker of an abandoned glasshouse, shields the only living
flower with its own body when a storm brings the roof down.

## Shape

- **Beginning:** at dusk, the robot waters its one surviving flower among dead plants.
- **Turn:** thunder cracks the glass roof; the panes fall, and the robot curls over the flower.
- **End:** at dawn the flower stands untouched beneath the robot, which hasn't moved; its eye flickers once.

**Tone:** quiet, tender, bittersweet.

## Characters

**PIP** (the only character)
> PIP: small fictional gardening robot about one metre tall, rounded capsule-shaped head with a single round amber lens eye set off-centre on the right of the face, pale sage-green painted steel body with heavily chipped paint showing dark grey metal underneath, black rubber joints at the neck, shoulders, elbows and knees, thin jointed arms with three-fingered dark grippers, two short legs with chunky feet.

(Block revised after the turnaround: the sheet gave Pip legs, not treads; the sheet is now the reference.)

- **Voice:** none; it speaks through the tilt of its head and its eye light.
- **Want and arc:** wants to keep the last flower alive; ends having given everything to do it.
- **Prop:** a small dented brass watering can (right hand), dropped in the storm.

**THE FLOWER**
> THE FLOWER: one vivid red flower with four soft petals and a dark centre on a single green stem, in a small cracked terracotta pot.

## World and location

The world: some time after people left. No people, no animals, no modern screens or signs. It rains through the storm and stops by dawn.

> THE GLASSHOUSE: abandoned Victorian glasshouse, white-painted iron frame with peeling paint, arched glass roof of small dirty panes with some missing, wooden potting benches along both sides crowded with dead brown plants and empty clay pots, cracked stone tile floor with moss between the tiles, the small terracotta pot standing alone on the floor in the middle of the central aisle.

## Visual style block

> STYLE: cinematic live-action film still, 35mm anamorphic lens look, shallow depth of field, fine film grain, natural moody light, palette of slate blue, rust orange, sage green and faded white with a single vivid red accent, muted desaturated grade except the red flower, no text, no logos, no watermark, no people.

## Scene list

```
S01 | THE GLASSHOUSE | dusk, storm coming | PIP | Pip waters the last flower; the storm breaks the roof; Pip shields it | 0:00-0:20
S02 | THE GLASSHOUSE | dawn, after the storm | PIP | The flower survived; Pip has not moved           | 0:20-0:30
```

## Shot list

| Shot | Size | Angle | Move | Action (start to end) | Sec | Sound |
|---|---|---|---|---|---|---|
| S01-SH01 | extreme wide | eye level, outside | slow push in | The glasshouse alone on a hill under heavy storm clouds; a faint amber light glows inside | 5 | music |
| S01-SH02 | medium | eye level | locked off | Pip tilts the watering can and gently waters the red flower | 5 | music |
| S01-SH03 | close-up | low, looking up | slow tilt up from Pip's eye to the roof | Lightning flashes; Pip looks up as a crack spreads across the glass above | 4 | music |
| S01-SH04 | wide | low | locked off, slow motion | Roof panes shatter and fall; Pip drops the can and curls over the flower, glass raining on its back | 6 | music |
| S02-SH01 | wide | eye level | locked off | Dawn light through the broken roof; Pip crouched and still, covered in glass shards, dust in the light beams | 5 | music |
| S02-SH02 | close-up | eye level | slow push in, ends on the flower | Beneath Pip's arms the red flower stands untouched with a drop of water; Pip's eye flickers faintly once | 5 | music |

**Total: 30 seconds.** Screen direction: Pip faces right throughout; the flower is always at Pip's right hand.

## Assets

| Asset | Link |
|---|---|
| Pip turnaround | https://asset.imagine.art/processed/a10e0973-943d-466e-a2c4-69cf86098ec9 |
| Glasshouse plate | https://asset.imagine.art/processed/f33d8c92-1604-4af5-ac2e-4b2f338a1ce9 |
| Keyframe S01-SH01 | https://asset.imagine.art/processed/082fb2ca-d052-47c4-abeb-709d8b203fba |
| Keyframe S01-SH02 | https://asset.imagine.art/processed/fe1de652-6b7e-4e50-a429-244584502b0f |
| Keyframe S01-SH03 | https://asset.imagine.art/processed/68359c5e-b18a-498e-a2fe-093075e6a66f |
| Keyframe S01-SH04 | https://asset.imagine.art/processed/9c603368-5800-4373-b5ea-753799ac224a |
| Keyframe S02-SH01 (T2; T1 rejected: flower looked crushed) | https://asset.imagine.art/processed/29b8f1c8-65f4-4634-ba21-5daab8f7d9cb |
| Keyframe S02-SH02 | https://asset.imagine.art/processed/d7952cb4-7236-461b-9f80-e5a0c9e69a2e |
| Storyboard | [storyboard.jpg](storyboard.jpg) |
| Clip S01-SH04 T1 (approved, used 0.4–6.4 s) | https://asset.imagine.art/processed/469de00d-c13d-46a3-82d7-2aff67b4797f |
| Clips for the other 5 shots | not made: ran out of ImagineArt credits (453 left; a 6 s 1080p clip costs more) |
| Music cue (30 s instrumental: quiet to 11 s, swell 12–19 s, drops at 20 s, resolves, silent by 26 s) | https://asset.imagine.art/processed/01a1c7dc-f182-7480-afd1-3c3512ec2830 |
| Cut v1 | [the-last-bloom.mp4](the-last-bloom.mp4), built with [build.sh](build.sh) |

## Notes for the shoot

- Every keyframe has thin black bars at the left and right (inherited from the glasshouse plate): crop them in the edit.
- S01-SH03: the roof crack is not yet visible in the keyframe; the clip prompt must have it spread across the pane.
- Plan: seedance-2.5, 1080p, durations 6/6/5/7/6/6 s (shot + ~1 s handles), clip prompts say "Audio: no music, no speech" so the score can go on top. Test shot: S01-SH04.

## Cut v1 (what is real footage and what is not)

| Time | Shot | In the cut |
|---|---|---|
| 0:00–0:05 | S01-SH01 | keyframe, slow push in, rain layer added in ffmpeg |
| 0:05–0:10 | S01-SH02 | keyframe, slow push in |
| 0:10–0:14 | S01-SH03 | keyframe, tilt up, two lightning flashes added in ffmpeg |
| 0:14–0:20 | S01-SH04 | **real Seedance clip** |
| 0:20–0:25 | S02-SH01 | keyframe, slow push in, light warming |
| 0:25–0:28.5 | S02-SH02 | keyframe, slow push in, eye flicker added in ffmpeg |
| 0:28.5–0:30 | title | "THE LAST BLOOM" on black |

To upgrade a shot to real footage: generate its clip with the prompt from the shooting plan, save it in `clips/`, and replace its `still` line in `build.sh` with a clip line like shot 4's.
