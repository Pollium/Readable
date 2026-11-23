import { RequestErrors } from '@pollium/readable-contracts/errors';
import { defineErrors } from '../utils/errors/define-errors';

export const RequestError = defineErrors(RequestErrors);
