# Third-party notices

## Tanuki Rush (the game)

This project ships a compiled copy of **TANUKI RUSH**, a browser game by
[tanuu5](https://github.com/tanuu5) (たぬ).

- Source: https://github.com/tanuu5/tanuki-rush
- License: MIT — Copyright (c) 2026 たぬ
- Bundled as: `mobile/assets/web/` (built with `npm run build` from the upstream source)

The full MIT text is reproduced in [`LICENSE-tanuki-rush`](LICENSE-tanuki-rush), as the
license requires.

**What this project did not do:** the game itself — the 3D course, the tanuki model,
the city, the music and sound effects, the physics and the HUD — was written by the
original author. This project adds a native Android shell around it.

**What this project did:** the Flutter application, the loopback asset server, the
Android configuration, offline font bundling, and the build pipeline.

## three.js

The game uses [three.js](https://threejs.org/), MIT License, Copyright © 2010-2024
three.js authors. It is compiled into `mobile/assets/web/assets/`.

## Fonts

| Family | Source | License |
| --- | --- | --- |
| Exo 2 | Google Fonts | SIL Open Font License 1.1 |
| M PLUS Rounded 1c | Google Fonts | SIL Open Font License 1.1 |

Only the `latin` and `latin-ext` subsets are bundled (in `mobile/assets/web/fonts/`) so
the app renders identically without a network connection.

## Flutter / Dart

Built with the Flutter SDK (BSD 3-Clause) and the `flutter_inappwebview` plugin (MIT).
