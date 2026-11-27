import BaseController, { Route, Status } from '@pollium/readable/http/Controller';
import { Body } from '@pollium/readable/http/params';
import Note from '../models/Note';
import { CreateNoteInput } from '../contracts/note';

export default class NoteController extends BaseController{
    @Route('/', 'POST')
    @Status(201)
    create(@Body() input: CreateNoteInput){
        return Note.create({ ...input }).save();
    }

    @Route('/')
    list(){
        return Note.find({ order: { createdAt: 'ASC' } });
    }
}
