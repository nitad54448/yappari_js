# script/

Place for third-party JavaScript libraries (local copies of CDN files), loaded from `index.html` with
`<script src="script/...">` before the files in `js/`.

Step 1 of Yappari JS needs none: plots are drawn by `js/ui/plot2d.js` and `js/ui/plot3d.js` on a canvas,
so the program runs offline from `file://` and stays fast with thousands of curves.
