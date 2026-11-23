import { RateLimitErrors } from '@pollium/readable-contracts/errors';
import { defineErrors } from '../utils/errors/define-errors';

export const RateLimitError = defineErrors(RateLimitErrors);