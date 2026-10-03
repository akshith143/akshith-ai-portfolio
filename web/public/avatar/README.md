# Avatar assets

The site picks the best avatar it finds here, in this order:

1. **`avatar.glb`** — a 3D model of you. Rendered with three.js and lip-synced to the cloned voice.
   It needs facial morph targets (ARKit blendshapes like `jawOpen`, `eyeBlinkLeft`, and/or Oculus
   visemes like `viseme_aa`). Photo-to-avatar tools such as **Avaturn** export exactly this:
   upload a selfie → export GLB "with ARKit blendshapes" → save it here as `avatar.glb`.
   Keep it small so it loads fast — compress it with:
   `npx @gltf-transform/cli optimize model.glb avatar.glb --compress meshopt --texture-compress webp --texture-size 1024 --simplify false`
   (13 MB → 2.2 MB for an Avaturn export, with every face shape intact).
2. **`photo.webp` / `photo.jpg` / `photo.png`** — a square, well-lit headshot (≥ 600×600).
   Shown as an animated portrait with a voice-reactive ring.
3. Nothing here → your GitHub avatar is used.

Restart the server after adding or changing files.
