import { ServerErrors } from '@pollium/readable-contracts/errors';
import { defineErrors } from '../utils/errors/define-errors';

export const ServerError = defineErrors(ServerErrors);
