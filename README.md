# Readable

Readable is the backend framework behind Pollium's APIs.

**Why?** AI writes more code today than anyone can stop to read. If every line still needs a human to follow
it, that human is the bottleneck. Readable makes the code an API needs small and decided in advance,
so what is left to read is the business logic. Every app lays out the same way, so you know where
everything is in a codebase you have never opened.

## Where everything is

```
tsconfig.json        { "extends": "@pollium/readable/tsconfig.json" }
vite.config.ts       export default readableConfig();
src/
  server.ts
  modules/
    notes/
      controllers/   routes
      models/        tables
      services/      business logic
      events/        event handlers
      queues/        background jobs
      gateways/      WebSocket channels
```

Every file in `controllers`, `models`, `events`, `queues` and `gateways` is found and mounted on boot.
There is no file to register it in.

## An endpoint

Express:

```ts
import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { dataSource } from '../db';
import { Note } from '../entities/Note';

const CreateNote = z.object({
    title: z.string().min(1),
    body: z.string()
});

const authenticate = (req, res, next) => {
    const header = req.headers.authorization;
    if(!header?.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });

    try{
        res.locals.userId = jwt.verify(header.slice(7), process.env.JWT_SECRET).sub;
        next();
    }catch{
        res.status(401).json({ error: 'Unauthorized' });
    }
};

export const notes = Router();

notes.post('/notes', authenticate, async (req, res) => {
    const input = CreateNote.safeParse(req.body);
    if(!input.success) return res.status(400).json({ error: 'ValidationFailed', errors: input.error.flatten().fieldErrors });

    const note = await dataSource.getRepository(Note).save({ ...input.data, ownerId: res.locals.userId });
    res.status(201).json({ data: note });
});

notes.get('/notes/:id', authenticate, async (req, res) => {
    const note = await dataSource.getRepository(Note).findOneBy({ id: req.params.id, ownerId: res.locals.userId });
    if(!note) return res.status(404).json({ error: 'NotFound' });

    res.json({ data: note });
});
```

Readable:

```ts
// the contracts package, shared with the web app
import { get, post } from '@pollium/readable-contracts/routing';
import { defineErrors } from '@pollium/readable-contracts/errors';
import { Note } from './domain';

export const NoteErrors = defineErrors({ domain: 'Note', causes: { NotFound: 404 } });

export interface CreateNoteInput{
    /** @minLength 1 */
    title: string;
    body: string;
}

export const noteRoutes = {
    create: post<CreateNoteInput, Note>('/notes'),
    get: get<Note>('/notes/:id')
};
```

```ts
// src/modules/notes/controllers/Note.ts
import NoteService from '../services/Note';
import { Route, Status } from '@pollium/readable/http/Controller';
import { Body, IdParam } from '@pollium/readable/http/params';
import { AuthenticatedController } from '@pollium/readable/auth/guards';
import { CurrentUser } from '@pollium/readable/auth/params';
import { CreateNoteInput, noteRoutes } from '@app/contracts/notes';

export default class NoteController extends AuthenticatedController{
    #notes = new NoteService();

    @Route(noteRoutes.create)
    @Status(201)
    create(@CurrentUser() userId: string, @Body() input: CreateNoteInput){
        return this.#notes.create(userId, input);
    }

    @Route(noteRoutes.get)
    get(@CurrentUser() userId: string, @IdParam('id') id: string){
        return this.#notes.get(userId, id);
    }
}
```

```ts
// src/modules/notes/services/Note.ts
import Note from '../models/Note';
import { findOrThrow } from '@pollium/readable/database/queries';
import { CreateNoteInput, NoteErrors } from '@app/contracts/notes';

export default class NoteService{
    create(ownerId: string, input: CreateNoteInput): Promise<Note>{
        return Note.create({ ...input, ownerId }).save();
    }

    get(ownerId: string, id: string): Promise<Note>{
        return findOrThrow(Note, { id, ownerId }, NoteErrors.NotFound);
    }
}
```

The controller only says which route calls which piece of logic. Readable checks the bearer token,
validates the body against the `CreateNoteInput` type, rejects an `id` that is not a UUID, wraps the
answer in `{ data }` and turns `Note::NotFound` into a 404. `noteRoutes` and `NoteErrors` are the same
contracts the web app reads, so both sides share one path, one type and one error code.

## Starting the API

Express:

```ts
import express from 'express';
import cors from 'cors';
import { dataSource } from './db';
import { notes } from './routes/notes';
import { projects } from './routes/projects';

const app = express();
app.set('trust proxy', 'loopback, linklocal, uniquelocal');
app.use(cors({ origin: process.env.CORS_ORIGIN?.split(','), credentials: true }));
app.use(express.json());
app.use(notes);
app.use(projects);
app.get('/health', (_req, res) => res.json({ status: 'ok' }));
app.use((err, _req, res, _next) => {
    console.error(err);
    res.status(500).json({ error: 'Internal' });
});

await dataSource.initialize();
const server = app.listen(Number(process.env.PORT));

for(const signal of ['SIGTERM', 'SIGINT']){
    process.on(signal, () => server.close(() => dataSource.destroy().then(() => process.exit(0))));
}
```

Readable:

```ts
// src/server.ts
import 'reflect-metadata';
import { readable } from '@pollium/readable/app/readable';
import { listen } from '@pollium/readable/app/Application';

listen(readable());
```

`readable()` reads `PORT`, `DATABASE_URL`, `REDIS_HOST`, `REDIS_PORT`, `JWT_SECRET`, `CORS_ORIGIN` and
`STORAGE_*` from the environment and mounts everything under `src/modules`. A new module never touches
this file. Compression, request logging, `/health`, error answers, the websocket for gateways, graceful
shutdown and the store behind `@RateLimit` come with it.
