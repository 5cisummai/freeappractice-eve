# Free AP Practice Eve Coach

Pip's model and tool loop for Web Coach. Free AP Practice remains the source of truth for authorizations, conversations, attachments, and credits. Eve uses a fresh private session for each app turn. It imports the app's conversation history, then ends the session after forwarding the response. Web Coach resumes inline cards and approvals from its stored conversation.

## Local development

Use Node.js 24 and run `npm ci`, `npm run check`, and `npm run dev -- --no-ui`. Configure the service using `.env.example`. In the app, set `COACH_EVE_URL` to the service origin and use the same `COACH_EVE_SERVICE_SECRET` on both sides. The app alone needs a separate `COACH_EVE_TURN_SECRET`. Use distinct credentials for local development, preview, and production.

`POST /coach/v1/turn` serves newline-delimited Eve events to the app. The caller supplies an opaque turn reference while its signed, scoped grant stays in the app's Redis namespace. App-owned tools are served by `/api/coach-tools/v1/[tool]`. The built-in Eve session endpoints deny authentication and the health endpoint remains available.

## Release

Deploy the Eve service with the corresponding app tool API and credentials. Verify Web Coach in an app preview before promoting the app. If Vercel protects the preview callback, configure a preview-specific trusted source or supply an approved automation bypass in `COACH_APP_VERCEL_BYPASS`. The app supports `COACH_EVE_VERCEL_BYPASS` when its Eve target is protected. Include a complete app turn with a tool call, a reload and continuation for both card types, a quoted reply, and a reaction-only response. The application uses Eve for every Coach turn after deployment. Roll back to the previous app deployment if the cutover fails.
