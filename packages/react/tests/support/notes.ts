import { defineErrors } from '@pollium/readable-contracts/errors';
import { PageOf } from '@pollium/readable-contracts/http';
import { gateway } from '@pollium/readable-contracts/gateway';
import { del, get, patch, post } from '@pollium/readable-contracts/routing';
import { tags } from 'typia';

export interface Note{
    id: string;
    title: string;
}

export interface CreateNoteInput{
    title: string;
}

export interface RenameNoteInput{
    title: string & tags.MinLength<3> & tags.MaxLength<20>;
}

export const noteRoutes = {
    list: get<Note[]>('/notebooks/:notebookId/notes'),
    get: get<Note>('/notebooks/:notebookId/notes/:noteId'),
    create: post<CreateNoteInput, Note>('/notebooks/:notebookId/notes'),
    update: patch<Partial<CreateNoteInput>, Note>('/notebooks/:notebookId/notes/:noteId'),
    rename: patch<RenameNoteInput, Note>('/notebooks/:notebookId/notes/:noteId/title'),
    remove: del('/notebooks/:notebookId/notes/:noteId'),
    archive: post<void, Note>('/notebooks/:notebookId/notes/:noteId/archive'),
    notebooks: get<{ id: string }[]>('/notebooks'),
    search: post<{ text: string }, Note[]>('/notes/search'),
    me: get<{ id: string }>('/me'),
    download: get<void>('/notebooks/:notebookId/export'),
    members: get<{ id: string }[]>('/teams/:teamId/members'),
    cluster: get<{ status: 'waiting' | 'ready' }>('/cluster'),
    feed: get<PageOf<Note>>('/notebooks/:notebookId/feed'),
    post: post<CreateNoteInput, Note>('/notebooks/:notebookId/feed'),
    removeMember: del('/teams/:teamId/members/:memberId')
};

export const NoteErrors = defineErrors({
    domain: 'Note',
    causes: {
        NotFound: 404,
        Locked: 409
    }
});

export interface NoteFrames{
    'note.changed': Note;
    'note.watch': Note[];
    'note.confirm': { question: string };
}

export interface NoteMessages{
    'note.watch': { notebookId: string };
    'note.unwatch': { notebookId: string };
    'note.confirm': { yes: boolean };
    'note.typing': { noteId: string };
}

export const noteGateway = gateway<NoteFrames, NoteMessages>('/notes/live');
