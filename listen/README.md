# Listening

Listen to your Google Docs on your phone: **https://tinkeringdad.github.io/listen/**

Paste a Google Doc link and tap **Listen**. The document is split into
chapters at its headings, and each chapter is voiced when you get to it with
Google's Chirp 3 HD voices.

## How to add a new document

1. Open the document in Google Docs and copy its link (Share → Copy link, or the
   address bar).
2. On the Listening page, paste the link and tap **Listen**.

That's it. It shows up under **Recent** from then on. If you edit the
document later, open it and tap **Chapters → Check the Google Doc for
changes**. Only the chapters whose text changed get voiced again.

Tips for documents written to be heard:
- Use Google Docs headings (Heading 1, Heading 2…). The biggest level that
  appears more than once becomes the chapters. Chapters longer than about
  13 minutes are split into parts.
- Links, web addresses, images, code blocks and Markdown symbols are not read
  aloud. Headings get a short pause before them.

## How the audio gets made

```
Phone (this page) ──sign in with Google──▶ your Listening server (Cloud Run)
                                              │ reads the Google Doc as you
                                              │ voices one chapter (Chirp 3 HD)
                                              ▼
                                  private bucket: audio + text, kept
```

- **The page** (`index.html`, `app.js`) holds no key. You sign in with Google;
  the server checks it's you and gives the phone a pass that lasts 30 days.
  Opening a new link asks Google for permission to read your Docs (read only).
- **The server** (`server/main.py`) runs in your Google Cloud project as the
  *listening-robot* account, which can use Text-to-Speech and your private
  bucket and nothing else. No key exists. Only your Google account can use it.
- **Chapters are voiced on demand.** The text is split into pieces under the
  voice service's size limit, voiced, joined with short pauses and saved as an
  MP3, together with the time each paragraph starts (for the highlighting).
  The next chapter is prepared when you're 80% through, or 2 minutes from the
  end.
- **Nothing is voiced twice.** A chapter is stored under a fingerprint of its
  text and the voice. Unchanged chapters are reused, on any phone.
- **On the phone**, chapters you play or save (↓) are kept so they play
  with no signal. Your place in each document is remembered.

## What it costs

Chirp 3 HD voices are billed by characters of text, and **the first 1 million
characters each month are free**. That's about 160,000 words, or about 18
hours of listening. After that it's $30 per million characters.

| | Characters | Cost |
|---|---|---|
| A 4,000-word document (about 25 minutes) | about 26,000 | free (2.6% of the monthly allowance) |
| Beyond the free 1 million, the same document | | about 80¢ |
| Voice samples | about 80 per voice, once | free |

The page shows how much of this month's free allowance the reader has used.
Google counts the allowance across your whole billing account. The server
(Cloud Run) and storage fit in Google's free tiers at this level of use.
Prices change, so check
[Google's price page](https://cloud.google.com/text-to-speech/pricing).

## One-time setup (already done for this site)

1. In Google Cloud (project with billing on), open Cloud Shell (**>_**) and run:
   ```bash
   bash <(curl -sL https://tinkeringdad.github.io/listen/setup.sh)
   ```
   It turns on the services, creates the robot account and the private bucket,
   then builds and starts the server. Run it again any time to install updates.
2. In **Google Auth Platform → Clients**, have a *Web application* client
   with `https://tinkeringdad.github.io` as an authorized JavaScript origin,
   and your account under **Audience → Test users**. Its Client ID goes in
   `config.js`.

## Testing locally

```bash
cd listen/server
pip install -r requirements.txt
python -m unittest discover -s tests
python tests/devserver.py some-folder-of-md-files     # stand-in Google, espeak voice
# in another terminal, from listen/:
python -m http.server 8000    # then open http://localhost:8000/?dev
```
