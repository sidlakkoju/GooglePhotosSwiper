The request payloads and response field mappings in photos-api.js are adapted from Google Photos Toolkit by xob0t, licensed under MIT. Full notice: LICENSE-GPTK.
Source: https://github.com/xob0t/Google-Photos-Toolkit
Reviewed revision: 6db9ab355e4797327e4078cf87a2b6994d36cf73
This narrow adapter supports read/import/create-album/add-to-album only. It contains no trash, permanent-delete, or sharing commands. Google login cookies and WIZ page tokens remain inside the Google Photos page and are never returned to the app or local server.
