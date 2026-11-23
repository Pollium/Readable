import BaseController from '../http/Controller';
import { Middleware } from '../http/middleware';
import { AuthenticatedRoute } from './AuthenticatedRoute';

@Middleware(AuthenticatedRoute)
export default abstract class AuthenticatedController extends BaseController{}
