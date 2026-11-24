import BaseController, { Route } from '../../../../../../../lib/http/Controller';

export default class NoteController extends BaseController{
    @Route('/latest')
    latest(){
        return 'first';
    }
}
