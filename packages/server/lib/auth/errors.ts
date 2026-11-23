import { AuthErrors } from '@pollium/readable-contracts/errors';
import { defineErrors } from '../utils/errors/define-errors';

export const AuthError = defineErrors(AuthErrors);
