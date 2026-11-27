import { defineErrors } from '@pollium/readable-contracts/errors';
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
}

export interface NoteMessages{
    'note.watch': { notebookId: string };
}

export const noteGateway = gateway<NoteFrames, NoteMessages>('/notes/live');
