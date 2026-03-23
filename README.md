# DeenSubs

Arabic Islamic content with accurate English subtitles, powered by AI.

## Stack

- **Edge**: Cloudflare Workers
- **Storage**: Cloudflare R2 (S3-compatible, free tier)
- **ASR**: ElevenLabs Scribe v2 (Arabic transcription)
- **Translation**: AI-powered Arabic → English

## Setup

```bash
npm install
npm run r2:create    # create R2 bucket (once)
npm run dev          # local dev server
npm run deploy       # deploy to Cloudflare
```

## Project Structure

```
deensubs/
├── src/
│   └── worker.js       # Cloudflare Worker (API + SSR)
├── wrangler.toml       # Cloudflare config
└── package.json
```

## How It Works

1. Arabic Islamic lectures are sourced from trusted scholars
2. ElevenLabs Scribe v2 transcribes the Arabic audio
3. AI translates the transcription to English, preserving Islamic terminology
4. Subtitles are synced and rendered for seamless viewing
