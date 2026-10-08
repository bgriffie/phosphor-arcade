# Phosphor Arcade

Four classic games in one offline home-screen web app, in the PHOSPHOR theme:
Snake, 2048, Mines (Minesweeper) and Blocks (a falling-blocks puzzle). Best scores stay on the phone.

Live: https://bgriffie.github.io/phosphor-arcade/

Install on iPhone: open the link in Safari, tap Share, then Add to Home Screen.

`index.html` is built from `src/` with `python3 build.py`, which inlines `phosphor.css` and `phosphor.js` from the brand folder.
When anything changes, bump `CACHE` in `sw.js` and the version in the app header.
