# Free AI Review Generator (English) — restaurant / cafe / clinic

Customer scans QR -> picks rating + points -> AI writes 3 reviews -> customer picks/edits
-> "Copy & Post" -> Google review page opens -> customer pastes and submits.

## 1. Get free API keys (5 min)
- Gemini: https://aistudio.google.com/apikey  (free, no card)
- Groq (backup, optional): https://console.groq.com/keys

## 2. Deploy free on Vercel
1. Put this folder on GitHub (new repo, upload files) — or use `npx vercel` from this folder.
2. vercel.com -> Add New Project -> import the repo -> Deploy.
3. Project Settings -> Environment Variables: add GEMINI_API_KEY (and GROQ_API_KEY). Redeploy.
4. Your site is live at https://<project>.vercel.app

## 3. Add a business
Edit `businesses.json`, add a block:
  "sharma-clinic": { "name": "Sharma Clinic", "type": "clinic", "placeId": "ChIJ....",
                     "tagline": "Thanks for visiting!", "color": "#0f766e", "logo": "" }
- type: restaurant | cafe | clinic
- key ("sharma-clinic") becomes the link: https://<site>/?b=sharma-clinic
- Find placeId: https://developers.google.com/maps/documentation/places/web-service/place-id (search business, copy ID)
  (or set "reviewUrl" to the business's own "Get more reviews" short link instead of placeId)
Push to GitHub -> Vercel redeploys automatically.

## 4. Make the QR
Open https://<site>/qr.html?b=sharma-clinic -> Download PNG / Print -> put on a standee.

## Change things
- Tags/options: top of index.html (TAGS, LOW_TAGS)
- Review style/rules: buildPrompt() in api/review.js
- Model: env var GEMINI_MODEL (default gemini-2.5-flash-lite)
- Colors/logo: per business in businesses.json
